import { describe, expect, it } from 'vitest';
import type { ResearchBar } from '@/lib/deepRsa/window';
import { compileFishProgram, evaluateFishProgram } from '@/lib/fish/algorithm';
import { readFishPreference } from '@/lib/fish/preferences';
import { accountResearchIndicators } from '@/lib/researchIndicators';
import { BTC_FREE_FEATURES, BUILTIN_FEATURES, compileFeatureFormula, definitionKey, mergeFeatureDefs } from '../features';

const fishSettings = { direction: '>' as const, threshold: 0, constraints: [] };
const bars: ResearchBar[] = Array.from({ length: 1200 }, (_, i) => {
  const close = 100 * Math.exp(.0003 * i + .018 * Math.sin(i / 12));
  const quoteVolume = 100_000 * (1.5 + .4 * Math.cos(i / 4));
  return {
    openTime: i * 300_000,
    open: close * .999,
    high: close * 1.002,
    low: close * .998,
    close,
    volume: quoteVolume / close,
    quoteVolume,
    takerBuyQuoteVolume: quoteVolume * (.5 + .2 * Math.sin(i / 7)),
    takerBuyVolume: null,
    refClose: null,
  };
});

describe('independent no-BTC definitions', () => {
  it('covers each built-in BTC-dependent formula exactly once and shows the new version separately', () => {
    const originals = BUILTIN_FEATURES.filter(def => compileFeatureFormula(def.formula).usesBtc);
    expect(originals).toHaveLength(8);
    expect(BTC_FREE_FEATURES.map(def => def.btcFreeSourceId).sort()).toEqual(originals.map(def => def.id).sort());
    const definitions = mergeFeatureDefs([]);
    const chartItems = accountResearchIndicators(definitions);
    for (const variant of BTC_FREE_FEATURES) {
      const original = originals.find(def => def.id === variant.btcFreeSourceId)!;
      expect(variant.id).not.toBe(original.id);
      expect(definitionKey(variant)).not.toBe(definitionKey(original));
      expect(compileFishProgram(original, fishSettings).compiled.usesBtc).toBe(true);
      const plan = compileFishProgram(variant, fishSettings);
      expect(plan.unavailable).toBeFalsy();
      expect(plan.compiled.usesBtc).toBe(false);
      expect(chartItems.find(item => item.featureId === variant.id)?.name).toContain('无 BTC');
      expect(readFishPreference(variant.id).direction).toBe(readFishPreference(original.id).direction);
    }
  });

  it.each(BTC_FREE_FEATURES)('$id matches the source fallback and ignores supplied BTC candles', variant => {
    const original = BUILTIN_FEATURES.find(def => def.id === variant.btcFreeSourceId)!;
    const plan = compileFishProgram(variant, fishSettings);
    const withoutBtc = evaluateFishProgram(bars, plan).value;
    const fallback = evaluateFishProgram(bars, compileFishProgram(original, fishSettings)).value;
    const withBtc = bars.map((bar, i) => ({ ...bar, refClose: 50_000 * Math.exp(.0004 * i + .015 * Math.sin(i / 12)) }));
    expect(Array.from(withoutBtc).some(Number.isFinite)).toBe(true);
    expect(withoutBtc).toEqual(fallback);
    expect(evaluateFishProgram(withBtc, plan).value).toEqual(withoutBtc);
  });

  it('keeps the original S admission rule when the no-BTC S series is selected', () => {
    const variant = BTC_FREE_FEATURES.find(def => def.btcFreeSourceId === 'state')!;
    const original = BUILTIN_FEATURES.find(def => def.id === 'state')!;
    const settings = { ...fishSettings, statistic: 'state' };
    const sourcePlan = compileFishProgram(original, settings);
    expect(sourcePlan.stateHold).toBeDefined();
    expect(compileFishProgram(variant, settings).stateHoldAlternatives).toEqual(sourcePlan.stateHoldAlternatives);
  });

  it('preserves the account versions of the original indicators when a no-BTC variant is saved', () => {
    const original = BUILTIN_FEATURES.find(def => def.id === 'cdi2')!;
    const variant = BTC_FREE_FEATURES.find(def => def.btcFreeSourceId === 'cdi2-v2')!;
    const definitions = mergeFeatureDefs([{ ...original, avgHours: 18 }, variant]);
    expect(definitions.find(def => def.id === 'cdi2-v2')?.avgHours).toBe(18);
    expect(definitions.find(def => def.id === variant.id)?.formula).toBe(variant.formula);
  });
});
