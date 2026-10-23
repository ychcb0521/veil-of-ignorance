import { describe, expect, it } from 'vitest';
import { AVG_HIGHLIGHT_SPECS, AVG_HIGHLIGHT_COLORS, avgCoreKey, avgResultKey, avgReferenceKey, calibratedAverageLimits, averageHighlightColor, displayAverage } from '../avgHighlight';
import { compileFeatureFormula, evaluateOnBars } from '../deepDig/features';

describe('avg highlighter: symmetric pooled quantiles, unchanged averaging mathematics', () => {
  it('uses deviations from 0.5 for state; asymmetric samples do not imply equal tail shares', () => {
    const spec = AVG_HIGHLIGHT_SPECS.find(s => s.id === 'STATE')!;
    const limits = calibratedAverageLimits([.5, .6, .7, .8, .9], spec);
    expect(limits.d).toBeCloseTo(.24, 12);
    expect(limits.lower).toBeCloseTo(.26, 12); expect(limits.upper).toBeCloseTo(.74, 12);
    expect(limits.above).toBe(.4); expect(limits.below).toBe(0);
  });
  it.each(AVG_HIGHLIGHT_SPECS)('$id uses green on the high side and red on the low side, including seller control', spec => {
    const limits = { lower: spec.center - .1, upper: spec.center + .1 };
    expect(averageHighlightColor(spec.center + .2, limits)).toBe(AVG_HIGHLIGHT_COLORS.buyer);
    expect(averageHighlightColor(spec.center - .2, limits)).toBe(AVG_HIGHLIGHT_COLORS.seller);
    expect(averageHighlightColor(limits.lower, limits)).toBe(AVG_HIGHLIGHT_COLORS.neutral);
    expect(averageHighlightColor(limits.upper, limits)).toBe(AVG_HIGHLIGHT_COLORS.neutral);
    expect(averageHighlightColor(spec.center)).toBe(AVG_HIGHLIGHT_COLORS.neutral);
  });
  it('does not exceed bounded ranges or fabricate thresholds without data', () => {
    const spec = AVG_HIGHLIGHT_SPECS.find(s => s.id === 'STATE')!;
    const limits = calibratedAverageLimits([-100, 100], spec);
    expect([limits.lower, limits.upper]).toEqual([0, 1]);
    expect(() => calibratedAverageLimits([NaN], spec)).toThrow();
  });
  it.each([6, 24, 48])('N=%sh: both display averages match the existing formula engine, including missing values', hours => {
    const bars = Array.from({ length: 800 }, (_, i) => ({ openTime: i * 300000, open: 10, high: 12, low: 8, close: i % 83 === 0 ? NaN : 10 + Math.sin(i / 17), volume: 1, takerBuyVolume: 0 }));
    const formula = `X=C\n a=avg(X,${hours})\n m=avg(X,${hours / 4})\n b=(4*m+3*ago(m,${hours / 4})+2*ago(m,${hours / 2})+ago(m,${hours * 3 / 4}))/10`;
    const expected = evaluateOnBars(bars, compileFeatureFormula(formula)).vars;
    for (const [kind, name] of [['avg', 'a'], ['avg2', 'b']] as const) {
      const actual = displayAverage(bars.map(b => b.close), hours, kind);
      const reference = expected.get(name) as Float64Array;
      for (let i = 0; i < actual.length; i++) {
        if (Number.isNaN(reference[i])) expect(actual[i]).toBeNaN();
        else expect(actual[i]).toBeCloseTo(reference[i], 12);
      }
    }
  });
  it('invalidates caches for N, averaging kind, core parameters, formula and population', () => {
    const def = { id: 'state', formula: 'state=C', scale: 1 };
    const key = avgCoreKey(['AAA', 'BBB'], def, 24);
    expect(avgCoreKey(['BBB', 'AAA'], def, 24)).toBe(key);
    expect(avgCoreKey(['AAA'], def, 24)).not.toBe(key);
    expect(avgCoreKey(['AAA', 'BBB'], { ...def, formula: 'state=O' }, 24)).not.toBe(key);
    expect(avgCoreKey(['AAA', 'BBB'], def, 48)).not.toBe(key);
    expect(avgResultKey(key, 6, 'avg')).not.toBe(avgResultKey(key, 24, 'avg'));
    expect(avgResultKey(key, 24, 'avg')).not.toBe(avgResultKey(key, 24, 'avg2'));
  });
  it('reference identity ignores comments and account presentation, but separates all calculation settings', () => {
    const def={id:'state',formula:'# note\nstate = C',scale:1};
    const key=avgReferenceKey(def,24,24,'avg2');
    expect(avgReferenceKey({...def,formula:'state = C # new note'},24,24,'avg2')).toBe(key);
    for(const patch of [{formula:'state = O'},{scale:100},{halfLifeHours:12},{avgHours:48}])expect(avgReferenceKey({...def,...patch},24,24,'avg2')).not.toBe(key);
    expect(avgReferenceKey(def,48,24,'avg2')).not.toBe(key);
    expect(avgReferenceKey(def,24,48,'avg2')).not.toBe(key);
    expect(avgReferenceKey(def,24,24,'avg')).not.toBe(key);
  });
});
