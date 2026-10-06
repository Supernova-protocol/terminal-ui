/* Pro paid in SOL: the server only grants Pro after it finds a confirmed transfer from the signed-in wallet
   to the treasury that carries the quote's reference key. RPC answers are stubbed here. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { solQuote, solVerify, proStatus, moonpayUrl } from '../../server/lib/pro';
import { HttpError } from '../../server/lib/env';

const TREASURY = 'J2xccRtuG43drESLYznHhLhQkLTdfepcKYbiQ9BsJVaf';
const SYSTEM = '11111111111111111111111111111111';
const newKey = () => bs58.encode(nacl.sign.keyPair().publicKey);
const newSig = () => bs58.encode(nacl.randomBytes(64));

type TxOpts = { wallet: string; reference?: string | null; lamports?: number; to?: string; signer?: string; err?: any; blockTime?: number; viaInner?: boolean };
function paymentTx(o: TxOpts) {
  const signer = o.signer || o.wallet;
  const keys = [{ pubkey: signer, signer: true, writable: true }, { pubkey: o.to || TREASURY, signer: false, writable: true }, { pubkey: SYSTEM, signer: false, writable: false }];
  if (o.signer && o.signer !== o.wallet) keys.push({ pubkey: o.wallet, signer: false, writable: true });
  if (o.reference) keys.push({ pubkey: o.reference, signer: false, writable: false });
  const ix = { program: 'system', programId: SYSTEM, parsed: { type: 'transfer', info: { source: o.wallet, destination: o.to || TREASURY, lamports: o.lamports ?? 100_000_000 } } };
  return {
    slot: 9, blockTime: o.blockTime ?? Math.floor(Date.now() / 1000),
    meta: { err: o.err ?? null, innerInstructions: o.viaInner ? [{ index: 0, instructions: [ix] }] : [] },
    transaction: { signatures: ['x'], message: { accountKeys: keys, instructions: o.viaInner ? [] : [ix] } },
  };
}

let chainTxs: Record<string, any> = {};
beforeEach(() => {
  chainTxs = {};
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    const req = JSON.parse(init.body);
    const result = req.method === 'getTransaction' ? (chainTxs[req.params[0]] ?? null) : null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function code(p: Promise<unknown>) {
  try { await p; return 'ok'; } catch (e) { return e instanceof HttpError ? e.code : String(e); }
}

describe('Pro paid in SOL', () => {
  it('quotes the configured price to the treasury with a fresh reference key', async () => {
    const w = newKey();
    const q = await solQuote(w);
    expect(q.lamports).toBe(100_000_000);
    expect(q.treasury).toBe(TREASURY);
    expect(bs58.decode(q.reference)).toHaveLength(32);
    expect(q.expiresAt - q.createdAt).toBe(10 * 60000);
  });

  it('activates Pro for 30 days after a valid payment and refuses to reuse it', async () => {
    const w = newKey();
    const q = await solQuote(w);
    const sig = newSig();
    chainTxs[sig] = paymentTx({ wallet: w, reference: q.reference });
    const st = await solVerify(w, q.id, sig);
    expect(st.active).toBe(true);
    expect(st.source).toBe('sol');
    expect(st.until).toBeGreaterThan(Date.now() + 29.9 * 86400000);
    // same transaction again (even with a new quote) is a replay
    const q2 = await solQuote(w);
    expect(await code(solVerify(w, q2.id, sig))).toBe('replay');
  });

  it('stacks a second payment on top of the remaining time', async () => {
    const w = newKey();
    for (let i = 0; i < 2; i++) {
      const q = await solQuote(w);
      const sig = newSig();
      chainTxs[sig] = paymentTx({ wallet: w, reference: q.reference });
      await solVerify(w, q.id, sig);
    }
    const st = await proStatus(w);
    expect(st.until).toBeGreaterThan(Date.now() + 59.9 * 86400000);
  });

  it('accepts a transfer made through an inner instruction', async () => {
    const w = newKey();
    const q = await solQuote(w);
    const sig = newSig();
    chainTxs[sig] = paymentTx({ wallet: w, reference: q.reference, viaInner: true });
    expect((await solVerify(w, q.id, sig)).active).toBe(true);
  });

  it('rejects underpayment, a missing reference, the wrong payer, failed transactions and other recipients', async () => {
    const cases: [Partial<TxOpts>, string][] = [
      [{ lamports: 99_999_999 }, 'underpaid'],
      [{ reference: null }, 'no_reference'],
      [{ signer: newKey() }, 'wrong_payer'],
      [{ err: { InstructionError: [0, 'Custom'] } }, 'tx_failed'],
      [{ to: newKey() }, 'underpaid'],
      [{ blockTime: Math.floor(Date.now() / 1000) - 3600 }, 'stale_payment'],
    ];
    for (const [over, expected] of cases) {
      const w = newKey();
      const q = await solQuote(w);
      const sig = newSig();
      chainTxs[sig] = paymentTx({ wallet: w, reference: q.reference, ...over });
      expect(await code(solVerify(w, q.id, sig)), expected).toBe(expected);
      expect((await proStatus(w)).active).toBe(false);
    }
  });

  it('will not verify a quote for a different wallet', async () => {
    const q = await solQuote(newKey());
    expect(await code(solVerify(newKey(), q.id, newSig()))).toBe('wrong_wallet');
  });
});

describe('MoonPay on-ramp URL', () => {
  it('is signed with HMAC-SHA256 over the query string, as MoonPay requires', () => {
    const w = newKey();
    const url = new URL(moonpayUrl(w, 'https://supernova.example', 100));
    const sig = url.searchParams.get('signature')!;
    url.searchParams.delete('signature');
    const expected = createHmac('sha256', 'sk_test_unit').update(url.search).digest('base64');
    expect(sig).toBe(expected);
    expect(url.searchParams.get('walletAddress')).toBe(w);
    expect(url.searchParams.get('currencyCode')).toBe('sol');
    expect(url.searchParams.get('baseCurrencyAmount')).toBe('100');
    expect(url.searchParams.get('redirectURL')).toBe('https://supernova.example/?onramp=done');
  });
});
