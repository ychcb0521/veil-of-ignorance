/** UI choices only. Execution and saved formulas retain their complete statistic registry. */
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { compileFeatureFormula } from '@/lib/deepDig/features';
import { researchIndicatorForFeature, researchSeriesNames } from '@/lib/researchIndicators';

export function algorithmMetricMenu(def: DeepDigFeatureDef, available: readonly {name:string;label:string}[]) {
  try {
    const item=researchIndicatorForFeature(def),names=researchSeriesNames(item,def.formula);
    const candidates=[{name:names.core,label:'原值'},...(!item.rawOnly?[{name:names.avg,label:'avg'},{name:names.avg2,label:'avg_2'}]:[])];
    const result=candidates.filter(c=>available.some(s=>s.name===c.name));
    // An unnamed final expression has no separate named core. Its result is the original value.
    if(!result.some(c=>c.label==='原值')&&!compileFeatureFormula(def.formula).program.statements.at(-1)?.name&&available.some(s=>s.name==='结果'))result.unshift({name:'结果',label:'原值'});
    return result;
  } catch { return []; }
}
