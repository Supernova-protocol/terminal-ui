/* Solana connection, balances and a robust send → confirm loop (HTTP polling only, no websockets). */
import { Connection, PublicKey, VersionedTransaction, LAMPORTS_PER_SOL, type Commitment } from '@solana/web3.js';
import { api, config, ApiError } from './api';

export const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

let conn: Connection | null = null;
export async function connection(): Promise<Connection> {
  if (conn) return conn;
  const cfg = await config();
  const url = /^https?:\/\//.test(cfg.rpcUrl) ? cfg.rpcUrl : location.origin + cfg.rpcUrl;
  conn = new Connection(url, { commitment: 'confirmed' as Commitment, disableRetryOnRateLimit: false });
  return conn;
}

export async function cluster() { return (await config()).cluster; }

export function explorer(kind: 'tx' | 'address' | 'token', id: string, net: 'mainnet' | 'devnet') {
  const q = net === 'devnet' ? '?cluster=devnet' : '';
  return `https://solscan.io/${kind === 'tx' ? 'tx' : kind === 'token' ? 'token' : 'account'}/${id}${q}`;
}

export async function solBalance(owner: string): Promise<number> {
  const c = await connection();
  return (await c.getBalance(new PublicKey(owner), 'confirmed')) / LAMPORTS_PER_SOL;
}

const decCache = new Map<string, number>();
/** Decimals of an SPL / Token-2022 mint (cached). */
export async function mintDecimals(mint: string): Promise<number | null> {
  if (mint === SOL_MINT) return 9;
  if (decCache.has(mint)) return decCache.get(mint)!;
  const c = await connection();
  const r = await c.getParsedAccountInfo(new PublicKey(mint), 'confirmed');
  const d = (r.value?.data as any)?.parsed?.info?.decimals;
  if (typeof d === 'number') { decCache.set(mint, d); return d; }
  return null;
}

export type Holding = { mint: string; amount: number; decimals: number; raw: string; program: 'spl' | 't22' };
/** All non-zero SPL + Token-2022 balances of a wallet. */
export async function tokenHoldings(owner: string): Promise<Holding[]> {
  const c = await connection();
  const pk = new PublicKey(owner);
  const [a, b] = await Promise.all([
    c.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROGRAM }, 'confirmed'),
    c.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_2022_PROGRAM }, 'confirmed').catch(() => ({ value: [] as any[] })),
  ]);
  const out = new Map<string, Holding>();
  const add = (list: any[], program: 'spl' | 't22') => {
    for (const x of list) {
      const info = x.account?.data?.parsed?.info;
      if (!info) continue;
      const amt = info.tokenAmount;
      const ui = Number(amt.uiAmountString ?? amt.uiAmount ?? 0);
      if (!(ui > 0)) continue;
      const prev = out.get(info.mint);
      if (prev) { prev.amount += ui; prev.raw = (BigInt(prev.raw) + BigInt(amt.amount)).toString(); }
      else out.set(info.mint, { mint: info.mint, amount: ui, decimals: amt.decimals, raw: amt.amount, program });
    }
  };
  add(a.value, 'spl'); add(b.value, 't22');
  return [...out.values()];
}

/* ---------- priority fee presets (fee in SOL over a 600k CU budget, like Raydium's UI) ---------- */
export const PRIORITY: Record<string, { sol: number; label: string }> = {
  fast: { sol: 0.00005, label: 'Fast' },
  turbo: { sol: 0.0005, label: 'Turbo' },
  ultra: { sol: 0.002, label: 'Ultra' },
};
export function computeBudget(prio: string, units = 600_000) {
  const p = PRIORITY[prio] || PRIORITY.turbo;
  return { units, microLamports: Math.max(1, Math.ceil((p.sol * 1e9 * 1e6) / units)) };
}

/* ---------- send + confirm ---------- */
export class TxError extends Error {
  code: string; signature?: string; logs?: string[];
  constructor(message: string, code: string, signature?: string, logs?: string[]) { super(message); this.code = code; this.signature = signature; this.logs = logs; }
}

const b64 = (u8: Uint8Array) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const txToBase64 = (tx: VersionedTransaction) => b64(tx.serialize());

export function explainProgramError(err: unknown, logs: string[] = []): string {
  const text = (typeof err === 'string' ? err : JSON.stringify(err || '')) + ' ' + logs.join(' ');
  if (/insufficient (funds|lamports)|InsufficientFunds|0x1\b/i.test(text)) return 'Not enough SOL for this transaction plus network fees.';
  if (/slippage|ExceededSlippage|TooLittle|too little|0x1771|0x1772|0x1774|exceed/i.test(text)) return 'Price moved beyond your slippage. Try again or raise slippage.';
  if (/PoolNotTrading|NotInFundraising|Migrat|status/i.test(text)) return 'This coin is no longer trading on the bonding curve (it may be graduating).';
  if (/blockhash|BlockhashNotFound|expired/i.test(text)) return 'The transaction expired before landing. Please retry.';
  if (/AccountNotFound|could not find account/i.test(text)) return 'An account this trade needs does not exist yet. Refresh and retry.';
  return 'The transaction failed on-chain.';
}

/** Sends a signed transaction (through our API, optionally via Jito) and polls until confirmed. */
export async function sendAndConfirm(signed: VersionedTransaction, opts: { mev?: boolean; timeoutMs?: number; onSent?: (sig: string) => void } = {}) {
  const raw = txToBase64(signed);
  let sig: string;
  try {
    const r = await api.post<{ signature: string; via: string }>('tx/send', { tx: raw, mev: !!opts.mev }, 25000);
    sig = r.signature;
  } catch (e: any) {
    if (e instanceof ApiError) throw new TxError(e.message, e.code || 'send_failed');
    throw e;
  }
  opts.onSent?.(sig);
  const c = await connection();
  const start = Date.now();
  const timeout = opts.timeoutMs ?? 75_000;
  let n = 0;
  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, n < 4 ? 700 : 1300));
    n++;
    let st: any = null;
    try { st = (await c.getSignatureStatuses([sig])).value[0]; } catch { /* transient RPC error: keep polling */ }
    if (st?.err) {
      let logs: string[] = [];
      try { const tx = await c.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }); logs = tx?.meta?.logMessages || []; } catch { /* ignore */ }
      throw new TxError(explainProgramError(st.err, logs), 'tx_failed', sig, logs);
    }
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
    // keep the transaction alive on congested slots (not for MEV-protected sends)
    if (!opts.mev && n % 3 === 0) c.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    if (n % 5 === 0) {
      try {
        const ok = await c.isBlockhashValid(signed.message.recentBlockhash, { commitment: 'confirmed' });
        if (!ok.value) {
          const final = (await c.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
          if (final && !final.err) return sig;
          throw new TxError('The transaction expired before it landed. Nothing was charged. Please try again.', 'expired', sig);
        }
      } catch (e) { if (e instanceof TxError) throw e; }
    }
  }
  throw new TxError('Still waiting for confirmation. Check the explorer link: it may land in a few seconds.', 'timeout', sig);
}

export async function requestAirdrop(address: string, sol = 1) {
  const c = await connection();
  const sig = await c.requestAirdrop(new PublicKey(address), Math.round(sol * LAMPORTS_PER_SOL));
  const start = Date.now();
  while (Date.now() - start < 40000) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = (await c.getSignatureStatuses([sig])).value[0];
    if (st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return sig;
  }
  return sig;
}
