import { route } from '../lib/router.js';
import { ENV, HttpError, need } from '../lib/env.js';
import { json, cached, body, str, optStr, httpsUrl, fetchJson, memoize } from '../lib/http.js';
import { limit } from '../lib/ratelimit.js';
import { decodeDataUrl, pinImage, pinJson, sniffImage } from '../lib/ipfs.js';

const cleanText = (s: string) => s.replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim();

/* ---------- coin image → IPFS ---------- */
route('POST', 'upload/image', async ({ req, ip }) => {
  await limit(`upimg:${ip}`, 30, 3600, 'Upload limit reached. Try again later.');
  const b = await body(req, 2.2 * 1024 * 1024);
  const symbol = optStr(b.symbol, 'symbol', 12).replace(/[^A-Za-z0-9]/g, '');
  const { buf, kind } = decodeDataUrl(str(b.dataUrl, 'image', 2.1 * 1024 * 1024, 30));
  const r = await pinImage(buf, kind, symbol);
  return json({ cid: r.cid, url: r.url });
});

/* ---------- Metaplex metadata JSON → IPFS ---------- */
route('POST', 'upload/metadata', async ({ req, ip, url }) => {
  await limit(`upmeta:${ip}`, 30, 3600, 'Upload limit reached. Try again later.');
  const b = await body(req);
  const name = cleanText(str(b.name, 'Name', 32));
  const symbol = str(b.symbol, 'Ticker', 10).toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new HttpError(400, 'Ticker must be 2 to 10 letters or digits.');
  const description = cleanText(optStr(b.description, 'Description', 500));
  const image = httpsUrl(b.image, 'Image');
  if (!image) throw new HttpError(400, 'Upload an image first.');
  const twitter = httpsUrl(b.twitter, 'X link');
  const telegram = httpsUrl(b.telegram, 'Telegram link');
  const website = httpsUrl(b.website, 'Website');
  const site = ENV.siteUrl || url.origin;
  const meta: Record<string, unknown> = {
    name, symbol, description, image, showName: true, createdOn: site,
    ...(twitter ? { twitter } : {}), ...(telegram ? { telegram } : {}), ...(website ? { website } : {}),
    extensions: { ...(twitter ? { twitter } : {}), ...(telegram ? { telegram } : {}), ...(website ? { website } : {}) },
    properties: { files: [{ uri: image, type: 'image/png' }], category: 'image' },
  };
  const r = await pinJson(meta, `${symbol.toLowerCase()}-metadata.json`);
  if (r.url.length > 200) throw new HttpError(500, 'Metadata link is too long for on-chain storage. Use a shorter PINATA_GATEWAY.');
  return json({ uri: r.url, cid: r.cid });
});

/* ---------- photo search (Pexels) for the AI coin creator ---------- */
export async function searchPhotos(q: string, n = 8) {
  need('PEXELS_API_KEY');
  const query = cleanText(q).slice(0, 80);
  return memoize(`pexels:${query.toLowerCase()}:${n}`, 3600_000, async () => {
    const r = await fetchJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${n}&orientation=square&size=medium`, { headers: { authorization: ENV.pexelsKey }, timeoutMs: 7000 });
    const https = (v: unknown, host?: string) => {
      if (typeof v !== 'string') return '';
      try { const u = new URL(v); return u.protocol === 'https:' && (!host || u.host === host) ? u.toString() : ''; } catch { return ''; }
    };
    return (r?.photos || []).map((p: any) => ({
      id: p.id, alt: cleanText(String(p.alt || '')).slice(0, 120),
      thumb: https(p.src?.medium, 'images.pexels.com'), full: https(p.src?.large, 'images.pexels.com'), page: https(p.url),
      photographer: cleanText(String(p.photographer || '')).slice(0, 60), photographerUrl: https(p.photographer_url),
      color: /^#[0-9a-fA-F]{3,8}$/.test(String(p.avg_color || '')) ? p.avg_color : '#111111',
    })).filter((p: any) => p.full && p.thumb);
  });
}

route('GET', 'images/search', async ({ url, ip }) => {
  await limit(`imgsearch:${ip}`, 40, 60);
  const q = str(url.searchParams.get('q'), 'q', 80, 2);
  return cached({ photos: await searchPhotos(q) }, 3600);
});

/* Same-origin proxy so the browser can crop Pexels photos on a canvas (no tainted-canvas CORS issues). */
route('GET', 'images/proxy', async ({ url, ip }) => {
  await limit(`imgproxy:${ip}`, 60, 60);
  const raw = str(url.searchParams.get('u'), 'u', 400, 20);
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, 'Bad image link.'); }
  if (u.protocol !== 'https:' || u.host !== 'images.pexels.com') throw new HttpError(400, 'Only Pexels images can be proxied.');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(u, { signal: ctl.signal, redirect: 'error' });
    if (!res.ok) throw new HttpError(502, 'Photo could not be loaded.');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 6 * 1024 * 1024) throw new HttpError(413, 'Photo too large.');
    const kind = sniffImage(buf);
    if (!kind) throw new HttpError(502, 'Photo is not an image.');
    return new Response(buf, { status: 200, headers: { 'content-type': kind, 'cache-control': 'public, max-age=86400, s-maxage=86400', 'x-content-type-options': 'nosniff' } });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, 'Photo download timed out.');
  } finally { clearTimeout(t); }
});
