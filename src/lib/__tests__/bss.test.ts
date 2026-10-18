import { describe, expect, it } from 'vitest';
import { BSS_DEFAULTS, BSS_WEIGHTS, computeBss, type BssBar } from '@/lib/bss';
import { BSS_DEF, BSS_FORMULA, BUILTIN_FEATURES, compileFeatureFormula, computeFeatureValues, DRIFT_SPEED_DEF, formulaVariables } from '@/lib/deepDig/features';
import { evaluateProgram, parseFormula, rollingZScore } from '@/lib/deepDig/formula';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { BAR_MS, type ObservationWindow, type ResearchBar } from '@/lib/deepRsa/window';

function bars(n: number, seed: number, barMs = BAR_MS, missingEvery = 0): ResearchBar[] {
  const rand = mulberry32(seed);
  let close = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = close;
    close = open * Math.exp(0.006 * (rand() - 0.5));
    const q = 2e5 * (0.3 + rand());
    const missing = missingEvery > 0 && i % missingEvery === 5;
    return {
      openTime: i * barMs, open, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * 0.999, close, volume: q / close,
      takerBuyVolume: null, quoteVolume: missing ? null : q, takerBuyQuoteVolume: missing ? null : q * rand(),
    };
  });
}
const windowOf = (b: ResearchBar[], barMs = BAR_MS): ObservationWindow => ({
  anchorMs: b.length * barMs, aligned: true, bars: b, expectedBars: b.length, missingBars: 0, coverage: 1, missingTakerBars: 0,
});

describe('【用户要求】BSS 买卖强度综合分', () => {
  it('【用户要求】去掉订单簿 I，权重 0.45 / 0.25 / 0.30（合计 1）；BSS ∈ [−1, 1]', () => {
    expect(BSS_WEIGHTS).toEqual({ alpha: 0.45, beta: 0.25, delta: 0.3 });
    expect(BSS_WEIGHTS.alpha + BSS_WEIGHTS.beta + BSS_WEIGHTS.delta).toBeCloseTo(1, 15);
    // 剧烈行情、成交额忽大忽小：标准化 = tanh(z)，A ∈ [−1, 1]，所以每一根都落在 −1 ~ 1
    const rand = mulberry32(3);
    let close = 100;
    const wild: BssBar[] = Array.from({ length: 2000 }, () => {
      close *= Math.exp(0.05 * (rand() - 0.5));
      const q = 1e5 * 10 ** (3 * rand());
      return { close, quoteVolume: q, takerBuyQuoteVolume: q * rand() };
    });
    const points = computeBss(wild, 5).filter(p => p.bss != null);
    expect(points.length).toBeGreaterThan(1900);
    for (const p of points) {
      expect(Math.abs(p.bss!)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.mz!)).toBeLessThan(1);
      expect(Math.abs(p.vz!)).toBeLessThan(1);
    }
  });

  it('分量逐项手算：M = 近 n 涨跌幅，V = 近 n 平均成交额 ÷ 窗口平均，A = (主动买 − 主动卖) ÷ 合计', () => {
    // 1 小时一根：近 n = 1 小时 = 1 根，窗口 3 小时 = 3 根
    const b: BssBar[] = [
      { close: 100, quoteVolume: 100, takerBuyQuoteVolume: 50 },
      { close: 110, quoteVolume: 200, takerBuyQuoteVolume: 150 },
      { close: 99, quoteVolume: 300, takerBuyQuoteVolume: 60 },
    ];
    const p = computeBss(b, 60, { recentHours: 1, normHours: 3 });
    expect(p[0].m).toBeNull(); // 没有前一根
    expect(p[1].m).toBeCloseTo(0.1, 12);
    expect(p[2].m).toBeCloseTo(-0.1, 12);
    expect(p[2].v).toBeCloseTo(300 / 200, 12);
    expect(p[1].a).toBeCloseTo((150 - 50) / 200, 12);
    expect(p[2].a).toBeCloseTo((60 - 240) / 300, 12);
    // 滚动 z-score：样本标准差，少于 2 个值记空
    const z = rollingZScore(Float64Array.from([1, 2, 3, 10]), 3);
    expect(Number.isNaN(z[0])).toBe(true);
    expect(z[1]).toBeCloseTo((2 - 1.5) / Math.SQRT1_2, 12);
    const m = (3 + 2 + 10) / 3;
    const sd = Math.sqrt(((2 - m) ** 2 + (3 - m) ** 2 + (10 - m) ** 2) / 2);
    expect(z[3]).toBeCloseTo((10 - m) / sd, 12);
    // 标准化 = tanh(滚动 z-score)；【用户要求】BSS = 0.45·M标准化 + 0.25·Vd + 0.30·A，跌时 Vd = −max(V标准化, 0)
    const mz = rollingZScore(Float64Array.from([Number.NaN, 0.1, -0.1]), 3)[2];
    expect(p[2].mz).toBeCloseTo(Math.tanh(mz), 12);
    expect(p[2].vz!).toBeGreaterThan(0); // 第三根放量
    expect(p[2].vd).toBeCloseTo(-p[2].vz!, 12); // 跌 + 放量：扣分
    expect(p[2].bss).toBeCloseTo(0.45 * p[2].mz! + 0.25 * p[2].vd! + 0.3 * p[2].a!, 12);
  });

  it('Deep dig 的 BSS 公式与图表指标的 computeBss 逐根一致（5 分钟、15 分钟；含缺成交额的 K 线）', () => {
    expect(BUILTIN_FEATURES.map(d => d.id).slice(0, 2)).toEqual([DRIFT_SPEED_DEF.id, BSS_DEF.id]);
    expect(formulaVariables(BSS_FORMULA)).toEqual({ names: ['n', 'M', 'V', 'A', 'Mz', 'Vz', 'Vd', 'BSS'], result: 'BSS' });
    const compiled = compileFeatureFormula(BSS_FORMULA);
    for (const [barMs, missingEvery] of [[BAR_MS, 0], [BAR_MS, 37], [3 * BAR_MS, 0]] as const) {
      const b = bars(576, 11, barMs, missingEvery);
      const ref = computeBss(b, barMs / 60_000, { recentHours: 1, normHours: 24 });
      const { value, vars } = computeFeatureValues(windowOf(b, barMs), compiled, { interval: barMs === BAR_MS ? '5m' : '15m', avgHours: 24 });
      expect(value).not.toBeNull();
      expect(value!).toBeCloseTo(ref.at(-1)!.bss!, 10);
      expect(vars.M!).toBeCloseTo(ref.at(-1)!.m!, 12);
      expect(vars.V!).toBeCloseTo(ref.at(-1)!.v!, 12);
      expect(vars.A!).toBeCloseTo(ref.at(-1)!.a!, 12);
    }
    // 标准化窗口跟着平均时长 avgh 走
    const b = bars(576, 12);
    const v12 = computeFeatureValues(windowOf(b), compiled, { avgHours: 12 }).value!;
    expect(v12).toBeCloseTo(computeBss(b, 5, { normHours: 12 }).at(-1)!.bss!, 10);
    expect(BSS_DEFAULTS).toEqual({ recentHours: 1, normHours: 24 });
  });

  it('公式函数 ago / zscore：按时长换算根数', () => {
    const x = Float64Array.from([1, 2, 3, 4, 5, 6]);
    const run = (src: string, barMinutes: number) => evaluateProgram(parseFormula(src, new Set(['x'])), { x }, { barMinutes }) as Float64Array;
    expect(Array.from(run('ago(x, 0.5)', 15))).toEqual([Number.NaN, Number.NaN, 1, 2, 3, 4]);
    expect(Array.from(run('ago(x, 1)', 60))).toEqual([Number.NaN, 1, 2, 3, 4, 5]);
    expect(Array.from(run('zscore(x, 1)', 30)).map(v => (Number.isNaN(v) ? null : Number(v.toFixed(6))))).toEqual([null, 0.707107, 0.707107, 0.707107, 0.707107, 0.707107]);
    expect(() => run('zscore(x, 0)', 5)).toThrow('zscore 的时长要大于 0');
  });

  it('【用户要求】涨时放量加分、缩量扣分；跌时放量扣分、缩量不加分；没涨没跌这一项为 0', () => {
    // 1 小时一根，窗口 3 根：前两根平量，第三根放量 / 缩量，分别配上涨 / 下跌 / 不动
    const run = (q3: number, c3: number) => computeBss([
      { close: 100, quoteVolume: 100, takerBuyQuoteVolume: 50 },
      { close: 100, quoteVolume: 110, takerBuyQuoteVolume: 55 },
      { close: c3, quoteVolume: q3, takerBuyQuoteVolume: q3 / 2 },
    ], 60, { recentHours: 1, normHours: 3 })[2];
    const upBig = run(400, 105);
    const downBig = run(400, 95);
    const upSmall = run(20, 105);
    const downSmall = run(20, 95);
    const flatBig = run(400, 100);
    expect(upBig.vz!).toBeGreaterThan(0);
    expect(upBig.vd!).toBeCloseTo(upBig.vz!, 12);
    expect(downBig.vd!).toBeCloseTo(-downBig.vz!, 12);
    expect(downBig.vd!).toBeLessThan(0);
    expect(upSmall.vz!).toBeLessThan(0);
    expect(upSmall.vd!).toBeLessThan(0); // 缩量上涨扣分
    expect(downSmall.vz!).toBeLessThan(0);
    expect(downSmall.vd).toBe(0); // 缩量下跌不加分
    expect(flatBig.vd).toBe(0);
    expect(downSmall.bss).toBeCloseTo(0.45 * downSmall.mz! + 0.3 * downSmall.a!, 12);
  });

  it('用户存过的 BSS 定义（自己加了行）：两种旧写法都换成现在的 V 方向分，其余行原样；别的特征值不动', async () => {
    const { mergeFeatureDefs, upgradeBssFormula } = await import('@/lib/deepDig/features');
    const body = BSS_FORMULA.split('\n').slice(1).filter(l => !l.startsWith('Vd ='));
    // 最早：不分方向
    const old = [
      '# BSS = 0.45·M标准化 + 0.25·V标准化 + 0.30·A，−1 ~ 1；订单簿 I 没有历史数据，去掉',
      ...body.map(l => (l.startsWith('BSS =') ? 'BSS = 0.45 * Mz + 0.25 * Vz + 0.30 * A' : l)),
      'avg_BSS = avg(BSS, 24)',
    ].join('\n');
    // 第一版方向分：Vd = sign(M) * Vz
    const signVersion = [
      '# BSS = 0.45·M标准化 + 0.25·sign(M)·V标准化 + 0.30·A，−1 ~ 1；订单簿 I 没有历史数据，去掉',
      ...body.flatMap(l => (l.startsWith('BSS =') ? ['Vd = sign(M) * Vz                       # 放量随价格方向加减分：涨时放量加分、缩量扣分；跌时放量扣分、缩量加分', l] : [l])),
      'avg_BSS = avg(BSS, 24)',
    ].join('\n');
    for (const f of [old, signVersion]) {
      const merged = mergeFeatureDefs([{ ...BSS_DEF, builtin: undefined, formula: f }]).find(d => d.id === 'bss')!;
      expect(merged.formula).toBe(`${BSS_FORMULA}\navg_BSS = avg(BSS, 24)`);
      expect(formulaVariables(merged.formula).result).toBe('avg_BSS');
    }
    // 已是新写法、或不是 BSS：原样
    expect(upgradeBssFormula({ id: 'bss', formula: BSS_FORMULA }).formula).toBe(BSS_FORMULA);
    expect(upgradeBssFormula({ id: 'other', formula: old }).formula).toBe(old);
  });
});
