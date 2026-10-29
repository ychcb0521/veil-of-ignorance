/** Filter choices use the same account definitions as charts and Deep dig. */
import { compileFeatureFormula, definitionKey, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { accountFeatureDefs } from '@/lib/featureSource';
import { researchIndicatorForFeature, researchChartFormula } from '@/lib/researchIndicators';
import { shortFishHash } from './algorithm';
import type { QualityBuyFilter } from './quality';
import type { QualityHoldingVeto, QualityOperator } from './qualityVeto';
import { validateHoldingVeto, isHoldingPriceChoice, holdingPriceLabels } from './qualityVeto';
export interface QualityFilterChoice { key: string; featureId: string; metric: string; label: string; group: string }
function build(definitions: readonly DeepDigFeatureDef[]) {
  const choices: QualityFilterChoice[] = [], defs = new Map<string,DeepDigFeatureDef>();
  for (const def of definitions) {
    const item = researchIndicatorForFeature(def);
    try {
      const formula = item ? researchChartFormula(item,def.formula) : def.formula;
      const names = [...new Set(compileFeatureFormula(formula).program.statements.flatMap(s => s.name ? [s.name] : []))];
      defs.set(def.id,{...def,formula,interval:'5m'});
      const preferred = item ? [item.core,`avg_${item.core}`,`avg_${item.core}_2`] : [];
      for (const metric of [...new Set([...preferred.filter(n => names.includes(n)),...names,'结果'])]) {
        const suffix = item && metric === item.core ? '原始值' : item && metric === `avg_${item.core}` ? 'avg' : item && metric === `avg_${item.core}_2` ? 'avg₂' : metric;
        choices.push({key:`${def.id}:${metric}`,featureId:def.id,metric,label:`${item?.short ?? def.short} ${suffix}`,group:item?.short ?? def.short});
      }
    } catch { /* Invalid account formulas cannot become executable filter choices. */ }
  }
  return {choices,defs};
}
export const qualityFilterChoices = (definitions: readonly DeepDigFeatureDef[] = accountFeatureDefs()): QualityFilterChoice[] => build(definitions).choices;
export function makeQualityBuyFilter(choiceKey: string, direction: '<' | '>', threshold: number, enabled = true, definitions: readonly DeepDigFeatureDef[] = accountFeatureDefs()): QualityBuyFilter {
  const {choices,defs}=build(definitions),choice=choices.find(c=>c.key===choiceKey),def=choice&&defs.get(choice.featureId);
  if (!choice || !def) throw new Error('未知的过滤指标，请检查账号公式');
  if (!Number.isFinite(threshold)) throw new Error('过滤阈值须为有限数字');
  return { id:`buy-${shortFishHash(JSON.stringify([choiceKey,direction,threshold]))}`,label:choice.label,metric:choice.metric,direction,threshold,enabled,
    snapshot:{featureId:def.id,featureShort:def.short,featureName:def.name,definitionKey:definitionKey(def),statistic:choice.metric,interval:'5m',scale:1,unit:'',threshold,direction,cutoffMs:0,average:0,cbi2:0,startAverage:0,previousAverage:0} };
}
export const qualityFilterChoiceKey = (f: QualityBuyFilter) => `${f.snapshot.featureId}:${f.metric}`;
export function makeQualityHoldingVeto(choiceKey:string,direction:QualityOperator,threshold:number,enabled=true,definitions:readonly DeepDigFeatureDef[]=accountFeatureDefs()):QualityHoldingVeto {
  const risk=isHoldingPriceChoice(choiceKey);
  const filter=risk?undefined:makeQualityBuyFilter(choiceKey,direction==='<'||direction==='<='?'<':'>',threshold,enabled,definitions);
  const v:QualityHoldingVeto={id:`veto-${shortFishHash(JSON.stringify([choiceKey,direction,threshold]))}`,label:risk?holdingPriceLabels[choiceKey]:filter!.label,
    kind:risk?choiceKey:'indicator',direction,threshold,enabled,metric:filter?.metric,snapshot:filter?.snapshot};
  validateHoldingVeto(v);return v;
}

export type HoldingVetoDraft={choice:string;direction:QualityOperator;threshold:string;enabled:boolean};
export const holdingVetoDraft=(saved:QualityHoldingVeto[]=[]):HoldingVetoDraft[]=>saved.length?saved.map(v=>({choice:v.kind==='indicator'?`${v.snapshot?.featureId}:${v.metric}`:v.kind,direction:v.direction,threshold:String(v.threshold),enabled:v.enabled})):
  [{choice:'static-drawdown',direction:'>=',threshold:'',enabled:false},{choice:'dynamic-drawdown',direction:'>=',threshold:'',enabled:false}];
export function parseHoldingVetoDraft(draft:HoldingVetoDraft[]):QualityHoldingVeto[] {
  if(draft.some(d=>(d.enabled||d.threshold.trim())&&(!d.threshold.trim()||!Number.isFinite(Number(d.threshold)))))throw new Error('请为启用的否决条件填写有限数字阈值');
  return [...new Map(draft.filter(d=>d.enabled||d.threshold.trim()).map(d=>{const v=makeQualityHoldingVeto(d.choice,d.direction,Number(d.threshold),d.enabled);return [v.id,v];})).values()];
}
