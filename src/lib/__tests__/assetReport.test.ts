import { describe, expect, it } from 'vitest';

import {
  buildOperationDailyPnl,
  filterDailyPnlByRange,
  operationDateKey,
  tradeRecordOperationTime,
} from '../assetReport';
import type { TradeRecord } from '@/types/trading';

function record(overrides: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: overrides.id ?? 'record-1',
    symbol: overrides.symbol ?? 'BTCUSDT',
    side: overrides.side ?? 'LONG',
    type: overrides.type ?? 'MARKET',
    action: overrides.action ?? 'CLOSE',
    entryPrice: overrides.entryPrice ?? 100,
    exitPrice: overrides.exitPrice ?? 110,
    quantity: overrides.quantity ?? 1,
    leverage: overrides.leverage ?? 10,
    pnl: overrides.pnl ?? 10,
    fee: overrides.fee ?? 0,
    slippage: overrides.slippage ?? 0,
    openTime: overrides.openTime ?? Date.parse('2026-02-18T01:10:00.000Z'),
    closeTime: overrides.closeTime ?? Date.parse('2026-02-18T01:35:00.000Z'),
    closedRealAt: overrides.closedRealAt,
  };
}

describe('asset report trade summaries', () => {
  it('groups trade PnL by objective operation time instead of simulated close time', () => {
    const operationTime = Date.parse('2026-06-29T06:57:49.000Z');
    const dailyPnl = buildOperationDailyPnl([
      record({ id: 'win', pnl: 125, closedRealAt: operationTime }),
      record({ id: 'loss', pnl: -25, closedRealAt: operationTime + 60_000 }),
    ]);

    expect(dailyPnl).toEqual([
      { date: '2026-06-29', pnl: 100, trades: 2 },
    ]);
  });

  it('does not fall back to time-machine close time for old records without operation time', () => {
    const oldRecord = record({
      pnl: 999,
      closeTime: Date.parse('2026-06-29T06:57:49.000Z'),
      closedRealAt: undefined,
    });

    expect(tradeRecordOperationTime(oldRecord)).toBeNull();
    expect(buildOperationDailyPnl([oldRecord])).toEqual([]);
  });

  it('filters summary rows by operation date range', () => {
    const today = Date.parse('2026-06-29T06:57:49.000Z');
    const dailyPnl = [
      { date: '2026-05-29', pnl: 10, trades: 1 },
      { date: '2026-05-30', pnl: 20, trades: 1 },
      { date: '2026-06-29', pnl: 30, trades: 2 },
    ];

    expect(operationDateKey(today)).toBe('2026-06-29');
    expect(filterDailyPnlByRange(dailyPnl, '30d', today)).toEqual([
      { date: '2026-05-30', pnl: 20, trades: 1 },
      { date: '2026-06-29', pnl: 30, trades: 2 },
    ]);
    expect(filterDailyPnlByRange(dailyPnl, 'all', today)).toEqual(dailyPnl);
  });
});
