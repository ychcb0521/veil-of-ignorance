import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KLineData } from 'klinecharts';

const registered = vi.hoisted(() => new Map<string, { calcParams: number[]; figures: { key: string; title: string }[]; calc: (d: KLineData[], ind: { calcParams: number[] }) => Record<string, number>[] }>());
vi.mock('klinecharts', () => ({
  registerIndicator: (def: { name: string }) => { registered.set(def.name, def as never); },
}));

import { AVG_DEFAULT_HOURS, bssPoints, dspPoints, indicatorCalcParams, registerCustomIndicators, rollingAvgHours } from '@/lib/customIndicators';
import { DSP_V_DISPLAY_SCALE } from '@/lib/dynamicSchellingPoint';
import { BSS_FORMULA, compileFeatureFormula, computeFeatureValues } from '@/lib/deepDig/features';
import { BAR_MS, type ResearchBar } from '@/lib/deepRsa/window';
import { IndicatorMenu } from '@/components/IndicatorMenu';
import type { IndicatorConfig } from '@/components/CandlestickChart';

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

describe('【用户要求】副图均线 avg_BSS = avg(BSS, N)、avg_a = avg(a, N)，N 默认 24、可调', () => {
  registerCustomIndicators();
  const k = klines(700);

  it('BSS 副图多一条 avg_BSS：逐根 = 过去 N 小时 BSS 的平均（5 分钟图 24 小时 = 288 根）；N 改成 6 跟着变', () => {
    const def = registered.get('BSS_CUSTOM')!;
    expect(def.calcParams).toEqual([1, AVG_DEFAULT_HOURS]);
    expect(def.figures.map(f => f.title)).toEqual(['BSS: ', 'avg_BSS: ']);
    const bss = bssPoints(k, 1).map(p => p.bss);
    const out = def.calc(k, { calcParams: [1, 24] });
    // 开头还没有 BSS 的几根：两条线都空着
    expect(bss[0]).toBeNull();
    expect(out[0]).toEqual({});
    for (const i of [20, 287, 288, 500, 699]) {
      expect(out[i].bss).toBe(bss[i]!);
      expect(out[i].avg).toBeCloseTo(manualAvg(bss, i, 288)!, 12);
    }
    const out6 = def.calc(k, { calcParams: [1, 6] });
    expect(out6[699].avg).toBeCloseTo(manualAvg(bss, 699, 72)!, 12);
    expect(out6[699].avg).not.toBeCloseTo(out[699].avg, 6);
    // 与 Deep dig 公式 avg(BSS, avgh) 同一份实现
    const bars: ResearchBar[] = k.map(d => ({ openTime: d.timestamp, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume!, takerBuyVolume: null, quoteVolume: d.turnover!, takerBuyQuoteVolume: d.takerBuyTurnover as number }));
    const window = { anchorMs: bars.length * BAR_MS, aligned: true, bars, expectedBars: bars.length, missingBars: 0, coverage: 1, missingTakerBars: 0 };
    const { vars } = computeFeatureValues(window, compileFeatureFormula(`${BSS_FORMULA}\nX = avg(BSS, avgh)`), { interval: '5m', avgHours: 24 });
    expect(vars.X!).toBeCloseTo(out[699].avg, 10);
  });

  it('DSP·a 副图多一条 avg_a：单位与 a 相同（基点 / 根）；1 小时图上每根窗口根数与 5 分钟图相同', () => {
    const def = registered.get('DSP_V_CUSTOM')!;
    expect(def.calcParams).toEqual([6, AVG_DEFAULT_HOURS]);
    expect(def.figures.map(f => f.title)).toEqual(['a(基点/根): ', 'avg_a: ']);
    const a = dspPoints(k, 6).map(p => (p.v == null ? null : p.v * DSP_V_DISPLAY_SCALE));
    const out = def.calc(k, { calcParams: [6, 24] });
    for (const i of [1, 300, 699]) {
      expect(out[i].v).toBe(a[i]!);
      expect(out[i].avg).toBeCloseTo(manualAvg(a, i, 288)!, 12);
    }
    const out1h = def.calc(klines(700, 12 * BAR), { calcParams: [6, 24] });
    expect(out1h[699].avg).toBeCloseTo(out[699].avg, 10);
  });

  it('参数：带均线的两个副图多传一个 N（老设置没有 → 24），其他指标不变；空值跳过', () => {
    expect(indicatorCalcParams('BSS_CUSTOM', { period: 2 })).toEqual([2, 24]);
    expect(indicatorCalcParams('DSP_V_CUSTOM', { period: 6, avgHours: 48 })).toEqual([6, 48]);
    expect(indicatorCalcParams('DSP_A_CUSTOM', { period: 6, avgHours: 48 })).toEqual([6]);
    expect(indicatorCalcParams('DSP_CUSTOM', { period: 6, avgHours: 48 })).toEqual([6]);
    expect(indicatorCalcParams('BSS_CUSTOM', { period: 1, avgHours: 0 })).toEqual([1, 24]);
    expect(rollingAvgHours([1, null, 3, 5], 1 / 6)).toEqual([1, 1, 3, 4]);
  });

  it('菜单：BSS / DSP 开着时多一个「avg」框（默认 24，可改）；清空、打到一半不弹回默认值', () => {
    const onChange = vi.fn();
    const indicators: IndicatorConfig[] = [{ type: 'BSS', period: 1, enabled: true }, { type: 'DSP', period: 6, avgHours: 12, enabled: true }];
    render(<IndicatorMenu open indicators={indicators} onIndicatorsChange={onChange} onClose={() => {}} />);
    const bssAvg = screen.getByLabelText('买卖强度综合分 BSS 均线时长 N（小时）') as HTMLInputElement;
    expect(bssAvg.value).toBe('24');
    expect((screen.getByLabelText('动态谢林点 DSP（含 a / A 副图） 均线时长 N（小时）') as HTMLInputElement).value).toBe('12');
    fireEvent.change(bssAvg, { target: { value: '' } });
    expect(bssAvg.value).toBe('');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(bssAvg, { target: { value: '48' } });
    expect(onChange).toHaveBeenLastCalledWith([{ type: 'BSS', period: 1, avgHours: 48, enabled: true }, indicators[1]]);
    // 其他指标没有这个框
    expect(screen.queryAllByLabelText(/均线时长/)).toHaveLength(2);
  });

  it('新开 BSS：带上默认均线时长 24', () => {
    const onChange = vi.fn();
    render(<IndicatorMenu open indicators={[]} onIndicatorsChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByText('买卖强度综合分 BSS'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ type: 'BSS', period: 1, avgHours: 24 })]);
  });
});
