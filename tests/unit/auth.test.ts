/* Sign-In With Solana end to end through the API router: nonce → wallet signature → session cookie → /me → logout. */
import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { dispatch } from '../../server/routes/index';

const ORIGIN = 'http://localhost:5173';
let ipSeq = 0;
function call(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) {
  const headers: Record<string, string> = { host: 'localhost:5173', 'x-forwarded-for': `10.0.0.${++ipSeq % 250}` };
  if (init.origin !== null) headers.origin = init.origin || ORIGIN;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  return dispatch(new Request(`${ORIGIN}/api/${path}`, { method: init.method || (init.body !== undefined ? 'POST' : 'GET'), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }));
}
const sign = (msg: string, kp: nacl.SignKeyPair) => bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey));

async function signIn(kp: nacl.SignKeyPair) {
  const address = bs58.encode(kp.publicKey);
  const n = await (await call('auth/nonce', { body: { address } })).json();
  const res = await call('auth/verify', { body: { address, nonce: n.nonce, signature: sign(n.message, kp) } });
  return { res, address, n };
}

describe('Sign-In With Solana', () => {
  it('issues a readable sign-in message bound to the address, domain and cluster', async () => {
    const kp = nacl.sign.keyPair();
    const address = bs58.encode(kp.publicKey);
    const n = await (await call('auth/nonce', { body: { address } })).json();
    expect(n.message).toContain('localhost:5173 wants you to sign in with your Solana account:');
    expect(n.message).toContain(address);
    expect(n.message).toContain('Chain ID: devnet');
    expect(n.message).toContain(`Nonce: ${n.nonce}`);
    expect(n.message).toMatch(/does not send a transaction/);
  });

  it('creates an HttpOnly session for a valid signature and ends it on logout', async () => {
    const kp = nacl.sign.keyPair();
    const { res, address } = await signIn(kp);
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/^sn_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax/);
    const cookie = setCookie.split(';')[0];
    const me = await (await call('auth/me', { cookie })).json();
    expect(me.address).toBe(address);
    expect(me.pro.active).toBe(false);
    const out = await call('auth/logout', { body: {}, cookie });
    expect(out.status).toBe(200);
    const after = await (await call('auth/me', { cookie })).json();
    expect(after.address).toBeNull();
  });

  it('rejects a signature from another key and burns the nonce', async () => {
    const kp = nacl.sign.keyPair(), other = nacl.sign.keyPair();
    const address = bs58.encode(kp.publicKey);
    const n = await (await call('auth/nonce', { body: { address } })).json();
    const bad = await call('auth/verify', { body: { address, nonce: n.nonce, signature: sign(n.message, other) } });
    expect(bad.status).toBe(401);
    const retry = await call('auth/verify', { body: { address, nonce: n.nonce, signature: sign(n.message, kp) } });
    expect(retry.status).toBe(400); // one-time nonce
    expect((await retry.json()).code).toBe('nonce_expired');
  });

  it('does not let a nonce issued for one wallet sign in another', async () => {
    const a = nacl.sign.keyPair(), b = nacl.sign.keyPair();
    const n = await (await call('auth/nonce', { body: { address: bs58.encode(a.publicKey) } })).json();
    const res = await call('auth/verify', { body: { address: bs58.encode(b.publicKey), nonce: n.nonce, signature: sign(n.message, b) } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('address_mismatch');
  });

  it('ignores forged or tampered session cookies', async () => {
    const kp = nacl.sign.keyPair();
    const { res } = await signIn(kp);
    const token = (res.headers.get('set-cookie') || '').split(';')[0].split('=')[1];
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.sub = bs58.encode(nacl.sign.keyPair().publicKey);
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    const me = await (await call('auth/me', { cookie: `sn_session=${forged}` })).json();
    expect(me.address).toBeNull();
    const none = await (await call('auth/me', { cookie: `sn_session=${h}.${p}.` })).json();
    expect(none.address).toBeNull();
  });

  it('only revokes sessions it signed, so a forged logout cannot sign someone else out', async () => {
    const kp = nacl.sign.keyPair();
    const { res, address } = await signIn(kp);
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
    const [h, p] = cookie.slice('sn_session='.length).split('.');
    const out = await call('auth/logout', { body: {}, cookie: `sn_session=${h}.${p}.AAAA` }); // same claims, bad signature
    expect(out.status).toBe(200);
    const me = await (await call('auth/me', { cookie })).json();
    expect(me.address).toBe(address);
  });

  it('blocks cross-site POSTs', async () => {
    const res = await call('auth/nonce', { body: { address: bs58.encode(nacl.sign.keyPair().publicKey) }, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('requires a session for the AI analyst', async () => {
    const res = await call('ai/analyze', { body: { mint: 'So11111111111111111111111111111111111111112', preset: 'rug' } });
    expect([401, 503]).toContain(res.status); // 503 when the AI key is not configured in this test env
  });
});

describe('router', () => {
  it('answers 404 for unknown routes and 405 for the wrong method', async () => {
    expect((await call('nope')).status).toBe(404);
    expect((await call('auth/nonce')).status).toBe(405);
  });
  it('maps the Vercel rewrite parameter (__p) to the route', async () => {
    const res = await dispatch(new Request(`${ORIGIN}/api/router?__p=health`, { headers: { host: 'localhost:5173' } }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
