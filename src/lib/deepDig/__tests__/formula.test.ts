import { describe, expect, it } from 'vitest';
import { evaluateProgram, lastValue, parseFormula } from '@/lib/deepDig/formula';
import { compileFeatureFormula, computeFeatureValue, computeFeatureValues, DRIFT_SPEED_FORMULA, EMA_DRIFT_SPEED_FORMULA, formulaVariables } from '@/lib/deepDig/features';
import { computeDspFeatures } from '@/lib/deepRsa/dspFeatures';
import { computeDsp } from '@/lib/dynamicSchellingPoint';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { BAR_MS, type ObservationWindow, type ResearchBar } from '@/lib/deepRsa/window';

const S = (xs: number[]) => Float64Array.from(xs);
const run = (src: string, inputs: Record<string, number | Float64Array> = {}) =>
  evaluateProgram(parseFormula(src, new Set(Object.keys(inputs))), inputs);

function window(n: number, seed: number, missingEvery = 0): ObservationWindow {
  const rand = mulberry32(seed);
  let close = 100;
  const bars: ResearchBar[] = Array.from({ length: n }, (_, i) => {
    const open = close;
    close = open * Math.exp(0.004 * (rand() - 0.5));
    const q = 2e5 * (0.3 + rand());
    const missing = missingEvery > 0 && i % missingEvery === 3;
    return {
      openTime: i * BAR_MS, open, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * 0.999, close, volume: q / close,
      takerBuyVolume: null, quoteVolume: missing ? null : q, takerBuyQuoteVolume: missing ? null : q * rand(),
    };
  });
  return { anchorMs: n * BAR_MS, aligned: true, bars, expectedBars: n, missingBars: 0, coverage: 1, missingTakerBars: 0 };
}

describe('【用户要求】Deep dig 公式：按用户写的公式提取特征值', () => {
  it('四则、乘方、比较、and / or / not、括号；× ÷ − 也认；# 是注释', () => {
    expect(run('1 + 2 * 3 ^ 2')).toBe(19);
    expect(run('(1 + 2) × 3 ÷ 2 − 1  # 注释')).toBe(3.5);
    expect(run('-2 ^ 2')).toBe(-4);
    expect(run('3 > 2 and not (1 > 2) or 0')).toBe(1);
    expect(run('a = 2\nb = a * 5; b + 1')).toBe(11);
  });

  it('序列逐根运算；prev / ema / sma / sum / nz / if / max / min', () => {
    const x = S([1, 2, 3, 4]);
    expect([...(run('x * 2 + 1', { x }) as Float64Array)]).toEqual([3, 5, 7, 9]);
    expect([...(run('nz(prev(x))', { x }) as Float64Array)]).toEqual([0, 1, 2, 3]);
    expect([...(run('sum(x, 2)', { x }) as Float64Array)].map(v => (Number.isNaN(v) ? null : v))).toEqual([null, 3, 5, 7]);
    expect([...(run('if(x > 2, x, 0)', { x }) as Float64Array)]).toEqual([0, 0, 3, 4]);
    expect([...(run('max(x, 2.5)', { x }) as Float64Array)]).toEqual([2.5, 2.5, 3, 4]);
    const rho = 2 ** (-5 / 60);
    const e = run('ema(x, 1)', { x: S([10, Number.NaN, 20]) }) as Float64Array;
    expect(e[0]).toBe(10);
    expect(e[1]).toBe(10); // 空的那根跳过
    expect(e[2]).toBeCloseTo(rho * 10 + (1 - rho) * 20, 12);
    expect((run('ema(x, 1, 0)', { x: S([10]) }) as Float64Array)[0]).toBeCloseTo((1 - rho) * 10, 12);
    expect(lastValue(run('ln(0 - 1)'))).toBeNull();
  });

  it('写错时说清楚第几行、哪里不对', () => {
    const err = (src: string, known: string[] = ['C']) => { try { parseFormula(src, new Set(known)); return ''; } catch (e) { return (e as Error).message; } };
    expect(err('A = C\nZ + 1')).toMatch(/^第 2 行：不认识「Z」/);
    expect(err('foo(C)')).toContain('没有「foo」这个函数');
    expect(err('ema(C)')).toContain('参数个数不对');
    expect(err('C = = 1')).toMatch(/^第 1 行/);
    expect(err('C = 1')).toBe(''); // 允许给序列另起同名中间量
    expect(err('a = 1\nC 2')).toMatch(/^第 2 行：式子没写完整/);
    expect(err('')).toContain('还没写公式');
    expect(err('b = 1', ['b'])).toBe('');
    expect(err('C > 1 = 2')).toMatch(/「=」|==/);
  });

  it('「平时成交额」用 ema(Q, hl) 的那版公式（上一版默认）与主图 DSP 指标的 V 一致（含缺金额的 K 线）', () => {
    const compiled = compileFeatureFormula(EMA_DRIFT_SPEED_FORMULA);
    expect(compiled.usesAmounts).toBe(true);
    for (const [seed, missingEvery] of [[1, 0], [2, 40], [3, 97]] as const) {
      const w = window(576, seed, missingEvery);
      const ref = computeDspFeatures(w, 6).dsp_v!;
      expect(ref).not.toBeNull();
      expect(computeFeatureValue(w, compiled)).toBeCloseTo(ref, 12);
    }
  });

  it('【用户要求】周期、半衰期可选：15 分钟线 + 半衰期 2 / 6 小时，ema 版公式与主图 DSP 按同一周期、同一半衰期算出的 V 一致', () => {
    const compiled = compileFeatureFormula(EMA_DRIFT_SPEED_FORMULA);
    const M15 = 15 * 60_000;
    const w = window(400, 7, 0);
    const bars15 = w.bars.map((b, i) => ({ ...b, openTime: i * M15 }));
    const w15 = { ...w, bars: bars15 };
    const dspInput = bars15.map(b => ({ time: b.openTime, close: b.close, quoteVolume: b.quoteVolume ?? null, takerBuyQuoteVolume: b.takerBuyQuoteVolume ?? null }));
    for (const hl of [2, 6]) {
      const ref = computeDsp(dspInput, { halfLifeHours: hl }, M15).at(-1)!.v!;
      expect(computeFeatureValue(w15, compiled, { interval: '15m', halfLifeHours: hl })).toBeCloseTo(ref, 12);
    }
    // 不同周期 / 半衰期确实不同
    expect(computeFeatureValue(w15, compiled, { interval: '15m', halfLifeHours: 2 })).not.toBeCloseTo(computeFeatureValue(w15, compiled, { interval: '15m', halfLifeHours: 6 })!, 8);
    // ema 按周期换算：15 分钟、半衰期 1 小时 → ρ = 2^(−15/60)
    const e = run('ema(x, 1)', { x: S([10, 20]) }) as Float64Array;
    const e15 = evaluateProgram(parseFormula('ema(x, 1)', new Set(['x'])), { x: S([10, 20]) }, { barMinutes: 15 }) as Float64Array;
    expect(e15[1]).toBeCloseTo(2 ** (-15 / 60) * 10 + (1 - 2 ** (-15 / 60)) * 20, 12);
    expect(e[1]).not.toBeCloseTo(e15[1], 6);
    // 观察窗 K 线不足 95% 不算
    expect(computeFeatureValue({ ...w15, coverage: 0.9 }, compiled, { interval: '15m' })).toBeNull();
  });

  it('【用户要求】avg(x, h)：过去 h 小时的平均，按周期换算根数；空值跳过；开头不满用已有的', () => {
    const x = S([1, 2, Number.NaN, 4, 5]);
    // 5 分钟线，0.25 小时 = 3 根
    expect(Array.from(run('avg(x, 0.25)', { x }) as Float64Array)).toEqual([1, 1.5, 1.5, 3, 4.5]);
    // 15 分钟线，0.25 小时 = 1 根
    const a15 = evaluateProgram(parseFormula('avg(x, 0.25)', new Set(['x'])), { x }, { barMinutes: 15 }) as Float64Array;
    expect(Array.from(a15)).toEqual([1, 2, Number.NaN, 4, 5]);
    expect(() => run('avg(x, 0)', { x })).toThrow('avg 的时长要大于 0');
  });

  it('【用户要求】默认公式：平时成交额 = 过去 avgh 小时（默认 24）的平均成交额；avgh 可点选、也可在公式里直接写数字', () => {
    const compiled = compileFeatureFormula(DRIFT_SPEED_FORMULA);
    const w = window(576, 5, 41);
    // 独立的逐根参考实现
    const ref = (avgH: number, hl: number) => {
      const n = (avgH * 60) / 5;
      const rho = 2 ** (-5 / (hl * 60));
      let v = 0;
      w.bars.forEach((b, i) => {
        const past = w.bars.slice(Math.max(0, i - n + 1), i + 1).map(p => p.quoteVolume).filter((q): q is number => q != null);
        const mean = past.reduce((a, q) => a + q, 0) / past.length;
        const q = b.quoteVolume; const buy = b.takerBuyQuoteVolume;
        const u = i === 0 || q == null || buy == null ? 0 : Math.log(1 + Math.abs(2 * buy - q) / mean) * (1 + Math.max((2 * buy - q) / q, 0)) * Math.log(b.close / w.bars[i - 1].close);
        v = rho * v + (1 - rho) * (Number.isFinite(u) ? u : 0);
      });
      return v;
    };
    expect(computeFeatureValue(w, compiled)).toBeCloseTo(ref(24, 6), 12);
    expect(computeFeatureValue(w, compiled, { avgHours: 12 })).toBeCloseTo(ref(12, 6), 12);
    expect(computeFeatureValue(w, compiled, { avgHours: 12 })).not.toBeCloseTo(ref(24, 6), 9);
    // 在公式里直接写 12，与点选 12 小时一样
    const literal = compileFeatureFormula(DRIFT_SPEED_FORMULA.replace('avg(Q, avgh)', 'avg(Q, 12)'));
    expect(computeFeatureValue(w, literal)).toBeCloseTo(ref(12, 6), 12);
    // 中文写法
    const zh = compileFeatureFormula(DRIFT_SPEED_FORMULA.replace('avg(Q, avgh)', 'avg(Q, 平均时长)'));
    expect(computeFeatureValue(w, zh, { avgHours: 12 })).toBeCloseTo(ref(12, 6), 12);
  });

  it('【用户要求】公式里起了名的变量都带回最后一根的值（推断统计选因变量用）', () => {
    const w = window(576, 6, 0);
    const compiled = compileFeatureFormula(DRIFT_SPEED_FORMULA + '\naa = avg(a, 24)');
    const { value, vars } = computeFeatureValues(w, compiled);
    expect(Object.keys(vars)).toEqual(['N', 'f', 'A', 'G', 'R', 'F', 'a', 'aa']);
    expect(vars.aa).toBe(value);
    expect(vars.a).toBeCloseTo(computeFeatureValue(w, compileFeatureFormula(DRIFT_SPEED_FORMULA))!, 15);
    expect(vars.aa).not.toBeCloseTo(vars.a!, 12);
    // 观察窗不合格：每个变量都是 null
    expect(computeFeatureValues(null, compiled).vars).toEqual(Object.fromEntries(['N', 'f', 'A', 'G', 'R', 'F', 'a', 'aa'].map(n => [n, null])));
    expect(formulaVariables(DRIFT_SPEED_FORMULA + '\naa = avg(a, 24)')).toEqual({ names: ['N', 'f', 'A', 'G', 'R', 'F', 'a', 'aa'], result: 'aa' });
    // 最后一句没起名：多一个「结果」
    expect(formulaVariables('R = ln(C / prev(C))\nR * 100')).toEqual({ names: ['R', '结果'], result: '结果' });
  });

  it('用到成交额的公式：有金额的 K 线不到 95% 记缺失；不用成交额的公式照算', () => {
    const w = window(200, 4, 10); // 每 10 根缺 1 根 → 90%
    expect(computeFeatureValue(w, compileFeatureFormula('ema(B - S, 6)'))).toBeNull();
    const c = computeFeatureValue(w, compileFeatureFormula('ln(C / prev(C, 12))'));
    expect(c).toBeCloseTo(Math.log(w.bars[199].close / w.bars[187].close), 12);
  });
});
