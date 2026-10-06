import { ENV, HttpError } from './env.js';

export type Ctx = { req: Request; url: URL; ip: string; path: string; params: Record<string, string> };
export type Handler = (ctx: Ctx) => Promise<Response>;

const BASE_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };

export const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, 'cache-control': 'no-store', ...headers } });

/** Public, CDN-cacheable JSON (market data that is identical for every visitor). */
export const cached = (data: unknown, maxAge: number, headers: Record<string, string> = {}) =>
  json(data, 200, { 'cache-control': `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 4}`, ...headers });

export async function body<T = any>(req: Request, maxBytes = 64 * 1024): Promise<T> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'Request body is too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Request body is too large.');
  if (!text) return {} as T;
  try { return JSON.parse(text) as T; } catch { throw new HttpError(400, 'Body must be valid JSON.'); }
}

export function clientIp(req: Request) {
  const f = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || '';
  return f.split(',')[0].trim() || '0.0.0.0';
}

export function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

/** Defense in depth for cookie-authenticated writes: the browser's Origin must be this site. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return; // same-origin fetches from older browsers, curl, server-to-server: cookies still SameSite=Lax
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  let o: URL;
  try { o = new URL(origin); } catch { throw new HttpError(403, 'Cross-site request blocked.', 'bad_origin'); }
  const allowed = new Set([host, safeHost(ENV.siteUrl)].filter(Boolean));
  if (!allowed.has(o.host)) throw new HttpError(403, 'Cross-site request blocked.', 'bad_origin');
}
const safeHost = (u: string) => { try { return new URL(u).host; } catch { return ''; } };

export function str(v: unknown, name: string, max = 200, min = 1): string {
  if (typeof v !== 'string') throw new HttpError(400, `${name} is required.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(400, `${name} must be ${min} to ${max} characters.`);
  return s;
}
export function optStr(v: unknown, name: string, max = 200): string {
  if (v == null || v === '') return '';
  return str(v, name, max, 0);
}

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isPubkey = (s: unknown): s is string => typeof s === 'string' && B58.test(s);
export function pubkey(v: unknown, name = 'address'): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!B58.test(s)) throw new HttpError(400, `${name} is not a valid Solana address.`);
  return s;
}
export function signatureStr(v: unknown, name = 'signature'): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(s)) throw new HttpError(400, `${name} is not a valid transaction signature.`);
  return s;
}
export function httpsUrl(v: unknown, name: string, max = 300): string {
  if (v == null || v === '') return '';
  const s = str(v, name, max, 0);
  let u: URL;
  try { u = new URL(s); } catch { throw new HttpError(400, `${name} must be a full https:// link.`); }
  if (u.protocol !== 'https:') throw new HttpError(400, `${name} must start with https://`);
  return u.toString();
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
  console.error('[api] unhandled', err);
  return json({ error: 'Something went wrong on our side. Try again in a moment.', code: 'internal' }, 500);
}

/* small in-process cache for upstream data (per warm serverless instance) */
const memo = new Map<string, { at: number; ttl: number; p: Promise<any> }>();
export function memoize<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.p;
  const p = fn().catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { at: Date.now(), ttl: ttlMs, p });
  if (memo.size > 800) { const first = memo.keys().next().value; if (first) memo.delete(first); }
  return p;
}
export function clearMemo(prefix = '') { for (const k of [...memo.keys()]) if (k.startsWith(prefix)) memo.delete(k); }

export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 8000);
  const host = new URL(url).host;
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, headers: { accept: 'application/json', ...(init.headers || {}) } });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
    if (res.status === 429) throw new HttpError(503, `${host} is rate limiting us. Try again in a few seconds.`, 'upstream_busy');
    if (!res.ok) {
      const detail = (data && (data.error?.message || data.error || data.message)) || '';
      const e = new HttpError(502, `${host} answered ${res.status}${detail && typeof detail === 'string' ? `: ${detail.slice(0, 160)}` : ''}`, 'upstream');
      (e as any).upstreamStatus = res.status;
      (e as any).upstreamBody = data;
      throw e;
    }
    return data;
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, `${host} did not respond in time.`, 'upstream_timeout');
  } finally { clearTimeout(t); }
}
