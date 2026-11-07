import {BOX_STOP_KIND,BOX_BREAK_CHOICE,isBoxBreak,freezeBoxStop,validateBoxStop,boxStopIdentity,boxStopLabel,type BoxStopRule} from './qualityBoxStop';
/** Filter choices use the same account definitions as charts and Deep dig. */
import { compileFeatureFormula, definitionKey, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { accountFeatureDefs } from '@/lib/featureSource';
import { researchIndicatorForFeature, researchChartFormula } from '@/lib/researchIndicators';
import { shortFishHash } from './algorithm';
import type { QualityBuyFilter } from './quality';
import type { QualityHoldingVeto, QualityOperator } from './qualityVeto';
import { validateHoldingVeto, isHoldingPriceChoice, holdingPriceLabels, ADDITION_PROFIT_KIND, ADDITION_PROFIT_LABEL, PAYOFF_STOP_KIND, PAYOFF_STOP_LABEL } from './qualityVeto';
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
export function makeQualityHoldingVeto(choiceKey:string,direction:QualityOperator,threshold:number,enabled=true,definitions:readonly DeepDigFeatureDef[]=accountFeatureDefs(),geometricMultiple=100):QualityHoldingVeto {
  if(choiceKey===PAYOFF_STOP_KIND){const v:QualityHoldingVeto={id:`veto-${shortFishHash(JSON.stringify([choiceKey,'>=',threshold]))}`,label:PAYOFF_STOP_LABEL,kind:PAYOFF_STOP_KIND,direction:'>=',threshold,enabled};validateHoldingVeto(v);return v;}
  const risk=isHoldingPriceChoice(choiceKey),addition=choiceKey===ADDITION_PROFIT_KIND;
  const filter=risk||addition?undefined:makeQualityBuyFilter(choiceKey,direction==='<'||direction==='<='?'<':'>',threshold,enabled,definitions);
  const v:QualityHoldingVeto={id:`veto-${shortFishHash(JSON.stringify([choiceKey,direction,threshold,...(addition?[geometricMultiple]:[])]))}`,label:addition?ADDITION_PROFIT_LABEL:risk?holdingPriceLabels[choiceKey]:filter!.label,
    kind:addition?ADDITION_PROFIT_KIND:risk?choiceKey:'indicator',direction,threshold,enabled,metric:filter?.metric,snapshot:filter?.snapshot,...(addition?{geometricMultiple}: {})};
  validateHoldingVeto(v);return v;
}

export type HoldingVetoDraft={choice:string;direction:QualityOperator;threshold:string;enabled:boolean;geometricMultiple?:string;boxStop?:BoxStopRule};
/** 【用户要求】2026-11-03 每套卖出算法的硬性终止框都默认带一条「盈亏比止盈」（不勾选、预填 5000R），用不用由用户选。 */
export const PAYOFF_STOP_DEFAULT_R='5000';
const withPayoffRow=(rows:HoldingVetoDraft[]):HoldingVetoDraft[]=>rows.some(r=>r.choice===PAYOFF_STOP_KIND)?rows:[...rows,{choice:PAYOFF_STOP_KIND,direction:'>=',threshold:PAYOFF_STOP_DEFAULT_R,enabled:false}];
export const holdingVetoDraft=(saved:QualityHoldingVeto[]=[]):HoldingVetoDraft[]=>(saved.length?saved.map(v=>({choice:v.kind===BOX_STOP_KIND&&v.boxStop&&isBoxBreak(v.boxStop)?BOX_BREAK_CHOICE:v.kind==='indicator'?`${v.snapshot?.featureId}:${v.metric}`:v.kind,direction:v.direction,threshold:String(v.threshold),enabled:v.enabled,...(v.boxStop?{boxStop:structuredClone(v.boxStop)}:{}),...(v.kind===ADDITION_PROFIT_KIND?{geometricMultiple:String(v.geometricMultiple??100)}:{})})):
  [{choice:'static-drawdown',direction:'>=',threshold:'',enabled:false},{choice:'dynamic-drawdown',direction:'>=',threshold:'',enabled:false}]);
/** 方案的硬性终止框（不含各次加仓后的否决）：默认多一条不勾选的盈亏比止盈。 */
export const planHoldingVetoDraft=(saved:QualityHoldingVeto[]=[]):HoldingVetoDraft[]=>withPayoffRow(holdingVetoDraft(saved));
export function parseHoldingVetoDraft(draft:HoldingVetoDraft[]):QualityHoldingVeto[] {
  const boxes=draft.filter(d=>d.choice===BOX_STOP_KIND||d.choice===BOX_BREAK_CHOICE).map(d=>{validateBoxStop(d.boxStop);if((d.choice===BOX_BREAK_CHOICE)!==isBoxBreak(d.boxStop))throw Error('支撑断裂与触价条件的执行版本不符');return {id:'veto-box-'+shortFishHash(JSON.stringify(boxStopIdentity(d.boxStop))),label:boxStopLabel(d.boxStop),kind:BOX_STOP_KIND,direction:'<=' as const,threshold:0,enabled:d.enabled,boxStop:freezeBoxStop(structuredClone(d.boxStop))};});
  draft=draft.filter(d=>d.choice!==BOX_STOP_KIND&&d.choice!==BOX_BREAK_CHOICE);
  if(draft.some(d=>(d.enabled||d.threshold.trim())&&(!d.threshold.trim()||!Number.isFinite(Number(d.threshold)))))throw new Error('请为启用的否决条件填写有限数字阈值');
  // 没勾选、还是默认 5000R 的那条盈亏比止盈只是预留位，不存进方案（下次打开会自动补上）
  return [...boxes,...new Map(draft.filter(d=>(d.enabled||d.threshold.trim())&&!(d.choice===PAYOFF_STOP_KIND&&!d.enabled&&d.threshold.trim()===PAYOFF_STOP_DEFAULT_R)).map(d=>{const v=makeQualityHoldingVeto(d.choice,d.direction,Number(d.threshold),d.enabled,undefined,d.geometricMultiple==null?100:d.geometricMultiple.trim()?Number(d.geometricMultiple):NaN);return [v.id,v];})).values()];
}
