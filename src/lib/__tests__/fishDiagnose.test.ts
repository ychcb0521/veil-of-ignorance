import { describe, expect, it, vi } from 'vitest';
import { FishScanner } from '@/lib/fishScanner';
import { FishAdapter, fishMissingRanges, type FishDataAdapter } from '@/lib/fish/adapters';
import { compileFishProgram } from '@/lib/fish/algorithm';
import { CBI2_DEF, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import type { ResearchBar } from '@/lib/deepRsa/window';

const STEP = 300000, cut = Date.UTC(2026, 3, 9, 15), signal = new AbortController().signal;
const def: DeepDigFeatureDef = { ...CBI2_DEF, id: 'simple', short: 'C', formula: 'P = C', scale: 1, unit: '' };
const algorithm = { H: 1, direction: '>' as const, threshold: 1.5, constraints: [] };
const plan = compileFishProgram(def, algorithm);
const aaa = { symbol: 'RAVEUSDT', instrument: 'RAVEUSDT', base: 'RAVE', multiplier: 1 }, btc = { symbol: 'BTCUSDT', instrument: 'BTCUSDT', base: 'BTC', multiplier: 1 };

describe('【用户要求】2026-10-19「原来能捕到、现在捕不到」：缓存补洞 + 查单个币', () => {
  it('缺的时间段全部补：头、中间的洞、尾', () => {
    const have = [2, 3, 6, 7].map(i => i * STEP);
    expect(fishMissingRanges(have, 0, 10 * STEP, STEP)).toEqual([[0, 2 * STEP], [4 * STEP, 6 * STEP], [8 * STEP, 10 * STEP]]);
    expect(fishMissingRanges([], 0, 3 * STEP, STEP)).toEqual([[0, 3 * STEP]]);
    expect(fishMissingRanges([0, STEP], 0, 2 * STEP, STEP)).toEqual([]);
  });

  it('两次不同截止时刻的扫描在缓存里留了洞，第三次扫中间时刻也能取全（以前只补头尾 → 整币算缺口跳过）', async () => {
    const adapter = new FishAdapter('binance', async path => {
      const u = new URL(path, 'https://t/'), a = Number(u.searchParams.get('startTime')), e = Number(u.searchParams.get('endTime'));
      return Array.from({ length: Math.floor((e - a) / STEP) + 1 }, (_, i) => [a + i * STEP, 1, 1, 1, 1, 1, a + (i + 1) * STEP - 1, 1, 1, .5, .5, 0]);
    });
    const count = 1000, day = 86400000;
    await adapter.candles(aaa, cut - 4 * day, signal, { interval: '5m', count }); // [−7.5d, −4d)
    await adapter.candles(aaa, cut, signal, { interval: '5m', count }); // [−3.5d, 0)
    const mid = await adapter.candles(aaa, cut - 1.5 * day, signal, { interval: '5m', count }); // [−5d, −1.5d)：两段缓存之间有 [−4d, −3.5d) 的洞
    expect(mid).toHaveLength(count);
    expect(mid.every((b, i) => b.openTime === cut - 1.5 * day - (count - i) * STEP)).toBe(true);
  });

  function scanner(make: (count: number, end: number) => ResearchBar[]) {
    const adapter: FishDataAdapter = { exchange: 'binance', list: vi.fn(async () => [aaa, btc]), btc: () => btc, candles: vi.fn(async (_m, end, _s, q) => make(q.count, end)), taker: vi.fn(async (_m, b) => b) };
    return new FishScanner(vi.fn(async () => new Response(JSON.stringify({ serverTime: cut + STEP }))) as typeof fetch, undefined, undefined, { binance: adapter });
  }
  const series = (closeAt: (i: number, n: number) => number) => (count: number, end: number): ResearchBar[] =>
    Array.from({ length: count }, (_, i) => ({ openTime: end - (count - i) * STEP, open: 1, high: 3, low: .5, close: closeAt(i, count), volume: 1, quoteVolume: 1, takerBuyQuoteVolume: .5, takerBuyVolume: null }));

  it('会命中：写出截止时的均值与这一轮的起点；结果与扫描一致', async () => {
    const s = scanner(series((i, n) => (i >= n - 100 ? 2 : 1)));
    const d = await s.diagnose({ symbol: 'rave', anchorMs: cut, feature: def, algorithm, signal });
    expect(d.outcome).toBe('hit');
    expect(d.lines[1]).toContain('会命中');
    expect(d.lines[1]).toContain('avg(P, 1h) 截止时 = 2.0000');
    expect(d.lines[0]).toContain(`需要 ${plan.N} 根`);
    const found: any[] = [];
    await s.scan({ feature: def, algorithm, anchorMs: cut, signal, onProgress: () => {}, onSignal: x => found.push(x) });
    expect(d.lines[1]).toContain(`这一轮从 ${new Date(found[0].timeMs + 8 * 3600000).toISOString().slice(5, 16).replace('T', ' ')} 开始`);
  });

  it('未达标：写出最近一次满足的时刻；起点不明、历史不足、找不到标的各有说明', async () => {
    const below = await scanner(series((i, n) => (i >= n - 100 && i < n - 40 ? 2 : 1))).diagnose({ symbol: 'RAVEUSDT', anchorMs: cut, feature: def, algorithm, signal });
    expect(below.outcome).toBe('below');
    expect(below.lines[2]).toContain('最近一次满足是在');
    const unknown = await scanner(series(() => 2)).diagnose({ symbol: 'RAVE', anchorMs: cut, feature: def, algorithm, signal });
    expect(unknown.outcome).toBe('unknown');
    const young = await scanner((count, end) => series(() => 1)(count, end).slice(50)).diagnose({ symbol: 'RAVE', anchorMs: cut, feature: def, algorithm, signal });
    expect(young.outcome).toBe('history');
    expect(young.lines[1]).toContain('当时未上市');
    const missing = await scanner(series(() => 1)).diagnose({ symbol: 'NOPE', anchorMs: cut, feature: def, algorithm, signal });
    expect(missing.outcome).toBe('not_found');
  });
});
