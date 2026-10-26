/** 鱼质量「买入过滤」可选的指标：内置特征值的原始值、avg、avg₂，按内置公式冻结（与卖出规则一致）。 */
import { BUILTIN_FEATURES, compileFeatureFormula, definitionKey } from '@/lib/deepDig/features';
import { CUSTOM_RESEARCH_INDICATORS, researchChartFormula } from '@/lib/researchIndicators';
import { shortFishHash } from './algorithm';
import type { QualityBuyFilter } from './quality';

export interface QualityFilterChoice { key: string; featureId: string; metric: string; label: string; group: string }
let cached: { choices: QualityFilterChoice[]; formulas: Map<string, string> } | undefined;
function build() {
  const choices: QualityFilterChoice[] = [], formulas = new Map<string, string>();
  for (const item of CUSTOM_RESEARCH_INDICATORS) {
    const def = BUILTIN_FEATURES.find(d => d.id === item.featureId);
    if (!def) continue;
    let formula: string, names: Set<string | undefined>;
    try { formula = researchChartFormula(item, def.formula); names = new Set(compileFeatureFormula(formula).program.statements.map(s => s.name)); } catch { continue; }
    formulas.set(def.id, formula);
    for (const [metric, suffix] of [[item.core, '原始值'], [`avg_${item.core}`, 'avg'], [`avg_${item.core}_2`, 'avg₂']] as const) {
      if (!names.has(metric)) continue;
      choices.push({ key: `${def.id}:${metric}`, featureId: def.id, metric, label: `${item.short} ${suffix}`, group: item.short });
    }
  }
  return { choices, formulas };
}
export const qualityFilterChoices = (): QualityFilterChoice[] => (cached ??= build()).choices;
/** 按选项生成一条买入条件（公式冻结进快照）。 */
export function makeQualityBuyFilter(choiceKey: string, direction: '<' | '>', threshold: number, enabled = true): QualityBuyFilter {
  const { choices, formulas } = (cached ??= build());
  const choice = choices.find(c => c.key === choiceKey);
  const def = choice && BUILTIN_FEATURES.find(d => d.id === choice.featureId);
  if (!choice || !def) throw new Error('未知的买入过滤指标');
  const frozen = { ...def, formula: formulas.get(def.id)!, interval: '5m' as const };
  return { id: `buy-${shortFishHash(JSON.stringify([choiceKey, direction, threshold]))}`, label: choice.label, metric: choice.metric, direction, threshold, enabled,
    snapshot: { featureId: def.id, featureShort: def.short, featureName: def.name, definitionKey: definitionKey(frozen), statistic: choice.metric, interval: '5m', scale: 1, unit: '',
      threshold, direction, cutoffMs: 0, average: 0, cbi2: 0, startAverage: 0, previousAverage: 0 } };
}
export const qualityFilterChoiceKey = (f: QualityBuyFilter) => `${f.snapshot.featureId}:${f.metric}`;
