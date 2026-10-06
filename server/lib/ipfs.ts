/* IPFS pinning through Pinata (coin images + Metaplex metadata JSON). */
import { ENV, HttpError, need } from './env.js';

const MAX_IMAGE = 1.5 * 1024 * 1024;

export function sniffImage(buf: Uint8Array): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf.length > 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}

export function decodeDataUrl(dataUrl: string) {
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) throw new HttpError(400, 'Image must be a PNG, JPEG, GIF or WebP.', 'bad_image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_IMAGE) throw new HttpError(413, 'Image is too large (max 1.5 MB).', 'too_large');
  const kind = sniffImage(buf);
  if (!kind) throw new HttpError(400, 'That file is not a valid image.', 'bad_image');
  return { buf, kind };
}

async function pin(blob: Blob, name: string) {
  need('PINATA_JWT');
  const form = new FormData();
  form.append('file', blob, name);
  form.append('network', 'public');
  form.append('name', name);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch('https://uploads.pinata.cloud/v3/files', { method: 'POST', headers: { authorization: `Bearer ${ENV.pinataJwt}` }, body: form, signal: ctl.signal });
    const data: any = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) throw new HttpError(503, 'IPFS upload is not authorised. Check PINATA_JWT.', 'pinata_auth');
    if (!res.ok || !data?.data?.cid) throw new HttpError(502, 'IPFS upload failed. Try again.', 'pinata');
    const cid = String(data.data.cid);
    return { cid, url: `${ENV.pinataGateway}/ipfs/${cid}` };
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(504, 'IPFS upload timed out. Try again.', 'pinata_timeout');
  } finally { clearTimeout(t); }
}

export async function pinImage(buf: Buffer, kind: string, symbol: string) {
  const ext = kind.split('/')[1].replace('jpeg', 'jpg');
  return pin(new Blob([new Uint8Array(buf)], { type: kind }), `${symbol.toLowerCase() || 'coin'}-${Date.now()}.${ext}`);
}

export async function pinJson(obj: unknown, name: string) {
  return pin(new Blob([JSON.stringify(obj)], { type: 'application/json' }), name);
}
