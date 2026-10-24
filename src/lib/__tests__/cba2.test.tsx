import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { computeCba2, CBA2_DEFAULTS, CBA2_FORMULA, type Cba2Bar } from '@/lib/cba2';
import { BUILTIN_FEATURES, CBA2_DEF, compileFeatureFormula, computeFeatureValues, evaluateOnBars, featureWindowMs } from '@/lib/deepDig/features';
import { cba2Points, CUSTOM_INDICATOR_MAP } from '@/lib/customIndicators';
import { IndicatorMenu } from '@/components/IndicatorMenu';

const step = 300000;
function bars(n = 1100): Cba2Bar[] {
  let e = 100;
  return Array.from({ length: n }, (_, i) => {
    e *= Math.exp(0.0003 + 0.001 * Math.sin(i * 1.7));
    const q = 10000 + 1000 * Math.sin(i / 9);
    return { time: i * step, close: e, volume: q / e, quoteVolume: q, takerBuyQuoteVolume: q * (0.5 + 0.2 * Math.sin(i / 5)) };
  });
}
const research = (b: Cba2Bar[]) => b.map(x => ({ openTime: x.time, open: x.close, high: x.close, low: x.close, close: x.close, volume: x.volume!, quoteVolume: x.quoteVolume, takerBuyQuoteVolume: x.takerBuyQuoteVolume, takerBuyVolume: null }));
const klines = (b: Cba2Bar[]) => b.map(x => ({ timestamp: x.time, open: x.close, high: x.close, low: x.close, close: x.close, volume: x.volume!, turnover: x.quoteVolume!, takerBuyTurnover: x.takerBuyQuoteVolume }));

// 独立逐项计算参考值，禁止用共享公式/加权函数。
function reference(b: Cba2Bar[], t: number) {
  const E = b.map(x => x.quoteVolume! / x.volume!);
  const r = E.map((x, i) => i ? Math.log(x / E[i - 1]) : NaN);
  const rho = 2 ** (-5 / (24 * 60));
  const ew: number[] = [];
  for (let i = 1; i < b.length; i++) ew[i] = i === 1 ? r[i] ** 2 : rho * ew[i - 1] + (1 - rho) * r[i] ** 2;
  let sum = 0, weights = 0;
  for (let i = t - 575; i <= t; i++) {
    const vbar = b.slice(i - 288, i).reduce((s, x) => s + x.quoteVolume!, 0) / 288;
    const v = b[i].quoteVolume!, d = 2 * b[i].takerBuyQuoteVolume! - v;
    const f = Math.log(1 + v / vbar);
    const g = 1 + Math.abs(d) / v * (d * r[i] > 0 ? 1 : 0);
    const scale = Math.sqrt(ew[i - 1] + 1e-12);
    const w = 2 ** (-((t - i) * 5 / 60) / 6);
    sum += w * f * g * r[i] / scale;
    weights += w;
  }
  const dd = Math.log(Math.max(...b.slice(t - 12, t + 1).map(x => x.close)) / b[t].close) / Math.sqrt(ew[t - 1] + 1e-12);
  return { cba2: 100 * Math.tanh(sum / weights), dd };
}

describe('CBA-2 图片公式与接入', () => {
  it('独立参考计算逐项一致：48小时归一化权重、历史EWMA、不偏向单边主动成交', () => {
    const b = bars(), out = computeCba2(b);
    for (const t of [900, 999, 1099]) {
      expect(out[t].cba2).toBeCloseTo(reference(b, t).cba2, 10);
      expect(out[t].dd).toBeCloseTo(reference(b, t).dd, 10);
    }
    const mirrored = b.map(x => ({ ...x, close: 10000 / x.close, volume: x.quoteVolume! * x.close / 10000, takerBuyQuoteVolume: x.quoteVolume! - x.takerBuyQuoteVolume! }));
    expect(computeCba2(mirrored).at(-1)!.cba2).toBeCloseTo(-out.at(-1)!.cba2!, 8);
  });
  it('第六个特征值、图表及Deep dig相同输入数值一致，拉取足够基线', () => {
    expect(BUILTIN_FEATURES[5].id).toBe(CBA2_DEF.id);
    expect(CUSTOM_INDICATOR_MAP['CBA-2']).toBe('CBA2_CUSTOM');
    expect(featureWindowMs(CBA2_DEF)).toBeGreaterThanOrEqual(73 * 3600000);
    const b = bars(), rows = research(b);
    const value = computeFeatureValues({ anchorMs: b.length * step, aligned: true, bars: rows, expectedBars: b.length, missingBars: 0, coverage: 1, missingTakerBars: 0 }, compileFeatureFormula(CBA2_FORMULA), CBA2_DEF);
    expect(value.value).toBeCloseTo(computeCba2(b).at(-1)!.cba2!, 12);
    expect(value.vars.DD).toBeCloseTo(computeCba2(b).at(-1)!.dd!, 12);
    expect(cba2Points(klines(b), 6)).toEqual(computeCba2(b));
  });
  it('未收盘、缺失、断线、无成交、基线不足时不造读数；其他周期留空', () => {
    expect(computeCba2(bars(850)).at(-1)!.cba2).toBeNull();
    const b = bars();
    expect(computeCba2(b, {}, b.at(-1)!.time + 1).at(-1)!.cba2).toBeNull();
    expect(cba2Points(klines(b).map((x, i) => ({ ...x, cba2Closed: i !== b.length - 1 })), 6).at(-1)!.cba2).toBeNull();
    for (const missing of [{ quoteVolume: null }, { volume: 0 }, { takerBuyQuoteVolume: null }, { time: b[1000].time + 1 }]) {
      const bad = b.map((x, i) => i === 1000 ? { ...x, ...missing } : x);
      expect(computeCba2(bad).at(-1)!.cba2).toBeNull();
    }
    expect(cba2Points(klines(b).map(x => ({ ...x, timestamp: x.timestamp * 3 })), 6).at(-1)!.cba2).toBeNull();
  });
  it('失效独立运行：阈值变化不清零或改变主值，历史值不受未来影响', () => {
    const b = bars();
    b[b.length - 1] = { ...b.at(-1)!, close: b.at(-1)!.close * 0.95 };
    const a = computeCba2(b), loose = computeCba2(b, { dmax: 1000 });
    expect(a.at(-1)!.invalid).toBe(true);
    expect(loose.at(-1)!.invalid).toBe(false);
    expect(a.at(-1)!.cba2).toBe(loose.at(-1)!.cba2);
    expect(a[999]).toEqual(computeCba2(b.slice(0, 1000)).at(-1));
    const out = evaluateOnBars(research(b), compileFeatureFormula(CBA2_FORMULA), CBA2_DEF);
    expect((out.vars.get('invalid') as Float64Array).at(-1)).toBe(1);
  });
  it('指标菜单可启用CBA-2，显示固定5分钟口径和参数', () => {
    const onChange = vi.fn();
    render(<IndicatorMenu open indicators={[]} onIndicatorsChange={onChange} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'CBA-2' } });
    fireEvent.click(screen.getByText('成交支持下的价格重心迁移 CBA-2'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ type: 'CBA-2', period: CBA2_DEFAULTS.halfLifeHours, enabled: true })]);
  });
});
