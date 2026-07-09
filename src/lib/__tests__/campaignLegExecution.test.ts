import { describe, expect, it } from 'vitest';
import {
  buildLegExitPriceCorrection,
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
