import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KLineData } from 'klinecharts';

const registered = vi.hoisted(() => new Map<string, { calcParams: number[]; figures: { key: string; title: string }[]; calc: (d: KLineData[], ind: { calcParams: number[] }) => Record<string, number>[] }>());
vi.mock('klinecharts', () => ({
  registerIndicator: (def: { name: string }) => { registered.set(def.name, def as never); },
}));

import { AVG_DEFAULT_HOURS, bssPoints, INDICATOR_COMPANIONS, dspPoints, indicatorCalcParams, registerCustomIndicators, rollingAvgHours, unifiedDspA } from '@/lib/customIndicators';
import { DSP_V_DISPLAY_SCALE } from '@/lib/dynamicSchellingPoint';
import { BSS_DEF, FEATURES_KEY, BSS_FORMULA, compileFeatureFormula, computeFeatureValues } from '@/lib/deepDig/features';
import { BAR_MS, type ResearchBar } from '@/lib/deepRsa/window';
import { IndicatorMenu } from '@/components/IndicatorMenu';
import type { IndicatorConfig } from '@/components/CandlestickChart';

beforeEach(() => localStorage.clear());
const BAR = 5 * 60_000;
function klines(n: number, barMs = BAR): KLineData[] {
  let close = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = close;
    close = open * (1 + 0.003 * Math.sin(i / 5) + 0.001 * Math.cos(i / 3));
    const turnover = 1e5 * (1.5 + Math.sin(i / 7));
    return { timestamp: i * barMs, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: turnover / close, turnover, takerBuyTurnover: turnover * (0.5 + 0.3 * Math.sin(i / 11)) } as KLineData;
  });
}
/** 手算：过去 bars 根（含当根）有值的平均。 */
const manualAvg = (xs: (number | null)[], i: number, bars: number) => {
  const w = xs.slice(Math.max(0, i - bars + 1), i + 1).filter((v): v is number => v != null);
  return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
};

describe('【用户要求】均线副图 avg_BSS = avg(BSS, N)、avg_a = avg(a, N)：各自独立一个副图，N 默认 24、可调', () => {
  registerCustomIndicators();
  const k = klines(700);

  it('【用户要求】不与原指标叠在一起：BSS、a 副图只有自己一条线；均线各是一个独立副图', () => {
    expect(registered.get('BSS_CUSTOM')!.figures.map(f => f.title)).toEqual(['BSS: ']);
    expect(registered.get('BSS_CUSTOM')!.calcParams).toEqual([1]);
    expect(registered.get('DSP_V_CUSTOM')!.figures.map(f => f.title)).toEqual(['a(基点/根): ']);
    expect(registered.get('DSP_V_CUSTOM')!.calcParams).toEqual([6, 0]);
    expect(registered.get('BSS_AVG_CUSTOM')!.figures.map(f => f.title)).toEqual(['avg_BSS: ']);
    expect(registered.get('DSP_V_AVG_CUSTOM')!.figures.map(f => f.title)).toEqual(['avg_a(基点/根): ']);
  });

  it('avg_BSS 副图：逐根 = 过去 N 小时 BSS 的平均（5 分钟图 24 小时 = 288 根）；在 Deep dig 改成 6 跟着变', () => {
    const def = registered.get('BSS_AVG_CUSTOM')!;
    expect(def.calcParams).toEqual([1, AVG_DEFAULT_HOURS, 0, 0, 0]);
    const bss = bssPoints(k, 1).map(p => p.bss);
    const out = def.calc(k, { calcParams: [1, 24] });
    // 开头还没有 BSS 的几根：空着
    expect(bss[0]).toBeNull();
    expect(out[0].bss).toBeUndefined();
    for (const i of [20, 287, 288, 500, 699]) expect(out[i].bss).toBeCloseTo(manualAvg(bss, i, 288)!, 12);
    localStorage.setItem('sim_anon_' + FEATURES_KEY, JSON.stringify([{ ...BSS_DEF, formula: BSS_FORMULA + '\navg_BSS = avg(BSS, 6)' }]));
    const out6 = def.calc(k, { calcParams: [1, 24] });
    localStorage.clear();
    expect(out6[699].bss).toBeCloseTo(manualAvg(bss, 699, 72)!, 12);
    expect(out6[699].bss).not.toBeCloseTo(out[699].bss, 6);
    // 与 Deep dig 公式 avg(BSS, avgh) 同一份实现
    const bars: ResearchBar[] = k.map(d => ({ openTime: d.timestamp, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume!, takerBuyVolume: null, quoteVolume: d.turnover!, takerBuyQuoteVolume: d.takerBuyTurnover as number }));
    const window = { anchorMs: bars.length * BAR_MS, aligned: true, bars, expectedBars: bars.length, missingBars: 0, coverage: 1, missingTakerBars: 0 };
    const { vars } = computeFeatureValues(window, compileFeatureFormula(`${BSS_FORMULA}\nX = avg(BSS, avgh)`), { interval: '5m', avgHours: 24 });
    expect(vars.X!).toBeCloseTo(out[699].bss, 10);
  });

  it('avg_a 副图：单位与 a 相同（基点 / 根）；1 小时图上每根窗口根数与 5 分钟图相同', () => {
    const def = registered.get('DSP_V_AVG_CUSTOM')!;
    expect(def.calcParams).toEqual([6, AVG_DEFAULT_HOURS, 0, 0, 0]);
    // 【用户要求】2026-10-19 公式统一：a 按 Deep dig 的公式（成交额基线 avg(Q, avgh)），不再是图上自己的 ema(Q, hl)
    const a = unifiedDspA(k, 6, false);
    const out = def.calc(k, { calcParams: [6, 24] });
    for (const i of [1, 300, 699]) expect(out[i].v).toBeCloseTo(manualAvg(a, i, 288)!, 12);
    const out1h = def.calc(klines(700, 12 * BAR), { calcParams: [6, 24] });
    expect(out1h[699].v).toBeCloseTo(out[699].v, 10);
  });

  it('参数：两个均线副图多传一个 N（老设置没有 → 24），其他指标不变；空值跳过', () => {
    expect(indicatorCalcParams('BSS_AVG_CUSTOM', { period: 2 })).toEqual([2, 24, expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(indicatorCalcParams('DSP_V_AVG_CUSTOM', { period: 6, avgHours: 48 })).toEqual([6, 48, 0, expect.any(Number), expect.any(Number)]);
    expect(indicatorCalcParams('BSS_CUSTOM', { period: 2, avgHours: 48 })).toEqual([2, expect.any(Number), expect.any(Number)]);
    expect(indicatorCalcParams('DSP_V_CUSTOM', { period: 6, avgHours: 48 })).toEqual([6, 0, expect.any(Number), expect.any(Number)]);
    expect(indicatorCalcParams('DSP_A_CUSTOM', { period: 6, avgHours: 48 })).toEqual([6]);
    expect(indicatorCalcParams('BSS_AVG_CUSTOM', { period: 1, avgHours: 0 })).toEqual([1, 24, expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(rollingAvgHours([1, null, 3, 5], 1 / 6)).toEqual([1, 1, 3, 4]);
  });

  it('菜单：自制 BSS 均值跟随 Deep dig；保留主图 DSP 的均线时长框', () => {
    const onChange = vi.fn();
    const indicators: IndicatorConfig[] = [{ type: 'BSS', period: 1, enabled: true }, { type: 'DSP', period: 6, avgHours: 12, enabled: true }];
    render(<IndicatorMenu open indicators={indicators} onIndicatorsChange={onChange} onClose={() => {}} />);
    expect(screen.getByLabelText('BSS 均线时长 N（小时）')).toHaveValue(24);
    const avg = screen.getByLabelText('动态谢林点 DSP（含 a / A 副图） 均线时长 N（小时）') as HTMLInputElement;
    expect(avg.value).toBe('12');
    fireEvent.change(avg, { target: { value: '' } }); expect(avg.value).toBe('');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(avg, { target: { value: '48' } });
    expect(onChange).toHaveBeenLastCalledWith([indicators[0], { ...indicators[1], avgHours: 48 }]);
    expect(screen.queryAllByLabelText(/均线时长/)).toHaveLength(2);
  });

  it('新开 BSS：默认近期窗口为 12 小时', () => {
    const onChange = vi.fn();
    render(<IndicatorMenu open indicators={[]} onIndicatorsChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByText('BSS', { exact: true }));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ type: 'BSS', period: 12 })]);
  });
});

describe('【用户要求】均线副图紧挨在原指标正下方（附属副图按顺序依次往下建）', () => {
  it('DSP：a → avg_a → A；BSS：主副图之后是 avg_BSS', () => {
    expect(INDICATOR_COMPANIONS.DSP.map(c => c.kcName)).toEqual(['DSP_V_CUSTOM', 'DSP_OVERLAY_AVG_CUSTOM', 'DSP_A_CUSTOM']);
    expect(INDICATOR_COMPANIONS.DSP_VA.map(c => c.kcName)).toEqual(['DSP_V_CUSTOM', 'DSP_V_AVG_CUSTOM', 'DSP_V_AVG2_CUSTOM']);
    expect(INDICATOR_COMPANIONS.BSS.map(c => c.kcName)).toEqual(['BSS_AVG_CUSTOM', 'BSS_AVG2_CUSTOM']);
  });
});
