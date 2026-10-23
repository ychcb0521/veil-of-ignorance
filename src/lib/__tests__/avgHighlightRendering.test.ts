import { describe, expect, it, vi } from 'vitest';
const templates = vi.hoisted(() => new Map<string, any>());
vi.mock('klinecharts', () => ({ registerIndicator: (template: any) => templates.set(template.name, template) }));
vi.mock('@/lib/avgHighlightClient', () => ({ avgCalibrationContext: () => ({ status: '已缓存', limits: { lower: -.1, upper: .1, d: .1, count: 100, above: .2, below: .2 } }), avgCalibrationVersion: () => 0 }));
import { registerCustomIndicators, calibratedAverageForName, indicatorCalcParams } from '../customIndicators';
import { AVG_HIGHLIGHT_SPECS, AVG_HIGHLIGHT_COLORS } from '../avgHighlight';
import { researchKcName } from '../researchIndicators';

registerCustomIndicators();
describe('all nine custom averages share calibrated highlight behavior', () => {
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
    }
    expect(indicatorCalcParams(raw, { period: 6, avgHours: 6 })).toEqual(indicatorCalcParams(raw, { period: 6, avgHours: 48 }));
  });
});
