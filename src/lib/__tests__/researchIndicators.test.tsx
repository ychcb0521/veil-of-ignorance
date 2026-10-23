import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { KLineData } from 'klinecharts';
const mock = vi.hoisted(() => ({ refs: [] as number[], version: 0, request: vi.fn(), registered: new Map<string, any>() }));
vi.mock('klinecharts', () => ({ registerIndicator: (d: any) => mock.registered.set(d.name, d) }));
vi.mock('@/lib/btcReference', () => ({ btcClosesAt: (times: number[]) => times.map((_, i) => mock.refs[i] ?? null), requestBtcReference: mock.request, btcReferenceVersion: () => mock.version }));
import { RESEARCH_INDICATORS, researchKcName, researchChartSeries, researchDefaultPeriod } from '@/lib/researchIndicators';
import { CUSTOM_INDICATOR_MAP, INDICATOR_COMPANIONS, indicatorCalcParams, registerCustomIndicators } from '@/lib/customIndicators';
import { BUILTIN_FEATURES, FEATURES_KEY, compileFeatureFormula, evaluateOnBars } from '@/lib/deepDig/features';
import { IndicatorMenu } from '@/components/IndicatorMenu';
import type { ResearchBar } from '@/lib/deepRsa/window';

function klines(n = 900): KLineData[] {
  let close = 100, btc = 50000;
  mock.refs = [];
  return Array.from({ length: n }, (_, i) => {
    const open = close; close *= Math.exp(0.001 * Math.sin(i * 0.27) + 0.0005 * Math.cos(i * 0.13));
    btc *= Math.exp(0.0003 * Math.sin(i * 0.19)); mock.refs.push(btc);
    const q = 10000 * (1.5 + Math.sin(i * 0.21));
    return { timestamp: i * 300000, open, high: Math.max(open, close) * 1.002, low: Math.min(open, close) * 0.998, close,
      volume: q / (close * (1 + 0.0005 * Math.sin(i))), turnover: q, takerBuyTurnover: q * (0.5 + 0.3 * Math.cos(i * 0.11)) };
  });
}
function researchBars(k: KLineData[]): ResearchBar[] { return k.map((d, i) => ({ openTime: d.timestamp, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume!, quoteVolume: d.turnover!, takerBuyVolume: null, takerBuyQuoteVolume: d.takerBuyTurnover as number, refClose: mock.refs[i] })); }
const val = (vars: Map<string, any>, name: string, i: number) => { const v = vars.get(name); const x = typeof v === 'number' ? v : v?.[i]; return Number.isFinite(x) ? x : null; };
const saved = (defs: unknown[]) => localStorage.setItem('sim_anon_' + FEATURES_KEY, JSON.stringify(defs));
const accountFormula = (formula: string, x: string) => `${formula}\navg_${x} = avg(${x}, 24)\nm6 = avg(${x}, 6)\navg_${x}_3 = (m6 + 2 * ago(m6, 6) + 3 * ago(m6, 12) + 4 * ago(m6, 18)) / 10\navg_${x}_2 = (4 * m6 + 3 * ago(m6, 6) + 2 * ago(m6, 12) + ago(m6, 18)) / 10`;

beforeEach(() => { localStorage.clear(); mock.request.mockClear(); mock.version = 0; });
registerCustomIndicators();
describe('五个 Deep dig 指标及 avg_x / avg_x_2', () => {
  it.each(RESEARCH_INDICATORS)('$id 三条序列逐根等于账号的 Deep dig 公式，原值不被末尾加权结果替代，显示倍数只乘一次', item => {
    const k = klines(); const def = BUILTIN_FEATURES.find(d => d.id === item.featureId)!;
    const formula = accountFormula(def.formula, item.core); saved([{ ...def, formula }]);
    const expected = evaluateOnBars(researchBars(k), compileFeatureFormula(formula));
    const actual = researchChartSeries(k, item, item.period, { fetchReference: false });
    for (const [series, name] of [[actual.core, item.core], [actual.avg, `avg_${item.core}`], [actual.avg2, `avg_${item.core}_2`]] as const) {
      for (let i = 0; i < k.length; i++) {
        const x = val(expected.vars, name, i);
        if (x == null) expect(series[i]).toBeNull(); else expect(series[i]).toBeCloseTo(x * def.scale, 10);
      }
    }
    for (const level of [0, 1, 2]) {
      const reg = mock.registered.get(researchKcName(item.id, level));
      expect(reg.figures).toHaveLength(1);
      const out = reg.calc(k, { calcParams: indicatorCalcParams(reg.name, { period: item.period }) });
      expect(out.at(-1).value).toBe((level === 0 ? actual.core : level === 1 ? actual.avg : actual.avg2).at(-1));
    }
  });

  it('均值使用校准界限与可见数值的范围，不再沿用原值固定范围', () => {
    for (const name of ['BSS_AVG_CUSTOM', 'DSP_V_AVG_CUSTOM', 'DSP_Z_V_AVG_CUSTOM']) {
      const reg = mock.registered.get(name);
      expect(reg.minValue).toBeUndefined(); expect(reg.maxValue).toBeUndefined();
      expect(reg.precision).toBeGreaterThanOrEqual(8);
    }
    for (const item of RESEARCH_INDICATORS) {
      for (const level of [1, 2]) {
        const reg = mock.registered.get(researchKcName(item.id, level));
        expect(reg.minValue).toBeUndefined(); expect(reg.maxValue).toBeUndefined();
        expect(reg.precision).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('没有保存均值定义时，默认第一条为 24h 均值，第二条为近到远 4:3:2:1 分段均值，不做均值再平均', () => {
    const item = RESEARCH_INDICATORS.find(d => d.id === 'DSS')!, k = klines();
    // Transparent ramp: raw = 1,2,3,...; hand calculate complete non-overlapping 6h blocks.
    saved([{ ...BUILTIN_FEATURES.find(d => d.id === 'dss')!, formula: 'DSS = T / 300000 + 1' }]);
    const out = researchChartSeries(k, item, 1, { fetchReference: false });
    const mean = (from: number, to: number) => (from + to) / 2;
    expect(out.avg[899]).toBe(mean(613, 900));
    expect(out.avg2[899]).toBe((4 * mean(829, 900) + 3 * mean(757, 828) + 2 * mean(685, 756) + mean(613, 684)) / 10);
    expect(out.avg2[899]).toBeGreaterThan(out.avg[899]!);
    expect(out.avg2[0]).toBeNull(); // ago has no history; do not fabricate early blocks.
  });

  it('自定义两个均值按原式显示；改参数、公式或显示倍数即时失效缓存，实时原地更新和前缀计算正确', () => {
    const item = RESEARCH_INDICATORS.find(d => d.id === 'SELLER_CONTROL')!, k = klines();
    const def = { ...BUILTIN_FEATURES.find(d => d.id === item.featureId)!, formula: 'bc = C\navg_bc = avg(bc, 2)\navg_bc_2 = avg(bc, 1) * 3', scale: 2 };
    saved([def]);
    const p1 = indicatorCalcParams(researchKcName(item.id), { period: 6 });
    let out = researchChartSeries(k, item, 6, { fetchReference: false });
    expect(out.core.at(-1)).toBe(k.at(-1)!.close * 2);
    const old = out.core.at(-1); k[k.length - 1].close += 1;
    out = researchChartSeries(k, item, 6, { fetchReference: false }); expect(out.core.at(-1)).toBe(old! + 2);
    saved([{ ...def, scale: 4 }]);
    expect(indicatorCalcParams(researchKcName(item.id), { period: 6 })).not.toEqual(p1);
    expect(researchChartSeries(k, item, 6, { fetchReference: false }).core.at(-1)).toBe(k.at(-1)!.close * 4);
    const prefix = researchChartSeries(k.slice(0, 700), item, 6, { fetchReference: false });
    const all = researchChartSeries(k, item, 6, { fetchReference: false });
    expect(prefix.avg2).toEqual(all.avg2.slice(0, 700));
    saved([{ ...def, formula: 'bc = hl\navg_bc = hl + 1\navg_bc_2 = hl + 2' }]);
    expect(researchChartSeries(k, item, 12, { fetchReference: false }).avg2.at(-1)).toBe(28);
  });

  it('添加时沿用基线和半衰期的小数小时，DSS 按用户要求默认 12h', () => {
    saved(BUILTIN_FEATURES.map(def => ({ ...def, halfLifeHours: 3.5, avgHours: 18.5, ...(def.id === 'dss' ? { formula: 'n = 2.5\nDSS = n' } : {}) })));
    expect(RESEARCH_INDICATORS.map(researchDefaultPeriod)).toEqual([18.5, 18.5, 3.5, 12, 3.5]);
  });

  it('仅用到 CB 的定义请求本周期 BTC；BTC 版本进入原值和两个均值参数，并使三条序列重算', () => {
    const k = klines();
    const dss = RESEARCH_INDICATORS.find(d => d.id === 'DSS')!, cdi = RESEARCH_INDICATORS.find(d => d.id === 'CDI2')!;
    researchChartSeries(k, dss, 1); expect(mock.request).not.toHaveBeenCalled();
    const def = BUILTIN_FEATURES.find(d => d.id === 'cdi2')!;
    saved([{ ...def, formula: 'CDI2 = CB\navg_CDI2 = avg(CDI2, 1)\navg_CDI2_2 = avg(CDI2, 2)' }]);
    const before = researchChartSeries(k, cdi, 24); expect(mock.request).toHaveBeenCalledWith(0, 900 * 300000, 300000);
    const params = [0, 1, 2].map(level => indicatorCalcParams(researchKcName(cdi.id, level), { period: 24 }));
    mock.refs = mock.refs.map(v => v + 5); mock.version++;
    const after = researchChartSeries(k, cdi, 24);
    expect(after.core.at(-1)).toBe(before.core.at(-1)! + 5);
    expect(after.avg.at(-1)).toBeCloseTo(before.avg.at(-1)! + 5, 8);
    for (const level of [0, 1, 2]) expect(indicatorCalcParams(researchKcName(cdi.id, level), { period: 24 })).not.toEqual(params[level]);
    k.forEach(d => { d.timestamp *= 3; }); researchChartSeries(k, cdi, 24);
    expect(mock.request).toHaveBeenLastCalledWith(0, 900 * 900000, 900000);
  });

  it('菜单可搜索、添加、修改参数和移除五项；每项各有两个独立的均值副图，状态的橘色线在 0.6（2026-10-22 用户要求）', () => {
    const changed = vi.fn();
    const { rerender } = render(<IndicatorMenu open onClose={() => {}} indicators={[]} onIndicatorsChange={changed} />);
    for (const item of RESEARCH_INDICATORS) {
      expect(CUSTOM_INDICATOR_MAP[item.id]).toBe(researchKcName(item.id));
      expect(INDICATOR_COMPANIONS[item.id].map(c => c.kcName)).toEqual([researchKcName(item.id, 1), researchKcName(item.id, 2)]);
      fireEvent.change(screen.getByPlaceholderText('搜索指标 (MACD / RSI / BOLL ...)'), { target: { value: item.id } });
      fireEvent.click(screen.getByText(item.name));
      expect(changed.mock.lastCall![0].at(-1)).toMatchObject({ type: item.id, period: researchDefaultPeriod(item), enabled: true });
    }
    const item = RESEARCH_INDICATORS[0], active = [{ type: item.id, period: 24, enabled: true }];
    rerender(<IndicatorMenu open onClose={() => {}} indicators={active} onIndicatorsChange={changed} />);
    fireEvent.change(screen.getByPlaceholderText('搜索指标 (MACD / RSI / BOLL ...)'), { target: { value: 'STATE' } });
    fireEvent.change(screen.getByLabelText(item.name + ' 参数'), { target: { value: '12' } });
    expect(changed.mock.lastCall![0][0].period).toBe(12);
    fireEvent.click(screen.getByText(item.name)); expect(changed.mock.lastCall![0]).toEqual([]);
    expect(mock.registered.get(researchKcName('STATE')).minValue).toBe(0);
    expect(mock.registered.get(researchKcName('STATE')).maxValue).toBe(1);
    const pixel = vi.fn(() => 40);
    const ctx = Object.fromEntries(['save', 'restore', 'setLineDash', 'beginPath', 'moveTo', 'lineTo', 'stroke'].map(k => [k, vi.fn()]));
    for (const state of [true, false]) {
      const reg = mock.registered.get(researchKcName(state ? 'STATE' : 'CDI2'));
      reg.draw({ ctx, bounding: { width: 400, height: 80 }, yAxis: { convertToPixel: pixel } });
      expect(pixel).toHaveBeenLastCalledWith(state ? 0.6 : 0);
    }
  });
});
