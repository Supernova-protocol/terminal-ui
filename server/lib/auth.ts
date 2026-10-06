/* Sign-In With Solana: the wallet signs a human-readable message (no transaction, no fee);
   the server verifies the ed25519 signature and issues an HttpOnly session cookie. */
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { SignJWT, jwtVerify } from 'jose';
import { kv } from './kv.js';
import { ENV, HttpError } from './env.js';
import { cookies } from './http.js';

export const SESSION_COOKIE = 'sn_session';
const SESSION_SECONDS = 7 * 24 * 3600;
const NONCE_SECONDS = 5 * 60;

let devSecret: Uint8Array | null = null;
function secret(): Uint8Array {
  const s = ENV.jwtSecret();
  if (s.length >= 32) return new TextEncoder().encode(s);
  if (ENV.isVercel) throw new HttpError(503, 'Sign-in is not configured yet (JWT_SECRET must be at least 32 characters). See SETUP.md.', 'not_configured');
  if (!devSecret) {
    devSecret = nacl.randomBytes(32);
    console.warn('[auth] JWT_SECRET not set: using a random development secret (sessions reset when the dev server restarts).');
  }
  return devSecret;
}

export function siteOrigin(req: Request) {
  if (ENV.siteUrl) return ENV.siteUrl;
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || u.host;
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '');
  return `${proto}://${host}`;
}

export function buildSignInMessage(p: { domain: string; address: string; uri: string; nonce: string; issuedAt: string; expirationTime: string; chainId: string }) {
  return [
    `${p.domain} wants you to sign in with your Solana account:`,
    p.address,
    '',
    'Sign in to Supernova. This only proves you own this wallet: it does not send a transaction, move funds or cost a fee.',
    '',
    `URI: ${p.uri}`,
    'Version: 1',
    `Chain ID: ${p.chainId}`,
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt}`,
    `Expiration Time: ${p.expirationTime}`,
  ].join('\n');
}

export async function createNonce(req: Request, address: string) {
  const origin = siteOrigin(req);
  const nonce = bs58.encode(nacl.randomBytes(16));
  const now = new Date();
  const message = buildSignInMessage({
    domain: new URL(origin).host,
    address,
    uri: origin,
    nonce,
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + NONCE_SECONDS * 1000).toISOString(),
    chainId: ENV.cluster,
  });
  await kv().set(`auth:nonce:${nonce}`, { address, message }, NONCE_SECONDS);
  return { nonce, message };
}

export function verifyEd25519(message: string, signatureB58: string, address: string) {
  let sig: Uint8Array, pk: Uint8Array;
  try { sig = bs58.decode(signatureB58); pk = bs58.decode(address); } catch { return false; }
  if (sig.length !== 64 || pk.length !== 32) return false;
  return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pk);
}

export async function consumeNonce(nonce: string, address: string, signature: string) {
  const key = `auth:nonce:${nonce}`;
  const rec = await kv().get<{ address: string; message: string }>(key);
  if (!rec) throw new HttpError(400, 'This sign-in request expired. Please try again.', 'nonce_expired');
  await kv().del(key); // one-time use, even if verification fails
  if (rec.address !== address) throw new HttpError(400, 'Wallet address does not match the sign-in request.', 'address_mismatch');
  if (!verifyEd25519(rec.message, signature, address)) throw new HttpError(401, 'Signature check failed. Make sure you sign with the connected wallet.', 'bad_signature');
  return rec.message;
}

const isSecure = (req: Request) => (ENV.siteUrl || req.url).startsWith('https://') || req.headers.get('x-forwarded-proto') === 'https';

export async function sessionCookie(req: Request, address: string) {
  const token = await new SignJWT({ sub: address })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .setIssuer('supernova')
    .sign(secret());
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${isSecure(req) ? '; Secure' : ''}`;
}

export function clearSessionCookie(req: Request) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;
}

/** Verifies a session JWT we issued (signature, issuer, expiry). Returns its claims or null. */
export async function verifySessionToken(token: string): Promise<{ sub: string; iat: number; exp: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: 'supernova', algorithms: ['HS256'] });
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    if (!sub || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
    return { sub, iat: payload.iat, exp: payload.exp };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    return null;
  }
}

export async function getSession(req: Request): Promise<{ address: string } | null> {
  const token = cookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const p = await verifySessionToken(token);
  if (!p) return null;
  if (await kv().get(`auth:revoked:${p.sub}:${p.iat}`)) return null;
  return { address: p.sub };
}

export async function requireSession(req: Request) {
  const s = await getSession(req);
  if (!s) throw new HttpError(401, 'Connect your wallet and sign in first.', 'auth_required');
  return s;
}

export const isAdmin = (address: string | null | undefined) => !!address && ENV.adminWallets.includes(address);
