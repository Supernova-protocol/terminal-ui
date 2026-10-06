import { route } from '../lib/router.js';
import { ENV, HttpError, LAUNCHLAB } from '../lib/env.js';
import { json, cached, body, pubkey, signatureStr, fetchJson, memoize } from '../lib/http.js';
import { limit } from '../lib/ratelimit.js';
import { MAJORS, dexPairs, solPriceUsd, ohlcv, poolTrades, trendingPools, TIMEFRAMES } from '../lib/market.js';
import { networkPulse, SOL_MINT } from '../lib/solana.js';
import {
  listLaunches, registerLaunch, getLaunch, viewLaunches, syncTrades, tradesFor, candlesFromTrades, feed, launchesBy, launchStats,
} from '../lib/launches.js';
import { gatherIntel } from '../lib/intel.js';
import { kv } from '../lib/kv.js';

/* ---------- majors, trending, single tokens ---------- */
route('GET', 'market/majors', async () => {
  const pairs = await dexPairs([SOL_MINT, ...MAJORS]);
  const sol = pairs[SOL_MINT] || null;
  return cached({ sol: sol ? { priceUsd: sol.priceUsd, change24h: sol.change.h24 } : null, tokens: MAJORS.map((m) => pairs[m]).filter(Boolean), at: Date.now() }, 15);
});

/* batch prices for wallet holdings (up to 30 mints) */
route('GET', 'market/prices', async ({ url }) => {
  const mints = (url.searchParams.get('mints') || '').split(',').filter(Boolean).slice(0, 30).map((m) => pubkey(m, 'mint'));
  if (!mints.length) return json({ prices: {} });
  const pairs = await dexPairs(mints).catch(() => ({} as Record<string, any>));
  const prices: Record<string, any> = {};
  for (const m of mints) { const p = pairs[m]; if (p) prices[m] = { priceUsd: p.priceUsd, name: p.name, symbol: p.symbol, image: p.image, change24h: p.change.h24, pair: p.pair }; }
  return cached({ prices }, 20);
});

route('GET', 'market/trending', async () => cached({ tokens: await trendingPools().catch(() => []), at: Date.now() }, 60));

route('GET', 'market/token/:mint', async ({ params }) => {
  const mint = pubkey(params.mint, 'mint');
  const [pair, launch] = await Promise.all([
    dexPairs([mint]).then((m) => m[mint] || null).catch(() => null),
    getLaunch(mint).then((r) => (r ? viewLaunches([mint]).then((v) => v[0] || null) : null)),
  ]);
  if (!pair && !launch) throw new HttpError(404, 'No market found for this token yet.', 'no_market');
  return cached({ pair, launch }, 10);
});

route('GET', 'market/candles', async ({ url }) => {
  const tf = url.searchParams.get('tf') || '1m';
  if (!TIMEFRAMES[tf]) throw new HttpError(400, 'Unknown timeframe.');
  const mint = url.searchParams.get('mint');
  const pool = url.searchParams.get('pool');
  if (mint) {
    const rec = await getLaunch(pubkey(mint, 'mint'));
    if (rec && (!pool || pool === rec.pool)) {
      await syncTrades(rec.mint).catch(() => {});
      const [trades, solUsd] = await Promise.all([tradesFor(rec.mint, 1000), solPriceUsd().catch(() => 0)]);
      return cached({ source: 'chain', candles: candlesFromTrades(trades, TIMEFRAMES[tf].sec, solUsd, rec.supply) }, 5);
    }
  }
  if (!pool) throw new HttpError(400, 'pool or mint is required.');
  return cached({ source: 'geckoterminal', candles: await ohlcv(pubkey(pool, 'pool'), tf) }, tf === '1m' ? 15 : 45);
});

route('GET', 'market/trades', async ({ url }) => {
  const mint = pubkey(url.searchParams.get('mint'), 'mint');
  const pool = url.searchParams.get('pool');
  const rec = await getLaunch(mint);
  if (rec && (!pool || pool === rec.pool)) {
    await syncTrades(mint).catch(() => {});
    const solUsd = await solPriceUsd().catch(() => 0);
    const trades = (await tradesFor(mint, 80)).map((t) => ({ ...t, usd: t.sol * solUsd, priceUsd: t.price * solUsd, amount: t.tokens }));
    return cached({ source: 'chain', trades }, 4);
  }
  if (!pool) throw new HttpError(400, 'pool is required.');
  return cached({ source: 'geckoterminal', trades: await poolTrades(pubkey(pool, 'pool'), mint) }, 10);
});

route('GET', 'market/net', async () => {
  const [pulse, sol] = await Promise.all([networkPulse().catch(() => null), solPriceUsd().catch(() => null)]);
  return cached({ ...(pulse || {}), solUsd: sol, cluster: ENV.cluster }, 10);
});

/* ---------- Supernova launches ---------- */
route('GET', 'launches', async ({ url }) => {
  const lim = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 60));
  const off = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const launches = await listLaunches(lim, off);
  return cached({ launches, stats: await launchStats(launches), at: Date.now() }, 5);
});

/* free, AI-less risk scan for the terminal's Token intel panel */
route('GET', 'intel/:mint', async ({ params, ip }) => {
  await limit(`intel:${ip}`, 30, 60);
  const mint = pubkey(params.mint, 'mint');
  const i = await memoize(`intel:${mint}`, 60_000, () => gatherIntel(mint));
  return cached({ checks: i.checks, sentinel: i.sentinel, scanned: i.scanned, holders: i.holders, notes: i.notes, isSupernovaLaunch: i.isSupernovaLaunch, ageHours: i.ageHours, flow: i.flow }, 60);
});

route('POST', 'launches', async ({ req, ip }) => {
  await limit(`register:${ip}`, 20, 3600);
  const b = await body(req);
  const rec = await registerLaunch(signatureStr(b.signature), pubkey(b.mint, 'mint'));
  const view = (await viewLaunches([rec.mint]))[0];
  return json({ launch: view });
});

route('GET', 'launches/:mint', async ({ params }) => {
  const mint = pubkey(params.mint, 'mint');
  const v = (await viewLaunches([mint]))[0];
  if (!v) throw new HttpError(404, 'Not a Supernova launch.', 'not_found');
  return cached({ launch: v }, 4);
});

route('POST', 'launches/:mint/sync', async ({ params, ip }) => {
  await limit(`sync:${ip}`, 30, 60);
  const mint = pubkey(params.mint, 'mint');
  const r = await syncTrades(mint, true);
  const v = (await viewLaunches([mint]))[0] || null;
  return json({ ...r, launch: v });
});

route('GET', 'feed', async () => cached({ events: await feed(60) }, 4));

route('GET', 'profile/:wallet', async ({ params }) => {
  const wallet = pubkey(params.wallet, 'wallet');
  const mints = await launchesBy(wallet);
  return cached({ launches: await viewLaunches(mints) }, 10);
});

/* ---------- Raydium LaunchLab config proxies (browser → our origin, no CORS surprises) ---------- */
route('GET', 'launchlab/configs', async () => {
  const data = await memoize(`ll:configs:${ENV.cluster}`, 10 * 60000, () => fetchJson(`${LAUNCHLAB[ENV.cluster].api}/main/configs`, { timeoutMs: 8000 }));
  return cached({ data: data?.data || [] }, 600);
});
route('GET', 'launchlab/cpmm-configs', async () => {
  const data = await memoize(`ll:cpmm:${ENV.cluster}`, 10 * 60000, () => fetchJson(`${LAUNCHLAB[ENV.cluster].apiV3}/main/cpmm-config`, { timeoutMs: 8000 }));
  return cached({ data: data?.data || [] }, 600);
});

/* recent-trade bookkeeping for wallets (used by the profile PnL chart) */
route('GET', 'wallet/:wallet/trades', async ({ params }) => {
  const wallet = pubkey(params.wallet, 'wallet');
  return json({ trades: await kv().lrange(`wallet:${ENV.cluster}:trades:${wallet}`, 0, 299) });
});
