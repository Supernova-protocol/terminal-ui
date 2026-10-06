/* Thin JSON client for the Supernova API (same origin, cookie session). */
export class ApiError extends Error {
  status: number; code: string;
  constructor(message: string, status = 0, code = '') { super(message); this.status = status; this.code = code; }
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 30000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch('/api/' + path.replace(/^\/+/, ''), {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (e: any) {
    throw new ApiError(e?.name === 'AbortError' ? 'The server took too long to answer.' : 'Network error: check your connection.', 0, 'network');
  } finally { clearTimeout(t); }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status}).`, res.status, (data && data.code) || '');
  return data as T;
}

export const api = {
  get: <T = any>(path: string, timeoutMs?: number) => call<T>('GET', path, undefined, timeoutMs),
  post: <T = any>(path: string, body: unknown = {}, timeoutMs?: number) => call<T>('POST', path, body, timeoutMs),
};

export type PublicConfig = {
  cluster: 'mainnet' | 'devnet';
  launchProgram: string; platformId: string; platformConfigured: boolean; migrateType: 'amm' | 'cpmm';
  rpcUrl: string;
  features: { ai: boolean; images: boolean; ipfs: boolean; stripe: boolean; solPay: boolean; moonpay: boolean; jupiter: boolean; mev: boolean; persistent: boolean };
  pro: { solPrice: number; days: number; priceLabel: string; freeAnalysesPerDay: number };
  setup?: { auth: boolean; customRpc: boolean; siteUrl: boolean; stripeWebhook: boolean; admins: boolean };
  jitoTipAccounts: string[];
};

let cfgP: Promise<PublicConfig> | null = null;
export function config(): Promise<PublicConfig> {
  if (!cfgP) cfgP = api.get<PublicConfig>('config').catch((e) => { cfgP = null; throw e; });
  return cfgP;
}
