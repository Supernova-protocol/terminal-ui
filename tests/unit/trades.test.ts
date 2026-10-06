/* Trades are indexed from the vault balance changes of each LaunchLab transaction (jsonParsed RPC shape). */
import { describe, it, expect } from 'vitest';
import { parseTrade, candlesFromTrades, type TradeRec } from '../../server/lib/launches';

const rec = { vaultA: 'VaultA1111111111111111111111111111111111111', vaultB: 'VaultB1111111111111111111111111111111111111', supplyRaw: '1000000000000000', decimals: 6, signature: 'createSig', creator: 'Creator111111111111111111111111111111111111' };

function tx(o: { sig?: string; signer?: string; preA?: string | null; postA: string; preB?: string | null; postB: string; err?: any; blockTime?: number }) {
  const keys = [o.signer || 'Trader1111111111111111111111111111111111111', 'Pool111111111111111111111111111111111111111', rec.vaultA, rec.vaultB];
  const bal = (i: number, amount: string, mint: string) => ({ accountIndex: i, mint, uiTokenAmount: { amount, decimals: i === 2 ? 6 : 9 } });
  const pre: any[] = [];
  if (o.preA != null) pre.push(bal(2, o.preA, 'MintA'));
  if (o.preB != null) pre.push(bal(3, o.preB, 'So11111111111111111111111111111111111111112'));
  return {
    slot: 42, blockTime: o.blockTime ?? 1_790_000_000,
    meta: { err: o.err ?? null, preTokenBalances: pre, postTokenBalances: [bal(2, o.postA, 'MintA'), bal(3, o.postB, 'So11111111111111111111111111111111111111112')] },
    transaction: { signatures: [o.sig || 'tradeSig'], message: { accountKeys: keys.map((pubkey, i) => ({ pubkey, signer: i === 0, writable: true })) } },
  };
}

describe('parseTrade', () => {
  it('reads a buy: tokens leave vault A, SOL enters vault B', () => {
    const t = parseTrade(tx({ preA: '800000000000000', postA: '790000000000000', preB: '5000000000', postB: '6000000000' }), rec)!;
    expect(t.side).toBe('buy');
    expect(t.tokens).toBe(10_000_000);
    expect(t.sol).toBe(1);
    expect(t.price).toBeCloseTo(1e-7, 15);
    expect(t.wallet).toBe('Trader1111111111111111111111111111111111111');
    expect(t.ts).toBe(1_790_000_000_000);
    expect(t.dev).toBeUndefined();
  });

  it('reads a sell and flags the creator wallet as dev', () => {
    const t = parseTrade(tx({ signer: rec.creator, preA: '790000000000000', postA: '795000000000000', preB: '6000000000', postB: '5500000000' }), rec)!;
    expect(t.side).toBe('sell');
    expect(t.tokens).toBe(5_000_000);
    expect(t.sol).toBe(0.5);
    expect(t.dev).toBe(true);
  });

  it('treats the creation transaction (vaults created in it) as the dev buy', () => {
    const t = parseTrade(tx({ sig: 'createSig', signer: rec.creator, preA: null, postA: '990000000000000', preB: null, postB: '300000000' }), rec)!;
    expect(t.side).toBe('buy');
    expect(t.tokens).toBe(10_000_000);
    expect(t.sol).toBe(0.3);
  });

  it('ignores failed transactions and non-trades', () => {
    expect(parseTrade(tx({ preA: '1', postA: '0', preB: '0', postB: '1', err: { InstructionError: [0, 'Custom'] } }), rec)).toBeNull();
    expect(parseTrade(tx({ preA: '5', postA: '5', preB: '9', postB: '3' }), rec)).toBeNull(); // SOL out only: migration / fee claim
    expect(parseTrade(null, rec)).toBeNull();
  });
});

describe('candlesFromTrades', () => {
  it('buckets trades into OHLCV candles in USD, chaining opens to the previous close', () => {
    const base = 1_790_000_000_000;
    const mk = (s: number, price: number, sol: number): TradeRec => ({ sig: String(s), ts: base + s * 1000, slot: s, side: 'buy', sol, tokens: sol / price, price, wallet: 'w' });
    const c = candlesFromTrades([mk(70, 3e-7, 2), mk(5, 1e-7, 1), mk(20, 2e-7, 1)], 60, 150, 1e9);
    expect(c).toHaveLength(2);
    expect(c[0].open).toBeCloseTo(1e-7 * 150, 12);
    expect(c[0].high).toBeCloseTo(2e-7 * 150, 12);
    expect(c[0].close).toBeCloseTo(2e-7 * 150, 12);
    expect(c[0].volume).toBeCloseTo(300, 9);
    expect(c[1].open).toBeCloseTo(c[0].close, 12);
    expect(c[1].close).toBeCloseTo(3e-7 * 150, 12);
    expect(c[1].time - c[0].time).toBe(60);
  });
});
