import { route } from '../lib/router.js';
import { ENV, HttpError } from '../lib/env.js';
import { json, body, str, pubkey, signatureStr, assertSameOrigin, fetchJson } from '../lib/http.js';
import { limit } from '../lib/ratelimit.js';
import { requireSession, getSession, siteOrigin } from '../lib/auth.js';
import { proStatus, createCheckout, confirmCheckout, billingPortal, handleWebhook, solQuote, solVerify, moonpayUrl } from '../lib/pro.js';

route('GET', 'pro/status', async ({ req }) => {
  const s = await getSession(req).catch(() => null);
  return json(await proStatus(s?.address));
});

/* card · Apple Pay · Google Pay via Stripe Checkout (subscription) */
route('POST', 'pro/checkout', async ({ req, ip }) => {
  assertSameOrigin(req);
  await limit(`checkout:${ip}`, 10, 600);
  const s = await requireSession(req);
  return json({ url: await createCheckout(s.address, siteOrigin(req)) });
});

route('POST', 'pro/confirm', async ({ req }) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  const b = await body(req);
  const id = str(b.sessionId, 'sessionId', 200, 10);
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw new HttpError(400, 'Invalid checkout session.');
  return json(await confirmCheckout(id, s.address));
});

route('POST', 'pro/portal', async ({ req }) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  return json({ url: await billingPortal(s.address, siteOrigin(req)) });
});

route('POST', 'pro/webhook', async ({ req }) => {
  const raw = await req.text();
  if (raw.length > 512 * 1024) throw new HttpError(413, 'Payload too large.');
  return json(await handleWebhook(raw, req.headers.get('stripe-signature')));
});

/* pay with SOL from the connected wallet */
route('POST', 'pro/sol/quote', async ({ req }) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  await limit(`solquote:${s.address}`, 10, 600);
  return json(await solQuote(s.address));
});

route('POST', 'pro/sol/verify', async ({ req }) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  await limit(`solverify:${s.address}`, 20, 600);
  const b = await body(req);
  return json(await solVerify(s.address, str(b.quoteId, 'quoteId', 40, 8), signatureStr(b.signature)));
});

/* buy SOL with card / Apple Pay / Google Pay (MoonPay widget, signed URL) */
route('POST', 'onramp/moonpay', async ({ req, ip }) => {
  assertSameOrigin(req);
  await limit(`onramp:${ip}`, 10, 600);
  const b = await body(req);
  const s = await getSession(req).catch(() => null);
  const wallet = pubkey(b.address || s?.address, 'wallet');
  const amount = Number(b.amountUsd) || undefined;
  return json({ url: moonpayUrl(wallet, siteOrigin(req), amount) });
});

/* ---------- Jupiter swaps (mainnet): majors, trending and graduated coins ---------- */
function jupHeaders(): Record<string, string> {
  return ENV.jupiterKey ? { 'x-api-key': ENV.jupiterKey } : {};
}
route('GET', 'swap/order', async ({ url, ip }) => {
  if (ENV.cluster !== 'mainnet') throw new HttpError(400, 'Jupiter swaps are only available on mainnet.', 'mainnet_only');
  await limit(`jup:${ip}`, 40, 60);
  const inputMint = pubkey(url.searchParams.get('inputMint'), 'inputMint');
  const outputMint = pubkey(url.searchParams.get('outputMint'), 'outputMint');
  const takerRaw = url.searchParams.get('taker');
  const taker = takerRaw ? pubkey(takerRaw, 'taker') : '';
  const amount = str(url.searchParams.get('amount'), 'amount', 20, 1);
  if (!/^[1-9][0-9]*$/.test(amount)) throw new HttpError(400, 'amount must be a positive integer in base units.');
  const slip = Math.round(Number(url.searchParams.get('slippageBps') || 100));
  if (!(slip >= 10 && slip <= 5000)) throw new HttpError(400, 'Slippage must be between 0.1% and 50%.');
  const q = new URLSearchParams({ inputMint, outputMint, amount, slippageBps: String(slip) });
  if (taker) q.set('taker', taker);
  if (ENV.jupReferralAccount && ENV.jupReferralFeeBps >= 50) { q.set('referralAccount', ENV.jupReferralAccount); q.set('referralFee', String(Math.min(255, ENV.jupReferralFeeBps))); }
  const r = await fetchJson(`${ENV.jupiterUrl}/order?${q}`, { headers: jupHeaders(), timeoutMs: 10000 });
  if (taker && !r?.transaction) throw new HttpError(400, r?.errorMessage || 'No route found for this swap right now.', 'no_route');
  if (!r?.outAmount) throw new HttpError(400, r?.errorMessage || 'No route found for this swap right now.', 'no_route');
  return json({
    transaction: r.transaction || null, requestId: r.requestId, inAmount: r.inAmount, outAmount: r.outAmount,
    priceImpactPct: Number(r.priceImpactPct || 0), slippageBps: r.slippageBps, router: r.router, feeBps: r.feeBps,
  });
});

route('POST', 'swap/execute', async ({ req, ip }) => {
  if (ENV.cluster !== 'mainnet') throw new HttpError(400, 'Jupiter swaps are only available on mainnet.', 'mainnet_only');
  await limit(`jupx:${ip}`, 40, 60);
  const b = await body(req, 32 * 1024);
  const signedTransaction = str(b.signedTransaction, 'signedTransaction', 4000, 100);
  const requestId = str(b.requestId, 'requestId', 200, 4);
  const r = await fetchJson(`${ENV.jupiterUrl}/execute`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...jupHeaders() },
    body: JSON.stringify({ signedTransaction, requestId }), timeoutMs: 30000,
  });
  if (r?.status !== 'Success') throw new HttpError(400, r?.error ? `Swap failed: ${String(r.error).slice(0, 160)}` : 'Swap failed to land. Try again.', 'swap_failed');
  return json({ signature: r.signature, inAmount: r.totalInputAmount || r.inputAmountResult, outAmount: r.totalOutputAmount || r.outputAmountResult });
});
