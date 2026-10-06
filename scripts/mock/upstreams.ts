/* DEV ONLY (npm run dev:mock): intercepts the server's outbound fetches and answers with a simulated chain and
   canned market data, so every page and flow can be exercised without accounts or network access. */
import { readFileSync, existsSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { chain, seed, fixtures, sendTransaction, airdrop, accountView, tokenAccountsOf, largestAccounts, TEST_WALLET, TREASURY, CPMM_CONFIGS } from './chain.ts';
import { registerLaunch } from '../../server/lib/launches.ts';

const SOL = 'So11111111111111111111111111111111111111112';
const MAJORS: [string, string, string, number, number][] = [
  ['EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', 'dogwifhat', 'WIF', 0.92, 920e6],
  ['DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', 'Bonk', 'BONK', 0.0000215, 1.66e9],
  ['7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', 'POPCAT', 'POPCAT', 0.381, 373e6],
  ['JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', 'Jupiter', 'JUP', 0.52, 1.58e9],
  ['4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', 'Raydium', 'RAY', 2.41, 702e6],
  ['jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', 'Jito', 'JTO', 2.12, 684e6],
  ['MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5', 'cat in a dogs world', 'MEW', 0.0029, 259e6],
  ['2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump', 'Peanut the Squirrel', 'PNUT', 0.21, 210e6],
  ['ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82', 'BOOK OF MEME', 'BOME', 0.0018, 124e6],
  ['ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY', 'Moo Deng', 'MOODENG', 0.159, 157e6],
];
const SOL_USD = 168.4;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const pairAddr = (mint: string) => bs58.encode(nacl.hash(new TextEncoder().encode('pair:' + mint)).subarray(0, 32));
const jitter = (seedStr: string, n = 1) => { const h = nacl.hash(new TextEncoder().encode(seedStr + Math.floor(Date.now() / 15000))); return ((h[0] / 255) - 0.5) * n; };

function dexPair(mint: string, name: string, sym: string, price: number, mcap: number) {
  const p = price * (1 + jitter(mint, 0.01));
  const liq = mcap * 0.03;
  return {
    chainId: 'solana', dexId: sym === 'JUP' ? 'meteora' : 'raydium', url: 'https://dexscreener.com/solana/' + pairAddr(mint), pairAddress: pairAddr(mint),
    baseToken: { address: mint, name, symbol: sym }, quoteToken: { address: SOL, name: 'Wrapped SOL', symbol: 'SOL' },
    priceNative: String(p / SOL_USD), priceUsd: String(p),
    txns: { m5: { buys: 40, sells: 31 }, h1: { buys: 512, sells: 470 }, h6: { buys: 2900, sells: 2700 }, h24: { buys: 11800, sells: 10900 } },
    volume: { h24: mcap * 0.08, h6: mcap * 0.02, h1: mcap * 0.004, m5: mcap * 0.0004 },
    priceChange: { m5: jitter(mint + 'a', 2), h1: jitter(mint + 'b', 6), h6: jitter(mint + 'c', 12), h24: jitter(mint + 'd', 30) },
    liquidity: { usd: liq, base: liq / 2 / p, quote: liq / 2 / SOL_USD }, fdv: mcap, marketCap: mcap, pairCreatedAt: Date.now() - 400 * 86400000,
  };
}

function ohlcv(price: number, tfSec: number, n: number, key: string) {
  const out: number[][] = [];
  let p = price;
  const now = Math.floor(Date.now() / 1000 / tfSec) * tfSec;
  const h = nacl.hash(new TextEncoder().encode(key));
  for (let i = 0; i < n; i++) {
    const r = ((h[i % 64] / 255) - 0.5) * 0.04 + Math.sin(i / 7) * 0.006;
    const close = p, open = p / (1 + r);
    out.push([now - i * tfSec, open, Math.max(open, close) * 1.006, Math.min(open, close) * 0.994, close, price * 2e6 * (0.4 + (h[(i * 7) % 64] / 255))]);
    p = open;
  }
  return out; // newest first, like GeckoTerminal
}

let PNG: Buffer | null = null;
function photo(): Buffer {
  if (PNG) return PNG;
  const f = '/home/claude/ad/assets/raccoon_coin.jpg';
  PNG = existsSync(f) ? readFileSync(f) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==', 'base64');
  return PNG;
}

/* ---------- JSON-RPC ---------- */
function rpcResult(id: any, result: any) { return { jsonrpc: '2.0', id, result }; }
function handleRpc(call: any) {
  const { id, method, params = [] } = call;
  const ctx = (value: any) => rpcResult(id, { context: { slot: chain.slot, apiVersion: '2.2.0' }, value });
  try {
    switch (method) {
      case 'getSlot': return rpcResult(id, chain.slot);
      case 'getBlockHeight': return rpcResult(id, chain.slot - 20_000_000);
      case 'getEpochInfo': return rpcResult(id, { epoch: 800, slotIndex: 123456, slotsInEpoch: 432000, absoluteSlot: chain.slot, blockHeight: chain.slot - 20_000_000, transactionCount: 1 });
      case 'getRecentPerformanceSamples': return rpcResult(id, [0, 1, 2, 3].map((i) => ({ slot: chain.slot - i * 150, numSlots: 150, numTransactions: 260000 + i * 1200, numNonVoteTransactions: 61000 + i * 400, samplePeriodSecs: 60 })));
      case 'getLatestBlockhash': return ctx({ blockhash: bs58.encode(nacl.hash(new TextEncoder().encode('bh' + chain.slot)).subarray(0, 32)), lastValidBlockHeight: chain.slot - 20_000_000 + 150 });
      case 'isBlockhashValid': return ctx(true);
      case 'getFeeForMessage': return ctx(5000);
      case 'getMinimumBalanceForRentExemption': return rpcResult(id, ((params[0] || 0) + 128) * 6960);
      case 'getVersion': return rpcResult(id, { 'solana-core': '2.2.0', 'feature-set': 1 });
      case 'getGenesisHash': return rpcResult(id, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
      case 'getHealth': return rpcResult(id, 'ok');
      case 'getRecentPrioritizationFees': return rpcResult(id, []);
      case 'getBalance': return ctx(chain.accounts.get(params[0])?.lamports || 0);
      case 'getAccountInfo': return ctx(accountView(params[0], params[1]?.encoding || 'base64'));
      case 'getMultipleAccounts': return ctx((params[0] || []).map((key: string) => accountView(key, params[1]?.encoding || 'base64')));
      case 'getTokenAccountsByOwner': {
        const prog = params[1]?.programId || '';
        const enc = params[2]?.encoding || 'base64';
        return ctx(tokenAccountsOf(params[0], prog).map((x) => ({ pubkey: x.pubkey, account: accountView(x.pubkey, enc) })));
      }
      case 'getTokenAccountBalance': {
        const v: any = accountView(params[0], 'jsonParsed');
        if (!v || !v.data?.parsed) throw { code: -32602, message: 'Invalid param: could not find account' };
        return ctx(v.data.parsed.info.tokenAmount);
      }
      case 'getTokenLargestAccounts': return ctx(largestAccounts(params[0]));
      case 'getSignaturesForAddress': {
        const all = chain.byAddress.get(params[0]) || [];
        const opts = params[1] || {};
        const out: any[] = [];
        for (const s of all) {
          if (opts.until && s === opts.until) break;
          const r = chain.sigs.get(s)!;
          out.push({ signature: s, slot: r.slot, err: null, memo: null, blockTime: r.blockTime, confirmationStatus: 'confirmed' });
          if (out.length >= (opts.limit || 1000)) break;
        }
        return rpcResult(id, out);
      }
      case 'getTransaction': return rpcResult(id, chain.sigs.get(params[0])?.tx || null);
      case 'getSignatureStatuses': return ctx((params[0] || []).map((s: string) => { const r = chain.sigs.get(s); return r ? { slot: r.slot, confirmations: null, err: null, status: { Ok: null }, confirmationStatus: 'confirmed' } : null; }));
      case 'sendTransaction': return rpcResult(id, sendTransaction(params[0]));
      case 'simulateTransaction': return ctx({ err: null, logs: [], accounts: null, unitsConsumed: 120000 });
      case 'requestAirdrop': return rpcResult(id, airdrop(params[0], params[1]));
      default: return { jsonrpc: '2.0', id, error: { code: -32601, message: `Mock RPC: ${method} not implemented` } };
    }
  } catch (e: any) {
    return { jsonrpc: '2.0', id, error: e?.rpc || { code: e?.code || -32000, message: e?.message || String(e) } };
  }
}

/* ---------- Anthropic ---------- */
function anthropic(body: any) {
  const tool = body.tools?.[0]?.name;
  let input: any;
  if (tool === 'propose_coin') {
    input = { name: 'Trench Bandit', ticker: 'BANDIT', description: 'The raccoon that robs bear markets and leaves green candles behind.', imageQuery: 'raccoon portrait' };
  } else {
    const text = String(body.messages?.[0]?.content || '');
    const m = /"priceUsd":([0-9.e-]+)/.exec(text);
    const px = m ? Number(m[1]) : 0.0001;
    input = {
      signal: 'ACCUMULATE', conviction: 68, rugRisk: 'LOW', headline: 'Clean dev, spread-out holders.',
      answer: `The dev wallet has not sold and the top ten wallets hold a modest share, so the structure looks clean. Flow over the last hour leans to buyers; the play is to buy pullbacks toward support and cut it if that level breaks.`,
      entry: px * 0.97, stop: px * 0.88, takeProfit: px * 1.25,
    };
  }
  return { id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'tool_use', id: 'toolu_mock', name: tool, input }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 180 } };
}

/* ---------- install ---------- */
let installed = false;
export function install() {
  if (installed) return;
  installed = true;
  seed();
  if (process.env.TREASURY_WALLET !== TREASURY.toBase58()) console.warn('[mock] TREASURY_WALLET differs from the simulator treasury');
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 120));
    switch (url.host) {
      case 'mock-rpc.local': return json(Array.isArray(body) ? body.map(handleRpc) : handleRpc(body));
      case 'api.dexscreener.com': {
        const ids = decodeURIComponent(url.pathname.split('/').pop() || '').split(',');
        const pairs: any[] = [];
        for (const id of ids) {
          if (id === SOL) pairs.push({ ...dexPair(SOL, 'Wrapped SOL', 'SOL', SOL_USD, 80e9), quoteToken: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC' } });
          const m = MAJORS.find((x) => x[0] === id);
          if (m) pairs.push(dexPair(...m));
        }
        return json(pairs);
      }
      case 'api.geckoterminal.com': {
        const path = url.pathname;
        if (path.includes('/ohlcv/')) {
          const tf = path.split('/ohlcv/')[1];
          const agg = Number(url.searchParams.get('aggregate') || 1);
          const sec = (tf === 'minute' ? 60 : tf === 'hour' ? 3600 : 86400) * agg;
          const pool = path.split('/pools/')[1].split('/')[0];
          const major = MAJORS.find((x) => pairAddr(x[0]) === pool);
          return json({ data: { attributes: { ohlcv_list: ohlcv(major ? major[3] : 0.001, sec, Number(url.searchParams.get('limit') || 200), pool + tf) } } });
        }
        if (path.endsWith('/trades')) {
          const pool = path.split('/pools/')[1].split('/')[0];
          const major = MAJORS.find((x) => pairAddr(x[0]) === pool);
          const price = major ? major[3] : 0.001;
          return json({ data: Array.from({ length: 30 }, (_, i) => {
            const buy = (i * 7) % 3 !== 0, usd = 50 + ((i * 97) % 23) * 180;
            return { id: 'tr' + i, attributes: { tx_hash: bs58.encode(nacl.hash(new TextEncoder().encode(pool + i))), kind: buy ? 'buy' : 'sell', volume_in_usd: String(usd), block_timestamp: new Date(Date.now() - i * 37000).toISOString(), tx_from_address: bs58.encode(nacl.hash(new TextEncoder().encode('w' + i)).subarray(0, 32)), from_token_address: buy ? SOL : major?.[0], to_token_address: buy ? major?.[0] : SOL, from_token_amount: String(buy ? usd / SOL_USD : usd / price), to_token_amount: String(buy ? usd / price : usd / SOL_USD), price_from_in_usd: String(buy ? SOL_USD : price), price_to_in_usd: String(buy ? price : SOL_USD) } };
          }) });
        }
        if (path.includes('trending_pools')) {
          const list = [['Glorp', 'GLORP', 0.0041], ['Space Hamster', 'SHAM', 0.00087], ['Turbo Owl', 'TOWL', 0.012]];
          const data: any[] = [], included: any[] = [];
          list.forEach(([name, sym, price], i) => {
            const mint = bs58.encode(nacl.hash(new TextEncoder().encode('trend' + i)).subarray(0, 32));
            data.push({ id: 'p' + i, attributes: { address: pairAddr(mint), name: sym + ' / SOL', base_token_price_usd: String(price), price_change_percentage: { h1: String(4 + i * 3), h24: String(40 + i * 25) }, volume_usd: { h24: String(900000 / (i + 1)) }, reserve_in_usd: String(120000 / (i + 1)), market_cap_usd: String(Number(price) * 1e9), pool_created_at: new Date(Date.now() - (i + 2) * 3600000).toISOString() }, relationships: { base_token: { data: { id: 'solana_' + mint } } } });
            included.push({ id: 'solana_' + mint, type: 'token', attributes: { address: mint, name, symbol: sym, image_url: null } });
          });
          return json({ data, included });
        }
        if (path.includes('/simple/')) return json({ data: { attributes: { token_prices: { [SOL]: String(SOL_USD) } } } });
        return json({ data: [] });
      }
      case 'api.anthropic.com': return json(anthropic(body));
      case 'uploads.pinata.cloud': return json({ data: { id: 'f' + Date.now(), cid: 'bafkreimock' + Math.random().toString(36).slice(2, 10) } });
      case 'gateway.pinata.cloud': {
        if (/\.(png|jpe?g)$|mock-image/.test(url.pathname)) return new Response(new Uint8Array(photo()), { status: 200, headers: { 'content-type': 'image/jpeg' } });
        const sym = (url.pathname.split('mock-')[1] || 'coin').toUpperCase();
        return json({ name: sym, symbol: sym, description: `${sym} is a coin from the offline simulator.`, image: 'https://gateway.pinata.cloud/ipfs/mock-image.png', twitter: 'https://x.com/supernova' });
      }
      case 'api.pexels.com': return json({ photos: [1, 2, 3, 4].map((i) => ({ id: i, alt: 'Raccoon portrait ' + i, url: 'https://www.pexels.com/photo/' + i, photographer: 'Mock Photographer', photographer_url: 'https://www.pexels.com/@mock', avg_color: '#3b3226', src: { medium: `https://images.pexels.com/photos/${i}/raccoon.jpeg?w=350`, large: `https://images.pexels.com/photos/${i}/raccoon.jpeg?w=940` } })) });
      case 'images.pexels.com': return new Response(new Uint8Array(photo()), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      case 'launch-mint-v1-devnet.raydium.io': return json({ id: 'x', success: true, data: [] });
      case 'api-v3-devnet.raydium.io': return json({ id: 'x', success: true, data: url.pathname === '/main/cpmm-config' ? CPMM_CONFIGS : [] });
      case 'bundles.jito.wtf': return json([{ landed_tips_50th_percentile: 0.00001, landed_tips_75th_percentile: 0.00005, landed_tips_95th_percentile: 0.0005 }]);
      default: return real(input, init);
    }
  }) as typeof fetch;
  console.log(`[mock] simulated devnet ready · test wallet ${TEST_WALLET.publicKey.toBase58()} · ${chain.accounts.size} accounts`);
  return Promise.all(fixtures.map((f) => registerLaunch(f.sig, f.mint).catch((e) => console.warn('[mock] register failed', f.mint, e?.message))));
}
export const TEST_WALLET_SEED = 7;
export { PublicKey };
