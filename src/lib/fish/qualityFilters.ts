import {MIRROR_HARD_STOP_STAGES_VERSION,type MirrorHardStopStage} from './qualityMirrorHardStopStages';
import { usesHourlyCda } from '@/lib/cdaPeriods';
import {POST_MIRROR_PROTECTION_VERSION} from './qualityPostMirrorProtection';
import { algorithmMetricMenu } from './algorithmMetricMenu';
import { guardDistanceConfig } from './qualityAdditionVeto';
import { guardDistanceDefinition, guardDistanceSignalChoices } from './qualityGuardDistance';
import {BOX_STOP_KIND,BOX_BREAK_CHOICE,BOX_SECOND_BREAK_CHOICE,BOX_SECOND_EXIT_CHOICE,boxStopChoice,freezeBoxStop,validateBoxStop,boxStopIdentity,boxStopLabel,type BoxStopRule} from './qualityBoxStop';
/** Filter choices use the same account definitions as charts and Deep dig. */
import { compileFeatureFormula, definitionKey, intervalOf, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { accountFeatureDefs } from '@/lib/featureSource';
import { researchIndicatorForFeature, researchChartFormula } from '@/lib/researchIndicators';
import { shortFishHash } from './algorithm';
import type { QualityBuyFilter } from './quality';
import type { QualitySignalMetric } from './qualitySignalReadings';
import type { QualityHoldingVeto, QualityOperator } from './qualityVeto';
import { holdingBoxStopIdentity, validateHoldingVeto, isHoldingPriceChoice, holdingPriceLabels, ADDITION_PROFIT_KIND, ADDITION_PROFIT_LABEL, PAYOFF_STOP_KIND, PAYOFF_STOP_LABEL } from './qualityVeto';
import { additionMetricTime, withAdditionMetricTime, type AdditionMetricTime } from './qualityAdditionMetric';
export interface QualityFilterChoice { key: string; featureId: string; metric: string; label: string; group: string }
function build(definitions: readonly DeepDigFeatureDef[], originalPeriod = false) {
  const choices: QualityFilterChoice[] = [], defs = new Map<string,DeepDigFeatureDef>();
  for (const def of definitions) {
    const item = researchIndicatorForFeature(def);
    try {
      const formula = item ? researchChartFormula(item,def.formula) : def.formula;
      const names = [...new Set(compileFeatureFormula(formula).program.statements.flatMap(s => s.name ? [s.name] : []))];
      defs.set(def.id,{...def,formula,interval:originalPeriod || usesHourlyCda(def) ? intervalOf(def) : '5m'});
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
export const qualityFilterDefinitions = (definitions: readonly DeepDigFeatureDef[], originalPeriod = false) => build(definitions, originalPeriod).defs;
/** Only these three series can be newly selected; legacy builders above remain complete. */
export function qualityFilterMenuChoices(definitions: readonly DeepDigFeatureDef[] = accountFeatureDefs(), originalPeriod = false): QualityFilterChoice[] {
  const {choices,defs}=build(definitions,originalPeriod);
  const menu = definitions.flatMap(def=>{
    const compiled=defs.get(def.id);if(!compiled)return [];
    const own=choices.filter(c=>c.featureId===def.id);
    return algorithmMetricMenu(originalPeriod ? def : compiled,own.map(c=>({name:c.metric,label:c.label}))).flatMap(metric=>{
      const choice=own.find(c=>c.metric===metric.name);
      return choice?[{...choice,label:`${choice.group} ${metric.label}`}]:[];
    });
  });
  return originalPeriod ? [...menu, ...guardDistanceSignalChoices] : menu;
}
export function makeQualityBuyFilter(choiceKey: string, direction: '<' | '>', threshold: number, enabled = true, definitions: readonly DeepDigFeatureDef[] = accountFeatureDefs()): QualityBuyFilter {
  const {choices,defs}=build(definitions),choice=choices.find(c=>c.key===choiceKey),def=choice&&defs.get(choice.featureId);
  if (!choice || !def) throw new Error('未知的过滤指标，请检查账号公式');
  if (!Number.isFinite(threshold)) throw new Error('过滤阈值须为有限数字');
  return { id:`buy-${shortFishHash(JSON.stringify([choiceKey,direction,threshold]))}`,label:choice.label,metric:choice.metric,direction,threshold,enabled,
    snapshot:metricSnapshot(choice,def,threshold,direction) };
}
function metricSnapshot(choice: QualityFilterChoice, def: DeepDigFeatureDef, threshold: number, direction: '<' | '>'): QualityBuyFilter['snapshot'] {
  return {featureId:def.id,featureShort:def.short,featureName:def.name,definitionKey:definitionKey(def),statistic:choice.metric,interval:intervalOf(def),scale:1,unit:'',threshold,direction,cutoffMs:0,average:0,cbi2:0,startAverage:0,previousAverage:0};
}
export function makeQualitySignalMetrics(choiceKeys: readonly string[], definitions: readonly DeepDigFeatureDef[]): QualitySignalMetric[] {
  if (!choiceKeys.length) return [];
  const {choices, defs} = build(definitions, true);
  return choiceKeys.map(key => {
    const distance = guardDistanceSignalChoices.find(choice => choice.key === key);
    const choice = distance ?? choices.find(choice => choice.key === key);
    const def = distance ? guardDistanceDefinition(guardDistanceConfig(distance.version,undefined,distance.timeframe).parameters)
      : choice && defs.get(choice.featureId);
    if (!choice || !def) throw Error('未知的读数算法，请检查账号公式');
    const snapshot = metricSnapshot(choice, def, 0, '>');
    if (distance) snapshot.unit = 'ATR';
    return {id:shortFishHash(JSON.stringify([key,snapshot.definitionKey,snapshot.interval])),label:choice.label,metric:choice.metric,snapshot};
  });
}
export const qualityFilterChoiceKey = <T extends Pick<QualityBuyFilter, 'snapshot' | 'metric'>>(f: T) => `${f.snapshot.featureId}:${f.metric}`;
export function makeQualityHoldingVeto(choiceKey:string,direction:QualityOperator,threshold:number,enabled=true,definitions:readonly DeepDigFeatureDef[]=accountFeatureDefs(),geometricMultiple=100):QualityHoldingVeto {
  if(choiceKey===PAYOFF_STOP_KIND){const v:QualityHoldingVeto={id:`veto-${shortFishHash(JSON.stringify([choiceKey,'>=',threshold]))}`,label:PAYOFF_STOP_LABEL,kind:PAYOFF_STOP_KIND,direction:'>=',threshold,enabled};validateHoldingVeto(v);return v;}
  const risk=isHoldingPriceChoice(choiceKey),addition=choiceKey===ADDITION_PROFIT_KIND;
  const filter=risk||addition?undefined:makeQualityBuyFilter(choiceKey,direction==='<'||direction==='<='?'<':'>',threshold,enabled,definitions);
  const v:QualityHoldingVeto={id:`veto-${shortFishHash(JSON.stringify([choiceKey,direction,threshold,...(addition?[geometricMultiple]:[])]))}`,label:addition?ADDITION_PROFIT_LABEL:risk?holdingPriceLabels[choiceKey]:filter!.label,
    kind:addition?ADDITION_PROFIT_KIND:risk?choiceKey:'indicator',direction,threshold,enabled,metric:filter?.metric,snapshot:filter?.snapshot,...(addition?{geometricMultiple}: {})};
  validateHoldingVeto(v);return v;
}

export type HoldingVetoDraft={choice:string;direction:QualityOperator;threshold:string;enabled:boolean;activation?:typeof POST_MIRROR_PROTECTION_VERSION;mirrorStage?:MirrorHardStopStage;geometricMultiple?:string;boxStop?:BoxStopRule;time?:AdditionMetricTime;saved?:QualityHoldingVeto};
/** 【用户要求】2026-11-03 每套卖出算法的硬性终止框都默认带一条「盈亏比止盈」（不勾选、预填 5000R），用不用由用户选。 */
export const PAYOFF_STOP_DEFAULT_R='5000';
const withPayoffRow=(rows:HoldingVetoDraft[]):HoldingVetoDraft[]=>rows.some(r=>r.choice===PAYOFF_STOP_KIND)?rows:[...rows,{choice:PAYOFF_STOP_KIND,direction:'>=',threshold:PAYOFF_STOP_DEFAULT_R,enabled:false}];
export const holdingVetoDraft=(saved:QualityHoldingVeto[]=[]):HoldingVetoDraft[]=>(saved.length?saved.map(v=>({choice:v.kind===BOX_STOP_KIND&&v.boxStop?boxStopChoice(v.boxStop):v.kind==='indicator'?`${v.snapshot?.featureId}:${v.metric}`:v.kind,direction:v.direction,threshold:String(v.threshold),enabled:v.enabled,...(v.mirrorStage?{mirrorStage:structuredClone(v.mirrorStage)}:{}),...(v.activation?{activation:v.activation}:{}),...(v.snapshot&&v.kind==='indicator'?{saved:v,time:additionMetricTime(v.snapshot)}:{}),...(v.boxStop?{boxStop:structuredClone(v.boxStop)}:{}),...(v.kind===ADDITION_PROFIT_KIND?{geometricMultiple:String(v.geometricMultiple??100)}:{})})):
  [{choice:'static-drawdown',direction:'>=',threshold:'',enabled:false},{choice:'dynamic-drawdown',direction:'>=',threshold:'',enabled:false}]);
/** 方案的硬性终止框（不含各次加仓后的否决）：默认多一条不勾选的盈亏比止盈。 */
export const planHoldingVetoDraft=(saved:QualityHoldingVeto[]=[]):HoldingVetoDraft[]=>withPayoffRow(holdingVetoDraft(saved));
export function parseHoldingVetoDraft(draft:HoldingVetoDraft[], definitions?:readonly DeepDigFeatureDef[]):QualityHoldingVeto[] {
  const boxChoice=(choice:string)=>[BOX_STOP_KIND,BOX_BREAK_CHOICE,BOX_SECOND_BREAK_CHOICE,BOX_SECOND_EXIT_CHOICE].includes(choice);
  const gated=(v:QualityHoldingVeto,d:HoldingVetoDraft):QualityHoldingVeto=>{const {activation:_,mirrorStage:__,...base}=v;if((d.activation||d.mirrorStage)&&base.boxStop)base.id='veto-box-'+shortFishHash(JSON.stringify(holdingBoxStopIdentity({...base,...(d.activation?{activation:d.activation}:{}),...(d.mirrorStage?{mirrorStage:d.mirrorStage}:{})})));const stageSuffix=new RegExp('-'+MIRROR_HARD_STOP_STAGES_VERSION+'-(before|after)$');base.id=base.id.replace(stageSuffix,'');const suffix='-'+POST_MIRROR_PROTECTION_VERSION;if(base.id.endsWith(suffix))base.id=base.id.slice(0,-suffix.length);const rule=d.activation?{...base,activation:d.activation,id:base.id+'-'+d.activation}:base;const staged=d.mirrorStage?{...rule,mirrorStage:structuredClone(d.mirrorStage),id:rule.id+'-'+d.mirrorStage.version+'-'+d.mirrorStage.stage}:rule;validateHoldingVeto(staged);return staged;};
  const boxes=draft.filter(d=>boxChoice(d.choice)).map(d=>{validateBoxStop(d.boxStop);if(d.choice!==boxStopChoice(d.boxStop))throw Error('支撑断裂与触价条件的执行版本不符');return gated({id:'veto-box-'+shortFishHash(JSON.stringify(boxStopIdentity(d.boxStop))),label:boxStopLabel(d.boxStop),kind:BOX_STOP_KIND,direction:'<=' as const,threshold:0,enabled:d.enabled,boxStop:freezeBoxStop(structuredClone(d.boxStop))},d);});
  draft=draft.filter(d=>!boxChoice(d.choice));
  if(draft.some(d=>(d.enabled||d.threshold.trim())&&(!d.threshold.trim()||!Number.isFinite(Number(d.threshold)))))throw new Error('请为启用的否决条件填写有限数字阈值');
  // 没勾选、还是默认 5000R 的那条盈亏比止盈只是预留位，不存进方案（下次打开会自动补上）
  const rules = draft.filter(d => (d.enabled || d.threshold.trim()) && !(d.choice === PAYOFF_STOP_KIND && !d.enabled && d.threshold.trim() === PAYOFF_STOP_DEFAULT_R)).map(d => {
    const build=():QualityHoldingVeto=>{const threshold = Number(d.threshold);
    const saved = d.saved?.snapshot && qualityFilterChoiceKey({ snapshot:d.saved.snapshot, metric:d.saved.metric! }) === d.choice ? d.saved : undefined;
    const direction: '<' | '>' = d.direction.startsWith('<') ? '<' : '>';
    const veto = saved ? { ...saved, enabled:d.enabled, direction:d.direction, threshold,
      snapshot:{ ...saved.snapshot!, direction, threshold } }
      : makeQualityHoldingVeto(d.choice,d.direction,threshold,d.enabled,definitions,d.geometricMultiple==null?100:d.geometricMultiple.trim()?Number(d.geometricMultiple):NaN);
    if (veto.kind !== 'indicator') return veto;
    if (!saved && !Object.keys(d.time ?? {}).length) return veto;
    if (saved && saved.direction === d.direction && saved.threshold === threshold &&
        JSON.stringify(d.time ?? {}) === JSON.stringify(additionMetricTime(saved.snapshot!))) return { ...saved, enabled:d.enabled };
    const timed = withAdditionMetricTime({ ...veto, metric:veto.metric!, snapshot:veto.snapshot!, direction }, d.time);
    return { ...veto, label:timed.label, snapshot:timed.snapshot,
      id:'veto-' + shortFishHash(JSON.stringify([d.choice,d.direction,threshold,timed.snapshot.definitionKey,timed.snapshot.interval])) };
    };return gated(build(),d);
  });
  return [...boxes, ...new Map(rules.map(v => [v.id, v])).values()];
}
