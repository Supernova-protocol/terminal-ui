/* Dev only: serve /api/* from the same Vite dev server, using the exact production router. */
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

/* Offline simulator settings (npm run dev:mock): must be in place before any server module reads its config. */
const MOCK_ENV: Record<string, string> = {
  SOLANA_CLUSTER: 'devnet', RPC_URL: 'https://mock-rpc.local', ANTHROPIC_API_KEY: 'mock', PINATA_JWT: 'mock', PEXELS_API_KEY: 'mock',
  TREASURY_WALLET: 'J2xccRtuG43drESLYznHhLhQkLTdfepcKYbiQ9BsJVaf', PRO_SOL_PRICE: '0.1',
};

export function apiDevPlugin(): Plugin {
  if (process.env.MOCK === '1') Object.assign(process.env, MOCK_ENV);
  // A separate, plain SSR server: the browser polyfills (crypto-browserify etc.) must not leak into Node code.
  let server: ViteDevServer | null = null;
  let mocked = false;
  const ssr = async () => {
    if (!server) server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'warn', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
    return server;
  };
  return {
    name: 'supernova-api-dev',
    apply: 'serve',
    configureServer(s) {
      s.httpServer?.once('close', () => { server?.close(); });
      s.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        try {
          if (process.env.MOCK === '1' && !mocked) { mocked = true; const m = await (await ssr()).ssrLoadModule('/scripts/mock/upstreams.ts'); await m.install(); }
          const mod = await (await ssr()).ssrLoadModule('/server/routes/index.ts');
          const host = req.headers.host || 'localhost:5173';
          const url = `http://${host}${req.url}`;
          const method = req.method || 'GET';
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (v == null) continue;
            if (Array.isArray(v)) v.forEach((x) => headers.append(k, x)); else headers.set(k, String(v));
          }
          headers.set('x-forwarded-for', req.socket.remoteAddress || '127.0.0.1');
          const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
          const request = new Request(url, { method, headers, body: body && body.length ? new Uint8Array(body) : undefined });
          const response: Response = await mod.dispatch(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
          const cookies = (response.headers as any).getSetCookie?.() || [];
          if (cookies.length) res.setHeader('set-cookie', cookies);
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (e: any) {
          server?.ssrFixStacktrace(e);
          console.error('[api-dev]', e);
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Dev API crashed: ' + (e?.message || e) }));
        }
      });
    },
  };
}
