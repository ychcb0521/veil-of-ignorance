import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KLineData } from 'klinecharts';

const registered = vi.hoisted(() => new Map<string, {
  calcParams: number[];
  calc: (d: KLineData[], ind: { calcParams: number[] }) => Record<string, number>[];
  createTooltipDataSource?: (p: unknown) => { name: string; calcParamsText: string; values: { title: { text: string }; value: { text: string } }[] };
}>());
vi.mock('klinecharts', () => ({ registerIndicator: (def: { name: string }) => { registered.set(def.name, def as never); } }));

import { computeDsp, DSP_VZ_DISPLAY_SCALE } from '@/lib/dynamicSchellingPoint';
import { dspPoints, indicatorCalcParams, registerCustomIndicators, unifiedDspA } from '@/lib/customIndicators';
import { evaluateProgram, parseFormula, rollingSd } from '@/lib/deepDig/formula';
import { BUILTIN_FEATURES, compileFeatureFormula, computeFeatureValue, DRIFT_SPEED_Z_DEF, DRIFT_SPEED_Z_FORMULA, formulaVariables } from '@/lib/deepDig/features';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { BAR_MS, type ResearchBar } from '@/lib/deepRsa/window';
import { IndicatorMenu } from '@/components/IndicatorMenu';
import type { IndicatorConfig } from '@/components/CandlestickChart';

/** 合成 5 分钟 K 线；vol = 每根涨跌的幅度（波动大小），其余（成交额、主动买入）完全相同。 */
function bars(n: number, seed: number, vol: number, missingEvery = 0): ResearchBar[] {
  const rand = mulberry32(seed);
  let close = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = close;
    close = open * Math.exp(vol * (rand() - 0.45));
    const q = 2e5 * (0.3 + rand());
    const missing = missingEvery > 0 && i % missingEvery === 3;
    return {
      openTime: i * BAR_MS, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: q / close,
      takerBuyVolume: null, quoteVolume: missing ? null : q, takerBuyQuoteVolume: missing ? null : q * rand(),
    };
  });
}
const dspInput = (b: ResearchBar[]) => b.map(x => ({ time: x.openTime, close: x.close, quoteVolume: x.quoteVolume, takerBuyQuoteVolume: x.takerBuyQuoteVolume }));
const windowOf = (b: ResearchBar[]) => ({ anchorMs: b.length * BAR_MS, aligned: true, bars: b, expectedBars: b.length, missingBars: 0, coverage: 1, missingTakerBars: 0 });

describe('【用户要求】动态谢林点 Z 分数版 az：只把涨跌 R 除以它过去 24 小时的标准差', () => {
  it('az = 同一个 ρ 平滑 f·G·(R ÷ σ)；原始 a、DSP 线不受影响；没开时不算', () => {
    const b = dspInput(bars(600, 1, 0.006));
    const raw = computeDsp(b, { halfLifeHours: 6 }, BAR_MS);
    const z = computeDsp(b, { halfLifeHours: 6, zWindowHours: 24 }, BAR_MS);
    expect(raw[10].vz).toBeUndefined();
    expect(z.map(p => p.v)).toEqual(raw.map(p => p.v));
    expect(z.map(p => p.dsp)).toEqual(raw.map(p => p.dsp));
    // 手算：R 一列 → 滚动样本标准差（288 根）→ 递推
    const r = Float64Array.from(b, (x, i) => (i === 0 ? Number.NaN : Math.log(x.close / b[i - 1].close)));
    const sd = rollingSd(r, 288);
    const rho = 2 ** (-5 / 360);
    let vz = 0;
    z.forEach((p, i) => {
      const rz = Number.isFinite(r[i]) && sd[i] > 0 ? r[i] / sd[i] : 0;
      vz = rho * vz + (1 - rho) * p.f * p.g * rz;
      expect(p.vz).toBeCloseTo(vz, 14);
    });
  });

  it('波动放大 3 倍（成交、主动买卖不变）：原始 a 跟着变大约 3 倍，az 几乎不变——不同币的波动大小不再左右读数', () => {
    const calm = computeDsp(dspInput(bars(800, 2, 0.004)), { halfLifeHours: 6, zWindowHours: 24 }, BAR_MS).at(-1)!;
    const wild = computeDsp(dspInput(bars(800, 2, 0.012)), { halfLifeHours: 6, zWindowHours: 24 }, BAR_MS).at(-1)!;
    expect(wild.v! / calm.v!).toBeGreaterThan(2.5);
    expect(wild.vz!).toBeCloseTo(calm.vz!, 6);
  });

  it('Deep dig 第三个内置特征值 az；把 f 换成 ema(Q, hl) 就与主图逐根一致（含缺金额的 K 线）', () => {
    expect(BUILTIN_FEATURES.map(d => d.id)).toContain(DRIFT_SPEED_Z_DEF.id);
    expect(formulaVariables(DRIFT_SPEED_Z_FORMULA)).toEqual({ names: ['N', 'f', 'A', 'G', 'R', 'Rz', 'F', 'az'], result: 'az' });
    const emaVersion = compileFeatureFormula(DRIFT_SPEED_Z_FORMULA.replace('f = ln(1 + N / avg(Q, avgh))', 'f = ln(1 + N / ema(Q, hl))'));
    for (const missingEvery of [0, 37]) {
      const b = bars(576, 3, 0.006, missingEvery);
      const ref = computeDsp(dspInput(b), { halfLifeHours: 6, zWindowHours: 24 }, BAR_MS).at(-1)!.vz!;
      expect(computeFeatureValue(windowOf(b), emaVersion, { halfLifeHours: 6, avgHours: 24 })).toBeCloseTo(ref, 12);
    }
    // 默认公式（过去 avgh 小时平均成交额）能算出来
    expect(computeFeatureValue(windowOf(bars(576, 4, 0.006)), compileFeatureFormula(DRIFT_SPEED_Z_FORMULA))).not.toBeNull();
    // sd(x, h)：过去 h 小时（按 K 线周期换算根数）的样本标准差
    const sd = evaluateProgram(parseFormula('sd(x, 0.25)', new Set(['x'])), { x: Float64Array.from([1, 2, 4, 8]) }, { barMinutes: 5 }) as Float64Array;
    expect(Number.isNaN(sd[0])).toBe(true);
    expect(sd[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(sd[3]).toBeCloseTo(Math.sqrt(((2 - 14 / 3) ** 2 + (4 - 14 / 3) ** 2 + (8 - 14 / 3) ** 2) / 2), 12);
  });
});

describe('【用户要求】K 线图：动态谢林点的「Z」开关', () => {
  registerCustomIndicators();
  const k: KLineData[] = bars(600, 5, 0.006).map(b => ({ timestamp: b.openTime, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume, turnover: b.quoteVolume!, takerBuyTurnover: b.takerBuyQuoteVolume } as KLineData));

  it('开关在参数最后一位：a / avg_a 副图换成 az（× 100，% 标准差 / 根）；图例名字跟着换，括号里不写开关', () => {
    expect(indicatorCalcParams('DSP_V_CUSTOM', { period: 6, zscore: true })).toEqual([6, 1, expect.any(Number), expect.any(Number)]);
    expect(indicatorCalcParams('DSP_V_AVG_CUSTOM', { period: 6, avgHours: 12, zscore: true })).toEqual([6, 12, 1, expect.any(Number), expect.any(Number)]);
    expect(indicatorCalcParams('DSP_A_CUSTOM', { period: 6, zscore: true })).toEqual([6]);
    const a = registered.get('DSP_V_CUSTOM')!;
    // 【用户要求】2026-10-19 公式统一：a / az 副图按 Deep dig 的公式算（与 DSP·a / DSP·az 特征值同一份定义）
    const out = a.calc(k, { calcParams: [6, 1] });
    expect(out[500].v).toBeCloseTo(unifiedDspA(k, 6, true)[500]!, 10);
    expect(a.calc(k, { calcParams: [6, 0] })[500].v).toBeCloseTo(unifiedDspA(k, 6, false)[500]!, 10);
    const tip = (name: string, calcParams: number[], result: Record<string, number>[]) => registered.get(name)!.createTooltipDataSource!({
      indicator: { calcParams, result, precision: 3 }, crosshair: { dataIndex: 500 }, defaultStyles: { tooltip: { icons: [], defaultValue: 'n/a' } },
    });
    const t = tip('DSP_V_CUSTOM', [6, 1], out);
    expect([t.name, t.calcParamsText, t.values[0].title.text, t.values[0].value.text]).toEqual(['DSP·az', '(6)', 'az(归一化×100): ', out[500].v.toFixed(3)]);
    expect(tip('DSP_V_CUSTOM', [6, 0], out).name).toBe('DSP·a');
    const avg = registered.get('DSP_V_AVG_CUSTOM')!;
    const t2 = tip('DSP_V_AVG_CUSTOM', [6, 24, 1], avg.calc(k, { calcParams: [6, 24, 1] }));
    expect([t2.name, t2.calcParamsText, t2.values[0].title.text]).toEqual(['avg_az', '(6)', 'avg_az(归一化×100): ']);
  });

  it('菜单：DSP 开着时有「Z」开关，点一下切换；自制普通版独立读取普通公式', () => {
    const onChange = vi.fn();
    const indicators: IndicatorConfig[] = [{ type: 'DSP', period: 6, avgHours: 24, enabled: true }];
    const { rerender } = render(<IndicatorMenu open indicators={indicators} onIndicatorsChange={onChange} onClose={() => {}} />);
    const z = screen.getByLabelText('动态谢林点 DSP（含 a / A 副图） 用波动率归一化版');
    expect(z).toHaveAttribute('aria-pressed', 'false');
    expect(z.getAttribute('title')).toContain('R / sd(R)');
    fireEvent.click(z);
    expect(onChange).toHaveBeenLastCalledWith([{ type: 'DSP', period: 6, avgHours: 24, zscore: true, enabled: true }]);
    rerender(<IndicatorMenu open indicators={[{ type: 'DSP', period: 6, avgHours: 24, zscore: true, enabled: true }]} onIndicatorsChange={onChange} onClose={() => {}} />);
    expect(screen.getByLabelText('动态谢林点 DSP（含 a / A 副图） 用波动率归一化版')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByText('买方推力漂移速度 DSP·az（波动率归一化）'));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ type: 'DSP', period: 6, zscore: true }), expect.objectContaining({ type: 'DSP_Z', period: 6 })]);
    // BSS 没有这个开关
    expect(screen.queryByLabelText(/买卖强度综合分 BSS 用波动率归一化版/)).not.toBeInTheDocument();
  });
});
