/* Vercel Function entry: vercel.json rewrites /api/<path> → /api/router?__p=<path>.
   Web-standard handlers (Request → Response). Both forms are exported so the function works with
   Vercel's `export default { fetch }` support and with per-method exports. */
import { dispatch } from '../server/routes/index.js';

export const config = { maxDuration: 60 };

const handle = (request: Request) => dispatch(request);

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const OPTIONS = handle;

export default { fetch: handle };
