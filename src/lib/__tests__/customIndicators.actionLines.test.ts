// 【用户要求】2026-10-22「按这个改」：橘色线 = 「渔」里的行动阈值——CBI-2 0.04、DSP·az 15（Z 开关打开时）、CBA 8、avg_BSS 0.08；原始 BSS 保留 0.2
import { describe, expect, it, vi } from 'vitest';
const registered = vi.hoisted(() => new Map<string, { draw?: (args: unknown) => boolean; maxValue?: number }>());
vi.mock('klinecharts', () => ({ registerIndicator: (def: { name: string }) => { registered.set(def.name, def as never); } }));
import { ACTION_LEVELS, ORANGE_DASH_LINE, registerCustomIndicators } from '@/lib/customIndicators';

/** 假画布：纵轴 v → (100000 − 1000·v) 像素（细到 0.001），记录每条横线对应的数值与颜色。 */
function lines(name: string, calcParams?: unknown[]) {
  const out: { v: number; color: string }[] = [];
  let color = '', y = 0;
  const ctx = { save() {}, restore() {}, beginPath() {}, lineTo() {}, setLineDash() {}, set lineWidth(_w: number) {}, set strokeStyle(c: string) { color = c; }, moveTo(_x: number, py: number) { y = py; }, stroke() { out.push({ v: (100000 - Math.floor(y)) / 1000, color }); } };
  registered.get(name)!.draw!({ ctx, bounding: { width: 300, height: 200000 }, yAxis: { convertToPixel: (v: number) => 100000 - 1000 * v }, indicator: { calcParams } });
  return out;
}
const orange = (name: string, calcParams?: unknown[]) => lines(name, calcParams).filter(l => l.color === ORANGE_DASH_LINE.color).map(l => Math.round(l.v * 100) / 100);

describe('副图橘色线 = 行动阈值', () => {
  it('数值与「渔」阈值一致', () => { expect(ACTION_LEVELS).toEqual({ cbi2: 0.04, az: 15, cba: 8, avgBss: 0.08 }); });
  it('CBI-2 在 0.04、CBA 在 8（纵轴总是包含 8）', () => {
    registerCustomIndicators();
    expect(orange('CBI2_CUSTOM')).toEqual([0.04]);
    expect(orange('CBA_CUSTOM')).toEqual([8]);expect(registered.get('CBA_CUSTOM')!.maxValue).toBe(8);
  });
  it('a / avg_a：Z 开关打开在 15 %σ/根，关着仍是 0（基点/根）', () => {
    registerCustomIndicators();
    expect(orange('DSP_V_CUSTOM', [6, 1])).toEqual([15]);expect(orange('DSP_V_CUSTOM', [6, 0])).toEqual([0]);
    expect(orange('DSP_V_AVG_CUSTOM', [6, 24, 1])).toEqual([15]);expect(orange('DSP_V_AVG_CUSTOM', [6, 24, 0])).toEqual([0]);
  });
  it('avg_BSS：灰色 0 轴 + 0.08 橘色线，不再有 ±0.55；原始 BSS 仍在 0.2', () => {
    registerCustomIndicators();
    const avg = lines('BSS_AVG_CUSTOM');
    expect(avg.map(l => Math.round(l.v * 100) / 100)).toEqual([0, 0.08]);expect(orange('BSS_AVG_CUSTOM')).toEqual([0.08]);
    expect(orange('BSS_CUSTOM')).toEqual([0.2]);
  });
});

// 【用户要求】2026-10-22「为啥没有横线？要加上横线」：读数离线很远时纵轴也要包含橘色线
describe('纵轴总是包含橘色线', () => {
  const k = Array.from({ length: 400 }, (_, i) => { const close = 100 + i / 50 + 2 * Math.sin(i / 9), q = 10000 + 3000 * Math.cos(i / 7); return { timestamp: i * 300000, open: close - .1, high: close + 1, low: close - 1, close, volume: q / close, turnover: q, takerBuyTurnover: q * (.5 + .3 * Math.sin(i / 13)) }; });
  const bounds = (name: string, calcParams: unknown[]) => { const reg: any = registered.get(name); const ind: any = { calcParams }; reg.calc(k, ind); return [ind.minValue, ind.maxValue]; };
  it('avg_a / avg_a_2：Z 开时包含 15，Z 关时包含 0；Z 版别名总包含 15', () => {
    registerCustomIndicators();
    expect(bounds('DSP_V_AVG_CUSTOM', [6, 24, 1])).toEqual([15, 15]);expect(bounds('DSP_V_AVG_CUSTOM', [6, 24, 0])).toEqual([0, 0]);
    expect(bounds('DSP_V_AVG2_CUSTOM', [6, 1, 0])).toEqual([15, 15]);
    expect(bounds('DSP_Z_V_AVG_CUSTOM', [6, 24, 1])).toEqual([15, 15]);
    // 原始 a 副图保留「总包含 0」，Z 开时再加 15
    expect(bounds('DSP_V_CUSTOM', [6, 1])).toEqual([0, 15]);
  });
  it('CBI-2 均值包含 0.04、CBA 均值包含 8、avg_BSS 包含 0.08；原始 CBI-2 仍是 −1 ~ 1', () => {
    registerCustomIndicators();
    expect(bounds('CBI2_AVG_CUSTOM', [24, 0, 0])).toEqual([0.04, 0.04]);
    expect(bounds('CBA_AVG2_CUSTOM', [6, 0, 0])).toEqual([8, 8]);
    expect(bounds('BSS_AVG_CUSTOM', [1, 24])).toEqual([0.08, 0.08]);
    expect(bounds('CBI2_CUSTOM', [24, 0])).toEqual([-1, 1]);
  });
});
