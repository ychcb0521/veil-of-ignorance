import { expect, it } from 'vitest';
import { ATR_PRICE_PCT_DEF, mergeFeatureDefs } from '@/lib/deepDig/features';
import { evaluateFishProgram } from '../algorithm';
import { validateEntryCondition } from '../preEntryThreeStage';
import { qualityMetricPlan } from '../quality';
import { additionMetricTime, withAdditionMetricTime, withMetricSnapshotTime } from '../qualityAdditionMetric';
import { holdingVetoDraft, makeQualityBuyFilter, makeQualitySignalMetrics, parseHoldingVetoDraft, qualityFilterMenuChoices } from '../qualityFilters';
import { makeQualitySellPlan } from '../qualitySellPlans';

const defs = [ATR_PRICE_PCT_DEF];
const key = ATR_PRICE_PCT_DEF.id + ':ATRP';
const base = makeQualityBuyFilter(key, '>', 6, true, defs);
const time = { interval: '1h', atrBars: '2' } as const;

it('offers ATR percentage in the shared algorithm and signal reading menus', () => {
  expect(mergeFeatureDefs([])).toContainEqual(expect.objectContaining({ id: ATR_PRICE_PCT_DEF.id }));
  for (const originalPeriod of [false, true]) {
    expect(qualityFilterMenuChoices(defs, originalPeriod)).toContainEqual(expect.objectContaining({ key }));
  }
});

it('executes the same percent at the chosen interval in static, entry, exit, veto and signal readings', () => {
  const buy = withAdditionMetricTime(base, time);
  const entry = withMetricSnapshotTime({ ...base, timing: 'closed' as const }, time);
  validateEntryCondition(entry);
  const sell = withMetricSnapshotTime(makeQualitySellPlan(key, '<', 6, defs), time);
  const [veto] = parseHoldingVetoDraft([{ choice: key, direction: '>=', threshold: '6', enabled: true, time }], defs);
  const reading = withMetricSnapshotTime(makeQualitySignalMetrics([key], defs)[0], time);
  const bars = [[101, 99, 100], [111, 109, 110], [105, 101, 104]].map(([high, low, close], i) => ({
    openTime: i * 3600000, open: close, high, low, close, volume: 1, quoteVolume: close,
    takerBuyVolume: null, takerBuyQuoteVolume: null, refClose: null,
  }));
  for (const snapshot of [buy.snapshot, entry.snapshot, sell.snapshot, veto.snapshot!, reading.snapshot]) {
    const restored = JSON.parse(JSON.stringify(snapshot));
    expect(additionMetricTime(restored)).toEqual(time);
    const { plan, scale } = qualityMetricPlan(restored, 'ATRP');
    expect([plan.step, plan.unit, scale]).toEqual([3600000, '%', 1]);
    const values = evaluateFishProgram(bars, plan).value;
    expect(values[0]).toBeNaN();
    expect(values[1]).toBeCloseTo(6.5 / 110 * 100, 10);
    expect(values[2]).toBeCloseTo(7.75 / 104 * 100, 10);
  }
  expect(parseHoldingVetoDraft(holdingVetoDraft([veto]), defs)).toEqual([veto]);
  expect(withAdditionMetricTime(buy, {})).toEqual(base);
  expect(withAdditionMetricTime(base, { atrBars: '14' })).toEqual(base);
  for (const atrBars of ['0', '-2', '1.5', 'abc']) {
    expect(() => withAdditionMetricTime(base, { atrBars })).toThrow('ATR 周期');
  }
});
