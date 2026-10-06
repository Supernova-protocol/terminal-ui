/* Tiny key-value layer: Upstash Redis in production, in-memory Map for local development and tests. */
import { Redis } from '@upstash/redis';
import { ENV } from './env.js';

export interface KV {
  get<T = unknown>(key: string): Promise<T | null>;
  mget<T = unknown>(keys: string[]): Promise<(T | null)[]>;
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Atomic add (default +1); a negative `by` refunds. The TTL is set when the key is created. */
  incr(key: string, ttlSec?: number, by?: number): Promise<number>;
  lpush(key: string, value: unknown, max?: number): Promise<void>;
  lrange<T = unknown>(key: string, start: number, stop: number): Promise<T[]>;
  setnx(key: string, value: unknown, ttlSec?: number): Promise<boolean>;
}

class UpstashKV implements KV {
  r: Redis;
  constructor() { this.r = new Redis({ url: ENV.upstashUrl, token: ENV.upstashToken }); }
  async get<T>(key: string) { return ((await this.r.get<T>(key)) ?? null) as T | null; }
  async mget<T>(keys: string[]) {
    if (!keys.length) return [];
    const out: (T | null)[] = [];
    for (let i = 0; i < keys.length; i += 100) out.push(...((await this.r.mget<(T | null)[]>(...keys.slice(i, i + 100))) as (T | null)[]));
    return out.map((v) => (v ?? null));
  }
  async set(key: string, value: unknown, ttlSec?: number) { if (ttlSec) await this.r.set(key, value, { ex: Math.max(1, Math.round(ttlSec)) }); else await this.r.set(key, value); }
  async del(key: string) { await this.r.del(key); }
  async incr(key: string, ttlSec?: number, by = 1) {
    const v = by === 1 ? await this.r.incr(key) : await this.r.incrby(key, by);
    if (ttlSec && by > 0 && v === by) await this.r.expire(key, Math.round(ttlSec));
    return v;
  }
  async lpush(key: string, value: unknown, max?: number) { await this.r.lpush(key, value); if (max) await this.r.ltrim(key, 0, max - 1); }
  async lrange<T>(key: string, start: number, stop: number) { return (await this.r.lrange<T>(key, start, stop)) as T[]; }
  async setnx(key: string, value: unknown, ttlSec?: number) {
    const ok = await this.r.set(key, value, ttlSec ? { nx: true, ex: Math.max(1, Math.round(ttlSec)) } : { nx: true });
    return ok === 'OK';
  }
}

class MemoryKV implements KV {
  m = new Map<string, { v: any; exp: number }>();
  private live(key: string) { const x = this.m.get(key); if (!x) return null; if (x.exp && Date.now() > x.exp) { this.m.delete(key); return null; } return x; }
  async get<T>(key: string) { const x = this.live(key); return x ? (structuredClone(x.v) as T) : null; }
  async mget<T>(keys: string[]) { return Promise.all(keys.map((k) => this.get<T>(k))); }
  async set(key: string, value: unknown, ttlSec?: number) { this.m.set(key, { v: structuredClone(value), exp: ttlSec ? Date.now() + ttlSec * 1000 : 0 }); }
  async del(key: string) { this.m.delete(key); }
  async incr(key: string, ttlSec?: number, by = 1) { const x = this.live(key); const v = (x ? Number(x.v) : 0) + by; this.m.set(key, { v, exp: x ? x.exp : ttlSec ? Date.now() + ttlSec * 1000 : 0 }); return v; }
  async lpush(key: string, value: unknown, max?: number) { const x = this.live(key); const arr = x ? x.v : []; arr.unshift(structuredClone(value)); if (max) arr.length = Math.min(arr.length, max); this.m.set(key, { v: arr, exp: 0 }); }
  async lrange<T>(key: string, start: number, stop: number) { const x = this.live(key); const arr = x ? x.v : []; return structuredClone(arr.slice(start, stop < 0 ? undefined : stop + 1)) as T[]; }
  async setnx(key: string, value: unknown, ttlSec?: number) { if (this.live(key)) return false; await this.set(key, value, ttlSec); return true; }
}

let inst: KV | null = null;
export function kv(): KV {
  if (inst) return inst;
  const g = globalThis as any;
  if (g.__supernovaKV) return (inst = g.__supernovaKV as KV); // one store per process, even if modules reload in dev
  if (ENV.upstashUrl && ENV.upstashToken) inst = new UpstashKV();
  else {
    if (ENV.isVercel) console.warn('[kv] Upstash Redis is not configured: using in-memory storage, which resets on every cold start. Add UPSTASH_REDIS_REST_URL/TOKEN before going live.');
    inst = new MemoryKV();
  }
  g.__supernovaKV = inst;
  return inst;
}
export const kvPersistent = () => !!(ENV.upstashUrl && ENV.upstashToken);
export function setKV(k: KV) { inst = k; (globalThis as any).__supernovaKV = k; }
export { MemoryKV };
