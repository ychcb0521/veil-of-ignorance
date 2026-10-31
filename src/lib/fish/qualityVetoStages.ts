import {holdingVetoIdentity,validateHoldingVeto,type QualityHoldingVeto,type QualityHoldingPath} from './qualityVeto';
import type {QualityGroup,QualityResult} from './quality';
export interface QualityVetoStage {afterAdditions:number;conditions:QualityHoldingVeto[]}
export type QualityVetoStageActivation=QualityVetoStage&{at:number;mode:'overlay'|'replace';peakBasis:'holding'|'stage'};
export const orderedVetoStages=(g:Pick<QualityGroup,'vetoStages'>)=>[...(g.vetoStages??[])].sort((a,b)=>a.afterAdditions-b.afterAdditions);
const slot=(v:QualityHoldingVeto)=>v.kind==='indicator'?`${v.kind}:${v.snapshot?.featureId}:${v.metric}`:v.kind;
export const qualityVetoStagesIdentity=(g:Pick<QualityGroup,'vetoStages'|'vetoStageMode'|'vetoPeakBasis'>)=>g.vetoStages?.length?['addition-count-veto-stages-v1',g.vetoStageMode??'overlay',g.vetoPeakBasis??'stage',orderedVetoStages(g).map(s=>[s.afterAdditions,s.conditions.map(v=>[v.enabled,holdingVetoIdentity([{...v,enabled:true}])[0]])])]:null;
export function validateQualityVetoStages(g:Pick<QualityGroup,'vetoStages'|'vetoStageMode'|'vetoPeakBasis'|'addition'>){
 if(!g.vetoStages?.length)return;
 if(!['overlay','replace'].includes(g.vetoStageMode??'overlay')||!['holding','stage'].includes(g.vetoPeakBasis??'stage'))throw Error('一票条件切换口径无效');
 const seen=new Set<number>();for(const s of g.vetoStages){if(!Number.isInteger(s.afterAdditions)||s.afterAdditions<1||s.afterAdditions>100)throw Error('一票条件切换次数须为 1 至 100 的整数');if(seen.has(s.afterAdditions))throw Error('同一次加仓只能设置一组一票条件切换');seen.add(s.afterAdditions);if(!s.conditions?.length)throw Error('每个阶段请添加至少一条一票条件');s.conditions.forEach(validateHoldingVeto);}
 if(g.addition?.enabled&&g.addition.quantityMode!=='calculator')throw Error('一票条件次数切换须使用按平衡公式定量的加仓方案');
}
/** Overlay updates only matching rule kinds (or matching indicator variables); other rules survive. */
export function stagedHoldingVetoes(g:QualityGroup,count:number):QualityHoldingVeto[]|undefined{
 let conditions=g.holdingVetoes;for(const stage of orderedVetoStages(g)){if(stage.afterAdditions>count)break;if(g.vetoStageMode==='replace')conditions=stage.conditions;else{const changed=new Set(stage.conditions.map(slot));conditions=[...(conditions??[]).filter(v=>!changed.has(slot(v))),...stage.conditions];}}
 return conditions;
}
/** Reset observations, never replay a past drawdown against a newly tightened limit. */
export function beginVetoStagePath(g:QualityGroup,r:QualityResult):QualityHoldingPath{
 const entry=r.entryPrice!,price=r.endPrice!,peak=(g.vetoPeakBasis??'stage')==='stage'?price:Math.max(price,r.vetoPath?.peak??entry*(1+(r.peakPct??0)/100));
 if(![entry,price,peak].every(n=>n>0&&Number.isFinite(n)))throw Error('一票条件切换缺少有效持仓价格');
 return {entry,peak,minimum:price,dynamic:0};
}

export const qualityVetoStagesLabel=(g:Pick<QualityGroup,'vetoStages'>)=>orderedVetoStages(g).map(s=>`第 ${s.afterAdditions} 次加仓后：${s.conditions.map(v=>`${v.label} ${v.direction} ${v.threshold}${v.kind==='indicator'?'':'%'}${v.enabled?'':'（停用）'}`).join(' 或 ')}`).join('；');
