import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addSizingProfitRecords, checkVerifiedAddOrder, verifiedAddSizingProfit } from '@/lib/addSizingVerifiedProfit';
import { verifyAddSizingRealizedRecords } from '@/lib/campaignLegExecution';
import { evaluateMarketAddFill } from '@/lib/addSizingFillGuard';
import type { AddSizingSnapshot, Position, TradeRecord } from '@/types/trading';

const source = vi.hoisted(() => ({ failed: false }));
vi.mock('@/lib/canonicalTimePrice', () => ({
  fetchCanonicalTimePriceAt: async () => {
    if (source.failed) throw new Error('rate limited');
    return { low: 0.179938, high: 0.182222, close: 0.1809787115 };
  },
}));

let recordSequence = 0;
const mirror = (): TradeRecord => ({ id: `mirror-${++recordSequence}`, fillId: 'mirror', symbol: 'BILLUSDT',
  side: 'LONG', type: 'MARKET', action: 'CLOSE', settlementMode: 'coin',
  entryPrice: 0.17481128524344, exitPrice: 0.18692252029, pnl: 108100.86692277054,
  pnlCoin: 582523.1317972753, contracts: 157165, quantity: 157165, contractSizeUsd: 10,
  leverage: 10, fee: 0, slippage: 0, openTime: 1000, closeTime: 100000 + recordSequence * 60000,
});
const position: Position = { id: 'held', side: 'LONG', entryPrice: 0.17481128524344,
  settlementMode: 'coin', quantity: 157165, contracts: 157165, contractSizeUsd: 10,
  leverage: 10, marginMode: 'isolated', margin: 157165, openTime: 1000 } as Position;
const snapshot: AddSizingSnapshot = { plan: 'B', at: 1000, side: 'LONG', settlement: 'coin',
  s1: 0.175037, sBar: position.entryPrice, x1: 8990552.285061803,
  g: 617588.6636697986, gUnit: 'BILL', orderKind: 'limit', s2Ref: 0.184243,
  s2Fill: 0.184243, slippagePct: 0, addCoinsMax: 11963113.93105844, contracts: 220412 };

beforeEach(() => { source.failed = false; });

describe('verified calculator profit and actual order budget', () => {
  it('BILL regression: seeds the corrected 54,662.74 U instead of raw 108,100.87 U, without rewriting wallet history', async () => {
    const record = mirror();
    const result = await verifiedAddSizingProfit('BILLUSDT', 'LONG', [record]);
    expect(result.complete).toBe(true);
    expect(result.usd).toBeCloseTo(54662.7407, 2);
    expect(record.pnl).toBe(108100.86692277054);
  });

  it('rechecks a limit calculation used as a market order: an oversized order is rejected', async () => {
    const result = await checkVerifiedAddOrder({ symbol: 'BILLUSDT', snapshot, positions: [position],
      history: [mirror()], kind: 'market', referencePrice: 0.18396133333333334, units: 220754, face: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('市价');
  });

  it('a smaller market order uses verified profit and captures its actual mode and price', async () => {
    const record = mirror();
    const result = await checkVerifiedAddOrder({ symbol: 'BILLUSDT', snapshot, positions: [position],
      history: [record], kind: 'market', referencePrice: 0.18396133333333334, units: 100000, face: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.orderKind).toBe('market');
      expect(result.snapshot.g * result.snapshot.s1).toBeCloseTo(54662.7407, 2);
      expect(result.snapshot.s2Fill).toBeGreaterThan(result.snapshot.s2Ref);
      expect(result.snapshot.addCoinsMax).toBeLessThan(snapshot.addCoinsMax);
      const fill = evaluateMarketAddFill({ symbol: 'BILLUSDT', side: 'LONG', settlement: 'coin',
        referencePrice: result.snapshot.s2Ref, fillPrice: result.snapshot.s2Fill,
        addCoins: 1000000 / result.snapshot.s2Fill, heldBefore: [position], ordersMap: {},
        tradeHistory: [record], snapshot: result.snapshot });
      expect(fill).not.toBeNull();
      expect(fill!.g * fill!.s1).toBeCloseTo(54662.7407, 2);
      expect(fill!.overLimit).toBe(false);
    }
  });

  it('failed verification cannot authorize an order using unverified profit', async () => {
    source.failed = true;
    const result = await checkVerifiedAddOrder({ symbol: 'BILLUSDT', snapshot, positions: [position],
      history: [mirror()], kind: 'limit', referencePrice: snapshot.s2Ref, units: 1000, face: 10 });
    expect(result.ok).toBe(false);
  });

  it('reads the current market price after asynchronous profit verification', async () => {
    let price = 0.18396133333333334;
    const checking = checkVerifiedAddOrder({ symbol: 'BILLUSDT', snapshot, positions: [position],
      history: [mirror()], kind: 'market', referencePrice: () => price, units: 100000, face: 10 });
    price = 0.195;
    expect((await checking).ok).toBe(false);
  });

  it('matches the campaign last-cut rule for multiple reductions of one fill', async () => {
    const first = { ...mirror(), id: 'first', closeTime: 2000, pnl: 10 };
    const last = { ...mirror(), id: 'last', closeTime: 3000 };
    const fetch = vi.fn(async () => ({ low: 0.179938, high: 0.182222, close: 0.1809787115 }));
    const checked = await verifyAddSizingRealizedRecords('BILLUSDT', [first, last], fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(checked.records[0].pnl).toBe(10);
    expect(checked.records[1].pnl).toBeCloseTo(54662.7407, 2);
  });

  it('isolates replay sessions, symbols and directions and deduplicates record ids', () => {
    const current = { ...mirror(), closedRealAt: 5000 };
    const records = addSizingProfitRecords('BILLUSDT', 'LONG', [current, current,
      { ...mirror(), closedRealAt: 1000 }, { ...mirror(), symbol: 'OTHER' },
      { ...mirror(), side: 'SHORT' }], 1000, 2000);
    expect(records).toEqual([current]);
  });
});
