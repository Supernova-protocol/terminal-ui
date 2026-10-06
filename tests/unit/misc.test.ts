import { describe, it, expect, afterEach, vi } from 'vitest';
import { sniffImage, decodeDataUrl } from '../../server/lib/ipfs';
import { fetchJson, assertSameOrigin, pubkey, httpsUrl } from '../../server/lib/http';
import { limit, dailyCount, refundDaily } from '../../server/lib/ratelimit';
import { HttpError } from '../../server/lib/env';
import { rsi, technicals } from '../../server/lib/intel';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return e instanceof HttpError ? `${e.status}:${e.code}` : String(e); } };

describe('image uploads', () => {
  it('recognises real image bytes, not just the declared type', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from('ffd8ffe000104a464946', 'hex'))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
    expect(decodeDataUrl('data:image/png;base64,' + PNG.toString('base64')).kind).toBe('image/png');
    expect(code(() => decodeDataUrl('data:image/png;base64,' + Buffer.from('<script>x</script>').toString('base64')))).toBe('400:bad_image');
    expect(code(() => decodeDataUrl('data:image/svg+xml;base64,PHN2Zz4='))).toBe('400:bad_image');
    expect(code(() => decodeDataUrl('data:image/png;base64,' + Buffer.concat([PNG, Buffer.alloc(1.6 * 1024 * 1024)]).toString('base64')))).toBe('413:too_large');
  });
});

describe('input validation', () => {
  it('accepts Solana addresses and https links only', () => {
    expect(pubkey('So11111111111111111111111111111111111111112')).toBe('So11111111111111111111111111111111111111112');
    expect(code(() => pubkey('0xabc'))).toMatch(/^400/);
    expect(httpsUrl('https://x.com/supernova', 'x')).toBe('https://x.com/supernova');
    expect(code(() => httpsUrl('javascript:alert(1)', 'x'))).toMatch(/^400/);
    expect(code(() => httpsUrl('http://insecure.example', 'x'))).toMatch(/^400/);
  });

  it('blocks cross-site browser requests', () => {
    const r = (origin: string) => new Request('https://supernova.example/api/x', { method: 'POST', headers: { origin, host: 'supernova.example' } });
    expect(code(() => assertSameOrigin(r('https://supernova.example')))).toBe('ok');
    expect(code(() => assertSameOrigin(r('https://evil.example')))).toBe('403:bad_origin');
    expect(code(() => assertSameOrigin(r('null')))).toBe('403:bad_origin');
  });
});

describe('upstream calls', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('maps upstream failures to clear API errors', async () => {
    const at = async (status: number) => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"nope"}', { status })));
      try { await fetchJson('https://api.example.com/x'); return 'ok'; } catch (e: any) { return `${e.status}:${e.code}`; }
    };
    expect(await at(429)).toBe('503:upstream_busy');
    expect(await at(500)).toBe('502:upstream');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    await expect(fetchJson('https://api.example.com/x')).rejects.toMatchObject({ status: 504, code: 'upstream_timeout' });
  });
});

describe('rate limiting', () => {
  it('allows N hits per window, then answers 429', async () => {
    const key = 'unit:' + Math.random();
    for (let i = 0; i < 3; i++) await limit(key, 3, 60);
    await expect(limit(key, 3, 60)).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });

  it('counts weighted hits (an RPC batch counts every call in it)', async () => {
    const key = 'unit:w:' + Math.random();
    await limit(key, 10, 60, 'slow down', 6);
    await expect(limit(key, 10, 60, 'slow down', 5)).rejects.toMatchObject({ status: 429 });
  });

  it('reserves daily quota units and gives them back', async () => {
    const key = 'unit:q:' + Math.random();
    expect(await dailyCount(key)).toBe(1);
    expect(await dailyCount(key)).toBe(2);
    await refundDaily(key);
    expect(await dailyCount(key, true)).toBe(1);
  });
});

describe('technical indicators', () => {
  it('computes RSI at the extremes and levels from candles', () => {
    const up = Array.from({ length: 30 }, (_, i) => 1 + i * 0.1);
    expect(rsi(up)).toBeGreaterThan(95);
    const down = [...up].reverse();
    expect(rsi(down)).toBeLessThan(5);
    const candles = up.map((c, i) => ({ time: i * 60, open: c - 0.05, high: c + 0.05, low: c - 0.1, close: c, volume: 10 + i }));
    const t: any = technicals(candles);
    expect(t).toBeTruthy();
  });
});
