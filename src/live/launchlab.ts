/* Raydium LaunchLab in the browser: create coins on our platform config, quote and trade on the bonding curve,
   claim creator fees. The SDK is loaded lazily (it is large) the first time a wallet action needs it. */
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import BN from 'bn.js';
import { api, config } from './api';
import { connection, computeBudget, sendAndConfirm, PRIORITY } from './chain';
import { wallet } from './wallet';

export const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

type Sdk = typeof import('@raydium-io/raydium-sdk-v2');
let sdkP: Promise<Sdk> | null = null;
export const sdk = () => (sdkP ||= import('@raydium-io/raydium-sdk-v2'));

let ray: { owner: string; r: any } | null = null;
async function raydium(owner: string) {
  const S = await sdk();
  const cfg = await config();
  if (ray && ray.owner === owner) return ray.r;
  const conn = await connection();
  const r = await S.Raydium.load({ connection: conn, cluster: cfg.cluster === 'mainnet' ? 'mainnet' : 'devnet', owner: new PublicKey(owner), disableLoadToken: true, blockhashCommitment: 'confirmed' });
  // launch defaults come through our same-origin proxy instead of a cross-origin call from the browser
  (r.api as any).fetchLaunchConfigs = async () => (await api.get('launchlab/configs')).data || [];
  ray = { owner, r };
  return r;
}

const programId = async () => new PublicKey((await config()).launchProgram);
export async function poolIdFor(mint: string) {
  const S = await sdk();
  return S.getPdaLaunchpadPoolId(await programId(), new PublicKey(mint), NATIVE_MINT).publicKey;
}

async function tip(mev: boolean, prio: string) {
  const cfg = await config();
  if (!mev || cfg.cluster !== 'mainnet' || !cfg.jitoTipAccounts?.length) return undefined;
  const acct = cfg.jitoTipAccounts[Math.floor(Math.random() * cfg.jitoTipAccounts.length)];
  const sol = Math.max(0.0001, (PRIORITY[prio] || PRIORITY.turbo).sol);
  return { address: new PublicKey(acct), amount: new BN(Math.round(sol * 1e9)) };
}
async function budget(mev: boolean, prio: string) {
  const cfg = await config();
  if (cfg.cluster !== 'mainnet') return undefined;
  return computeBudget(mev ? 'fast' : prio);
}

/* ---------- curve state (cached briefly so quotes feel instant while typing) ---------- */
type CurveState = { poolInfo: any; configInfo: any; platformFeeRate: BN; creatorFeeRate: BN; slot: number; at: number; mintProgram: PublicKey };
const curveCache = new Map<string, CurveState>();
export async function curveState(mint: string, maxAgeMs = 2500): Promise<CurveState> {
  const hit = curveCache.get(mint);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit;
  const S = await sdk();
  const conn = await connection();
  const pid = await poolIdFor(mint);
  const poolAcc = await conn.getAccountInfo(pid, 'confirmed');
  if (!poolAcc) throw new Error('This coin has no LaunchLab pool on this network.');
  const poolInfo = S.LaunchpadPool.decode(poolAcc.data);
  const [cfgAcc, platAcc, mintAcc, slot] = await Promise.all([
    conn.getAccountInfo(poolInfo.configId, 'confirmed'),
    conn.getAccountInfo(poolInfo.platformId, 'confirmed'),
    conn.getAccountInfo(new PublicKey(mint), 'confirmed'),
    conn.getSlot('confirmed'),
  ]);
  if (!cfgAcc || !platAcc) throw new Error('LaunchLab config not found.');
  const configInfo = S.LaunchpadConfig.decode(cfgAcc.data);
  const platform = S.PlatformConfig.decode(platAcc.data);
  const st: CurveState = { poolInfo, configInfo, platformFeeRate: platform.feeRate, creatorFeeRate: platform.creatorFeeRate, slot, at: Date.now(), mintProgram: mintAcc?.owner || TOKEN_PROGRAM };
  curveCache.set(mint, st);
  return st;
}

export function curveSnapshot(st: CurveState) {
  const p = st.poolInfo;
  const decA = p.mintDecimalsA, decB = p.mintDecimalsB;
  const price = (Number(p.virtualB.add(p.realB).toString()) / Number(p.virtualA.sub(p.realA).toString())) * 10 ** (decA - decB);
  const raised = Number(p.realB.toString()) / 10 ** decB, target = Number(p.totalFundRaisingB.toString()) / 10 ** decB;
  return { status: p.status as number, priceSol: price, raisedSol: raised, targetSol: target, progress: target > 0 ? Math.min(100, (raised / target) * 100) : 0, decimals: decA, supply: Number(p.supply.toString()) / 10 ** decA };
}

export type CurveQuote = { side: 'buy' | 'sell'; inAmount: number; outAmount: number; minOut: number; feeSol: number; priceImpactPct: number; avgPriceSol: number; newPriceSol: number; capped: boolean };

export async function quote(mint: string, side: 'buy' | 'sell', amount: number, slippageBps: number): Promise<CurveQuote> {
  const S = await sdk();
  const st = await curveState(mint);
  const p = st.poolInfo;
  const decA = p.mintDecimalsA;
  const zero = new BN(0);
  const base = { protocolFeeRate: st.configInfo.tradeFeeRate, platformFeeRate: st.platformFeeRate, curveType: st.configInfo.curveType, shareFeeRate: zero, creatorFeeRate: st.creatorFeeRate, transferFeeConfigA: undefined, slot: st.slot };
  const snap = curveSnapshot(st);
  const keep = (10000 - slippageBps) / 10000;
  if (side === 'buy') {
    const lamports = new BN(Math.floor(amount * 1e9));
    const r = S.Curve.buyExactIn({ poolInfo: p, amountB: lamports, ...base });
    const outRaw = r.amountA.amount.sub(r.amountA.fee ?? zero);
    const out = Number(outRaw.toString()) / 10 ** decA;
    const paid = Number(r.amountB.toString()) / 1e9;
    const fee = Number(Object.values(r.splitFee).reduce((a: BN, b: any) => a.add(b), zero).toString()) / 1e9;
    const after = { ...p, realA: p.realA.add(outRaw), realB: p.realB.add(r.amountB.sub(Object.values(r.splitFee).reduce((a: BN, b: any) => a.add(b), zero))) };
    const newPrice = curveSnapshot({ ...st, poolInfo: after }).priceSol;
    const avg = out > 0 ? paid / out : 0;
    return { side, inAmount: paid, outAmount: out, minOut: out * keep, feeSol: fee, priceImpactPct: snap.priceSol > 0 ? (avg / snap.priceSol - 1) * 100 : 0, avgPriceSol: avg, newPriceSol: newPrice, capped: r.amountB.lt(lamports) };
  }
  const raw = new BN(Math.floor(amount * 10 ** decA));
  const r = S.Curve.sellExactIn({ poolInfo: p, amountA: raw, ...base });
  const outSol = Number(r.amountB.toString()) / 1e9;
  const fee = Number(Object.values(r.splitFee).reduce((a: BN, b: any) => a.add(b), zero).toString()) / 1e9;
  const avg = amount > 0 ? outSol / amount : 0;
  return { side, inAmount: amount, outAmount: outSol, minOut: outSol * keep, feeSol: fee, priceImpactPct: snap.priceSol > 0 ? (1 - avg / snap.priceSol) * 100 : 0, avgPriceSol: avg, newPriceSol: 0, capped: false };
}

/* ---------- trading ---------- */
async function finish(mint: string) {
  curveCache.delete(mint);
  api.post(`launches/${mint}/sync`).catch(() => {});
}

export async function buy(o: { mint: string; sol: number; slippageBps: number; prio: string; mev: boolean; onSent?: (sig: string) => void }) {
  const owner = wallet.state.address;
  if (!owner) throw new Error('Connect a wallet first.');
  const S = await sdk();
  const r = await raydium(owner);
  await r.account.fetchWalletTokenAccounts({ forceUpdate: true });
  const st = await curveState(o.mint, 0);
  if (st.poolInfo.status !== 0) throw new Error('This coin has graduated: it now trades on Raydium.');
  const { transaction, extInfo } = await r.launchpad.buyToken({
    programId: await programId(), mintA: new PublicKey(o.mint), mintAProgram: st.mintProgram, poolInfo: st.poolInfo, configInfo: st.configInfo,
    platformFeeRate: st.platformFeeRate, txVersion: S.TxVersion.V0, buyAmount: new BN(Math.floor(o.sol * 1e9)), slippage: new BN(o.slippageBps),
    computeBudgetConfig: await budget(o.mev, o.prio), txTipConfig: await tip(o.mev, o.prio),
  });
  const signed = await wallet.signOne(transaction);
  const sig = await sendAndConfirm(signed, { mev: o.mev, onSent: o.onSent });
  await finish(o.mint);
  return { signature: sig, expectedOut: Number(extInfo.decimalOutAmount.toString()) / 10 ** st.poolInfo.mintDecimalsA };
}

export async function sell(o: { mint: string; tokens: number; slippageBps: number; prio: string; mev: boolean; onSent?: (sig: string) => void }) {
  const owner = wallet.state.address;
  if (!owner) throw new Error('Connect a wallet first.');
  const S = await sdk();
  const r = await raydium(owner);
  await r.account.fetchWalletTokenAccounts({ forceUpdate: true });
  const st = await curveState(o.mint, 0);
  if (st.poolInfo.status !== 0) throw new Error('This coin has graduated: it now trades on Raydium.');
  const { transaction, extInfo } = await r.launchpad.sellToken({
    programId: await programId(), mintA: new PublicKey(o.mint), mintAProgram: st.mintProgram, poolInfo: st.poolInfo, configInfo: st.configInfo,
    platformFeeRate: st.platformFeeRate, txVersion: S.TxVersion.V0, sellAmount: new BN(Math.floor(o.tokens * 10 ** st.poolInfo.mintDecimalsA)), slippage: new BN(o.slippageBps),
    computeBudgetConfig: await budget(o.mev, o.prio), txTipConfig: await tip(o.mev, o.prio),
  });
  const signed = await wallet.signOne(transaction);
  const sig = await sendAndConfirm(signed, { mev: o.mev, onSent: o.onSent });
  await finish(o.mint);
  return { signature: sig, minOutSol: Number(extInfo.outAmount.toString()) / 1e9 };
}

/* ---------- create a coin ---------- */
const DEFAULTS = { supply: '1000000000000000', totalSellA: '793100000000000', totalFundRaisingB: '85000000000' };

export async function createCoin(o: {
  name: string; symbol: string; uri: string; devBuySol: number; slippageBps: number; prio: string; mev: boolean;
  onStep?: (step: 'build' | 'sign' | 'send' | 'confirm' | 'index', info?: any) => void;
}) {
  const owner = wallet.state.address;
  if (!owner) throw new Error('Connect a wallet first.');
  const cfg = await config();
  const S = await sdk();
  const r = await raydium(owner);
  const conn = await connection();
  o.onStep?.('build');
  const pid = new PublicKey(cfg.launchProgram);
  const configId = S.getPdaLaunchpadConfigId(pid, NATIVE_MINT, 0, 0).publicKey;
  const cfgAcc = await conn.getAccountInfo(configId, 'confirmed');
  if (!cfgAcc) throw new Error('LaunchLab is not available on this network right now.');
  const configInfo = S.LaunchpadConfig.decode(cfgAcc.data);
  let defaults = DEFAULTS;
  try {
    const list = (await api.get('launchlab/configs')).data || [];
    const d = list.find((c: any) => c?.key?.pubKey === configId.toBase58())?.defaultParams;
    if (d?.supplyInit && d?.totalSellA && d?.totalFundRaisingB) defaults = { supply: d.supplyInit, totalSellA: d.totalSellA, totalFundRaisingB: d.totalFundRaisingB };
  } catch { /* keep LaunchLab defaults */ }

  const mintKp = Keypair.generate();
  const devLamports = new BN(Math.floor(Math.max(0, o.devBuySol) * 1e9));
  const createOnly = devLamports.lten(0);
  await r.account.fetchWalletTokenAccounts({ forceUpdate: true });
  const { transactions, extInfo } = await r.launchpad.createLaunchpad({
    programId: pid, mintA: mintKp.publicKey, decimals: 6, name: o.name, symbol: o.symbol, uri: o.uri,
    migrateType: cfg.migrateType, configId, configInfo, mintBDecimals: 9, platformId: new PublicKey(cfg.platformId),
    txVersion: S.TxVersion.V0, slippage: new BN(o.slippageBps), buyAmount: createOnly ? new BN(1) : devLamports, createOnly,
    extraSigners: [mintKp], supply: new BN(defaults.supply), totalSellA: new BN(defaults.totalSellA), totalFundRaisingB: new BN(defaults.totalFundRaisingB),
    computeBudgetConfig: await budget(o.mev, o.prio), txTipConfig: await tip(o.mev, o.prio),
  });

  o.onStep?.('sign', { mint: mintKp.publicKey.toBase58(), count: transactions.length });
  const signed = await wallet.signAll(transactions);
  for (const tx of signed) {
    const signers = tx.message.staticAccountKeys.slice(0, tx.message.header.numRequiredSignatures);
    if (signers.some((k) => k.equals(mintKp.publicKey))) tx.sign([mintKp]); // re-apply after the wallet signed
  }
  const sigs: string[] = [];
  for (let i = 0; i < signed.length; i++) {
    o.onStep?.('send', { index: i, total: signed.length });
    sigs.push(await sendAndConfirm(signed[i], { mev: o.mev, onSent: (s) => o.onStep?.('confirm', { signature: s, index: i }) }));
  }
  o.onStep?.('index');
  const mint = mintKp.publicKey.toBase58();
  let launch: any = null;
  for (let i = 0; i < 4 && !launch; i++) {
    try { launch = (await api.post('launches', { signature: sigs[0], mint }, 45000)).launch; }
    catch (e: any) { if (i === 3) console.warn('[launch] registration failed', e?.message); else await new Promise((res) => setTimeout(res, 2000)); }
  }
  return { mint, pool: extInfo.address.poolId.toBase58(), signatures: sigs, launch };
}

/* ---------- creator rewards (LaunchLab creator fee vault, paid in SOL) ---------- */
export async function creatorFeeBalance(creator: string) {
  const S = await sdk();
  const conn = await connection();
  const vault = S.getPdaCreatorVault(await programId(), new PublicKey(creator), NATIVE_MINT).publicKey;
  try { const b = await conn.getTokenAccountBalance(vault, 'confirmed'); return Number(b.value.uiAmount || 0); } catch { return 0; }
}

const wsolAta = (owner: PublicKey) => getAssociatedTokenAddressSync(NATIVE_MINT, owner, false, TOKEN_PROGRAM);
const ataIdempotent = (payer: PublicKey, ata: PublicKey, owner: PublicKey) => createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, NATIVE_MINT, TOKEN_PROGRAM);
const closeAccount = (account: PublicKey, owner: PublicKey) => createCloseAccountInstruction(account, owner, owner, [], TOKEN_PROGRAM);

async function sendIxs(ixs: TransactionInstruction[], owner: PublicKey) {
  const conn = await connection();
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const signed = await wallet.signOne(new VersionedTransaction(msg));
  return sendAndConfirm(signed);
}

/** Claims the creator fees into the wallet and unwraps them to plain SOL in the same transaction. */
export async function claimCreatorFees() {
  const owner = wallet.state.address;
  if (!owner) throw new Error('Connect a wallet first.');
  const S = await sdk();
  const pid = await programId();
  const me = new PublicKey(owner);
  const ata = wsolAta(me);
  const ix = S.claimCreatorFee(pid, me, S.getPdaCreatorFeeVaultAuth(pid).publicKey, S.getPdaCreatorVault(pid, me, NATIVE_MINT).publicKey, ata, NATIVE_MINT, TOKEN_PROGRAM);
  return sendIxs([ataIdempotent(me, ata, me), ix, closeAccount(ata, me)], me);
}

/* ---------- platform admin (owner of the platform config) ---------- */
export async function platformInfo(platformId?: string) {
  const S = await sdk();
  const conn = await connection();
  const cfg = await config();
  const id = new PublicKey(platformId || cfg.platformId);
  const acc = await conn.getAccountInfo(id, 'confirmed');
  if (!acc) return null;
  const p = S.PlatformConfig.decode(acc.data);
  const txt = (a: number[]) => new TextDecoder().decode(Uint8Array.from(a)).replace(/\0+$/, '');
  const vault = S.getPdaPlatformVault(new PublicKey(cfg.launchProgram), id, NATIVE_MINT).publicKey;
  let vaultSol = 0;
  try { vaultSol = Number((await conn.getTokenAccountBalance(vault, 'confirmed')).value.uiAmount || 0); } catch { /* empty vault */ }
  return {
    id: id.toBase58(), claimFeeWallet: p.platformClaimFeeWallet.toBase58(), lockNftWallet: p.platformLockNftWallet.toBase58(),
    feeRate: Number(p.feeRate.toString()), creatorFeeRate: Number(p.creatorFeeRate.toString()),
    scales: { platform: Number(p.platformScale.toString()), creator: Number(p.creatorScale.toString()), burn: Number(p.burnScale.toString()) },
    name: txt(p.name as any), web: txt(p.web as any), img: txt(p.img as any), cpConfigId: p.cpConfigId.toBase58(), vaultSol,
  };
}

export async function platformIdFor(admin: string) {
  const S = await sdk();
  return S.getPdaPlatformId(await programId(), new PublicKey(admin)).publicKey.toBase58();
}

export async function createPlatform(o: { name: string; web: string; img: string; feeRate: number; creatorFeeRate: number; cpConfigId: string; platformScale: number; creatorScale: number; burnScale: number; claimWallet?: string }) {
  const owner = wallet.state.address;
  if (!owner) throw new Error('Connect the admin wallet first.');
  const S = await sdk();
  const r = await raydium(owner);
  const me = new PublicKey(owner);
  const { transaction, extInfo } = await r.launchpad.createPlatformConfig({
    programId: await programId(), platformAdmin: me, platformClaimFeeWallet: o.claimWallet ? new PublicKey(o.claimWallet) : me,
    platformLockNftWallet: me, platformVestingWallet: me, cpConfigId: new PublicKey(o.cpConfigId), transferFeeExtensionAuth: me,
    creatorFeeRate: new BN(o.creatorFeeRate), feeRate: new BN(o.feeRate),
    migrateCpLockNftScale: { platformScale: new BN(o.platformScale), creatorScale: new BN(o.creatorScale), burnScale: new BN(o.burnScale) },
    name: o.name, web: o.web, img: o.img, txVersion: S.TxVersion.V0,
  });
  const signed = await wallet.signOne(transaction);
  const sig = await sendAndConfirm(signed);
  return { signature: sig, platformId: extInfo.platformId.toBase58() };
}

export type PlatformUpdate =
  | { type: 'updateFeeRate'; value: number }
  | { type: 'updateClaimFeeWallet'; value: string }
  | { type: 'updateName' | 'updateWeb' | 'updateImg'; value: string };

/** Edits the platform config owned by the connected wallet: one small transaction per changed field, signed together. */
export async function updatePlatform(updates: PlatformUpdate[]) {
  const owner = wallet.state.address;
  if (!owner) throw new Error('Connect the platform admin wallet first.');
  if (!updates.length) return [];
  const S = await sdk();
  const r = await raydium(owner);
  const me = new PublicKey(owner);
  const txs: VersionedTransaction[] = [];
  for (const u of updates) {
    const updateInfo: any = u.type === 'updateFeeRate' ? { type: u.type, value: new BN(u.value) }
      : u.type === 'updateClaimFeeWallet' ? { type: u.type, value: new PublicKey(u.value) }
      : { type: u.type, value: u.value };
    const { transaction } = await r.launchpad.updatePlatformConfig({ programId: await programId(), platformAdmin: me, updateInfo, txVersion: S.TxVersion.V0 });
    txs.push(transaction as VersionedTransaction);
  }
  const signed = await wallet.signAll(txs);
  const sigs: string[] = [];
  for (const t of signed) sigs.push(await sendAndConfirm(t));
  return sigs;
}

export async function claimPlatformFees(platformId?: string) {
  const owner = wallet.state.address;
  if (!owner) throw new Error('Connect the fee wallet first.');
  const S = await sdk();
  const cfg = await config();
  const pid = new PublicKey(cfg.launchProgram);
  const id = new PublicKey(platformId || cfg.platformId);
  const me = new PublicKey(owner);
  const ata = wsolAta(me);
  const ix = S.claimPlatformFeeFromVault(pid, id, me, S.getPdaPlatformFeeVaultAuth(pid).publicKey, S.getPdaPlatformVault(pid, id, NATIVE_MINT).publicKey, ata, NATIVE_MINT, TOKEN_PROGRAM);
  return sendIxs([ataIdempotent(me, ata, me), ix, closeAccount(ata, me)], me);
}
