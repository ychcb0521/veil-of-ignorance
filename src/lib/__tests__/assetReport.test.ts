import { describe, expect, it } from 'vitest';

import {
  buildOperationDailyPnlDetails,
  buildOperationDailyPnl,
  filterDailyPnlByRange,
  operationDateKey,
  pnlForOperationDate,
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
    expect(buildOperationDailyPnlDetails([oldRecord])).toEqual([]);
  });

  it('groups operation-day detail by traded symbol with record-level PnL', () => {
    const day = Date.parse('2026-06-29T06:57:49.000Z');

    expect(buildOperationDailyPnlDetails([
      record({ id: 'power-win', symbol: 'POWERUSDT', pnl: 100, fee: 2, closedRealAt: day + 2_000 }),
      record({ id: 'jelly-loss', symbol: 'JELLYJELLYUSDT', pnl: -25, fee: 1, closedRealAt: day + 1_000 }),
      record({ id: 'power-add', symbol: 'POWERUSDT', pnl: 40, closedRealAt: day + 3_000 }),
    ])).toEqual([
      {
        date: '2026-06-29',
        pnl: 115,
        trades: 3,
        symbols: [
          {
            symbol: 'POWERUSDT',
            pnl: 140,
            trades: 2,
            records: [
              {
                id: 'power-win',
                symbol: 'POWERUSDT',
                side: 'LONG',
                action: 'CLOSE',
                pnl: 100,
                fee: 2,
                operationTime: day + 2_000,
              },
              {
                id: 'power-add',
                symbol: 'POWERUSDT',
                side: 'LONG',
                action: 'CLOSE',
                pnl: 40,
                fee: 0,
                operationTime: day + 3_000,
              },
            ],
          },
          {
            symbol: 'JELLYJELLYUSDT',
            pnl: -25,
            trades: 1,
            records: [
              {
                id: 'jelly-loss',
                symbol: 'JELLYJELLYUSDT',
                side: 'LONG',
                action: 'CLOSE',
                pnl: -25,
                fee: 1,
                operationTime: day + 1_000,
              },
            ],
          },
        ],
      },
    ]);
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

  it('returns only the PnL for the objective operation date', () => {
    const now = Date.parse('2026-06-29T06:57:49.000Z');
    const dailyPnl = buildOperationDailyPnl([
      record({ id: 'previous-day', pnl: 999, closedRealAt: Date.parse('2026-06-28T10:00:00.000Z') }),
      record({ id: 'today-win', pnl: 125, closedRealAt: now }),
      record({ id: 'today-loss', pnl: -25, closedRealAt: now + 60_000 }),
    ]);

    expect(pnlForOperationDate(dailyPnl, now)).toBe(100);
  });
});
