import { expect, it, vi } from 'vitest';
import { FishScanner, type FishScanSettings } from '@/lib/fishScanner';
import { FISH_TURNOVER_FLOORS } from '@/lib/fish/shared';
import { countFishMarketHits, fishMarketHits, runFishHitRate, screeningHitRateSamples, type FishHitRateMode, type FishHitRateOptions, type FishHitRateWindow } from '@/lib/fish/hitRate';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { readFishRound } from '@/lib/fish/roundSummary';
import type { FishDataAdapter } from '@/lib/fish/adapters';
import type { PreEntryRecord } from '@/lib/fish/preEntryMonitor';
import type { TradeSignal } from '@/lib/signalLibrary';

const HOUR = 3_600_000, STEP = 300_000;
const sampleTime = Date.UTC(2026, 10, 1, 8);
const startTime = sampleTime - 2.5 * HOUR;
const anchor = sampleTime + 2.5 * HOUR;
const symbols = ['EARLY', 'EDGE', 'ENDED', 'STALE', 'OTHER', 'BROKEN', 'WICK', 'THIN'];
const markets = symbols.map(base => ({ symbol: base + 'USDT', instrument: base, base, multiplier: 1 }));
const feature = { ...CBI2_DEF, id: 'hit-rate-test', interval: '5m' as const, formula: 'X = C\nX', scale: 1, unit: '' };
const algorithm = { statistic: '结果', direction: '>' as const, threshold: 1, constraints: [] };
const sample = (base: string): TradeSignal => ({ id: base, symbol: base + 'USDT', timeMs: sampleTime, timeLabel: '', fallbackZone: '', quality: 3 });

function setup(stopAfterFirst = false) {
  const firstHit: Record<string, number> = { EARLY: sampleTime - HOUR, EDGE: startTime, ENDED: sampleTime, STALE: startTime - STEP, OTHER: sampleTime + HOUR };
  const candles = vi.fn<FishDataAdapter['candles']>(async (market, cut, _signal, query) => {
    if (market.base === 'BROKEN') throw new Error('模拟取数失败');
    const count = query?.count ?? 400;
    return Array.from({ length: count }, (_, index) => {
      const openTime = cut - (count - index) * STEP;
      if (market.base === 'WICK') {
        return { openTime, open: 10, high: 10.125, low: openTime === sampleTime ? 9 : 9.875, close: 10, volume: 100, takerBuyVolume: 50, quoteVolume: 1e9 };
      }
      const closeTime = openTime + STEP;
      const ordinary = closeTime >= firstHit[market.base] && !(market.base === 'ENDED' && closeTime === cut) ? 2 : 0.5;
      const close = market.base === 'ENDED' && closeTime === startTime - STEP ? 20
        : market.base === 'ENDED' && (closeTime === startTime || closeTime === sampleTime) ? 3 : ordinary;
      const quoteVolume = market.base === 'THIN' || (market.base === 'EDGE' && openTime < startTime) ? 25_000 : 1e9;
      return { openTime, open: close, high: close, low: close, close, volume: 100, takerBuyVolume: 50, quoteVolume };
    });
  });
  const adapter: FishDataAdapter = { exchange: 'binance', list: async () => markets, btc: () => markets[0], taker: async (_market, bars) => bars, candles };
  const scanner = new FishScanner(async () => new Response(JSON.stringify({ serverTime: anchor + HOUR })), undefined, undefined, { binance: adapter });
  const controller = new AbortController(), windows: FishHitRateWindow[] = [];
  const run = (mode: FishHitRateMode, samples: TradeSignal[], combination: 'and' | 'or' = 'and', wick = false, options: Pick<FishScanSettings, 'algorithms' | 'turnoverFloors'> = {}, window?: FishHitRateOptions['window']) => runFishHitRate(scanner, {
    samples, mode, window, signal: controller.signal, onProgress: () => {},
    settings: { exchanges: ['binance'], combination, downwardWick: { enabled: wick, hours: 4, atrMultiple: 3 }, algorithms: [{ feature, algorithm }, { feature: { ...feature, id: 'second' }, algorithm }], ...options },
    onWindow: window => { windows.push(window); if (stopAfterFirst) controller.abort(); },
  });
  return { run, windows, candles, controller };
}

it('scans exactly the listed markets for the same five-hour window and keeps test catches out of capture summaries', async () => {
  const { run, windows, candles } = setup();
  await run('targets', [sample('EARLY'), sample('EDGE'), sample('ENDED'), sample('STALE'), sample('BROKEN')]);
  expect(windows).toHaveLength(1);
  expect(windows[0].anchorMs).toBe(anchor);
  expect(candles.mock.calls.map(([market]) => market.base).sort()).toEqual(['BROKEN', 'EARLY', 'EDGE', 'ENDED', 'STALE']);
  expect(windows[0].rows.map(row => [row.sample.id, row.status, row.hit?.timeMs, row.reason ?? row.rejections?.map(rejection => rejection.label).join('、')])).toEqual([
    ['EARLY', 'hit', sampleTime - HOUR, undefined],
    ['EDGE', 'hit', startTime, undefined],
    ['ENDED', 'miss', undefined, '截止时未达到算法门槛'],
    ['STALE', 'miss', undefined, '信号起点超出测试窗口'],
    ['BROKEN', 'unverified', undefined, '行情请求失败'],
  ]);
  for (const hit of windows[0].hits) {
    expect(hit.fish?.lookbackHours).toBe(5);
    expect(readFishRound(hit.fish?.algorithmKey, hit.fish?.cutoffMs)).toBeNull();
    for (const member of hit.fish?.algorithms ?? []) expect(readFishRound(member.algorithmKey, member.cutoffMs)).toBeNull();
  }
});

it('keeps outside-window evidence separate from other algorithms that missed the threshold', async () => {
  const { run, windows } = setup();
  const algorithms = [
    { feature, algorithm },
    { feature: { ...feature, id: 'higher-threshold', short: 'BSS' }, algorithm: { ...algorithm, threshold: 3 } },
  ];
  await run('targets', [{ ...sample('STALE'), timeMs: sampleTime + 60_000 }], 'or', false, { algorithms });
  expect(windows[0]).toMatchObject({ startMs: startTime + 60_000, anchorMs: anchor + 60_000 });
  const row = windows[0].rows[0];
  expect(row).toMatchObject({
    status: 'miss',
    rejections: [{ kind: 'outside' }, { kind: 'below' }],
    outside: [{ algorithm: 'CBI-2', startMs: startTime - STEP, cutoffMs: anchor, cutoffReading: 2, threshold: 1, direction: '>' }],
    thresholds: [{ algorithm: 'BSS', cutoffMs: anchor, cutoffReading: 2, threshold: 3 }],
  });
  expect(row.outside).toHaveLength(1);
  expect(row.thresholds).toHaveLength(1);
});

it('uses the saved before and after durations for every sample in the same window', async () => {
  const { run, windows } = setup();
  await run('targets', [sample('EARLY'), sample('ENDED')], 'or', false, {}, { beforeHours: 1, afterHours: 0.5 });
  expect(windows).toHaveLength(1);
  expect(windows[0]).toMatchObject({ startMs: sampleTime - HOUR, anchorMs: sampleTime + 0.5 * HOUR });
  expect(windows[0].rows.map(row => row.status)).toEqual(['hit', 'miss']);
  expect(windows[0].hits[0].fish?.lookbackHours).toBe(1.5);
});

it('lists the other market hits without attributing them to the supplied sample', async () => {
  const { run, windows } = setup();
  await run('market', [sample('ENDED'), { ...sample('EARLY'), exchange: 'okx' }], 'or');
  expect(windows[0].hits.map(hit => hit.symbol)).toEqual(['EDGEUSDT', 'EARLYUSDT', 'OTHERUSDT']);
  expect(windows[0].rows.map(row => row.status)).toEqual(['miss', 'unverified']);
});

it('stops before another window and retains windows that were already published', async () => {
  const { run, candles, windows } = setup(true);
  await run('targets', [sample('EARLY'), { ...sample('OTHER'), timeMs: sampleTime - HOUR }]);
  expect(candles.mock.calls.map(([market]) => market.base)).toEqual(['EARLY']);
  expect(windows).toHaveLength(1);
  expect(windows[0].rows[0].status).toBe('hit');
});

it('retains the original 5-minute candle and rule when a downward wick excludes the sample', async () => {
  const { run, windows } = setup();
  await run('targets', [sample('WICK')], 'or', true);
  const row = windows[0].rows[0];
  expect(row).toMatchObject({
    status: 'miss', rejections: [{ kind: 'wick', label: '被插针过滤排除' }],
    wick: { symbol: 'WICKUSDT', exchange: 'binance', openTime: sampleTime, cutoffMs: anchor,
      open: 10, low: 9, drop: 1, atr: 0.25, rule: { enabled: true, hours: 4, atrMultiple: 3 } },
  });
  expect(row.wick?.candles.some(candle => candle.openTime === sampleTime && candle.low === 9)).toBe(true);
});

it('uses only closes inside the five-hour window and reports the selected series in its comparison units', async () => {
  const algorithms = [
    { feature: { ...feature, scale: 2, unit: '%' }, algorithm: { ...algorithm, threshold: 2 } },
    { feature: { ...feature, id: 'secondary', formula: 'X = C\nY = X * 10\nX' }, algorithm: { ...algorithm, statistic: 'Y', threshold: 10 } },
  ];
  for (const mode of ['targets', 'market'] as const) {
    const { run, windows } = setup();
    await run(mode, [sample('ENDED')], 'or', false, { algorithms });
    expect(windows[0].rows[0]).toMatchObject({
      status: 'miss',
      rejections: [{ kind: 'below', label: '截止时未达到算法门槛' }],
      thresholds: [
        { statistic: '结果', threshold: 2, unit: '%', cutoffMs: anchor, cutoffReading: 1, maximum: { value: 6, timeMs: startTime } },
        { statistic: 'Y', threshold: 10, unit: '原值', cutoffMs: anchor, cutoffReading: 5, maximum: { value: 30, timeMs: startTime } },
      ],
    });
  }
});

it('retains measured turnover at the actual failed check, keeping both cutoff and signal-start evidence distinct', async () => {
  const { run, windows } = setup();
  await run('targets', [sample('THIN'), sample('EDGE')], 'or', false, { turnoverFloors: FISH_TURNOVER_FLOORS });
  const checks = [
    { hours: 1, value: 300_000, min: 1_000_000, ok: false },
    { hours: 12, value: 3_600_000, min: 8_000_000, ok: false },
    { hours: 24, value: 7_200_000, min: 10_000_000, ok: false },
  ];
  expect(windows[0].rows).toMatchObject([
    { status: 'miss', rejections: [{ kind: 'thin', label: '成交额未达门槛' }], turnover: [{ symbol: 'THINUSDT', stage: 'cutoff', at: anchor, checks }] },
    { status: 'miss', rejections: [{ kind: 'thin', label: '成交额未达门槛' }], turnover: [{ symbol: 'EDGEUSDT', stage: 'signal-start', at: startTime, checks }] },
  ]);
});

it('classifies market hits against the full test samples and counts repeated starts only once', async () => {
  const { run, windows } = setup();
  const samples = [sample('EARLY'), { ...sample('OTHER'), timeMs: sampleTime + 0.5 * HOUR }];
  await run('market', samples, 'or');
  const hits = fishMarketHits(windows, samples);
  expect(hits.filter(row => row.signal.symbol === 'OTHERUSDT').map(row => row.group)).toEqual(['other-window', 'sample']);
  expect(hits.filter(row => row.signal.symbol === 'EARLYUSDT').map(row => row.group)).toEqual(['sample', 'other-window']);
  const outside = hits.filter(row => row.group === 'outside');
  expect(outside.map(row => row.signal.symbol)).toEqual(['EDGEUSDT']);
  expect(countFishMarketHits([...outside, ...outside])).toEqual({ markets: 1, signals: 1 });
});

it('anchors selected screening records to their original signal time and deduplicates repeated admissions', async () => {
  const source = sample('EARLY');
  const matchedAt = sampleTime + 8 * HOUR;
  const record: PreEntryRecord = {
    id: 'selected', roundId: 'first-round', sample: { id: source.id, source, enteredAt: source.timeMs, basis: 'signal', importedAt: sampleTime, groups: [] },
    status: 'matched', startTime: sampleTime, cursor: matchedAt, matchedAt, updatedAt: matchedAt, readings: [],
  };
  const records = [
    record,
    { ...record, id: 'repeat', roundId: 'repeat-round', matchedAt: matchedAt + HOUR },
    { ...record, id: 'hidden', roundId: 'hidden-round', sample: { ...record.sample, source: sample('EDGE') } },
    { ...record, id: 'not-matched', status: 'unmatched' as const, sample: { ...record.sample, source: sample('ENDED') } },
    { ...record, id: 'not-selected', sample: { ...record.sample, source: sample('OTHER') } },
  ];
  const selected = screeningHitRateSamples(records, ['selected', 'repeat', 'hidden', 'not-matched'], { 'hidden-round': { hidden: true, at: matchedAt } });
  expect(selected).toMatchObject([{ symbol: 'EARLYUSDT', timeMs: sampleTime }]);
  const { run, windows } = setup();
  await run('targets', selected);
  expect(windows[0]).toMatchObject({ startMs: startTime, anchorMs: anchor, rows: [{ status: 'hit' }] });
  expect(record.matchedAt).toBe(matchedAt);
});
