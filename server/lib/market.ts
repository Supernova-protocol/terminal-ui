/* Public market data (DexScreener + GeckoTerminal), cached per warm instance and at the CDN. */
import { fetchJson, memoize } from './http.js';
import { HttpError } from './env.js';
import { SOL_MINT } from './solana.js';

const DS = 'https://api.dexscreener.com';
const cgKey = (process.env.COINGECKO_API_KEY || '').trim();
const GT = cgKey ? 'https://pro-api.coingecko.com/api/v3/onchain' : 'https://api.geckoterminal.com/api/v2';
const GT_HEADERS: Record<string, string> = cgKey ? { 'x-cg-pro-api-key': cgKey } : { accept: 'application/json;version=20230302' };

/** Blue-chip Solana tokens shown in the hub (mainnet mints). */
export const MAJORS = [
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // POPCAT
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', // JTO
  'MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', // MEW
  '2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', // PNUT
  'ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', // BOME
  'ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', // MOODENG
];

export type Pair = {
  mint: string; pair: string; dex: string; name: string; symbol: string; quote: string;
  priceUsd: number; priceNative: number; change: { m5: number; h1: number; h6: number; h24: number };
  volume24h: number; liquidityUsd: number; fdv: number; mcap: number; createdAt: number | null;
  txns24h: { buys: number; sells: number }; txns1h: { buys: number; sells: number };
  reserves: { base: number; quote: number }; quoteMint: string;
  image: string | null; url: string;
};

function toPair(p: any, mint: string): Pair {
  const n = (x: any) => (Number.isFinite(+x) ? +x : 0);
  return {
    mint,
    pair: p.pairAddress,
    dex: p.dexId,
    name: String(p.baseToken?.name || '').slice(0, 60),
    symbol: String(p.baseToken?.symbol || '').slice(0, 16),
    quote: p.quoteToken?.symbol || '',
    priceUsd: n(p.priceUsd),
    priceNative: n(p.priceNative),
    change: { m5: n(p.priceChange?.m5), h1: n(p.priceChange?.h1), h6: n(p.priceChange?.h6), h24: n(p.priceChange?.h24) },
    volume24h: n(p.volume?.h24),
    liquidityUsd: n(p.liquidity?.usd),
    fdv: n(p.fdv),
    mcap: n(p.marketCap) || n(p.fdv),
    createdAt: p.pairCreatedAt ? Number(p.pairCreatedAt) : null,
    txns24h: { buys: n(p.txns?.h24?.buys), sells: n(p.txns?.h24?.sells) },
    txns1h: { buys: n(p.txns?.h1?.buys), sells: n(p.txns?.h1?.sells) },
    reserves: { base: n(p.liquidity?.base), quote: n(p.liquidity?.quote) },
    quoteMint: p.quoteToken?.address || '',
    image: typeof p.info?.imageUrl === 'string' && p.info.imageUrl.startsWith('https://') ? p.info.imageUrl : null,
    url: typeof p.url === 'string' ? p.url : '',
  };
}

/** Best (deepest) pair for each mint where the mint is the base token. Up to 30 mints per upstream call. */
export async function dexPairs(mints: string[]): Promise<Record<string, Pair>> {
  const uniq = [...new Set(mints)].filter(Boolean);
  const out: Record<string, Pair> = {};
  for (let i = 0; i < uniq.length; i += 30) {
    const chunk = uniq.slice(i, i + 30);
    const key = 'ds:' + chunk.slice().sort().join(',');
    const arr: any[] = await memoize(key, 12000, () => fetchJson(`${DS}/tokens/v1/solana/${chunk.join(',')}`, { timeoutMs: 7000 }).then((r) => (Array.isArray(r) ? r : r?.pairs || [])));
    for (const p of arr) {
      const base = p?.baseToken?.address;
      if (!base || !chunk.includes(base) || p.chainId !== 'solana' || !(+p.priceUsd > 0)) continue;
      const cur = out[base];
      if (!cur || (+p.liquidity?.usd || 0) > cur.liquidityUsd) out[base] = toPair(p, base);
    }
  }
  return out;
}

export async function solPriceUsd(): Promise<number> {
  return memoize('sol:usd', 20000, async () => {
    try {
      const m = await dexPairs([SOL_MINT]);
      if (m[SOL_MINT]?.priceUsd) return m[SOL_MINT].priceUsd;
    } catch { /* fall through */ }
    const r = await fetchJson(`${GT}/simple/networks/solana/token_price/${SOL_MINT}`, { headers: GT_HEADERS, timeoutMs: 6000 });
    const v = Number(r?.data?.attributes?.token_prices?.[SOL_MINT]);
    if (!(v > 0)) throw new HttpError(502, 'SOL price unavailable right now.', 'upstream');
    return v;
  });
}

/* ---------- GeckoTerminal: candles, trades, trending ---------- */
export const TIMEFRAMES: Record<string, { tf: 'minute' | 'hour' | 'day'; agg: number; sec: number }> = {
  '1m': { tf: 'minute', agg: 1, sec: 60 },
  '5m': { tf: 'minute', agg: 5, sec: 300 },
  '15m': { tf: 'minute', agg: 15, sec: 900 },
  '1h': { tf: 'hour', agg: 1, sec: 3600 },
  '4h': { tf: 'hour', agg: 4, sec: 14400 },
  '1d': { tf: 'day', agg: 1, sec: 86400 },
};

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

export async function ohlcv(pool: string, tfKey: string, limit = 300): Promise<Candle[]> {
  const tf = TIMEFRAMES[tfKey] || TIMEFRAMES['1m'];
  const ttl = tf.sec <= 60 ? 20000 : tf.sec <= 900 ? 45000 : 120000;
  return memoize(`gt:ohlcv:${pool}:${tfKey}:${limit}`, ttl, async () => {
    const r = await fetchJson(`${GT}/networks/solana/pools/${pool}/ohlcv/${tf.tf}?aggregate=${tf.agg}&limit=${limit}&currency=usd&token=base`, { headers: GT_HEADERS, timeoutMs: 8000 });
    const list: number[][] = r?.data?.attributes?.ohlcv_list || [];
    return list
      .map((x) => ({ time: Number(x[0]), open: +x[1], high: +x[2], low: +x[3], close: +x[4], volume: +x[5] }))
      .filter((c) => c.time > 0 && c.close > 0)
      .sort((a, b) => a.time - b.time);
  });
}

export type Trade = { sig: string; ts: number; side: 'buy' | 'sell'; usd: number; priceUsd: number; amount: number; sol: number | null; wallet: string };

export async function poolTrades(pool: string, baseMint: string): Promise<Trade[]> {
  return memoize(`gt:trades:${pool}`, 10000, async () => {
    const r = await fetchJson(`${GT}/networks/solana/pools/${pool}/trades`, { headers: GT_HEADERS, timeoutMs: 8000 });
    const rows: any[] = r?.data || [];
    return rows.slice(0, 120).map((x) => {
      const a = x.attributes || {};
      const buy = a.kind === 'buy';
      const baseIsTo = a.to_token_address === baseMint;
      const amount = +(baseIsTo ? a.to_token_amount : a.from_token_amount) || 0;
      const priceUsd = +(baseIsTo ? a.price_to_in_usd : a.price_from_in_usd) || 0;
      const solSide = baseIsTo ? a.from_token_address : a.to_token_address;
      const solAmt = solSide === SOL_MINT ? +(baseIsTo ? a.from_token_amount : a.to_token_amount) : null;
      return { sig: a.tx_hash, ts: Date.parse(a.block_timestamp) || Date.now(), side: buy ? 'buy' : 'sell', usd: +a.volume_in_usd || 0, priceUsd, amount, sol: solAmt, wallet: a.tx_from_address || '' } as Trade;
    });
  });
}

export async function trendingPools() {
  return memoize('gt:trending', 90000, async () => {
    const r = await fetchJson(`${GT}/networks/solana/trending_pools?include=base_token&page=1&duration=1h`, { headers: GT_HEADERS, timeoutMs: 8000 });
    const tokens = new Map<string, any>();
    for (const inc of r?.included || []) if (inc.type === 'token') tokens.set(inc.id, inc.attributes);
    const out: any[] = [];
    for (const p of r?.data || []) {
      const a = p.attributes || {};
      const baseId = p.relationships?.base_token?.data?.id;
      const tk = tokens.get(baseId) || {};
      const mint = tk.address || (baseId ? String(baseId).replace(/^solana_/, '') : '');
      if (!mint || mint === SOL_MINT) continue;
      const img = typeof tk.image_url === 'string' && tk.image_url.startsWith('https://') ? tk.image_url : null;
      out.push({
        mint, pool: a.address, name: String(tk.name || a.name || '').slice(0, 60), symbol: String(tk.symbol || '').slice(0, 16),
        priceUsd: +a.base_token_price_usd || 0, change24h: +a.price_change_percentage?.h24 || 0, change1h: +a.price_change_percentage?.h1 || 0,
        volume24h: +a.volume_usd?.h24 || 0, liquidityUsd: +a.reserve_in_usd || 0, mcap: +a.market_cap_usd || +a.fdv_usd || 0,
        createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null, image: img,
      });
    }
    return out.slice(0, 20);
  });
}
