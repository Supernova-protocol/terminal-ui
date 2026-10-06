/* Minimal Solana JSON-RPC helpers + account decoders used by the API (no heavy SDKs on the server). */
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { ENV, HttpError } from './env.js';
import { fetchJson, memoize } from './http.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';

let rpcId = 0;
export async function rpc<T = any>(method: string, params: unknown[] = [], timeoutMs = 9000): Promise<T> {
  const res = await fetchJson(ENV.rpcUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    timeoutMs,
  });
  if (res && res.error) {
    const msg = String(res.error.message || 'error');
    throw new HttpError(502, `Solana RPC ${method} failed: ${msg.slice(0, 200)}`, 'rpc');
  }
  return res?.result as T;
}

/** JSON-RPC batch (one HTTP round trip). Falls back to sequential calls if the provider rejects batches. */
export async function rpcBatch<T = any>(calls: { method: string; params: unknown[] }[], timeoutMs = 15000): Promise<(T | null)[]> {
  if (!calls.length) return [];
  try {
    const res = await fetchJson(ENV.rpcUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }))),
      timeoutMs,
    });
    if (!Array.isArray(res)) throw new Error('batch not supported');
    const byId = new Map<number, any>(res.map((r: any) => [Number(r.id), r]));
    return calls.map((_, i) => (byId.get(i)?.result ?? null) as T | null);
  } catch (e) {
    if (e instanceof HttpError && e.code === 'upstream_busy') throw e;
    const out: (T | null)[] = [];
    for (const c of calls) out.push(await rpc<T>(c.method, c.params).catch(() => null));
    return out;
  }
}

export type RawAccount = { owner: string; lamports: number; data: Buffer } | null;

/** getMultipleAccounts in chunks of 100, base64-decoded. */
export async function getAccounts(keys: string[], commitment: 'confirmed' | 'processed' = 'confirmed'): Promise<RawAccount[]> {
  const out: RawAccount[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const r = await rpc<{ value: any[] }>('getMultipleAccounts', [chunk, { encoding: 'base64', commitment }]);
    for (const v of r.value) out.push(v ? { owner: v.owner, lamports: v.lamports, data: Buffer.from(v.data[0], 'base64') } : null);
  }
  return out;
}

export async function getAccount(key: string, commitment: 'confirmed' | 'processed' = 'confirmed') {
  return (await getAccounts([key], commitment))[0];
}

/* ---------- byte readers ---------- */
const u64 = (b: Buffer, o: number) => b.readBigUInt64LE(o);
const pk = (b: Buffer, o: number) => bs58.encode(b.subarray(o, o + 32));

/* ---------- Raydium LaunchLab pool (layout: raydium-sdk-v2 src/raydium/launchpad/layout.ts) ---------- */
export const LAUNCHPAD_POOL_SIZE = 429;
export type LaunchPool = {
  status: number; decimalsA: number; decimalsB: number; migrateType: number;
  supply: bigint; totalSellA: bigint; virtualA: bigint; virtualB: bigint; realA: bigint; realB: bigint;
  totalFundRaisingB: bigint; protocolFee: bigint; platformFee: bigint; migrateFee: bigint;
  configId: string; platformId: string; mintA: string; mintB: string; vaultA: string; vaultB: string; creator: string;
  mintProgramFlag: number;
};
export function decodeLaunchPool(d: Buffer): LaunchPool {
  if (d.length < LAUNCHPAD_POOL_SIZE) throw new Error('not a LaunchLab pool account');
  return {
    status: d[17], decimalsA: d[18], decimalsB: d[19], migrateType: d[20],
    supply: u64(d, 21), totalSellA: u64(d, 29), virtualA: u64(d, 37), virtualB: u64(d, 45), realA: u64(d, 53), realB: u64(d, 61),
    totalFundRaisingB: u64(d, 69), protocolFee: u64(d, 77), platformFee: u64(d, 85), migrateFee: u64(d, 93),
    configId: pk(d, 141), platformId: pk(d, 173), mintA: pk(d, 205), mintB: pk(d, 237), vaultA: pk(d, 269), vaultB: pk(d, 301), creator: pk(d, 333),
    mintProgramFlag: d[365],
  };
}

/** Constant-product curve price in SOL per whole token: (vB + rB) / (vA − rA) · 10^(decA − decB). */
export function curvePriceSol(p: LaunchPool) {
  const num = Number(p.virtualB + p.realB);
  const den = Number(p.virtualA - p.realA);
  if (!(den > 0)) return 0;
  return (num / den) * 10 ** (p.decimalsA - p.decimalsB);
}

/** 0 = trading on the bonding curve, 1 = raise complete / migrating, 2 = migrated to a Raydium pool. */
export function curveSummary(p: LaunchPool) {
  const raised = Number(p.realB) / 10 ** p.decimalsB;
  const target = Number(p.totalFundRaisingB) / 10 ** p.decimalsB;
  const progress = target > 0 ? Math.min(100, (raised / target) * 100) : 0;
  const priceSol = curvePriceSol(p);
  const supply = Number(p.supply) / 10 ** p.decimalsA;
  const sold = Number(p.realA) / 10 ** p.decimalsA;
  const forSale = Number(p.totalSellA) / 10 ** p.decimalsA;
  return {
    status: p.status,
    phase: p.status === 0 ? 'curve' : p.status === 1 ? 'migrating' : 'graduated',
    raisedSol: raised, targetSol: target, progress,
    priceSol, supply, sold, forSale,
    mcapSol: priceSol * supply,
    migrateType: p.migrateType === 0 ? 'amm' : 'cpmm',
  };
}

/* ---------- LaunchLab platform config (subset) ---------- */
export type PlatformInfo = { claimFeeWallet: string; feeRate: number; creatorFeeRate: number; name: string; web: string; img: string; cpConfigId: string };
const cstr = (b: Buffer) => { const i = b.indexOf(0); return (i >= 0 ? b.subarray(0, i) : b).toString('utf8').trim(); };
export function decodePlatform(d: Buffer): PlatformInfo {
  // u64 disc 0 | u64 epoch 8 | claimFeeWallet 16 | lockNftWallet 48 | platformScale 80 | creatorScale 88 | burnScale 96 | feeRate 104
  // name[64] 112 | web[256] 176 | img[256] 432 | cpConfigId 688 | creatorFeeRate 720
  return {
    claimFeeWallet: pk(d, 16),
    feeRate: Number(u64(d, 104)),
    name: cstr(d.subarray(112, 176)),
    web: cstr(d.subarray(176, 432)),
    img: cstr(d.subarray(432, 688)),
    cpConfigId: pk(d, 688),
    creatorFeeRate: Number(u64(d, 720)),
  };
}

/* ---------- PDAs ---------- */
export function launchPoolId(mintA: string, mintB = SOL_MINT, program = ENV.launchProgram) {
  return PublicKey.findProgramAddressSync([Buffer.from('pool'), new PublicKey(mintA).toBuffer(), new PublicKey(mintB).toBuffer()], new PublicKey(program))[0].toBase58();
}
export function metadataPda(mint: string) {
  const prog = new PublicKey(METADATA_PROGRAM);
  return PublicKey.findProgramAddressSync([Buffer.from('metadata'), prog.toBuffer(), new PublicKey(mint).toBuffer()], prog)[0].toBase58();
}

/* ---------- Metaplex token metadata (name / symbol / uri) ---------- */
export function decodeMetadata(d: Buffer) {
  // key u8 | updateAuthority 32 | mint 32 | name (u32 len + bytes) | symbol | uri
  let o = 1 + 32 + 32;
  const read = () => { const len = d.readUInt32LE(o); o += 4; const s = d.subarray(o, o + len).toString('utf8').replace(/\0+$/g, '').trim(); o += len; return s; };
  const updateAuthority = pk(d, 1);
  const mint = pk(d, 33);
  const name = read(); const symbol = read(); const uri = read();
  return { updateAuthority, mint, name, symbol, uri };
}

export async function tokenMetadata(mints: string[]) {
  const pdas = mints.map(metadataPda);
  const accs = await getAccounts(pdas);
  const out: Record<string, { name: string; symbol: string; uri: string } | null> = {};
  mints.forEach((m, i) => {
    const a = accs[i];
    try { out[m] = a && a.owner === METADATA_PROGRAM ? decodeMetadata(a.data) : null; } catch { out[m] = null; }
  });
  return out;
}

/* ---------- SPL mint info ---------- */
export async function mintInfo(mint: string) {
  const r = await rpc<{ value: any }>('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const v = r?.value;
  if (!v || (v.owner !== TOKEN_PROGRAM && v.owner !== TOKEN_2022_PROGRAM) || v.data?.parsed?.type !== 'mint') throw new HttpError(404, 'That address is not a token mint on this network.', 'not_a_mint');
  const info = v.data.parsed.info;
  const exts: string[] = (info.extensions || []).map((x: any) => x.extension);
  return {
    program: v.owner === TOKEN_2022_PROGRAM ? 'token-2022' : 'spl-token',
    decimals: info.decimals as number,
    supply: Number(info.supply) / 10 ** info.decimals,
    mintAuthority: (info.mintAuthority as string) || null,
    freezeAuthority: (info.freezeAuthority as string) || null,
    extensions: exts,
  };
}

/** Top holders with owner wallets resolved (token accounts → owners). */
export async function topHolders(mint: string, decimals: number, supply: number) {
  const r = await rpc<{ value: { address: string; amount: string; uiAmount: number | null }[] }>('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
  const rows = (r?.value || []).slice(0, 20);
  if (!rows.length) return [];
  const accs = await rpc<{ value: any[] }>('getMultipleAccounts', [rows.map((x) => x.address), { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  return rows.map((x, i) => {
    const owner = accs?.value?.[i]?.data?.parsed?.info?.owner || null;
    const amount = Number(x.amount) / 10 ** decimals;
    return { tokenAccount: x.address, owner, amount, pct: supply > 0 ? (amount / supply) * 100 : 0 };
  });
}

/* ---------- transactions ---------- */
export async function getParsedTx(signature: string) {
  return rpc<any>('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }], 12000);
}

/** Poll until a transaction is visible at `confirmed` (RPC nodes can lag a couple of seconds behind the wallet). */
export async function waitForTx(signature: string, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const tx = await getParsedTx(signature);
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 1200 + i * 600));
  }
  throw new HttpError(404, 'Transaction not found yet. Wait a few seconds and try again.', 'tx_not_found');
}

export function txAccountKeys(tx: any): { pubkey: string; signer: boolean; writable: boolean }[] {
  const keys = tx?.transaction?.message?.accountKeys || [];
  return keys.map((k: any) => (typeof k === 'string' ? { pubkey: k, signer: false, writable: false } : { pubkey: k.pubkey, signer: !!k.signer, writable: !!k.writable }));
}

export function txFeePayer(tx: any) {
  const k = txAccountKeys(tx)[0];
  return k ? k.pubkey : null;
}

/** All top-level + inner instructions (jsonParsed). */
export function allInstructions(tx: any): any[] {
  const top = tx?.transaction?.message?.instructions || [];
  const inner = (tx?.meta?.innerInstructions || []).flatMap((x: any) => x.instructions || []);
  return [...top, ...inner];
}

export const lamportsToSol = (l: number | bigint) => Number(l) / 1e9;

/** Cached network pulse for the status bar (TPS, slot, epoch). */
export function networkPulse() {
  return memoize('net:pulse', 15000, async () => {
    const [perf, slot, epoch] = await Promise.all([
      rpc<any[]>('getRecentPerformanceSamples', [4]).catch(() => []),
      rpc<number>('getSlot', [{ commitment: 'confirmed' }]).catch(() => 0),
      rpc<any>('getEpochInfo', [{ commitment: 'confirmed' }]).catch(() => null),
    ]);
    const samples = (perf || []).filter((s) => s && s.samplePeriodSecs > 0);
    const tps = samples.length ? samples.reduce((a, s) => a + s.numTransactions / s.samplePeriodSecs, 0) / samples.length : 0;
    const nonVote = samples.length && samples[0].numNonVoteTransactions != null
      ? samples.reduce((a, s) => a + s.numNonVoteTransactions / s.samplePeriodSecs, 0) / samples.length : null;
    return { tps: Math.round(tps), userTps: nonVote != null ? Math.round(nonVote) : null, slot, epoch: epoch?.epoch ?? null, epochProgress: epoch ? epoch.slotIndex / epoch.slotsInEpoch : null, at: Date.now() };
  });
}
