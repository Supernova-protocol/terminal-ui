/* Supernova Pro entitlements: paid by card / Apple Pay / Google Pay (Stripe subscription) or by SOL from the wallet. */
import Stripe from 'stripe';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { createHmac } from 'node:crypto';
import { kv } from './kv.js';
import { ENV, HttpError, need } from './env.js';
import { isAdmin } from './auth.js';
import { waitForTx, txAccountKeys, allInstructions } from './solana.js';

export type ProStatus = { active: boolean; until: number; source: 'stripe' | 'sol' | 'admin' | null; cancelAtPeriodEnd?: boolean; manageable: boolean };

type StripeEnt = { until: number; customerId: string; subscriptionId: string; status: string; cancelAtPeriodEnd: boolean; updatedAt: number };
type SolEnt = { until: number; payments: number; updatedAt: number };

const K = {
  stripe: (w: string) => `pro:stripe:${w}`,
  sol: (w: string) => `pro:sol:${w}`,
  customer: (w: string) => `pro:customer:${w}`,
  evt: (id: string) => `stripe:evt:${id}`,
  quote: (id: string) => `solpay:quote:${id}`,
  sig: (s: string) => `solpay:sig:${s}`,
};

export async function proStatus(wallet: string | null | undefined): Promise<ProStatus> {
  if (!wallet) return { active: false, until: 0, source: null, manageable: false };
  if (isAdmin(wallet)) return { active: true, until: Date.now() + 365 * 86400000, source: 'admin', manageable: false };
  const [s, l] = await Promise.all([kv().get<StripeEnt>(K.stripe(wallet)), kv().get<SolEnt>(K.sol(wallet))]);
  const su = s?.until || 0, lu = l?.until || 0;
  const until = Math.max(su, lu);
  return { active: until > Date.now(), until, source: until === 0 ? null : su >= lu ? 'stripe' : 'sol', cancelAtPeriodEnd: s?.cancelAtPeriodEnd, manageable: !!s?.customerId };
}

/* ---------------- Stripe ---------------- */
let stripeClient: Stripe | null = null;
export function stripe() {
  need('STRIPE_SECRET_KEY', 'STRIPE_PRICE_ID_PRO');
  if (!stripeClient) stripeClient = new Stripe(ENV.stripeSecret, { maxNetworkRetries: 1, timeout: 20000 });
  return stripeClient;
}

export async function createCheckout(wallet: string, origin: string) {
  const s = stripe();
  const customer = await kv().get<string>(K.customer(wallet));
  const session = await s.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: ENV.stripePricePro, quantity: 1 }],
    success_url: `${origin}/?pro=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?pro=cancel`,
    client_reference_id: wallet,
    metadata: { wallet },
    subscription_data: { metadata: { wallet } },
    allow_promotion_codes: true,
    ...(customer ? { customer } : {}),
  });
  if (!session.url) throw new HttpError(502, 'Stripe did not return a checkout link.', 'stripe');
  return session.url;
}

function periodEnd(sub: any): number {
  const item = sub?.items?.data?.[0];
  const sec = Number(item?.current_period_end || sub?.current_period_end || 0);
  return sec * 1000;
}

async function applySubscription(sub: any, walletHint?: string) {
  const wallet = (sub?.metadata?.wallet as string) || walletHint;
  if (!wallet) return;
  const live = ['active', 'trialing', 'past_due'].includes(sub.status);
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || '';
  const ent: StripeEnt = {
    until: live ? periodEnd(sub) + (sub.status === 'past_due' ? 3 * 86400000 : 0) : Math.min(Date.now(), periodEnd(sub) || Date.now()),
    customerId, subscriptionId: sub.id, status: sub.status, cancelAtPeriodEnd: !!sub.cancel_at_period_end, updatedAt: Date.now(),
  };
  await kv().set(K.stripe(wallet), ent);
  if (customerId) await kv().set(K.customer(wallet), customerId);
}

/** Called on return from Checkout so Pro unlocks immediately even if the webhook is a few seconds late. */
export async function confirmCheckout(sessionId: string, wallet: string) {
  const s = stripe();
  const session = await s.checkout.sessions.retrieve(sessionId, { expand: ['subscription'] });
  if ((session.client_reference_id || session.metadata?.wallet) !== wallet) throw new HttpError(403, 'This checkout belongs to a different wallet.', 'wrong_wallet');
  if (session.status !== 'complete') throw new HttpError(402, 'Payment is not complete yet.', 'not_paid');
  const sub: any = session.subscription;
  if (sub && typeof sub === 'object') await applySubscription(sub, wallet);
  return proStatus(wallet);
}

export async function billingPortal(wallet: string, origin: string) {
  const s = stripe();
  const customer = await kv().get<string>(K.customer(wallet));
  if (!customer) throw new HttpError(404, 'No card subscription found for this wallet.', 'no_customer');
  const p = await s.billingPortal.sessions.create({ customer, return_url: `${origin}/?view=profile` });
  return p.url;
}

export async function handleWebhook(raw: string, signature: string | null) {
  need('STRIPE_WEBHOOK_SECRET');
  if (!signature) throw new HttpError(400, 'Missing Stripe signature.', 'bad_signature');
  let event: Stripe.Event;
  try { event = await stripe().webhooks.constructEventAsync(raw, signature, ENV.stripeWebhookSecret); }
  catch { throw new HttpError(400, 'Invalid Stripe signature.', 'bad_signature'); }
  if (!(await kv().setnx(K.evt(event.id), 1, 7 * 86400))) return { duplicate: true };
  const obj: any = event.data.object;
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj.mode === 'subscription' && obj.subscription) {
          const sub = await stripe().subscriptions.retrieve(typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id);
          await applySubscription(sub, obj.client_reference_id || obj.metadata?.wallet);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // events can arrive out of order: apply the subscription's current state rather than the event snapshot
        const fresh: any = await stripe().subscriptions.retrieve(obj.id).catch(() => obj);
        await applySubscription(fresh);
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        const subId = obj.subscription || obj.parent?.subscription_details?.subscription;
        if (subId) await applySubscription(await stripe().subscriptions.retrieve(typeof subId === 'string' ? subId : subId.id));
        break;
      }
      default: break;
    }
  } catch (e) {
    await kv().del(K.evt(event.id)).catch(() => {}); // not applied: let Stripe's automatic retry process it again
    throw e;
  }
  return { ok: true, type: event.type };
}

/* ---------------- SOL payment (Solana Pay style reference key) ---------------- */
export async function solQuote(wallet: string) {
  need('TREASURY_WALLET');
  const id = bs58.encode(nacl.randomBytes(12));
  const reference = bs58.encode(nacl.sign.keyPair().publicKey); // random 32-byte key that tags the transfer
  const lamports = Math.round(ENV.proSolPrice * 1e9);
  const quote = { id, wallet, reference, lamports, treasury: ENV.treasury, createdAt: Date.now(), expiresAt: Date.now() + 10 * 60000, days: ENV.proDays };
  await kv().set(K.quote(id), quote, 15 * 60);
  return quote;
}

export async function solVerify(wallet: string, quoteId: string, signature: string) {
  const q = await kv().get<{ id: string; wallet: string; reference: string; lamports: number; treasury: string; createdAt: number; expiresAt: number; days: number }>(K.quote(quoteId));
  if (!q) throw new HttpError(400, 'This payment quote expired. Start again.', 'quote_expired');
  if (q.wallet !== wallet) throw new HttpError(403, 'This quote belongs to a different wallet.', 'wrong_wallet');
  if (!(await kv().setnx(K.sig(signature), wallet, 365 * 86400))) throw new HttpError(409, 'This payment was already used.', 'replay');
  try {
    const tx = await waitForTx(signature, 8);
    if (tx.meta?.err) throw new HttpError(400, 'The payment transaction failed on-chain.', 'tx_failed');
    const keys = txAccountKeys(tx);
    if (!keys.some((k) => k.signer && k.pubkey === wallet)) throw new HttpError(400, 'The payment was not signed by your wallet.', 'wrong_payer');
    if (!keys.some((k) => k.pubkey === q.reference)) throw new HttpError(400, 'Payment is missing its reference.', 'no_reference');
    const paid = allInstructions(tx)
      .filter((ix) => ix.program === 'system' && (ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferWithSeed'))
      .filter((ix) => ix.parsed.info.source === wallet && ix.parsed.info.destination === q.treasury)
      .reduce((a, ix) => a + Number(ix.parsed.info.lamports || 0), 0);
    if (paid < q.lamports) throw new HttpError(400, `Payment too small: ${paid / 1e9} SOL received, ${q.lamports / 1e9} SOL required.`, 'underpaid');
    const bt = (tx.blockTime || 0) * 1000;
    if (bt && (bt < q.createdAt - 120000 || bt > q.expiresAt + 300000)) throw new HttpError(400, 'Payment was sent outside the quote window.', 'stale_payment');
    const cur = await kv().get<SolEnt>(K.sol(wallet));
    const base = Math.max(Date.now(), cur?.until || 0);
    await kv().set(K.sol(wallet), { until: base + q.days * 86400000, payments: (cur?.payments || 0) + 1, updatedAt: Date.now() });
    await kv().del(K.quote(quoteId));
    return proStatus(wallet);
  } catch (e) {
    if (!(e instanceof HttpError && e.code === 'replay')) await kv().del(K.sig(signature)); // let the user retry a genuinely pending tx
    throw e;
  }
}

/* ---------------- MoonPay on-ramp (card / Apple Pay / Google Pay → SOL) ---------------- */
export function moonpayUrl(wallet: string, origin: string, amountUsd?: number) {
  need('MOONPAY_PUBLISHABLE_KEY', 'MOONPAY_SECRET_KEY');
  const p = new URLSearchParams({ apiKey: ENV.moonpayKey, currencyCode: 'sol', walletAddress: wallet, colorCode: '#00F3FF', theme: 'dark', redirectURL: `${origin}/?onramp=done` });
  if (amountUsd && amountUsd >= 20 && amountUsd <= 10000) { p.set('baseCurrencyCode', 'usd'); p.set('baseCurrencyAmount', String(Math.round(amountUsd))); }
  const query = '?' + p.toString();
  const signature = createHmac('sha256', ENV.moonpaySecret).update(query).digest('base64');
  return `${ENV.moonpayBase}${query}&signature=${encodeURIComponent(signature)}`;
}
