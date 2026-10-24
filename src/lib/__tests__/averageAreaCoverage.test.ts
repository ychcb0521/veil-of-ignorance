import { expect, it, vi } from 'vitest';
const templates = vi.hoisted(() => new Map<string, any>());
vi.mock('klinecharts', () => ({ registerIndicator: (template: any) => templates.set(template.name, template) }));
vi.mock('../drawAverageArea', () => ({ drawAverageArea: vi.fn(() => true) }));
import { drawAverageArea } from '../drawAverageArea';
import { registerCustomIndicators } from '../customIndicators';
import { CUSTOM_RESEARCH_INDICATORS, researchKcName } from '../researchIndicators';

registerCustomIndicators();
function args() {
  return { ctx: { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillRect() {}, setLineDash() {} },
    bounding: { width: 300, height: 100 }, yAxis: { convertToPixel: (value: number) => 50 - value * 10 },
    indicator: { result: [{ _avgLower: -.1, _avgUpper: .1 }] },
  };
}
it('routes both averages of all 11 custom families through the shared area renderer', () => {
  for (const item of CUSTOM_RESEARCH_INDICATORS) for (const level of [1, 2]) {
    vi.mocked(drawAverageArea).mockClear();
    const template = templates.get(researchKcName(item.id, level)), input = args();
    expect(template.draw(input), `${item.id} avg${level}`).toBe(true);
    expect(drawAverageArea).toHaveBeenCalledExactlyOnceWith(input, template.figures[0].key, expect.objectContaining({ lower: -.1, upper: .1 }));
  }
});
it('also covers the legacy DSP average while leaving original-value panes unchanged', () => {
  vi.mocked(drawAverageArea).mockClear();
  expect(templates.get('DSP_OVERLAY_AVG_CUSTOM').draw(args())).toBe(true);
  expect(drawAverageArea).toHaveBeenCalledOnce();
  vi.mocked(drawAverageArea).mockClear();
  for (const item of CUSTOM_RESEARCH_INDICATORS) templates.get(researchKcName(item.id)).draw?.(args());
  expect(drawAverageArea).not.toHaveBeenCalled();
});
