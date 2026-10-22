// 【用户要求】2026-10-22「多空状态 S 盘面上那条橘色横线设为 0.67」「多空状态 S 的两条均值线，设成 0.6」
import { describe, expect, it, vi } from 'vitest';
const registered = vi.hoisted(() => new Map<string, { draw?: (args: unknown) => boolean }>());
vi.mock('klinecharts', () => ({ registerIndicator: (def: { name: string }) => { registered.set(def.name, def as never); } }));
import { RESEARCH_INDICATORS, researchKcName } from '@/lib/researchIndicators';
import { registerCustomIndicators } from '@/lib/customIndicators';
const lineAt = (name: string) => { let y = 0; const ys: number[] = []; const ctx = { save() {}, restore() {}, beginPath() {}, lineTo() {}, setLineDash() {}, set lineWidth(_w: number) {}, set strokeStyle(_c: string) {}, moveTo(_x: number, py: number) { y = py; }, stroke() { ys.push((100000 - Math.floor(y)) / 100000); } };
  registered.get(name)!.draw!({ ctx, bounding: { width: 300, height: 200000 }, yAxis: { convertToPixel: (v: number) => 100000 - 100000 * v } }); return ys; };
describe('多空状态 S 的橘色线', () => {
  it('原始值与两条均值线（avg_state、avg_state_2）都在 0.6（2026-10-22 由 0.67 改）；其余研究指标仍在 0', () => {
    registerCustomIndicators();
    expect(lineAt(researchKcName('STATE', 0))).toEqual([0.6]);
    expect(lineAt(researchKcName('STATE', 1))).toEqual([0.6]);
    expect(lineAt(researchKcName('STATE', 2))).toEqual([0.6]);
    for (const item of RESEARCH_INDICATORS) if (item.id !== 'STATE') expect(item.neutral).toBe(0);
  });
});
