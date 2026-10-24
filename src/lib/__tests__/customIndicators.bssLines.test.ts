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
    save() {}, restore() {}, beginPath() {}, lineTo() {}, fillRect() {},
    set strokeStyle(c: string) { state.color = c; },
    set lineWidth(w: number) { state.width = w; },
    setLineDash(d: number[]) { state.dash = d; },
    moveTo(_x: number, y: number) { state.y = y; },
    stroke() { out.push({ y: state.y, color: state.color, width: state.width, dash: [...state.dash] }); },
  };
  registered.get(name)!.draw!({ ctx, bounding: { width: 300, height: 200 }, yAxis: { convertToPixel: (v: number) => 100 - 100 * v } });
  return out;
}

describe('BSS 与 DSP·a 使用统一的淡实线中轴', () => {
  it('BSS 中轴保持 0，±0.55 使用右侧短刻度', () => {
    registerCustomIndicators();
    const dspA = strokesOf('DSP_V_CUSTOM');
    expect(dspA).toEqual([{ y: 100.5, ...ORANGE_DASH_LINE }]);
    const bss = strokesOf('BSS_CUSTOM');
    const at = (v: number) => bss.filter(s => Math.floor(s.y) === Math.round(100 - 100 * v));
    expect(at(0)).toEqual([{ y: 100.5, color: dspA[0].color, width: dspA[0].width, dash: [] }]);
    expect(bss.at(-1)!.y).toBe(100.5);
    expect(at(-0.55)).toEqual([{ y: 155.5, color: 'rgba(246,70,93,0.5)', width: 1, dash: [] }]);
    expect(bss).toHaveLength(3);
  });
});
