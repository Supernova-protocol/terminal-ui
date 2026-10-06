/* DEV ONLY: a tiny in-memory Solana RPC that understands enough of LaunchLab, SPL Token and the System program
   to exercise the whole site offline (npm run dev:mock). Never used in production builds. */
import { Keypair, PublicKey, VersionedTransaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AccountLayout, MintLayout, ACCOUNT_SIZE, MINT_SIZE, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  LaunchpadConfig, LaunchpadPool, PlatformConfig, getPdaLaunchpadConfigId, getPdaLaunchpadPoolId, getPdaLaunchpadVaultId, getPdaLaunchpadAuth,
  getPdaPlatformId, getPdaPlatformVault, getPdaPlatformFeeVaultAuth, getPdaCreatorVault, getPdaCreatorFeeVaultAuth,
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

export const PROGRAM = new PublicKey('DRay6fNdQ5J82H7xV6uq2aV3mNrUZ1J4PgSKsWgptcm6');
export const PLATFORM = new PublicKey('2Jx4KTDrVSdWNazuGpcA8n3ZLTRGGBDxAWhuKe2Xcj2a');
export const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
export const TEST_WALLET = Keypair.fromSeed(new Uint8Array(32).fill(7));
export const TREASURY = Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey;
const CONFIG = getPdaLaunchpadConfigId(PROGRAM, NATIVE_MINT, 0, 0).publicKey;
const AUTH = getPdaLaunchpadAuth(PROGRAM).publicKey;
const FEE = { trade: 2500, platform: 2500, creator: 500 };
const PLATFORM_FEE_AUTH = getPdaPlatformFeeVaultAuth(PROGRAM).publicKey;
const CREATOR_FEE_AUTH = getPdaCreatorFeeVaultAuth(PROGRAM).publicKey;
export const CPMM_PROGRAM = new PublicKey('DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb');
/** CPMM fee tiers served by the mocked Raydium API (GET /main/cpmm-config) and seeded on the mock chain. */
export const CPMM_CONFIGS = [
  { index: 0, protocolFeeRate: 120000, tradeFeeRate: 2500, fundFeeRate: 40000, createPoolFee: '150000000' },
  { index: 1, protocolFeeRate: 120000, tradeFeeRate: 10000, fundFeeRate: 40000, createPoolFee: '150000000' },
  { index: 2, protocolFeeRate: 120000, tradeFeeRate: 20000, fundFeeRate: 40000, createPoolFee: '150000000' },
  { index: 3, protocolFeeRate: 120000, tradeFeeRate: 40000, fundFeeRate: 40000, createPoolFee: '150000000' },
].map((c) => {
  const idx = Buffer.alloc(2); idx.writeUInt16BE(c.index);
  return { id: PublicKey.findProgramAddressSync([Buffer.from('amm_config'), idx], CPMM_PROGRAM)[0].toBase58(), ...c };
});
const pad = (s: string, n: number) => { const b = Buffer.alloc(n); Buffer.from(s).subarray(0, n).copy(b); return [...b]; };
const platformVault = (platformId: PublicKey | string) => getPdaPlatformVault(PROGRAM, new PublicKey(k(platformId)), NATIVE_MINT).publicKey.toBase58();
const creatorVault = (creator: PublicKey | string) => getPdaCreatorVault(PROGRAM, new PublicKey(k(creator)), NATIVE_MINT).publicKey.toBase58();
const INIT = { vA: new BN('1073471847374405'), vB: new BN('30050573465'), supply: new BN('1000000000000000'), sell: new BN('793100000000000'), raise: new BN('85000000000') };

type Acc = { owner: string; lamports: number; data: Buffer; exec?: boolean };
type Rec = { sig: string; slot: number; blockTime: number; tx: any; keys: string[] };

export const chain = {
  slot: 330_000_000,
  accounts: new Map<string, Acc>(),
  sigs: new Map<string, Rec>(),
  byAddress: new Map<string, string[]>(),
};

const k = (p: PublicKey | string) => (typeof p === 'string' ? p : p.toBase58());
const rent = (size: number) => (size + 128) * 6960;
const set = (key: PublicKey | string, owner: PublicKey | string, data: Buffer, lamports?: number) => chain.accounts.set(k(key), { owner: k(owner), data, lamports: lamports ?? rent(data.length) });
const lamportsOf = (key: string) => chain.accounts.get(key)?.lamports || 0;
function addLamports(key: string, delta: number) {
  const a = chain.accounts.get(key);
  if (a) a.lamports = Math.max(0, a.lamports + delta);
  else chain.accounts.set(key, { owner: SystemProgram.programId.toBase58(), lamports: Math.max(0, delta), data: Buffer.alloc(0) });
}

/* ---------- encoders ---------- */
function encode(layout: any, obj: any) { const b = Buffer.alloc(layout.span); layout.encode(obj, b); return b; }
function mintData(supply: bigint, decimals: number) {
  return encode(MintLayout, { mintAuthorityOption: 0, mintAuthority: PublicKey.default, supply, decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: PublicKey.default });
}
function tokenData(mint: PublicKey | string, owner: PublicKey | string, amount: bigint) {
  return encode(AccountLayout, { mint: new PublicKey(k(mint)), owner: new PublicKey(k(owner)), amount, delegateOption: 0, delegate: PublicKey.default, state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default });
}
function tokenAmount(key: string): bigint { const a = chain.accounts.get(key); if (!a || a.data.length !== ACCOUNT_SIZE) return 0n; return (AccountLayout.decode(a.data) as any).amount as bigint; }
function setTokenAmount(key: string, mint: string, owner: string, amount: bigint) {
  const a = chain.accounts.get(key);
  if (a && a.data.length === ACCOUNT_SIZE) { const d: any = AccountLayout.decode(a.data); d.amount = amount; a.data = encode(AccountLayout, d); }
  else set(key, TOKEN_PROGRAM_ID, tokenData(mint, owner, amount));
}
function metadataData(mint: PublicKey, name: string, symbol: string, uri: string) {
  const s = (v: string, n: number) => { const b = Buffer.alloc(4 + n); const raw = Buffer.from(v, 'utf8').subarray(0, n); b.writeUInt32LE(n, 0); raw.copy(b, 4); return b; };
  return Buffer.concat([Buffer.from([4]), PLATFORM.toBuffer(), mint.toBuffer(), s(name, 32), s(symbol, 10), s(uri, 200), Buffer.alloc(200)]);
}
export const metadataPda = (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), mint.toBuffer()], METADATA_PROGRAM)[0];

function poolData(p: any) { return encode(LaunchpadPool, p); }
function readPool(key: string) { const a = chain.accounts.get(key); return a ? (LaunchpadPool.decode(a.data) as any) : null; }

/* ---------- seed ---------- */
export const fixtures: { mint: string; sig: string }[] = [];
export function seed() {
  if (chain.accounts.size) return;
  set(CONFIG, PROGRAM, encode(LaunchpadConfig, {
    epoch: new BN(800), curveType: 0, index: 0, migrateFee: new BN(0), tradeFeeRate: new BN(FEE.trade), maxShareFeeRate: new BN(10000),
    minSupplyA: new BN(10_000_000), maxLockRate: new BN(300000), minSellRateA: new BN(200000), minMigrateRateA: new BN(200000), minFundRaisingB: new BN(30_000_000_000),
    mintB: NATIVE_MINT, protocolFeeOwner: PLATFORM, migrateFeeOwner: PLATFORM, migrateToAmmWallet: PLATFORM, migrateToCpmmWallet: PLATFORM,
  }));
  // the test wallet is the fee wallet of the default platform so the admin page can claim platform fees in e2e runs
  set(PLATFORM, PROGRAM, encode(PlatformConfig, {
    epoch: new BN(800), platformClaimFeeWallet: TEST_WALLET.publicKey, platformLockNftWallet: TREASURY, platformScale: new BN(400000), creatorScale: new BN(500000), burnScale: new BN(100000),
    feeRate: new BN(FEE.platform), name: pad('Supernova', 64), web: pad('https://supernova.example', 256), img: pad('https://supernova.example/logo.png', 256),
    cpConfigId: PLATFORM, creatorFeeRate: new BN(FEE.creator), transferFeeExtensionAuth: TREASURY, platformVestingWallet: TREASURY, platformVestingScale: new BN(0),
    platformCpCreator: TREASURY, restrictGlobalConfig: 0, restrictCurveParam: 0, curveRuleManager: TREASURY,
  }));
  set(PROGRAM, PublicKey.default, Buffer.alloc(36), 1_141_440);
  for (const c of CPMM_CONFIGS) set(c.id, CPMM_PROGRAM, Buffer.alloc(236));
  addLamports(TEST_WALLET.publicKey.toBase58(), 5 * LAMPORTS_PER_SOL);
  // a few existing coins with trading history
  const coins = [
    { name: 'Trench Bandit', symbol: 'BANDIT', buys: [2.5, 1.2, 4, 0.8, 6.5, 3.3, 9, 2.2, 5.1, 7.4], sells: [3, 7] },
    { name: 'Photon Frog', symbol: 'PHRG', buys: [0.5, 1, 0.7, 2, 0.4], sells: [2] },
    { name: 'Nebula Inu', symbol: 'NBLA', buys: [1, 3, 2.5, 8, 12, 6, 9, 14, 4.5], sells: [4] },
  ];
  const creators = [Keypair.generate(), Keypair.generate(), TEST_WALLET];
  coins.forEach((f, i) => {
    const mint = Keypair.generate();
    const t0 = Math.floor(Date.now() / 1000) - (6 - i) * 3600;
    addLamports(creators[i].publicKey.toBase58(), 20 * LAMPORTS_PER_SOL);
    const made = createLaunch(creators[i].publicKey, mint.publicKey, f.name, f.symbol, `https://gateway.pinata.cloud/ipfs/mock-${f.symbol.toLowerCase()}`, t0, BigInt(Math.round((0.5 + i) * 1e9)));
    fixtures.push({ mint: mint.publicKey.toBase58(), sig: (made as any).sig });
    const traders = Array.from({ length: 6 }, () => Keypair.generate().publicKey);
    let t = t0 + 60;
    const seq = [...f.buys.map((b) => ['buy', b] as const), ...f.sells.map((s) => ['sell', s] as const)].sort(() => Math.random() - 0.5);
    for (const [side, amt] of seq) {
      t += 120 + Math.floor(Math.random() * 900);
      const who = traders[Math.floor(Math.random() * traders.length)];
      addLamports(who.toBase58(), 50 * LAMPORTS_PER_SOL);
      if (side === 'buy') trade(who, mint.publicKey, 'buy', BigInt(Math.round(amt * 1e9)), t);
      else { const ata = getAssociatedTokenAddressSync(mint.publicKey, who).toBase58(); const bal = tokenAmount(ata); if (bal > 0n) trade(who, mint.publicKey, 'sell', bal / 2n, t); }
    }
  });
  return { config: CONFIG.toBase58() };
}

/* ---------- LaunchLab effects ---------- */
function vaults(pool: PublicKey, mint: PublicKey) {
  return { a: getPdaLaunchpadVaultId(PROGRAM, pool, mint).publicKey, b: getPdaLaunchpadVaultId(PROGRAM, pool, NATIVE_MINT).publicKey };
}
export function createLaunch(creator: PublicKey, mint: PublicKey, name: string, symbol: string, uri: string, blockTime?: number, devBuyLamports = 0n, opts: { record?: boolean; platform?: PublicKey } = {}) {
  const pool = getPdaLaunchpadPoolId(PROGRAM, mint, NATIVE_MINT).publicKey;
  const v = vaults(pool, mint);
  set(mint, TOKEN_PROGRAM_ID, mintData(BigInt(INIT.supply.toString()), 6));
  set(metadataPda(mint), METADATA_PROGRAM, metadataData(mint, name, symbol, uri));
  set(v.a, TOKEN_PROGRAM_ID, tokenData(mint, AUTH, BigInt(INIT.supply.toString())));
  set(v.b, TOKEN_PROGRAM_ID, tokenData(NATIVE_MINT, AUTH, 0n));
  set(pool, PROGRAM, poolData({
    epoch: new BN(800), bump: 255, status: 0, mintDecimalsA: 6, mintDecimalsB: 9, migrateType: 1,
    supply: INIT.supply, totalSellA: INIT.sell, virtualA: INIT.vA, virtualB: INIT.vB, realA: new BN(0), realB: new BN(0),
    totalFundRaisingB: INIT.raise, protocolFee: new BN(0), platformFee: new BN(0), migrateFee: new BN(0),
    vestingSchedule: { totalLockedAmount: new BN(0), cliffPeriod: new BN(0), unlockPeriod: new BN(0), startTime: new BN(0), totalAllocatedShare: new BN(0) },
    configId: CONFIG, platformId: opts.platform || PLATFORM, mintA: mint, mintB: NATIVE_MINT, vaultA: v.a, vaultB: v.b, creator,
    mintProgramFlag: 0, cpmmCreatorFeeOn: 0, platformVestingShare: new BN(0),
  }));
  if (opts.record === false) return { pool, ...v };
  const keys = [creator.toBase58(), mint.toBase58(), pool.toBase58(), v.a.toBase58(), v.b.toBase58(), PROGRAM.toBase58(), metadataPda(mint).toBase58()];
  const signers = new Set([creator.toBase58(), mint.toBase58()]);
  const pre = new Map<string, bigint | null>([[v.a.toBase58(), null], [v.b.toBase58(), null]]); // vaults are created in this transaction
  if (devBuyLamports > 0n) applyBuy(creator, mint, devBuyLamports);
  const sig = record(undefined, keys, signers, pre, blockTime);
  return { pool, ...v, sig };
}

/** Fee rates of a pool: protocol (config) + its platform's fee + the creator fee, all in 1e6 units. */
function feeRates(p: any) {
  const a = chain.accounts.get(k(p.platformId));
  const pc: any = a ? PlatformConfig.decode(a.data) : null;
  return { trade: FEE.trade, platform: pc ? Number(pc.feeRate.toString()) : 0, creator: pc ? Number(pc.creatorFeeRate.toString()) : 0 };
}
function accrueFees(p: any, base: bigint) {
  const f = feeRates(p);
  const plat = (base * BigInt(f.platform)) / 1_000_000n, cre = (base * BigInt(f.creator)) / 1_000_000n;
  if (plat > 0n) { const v = platformVault(p.platformId); setTokenAmount(v, NATIVE_MINT.toBase58(), PLATFORM_FEE_AUTH.toBase58(), tokenAmount(v) + plat); }
  if (cre > 0n) { const v = creatorVault(p.creator); setTokenAmount(v, NATIVE_MINT.toBase58(), CREATOR_FEE_AUTH.toBase58(), tokenAmount(v) + cre); }
}
const totalFee = (p: any) => { const f = feeRates(p); return BigInt(f.trade + f.platform + f.creator); };
function applyBuy(owner: PublicKey, mint: PublicKey, lamportsIn: bigint) {
  const poolKey = getPdaLaunchpadPoolId(PROGRAM, mint, NATIVE_MINT).publicKey.toBase58();
  const p = readPool(poolKey);
  if (!p || p.status !== 0) throw rpcError(-32002, 'Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1773 (PoolNotTrading)');
  const inLess = (lamportsIn * (1_000_000n - totalFee(p))) / 1_000_000n;
  const x = BigInt(p.virtualA.sub(p.realA).toString()), y = BigInt(p.virtualB.add(p.realB).toString());
  let out = x - (x * y) / (y + inLess);
  const remaining = BigInt(p.totalSellA.sub(p.realA).toString());
  if (out > remaining) out = remaining;
  p.realA = p.realA.add(new BN(out.toString()));
  p.realB = p.realB.add(new BN(inLess.toString()));
  if (p.realB.gte(p.totalFundRaisingB) || p.realA.gte(p.totalSellA)) p.status = 1;
  chain.accounts.get(poolKey)!.data = poolData(p);
  const v = { a: k(p.vaultA), b: k(p.vaultB) };
  setTokenAmount(v.a, k(mint), AUTH.toBase58(), tokenAmount(v.a) - out);
  setTokenAmount(v.b, NATIVE_MINT.toBase58(), AUTH.toBase58(), tokenAmount(v.b) + inLess);
  const ata = getAssociatedTokenAddressSync(mint, owner).toBase58();
  setTokenAmount(ata, k(mint), k(owner), tokenAmount(ata) + out);
  if (lamportsOf(k(owner)) < Number(lamportsIn) + 10_000) throw rpcError(-32002, 'Transaction simulation failed: Attempt to debit an account but found no record of a prior credit. insufficient lamports');
  addLamports(k(owner), -Number(lamportsIn));
  accrueFees(p, lamportsIn);
  return out;
}
function applySell(owner: PublicKey, mint: PublicKey, amountA: bigint) {
  const poolKey = getPdaLaunchpadPoolId(PROGRAM, mint, NATIVE_MINT).publicKey.toBase58();
  const p = readPool(poolKey);
  if (!p || p.status !== 0) throw rpcError(-32002, 'Transaction simulation failed: custom program error: 0x1773 (PoolNotTrading)');
  const ata = getAssociatedTokenAddressSync(mint, owner).toBase58();
  if (tokenAmount(ata) < amountA) throw rpcError(-32002, 'Transaction simulation failed: insufficient funds');
  const x = BigInt(p.virtualA.sub(p.realA).toString()), y = BigInt(p.virtualB.add(p.realB).toString());
  const outGross = y - (x * y) / (x + amountA);
  const out = (outGross * (1_000_000n - totalFee(p))) / 1_000_000n;
  p.realA = p.realA.sub(new BN(amountA.toString()));
  p.realB = p.realB.sub(new BN(outGross.toString()));
  chain.accounts.get(poolKey)!.data = poolData(p);
  const v = { a: k(p.vaultA), b: k(p.vaultB) };
  setTokenAmount(v.a, k(mint), AUTH.toBase58(), tokenAmount(v.a) + amountA);
  setTokenAmount(v.b, NATIVE_MINT.toBase58(), AUTH.toBase58(), tokenAmount(v.b) - outGross);
  setTokenAmount(ata, k(mint), k(owner), tokenAmount(ata) - amountA);
  addLamports(k(owner), Number(out));
  accrueFees(p, outGross);
  return out;
}

export function trade(owner: PublicKey, mint: PublicKey, side: 'buy' | 'sell', amount: bigint, blockTime?: number) {
  const poolKey = getPdaLaunchpadPoolId(PROGRAM, mint, NATIVE_MINT).publicKey;
  const p = readPool(poolKey.toBase58());
  const v = { a: k(p.vaultA), b: k(p.vaultB) };
  const ata = getAssociatedTokenAddressSync(mint, owner).toBase58();
  const keys = [owner.toBase58(), AUTH.toBase58(), CONFIG.toBase58(), PLATFORM.toBase58(), poolKey.toBase58(), ata, v.a, v.b, mint.toBase58(), NATIVE_MINT.toBase58(), PROGRAM.toBase58()];
  const pre = snapshot([v.a, v.b, ata]);
  if (side === 'buy') applyBuy(owner, mint, amount); else applySell(owner, mint, amount);
  return record(undefined, keys, new Set([owner.toBase58()]), pre, blockTime);
}

/* ---------- transaction records (jsonParsed shape) ---------- */
function snapshot(keys: string[]) { const m = new Map<string, bigint | null>(); for (const key of keys) m.set(key, chain.accounts.has(key) ? tokenAmount(key) : null); return m; }
function tokenMeta(key: string) { const a = chain.accounts.get(key); if (!a || a.data.length !== ACCOUNT_SIZE) return null; const d: any = AccountLayout.decode(a.data); return { mint: k(d.mint), owner: k(d.owner) }; }
function decimalsOf(mint: string) { const a = chain.accounts.get(mint); return a && a.data.length === MINT_SIZE ? (MintLayout.decode(a.data) as any).decimals : 9; }
function bal(index: number, key: string, amount: bigint) {
  const m = tokenMeta(key)!;
  const dec = decimalsOf(m.mint);
  return { accountIndex: index, mint: m.mint, owner: m.owner, programId: TOKEN_PROGRAM_ID.toBase58(), uiTokenAmount: { amount: amount.toString(), decimals: dec, uiAmount: Number(amount) / 10 ** dec, uiAmountString: String(Number(amount) / 10 ** dec) } };
}
function record(sig: string | undefined, keys: string[], signers: Set<string>, pre: Map<string, bigint | null>, blockTime?: number, parsedIxs: any[] = [], extra: any = {}) {
  chain.slot += 2;
  const s = sig || bs58.encode(nacl.randomBytes(64));
  const preTB: any[] = [], postTB: any[] = [];
  keys.forEach((key, i) => {
    if (!pre.has(key)) return;
    const before = pre.get(key);
    if (before != null && tokenMeta(key)) preTB.push(bal(i, key, before));
    if (tokenMeta(key)) postTB.push(bal(i, key, tokenAmount(key)));
  });
  const tx = {
    slot: chain.slot, blockTime: blockTime || Math.floor(Date.now() / 1000), version: 0,
    meta: { err: null, fee: 5000, preBalances: keys.map(lamportsOf), postBalances: keys.map(lamportsOf), preTokenBalances: preTB, postTokenBalances: postTB, innerInstructions: [], logMessages: [], ...extra.meta },
    transaction: { signatures: [s], message: { accountKeys: keys.map((key) => ({ pubkey: key, signer: signers.has(key), writable: true, source: 'transaction' })), instructions: parsedIxs, recentBlockhash: bs58.encode(nacl.randomBytes(32)) } },
  };
  const rec: Rec = { sig: s, slot: chain.slot, blockTime: tx.blockTime, tx, keys };
  chain.sigs.set(s, rec);
  for (const key of new Set(keys)) { const l = chain.byAddress.get(key) || []; l.unshift(s); chain.byAddress.set(key, l); }
  return s;
}

/* ---------- sendTransaction: verify signatures, then apply the instructions we understand ---------- */
export function rpcError(code: number, message: string) { const e: any = new Error(message); e.rpc = { code, message }; return e; }
const DISC = {
  initV2: Buffer.from([67, 153, 175, 39, 218, 16, 38, 32]),
  buyIn: Buffer.from([250, 234, 13, 123, 213, 156, 19, 236]),
  sellIn: Buffer.from([149, 39, 222, 155, 211, 124, 152, 26]),
  claimCreator: Buffer.from([26, 97, 138, 203, 132, 171, 141, 252]),
  createPlatform: Buffer.from([176, 90, 196, 175, 253, 113, 220, 20]),
  updatePlatform: Buffer.from([195, 60, 76, 129, 146, 45, 67, 143]),
  claimPlatformVault: Buffer.from([117, 241, 198, 168, 248, 218, 80, 29]),
};
const programError = (msg: string) => rpcError(-32002, `Transaction simulation failed: Error processing Instruction 0: ${msg}`);
function borshStr(d: Buffer, o: number) { const len = d.readUInt32LE(o); return { v: d.subarray(o + 4, o + 4 + len).toString('utf8'), o: o + 4 + len }; }

export function sendTransaction(b64: string) {
  const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));
  const msg = tx.message;
  const keys = msg.staticAccountKeys.map((x) => x.toBase58());
  const nSig = msg.header.numRequiredSignatures;
  const bytes = msg.serialize();
  for (let i = 0; i < nSig; i++) {
    if (!nacl.sign.detached.verify(bytes, tx.signatures[i], msg.staticAccountKeys[i].toBytes()))
      throw rpcError(-32003, `Transaction signature verification failure (signer ${keys[i]})`);
  }
  const sig = bs58.encode(tx.signatures[0]);
  if (chain.sigs.has(sig)) throw rpcError(-32002, 'This transaction has already been processed');
  const signers = new Set(keys.slice(0, nSig));
  const payer = keys[0];
  const parsed: any[] = [];
  const touched: string[] = [...keys];
  const pre = new Map<string, bigint | null>();
  for (const ix of msg.compiledInstructions) {
    const prog = keys[ix.programIdIndex];
    const acc = ix.accountKeyIndexes.map((i) => keys[i]);
    const data = Buffer.from(ix.data);
    if (prog === SystemProgram.programId.toBase58()) {
      const kind = data.readUInt32LE(0);
      if (kind === 2) {
        const lamports = Number(data.readBigUInt64LE(4));
        if (lamportsOf(acc[0]) < lamports) throw rpcError(-32002, 'Transaction simulation failed: insufficient lamports');
        addLamports(acc[0], -lamports); addLamports(acc[1], lamports);
        parsed.push({ program: 'system', programId: prog, parsed: { type: 'transfer', info: { source: acc[0], destination: acc[1], lamports } } });
      }
      continue;
    }
    if (prog === PROGRAM.toBase58()) {
      const disc = data.subarray(0, 8);
      if (disc.equals(DISC.initV2)) {
        let o = 8; const dec = data[o]; o += 1;
        const name = borshStr(data, o); o = name.o; const symbol = borshStr(data, o); o = symbol.o; const uri = borshStr(data, o);
        void dec;
        const mint = new PublicKey(acc[6]);
        const pool = getPdaLaunchpadPoolId(PROGRAM, mint, NATIVE_MINT).publicKey;
        const v = vaults(pool, mint);
        if (!chain.accounts.has(acc[3])) throw programError('custom program error: 0xbc4 (AccountNotInitialized: platform_config)');
        createLaunch(new PublicKey(acc[1]), mint, name.v, symbol.v, uri.v, undefined, 0n, { record: false, platform: new PublicKey(acc[3]) });
        pre.set(v.a.toBase58(), null); pre.set(v.b.toBase58(), null);
      } else if (disc.equals(DISC.buyIn)) {
        const amountB = data.readBigUInt64LE(8);
        const vA = acc[7], vB = acc[8], ata = acc[5];
        for (const x of [vA, vB, ata]) if (!pre.has(x)) pre.set(x, chain.accounts.has(x) ? tokenAmount(x) : null);
        applyBuy(new PublicKey(acc[0]), new PublicKey(acc[9]), amountB);
      } else if (disc.equals(DISC.sellIn)) {
        const amountA = data.readBigUInt64LE(8);
        const vA = acc[7], vB = acc[8], ata = acc[5];
        for (const x of [vA, vB, ata]) if (!pre.has(x)) pre.set(x, chain.accounts.has(x) ? tokenAmount(x) : null);
        applySell(new PublicKey(acc[0]), new PublicKey(acc[9]), amountA);
      } else if (disc.equals(DISC.claimCreator)) {
        const creator = acc[0], vault = acc[2];
        if (!signers.has(creator)) throw programError('missing required signature for instruction');
        if (vault !== creatorVault(creator)) throw programError('custom program error: 0x7d6 (ConstraintSeeds: creator_fee_vault)');
        const amt = tokenAmount(vault);
        if (amt > 0n) { if (!pre.has(vault)) pre.set(vault, amt); setTokenAmount(vault, NATIVE_MINT.toBase58(), CREATOR_FEE_AUTH.toBase58(), 0n); addLamports(creator, Number(amt)); } // claim + unwrap
      } else if (disc.equals(DISC.createPlatform)) {
        const admin = acc[0], claimWallet = acc[1], lockWallet = acc[2], platformId = acc[3], cpConfig = acc[4], tfeAuth = acc[6], vestWallet = acc[7];
        if (!signers.has(admin)) throw programError('missing required signature for instruction');
        if (platformId !== getPdaPlatformId(PROGRAM, new PublicKey(admin)).publicKey.toBase58()) throw programError('custom program error: 0x7d6 (ConstraintSeeds: platform_config)');
        if (chain.accounts.has(platformId)) throw programError(`Allocate: account Address { address: ${platformId}, base: None } already in use`);
        if (!chain.accounts.has(cpConfig)) throw programError('custom program error: 0xbc4 (AccountNotInitialized: cpswap_config)');
        let o = 8;
        const u64 = () => { const v = data.readBigUInt64LE(o); o += 8; return v; };
        const platformScale = u64(), creatorScale = u64(), burnScale = u64(), feeRate = u64();
        const name = borshStr(data, o); o = name.o; const web = borshStr(data, o); o = web.o; const img = borshStr(data, o); o = img.o;
        const creatorFeeRate = u64(), vestingScale = u64();
        if (platformScale + creatorScale + burnScale !== 1_000_000n) throw programError('custom program error: 0x1770 (InvalidInput: LP scales must add up to 1000000)');
        if (Buffer.byteLength(name.v) > 64 || Buffer.byteLength(web.v) > 256 || Buffer.byteLength(img.v) > 256) throw programError('custom program error: 0x1770 (InvalidInput: name/web/img too long)');
        set(platformId, PROGRAM, encode(PlatformConfig, {
          epoch: new BN(800), platformClaimFeeWallet: new PublicKey(claimWallet), platformLockNftWallet: new PublicKey(lockWallet),
          platformScale: new BN(platformScale.toString()), creatorScale: new BN(creatorScale.toString()), burnScale: new BN(burnScale.toString()),
          feeRate: new BN(feeRate.toString()), name: pad(name.v, 64), web: pad(web.v, 256), img: pad(img.v, 256), cpConfigId: new PublicKey(cpConfig),
          creatorFeeRate: new BN(creatorFeeRate.toString()), transferFeeExtensionAuth: new PublicKey(tfeAuth), platformVestingWallet: new PublicKey(vestWallet),
          platformVestingScale: new BN(vestingScale.toString()), platformCpCreator: new PublicKey(admin), restrictGlobalConfig: 0, restrictCurveParam: 0, curveRuleManager: new PublicKey(admin),
        }));
        addLamports(admin, -rent(PlatformConfig.span));
      } else if (disc.equals(DISC.updatePlatform)) {
        const admin = acc[0], platformId = acc[1];
        if (!signers.has(admin)) throw programError('missing required signature for instruction');
        if (platformId !== getPdaPlatformId(PROGRAM, new PublicKey(admin)).publicKey.toBase58()) throw programError('custom program error: 0x7d6 (ConstraintSeeds: platform_config)');
        const a = chain.accounts.get(platformId);
        if (!a) throw programError('custom program error: 0xbc4 (AccountNotInitialized: platform_config)');
        const pc: any = PlatformConfig.decode(a.data);
        const index = data[8];
        if (index === 0) pc.platformClaimFeeWallet = new PublicKey(data.subarray(9, 41));
        else if (index === 3) pc.feeRate = new BN(data.readBigUInt64LE(9).toString());
        else if (index >= 4 && index <= 6) { const v = borshStr(data, 9).v; if (index === 4) pc.name = pad(v, 64); else if (index === 5) pc.web = pad(v, 256); else pc.img = pad(v, 256); }
        else throw programError('custom program error: 0x1770 (InvalidInput: update not supported by the mock)');
        a.data = encode(PlatformConfig, pc);
      } else if (disc.equals(DISC.claimPlatformVault)) {
        const claimWallet = acc[0], platformId = acc[2], vault = acc[3];
        if (!signers.has(claimWallet)) throw programError('missing required signature for instruction');
        const a = chain.accounts.get(platformId);
        if (!a) throw programError('custom program error: 0xbc4 (AccountNotInitialized: platform_config)');
        const pc: any = PlatformConfig.decode(a.data);
        if (k(pc.platformClaimFeeWallet) !== claimWallet) throw programError('custom program error: 0x7d1 (ConstraintHasOne: platform_claim_fee_wallet)');
        if (vault !== platformVault(platformId)) throw programError('custom program error: 0x7d6 (ConstraintSeeds: platform_fee_vault)');
        const amt = tokenAmount(vault);
        if (amt > 0n) { if (!pre.has(vault)) pre.set(vault, amt); setTokenAmount(vault, NATIVE_MINT.toBase58(), PLATFORM_FEE_AUTH.toBase58(), 0n); addLamports(claimWallet, Number(amt)); } // claim + unwrap
      }
      continue;
    }
    // ATA create / SPL token / compute budget / memo: accepted as no-ops for the mock
  }
  addLamports(payer, -5000);
  return record(sig, touched, signers, pre, undefined, parsed);
}

export function airdrop(to: string, lamports: number) {
  addLamports(to, lamports);
  return record(undefined, [to], new Set(), new Map());
}

/* ---------- account views ---------- */
export function accountView(key: string, encoding: string) {
  const a = chain.accounts.get(key);
  if (!a) return null;
  const base = { lamports: a.lamports, owner: a.owner, executable: !!a.exec, rentEpoch: 0, space: a.data.length };
  if (encoding === 'jsonParsed' && a.owner === TOKEN_PROGRAM_ID.toBase58()) {
    if (a.data.length === MINT_SIZE) {
      const m: any = MintLayout.decode(a.data);
      return { ...base, data: { program: 'spl-token', space: MINT_SIZE, parsed: { type: 'mint', info: { decimals: m.decimals, supply: m.supply.toString(), mintAuthority: m.mintAuthorityOption ? k(m.mintAuthority) : null, freezeAuthority: m.freezeAuthorityOption ? k(m.freezeAuthority) : null, isInitialized: true } } } };
    }
    if (a.data.length === ACCOUNT_SIZE) {
      const t: any = AccountLayout.decode(a.data);
      const dec = decimalsOf(k(t.mint));
      return { ...base, data: { program: 'spl-token', space: ACCOUNT_SIZE, parsed: { type: 'account', info: { mint: k(t.mint), owner: k(t.owner), state: 'initialized', isNative: false, tokenAmount: { amount: t.amount.toString(), decimals: dec, uiAmount: Number(t.amount) / 10 ** dec, uiAmountString: String(Number(t.amount) / 10 ** dec) } } } } };
    }
  }
  return { ...base, data: [a.data.toString('base64'), 'base64'] };
}

export function tokenAccountsOf(owner: string, programId: string) {
  const out: { pubkey: string; acc: Acc }[] = [];
  for (const [key, a] of chain.accounts) {
    if (a.owner !== programId || a.data.length !== ACCOUNT_SIZE) continue;
    const t: any = AccountLayout.decode(a.data);
    if (k(t.owner) === owner) out.push({ pubkey: key, acc: a });
  }
  return out;
}
export function largestAccounts(mint: string) {
  const rows: { address: string; amount: bigint }[] = [];
  for (const [key, a] of chain.accounts) {
    if (a.owner !== TOKEN_PROGRAM_ID.toBase58() || a.data.length !== ACCOUNT_SIZE) continue;
    const t: any = AccountLayout.decode(a.data);
    if (k(t.mint) === mint && t.amount > 0n) rows.push({ address: key, amount: t.amount });
  }
  rows.sort((x, y) => (y.amount > x.amount ? 1 : -1));
  const dec = decimalsOf(mint);
  return rows.slice(0, 20).map((r) => ({ address: r.address, amount: r.amount.toString(), decimals: dec, uiAmount: Number(r.amount) / 10 ** dec, uiAmountString: String(Number(r.amount) / 10 ** dec) }));
}
export { ASSOCIATED_TOKEN_PROGRAM_ID };
