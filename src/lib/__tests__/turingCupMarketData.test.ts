import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { fetchCanonicalTimePriceAt } from '@/lib/canonicalTimePrice';
import { diagnoseSignalJump, preflightSignalJumpIssues } from '@/lib/signalJumpDiagnostics';
import { fetchReplayKlineRange } from '@/hooks/useReplayKlines';
import { FishScanner } from '@/lib/fishScanner';
import { importQualityLibrary, newQualityStudy, qualityComparisonRows, type QualityGroup } from '@/lib/fish/quality';
import { archiveQualityResult } from '@/lib/fish/qualityCampaignArchive';
import { buildQualityCampaignData } from '@/lib/fish/qualityCampaignProjection';
import { buildCampaignDayIndex, hasCampaignOnSignalDay } from '@/lib/signalCampaignIndex';
import { turingCupSymbol } from '@/lib/turingCupSymbol';
import { connectTuringCupMarket } from '@/lib/turingCupMarketData';
import type { TradeSignal } from '@/lib/signalLibrary';

const rpc = vi.fn();

const minute = 60_000;
const time = Date.UTC(2026, 9, 1);
const ticker = 'TESTUSDT';
const online: TradeSignal = { id: 'online', symbol: ticker, timeMs: time, timeLabel: '', fallbackZone: '' };
const offline: TradeSignal = { ...online, id: 'offline', symbol: turingCupSymbol(ticker) };
const network = vi.fn(async () => { throw Error('An offline request reached the exchange'); });
type Query = { p_symbol: string; p_interval: string; p_start: number | null; p_end: number | null; p_limit: number };

beforeEach(() => {
  connectTuringCupMarket({ rpc });
  network.mockClear();
  vi.stubGlobal('fetch', network);
  rpc.mockReset().mockImplementation((fn: string, query: Query) => {
    const step = query.p_interval === '5m' ? 5 * minute : minute;
    const history = step === minute ? 25 : 3_000;
    const series = query.p_symbol === ticker ? Array.from({ length: (history + 15) / (step / minute) }, (_, index) => {
      const t = time - history * minute + index * step;
      const close = t >= time && query.p_interval === '5m' ? 90 : 100;
      const open = t === time + 5 * minute && step === minute ? 92 : 100;
      return [t, String(open), '101', '89', String(close), 1, null, 100, null, 0.5, 50];
    }) : [];
    const window = series.filter(([t]) => Number(t) >= (query.p_start ?? -Infinity) && Number(t) <= (query.p_end ?? Infinity));
    const data = fn === 'read_turing_cup_tick_size' ? 0.01
      : query.p_start == null ? window.slice(-query.p_limit) : window.slice(0, query.p_limit);
    const promise = Promise.resolve({ data, error: null });
    return Object.assign(promise, { abortSignal: () => promise });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('图灵杯离线来源', () => {
  it('uses only the archive for jump preflight, execution price and campaign K-lines', async () => {
    expect(await diagnoseSignalJump(offline.symbol, time, '1m', minute)).toEqual({ status: 'available' });
    const missing = await diagnoseSignalJump(turingCupSymbol('MISSING'), time, '1m', minute);
    expect(missing).toMatchObject({ status: 'retryable' });
    expect(await preflightSignalJumpIssues([offline], '1m', minute)).toMatchObject({
      checkedSymbols: 1, totalSymbols: 1, fatalIssueCount: 0, retryableSymbols: 0,
    });
    expect(await fetchCanonicalTimePriceAt(offline.symbol, time)).toMatchObject({ close: 100 });
    const candles = await fetchReplayKlineRange(offline.symbol, '1m', time, time + 2 * minute);
    expect(candles.map(candle => candle.time)).toEqual([time, time + minute, time + 2 * minute]);
    expect(candles[0]).toMatchObject({ close: 100, quoteVolume: 100, takerBuyQuoteVolume: 50 });
    expect(network).not.toHaveBeenCalled();
  });

  it('uses the same filter and sell engine, then preserves the offline source in the campaign', async () => {
    const def = { id: 'fixture', name: 'Fixture', short: 'F', definition: '', formula: 'raw = C',
      scale: 1, unit: '', positive: '1', control: '0', interval: '5m' as const, halfLifeHours: 3, avgHours: 12 };
    const snapshot = { featureId: def.id, featureShort: 'F', definitionKey: definitionKey(def), statistic: 'raw', interval: '5m' as const,
      scale: 1, direction: '<' as const, threshold: 95, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0, cutoffMs: time };
    const plan: QualityGroup = {
      id: 'sell-fixture', label: 'Fixture', metric: 'raw', snapshot, rule: { metric: 'raw', direction: '<', threshold: 95 },
      buyFilters: [{ id: 'buy-fixture', label: 'Fixture', metric: 'raw', direction: '>', threshold: 95, enabled: true, snapshot }],
    };
    const original = importQualityLibrary(importQualityLibrary(newQualityStudy(), [online]), [offline], time, 'turing');
    const rows = qualityComparisonRows(original);
    expect(rows.map(row => row.origin)).toEqual(['library', 'turing']);
    expect(rows[0].id).not.toBe(rows[1].id);
    const study = { ...original, sellPlans: [plan], selectedSellId: plan.id, selectedRowIds: [rows[1].id] };
    const onFilterReading = vi.fn(), onResult = vi.fn();
    await new FishScanner(network).quality({ study, task: 'monitor', signal: new AbortController().signal,
      onProgress: vi.fn(), onFilterReading, onResult });
    expect(onFilterReading).toHaveBeenCalledWith(expect.objectContaining({ value: 100 }));
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'closed', entryPrice: 100, endPrice: 92, endTime: time + 5 * minute,
    }));
    const archived = archiveQualityResult(study, onResult.mock.calls[0][0]);
    const { campaign } = buildQualityCampaignData('owner', archived.campaignRuns![0], 'sell');
    expect(campaign.symbol).toBe(offline.symbol);
    const index = buildCampaignDayIndex([campaign]);
    expect(hasCampaignOnSignalDay(index, offline)).toBe(true);
    expect(hasCampaignOnSignalDay(index, online)).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });
});
