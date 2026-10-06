/* Market data, AI, Pro payments, uploads: small wrappers the page calls through window.SN. */
import { PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { api, config } from './api';
import { connection, sendAndConfirm } from './chain';
import { wallet } from './wallet';

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const qs = (o: Record<string, string | number | undefined | null>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '') as [string, string][]).toString();

export const market = {
  majors: () => api.get('market/majors'),
  trending: () => api.get('market/trending'),
  launches: (limit = 60) => api.get(`launches?limit=${limit}`),
  launch: (mint: string) => api.get(`launches/${mint}`),
  sync: (mint: string) => api.post(`launches/${mint}/sync`),
  token: (mint: string) => api.get(`market/token/${mint}`),
  candles: (o: { mint?: string; pool?: string; tf: string }) => api.get(`market/candles?${qs(o)}`),
  trades: (o: { mint: string; pool?: string }) => api.get(`market/trades?${qs(o)}`),
  net: () => api.get('market/net'),
  feed: () => api.get('feed'),
  profile: (w: string) => api.get(`profile/${w}`),
  walletTrades: (w: string) => api.get(`wallet/${w}/trades`),
};

export const ai = {
  builder: (concept: string) => api.post('ai/builder', { concept }, 45000),
  analyze: (o: { mint: string; preset?: string; question?: string }) => api.post('ai/analyze', o, 70000),
  quota: () => api.get('ai/quota'),
};

/* ---------- images: square-crop on a canvas, then pin to IPFS ---------- */
function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('Image failed to load.')); i.src = src; });
}
export async function squareDataUrl(src: string, size = 512): Promise<string> {
  const img = await loadImg(src);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.9);
}
export const proxied = (pexelsUrl: string) => `/api/images/proxy?u=${encodeURIComponent(pexelsUrl)}`;

export const media = {
  search: (q: string) => api.get(`images/search?q=${encodeURIComponent(q)}`),
  async uploadImage(src: string, symbol: string) {
    const dataUrl = src.startsWith('data:image/') ? (src.length > 1_900_000 ? await squareDataUrl(src) : src) : await squareDataUrl(src.startsWith('https://images.pexels.com/') ? proxied(src) : src);
    return api.post<{ url: string; cid: string }>('upload/image', { dataUrl, symbol }, 45000);
  },
  uploadMetadata: (m: { name: string; symbol: string; description: string; image: string; twitter?: string; telegram?: string; website?: string }) =>
    api.post<{ uri: string; cid: string }>('upload/metadata', m, 45000),
};

/* ---------- Pro ---------- */
export const pro = {
  status: () => api.get('pro/status'),
  async checkout() {
    await wallet.signIn();
    const { url } = await api.post<{ url: string }>('pro/checkout');
    location.assign(url);
  },
  confirm: (sessionId: string) => api.post('pro/confirm', { sessionId }),
  async portal() { const { url } = await api.post<{ url: string }>('pro/portal'); location.assign(url); },
  /** Pay for Pro with SOL straight from the connected wallet (transfer tagged with a reference key + memo). */
  async payWithSol(onStep?: (s: 'quote' | 'sign' | 'confirm' | 'verify') => void) {
    await wallet.signIn();
    onStep?.('quote');
    const q = await api.post<{ id: string; reference: string; lamports: number; treasury: string; days: number }>('pro/sol/quote');
    const from = new PublicKey(wallet.state.address!);
    const conn = await connection();
    const { blockhash } = await conn.getLatestBlockhash('confirmed');
    const transfer = SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(q.treasury), lamports: q.lamports });
    transfer.keys.push({ pubkey: new PublicKey(q.reference), isSigner: false, isWritable: false });
    const memo = new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: new TextEncoder().encode(`Supernova Pro ${q.days}d`) as any });
    const cfg = await config();
    const ixs = [...(cfg.cluster === 'mainnet' ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), ComputeBudgetProgram.setComputeUnitLimit({ units: 30_000 })] : []), transfer, memo];
    const msg = new TransactionMessage({ payerKey: from, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
    onStep?.('sign');
    const signed = await wallet.signOne(new VersionedTransaction(msg));
    onStep?.('confirm');
    const sig = await sendAndConfirm(signed);
    onStep?.('verify');
    let last: any;
    for (let i = 0; i < 5; i++) {
      try { return { signature: sig, status: await api.post('pro/sol/verify', { quoteId: q.id, signature: sig }) }; }
      catch (e: any) { last = e; if (e?.code !== 'tx_not_found') break; await new Promise((r) => setTimeout(r, 2500)); }
    }
    throw last;
  },
  async buySol(amountUsd?: number) {
    const address = wallet.state.address;
    if (!address) throw new Error('Connect a wallet first.');
    const { url } = await api.post<{ url: string }>('onramp/moonpay', { address, amountUsd });
    return url;
  },
};
