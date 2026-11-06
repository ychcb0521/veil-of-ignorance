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
import { turingReplaySamples } from '@/lib/turingReplaySamples';
import { parseSignalText } from '@/lib/signalLibrary';
import { connectTuringCupMarket } from '@/lib/turingCupMarketData';
import { loadTuringReplayArchive, parseTuringReplayArchive, readArchiveKlines } from '@/lib/turingCupReplayArchive';
import type { TradeSignal } from '@/lib/signalLibrary';

vi.mock('@/lib/turingCupReplayArchive', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/turingCupReplayArchive')>(),
  loadTuringReplayArchive: vi.fn(),
}));

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
  vi.mocked(loadTuringReplayArchive).mockReset().mockResolvedValue(undefined);
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

  it('aggregates full buckets, preserves a missing minute and marks the first traded reopen', () => {
    const first = [10000, 10100, 9900, 10050, 10, 1000, 2, 200];
    const second = [10050, 10300, 9700, 10150, 5, 505, 3, 303];
    const empty = [10150, 10150, 10150, 10150, 0, 0, 0, 0];
    const archive = parseTuringReplayArchive(JSON.stringify({ version: 1, anchorMs: time, minutes: 10,
      markets: { [ticker]: [first, first, second, second, first, null, empty, second, first, first] },
      reopens: [[5, 'lunch']],
    }));
    const bars = readArchiveKlines(archive, ticker, '5m', { startTime: time });
    expect(bars).toEqual([[time, '100.00', '103.00', '97.00', '100.50', 40, time + 5 * minute - 1, 4010, null, 12, 1206, null]]);
    const resumed = readArchiveKlines(archive, ticker, '1m', { startTime: time + 5 * minute, limit: 2 });
    expect(resumed.map(row => row[0])).toEqual([time + 6 * minute, time + 7 * minute]);
    expect(resumed[0][11]).toBeNull();
    expect(resumed[1][11]).toEqual({ turingReplayVersion: 1, reopen: 'lunch' });
    expect(readArchiveKlines(archive, ticker, '1m', { limit: 1 })[0][0]).toBe(time + 9 * minute);
  });

  it('generates one comparison row per archived symbol and preserves a manually entered Turing ticker', () => {
    const bar = [10000, 10000, 10000, 10000, 1, 100, .5, 50];
    const archive = parseTuringReplayArchive(JSON.stringify({
      version: 1, anchorMs: time, minutes: 3_000,
      markets: { 'TURING 1': Array(3_000).fill(bar), 'TURING 2': Array(3_000).fill(bar) }, reopens: [],
    }));
    const signals = turingReplaySamples(archive);
    expect(signals.map(signal => [signal.symbol, signal.timeMs, signal.turingReplaySample])).toEqual([
      ['TURING:TURING 1', time + 2885 * minute, true],
      ['TURING:TURING 2', time + 2885 * minute, true],
    ]);
    const manual = parseSignalText('2026-10-01 08:00\nTuring 1 98', turingCupSymbol);
    expect(manual.signals[0]).toMatchObject({ symbol: 'TURING:TURING 1', fallbackZone: '98' });
  });

  it.each(['rpc', 'continuous archive'])('uses the same filter and sell engine with %s, and preserves the source in the campaign', async source => {
    let runSignal = offline;
    if (source === 'continuous archive') {
      const history = 2885;
      const candles = Array.from({ length: history + 15 }, (_, slot) => {
        const open = slot === history + 5 ? 9_200 : slot > history ? 9_000 : 10_000;
        return [open, 10_100, 8_900, slot >= history ? 9_000 : 10_000, 1, 100, 0.5, 50];
      });
      const archive = parseTuringReplayArchive(JSON.stringify({ version: 1, anchorMs: time - history * minute,
        minutes: candles.length, markets: { [ticker]: candles }, reopens: [[history + 5, 'session-gap']],
      }));
      vi.mocked(loadTuringReplayArchive).mockResolvedValue(archive);
      runSignal = turingReplaySamples(archive)[0];
      expect(runSignal).toMatchObject({ symbol: offline.symbol, timeMs: time, turingReplaySample: true });
      const reopen = await fetchReplayKlineRange(offline.symbol, '1m', time + 5 * minute, time + 6 * minute);
      expect(reopen[0]).toMatchObject({ open: 92, turingReopen: 'session-gap' });
    }
    const def = { id: 'fixture', name: 'Fixture', short: 'F', definition: '', formula: 'raw = C',
      scale: 1, unit: '', positive: '1', control: '0', interval: '5m' as const, halfLifeHours: 3, avgHours: 12 };
    const snapshot = { featureId: def.id, featureShort: 'F', definitionKey: definitionKey(def), statistic: 'raw', interval: '5m' as const,
      scale: 1, direction: '<' as const, threshold: 95, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0, cutoffMs: time };
    const plan: QualityGroup = {
      id: 'sell-fixture', label: 'Fixture', metric: 'raw', snapshot, rule: { metric: 'raw', direction: '<', threshold: 95 },
      buyFilters: [{ id: 'buy-fixture', label: 'Fixture', metric: 'raw', direction: '>', threshold: 95, enabled: true, snapshot }],
    };
    const original = importQualityLibrary(importQualityLibrary(newQualityStudy(), [online]), [runSignal], time, 'turing');
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
    if (source === 'continuous archive') expect(rpc).not.toHaveBeenCalled();
  });
});
