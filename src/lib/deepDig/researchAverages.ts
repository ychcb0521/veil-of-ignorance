import { namedChartFormula } from '../featureSource';
import { researchChartFormula, researchIndicatorForFeature } from '../researchIndicators';
import { compileFeatureFormula, type DeepDigFeatureDef } from './features';

/** Resolve chart defaults for this research session without writing them into the account definition. */
export function withResearchAverages(def: DeepDigFeatureDef): DeepDigFeatureDef {
  try {
    const indicator = researchIndicatorForFeature(def);
    if (indicator.rawOnly) return def;
    const named = namedChartFormula(def.formula);
    const complete = researchChartFormula(indicator, named);
    if (complete === named) return def;

    // Deep Dig uses the last statement as its main result. The chart reads variables by name.
    // namedChartFormula gives an unnamed final expression a collision-free variable of its own.
    const last = compileFeatureFormula(named).program.statements.at(-1)!.name!;
    const result = named === def.formula ? `${last} = ${last}` : last;
    return { ...def, formula: `${complete}\n${result}   # 原公式的主输出` };
  } catch {
    // A partially edited or invalid formula must remain available in the editor.
    return def;
  }
}
