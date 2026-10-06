/* One Vercel function serves every /api/* route (keeps the Hobby plan's function count low and cold starts shared). */
import { HttpError } from './env.js';
import { clientIp, errorResponse, json, type Ctx, type Handler } from './http.js';
import { limit } from './ratelimit.js';

type Route = { method: string; parts: string[]; handler: Handler };
const routes: Route[] = [];

export function route(method: string, pattern: string, handler: Handler) {
  routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
}

function match(parts: string[], path: string[]) {
  if (parts.length !== path.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(path[i]);
    else if (parts[i] !== path[i]) return null;
  }
  return params;
}

export function apiPath(url: URL) {
  const p = url.searchParams.get('__p');
  if (p != null) return p.replace(/^\/+|\/+$/g, '');
  return url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
}

export async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = apiPath(url);
  const segs = path.split('/').filter(Boolean);
  const ip = clientIp(req);
  try {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, POST, OPTIONS' } });
    let methodMismatch = false;
    for (const r of routes) {
      const params = match(r.parts, segs);
      if (!params) continue;
      if (r.method !== req.method && !(r.method === 'GET' && req.method === 'HEAD')) { methodMismatch = true; continue; }
      if (path !== 'rpc' && path !== 'pro/webhook') await limit(`ip:${ip}`, 240, 60);
      const ctx: Ctx = { req, url, ip, path, params };
      return await r.handler(ctx);
    }
    if (methodMismatch) throw new HttpError(405, 'Method not allowed.', 'method');
    throw new HttpError(404, `No API route for /api/${path}.`, 'not_found');
  } catch (e) {
    return errorResponse(e);
  }
}

export { json };
