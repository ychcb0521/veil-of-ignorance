import {ADDITION_K_TOUCH_VERSION} from '@/lib/fish/qualityAddition';
import {DBL5_GUARD_DEFAULTS} from '@/lib/dbl5m';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { defaultBreakevenFloor, defaultGeometricLock, defaultQualityAddition, defaultSupportReduction, qualityAdditionAtrSettings, qualityAdditionConditions, qualityAdditionPrerequisites, validateQualityAddition, type QualityAdditionRule, type QualityAdditionRoundRule } from '@/lib/fish/qualityAddition';
import { qualityFilterChoices, makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { makeQualitySellPlan } from '@/lib/fish/qualitySellPlans';
import { orderedSellStages, type QualitySellStage } from '@/lib/fish/qualitySellStages';
import {defaultStructureAddition,guardTrendOnly,type StructureAdditionRule} from '@/lib/fish/qualityAdditionStructure';
import {boxAlgorithmVersion,CURRENT_BOX_VERSION,CURRENT_GUARD_VERSION,freezeStructureVersions,structureVersionLabel} from '@/lib/fish/boxAlgorithmVersions';
import {BoxAlgorithmVersionNotes} from '@/components/FishQualityPlanVersions';
import { FishQualityInfo } from '@/components/FishQualityModule';
import { ADDITION_VETO_DEFAULTS, ADDITION_VETO_KINDS, ADDITION_VETO_LABELS, pullbackParams, type AdditionEntryVetoKind, type QualityAdditionEntryVeto } from '@/lib/fish/qualityAdditionVeto';
import { FishQualityHoldingVetoEditor } from '@/components/FishQualityHoldingVetoEditor';
import type { VetoStagesDraft } from '@/components/FishQualityVetoStagesEditor';
import type { HoldingVetoDraft } from '@/lib/fish/qualityFilters';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';

/**
 * 【用户要求】2026-11-01 加仓细节：每次加仓独立设置，且每次分三段——
 *   方向（必要不充分：时机那一刻须全部满足，可选指标与涨幅门槛；用户 2026-11-01 定名「方向」，代码里仍叫 prerequisites）、
 *   位置（必要充分：达到即加仓，主要用箱体 DBL / SBS；用户定名「位置」，代码里仍按 source/structure 存）、
 *   卖出（必要充分：碰到均衡线 K、可不断添加的否决条件——存为方案的 vetoStages，以及可选的「本次加仓后改用的卖出算法」）。
 * 2026-11-01 用户：位置 = 箱体算法（只此一种）+ 一行「K = 旧C − n×ATR」（C 为箱体支撑，不用 S 免得和成本线混淆；新 C 产生即加仓，K 取上一箱体的旧 C，多留一个箱体作冗余）；原「入场距离 T ≥ S＋n×ATR」删除；
 * 卖出 =「一条条终止条件，像硬性终止那样可不断增加，如碰到 K 卖出、5 分钟回撤超 10% 卖出」。
 * 数据沿用原格式：自选指标时机的方向条件仍是 conditions[1..]；箱体 / 原探测时机的存 prerequisites；
 * 「本次加仓后改用的卖出算法」就是方案的 sellStages（afterAdditions = 第几次）。
 */
interface ConditionDraft {choice:string;direction:'<'|'>';threshold:string}
export interface SellSwitchDraft extends ConditionDraft {enabled:boolean}
/** 加仓否决的编辑草稿：四条各自的开关与参数（字符串，保存时校验）。 */
type VetoFieldDraft={enabled:boolean;lookbackBars:string;atr:string;ratio:string;pct:string;er:string;join?:'and'|'or';sticky?:boolean;windows:{minutes:string;pct:string}[]};
export type AdditionVetoDraft=Record<AdditionEntryVetoKind,VetoFieldDraft>;
const vetoDraftOf=(saved?:readonly QualityAdditionEntryVeto[]):AdditionVetoDraft=>Object.fromEntries(ADDITION_VETO_KINDS.map(kind=>{const found=saved?.find(x=>x.kind===kind),v=kind==='pullback'?(found?pullbackParams(found):ADDITION_VETO_DEFAULTS.pullback):{...ADDITION_VETO_DEFAULTS[kind],...found},str=(x?:number)=>x==null?'':String(x);const defaults=ADDITION_VETO_DEFAULTS[kind].windows??[],windows=v.windows??defaults;return [kind,{enabled:!!saved?.find(x=>x.kind===kind)?.enabled,lookbackBars:str(v.lookbackBars),atr:str(v.atr),ratio:str(v.ratio),pct:str(v.pct),er:str(v.er),join:v.join??'and',sticky:found?!!found.sticky:(kind==='pullback'||kind==='pullback-atr'),windows:Array.from({length:Math.max(3,windows.length)},(_,i)=>({minutes:str(windows[i]?.minutes??defaults[i]?.minutes),pct:windows[i]?str(windows[i].pct):''}))}];})) as AdditionVetoDraft;
interface DetectorPreDraft {enabled:boolean;featureId:string;stricterPct:string}
interface RoundDraft extends ConditionDraft {detectorPre:DetectorPreDraft;entryVetoes:AdditionVetoDraft;source:'detector'|'custom'|'structure';structure:StructureAdditionRule;structureBuffer:string;stricterPct:string;extraConditions:ConditionDraft[];gainEnabled:boolean;minGainPct:string;supportOffsetAtr:string;sellSwitch:SellSwitchDraft;
 /** 【用户要求】2026-11-04 恢复 S/T/K 位置：入场距离 T ≥ S＋n×ATR（空＝不检查）；涨幅门槛基准。 */
 entryDistanceAtr?:string;gainBasis?:'average'|'cost-line'}
/** 【用户要求】2026-11-03 防守线要说明是哪条线、虚线算不算、断掉意味着什么等细节。 */
export function GuardLineNotes(){return <div className="space-y-2 text-[11px] leading-relaxed" data-testid="guard-line-notes">
 <p><b className="font-medium text-foreground">是哪条线</b>：K 线图上 DBL-5 那条<b className="font-medium text-foreground">蓝色加粗线</b>，就是防守线，只有这一条。淡绿色细线是箱底（下轨），淡灰色细线是固定上轨，都不是防守线。红色 × 表示防守线被收盘确认跌破。</p>
 <p><b className="font-medium text-foreground">实线和虚线</b>：都是防守线，只是行情状态不同。<b className="font-medium text-foreground">实线＝上涨期</b>：新箱底比上一箱体高，且两箱重叠不到较小箱高的一半，线＝新箱底 − a×ATR（默认 0.5），只升不降。<b className="font-medium text-foreground">虚线＝震荡期</b>：其他情况都算震荡（第一个箱体也算），线＝震荡区里最低的箱底 − b×ATR（默认 1）；区间里的小箱体不抬线，箱底创新低时线跟着下移。ATR 是 5 分钟 ATR(14)。</p>
 <p><b className="font-medium text-foreground">防守线类型</b>：选「实线和虚线」（默认）时，两种线都能当 K。选「只用实线」时，新 C 产生那一刻如果防守线是虚线（震荡期），这次就不加仓，原因记进战役「未加仓理由」，等到实线（上涨期）时的新 C 再加。</p>
 <p><b className="font-medium text-foreground">怎样算跌破</b>：只看 5 分钟收盘价，影线刺穿不算。上涨期（实线）1 根收盘低于线即跌破；震荡期（虚线）要连续 2 根，中间有一根收回线上就重新计数。</p>
 <p><b className="font-medium text-foreground">断掉意味着什么</b>：跌破确认后，图上画红 ×，这段线到此结束、不再显示，说明原来的箱体结构已经失效。等下一个箱体确认后，才按震荡期（虚线）重新起一条新线。线断开期间没有防守线，<b className="font-medium text-foreground">不会加仓</b>。行情数据中断时线也会断开、重新开始。</p>
 {/* 【用户要求】2026-11-03「防守线与是否卖出没有直接关系，需要通过K才起作用」 */}
 <p><b className="font-medium text-foreground">只在加仓那一刻起作用</b>：K＝当时的防守线 − 冗余×ATR，同时记下当时是实线还是虚线，决定之后要几根收盘确认（实线 1 根，虚线连续 2 根）。K 随后<b className="font-medium text-foreground">冻结</b>，下一次加仓才换成新的 K。</p>
 <p><b className="font-medium text-foreground">卖不卖只看 K</b>：5 分钟收盘按上面的根数确认跌破 K，就在下一分钟开盘卖出全部持仓。防守线之后怎么上移、断开，图上有没有红 ×，都<b className="font-medium text-foreground">不直接触发卖出</b>。</p>
 <p><b className="font-medium text-foreground">唯一的联动</b>：启用「支撑下移减仓」时，防守线下移会按减仓规则把 K 挪到 K′，起作用的仍然是 K。</p>
 <p><b className="font-medium text-foreground">保本底线（可选）</b>：在「卖出」里勾选后，K 下方 m×ATR 另有一条 F，盘中碰到即按 F 卖出，加仓量也按 F 算，保证整笔不亏。</p>
</div>;}
/** 【用户要求】2026-11-03「加仓后，无论如何都不要亏」：保本底线的说明。 */
export function BreakevenFloorNotes({immediate=false}:{immediate?:boolean}={}){if(immediate)return <div className="space-y-2 text-[11px] leading-relaxed" data-testid="breakeven-floor-notes"><p>当前使用即时触价新版：先碰到防守线 K 就立即卖出全部持仓，不等收盘，也不必等下方 F。</p><p>F＝K−m×ATR 仍保留为原平衡公式的加仓定量基准，加仓币数不因这次执行升级而放大或缩小。在更高的 K 提前退出，通常比等 F 更早保护仓位；开盘跳空越过 K 或 F 时仍只能按实际开盘价模拟成交，不能保证不亏。</p></div>;return <div className="space-y-2 text-[11px] leading-relaxed" data-testid="breakeven-floor-notes">
 <p><b className="font-medium text-foreground">为什么需要</b>：平衡公式只保证在 K 价卖出时整笔保本。防守线要等 5 分钟收盘确认、下一分钟开盘才卖，组合卖出与否决也按下一分钟开盘卖，成交价可能低于 K，加仓后就会亏。</p>
 <p><b className="font-medium text-foreground">怎么做</b>：在防守线 K 下方 m×ATR 再挂一条保本底线 F。加仓量按 F 用平衡公式算；价格盘中碰到 F，立即按 F 卖出全部持仓。防守线 K 照旧收盘确认，两者谁先到算谁。所以不论哪条路径卖出，成交价都不低于 F，整笔不亏。</p>
 <p><b className="font-medium text-foreground">例外</b>：开盘直接跳空到 F 下方时，按开盘价卖出。</p>
 <p><b className="font-medium text-foreground">取舍</b>：m 越大，F 离 K 越远，防守线的噪音容忍度保留越多，但加仓量也越小。只对 K 取防守线的那几次生效，各次通用。</p>
</div>;}
export interface AdditionDraft extends RoundDraft {kStopVersion?:typeof ADDITION_K_TOUCH_VERSION;enabled:boolean;quantityMode:'calculator'|'entry'|'fixed';quantity:string;repeat:boolean;maxRounds:string;otherRounds:RoundDraft[];
  /** 支撑线下移减仓（各次加仓通用）。 */
  supportReduction?:{enabled:boolean;minDropAtr:string;maxPct:string;exitEnabled?:boolean;exitAfterDrops?:string;version?:2};
  /** 几何仓位 > 门槛时保住 x% 开仓价有效涨幅（各次通用）。 */
  geometricLock?:{enabled:boolean;multiple:string;pct:string};
  /** 保本底线（防守线 K 下方 m×ATR，盘中碰到即卖；各次通用）。 */
  breakevenFloor?:{enabled:boolean;atr:string};
  /** 设在「最多加仓次数」之后的旧切换阶段：原样保留，不在轮次里显示。 */
  laterSellStages?:QualitySellStage[]}
const conditionDraft=(f?:ReturnType<typeof qualityAdditionConditions>[number]):ConditionDraft=>({choice:f?f.snapshot.featureId+':'+f.metric:'',direction:f?.direction??'>',threshold:f?String(f.threshold):''});
const sellSwitchDraft=(stage?:QualitySellStage):SellSwitchDraft=>stage?{enabled:true,choice:stage.snapshot.featureId+':'+stage.metric,direction:stage.rule.direction,threshold:String(stage.rule.threshold)}:{enabled:false,choice:'',direction:'<',threshold:''};
/**
 * 【用户要求】2026-11-01 位置只用箱体算法（DBL / SBS），下方一行 K = 旧C − n×ATR。
 * 旧的「自选指标」轮次：那条指标挪到「方向」最前面作为加仓前提保留；「原探测算法再次命中」没有对应设置，改为箱体。
 * 只改编辑草稿：未保存前方案仍按原设置计算，保存后才写成箱体。
 */
/** legacy：这套加仓是用户启用过的旧方案时，才把「原探测算法」轮次找回为方向条件（默认空设置的 source 也是 detector）。 */
const roundDraft=(rule:QualityAdditionRoundRule,stage?:QualitySellStage,legacy=false):RoundDraft=>{
 const custom=rule.source==='custom',conditions=qualityAdditionConditions(rule),atr=qualityAdditionAtrSettings(rule);
 const common={stricterPct:String(rule.stricterPct),gainEnabled:rule.minGainPct!=null,minGainPct:String(rule.minGainPct??5),supportOffsetAtr:String(atr.supportOffsetAtr),sellSwitch:sellSwitchDraft(stage),entryVetoes:vetoDraftOf(rule.entryVetoes),
  entryDistanceAtr:rule.entryDistanceAtr!=null?String(rule.entryDistanceAtr):'',gainBasis:rule.gainBasis==='average'?'average' as const:'cost-line' as const,
  // 旧的「原探测算法再次命中」轮次：打开时把它作为「方向」里的探测算法条件找回来（保存后才写入）
  detectorPre:rule.detectorPrerequisite?{enabled:rule.detectorPrerequisite.enabled,featureId:rule.detectorPrerequisite.featureId??'',stricterPct:String(rule.detectorPrerequisite.stricterPct)}:legacy&&rule.source==='detector'?{enabled:true,featureId:'',stricterPct:String(rule.stricterPct)}:{enabled:false,featureId:'',stricterPct:'10'}};
 // 【用户要求】2026-11-04 恢复「指标＋入场距离（S/T/K）」位置：自选指标的轮次保持原样打开，首条指标是加仓条件、其余为同时满足的指标条件
 // （11-01～11-03 这里会把它改成箱体，保存后就换了算法——11-03 旧模板重跑结果不同就是这个原因）
 if(custom)return {source:'custom',structure:defaultStructureAddition(),structureBuffer:'0',...conditionDraft(conditions[0]),extraConditions:conditions.slice(1).map(conditionDraft),...common};
 return {source:'structure',structure:structuredClone(rule.source==='structure'&&rule.structure?rule.structure:defaultStructureAddition()),structureBuffer:String(rule.source==='structure'?rule.structure?.buffer??0:0),
  ...conditionDraft(undefined),extraConditions:qualityAdditionPrerequisites(rule).map(conditionDraft),...common};
};
const copyRound=(d:RoundDraft):RoundDraft=>({entryDistanceAtr:d.entryDistanceAtr,gainBasis:d.gainBasis,source:d.source,structure:structuredClone(d.structure),structureBuffer:d.structureBuffer,stricterPct:d.stricterPct,choice:d.choice,direction:d.direction,threshold:d.threshold,extraConditions:structuredClone(d.extraConditions),gainEnabled:d.gainEnabled,minGainPct:d.minGainPct,supportOffsetAtr:d.supportOffsetAtr,sellSwitch:{...d.sellSwitch,enabled:false},entryVetoes:structuredClone(d.entryVetoes),detectorPre:{...d.detectorPre}});
export function additionDraft(rule=defaultQualityAddition(),sellStages?:readonly QualitySellStage[]):AdditionDraft {
 const count=rule.maxRounds??(rule.repeat===false?1:3),stages=orderedSellStages({sellStages:[...(sellStages??[])]}),stageAt=(n:number)=>stages.find(s=>s.afterAdditions===n);
 const first=roundDraft(rule.rounds?.[0]??rule,stageAt(1),rule.enabled),later=stages.filter(s=>s.afterAdditions>count);
 return {...first,...(rule.kStopVersion?{kStopVersion:rule.kStopVersion}:{}),enabled:rule.enabled,quantityMode:'calculator',quantity:'1',repeat:count>1,maxRounds:String(count),otherRounds:Array.from({length:count-1},(_,i)=>roundDraft(rule.rounds?.[i+1]??rule,stageAt(i+2),rule.enabled)),supportReduction:(r=>({enabled:r.enabled,minDropAtr:String(r.minDropAtr),maxPct:String(r.maxPct),exitEnabled:r.exitAfterDrops!=null,exitAfterDrops:String(r.exitAfterDrops??3),...(r.version===2?{version:2 as const}:{})}))(rule.supportReduction??defaultSupportReduction()),geometricLock:(g=>({enabled:g.enabled,multiple:String(g.multiple),pct:String(g.pct)}))(rule.geometricLock??defaultGeometricLock()),breakevenFloor:(f=>({enabled:f.enabled,atr:String(f.atr)}))(rule.breakevenFloor??defaultBreakevenFloor()),...(later.length?{laterSellStages:later}:{})};
}
function parseRound(d:RoundDraft,enabled:boolean,defs:readonly DeepDigFeatureDef[]):QualityAdditionRoundRule{
 const rule:QualityAdditionRoundRule={source:d.source,stricterPct:d.stricterPct.trim()?Number(d.stricterPct):NaN,supportOffsetAtr:d.source==='structure'?undefined:d.supportOffsetAtr.trim()?Number(d.supportOffsetAtr):NaN};
 if(d.source==='structure'){rule.structure={...structuredClone(d.structure),buffer:d.structureBuffer.trim()?Number(d.structureBuffer):NaN};if(!guardTrendOnly(rule.structure))delete rule.structure.guardTrendOnly;}
 const build=(rows:ConditionDraft[])=>rows.flatMap(row=>{try{return [makeQualityBuyFilter(row.choice,row.direction,row.threshold.trim()?Number(row.threshold):NaN,true,defs)];}catch(error){if(enabled)throw error;return [];}});
 if(d.source==='custom'){
  const conditions=build([d,...d.extraConditions]);
  rule.condition=conditions[0];if(conditions.length>1)rule.conditions=conditions;
 }else{const prerequisites=build(d.extraConditions);if(prerequisites.length)rule.prerequisites=prerequisites;}
 if(d.gainEnabled)rule.minGainPct=d.minGainPct.trim()?Number(d.minGainPct):NaN;
 if(d.gainEnabled&&d.gainBasis==='average')rule.gainBasis='average';
 if(d.source==='custom'&&d.entryDistanceAtr?.trim())rule.entryDistanceAtr=Number(d.entryDistanceAtr);
 if(d.source!=='custom'&&d.detectorPre?.enabled)rule.detectorPrerequisite={enabled:true,stricterPct:d.detectorPre.stricterPct.trim()?Number(d.detectorPre.stricterPct):NaN,...(d.detectorPre.featureId?{featureId:d.detectorPre.featureId}:{})};
 const num=(x:string)=>x.trim()?Number(x):NaN,vetoes=ADDITION_VETO_KINDS.filter(k=>d.entryVetoes?.[k]?.enabled).map(kind=>{const f=d.entryVetoes[kind],base=ADDITION_VETO_DEFAULTS[kind];
  // 冲高回落：ATR 与百分比各自可留空（留空＝不用这一项），两项都填时带上「且 / 或」
  if(kind==='pullback')return {kind,enabled:true,...(f.atr.trim()?{atr:num(f.atr)}:{}),...(f.pct.trim()?{pct:num(f.pct)}:{}),...(f.atr.trim()&&f.pct.trim()?{join:f.join??'and'}:{}),...(f.sticky?{sticky:true}:{})} as QualityAdditionEntryVeto;
  if(kind==='pullback-atr')return {kind,enabled:true,atr:num(f.atr),...(f.sticky?{sticky:true}:{})} as QualityAdditionEntryVeto;
  return {kind,enabled:true,...(base.lookbackBars!=null?{lookbackBars:num(f.lookbackBars)}:{}),...(base.atr!=null?{atr:num(f.atr)}:{}),...(base.ratio!=null?{ratio:num(f.ratio)}:{}),...(base.pct!=null?{pct:num(f.pct)}:{}),...(base.er!=null?{er:num(f.er)}:{}),...(base.windows!=null?{windows:(f.windows??[]).filter(w=>w.pct.trim()).map(w=>({minutes:num(w.minutes),pct:num(w.pct)}))}:{})};});
 if(vetoes.length)rule.entryVetoes=vetoes;
 return rule;
}
const roundCount=(d:Pick<AdditionDraft,'maxRounds'>)=>{const n=d.maxRounds.trim()?Number(d.maxRounds):NaN;return Number.isInteger(n)&&n>=1&&n<=100?n:1;};
export function parseAdditionDraft(d:AdditionDraft,defs:readonly DeepDigFeatureDef[]):QualityAdditionRule{
 const count=d.maxRounds.trim()?Number(d.maxRounds):NaN;
 if(d.enabled&&(!Number.isInteger(count)||count<1||count>100))throw new Error('最多加仓次数须为 1 至 100 的整数');
 const n=roundCount(d);
 // 【用户要求】2026-11-02 保存时冻结箱体算法版本（防守线参数写成明确值）
 const rounds=Array.from({length:n},(_,i)=>{try{const r=parseRound(i?d.otherRounds[i-1]??d:d,d.enabled,defs);return r.structure?{...r,structure:freezeStructureVersions(r.structure)}:r;}catch(e){throw new Error(`第 ${i+1} 次加仓：${e instanceof Error?e.message:'条件无效'}`);}});
 const cut=d.supportReduction,num=(x:string)=>x.trim()?Number(x):NaN;
 const rule:QualityAdditionRule={enabled:d.enabled,...(d.kStopVersion?{kStopVersion:d.kStopVersion}:{}),quantityMode:'calculator',quantity:1,repeat:n>1,maxRounds:n,rounds,...rounds[0],...(cut?.enabled?{supportReduction:{enabled:true,minDropAtr:num(cut.minDropAtr),maxPct:num(cut.maxPct),...(cut.exitEnabled?{exitAfterDrops:num(cut.exitAfterDrops??'')}:{}),...(cut.version===2?{version:2 as const}:{})}}:{}),...(d.geometricLock?.enabled?{geometricLock:{enabled:true,multiple:num(d.geometricLock.multiple),pct:num(d.geometricLock.pct)}}:{}),...(d.breakevenFloor?.enabled?{breakevenFloor:{enabled:true,atr:num(d.breakevenFloor.atr)}}:{})};validateQualityAddition(rule);return rule;
}
/** 各次加仓「卖出」里设置的改用卖出算法 → 方案的 sellStages；没有任何切换时返回 undefined。 */
export function parseAdditionSellStages(d:AdditionDraft,defs:readonly DeepDigFeatureDef[]):QualitySellStage[]|undefined{
 const n=roundCount(d),stages:QualitySellStage[]=[];
 for(let i=0;i<n;i++){
  const s=(i?d.otherRounds[i-1]??d:d).sellSwitch;if(!s?.enabled)continue;
  const threshold=s.threshold.trim()?Number(s.threshold):NaN;
  if(!s.choice||!Number.isFinite(threshold))throw new Error(`第 ${i+1} 次加仓：改用的卖出算法须选择指标并填写有限数字门槛`);
  const plan=makeQualitySellPlan(s.choice,s.direction,threshold,defs);
  stages.push({afterAdditions:i+1,label:plan.label,metric:plan.metric,snapshot:plan.snapshot,rule:plan.rule!});
 }
 const all=[...stages,...(d.laterSellStages??[])];
 return all.length?all.sort((a,b)=>a.afterAdditions-b.afterAdditions):undefined;
}
const field='h-8 min-w-0 rounded-md border border-border/60 bg-background px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40';
/** 回放预设：每组只设这三项，false＝取消勾选。 */
const VETO_PRESETS:{name:string;detail:string;set:Partial<Record<AdditionEntryVetoKind,Partial<VetoFieldDraft>|false>>}[]=[
 {name:'保大单',detail:'冲高回落 ≥2.5 ATR 且 ≥4% · +5600.9，4 笔由平转赚、无一变差，SAPIEN 保住 +3936',set:{pullback:{atr:'2.5',pct:'4',join:'and',sticky:true},'pullback-atr':false,'upper-wick':false}},
 {name:'高胜率',detail:'冲高回落·仅 ATR ≥2.5 · 44 场 +2512.9（基准 +5592.2），赚/亏/平 21/3/20，COOKIE 0 → +304，但 SAPIEN +3936 → +533',set:{pullback:false,'pullback-atr':{atr:'2.5',sticky:true},'upper-wick':false}},
 {name:'高胜率+长上影',detail:'冲高回落·仅 ATR ≥2.5 + 长上影 近 12 根 ≥1.5 ATR 且占整根 ≥60% · 44 场 +2541.2，赚/亏/平 22/3/19（比「高胜率」多救回 ONT +28.4），SAPIEN 同样 +3936 → +533',set:{pullback:false,'pullback-atr':{atr:'2.5',sticky:true},'upper-wick':{lookbackBars:'12',atr:'1.5',ratio:'60'}}},
];
/** 数字输入：同高、居中、等宽数字，所有条件行对齐。 */
const cell=field+' h-7 px-1 text-center tabular-nums';
/** 说明弹窗里的一小节：短标题 + 正文，替代大段连续文字。 */
function InfoBlock({title,children}:{title:string;children:ReactNode}){
 return <section className="space-y-1"><h6 className="text-[11px] font-medium text-foreground">{title}</h6><div className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">{children}</div></section>;
}
function Part({title,role,info,children,testId}:{title:string;role:string;info:ReactNode;children:ReactNode;testId:string}){
 return <section className="space-y-2 rounded-md border border-border/60 bg-background/60 p-2.5" data-testid={testId}>
  <div className="flex items-center gap-1.5"><h5 className="text-[11px] font-medium">{title}</h5><span className="text-[10px] text-muted-foreground">{role}</span><FishQualityInfo label={`${title}说明`}>{info}</FishQualityInfo></div>
  {children}
 </section>;
}
/** vetoStages：每次加仓「卖出」里的否决条件，存为方案的 vetoStages（afterAdditions = 第几次），与硬性终止同一套条件和引擎。 */
export function FishQualityAdditionEditor({draft:all,setDraft,vetoStages,setVetoStages}:{draft:AdditionDraft;setDraft:(draft:AdditionDraft)=>void;vetoStages?:VetoStagesDraft;setVetoStages?:(draft:VetoStagesDraft)=>void}) {
 const defs=useFeatureDefinitions(),choices=useMemo(()=>qualityFilterChoices(defs),[defs]);
 const features=[...new Map(choices.map(c=>[c.featureId,c.group])).entries()];
 const [selectedRound,setSelectedRound]=useState(0),count=Math.min(100,Math.max(1,Math.floor(Number(all.maxRounds)||1))),index=Math.min(selectedRound,count-1);
 const current=index?all.otherRounds[index-1]??all:all,d={...all,...current};
 const patch=(p:Partial<AdditionDraft>)=>{if('enabled' in p){setDraft({...all,...p});return;}if(!index){setDraft({...all,...p});return;}const others=Array.from({length:Math.max(count-1,all.otherRounds.length)},(_,i)=>all.otherRounds[i]??copyRound(all));others[index-1]={...current,...p};setDraft({...all,otherRounds:others});};
 const setLimit=(value:string)=>{const limit=Math.min(100,Math.max(1,Math.floor(Number(value)||1)));const others=Array.from({length:Math.max(limit-1,all.otherRounds.length)},(_,i)=>all.otherRounds[i]??copyRound(all));setSelectedRound(Math.min(index,limit-1));setDraft({...all,maxRounds:value,repeat:limit>1,otherRounds:others});};
 /** 特征值 + 变量 + 方向 + 门槛，一行。 */
 const indicator=(row:ConditionDraft,label:string,update:(change:Partial<ConditionDraft>)=>void,disabled=!d.enabled)=>{
  const feature=choices.find(c=>c.key===row.choice)?.featureId??'';
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem_5rem] gap-1.5">
   <select aria-label={label.replace('{x}','特征值')} disabled={disabled} value={feature} className={field} onChange={e=>update({choice:choices.find(c=>c.featureId===e.target.value)!.key})}><option value="" disabled>选择特征值</option>{features.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select>
   <select aria-label={label.replace('{x}','指标变量')} disabled={disabled} value={row.choice} className={field} onChange={e=>update({choice:e.target.value})}><option value="" disabled>选择变量</option>{choices.filter(c=>c.featureId===feature).map(c=><option key={c.key} value={c.key}>{c.label}</option>)}</select>
   <select aria-label={label.replace('{x}','方向')} className={field} disabled={disabled} value={row.direction} onChange={e=>update({direction:e.target.value as '<'|'>'})}><option value=">">&gt;</option><option value="<">&lt;</option></select>
   <input aria-label={label.replace('{x}','指标门槛')} className={field} disabled={disabled} type="number" step="any" placeholder="门槛" value={row.threshold} onChange={e=>update({threshold:e.target.value})}/>
  </div>;
 };
 const prerequisiteRow=(row:ConditionDraft,i:number)=><div key={i} className="flex items-center gap-1.5" data-testid="addition-prerequisite">
  <div className="min-w-0 flex-1">{indicator(row,`加仓方向条件 ${i+1} {x}`,change=>patch({extraConditions:d.extraConditions.map((item,j)=>j===i?{...item,...change}:item)}))}</div>
  <button type="button" disabled={!d.enabled} aria-label={`删除加仓方向条件 ${i+1}`} className="shrink-0 px-1 text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-40" onClick={()=>patch({extraConditions:d.extraConditions.filter((_,j)=>j!==i)})}>删除</button>
 </div>;
 const box=d.source==='structure';
 return <section className="space-y-3 rounded-lg border border-primary/20 bg-primary/[0.03] p-3" data-testid="quality-addition-editor">
  <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-1.5"><h4 className="text-xs font-medium">③ 加仓细节</h4><FishQualityInfo label="加仓细节说明">
   <div className="space-y-3">
    <InfoBlock title="每次加仓：三段依次判断">
     <ol className="list-decimal space-y-0.5 pl-4">
      <li><b className="font-medium text-foreground">方向</b>（前提）：指标与涨幅门槛须全部满足，否则不加仓。</li>
      <li><b className="font-medium text-foreground">位置</b>（触发）：箱体算法在 5 分钟线上产生新 C 的那一刻加仓，按下一分钟开盘价成交。</li>
      <li><b className="font-medium text-foreground">卖出</b>：碰到 K 或任一否决条件达标，卖出全部持仓。</li>
     </ol>
     <p>各次加仓独立设置，改一次不影响其他次。</p>
    </InfoBlock>
    <InfoBlock title="加仓量（均衡公式）">
     <p className="rounded bg-muted/60 px-2 py-1 text-center font-mono text-foreground">Q × (K − S) + P = 新增币数 × (T − K)</p>
     <dl className="grid grid-cols-[1.25rem_1fr] gap-x-2 gap-y-0.5">
      <dt className="font-mono text-foreground">T</dt><dd>加仓价</dd>
      <dt className="font-mono text-foreground">K</dt><dd>均衡线，也是加仓后的止损线：K = 旧C 或新C − n×ATR（每次加仓自选）</dd>
      <dt className="font-mono text-foreground">C</dt><dd>箱体支撑：新 C 触发加仓；旧 C 是上一箱体的支撑，多留一个箱体作冗余</dd>
      <dt className="font-mono text-foreground">防</dt><dd>防守线（DBL-5）：新箱底抬高且与上一箱体重叠不到一半为上涨期，线＝箱底 − a×ATR、只升不降；否则为震荡期，线＝震荡区最低箱底 − b×ATR，区间内的小箱体不抬线。跌破须按 5 分钟收盘确认（上涨期 1 根、震荡期连续 2 根），确认后下一分钟开盘卖出。图上蓝色实线＝上涨期、虚线＝震荡期，都是防守线；细节见「位置」里防守线旁的 ⓘ</dd>
      <dt className="font-mono text-foreground">S</dt><dd>成本线：首轮为首次买入价，之后为上一次的 K</dd>
      <dt className="font-mono text-foreground">Q</dt><dd>加仓前持币数（首轮为镜像止盈后的剩余币数）</dd>
      <dt className="font-mono text-foreground">P</dt><dd>本轮可用落袋利润：首轮含镜像止盈利润，用过的不再重复用</dd>
     </dl>
    </InfoBlock>
    <InfoBlock title="时序">
     <ul className="list-disc space-y-0.5 pl-4">
      <li>首次加仓须在镜像止盈成交之后（卖出比例不限，须留有余仓），最早从下一分钟起检查。</li>
      <li>卖出与加仓同时触发时先卖出；同一分钟先后不明时优先止损，跳空按开盘价。</li>
      <li>只用新确认的收盘读数；ATR 为加仓时已收盘的 5 分钟 ATR(14)；续算不会重复加仓。</li>
     </ul>
    </InfoBlock>
    <InfoBlock title="收益口径">
     <p>收益率＝总盈亏 ÷ 累计投入；止盈、否决和分段切换仍以首次买入价为基准。保存后点「开始监测」生效，旧轮次保留。</p>
    </InfoBlock>
   </div>
  </FishQualityInfo></div><label className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"><input aria-label="启用条件加仓" type="checkbox" checked={d.enabled} onChange={e=>patch({enabled:e.target.checked})} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"/>启用</label></div>
  <div className="flex flex-wrap items-center gap-2"><label className="flex items-center gap-2 text-[11px] text-muted-foreground">最多加仓<input aria-label="最多加仓次数" type="number" min="1" max="100" step="1" disabled={!d.enabled} value={all.maxRounds} onChange={e=>setLimit(e.target.value)} className={field+' w-16'}/>次</label>
   <div role="tablist" aria-label="选择加仓轮次" className="flex flex-wrap gap-1">{Array.from({length:count},(_,i)=><button key={i} type="button" role="tab" aria-selected={index===i} className={`rounded px-2 py-1 text-[11px] ${index===i?'bg-primary/15 text-primary':'bg-muted/40 text-muted-foreground hover:bg-muted'}`} onClick={()=>setSelectedRound(i)}>第 {i+1} 次</button>)}</div></div>

  <Part title="方向" role="必要不充分 · 位置那一刻须全部满足" testId="addition-prerequisites" info={<p>方向条件本身不会触发加仓：只有在「位置」达到的那一刻，下列指标和涨幅门槛全部满足，这次加仓才成立；不满足就等下一个位置。指标只读当时最后一根已收盘 K 线。涨幅门槛＝那一刻收盘价相对最新成本线 S 的涨幅（首轮 S 为首次买入价，之后为上一次加仓的 K）。探测算法：这条信号的原探测算法（或只选其中一个）在那一刻的读数，须沿原探测方向达到原门槛再提高 x%（调整量＝原门槛绝对值 × x%，原门槛为 0 时按 1 个单位）；信号没有所选的探测算法就不加仓。</p>}>
   <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-[11px]">
   {d.source!=='custom'&&(()=>{const dp=d.detectorPre??{enabled:false,featureId:'',stricterPct:'10'},setDp=(next:Partial<DetectorPreDraft>)=>patch({detectorPre:{...dp,...next}});
    return <><label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" aria-label="启用探测算法方向条件" disabled={!d.enabled} checked={dp.enabled} onChange={e=>setDp({enabled:e.target.checked})}/><span className={dp.enabled?'font-medium':'text-muted-foreground'}>探测算法</span></label>
     <div className={`flex flex-wrap items-center gap-1.5 text-muted-foreground ${dp.enabled?'':'opacity-55'}`} data-testid="addition-detector-prerequisite"><select aria-label="方向探测算法" disabled={!d.enabled||!dp.enabled} value={dp.featureId} onChange={e=>setDp({featureId:e.target.value})} className={field+' h-7 w-52'}><option value="">全部原探测算法（同时满足）</option>{features.map(([id,group])=><option key={id} value={id}>{group}</option>)}</select>探测值比原门槛提高 ≥<input aria-label="探测值提高百分比" type="number" min="0" step="any" disabled={!d.enabled||!dp.enabled} value={dp.stricterPct} onChange={e=>setDp({stricterPct:e.target.value})} className={cell+' w-14'}/>%</div></>;})()}
    <label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" aria-label="启用加仓涨幅门槛" disabled={!d.enabled} checked={d.gainEnabled} onChange={e=>patch({gainEnabled:e.target.checked})}/><span className={d.gainEnabled?'font-medium':'text-muted-foreground'}>涨幅门槛</span></label>
    <div className={`flex items-center gap-1.5 text-muted-foreground ${d.gainEnabled?'':'opacity-55'}`}>{/* 2026-11-04 涨幅门槛基准可选：相对成本线 S（11-01 起）或相对持仓均价（10-31 版） */}<select aria-label="涨幅门槛基准" disabled={!d.enabled||!d.gainEnabled} value={d.gainBasis??'cost-line'} onChange={e=>patch({gainBasis:e.target.value as 'average'|'cost-line'})} className={field+' h-7 px-1.5'}><option value="cost-line">相对最新成本线 S</option><option value="average">相对持仓均价</option></select>上涨 ≥<input aria-label="加仓涨幅门槛" type="number" min="0" step="any" disabled={!d.enabled||!d.gainEnabled} className={cell+' w-14'} value={d.minGainPct} onChange={e=>patch({minGainPct:e.target.value})}/>%</div>
    <span className="self-start pt-1.5 text-muted-foreground">指标条件</span>
    <div className="space-y-1.5">{d.extraConditions.map(prerequisiteRow)}<button type="button" disabled={!d.enabled} className="text-[11px] text-primary disabled:opacity-40" onClick={()=>patch({extraConditions:[...d.extraConditions,{choice:choices[0]?.key??'',direction:'>',threshold:'0'}]})}>＋ 添加方向条件</button></div>
   </div>
  </Part>

  {/* 【用户要求】2026-11-03 否决与位置要整齐紧凑：左列条件名 / 标签定宽，右列参数同高同宽、居中对齐；长说明进 ⓘ */}
  <Part title="否决" role="任一成立则这次不加仓 · 等下一个新 C" testId="addition-vetoes" info={<div className="space-y-2">
   <p>方向满足、新 C 出现之后再看这里：任一勾选的条件在加仓那一刻成立，这一次就不加仓，继续等下一个新 C。只用已收盘的 5 分钟 K 线，ATR 为 5 分钟 ATR(14)。</p>
   <ul className="list-disc space-y-0.5 pl-4"><li>持仓期间急跌：买入后任意 N 分钟内（窗口首根开盘 → 末根收盘）跌幅达到设定值，与硬性终止「N 分钟内跌幅」同口径；跌幅留空即不用这一组。</li><li>长上影线：冲高被砸，上方抛压重。</li><li>向下大插针：有人砸盘、扫止损，K 容易被打到。</li><li>高震荡：波动放大或来回多、净涨少，加仓后被扫几乎必然。</li><li>未收复最高点前不再加（冲高回落两行各自可勾）：某次加仓被冲高回落否决后锁住，之后只要还没有一根 5 分钟收盘价回到当时的持仓最高点，后面每一个新 C、每一次加仓都不加（不论那一次有没有勾否决）；收复后解锁。防止挡掉一次后在下一个新 C 又加进去（PENGU 04-23 的情况）。</li><li>冲高回落·仅ATR：只按 ATR 判断回落、不看百分比。回放里胜率明显更高，但会把 SAPIEN 这类大单也挡掉（+3936 → +533）；与「冲高回落（且 4%）」各自勾选，同时勾上时以先成立的为准，相当于只用这一条。</li><li>冲高回落：从持仓最高点已明显回落、还没收复。可按 ATR、按百分比，或两者「且 / 或」组合；两项都填默认「且」；哪一项留空就不用那一项（回放里 ATR 更能分出成败，百分比适合再要求回落的绝对幅度够大）。</li></ul>
   <ul className="list-disc space-y-0.5 pl-4">
    <li>每一次加仓的否决各自独立：第 1、2、3……次各用自己标签页里勾选的条件，某一次没有勾就没有否决，不会沿用前一次的设置。</li>
    <li>冲高回落的「持仓最高点」从首次买入算起，不是从上一次加仓算起。</li>
    <li>持仓期间急跌从首次买入一直查到加仓那一刻：只要持仓中出现过一次，之后每一次加仓都会被否决，涨回去也不恢复。</li>
    <li>数据缺失时不否决：加仓那一刻拿不到 5 分钟 ATR，或「持仓期间急跌」缺 1 分钟线时，这些条件视为不成立，照常加仓。</li>
   </ul>
   <p>被否决的加仓会记在结果里（悬停卖出列可看时间与原因）。</p></div>}>
   {/* 【用户要求】2026-11-03 回放里的三组否决做成预设，点一下设好当前这一次加仓（之后仍可手改） */}
   <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground" data-testid="addition-veto-presets"><span>回放预设</span>
    {VETO_PRESETS.map(p=><button key={p.name} type="button" disabled={!d.enabled} title={p.detail} aria-label={`否决预设 ${p.name}`} className="rounded border border-border/60 px-2 py-0.5 hover:bg-muted disabled:opacity-40" onClick={()=>{const base=d.entryVetoes??vetoDraftOf(),next={...base};for(const [kind,v] of Object.entries(p.set) as [AdditionEntryVetoKind,Partial<VetoFieldDraft>|false][])next[kind]={...base[kind],...(v===false?{enabled:false}:{enabled:true,...v})};patch({entryVetoes:next});}}>{p.name}</button>)}
    <FishQualityInfo label="否决预设说明"><div className="space-y-1.5 text-[11px]"><p>「组合算法1」44 场回放（基准约 +5590；去掉最赚 2 笔后基准约 +230）：</p><ul className="list-disc space-y-0.5 pl-4">{VETO_PRESETS.map(p=><li key={p.name}><span className="font-medium">{p.name}</span>：{p.detail}</li>)}</ul><p className="text-muted-foreground">预设只改冲高回落、冲高回落·仅ATR、长上影线三项，其他否决保持原样；只作用于当前选中的这一次加仓。</p></div></FishQualityInfo></div>
   <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-[11px]">
   {ADDITION_VETO_KINDS.map(kind=>{const f=d.entryVetoes?.[kind]??vetoDraftOf()[kind],off=!d.enabled||!f.enabled,set=(next:Partial<VetoFieldDraft>)=>patch({entryVetoes:{...(d.entryVetoes??vetoDraftOf()),[kind]:{...f,...next}}}),num=(key:keyof Omit<VetoFieldDraft,'enabled'|'windows'|'join'|'sticky'>,label:string,w='w-14')=><input aria-label={`${ADDITION_VETO_LABELS[kind]} ${label}`} type="number" step="any" disabled={off} value={f[key]} onChange={e=>set({[key]:e.target.value})} className={cell+' '+w}/>;
    return <Fragment key={kind}><label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" aria-label={`启用加仓否决 ${ADDITION_VETO_LABELS[kind]}`} disabled={!d.enabled} checked={f.enabled} onChange={e=>set({enabled:e.target.checked})}/><span className={`font-medium ${f.enabled?'':'text-muted-foreground'}`}>{ADDITION_VETO_LABELS[kind]}</span></label>
     <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground ${f.enabled?'':'opacity-55'}`} data-testid={`addition-veto-${kind}`}>{kind==='upper-wick'?<>近{num('lookbackBars','回看根数','w-12')}根 · 上影 ≥{num('atr','ATR倍数')}ATR 且占整根 ≥{num('ratio','上影占比','w-12')}%</>
      :kind==='lower-spike'?<>近{num('lookbackBars','回看根数','w-12')}根 · 下影 ≥{num('atr','ATR倍数')}ATR 或低于前收 ≥{num('pct','跌幅','w-12')}%</>
      :kind==='volatility'?<>ATR ≥ 6 小时中位 ×{num('ratio','ATR放大倍数')}或 ER(24) ≤{num('er','效率比')}</>
      :kind==='pullback-atr'?<>距持仓最高点回落 ≥{num('atr','回落ATR倍数')}ATR<span className="text-[10px] text-muted-foreground/70">不看百分比</span><label className="ml-1 inline-flex items-center gap-1 whitespace-nowrap text-[10px]"><input type="checkbox" className="h-3 w-3" aria-label={`${ADDITION_VETO_LABELS[kind]} 未收复最高点前不再加`} disabled={off} checked={!!f.sticky} onChange={e=>set({sticky:e.target.checked})}/>未收复最高点前不再加</label></>:kind==='fast-drop'?<>{(f.windows??[]).map((w,i)=><span key={i} className="inline-flex items-center gap-1 whitespace-nowrap">{i>0&&<span className="px-0.5 text-muted-foreground/50">·</span>}<input aria-label={`持仓期间急跌 第${i+1}组分钟`} type="number" step="1" min="1" disabled={off} value={w.minutes} onChange={e=>set({windows:f.windows.map((x,j)=>j===i?{...x,minutes:e.target.value}:x)})} className={cell+' w-11'}/>分钟跌 ≥<input aria-label={`持仓期间急跌 第${i+1}组跌幅`} type="number" step="any" placeholder="不用" disabled={off} value={w.pct} onChange={e=>set({windows:f.windows.map((x,j)=>j===i?{...x,pct:e.target.value}:x)})} className={cell+' w-12'}/>%</span>)}</>
      :<>距持仓最高点回落 ≥{num('atr','回落ATR倍数')}ATR<select aria-label="冲高回落组合方式" disabled={off} value={f.join??'and'} onChange={e=>set({join:e.target.value as 'and'|'or'})} className={field+' h-7 px-1.5'}><option value="and">且</option><option value="or">或</option></select>≥{num('pct','回落百分比')}%<label className="ml-1 inline-flex items-center gap-1 whitespace-nowrap text-[10px]"><input type="checkbox" className="h-3 w-3" aria-label={`${ADDITION_VETO_LABELS[kind]} 未收复最高点前不再加`} disabled={off} checked={!!f.sticky} onChange={e=>set({sticky:e.target.checked})}/>未收复最高点前不再加</label></>}</div></Fragment>;})}
   </div>
  </Part>
  <Part title="位置" role="必要充分 · 达到即加仓" testId="addition-timing" info={<div className="space-y-3">
   <InfoBlock title="指标 · S / T / K">
    <p>加仓条件（自选指标）在 5 分钟收盘达标、且加仓价 T 比最新成本线 S 至少高出 n 个 5 分钟 ATR(14) 时加仓（入场距离留空＝不检查）；K＝T − m × ATR，碰到 K 卖出全部持仓。S：首次加仓为首次买入价，之后为上一次加仓的 K。「方向」里的其它指标条件须在同一时刻同时满足。</p>
    <p>这是 10-31 时的加仓方式（11-01 改成箱体位置后一度取消，11-04 应用户要求恢复）；涨幅门槛选「相对持仓均价」即与 10-31 版同一口径。</p>
   </InfoBlock>
   <InfoBlock title="箱体位置（5 分钟线）">
    <p>新 C（{d.structure.algorithm==='dbl5'?'DBL-5 支撑抬高含完整台阶与内部箱底抬高':'SBS-5M 确认已含冻结后的独立测试；回踩只用正式支撑的再次测试成功'}）收盘确认后，下一分钟开盘加仓；每个箱体最多加仓一次，候选箱体不参与。</p>
   </InfoBlock>
   <InfoBlock title="K = 旧C / 新C − n × ATR">
    <p>每次加仓自己选 K 的基准。旧 C（默认）：新 C 产生前仍然有效的上一箱体支撑，始终多留一个箱体空间作冗余，给行情呼吸的时间。新 C：本次事件刚产生的箱体支撑，K 更高、同一位置可加的币数更多，但止损也更近。K 再减去 n 个 5 分钟 ATR(14)（n 可为 0）；成交价位按交易所报价步长向下取整。</p>
    <p>选旧 C 时：首个箱体、或中途支撑失效时没有旧 C，不加仓。无论哪种，新 K 低于上一次的 K 时都不加仓。</p>
    <p>K 最小距离：K 离加仓价 T 不足 x% 时，改用 T×(1−x%) 当 K（按报价步长向下取整），加仓量和碰 K 卖出都按它算。回放里失败的加仓多是 K 只离现价 1–2%，正常抖动就碰到，平衡公式又把加仓放大 5–9 倍；放宽后加得更少、也不容易被扫。放宽后若低于上一次的 K，这次照样不加。留空＝不限。</p>
   </InfoBlock>
  </div>}>
   <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-[11px]">
    <span className="text-muted-foreground">位置算法</span>
    <select aria-label="加仓条件来源" disabled={!d.enabled} value={d.source} className={field+' h-7 w-full'} onChange={e=>patch({source:e.target.value as AdditionDraft['source'],choice:d.choice||choices[0]?.key||'',...(e.target.value==='structure'?{structure:defaultStructureAddition(d.structure.algorithm,defs),structureBuffer:'0'}:{entryDistanceAtr:d.entryDistanceAtr||'2',supportOffsetAtr:d.supportOffsetAtr||'1.5'})})}><option value="structure">箱体 · DBL / SBS</option><option value="custom">指标 · S / T / K</option></select>
    {/* 【用户要求】2026-11-04 恢复「指标＋入场距离（S/T/K）」：指标达标、且 T 高出成本线 S 足够时加仓，K＝T−m×ATR */}
    {d.source==='custom'&&<><span className="text-muted-foreground">加仓条件</span>
    <div data-testid="addition-sttk-trigger">{indicator(d,'加仓条件 {x}',change=>patch(change))}</div>
    <span className="text-muted-foreground">入场距离</span>
    <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground" data-testid="addition-entry-distance">T ≥ S ＋<input aria-label="入场距离ATR倍数" type="number" min="0" step="any" placeholder="不限" disabled={!d.enabled} value={d.entryDistanceAtr??''} onChange={e=>patch({entryDistanceAtr:e.target.value})} className={cell+' w-14'}/>ATR<span className="text-[10px] text-muted-foreground/70">T 加仓价 · S 成本线</span></div>
    <span className="text-muted-foreground">K =</span>
    <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground" data-testid="addition-sttk-k">T −<input aria-label="K回撤ATR倍数" type="number" min="0" step="any" disabled={!d.enabled} value={d.supportOffsetAtr} onChange={e=>patch({supportOffsetAtr:e.target.value})} className={cell+' w-14'}/>× ATR</div></>}
    {box&&<><span className="text-muted-foreground">箱体算法</span>
    <div className="flex min-w-0 items-center gap-2"><select aria-label="箱体加仓算法" className={field+' h-7 min-w-0 flex-1'} disabled={!d.enabled} value={d.structure.algorithm} onChange={e=>patch({structure:{...defaultStructureAddition(e.target.value as StructureAdditionRule['algorithm'],defs),kSource:e.target.value==='sbs5m'&&d.structure.kSource==='guard'?'previous':d.structure.kSource}})}><option value="dbl5">{boxAlgorithmVersion(CURRENT_BOX_VERSION.dbl5)!.label} · 达瓦斯下轨</option><option value="sbs5m">{boxAlgorithmVersion(CURRENT_BOX_VERSION.sbs5m)!.label} · 台阶支撑</option></select><span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-primary" data-testid="addition-box-version" title="保存时冻结的版本">{structureVersionLabel(d.structure)}</span><FishQualityInfo label="箱体算法版本说明"><BoxAlgorithmVersionNotes/></FishQualityInfo></div>
    <span className="text-muted-foreground">触发事件</span>
    <select aria-label="箱体加仓时机" className={field+' h-7 w-full'} disabled={!d.enabled} value={d.structure.trigger} onChange={e=>patch({structure:{...d.structure,trigger:e.target.value as StructureAdditionRule['trigger']}})}><option value="raise">支撑抬高确认</option><option value="confirm">新箱体确认（含基准）</option>{d.structure.algorithm==='sbs5m'&&<option value="retest">独立回踩成功</option>}</select></>}
    {box&&<><span className="text-muted-foreground">K =</span>
    <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground" data-testid="addition-k-row"><select aria-label="K基准箱体" title="旧C：上一箱体的支撑（多留一个箱体作冗余）；新C：本次事件刚产生的箱体支撑；防守线：DBL-5 分上涨 / 震荡留冗余、收盘确认跌破的线" className={field+' h-7 w-36'} disabled={!d.enabled} value={d.structure.kSource??'previous'} onChange={e=>patch({structure:{...d.structure,kSource:e.target.value as NonNullable<StructureAdditionRule['kSource']>}})}><option value="previous">旧C</option><option value="current">新C</option>{d.structure.algorithm==='dbl5'&&<option value="guard">{boxAlgorithmVersion(CURRENT_GUARD_VERSION)!.label}（更结实）</option>}</select>−<input aria-label="箱体支撑冗余" type="number" min="0" step="any" disabled={!d.enabled} value={d.structureBuffer} onChange={e=>patch({structureBuffer:e.target.value,structure:{...d.structure,bufferUnit:'atr'}})} className={cell+' w-14'}/>{d.structure.bufferUnit==='percent'?'% × C':'× ATR'}</div>
    {d.structure.kSource==='guard'&&<><span className="flex items-center gap-1 text-muted-foreground">防守线<FishQualityInfo label="防守线说明"><GuardLineNotes/></FishQualityInfo></span>
    <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground" data-testid="addition-guard-row"><select aria-label="防守线类型" className={field+' h-7 w-28'} disabled={!d.enabled} value={d.structure.guardTrendOnly?'trend':'both'} onChange={e=>patch({structure:{...d.structure,guardTrendOnly:e.target.value==='trend'?true:undefined}})}><option value="both">实线和虚线</option><option value="trend">只用实线</option></select><span className="px-0.5 text-muted-foreground/50">·</span>上涨期 箱底 −<input aria-label="上涨期防守冗余" type="number" min="0" step="0.1" disabled={!d.enabled} value={d.structure.definition.DBL5_config?.guard_trend_atr??DBL5_GUARD_DEFAULTS.guard_trend_atr} onChange={e=>{const v=Number(e.target.value);if(e.target.value!==''&&Number.isFinite(v)&&v>=0)patch({structure:{...d.structure,definition:{...d.structure.definition,DBL5_config:{...d.structure.definition.DBL5_config,guard_trend_atr:v}}}});}} className={cell+' w-14'}/>ATR<span className="px-0.5 text-muted-foreground/50">·</span>震荡期 区间底 −<input aria-label="震荡期防守冗余" type="number" min="0" step="0.1" disabled={!d.enabled} value={d.structure.definition.DBL5_config?.guard_range_atr??DBL5_GUARD_DEFAULTS.guard_range_atr} onChange={e=>{const v=Number(e.target.value);if(e.target.value!==''&&Number.isFinite(v)&&v>=0)patch({structure:{...d.structure,definition:{...d.structure.definition,DBL5_config:{...d.structure.definition.DBL5_config,guard_range_atr:v}}}});}} className={cell+' w-14'}/>ATR</div></>}
    <span className="text-muted-foreground">最小距离</span>
    <div className="flex flex-wrap items-center gap-1.5 text-muted-foreground" data-testid="addition-k-min-distance">K 离加仓价 ≥<input aria-label="K最小距离" type="number" min="0" step="0.1" placeholder="不限" disabled={!d.enabled} value={d.structure.minDistancePct??''} onChange={e=>{const v=e.target.value.trim();patch({structure:{...d.structure,minDistancePct:v===''?undefined:Number(v)}});}} className={cell+' w-14'}/>%<span className="text-[10px] text-muted-foreground/70">不足按此算加仓量与止损</span></div></>}
   </div>
  </Part>

  <Part title="卖出" role="必要充分 · 任一达标即卖出全部持仓" testId="addition-sell" info={<div className="space-y-2">
   <p>这里的卖出条件与 ④ 硬性终止并列：任何一个先达标，都立即卖出全部仓位（含各次加仓买入的部分）。</p>
   <p>碰到 K：本次加仓后价格跌到「位置」里算出的 K 即卖出全部持仓，跳空按开盘价；同一分钟先后不明时优先止损。这一条始终生效。</p>
   <p>否决条件：本次加仓实际成交后开始检查，可添加多条，任一条达标即卖出全部持仓；条件类型与 ④ 硬性终止相同（静态 / 动态回撤、1 / 5 分钟内跌幅、指标、加仓止盈约束）。后面某次加仓没有另设时，继续沿用这里的条件。</p>
   <p>与硬性终止：「同类替换」时，这里的某类条件替换硬性终止里的同类条件（如动态回撤 20% 改为 15%），其他硬性终止条件照常生效；「整组替换」时只用这里的条件。回撤峰值可沿用持仓最高价，或从本次加仓成交价重新记录。这两项对各次加仓通用。</p>
   <p>支撑线下移时减仓（减仓计算器同一公式）：最近一次加仓所依据的支撑线（选防守线时为防守线）在 5 分钟收盘时下移 ≥ n×ATR，而价格仍在原 K 之上，就把止损 K 挪到新支撑算出的 K′，并在下一分钟开盘价 T 减仓 X＝(S−K′)÷(T−K′)，S 为整笔保本价（扣除镜像止盈与此前减仓已落袋的利润）。这样之后碰到 K′ 时整笔仍约保本。X≤0 时只挪 K′ 不减仓；X≥1 或超过单次上限时不减仓、K 不动。减仓落袋的利润计入之后加仓的可用利润 G。</p>
   <p>保住有效涨幅：整笔几何仓位 M（现持币数 ÷ 首仓币数）大于门槛（默认 10）时，止损线从最近一次加仓的 Kₘ 上移到 Kₘ＋x%×首次开仓价 E（默认 x＝1%），价格盘中碰到即卖出全部持仓（跳空按开盘价）。这样卖出时开仓价的有效涨幅 ΔP÷E＝(卖出价−Kₘ)÷E 至少约为 x%。这条线不等收盘确认：即使 K 取防守线，碰线也当场卖出。M 不超过门槛时照旧按 K 卖出；之后的加仓把 Kₘ 换成新的 K，线随之重算。</p>
   <p>K 连续下移 N 次即全仓卖出：自最近一次加仓起，K 每下移一次计一次（加仓把 K 上移后重新计数）；第 N 次下移确认时不再减仓，按下一分钟开盘价卖出全部持仓。</p>
   <p>改用的卖出算法：本次加仓实际成交后，普通卖出算法换成这里设置的指标，直到下一次加仓另有设置；未设置则沿用之前的卖出算法。半仓镜像与硬性终止继续生效。</p>
  </div>}>
   <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 text-[11px]">
    <label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" checked disabled aria-label="碰到K卖出"/><span className="font-medium">碰到 K</span></label>
    <div className="space-y-1 text-muted-foreground" data-testid="addition-sell-k"><select aria-label="碰到K执行版本" className={field+' h-7'} disabled={!d.enabled} value={all.kStopVersion??'legacy'} onChange={e=>setDraft({...all,kStopVersion:e.target.value===ADDITION_K_TOUCH_VERSION?ADDITION_K_TOUCH_VERSION:undefined})}><option value={ADDITION_K_TOUCH_VERSION}>即时触价新版 · 碰到 K 全仓卖出（最灵敏）</option><option value="legacy">保留原版执行方式</option></select><p>{all.kStopVersion===ADDITION_K_TOUCH_VERSION?'低于或等于 K 即按 K 卖出全部余仓与加仓；开盘越线按开盘价。影线算，不等 1 分钟或 5 分钟收盘确认。':d.structure.kSource==='guard'&&d.source==='structure'?'原版：5 分钟收盘跌破 K 即卖出（上涨期 1 根、震荡期连续 2 根；影线不算）。':'原版：价格碰到 K 即卖出全部持仓。'}</p>{all.kStopVersion===ADDITION_K_TOUCH_VERSION&&<p className="text-[10px] text-primary">各次加仓的 K / K′ 均使用即时触价。保存后运行新轮次；旧轮次和旧版保留，加仓量仍沿用原公式与保本底线设置。</p>}</div>
   {(()=>{const cut:NonNullable<AdditionDraft['supportReduction']>=all.supportReduction??{enabled:false,minDropAtr:'0.5',maxPct:'80',exitEnabled:false,exitAfterDrops:'3',version:2},set=(next:Partial<typeof cut>)=>setDraft({...all,supportReduction:{...cut,...next}});
    return <><label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" aria-label="支撑线下移时减仓" disabled={!d.enabled} checked={cut.enabled} onChange={e=>set({enabled:e.target.checked})}/><span className={cut.enabled?'font-medium':'text-muted-foreground'}>支撑下移减仓</span></label>
     <div className={`flex flex-wrap items-center gap-1.5 text-muted-foreground ${cut.enabled?'':'opacity-55'}`} data-testid="addition-support-reduction">下移 ≥<input aria-label="支撑下移ATR倍数" type="number" min="0" step="any" disabled={!d.enabled||!cut.enabled} value={cut.minDropAtr} onChange={e=>set({minDropAtr:e.target.value})} className={cell+' w-14'}/>ATR<span className="px-0.5 text-muted-foreground/50">·</span>单次最多减<input aria-label="单次减仓上限" type="number" min="0" max="100" step="any" disabled={!d.enabled||!cut.enabled} value={cut.maxPct} onChange={e=>set({maxPct:e.target.value})} className={cell+' w-14'}/>%<span className="text-[10px] text-muted-foreground/70">各次通用</span>
      <label className="ml-1 inline-flex items-center gap-1 whitespace-nowrap" title="11-03 修正：减仓后加仓的成本线取整笔真实保本价，减仓所得不再重复计入落袋（不勾＝11-02 原版，已存的方案和模板照旧按原版算，结果不变）"><input type="checkbox" className="h-3 w-3 accent-[hsl(var(--primary))]" aria-label="减仓后不重复计落袋" disabled={!d.enabled||!cut.enabled} checked={cut.version===2} onChange={e=>set({version:e.target.checked?2:undefined})}/>减仓后不重复计落袋</label></div>
     <label className={`flex items-center gap-2 whitespace-nowrap ${cut.enabled?'':'opacity-55'}`}><input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" aria-label="K连续下移全仓卖出" disabled={!d.enabled||!cut.enabled} checked={!!cut.exitEnabled} onChange={e=>set({exitEnabled:e.target.checked})}/><span className={cut.exitEnabled&&cut.enabled?'font-medium':'text-muted-foreground'}>连续下移全卖</span></label>
     <div className={`flex flex-wrap items-center gap-1.5 text-muted-foreground ${cut.enabled&&cut.exitEnabled?'':'opacity-55'}`} data-testid="addition-support-drop-exit">K 连续下移<input aria-label="K连续下移次数" type="number" min="1" max="20" step="1" disabled={!d.enabled||!cut.enabled||!cut.exitEnabled} value={cut.exitAfterDrops??'3'} onChange={e=>set({exitAfterDrops:e.target.value})} className={cell+' w-14'}/>次即全仓卖出<span className="text-[10px] text-muted-foreground/70">加仓后重新计数</span></div></>;})()}
   {(()=>{const g:NonNullable<AdditionDraft['geometricLock']>=all.geometricLock??{enabled:false,multiple:'10',pct:'1'},set=(next:Partial<typeof g>)=>setDraft({...all,geometricLock:{...g,...next}});
    return <><label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" aria-label="几何仓位大时保住有效涨幅" disabled={!d.enabled} checked={g.enabled} onChange={e=>set({enabled:e.target.checked})}/><span className={g.enabled?'font-medium':'text-muted-foreground'}>保住有效涨幅</span></label>
     <div className={`flex flex-wrap items-center gap-1.5 text-muted-foreground ${g.enabled?'':'opacity-55'}`} data-testid="addition-geometric-lock">几何仓位 &gt;<input aria-label="几何仓位门槛" type="number" min="0" step="any" disabled={!d.enabled||!g.enabled} value={g.multiple} onChange={e=>set({multiple:e.target.value})} className={cell+' w-14'}/>时至少保留<input aria-label="保留开仓价有效涨幅百分比" type="number" min="0" max="100" step="any" disabled={!d.enabled||!g.enabled} value={g.pct} onChange={e=>set({pct:e.target.value})} className={cell+' w-14'}/>% 开仓价有效涨幅<span className="text-[10px] text-muted-foreground/70">止损上移到 Kₘ＋x%×E</span></div></>;})()}
   {(()=>{const f:NonNullable<AdditionDraft['breakevenFloor']>=all.breakevenFloor??{enabled:false,atr:String(defaultBreakevenFloor().atr)},set=(next:Partial<typeof f>)=>setDraft({...all,breakevenFloor:{...f,...next}});
    return <><label className="flex items-center gap-2 whitespace-nowrap"><input type="checkbox" className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" aria-label="防守线保本底线" disabled={!d.enabled} checked={f.enabled} onChange={e=>set({enabled:e.target.checked})}/><span className={f.enabled?'font-medium':'text-muted-foreground'}>保本底线</span><FishQualityInfo label="保本底线说明"><BreakevenFloorNotes immediate={all.kStopVersion===ADDITION_K_TOUCH_VERSION}/></FishQualityInfo></label>
     <div className={`flex flex-wrap items-center gap-1.5 text-muted-foreground ${f.enabled?'':'opacity-55'}`} data-testid="addition-breakeven-floor">F＝防守线 K −<input aria-label="保本底线ATR倍数" type="number" min="0" max="20" step="0.1" disabled={!d.enabled||!f.enabled} value={f.atr} onChange={e=>set({atr:e.target.value})} className={cell+' w-14'}/>ATR<span className="text-[10px] text-muted-foreground/70">盘中碰到即卖 · 加仓量按 F 算</span></div></>;})()}
   </div>
   {vetoStages&&setVetoStages&&(()=>{
    const n=index+1,at=vetoStages.stages.findIndex(s=>Number(s.afterAdditions)===n),stage=at<0?undefined:vetoStages.stages[at];
    const put=(conditions:HoldingVetoDraft[])=>{const rest=vetoStages.stages.filter((_,i)=>i!==at);
     const stages=conditions.length?[...rest,{afterAdditions:String(n),conditions}].sort((a,b)=>Number(a.afterAdditions)-Number(b.afterAdditions)):rest;
     setVetoStages({...vetoStages,enabled:stages.length>0,stages});};
    return <div className="space-y-2" data-testid="addition-sell-vetoes">
     <FishQualityHoldingVetoEditor compact labelPrefix={`第 ${n} 次加仓后 `} draft={stage?.conditions??[]} setDraft={put}/>
     {stage&&<div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-[10px] text-muted-foreground">与硬性终止（各次通用）<select aria-label="一票次数切换条件范围" className={field+' w-full'} value={vetoStages.mode} onChange={e=>setVetoStages({...vetoStages,mode:e.target.value as VetoStagesDraft['mode']})}><option value="overlay">同类替换，其余并存</option><option value="replace">整组替换</option></select></label>
      <label className="space-y-1 text-[10px] text-muted-foreground">回撤峰值（各次通用）<select aria-label="一票次数切换峰值口径" className={field+' w-full'} value={vetoStages.peakBasis} onChange={e=>setVetoStages({...vetoStages,peakBasis:e.target.value as VetoStagesDraft['peakBasis']})}><option value="stage">从本次加仓价重新记录</option><option value="holding">沿用持仓最高价</option></select></label>
     </div>}
    </div>;
   })()}
   <label className="inline-flex items-center gap-1.5 text-[11px]"><input type="checkbox" aria-label={`第 ${index+1} 次加仓后改用卖出算法`} checked={d.sellSwitch.enabled} onChange={e=>patch({sellSwitch:{...d.sellSwitch,enabled:e.target.checked,choice:d.sellSwitch.choice||choices[0]?.key||''}})}/>本次加仓后改用卖出算法</label>
   {d.sellSwitch.enabled&&indicator(d.sellSwitch,`第 ${index+1} 次加仓后卖出 {x}`,change=>patch({sellSwitch:{...d.sellSwitch,...change}}),false)}
  </Part>
  {!!all.laterSellStages?.length&&<p className="text-[10px] text-muted-foreground">另有 {all.laterSellStages.length} 个卖出切换设在第 {all.laterSellStages.map(s=>s.afterAdditions).join('、')} 次加仓后，超过最多加仓次数，暂不生效（已保留）。</p>}
  {!!vetoStages?.stages.some(s=>Number(s.afterAdditions)>count)&&<p className="text-[10px] text-muted-foreground">另有否决条件设在第 {vetoStages.stages.filter(s=>Number(s.afterAdditions)>count).map(s=>s.afterAdditions).join('、')} 次加仓后，超过最多加仓次数，暂不生效（已保留）。</p>}
 </section>;
}
