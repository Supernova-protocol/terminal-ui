/* Token intelligence: deterministic on-chain + market checks that feed the AI analyst. */
import { PublicKey } from '@solana/web3.js';
import { ENV } from './env.js';
import { mintInfo, topHolders, getAccount, decodeLaunchPool, curveSummary, launchPoolId } from './solana.js';
import { dexPairs, ohlcv, poolTrades, solPriceUsd, type Candle, type Pair } from './market.js';
import { getLaunch, tradesFor, candlesFromTrades, syncTrades, type LaunchRecord, type TradeRec } from './launches.js';
import { kv } from './kv.js';

const BURN = new Set(['1nc1nerator11111111111111111111111111111111', '11111111111111111111111111111111']);
const isPda = (a: string | null) => { if (!a) return true; try { return !PublicKey.isOnCurve(new PublicKey(a).toBytes()); } catch { return true; } };
const LAUNCHLAB_AUTH = { mainnet: 'WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh', devnet: '5xqNaZXX5eUi4p5HU4oz9i5QnwRNT2y6oN7yyn4qENeq' };

export type Check = { key: string; label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'info' };

/* ---------- technicals ---------- */
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export function ema(vals: number[], n: number) { const k = 2 / (n + 1); const out: number[] = []; let e = vals[0] ?? 0; for (const v of vals) { e = v * k + e * (1 - k); out.push(e); } return out; }
export function rsi(closes: number[], n = 14) {
  if (closes.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = closes.length - n; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; if (d > 0) g += d; else l -= d; }
  if (l === 0) return g === 0 ? 50 : 100;
  return 100 - 100 / (1 + g / l);
}
export function technicals(cs: Candle[]) {
  if (cs.length < 3) return null;
  const closes = cs.map((c) => c.close);
  const last = closes[closes.length - 1];
  const tail = cs.slice(-24);
  const e20 = ema(closes, 20), e50 = ema(closes, 50);
  const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i])).filter(Number.isFinite);
  const sd = Math.sqrt(avg(rets.map((r) => r * r)) - avg(rets) ** 2) || 0;
  const vwapNum = tail.reduce((a, c) => a + ((c.high + c.low + c.close) / 3) * c.volume, 0);
  const vwapDen = tail.reduce((a, c) => a + c.volume, 0);
  const v6 = avg(cs.slice(-6).map((c) => c.volume)), v24 = avg(cs.slice(-30, -6).map((c) => c.volume)) || v6;
  return {
    last,
    rsi14: rsi(closes),
    trend: e20[e20.length - 1] >= e50[e50.length - 1] ? 'up' : 'down',
    support: Math.min(...tail.map((c) => c.low)),
    resistance: Math.max(...tail.map((c) => c.high)),
    vwap: vwapDen > 0 ? vwapNum / vwapDen : last,
    volatilityPct: sd * 100,
    volumeTrend: v24 > 0 ? v6 / v24 : 1,
    changePct: ((last / cs[Math.max(0, cs.length - 13)].close) - 1) * 100,
    bars: cs.length,
  };
}

/* ---------- flow ---------- */
function flowFrom(trades: { side: string; usd: number; ts: number; wallet: string }[]) {
  const now = Date.now();
  const hour = trades.filter((t) => now - t.ts < 3600_000);
  const sorted = [...hour].sort((a, b) => b.usd - a.usd);
  const whaleCut = Math.max(500, sorted[Math.floor(sorted.length * 0.1)]?.usd || 0);
  const whales = hour.filter((t) => t.usd >= whaleCut);
  const sum = (arr: typeof hour, side: string) => arr.filter((t) => t.side === side).reduce((a, t) => a + t.usd, 0);
  return {
    trades1h: hour.length,
    buyUsd1h: Math.round(sum(hour, 'buy')), sellUsd1h: Math.round(sum(hour, 'sell')),
    whaleThresholdUsd: Math.round(whaleCut),
    whaleBuys: whales.filter((t) => t.side === 'buy').length, whaleSells: whales.filter((t) => t.side === 'sell').length,
    whaleNetUsd: Math.round(sum(whales, 'buy') - sum(whales, 'sell')),
    biggest: sorted.slice(0, 5).map((t) => ({ side: t.side, usd: Math.round(t.usd), minsAgo: Math.round((now - t.ts) / 60000), wallet: t.wallet.slice(0, 4) + '…' + t.wallet.slice(-4) })),
    uniqueWallets1h: new Set(hour.map((t) => t.wallet)).size,
  };
}

/* ---------- the bundle ---------- */
export async function gatherIntel(mint: string) {
  const solUsd = await solPriceUsd().catch(() => 0);
  const launch: LaunchRecord | null = await getLaunch(mint);
  const checks: Check[] = [];
  let sentinel = 100;
  const notes: string[] = [];

  // chain facts
  let mi: Awaited<ReturnType<typeof mintInfo>> | null = null;
  try { mi = await mintInfo(mint); } catch { notes.push(`Mint not found on ${ENV.cluster}; on-chain checks skipped.`); }
  const auth = LAUNCHLAB_AUTH[ENV.cluster];
  if (mi) {
    const ma = mi.mintAuthority, fa = mi.freezeAuthority;
    const maTone = !ma || ma === auth ? 'good' : 'bad';
    const faTone = !fa || fa === auth ? 'good' : 'bad';
    checks.push({ key: 'mint_auth', label: 'Mint authority', value: !ma ? 'Revoked' : ma === auth ? 'Program-locked' : 'Active', tone: maTone });
    checks.push({ key: 'freeze_auth', label: 'Freeze authority', value: !fa ? 'Revoked' : fa === auth ? 'Program-locked' : 'Active', tone: faTone });
    if (maTone === 'bad') sentinel -= 25;
    if (faTone === 'bad') sentinel -= 20;
    const risky = mi.extensions.filter((x) => ['permanentDelegate', 'transferHook', 'nonTransferable', 'defaultAccountState', 'transferFeeConfig', 'pausableConfig'].includes(x));
    if (risky.length) { checks.push({ key: 'extensions', label: 'Token-2022 extensions', value: risky.join(', '), tone: 'bad' }); sentinel -= 15; }
  }

  // holders
  let holders: { owner: string | null; pct: number; amount: number; contract: boolean }[] = [];
  if (mi) {
    try {
      const raw = await topHolders(mint, mi.decimals, mi.supply);
      holders = raw.map((h) => ({ owner: h.owner, pct: h.pct, amount: h.amount, contract: BURN.has(h.owner || '') || isPda(h.owner) }));
    } catch { notes.push('Holder list unavailable from the RPC.'); }
  }
  const wallets = holders.filter((h) => !h.contract);
  const top10 = wallets.slice(0, 10).reduce((a, h) => a + h.pct, 0);
  const topOne = wallets[0]?.pct || 0;
  if (holders.length) {
    const tone = top10 < 20 ? 'good' : top10 < 35 ? 'warn' : 'bad';
    checks.push({ key: 'top10', label: 'Top 10 holders', value: top10.toFixed(1) + '%', tone });
    sentinel -= top10 < 20 ? 0 : top10 < 35 ? 8 : 20;
    if (topOne > 10) { checks.push({ key: 'whale', label: 'Largest wallet', value: topOne.toFixed(1) + '%', tone: topOne > 20 ? 'bad' : 'warn' }); sentinel -= topOne > 20 ? 12 : 5; }
  }

  // market + trades + candles
  let pair: Pair | null = null;
  if (ENV.cluster === 'mainnet' || !launch) {
    try { pair = (await dexPairs([mint]))[mint] || null; } catch { notes.push('DexScreener did not answer.'); }
  }
  let curve: ReturnType<typeof curveSummary> | null = null;
  let trades: { side: string; usd: number; ts: number; wallet: string }[] = [];
  let candles: Candle[] = [];
  let launchTrades: TradeRec[] = [];
  if (launch) {
    try {
      const acc = await getAccount(launch.pool || launchPoolId(mint));
      if (acc) curve = curveSummary(decodeLaunchPool(acc.data));
    } catch { /* pool unreadable */ }
    await syncTrades(mint).catch(() => {});
    launchTrades = await tradesFor(mint, 1000);
    trades = launchTrades.map((t) => ({ side: t.side, usd: t.sol * solUsd, ts: t.ts, wallet: t.wallet }));
    if (!pair || curve?.phase === 'curve') candles = candlesFromTrades(launchTrades, 300, solUsd, launch.supply);
    const stats = await kv().get<any>(`launch:stats:${mint}`);
    const devTone = stats?.devSold ? 'warn' : 'good';
    const devHold = holders.find((h) => h.owner === launch.creator);
    checks.unshift({ key: 'dev', label: 'Dev wallet', value: (stats?.devSold ? 'Has sold' : 'No sells') + (devHold ? ` · holds ${devHold.pct.toFixed(1)}%` : ''), tone: devTone });
    if (stats?.devSold) sentinel -= 10;
    const bundles = stats?.firstSlotBuyers || 0;
    checks.push({ key: 'bundles', label: 'Bundled snipes at launch', value: bundles ? `${bundles} wallet${bundles > 1 ? 's' : ''} in block 1` : 'None', tone: bundles === 0 ? 'good' : bundles < 3 ? 'warn' : 'bad' });
    sentinel -= bundles === 0 ? 0 : bundles < 3 ? 6 : 15;
    if (curve) checks.push({ key: 'curve', label: curve.phase === 'curve' ? 'Bonding curve' : 'Status', value: curve.phase === 'curve' ? `${curve.progress.toFixed(1)}% · ${curve.raisedSol.toFixed(2)}/${curve.targetSol.toFixed(0)} SOL` : curve.phase === 'migrating' ? 'Graduating' : 'Graduated to Raydium', tone: 'info' });
  }
  if (pair && (!candles.length)) {
    try { candles = await ohlcv(pair.pair, '5m', 150); } catch { notes.push('Candles unavailable.'); }
    try { trades = (await poolTrades(pair.pair, mint)).map((t) => ({ side: t.side, usd: t.usd, ts: t.ts, wallet: t.wallet })); } catch { notes.push('Recent trades unavailable.'); }
  }
  if (pair) {
    const liqTone = pair.liquidityUsd >= 100_000 ? 'good' : pair.liquidityUsd >= 15_000 ? 'warn' : 'bad';
    checks.push({ key: 'liquidity', label: 'Liquidity', value: '$' + Math.round(pair.liquidityUsd).toLocaleString('en-US'), tone: liqTone });
    sentinel -= liqTone === 'good' ? 0 : liqTone === 'warn' ? 5 : 14;
  }

  const tech = technicals(candles);
  const flow = trades.length ? flowFrom(trades) : null;
  if (flow && flow.trades1h > 0) {
    const net = flow.buyUsd1h - flow.sellUsd1h;
    checks.push({ key: 'flow', label: 'Net flow (1h)', value: `${net >= 0 ? '+' : '−'}$${Math.abs(net).toLocaleString('en-US')}`, tone: net >= 0 ? 'good' : 'warn' });
  }
  sentinel = Math.max(5, Math.min(99, Math.round(sentinel)));
  const scanned = !!mi; // false when the mint does not exist on this cluster (e.g. mainnet blue chips while running on devnet)

  const priceUsd = pair?.priceUsd || (curve ? curve.priceSol * solUsd : tech?.last || 0);
  const supply = mi?.supply || launch?.supply || 0;
  return {
    mint,
    name: launch?.name || pair?.name || 'Unknown token',
    symbol: launch?.symbol || pair?.symbol || '???',
    cluster: ENV.cluster,
    isSupernovaLaunch: !!launch,
    priceUsd, solUsd,
    mcapUsd: pair?.mcap || priceUsd * supply,
    change: pair?.change || null,
    volume24hUsd: pair?.volume24h ?? null,
    liquidityUsd: pair?.liquidityUsd ?? null,
    ageHours: launch ? (Date.now() - launch.createdAt) / 3600000 : pair?.createdAt ? (Date.now() - pair.createdAt) / 3600000 : null,
    txns: pair ? { h1: pair.txns1h, h24: pair.txns24h } : null,
    curve, checks, sentinel: scanned ? sentinel : null, scanned, technicals: tech, flow,
    holders: holders.slice(0, 12).map((h) => ({ pct: +h.pct.toFixed(2), contract: h.contract, wallet: h.owner ? h.owner.slice(0, 4) + '…' + h.owner.slice(-4) : '?' })),
    creatorOtherLaunches: launch ? Math.max(0, (await kv().lrange<string>(`launches:${ENV.cluster}:by:${launch.creator}`, 0, 50)).length - 1) : null,
    notes,
  };
}
export type Intel = Awaited<ReturnType<typeof gatherIntel>>;
