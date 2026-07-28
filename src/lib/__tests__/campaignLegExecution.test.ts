import { describe, expect, it } from 'vitest';
import {
  buildLegExitPriceCorrection,
  buildTradeRecordPnlCorrection,
  fetchLegExitPriceCorrections,
  resolveLegExecution,
} from '@/lib/campaignLegExecution';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

describe('campaign leg execution price resolution', () => {
  it('uses canonical close price when a historical record exit is outside the close-time candle', () => {
    const correction = buildLegExitPriceCorrection(0.19867, {
      low: 0.186,
      high: 0.191,
      close: 0.1895,
    });

    expect(correction).toEqual({
      exitPrice: 0.1895,
      originalExitPrice: 0.19867,
      candleLow: 0.186,
      candleHigh: 0.191,
    });
  });

  it('keeps the original record exit price when it is inside the close-time candle', () => {
    expect(buildLegExitPriceCorrection(0.1902, {
      low: 0.186,
      high: 0.191,
      close: 0.1895,
    })).toBeNull();
  });

  it('rejects a 0.88% bad exit price for a small-price instrument', () => {
    const correction = buildLegExitPriceCorrection(0.0062373, {
      low: 0.006111,
      high: 0.006133,
      close: 0.0061265,
    });

    expect(correction).toEqual({
      exitPrice: 0.0061265,
      originalExitPrice: 0.0062373,
      candleLow: 0.006111,
      candleHigh: 0.006133,
    });
  });

  it('keeps official fees while replacing only the gross P&L from a bad exit', () => {
    const record = {
      id: 'fee-preservation-record',
      symbol: 'TESTUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1,
      exitPrice: 1.1,
      quantity: 100,
      leverage: 1,
      pnl: 9,
      fee: 1,
      slippage: 0,
      openTime: 1,
      closeTime: 2,
    } satisfies TradeRecord;

    const correction = buildTradeRecordPnlCorrection(record, {
      exitPrice: 1.05,
      originalExitPrice: 1.1,
      candleLow: 1.04,
      candleHigh: 1.06,
    });
    expect(correction?.originalNetPnl).toBe(9);
    expect(correction?.correctedNetPnl).toBeCloseTo(4, 8);
    expect(correction?.pnlDelta).toBeCloseTo(-5, 8);
  });

  it('deduplicates canonical-price requests shared by multiple linked legs', async () => {
    const record = {
      id: 'shared-record',
      symbol: 'RSRUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 0.006,
      exitPrice: 0.0062373,
      quantity: 1_600_000,
      leverage: 1,
      pnl: 1,
      fee: 0,
      slippage: 0,
      openTime: 1_000,
      closeTime: 2_000,
    } satisfies TradeRecord;
    const legs = [
      { id: 'leg-a', trade_record_id: record.id } as TradeJournal,
      { id: 'leg-b', trade_record_id: record.id } as TradeJournal,
    ];
    let requestCount = 0;

    const corrections = await fetchLegExitPriceCorrections(
      'RSRUSDT',
      legs,
      [record],
      async () => {
        requestCount += 1;
        return { low: 0.006111, high: 0.006133, close: 0.0061265 };
      },
    );

    expect(requestCount).toBe(1);
    expect(corrections['leg-a']?.exitPrice).toBe(0.0061265);
    expect(corrections['leg-b']?.exitPrice).toBe(0.0061265);
  });

  it('applies leg-level exit price corrections consistently for charts and tables', () => {
    const leg = {
      id: 'leg-1',
      trade_record_id: 'record-1',
      pre_simulated_time: '2025-04-26T01:38:00.000Z',
      pre_entry_price: 0.165244,
      post_real_close_time: '2025-04-26T05:17:00.000Z',
      post_exit_price_snapshot: 0.19867,
    } as TradeJournal;
    const record = {
      id: 'record-1',
      symbol: 'ALPACAUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 0.165244,
      exitPrice: 0.19867,
      quantity: 1,
      leverage: 1,
      pnl: 1,
      fee: 0,
      slippage: 0,
      openTime: Date.parse('2025-04-26T01:38:00.000Z'),
      closeTime: Date.parse('2025-04-26T05:17:00.000Z'),
    } satisfies TradeRecord;

    const resolved = resolveLegExecution(leg, record, {
      'leg-1': {
        exitPrice: 0.1895,
        originalExitPrice: 0.19867,
        candleLow: 0.186,
        candleHigh: 0.191,
      },
    });

    expect(resolved.closeTime).toBe(record.closeTime);
    expect(resolved.entryPrice).toBe(0.165244);
    expect(resolved.exitPrice).toBe(0.1895);
  });
});
