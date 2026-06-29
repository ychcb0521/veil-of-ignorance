import { describe, expect, it } from 'vitest';

import {
  buildOperationAssetHistory,
  buildOperationDailyPnlDetails,
  buildOperationDailyPnl,
  dailyPnlFromDetails,
  filterAssetHistoryByRange,
  filterDailyPnlByRange,
  filterOperationPnlDetailsByRange,
  operationDateKey,
  pnlForOperationDate,
  summarizeOperationPnlDetailsByRange,
  summarizeOperationPnlDetailsForDate,
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

  it('summarizes selected report ranges by record-level operation time', () => {
    const now = Date.parse('2026-06-29T10:00:00.000Z');
    const justOutside7d = now - 7 * 86400_000 - 1;
    const justInside7d = now - 7 * 86400_000 + 1;
    const details = buildOperationDailyPnlDetails([
      record({ id: 'outside-7d', pnl: 1000, closedRealAt: justOutside7d }),
      record({ id: 'inside-7d', pnl: 200, closedRealAt: justInside7d }),
      record({ id: 'latest', pnl: -50, closedRealAt: now }),
    ]);

    expect(summarizeOperationPnlDetailsByRange(details, '7d', now)).toEqual({
      pnl: 150,
      trades: 2,
    });
    expect(summarizeOperationPnlDetailsByRange(details, '30d', now)).toEqual({
      pnl: 1150,
      trades: 3,
    });
    expect(summarizeOperationPnlDetailsByRange(details, 'all', now)).toEqual({
      pnl: 1150,
      trades: 3,
    });
  });

  it('summarizes a selected calendar date from daily details', () => {
    const details = buildOperationDailyPnlDetails([
      record({ id: 'previous-day', pnl: 1000, closedRealAt: Date.parse('2026-06-28T10:00:00.000Z') }),
      record({ id: 'day-win', pnl: 200, closedRealAt: Date.parse('2026-06-29T08:00:00.000Z') }),
      record({ id: 'day-loss', pnl: -50, closedRealAt: Date.parse('2026-06-29T10:00:00.000Z') }),
    ]);

    expect(summarizeOperationPnlDetailsForDate(details, '2026-06-29')).toEqual({
      pnl: 150,
      trades: 2,
    });
  });

  it('builds the asset curve by chronological operation time instead of time-machine close time', () => {
    const firstOperation = Date.parse('2026-06-22T10:00:00.000Z');
    const secondOperation = Date.parse('2026-06-29T10:00:00.000Z');

    const history = buildOperationAssetHistory([
      record({
        id: 'second',
        pnl: 300,
        closedRealAt: secondOperation,
        closeTime: Date.parse('2026-02-19T06:34:00.000Z'),
      }),
      record({
        id: 'first',
        pnl: 100,
        closedRealAt: firstOperation,
        closeTime: Date.parse('2026-04-10T00:00:00.000Z'),
      }),
    ], 1_000);

    expect(history).toEqual([
      { timestamp: firstOperation, totalBalance: 1_100 },
      { timestamp: secondOperation, totalBalance: 1_400 },
    ]);
  });

  it('filters asset curve ranges from the latest real operation time and returns sorted points', () => {
    const oldPoint = { timestamp: Date.parse('2026-04-10T00:00:00.000Z'), totalBalance: 1_100 };
    const inside7d = { timestamp: Date.parse('2026-06-23T10:00:00.000Z'), totalBalance: 1_300 };
    const latest = { timestamp: Date.parse('2026-06-29T10:00:00.000Z'), totalBalance: 1_400 };
    const sevenDayCutoff = Date.parse('2026-06-22T10:00:00.000Z');
    const thirtyDayCutoff = Date.parse('2026-05-30T10:00:00.000Z');

    expect(filterAssetHistoryByRange([latest, oldPoint, inside7d], '7d')).toEqual([
      { timestamp: sevenDayCutoff, totalBalance: 1_100 },
      inside7d,
      latest,
    ]);
    expect(filterAssetHistoryByRange([latest, oldPoint, inside7d], '30d')).toEqual([
      { timestamp: thirtyDayCutoff, totalBalance: 1_100 },
      inside7d,
      latest,
    ]);
    expect(filterAssetHistoryByRange([latest, oldPoint, inside7d], '90d')).toEqual([
      oldPoint,
      inside7d,
      latest,
    ]);
  });

  it('rebuilds calendar details from only the records inside the selected range', () => {
    const now = Date.parse('2026-06-29T10:00:00.000Z');
    const justOutside7d = now - 7 * 86400_000 - 1;
    const sameCalendarDayInside7d = now - 7 * 86400_000 + 1;
    const details = buildOperationDailyPnlDetails([
      record({ id: 'outside', symbol: 'POWERUSDT', pnl: 1000, closedRealAt: justOutside7d }),
      record({ id: 'inside', symbol: 'POWERUSDT', pnl: 200, closedRealAt: sameCalendarDayInside7d }),
      record({ id: 'latest', symbol: 'SAGAUSDT', pnl: -50, closedRealAt: now }),
    ]);

    const rangedDetails = filterOperationPnlDetailsByRange(details, '7d', now);

    expect(dailyPnlFromDetails(rangedDetails)).toEqual([
      { date: '2026-06-22', pnl: 200, trades: 1 },
      { date: '2026-06-29', pnl: -50, trades: 1 },
    ]);
    expect(summarizeOperationPnlDetailsForDate(rangedDetails, '2026-06-22')).toEqual({
      pnl: 200,
      trades: 1,
    });
  });
});
