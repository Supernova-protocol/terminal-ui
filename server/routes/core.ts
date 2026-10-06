import { route } from '../lib/router.js';
import { ENV, HttpError } from '../lib/env.js';
import { json, body, pubkey, str, signatureStr, fetchJson, assertSameOrigin, memoize, cookies } from '../lib/http.js';
import { limit } from '../lib/ratelimit.js';
import { kv, kvPersistent } from '../lib/kv.js';
import { createNonce, consumeNonce, sessionCookie, clearSessionCookie, getSession, verifySessionToken, isAdmin, SESSION_COOKIE } from '../lib/auth.js';
import { proStatus } from '../lib/pro.js';
import { rpc } from '../lib/solana.js';

/* ---------- health & public config ---------- */
route('GET', 'health', async () => json({ ok: true, cluster: ENV.cluster, time: Date.now() }));

export const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5', 'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY', 'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh', 'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL', '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

route('GET', 'config', async () => json({
  cluster: ENV.cluster,
  launchProgram: ENV.launchProgram,
  platformId: ENV.platformId,
  platformConfigured: ENV.platformConfigured,
  migrateType: ENV.migrateType,
  rpcUrl: ENV.publicRpcUrl || '/api/rpc',
  features: {
    ai: !!ENV.anthropicKey,
    images: !!ENV.pexelsKey,
    ipfs: !!ENV.pinataJwt,
    stripe: !!(ENV.stripeSecret && ENV.stripePricePro),
    solPay: !!ENV.treasury,
    moonpay: !!(ENV.moonpayKey && ENV.moonpaySecret),
    jupiter: ENV.cluster === 'mainnet',
    mev: ENV.cluster === 'mainnet',
    persistent: kvPersistent(),
  },
  pro: { solPrice: ENV.proSolPrice, days: ENV.proDays, priceLabel: ENV.proPriceLabel, freeAnalysesPerDay: ENV.freeAnalysesPerDay },
  // setup checklist for the admin page (booleans only, never the values)
  setup: {
    auth: ENV.jwtSecret().length >= 32,
    customRpc: !!process.env.RPC_URL,
    siteUrl: !!ENV.siteUrl,
    stripeWebhook: !!ENV.stripeWebhookSecret,
    admins: ENV.adminWallets.length > 0,
  },
  jitoTipAccounts: JITO_TIP_ACCOUNTS,
}, 200, { 'cache-control': 'public, max-age=60, s-maxage=60' }));

/* ---------- Sign-In With Solana ---------- */
route('POST', 'auth/nonce', async ({ req, ip }) => {
  assertSameOrigin(req);
  await limit(`nonce:${ip}`, 20, 60);
  const b = await body(req);
  const address = pubkey(b.address);
  return json(await createNonce(req, address));
});

route('POST', 'auth/verify', async ({ req, ip }) => {
  assertSameOrigin(req);
  await limit(`verify:${ip}`, 20, 60);
  const b = await body(req);
  const address = pubkey(b.address);
  const nonce = str(b.nonce, 'nonce', 64, 8);
  const signature = str(b.signature, 'signature', 120, 64);
  await consumeNonce(nonce, address, signature);
  const cookie = await sessionCookie(req, address);
  return json({ address, pro: await proStatus(address), admin: isAdmin(address) }, 200, { 'set-cookie': cookie });
});

route('GET', 'auth/me', async ({ req }) => {
  const s = await getSession(req).catch(() => null);
  if (!s) return json({ address: null, pro: await proStatus(null), admin: false });
  return json({ address: s.address, pro: await proStatus(s.address), admin: isAdmin(s.address) });
});

route('POST', 'auth/logout', async ({ req }) => {
  assertSameOrigin(req);
  const token = cookies(req)[SESSION_COOKIE];
  if (token) {
    // only a token we signed can be revoked: a forged one must not be able to write revocation keys
    const p = await verifySessionToken(token).catch(() => null);
    if (p) await kv().set(`auth:revoked:${p.sub}:${p.iat}`, 1, Math.max(1, p.exp - Math.floor(Date.now() / 1000)));
  }
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie(req) });
});

/* ---------- RPC proxy (keeps the RPC key server-side) ---------- */
const RPC_METHODS = new Set([
  'getAccountInfo', 'getBalance', 'getBlockHeight', 'getBlockTime', 'getEpochInfo', 'getEpochSchedule', 'getFeeForMessage',
  'getFirstAvailableBlock', 'getGenesisHash', 'getHealth', 'getLatestBlockhash', 'getMinimumBalanceForRentExemption',
  'getMultipleAccounts', 'getRecentPerformanceSamples', 'getRecentPrioritizationFees', 'getSignatureStatuses',
  'getSignaturesForAddress', 'getSlot', 'getTokenAccountBalance', 'getTokenAccountsByOwner', 'getTokenLargestAccounts',
  'getTokenSupply', 'getTransaction', 'getVersion', 'isBlockhashValid', 'sendTransaction', 'simulateTransaction',
]);
route('POST', 'rpc', async ({ req, ip }) => {
  if (Number(req.headers.get('content-length') || 0) > 256 * 1024) throw new HttpError(413, 'RPC request too large.');
  const text = await req.text();
  if (text.length > 256 * 1024) throw new HttpError(413, 'RPC request too large.');
  let payload: any;
  try { payload = JSON.parse(text); } catch { throw new HttpError(400, 'Invalid JSON-RPC body.'); }
  const calls = Array.isArray(payload) ? payload : [payload];
  if (!calls.length || calls.length > 25) throw new HttpError(400, 'Batch must contain 1 to 25 calls.');
  // every call in a batch counts against the per-IP budget, so the paid RPC cannot be used as a free relay
  await limit(`rpc:${ip}`, 600, 60, 'Too many network requests from this browser. Slow down for a moment.', calls.length);
  for (const c of calls) {
    const m = c && c.method;
    const ok = RPC_METHODS.has(m) || (m === 'requestAirdrop' && ENV.cluster === 'devnet');
    if (!ok) throw new HttpError(403, `RPC method ${String(m).slice(0, 40)} is not available through this proxy.`, 'rpc_method');
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const upstream = await fetch(ENV.rpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: text, signal: ctl.signal });
    const out = await upstream.text();
    return new Response(out, { status: upstream.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch {
    throw new HttpError(504, 'The Solana RPC did not respond. Try again.', 'rpc_timeout');
  } finally { clearTimeout(t); }
});

/* ---------- transaction relay (normal RPC or Jito for MEV protection) ---------- */
route('POST', 'tx/send', async ({ req, ip }) => {
  await limit(`txsend:${ip}`, 40, 60);
  const b = await body(req, 32 * 1024);
  const tx = str(b.tx, 'tx', 4000, 100);
  if (!/^[A-Za-z0-9+/=]+$/.test(tx)) throw new HttpError(400, 'Transaction must be base64.');
  if (b.mev && ENV.cluster === 'mainnet') {
    try {
      const r = await fetchJson(`${ENV.jitoUrl}?bundleOnly=true`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sendTransaction', params: [tx, { encoding: 'base64' }] }), timeoutMs: 8000,
      });
      if (r?.result) return json({ signature: r.result, via: 'jito' });
      if (r?.error) throw new HttpError(400, `Jito rejected the transaction: ${String(r.error.message || '').slice(0, 160)}`, 'jito');
    } catch (e: any) {
      if (e instanceof HttpError && e.code === 'jito') throw e;
      // block engine busy: fall through to the normal RPC path
    }
  }
  try {
    const sig = await rpc<string>('sendTransaction', [tx, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }], 15000);
    return json({ signature: sig, via: b.mev && ENV.cluster === 'mainnet' ? 'rpc-fallback' : 'rpc' });
  } catch (e: any) {
    if (e instanceof HttpError && e.code === 'rpc') throw new HttpError(400, simplifyRpcError(e.message), 'tx_rejected');
    throw e;
  }
});

export function simplifyRpcError(msg: string) {
  const m = msg || '';
  if (/insufficient (funds|lamports)|0x1\b|custom program error: 0x1$/i.test(m)) return 'Not enough SOL to cover this trade plus network fees.';
  if (/slippage|exceeds desired slippage|0x1771|ExceededSlippage|too little output/i.test(m)) return 'Price moved more than your slippage setting. Try again or raise slippage.';
  if (/blockhash not found|block height exceeded/i.test(m)) return 'The transaction expired before it landed. Please try again.';
  if (/already been processed/i.test(m)) return 'This transaction was already sent.';
  return 'The network rejected the transaction: ' + m.replace(/^Solana RPC sendTransaction failed:\s*/, '').slice(0, 180);
}

route('GET', 'tx/status', async ({ url }) => {
  const sigs = (url.searchParams.get('sigs') || '').split(',').filter(Boolean).slice(0, 20).map((s) => signatureStr(s));
  if (!sigs.length) throw new HttpError(400, 'sigs is required.');
  const r = await rpc<{ value: any[] }>('getSignatureStatuses', [sigs, { searchTransactionHistory: false }]);
  return json({ statuses: r.value.map((v) => (v ? { status: v.confirmationStatus, err: v.err, slot: v.slot } : null)) });
});

route('GET', 'jito/tips', async () => {
  const tips = await memoize('jito:tips', 60000, async () => {
    try {
      const r = await fetchJson('https://bundles.jito.wtf/api/v1/bundles/tip_floor', { timeoutMs: 4000 });
      const row = Array.isArray(r) ? r[0] : null;
      return row ? { p50: row.landed_tips_50th_percentile, p75: row.landed_tips_75th_percentile, p95: row.landed_tips_95th_percentile } : null;
    } catch { return null; }
  });
  return json({ accounts: JITO_TIP_ACCOUNTS, floorSol: tips }, 200, { 'cache-control': 'public, s-maxage=60' });
});
