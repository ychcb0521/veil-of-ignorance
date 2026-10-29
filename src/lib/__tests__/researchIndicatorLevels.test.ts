// Current chart contract: STATE raw uses 0.6; calibrated averages retain the model center 0.5; seller features retain zero.
import { describe, expect, it, vi } from 'vitest';
const registered = vi.hoisted(() => new Map<string, { draw?: (args: unknown) => boolean }>());
vi.mock('klinecharts', () => ({ registerIndicator: (def: { name: string }) => { registered.set(def.name, def as never); } }));
import { RESEARCH_INDICATORS, researchKcName } from '@/lib/researchIndicators';
import { registerCustomIndicators } from '@/lib/customIndicators';
const lineAt = (name: string) => { let y = 0; const ys: number[] = []; const ctx = { save() {}, restore() {}, beginPath() {}, lineTo() {}, fillRect() {}, setLineDash() {}, set lineWidth(_w: number) {}, set strokeStyle(_c: string) {}, moveTo(_x: number, py: number) { y = py; }, stroke() { ys.push((100000 - Math.floor(y)) / 100000); } };
  registered.get(name)!.draw!({ ctx, bounding: { width: 300, height: 200000 }, yAxis: { convertToPixel: (v: number) => 100000 - 100000 * v } }); return ys; };
describe('多空状态 S 的橘色线', () => {
  it('状态 S 原值为0.6，校准均值中心为0.5；卖方方向保持零基准', () => {
    registerCustomIndicators();
    expect(lineAt(researchKcName('STATE', 0))).toEqual([0.6]);
    expect(lineAt(researchKcName('STATE', 1))).toEqual([0.5]);
    expect(lineAt(researchKcName('STATE', 2))).toEqual([0.5]);
    expect(Object.fromEntries(RESEARCH_INDICATORS.filter(i => i.seller).map(i => [i.id, i.neutral]))).toEqual({ CDI2: 0, SELLER_CONTROL: 0, DSS: 0, CDA: 0, MBI_BEAR: 0, CTBA_BEAR: 0 });
  });
});
