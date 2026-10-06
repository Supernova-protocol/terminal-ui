(() => {
/* =========================================================
   SUPERNOVA V2 — core utilities, state, storage, toasts
   ========================================================= */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const HOVER = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

const Ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
};

/** rAF tween: fn(easedT, rawT). Resolves when done. */
function tween(ms, fn, easing = Ease.outCubic) {
  return new Promise((res) => {
    if (ms <= 0) { fn(1, 1); return res(); }
    const t0 = performance.now();
    const step = (now) => {
      const t = clamp((now - t0) / ms, 0, 1);
      fn(easing(t), t);
      if (t < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

/* FNV-1a hash → seed, mulberry32 PRNG: deterministic per-token "random" traits */
function hashSeed(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seeded = (s) => mulberry32(hashSeed(String(s)));

const shortAddr = (a, n = 4) => (a ? a.slice(0, n) + '…' + a.slice(-n) : '');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- number formatting ---------- */
const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
/** DexScreener-style price: 0.0₄2148 for tiny memecoin prices. */
function fmtPrice(p) {
  if (p == null || !isFinite(p)) return '—';
  const a = Math.abs(p);
  if (a >= 1000) return a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 100) return a.toFixed(2);
  if (a >= 1) return a.toFixed(3);
  if (a >= 0.01) return a.toFixed(4);
  if (a >= 0.0001) return a.toFixed(6);
  if (a === 0) return '0';
  let z = Math.floor(-Math.log10(a));
  let sig = Math.round(a * Math.pow(10, z + 4));
  if (sig >= 10000) { z -= 1; sig = Math.round(a * Math.pow(10, z + 4)); }
  return '0.0' + String(z).split('').map((d) => SUB_DIGITS[+d]).join('') + String(sig).padStart(4, '0').slice(0, 4);
}
/** Plain decimal price for prompts/clipboard (no subscripts, no exponent). */
function fmtUSD(n, dp) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e12) return s + '$' + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e4) return s + '$' + (a / 1e3).toFixed(1) + 'K';
  if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(2) + 'K';
  return s + '$' + a.toFixed(dp ?? 2);
}
function fmtNum(n) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e12) return s + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K';
  return s + a.toFixed(a < 10 ? 2 : 0);
}
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
function fmtPct(n, dp = 2) {
  if (n == null || !isFinite(n)) return '—';
  const s = n > 0 ? '+' : n < 0 ? '−' : '';
  const a = Math.abs(n);
  return s + (a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toFixed(a >= 100 ? 0 : dp)) + '%';
}
function fmtSOL(n, dp) {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  const d = dp ?? (a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : 3);
  return (n < 0 ? '−' : '') + a.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
const signed = (n, f = fmtSOL) => (n > 0 ? '+' : '') + f(n);
const dirClass = (n) => (n > 0.00001 ? 'up' : n < -0.00001 ? 'down' : 'flat');
function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 4) return 'now';
  if (s < 60) return Math.floor(s) + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
const hms = (ts) => { const d = new Date(ts); return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':'); };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (ts) => { const d = new Date(ts); return MONTHS[d.getMonth()] + ' ' + d.getDate(); };

/* ---------- constants ---------- */
const C = { cyan: '#00F3FF', violet: '#A855F7', green: '#00FFA3', red: '#FF3B69', amber: '#FFBE5C', ink: '#E8EBF5', ink2: '#8E94AA', ink3: '#585D73' };
const SN = window.SN;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const STORE_KEY = 'supernova.v3.prefs';
const PRIO = { fast: { fee: 0.00005, label: 'Fast' }, turbo: { fee: 0.0005, label: 'Turbo' }, ultra: { fee: 0.002, label: 'Ultra' } };
const WHALE_SOL = 10;
const IV_TF = { 1: '1m', 5: '5m', 15: '15m', 60: '1h' };

/* ---------- the single source of truth ---------- */
const state = {
  phase: 'boot',
  view: 'hub',
  activeId: null,
  tokens: [],
  byId: new Map(),
  solPrice: 0,
  solOpen: 0,
  cfg: null,
  cluster: 'devnet',
  dataSource: 'loading',
  net: { tps: 0, slot: 0, rpc: 0, epoch: null, ok: false },
  global: { vol24h: 0, launches: 0, launches24h: 0, graduated: 0 },
  user: null,
  session: null,
  watch: new Set(),
  feed: [],
  feedFilter: 'all',
  feedPaused: false,
  feedMissed: 0,
  scan: { sort: 'vol', dir: -1, filter: 'all', q: '' },
  trade: { side: 'buy', slip: 1, mev: true, prio: 'turbo' },
  chart: { iv: 1, ema: true, vol: true },
  pending: null,
  pendingCancel: null,
};

const tokenById = (id) => state.byId.get(id) || null;
const activeToken = () => tokenById(state.activeId);
const isMainnet = () => state.cluster === 'mainnet';
const explorerTx = (sig) => SN.chain.explorer('tx', sig, state.cluster);
const explorerToken = (mint) => SN.chain.explorer('token', mint, state.cluster);
const explorerAddr = (a) => SN.chain.explorer('address', a, state.cluster);

/* ---------- persistence (per-viewer conveniences only: prefs, watchlist, profile look, local swap log) ---------- */
const Store = {
  load() { try { const raw = localStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } },
  save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serializeState())); }
    catch {
      try { const s = serializeState(); for (const p of Object.values(s.profiles || {})) delete p.customData; localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
    }
  },
};
const saveSoon = debounce(() => Store.save(), 700);
const PREFS = Store.load() || {};
PREFS.profiles = PREFS.profiles || {};
PREFS.swaps = PREFS.swaps || {};

function serializeState() {
  const u = state.user;
  if (u) {
    PREFS.profiles[u.address] = { avatar: u.avatar, handle: u.handle, customData: u.customData || null, joined: u.joined };
    PREFS.swaps[u.address] = (u.localTrades || []).slice(-200);
  }
  return {
    v: 3,
    watch: [...state.watch],
    trade: state.trade,
    chart: state.chart,
    activeId: state.activeId,
    profiles: PREFS.profiles,
    swaps: PREFS.swaps,
  };
}
/* ---------- clipboard (iframe-safe) ---------- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}

/* ---------- toast notifications ---------- */
const TOAST_ICON = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info', warn: 'fa-triangle-exclamation', ai: 'fa-wand-magic-sparkles' };
function toast({ type = 'info', title = '', msg = '', duration = 5200, action = null, icon = null } = {}) {
  const host = $('#toasts');
  if (!host) return null;
  const slot = document.createElement('div');
  slot.className = 'toast-slot';
  slot.innerHTML =
    `<div class="toast ${type}" role="${type === 'error' ? 'alert' : 'status'}">` +
    `<div class="t-ic"><i class="fa-solid ${icon || TOAST_ICON[type] || TOAST_ICON.info}"></i></div>` +
    `<div class="min-w-0"><div class="t-title">${esc(title)}</div>${msg ? `<div class="t-msg">${msg}</div>` : ''}` +
    `${action ? `<div class="t-act"><button class="btn btn-ghost btn-sm" data-act>${esc(action.label)}</button></div>` : ''}</div>` +
    `<button class="t-x" aria-label="Dismiss notification"><i class="fa-solid fa-xmark"></i></button><div class="t-bar"></div></div>`;
  host.appendChild(slot);
  const live = $$('.toast-slot:not(.closing)', host);
  if (live.length > 4) dismissToast(live[0]);
  const bar = slot.querySelector('.t-bar');
  let anim = null;
  if (bar.animate) {
    anim = bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration, easing: 'linear', fill: 'forwards' });
    anim.onfinish = () => dismissToast(slot);
    slot.addEventListener('pointerenter', () => anim.pause());
    slot.addEventListener('pointerleave', () => anim.play());
  } else setTimeout(() => dismissToast(slot), duration);
  slot.querySelector('.t-x').addEventListener('click', () => dismissToast(slot));
  if (action) slot.querySelector('[data-act]').addEventListener('click', () => { try { action.onClick(); } finally { dismissToast(slot); } });
  return slot;
}
function dismissToast(slot) {
  if (!slot || slot.classList.contains('closing')) return;
  slot.classList.add('closing');
  setTimeout(() => slot.remove(), 400);
}

/** Price/value flash without layout thrash (Web Animations API). */
function flash(el, dir) {
  if (!el || !el.animate || !dir || REDUCED) return;
  const now = performance.now();
  if (el._fl && now - el._fl < 1500) return; // at most one tick-flash per cell every 1.5s
  el._fl = now;
  const base = el._base || (el._base = getComputedStyle(el).color);
  const c = dir > 0 ? '0,255,163' : '255,59,105';
  el.animate([{ color: `rgb(${c})`, textShadow: `0 0 14px rgba(${c},.75)` }, { color: base, textShadow: `0 0 0 rgba(${c},0)` }], { duration: 900, easing: 'ease-out' });
}
function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }
function setDir(el, n) { if (!el) return; const c = dirClass(n); if (!el.classList.contains(c)) { el.classList.remove('up', 'down', 'flat'); el.classList.add(c); } }
function nudge(el) { if (el && el.animate) el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 360, easing: 'ease-out' }); }

/* Libraries load with `defer`; the intro starts before they finish. */
const libsReady = new Promise((res) => {
  const ok = () => !!(window.LightweightCharts && window.Chart);
  if (ok()) return res(true);
  window.addEventListener('load', () => res(ok()), { once: true });
  setTimeout(() => res(ok()), 15000);
});

/* =========================================================
   Brand mark: 4-pointed star with a living eye
   ========================================================= */
let EYE_UID = 0;
const eyePath = (k) => {
  const h = 30 * Math.max(0, k);
  const a = (100 - h).toFixed(2), b = (100 + h).toFixed(2);
  return `M58 100C78 ${a} 122 ${a} 142 100C122 ${b} 78 ${b} 58 100Z`;
};

function logoSVG({ frame = true, alert = true } = {}) {
  const u = 'nv' + ++EYE_UID;
  return `<svg class="nova-logo" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="${u}s" x1="20" y1="10" x2="180" y2="190" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00F3FF"/><stop offset=".55" stop-color="#72B9FF"/><stop offset="1" stop-color="#A855F7"/></linearGradient>
    <radialGradient id="${u}i" cx="100" cy="100" r="18" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#F2FEFF"/><stop offset=".36" stop-color="#00F3FF"/><stop offset="1" stop-color="#3A1475"/></radialGradient>
    <radialGradient id="${u}r" cx="100" cy="100" r="18" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFE9EE"/><stop offset=".4" stop-color="#FF3B69"/><stop offset="1" stop-color="#4A0716"/></radialGradient>
    <filter id="${u}g" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="${u}c"><path data-eye-clip d="${eyePath(0)}"/></clipPath>
  </defs>
  ${frame ? `<path class="nova-frame" d="M100 22L178 100L100 178L22 100Z" stroke="url(#${u}s)" stroke-width="1" stroke-dasharray="3 5"/>` : ''}
  <path class="nova-star" d="M100 4L123 77L196 100L123 123L100 196L77 123L4 100L77 77Z" fill="url(#${u}s)" fill-opacity=".07" stroke="url(#${u}s)" stroke-width="2.6" stroke-linejoin="round" filter="url(#${u}g)"/>
  <path d="M100 16V58M100 142V184M16 100H54M146 100H184" stroke="url(#${u}s)" stroke-width="1" opacity=".55"/>
  <path data-eye-lid d="${eyePath(0)}" fill="#020205" stroke="url(#${u}s)" stroke-width="2.6" stroke-linejoin="round"/>
  <g clip-path="url(#${u}c)">
    <g data-eye-iris>
      <circle cx="100" cy="100" r="17" fill="url(#${u}i)" filter="url(#${u}g)"/>
      <circle data-eye-iris-alert cx="100" cy="100" r="17" fill="url(#${u}r)" style="opacity:0"/>
      <circle cx="100" cy="100" r="7.2" fill="#020205"/>
      <circle cx="104.6" cy="95.4" r="2.6" fill="#fff" opacity=".92"/>
    </g>
  </g>
  ${alert ? `<g data-eye-alert style="opacity:0"><rect x="95" y="24" width="10" height="27" rx="4" fill="#FF3B69" filter="url(#${u}g)"/><circle cx="100" cy="61" r="5.2" fill="#FF3B69" filter="url(#${u}g)"/></g>` : ''}
</svg>`;
}

function createEye(root) {
  const svg = root.querySelector('svg');
  const lid = svg.querySelector('[data-eye-lid]');
  const clip = svg.querySelector('[data-eye-clip]');
  const iris = svg.querySelector('[data-eye-iris]');
  const irisAlert = svg.querySelector('[data-eye-iris-alert]');
  const alertG = svg.querySelector('[data-eye-alert]');
  const st = { open: 0, x: 0, y: 0, blinking: false, hold: false, base: 1 };
  const eye = {
    st, root, svg,
    setOpen(k) { st.open = k; const d = eyePath(k); lid.setAttribute('d', d); clip.setAttribute('d', d); },
    setLook(x, y) { st.x = x; st.y = y; iris.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`); },
    lookTo(x, y, ms = 260) { const x0 = st.x, y0 = st.y; return tween(ms, (e) => eye.setLook(lerp(x0, x, e), lerp(y0, y, e)), Ease.outExpo); },
    async blink(ms = 180) {
      if (st.blinking) return;
      st.blinking = true;
      const o = st.open > 0.05 ? st.open : st.base;
      await tween(ms * 0.45, (e) => eye.setOpen(o * (1 - e)), Ease.inOutCubic);
      await tween(ms * 0.55, (e) => eye.setOpen(o * e), Ease.outCubic);
      st.blinking = false;
    },
    alarm(on) { irisAlert.style.opacity = on ? '1' : '0'; if (alertG) alertG.style.opacity = on ? '1' : '0'; },
  };
  return eye;
}

function mountEye(el, opts = {}) {
  el.innerHTML = logoSVG(opts);
  const eye = createEye(el);
  eye.st.base = opts.open ?? 1;
  eye.setOpen(opts.startOpen ?? 0);
  eye.setLook(0, 0);
  if (opts.track) Eyes.track(eye);
  return eye;
}

/* Every tracked eye follows the cursor; idles with a slow drift on touch screens. */
const Eyes = {
  list: new Set(),
  mouse: { x: window.innerWidth / 2, y: window.innerHeight / 3, t: 0 },
  running: false,
  init() {
    window.addEventListener('pointermove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.t = performance.now(); }, { passive: true });
  },
  track(eye) {
    this.list.add(eye);
    this.scheduleBlink(eye);
    if (!this.running) { this.running = true; requestAnimationFrame((t) => this.loop(t)); }
  },
  untrack(eye) { this.list.delete(eye); },
  scheduleBlink(eye) {
    setTimeout(async () => {
      if (!this.list.has(eye)) return;
      if (!document.hidden && !eye.st.hold && eye.st.open > 0.3) await eye.blink();
      this.scheduleBlink(eye);
    }, rand(2600, 6800));
  },
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    if (document.hidden) return;
    const idle = performance.now() - this.mouse.t > 4500;
    for (const eye of this.list) {
      if (eye.st.hold || !eye.root.isConnected) continue;
      const r = eye.svg.getBoundingClientRect();
      if (!r.width) continue;
      let tx, ty;
      if (idle) { tx = Math.sin(t / 1400 + r.left) * 11; ty = Math.cos(t / 1900 + r.top) * 5.5; }
      else {
        const dx = this.mouse.x - (r.left + r.width / 2), dy = this.mouse.y - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) || 1;
        const m = 1 - Math.exp(-d / 170); // saturating gaze: nearby cursor = subtle, far cursor = full deflection
        tx = (dx / d) * 16 * m; ty = (dy / d) * 8.5 * m;
      }
      eye.setLook(lerp(eye.st.x, tx, 0.16), lerp(eye.st.y, ty, 0.16));
    }
  },
};

/* =========================================================
   Starfield: depth-projected stars, warp streaks on demand
   ========================================================= */
const BG = {
  c: null, ctx: null, w: 0, h: 0, dpr: 1, stars: [],
  warp: 0, warpT: 0, speed: 0.0012, speedT: 0.0012, dim: 1, dimT: 1,
  init() {
    this.c = $('#bg-canvas');
    this.ctx = this.c.getContext('2d');
    this.resize();
    window.addEventListener('resize', debounce(() => this.resize(), 120));
    const n = window.innerWidth < 700 ? 110 : 210;
    for (let i = 0; i < n; i++) this.stars.push(this.spawn(true));
    requestAnimationFrame((t) => this.frame(t));
  },
  spawn(initial) {
    const r = Math.random();
    return { x: rand(-1, 1), y: rand(-1, 1), z: initial ? rand(0.06, 1) : 1, tw: rand(0, 6.28), hue: r < 0.1 ? 'c' : r < 0.18 ? 'v' : 'w' };
  },
  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.c.width = Math.floor(this.w * this.dpr); this.c.height = Math.floor(this.h * this.dpr);
  },
  setMode(mode) {
    if (mode === 'intro') { this.speedT = 0.0009; this.dimT = 0.7; }
    else if (mode === 'story') { this.speedT = 0.0016; this.dimT = 1; }
    else { this.speedT = 0.00016; this.dimT = 0.55; }
  },
  warpBurst(ms = 1000) { if (REDUCED) return; this.warpT = 1; setTimeout(() => { this.warpT = 0; }, ms); },
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    if (document.hidden) return;
    const { ctx, dpr } = this;
    const W = this.c.width, H = this.c.height;
    this.warp += (this.warpT - this.warp) * 0.07;
    this.speed += (this.speedT - this.speed) * 0.05;
    this.dim += (this.dimT - this.dim) * 0.04;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2 + (Eyes.mouse.x - this.w / 2) * -0.025 * dpr;
    const cy = H / 2 + (Eyes.mouse.y - this.h / 2) * -0.025 * dpr;
    const fov = Math.min(W, H) * 0.55;
    const sp = REDUCED ? 0 : this.speed + this.warp * 0.042;
    const streak = this.warp > 0.04;
    for (const s of this.stars) {
      const pz = s.z;
      s.z -= sp;
      if (s.z <= 0.03) { Object.assign(s, this.spawn(false)); continue; }
      const sx = cx + (s.x / s.z) * fov, sy = cy + (s.y / s.z) * fov;
      if (sx < -60 || sx > W + 60 || sy < -60 || sy > H + 60) { Object.assign(s, this.spawn(false)); continue; }
      const k = 1 - s.z;
      const a = Math.min(1, k * 1.3) * (0.62 + 0.38 * Math.sin(t * 0.0016 + s.tw)) * this.dim;
      const col = s.hue === 'c' ? `rgba(0,243,255,${a.toFixed(3)})` : s.hue === 'v' ? `rgba(196,150,255,${a.toFixed(3)})` : `rgba(226,233,255,${a.toFixed(3)})`;
      const size = (0.45 + k * 1.9) * dpr;
      if (streak) {
        const px = cx + (s.x / pz) * fov, py = cy + (s.y / pz) * fov;
        ctx.strokeStyle = col; ctx.lineWidth = size; ctx.beginPath();
        ctx.moveTo(px, py); ctx.lineTo(sx + (sx - px) * this.warp * 2.5, sy + (sy - py) * this.warp * 2.5); ctx.stroke();
      } else { ctx.fillStyle = col; ctx.fillRect(sx, sy, size, size); }
    }
  },
};

/* =========================================================
   Confetti burst (deploy success)
   ========================================================= */
function confetti(x, y, n = 160) {
  if (REDUCED) return;
  const c = $('#fx-canvas'), ctx = c.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = window.innerWidth * dpr; c.height = window.innerHeight * dpr;
  const cols = [C.cyan, C.violet, C.green, '#FFFFFF', '#7DEBFF'];
  const ps = Array.from({ length: n }, () => {
    const a = rand(0, Math.PI * 2), v = rand(4, 14);
    return { x: x * dpr, y: y * dpr, vx: Math.cos(a) * v * dpr, vy: (Math.sin(a) * v - rand(3, 8)) * dpr, w: rand(4, 9) * dpr, h: rand(2, 5) * dpr, r: rand(0, 6.28), vr: rand(-0.3, 0.3), col: pick(cols), life: rand(80, 140) };
  });
  let f = 0;
  const step = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'lighter';
    let alive = 0;
    for (const p of ps) {
      if (p.life <= 0) continue;
      alive++; p.life--;
      p.vy += 0.3 * dpr; p.vx *= 0.986; p.vy *= 0.986; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.life / 30); ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
    if (alive && f++ < 280) requestAnimationFrame(step);
    else ctx.clearRect(0, 0, c.width, c.height);
  };
  requestAnimationFrame(step);
}

/* Cursor spotlight border on .spot panels (one listener for the whole page). */
function initSpotlight() {
  if (!HOVER) return;
  document.addEventListener('pointermove', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('.spot') : null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', (e.clientX - r.left).toFixed(0) + 'px');
    el.style.setProperty('--my', (e.clientY - r.top).toFixed(0) + 'px');
  }, { passive: true });
}

/* 3D tilt for mover cards (delegated, so re-rendered cards keep it). */
function bindTilt(container, selector) {
  if (!HOVER || REDUCED) return;
  container.addEventListener('pointermove', (e) => {
    const el = e.target.closest(selector); if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-py * 7).toFixed(2)}deg) rotateY(${(px * 9).toFixed(2)}deg) translateY(-3px) scale(1.02)`;
  });
  container.addEventListener('pointerout', (e) => { const el = e.target.closest(selector); if (el && !el.contains(e.relatedTarget)) el.style.transform = ''; });
  container.addEventListener('pointerdown', (e) => { const el = e.target.closest(selector); if (el) el.style.transform = 'perspective(900px) scale(.97)'; });
}

/* =========================================================
   Procedural art: token marks and avatar presets (original designs)
   ========================================================= */
const svgURI = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);
const LOGO_CACHE = new Map();
function tokenLogo(symbol, seed) {
  const key = symbol + '|' + seed;
  if (LOGO_CACHE.has(key)) return LOGO_CACHE.get(key);
  const r = seeded(seed || symbol);
  const h1 = Math.floor(r() * 360), h2 = (h1 + 50 + Math.floor(r() * 130)) % 360;
  const letters = (symbol || '?').replace(/[^A-Z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
  const shape = Math.floor(r() * 5);
  const ink = 'rgba(4,4,12,.28)';
  const shapes = [
    `<circle cx="32" cy="32" r="19" fill="none" stroke="${ink}" stroke-width="5"/>`,
    `<path d="M32 11L53 47H11Z" fill="${ink}"/>`,
    `<path d="M32 9L52 20.5V43.5L32 55L12 43.5V20.5Z" fill="none" stroke="${ink}" stroke-width="4"/>`,
    `<path d="M32 6L58 32L32 58L6 32Z" fill="${ink}"/>`,
    `<ellipse cx="32" cy="32" rx="26" ry="9" fill="none" stroke="${ink}" stroke-width="3.5" transform="rotate(-24 32 32)"/>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h1} 95% 62%)"/><stop offset="1" stop-color="hsl(${h2} 88% 44%)"/></linearGradient><radialGradient id="b" cx="30%" cy="22%" r="80%"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><circle cx="32" cy="32" r="32" fill="url(#a)"/>${shapes[shape]}<circle cx="32" cy="32" r="32" fill="url(#b)"/><text x="32" y="${letters.length > 1 ? 39 : 41}" text-anchor="middle" font-family="Inter,Segoe UI,Arial,sans-serif" font-weight="900" font-size="${letters.length > 1 ? 21 : 26}" letter-spacing="-1" fill="#05050c">${letters}</text></svg>`;
  const uri = svgURI(svg);
  LOGO_CACHE.set(key, uri);
  return uri;
}
const logoFor = (t) => t.logo || t.fallbackLogo;
const logoImg = (t, cls = '') => `<img class="tk-logo ${cls}" src="${esc(logoFor(t))}" data-fb="${esc(t.fallbackLogo)}" alt="" loading="lazy" decoding="async">`;
/* Remote logos may be blocked or dead: swap to the generated mark (capture phase catches img errors). */
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img && img.tagName === 'IMG' && img.dataset.fb && img.src !== img.dataset.fb) img.src = img.dataset.fb;
}, true);

const AVATARS = [
  { name: 'Nova', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1630"/><stop offset="1" stop-color="#1B0B33"/></linearGradient><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00F3FF"/><stop offset="1" stop-color="#A855F7"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><path d="M32 6L39 25L58 32L39 39L32 58L25 39L6 32L25 25Z" fill="none" stroke="url(#s)" stroke-width="2"/><path d="M19 32C24 25 40 25 45 32C40 39 24 39 19 32Z" fill="#020205" stroke="url(#s)" stroke-width="1.6"/><circle cx="32" cy="32" r="5.5" fill="#00F3FF"/><circle cx="32" cy="32" r="2.4" fill="#020205"/></svg>` },
  { name: 'Visor', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14213D"/><stop offset="1" stop-color="#05060F"/></linearGradient><linearGradient id="v" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#00F3FF"/><stop offset="1" stop-color="#00FFA3"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><path d="M14 52C14 30 22 14 32 14S50 30 50 52Z" fill="#1E2A44"/><rect x="18" y="28" width="28" height="9" rx="4.5" fill="url(#v)"/><rect x="18" y="28" width="28" height="9" rx="4.5" fill="#fff" opacity=".18"/><path d="M10 64C12 54 20 50 32 50S52 54 54 64Z" fill="#2A3656"/></svg>` },
  { name: 'Prism', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0A0716"/><path d="M4 30L26 33" stroke="#fff" stroke-width="2"/><path d="M32 12L50 46H14Z" fill="#1A1430" stroke="#C9B6FF" stroke-width="1.6"/><path d="M38 34L62 26" stroke="#FF3B69" stroke-width="2"/><path d="M38 35L62 33" stroke="#FFBE5C" stroke-width="2"/><path d="M38 36L62 40" stroke="#00FFA3" stroke-width="2"/><path d="M38 37L62 47" stroke="#00F3FF" stroke-width="2"/><path d="M38 38L62 54" stroke="#A855F7" stroke-width="2"/></svg>` },
  { name: 'Glitch', svg: (() => { const r = seeded('glitch-avatar'); let cells = ''; for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) { if (r() > 0.45) { const c = r() > 0.5 ? '#00F3FF' : '#A855F7'; cells += `<rect x="${12 + x * 8}" y="${12 + y * 8}" width="8" height="8" fill="${c}"/>`; if (x < 2) cells += `<rect x="${44 - x * 8}" y="${12 + y * 8}" width="8" height="8" fill="${c}"/>`; } } return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#070712"/>${cells}</svg>`; })() },
  { name: 'Orbit', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="p" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#FFD7A8"/><stop offset=".6" stop-color="#FF3B69"/><stop offset="1" stop-color="#3B0A1E"/></radialGradient></defs><rect width="64" height="64" fill="#06040E"/><circle cx="12" cy="14" r="1" fill="#fff"/><circle cx="52" cy="10" r="1.2" fill="#fff"/><circle cx="50" cy="52" r=".9" fill="#fff"/><circle cx="32" cy="33" r="14" fill="url(#p)"/><ellipse cx="32" cy="33" rx="25" ry="7" fill="none" stroke="#FFBE5C" stroke-width="2.2" transform="rotate(-18 32 33)"/></svg>` },
  { name: 'Sigil', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#04110D"/><path d="M32 8L52 19.5V42.5L32 54L12 42.5V19.5Z" fill="none" stroke="#00FFA3" stroke-width="2"/><path d="M32 8V54M12 19.5L52 42.5M52 19.5L12 42.5" stroke="#00FFA3" stroke-width="1" opacity=".45"/><circle cx="32" cy="31" r="7" fill="#04110D" stroke="#00FFA3" stroke-width="2"/></svg>` },
  { name: 'Reactor', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="c"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#00F3FF"/><stop offset="1" stop-color="#00F3FF" stop-opacity="0"/></radialGradient></defs><rect width="64" height="64" fill="#03080F"/><circle cx="32" cy="32" r="24" fill="none" stroke="#00F3FF" stroke-opacity=".25" stroke-width="2"/><circle cx="32" cy="32" r="17" fill="none" stroke="#00F3FF" stroke-opacity=".5" stroke-width="2" stroke-dasharray="4 4"/><circle cx="32" cy="32" r="12" fill="url(#c)"/></svg>` },
  { name: 'Wave', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0C0618"/><path d="M0 24Q8 16 16 24T32 24T48 24T64 24" fill="none" stroke="#A855F7" stroke-width="2.4"/><path d="M0 34Q8 26 16 34T32 34T48 34T64 34" fill="none" stroke="#00F3FF" stroke-width="2.4"/><path d="M0 44Q8 36 16 44T32 44T48 44T64 44" fill="none" stroke="#00FFA3" stroke-width="2.4"/></svg>` },
  { name: 'Specter', svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E8EBF5"/><stop offset="1" stop-color="#A855F7"/></linearGradient></defs><rect width="64" height="64" fill="#0A0A14"/><path d="M18 52V30C18 21 24 14 32 14S46 21 46 30V52L41 48L36.5 52L32 48L27.5 52L23 48Z" fill="url(#g)"/><circle cx="27" cy="31" r="3" fill="#0A0A14"/><circle cx="37" cy="31" r="3" fill="#0A0A14"/></svg>` },
].map((a) => ({ name: a.name, uri: svgURI(a.svg) }));
const avatarURI = (av) => (av && av.kind === 'custom' && av.data ? av.data : AVATARS[(av && av.id) || 0].uri);

/* =========================================================
   PHASES 1 → 2 → 3
   ========================================================= */
const SKIP = Symbol('skip');
const Phase = { skipIntro: false, skipStory: false, entering: false, introEye: null, storyEye: null, ctaReady: false, latTimer: 0 };

function capLine(text, cls = '') {
  const cap = $('#intro-caption');
  const ln = document.createElement('span');
  ln.className = 'ln ' + cls;
  ln.textContent = text;
  cap.appendChild(ln);
  while (cap.children.length > 2) cap.firstElementChild.remove();
}

/* ---------- PHASE 1: the eye wakes up, spots volatility, looks down ---------- */
async function runIntro() {
  state.phase = 'intro';
  Phase.skipIntro = false;
  Phase.entering = false;
  BG.setMode('intro');
  document.body.classList.add('locked', 'pre-app');
  const intro = $('#phase-intro');
  intro.hidden = false;
  intro.classList.remove('fade');
  const wrap = $('#intro-logo-wrap');
  wrap.style.transition = 'none'; wrap.style.transform = ''; wrap.style.opacity = '';
  const logo = $('#intro-logo');
  logo.className = 'intro-logo';
  $('#intro-alert').className = 'intro-alert';
  const cap = $('#intro-caption'); cap.className = 'intro-caption mono'; cap.innerHTML = '';
  $('#intro-flash').classList.remove('on');
  const eye = mountEye(logo, { frame: true, alert: false, startOpen: 0 });
  Phase.introEye = eye;

  const step = async (ms) => { await sleep(ms); if (Phase.skipIntro) throw SKIP; };
  try {
    await step(450);
    capLine('Supernova core v2.0.0');
    logo.classList.add('in');
    await step(1350);
    capLine(state.cfg ? `Linked to Solana ${state.cluster}` : 'Linking to Solana');
    await tween(720, (e) => eye.setOpen(e), Ease.outBack);
    if (Phase.skipIntro) throw SKIP;
    await step(220);
    await eye.blink(200);
    await step(240);
    await eye.lookTo(-15, 0, 240); await step(420);
    await eye.lookTo(15, -1, 320); await step(440);
    await eye.lookTo(0, 0, 220);
    logo.classList.add('charged');
    await step(320);
    // ⚠ volatility detected
    $('#intro-alert').classList.add('pop');
    $('#intro-flash').classList.add('on');
    eye.alarm(true);
    capLine('Scanning the trenches', 'warn');
    if (!REDUCED) logo.classList.add('shake');
    await tween(620, (e, t) => eye.setLook(Math.sin(t * 70) * 3.4 * (1 - t), Math.cos(t * 53) * 2.2 * (1 - t)), Ease.linear);
    await step(120);
    await eye.lookTo(0, 9.5, 300);          // straight down
    await tween(260, (e) => eye.setOpen(1 - 0.22 * e));
    await step(420);
  } catch (err) { if (err !== SKIP) console.error(err); }
  await toStory(!Phase.skipIntro);
}

/* ---------- transition: FLIP the logo into the story anchor ---------- */
async function toStory(animated) {
  const story = $('#phase-story');
  const intro = $('#phase-intro');
  resetStory();
  story.hidden = false;
  story.classList.remove('out', 'in');
  const anchor = $('#story-anchor');
  Phase.storyEye = mountEye(anchor, { frame: false, alert: false, startOpen: 0.78 });
  Phase.storyEye.setLook(0, 9.5);
  anchor.style.opacity = '0';
  $('#story-scroller').scrollTop = 0;
  await nextFrame();
  BG.setMode('story');
  if (animated && !REDUCED) {
    const wrap = $('#intro-logo-wrap');
    const a = anchor.getBoundingClientRect(), b = $('#intro-logo').getBoundingClientRect();
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    const s = a.width / b.width;
    Phase.introEye.alarm(false);
    $('#intro-alert').classList.add('gone');
    $('#intro-caption').classList.add('gone');
    $('#intro-logo').classList.remove('shake', 'charged');
    wrap.style.transition = 'transform 1.05s cubic-bezier(.7,0,.2,1)';
    wrap.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(4)})`;
    intro.classList.add('fade');
    await sleep(360);
    story.classList.add('in');
    await sleep(720);
  } else {
    $('#intro-logo-wrap').style.opacity = '0';
    intro.classList.add('fade');
    story.classList.add('in');
    await sleep(450);
  }
  anchor.style.opacity = '1';
  intro.hidden = true;
  runStory();
}

function resetStory() {
  Phase.ctaReady = false;
  Phase.skipStory = false;
  $$('.story-node').forEach((n) => n.classList.remove('active'));
  $$('#sys-checks li').forEach((li) => { li.classList.remove('ok', 'warn'); li.querySelector('.st').innerHTML = '<span class="spin"></span>Checking'; });
  $('#cta-enter').classList.remove('ready');
  $('#rail-line').style.height = '0px';
  const tip = $('#rail-tip'); tip.classList.remove('on'); tip.style.top = '';
  $('#story-pbar').style.width = '0%'; $('#story-ptxt').textContent = '0%';
  const lat = $('#lat-bars');
  lat.innerHTML = Array.from({ length: 7 }, (_, i) => `<div class="lat-col"><b>—</b><div class="lat-bar"></div><span>#${i + 1}</span></div>`).join('');
  Phase.lat = [];
}

/* Live round trips to the Solana RPC (through our API), not marketing numbers. */
async function measureLatency() {
  if (Phase.latBusy) return;
  Phase.latBusy = true;
  try {
    const t0 = performance.now();
    const conn = await SN.chain.connection();
    const slot = await conn.getSlot('confirmed');
    const ms = Math.round(performance.now() - t0);
    state.net.rpc = ms; state.net.slot = Math.max(state.net.slot, slot); state.net.ok = true;
    Phase.lat = [...(Phase.lat || []), ms].slice(-7);
  } catch { Phase.lat = [...(Phase.lat || []), null].slice(-7); }
  finally { Phase.latBusy = false; }
  const cols = $$('#lat-bars .lat-col');
  const vals = Phase.lat;
  const top = Math.max(250, ...vals.filter(Boolean));
  cols.forEach((c, i) => { const v = vals[i]; c.querySelector('b').textContent = v == null ? (i < vals.length ? 'err' : '—') : v + 'ms'; c.querySelector('.lat-bar').style.height = v == null ? '4px' : clamp((v / top) * 92, 8, 92) + 'px'; });
  const ok = vals.filter((v) => v != null).sort((x, y) => x - y);
  if (ok.length) $('#lat-med').textContent = ok[Math.floor(ok.length / 2)] + 'ms';
  setText($('#lat-tps'), state.net.tps ? fmtInt(state.net.tps) : '—');
  setText($('#lat-slot'), state.net.slot ? fmtInt(state.net.slot) : '—');
}

function activateNode(n) {
  n.classList.add('active');
  if (n.dataset.step === '2') { measureLatency(); clearInterval(Phase.latTimer); Phase.latTimer = setInterval(() => { if (state.phase === 'story') measureLatency(); else clearInterval(Phase.latTimer); }, 900); }
}

/* Real readiness checks shown at the end of the story. */
async function systemChecks() {
  await Promise.race([dataReady, sleep(6000)]);
  const f = (state.cfg && state.cfg.features) || {};
  const wallets = SN.wallet.list().filter((w) => w.installed);
  return {
    market: state.dataSource === 'live' ? ['ok', 'Live'] : ['warn', 'Unavailable'],
    launchlab: state.cfg ? (state.cfg.platformConfigured ? ['ok', 'Online'] : ['warn', 'Default platform']) : ['warn', 'Offline'],
    mev: !state.cfg ? ['warn', 'Offline'] : isMainnet() ? ['ok', 'Jito ready'] : ['warn', 'Mainnet only'],
    ai: f.ai ? ['ok', 'Online'] : ['warn', 'Not configured'],
    wallet: wallets.length ? ['ok', esc(wallets[0].name)] : ['warn', SN.wallet.isMobile() ? 'Open in wallet' : 'None found'],
  };
}

/* ---------- PHASE 2: the rail draws itself and drives the scroll ---------- */
async function runStory() {
  state.phase = 'story';
  const scroller = $('#story-scroller'), content = $('#story-content');
  const line = $('#rail-line'), tip = $('#rail-tip');
  const nodes = $$('.story-node', content);
  const relY = (el) => el.getBoundingClientRect().top - content.getBoundingClientRect().top;
  const y0 = parseFloat(getComputedStyle(content).getPropertyValue('--rail-y0')) || 170;
  const stops = nodes.map((n) => relY(n.querySelector('.story-dot')) + 9);
  const cta = $('#cta-enter');
  const endY = relY(cta) + cta.offsetHeight / 2;
  let tipY = y0, hold = 0;
  const onUser = () => { hold = performance.now() + 1800; };
  scroller.addEventListener('wheel', onUser, { passive: true });
  scroller.addEventListener('touchmove', onUser, { passive: true });
  tip.style.top = y0 + 'px';
  tip.classList.add('on');

  const render = () => {
    line.style.height = Math.max(0, tipY - y0).toFixed(1) + 'px';
    tip.style.top = tipY.toFixed(1) + 'px';
    const pct = clamp((tipY - y0) / Math.max(1, endY - y0), 0, 1);
    $('#story-pbar').style.width = (pct * 100).toFixed(1) + '%';
    $('#story-ptxt').textContent = Math.round(pct * 100) + '%';
    if (performance.now() > hold) scroller.scrollTop = clamp(tipY - scroller.clientHeight * 0.56, 0, scroller.scrollHeight - scroller.clientHeight);
    nodes.forEach((n, i) => { if (!n.classList.contains('active') && tipY >= stops[i] - 2) activateNode(n); });
    // the anchor eye keeps watching the comet head
    if (Phase.storyEye) { const a = $('#story-anchor').getBoundingClientRect(); const tr = tip.getBoundingClientRect(); const dy = tr.top - a.bottom; Phase.storyEye.setLook(clamp((tr.left - a.left - a.width / 2) / 30, -6, 6), clamp(4 + dy / 90, 4, 9.5)); }
  };
  const moveTo = async (to) => {
    const from = tipY;
    const ms = clamp(Math.abs(to - from) / 0.5, 650, 2300);
    await tween(ms, (e) => { if (!Phase.skipStory) { tipY = lerp(from, to, e); render(); } }, Ease.inOutCubic);
  };
  const wait = async (ms) => { await sleep(ms); if (Phase.skipStory) throw SKIP; };
  try {
    await wait(350);
    for (let i = 0; i < stops.length; i++) {
      await moveTo(stops[i]);
      if (Phase.skipStory) throw SKIP;
      if (i < stops.length - 1) await wait(1300);
    }
    const checks = await systemChecks();
    for (const li of $$('#sys-checks li')) {
      await wait(rand(230, 360));
      const [st, label] = checks[li.dataset.check] || ['ok', 'Online'];
      li.classList.add('ok');
      if (st !== 'ok') li.classList.add('warn');
      li.querySelector('.st').innerHTML = `<i class="fa-solid fa-${st === 'ok' ? 'check' : 'triangle-exclamation'}"></i>${label}`;
    }
    await moveTo(endY);
    if (Phase.skipStory) throw SKIP;
    Phase.ctaReady = true;
    cta.classList.add('ready');
    try { cta.focus({ preventScroll: true }); } catch { cta.focus(); }
  } catch (err) { if (err !== SKIP) console.error(err); }
  finally {
    scroller.removeEventListener('wheel', onUser);
    scroller.removeEventListener('touchmove', onUser);
  }
}

/* ---------- PHASE 3: warp into the trenches ---------- */
async function enterApp() {
  if (Phase.entering || state.phase === 'app') return;
  Phase.entering = true;
  Phase.skipStory = true;
  Phase.skipIntro = true;
  clearInterval(Phase.latTimer);
  BG.warpBurst(1000);
  const wf = $('#warp-flash'); wf.classList.remove('on'); void wf.offsetWidth; wf.classList.add('on');
  $('#phase-story').classList.add('out');
  $('#phase-intro').classList.add('fade');
  await sleep(420);
  await dataReady;
  const first = !App.inited;
  if (first) App.init();
  const app = $('#app');
  app.hidden = false;
  document.body.classList.remove('locked', 'pre-app');
  if (first) {
    await nextFrame(); await nextFrame();
    app.classList.add('in');
    Router.go(state.view || 'hub', { force: true, instant: true });
  }
  BG.setMode('app');
  await sleep(first ? 1000 : 600);
  $('#phase-story').hidden = true;
  $('#phase-intro').hidden = true;
  app.classList.add('settled');
  state.phase = 'app';
  Phase.entering = false;
  Nav.sync();
  App.onEnter(first);
}

function replayIntro() {
  if (state.phase !== 'app') return;
  Palette.close(); Wallet.close(); ProModal.close();
  if ($('#chart-panel').classList.contains('expanded')) Term.toggleExpand(false);
  window.scrollTo(0, 0);
  runIntro();
}

/* =========================================================
   LIVE MARKET DATA
   Blue chips and trending coins come from DexScreener / GeckoTerminal,
   every Supernova launch comes from Raydium LaunchLab (indexed from the chain).
   Everything flows through our /api so keys stay server-side.
   ========================================================= */
function baseToken(id, kind) {
  return {
    id, address: id, kind, symbol: '???', name: '', logo: null, fallbackLogo: tokenLogo('?', id), desc: '',
    price: 0, supply: 0, mcap: 0, vol24h: 0, liquidity: 0, change24h: 0, ch1h: 0, ch5m: 0, open24h: 0,
    createdAt: 0, holders: null, txns24h: null, graduated: true, curve: 100,
    candles: null, candlesTf: null, candlesAt: 0, candleSource: null, spark: null, intel: null, lastDir: 0,
    pair: null, dex: null, launch: null, cp: null, creator: null, reserves: null, quoteMint: null, dataAt: 0,
  };
}

function setPrice(t, p) {
  if (!(p > 0) || !isFinite(p)) return;
  if (t.price > 0 && p !== t.price) t.lastDir = p > t.price ? 1 : -1;
  t.price = p;
  const cs = t.candles; // keep the forming candle in step with the latest print
  if (cs && cs.length) { const L = cs[cs.length - 1]; L.close = p; if (p > L.high) L.high = p; if (p < L.low) L.low = p; }
}

const cleanSym = (s) => String(s || '???').toUpperCase().replace(/\s+/g, '').slice(0, 12);

function applyPair(t, p) {
  t.symbol = cleanSym(p.symbol || t.symbol);
  t.name = String(p.name || t.name || t.symbol).slice(0, 40);
  if (p.image && !t.launch) t.logo = p.image;
  t.fallbackLogo = tokenLogo(t.symbol, t.id);
  setPrice(t, p.priceUsd);
  t.mcap = p.mcap || t.mcap; t.vol24h = p.volume24h || 0; t.liquidity = p.liquidityUsd || 0;
  t.change24h = p.change.h24 || 0; t.ch1h = p.change.h1 || 0; t.ch5m = p.change.m5 || 0;
  t.open24h = t.price / (1 + t.change24h / 100);
  if (p.createdAt) t.createdAt = p.createdAt;
  t.pair = p.pair; t.dex = p.dex; t.reserves = p.reserves || null; t.quoteMint = p.quoteMint || null;
  t.txns24h = p.txns24h ? p.txns24h.buys + p.txns24h.sells : null;
  t.supply = t.price > 0 && t.mcap > 0 ? t.mcap / t.price : t.supply;
  t.graduated = true; t.curve = 100;
  t.dataAt = Date.now();
}

function applyTrending(t, x) {
  t.symbol = cleanSym(x.symbol); t.name = String(x.name || x.symbol).slice(0, 40);
  if (x.image) t.logo = x.image;
  t.fallbackLogo = tokenLogo(t.symbol, t.id);
  setPrice(t, x.priceUsd);
  t.mcap = x.mcap || 0; t.vol24h = x.volume24h || 0; t.liquidity = x.liquidityUsd || 0;
  t.change24h = x.change24h || 0; t.ch1h = x.change1h || 0;
  t.open24h = t.price / (1 + t.change24h / 100);
  if (x.createdAt) t.createdAt = x.createdAt;
  t.pair = x.pool; t.graduated = true; t.curve = 100;
  t.supply = t.price > 0 && t.mcap > 0 ? t.mcap / t.price : t.supply;
  t.dataAt = Date.now();
}

/** Returns true when this update is the moment the coin graduated. */
function applyLaunch(t, v) {
  const was = t.launch ? t.graduated : null;
  t.launch = v;
  t.symbol = cleanSym(v.symbol); t.name = String(v.name || v.symbol).slice(0, 40); t.desc = v.description || '';
  t.logo = v.image || null; t.fallbackLogo = tokenLogo(t.symbol, t.id);
  t.creator = v.creator;
  setPrice(t, v.priceUsd);
  t.supply = v.supply; t.mcap = v.mcapUsd; t.vol24h = v.vol24hUsd; t.liquidity = v.liquidityUsd;
  t.change24h = v.change24h || 0; t.ch1h = v.change1h || 0; t.ch5m = 0;
  t.open24h = t.price / (1 + t.change24h / 100);
  t.createdAt = v.createdAt; t.holders = v.traders || null; t.txns24h = v.trades24h;
  t.graduated = v.phase !== 'curve'; t.curve = t.graduated ? 100 : v.progress;
  t.pair = v.graduatedPair || null; t.dex = v.dex; t.reserves = v.reserves; t.cp = v.cp;
  t.kind = state.user && v.creator === state.user.address ? 'user' : 'launch';
  t.dataAt = Date.now();
  return was === false && t.graduated;
}

const isLaunch = (t) => !!t && (t.kind === 'launch' || t.kind === 'user');
const onCurve = (t) => isLaunch(t) && !t.graduated;

/** Percent change over `mins`: from loaded 1m candles when we have them, else the upstream windows. */
function changeOver(t, mins) {
  const cs = t.candles;
  if (cs && cs.length > 3 && t.candlesTf === '1m' && mins < cs.length) {
    const ref = cs[cs.length - 1 - mins];
    if (ref && ref.close > 0) return (t.price / ref.close - 1) * 100;
  }
  if (mins <= 5) return t.ch5m || 0;
  if (mins <= 60) return t.ch1h || 0;
  return t.change24h || 0;
}

/* ---------- feed ---------- */
function pushFeed(ev) {
  state.feed.unshift(ev);
  if (state.feed.length > 120) state.feed.length = 120;
  if (state.phase !== 'app') return;
  if (state.feedPaused) { state.feedMissed++; Hub.pausedNote(); return; }
  if (state.view === 'hub') Hub.feedInsert(ev);
}

function feedFromServer(e) {
  if (e.type === 'launch') return { id: 'L:' + e.mint, type: 'launch', tokenId: e.mint, ts: e.ts, wallet: e.wallet || '' };
  const sol = +e.sol || 0;
  const dev = !!e.dev, whale = sol >= WHALE_SOL;
  return {
    id: 'T:' + e.sig, type: 'trade', side: e.side === 'sell' ? 'sell' : 'buy', tokenId: e.mint, sol, usd: sol * (state.solPrice || 0),
    tag: dev ? 'Dev wallet' : whale ? 'Whale' : e.side === 'sell' ? 'Seller' : 'Buyer',
    icon: dev ? 'fa-user-gear' : whale ? 'fa-fish-fins' : e.side === 'sell' ? 'fa-arrow-trend-down' : 'fa-arrow-trend-up',
    wallet: e.wallet || '', ts: e.ts, whale, sig: e.sig,
  };
}

const Data = {
  seen: new Set(), timers: [], booted: false, lastErr: 0,
  upsert(id, kind) {
    let t = state.byId.get(id);
    if (!t) { t = baseToken(id, kind); state.tokens.push(t); state.byId.set(id, t); }
    return t;
  },
  async boot() {
    try { state.cfg = await SN.config(); state.cluster = state.cfg.cluster; }
    catch (e) { console.warn('[Supernova] config unavailable', e && e.message); }
    const r = await Promise.allSettled([this.pollMajors(), this.pollLaunches(), this.pollTrending(), this.pollNet()]);
    await this.pollFeed(true).catch(() => {}); // after the coins exist, so their events can be shown
    state.dataSource = r[0].status === 'fulfilled' || r[1].status === 'fulfilled' ? 'live' : 'offline';
    this.booted = true;
  },
  start() {
    const every = (ms, fn) => this.timers.push(setInterval(() => { if (!document.hidden) fn().catch((e) => this.err(e)); }, ms));
    every(15000, () => this.pollMajors());
    every(6000, () => this.pollLaunches());
    every(60000, () => this.pollTrending());
    every(10000, () => this.pollNet());
    every(5000, () => this.pollFeed());
    every(45000, () => this.pollSparks());
    this.pollSparks().catch(() => {});
  },
  err(e) { if (Date.now() - this.lastErr > 60000) { this.lastErr = Date.now(); console.warn('[Supernova] data refresh failed:', e && e.message); } },

  async pollMajors() {
    const r = await SN.market.majors();
    if (r.sol && r.sol.priceUsd > 0) { state.solPrice = r.sol.priceUsd; state.solOpen = r.sol.priceUsd / (1 + (r.sol.change24h || 0) / 100); }
    for (const p of r.tokens || []) {
      const t = this.upsert(p.mint, 'major');
      if (isLaunch(t)) continue;
      t.kind = 'major';
      applyPair(t, p);
    }
    state.dataSource = 'live';
  },
  async pollLaunches() {
    const r = await SN.market.launches(80);
    for (const v of r.launches || []) {
      const t = this.upsert(v.mint, 'launch');
      if (applyLaunch(t, v) && state.phase === 'app') this.onGraduated(t);
    }
    if (r.stats) state.global = { vol24h: r.stats.vol24hUsd || 0, launches: r.stats.total || 0, launches24h: r.stats.last24h || 0, graduated: r.stats.graduated || 0 };
  },
  async pollTrending() {
    const r = await SN.market.trending();
    const live = new Set();
    for (const x of r.tokens || []) {
      const cur = state.byId.get(x.mint);
      if (cur && cur.kind !== 'trending') continue;
      const t = this.upsert(x.mint, 'trending');
      applyTrending(t, x);
      live.add(x.mint);
    }
    // trending coins that cooled off leave the scanner unless you are using them
    for (const t of state.tokens.slice()) {
      if (t.kind !== 'trending' || live.has(t.id) || t.id === state.activeId || state.watch.has(t.id) || (state.user && state.user.holdings[t.id])) continue;
      state.tokens.splice(state.tokens.indexOf(t), 1);
      state.byId.delete(t.id);
      if (Hub.inited) Hub.dropRow(t.id);
    }
  },
  async pollNet() {
    const t0 = performance.now();
    try {
      const conn = await SN.chain.connection();
      const slot = await conn.getSlot('confirmed');
      state.net.rpc = Math.round(performance.now() - t0);
      state.net.slot = Math.max(state.net.slot, slot);
      state.net.ok = true;
    } catch { state.net.ok = false; }
    const r = await SN.market.net().catch(() => null);
    if (r) {
      if (r.tps) state.net.tps = r.tps;
      if (r.slot) state.net.slot = Math.max(state.net.slot, r.slot);
      if (r.solUsd > 0) state.solPrice = r.solUsd;
    }
  },
  async pollFeed(initial) {
    const r = await SN.market.feed();
    const fresh = [];
    for (const e of r.events || []) {
      const ev = feedFromServer(e);
      if (this.seen.has(ev.id) || !state.byId.has(ev.tokenId)) continue; // unknown coins are retried on the next poll
      this.seen.add(ev.id);
      fresh.push(ev);
    }
    fresh.sort((a, b) => a.ts - b.ts);
    for (const ev of fresh) {
      if (initial) { state.feed.unshift(ev); continue; }
      pushFeed(ev);
      if (ev.type === 'trade' && ev.whale && state.phase === 'app') Header.eyeAlert();
      if (ev.type === 'trade' && state.view === 'terminal' && ev.tokenId === state.activeId) Term.pollTape();
    }
    if (initial && state.feed.length > 120) state.feed.length = 120;
  },
  async loadSpark(t) {
    const q = isLaunch(t) && !t.pair ? { mint: t.id, tf: '5m' } : t.pair ? { pool: t.pair, tf: '15m', mint: t.id } : null;
    if (!q) return;
    const r = await SN.market.candles(q);
    const cs = (r.candles || []).slice(-40);
    if (cs.length >= 2) t.spark = cs.map((c) => c.close);
  },
  async pollSparks() {
    const ids = new Set([...(Hub.moverIds || [])]);
    for (const id of ids) { const t = tokenById(id); if (t) await this.loadSpark(t).catch(() => {}); }
  },
  /** Open any coin by mint address (pasted in search): Supernova launch or any DEX-listed token. */
  async openMint(mint) {
    if (state.byId.has(mint)) return state.byId.get(mint);
    const r = await SN.market.token(mint);
    let t;
    if (r.launch) { t = this.upsert(mint, 'launch'); applyLaunch(t, r.launch); }
    else if (r.pair) { t = this.upsert(mint, 'external'); applyPair(t, r.pair); }
    if (t && Hub.inited && state.view === 'hub') Hub.renderScanner(true);
    return t || null;
  },
  onGraduated(t) {
    pushFeed({ id: 'G:' + t.id, type: 'grad', tokenId: t.id, ts: Date.now() });
    toast({
      type: 'success', icon: 'fa-graduation-cap', duration: 7000,
      title: t.kind === 'user' ? `Your coin $${t.symbol} graduated` : `$${t.symbol} graduated`,
      msg: `${esc(t.name)} filled its bonding curve. Liquidity is migrating to a Raydium pool.`,
      action: { label: 'Open in terminal', onClick: () => Router.go('terminal', { token: t.id }) },
    });
  },
};
/* =========================================================
   APP SHELL: header, nav, router, ticker, palette, wallet
   ========================================================= */
const Header = {
  eye: null, alertT: 0,
  init() {
    this.eye = mountEye($('#brand-eye'), { frame: false, alert: true, track: true, startOpen: 1 });
    $('#wallet-btn').addEventListener('click', () => (state.user ? Router.go('profile') : Wallet.open()));
    if (/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)) $('#kbd-hint').textContent = '⌘K';
    $('#open-palette').addEventListener('click', () => Palette.open());
    $('#open-palette-m').addEventListener('click', () => Palette.open());
    this.renderWallet();
  },
  /** The brand eye spots a whale: red "!" flashes and the mark jolts. */
  eyeAlert() {
    const svg = this.eye && this.eye.svg;
    if (!svg) return;
    svg.classList.remove('alerting');
    svg.getBoundingClientRect();
    svg.classList.add('alerting');
    this.eye.alarm(true);
    clearTimeout(this.alertT);
    this.alertT = setTimeout(() => { svg.classList.remove('alerting'); this.eye.alarm(false); }, 1500);
  },
  renderWallet() {
    const b = $('#wallet-btn'), u = state.user;
    if (!u) {
      b.className = 'btn btn-primary btn-sm';
      b.innerHTML = '<i class="fa-solid fa-wallet"></i><span>Connect wallet</span>';
      b.setAttribute('aria-label', 'Connect wallet');
      return;
    }
    b.className = 'wallet-btn';
    b.innerHTML = `<img src="${esc(avatarURI(u.avatar))}" alt=""><span class="hidden sm:grid text-left leading-tight pr-1.5"><span class="wb-addr mono">${esc(shortAddr(u.address))}</span><span class="wb-bal mono" id="wb-bal">${u.solKnown ? fmtSOL(u.sol) + ' SOL' : '…'}</span></span>`;
    b.setAttribute('aria-label', 'Open your profile');
  },
  live() {
    setText($('#hdr-tps'), state.net.tps ? fmtInt(state.net.tps) : '—');
    if (state.user && state.user.solKnown) setText($('#wb-bal'), fmtSOL(state.user.sol) + ' SOL');
  },
};

const Nav = {
  init() {
    window.addEventListener('resize', debounce(() => this.sync(), 100));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.sync());
  },
  sync() {
    $$('.nav-btn, .mnav button').forEach((b) => {
      const on = b.dataset.nav === state.view;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const btn = $(`.nav-btn[data-nav="${state.view}"]`), ind = $('#nav-ind');
    if (btn && btn.offsetWidth) { ind.style.width = btn.offsetWidth + 'px'; ind.style.transform = `translateX(${btn.offsetLeft}px)`; ind.style.opacity = '1'; }
  },
};

const VIEW_HOOKS = {
  hub: { show: () => Hub.onShow() },
  terminal: { show: () => Term.onShow(), hide: () => Term.onHide() },
  profile: { show: () => Profile.onShow() },
  launch: { show: () => Launch.onShow() },
};
function defaultTokenId() {
  const t = [...state.tokens].filter((x) => x.price > 0).sort((a, b) => b.vol24h - a.vol24h)[0];
  return t ? t.id : null;
}

const Router = {
  seq: 0,
  async go(view, opts = {}) {
    if (!VIEW_HOOKS[view]) view = 'hub';
    if (view === 'terminal') {
      const id = opts.token && state.byId.has(opts.token) ? opts.token : state.byId.has(state.activeId) ? state.activeId : defaultTokenId();
      if (id && (id !== state.activeId || Term.loadedId !== id)) Term.setToken(id);
    }
    const prev = state.view, changed = prev !== view;
    if (!changed && !opts.force) { if (view === 'terminal') Term.onShow(); window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' }); return; }
    const seq = ++this.seq;
    const from = $('#view-' + prev), to = $('#view-' + view);
    if (changed && VIEW_HOOKS[prev] && VIEW_HOOKS[prev].hide) VIEW_HOOKS[prev].hide();
    state.view = view;
    Nav.sync();
    if (changed && from && !from.hidden && !opts.instant) {
      from.classList.add('leaving');
      await sleep(170);
      if (seq !== this.seq) return;
    }
    $$('.view').forEach((v) => { if (v !== to) { v.hidden = true; v.classList.remove('active', 'leaving'); } });
    to.hidden = false;
    to.classList.remove('leaving');
    void to.offsetWidth;
    to.classList.add('active');
    window.scrollTo(0, 0);
    VIEW_HOOKS[view].show();
    Nav.sync();
    if (!opts.instant) saveSoon();
  },
};

const Ticker = {
  build() {
    const top = [...state.tokens].filter((t) => t.price > 0 && (t.kind === 'major' || t.vol24h > 50000 || isLaunch(t))).sort((a, b) => b.vol24h - a.vol24h).slice(0, 16);
    const solc = state.solOpen ? (state.solPrice / state.solOpen - 1) * 100 : 0;
    const sys =
      `<span class="tk-item"><span class="k">SOL</span><b data-tk="sol">${state.solPrice ? '$' + fmtPrice(state.solPrice) : '—'}</b><span data-tk="solc">${fmtPct(solc)}</span></span>` +
      `<span class="tk-item"><span class="k">TPS</span><b data-tk="tps">${state.net.tps ? fmtInt(state.net.tps) : '—'}</b></span>` +
      `<span class="tk-item"><span class="k">Supernova 24h vol</span><b data-tk="vol">${fmtUSD(state.global.vol24h)}</b></span>` +
      `<span class="tk-item"><span class="k">Coins launched</span><b data-tk="launches">${fmtInt(state.global.launches)}</b></span>` +
      `<span class="tk-item"><span class="k">Slot</span><b data-tk="slot">${state.net.slot ? fmtInt(state.net.slot) : '—'}</b></span>`;
    const toks = (dup) => top.map((t) => `<button class="tk-item" data-token="${esc(t.id)}" ${dup ? 'tabindex="-1"' : ''} aria-label="Open ${esc(t.symbol)} in the terminal"><span class="k">${esc(t.symbol)}</span><b data-tkp="${esc(t.id)}">$${fmtPrice(t.price)}</b><span class="${dirClass(t.change24h)}" data-tkc="${esc(t.id)}">${fmtPct(t.change24h)}</span></button>`).join('');
    const track = $('#ticker-track');
    track.innerHTML = `<div class="flex items-center">${sys}${toks(false)}</div><div class="flex items-center" aria-hidden="true">${sys}${toks(true)}</div>`;
    requestAnimationFrame(() => { const w = track.scrollWidth / 2; track.style.setProperty('--ticker-dur', Math.max(35, w / 46).toFixed(0) + 's'); });
    this.update();
  },
  update() {
    const track = $('#ticker-track');
    if (!track || !track.firstChild) return;
    const solc = state.solOpen ? (state.solPrice / state.solOpen - 1) * 100 : 0;
    $$('[data-tk]', track).forEach((el) => {
      switch (el.dataset.tk) {
        case 'sol': if (state.solPrice) setText(el, '$' + fmtPrice(state.solPrice)); break;
        case 'solc': setText(el, fmtPct(solc)); setDir(el, solc); break;
        case 'tps': if (state.net.tps) setText(el, fmtInt(state.net.tps)); break;
        case 'vol': setText(el, fmtUSD(state.global.vol24h)); break;
        case 'launches': setText(el, fmtInt(state.global.launches)); break;
        case 'slot': if (state.net.slot) setText(el, fmtInt(state.net.slot)); break;
      }
    });
    $$('[data-tkp]', track).forEach((el) => { const t = tokenById(el.dataset.tkp); if (t) setText(el, '$' + fmtPrice(t.price)); });
    $$('[data-tkc]', track).forEach((el) => { const t = tokenById(el.dataset.tkc); if (t) { setText(el, fmtPct(t.change24h)); setDir(el, t.change24h); } });
  },
};

/* ---------- ⌘K command palette ---------- */
const Palette = {
  items: [], sel: 0, isOpen: false, lastFocus: null,
  init() {
    const inp = $('#pal-input');
    inp.addEventListener('input', () => { this.sel = 0; this.render(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this.run(this.sel); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    $('#palette').addEventListener('click', (e) => {
      if (e.target.id === 'palette') { this.close(); return; }
      const it = e.target.closest('.pal-item');
      if (it) this.run(+it.dataset.i);
    });
    $('#pal-list').addEventListener('pointermove', (e) => {
      const it = e.target.closest('.pal-item');
      if (it && +it.dataset.i !== this.sel) { this.sel = +it.dataset.i; this.paintSel(false); }
    });
  },
  actions() {
    const f = (state.cfg && state.cfg.features) || {};
    return [
      { label: 'Go to Discover', icon: 'fa-compass', hint: '1', run: () => Router.go('hub') },
      { label: 'Open the terminal', icon: 'fa-chart-line', hint: '2', run: () => Router.go('terminal') },
      { label: 'Launch a coin', icon: 'fa-rocket', hint: '3', run: () => Router.go('launch') },
      state.user ? { label: 'Open your profile', icon: 'fa-user-astronaut', hint: '4', run: () => Router.go('profile') } : { label: 'Connect wallet', icon: 'fa-wallet', hint: '', run: () => Wallet.open() },
      { label: 'Supernova Pro: AI analyst', icon: 'fa-crown', hint: '', run: () => ProModal.open() },
      ...(f.moonpay ? [{ label: 'Buy SOL with Apple Pay or card', icon: 'fa-credit-card', hint: '', run: () => Funding.buySol() }] : []),
      ...(state.cluster === 'devnet' ? [{ label: 'Get free devnet SOL', icon: 'fa-faucet-drip', hint: '', run: () => Funding.airdrop() }] : []),
      ...(state.user ? [{ label: 'Disconnect wallet', icon: 'fa-right-from-bracket', hint: '', run: () => Wallet.disconnect() }] : []),
      { label: 'Replay intro', icon: 'fa-rotate-left', hint: '', run: () => replayIntro() },
    ];
  },
  render() {
    const q = $('#pal-input').value.trim().toLowerCase();
    const starts = (t) => (t.symbol.toLowerCase().startsWith(q) ? 2 : t.name.toLowerCase().startsWith(q) ? 1 : 0);
    const toks = state.tokens
      .filter((t) => t.price > 0 && (!q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase() === q))
      .sort((a, b) => (q ? starts(b) - starts(a) : 0) || b.vol24h - a.vol24h)
      .slice(0, q ? 8 : 6);
    const acts = this.actions().filter((a) => !q || a.label.toLowerCase().includes(q));
    this.items = [];
    let html = '';
    const tokHTML = (t, i) => `<button class="pal-item" data-i="${i}" role="option">${logoImg(t, 'sm')}<span class="min-w-0"><span class="block font-semibold text-ink truncate">${esc(t.name)}</span><span class="block mono text-[11px] text-ink-3">$${esc(t.symbol)}${onCurve(t) ? ' on curve' : ''}</span></span><span class="pi-r"><span class="text-ink">$${fmtPrice(t.price)}</span> <span class="${dirClass(t.change24h)}">${fmtPct(t.change24h)}</span></span></button>`;
    const actHTML = (a, i) => `<button class="pal-item" data-i="${i}" role="option"><span class="pi-ic"><i class="fa-solid ${a.icon}"></i></span><span>${esc(a.label)}</span>${a.hint ? `<kbd class="ml-auto">${a.hint}</kbd>` : ''}</button>`;
    const group = (title, list, fn, isTok) => {
      if (!list.length) return;
      html += `<div class="pal-group">${title}</div>`;
      list.forEach((x) => { const i = this.items.length; this.items.push(isTok ? () => Router.go('terminal', { token: x.id }) : x.run); html += fn(x, i); });
    };
    const raw = $('#pal-input').value.trim();
    const mintQ = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw) && !state.byId.has(raw) ? raw : null;
    if (mintQ) group('Contract address', [{ label: `Open token ${shortAddr(mintQ, 6)}`, icon: 'fa-magnifying-glass-dollar', hint: '', run: () => openByMint(mintQ) }], actHTML, false);
    if (q) { group('Tokens', toks, tokHTML, true); group('Actions', acts, actHTML, false); }
    else { group('Jump to', acts, actHTML, false); group('Most traded', toks, tokHTML, true); }
    if (!this.items.length) html = `<div class="scan-empty">Nothing matches “${esc(q)}”. Try a ticker like WIF, or paste a token's contract address.</div>`;
    $('#pal-list').innerHTML = html;
    this.sel = clamp(this.sel, 0, Math.max(0, this.items.length - 1));
    this.paintSel(true);
  },
  paintSel(scroll) {
    $$('.pal-item', $('#pal-list')).forEach((el) => {
      const on = +el.dataset.i === this.sel;
      el.classList.toggle('sel', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && scroll) el.scrollIntoView({ block: 'nearest' });
    });
  },
  move(d) { if (!this.items.length) return; this.sel = (this.sel + d + this.items.length) % this.items.length; this.paintSel(true); },
  run(i) { const fn = this.items[i]; if (!fn) return; this.close(); fn(); },
  open(q = '') {
    if (state.phase !== 'app') return;
    this.lastFocus = document.activeElement;
    this.isOpen = true;
    $('#palette').classList.add('open');
    const inp = $('#pal-input');
    inp.value = q; this.sel = 0; this.render();
    setTimeout(() => inp.focus(), 30);
  },
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    $('#palette').classList.remove('open');
    try { if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus({ preventScroll: true }); } catch { /* element gone */ }
  },
  toggle() { if (this.isOpen) this.close(); else this.open(); },
};


async function openByMint(mint) {
  toast({ type: 'info', title: 'Looking up that token', msg: `<span class="mono">${esc(shortAddr(mint, 6))}</span>`, duration: 2200 });
  try {
    const t = await Data.openMint(mint);
    if (!t) throw new Error('No market found for this token yet.');
    Router.go('terminal', { token: t.id });
  } catch (e) {
    toast({ type: 'error', title: "Couldn't open that token", msg: esc((e && e.message) || 'No market found for this address.') });
  }
}

/* =========================================================
   WALLET (real): Phantom, Solflare, Trust Wallet, Backpack and any
   Wallet Standard wallet. Non-custodial: keys never leave the wallet.
   ========================================================= */
function makeUser(address, walletName) {
  const prof = PREFS.profiles[address] || {};
  return {
    address, wallet: walletName || 'Wallet', sol: 0, solKnown: false,
    avatar: prof.avatar || { kind: 'preset', id: hashSeed(address) % AVATARS.length },
    customData: prof.customData || null,
    handle: prof.handle || 'trencher_' + address.slice(-4).toLowerCase(),
    joined: prof.joined || Date.now(),
    holdings: {}, balances: [], trades: [], serverTrades: [], localTrades: (PREFS.swaps[address] || []).slice(),
    realized: 0, stats: { trades: 0, wins: 0, losses: 0 }, pnl: [], launches: [], historyAt: 0, creatorFees: null,
  };
}

const Wallet = {
  isOpen: false, busy: false, lastFocus: null,
  init() {
    $('#wm-close').addEventListener('click', () => this.close());
    $('#wallet-modal').addEventListener('click', (e) => {
      if (e.target.id === 'wallet-modal') { this.close(); return; }
      const b = e.target.closest('[data-wallet]');
      if (b) { this.connect(b.dataset.wallet); return; }
      if (e.target.closest('[data-wm-back]')) { this.busy = false; this.renderList(); }
    });
    SN.wallet.subscribe((st) => this.onState(st));
    SN.wallet.onList(() => { if (this.isOpen && !this.busy) this.renderList(); });
  },
  open(pending, onCancel) {
    if (state.user) { if (typeof pending === 'function') pending(); return; }
    if (state.pendingCancel) { const c = state.pendingCancel; state.pendingCancel = null; try { c(); } catch { /* ignore */ } }
    state.pending = typeof pending === 'function' ? pending : null;
    state.pendingCancel = typeof onCancel === 'function' ? onCancel : null;
    this.busy = false;
    this.renderList();
    this.lastFocus = document.activeElement;
    this.isOpen = true;
    $('#wallet-modal').classList.add('open');
    setTimeout(() => { const f = $('#wm-body [data-wallet], #wm-body a'); if (f) f.focus(); }, 60);
  },
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.busy = false;
    state.pending = null;
    const cancel = state.pendingCancel;
    state.pendingCancel = null;
    $('#wallet-modal').classList.remove('open');
    try { if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus({ preventScroll: true }); } catch { /* gone */ }
    if (cancel) try { cancel(); } catch { /* ignore */ }
  },
  renderList() {
    const list = SN.wallet.list();
    const mobile = SN.wallet.isMobile();
    const installed = list.filter((w) => w.installed), sug = list.filter((w) => !w.installed);
    const ic = (w) => w.icon
      ? `<span class="wallet-ic" style="background:transparent"><img src="${esc(w.icon)}" alt="" style="width:100%;height:100%;border-radius:inherit"></span>`
      : `<span class="wallet-ic" style="background:${esc(w.color || 'linear-gradient(135deg,#4A5068,#161A27)')}">${esc(w.name.charAt(0))}</span>`;
    const row = (w) => w.installed
      ? `<button class="wallet-opt" data-wallet="${esc(w.id)}">${ic(w)}<span class="min-w-0"><span class="wn block">${esc(w.name)}</span><span class="wd block">Detected in this browser</span></span><i class="fa-solid fa-chevron-right ml-auto text-ink-3"></i></button>`
      : `<a class="wallet-opt" href="${esc(w.url || '#')}" ${mobile ? '' : 'target="_blank" rel="noopener"'}>${ic(w)}<span class="min-w-0"><span class="wn block">${esc(w.name)}</span><span class="wd block">${mobile ? `Open Supernova in ${esc(w.name)}` : 'Not installed: get the extension'}</span></span><i class="fa-solid fa-arrow-up-right-from-square ml-auto text-ink-3"></i></a>`;
    let html = installed.map(row).join('');
    if (sug.length) {
      const note = installed.length ? 'Other wallets' : mobile ? 'Open this page inside your wallet app to connect' : 'No Solana wallet found in this browser';
      html += `<div class="text-[11.5px] text-ink-3 mt-1 px-0.5">${note}</div>` + sug.map(row).join('');
    }
    $('#wm-body').innerHTML = html;
  },
  async connect(id) {
    if (this.busy) return;
    this.busy = true;
    const w = SN.wallet.list().find((x) => x.id === id);
    const name = w ? w.name : 'your wallet';
    $('#wm-body').innerHTML = `<div class="connecting"><div class="conn-orb"></div><div><div class="font-bold text-[15px]">Approve the connection in ${esc(name)}</div><div class="text-[12px] text-ink-3 mt-1">Supernova only sees your public address. Every transaction needs your approval in the wallet.</div></div></div>`;
    try {
      await SN.wallet.connect(id);
      const pending = state.pending;
      this.busy = false;
      this.isOpen = false;
      state.pending = null;
      state.pendingCancel = null;
      $('#wallet-modal').classList.remove('open');
      if (pending) setTimeout(pending, 300);
    } catch (e) {
      this.busy = false;
      const m = (e && e.message) || '';
      const msg = /reject|denied|cancel|declin/i.test(m) ? 'You declined the request in your wallet.' : esc(m || 'The wallet did not respond.');
      $('#wm-body').innerHTML = `<div class="connecting"><div class="feed-ic sell" style="width:46px;height:46px;flex:none"><i class="fa-solid fa-xmark"></i></div><div><div class="font-bold text-[15px]">Couldn't connect ${esc(name)}</div><div class="text-[12px] text-ink-3 mt-1">${msg}</div><button class="btn btn-ghost btn-sm mt-3" data-wm-back><i class="fa-solid fa-arrow-left"></i>Back to wallets</button></div></div>`;
    }
  },
  onState(st) {
    const prev = state.user;
    if (!st.address) {
      if (!prev) return;
      state.user = null;
      state.session = null;
      Account.stop();
      App.userChanged();
      toast({ type: 'info', title: 'Wallet disconnected', msg: 'Connect again any time to trade and launch.', action: { label: 'Connect', onClick: () => Wallet.open() } });
      return;
    }
    if (prev && prev.address === st.address) return;
    state.user = makeUser(st.address, st.name);
    state.session = null;
    for (const t of state.tokens) if (t.launch) t.kind = t.creator === st.address ? 'user' : 'launch';
    App.userChanged();
    Account.start();
    Session.check();
    if (state.phase === 'app') {
      toast({ type: 'success', title: prev ? 'Account switched' : 'Wallet connected', msg: `${esc(st.name || 'Wallet')} connected as <span class="mono">${esc(shortAddr(st.address))}</span>.` });
      if (state.cluster === 'devnet') setTimeout(() => toast({ type: 'info', icon: 'fa-flask', duration: 8000, title: 'Supernova is on devnet', msg: 'Switch your wallet to devnet (Phantom: Settings → Developer settings → Testnet mode). Devnet SOL is free.', action: { label: 'Get devnet SOL', onClick: () => Funding.airdrop() } }), 900);
    }
  },
  disconnect() { SN.wallet.disconnect().catch(() => {}); },
};

/* ---------- Sign-In With Solana (only when a feature needs it: AI analyst, Pro) ---------- */
const Session = {
  async check() {
    try {
      const me = await SN.wallet.me(true);
      if (state.user && me && me.address === state.user.address) { state.session = me; App.sessionChanged(); }
    } catch { /* not signed in */ }
  },
  async ensure() {
    if (!state.user) {
      await new Promise((res, rej) => Wallet.open(
        () => (state.user ? res() : rej(new Error('Connect a wallet first.'))),
        () => rej(Object.assign(new Error('Wallet connection cancelled.'), { code: 'cancelled' })),
      ));
    }
    if (state.session && state.session.address === state.user.address) return state.session;
    toast({ type: 'info', icon: 'fa-signature', title: 'Sign the message in your wallet', msg: 'It only proves you own this address. No transaction, no fee.', duration: 5000 });
    const s = await SN.wallet.signIn();
    state.session = s;
    App.sessionChanged();
    return s;
  },
  get pro() { return !!(state.session && state.session.pro && state.session.pro.active); },
};

/* ---------- balances, history and cost basis ---------- */
const Account = {
  timer: 0, busy: false, queued: false,
  start() { clearInterval(this.timer); this.timer = setInterval(() => { if (!document.hidden) this.refresh(); }, 20000); this.refresh(true); },
  stop() { clearInterval(this.timer); },
  soon(full = true) { setTimeout(() => this.refresh(full), 1500); setTimeout(() => this.refresh(full), 6000); },
  async refresh(full) {
    const u = state.user;
    if (!u) return;
    if (this.busy) { this.queued = true; return; }
    this.busy = true;
    try {
      const [sol, bals] = await Promise.all([SN.chain.solBalance(u.address), SN.chain.tokenHoldings(u.address)]);
      if (state.user !== u) return;
      u.sol = sol; u.solKnown = true; u.balances = bals;
      if (full || Date.now() - u.historyAt > 60000) await this.loadHistory(u);
      await this.priceUnknown(u);
      this.rebuild(u);
      Header.live();
      Header.renderWallet();
      Term.refreshUserBits();
      Launch.updateCost();
      if (state.view === 'profile') Profile.render();
    } catch (e) {
      console.warn('[Supernova] balance refresh failed:', e && e.message);
    } finally {
      this.busy = false;
      if (this.queued) { this.queued = false; setTimeout(() => this.refresh(false), 300); }
    }
  },
  async loadHistory(u) {
    const [tr, prof] = await Promise.all([SN.market.walletTrades(u.address).catch(() => null), SN.market.profile(u.address).catch(() => null)]);
    if (tr) u.serverTrades = (tr.trades || []).map((x) => ({ sig: x.sig, tokenId: x.mint, side: x.side, sol: +x.sol, tokens: +x.tokens, priceSol: +x.price, ts: x.ts, source: 'chain' }));
    if (prof) {
      for (const v of prof.launches || []) { const t = Data.upsert(v.mint, 'user'); applyLaunch(t, v); }
      u.launches = (prof.launches || []).map((v) => v.mint);
    }
    u.historyAt = Date.now();
  },
  async priceUnknown(u) {
    const unknown = u.balances.filter((b) => !state.byId.has(b.mint)).map((b) => b.mint).slice(0, 30);
    if (!unknown.length || !isMainnet()) return;
    const r = await SN.api.get('market/prices?mints=' + unknown.join(',')).catch(() => null);
    for (const m of unknown) {
      const p = r && r.prices && r.prices[m];
      if (!p) continue;
      const t = Data.upsert(m, 'external');
      t.symbol = cleanSym(p.symbol); t.name = String(p.name || t.symbol).slice(0, 40); t.logo = p.image || null;
      t.fallbackLogo = tokenLogo(t.symbol, m); setPrice(t, p.priceUsd); t.change24h = p.change24h || 0; t.pair = p.pair || null;
    }
  },
  /** Average-cost bookkeeping over the merged history (chain-indexed curve trades + this browser's Jupiter swaps). */
  rebuild(u) {
    const by = new Map();
    for (const x of [...(u.serverTrades || []), ...(u.localTrades || [])]) if (x && x.sig && !by.has(x.sig)) by.set(x.sig, { ...x });
    const trades = [...by.values()].sort((a, b) => a.ts - b.ts);
    const book = {};
    let realized = 0, wins = 0, losses = 0;
    const pnl = [];
    for (const x of trades) {
      const b = book[x.tokenId] || (book[x.tokenId] = { amount: 0, cost: 0 });
      if (x.side === 'buy') { b.amount += x.tokens; b.cost += x.sol; x.realized = null; }
      else {
        if (b.amount <= 0) { x.realized = null; continue; }
        const qty = Math.min(b.amount, x.tokens), frac = qty / b.amount, costPart = b.cost * frac;
        const r = x.sol * (qty / x.tokens) - costPart;
        realized += r; if (r >= 0) wins++; else losses++;
        b.amount -= qty; b.cost -= costPart; x.realized = r;
        pnl.push({ t: x.ts, v: +realized.toFixed(4) });
      }
    }
    const holdings = {};
    for (const bal of u.balances) {
      if (!state.byId.has(bal.mint)) continue;
      const b = book[bal.mint];
      const known = !!(b && b.amount > 0);
      const covered = known ? Math.min(1, b.amount / bal.amount) : 0;
      holdings[bal.mint] = { amount: bal.amount, decimals: bal.decimals, raw: bal.raw, cost: known ? b.cost * Math.min(1, bal.amount / b.amount) : 0, costKnown: known && covered > 0.98, partial: known && covered <= 0.98 };
    }
    u.holdings = holdings; u.trades = trades; u.realized = realized; u.stats = { trades: wins + losses, wins, losses }; u.pnl = pnl;
  },
  recordLocal(tr) {
    const u = state.user;
    if (!u) return;
    u.localTrades.push(tr);
    if (u.localTrades.length > 200) u.localTrades.shift();
    this.rebuild(u);
    saveSoon();
  },
};

/* ---------- funding: Apple Pay / card on-ramp (MoonPay) and the devnet faucet ---------- */
const Funding = {
  async buySol(amountUsd) {
    if (!state.user) { Wallet.open(() => this.buySol(amountUsd)); return; }
    if (!(state.cfg && state.cfg.features.moonpay)) { toast({ type: 'info', title: 'Card purchases are not enabled yet', msg: 'Most wallets (Phantom, Solflare, Trust Wallet) also sell SOL with Apple Pay or card right inside the app.' }); return; }
    // Open the tab synchronously (inside the click) so popup blockers allow it, then point it at the signed URL.
    // 'noopener' would make window.open return null, so the opener link is cut by hand instead.
    let win = null;
    try { win = window.open('about:blank', '_blank'); if (win) win.opener = null; } catch { win = null; }
    try {
      const url = await SN.pro.buySol(amountUsd);
      if (win && !win.closed) win.location.replace(url); else location.assign(url);
      toast({ type: 'info', icon: 'fa-credit-card', title: 'Finish the purchase in MoonPay', msg: 'Pay with Apple Pay, Google Pay or card. SOL arrives straight in your wallet; your balance updates automatically.', duration: 8000 });
      Account.soon();
    } catch (e) { if (win) win.close(); toast({ type: 'error', title: "Couldn't open the purchase", msg: esc(e.message || 'Try again in a moment.') }); }
  },
  async airdrop() {
    if (state.cluster !== 'devnet') return;
    if (!state.user) { Wallet.open(() => this.airdrop()); return; }
    toast({ type: 'info', icon: 'fa-faucet-drip', title: 'Requesting 1 devnet SOL', msg: 'The public faucet can be slow or rate limited.', duration: 3000 });
    try {
      await SN.chain.requestAirdrop(state.user.address, 1);
      toast({ type: 'success', title: '1 devnet SOL received', msg: 'Test SOL has no value. Use it to try launches and trades.' });
      Account.soon(false);
    } catch (e) {
      toast({ type: 'warn', title: 'Faucet is busy', msg: 'Try again in a minute or use faucet.solana.com.', action: { label: 'Open faucet', onClick: () => window.open('https://faucet.solana.com', '_blank', 'noopener') } });
    }
  },
};
/* =========================================================
   VIEW 1 · DISCOVER HUB
   ========================================================= */
const cap1 = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const SORTS = {
  vol: (t) => t.vol24h, mcap: (t) => t.mcap, price: (t) => t.price,
  ch1h: (t) => changeOver(t, 60), ch24h: (t) => t.change24h,
  curve: (t) => (t.graduated ? 100 : t.curve), name: (t) => t.name.toLowerCase(),
};
const heat = (t) => Math.abs(changeOver(t, 5)) * 1.6 + Math.abs(changeOver(t, 60)) * 0.6 + Math.log10(1 + t.vol24h) * 0.35 + (isLaunch(t) ? 1.2 : t.kind === 'trending' ? 0.6 : 0);

let SPARK_UID = 0;
function sparkPath(vals, w = 160, h = 54, pad = 6) {
  let mn = Infinity, mx = -Infinity;
  for (const v of vals) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = mx - mn || mx * 0.001 || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - pad - ((v - mn) / span) * (h - pad * 2)]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx2 = (pts[i][0] + pts[i + 1][0]) / 2, my2 = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx2.toFixed(1)} ${my2.toFixed(1)}`;
  }
  const L = pts[pts.length - 1];
  d += ` L${L[0].toFixed(1)} ${L[1].toFixed(1)}`;
  return { line: d, area: d + ` L${w} ${h} L0 ${h} Z`, lastY: L[1] / h };
}

function toggleWatch(id) {
  const t = tokenById(id);
  if (!t) return;
  const on = !state.watch.has(id);
  if (on) state.watch.add(id); else state.watch.delete(id);
  $$(`[data-watch="${CSS.escape(id)}"]`).forEach((b) => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = `<i class="fa-${on ? 'solid' : 'regular'} fa-star"></i>`;
  });
  toast({ type: on ? 'success' : 'info', icon: 'fa-star', title: on ? `$${t.symbol} added to your watchlist` : `$${t.symbol} removed from your watchlist`, duration: 2600 });
  if (state.scan.filter === 'watch') Hub.renderScanner(true);
  saveSoon();
}

const Hub = {
  inited: false, rows: new Map(), order: [], moverIds: [], movers: new Map(),
  countedUp: false, heroLive: false, lastSort: 0, lastPick: 0, lastTimes: 0,
  init() {
    $('#scan-filters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]'); if (!b) return;
      state.scan.filter = b.dataset.filter;
      $$('#scan-filters .chip').forEach((c) => c.classList.toggle('on', c === b));
      this.renderScanner(true);
    });
    $('#scan-search').addEventListener('input', debounce((e) => { state.scan.q = e.target.value.trim().toLowerCase(); this.renderScanner(true); }, 120));
    $$('.th-btn').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      if (state.scan.sort === k) state.scan.dir *= -1; else { state.scan.sort = k; state.scan.dir = k === 'name' ? 1 : -1; }
      this.paintSort();
      this.renderScanner(true);
    }));
    $('#feed-filters').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ff]'); if (!b) return;
      state.feedFilter = b.dataset.ff;
      $$('#feed-filters .chip').forEach((c) => c.classList.toggle('on', c === b));
      this.renderFeed();
    });
    $('#feed-pause').addEventListener('click', () => this.togglePause());
    $('#hero-terminal').addEventListener('click', () => Router.go('terminal', { token: this.moverIds[0] || defaultTokenId() }));
    bindTilt($('#movers'), '.mover');
    this.heroEye = mountEye($('#hero-eye'), { frame: true, alert: false, track: true, startOpen: 1 });
    this.paintSort();
    this.inited = true;
  },
  onShow() {
    if (!this.moverIds.length) this.pickMovers();
    this.renderMovers();
    this.renderScanner(true);
    this.renderFeed();
    if (!this.countedUp) {
      this.countedUp = true;
      const g = state.global;
      if (REDUCED) this.heroLive = true;
      else tween(1400, (e) => { setText($('#hs-vol'), fmtUSD(g.vol24h * e)); setText($('#hs-launch'), fmtInt(g.launches * e)); setText($('#hs-grad'), fmtInt(g.graduated * e)); }, Ease.outExpo).then(() => { this.heroLive = true; });
    }
    this.live(true);
  },

  /* ---------- live tick ---------- */
  live(force) {
    const now = performance.now();
    this.heroUpdate();
    for (const [id, m] of this.movers) { const t = tokenById(id); if (t) this.fillMover(t, m); }
    if (now - this.lastPick > 20000 && !force) { this.lastPick = now; const before = this.moverIds.join(); this.pickMovers(); if (this.moverIds.join() !== before) this.renderMovers(); }
    if (force || now - this.lastSort > 6000) { this.lastSort = now; this.renderScanner(false); }
    else for (const id of this.order) { const t = tokenById(id), r = this.rows.get(id); if (t && r) this.fillRow(t, r, true); }
    if (now - this.lastTimes > 4000) { this.lastTimes = now; $$('#feed-list [data-ts]').forEach((el) => setText(el, timeAgo(+el.dataset.ts))); this.flow(); }
  },
  heroUpdate() {
    const g = state.global, n = state.net;
    if (this.heroLive) { setText($('#hs-vol'), fmtUSD(g.vol24h)); setText($('#hs-launch'), fmtInt(g.launches)); setText($('#hs-grad'), fmtInt(g.graduated)); }
    const live = state.tokens.filter((t) => isLaunch(t) && t.vol24h > 0).length;
    setText($('#hs-vol-d'), `across ${fmtInt(live)} Supernova coin${live === 1 ? '' : 's'}`);
    setText($('#hs-launch-d'), '+' + fmtInt(g.launches24h));
    setText($('#hs-fill'), n.rpc ? n.rpc + 'ms' : '—');
    setText($('#hs-tps'), n.tps ? fmtInt(n.tps) : '—');
    setText($('#hero-slot'), n.slot ? fmtInt(n.slot) : '—');
    setText($('#hero-net'), state.cluster === 'mainnet' ? 'Solana mainnet' : 'Solana devnet (test mode)');
  },

  /* ---------- top movers ---------- */
  pickMovers() {
    const prev = new Set(this.moverIds);
    this.moverIds = state.tokens.filter((t) => t.price > 0 && t.vol24h > 0).sort((a, b) => heat(b) - heat(a)).slice(0, 4).map((t) => t.id);
    for (const id of this.moverIds) if (!prev.has(id)) { const t = tokenById(id); if (t && !t.spark) Data.loadSpark(t).then(() => { const m = this.movers.get(id); if (m) this.fillMover(t, m); }).catch(() => {}); }
  },
  moverHTML(t) {
    const u = 'sg' + ++SPARK_UID;
    return `<div class="mover panel spot" role="button" tabindex="0" data-token="${esc(t.id)}" aria-label="Open ${esc(t.symbol)} in the terminal">
      <div class="mover-top">${logoImg(t)}<div class="min-w-0"><div class="mover-name">${esc(t.name)}</div><div class="mover-sym mono">$${esc(t.symbol)}</div></div><span class="mover-chg mono" data-f="chg"></span></div>
      <div class="mover-price mono" data-f="price"></div>
      <div class="spark-wrap" data-f="sw"><svg class="spark" viewBox="0 0 160 54" preserveAspectRatio="none" data-f="spark"><defs><linearGradient id="${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" data-f="g0" stop-opacity=".34"/><stop offset="1" data-f="g1" stop-opacity="0"/></linearGradient></defs><path data-f="area" fill="url(#${u})"/><path class="sl" data-f="line"/></svg><span class="spark-dot" data-f="dot"></span></div>
      <div class="mover-curve"><div class="flex justify-between"><span data-f="cl">Bonding curve</span><span class="mono" data-f="cv"></span></div><div class="curve-bar" data-f="cb"><i data-f="cbi"></i></div></div>
      <div class="mover-meta mono"><span>MC <b data-f="mc"></b></span><span>Vol <b data-f="vol"></b></span><span>Liq <b data-f="hold"></b></span></div>
    </div>`;
  },
  renderMovers() {
    const box = $('#movers');
    box.innerHTML = this.moverIds.map(tokenById).filter(Boolean).map((t) => this.moverHTML(t)).join('');
    this.movers.clear();
    $$('.mover', box).forEach((el, i) => {
      const f = {};
      el.querySelectorAll('[data-f]').forEach((x) => { f[x.dataset.f] = x; });
      const m = { el, f, last: {} };
      this.movers.set(el.dataset.token, m);
      this.fillMover(tokenById(el.dataset.token), m);
      if (!REDUCED && el.animate) el.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 650, delay: i * 70, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' });
    });
  },
  fillMover(t, m) {
    const f = m.f, L = m.last;
    const price = '$' + fmtPrice(t.price);
    if (L.price !== price) { f.price.textContent = price; if (L.price) flash(f.price, t.lastDir); L.price = price; }
    setText(f.chg, fmtPct(t.change24h)); setDir(f.chg, t.change24h);
    let vals = t.spark && t.spark.length >= 2 ? t.spark.slice() : t.candles && t.candles.length >= 2 ? t.candles.slice(-40).map((c) => c.close) : [t.open24h || t.price, t.price];
    vals[vals.length - 1] = t.price;
    if (vals.length < 2) vals = [t.price, t.price];
    const up = vals[vals.length - 1] >= vals[0];
    const sp = sparkPath(vals);
    f.line.setAttribute('d', sp.line);
    f.area.setAttribute('d', sp.area);
    if (L.up !== up) {
      L.up = up;
      f.spark.classList.toggle('up', up); f.spark.classList.toggle('down', !up);
      const col = up ? C.green : C.red;
      f.g0.setAttribute('stop-color', col); f.g1.setAttribute('stop-color', col);
      f.sw.classList.toggle('up', up); f.sw.classList.toggle('down', !up);
    }
    f.dot.style.top = (sp.lastY * 100).toFixed(1) + '%';
    if (t.graduated) {
      if (L.grad !== true) { L.grad = true; setText(f.cl, isLaunch(t) ? 'Graduated to Raydium' : (t.dex ? cap1(t.dex) + ' pool' : 'DEX pool')); f.cb.classList.add('grad'); f.cbi.style.width = '100%'; setText(f.cv, isLaunch(t) ? '100%' : 'Live'); }
    } else {
      L.grad = false;
      f.cb.classList.remove('grad');
      f.cbi.style.width = t.curve.toFixed(1) + '%';
      setText(f.cv, t.curve.toFixed(1) + '%');
    }
    setText(f.mc, fmtUSD(t.mcap)); setText(f.vol, fmtUSD(t.vol24h)); setText(f.hold, fmtUSD(t.liquidity));
  },

  /* ---------- scanner ---------- */
  paintSort() {
    $$('.th-btn').forEach((b) => {
      const on = b.dataset.sort === state.scan.sort;
      b.classList.toggle('on', on);
      b.dataset.dir = on ? (state.scan.dir > 0 ? 'asc' : 'desc') : '';
      const label = b.textContent.replace(/[▲▼]/g, '').trim();
      b.textContent = label + (on ? (state.scan.dir > 0 ? ' ▲' : ' ▼') : '');
    });
  },
  filtered() {
    const { filter, q } = state.scan;
    const now = Date.now();
    let list = state.tokens.filter((t) => t.price > 0 || isLaunch(t));
    if (filter === 'trending') list = list.filter((t) => t.kind === 'trending' || (isLaunch(t) && now - t.createdAt < 24 * 3600e3)).sort((a, b) => heat(b) - heat(a)).slice(0, 20);
    else if (filter === 'launches') list = list.filter((t) => isLaunch(t));
    else if (filter === 'graduated') list = list.filter((t) => isLaunch(t) && t.graduated);
    else if (filter === 'watch') list = list.filter((t) => state.watch.has(t.id));
    if (q) list = list.filter((t) => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q));
    const fn = SORTS[state.scan.sort] || SORTS.vol, d = state.scan.dir;
    return list.sort((a, b) => { const x = fn(a), y = fn(b); return (x < y ? -1 : x > y ? 1 : 0) * d; });
  },
  makeRow(t) {
    const tr = document.createElement('tr');
    tr.dataset.token = t.id;
    tr.tabIndex = 0;
    tr.setAttribute('role', 'button');
    tr.setAttribute('aria-label', `Open ${t.symbol} in the terminal`);
    const w = state.watch.has(t.id);
    const isNew = isLaunch(t) && Date.now() - t.createdAt < 60 * 60000;
    const badge = t.kind === 'user' ? '<span class="badge badge-mine">Yours</span>' : isNew ? '<span class="badge badge-new">New</span>' : isLaunch(t) ? '<span class="badge badge-curve">Supernova</span>' : '';
    tr.innerHTML =
      `<td><button class="icon-btn sm ${w ? 'on' : ''}" data-watch="${esc(t.id)}" aria-pressed="${w}" aria-label="Watch ${esc(t.symbol)}"><i class="fa-${w ? 'solid' : 'regular'} fa-star"></i></button></td>` +
      `<td class="scan-rank" data-c="rank"></td>` +
      `<td><div class="scan-tok">${logoImg(t)}<div class="min-w-0"><div class="flex items-center gap-1.5"><span class="nm">${esc(t.name)}</span>${badge}</div><div class="sy">$${esc(t.symbol)}</div></div></div></td>` +
      `<td data-c="price"></td><td data-c="ch1h"></td><td data-c="ch24h"></td><td data-c="vol"></td><td data-c="mcap"></td>` +
      `<td><div class="mini-curve"><span data-c="cl"></span><div class="curve-bar" data-c="cb"><i data-c="cbi"></i></div></div></td>` +
      `<td><button class="btn btn-ghost btn-sm" data-token="${esc(t.id)}">Trade</button></td>`;
    const cells = {};
    tr.querySelectorAll('[data-c]').forEach((el) => { cells[el.dataset.c] = el; });
    const row = { tr, cells, last: {} };
    this.rows.set(t.id, row);
    this.fillRow(t, row, false);
    return row;
  },
  fillRow(t, row, fl) {
    const c = row.cells, L = row.last;
    const price = '$' + fmtPrice(t.price);
    if (L.price !== price) { c.price.textContent = price; if (fl && L.price) flash(c.price, t.lastDir); L.price = price; }
    const h1 = changeOver(t, 60);
    setText(c.ch1h, fmtPct(h1)); setDir(c.ch1h, h1);
    setText(c.ch24h, fmtPct(t.change24h)); setDir(c.ch24h, t.change24h);
    setText(c.vol, fmtUSD(t.vol24h));
    setText(c.mcap, fmtUSD(t.mcap));
    if (t.graduated) {
      if (!L.grad) { L.grad = true; c.cl.textContent = isLaunch(t) ? 'Graduated' : 'Pool'; c.cl.className = 'text-neon-green'; c.cb.classList.add('grad'); c.cbi.style.width = '100%'; }
    } else {
      setText(c.cl, t.curve.toFixed(1) + '%');
      c.cbi.style.width = t.curve.toFixed(1) + '%';
    }
  },
  renderScanner(force) {
    const list = this.filtered();
    for (const t of list) if (!this.rows.has(t.id)) this.makeRow(t);
    const ids = list.map((t) => t.id);
    if (force || ids.join() !== this.order.join()) this.reorder(list, !force);
    this.order = ids;
    for (const t of list) this.fillRow(t, this.rows.get(t.id), !force);
    const empty = $('#scan-empty');
    empty.hidden = list.length > 0;
    if (!list.length) {
      const f = state.scan.filter;
      empty.innerHTML = f === 'watch' && !state.scan.q
        ? 'Your watchlist is empty. Tap the star on any row to pin a token here.'
        : (f === 'launches' || f === 'graduated') && !state.scan.q
          ? `No Supernova coins ${f === 'graduated' ? 'have graduated' : 'are live'} yet. <button class="btn btn-primary btn-sm ml-2" data-nav="launch"><i class="fa-solid fa-rocket"></i>Launch the first one</button>`
          : state.dataSource === 'loading' ? 'Loading live markets…'
          : `No tokens match this filter. <button class="btn btn-ghost btn-sm ml-2" id="scan-reset">Show all tokens</button>`;
      const rb = $('#scan-reset');
      if (rb) rb.addEventListener('click', () => { state.scan.filter = 'all'; state.scan.q = ''; $('#scan-search').value = ''; $$('#scan-filters .chip').forEach((c) => c.classList.toggle('on', c.dataset.filter === 'all')); this.renderScanner(true); });
    }
  },
  reorder(list, animate) {
    const body = $('#scan-body');
    const first = new Map();
    const anim = animate && !REDUCED && state.view === 'hub';
    if (anim) for (const t of list) { const r = this.rows.get(t.id); if (r.tr.isConnected) first.set(t.id, r.tr.getBoundingClientRect().top); }
    const keep = new Set(list.map((t) => t.id));
    for (const [id, r] of this.rows) if (!keep.has(id) && r.tr.isConnected) r.tr.remove();
    list.forEach((t, i) => { const r = this.rows.get(t.id); setText(r.cells.rank, String(i + 1)); body.appendChild(r.tr); });
    if (!anim) return;
    for (const t of list) {
      const r = this.rows.get(t.id), f = first.get(t.id);
      if (f == null) { r.tr.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450 }); continue; }
      const dy = f - r.tr.getBoundingClientRect().top;
      if (Math.abs(dy) > 2) r.tr.animate([{ transform: `translateY(${dy.toFixed(0)}px)` }, { transform: 'translateY(0)' }], { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  },
  dropRow(id) { const r = this.rows.get(id); if (r) { r.tr.remove(); this.rows.delete(id); } this.order = this.order.filter((x) => x !== id); if (this.moverIds.includes(id)) { this.moverIds = this.moverIds.filter((x) => x !== id); if (state.view === 'hub') this.renderMovers(); } },

  /* ---------- smart money feed ---------- */
  feedMatch(ev) {
    const f = state.feedFilter;
    if (f === 'all') return true;
    if (ev.type !== 'trade') return false;
    return f === 'whale' ? ev.whale : ev.side === f;
  },
  feedHTML(ev, enter) {
    const t = tokenById(ev.tokenId);
    if (!t) return '';
    const cls = enter ? ' enter' : '';
    const time = `<div class="feed-time" data-ts="${ev.ts}">${timeAgo(ev.ts)}</div>`;
    if (ev.type === 'launch') return `<div class="feed-item${cls}" role="button" tabindex="0" data-token="${esc(t.id)}" aria-label="New launch ${esc(t.symbol)}"><div class="feed-ic launch"><i class="fa-solid fa-rocket"></i></div><div class="min-w-0"><div class="feed-line"><span class="feed-tag">New launch</span><span class="mono">${esc(shortAddr(ev.wallet))}</span></div><div class="feed-desc">Deployed <b>$${esc(t.symbol)}</b> on the curve</div></div><div><div class="feed-amt text-neon-cyan">${fmtUSD(t.mcap)}</div>${time}</div></div>`;
    if (ev.type === 'grad') return `<div class="feed-item${cls}" role="button" tabindex="0" data-token="${esc(t.id)}" aria-label="${esc(t.symbol)} graduated"><div class="feed-ic launch"><i class="fa-solid fa-graduation-cap"></i></div><div class="min-w-0"><div class="feed-line"><span class="feed-tag">Graduation</span></div><div class="feed-desc"><b>$${esc(t.symbol)}</b> migrated to Raydium</div></div><div><div class="feed-amt up">${fmtUSD(t.mcap)}</div>${time}</div></div>`;
    const buy = ev.side === 'buy';
    return `<div class="feed-item ${ev.side}${ev.whale ? ' whale' : ''}${cls}" role="button" tabindex="0" data-token="${esc(t.id)}" aria-label="${esc(ev.tag)} ${buy ? 'bought' : 'sold'} ${esc(t.symbol)}"><div class="feed-ic ${ev.side}"><i class="fa-solid ${ev.icon}"></i></div><div class="min-w-0"><div class="feed-line"><span class="feed-tag">${esc(ev.tag)}</span><span class="mono">${esc(shortAddr(ev.wallet))}</span></div><div class="feed-desc">${buy ? 'Bought' : 'Sold'} <b class="mono">${fmtSOL(ev.sol)} SOL</b> of <b>$${esc(t.symbol)}</b></div></div><div><div class="feed-amt ${buy ? 'up' : 'down'}">${buy ? '+' : '−'}${fmtUSD(ev.usd || ev.sol * state.solPrice)}</div>${time}</div></div>`;
  },
  renderFeed() {
    $('#feed-list').innerHTML = state.feed.filter((e) => this.feedMatch(e)).slice(0, 40).map((e) => this.feedHTML(e, false)).join('') || '<div class="empty"><span>No Supernova trades yet. Every buy, sell and launch on our curves shows up here the moment it lands on-chain.</span></div>';
    this.flow();
  },
  feedInsert(ev) {
    this.flow();
    if (!this.feedMatch(ev)) return;
    const list = $('#feed-list');
    const emptyNote = list.querySelector('.empty');
    if (emptyNote) emptyNote.remove();
    list.insertAdjacentHTML('afterbegin', this.feedHTML(ev, !REDUCED));
    while (list.children.length > 40) list.lastElementChild.remove();
  },
  flow() {
    let b = 0, s = 0, n = 0;
    for (const e of state.feed) { if (e.type !== 'trade') continue; const usd = e.usd || e.sol * state.solPrice; if (e.side === 'buy') b += usd; else s += usd; if (++n >= 40) break; }
    const tot = b + s || 1;
    $('#flow-b').style.width = ((b / tot) * 100).toFixed(1) + '%';
    $('#flow-s').style.width = ((s / tot) * 100).toFixed(1) + '%';
    const net = b - s, el = $('#flow-net');
    setText(el, (net >= 0 ? '+' : '−') + fmtUSD(Math.abs(net)));
    setDir(el, net);
  },
  togglePause() {
    state.feedPaused = !state.feedPaused;
    const btn = $('#feed-pause');
    btn.innerHTML = `<i class="fa-solid fa-${state.feedPaused ? 'play' : 'pause'}"></i>`;
    btn.setAttribute('aria-label', state.feedPaused ? 'Resume feed' : 'Pause feed');
    $('#feed-dot').style.animationPlayState = state.feedPaused ? 'paused' : 'running';
    if (!state.feedPaused) { state.feedMissed = 0; this.renderFeed(); }
    this.pausedNote();
  },
  pausedNote() {
    const el = $('#feed-paused');
    el.hidden = !state.feedPaused;
    el.textContent = state.feedMissed ? `Paused, ${state.feedMissed} new` : 'Paused';
  },
};


/* =========================================================
   VIEW 2 · PRO TERMINAL (live chart, depth, tape, real execution)
   ========================================================= */
const pad2 = (n) => String(n).padStart(2, '0');
function priceFormatFor(p) {
  const prec = !(p > 0) ? 6 : p >= 1000 ? 2 : p >= 1 ? 4 : clamp(Math.ceil(-Math.log10(p)) + 4, 4, 14);
  return { type: 'price', precision: prec, minMove: +Math.pow(10, -prec).toFixed(prec) };
}
function emaArr(vals, n) {
  const k = 2 / (n + 1), out = new Array(vals.length);
  let e = vals[0];
  for (let i = 0; i < vals.length; i++) { e = i ? vals[i] * k + e * (1 - k) : vals[0]; out[i] = e; }
  return out;
}
const volColor = (b) => (b.close >= b.open ? 'rgba(0,255,163,0.3)' : 'rgba(255,59,105,0.3)');
const tfSeconds = () => ({ 1: 60, 5: 300, 15: 900, 60: 3600 })[state.chart.iv] || 60;
const DEPTH_SIZES = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25];
const isRejection = (e) => /reject|denied|cancel|declin|User rejected/i.test((e && (e.message || e.name)) || '');
const toRaw = (amount, decimals) => {
  const [i, f = ''] = String(amount).split('.');
  const s = (i.replace(/^0+(?=\d)/, '') || '0') + f.padEnd(decimals, '0').slice(0, decimals);
  return s.replace(/^0+(?=\d)/, '') || '0';
};

const Term = {
  inited: false, chart: null, cs: null, vs: null, es: null, mk: null, wm: null, avgLine: null,
  loadedId: null, loadedTf: null, emaPrev: 0, emaCur: 0, hovering: false, mag: 0, lastBar: null, seriesSeq: 0,
  askRows: [], bidRows: [], levels: null, timers: [], running: false, executing: false, btnLabel: null,
  headEls: null, headLast: {}, posEls: null, tapeSeen: new Set(),
  quoteRes: null, quoteKey: '', quoteErr: null, quoteBusy: false, quoteSeq: 0, qT: 0, aiEye: null,

  init() {
    $('#iv-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-iv]'); if (!b) return; state.chart.iv = +b.dataset.iv; this.paintToolbar(); this.loadSeries(true); saveSoon(); });
    $('#tg-ema').addEventListener('click', () => { state.chart.ema = !state.chart.ema; this.paintToolbar(); if (this.es) this.es.applyOptions({ visible: state.chart.ema }); this.legend(null); saveSoon(); });
    $('#tg-vol').addEventListener('click', () => { state.chart.vol = !state.chart.vol; this.paintToolbar(); if (this.vs) this.vs.applyOptions({ visible: state.chart.vol }); saveSoon(); });
    $('#chart-expand').addEventListener('click', () => this.toggleExpand());
    $('#side-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-side]'); if (b) this.setSide(b.dataset.side); });
    $('#quick').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) this.quick(b.dataset.q); });
    $('#amt-input').addEventListener('input', (e) => {
      let v = e.target.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
      const parts = v.split('.');
      if (parts.length > 2) v = parts[0] + '.' + parts.slice(1).join('');
      if (v !== e.target.value) e.target.value = v;
      this.scheduleQuote();
    });
    $('#amt-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.execute(); });
    $('#slip-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-slip]'); if (!b) return; state.trade.slip = +b.dataset.slip; $('#slip-custom').value = ''; this.paintExecControls(); this.scheduleQuote(); saveSoon(); });
    $('#slip-custom').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value.replace(',', '.'));
      if (isFinite(v) && v > 0) { state.trade.slip = clamp(v, 0.1, 50); this.paintExecControls(); this.scheduleQuote(); saveSoon(); }
    });
    $('#mev-switch').addEventListener('click', () => {
      if (!isMainnet()) { toast({ type: 'info', title: 'MEV shield is mainnet only', msg: 'Jito bundles do not exist on devnet. Trades here go straight to the RPC.', duration: 3800 }); return; }
      state.trade.mev = !state.trade.mev; this.paintExecControls(); this.renderQuote();
      if (!state.trade.mev) toast({ type: 'warn', title: 'MEV shield is off', msg: 'Curve trades now go to the public RPC path, where searchers can see them before they land.', duration: 4200 });
      saveSoon();
    });
    $('#prio-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-prio]'); if (!b) return; state.trade.prio = b.dataset.prio; this.paintExecControls(); this.renderQuote(); saveSoon(); });
    $('#exec-btn').addEventListener('click', () => this.execute());
    $('#close-pos').addEventListener('click', () => this.closePosition());
    $('#ob').addEventListener('click', (e) => { const row = e.target.closest('.ob-row'); if (row) this.bookClick(row); });
    $('#exec-panel').addEventListener('click', (e) => {
      if (e.target.closest('[data-buysol]')) Funding.buySol();
      else if (e.target.closest('[data-airdrop]')) Funding.airdrop();
    });
    this.aiEye = mountEye($('#ai-eye'), { frame: false, alert: false, track: true, startOpen: 1 });
    this.buildBook();
    this.paintToolbar();
    this.paintExecControls();
    this.inited = true;
  },

  /* ---------- lifecycle ---------- */
  setToken(id) {
    const t = tokenById(id);
    if (!t) return;
    state.activeId = id;
    this.tapeSeen = new Set();
    $('#tape').innerHTML = '';
    setText($('#tape-rate'), '—');
    $('#amt-input').value = '';
    this.quoteRes = null; this.quoteErr = null;
    this.renderHead();
    this.renderExec();
    this.renderPos();
    this.renderIntel(true);
    this.tickBook();
    AI.reset();
    if (this.cs) this.loadSeries(true);
    if (this.running) { this.pollTape(); this.refreshActive(); }
    saveSoon();
  },
  onShow() {
    if (!state.byId.has(state.activeId)) { const d = defaultTokenId(); if (d) this.setToken(d); }
    this.ensureChart();
    if (this.cs && (this.loadedId !== state.activeId || this.loadedTf !== IV_TF[state.chart.iv])) this.loadSeries(true);
    this.renderHead(); this.renderExec(); this.renderPos(); this.renderIntel(false);
    this.start();
  },
  onHide() { this.stop(); if ($('#chart-panel').classList.contains('expanded')) this.toggleExpand(false); },
  start() {
    if (this.running) return;
    this.running = true;
    const every = (ms, fn) => this.timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms));
    this.pollTape(); this.refreshActive();
    every(4000, () => this.refreshActive());
    every(6000, () => this.pollTape());
    every(12000, () => this.loadSeries(false));
    every(60000, () => this.renderIntel(false));
  },
  stop() { this.running = false; this.timers.forEach(clearInterval); this.timers = []; },
  /** Faster price updates for the coin on screen. */
  async refreshActive() {
    const t = activeToken();
    if (!t) return;
    try {
      if (isLaunch(t)) {
        const r = await SN.market.launch(t.id);
        if (r.launch && state.activeId === t.id) { if (applyLaunch(t, r.launch)) Data.onGraduated(t); }
      } else if (t.kind !== 'major' || Date.now() - t.dataAt > 9000) {
        const r = await SN.market.token(t.id);
        if (r.pair && state.activeId === t.id) applyPair(t, r.pair);
      }
    } catch { /* keep the last good data */ }
    if (state.activeId === t.id) { this.tickBook(); this.headLive(); }
  },
  live() {
    const t = activeToken();
    if (!t) return;
    this.headLive();
    this.liveChart(t);
    this.posLive();
  },
  refreshUserBits() {
    if (!this.inited) return;
    this.refreshBalance(); this.btnLabel = null; this.renderQuote(); this.renderPos(); this.updateAvgLine();
    const t = activeToken();
    if (this.mk && t) this.mk.setMarkers(this.markersFor(t));
  },

  /* ---------- chart ---------- */
  ensureChart() {
    if (this.chart) return true;
    const LC = window.LightweightCharts;
    if (!LC) { $('#chart-offline').hidden = false; return false; }
    this.chart = LC.createChart($('#tv-chart'), {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: 'rgba(142,148,170,0.95)', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: 'rgba(255,255,255,0.035)' }, horzLines: { color: 'rgba(255,255,255,0.035)' } },
      crosshair: {
        mode: LC.CrosshairMode.Normal,
        vertLine: { color: 'rgba(0,243,255,0.42)', width: 1, style: LC.LineStyle.Dashed, labelBackgroundColor: '#0A2A33' },
        horzLine: { color: 'rgba(0,243,255,0.42)', width: 1, style: LC.LineStyle.Dashed, labelBackgroundColor: '#0A2A33' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.07)', scaleMargins: { top: 0.12, bottom: 0.22 } },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.07)', timeVisible: true, secondsVisible: false, rightOffset: 6, barSpacing: 8, minBarSpacing: 2,
        tickMarkFormatter: (time) => { const d = new Date(time * 1000); return state.chart.iv >= 60 ? fmtDay(d) + ' ' + pad2(d.getHours()) + 'h' : pad2(d.getHours()) + ':' + pad2(d.getMinutes()); },
      },
      localization: {
        priceFormatter: (p) => fmtPrice(p),
        timeFormatter: (time) => { const d = new Date(time * 1000); return fmtDay(d) + '  ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); },
      },
    });
    this.cs = this.chart.addSeries(LC.CandlestickSeries, {
      upColor: C.green, downColor: C.red, borderVisible: false,
      wickUpColor: 'rgba(0,255,163,0.85)', wickDownColor: 'rgba(255,59,105,0.85)',
      priceLineColor: 'rgba(0,243,255,0.75)', priceLineStyle: LC.LineStyle.Dotted,
    });
    this.vs = this.chart.addSeries(LC.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false, visible: state.chart.vol });
    this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    this.es = this.chart.addSeries(LC.LineSeries, { color: 'rgba(168,85,247,0.95)', lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, visible: state.chart.ema });
    this.mk = LC.createSeriesMarkers(this.cs, []);
    try { this.wm = LC.createTextWatermark(this.chart.panes()[0], { horzAlign: 'center', vertAlign: 'center', lines: [] }); } catch { this.wm = null; }
    this.chart.subscribeCrosshairMove((p) => this.onCross(p));
    return true;
  },
  seriesQuery(t) {
    const tf = IV_TF[state.chart.iv] || '1m';
    if (isLaunch(t) && (onCurve(t) || !t.pair)) return { mint: t.id, tf };
    if (t.pair) return { pool: t.pair, mint: t.id, tf };
    return null;
  },
  async loadSeries(force) {
    const t = activeToken();
    if (!t || !this.cs) return;
    const q = this.seriesQuery(t);
    const tf = IV_TF[state.chart.iv] || '1m';
    if (!q) { t.candles = []; t.candlesTf = tf; this.loadChart(); return; }
    const seq = ++this.seriesSeq;
    if (force) setText($('#chart-src'), 'Loading…');
    try {
      const r = await SN.market.candles(q);
      if (seq !== this.seriesSeq || state.activeId !== t.id) return;
      t.candles = (r.candles || []).filter((c) => c.close > 0).map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 }));
      t.candlesTf = tf; t.candlesAt = Date.now(); t.candleSource = r.source;
      if (t.price > 0 && t.candles.length) {
        const step = tfSeconds(), now = Math.floor(Date.now() / 1000 / step) * step, L = t.candles[t.candles.length - 1];
        if (L.time === now) { L.close = t.price; L.high = Math.max(L.high, t.price); L.low = Math.min(L.low, t.price); }
      }
      if (force || this.loadedId !== t.id || this.loadedTf !== tf) this.loadChart(); else this.mergeChart(t);
    } catch (e) {
      if (seq !== this.seriesSeq) return;
      if (force || this.loadedId !== t.id) { t.candles = []; t.candlesTf = tf; this.loadChart(e && e.message); }
    }
  },
  loadChart(errMsg) {
    const t = activeToken();
    if (!t || !this.cs) return;
    const cs = t.candles || [];
    const tf = IV_TF[state.chart.iv] || '1m';
    const ref = t.price || (cs.length ? cs[cs.length - 1].close : 0);
    this.mag = ref > 0 ? Math.floor(Math.log10(ref)) : 0;
    this.cs.applyOptions({ priceFormat: priceFormatFor(ref) });
    this.cs.setData(cs.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    this.vs.setData(cs.map((c) => ({ time: c.time, value: c.volume, color: volColor(c) })));
    const ema = cs.length ? emaArr(cs.map((c) => c.close), 20) : [];
    this.es.setData(cs.map((c, i) => ({ time: c.time, value: ema[i] })));
    this.emaCur = ema.length ? ema[ema.length - 1] : 0;
    this.emaPrev = ema.length > 1 ? ema[ema.length - 2] : this.emaCur;
    const last = cs[cs.length - 1];
    this.lastBar = last ? { ...last } : null;
    this.mk.setMarkers(this.markersFor(t));
    const src = t.candleSource === 'chain' ? 'On-chain trades' : t.candleSource === 'geckoterminal' ? 'GeckoTerminal' : '';
    setText($('#chart-src'), cs.length ? src : errMsg ? 'Chart unavailable' : 'No trades yet');
    if (this.wm) this.wm.applyOptions({ lines: [
      { text: t.symbol + '/USD', color: 'rgba(255,255,255,0.045)', fontSize: 64, fontFamily: 'Inter, sans-serif', fontStyle: '900' },
      { text: cs.length ? tf + '   SUPERNOVA' : (errMsg ? 'CHART UNAVAILABLE' : 'WAITING FOR THE FIRST TRADE'), color: 'rgba(0,243,255,0.09)', fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontStyle: '600' },
    ] });
    const n = cs.length;
    if (n) this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(-4, n - 110), to: n + 5 });
    this.loadedId = t.id; this.loadedTf = tf;
    this.updateAvgLine();
    this.legend(null);
  },
  /** Refresh without resetting the view: update existing bars and append new ones. */
  mergeChart(t) {
    const cs = t.candles || [];
    if (!cs.length) return;
    if (!this.lastBar) { this.loadChart(); return; }
    const from = cs.findIndex((c) => c.time >= this.lastBar.time);
    if (from < 0) return;
    try {
      for (let i = from; i < cs.length; i++) {
        const c = cs[i];
        this.cs.update({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
        this.vs.update({ time: c.time, value: c.volume, color: volColor(c) });
        if (c.time !== this.lastBar.time) this.emaPrev = this.emaCur;
        this.emaCur = c.close * (2 / 21) + this.emaPrev * (19 / 21);
        this.es.update({ time: c.time, value: this.emaCur });
        this.lastBar = { ...c };
      }
    } catch { this.loadChart(); return; }
    if (!this.hovering) this.legend(null);
  },
  /** Moves the forming candle with the live price between candle refreshes. */
  liveChart(t) {
    if (!this.cs || this.loadedId !== t.id || !this.lastBar || !(t.price > 0)) return;
    const step = tfSeconds();
    const now = Math.floor(Date.now() / 1000 / step) * step;
    const p = t.price;
    let bar;
    if (now > this.lastBar.time) {
      if (p === this.lastBar.close) return; // no new print: don't invent flat candles
      bar = { time: now, open: this.lastBar.close, high: Math.max(this.lastBar.close, p), low: Math.min(this.lastBar.close, p), close: p, volume: 0 };
      this.emaPrev = this.emaCur;
    } else {
      if (p === this.lastBar.close) return;
      bar = { ...this.lastBar, close: p, high: Math.max(this.lastBar.high, p), low: Math.min(this.lastBar.low, p) };
    }
    try {
      this.cs.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
      this.emaCur = bar.close * (2 / 21) + this.emaPrev * (19 / 21);
      this.es.update({ time: bar.time, value: this.emaCur });
    } catch { return; }
    this.lastBar = bar;
    const mag = Math.floor(Math.log10(p));
    if (mag !== this.mag) { this.mag = mag; this.cs.applyOptions({ priceFormat: priceFormatFor(p) }); }
    if (!this.hovering) this.legend(null);
  },
  onCross(p) {
    const d = p && p.time && p.seriesData ? p.seriesData.get(this.cs) : null;
    if (!d) { this.hovering = false; this.legend(null); return; }
    this.hovering = true;
    const vd = p.seriesData.get(this.vs);
    this.legend({ ...d, volume: vd ? vd.value : null });
  },
  legend(bar) {
    const t = activeToken(), b = bar || this.lastBar;
    if (!t) return;
    if (!b) { $('#chart-legend').innerHTML = `<span><b class="text-ink">${esc(t.symbol)}/USD</b> ${IV_TF[state.chart.iv]}</span><span>${t.price > 0 ? 'Price <b>' + fmtPrice(t.price) + '</b>' : 'No price yet'}</span>`; return; }
    const ch = (b.close / b.open - 1) * 100, dc = dirClass(ch);
    $('#chart-legend').innerHTML =
      `<span><b class="text-ink">${esc(t.symbol)}/USD</b> ${IV_TF[state.chart.iv]}</span><span>O <b>${fmtPrice(b.open)}</b></span><span>H <b>${fmtPrice(b.high)}</b></span>` +
      `<span>L <b>${fmtPrice(b.low)}</b></span><span>C <b class="${dc}">${fmtPrice(b.close)}</b></span><span class="${dc}">${fmtPct(ch)}</span>` +
      (b.volume ? `<span>Vol <b>${fmtUSD(b.volume)}</b></span>` : '') +
      (state.chart.ema && this.emaCur ? `<span class="text-neon-violet">EMA 20 <b class="text-neon-violet">${fmtPrice(this.emaCur)}</b></span>` : '');
  },
  markersFor(t) {
    if (!state.user) return [];
    const step = tfSeconds();
    return state.user.trades.filter((x) => x.tokenId === t.id && x.ts).map((x) => ({
      time: Math.floor(x.ts / 1000 / step) * step,
      position: x.side === 'buy' ? 'belowBar' : 'aboveBar',
      color: x.side === 'buy' ? C.green : C.red,
      shape: x.side === 'buy' ? 'arrowUp' : 'arrowDown',
      text: (x.side === 'buy' ? 'B ' : 'S ') + fmtSOL(x.sol),
    })).sort((a, b) => a.time - b.time);
  },
  updateAvgLine() {
    if (!this.cs) return;
    if (this.avgLine) { try { this.cs.removePriceLine(this.avgLine); } catch { /* stale */ } this.avgLine = null; }
    const t = activeToken(), h = t && state.user && state.user.holdings[t.id];
    if (!h || !(h.amount > 0) || !h.costKnown || !state.solPrice) return;
    this.avgLine = this.cs.createPriceLine({ price: (h.cost * state.solPrice) / h.amount, color: C.violet, lineWidth: 1, lineStyle: window.LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: 'Avg entry' });
  },
  aiLines: [],
  /** Draws the analyst's entry / stop / target levels on the chart. */
  setAiLevels(L) {
    if (!this.cs) return;
    for (const l of this.aiLines) { try { this.cs.removePriceLine(l); } catch { /* stale */ } }
    this.aiLines = [];
    if (!L) return;
    const LS = window.LightweightCharts.LineStyle;
    const add = (price, color, title) => { if (price > 0) this.aiLines.push(this.cs.createPriceLine({ price, color, lineWidth: 1, lineStyle: LS.LargeDashed, axisLabelVisible: true, title })); };
    add(L.entry, C.cyan, 'AI entry'); add(L.stop, C.red, 'AI stop'); add(L.takeProfit, C.green, 'AI target');
  },
  paintToolbar() {
    $$('#iv-seg [data-iv]').forEach((b) => b.classList.toggle('on', +b.dataset.iv === state.chart.iv));
    $('#tg-ema').classList.toggle('on', state.chart.ema);
    $('#tg-vol').classList.toggle('on', state.chart.vol);
  },
  toggleExpand(force) {
    const p = $('#chart-panel');
    const on = typeof force === 'boolean' ? force : !p.classList.contains('expanded');
    p.classList.toggle('expanded', on);
    let scrim = $('#chart-scrim');
    if (on && !scrim) { scrim = document.createElement('div'); scrim.id = 'chart-scrim'; scrim.className = 'chart-scrim'; scrim.addEventListener('click', () => this.toggleExpand(false)); $('#app').appendChild(scrim); }
    if (!on && scrim) scrim.remove();
    document.body.classList.toggle('locked', on);
    const b = $('#chart-expand');
    b.innerHTML = `<i class="fa-solid fa-${on ? 'compress' : 'expand'}"></i>`;
    b.setAttribute('aria-label', on ? 'Exit expanded chart' : 'Expand chart');
  },

  /* ---------- token header ---------- */
  renderHead() {
    const t = activeToken();
    if (!t) return;
    const w = state.watch.has(t.id);
    const status = isLaunch(t)
      ? (t.graduated ? '<span class="badge badge-grad">Graduated</span>' : '<span class="badge badge-curve">On curve</span>')
      : `<span class="badge badge-grad">${esc(t.dex ? cap1(t.dex) : 'DEX')}</span>`;
    const links = `<a class="chip" href="${esc(explorerToken(t.id))}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i>Solscan</a>`;
    $('#term-head').innerHTML = `
      <div class="th-id">${logoImg(t, 'lg')}<div class="min-w-0">
        <div class="flex items-center gap-2 flex-wrap"><h1 class="th-name">${esc(t.name)}</h1><span class="th-sym mono">$${esc(t.symbol)}</span>${status}${t.kind === 'user' ? '<span class="badge badge-mine">Yours</span>' : ''}</div>
        <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <button class="addr-chip mono" data-copy="${esc(t.address)}" aria-label="Copy contract address">${esc(shortAddr(t.address, 5))}<i class="fa-regular fa-copy"></i></button>
          <button class="icon-btn sm ${w ? 'on' : ''}" data-watch="${esc(t.id)}" aria-pressed="${w}" aria-label="Watch ${esc(t.symbol)}"><i class="fa-${w ? 'solid' : 'regular'} fa-star"></i></button>
          <button class="chip" id="th-switch"><i class="fa-solid fa-arrow-right-arrow-left"></i>Switch token</button>
          ${links}
        </div>
      </div></div>
      <div class="th-price"><div class="th-px mono" data-tf="price"></div><div class="th-chg mono" data-tf="chg"></div></div>
      <div class="th-stats">
        <div class="th-stat"><span>Market cap</span><b data-tf="mc"></b></div>
        <div class="th-stat"><span>24h volume</span><b data-tf="vol"></b></div>
        <div class="th-stat"><span data-tf="liql">Liquidity</span><b data-tf="liq"></b></div>
        <div class="th-stat"><span>24h trades</span><b data-tf="hold"></b></div>
        <div class="th-stat"><span>1h change</span><b data-tf="h1"></b></div>
        <div class="th-stat"><span data-tf="cl">Bonding curve</span><b data-tf="cv"></b><div class="curve-bar" data-tf="cb"><i data-tf="cbi"></i></div></div>
      </div>`;
    $('#th-switch').addEventListener('click', () => Palette.open());
    this.headEls = {};
    $$('[data-tf]', $('#term-head')).forEach((el) => { this.headEls[el.dataset.tf] = el; });
    this.headLast = {};
    this.headLive();
    setText($('#book-sym'), onCurve(t) ? 'Bonding curve' : t.reserves ? 'Pool estimate' : '—');
  },
  headLive() {
    const t = activeToken(), f = this.headEls;
    if (!t || !f || !f.price) return;
    const price = t.price > 0 ? '$' + fmtPrice(t.price) : '—';
    if (this.headLast.price !== price) { f.price.textContent = price; if (this.headLast.price) flash(f.price, t.lastDir); this.headLast.price = price; }
    setText(f.chg, fmtPct(t.change24h) + ' in 24h'); setDir(f.chg, t.change24h);
    setText(f.mc, t.mcap ? fmtUSD(t.mcap) : '—'); setText(f.vol, fmtUSD(t.vol24h));
    if (onCurve(t)) { setText(f.liql, 'Raised'); setText(f.liq, fmtSOL(t.launch ? t.launch.raisedSol : 0) + ' SOL'); }
    else { setText(f.liql, 'Liquidity'); setText(f.liq, t.liquidity ? fmtUSD(t.liquidity) : '—'); }
    setText(f.hold, t.txns24h != null ? fmtInt(t.txns24h) : '—');
    const h1 = changeOver(t, 60); setText(f.h1, fmtPct(h1)); setDir(f.h1, h1);
    if (t.graduated) { setText(f.cl, isLaunch(t) ? 'Graduated' : 'Pool'); setText(f.cv, isLaunch(t) ? 'Raydium' : (t.dex ? cap1(t.dex) : 'DEX')); f.cb.classList.add('grad'); f.cbi.style.width = '100%'; }
    else {
      const L = t.launch;
      setText(f.cl, 'Bonding curve'); setText(f.cv, `${t.curve.toFixed(1)}%${L ? ` of ${fmtInt(L.targetSol)} SOL` : ''}`);
      f.cb.classList.remove('grad'); f.cbi.style.width = t.curve.toFixed(1) + '%';
    }
  },

  /* ---------- depth: price-impact ladder from the curve or pool reserves ---------- */
  buildBook() {
    const row = (side, i) => `<div class="ob-row ${side}" data-side="${side}" data-i="${i}" title="Use this size in the order ticket"><i class="depth"></i><span></span><span></span><span></span></div>`;
    $('#ob').innerHTML = `<div class="ob-head"><span>Price after</span><span>Size SOL</span><span>Impact</span></div>` +
      Array.from({ length: DEPTH_SIZES.length }, (_, r) => row('ask', DEPTH_SIZES.length - 1 - r)).join('') +
      `<div class="ob-mid"><span class="px mono" id="ob-mid">—</span><span class="spr" id="ob-spr">—</span></div>` +
      Array.from({ length: DEPTH_SIZES.length }, (_, r) => row('bid', r)).join('');
    const prep = (el) => { el._s = el.querySelectorAll('span'); el._d = el.querySelector('.depth'); return el; };
    this.askRows = $$('.ob-row.ask', $('#ob')).map(prep);
    this.bidRows = $$('.ob-row.bid', $('#ob')).map(prep);
  },
  /** Constant-product reserves in SOL terms: x tokens, y SOL, fee fraction. */
  depthModel(t) {
    const sp = state.solPrice;
    if (onCurve(t) && t.cp) {
      const cp = t.cp;
      const x = (Number(cp.vA) - Number(cp.rA)) / 10 ** cp.decA, y = (Number(cp.vB) + Number(cp.rB)) / 10 ** cp.decB;
      if (x > 0 && y > 0) return { x, y, fee: (cp.feeRate || 0) / 1e6, kind: 'curve' };
    }
    if (t.reserves && t.reserves.base > 0 && t.reserves.quote > 0 && sp > 0) {
      const quoteIsSol = t.quoteMint === SOL_MINT;
      const y = quoteIsSol ? t.reserves.quote : (t.reserves.base * t.price) / sp; // value the quote side in SOL
      return { x: t.reserves.base, y, fee: 0.0025, kind: 'pool' };
    }
    return null;
  },
  tickBook() {
    const t = activeToken();
    if (!t || !this.askRows.length) return;
    const m = this.depthModel(t), sp = state.solPrice;
    const mid = $('#ob-mid');
    setText(mid, t.price > 0 ? '$' + fmtPrice(t.price) : '—'); setDir(mid, t.lastDir);
    if (!m || !sp) {
      this.levels = null;
      [...this.askRows, ...this.bidRows].forEach((el) => { setText(el._s[0], '—'); setText(el._s[1], fmtSOL(DEPTH_SIZES[+el.dataset.i])); setText(el._s[2], '—'); el._d.style.width = '0%'; });
      setText($('#ob-spr'), 'Depth unavailable');
      return;
    }
    const p0 = m.y / m.x; // SOL per token
    const L = { ask: [], bid: [] };
    for (let i = 0; i < DEPTH_SIZES.length; i++) {
      const s = DEPTH_SIZES[i];
      const inB = s * (1 - m.fee), out = m.x - (m.x * m.y) / (m.y + inB);
      const after = (m.y + inB) / (m.x - out), impB = out > 0 ? ((s / out) / p0 - 1) * 100 : 100;
      const tok = s / p0, solOut = (m.y - (m.x * m.y) / (m.x + tok)) * (1 - m.fee);
      const afterS = (m.y - solOut / (1 - m.fee)) / (m.x + tok), impS = (1 - solOut / tok / p0) * 100;
      L.ask[i] = { size: s, tokens: out, price: after * sp, impact: impB };
      L.bid[i] = { size: s, tokens: tok, price: afterS * sp, impact: impS };
    }
    this.levels = L;
    const max = Math.max(1, ...L.ask.map((x) => x.impact), ...L.bid.map((x) => x.impact));
    const paint = (el, lv) => { setText(el._s[0], fmtPrice(lv.price)); setText(el._s[1], fmtSOL(lv.size)); setText(el._s[2], lv.impact.toFixed(lv.impact < 10 ? 2 : 1) + '%'); el._d.style.width = clamp((lv.impact / max) * 100, 2, 100).toFixed(1) + '%'; };
    this.askRows.forEach((el) => paint(el, L.ask[+el.dataset.i]));
    this.bidRows.forEach((el) => paint(el, L.bid[+el.dataset.i]));
    setText($('#ob-spr'), `${m.kind === 'curve' ? 'Curve fee' : 'Est. pool fee'} ${(m.fee * 100).toFixed(2)}%`);
  },
  bookClick(row) {
    const t = activeToken(), lv = this.levels && this.levels[row.dataset.side][+row.dataset.i];
    if (!t || !lv) return;
    if (row.dataset.side === 'ask') { this.setSide('buy'); $('#amt-input').value = String(lv.size); }
    else {
      this.setSide('sell');
      const h = state.user && state.user.holdings[t.id];
      $('#amt-input').value = String(+(h ? Math.min(h.amount, lv.tokens) : lv.tokens).toPrecision(6));
    }
    this.scheduleQuote();
    flash($('#amt-box'), row.dataset.side === 'ask' ? 1 : -1);
  },

  /* ---------- recent trades (chain index for curve coins, GeckoTerminal for pools) ---------- */
  async pollTape() {
    const t = activeToken();
    if (!t) return;
    const q = isLaunch(t) && (onCurve(t) || !t.pair) ? { mint: t.id } : t.pair ? { mint: t.id, pool: t.pair } : null;
    if (!q) return;
    try {
      const r = await SN.market.trades(q);
      if (state.activeId !== t.id) return;
      const rows = (r.trades || []).slice(0, 30).sort((a, b) => a.ts - b.ts);
      const first = this.tapeSeen.size === 0;
      for (const tr of rows) {
        if (!tr.sig || this.tapeSeen.has(tr.sig)) continue;
        this.tapeSeen.add(tr.sig);
        const sol = tr.sol != null ? tr.sol : state.solPrice ? tr.usd / state.solPrice : 0;
        this.tapePush({ ts: tr.ts, price: tr.priceUsd || 0, sol, side: tr.side, mine: !!(state.user && tr.wallet === state.user.address), sig: tr.sig }, first);
      }
      const now = Date.now(), recent = (r.trades || []).filter((x) => now - x.ts < 300000).length;
      setText($('#tape-rate'), recent ? (recent / 5).toFixed(1) + ' trades/min' : 'quiet');
      if (!rows.length && first) $('#tape').innerHTML = '<div class="empty" style="padding:14px"><span>No trades yet.</span></div>';
    } catch { /* keep the tape as is */ }
  },
  tapePush(tr, quiet) {
    const tape = $('#tape');
    if (!tape) return;
    const empty = tape.querySelector('.empty'); if (empty) empty.remove();
    const el = document.createElement('a');
    el.className = `tape-row ${tr.side}${tr.sol >= WHALE_SOL ? ' big' : ''}${tr.mine ? ' mine' : ''}${REDUCED || quiet ? '' : ' enter'}`;
    if (tr.sig) { el.href = explorerTx(tr.sig); el.target = '_blank'; el.rel = 'noopener'; el.title = 'View on Solscan'; }
    el.innerHTML = `<span>${hms(tr.ts)}</span><span>${tr.price ? fmtPrice(tr.price) : '—'}</span><span>${tr.mine ? '<b class="you">YOU</b>' : ''}${fmtSOL(tr.sol)}</span>`;
    tape.prepend(el);
    while (tape.children.length > 14) tape.lastElementChild.remove();
  },

  /* ---------- execution ---------- */
  venue(t) {
    if (!t) return null;
    if (onCurve(t)) return t.launch && t.launch.phase === 'migrating' ? null : 'curve';
    if (isMainnet() && t.price > 0 && (state.cfg && state.cfg.features.jupiter)) return 'jupiter';
    return null;
  },
  setSide(side) { state.trade.side = side; $('#amt-input').value = ''; this.btnLabel = null; this.quoteRes = null; this.renderExec(); saveSoon(); },
  paintExecControls() {
    const t = activeToken(), v = this.venue(t);
    $$('#side-seg [data-side]').forEach((b) => b.classList.toggle('on', b.dataset.side === state.trade.side));
    const custom = $('#slip-custom').value.trim() !== '';
    $$('#slip-seg [data-slip]').forEach((b) => b.classList.toggle('on', !custom && +b.dataset.slip === state.trade.slip));
    if (!custom && ![0.5, 1, 3].includes(state.trade.slip)) $('#slip-custom').value = String(state.trade.slip);
    const mevOn = state.trade.mev && isMainnet() && v === 'curve';
    const sw = $('#mev-switch');
    sw.classList.toggle('on', mevOn);
    sw.setAttribute('aria-checked', mevOn ? 'true' : 'false');
    sw.disabled = !isMainnet() || v === 'jupiter';
    sw.title = !isMainnet() ? 'Mainnet only' : v === 'jupiter' ? 'Jupiter lands swaps through its own infrastructure' : 'Send through the Jito block engine';
    $$('#prio-seg [data-prio]').forEach((b) => b.classList.toggle('on', b.dataset.prio === state.trade.prio));
    setText($('#exec-route'), v === 'curve' ? (mevOn ? 'LaunchLab · Jito' : 'Raydium LaunchLab') : v === 'jupiter' ? 'Jupiter' : 'Unavailable');
  },
  renderExec() {
    const t = activeToken();
    if (!t) return;
    const buy = state.trade.side === 'buy';
    $('#amt-unit').textContent = buy ? 'SOL' : '$' + t.symbol;
    $('#quick').innerHTML = (buy ? ['0.1', '0.5', '1', '5', 'Max'] : ['10%', '25%', '50%', '75%', 'Max']).map((q) => `<button data-q="${q}">${q}</button>`).join('');
    this.refreshBalance();
    this.paintExecControls();
    this.btnLabel = null;
    this.scheduleQuote();
    const note = $('#exec-note');
    if (note) {
      const v = this.venue(t);
      note.innerHTML = v === 'curve' ? `Trades settle on Solana ${esc(state.cluster)} from your wallet against the LaunchLab bonding curve.`
        : v === 'jupiter' ? 'Swaps route through Jupiter on Solana mainnet. You approve every trade in your wallet.'
        : isLaunch(t) && t.launch && t.launch.phase === 'migrating' ? 'This coin is migrating to Raydium. Trading reopens in a few minutes.'
        : `Trading this token isn't available on ${esc(state.cluster)}.`;
    }
  },
  refreshBalance() {
    const t = activeToken(), u = state.user, el = $('#exec-bal');
    if (!u) { el.textContent = 'Wallet not connected'; return; }
    if (!u.solKnown) { el.textContent = 'Loading balance…'; return; }
    if (state.trade.side === 'buy') el.innerHTML = `Balance ${fmtSOL(u.sol)} SOL`;
    else { const h = t && u.holdings[t.id]; el.textContent = `Holding ${fmtNum(h ? h.amount : 0)} ${t ? t.symbol : ''}`; }
  },
  quick(q) {
    const t = activeToken(), u = state.user, inp = $('#amt-input');
    if (!t) return;
    if (state.trade.side === 'buy') {
      if (q === 'Max') {
        if (!u) { Wallet.open(() => this.quick('Max')); return; }
        inp.value = Math.max(0, u.sol - PRIO[state.trade.prio].fee - 0.012).toFixed(3);
      } else inp.value = q;
    } else {
      if (!u) { Wallet.open(); return; }
      const h = u.holdings[t.id];
      if (!h) { toast({ type: 'info', title: `You don't hold $${t.symbol}`, msg: 'Switch to Buy to open a position first.', duration: 3000 }); return; }
      const pct = q === 'Max' ? 1 : parseFloat(q) / 100;
      inp.value = String(pct === 1 ? h.amount : +(h.amount * pct).toPrecision(6));
    }
    this.scheduleQuote();
  },
  inputKey() {
    const t = activeToken();
    return [t && t.id, state.trade.side, $('#amt-input').value.trim(), state.trade.slip, this.venue(t)].join('|');
  },
  scheduleQuote() {
    clearTimeout(this.qT);
    this.qT = setTimeout(() => this.fetchQuote(), 260);
    this.renderQuote();
  },
  async decimalsOf(t) {
    if (t.cp) return t.cp.decA;
    const h = state.user && state.user.holdings[t.id];
    if (h && h.decimals != null) return h.decimals;
    if (t.decimals != null) return t.decimals;
    t.decimals = await SN.chain.mintDecimals(t.id);
    if (t.decimals == null) throw new Error('Could not read token decimals.');
    return t.decimals;
  },
  async fetchQuote() {
    const t = activeToken();
    const amt = parseFloat($('#amt-input').value);
    const key = this.inputKey(), venue = this.venue(t);
    if (!t || !(amt > 0) || !venue) { this.quoteRes = null; this.quoteErr = null; this.quoteBusy = false; this.renderQuote(); return; }
    const seq = ++this.quoteSeq;
    this.quoteBusy = true; this.renderQuote();
    const side = state.trade.side, slipBps = Math.round(state.trade.slip * 100);
    try {
      let q;
      if (venue === 'curve') {
        const L = await SN.launchlab();
        q = await L.quote(t.id, side, amt, slipBps);
      } else {
        const J = await SN.jupiter();
        const dec = await this.decimalsOf(t);
        const inMint = side === 'buy' ? SOL_MINT : t.id, outMint = side === 'buy' ? t.id : SOL_MINT;
        const o = await J.order(inMint, outMint, toRaw(amt, side === 'buy' ? 9 : dec), slipBps, '');
        const out = Number(o.outAmount) / 10 ** (side === 'buy' ? dec : 9);
        const avgSol = side === 'buy' ? amt / out : out / amt;
        const spot = state.solPrice ? t.price / state.solPrice : 0;
        q = { side, inAmount: amt, outAmount: out, minOut: out * (1 - slipBps / 10000), feeSol: 0, avgPriceSol: avgSol, priceImpactPct: spot ? Math.abs(avgSol / spot - 1) * 100 : 0, router: o.router };
      }
      if (seq !== this.quoteSeq) return;
      this.quoteRes = { ...q, venue, key }; this.quoteErr = null;
    } catch (e) {
      if (seq !== this.quoteSeq) return;
      this.quoteRes = null; this.quoteErr = (e && e.message) || 'No quote available.';
    } finally {
      if (seq === this.quoteSeq) { this.quoteBusy = false; this.renderQuote(); }
    }
  },
  validate() {
    const t = activeToken(), u = state.user, buy = state.trade.side === 'buy';
    const amt = parseFloat($('#amt-input').value);
    const venue = this.venue(t);
    if (!t) return { ok: false, reason: 'Pick a token first.' };
    if (!venue) return { ok: false, reason: isLaunch(t) && t.launch && t.launch.phase === 'migrating' ? 'This coin is migrating to Raydium right now.' : isMainnet() ? 'No market for this token right now.' : `Only Supernova curve coins trade on ${state.cluster}.` };
    if (!(amt > 0)) return { ok: false, reason: buy ? 'Enter an amount in SOL.' : `Enter an amount of $${t.symbol}.` };
    if (!u) return { ok: true };
    const fee = PRIO[state.trade.prio].fee;
    if (buy) {
      if (amt < 0.001) return { ok: false, reason: 'The minimum order is 0.001 SOL.' };
      if (u.solKnown && amt + fee + 0.005 > u.sol) return { ok: false, reason: `Not enough SOL. You have ${fmtSOL(u.sol)} SOL, and need a little extra for fees and the token account.`, fund: true };
    } else {
      const h = u.holdings[t.id];
      if (!h) return { ok: false, reason: `You don't hold any $${t.symbol}.` };
      if (amt > h.amount * 1.000001) return { ok: false, reason: `You hold ${fmtNum(h.amount)} $${t.symbol}.` };
    }
    const q = this.quoteRes;
    if (q && q.key === this.inputKey() && q.venue === 'curve' && q.capped && buy) return { ok: true, warn: 'This buy would fill the rest of the curve; the unused SOL stays in your wallet.' };
    return { ok: true };
  },
  renderQuote() {
    const t = activeToken();
    if (!t) return;
    const buy = state.trade.side === 'buy';
    const amt = parseFloat($('#amt-input').value), has = amt > 0;
    const q = this.quoteRes && this.quoteRes.key === this.inputKey() ? this.quoteRes : null;
    const venue = this.venue(t), sp = state.solPrice;
    const impCls = !q ? '' : q.priceImpactPct < 1 ? 'up' : q.priceImpactPct < 4 ? 'text-neon-amber' : 'down';
    const wait = has && !q && this.quoteBusy ? '<span class="spin-sm"></span>' : '—';
    const outTxt = !has ? '—' : q ? (buy ? `${fmtNum(q.outAmount)} ${esc(t.symbol)}` : `${fmtSOL(q.outAmount)} SOL`) : wait;
    const minTxt = !has || !q ? (has ? wait : '—') : buy ? `${fmtNum(q.minOut)} ${esc(t.symbol)}` : `${fmtSOL(q.minOut)} SOL`;
    const avgUsd = q && sp ? q.avgPriceSol * sp : 0;
    const prioFee = PRIO[state.trade.prio].fee;
    const mev = state.trade.mev && isMainnet() && venue === 'curve';
    const feeTxt = venue === 'curve' ? `${q ? fmtSOL(q.feeSol, 5) + ' SOL trading fee + ' : ''}${prioFee} SOL ${mev ? 'Jito tip' : 'priority'}` : venue === 'jupiter' ? 'Included in the quote' : '—';
    const v = this.validate();
    $('#quote').innerHTML =
      `<div class="big"><span>You receive</span><b>${outTxt}</b></div>` +
      `<div><span>Average price</span><b>${q && avgUsd ? '$' + fmtPrice(avgUsd) : has ? wait : '—'}</b></div>` +
      `<div><span>Price impact</span><b class="${impCls}">${q ? q.priceImpactPct.toFixed(2) + '%' : has ? wait : '—'}</b></div>` +
      `<div><span>Minimum received</span><b>${minTxt}</b></div>` +
      `<div><span>Fees</span><b>${feeTxt}</b></div>` +
      `<div><span>Route</span><b>${venue === 'curve' ? (mev ? 'Jito bundle → LaunchLab curve' : 'RPC → LaunchLab curve') : venue === 'jupiter' ? 'Jupiter' + (q && q.router ? ` (${esc(q.router)})` : '') : 'Unavailable'}</b></div>` +
      (this.quoteErr && has ? `<div class="down"><span>${esc(this.quoteErr)}</span></div>` : '') +
      (q && q.priceImpactPct >= 5 ? `<div class="text-neon-amber"><span>High price impact. A smaller size gets a better average price.</span></div>` : '') +
      (v.warn ? `<div class="text-neon-amber"><span>${esc(v.warn)}</span></div>` : '') +
      (state.user && v.fund ? `<div><span>Need SOL?</span><b>${state.cluster === 'devnet' ? '<button class="chip" data-airdrop><i class="fa-solid fa-faucet-drip"></i>Free devnet SOL</button>' : '<button class="chip" data-buysol><i class="fa-solid fa-credit-card"></i>Buy SOL</button>'}</b></div>` : '');
    if (this.executing) return;
    const label = !state.user ? 'connect' : `${buy ? 'Buy' : 'Sell'} $${t.symbol}|${!!venue}`;
    if (label === this.btnLabel) return;
    this.btnLabel = label;
    const btn = $('#exec-btn');
    btn.className = `btn ${buy ? 'btn-buy' : 'btn-sell'} btn-xl w-full`;
    btn.disabled = !!state.user && !venue;
    btn.innerHTML = !state.user ? '<i class="fa-solid fa-wallet"></i>Connect wallet to trade' : venue ? esc(`${buy ? 'Buy' : 'Sell'} $${t.symbol}`) : 'Trading unavailable';
  },
  async execute() {
    if (this.executing) return;
    const t = activeToken();
    if (!t) return;
    if (!state.user) { Wallet.open(() => { this.btnLabel = null; this.renderQuote(); }); return; }
    const v = this.validate();
    if (!v.ok) { toast({ type: 'error', title: 'Order not sent', msg: esc(v.reason), duration: 4200, action: v.fund ? (state.cluster === 'devnet' ? { label: 'Get devnet SOL', onClick: () => Funding.airdrop() } : { label: 'Buy SOL', onClick: () => Funding.buySol() }) : null }); nudge($('#amt-box')); return; }
    const venue = this.venue(t), buy = state.trade.side === 'buy', amt = parseFloat($('#amt-input').value);
    const slipBps = Math.round(state.trade.slip * 100), prio = state.trade.prio, mev = state.trade.mev && isMainnet() && venue === 'curve';
    const quote = this.quoteRes && this.quoteRes.key === this.inputKey() ? this.quoteRes : null;
    this.executing = true;
    const btn = $('#exec-btn');
    btn.disabled = true;
    btn.innerHTML = `<span class="spin"></span>Approve in ${esc(state.user.wallet)}`;
    const t0 = performance.now();
    try {
      let sig, solAmt, tokAmt;
      if (venue === 'curve') {
        const L = await SN.launchlab();
        const onSent = () => { btn.innerHTML = `<span class="spin"></span>${mev ? 'Landing via Jito' : 'Confirming on-chain'}`; };
        if (buy) { const r = await L.buy({ mint: t.id, sol: amt, slippageBps: slipBps, prio, mev, onSent }); sig = r.signature; solAmt = amt; tokAmt = quote ? quote.outAmount : r.expectedOut; }
        else { const r = await L.sell({ mint: t.id, tokens: amt, slippageBps: slipBps, prio, mev, onSent }); sig = r.signature; tokAmt = amt; solAmt = quote ? quote.outAmount : r.minOutSol; }
      } else {
        const J = await SN.jupiter();
        const dec = await this.decimalsOf(t);
        const r = await J.swap({ inputMint: buy ? SOL_MINT : t.id, outputMint: buy ? t.id : SOL_MINT, amountRaw: toRaw(amt, buy ? 9 : dec), slippageBps: slipBps, onSigned: () => { btn.innerHTML = '<span class="spin"></span>Landing via Jupiter'; } });
        sig = r.signature;
        const inAmt = Number(r.inAmount) / 10 ** (buy ? 9 : dec), outAmt = Number(r.outAmount) / 10 ** (buy ? dec : 9);
        solAmt = buy ? inAmt : outAmt; tokAmt = buy ? outAmt : inAmt;
      }
      const ms = Math.round(performance.now() - t0);
      Account.recordLocal({ sig, tokenId: t.id, side: buy ? 'buy' : 'sell', sol: +solAmt || 0, tokens: +tokAmt || 0, ts: Date.now(), source: venue });
      this.tapeSeen.add(sig);
      this.tapePush({ ts: Date.now(), price: t.price, sol: +solAmt || 0, side: buy ? 'buy' : 'sell', mine: true, sig });
      if (this.mk) this.mk.setMarkers(this.markersFor(t));
      btn.innerHTML = `<i class="fa-solid fa-check"></i>Confirmed in ${(ms / 1000).toFixed(1)}s`;
      toast({
        type: 'success',
        title: `${buy ? 'Bought' : 'Sold'} ${tokAmt ? fmtNum(tokAmt) + ' ' : ''}$${t.symbol}`,
        msg: `${buy ? 'Paid' : 'Received'} ${fmtSOL(solAmt)} SOL${venue === 'curve' && buy ? ' (estimated tokens; your balance updates in a moment)' : ''}. Confirmed on Solana in ${(ms / 1000).toFixed(1)}s${mev ? ' via a Jito bundle' : ''}.`,
        action: { label: 'View on Solscan', onClick: () => window.open(explorerTx(sig), '_blank', 'noopener') },
        duration: 8000,
      });
      $('#amt-input').value = '';
      this.quoteRes = null;
      Account.soon();
      setTimeout(() => { this.refreshActive(); this.pollTape(); this.loadSeries(false); }, 1500);
      App.userTraded();
      await sleep(1200);
    } catch (e) {
      const sigLink = e && e.signature ? { label: 'View transaction', onClick: () => window.open(explorerTx(e.signature), '_blank', 'noopener') } : null;
      if (isRejection(e)) toast({ type: 'info', title: 'Trade cancelled', msg: 'You declined it in your wallet. Nothing was sent.', duration: 3200 });
      else toast({ type: 'error', title: 'Trade failed', msg: esc((e && e.message) || 'Something went wrong.'), duration: 9000, action: sigLink });
    } finally {
      this.executing = false;
      btn.disabled = false;
      this.btnLabel = null;
      this.scheduleQuote(); this.refreshBalance(); this.renderPos();
    }
  },
  closePosition() {
    const t = activeToken(), h = t && state.user && state.user.holdings[t.id];
    if (!h) return;
    this.setSide('sell');
    $('#amt-input').value = String(h.amount);
    this.fetchQuote().then(() => this.execute());
  },

  /* ---------- position + intel ---------- */
  renderPos() {
    const t = activeToken(), box = $('#pos-body'), btn = $('#close-pos');
    if (!t) return;
    const u = state.user;
    this.posEls = null;
    if (!u) {
      btn.disabled = true;
      box.innerHTML = `<div class="empty"><span>Connect a wallet to see your position in $${esc(t.symbol)}.</span><button class="btn btn-ghost btn-sm" data-connect><i class="fa-solid fa-wallet"></i>Connect wallet</button></div>`;
      return;
    }
    const h = u.holdings[t.id];
    const fills = u.trades.filter((x) => x.tokenId === t.id).slice(-4).reverse();
    const fillsHTML = fills.length ? `<div class="mt-4 grid gap-1.5">${fills.map((x) => `<a class="flex justify-between gap-3 text-[12px] mono" href="${esc(explorerTx(x.sig))}" target="_blank" rel="noopener"><span class="${x.side === 'buy' ? 'up' : 'down'}">${x.side === 'buy' ? 'Bought' : 'Sold'} for ${fmtSOL(x.sol)} SOL</span><span class="text-ink-3">${timeAgo(x.ts) === 'now' ? 'just now' : timeAgo(x.ts) + ' ago'}</span></a>`).join('')}</div>` : '';
    btn.disabled = !h || !this.venue(t);
    if (!h) { box.innerHTML = `<div class="empty"><span>No $${esc(t.symbol)} in this wallet${u.solKnown ? '' : ' yet'}. Your fills will show up here.</span></div>${fillsHTML}`; return; }
    box.innerHTML = `<div class="pos-stats"><div class="kv"><span>Holding</span><b data-p="amt"></b></div><div class="kv"><span>Value</span><b data-p="val"></b></div><div class="kv"><span>Average entry</span><b data-p="avg"></b></div><div class="kv"><span>Unrealized PnL</span><b data-p="pnl"></b></div></div>${fillsHTML}`;
    this.posEls = {};
    $$('[data-p]', box).forEach((el) => { this.posEls[el.dataset.p] = el; });
    this.posLive();
  },
  posLive() {
    const t = activeToken(), u = state.user, f = this.posEls;
    if (!t || !u || !f) return;
    const h = u.holdings[t.id];
    if (!h) return;
    const sp = state.solPrice || 0;
    const valSol = sp ? (h.amount * t.price) / sp : 0;
    setText(f.amt, fmtNum(h.amount) + ' ' + t.symbol);
    setText(f.val, sp ? fmtSOL(valSol) + ' SOL' : '—');
    if (h.costKnown && h.amount > 0) {
      const pnl = valSol - h.cost, pct = h.cost ? (pnl / h.cost) * 100 : 0;
      setText(f.avg, sp ? '$' + fmtPrice((h.cost * sp) / h.amount) : '—');
      setText(f.pnl, `${signed(pnl)} SOL (${fmtPct(pct)})`); setDir(f.pnl, pnl);
    } else { setText(f.avg, '—'); setText(f.pnl, h.partial ? 'Partial history' : 'Unknown cost'); }
  },
  async renderIntel(reset) {
    const t = activeToken();
    if (!t) return;
    const box = $('#intel-body');
    const fresh = t.intel && Date.now() - t.intel.at < 60000;
    if (reset && !fresh) box.innerHTML = `<div class="empty"><span class="spin-sm"></span><span>Scanning $${esc(t.symbol)} on-chain…</span></div>`;
    if (fresh) { this.paintIntel(t); return; }
    try {
      const r = await SN.api.get('intel/' + t.id, 40000);
      t.intel = { ...r, at: Date.now() };
      if (state.activeId === t.id) this.paintIntel(t);
    } catch (e) {
      if (state.activeId === t.id && (!t.intel || reset)) box.innerHTML = `<div class="empty"><span>${esc((e && e.message) || 'Scan unavailable right now.')}</span></div>`;
    }
  },
  paintIntel(t) {
    const i = t.intel;
    if (i.sentinel == null) {
      $('#intel-body').innerHTML = `<div class="empty"><span>On-chain checks for $${esc(t.symbol)} aren't available on Solana ${esc(state.cluster)}${state.cluster === 'devnet' ? ' (this token lives on mainnet)' : ''}.</span></div>`;
      return;
    }
    const score = i.sentinel;
    const col = score >= 80 ? C.green : score >= 60 ? C.amber : C.red;
    const verdict = score >= 80 ? 'Clean setup' : score >= 60 ? 'A few flags' : 'High risk';
    const item = (c) => `<div class="intel-item"><span>${esc(c.label)}</span><b class="${c.tone === 'good' ? 'up' : c.tone === 'bad' ? 'down' : c.tone === 'warn' ? 'text-neon-amber' : ''}">${esc(c.value)}</b></div>`;
    $('#intel-body').innerHTML =
      `<div class="flex items-center gap-4 mb-3.5"><div class="relative w-[54px] h-[54px] flex-none"><div class="score-ring absolute inset-0" style="--p:${score};--c:${col}"></div><b class="absolute inset-0 grid place-items-center mono text-[14px]">${score}</b></div>` +
      `<div><div class="font-bold text-[14px]">${verdict}</div><div class="text-[12px] text-ink-3">Sentinel score from on-chain checks for $${esc(t.symbol)}</div></div></div>` +
      `<div class="intel">${(i.checks || []).map(item).join('')}${t.createdAt ? item({ label: 'Age', value: timeAgo(t.createdAt), tone: 'info' }) : ''}</div>` +
      ((i.notes || []).length ? `<div class="text-[11px] text-ink-3 mt-2">${esc(i.notes[0])}</div>` : '');
  },
};

/* =========================================================
   AI ANALYST (Pro): Claude reads the live chain + market data
   ========================================================= */
const AI_PRESETS = {
  rug: { icon: 'fa-shield-halved', label: 'Is this a rug? Scan dev & holders' },
  whales: { icon: 'fa-fish', label: 'Are whales buying or dumping?' },
  entry: { icon: 'fa-crosshairs', label: 'Best entry & take-profit?' },
};
const AI_STEPS = {
  rug: ['Reading the dev wallet', 'Measuring holder concentration', 'Checking mint and freeze authority', 'Looking for bundled snipes', 'Writing the verdict'],
  whales: ['Pulling the live tape', 'Sizing the largest fills', 'Netting buy and sell flow', 'Comparing against the holder map', 'Writing the verdict'],
  entry: ['Loading candles', 'Finding support and resistance', 'Reading RSI and the EMA stack', 'Pricing the curve depth', 'Writing the plan'],
  thesis: ['Loading candles', 'Measuring order-flow imbalance', 'Scanning holders and authorities', 'Reading momentum', 'Writing the thesis'],
  custom: ['Reading on-chain data', 'Pulling the live tape', 'Scanning holders and authorities', 'Thinking it through', 'Writing the answer'],
};

const AI = {
  busy: false, run: 0, lastText: '', lines: [],
  init() {
    $('#ai-presets').innerHTML = Object.entries(AI_PRESETS).map(([k, p]) => `<button class="ai-q" data-preset="${k}"><span class="qi"><i class="fa-solid ${p.icon}"></i></span><span class="qt">${esc(p.label)}</span><i class="fa-solid fa-arrow-right qa"></i></button>`).join('');
    $('#ai-presets').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (b) this.ask(b.dataset.preset); });
    $('#ai-ask').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('#ai-q').value.trim();
      if (q.length < 3) { nudge($('#ai-ask')); return; }
      this.ask('custom', q);
    });
    $('#ai-run').addEventListener('click', () => this.ask('thesis'));
    $('#ai-copy').addEventListener('click', async () => {
      const ok = await copyText(this.lastText || $('#ai-text').textContent.trim());
      toast({ type: ok ? 'success' : 'error', duration: 2400, title: ok ? 'Analysis copied' : "Couldn't copy the analysis", msg: ok ? '' : 'Select the text and copy it manually.' });
    });
    this.labels();
  },
  labels() {
    const el = $('#forge-model');
    if (el) el.textContent = !state.cfg ? 'Connecting…' : state.cfg.features.ai ? 'Claude' : 'Built-in generator';
    const q = $('#ai-quota');
    if (q) q.textContent = Session.pro ? 'Pro · unlimited' : state.cfg ? `${state.cfg.pro.freeAnalysesPerDay} free per day` : '';
    const badge = $('#ai-pro');
    if (badge) badge.classList.toggle('on', Session.pro);
  },
  setStatus(cls, text) { const s = $('#ai-status'); if (!s) return; s.className = 'ai-status mono' + (cls ? ' ' + cls : ''); s.textContent = text; },
  reset() {
    this.run++;
    this.busy = false;
    if (!$('#ai-run')) return;
    const t = activeToken();
    $('#ai-run').disabled = false;
    $('#ai-copy').disabled = true;
    $('#ai-run-label').textContent = t ? 'Read the tape on $' + t.symbol : 'Read the tape';
    $('#ai-q').placeholder = t ? `Ask anything about $${t.symbol}…` : 'Ask anything…';
    $$('#ai-presets .ai-q').forEach((b) => { b.disabled = false; b.classList.remove('on'); });
    $('#ai-signal').hidden = true;
    $('#ai-steps').hidden = true;
    $('#ai-verdict').hidden = true;
    $('#ai-levels').hidden = true;
    $('#ai-body').classList.remove('scanning');
    const tx = $('#ai-text');
    tx.className = 'ai-text idle';
    tx.textContent = 'Pick a question or ask your own. The analyst reads the live tape, holders and dev wallet, then answers in plain words.';
    this.lastText = '';
    this.setStatus('', 'Idle');
    setText($('#ai-foot'), 'Reads live on-chain and market data. Not financial advice.');
    Term.setAiLevels(null);
    if (Term.aiEye) Term.aiEye.st.hold = false;
    this.labels();
  },
  async steps(run, preset) {
    const ul = $('#ai-steps');
    ul.hidden = false;
    const steps = AI_STEPS[preset] || AI_STEPS.custom;
    ul.innerHTML = steps.map((s) => `<li><span class="spin-sm"></span><span>${esc(s)}</span></li>`).join('');
    const lis = $$('li', ul);
    for (let i = 0; i < lis.length - 1; i++) {
      await sleep(rand(700, 1300));
      if (run !== this.run || !this.busy) return;
      lis[i].classList.add('ok');
      lis[i].firstElementChild.outerHTML = '<i class="fa-solid fa-check"></i>';
    }
  },
  async ask(preset, question) {
    if (this.busy) return;
    const t = activeToken();
    if (!t) return;
    if (!(state.cfg && state.cfg.features.ai)) { toast({ type: 'info', title: 'The AI analyst is not switched on yet', msg: 'The site owner needs to add an Anthropic API key (see SETUP.md).' }); return; }
    if (!state.user) { Wallet.open(() => this.ask(preset, question)); return; }
    try { await Session.ensure(); }
    catch (e) { if (!isRejection(e)) toast({ type: 'error', title: "Couldn't sign in", msg: esc((e && e.message) || 'Try again.') }); return; }
    this.busy = true;
    const run = ++this.run, stale = () => run !== this.run;
    const btn = $('#ai-run'), text = $('#ai-text'), body = $('#ai-body');
    btn.disabled = true;
    $('#ai-copy').disabled = true;
    $$('#ai-presets .ai-q').forEach((b) => { b.disabled = true; b.classList.toggle('on', b.dataset.preset === preset); });
    this.setStatus('busy', 'Scanning');
    $('#ai-signal').hidden = true; $('#ai-verdict').hidden = true; $('#ai-levels').hidden = true;
    text.className = 'ai-text idle';
    text.textContent = preset === 'custom' ? `“${question}”` : (AI_PRESETS[preset] ? AI_PRESETS[preset].label : 'Reading the tape…');
    body.classList.add('scanning');
    const eye = Term.aiEye;
    if (eye) { eye.st.hold = true; eye.lookTo(-15, 3, 320); }
    this.steps(run, preset);
    let r;
    try {
      r = await SN.ai.analyze({ mint: t.id, preset: preset === 'custom' ? undefined : preset, question: preset === 'custom' ? question : undefined });
    } catch (e) {
      if (stale()) return;
      this.busy = false;
      body.classList.remove('scanning');
      $('#ai-steps').hidden = true;
      btn.disabled = false;
      $$('#ai-presets .ai-q').forEach((b) => { b.disabled = false; b.classList.remove('on'); });
      if (eye) eye.st.hold = false;
      if (e && e.code === 'pro_required') {
        this.setStatus('', 'Free limit reached');
        text.className = 'ai-text idle';
        text.textContent = 'You used today’s free analysis. Pro unlocks unlimited questions, the rug scanner and entry plans.';
        ProModal.open('quota');
      } else if (e && e.code === 'auth_required') {
        state.session = null;
        this.setStatus('', 'Sign in needed');
        text.textContent = 'Your sign-in expired. Ask again to sign a fresh message.';
      } else {
        this.setStatus('', 'Error');
        text.className = 'ai-text idle';
        text.textContent = (e && e.message) || 'The analyst could not answer. Try again.';
      }
      return;
    }
    if (stale()) return;
    // real checks replace the progress list (like the ad: dev wallet, holders, authorities, snipes)
    const ul = $('#ai-steps');
    const tone = (c) => (c.tone === 'good' ? 'up' : c.tone === 'bad' ? 'down' : c.tone === 'warn' ? 'text-neon-amber' : '');
    ul.innerHTML = (r.checks || []).slice(0, 5).map((c) => `<li class="ok"><i class="fa-solid fa-${c.tone === 'bad' ? 'xmark' : c.tone === 'warn' ? 'triangle-exclamation' : 'check'}"></i><span>${esc(c.label)}</span><b class="ml-auto mono ${tone(c)}">${esc(c.value)}</b></li>`).join('');
    body.classList.remove('scanning');
    const rugCls = { LOW: 'bull', MEDIUM: 'neutral', HIGH: 'bear', EXTREME: 'bear' }[r.rugRisk] || 'neutral';
    $('#ai-verdict').innerHTML = `<span class="sig-badge ${rugCls}">${esc(r.rugRisk)} RUG RISK</span><div class="text-[13px] text-ink-2 leading-snug">${r.sentinel != null ? `<b class="text-ink">Sentinel ${r.sentinel}/100.</b> ` : ''}${esc(r.headline)}</div>`;
    $('#ai-verdict').hidden = false;
    const badge = $('#sig-badge');
    badge.className = 'sig-badge ' + r.tone;
    badge.textContent = r.signal;
    $('#ai-signal').hidden = false;
    setText($('#conv-v'), r.conviction + '%');
    const bar = $('#conv-bar');
    bar.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = r.conviction + '%'; }));
    if (eye) eye.lookTo(0, 0, 240);
    this.setStatus('busy', 'Writing');
    const L = r.levels || {};
    if (L.entry || L.stop || L.takeProfit) {
      $('#ai-levels').innerHTML = [['Entry', L.entry, ''], ['Stop', L.stop, 'down'], ['Take profit', L.takeProfit, 'up']].filter((x) => x[1]).map(([k, v, c]) => `<div class="kv"><span>${k}</span><b class="${c}">$${fmtPrice(v)}</b></div>`).join('');
      $('#ai-levels').hidden = false;
      Term.setAiLevels(L);
    }
    this.lastText = `${r.signal} (${r.conviction}% conviction) · ${r.rugRisk} rug risk${r.sentinel != null ? ` · Sentinel ${r.sentinel}/100` : ''}\n${r.answer}`;
    await typewrite(text, r.answer, stale);
    if (stale()) return;
    this.setStatus('done', 'Complete');
    const q = r.quota || {};
    setText($('#ai-foot'), `${q.pro ? 'Pro' : `${Math.max(0, (q.limit || 0) - (q.used || 0))} free left today`} · Claude read live data at ${hms(r.at)}. Not financial advice.`);
    btn.disabled = false;
    $('#ai-run-label').textContent = 'Read the tape again';
    $('#ai-copy').disabled = false;
    $$('#ai-presets .ai-q').forEach((b) => { b.disabled = false; });
    if (preset === 'custom') $('#ai-q').value = '';
    if (eye) eye.st.hold = false;
    this.busy = false;
  },
};

async function typewrite(el, text, stale) {
  el.className = 'ai-text';
  el.textContent = '';
  const span = document.createElement('span'), caret = document.createElement('span');
  caret.className = 'caret';
  el.append(span, caret);
  if (REDUCED) { span.textContent = text; caret.remove(); return; }
  let i = 0;
  while (i < text.length) {
    if (stale()) return;
    i = Math.min(text.length, i + 2);
    span.textContent = text.slice(0, i);
    const ch = text[i - 1];
    await sleep(ch === '.' || ch === ',' ? 60 : 14);
  }
  setTimeout(() => caret.remove(), 1800);
}

/* ---------- AI coin creator helpers (offline fallback when the AI is not configured) ---------- */
const STOPWORDS = new Set('a an the and or of to in on for with that this is are be it as at by from into over under like who what which when where very just about some my your our their its only up out has have'.split(' '));
const NAME_PREFIX = ['Quantum', 'Hyper', 'Neon', 'Turbo', 'Cosmic', 'Giga', 'Astro', 'Laser', 'Void', 'Plasma', 'Mega', 'Nova', 'Orbital', 'Chrono'];
const NAME_SUFFIX = ['Inu', 'Cat', 'Frog', 'Club', 'Army', 'Nova', 'Mode', 'Season', 'Protocol', 'Maxi', 'Gang', 'Core'];
const IDEAS = ['A raccoon that robs bear markets', 'A hamster that day-trades from a server rack', 'Frogs colonizing Mars', 'A capybara that only wakes up for green candles', 'Penguins running a validator in Antarctica'];
const capWord = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
function makeTicker(name) {
  const words = name.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return 'NOVA';
  const last = words[words.length - 1];
  let tk;
  if (words.length > 1 && last.length <= 3) tk = words.slice(0, -1).map((w) => w[0]).join('') + last;
  else if (last.length >= 3 && last.length <= 5) tk = last;
  else { const w = words.slice().sort((a, b) => b.length - a.length)[0]; tk = w[0] + w.slice(1).replace(/[AEIOU]/g, ''); }
  tk = tk.replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (tk.length < 3) tk = words.join('').replace(/[^A-Z0-9]/g, '').slice(0, 4);
  return tk || 'NOVA';
}
function localIdea(concept) {
  const words = String(concept).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const core = words.length ? words[Math.floor(Math.random() * Math.min(words.length, 3))] : pick(['nova', 'void', 'pulse']);
  const Core = capWord(core);
  const other = words.find((w) => w !== core);
  const patterns = [
    () => `${pick(NAME_PREFIX)} ${Core}`,
    () => `${Core} ${pick(NAME_SUFFIX)}`,
    () => (other ? `${capWord(other)} ${Core}` : `${Core} ${pick(NAME_SUFFIX)}`),
    () => `${Core}${pick(['tron', 'verse', 'zilla'])}`,
  ];
  const name = pick(patterns)().slice(0, 24).trim();
  const descs = [
    `${name} is the ${core} the timeline didn't know it needed.`,
    `One ${core}, one curve, zero chill. ${name} is here.`,
    `${name} was born in the trenches and runs on memes.`,
    `The ${core} economy starts now, and ${name} isn't asking permission.`,
  ];
  return { name, ticker: makeTicker(name), description: pick(descs).slice(0, 150), imageQuery: core };
}
/* =========================================================
   VIEW 3 · PROFILE HUD
   ========================================================= */
function readFileAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
/** Center-crop to a square and downscale, so uploads stay small enough for local storage. */
async function imageToDataURL(file, size, type = 'image/jpeg') {
  if (!file || !/^image\//.test(file.type)) throw new Error('not-image');
  const img = await loadImage(await readFileAsDataURL(file));
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL(type, 0.86);
}

const PNL_GLOW = {
  id: 'snGlow',
  beforeDatasetDraw(chart, args) { if (args.index !== 0) return; const c = chart.ctx; c.save(); c.shadowColor = 'rgba(0,243,255,0.85)'; c.shadowBlur = 18; },
  afterDatasetDraw(chart, args) { if (args.index !== 0) return; chart.ctx.restore(); },
};
const PNL_HOVER = {
  id: 'snHover',
  afterDatasetsDraw(chart) {
    const a = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
    if (!a || !a.length) return;
    const x = a[0].element.x, { top, bottom } = chart.chartArea, c = chart.ctx;
    c.save(); c.strokeStyle = 'rgba(0,243,255,0.35)'; c.lineWidth = 1; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke(); c.restore();
  },
};

const Profile = {
  chart: null, range: 0, lastLive: 0, statEls: null, holdEls: new Map(), launchEls: new Map(), feesBusy: false,
  init() {
    $('#avatars').addEventListener('click', (e) => {
      const b = e.target.closest('[data-av]');
      if (!b || !state.user) return;
      const v = b.dataset.av;
      if (v === 'upload') { $('#avatar-file').click(); return; }
      if (v === 'custom') { if (state.user.customData) this.setAvatar({ kind: 'custom', data: state.user.customData }); return; }
      this.setAvatar({ kind: 'preset', id: +v });
    });
    $('#avatar-file').addEventListener('change', (e) => this.upload(e.target.files && e.target.files[0]));
    $('#pnl-range').addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      this.range = +b.dataset.r;
      $$('#pnl-range [data-r]').forEach((x) => x.classList.toggle('on', x === b));
      this.renderChart(true);
    });
    $('#id-card').addEventListener('click', (e) => {
      if (e.target.closest('#handle-edit')) this.editHandle();
      else if (e.target.closest('#disconnect')) Wallet.disconnect();
      else if (e.target.closest('[data-buysol]')) Funding.buySol();
      else if (e.target.closest('[data-airdrop]')) Funding.airdrop();
      else if (e.target.closest('[data-pro]')) ProModal.open();
      else if (e.target.closest('[data-claim]')) this.claimFees();
      else if (e.target.closest('[data-refresh]')) Account.refresh(true);
    });
  },
  onShow() { this.render(); },

  /* ---------- portfolio math ---------- */
  portfolio() {
    const u = state.user, sp = state.solPrice;
    let val = 0, unreal = 0, n = 0;
    if (u && sp) for (const [id, h] of Object.entries(u.holdings)) {
      const t = tokenById(id);
      if (!t || !(t.price > 0)) continue;
      const v = (h.amount * t.price) / sp;
      val += v; n++;
      if (h.costKnown) unreal += v - h.cost;
    }
    return { val, n, unreal, total: (u ? u.sol : 0) + val };
  },
  totalPnl() { const u = state.user; return u ? u.realized + this.portfolio().unreal : 0; },
  tier(total) { return total >= 500 ? 'Whale' : total >= 200 ? 'Shark' : total >= 50 ? 'Dolphin' : 'Shrimp'; },

  /* ---------- render ---------- */
  render() {
    const u = state.user;
    $('#profile-locked').hidden = !!u;
    $('#profile-on').hidden = !u;
    if (!u) return;
    this.renderId(); this.renderStats(); this.renderAvatars(); this.renderHoldings(); this.renderLaunched();
    if (state.view === 'profile') this.renderChart(false);
  },
  renderId() {
    const u = state.user, p = this.portfolio();
    const pro = state.session && state.session.pro;
    const f = (state.cfg && state.cfg.features) || {};
    const proLine = pro && pro.active
      ? `<span class="badge badge-pro"><i class="fa-solid fa-crown"></i>Pro until ${esc(fmtDay(pro.until))}</span>`
      : `<button class="chip" data-pro><i class="fa-solid fa-crown"></i>Unlock Pro</button>`;
    const fund = state.cluster === 'devnet'
      ? '<button class="btn btn-ghost btn-sm" data-airdrop><i class="fa-solid fa-faucet-drip"></i>Free devnet SOL</button>'
      : f.moonpay ? '<button class="btn btn-ghost btn-sm" data-buysol><i class="fa-solid fa-credit-card"></i>Buy SOL · Apple Pay</button>' : '';
    const fees = u.launches && u.launches.length
      ? `<div class="mt-4 p-3 rounded-xl" style="background:rgba(0,255,163,.06);border:1px solid rgba(0,255,163,.18)"><div class="flex items-center justify-between gap-3"><div><div class="label" style="margin:0">Creator rewards</div><div class="mono text-[13px] mt-1" id="creator-fees">${u.creatorFees == null ? 'Checking…' : fmtSOL(u.creatorFees, 4) + ' SOL claimable'}</div></div><button class="btn btn-primary btn-sm" data-claim ${u.creatorFees > 0 ? '' : 'disabled'}><i class="fa-solid fa-hand-holding-dollar"></i>Claim</button></div></div>`
      : '';
    $('#id-card').innerHTML = `
      <div class="flex items-center gap-4">
        <div class="id-avatar"><img src="${esc(avatarURI(u.avatar))}" alt="Your avatar"></div>
        <div class="min-w-0">
          <span class="tier"><i class="fa-solid fa-crown"></i>${this.tier(p.total)} tier</span>
          <div class="mt-2" id="handle-wrap"><button class="id-handle" id="handle-edit" aria-label="Edit your handle">@${esc(u.handle)}<i class="fa-solid fa-pen"></i></button></div>
          <div class="text-[12px] text-ink-3 mt-1">${esc(u.wallet)} on Solana ${esc(state.cluster)}</div>
          <div class="mt-2 flex flex-wrap gap-1.5">${proLine}</div>
        </div>
      </div>
      <div class="mt-5"><div class="label">Wallet address</div>
        <button class="addr-chip mono w-full justify-between" data-copy="${esc(u.address)}" style="padding:10px 12px;font-size:12px" aria-label="Copy wallet address"><span class="truncate">${esc(u.address)}</span><i class="fa-regular fa-copy"></i></button>
      </div>
      <div class="grid grid-cols-2 gap-2.5 mt-4">
        <button class="btn btn-ghost btn-sm" data-nav="terminal"><i class="fa-solid fa-chart-line"></i>Trade</button>
        ${fund || `<a class="btn btn-ghost btn-sm" href="${esc(explorerAddr(u.address))}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i>Solscan</a>`}
        <button class="btn btn-ghost btn-sm" data-refresh><i class="fa-solid fa-rotate"></i>Refresh</button>
        <button class="btn btn-danger btn-sm" id="disconnect"><i class="fa-solid fa-right-from-bracket"></i>Disconnect</button>
      </div>${fees}`;
    if (u.launches && u.launches.length && u.creatorFees == null) this.loadFees();
  },
  async loadFees() {
    const u = state.user;
    if (!u || this.feesBusy) return;
    this.feesBusy = true;
    try { const L = await SN.launchlab(); u.creatorFees = await L.creatorFeeBalance(u.address); }
    catch { u.creatorFees = 0; }
    finally { this.feesBusy = false; }
    if (state.user === u && state.view === 'profile') this.renderId();
  },
  async claimFees() {
    const u = state.user;
    if (!u || !(u.creatorFees > 0)) return;
    const btn = $('#id-card [data-claim]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Approve in wallet'; }
    try {
      const L = await SN.launchlab();
      const sig = await L.claimCreatorFees();
      toast({ type: 'success', icon: 'fa-hand-holding-dollar', title: `Claimed ${fmtSOL(u.creatorFees, 4)} SOL`, msg: 'Creator rewards are in your wallet as plain SOL.', action: { label: 'View on Solscan', onClick: () => window.open(explorerTx(sig), '_blank', 'noopener') } });
      u.creatorFees = null;
      Account.soon(false);
    } catch (e) {
      if (!isRejection(e)) toast({ type: 'error', title: "Couldn't claim rewards", msg: esc((e && e.message) || 'Try again.') });
    }
    this.renderId();
  },
  editHandle() {
    const wrap = $('#handle-wrap'), u = state.user;
    if (!wrap || !u) return;
    wrap.innerHTML = `<input class="field handle-input" id="handle-in" maxlength="20" value="${esc(u.handle)}" aria-label="Your handle" spellcheck="false" autocomplete="off">`;
    const inp = $('#handle-in');
    inp.focus(); inp.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) {
        const v = inp.value.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
        if (v.length >= 3 && v !== u.handle) { u.handle = v; toast({ type: 'success', title: 'Handle updated', msg: `You're now @${esc(v)}.`, duration: 2600 }); saveSoon(); }
        else if (v.length && v.length < 3) toast({ type: 'error', title: 'Handle not saved', msg: 'Use 3 to 20 letters, numbers or underscores.' });
      }
      this.renderId();
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
    inp.addEventListener('blur', () => finish(true));
  },
  renderStats() {
    $('#stat-cards').innerHTML = `
      <div class="panel stat-card spot"><div class="k"><i class="fa-solid fa-coins text-neon-cyan"></i>SOL balance</div><div class="v" data-s="sol"></div><div class="s" data-s="solusd"></div></div>
      <div class="panel stat-card spot"><div class="k"><i class="fa-solid fa-layer-group text-neon-violet"></i>Portfolio value</div><div class="v" data-s="port"></div><div class="s" data-s="ports"></div></div>
      <div class="panel stat-card spot"><div class="k"><i class="fa-solid fa-bullseye text-neon-green"></i>Win rate</div><div class="v" data-s="wr"></div><div class="winrate"><i data-s="wrbar"></i></div><div class="s" data-s="wrs"></div></div>
      <div class="panel stat-card spot"><div class="k"><i class="fa-solid fa-chart-line text-neon-cyan"></i>All-time PnL</div><div class="v" data-s="pnl"></div><div class="s" data-s="pnlusd"></div></div>`;
    this.statEls = {};
    $$('[data-s]', $('#stat-cards')).forEach((el) => { this.statEls[el.dataset.s] = el; });
    this.statsLive();
  },
  statsLive() {
    const u = state.user, f = this.statEls;
    if (!u || !f) return;
    const p = this.portfolio(), pnl = this.totalPnl(), sp = state.solPrice;
    setText(f.sol, u.solKnown ? fmtSOL(u.sol) + ' SOL' : '…');
    setText(f.solusd, '≈ ' + fmtUSD(u.sol * sp));
    setText(f.port, fmtSOL(p.total) + ' SOL');
    setText(f.ports, `${fmtSOL(p.val)} SOL across ${p.n} position${p.n === 1 ? '' : 's'}`);
    const wr = (u.stats.wins / Math.max(1, u.stats.wins + u.stats.losses)) * 100;
    setText(f.wr, wr.toFixed(1) + '%');
    f.wrbar.style.width = wr.toFixed(1) + '%';
    setText(f.wrs, u.stats.wins + u.stats.losses ? `${fmtInt(u.stats.wins)} wins, ${fmtInt(u.stats.losses)} losses` : 'From your closed Supernova trades');
    setText(f.pnl, signed(pnl) + ' SOL');
    setDir(f.pnl, pnl);
    setText(f.pnlusd, (pnl >= 0 ? '+' : '−') + fmtUSD(Math.abs(pnl * sp)));
  },
  renderAvatars() {
    const u = state.user;
    const isPreset = (i) => u.avatar.kind === 'preset' && u.avatar.id === i;
    $('#avatars').innerHTML =
      AVATARS.map((a, i) => `<button class="avatar-opt ${isPreset(i) ? 'on' : ''}" data-av="${i}" aria-pressed="${isPreset(i)}" aria-label="Use the ${a.name} avatar"><img src="${a.uri}" alt=""></button>`).join('') +
      (u.customData ? `<button class="avatar-opt ${u.avatar.kind === 'custom' ? 'on' : ''}" data-av="custom" aria-pressed="${u.avatar.kind === 'custom'}" aria-label="Use your uploaded avatar"><img src="${esc(u.customData)}" alt=""></button>` : '') +
      `<button class="avatar-opt upload" data-av="upload" aria-label="Upload a custom avatar"><i class="fa-solid fa-upload"></i>Upload</button>`;
  },
  async upload(file) {
    $('#avatar-file').value = '';
    if (!file || !state.user) return;
    if (!/^image\//.test(file.type)) { toast({ type: 'error', title: "That file isn't an image", msg: 'Upload a PNG, JPG, GIF or WebP.' }); return; }
    if (file.size > 12 * 1024 * 1024) { toast({ type: 'error', title: 'That image is too large', msg: 'Pick an image under 12 MB.' }); return; }
    try {
      const data = await imageToDataURL(file, 192);
      state.user.customData = data;
      this.setAvatar({ kind: 'custom', data });
      toast({ type: 'success', title: 'Avatar updated', msg: 'Your upload is cropped to a square and saved in this browser only.' });
    } catch { toast({ type: 'error', title: "Couldn't read that image", msg: 'Try a different file.' }); }
  },
  setAvatar(av) {
    state.user.avatar = av;
    this.renderAvatars(); this.renderId(); Header.renderWallet();
    saveSoon();
  },
  renderHoldings() {
    const u = state.user, box = $('#holdings');
    const rows = Object.entries(u.holdings).map(([id, h]) => ({ t: tokenById(id), h })).filter((x) => x.t)
      .sort((a, b) => b.h.amount * b.t.price - a.h.amount * a.t.price);
    this.holdEls.clear();
    if (!rows.length) {
      box.innerHTML = `<div class="empty"><span>${u.solKnown ? 'No tokens in this wallet yet.' : 'Loading your wallet…'}</span><button class="btn btn-ghost btn-sm" data-nav="terminal"><i class="fa-solid fa-chart-line"></i>Open the terminal</button></div>`;
      setText($('#hold-sum'), '');
      return;
    }
    box.innerHTML = rows.map(({ t }) => `<div class="list-row" role="button" tabindex="0" data-token="${esc(t.id)}" aria-label="Trade ${esc(t.symbol)}">${logoImg(t)}<div class="min-w-0"><div class="font-semibold text-[13.5px] truncate">${esc(t.name)}</div><div class="mono text-[11px] text-ink-3" data-h="amt"></div></div><div class="text-right mono"><div class="text-[13px]" data-h="val"></div><div class="text-[11.5px]" data-h="pnl"></div></div></div>`).join('');
    $$('.list-row', box).forEach((row) => { const f = {}; row.querySelectorAll('[data-h]').forEach((el) => { f[el.dataset.h] = el; }); this.holdEls.set(row.dataset.token, f); });
    this.holdingsLive();
  },
  holdingsLive() {
    const u = state.user;
    if (!u) return;
    let tot = 0;
    for (const [id, f] of this.holdEls) {
      const t = tokenById(id), h = u.holdings[id];
      if (!t || !h) continue;
      const v = state.solPrice && t.price > 0 ? (h.amount * t.price) / state.solPrice : 0;
      tot += v;
      setText(f.amt, `${fmtNum(h.amount)} $${t.symbol}`);
      setText(f.val, t.price > 0 ? fmtSOL(v) + ' SOL' : 'No price');
      if (h.costKnown) { const pnl = v - h.cost; setText(f.pnl, `${signed(pnl)} SOL (${fmtPct(h.cost ? (pnl / h.cost) * 100 : 0)})`); setDir(f.pnl, pnl); }
      else { setText(f.pnl, h.partial ? 'partial history' : 'cost unknown'); f.pnl.className = 'text-[11.5px] text-ink-3'; }
    }
    if (this.holdEls.size) setText($('#hold-sum'), fmtSOL(tot) + ' SOL');
  },
  renderLaunched() {
    const u = state.user, box = $('#launched');
    const mine = state.tokens.filter((t) => t.kind === 'user' && t.creator === u.address).sort((a, b) => b.createdAt - a.createdAt);
    this.launchEls.clear();
    if (!mine.length) {
      box.innerHTML = `<div class="empty"><span>You haven't launched a coin from this wallet yet.</span><button class="btn btn-primary btn-sm" data-nav="launch"><i class="fa-solid fa-rocket"></i>Launch your first coin</button></div>`;
      return;
    }
    box.innerHTML = mine.map((t) => `<div class="list-row" role="button" tabindex="0" data-token="${esc(t.id)}" aria-label="Trade ${esc(t.symbol)}">${logoImg(t)}<div class="min-w-0"><div class="flex items-center gap-1.5"><span class="font-semibold text-[13.5px] truncate">${esc(t.name)}</span><span class="mono text-[11px] text-ink-3">$${esc(t.symbol)}</span></div><div class="mt-1.5 w-[150px] max-w-full curve-bar" data-l="cb"><i data-l="cbi"></i></div></div><div class="text-right mono"><div class="text-[13px]" data-l="mc"></div><div class="text-[11px] text-ink-3" data-l="age"></div></div></div>`).join('');
    $$('.list-row', box).forEach((row) => { const f = {}; row.querySelectorAll('[data-l]').forEach((el) => { f[el.dataset.l] = el; }); this.launchEls.set(row.dataset.token, f); });
    this.launchedLive();
  },
  launchedLive() {
    for (const [id, f] of this.launchEls) {
      const t = tokenById(id);
      if (!t) continue;
      setText(f.mc, fmtUSD(t.mcap));
      setText(f.age, t.graduated ? 'Graduated' : `${t.curve.toFixed(1)}% to graduation`);
      f.cb.classList.toggle('grad', t.graduated);
      f.cbi.style.width = (t.graduated ? 100 : t.curve).toFixed(1) + '%';
    }
  },

  /* ---------- PnL chart ---------- */
  series() {
    const u = state.user, now = Date.now();
    let pts = [{ t: Math.min(u.joined, u.trades.length ? u.trades[0].ts : now) - 60000, v: 0 }, ...u.pnl];
    pts.push({ t: now, v: +this.totalPnl().toFixed(4) });
    if (this.range) pts = pts.filter((p) => p.t >= now - this.range * 86400000);
    if (pts.length < 2) pts.unshift({ t: now - 3600e3, v: pts.length ? pts[0].v : 0 });
    return pts;
  },
  label(ts) { const d = new Date(ts); return Date.now() - ts < 86400000 ? pad2(d.getHours()) + ':' + pad2(d.getMinutes()) : fmtDay(ts); },
  renderChart(animate) {
    if (!state.user) return;
    if (!window.Chart) { libsReady.then(() => { if (window.Chart && state.view === 'profile') this.renderChart(true); }); return; }
    const pts = this.series();
    const labels = pts.map((p) => this.label(p.t)), data = pts.map((p) => p.v);
    if (this.chart) {
      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data = data;
      this.chart.update(animate ? undefined : 'none');
      return;
    }
    const Ch = window.Chart;
    Ch.defaults.font.family = "'JetBrains Mono', ui-monospace, monospace";
    Ch.defaults.color = C.ink3;
    this.chart = new Ch($('#pnl-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data, borderWidth: 2.4, tension: 0.35, fill: 'origin',
          pointRadius: 0, pointHoverRadius: 5, pointHoverBorderWidth: 2, pointHoverBackgroundColor: C.cyan, pointHoverBorderColor: '#020205',
          borderColor: (ctx) => { const { chart } = ctx, a = chart.chartArea; if (!a) return C.cyan; const g = chart.ctx.createLinearGradient(a.left, 0, a.right, 0); g.addColorStop(0, C.violet); g.addColorStop(1, C.cyan); return g; },
          backgroundColor: (ctx) => { const { chart } = ctx, a = chart.chartArea; if (!a) return 'rgba(0,243,255,0.1)'; const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom); g.addColorStop(0, 'rgba(0,243,255,0.28)'); g.addColorStop(0.6, 'rgba(168,85,247,0.07)'); g.addColorStop(1, 'rgba(168,85,247,0)'); return g; },
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: REDUCED ? false : { duration: 1100, easing: 'easeOutQuart' },
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 10, right: 6, left: 2 } },
        plugins: {
          legend: { display: false },
          filler: { drawTime: 'beforeDatasetsDraw' },
          tooltip: {
            backgroundColor: 'rgba(10,10,20,0.95)', borderColor: 'rgba(0,243,255,0.35)', borderWidth: 1, padding: 10, displayColors: false,
            titleColor: C.ink2, bodyColor: C.ink, titleFont: { size: 11 }, bodyFont: { size: 12.5, weight: '600' },
            callbacks: { label: (c) => `${c.parsed.y >= 0 ? '+' : ''}${c.parsed.y.toFixed(2)} SOL` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0, autoSkipPadding: 18, font: { size: 10.5 } } },
          y: { grid: { color: 'rgba(255,255,255,0.045)' }, border: { display: false }, ticks: { font: { size: 10.5 }, callback: (v) => v + ' SOL' } },
        },
      },
      plugins: [PNL_GLOW, PNL_HOVER],
    });
  },
  live() {
    const now = performance.now();
    if (now - this.lastLive < 2000 || !state.user) return;
    this.lastLive = now;
    this.statsLive(); this.holdingsLive(); this.launchedLive();
    if (this.chart) { const ds = this.chart.data.datasets[0]; ds.data[ds.data.length - 1] = +this.totalPnl().toFixed(3); this.chart.update('none'); }
  },
};


/* =========================================================
   VIEW 4 · LAUNCHPAD (real Raydium LaunchLab coins)
   ========================================================= */
function setHint(id, text, err = false) { const el = $('#' + id); if (!el) return; el.textContent = text; el.classList.toggle('err', err); }
async function typeInto(input, text) {
  input.value = '';
  const fire = () => input.dispatchEvent(new Event('input', { bubbles: true }));
  if (REDUCED) { input.value = text; fire(); return; }
  const delay = text.length > 60 ? 7 : 24;
  for (let i = 1; i <= text.length; i++) { input.value = text.slice(0, i); if (i % 2 === 0 || i === text.length) fire(); await sleep(delay); }
}

/* LaunchLab defaults (SOL quote, constant-product curve): 1B supply, ~793M sold on the curve, 85 SOL raise. */
const CURVE0 = { vA: 1073471847.374405, vB: 30.050573465, supply: 1e9, target: 85, fee: 0.01 };
const RENT_EST = 0.018;

const Launch = {
  seed: 'mark-' + Math.random().toString(36).slice(2, 8),
  imgData: null, photo: null, photos: [], deploying: false, forging: false, total: 0, btnKey: null,
  init() {
    $('#f-name').addEventListener('input', () => { this.markField('name'); this.updatePreview(); });
    $('#f-ticker').addEventListener('input', (e) => {
      const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      if (v !== e.target.value) e.target.value = v;
      this.markField('ticker'); this.updatePreview();
    });
    $('#f-desc').addEventListener('input', () => this.updatePreview());
    $('#f-dev').addEventListener('input', () => { setText($('#f-dev-v'), (+$('#f-dev').value).toFixed(1) + ' SOL'); this.updatePreview(); this.updateCost(); });
    $('#f-upload').addEventListener('click', () => $('#f-file').click());
    $('#f-file').addEventListener('change', (e) => this.upload(e.target.files && e.target.files[0]));
    $('#f-reroll').addEventListener('click', () => {
      this.seed = 'mark-' + Math.random().toString(36).slice(2, 8);
      this.imgData = null; this.photo = null;
      this.paintPhotos();
      setHint('f-img-h', 'New generated mark. Upload art or pick a photo to replace it.');
      this.updatePreview();
      const logo = $('#pv-logo');
      if (logo.animate && !REDUCED) logo.animate([{ transform: 'rotate(-180deg) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 600, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    });
    $('#f-photos').addEventListener('click', (e) => { const b = e.target.closest('[data-photo]'); if (b) this.pickPhoto(+b.dataset.photo); });
    $('#f-mev').addEventListener('click', (e) => {
      if (!isMainnet()) { toast({ type: 'info', title: 'MEV shield is mainnet only', msg: 'On devnet the launch goes straight to the RPC.', duration: 3200 }); return; }
      const b = e.currentTarget, on = !b.classList.contains('on');
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
      this.updateCost();
    });
    $('#forge-go').addEventListener('click', () => this.forge());
    $('#forge-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.forge(); });
    $('#idea-chips').innerHTML = IDEAS.map((s) => `<button class="chip" data-idea="${esc(s)}"><i class="fa-solid fa-lightbulb"></i>${esc(s)}</button>`).join('');
    $('#idea-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-idea]'); if (!b) return; $('#forge-in').value = b.dataset.idea; this.forge(); });
    $('#deploy-btn').addEventListener('click', () => this.deploy());
    this.updatePreview();
    this.updateCost();
  },
  onShow() {
    AI.labels();
    const mev = $('#f-mev');
    if (!isMainnet()) { mev.classList.remove('on'); mev.setAttribute('aria-checked', 'false'); }
    setText($('#launch-net'), isMainnet() ? 'Solana mainnet' : 'Solana devnet (test SOL)');
    this.updatePreview(); this.updateCost();
  },

  values() {
    return {
      name: $('#f-name').value.replace(/\s+/g, ' ').trim(),
      ticker: $('#f-ticker').value.trim(),
      desc: $('#f-desc').value.replace(/\s+/g, ' ').trim(),
      dev: +$('#f-dev').value,
      twitter: $('#f-x').value.trim(), telegram: $('#f-tg').value.trim(), website: $('#f-web').value.trim(),
    };
  },
  imageSrc() { return this.imgData || (this.photo ? this.photo.full : null); },
  logoSrc(v) { return this.imgData || (this.photo ? this.photo.thumb : null) || tokenLogo(v.ticker || 'NOVA', this.seed); },
  /** Start of the curve after the optional dev buy (constant product, ~1% fees). */
  startState(dev) {
    const sp = state.solPrice || 0;
    const inB = Math.max(0, dev) * (1 - CURVE0.fee);
    const out = CURVE0.vA - (CURVE0.vA * CURVE0.vB) / (CURVE0.vB + inB);
    const price = ((CURVE0.vB + inB) / (CURVE0.vA - out)) * sp;
    return { price, mcap: price * CURVE0.supply, curve: (inB / CURVE0.target) * 100, tokens: out, devPct: (out / CURVE0.supply) * 100 };
  },
  errors(v) {
    const e = {};
    if (v.name.length < 2) e.name = 'Give your coin a name of at least 2 characters.';
    if (v.ticker.length < 2) e.ticker = 'Tickers need 2 to 10 letters or numbers.';
    for (const [k, label] of [['twitter', 'X link'], ['telegram', 'Telegram link'], ['website', 'Website']]) if (v[k] && !/^https:\/\/\S+$/i.test(v[k])) e[k] = `${label} must start with https://`;
    return e;
  },
  markField(which, force) {
    const v = this.values(), e = this.errors(v);
    const map = { name: ['f-name', 'f-name-h', '2 to 32 characters.'], ticker: ['f-ticker', 'f-ticker-h', '2 to 10 letters or numbers.'] };
    const [fid, hid, ok] = map[which];
    const val = which === 'name' ? v.name : v.ticker;
    const bad = !!e[which] && (force || val.length >= 2);
    $('#' + fid).classList.toggle('invalid', bad);
    if (bad) setHint(hid, e[which], true);
    else if (which === 'ticker' && val) {
      const dup = state.tokens.find((t) => t.symbol === val);
      setHint(hid, dup ? `$${val} is already used by ${dup.name}. You can still launch it, but a unique ticker is easier to find.` : `$${val} looks free on Supernova.`, false);
    } else setHint(hid, ok);
  },
  updatePreview() {
    const v = this.values(), s = this.startState(v.dev);
    const logo = $('#pv-logo'), src = this.logoSrc(v);
    if (logo.getAttribute('src') !== src) logo.src = src;
    setText($('#pv-name'), v.name || 'Your coin');
    setText($('#pv-sym'), '$' + (v.ticker || 'TICKER'));
    setText($('#pv-desc'), v.desc || 'Your one-line pitch shows here.');
    setText($('#pv-mc'), state.solPrice ? fmtUSD(s.mcap) : '—');
    setText($('#pv-px'), state.solPrice ? '$' + fmtPrice(s.price) : '—');
    setText($('#pv-curve'), s.curve.toFixed(1) + '%');
    $('#pv-curve-bar').style.width = clamp(s.curve, 0, 100).toFixed(1) + '%';
    setText($('#pv-addr'), 'Address set at deploy');
    setText($('#pv-dev'), v.dev > 0 ? `${s.devPct.toFixed(2)}% to you` : 'No dev buy');
  },
  updateCost() {
    const dev = +$('#f-dev').value, u = state.user;
    const prio = isMainnet() ? PRIO[state.trade.prio].fee : 0;
    const fee = dev * CURVE0.fee;
    const total = RENT_EST + prio + dev + fee + 0.00001;
    this.total = total;
    $('#cost').innerHTML =
      `<div><span>On-chain accounts (rent)</span><b>≈ ${RENT_EST.toFixed(3)} SOL</b></div>` +
      `<div><span>${$('#f-mev').classList.contains('on') && isMainnet() ? 'Jito tip' : 'Priority fee'}</span><b>${prio ? prio + ' SOL' : 'none on devnet'}</b></div>` +
      `<div><span>Dev buy</span><b>${dev.toFixed(2)} SOL</b></div>` +
      (dev > 0 ? `<div><span>Trading fee on the dev buy</span><b>≈ ${fmtSOL(fee, 4)} SOL</b></div>` : '') +
      `<div><span>Image and metadata on IPFS</span><b>Free</b></div>` +
      `<div class="tot"><span>Total (estimate)</span><b>${fmtSOL(total, 4)} SOL</b></div>` +
      (u ? `<div><span>Wallet balance</span><b class="${!u.solKnown || u.sol >= total ? '' : 'down'}">${u.solKnown ? fmtSOL(u.sol) + ' SOL' : '…'}</b></div>` : `<div><span>Wallet</span><b>Not connected</b></div>`);
    if (this.deploying) return;
    const key = u ? 'deploy' : 'connect';
    if (key === this.btnKey) return;
    this.btnKey = key;
    $('#deploy-btn').innerHTML = u ? '<i class="fa-solid fa-rocket"></i>Launch coin' : '<i class="fa-solid fa-wallet"></i>Connect wallet to launch';
  },
  async upload(file) {
    $('#f-file').value = '';
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) { toast({ type: 'error', title: "That file isn't supported", msg: 'Upload a PNG, JPG, GIF or WebP image.' }); return; }
    if (file.size > 15 * 1024 * 1024) { toast({ type: 'error', title: 'That image is too large', msg: 'Pick an image under 15 MB.' }); return; }
    try {
      this.imgData = await imageToDataURL(file, 512, 'image/jpeg');
      this.photo = null; this.paintPhotos();
      setHint('f-img-h', `Using ${file.name.slice(0, 40)} (cropped to a 512px square).`);
      this.updatePreview();
    } catch { toast({ type: 'error', title: "Couldn't use that file", msg: 'Upload a PNG, JPG, GIF or WebP image.' }); }
  },
  paintPhotos() {
    const box = $('#f-photos');
    if (!this.photos.length) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = this.photos.map((p, i) => `<button class="photo-opt ${this.photo === p ? 'on' : ''}" data-photo="${i}" aria-label="Use photo ${i + 1}${p.alt ? ': ' + esc(p.alt) : ''}" style="background-color:${esc(p.color || '#111')}"><img src="${esc(p.thumb)}" alt="" loading="lazy"></button>`).join('');
  },
  pickPhoto(i) {
    const p = this.photos[i];
    if (!p) return;
    this.photo = p; this.imgData = null;
    this.paintPhotos();
    $('#f-img-h').innerHTML = `Photo by <a href="${esc(p.photographerUrl || p.page)}" target="_blank" rel="noopener">${esc(p.photographer || 'Pexels')}</a> on <a href="${esc(p.page)}" target="_blank" rel="noopener">Pexels</a>. It is cropped to a square at launch.`;
    this.updatePreview();
  },

  /* ---------- AI coin creator (free) ---------- */
  async forge() {
    if (this.forging) return;
    const concept = $('#forge-in').value.trim();
    if (concept.length < 3) {
      nudge($('#forge-in'));
      toast({ type: 'info', title: 'Describe a concept first', msg: 'A few words is enough, like “a raccoon that robs bear markets”.' });
      return;
    }
    this.forging = true;
    const btn = $('#forge-go');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span><span>Generating</span>';
    let idea = null, photos = [], via = 'local';
    if (state.cfg && state.cfg.features.ai) {
      try {
        const r = await SN.ai.builder(concept);
        idea = r.idea; photos = r.photos || []; via = 'claude';
      } catch (e) {
        toast({ type: 'warn', title: 'The AI builder is busy', msg: esc((e && e.message) || 'The built-in generator filled the form instead.') });
      }
    }
    if (!idea) {
      idea = localIdea(concept);
      if (state.cfg && state.cfg.features.images) photos = (await SN.media.search(idea.imageQuery).catch(() => ({ photos: [] }))).photos || [];
    }
    this.seed = 'mark-' + hashSeed(idea.name + Date.now()).toString(36);
    this.imgData = null; this.photo = null;
    this.photos = photos.slice(0, 8);
    this.paintPhotos();
    btn.innerHTML = '<span class="spin"></span><span>Filling the form</span>';
    await typeInto($('#f-name'), idea.name);
    await typeInto($('#f-ticker'), idea.ticker);
    await typeInto($('#f-desc'), idea.description);
    if (this.photos.length) this.pickPhoto(0);
    else setHint('f-img-h', 'No matching photo found. Upload your own art or keep the generated mark.');
    this.updatePreview();
    toast({ type: 'ai', title: 'Coin idea ready', msg: `${esc(idea.name)} ($${esc(idea.ticker)}) is in the form${via === 'claude' ? ', written by Claude' : ''}${this.photos.length ? ' with a matching photo' : ''}. Edit anything, then launch.` });
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i><span>Generate</span>';
    this.forging = false;
    AI.labels();
  },

  /* ---------- deployment ---------- */
  async deploy() {
    if (this.deploying) return;
    const v = this.values(), errs = this.errors(v);
    if (Object.keys(errs).length) {
      this.markField('name', true); this.markField('ticker', true);
      toast({ type: 'error', title: 'Fix the highlighted fields', msg: esc(Object.values(errs)[0]) });
      nudge($('#launch-form-panel'));
      return;
    }
    if (!state.user) { Wallet.open(() => this.deploy()); return; }
    const f = (state.cfg && state.cfg.features) || {};
    if (!f.ipfs) { toast({ type: 'error', title: 'Launching is not configured yet', msg: 'The site owner needs to add IPFS storage (PINATA_JWT) so coin images and metadata can be pinned.' }); return; }
    this.updateCost();
    if (state.user.solKnown && state.user.sol < this.total) {
      toast({ type: 'error', title: 'Not enough SOL to launch', msg: `You need about ${fmtSOL(this.total, 3)} SOL and have ${fmtSOL(state.user.sol)} SOL. Lower the dev buy or add SOL.`, action: state.cluster === 'devnet' ? { label: 'Get devnet SOL', onClick: () => Funding.airdrop() } : f.moonpay ? { label: 'Buy SOL', onClick: () => Funding.buySol() } : null });
      return;
    }
    this.deploying = true;
    const btn = $('#deploy-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>Launching';
    const panel = $('#launch-form-panel');
    const old = $('#deploy-ov'); if (old) old.remove();
    const ov = document.createElement('div');
    ov.className = 'deploy-overlay';
    ov.id = 'deploy-ov';
    const mev = $('#f-mev').classList.contains('on') && isMainnet();
    const steps = ['Pinning the image to IPFS', 'Writing token metadata', `Approve in ${state.user.wallet}`, `Creating the coin on LaunchLab${mev ? ' (Jito)' : ''}`, 'Confirming on Solana', 'Listing it on Supernova'];
    ov.innerHTML = `<div class="deploy-box"><div><div class="font-black text-[22px] tracking-[-0.04em]">Launching $${esc(v.ticker)}</div><div class="text-[12.5px] text-ink-3 mt-1">Real transaction on Solana ${esc(state.cluster)}. Keep this tab open.</div></div><div class="dprog"><i id="dprog"></i></div><ol class="dsteps">${steps.map((s) => `<li><span class="ic"></span><span>${esc(s)}</span></li>`).join('')}</ol><div class="text-[12px] text-ink-3" id="deploy-note"></div></div>`;
    panel.appendChild(ov);
    if (ov.animate && !REDUCED) ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    const lis = $$('.dsteps li', ov);
    let cur = -1;
    const go = (i) => {
      for (let k = Math.max(0, cur); k < i; k++) { lis[k].classList.remove('run'); lis[k].classList.add('ok'); lis[k].querySelector('.ic').innerHTML = '<i class="fa-solid fa-check"></i>'; }
      cur = i;
      if (lis[i]) lis[i].classList.add('run');
      $('#dprog').style.width = ((i / lis.length) * 100).toFixed(0) + '%';
    };
    try {
      go(0);
      const src = this.imageSrc() || await svgToPng(tokenLogo(v.ticker, this.seed));
      const img = await SN.media.uploadImage(src, v.ticker);
      go(1);
      const meta = await SN.media.uploadMetadata({ name: v.name, symbol: v.ticker, description: v.desc, image: img.url, twitter: v.twitter, telegram: v.telegram, website: v.website });
      go(2);
      const L = await SN.launchlab();
      const res = await L.createCoin({
        name: v.name, symbol: v.ticker, uri: meta.uri, devBuySol: v.dev, slippageBps: 1000, prio: state.trade.prio, mev,
        onStep: (s, info) => {
          if (s === 'sign') go(2);
          else if (s === 'send') go(3);
          else if (s === 'confirm') { go(4); if (info && info.signature) $('#deploy-note').innerHTML = `Transaction sent: <a href="${esc(explorerTx(info.signature))}" target="_blank" rel="noopener">view on Solscan</a>`; }
          else if (s === 'index') go(5);
        },
      });
      go(lis.length);
      let t = tokenById(res.mint);
      if (res.launch) { t = Data.upsert(res.mint, 'user'); applyLaunch(t, res.launch); }
      else {
        t = Data.upsert(res.mint, 'user');
        Object.assign(t, { symbol: cleanSym(v.ticker), name: v.name, desc: v.desc, logo: img.url, fallbackLogo: tokenLogo(v.ticker, res.mint), creator: state.user.address, createdAt: Date.now(), graduated: false, curve: 0, kind: 'user' });
        Data.pollLaunches().catch(() => {});
      }
      if (state.user && !state.user.launches.includes(res.mint)) state.user.launches.unshift(res.mint);
      const share = `https://x.com/intent/post?text=${encodeURIComponent(`I just launched $${v.ticker} on Supernova`)}&url=${encodeURIComponent(location.origin + '/?token=' + res.mint)}`;
      ov.innerHTML = `<div class="success-burst"><img class="tk-logo xl" src="${esc(img.url)}" alt=""><h3>$${esc(v.ticker)} is live</h3><p class="text-[13px] text-ink-2 m-0 max-w-[36ch]">${esc(v.name)} is trading on its bonding curve. It graduates to Raydium when the curve raises ${CURVE0.target} SOL.</p><button class="mono text-[11.5px] text-ink-3 addr-chip" data-copy="${esc(res.mint)}">${esc(shortAddr(res.mint, 6))}<i class="fa-regular fa-copy"></i></button><div class="flex flex-wrap justify-center gap-2 mt-2"><button class="btn btn-primary" data-token="${esc(res.mint)}"><i class="fa-solid fa-chart-line"></i>Open in terminal</button><a class="btn btn-ghost" href="${esc(share)}" target="_blank" rel="noopener"><i class="fa-solid fa-share-nodes"></i>Share</a><a class="btn btn-ghost" href="${esc(explorerTx(res.signatures[0]))}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i>Solscan</a><button class="btn btn-ghost" id="launch-again"><i class="fa-solid fa-plus"></i>Launch another</button></div></div>`;
      $('#launch-again').addEventListener('click', () => this.resetForm());
      const r = btn.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top + 10);
      toast({ type: 'success', icon: 'fa-rocket', title: `$${v.ticker} is live`, msg: `${esc(v.name)} is on the Supernova curve.`, action: { label: 'Open in terminal', onClick: () => Router.go('terminal', { token: res.mint }) } });
      Account.soon();
      App.userChanged();
    } catch (e) {
      const cancelled = isRejection(e);
      const sigLink = e && e.signature ? `<a href="${esc(explorerTx(e.signature))}" target="_blank" rel="noopener">View the transaction</a>` : '';
      ov.innerHTML = `<div class="success-burst"><div class="feed-ic sell" style="width:56px;height:56px"><i class="fa-solid fa-${cancelled ? 'ban' : 'triangle-exclamation'}"></i></div><h3>${cancelled ? 'Launch cancelled' : 'Launch failed'}</h3><p class="text-[13px] text-ink-2 m-0 max-w-[40ch]">${cancelled ? 'You declined in your wallet. Nothing was created and no SOL was spent.' : esc((e && e.message) || 'Something went wrong.')}</p>${sigLink ? `<p class="text-[12px] m-0">${sigLink}</p>` : ''}<div class="flex flex-wrap justify-center gap-2 mt-2"><button class="btn btn-primary" id="deploy-retry"><i class="fa-solid fa-rotate-right"></i>Try again</button><button class="btn btn-ghost" id="deploy-close">Edit details</button></div></div>`;
      $('#deploy-retry').addEventListener('click', () => { ov.remove(); this.deploy(); });
      $('#deploy-close').addEventListener('click', () => ov.remove());
    } finally {
      this.deploying = false;
      btn.disabled = false;
      this.btnKey = null;
      this.updateCost();
    }
  },
  resetForm() {
    ['f-name', 'f-ticker', 'f-desc', 'forge-in', 'f-x', 'f-tg', 'f-web'].forEach((id) => { $('#' + id).value = ''; });
    $('#f-name').classList.remove('invalid'); $('#f-ticker').classList.remove('invalid');
    setHint('f-name-h', '2 to 32 characters.'); setHint('f-ticker-h', '2 to 10 letters or numbers.');
    setHint('f-img-h', 'Upload your art, or let the AI builder pick a matching photo. Without one, the generated mark is used.');
    this.imgData = null; this.photo = null; this.photos = []; this.paintPhotos();
    this.seed = 'mark-' + Math.random().toString(36).slice(2, 8);
    const ov = $('#deploy-ov'); if (ov) ov.remove();
    this.updatePreview(); this.updateCost();
    $('#f-name').focus();
  },
};

/** Generated SVG marks become a 512px PNG so wallets and explorers can show them. */
async function svgToPng(svgUri) {
  const img = await loadImage(svgUri);
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  c.getContext('2d').drawImage(img, 0, 0, 512, 512);
  return c.toDataURL('image/png');
}

/* =========================================================
   SUPERNOVA PRO: card / Apple Pay / Google Pay (Stripe) or SOL from the wallet
   ========================================================= */
const ProModal = {
  el: null, isOpen: false, busy: false, reason: null, lastFocus: null,
  ensure() {
    if (this.el) return;
    const root = document.createElement('div');
    root.className = 'modal-root';
    root.id = 'pro-modal';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'pro-title');
    root.innerHTML = `<div class="modal panel glass pro-modal"><div class="panel-hd"><h2 class="panel-title" id="pro-title"><i class="fa-solid fa-crown text-neon-violet"></i>Supernova Pro</h2><button class="icon-btn sm" data-pro-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div><div class="p-4 grid gap-3" id="pro-body"></div></div>`;
    document.body.appendChild(root);
    root.addEventListener('click', (e) => {
      if (e.target === root || e.target.closest('[data-pro-close]')) { this.close(); return; }
      if (e.target.closest('[data-pay-card]')) this.payCard();
      else if (e.target.closest('[data-pay-sol]')) this.paySol();
      else if (e.target.closest('[data-pro-manage]')) this.manage();
      else if (e.target.closest('[data-pro-connect]')) { this.close(); Wallet.open(() => ProModal.open(this.reason)); }
    });
    this.el = root;
  },
  open(reason) {
    this.ensure();
    this.reason = reason || null;
    this.render();
    this.lastFocus = document.activeElement;
    this.isOpen = true;
    this.el.classList.add('open');
    if (state.user && !state.session) Session.check().then(() => { if (this.isOpen) this.render(); });
  },
  close() {
    if (!this.isOpen || this.busy) return;
    this.isOpen = false;
    this.el.classList.remove('open');
    try { if (this.lastFocus && this.lastFocus.focus) this.lastFocus.focus({ preventScroll: true }); } catch { /* gone */ }
  },
  render() {
    if (!this.el) return;
    const cfg = state.cfg, f = (cfg && cfg.features) || {}, p = (cfg && cfg.pro) || { solPrice: 0, days: 30, priceLabel: '', freeAnalysesPerDay: 1 };
    const pro = state.session && state.session.pro;
    const perks = [
      ['fa-shield-halved', 'Rug scan', 'Dev wallet, holder concentration, mint and freeze authority, bundled launch snipes.'],
      ['fa-fish', 'Whale flow', 'Who is buying or dumping right now, from the live tape.'],
      ['fa-crosshairs', 'Entry and take-profit plans', 'Levels drawn straight onto your chart.'],
      ['fa-comments', 'Ask anything', 'Plain-language answers on any Solana token, unlimited.'],
    ];
    let actions;
    if (pro && pro.active) {
      actions = `<div class="p-3 rounded-xl" style="background:rgba(0,255,163,.07);border:1px solid rgba(0,255,163,.2)"><div class="font-bold text-[14px]"><i class="fa-solid fa-circle-check text-neon-green"></i> Pro is active</div><div class="text-[12.5px] text-ink-2 mt-1">Until ${esc(new Date(pro.until).toLocaleDateString())}${pro.source === 'stripe' ? (pro.cancelAtPeriodEnd ? ' · cancels at period end' : ' · renews automatically') : pro.source === 'sol' ? ' · paid in SOL' : ''}</div></div>` +
        (pro.manageable ? `<button class="btn btn-ghost w-full" data-pro-manage><i class="fa-solid fa-gear"></i>Manage billing</button>` : '') +
        (f.solPay ? `<button class="btn btn-ghost w-full" data-pay-sol><i class="fa-solid fa-plus"></i>Add ${p.days} days for ${p.solPrice} SOL</button>` : '');
    } else if (!state.user) {
      actions = `<button class="btn btn-primary btn-lg w-full" data-pro-connect><i class="fa-solid fa-wallet"></i>Connect a wallet to continue</button>`;
    } else {
      actions = (f.stripe ? `<button class="btn btn-primary btn-lg w-full" data-pay-card><i class="fa-solid fa-credit-card"></i>Pay with Apple Pay or card${p.priceLabel ? ' · ' + esc(p.priceLabel) : ''}</button>` : '') +
        (f.solPay ? `<button class="btn btn-violet btn-lg w-full" data-pay-sol><i class="fa-solid fa-wallet"></i>Pay ${p.solPrice} SOL from your wallet · ${p.days} days</button>` : '') +
        (!f.stripe && !f.solPay ? `<div class="text-[13px] text-ink-2">Payments are not switched on yet. The site owner needs to add Stripe or a treasury wallet (see SETUP.md).</div>` : '');
    }
    $('#pro-body', this.el).innerHTML =
      (this.reason === 'quota' ? `<div class="text-[13px] text-neon-amber"><i class="fa-solid fa-hourglass-end"></i> You used today's free analysis.</div>` : '') +
      `<p class="text-[14px] text-ink-2 m-0">The AI analyst reads the chain and the live tape for you. Free accounts get ${p.freeAnalysesPerDay} analysis a day; Pro is unlimited.</p>` +
      `<div class="grid gap-2">${perks.map(([ic, t, d]) => `<div class="flex gap-3 items-start"><span class="pi-ic" style="flex:none"><i class="fa-solid ${ic}"></i></span><div><div class="font-semibold text-[13.5px]">${t}</div><div class="text-[12px] text-ink-3">${d}</div></div></div>`).join('')}</div>` +
      `<div class="grid gap-2 mt-1" id="pro-actions">${actions}</div>` +
      `<div class="text-[11px] text-ink-3 leading-relaxed">Card payments run on Stripe Checkout; Apple Pay and Google Pay show up automatically on supported devices. SOL payments go straight from your wallet to the Supernova treasury and are verified on-chain. Not financial advice.</div>`;
  },
  async payCard() {
    if (this.busy) return;
    this.busy = true;
    const b = $('[data-pay-card]', this.el);
    if (b) b.innerHTML = '<span class="spin"></span>Opening secure checkout';
    try { await SN.pro.checkout(); }
    catch (e) {
      this.busy = false;
      if (!isRejection(e)) toast({ type: 'error', title: "Couldn't open checkout", msg: esc((e && e.message) || 'Try again.') });
      this.render();
    }
  },
  async paySol() {
    if (this.busy) return;
    this.busy = true;
    const b = $('[data-pay-sol]', this.el);
    const label = { quote: 'Preparing the payment', sign: `Approve in ${state.user ? state.user.wallet : 'your wallet'}`, confirm: 'Confirming on Solana', verify: 'Verifying the payment' };
    try {
      const r = await SN.pro.payWithSol((s) => { if (b) b.innerHTML = `<span class="spin"></span>${label[s]}`; });
      if (state.session) state.session.pro = r.status;
      App.sessionChanged();
      toast({ type: 'success', icon: 'fa-crown', title: 'Welcome to Supernova Pro', msg: `Unlocked until ${esc(new Date(r.status.until).toLocaleDateString())}.`, action: { label: 'View payment', onClick: () => window.open(explorerTx(r.signature), '_blank', 'noopener') } });
      Account.soon(false);
    } catch (e) {
      if (!isRejection(e)) toast({ type: 'error', title: 'Payment not completed', msg: esc((e && e.message) || 'Try again.'), duration: 9000, action: e && e.signature ? { label: 'View transaction', onClick: () => window.open(explorerTx(e.signature), '_blank', 'noopener') } : null });
    } finally {
      this.busy = false;
      this.render();
    }
  },
  async manage() {
    try { await SN.pro.portal(); } catch (e) { toast({ type: 'error', title: "Couldn't open billing", msg: esc((e && e.message) || 'Try again.') }); }
  },
};

/* =========================================================
   APP LIFECYCLE + BOOT
   ========================================================= */
const App = {
  inited: false,
  init() {
    Header.init(); Nav.init(); Palette.init(); Wallet.init();
    Hub.init(); Term.init(); AI.init(); Profile.init(); Launch.init();
    Ticker.build();
    this.dataUI();
    this.netUI();
    this.netBanner();
    Data.start();
    setInterval(() => this.tick(), 1000);
    setInterval(() => { if (!document.hidden) { this.netUI(); this.dataUI(); } }, 2000);
    setInterval(() => { if (!document.hidden && state.phase === 'app') Ticker.update(); }, 2000);
    setInterval(() => { if (!document.hidden && state.phase === 'app') Ticker.build(); }, 90000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.phase === 'app') { Ticker.update(); if (state.view === 'hub') Hub.renderFeed(); if (state.user) Account.refresh(false); } });
    SN.wallet.restore().catch(() => {});
    this.inited = true;
  },
  tick() {
    if (document.hidden || state.phase !== 'app') return;
    if (state.view === 'hub') Hub.live(false);
    else if (state.view === 'terminal') Term.live();
    else if (state.view === 'profile') Profile.live();
    Header.live();
  },
  netUI() {
    const n = state.net;
    setText($('#sb-rpc'), n.rpc ? n.rpc + 'ms' : '—');
    setText($('#sb-slot'), n.slot ? fmtInt(n.slot) : '—');
    setText($('#sb-sol'), state.solPrice ? '$' + fmtPrice(state.solPrice) : '—');
    setText($('#sb-status'), n.ok ? `Solana ${state.cluster}` : 'Reconnecting to Solana…');
    setText($('#sb-mev'), isMainnet() ? 'Jito' : 'mainnet only');
    if (state.view === 'hub' && n.slot) setText($('#hero-slot'), fmtInt(n.slot));
  },
  dataUI() {
    const live = state.dataSource === 'live';
    $('#data-pill').classList.toggle('live', live);
    setText($('#data-src'), live ? 'Live market data' : state.dataSource === 'loading' ? 'Connecting…' : 'Market data offline');
    $('#data-pill').title = live ? 'Prices from DexScreener and GeckoTerminal; Supernova coins straight from the chain' : 'The market data service is not reachable right now';
  },
  netBanner() {
    const b = $('#net-banner');
    if (!b) return;
    const dev = state.cluster === 'devnet';
    b.hidden = !dev;
    if (dev) b.innerHTML = `<i class="fa-solid fa-flask"></i><span class="nb-long"><b>Devnet mode.</b> Coins and SOL here are test assets with no value. Set your wallet to devnet to trade.</span><span class="nb-short"><b>Devnet</b> · test coins, no real value</span><button class="chip" data-airdrop-banner><i class="fa-solid fa-faucet-drip"></i><span class="nb-long">Free devnet SOL</span><span class="nb-short">Free SOL</span></button>`;
    const fit = () => document.documentElement.style.setProperty('--banner-h', (b.hidden ? 0 : b.offsetHeight) + 'px');
    fit();
    if (!this.bannerBound) { this.bannerBound = true; window.addEventListener('resize', debounce(fit, 150)); requestAnimationFrame(fit); }
  },
  onEnter(first) {
    if (!first) return;
    this.handleUrl();
    const msg = state.user ? `Welcome back, @${esc(state.user.handle)}.` : 'Connect Phantom, Solflare, Trust Wallet or Backpack to trade and launch coins.';
    setTimeout(() => toast({
      type: 'info', icon: 'fa-satellite-dish', title: 'Welcome to the trenches', duration: 6500,
      msg: msg + (state.dataSource === 'live' ? '' : ' Market data is reconnecting.'),
      action: state.user ? null : { label: 'Connect wallet', onClick: () => Wallet.open() },
    }), 650);
  },
  async handleUrl() {
    const p = new URLSearchParams(location.search);
    const clean = () => { try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ } };
    if (p.get('pro') === 'success' && p.get('session_id')) {
      clean();
      try {
        await SN.pro.confirm(p.get('session_id'));
        await Session.check();
        toast({ type: 'success', icon: 'fa-crown', title: 'Welcome to Supernova Pro', msg: 'Your payment went through. The AI analyst is unlimited now.', duration: 8000 });
      } catch (e) {
        toast({ type: 'warn', title: 'Payment received, activating Pro', msg: 'This can take a few seconds. Reconnect your wallet if Pro does not show up.', duration: 8000 });
      }
    } else if (p.get('pro') === 'cancel') { clean(); toast({ type: 'info', title: 'Checkout cancelled', msg: 'No payment was taken.' }); }
    else if (p.get('onramp') === 'done') { clean(); toast({ type: 'success', title: 'Purchase submitted', msg: 'Your SOL usually arrives within a few minutes.' }); Account.soon(false); }
    const tok = p.get('token');
    if (tok && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tok)) { clean(); openByMint(tok); }
    const view = p.get('view');
    if (view && VIEW_HOOKS[view]) { clean(); Router.go(view); }
  },
  userChanged() {
    Header.renderWallet();
    Profile.render();
    Term.refreshUserBits();
    Launch.updateCost();
    AI.labels();
    if (ProModal.isOpen) ProModal.render();
    if (state.view === 'hub' && Hub.inited) Hub.renderScanner(true);
    saveSoon();
  },
  userTraded() {
    Header.live();
    if (state.view === 'profile') Profile.render();
    saveSoon();
  },
  sessionChanged() {
    AI.labels();
    if (state.view === 'profile') Profile.render();
    if (ProModal.isOpen) ProModal.render();
  },
};

function bindGlobal() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const w = t.closest('[data-watch]');
    if (w) { e.preventDefault(); toggleWatch(w.dataset.watch); return; }
    const cp = t.closest('[data-copy]');
    if (cp) {
      e.preventDefault();
      const val = cp.dataset.copy;
      copyText(val).then((ok) => toast({ type: ok ? 'success' : 'error', duration: 2400, title: ok ? 'Address copied' : "Couldn't copy the address", msg: ok ? `<span class="mono">${esc(shortAddr(val, 6))}</span>` : 'Select it and copy it manually.' }));
      return;
    }
    if (t.closest('[data-airdrop-banner]')) { e.preventDefault(); Funding.airdrop(); return; }
    if (t.closest('[data-pro-open]')) { e.preventDefault(); ProModal.open(); return; }
    const cn = t.closest('[data-connect]');
    if (cn) { e.preventDefault(); Wallet.open(); return; }
    const tk = t.closest('[data-token]');
    if (tk) { e.preventDefault(); if (state.byId.has(tk.dataset.token)) Router.go('terminal', { token: tk.dataset.token }); else openByMint(tk.dataset.token); return; }
    const nv = t.closest('[data-nav]');
    if (nv) { e.preventDefault(); Router.go(nv.dataset.nav); }
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
    if (state.phase === 'intro') { if (e.key === 'Escape') Phase.skipIntro = true; return; }
    if (state.phase === 'story') { if (e.key === 'Escape' || (e.key === 'Enter' && Phase.ctaReady)) { e.preventDefault(); enterApp(); } return; }
    if (state.phase !== 'app') return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); Palette.toggle(); return; }
    if (e.key === 'Escape') {
      if (Palette.isOpen) Palette.close();
      else if (ProModal.isOpen) ProModal.close();
      else if (Wallet.isOpen) Wallet.close();
      else if ($('#chart-panel').classList.contains('expanded')) Term.toggleExpand(false);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !typing) {
      const rb = e.target.closest && e.target.closest('[role="button"]');
      if (rb && rb.tagName !== 'BUTTON') { e.preventDefault(); rb.click(); return; }
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey || Palette.isOpen || Wallet.isOpen || ProModal.isOpen) return;
    if (e.key === '/') { e.preventDefault(); Palette.open(); return; }
    const views = { 1: 'hub', 2: 'terminal', 3: 'launch', 4: 'profile' };
    if (views[e.key]) Router.go(views[e.key]);
  });
}

/* ---------- saved preferences (per-viewer convenience) ---------- */
(function applyPrefs(s) {
  if (!s) return;
  try {
    const tr = s.trade || {};
    if (tr.side === 'buy' || tr.side === 'sell') state.trade.side = tr.side;
    if (isFinite(tr.slip) && tr.slip >= 0.1 && tr.slip <= 50) state.trade.slip = +tr.slip;
    if (typeof tr.mev === 'boolean') state.trade.mev = tr.mev;
    if (PRIO[tr.prio]) state.trade.prio = tr.prio;
    const ch = s.chart || {};
    if ([1, 5, 15, 60].includes(ch.iv)) state.chart.iv = ch.iv;
    if (typeof ch.ema === 'boolean') state.chart.ema = ch.ema;
    if (typeof ch.vol === 'boolean') state.chart.vol = ch.vol;
  } catch { /* ignore malformed prefs */ }
})(PREFS);

function restoreSaved() {
  try {
    (PREFS.watch || []).forEach((id) => state.watch.add(id));
    if (PREFS.activeId && state.byId.has(PREFS.activeId)) state.activeId = PREFS.activeId;
    else if (PREFS.activeId && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(PREFS.activeId)) Data.openMint(PREFS.activeId).then((t) => { if (t && !state.activeId) state.activeId = t.id; }).catch(() => {});
  } catch (e) { console.warn('[Supernova] Saved preferences ignored:', e); }
}

/* ---------- data boot: live markets through /api ---------- */
const dataReady = (async () => {
  try { await Data.boot(); } catch (e) { console.warn('[Supernova] market data unavailable:', e && e.message); state.dataSource = 'offline'; }
  restoreSaved();
  return true;
})();

function boot() {
  BG.init();
  Eyes.init();
  initSpotlight();
  bindGlobal();
  $('#intro-skip').addEventListener('click', () => { Phase.skipIntro = true; });
  $('#story-skip').addEventListener('click', () => enterApp());
  $('#cta-enter').addEventListener('click', () => enterApp());
  $('#replay-intro').addEventListener('click', () => replayIntro());
  // deep links (shared coin, return from checkout or the on-ramp) skip the intro and open the app directly
  if (/[?&](token|pro|onramp|view)=/.test(location.search)) enterApp();
  else runIntro();
}
boot();

})();
