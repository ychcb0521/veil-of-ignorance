import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { CUSTOM_RESEARCH_INDICATORS, researchChartFormula } from '@/lib/researchIndicators';

// 捕捞默认项独立调整；这些手动可选算法仍按图上的均值序列读「结果」。
const PREPARED = new Set(['cbi2', 'mbi', 'state', 'cba', 'drift-speed-z', 'bss', 'cda']);

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
