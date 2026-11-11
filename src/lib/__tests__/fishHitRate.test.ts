import { expect, it, vi } from 'vitest';
import { FishScanner } from '@/lib/fishScanner';
import { runFishHitRate, type FishHitRateMode, type FishHitRateWindow } from '@/lib/fish/hitRate';
import { CBI2_DEF } from '@/lib/deepDig/features';
import { readFishRound } from '@/lib/fish/roundSummary';
import type { FishDataAdapter } from '@/lib/fish/adapters';
import type { TradeSignal } from '@/lib/signalLibrary';

const HOUR = 3_600_000, STEP = 300_000;
const sampleTime = Date.UTC(2026, 10, 1, 8);
const startTime = sampleTime - 2.5 * HOUR;
const anchor = sampleTime + 2.5 * HOUR;
const symbols = ['EARLY', 'EDGE', 'ENDED', 'STALE', 'OTHER', 'BROKEN'];
const markets = symbols.map(base => ({ symbol: base + 'USDT', instrument: base, base, multiplier: 1 }));
const feature = { ...CBI2_DEF, id: 'hit-rate-test', interval: '5m' as const, formula: 'X = C\nX', scale: 1, unit: '' };
const algorithm = { statistic: '结果', direction: '>' as const, threshold: 1, constraints: [] };
const sample = (base: string): TradeSignal => ({ id: base, symbol: base + 'USDT', timeMs: sampleTime, timeLabel: '', fallbackZone: '', quality: 3 });

function setup(stopAfterFirst = false) {
  const firstHit: Record<string, number> = { EARLY: sampleTime - HOUR, EDGE: startTime, ENDED: sampleTime, STALE: startTime - STEP, OTHER: sampleTime + HOUR };
  const candles = vi.fn<FishDataAdapter['candles']>(async (market, cut, _signal, query) => {
    if (market.base === 'BROKEN') throw new Error('模拟取数失败');
    return Array.from({ length: query.count }, (_, index) => {
      const openTime = cut - (query.count - index) * STEP;
      const close = openTime + STEP >= firstHit[market.base] && !(market.base === 'ENDED' && openTime + STEP === cut) ? 2 : 0.5;
      return { openTime, open: close, high: close, low: close, close, volume: 100, quoteVolume: 1e9 };
    });
  });
  const adapter: FishDataAdapter = { exchange: 'binance', list: async () => markets, btc: () => markets[0], taker: async (_market, bars) => bars, candles };
  const scanner = new FishScanner(async () => new Response(JSON.stringify({ serverTime: anchor + HOUR })), undefined, undefined, { binance: adapter });
  const controller = new AbortController(), windows: FishHitRateWindow[] = [];
  const run = (mode: FishHitRateMode, samples: TradeSignal[], combination: 'and' | 'or' = 'and') => runFishHitRate(scanner, {
    samples, mode, signal: controller.signal, onProgress: () => {},
    settings: { exchanges: ['binance'], combination, algorithms: [{ feature, algorithm }, { feature: { ...feature, id: 'second' }, algorithm }] },
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
  expect(windows[0].rows.map(row => [row.sample.id, row.status, row.hit?.timeMs, row.reason])).toEqual([
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
