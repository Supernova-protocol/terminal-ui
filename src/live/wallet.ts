/* Real wallet connection: Wallet Standard (Phantom, Solflare, Backpack, Trust Wallet, OKX, Coinbase…), legacy injected
   providers as a fallback, and deep links that reopen the site inside a mobile wallet's browser. Non-custodial:
   keys never leave the wallet; we only ask it to sign. */
import { getWallets } from '@wallet-standard/app';
import type { Wallet as StdWallet, WalletAccount } from '@wallet-standard/base';
import { VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { api, config } from './api';

export type WalletInfo = { id: string; name: string; icon: string | null; installed: boolean; kind: 'standard' | 'legacy' | 'suggest'; url?: string; color?: string };
type Adapter = {
  id: string; name: string; icon: string | null; kind: 'standard' | 'legacy';
  connect(silent?: boolean): Promise<string>;
  disconnect(): Promise<void>;
  signAll(txs: VersionedTransaction[]): Promise<VersionedTransaction[]>;
  signMessage(msg: Uint8Array): Promise<Uint8Array>;
  onChange(cb: (address: string | null) => void): () => void;
};

const LAST_KEY = 'supernova.wallet.last';
const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } } };

/* ---------- Wallet Standard ---------- */
const SOLANA_CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet', 'solana:localnet'];
function isSolanaWallet(w: StdWallet) {
  return w.chains.some((c) => SOLANA_CHAINS.includes(c)) && 'standard:connect' in w.features && 'solana:signTransaction' in w.features;
}
async function chainId() { return `solana:${(await config()).cluster}` as const; }

function standardAdapter(w: StdWallet): Adapter {
  let account: WalletAccount | null = null;
  const f: any = w.features;
  const pickAccount = (accs: readonly WalletAccount[]) => accs.find((a) => a.chains.some((c) => c.startsWith('solana:'))) || accs[0] || null;
  return {
    id: 'std:' + w.name, name: w.name, icon: w.icon || null, kind: 'standard',
    async connect(silent = false) {
      const res = await f['standard:connect'].connect(silent ? { silent: true } : undefined);
      account = pickAccount(res?.accounts?.length ? res.accounts : w.accounts);
      if (!account) throw new Error(silent ? 'not-authorized' : 'The wallet did not share an account.');
      return account.address;
    },
    async disconnect() { try { await f['standard:disconnect']?.disconnect(); } catch { /* some wallets do not implement it */ } account = null; },
    async signAll(txs) {
      if (!account) throw new Error('Wallet is not connected.');
      const feat = f['solana:signTransaction'];
      const versions: any[] = feat.supportedTransactionVersions || ['legacy', 0];
      if (!versions.includes(0)) throw new Error(`${w.name} cannot sign versioned transactions. Try Phantom, Solflare or Backpack.`);
      const chain = await chainId();
      const out = await feat.signTransaction(...txs.map((tx) => ({ account, transaction: tx.serialize(), chain })));
      return out.map((o: any) => VersionedTransaction.deserialize(o.signedTransaction));
    },
    async signMessage(msg) {
      if (!account) throw new Error('Wallet is not connected.');
      const feat = f['solana:signMessage'];
      if (!feat) throw new Error(`${w.name} does not support message signing.`);
      const [out] = await feat.signMessage({ account, message: msg });
      return out.signature;
    },
    onChange(cb) {
      const ev = f['standard:events'];
      if (!ev) return () => {};
      return ev.on('change', (props: any) => {
        if (!props.accounts) return;
        account = pickAccount(props.accounts);
        cb(account ? account.address : null);
      });
    },
  };
}

/* ---------- legacy injected providers (window.solana style) ---------- */
type Legacy = { name: string; get: () => any; color: string };
const LEGACY: Legacy[] = [
  { name: 'Phantom', get: () => (window as any).phantom?.solana, color: 'linear-gradient(135deg,#AB9FF2,#5A47D6)' },
  { name: 'Solflare', get: () => (window as any).solflare, color: 'linear-gradient(135deg,#FFC94D,#F06A1D)' },
  { name: 'Trust Wallet', get: () => (window as any).trustwallet?.solana || (window as any).trustWallet?.solana, color: 'linear-gradient(135deg,#48FF91,#0500FF)' },
  { name: 'Backpack', get: () => (window as any).backpack, color: 'linear-gradient(135deg,#FF6B6B,#C21E56)' },
  { name: 'Coinbase Wallet', get: () => (window as any).coinbaseSolana, color: 'linear-gradient(135deg,#2E6BFF,#0039C7)' },
  { name: 'OKX Wallet', get: () => (window as any).okxwallet?.solana, color: 'linear-gradient(135deg,#3A3A3A,#000)' },
];
function legacyAdapter(l: Legacy): Adapter {
  const p = () => l.get();
  return {
    id: 'legacy:' + l.name, name: l.name, icon: null, kind: 'legacy',
    async connect(silent = false) {
      const prov = p();
      if (!prov) throw new Error(`${l.name} is not available in this browser.`);
      const r = await prov.connect(silent ? { onlyIfTrusted: true } : undefined);
      const pk = r?.publicKey || prov.publicKey;
      if (!pk) throw new Error('The wallet did not share an account.');
      return pk.toString();
    },
    async disconnect() { try { await p()?.disconnect?.(); } catch { /* ignore */ } },
    async signAll(txs) {
      const prov = p();
      if (prov.signAllTransactions) return prov.signAllTransactions(txs);
      const out: VersionedTransaction[] = [];
      for (const t of txs) out.push(await prov.signTransaction(t));
      return out;
    },
    async signMessage(msg) {
      const r = await p().signMessage(msg, 'utf8');
      return r?.signature || r;
    },
    onChange(cb) {
      const prov = p();
      if (!prov?.on) return () => {};
      const onAcc = (pk: any) => cb(pk ? pk.toString() : null);
      const onDis = () => cb(null);
      prov.on('accountChanged', onAcc); prov.on('disconnect', onDis);
      return () => { prov.removeListener?.('accountChanged', onAcc); prov.removeListener?.('disconnect', onDis); prov.off?.('accountChanged', onAcc); prov.off?.('disconnect', onDis); };
    },
  };
}

/* ---------- suggestions + mobile deep links ---------- */
const SUGGEST = [
  { name: 'Phantom', color: 'linear-gradient(135deg,#AB9FF2,#5A47D6)', install: 'https://phantom.com/download', deep: (u: string) => `https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
  { name: 'Solflare', color: 'linear-gradient(135deg,#FFC94D,#F06A1D)', install: 'https://solflare.com/download', deep: (u: string) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
  { name: 'Trust Wallet', color: 'linear-gradient(135deg,#48FF91,#0500FF)', install: 'https://trustwallet.com/download', deep: (u: string) => `https://link.trustwallet.com/open_url?coin_id=501&url=${encodeURIComponent(u)}` },
  { name: 'Backpack', color: 'linear-gradient(135deg,#FF6B6B,#C21E56)', install: 'https://backpack.app/downloads', deep: (u: string) => `https://backpack.app/ul/v1/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}` },
];

/* ---------- the wallet store ---------- */
type Listener = (s: WalletState) => void;
export type WalletState = { address: string | null; name: string | null; icon: string | null };

class WalletManager {
  private adapters = new Map<string, Adapter>();
  private active: Adapter | null = null;
  private off: (() => void) | null = null;
  private listeners = new Set<Listener>();
  private listListeners = new Set<() => void>();
  state: WalletState = { address: null, name: null, icon: null };

  constructor() {
    const { get, on } = getWallets();
    const add = (ws: readonly StdWallet[]) => { for (const w of ws) if (isSolanaWallet(w) && !this.adapters.has('std:' + w.name)) this.adapters.set('std:' + w.name, standardAdapter(w)); this.listListeners.forEach((f) => f()); };
    add(get());
    on('register', (...ws: StdWallet[]) => add(ws));
  }

  private legacyAvailable(): Adapter[] {
    const stdNames = new Set([...this.adapters.values()].map((a) => a.name.toLowerCase()));
    return LEGACY.filter((l) => l.get() && !stdNames.has(l.name.toLowerCase())).map(legacyAdapter);
  }

  /** Wallets for the connect modal: installed ones first, then install / open-in-app suggestions. */
  list(): WalletInfo[] {
    const installed: WalletInfo[] = [...this.adapters.values(), ...this.legacyAvailable()].map((a) => ({
      id: a.id, name: a.name, icon: a.icon, installed: true, kind: a.kind,
      color: LEGACY.find((l) => l.name === a.name)?.color,
    }));
    const have = new Set(installed.map((w) => w.name.toLowerCase()));
    const mobile = isMobile();
    const suggestions: WalletInfo[] = SUGGEST.filter((s) => !have.has(s.name.toLowerCase())).map((s) => ({
      id: 'suggest:' + s.name, name: s.name, icon: null, installed: false, kind: 'suggest', color: s.color,
      url: mobile ? s.deep(location.href) : s.install,
    }));
    return [...installed, ...suggestions];
  }
  onList(f: () => void) { this.listListeners.add(f); return () => this.listListeners.delete(f); }
  isMobile() { return isMobile(); }

  private find(id: string): Adapter | null {
    return this.adapters.get(id) || this.legacyAvailable().find((a) => a.id === id) || null;
  }

  subscribe(f: Listener) { this.listeners.add(f); return () => this.listeners.delete(f); }
  private emit() { for (const f of this.listeners) f(this.state); }

  async connect(id: string, silent = false) {
    const a = this.find(id);
    if (!a) throw new Error('That wallet is not available in this browser.');
    const address = await a.connect(silent);
    if (this.active && this.active !== a) { this.off?.(); }
    this.active = a;
    this.off?.();
    this.off = a.onChange((addr) => {
      if (!addr) { this.state = { address: null, name: null, icon: null }; this.active = null; store.set(LAST_KEY, null); }
      else this.state = { ...this.state, address: addr };
      this.emit();
    });
    this.state = { address, name: a.name, icon: a.icon };
    store.set(LAST_KEY, a.id);
    this.emit();
    return this.state;
  }

  /** Silent reconnect to the last wallet (no popup if the site is already trusted). */
  async restore(): Promise<WalletState | null> {
    const id = store.get(LAST_KEY);
    if (!id) return null;
    for (let i = 0; i < 8 && !this.find(id); i++) await new Promise((r) => setTimeout(r, 250)); // wallets register a moment after load
    if (!this.find(id)) return null;
    try { return await this.connect(id, true); } catch { return null; }
  }

  async disconnect() {
    const a = this.active;
    this.off?.(); this.off = null;
    this.active = null;
    this.state = { address: null, name: null, icon: null };
    store.set(LAST_KEY, null);
    this.emit();
    if (a) await a.disconnect();
    api.post('auth/logout').catch(() => {});
  }

  get connected() { return !!(this.active && this.state.address); }

  async signAll(txs: VersionedTransaction[]) {
    if (!this.active) throw new Error('Connect a wallet first.');
    return this.active.signAll(txs);
  }
  async signOne(tx: VersionedTransaction) { return (await this.signAll([tx]))[0]; }

  /* ---------- Sign-In With Solana (session cookie for Pro + AI) ---------- */
  session: { address: string | null; pro: any; admin: boolean } | null = null;
  async me(force = false) {
    if (this.session && !force) return this.session;
    this.session = await api.get('auth/me');
    return this.session!;
  }
  async signIn() {
    const address = this.state.address;
    if (!this.active || !address) throw new Error('Connect a wallet first.');
    const cur = await this.me(true).catch(() => null);
    if (cur && cur.address === address) return cur;
    const { nonce, message } = await api.post<{ nonce: string; message: string }>('auth/nonce', { address });
    const sig = await this.active.signMessage(new TextEncoder().encode(message));
    const res = await api.post('auth/verify', { address, nonce, signature: bs58.encode(sig) });
    this.session = res;
    return res;
  }
}

export const wallet = new WalletManager();
