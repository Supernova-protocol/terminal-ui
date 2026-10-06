/* Supernova admin (admin.html): setup checklist, create/edit the LaunchLab platform config owned by your wallet,
   and claim platform fees. Every on-chain action is built in the browser and signed by the connected wallet. */
import './polyfills';
import './styles/site.css';
import './styles/tailwind.css';
import './styles/admin.css';
import '@fortawesome/fontawesome-free/js/solid.js';
import '@fortawesome/fontawesome-free/js/fontawesome.js';
import { api, config, type PublicConfig } from './live/api';
import { wallet, type WalletInfo } from './live/wallet';
import { explorer } from './live/chain';

type LL = typeof import('./live/launchlab');
type PlatformInfo = NonNullable<Awaited<ReturnType<LL['platformInfo']>>>;
type CpmmConfig = { id: string; index: number; tradeFeeRate: number };

const ll = (): Promise<LL> => import('./live/launchlab');
const $ = <T extends HTMLElement = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector(s) as T | null;
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const short = (a: string) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
const pct = (ppm: number) => `${(ppm / 10000).toLocaleString('en-US', { maximumFractionDigits: 4 })}%`;
const sol = (v: number) => `${v.toLocaleString('en-US', { maximumFractionDigits: v < 1 ? 6 : 4 })} SOL`;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const isPubkey = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const isUrlOrEmpty = (s: string) => !s || /^https:\/\/[^\s]+$/i.test(s);
const errMsg = (e: any) => {
  const m = String((e && e.message) || e || 'Something went wrong.');
  return /reject|denied|cancel|declin/i.test(m) ? 'You declined the request in your wallet.' : m;
};

const state = {
  cfg: null as PublicConfig | null,
  address: null as string | null,
  ownId: null as string | null,
  own: undefined as PlatformInfo | null | undefined, // undefined = loading, null = not created
  active: undefined as PlatformInfo | null | undefined,
  cpmm: [] as CpmmConfig[],
  busy: false,
  editing: false,
};

/* ---------- toast ---------- */
let toastTimer = 0;
function toast(html: string, kind: 'ok' | 'err' | '' = '', ms = 6500) {
  const t = $('#adm-toast')!;
  t.className = `adm-toast ${kind}`;
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t.hidden = true; }, ms);
}
const txLink = (sig: string) => `<a href="${esc(explorer('tx', sig, state.cfg!.cluster))}" target="_blank" rel="noopener">View on Solscan</a>`;

/* ---------- setup checklist ---------- */
function renderSetup() {
  const c = state.cfg!;
  const s = c.setup || { auth: false, customRpc: false, siteUrl: false, stripeWebhook: false, admins: false };
  const items: { ok: boolean; need: boolean; t: string; d: string; env: string }[] = [
    { ok: s.auth, need: true, t: 'Wallet sign-in', d: 'A random secret of 32+ characters. The AI analyst and Pro need signed-in wallets.', env: 'JWT_SECRET' },
    { ok: c.features.persistent, need: true, t: 'Database', d: 'Upstash Redis (Vercel → Storage). Without it launches, sessions and Pro reset on every cold start.', env: 'UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN' },
    { ok: s.customRpc, need: true, t: 'Solana RPC', d: 'A private RPC such as Helius. The public endpoint is rate limited and not meant for production traffic.', env: 'RPC_URL' },
    { ok: c.features.ipfs, need: true, t: 'Coin images and metadata (IPFS)', d: 'Pinata JWT. Every launch stores its image and metadata there.', env: 'PINATA_JWT' },
    { ok: c.platformConfigured, need: true, t: 'Your LaunchLab platform', d: "Create it on this page, then set its address so platform fees go to you instead of Raydium's default platform.", env: 'PLATFORM_ID' },
    { ok: c.features.ai, need: true, t: 'AI analyst and AI coin creator', d: 'Anthropic API key.', env: 'ANTHROPIC_API_KEY' },
    { ok: c.features.images, need: false, t: 'Photo search for the AI creator', d: 'Pexels API key (free).', env: 'PEXELS_API_KEY' },
    { ok: c.features.stripe, need: false, t: 'Pro with card and Apple Pay', d: 'Stripe secret key and the price ID of the monthly Pro subscription.', env: 'STRIPE_SECRET_KEY, STRIPE_PRICE_ID_PRO' },
    ...(c.features.stripe ? [{ ok: s.stripeWebhook, need: true, t: 'Stripe webhook', d: 'Keeps Pro in sync with renewals and cancellations. Endpoint: /api/pro/webhook.', env: 'STRIPE_WEBHOOK_SECRET' }] : []),
    { ok: c.features.solPay, need: false, t: 'Pro paid in SOL', d: 'The wallet that receives SOL payments.', env: 'TREASURY_WALLET' },
    { ok: c.features.moonpay, need: false, t: 'Buy SOL with Apple Pay (MoonPay)', d: 'MoonPay publishable and secret keys.', env: 'MOONPAY_PUBLISHABLE_KEY, MOONPAY_SECRET_KEY' },
    { ok: s.siteUrl, need: false, t: 'Public site URL', d: 'Used in sign-in messages and payment redirects.', env: 'PUBLIC_SITE_URL' },
    { ok: s.admins, need: false, t: 'Admin wallets', d: 'Comma-separated wallets that always have Pro.', env: 'ADMIN_WALLETS' },
    { ok: c.cluster === 'mainnet', need: false, t: c.cluster === 'mainnet' ? 'Live on mainnet' : 'Running on devnet', d: c.cluster === 'mainnet' ? 'Real SOL and real coins.' : 'Test SOL only. Switch when everything above is green and you have tested every flow.', env: 'SOLANA_CLUSTER=mainnet' },
  ];
  const req = items.filter((i) => i.need), done = req.filter((i) => i.ok).length;
  $('#setup-score')!.textContent = `${done} of ${req.length} required`;
  $('#setup-list')!.innerHTML = items.map((i) => {
    const cls = i.ok ? 'ok' : i.need ? 'miss' : 'opt';
    const ic = i.ok ? 'fa-circle-check' : i.need ? 'fa-circle-xmark' : 'fa-circle-minus';
    return `<li class="${cls}"><span class="ic"><i class="fa-solid ${ic}"></i></span><div><div class="t">${esc(i.t)}${!i.need && !i.ok ? ' <span class="muted">· optional</span>' : ''}</div><div class="d">${esc(i.d)}${i.ok ? '' : ` Set <code>${esc(i.env)}</code>.`}</div></div></li>`;
  }).join('');
}

/* ---------- wallet ---------- */
function renderWalletBtn() {
  const b = $('#adm-wallet-btn')!;
  b.innerHTML = state.address
    ? `<i class="fa-solid fa-circle-check"></i><span class="mono">${esc(short(state.address))}</span>`
    : '<i class="fa-solid fa-wallet"></i><span>Connect wallet</span>';
  b.title = state.address ? 'Disconnect' : '';
}
function openWallets() {
  const list: WalletInfo[] = wallet.list();
  const mobile = wallet.isMobile();
  const ic = (w: WalletInfo) => (w.icon
    ? `<span class="wallet-ic" style="background:transparent"><img src="${esc(w.icon)}" alt="" style="width:100%;height:100%;border-radius:inherit"></span>`
    : `<span class="wallet-ic" style="background:${esc(w.color || 'linear-gradient(135deg,#4A5068,#161A27)')}">${esc(w.name.charAt(0))}</span>`);
  $('#aw-body')!.innerHTML = list.map((w) => (w.installed
    ? `<button class="wallet-opt" data-wallet="${esc(w.id)}">${ic(w)}<span class="min-w-0"><span class="wn block">${esc(w.name)}</span><span class="wd block">Detected in this browser</span></span><i class="fa-solid fa-chevron-right ml-auto text-ink-3"></i></button>`
    : `<a class="wallet-opt" href="${esc(w.url || '#')}" ${mobile ? '' : 'target="_blank" rel="noopener"'}>${ic(w)}<span class="min-w-0"><span class="wn block">${esc(w.name)}</span><span class="wd block">${mobile ? `Open this page in ${esc(w.name)}` : 'Not installed: get the extension'}</span></span><i class="fa-solid fa-arrow-up-right-from-square ml-auto text-ink-3"></i></a>`)).join('')
    + '<div class="muted mt-1">Use the wallet that owns (or will own) the platform. Supernova only sees its public address.</div>';
  $('#adm-wallets')!.classList.add('open');
}
const closeWallets = () => $('#adm-wallets')!.classList.remove('open');

async function onWallet(address: string | null) {
  if (address === state.address) return;
  state.address = address;
  state.ownId = null;
  state.own = undefined;
  state.editing = false;
  renderWalletBtn();
  if (!state.cfg) return; // boot renders and loads once the config is in
  renderPlatform();
  renderFees();
  if (address) await loadPlatforms();
}

/* ---------- data ---------- */
async function loadPlatforms() {
  const m = await ll();
  const c = state.cfg!;
  const [active, ownId] = await Promise.all([
    m.platformInfo(c.platformId).catch(() => null),
    state.address ? m.platformIdFor(state.address) : Promise.resolve(null),
  ]);
  state.active = active;
  if (ownId && ownId === state.ownId && state.own !== undefined && ownId !== c.platformId) { /* keep */ }
  state.ownId = ownId;
  state.own = ownId ? (ownId === c.platformId ? active : await m.platformInfo(ownId).catch(() => null)) : undefined;
  renderPlatform();
  renderFees();
}

async function loadCpmm() {
  try {
    const r = await api.get<{ data: any[] }>('launchlab/cpmm-configs');
    state.cpmm = (r.data || [])
      .map((x) => ({ id: String(x.id), index: Number(x.index), tradeFeeRate: Number(x.tradeFeeRate) }))
      .filter((x) => isPubkey(x.id) && Number.isFinite(x.tradeFeeRate))
      .sort((a, b) => a.tradeFeeRate - b.tradeFeeRate || a.index - b.index);
  } catch { state.cpmm = []; }
}

/* ---------- platform panel ---------- */
function platformKv(p: PlatformInfo) {
  const tier = state.cpmm.find((x) => x.id === p.cpConfigId);
  const cells: [string, string][] = [
    ['Name', p.name || '—'],
    ['Platform fee', pct(p.feeRate)],
    ['Creator fee', pct(p.creatorFeeRate)],
    ['Fee wallet', short(p.claimFeeWallet)],
    ['LP split · you / creator / burned', `${pct(p.scales.platform)} / ${pct(p.scales.creator)} / ${pct(p.scales.burn)}`],
    ['Raydium pool fee', tier ? pct(tier.tradeFeeRate) : short(p.cpConfigId)],
    ['Unclaimed fees', sol(p.vaultSol)],
    ['Website', p.web || '—'],
  ];
  return `<div class="adm-kv">${cells.map(([k, v]) => `<div><span>${esc(k)}</span><b title="${esc(v)}">${esc(v)}</b></div>`).join('')}</div>`;
}

function copyRow(label: string, value: string) {
  return `<div class="adm-copy"><span class="muted" style="flex:none">${esc(label)}</span><code class="adm-code">${esc(value)}</code><button class="icon-btn sm" data-copy="${esc(value)}" aria-label="Copy"><i class="fa-solid fa-copy"></i></button></div>`;
}

function renderPlatform() {
  const c = state.cfg!;
  $('#plat-cluster')!.textContent = `${c.cluster} · program ${short(c.launchProgram)}`;
  const body = $('#plat-body')!;
  const activeNote = c.platformConfigured
    ? `<div class="adm-note ok">Supernova launches use platform <b class="mono">${esc(short(c.platformId))}</b> (from <code class="adm-code">PLATFORM_ID</code>).</div>`
    : state.own
      ? '' // created but not switched on yet: the "Last step" note below says what to do
      : `<div class="adm-note warn"><b>No platform of your own yet.</b> Launches currently use Raydium's default LaunchLab platform, so its platform fee goes to Raydium. Create yours below and set <code class="adm-code">PLATFORM_ID</code>.</div>`;
  if (!state.address) {
    body.innerHTML = `${activeNote}<p class="muted m-0">Connect the wallet that will own the platform. Its address is derived from that wallet, one platform per wallet.</p><div><button class="btn btn-primary" data-connect><i class="fa-solid fa-wallet"></i>Connect wallet</button></div>`;
    return;
  }
  if (state.own === undefined) { body.innerHTML = `${activeNote}<div class="muted"><span class="spin-sm" style="display:inline-block;vertical-align:-2px"></span> Reading your platform from the chain…</div>`; return; }
  if (state.own === null) { body.innerHTML = activeNote + createForm(); bindCreateForm(); return; }
  const p = state.own;
  const live = p.id === c.platformId;
  body.innerHTML = activeNote
    + `<div class="flex items-center gap-2 flex-wrap"><span class="badge badge-grad"><i class="fa-solid fa-check"></i>Created</span>${live ? '<span class="badge badge-new">Active on this site</span>' : '<span class="badge badge-curve">Not active yet</span>'}</div>`
    + platformKv(p)
    + copyRow('Platform address', p.id)
    + (live ? '' : `<div class="adm-note warn"><b>Last step:</b> in Vercel → Project → Settings → Environment Variables set <code class="adm-code">PLATFORM_ID=${esc(p.id)}</code>, then redeploy. New launches will use your platform and its fees go to <span class="mono">${esc(short(p.claimFeeWallet))}</span>.</div>`)
    + (state.editing ? editForm(p) : `<div class="flex gap-2 flex-wrap"><button class="btn btn-ghost btn-sm" data-edit><i class="fa-solid fa-pen"></i>Edit fee, wallet or details</button><a class="btn btn-ghost btn-sm" href="${esc(explorer('address', p.id, c.cluster))}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i>Solscan</a></div>`);
  if (state.editing) bindEditForm(p);
}

function tierOptions(selected?: string) {
  if (!state.cpmm.length) return '<option value="">Raydium fee tiers are unavailable right now</option>';
  const pick = selected || state.cpmm[0].id;
  return state.cpmm.map((t) => `<option value="${esc(t.id)}" ${t.id === pick ? 'selected' : ''}>${pct(t.tradeFeeRate)} pool fee (tier ${t.index})</option>`).join('');
}

function createForm() {
  const addr = state.address!;
  return `<form class="adm-form" id="create-form" novalidate>
    <div class="adm-note">Creating the platform costs about 0.008 SOL of rent and one signature. Coins launched through Supernova then pay the platform fee to your fee wallet on every bonding-curve trade, and the creator fee to each coin's creator.</div>
    <div class="adm-row">
      <div><label class="label" for="pf-name">Platform name</label><input class="field" id="pf-name" maxlength="64" value="Supernova" required><div class="hint">Shown by explorers and Raydium. Up to 64 bytes.</div></div>
      <div><label class="label" for="pf-web">Website</label><input class="field" id="pf-web" maxlength="256" value="${esc(location.origin.startsWith('https://') ? location.origin : '')}" placeholder="https://supernova.example"></div>
    </div>
    <div><label class="label" for="pf-img">Logo URL</label><input class="field" id="pf-img" maxlength="256" placeholder="https://…/logo.png"><div class="hint">Optional, https only.</div></div>
    <div class="adm-row">
      <div><label class="label" for="pf-fee">Platform fee per trade (%)</label><input class="field mono" id="pf-fee" type="number" inputmode="decimal" min="0" max="5" step="0.01" value="0.5"></div>
      <div><label class="label" for="pf-cfee">Creator fee per trade (%)</label><input class="field mono" id="pf-cfee" type="number" inputmode="decimal" min="0" max="5" step="0.01" value="0.25"></div>
    </div>
    <div class="adm-sum" id="pf-total"></div>
    <fieldset class="grid gap-2" style="border:0;padding:0;margin:0">
      <legend class="label">LP tokens when a coin graduates (must add up to 100%)</legend>
      <div class="adm-row">
        <div><label class="label" for="pf-sp">You (%)</label><input class="field mono" id="pf-sp" type="number" min="0" max="100" step="1" value="10"></div>
        <div><label class="label" for="pf-sc">Creator (%)</label><input class="field mono" id="pf-sc" type="number" min="0" max="100" step="1" value="10"></div>
        <div><label class="label" for="pf-sb">Burned (%)</label><input class="field mono" id="pf-sb" type="number" min="0" max="100" step="1" value="80"></div>
      </div>
      <div class="adm-sum" id="pf-scale-sum"></div>
      <div class="hint" style="margin-top:0">Shares for you and the creator are locked Raydium LP positions: the liquidity cannot be pulled, the holder earns that share of the pool's trading fees.</div>
    </fieldset>
    <div class="adm-row">
      <div><label class="label" for="pf-tier">Raydium pool fee after graduation</label><select class="field" id="pf-tier">${tierOptions()}</select></div>
      <div><label class="label" for="pf-wallet">Fee wallet</label><input class="field mono" id="pf-wallet" value="${esc(addr)}" spellcheck="false"><div class="hint">Receives the platform fees. Defaults to this wallet.</div></div>
    </div>
    <div class="hint err" id="pf-err" hidden></div>
    <div><button class="btn btn-primary btn-lg" id="pf-submit" type="submit"><i class="fa-solid fa-building-columns"></i>Create platform</button></div>
  </form>`;
}

function readCreate() {
  const v = (id: string) => ($(`#${id}`) as HTMLInputElement).value.trim();
  const num = (id: string) => Number(v(id).replace(',', '.'));
  const fee = num('pf-fee'), cfee = num('pf-cfee');
  const sp = num('pf-sp'), sc = num('pf-sc'), sb = num('pf-sb');
  const o = { name: v('pf-name'), web: v('pf-web'), img: v('pf-img'), fee, cfee, sp, sc, sb, tier: v('pf-tier'), wallet: v('pf-wallet') };
  let err = '';
  if (!o.name || bytes(o.name) > 64) err = 'The platform name needs 1 to 64 bytes.';
  else if (!isUrlOrEmpty(o.web) || bytes(o.web) > 256) err = 'The website must be an https:// link (256 bytes max).';
  else if (!isUrlOrEmpty(o.img) || bytes(o.img) > 256) err = 'The logo must be an https:// link (256 bytes max).';
  else if (!(fee >= 0 && fee <= 5)) err = 'The platform fee must be between 0% and 5%.';
  else if (!(cfee >= 0 && cfee <= 5)) err = 'The creator fee must be between 0% and 5%.';
  else if (![sp, sc, sb].every((x) => Number.isInteger(x) && x >= 0 && x <= 100) || sp + sc + sb !== 100) err = 'The LP shares must be whole percentages that add up to 100%.';
  else if (!isPubkey(o.tier)) err = 'Pick a Raydium pool fee tier.';
  else if (!isPubkey(o.wallet)) err = 'The fee wallet is not a valid Solana address.';
  return { o, err };
}

function bindCreateForm() {
  const f = $('#create-form') as HTMLFormElement;
  const upd = () => {
    const { o } = readCreate();
    const proto = 0.25; // LaunchLab protocol fee (config trade fee rate)
    const total = proto + (o.fee || 0) + (o.cfee || 0);
    $('#pf-total')!.innerHTML = `Traders pay about <b class="mono">${total.toFixed(2)}%</b> per curve trade: ${proto}% LaunchLab protocol + ${o.fee || 0}% you + ${o.cfee || 0}% creator.${total > 1.5 ? ' <span class="up" style="color:rgb(var(--neon-amber))">High fees push traders to other launchpads.</span>' : ''}`;
    const sum = (o.sp || 0) + (o.sc || 0) + (o.sb || 0);
    const s = $('#pf-scale-sum')!;
    s.textContent = `Total ${sum}%`;
    s.classList.toggle('bad', sum !== 100);
  };
  f.addEventListener('input', upd);
  upd();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const { o, err } = readCreate();
    const el = $('#pf-err')!;
    el.hidden = !err;
    el.textContent = err;
    if (err) return;
    const btn = $('#pf-submit') as HTMLButtonElement;
    state.busy = true;
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>Approve in your wallet';
    try {
      const m = await ll();
      const r = await m.createPlatform({
        name: o.name, web: o.web, img: o.img,
        feeRate: Math.round(o.fee * 10000), creatorFeeRate: Math.round(o.cfee * 10000), cpConfigId: o.tier,
        platformScale: o.sp * 10000, creatorScale: o.sc * 10000, burnScale: o.sb * 10000, claimWallet: o.wallet,
      });
      toast(`<b>Platform created.</b> Set PLATFORM_ID in Vercel to switch it on. ${txLink(r.signature)}`, 'ok', 12000);
      await loadPlatforms();
    } catch (e2) {
      el.hidden = false;
      el.textContent = errMsg(e2);
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-building-columns"></i>Create platform';
    } finally { state.busy = false; }
  });
}

function editForm(p: PlatformInfo) {
  return `<form class="adm-form" id="edit-form" novalidate>
    <div class="adm-row">
      <div><label class="label" for="pe-fee">Platform fee per trade (%)</label><input class="field mono" id="pe-fee" type="number" inputmode="decimal" min="0" max="5" step="0.01" value="${p.feeRate / 10000}"></div>
      <div><label class="label" for="pe-wallet">Fee wallet</label><input class="field mono" id="pe-wallet" value="${esc(p.claimFeeWallet)}" spellcheck="false"></div>
    </div>
    <div class="adm-row">
      <div><label class="label" for="pe-name">Name</label><input class="field" id="pe-name" maxlength="64" value="${esc(p.name)}"></div>
      <div><label class="label" for="pe-web">Website</label><input class="field" id="pe-web" maxlength="256" value="${esc(p.web)}"></div>
    </div>
    <div><label class="label" for="pe-img">Logo URL</label><input class="field" id="pe-img" maxlength="256" value="${esc(p.img)}"></div>
    <div class="hint" style="margin-top:0">The creator fee and LP split are fixed when the platform is created. Each changed field is one small transaction; your wallet asks once for all of them.</div>
    <div class="hint err" id="pe-err" hidden></div>
    <div class="flex gap-2 flex-wrap"><button class="btn btn-primary" id="pe-submit" type="submit"><i class="fa-solid fa-floppy-disk"></i>Save changes</button><button class="btn btn-ghost" type="button" data-edit-cancel>Cancel</button></div>
  </form>`;
}

function bindEditForm(p: PlatformInfo) {
  const f = $('#edit-form') as HTMLFormElement;
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const v = (id: string) => ($(`#${id}`) as HTMLInputElement).value.trim();
    const fee = Number(v('pe-fee').replace(',', '.'));
    const w = v('pe-wallet'), name = v('pe-name'), web = v('pe-web'), img = v('pe-img');
    let err = '';
    if (!(fee >= 0 && fee <= 5)) err = 'The platform fee must be between 0% and 5%.';
    else if (!isPubkey(w)) err = 'The fee wallet is not a valid Solana address.';
    else if (!name || bytes(name) > 64) err = 'The name needs 1 to 64 bytes.';
    else if (!isUrlOrEmpty(web) || bytes(web) > 256 || !isUrlOrEmpty(img) || bytes(img) > 256) err = 'Links must start with https:// (256 bytes max).';
    const el = $('#pe-err')!;
    el.hidden = !err; el.textContent = err;
    if (err) return;
    const m = await ll();
    const ups: import('./live/launchlab').PlatformUpdate[] = [];
    if (Math.round(fee * 10000) !== p.feeRate) ups.push({ type: 'updateFeeRate', value: Math.round(fee * 10000) });
    if (w !== p.claimFeeWallet) ups.push({ type: 'updateClaimFeeWallet', value: w });
    if (name !== p.name) ups.push({ type: 'updateName', value: name });
    if (web !== p.web) ups.push({ type: 'updateWeb', value: web });
    if (img !== p.img) ups.push({ type: 'updateImg', value: img });
    if (!ups.length) { state.editing = false; renderPlatform(); return; }
    const btn = $('#pe-submit') as HTMLButtonElement;
    state.busy = true; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Approve in your wallet';
    try {
      const sigs = await m.updatePlatform(ups);
      state.editing = false;
      toast(`<b>Platform updated</b> (${sigs.length} change${sigs.length > 1 ? 's' : ''}). ${txLink(sigs[sigs.length - 1])}`, 'ok');
      await loadPlatforms();
    } catch (e2) {
      el.hidden = false; el.textContent = errMsg(e2);
      btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>Save changes';
    } finally { state.busy = false; }
  });
}

/* ---------- fees panel ---------- */
function renderFees() {
  const c = state.cfg!;
  const body = $('#fees-body')!;
  const rows: { label: string; p: PlatformInfo }[] = [];
  if (state.active) rows.push({ label: c.platformConfigured ? 'Active platform' : "Raydium's default platform", p: state.active });
  if (state.own && state.own.id !== state.active?.id) rows.push({ label: 'Your platform', p: state.own });
  if (state.active === undefined) { body.innerHTML = '<div class="muted">Reading fee vaults…</div>'; return; }
  if (!rows.length) {
    body.innerHTML = c.platformConfigured
      ? `<div class="adm-note warn"><b>PLATFORM_ID points to a platform that does not exist on ${esc(c.cluster)}.</b> Create it above with the wallet that owns it, or fix the variable. Launches fail until it exists.</div>`
      : '<div class="muted">No platform found on this network.</div>';
    return;
  }
  body.innerHTML = rows.map(({ label, p }) => {
    const mine = !!state.address && state.address === p.claimFeeWallet;
    const action = mine
      ? `<button class="btn btn-primary btn-sm" data-claim="${esc(p.id)}" ${p.vaultSol > 0 ? '' : 'disabled'}><i class="fa-solid fa-hand-holding-dollar"></i>Claim ${p.vaultSol > 0 ? esc(sol(p.vaultSol)) : ''}</button>`
      : `<span class="muted">Claimable by ${esc(short(p.claimFeeWallet))}${state.address ? '' : ' · connect it to claim'}</span>`;
    return `<div class="grid gap-2" style="padding-bottom:12px;border-bottom:1px solid var(--hairline)">
      <div class="flex items-center justify-between gap-2 flex-wrap"><b>${esc(label)}</b><span class="mono muted">${esc(short(p.id))}</span></div>
      <div class="adm-kv"><div><span>Unclaimed</span><b>${esc(sol(p.vaultSol))}</b></div><div><span>Platform fee</span><b>${esc(pct(p.feeRate))}</b></div><div><span>Fee wallet</span><b>${esc(short(p.claimFeeWallet))}</b></div></div>
      <div>${action}</div>
    </div>`;
  }).join('') + '<div class="hint" style="margin-top:0">Fees build up in a LaunchLab vault and arrive as SOL when you claim. Creators claim their own creator fees from their profile.</div>';
}

async function claim(id: string, btn: HTMLButtonElement) {
  if (state.busy) return;
  state.busy = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>Approve in your wallet';
  try {
    const m = await ll();
    const sig = await m.claimPlatformFees(id);
    toast(`<b>Fees claimed.</b> The SOL is in your wallet. ${txLink(sig)}`, 'ok');
    await loadPlatforms();
  } catch (e) {
    toast(esc(errMsg(e)), 'err');
    renderFees();
  } finally { state.busy = false; }
}

/* ---------- boot ---------- */
function bindEvents() {
  document.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const w = t.closest<HTMLElement>('[data-wallet]');
    if (w) {
      $('#aw-body')!.innerHTML = '<div class="connecting"><div class="conn-orb"></div><div class="font-bold">Approve the connection in your wallet</div></div>';
      try { await wallet.connect(w.dataset.wallet!); closeWallets(); } catch (err) { toast(esc(errMsg(err)), 'err'); openWallets(); }
      return;
    }
    if (t.closest('[data-aw-close]') || t.id === 'adm-wallets') { closeWallets(); return; }
    if (t.closest('#adm-wallet-btn')) { if (state.address) { await wallet.disconnect(); } else openWallets(); return; }
    if (t.closest('[data-connect]')) { openWallets(); return; }
    if (!state.cfg) return;
    if (t.closest('[data-edit]')) { state.editing = true; renderPlatform(); return; }
    if (t.closest('[data-edit-cancel]')) { state.editing = false; renderPlatform(); return; }
    const cp = t.closest<HTMLElement>('[data-copy]');
    if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy || ''); toast('Copied.', 'ok', 1800); } catch { toast('Copy failed: select the text instead.', 'err', 3000); } return; }
    const cl = t.closest<HTMLButtonElement>('[data-claim]');
    if (cl) { claim(cl.dataset.claim!, cl); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWallets(); });
}

async function boot() {
  bindEvents(); // before any await, so early clicks are never lost
  renderWalletBtn();
  wallet.subscribe((st) => { onWallet(st.address).catch(() => {}); });
  try {
    state.cfg = await config();
  } catch (e) {
    $('#setup-list')!.innerHTML = `<li class="miss"><span class="ic"><i class="fa-solid fa-circle-xmark"></i></span><div><div class="t">The API is not reachable</div><div class="d">${esc(errMsg(e))}</div></div></li>`;
    $('#plat-body')!.innerHTML = '<div class="muted">Unavailable.</div>';
    return;
  }
  const c = state.cfg;
  $('#adm-net')!.innerHTML = `<span class="live-dot"></span>Solana ${esc(c.cluster)}`;
  renderSetup();
  renderWalletBtn();
  renderPlatform();
  renderFees();
  wallet.restore().catch(() => {});
  await loadCpmm();
  loadPlatforms().catch(() => { state.active = null; renderFees(); });
}

boot();
