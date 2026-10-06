/* Supernova launch registry: every coin created through our LaunchLab platform config, verified on-chain.
   Trades are indexed straight from the chain (pool vault balance changes), so trades made on any front-end count. */
import { kv } from './kv.js';
import { ENV, HttpError } from './env.js';
import { memoize } from './http.js';
import {
  rpc, rpcBatch, getAccounts, getAccount, decodeLaunchPool, decodePlatform, curveSummary, launchPoolId, tokenMetadata,
  waitForTx, txAccountKeys, SOL_MINT, type LaunchPool,
} from './solana.js';
import { dexPairs, solPriceUsd, type Candle } from './market.js';

export type LaunchRecord = {
  mint: string; pool: string; creator: string; platformId: string;
  name: string; symbol: string; uri: string; image: string | null; description: string;
  twitter: string; telegram: string; website: string;
  createdAt: number; signature: string; vaultA: string; vaultB: string;
  decimals: number; supply: number; supplyRaw: string; targetSol: number; migrateType: 'amm' | 'cpmm'; cluster: string;
  graduatedPair?: string | null;
};
export type TradeRec = { sig: string; ts: number; slot: number; side: 'buy' | 'sell'; sol: number; tokens: number; price: number; wallet: string; dev?: boolean };
export type LaunchStats = {
  lastPrice: number; open24h: number; change24h: number; change1h: number; vol24hSol: number; trades24h: number; buys24h: number; sells24h: number;
  traders24h: number; tradersAll: number; lastTradeAt: number; syncedAt: number; high: number; devSold: boolean; devBoughtTokens: number; firstSlotBuyers: number;
};

const K = {
  rec: (m: string) => `launch:${m}`,
  stats: (m: string) => `launch:stats:${m}`,
  trades: (m: string) => `trades:${m}`,
  last: (m: string) => `trades:last:${m}`,
  lock: (m: string) => `trades:lock:${m}`,
  index: () => `launches:${ENV.cluster}:index`,
  count: () => `launches:${ENV.cluster}:count`,
  byCreator: (w: string) => `launches:${ENV.cluster}:by:${w}`,
  feed: () => `feed:${ENV.cluster}`,
  wallet: (w: string) => `wallet:${ENV.cluster}:trades:${w}`,
};
const MAX_TRADES = 1000;

/* ---------- metadata JSON (only from known IPFS/Arweave gateways: no SSRF) ---------- */
const GATEWAY_HOSTS = new Set(['gateway.pinata.cloud', 'ipfs.io', 'cloudflare-ipfs.com', 'nftstorage.link', 'arweave.net', 'w3s.link', 'dweb.link', 'cf-ipfs.com']);
function allowedHost(u: URL) {
  const pin = (() => { try { return new URL(ENV.pinataGateway).host; } catch { return ''; } })();
  return u.protocol === 'https:' && (GATEWAY_HOSTS.has(u.host) || u.host === pin || u.host.endsWith('.mypinata.cloud') || u.host.endsWith('.ipfs.w3s.link'));
}
export function ipfsToHttp(uri: string) {
  if (!uri) return '';
  if (uri.startsWith('ipfs://')) return `${ENV.pinataGateway}/ipfs/${uri.slice(7).replace(/^ipfs\//, '')}`;
  return uri;
}
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '');
const safeLink = (v: unknown) => { const s = clip(v, 200); try { const u = new URL(s); return u.protocol === 'https:' ? u.toString() : ''; } catch { return ''; } };

async function readMetadataJson(uri: string) {
  const http = ipfsToHttp(uri);
  let u: URL;
  try { u = new URL(http); } catch { return null; }
  if (!allowedHost(u)) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch(u, { signal: ctl.signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 64 * 1024) return null;
    return JSON.parse(text);
  } catch { return null; } finally { clearTimeout(t); }
}

/* ---------- registration ---------- */
export async function registerLaunch(signature: string, mint: string): Promise<LaunchRecord> {
  const existing = await kv().get<LaunchRecord>(K.rec(mint));
  if (existing) return existing;

  const tx = await waitForTx(signature);
  if (tx.meta?.err) throw new HttpError(400, 'That transaction failed on-chain, so no coin was created.', 'tx_failed');
  const keys = txAccountKeys(tx);
  const mintKey = keys.find((k) => k.pubkey === mint);
  if (!mintKey || !mintKey.signer) throw new HttpError(400, 'This transaction did not create that mint.', 'mint_mismatch');
  if (!keys.some((k) => k.pubkey === ENV.launchProgram)) throw new HttpError(400, 'This transaction is not a LaunchLab launch.', 'not_launchlab');

  const pool = launchPoolId(mint);
  const acc = await getAccount(pool);
  if (!acc || acc.owner !== ENV.launchProgram) throw new HttpError(400, 'No LaunchLab pool exists for this mint yet.', 'no_pool');
  const p = decodeLaunchPool(acc.data);
  if (p.mintA !== mint || p.mintB !== SOL_MINT) throw new HttpError(400, 'Pool does not match this mint.', 'pool_mismatch');
  if (p.platformId !== ENV.platformId) throw new HttpError(400, 'This coin was launched on a different platform.', 'wrong_platform');
  if (!keys.some((k) => k.signer && k.pubkey === p.creator)) throw new HttpError(400, 'Creator did not sign this launch.', 'creator_mismatch');

  const meta = (await tokenMetadata([mint]))[mint];
  const json = meta?.uri ? await readMetadataJson(meta.uri) : null;
  const image = json && typeof json.image === 'string' ? ipfsToHttp(json.image) : '';
  const ext = (json && typeof json.extensions === 'object' && json.extensions) || {};

  const rec: LaunchRecord = {
    mint, pool, creator: p.creator, platformId: p.platformId,
    name: clip(meta?.name, 32) || 'Unnamed', symbol: clip(meta?.symbol, 10).toUpperCase() || '???', uri: clip(meta?.uri, 200),
    // only IPFS/Arweave gateway images: an arbitrary host could track everyone who views the coin
    image: image && (() => { try { return allowedHost(new URL(image)); } catch { return false; } })() ? image.slice(0, 300) : null,
    description: clip(json?.description, 500),
    twitter: safeLink(json?.twitter || ext.twitter), telegram: safeLink(json?.telegram || ext.telegram), website: safeLink(json?.website || ext.website),
    createdAt: tx.blockTime ? tx.blockTime * 1000 : Date.now(), signature,
    vaultA: p.vaultA, vaultB: p.vaultB, decimals: p.decimalsA,
    supply: Number(p.supply) / 10 ** p.decimalsA, supplyRaw: p.supply.toString(),
    targetSol: Number(p.totalFundRaisingB) / 10 ** p.decimalsB,
    migrateType: p.migrateType === 0 ? 'amm' : 'cpmm', cluster: ENV.cluster,
  };
  if (await kv().setnx(`launch:registered:${mint}`, 1)) {
    await kv().set(K.rec(mint), rec);
    await kv().lpush(K.index(), mint, 5000);
    await kv().incr(K.count());
    await kv().lpush(K.byCreator(p.creator), mint, 500);
    await kv().lpush(K.feed(), { type: 'launch', mint, symbol: rec.symbol, name: rec.name, image: rec.image, wallet: p.creator, ts: rec.createdAt }, 200);
  }
  await syncTrades(mint).catch((e) => console.warn('[launch] first sync failed', e?.message));
  return rec;
}

export const getLaunch = (mint: string) => kv().get<LaunchRecord>(K.rec(mint));

/* ---------- trade indexing from vault balance changes ---------- */
function amountOf(list: any[] | undefined, idx: number) {
  const x = (list || []).find((b) => b.accountIndex === idx);
  return x ? BigInt(x.uiTokenAmount?.amount || '0') : null;
}

export function parseTrade(tx: any, rec: Pick<LaunchRecord, 'vaultA' | 'vaultB' | 'supplyRaw' | 'decimals' | 'signature' | 'creator'>): TradeRec | null {
  if (!tx || tx.meta?.err) return null;
  const keys = txAccountKeys(tx);
  const ia = keys.findIndex((k) => k.pubkey === rec.vaultA);
  const ib = keys.findIndex((k) => k.pubkey === rec.vaultB);
  if (ia < 0 || ib < 0) return null;
  const isCreate = tx.transaction?.signatures?.[0] === rec.signature;
  const preA = amountOf(tx.meta?.preTokenBalances, ia) ?? (isCreate ? BigInt(rec.supplyRaw) : null);
  const postA = amountOf(tx.meta?.postTokenBalances, ia);
  const preB = amountOf(tx.meta?.preTokenBalances, ib) ?? (isCreate ? 0n : null);
  const postB = amountOf(tx.meta?.postTokenBalances, ib);
  if (preA == null || postA == null || preB == null || postB == null) return null;
  const dA = postA - preA; // tokens into the vault (+) or out (−)
  const dB = postB - preB; // SOL into the vault (+) or out (−)
  let side: 'buy' | 'sell';
  if (dA < 0n && dB > 0n) side = 'buy';
  else if (dA > 0n && dB < 0n) side = 'sell';
  else return null; // migration, fee claims, etc.
  const tokens = Number(dA < 0n ? -dA : dA) / 10 ** rec.decimals;
  const sol = Number(dB < 0n ? -dB : dB) / 1e9;
  if (!(tokens > 0) || !(sol > 0)) return null;
  const wallet = keys.find((k) => k.signer)?.pubkey || keys[0]?.pubkey || '';
  return { sig: tx.transaction.signatures[0], ts: (tx.blockTime || Math.floor(Date.now() / 1000)) * 1000, slot: tx.slot || 0, side, sol, tokens, price: sol / tokens, wallet, dev: wallet === rec.creator || undefined };
}

export async function syncTrades(mint: string, force = false): Promise<{ added: number }> {
  const rec = await getLaunch(mint);
  if (!rec) throw new HttpError(404, 'Unknown launch.', 'not_found');
  if (!(await kv().setnx(K.lock(mint), 1, force ? 4 : 8))) return { added: 0 };
  try {
    const last = await kv().get<string>(K.last(mint));
    const opts: any = { limit: 60, commitment: 'confirmed' };
    if (last) opts.until = last;
    const sigs = (await rpc<any[]>('getSignaturesForAddress', [rec.pool, opts])) || [];
    if (!sigs.length) { await touchStats(mint, rec); return { added: 0 }; }
    const fresh = sigs.filter((s) => !s.err).slice(0, 40).reverse(); // oldest → newest
    const txs = await rpcBatch(fresh.map((s) => ({ method: 'getTransaction', params: [s.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] })));
    let added = 0;
    for (const tx of txs) {
      const tr = parseTrade(tx, rec);
      if (!tr) continue;
      await kv().lpush(K.trades(mint), tr, MAX_TRADES);
      await kv().lpush(K.feed(), { type: 'trade', mint, symbol: rec.symbol, image: rec.image, ...tr }, 200);
      await kv().lpush(K.wallet(tr.wallet), { mint, symbol: rec.symbol, ...tr }, 300);
      added++;
    }
    await kv().set(K.last(mint), sigs[0].signature);
    await touchStats(mint, rec);
    return { added };
  } finally {
    await kv().del(K.lock(mint));
  }
}

async function touchStats(mint: string, rec: LaunchRecord) {
  const trades = await kv().lrange<TradeRec>(K.trades(mint), 0, MAX_TRADES - 1);
  const now = Date.now();
  const day = trades.filter((t) => now - t.ts < 86400000);
  const lastPrice = trades[0]?.price || 0;
  const before = trades.find((t) => now - t.ts >= 86400000);
  const open24h = before ? before.price : (trades[trades.length - 1]?.price || lastPrice);
  const hourRef = trades.find((t) => now - t.ts >= 3600000);
  const open1h = hourRef ? hourRef.price : (trades[trades.length - 1]?.price || lastPrice);
  const firstSlot = trades.length ? Math.min(...trades.map((t) => t.slot || Infinity)) : 0;
  const firstSlotBuyers = new Set(trades.filter((t) => t.slot === firstSlot && t.side === 'buy' && t.wallet !== rec.creator).map((t) => t.wallet)).size;
  const dev = trades.filter((t) => t.wallet === rec.creator);
  const stats: LaunchStats = {
    lastPrice, open24h, change24h: open24h > 0 ? (lastPrice / open24h - 1) * 100 : 0, change1h: open1h > 0 ? (lastPrice / open1h - 1) * 100 : 0,
    vol24hSol: day.reduce((a, t) => a + t.sol, 0), trades24h: day.length,
    buys24h: day.filter((t) => t.side === 'buy').length, sells24h: day.filter((t) => t.side === 'sell').length,
    traders24h: new Set(day.map((t) => t.wallet)).size, tradersAll: new Set(trades.map((t) => t.wallet)).size,
    lastTradeAt: trades[0]?.ts || 0, syncedAt: now, high: trades.reduce((a, t) => Math.max(a, t.price), 0),
    devSold: dev.some((t) => t.side === 'sell'), devBoughtTokens: dev.filter((t) => t.side === 'buy').reduce((a, t) => a + t.tokens, 0) - dev.filter((t) => t.side === 'sell').reduce((a, t) => a + t.tokens, 0),
    firstSlotBuyers,
  };
  await kv().set(K.stats(mint), stats);
  return stats;
}

export const tradesFor = (mint: string, n = 100) => kv().lrange<TradeRec>(K.trades(mint), 0, Math.min(MAX_TRADES, n) - 1);
export const feed = (n = 60) => kv().lrange<any>(K.feed(), 0, n - 1);

/** Candles in USD built from indexed trades (curve phase). */
export function candlesFromTrades(trades: TradeRec[], bucketSec: number, solUsd: number, supply: number): Candle[] {
  const asc = [...trades].sort((a, b) => a.ts - b.ts);
  const out: Candle[] = [];
  for (const t of asc) {
    const time = Math.floor(t.ts / 1000 / bucketSec) * bucketSec;
    const p = t.price * solUsd;
    const last = out[out.length - 1];
    if (!last || last.time !== time) out.push({ time, open: last ? last.close : p, high: Math.max(p, last ? last.close : p), low: Math.min(p, last ? last.close : p), close: p, volume: t.sol * solUsd });
    else { last.close = p; last.high = Math.max(last.high, p); last.low = Math.min(last.low, p); last.volume += t.sol * solUsd; }
  }
  void supply;
  return out;
}

/* ---------- public views ---------- */
export type LaunchView = ReturnType<typeof viewOf>;
function viewOf(rec: LaunchRecord, pool: LaunchPool | null, stats: LaunchStats | null, solUsd: number, pair?: any, feeRate = 0) {
  const curve = pool ? curveSummary(pool) : null;
  const priceSol = curve && curve.phase === 'curve' ? curve.priceSol : (stats?.lastPrice || curve?.priceSol || 0);
  const priceUsd = pair?.priceUsd || priceSol * solUsd;
  return {
    mint: rec.mint, pool: rec.pool, creator: rec.creator, name: rec.name, symbol: rec.symbol, image: rec.image, description: rec.description,
    twitter: rec.twitter, telegram: rec.telegram, website: rec.website, createdAt: rec.createdAt, signature: rec.signature,
    decimals: rec.decimals, supply: rec.supply, targetSol: rec.targetSol,
    phase: curve?.phase || 'curve', progress: curve ? (curve.phase === 'curve' ? curve.progress : 100) : 0, raisedSol: curve?.raisedSol || 0,
    priceSol, priceUsd, mcapUsd: pair?.mcap || priceUsd * rec.supply,
    change24h: pair ? pair.change.h24 : stats?.change24h || 0,
    change1h: pair ? pair.change.h1 : stats?.change1h || 0,
    vol24hUsd: pair ? pair.volume24h : (stats?.vol24hSol || 0) * solUsd,
    liquidityUsd: pair ? pair.liquidityUsd : (curve?.raisedSol || 0) * solUsd,
    trades24h: stats?.trades24h || 0, buys24h: stats?.buys24h || 0, sells24h: stats?.sells24h || 0,
    traders: stats?.tradersAll || 0, lastTradeAt: stats?.lastTradeAt || 0,
    devSold: !!stats?.devSold, firstSlotBuyers: stats?.firstSlotBuyers || 0,
    graduatedPair: pair?.pair || rec.graduatedPair || null, dex: pair?.dex || null,
    cp: pool ? { vA: pool.virtualA.toString(), vB: pool.virtualB.toString(), rA: pool.realA.toString(), rB: pool.realB.toString(), decA: pool.decimalsA, decB: pool.decimalsB, feeRate } : null,
    reserves: pair?.reserves || null,
  };
}

/* total fee rate (protocol + platform + creator, parts per million) for a pool's config + platform */
async function feeRateFor(configId: string, platformId: string) {
  return memoize(`fees:${configId}:${platformId}`, 600_000, async () => {
    const [c, p] = await getAccounts([configId, platformId]);
    const trade = c && c.data.length >= 35 ? Number(c.data.readBigUInt64LE(27)) : 2500;
    const plat = p ? decodePlatform(p.data) : null;
    return trade + (plat?.feeRate || 0) + (plat?.creatorFeeRate || 0);
  });
}

export async function viewLaunches(mints: string[]) {
  if (!mints.length) return [];
  const recs = (await kv().mget<LaunchRecord>(mints.map(K.rec))).filter(Boolean) as LaunchRecord[];
  const [accs, stats, solUsd] = await Promise.all([
    getAccounts(recs.map((r) => r.pool)).catch(() => recs.map(() => null)),
    kv().mget<LaunchStats>(recs.map((r) => K.stats(r.mint))),
    solPriceUsd().catch(() => 0),
  ]);
  const pools = accs.map((a) => { try { return a ? decodeLaunchPool(a.data) : null; } catch { return null; } });
  const graduated = recs.filter((_, i) => pools[i] && pools[i]!.status === 2).map((r) => r.mint);
  const pairs = graduated.length && ENV.cluster === 'mainnet' ? await dexPairs(graduated).catch(() => ({} as Record<string, any>)) : {};
  for (const r of recs) if (pairs[r.mint] && r.graduatedPair !== pairs[r.mint].pair) { r.graduatedPair = pairs[r.mint].pair; kv().set(K.rec(r.mint), r).catch(() => {}); }
  const fees = await Promise.all(pools.map((p) => (p ? feeRateFor(p.configId, p.platformId).catch(() => 0) : Promise.resolve(0))));
  return recs.map((r, i) => viewOf(r, pools[i], stats[i], solUsd, pairs[r.mint], fees[i]));
}

export async function launchStats(views: Awaited<ReturnType<typeof viewLaunches>>) {
  const total = Number((await kv().get<number>(K.count())) || views.length);
  const day = Date.now() - 86400000;
  return {
    total,
    last24h: views.filter((v) => v.createdAt >= day).length,
    graduated: views.filter((v) => v.phase !== 'curve').length,
    vol24hUsd: views.reduce((a, v) => a + (v.vol24hUsd || 0), 0),
  };
}

export async function listLaunches(limit = 60, offset = 0) {
  return memoize(`launches:list:${limit}:${offset}`, 6000, async () => {
    const mints = await kv().lrange<string>(K.index(), offset, offset + limit - 1);
    const views = await viewLaunches(mints);
    // keep stats fresh for the most recently active coins without a separate indexer
    const stale = views.filter((v) => v.phase === 'curve').slice(0, 4);
    await Promise.allSettled(stale.map((v) => syncTrades(v.mint)));
    return views;
  });
}

export const launchesBy = (wallet: string) => kv().lrange<string>(K.byCreator(wallet), 0, 99);
