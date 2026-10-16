import { describe, expect, it } from 'vitest';
import { evaluateProgram, lastValue, parseFormula } from '@/lib/deepDig/formula';
import { compileFeatureFormula, computeFeatureValue, DRIFT_SPEED_FORMULA } from '@/lib/deepDig/features';
import { computeDspFeatures } from '@/lib/deepRsa/dspFeatures';
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

  it('内置「漂移速度 V」的默认公式与主图 DSP 指标的 V 一致（含缺金额的 K 线）', () => {
    const compiled = compileFeatureFormula(DRIFT_SPEED_FORMULA);
    expect(compiled.usesAmounts).toBe(true);
    for (const [seed, missingEvery] of [[1, 0], [2, 40], [3, 97]] as const) {
      const w = window(576, seed, missingEvery);
      const ref = computeDspFeatures(w, 6).dsp_v!;
      expect(ref).not.toBeNull();
      expect(computeFeatureValue(w, compiled)).toBeCloseTo(ref, 12);
    }
  });

  it('用到成交额的公式：有金额的 K 线不到 95% 记缺失；不用成交额的公式照算', () => {
    const w = window(200, 4, 10); // 每 10 根缺 1 根 → 90%
    expect(computeFeatureValue(w, compileFeatureFormula('ema(B - S, 6)'))).toBeNull();
    const c = computeFeatureValue(w, compileFeatureFormula('ln(C / prev(C, 12))'));
    expect(c).toBeCloseTo(Math.log(w.bars[199].close / w.bars[187].close), 12);
  });
});
