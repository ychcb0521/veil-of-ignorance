import { describe, expect, it } from 'vitest';
import { MBI_DEF, MBI_BEAR_DEF, CTBA_DEF, CTBA_BEAR_DEF, compileFeatureFormula, evaluateOnBars, featureWindowMs, intervalOf, copyFeatureDefinition, BUILTIN_FEATURES } from '../features';
import { snapshotOf } from '../analysis';
const bars = (n = 1900) => Array.from({ length: n }, (_, i) => {
  const close = 100 * Math.exp(.06 * Math.sin(i / 35) + .01 * Math.sin(i / 5)), amount = 10000 + 2000 * Math.sin(i / 13);
  return { openTime: i * 300000, open: close, high: close * 1.005, low: close * .995, close, volume: amount / close, quoteVolume: amount, takerBuyVolume: null, takerBuyQuoteVolume: amount * (.5 + .35 * Math.sin(i / 31)) };
});
describe('seller-only MBI and CTBA', () => {
  it.each([[MBI_DEF, MBI_BEAR_DEF, 'MBI', 'MBI_bear'], [CTBA_DEF, CTBA_BEAR_DEF, 'CTBA', 'CTBA_bear']] as const)('$1.id keeps negative readings, zeros positive readings and preserves missing values', (original, bear, source, core) => {
    const data = bars(), before = evaluateOnBars(data, compileFeatureFormula(original.formula), original);
    const actual = evaluateOnBars(data, compileFeatureFormula(bear.formula), bear);
    const old = before.vars.get(source) as Float64Array, values = actual.vars.get(core) as Float64Array;
    let negatives = 0, zeros = 0, missing = 0;
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(old[i])) { expect(Number.isNaN(values[i])).toBe(true); missing++; }
      else { expect(values[i]).toBe(Math.min(old[i], 0)); if (values[i] < 0) negatives++; else zeros++; }
    }
    expect(negatives).toBeGreaterThan(0); expect(zeros).toBeGreaterThan(0); expect(missing).toBeGreaterThan(0);
    for (const name of ['avg_' + core, 'avg_' + core + '_2']) {
      const x = actual.vars.get(name) as Float64Array; expect(Array.from(x).filter(Number.isFinite).every(v => v <= 0)).toBe(true);
      expect(Array.from(x).some(Number.isFinite)).toBe(true);
    }
    const prefix = evaluateOnBars(data.slice(0, 1500), compileFeatureFormula(bear.formula), bear).vars.get(core) as Float64Array;
    expect(Array.from(values.slice(0, 1500))).toEqual(Array.from(prefix));
    expect(Array.from(evaluateOnBars(data, compileFeatureFormula(original.formula), original).vars.get(source) as Float64Array)).toEqual(Array.from(old));
    const copy = copyFeatureDefinition(bear, BUILTIN_FEATURES, 100);
    expect(featureWindowMs(copy)).toBe(featureWindowMs(bear));
    expect(intervalOf(copy)).toBe(intervalOf(bear));
    expect(snapshotOf({ ...copy, MBI_N: 7, MBI_Z0: .9 })).toMatchObject({ chartTemplate: bear.chartTemplate });
    if (source === 'MBI') expect(snapshotOf({ ...copy, MBI_N: 7, MBI_Z0: .9 })).toMatchObject({ MBI_N: 7, MBI_Z0: .9 });
  });
});
