import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { CUSTOM_RESEARCH_INDICATORS, researchChartFormula } from '@/lib/researchIndicators';
import { FISH_DEFAULT_ALGORITHMS } from './cards';

/** Match the chart's named averages when an untouched builtin lacks them.
 * Existing account series are preserved verbatim; no research definition is saved.
 */
export function fishFeatureDefinitions(defs: readonly DeepDigFeatureDef[]): DeepDigFeatureDef[] {
  return defs.map(def => {
    if (!FISH_DEFAULT_ALGORITHMS.includes(def.id)) return def;
    const indicator = CUSTOM_RESEARCH_INDICATORS.find(item => item.featureId === def.id);
    if (!indicator) return def;
    try {
      const formula = researchChartFormula(indicator, def.formula);
      return formula === def.formula ? def : { ...def, formula };
    } catch { return def; } // Keep invalid account formulas editable in the panel.
  });
}
