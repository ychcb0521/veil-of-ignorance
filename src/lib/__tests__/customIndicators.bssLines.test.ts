import { describe, expect, it, vi } from 'vitest';

const registered = vi.hoisted(() => new Map<string, { draw?: (args: unknown) => boolean }>());
vi.mock('klinecharts', () => ({
  registerIndicator: (def: { name: string; draw?: (args: unknown) => boolean }) => { registered.set(def.name, def); },
}));

import { ORANGE_DASH_LINE, registerCustomIndicators } from '@/lib/customIndicators';

type Stroke = { y: number; color: string; width: number; dash: number[] };
/** 假画布：记录每一条横线的位置与样式。纵轴 1 → 0px、−1 → 200px。 */
function strokesOf(name: string): Stroke[] {
  const out: Stroke[] = [];
  const state = { color: '', width: 0, dash: [] as number[], y: 0 };
  const ctx = {
    save() {}, restore() {}, beginPath() {}, lineTo() {},
    set strokeStyle(c: string) { state.color = c; },
    set lineWidth(w: number) { state.width = w; },
    setLineDash(d: number[]) { state.dash = d; },
    moveTo(_x: number, y: number) { state.y = y; },
    stroke() { out.push({ y: state.y, color: state.color, width: state.width, dash: [...state.dash] }); },
  };
  registered.get(name)!.draw!({ ctx, bounding: { width: 300, height: 200 }, yAxis: { convertToPixel: (v: number) => 100 - 100 * v } });
  return out;
}

describe('【用户要求】BSS 副图 0.2 处的橘黄色虚线与 DSP·a 的 0 轴同一样式', () => {
  it('+0.2 画橘黄虚线（颜色、线宽、虚线段与 DSP·a 0 轴逐项相同），最后画、压在上面；−0.2 仍是淡点线', () => {
    registerCustomIndicators();
    const dspA = strokesOf('DSP_V_CUSTOM');
    expect(dspA).toEqual([{ y: 100.5, ...ORANGE_DASH_LINE }]);
    const bss = strokesOf('BSS_CUSTOM');
    const at = (v: number) => bss.filter(s => Math.floor(s.y) === Math.round(100 - 100 * v));
    expect(at(0.2)).toEqual([{ y: 80.5, color: dspA[0].color, width: dspA[0].width, dash: dspA[0].dash }]);
    expect(bss.at(-1)!.y).toBe(80.5);
    expect(at(-0.2)).toEqual([{ y: 120.5, color: 'rgba(245,158,11,0.4)', width: 1, dash: [1, 3] }]);
    expect(bss).toHaveLength(5);
  });
});
