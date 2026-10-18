import { makeData } from './fixtures';
import { describe, expect, it } from 'vitest';
import { compileFeatureFormula, computeFeatureValues, DRIFT_SPEED_FORMULA, formulaVariables } from '@/lib/deepDig/features';
import { computeEventSeries, groupCurves, seriesOffsets, seriesRangeOf, valueAt, type DeepDigSeries } from '@/lib/deepDig/series';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { BAR_MS, extractWindow, type ResearchBar } from '@/lib/deepRsa/window';
import type { DeepDigRow } from '@/lib/deepDig/analysis';

const HOUR = 3_600_000;
const ANCHOR = Date.parse('2026-03-10T00:00:00Z');

function bars(fromMs: number, toMs: number, seed = 1, skip?: (t: number) => boolean): ResearchBar[] {
  const rand = mulberry32(seed);
  let close = 100;
  const out: ResearchBar[] = [];
  for (let t = fromMs; t < toMs; t += BAR_MS) {
    const open = close;
    close = open * Math.exp(0.004 * (rand() - 0.5));
    const q = 2e5 * (0.3 + rand());
    if (skip?.(t)) continue;
    out.push({ openTime: t, open, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * 0.999, close, volume: q / close, takerBuyVolume: null, quoteVolume: q, takerBuyQuoteVolume: q * rand() });
  }
  return out;
}

describe('【用户要求】Deep dig 时间序列曲线：各组在进场前后每个时点的平均', () => {
  it('范围：5m 默认进场前后各 24 小时、每小时一点；粗周期至少 12 根', () => {
    const r5 = seriesRangeOf({});
    expect(r5).toEqual({ beforeMs: 24 * HOUR, afterMs: 24 * HOUR, stepMs: HOUR });
    const o = seriesOffsets(r5);
    expect(o).toHaveLength(49);
    expect([o[0], o[24], o[48]]).toEqual([-24 * HOUR, 0, 24 * HOUR]);
    expect(seriesOffsets(seriesRangeOf({ interval: '4h' }))).toHaveLength(25);
  });

  it('【用户要求】时间段与平均时长一致：进场前后各 avgh 小时，点距 ≈ 范围 ÷ 24（取整根），进场一定是其中一点', () => {
    const MIN = 60_000;
    const cases: [number, number, number, number][] = [
      // avgh, 范围, 点距, 点数（5 分钟线）
      [24, 24 * HOUR, HOUR, 49],
      [48, 48 * HOUR, 2 * HOUR, 49],
      [72, 72 * HOUR, 3 * HOUR, 49],
      [36, 36 * HOUR, 1.5 * HOUR, 49],
      [12, 12 * HOUR, 30 * MIN, 49],
      [4, 4 * HOUR, 10 * MIN, 49],
      [1, HOUR, 5 * MIN, 25],
    ];
    for (const [avgHours, span, step, n] of cases) {
      const r = seriesRangeOf({ avgHours });
      expect(r).toEqual({ beforeMs: span, afterMs: span, stepMs: step });
      const o = seriesOffsets(r);
      expect(o).toHaveLength(n);
      expect(o).toContain(0);
    }
  });

  it('每个点 = 那一刻之前最后一根已收盘 K 线上的值；τ = 0 与特征值一致；缺 K 线的点记缺失', () => {
    const all = bars(ANCHOR - 72 * HOUR, ANCHOR + 24 * HOUR, 3);
    const offsets = seriesOffsets(seriesRangeOf({}));
    // 无记忆的公式：逐点精确
    const lnC = compileFeatureFormula('X = ln(C)');
    const s = computeEventSeries(all, ANCHOR, lnC, {}, ['X'], offsets)!;
    offsets.forEach((tau, k) => {
      const last = all.filter(b => b.openTime + BAR_MS <= ANCHOR + tau).at(-1)!;
      expect(s[k]).toBeCloseTo(Math.log(last.close), 5);
    });
    // 默认公式：τ = 0 与按 48h 观察窗算出的特征值一致（曲线每点往前多 24h 历史，只差 48h 以前那点残余权重）
    const compiled = compileFeatureFormula(DRIFT_SPEED_FORMULA);
    const { names } = formulaVariables(DRIFT_SPEED_FORMULA);
    const full = computeEventSeries(all, ANCHOR, compiled, {}, names, offsets)!;
    const feature = computeFeatureValues(extractWindow(all, ANCHOR), compiled);
    const series: DeepDigSeries = { finishedAt: 1, offsets, names, result: 'a', byEvent: { e: full } };
    expect(valueAt(series, 'e', 'a')).toBeCloseTo(feature.value!, 6);
    expect(Math.abs(valueAt(series, 'e', 'a')! - feature.value!)).toBeLessThan(0.01 * Math.abs(feature.value!) + 1e-12);
    expect(valueAt(series, 'e', 'F')).toBeCloseTo(feature.vars.F!, 6);
    // 进场后 3–5 小时没有 K 线：那几个点缺失，其余照常
    const gap = bars(ANCHOR - 72 * HOUR, ANCHOR + 24 * HOUR, 3, t => t >= ANCHOR + 2 * HOUR && t < ANCHOR + 5 * HOUR);
    const g = computeEventSeries(gap, ANCHOR, lnC, {}, ['X'], offsets)!;
    expect([3, 4, 5].map(h => Number.isNaN(g[24 + h]))).toEqual([true, true, true]);
    expect(Number.isNaN(g[24 + 2])).toBe(false);
    expect(Number.isNaN(g[24 + 6])).toBe(false);
  });

  it('按组平均：只算这一组、有特征值、没删掉的行；标准误按样本标准差', () => {
    const offsets = [-HOUR, 0, HOUR];
    const ev = (id: string, xs: number[]) => [id, Float32Array.from(xs)] as const;
    const series: DeepDigSeries = {
      finishedAt: 1, offsets, names: ['V'], result: 'V',
      byEvent: Object.fromEntries([ev('a', [1, 2, 3]), ev('b', [3, 4, Number.NaN]), ev('c', [100, 100, 100]), ev('d', [9, 9, 9])]),
    };
    const row = (id: string, group: DeepDigRow['group'], v: number | null): DeepDigRow => ({ id, symbol: 'X', anchorMs: 0, group, memberIds: [], v, endRet: 0, maxUp: 0, maxDown: 0, period: 'discovery' });
    // d 被删掉（不在 rows 里）；c 没有特征值
    const curves = groupCurves([row('a', 'positive', 1), row('b', 'positive', 1), row('c', 'positive', null), row('e', 'control', 1)], series, 'V');
    const pos = curves.find(c => c.group === 'positive')!;
    expect(pos.n).toBe(2);
    expect(pos.mean).toEqual([2, 3, 3]);
    expect(pos.count).toEqual([2, 2, 1]);
    expect(pos.se[0]).toBeCloseTo(Math.sqrt(2 / 2), 12);
    expect(pos.se[2]).toBeNull();
    // 没有曲线的行不算
    expect(curves.find(c => c.group === 'control')!).toMatchObject({ n: 0, mean: [null, null, null] });
  });
});


describe('推断时点快照', () => {
  it('全变量同步、缺失不能回填进场值，元数据记录实际时点，曲线不匹配时拒绝使用', async () => {
    const { dataAtOffset } = await import('@/lib/deepDig/series');
    const data = makeData();
    const row = data.rows[0];
    data.rows[0] = { ...row, vars: { F: 7, old: 99 } };
    const series: DeepDigSeries = { finishedAt: data.finishedAt, offsets: [0, HOUR], names: ['F','a'], result: 'a', byEvent: { [row.id]: Float32Array.from([7, 42, row.v!, 3]) } };
    const selected = dataAtOffset(data, series, HOUR)!;
    expect(selected.sampleOffsetMs).toBe(HOUR);
    expect(selected.rows[0]).toMatchObject({ v: 3, vars: { F: 42, a: 3, old: null } });
    expect(selected.rows[1].v).toBeNull();
    expect(selected.rows[1].vars!.F).toBeNull();
    expect(dataAtOffset(data, null, HOUR)).toBeNull();
    expect(dataAtOffset(data, { ...series, finishedAt: data.finishedAt + 1 }, HOUR)).toBeNull();
    expect(dataAtOffset(data, series, 5 * HOUR)).toBeNull();
    expect(dataAtOffset(data, null, 0)).toBe(data);
    expect(data.rows[0].vars!.F).toBe(7);
  });
});
