/* The API decodes LaunchLab accounts by byte offset (no SDK on the server). These tests encode accounts with the
   official Raydium SDK layouts and check that the light decoders read exactly the same values. */
import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { LaunchpadPool, PlatformConfig, LaunchpadConfig } from '@raydium-io/raydium-sdk-v2';
import { decodeLaunchPool, decodePlatform, curvePriceSol, curveSummary, LAUNCHPAD_POOL_SIZE } from '../../server/lib/solana';

const key = () => Keypair.generate().publicKey;
const enc = (layout: any, obj: any) => { const b = Buffer.alloc(layout.span); layout.encode(obj, b); return b; };
const pad = (s: string, n: number) => { const b = Buffer.alloc(n); Buffer.from(s).copy(b); return [...b]; };

describe('LaunchLab pool decoder', () => {
  const k = { config: key(), platform: key(), mintA: key(), mintB: new PublicKey('So11111111111111111111111111111111111111112'), vaultA: key(), vaultB: key(), creator: key() };
  const pool = {
    epoch: new BN(812), bump: 254, status: 0, mintDecimalsA: 6, mintDecimalsB: 9, migrateType: 1,
    supply: new BN('1000000000000000'), totalSellA: new BN('793100000000000'), virtualA: new BN('1073471847374405'), virtualB: new BN('30050573465'),
    realA: new BN('123456789000000'), realB: new BN('4200000000'), totalFundRaisingB: new BN('85000000000'),
    protocolFee: new BN(11), platformFee: new BN(22), migrateFee: new BN(33),
    vestingSchedule: { totalLockedAmount: new BN(0), cliffPeriod: new BN(0), unlockPeriod: new BN(0), startTime: new BN(0), totalAllocatedShare: new BN(0) },
    configId: k.config, platformId: k.platform, mintA: k.mintA, mintB: k.mintB, vaultA: k.vaultA, vaultB: k.vaultB, creator: k.creator,
    mintProgramFlag: 0, cpmmCreatorFeeOn: 0, platformVestingShare: new BN(0),
  };
  const data = enc(LaunchpadPool, pool);

  it('has the size the decoder expects', () => {
    expect(data.length).toBeGreaterThanOrEqual(LAUNCHPAD_POOL_SIZE);
  });

  it('reads every field at the right offset', () => {
    const d = decodeLaunchPool(data);
    expect(d.status).toBe(0);
    expect(d.decimalsA).toBe(6);
    expect(d.decimalsB).toBe(9);
    expect(d.migrateType).toBe(1);
    expect(d.supply).toBe(1000000000000000n);
    expect(d.totalSellA).toBe(793100000000000n);
    expect(d.virtualA).toBe(1073471847374405n);
    expect(d.virtualB).toBe(30050573465n);
    expect(d.realA).toBe(123456789000000n);
    expect(d.realB).toBe(4200000000n);
    expect(d.totalFundRaisingB).toBe(85000000000n);
    expect([d.protocolFee, d.platformFee, d.migrateFee]).toEqual([11n, 22n, 33n]);
    expect(d.configId).toBe(k.config.toBase58());
    expect(d.platformId).toBe(k.platform.toBase58());
    expect(d.mintA).toBe(k.mintA.toBase58());
    expect(d.mintB).toBe(k.mintB.toBase58());
    expect(d.vaultA).toBe(k.vaultA.toBase58());
    expect(d.vaultB).toBe(k.vaultB.toBase58());
    expect(d.creator).toBe(k.creator.toBase58());
  });

  it('prices the curve like the SDK formula and reports progress', () => {
    const d = decodeLaunchPool(data);
    const expected = ((30050573465 + 4200000000) / (1073471847374405 - 123456789000000)) * 10 ** (6 - 9);
    expect(curvePriceSol(d)).toBeCloseTo(expected, 15);
    const s = curveSummary(d);
    expect(s.phase).toBe('curve');
    expect(s.raisedSol).toBeCloseTo(4.2, 9);
    expect(s.targetSol).toBe(85);
    expect(s.progress).toBeCloseTo((4.2 / 85) * 100, 6);
    expect(s.migrateType).toBe('cpmm');
  });

  it('rejects accounts that are too small', () => {
    expect(() => decodeLaunchPool(Buffer.alloc(100))).toThrow();
  });
});

describe('LaunchLab platform decoder', () => {
  it('matches the SDK PlatformConfig layout', () => {
    const claim = key(), cp = key();
    const data = enc(PlatformConfig, {
      epoch: new BN(800), platformClaimFeeWallet: claim, platformLockNftWallet: key(), platformScale: new BN(100000), creatorScale: new BN(100000), burnScale: new BN(800000),
      feeRate: new BN(5000), name: pad('Supernova', 64), web: pad('https://supernova.example', 256), img: pad('https://supernova.example/logo.png', 256),
      cpConfigId: cp, creatorFeeRate: new BN(2500), transferFeeExtensionAuth: key(), platformVestingWallet: key(), platformVestingScale: new BN(0),
      platformCpCreator: key(), restrictGlobalConfig: 0, restrictCurveParam: 0, curveRuleManager: key(),
    });
    const p = decodePlatform(data);
    expect(p).toEqual({
      claimFeeWallet: claim.toBase58(), feeRate: 5000, creatorFeeRate: 2500, name: 'Supernova',
      web: 'https://supernova.example', img: 'https://supernova.example/logo.png', cpConfigId: cp.toBase58(),
    });
  });
});

describe('LaunchLab config', () => {
  it('stores tradeFeeRate at byte 27 (read by the fee lookup)', () => {
    const data = enc(LaunchpadConfig, {
      epoch: new BN(800), curveType: 0, index: 0, migrateFee: new BN(0), tradeFeeRate: new BN(2500), maxShareFeeRate: new BN(10000),
      minSupplyA: new BN(0), maxLockRate: new BN(0), minSellRateA: new BN(0), minMigrateRateA: new BN(0), minFundRaisingB: new BN(0),
      mintB: key(), protocolFeeOwner: key(), migrateFeeOwner: key(), migrateToAmmWallet: key(), migrateToCpmmWallet: key(),
    });
    expect(Number(data.readBigUInt64LE(27))).toBe(2500);
  });
});
