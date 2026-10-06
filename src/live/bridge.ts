/* window.SN: the single surface the page script (src/app.js) uses for anything real (wallet, chain, data, AI, payments). */
import { api, config, ApiError } from './api';
import * as chain from './chain';
import { wallet } from './wallet';
import { market, ai, media, pro, squareDataUrl, proxied } from './services';

// LaunchLab + Jupiter pull in the Raydium SDK: load them only when a wallet action needs them.
const launchlab = () => import('./launchlab');
const jupiter = () => import('./jupiter');

const SN = { api, config, ApiError, chain, wallet, market, ai, media, pro, squareDataUrl, proxied, launchlab, jupiter };
declare global { interface Window { SN: typeof SN } }
window.SN = SN;
export default SN;
