import {stagedHoldingVetoes} from './qualityVetoStages';
import type {FishSnapshot} from './algorithm';
import type {QualityExitRule,QualityGroup,QualityResult} from './quality';
export interface QualitySellStage {afterAdditions:number;label:string;metric:string;snapshot:FishSnapshot;rule:QualityExitRule}
export type QualitySellStageActivation=QualitySellStage&{at:number};
export const orderedSellStages=(g:Pick<QualityGroup,'sellStages'>)=>[...(g.sellStages??[])].sort((a,b)=>a.afterAdditions-b.afterAdditions);
/** Absent settings preserve all historical result identities. */
export const qualitySellStagesIdentity=(g:Pick<QualityGroup,'sellStages'>)=>g.sellStages?.length?['addition-count-sell-stages-v1',orderedSellStages(g).map(s=>[s.afterAdditions,s.metric,s.snapshot.featureId,s.snapshot.definitionKey,s.snapshot.interval,s.snapshot.scale,s.rule.direction,s.rule.threshold])]:null;
export function validateQualitySellStages(g:Pick<QualityGroup,'sellStages'|'addition'>){
 const seen=new Set<number>();for(const s of g.sellStages??[]){
  if(!Number.isInteger(s.afterAdditions)||s.afterAdditions<1||s.afterAdditions>100)throw Error('切换的加仓次数须为 1 至 100 的整数');
  if(seen.has(s.afterAdditions))throw Error('同一次加仓只能设置一个卖出算法切换');seen.add(s.afterAdditions);
  if(!s.snapshot?.definitionKey||!s.metric||!s.rule||s.rule.metric!==s.metric||!['<','>'].includes(s.rule.direction)||!Number.isFinite(s.rule.threshold))throw Error('每个卖出阶段须选择指标、方向并填写有限数字门槛');
 }
 if(g.sellStages?.length&&g.addition?.enabled&&g.addition.quantityMode!=='calculator')throw Error('次数切换须使用按平衡公式定量的加仓方案');
}
export function qualityStagePlan(g:QualityGroup,stage?:QualitySellStage):QualityGroup{
 const {sellStages:_,vetoStages:__,...base}=g;
 return stage?{...base,metric:stage.metric,snapshot:stage.snapshot,rule:stage.rule,combo:undefined,definitionSource:'account',execution:'intrabar-1m'}:base;
}
export const effectiveQualitySellPlan=(g:QualityGroup,result:QualityResult)=>{const selected=result.activeSellStage?qualityStagePlan(g,result.activeSellStage):g;return result.activeVetoStage?{...selected,holdingVetoes:stagedHoldingVetoes(g,result.activeVetoStage.afterAdditions)}:selected;};
export const qualitySellStagesLabel=(g:Pick<QualityGroup,'sellStages'>)=>orderedSellStages(g).map(s=>`第 ${s.afterAdditions} 次加仓后：${s.label} ${s.rule.direction} ${s.rule.threshold}`).join('；');
