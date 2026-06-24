import { describe, expect, it } from 'vitest';
import type { Position } from '@/types/trading';
import { settlePositionClose } from '@/lib/tradingSettlement';

describe('settlePositionClose trade history record', () => {
  it('records a take-profit close with complete history fields', () => {
    const pos: Position = {
      id: 'pos-1',
      side: 'LONG',
      entryPrice: 100,
      quantity: 10,
      leverage: 10,
      marginMode: 'isolated',
      settlementMode: 'usdt',
      settlementAsset: 'USDT',
      margin: 100,
      isolatedMargin: 100,
      openTime: 1_000,
    };

    const settled = settlePositionClose('TESTUSDT', pos, 120, 5, 2_000, 'tp1', 3_000);

    expect(settled).not.toBeNull();
    expect(settled?.willFullyClose).toBe(false);
    expect(settled?.remainingUnits).toBeCloseTo(5);
    expect(settled?.record).toMatchObject({
      symbol: 'TESTUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 100,
      quantity: 5,
      leverage: 10,
      settlementMode: 'usdt',
      settlementAsset: 'USDT',
      openTime: 1_000,
      closeTime: 2_000,
      closedRealAt: 3_000,
      exit_method: 'tp1',
    });
    expect(settled?.record.exitPrice).toBeGreaterThan(0);
    expect(settled?.record.notionalUsd).toBeGreaterThan(0);
    expect(settled?.record.fee).toBeGreaterThan(0);
    expect(settled?.record.pnl).toBeGreaterThan(0);
  });
});
