import { kv } from './kv.js';
import { HttpError } from './env.js';

/** Fixed-window limiter. Throws 429 when `key` exceeds `limitN` hits (or weight units) inside `windowSec`. */
export async function limit(key: string, limitN: number, windowSec: number, message = 'Too many requests. Slow down and try again shortly.', weight = 1) {
  const win = Math.floor(Date.now() / 1000 / windowSec);
  const n = await kv().incr(`rl:${key}:${win}`, windowSec + 5, Math.max(1, Math.floor(weight)));
  if (n > limitN) throw new HttpError(429, message, 'rate_limited');
  return limitN - n;
}

const dayKey = (key: string) => `q:${key}:${new Date().toISOString().slice(0, 10)}`;

/** Daily quota counter (UTC day). Returns the count after the increment (or the current count with `peek`); never throws. */
export async function dailyCount(key: string, peek = false) {
  const k = dayKey(key);
  if (peek) return Number((await kv().get<number>(k)) || 0);
  return kv().incr(k, 60 * 60 * 26);
}

/** Gives back one unit taken with dailyCount (a request that was refused or failed after reserving it). */
export async function refundDaily(key: string) {
  await kv().incr(dayKey(key), 60 * 60 * 26, -1);
}
