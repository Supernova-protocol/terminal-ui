import { defineConfig, loadEnv } from 'vite';
import { apiDevPlugin } from './scripts/vite-api-plugin.ts';

export default defineConfig(({ mode }) => {
  // Server-side secrets from .env / .env.local for the dev API (never exposed to the browser bundle).
  const env = loadEnv(mode, process.cwd(), '');
  for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = v;

  return {
    plugins: [apiDevPlugin()],
    resolve: { alias: { buffer: 'buffer/' } },
    define: { 'process.env.NODE_DEBUG': 'false' },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 6000,
      sourcemap: false,
      rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } },
    },
    server: { port: 5173 },
    ssr: { noExternal: [] },
  };
});
