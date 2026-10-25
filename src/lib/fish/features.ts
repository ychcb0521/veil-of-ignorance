import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { CUSTOM_RESEARCH_INDICATORS, researchChartFormula } from '@/lib/researchIndicators';
import { FISH_DEFAULT_ALGORITHMS } from './cards';

// CDA 退出默认组合后，手动加的 CDA 卡仍按图上的均值序列读「结果」。
const PREPARED = new Set([...FISH_DEFAULT_ALGORITHMS, 'cda']);

/** Match the chart's named averages when an untouched builtin lacks them.
 * Existing account series are preserved verbatim; no research definition is saved.
 */
export function fishFeatureDefinitions(defs: readonly DeepDigFeatureDef[]): DeepDigFeatureDef[] {
  return defs.map(def => {
    if (!PREPARED.has(def.id)) return def;
    const indicator = CUSTOM_RESEARCH_INDICATORS.find(item => item.featureId === def.id);
    if (!indicator) return def;
    try {
      const formula = researchChartFormula(indicator, def.formula);
      return formula === def.formula ? def : { ...def, formula };
    } catch { return def; } // Keep invalid account formulas editable in the panel.
  });
}
