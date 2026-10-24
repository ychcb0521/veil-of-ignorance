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
    save() {}, restore() {}, beginPath() {}, lineTo() {}, fillRect() { throw new Error('Unexpected boundary band'); },
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
  it('BSS 与 DSP·a 均只保留零门槛线', () => {
    registerCustomIndicators();
    const expected = [{ y: 100.5, ...ORANGE_DASH_LINE }];
    expect(strokesOf('DSP_V_CUSTOM')).toEqual(expected);
    expect(strokesOf('BSS_CUSTOM')).toEqual(expected);
  });
});
