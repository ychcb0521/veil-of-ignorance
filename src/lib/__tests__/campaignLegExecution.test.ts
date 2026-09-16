import { describe, expect, it } from 'vitest';
import {
  buildLegExitPriceCorrection,
  buildTradeRecordPnlCorrection,
  fetchLegExitPriceCorrections,
  fetchLegExitPriceCorrectionsResult,
  resolveLegExecution,
  sameLegExitPriceCorrections,
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

  /**
   * complete 是自愈回写的闸门：「校验不了」必须与「校验过、无需校正」分开，
   * 否则换一台没有成交记录的浏览器读一次，落库值就会被未校正的快照合计翻回去。
   */
  describe('completeness flag', () => {
    const closedRecord = (id: string): TradeRecord => ({
      id,
      symbol: 'TESTUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 1,
      exitPrice: 1.05,
      quantity: 100,
      leverage: 1,
      pnl: 5,
      fee: 0,
      slippage: 0,
      openTime: 1_000,
      closeTime: 2_000,
    });
    const inRange = async () => ({ low: 1, high: 1.1, close: 1.05 });

    it('is complete when every linked leg resolves and every candle arrives, with or without a correction', async () => {
      const result = await fetchLegExitPriceCorrectionsResult(
        'TESTUSDT',
        [{ id: 'leg-a', trade_record_id: 'rec-a' } as TradeJournal],
        [closedRecord('rec-a')],
        inRange,
      );
      expect(result).toEqual({ corrections: {}, complete: true });
    });

    it('is complete for legs that never carried a trade record (pure review snapshots)', async () => {
      const legs = [{ id: 'leg-snapshot', trade_record_id: null } as TradeJournal];
      expect(await fetchLegExitPriceCorrectionsResult('TESTUSDT', legs, [], inRange))
        .toEqual({ corrections: {}, complete: true });
      expect(await fetchLegExitPriceCorrectionsResult('TESTUSDT', legs, [closedRecord('rec-x')], inRange))
        .toEqual({ corrections: {}, complete: true });
    });

    it('is incomplete when a linked leg has no local record at all (empty trade history)', async () => {
      let requestCount = 0;
      const result = await fetchLegExitPriceCorrectionsResult(
        'TESTUSDT',
        [{ id: 'leg-a', trade_record_id: 'rec-a' } as TradeJournal],
        [],
        async () => { requestCount += 1; return inRange(); },
      );
      expect(result).toEqual({ corrections: {}, complete: false });
      expect(requestCount).toBe(0);
    });

    it('is incomplete when only one linked leg fails to resolve, while the resolved legs are still corrected', async () => {
      const result = await fetchLegExitPriceCorrectionsResult(
        'TESTUSDT',
        [
          { id: 'leg-a', trade_record_id: 'rec-a' } as TradeJournal,
          { id: 'leg-missing', trade_record_id: 'rec-gone' } as TradeJournal,
        ],
        [{ ...closedRecord('rec-a'), exitPrice: 1.5 }],
        inRange,
      );
      expect(result.complete).toBe(false);
      expect(result.corrections['leg-a']?.exitPrice).toBe(1.05);
      expect(result.corrections['leg-missing']).toBeUndefined();
    });

    it('is incomplete when a candle fetch rejects', async () => {
      const result = await fetchLegExitPriceCorrectionsResult(
        'TESTUSDT',
        [{ id: 'leg-a', trade_record_id: 'rec-a' } as TradeJournal],
        [closedRecord('rec-a')],
        async () => { throw new Error('HTTP 429'); },
      );
      expect(result).toEqual({ corrections: {}, complete: false });
    });

    it('the read-only wrapper still returns whatever corrections were resolved', async () => {
      const corrections = await fetchLegExitPriceCorrections(
        'TESTUSDT',
        [
          { id: 'leg-a', trade_record_id: 'rec-a' } as TradeJournal,
          { id: 'leg-missing', trade_record_id: 'rec-gone' } as TradeJournal,
        ],
        [{ ...closedRecord('rec-a'), exitPrice: 1.5 }],
        inRange,
      );
      expect(Object.keys(corrections)).toEqual(['leg-a']);
    });
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

describe('sameLegExitPriceCorrections', () => {
  const correction = { exitPrice: 0.1895, originalExitPrice: 0.19867, candleLow: 0.186, candleHigh: 0.191 };

  it('内容相同即算没变（两份空的、逐字相同的都算）', () => {
    expect(sameLegExitPriceCorrections({}, {})).toBe(true);
    expect(sameLegExitPriceCorrections({ 'leg-1': correction }, { 'leg-1': { ...correction } })).toBe(true);
  });

  it('键集合或任一价格不同就算变了', () => {
    expect(sameLegExitPriceCorrections({}, { 'leg-1': correction })).toBe(false);
    expect(sameLegExitPriceCorrections({ 'leg-1': correction }, { 'leg-2': correction })).toBe(false);
    expect(sameLegExitPriceCorrections(
      { 'leg-1': correction },
      { 'leg-1': { ...correction, exitPrice: 0.19 } },
    )).toBe(false);
    expect(sameLegExitPriceCorrections(
      { 'leg-1': correction },
      { 'leg-1': { ...correction, candleHigh: 0.2 } },
    )).toBe(false);
  });
});
