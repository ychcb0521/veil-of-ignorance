import { describe, expect, it, vi } from 'vitest';
const templates = vi.hoisted(() => new Map<string, any>());
vi.mock('klinecharts', () => ({ registerIndicator: (template: any) => templates.set(template.name, template) }));
vi.mock('@/lib/avgHighlightClient', () => ({ avgCalibrationContext: (featureId: string) => {
  const center = ['state', 'state2'].includes(featureId) ? .5 : 0;
  return { status: '已缓存', limits: { lower: center - .1, upper: center + .1, d: .1, count: 100, above: .2, below: .2 } };
}, avgCalibrationVersion: () => 0 }));
import { registerCustomIndicators, calibratedAverageForName, indicatorCalcParams } from '../customIndicators';
import { AVG_HIGHLIGHT_SPECS, AVG_HIGHLIGHT_COLORS } from '../avgHighlight';
import { CUSTOM_RESEARCH_INDICATORS, researchKcName } from '../researchIndicators';

registerCustomIndicators();
describe('all custom averages share calibrated highlight behavior', () => {
  it('covers both average panes for every custom indicator', () => {
    for (const item of CUSTOM_RESEARCH_INDICATORS) for (const level of [1, 2]) {
      expect(calibratedAverageForName(researchKcName(item.id, level)), item.id).toBeDefined();
    }
  });
  it.each(AVG_HIGHLIGHT_SPECS)('$id has independent avg/avg2 and preserves raw registration', spec => {
    const raw = researchKcName(spec.id);
    expect(calibratedAverageForName(raw)).toBeUndefined();
    for (const level of [1, 2]) {
      const name = researchKcName(spec.id, level), template = templates.get(name);
      expect(calibratedAverageForName(name)?.kind).toBe(level === 1 ? 'avg' : 'avg2');
      const figure = template.figures[0];
      const style = (value: number) => figure.styles({ current: { indicatorData: { [figure.key]: value, _avgLower: spec.center - .1, _avgUpper: spec.center + .1 } } });
      expect(style(spec.center).color).toBe(AVG_HIGHLIGHT_COLORS.neutral);
      expect(style(spec.center + .2).color).toBe(AVG_HIGHLIGHT_COLORS.buyer);
      expect(style(spec.center - .2).color).toBe(AVG_HIGHLIGHT_COLORS.seller);
      expect(indicatorCalcParams(name, { period: 6, avgHours: 48 }).slice(0, 2)).toEqual([6, 48]);
      const indicator = { calcParams: [6, 24], minValue: undefined as number | undefined, maxValue: undefined as number | undefined };
      template.calc([], indicator);
      expect(indicator.minValue).toBe(spec.center - .1);
      expect(indicator.maxValue).toBe(spec.center + .1);
      const lines: { value: number; color: string }[] = [];
      let color = '';
      const ctx = { save() {}, restore() {}, beginPath() {}, lineTo() {}, stroke() {}, setLineDash() {}, set lineWidth(_width: number) {}, set strokeStyle(value: string) { color = value; }, moveTo(_x: number, y: number) { lines.push({ value: (1000 - Math.floor(y)) / 100, color }); } };
      template.draw({ ctx, bounding: { width: 300, height: 2000 }, yAxis: { convertToPixel: (v: number) => 1000 - 100 * v }, indicator: { ...indicator, result: [{ _avgLower: indicator.minValue, _avgUpper: indicator.maxValue }] } });
      expect(lines.map(line => line.color)).toEqual(['#F59E0B', AVG_HIGHLIGHT_COLORS.buyer, AVG_HIGHLIGHT_COLORS.seller]);
      expect(lines[1].value).toBeCloseTo(spec.center + .1);
      expect(lines[2].value).toBeCloseTo(spec.center - .1);
    }
    expect(indicatorCalcParams(raw, { period: 6, avgHours: 6 })).toEqual(indicatorCalcParams(raw, { period: 6, avgHours: 48 }));
  });
});
