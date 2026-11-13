import {HOLDING_LEDGER_ADDITION_VERSION,replayQualityHoldingLedger} from './qualityHoldingLedger';
import {qualityAdditionFills} from './qualityAddition';
import type { TradeCampaign } from '@/types/journal';
/** Presentation of frozen monitor results; never infer a fill from a price peak. */
import type { QualityGroup, QualityResult } from './quality';
import type { QualityMirrorFill, QualityMirrorTakeProfit } from './qualityMirror';
import { mirrorFillGainPct } from './qualityMirror';
import { formatUTC8 } from '@/lib/timeFormat';
export const qualityPeakPct = (result?: QualityResult): number | null => result && ['open','closed'].includes(result.status) && result.peakPct != null && Number.isFinite(result.peakPct) ? Math.max(0,result.peakPct) : null;
/** Original buy price to actual final sale price; independent of partial sales/addition sizing. */
export const qualitySalePriceChangePct=(result?:QualityResult):number|null=>{
 if(result?.status!=='closed'||!Number.isFinite(result.entryPrice)||!(result.entryPrice!>0)||!Number.isFinite(result.endPrice)||!(result.endPrice!>0))return null;
 const value=(result.endPrice!/result.entryPrice!-1)*100;return Number.isFinite(value)?value:null;
};
/**
 * 相对涨幅 G（与交易战役同口径）＝ (F − Kₘ) ÷ (E − K初)，以首仓风险距离为单位，返回 ×100 的数值（2.5 倍记作 250）。
 * F 最终卖出价；Kₘ 最后一次加仓的止损线 K；E 首次买入价；K初 ＝ E × (1 − 静态回撤阈值%)——
 * 与鱼质量战役的初始风险相同（硬性终止里启用的静态回撤，多条取最小值）。
 * 只算有实际加仓且已卖出的持仓（交易战役同样只算有加仓的）；缺任一项返回 null 并说明原因。
 */
export function qualityRelativeGain(plan:Pick<QualityGroup,'holdingVetoes'>,result?:QualityResult):{value:number|null;reason:string}{
 if(result?.status!=='closed')return {value:null,reason:result?.status==='open'?'持有中，卖出后才有相对涨幅':'尚无卖出结果'};
 const fills=qualityAdditionFills(result);if(!fills.length)return {value:null,reason:'没有实际加仓：相对涨幅只算有加仓的持仓（与交易战役一致）'};
 const stops=(plan.holdingVetoes??[]).filter(v=>v.enabled&&v.kind==='static-drawdown'&&(v.direction==='>='||v.direction==='>')&&Number.isFinite(v.threshold)&&v.threshold>0&&v.threshold<=100).map(v=>v.threshold);
 if(!stops.length)return {value:null,reason:'缺少初始止损 K初：请在硬性终止里启用静态回撤'};
 const E=result.entryPrice,F=result.endPrice,K=fills.at(-1)?.sizing?.support,K0=E!=null?E*(1-Math.min(...stops)/100):undefined;
 if(![E,F,K,K0].every(v=>v!=null&&Number.isFinite(v)&&v>0)||!(E!>K0!))return {value:null,reason:'缺少买入价、卖出价或加仓止损线'};
 const value=(F!-K!)/(E!-K0!)*100;
 return Number.isFinite(value)?{value,reason:`G＝(F ${F} − Kₘ ${K}) ÷ (E ${E} − K初 ${+K0!.toPrecision(10)})`}:{value:null,reason:'相对涨幅超出可计算范围'};
}
/**
 * 几何仓位 M（与交易战役同口径）＝ (1 − αf) × ∏(1 + αₖ)：加仓后相对首仓的仓位倍数。
 * αf 首次加仓前已卖出的首仓比例（这里就是镜像平衡减仓）；αₖ 第 k 次加仓币数 ÷ 加仓前持币数。
 * 没有加仓：已卖出时 αf 计入镜像，仍持有时不计（交易战役同样只在战役结束后计入未加仓前的减仓）。
 */
export function qualityGeometricPosition(result?:QualityResult):number|null{
 if(!result||(result.status!=='open'&&result.status!=='closed'))return null;
 const E=result.entryPrice,notional=result.initialNotional;if(!(E!>0)||!(notional!>0)||!Number.isFinite(E)||!Number.isFinite(notional))return null;
 const fills=qualityAdditionFills(result),mirror=result.mirrorFill,initial=notional!/E!;
 if(fills.some(f=>f.positionVersion===HOLDING_LEDGER_ADDITION_VERSION)){const p=replayQualityHoldingLedger({notional:notional!,entryPrice:E!,entryAt:result.entryTime!,additions:fills,mirror,reductions:result.additionReductions,includeIntraminute:true,details:false});return p.held/p.initialQuantity;}
 const reduction=fills.length?(mirror&&mirror.at<=fills[0].at?mirror.fraction:0):result.status==='closed'&&mirror?mirror.fraction:0;
 if(!(reduction>=0&&reduction<=1))return null;
 let held=initial*(1-reduction),value=1-reduction;
 // 支撑线下移减仓：整个持仓按比例缩小，与加仓按时间先后交替
 const cuts=fills.length?(result.additionReductions??[]).filter(c=>c.fraction>0):[];
 const steps=[...fills.map(f=>({at:f.at,f})),...cuts.map(c=>({at:c.at,c}))].sort((a,b)=>a.at-b.at);
 for(const s of steps){if('c' in s){value*=1-s.c.fraction;held*=1-s.c.fraction;continue;}const f=s.f,before=f.sizing?.coinsBefore??held;if(!(before>0)||!(f.quantity>=0))return null;value*=1+f.quantity/before;held=before+f.quantity;}
 return Number.isFinite(value)?value:null;
}
export const qualityGeometricPositionText=(value:number|null)=>value==null?'—':`${value.toFixed(2)}x`;
/**
 * 【用户要求】2026-11-02 组合表「相对涨幅」后加「盈亏比」，与交易战役同口径（campaignB.PAYOFF_RATIO_FORMULA）：
 * 盈亏比 b ＝ 已实现净盈亏 ÷ 初始最大预期亏损 L₀；持仓监测的 L₀ ＝ 初始仓位 × 硬性终止静态回撤%（qualityCampaignStaticRisk 同一来源）。只算已卖出的持仓。
 */
export function qualityPayoffRatio(plan:Pick<QualityGroup,'holdingVetoes'>,result?:QualityResult):{value:number|null;reason:string}{
 if(result?.status!=='closed')return {value:null,reason:result?.status==='open'?'持有中，卖出后才有盈亏比':'尚无卖出结果'};
 const stops=(plan.holdingVetoes??[]).filter(v=>v.enabled&&v.kind==='static-drawdown'&&(v.direction==='>='||v.direction==='>')&&Number.isFinite(v.threshold)&&v.threshold>0&&v.threshold<=100).map(v=>v.threshold);
 if(!stops.length)return {value:null,reason:'缺少初始最大预期亏损 L₀：请在硬性终止里启用静态回撤'};
 const notional=result.initialNotional??100,L0=notional*Math.min(...stops)/100,pnl=result.pnl;
 if(pnl==null||!Number.isFinite(pnl)||!(L0>0))return {value:null,reason:'缺少已实现盈亏'};
 const value=pnl/L0;
 return Number.isFinite(value)?{value,reason:`盈亏比＝已实现净盈亏 ${pnl.toFixed(2)} ÷ L₀ ${+L0.toPrecision(8)}（${notional} × ${Math.min(...stops)}%）`}:{value:null,reason:'盈亏比超出可计算范围'};
}
export const qualityPayoffRatioText=(value:number|null)=>value==null?'—':`${value>0?'+':''}${value.toFixed(2)}R`;
export const qualityRelativeGainText=(value:number|null)=>value==null?'—':`${(value/100).toFixed(2)}×`;
export interface HalfMirrorSummary { state:'disabled'|'pending'|'error'|'untriggered'|'filled'; label:string; value:number|null; text:string; detail:string }
const pct=(value:number)=>`${value>0?'+':''}${value.toFixed(2)}%`;
type MirrorResult = Pick<QualityResult,'status'|'returnPct'|'entryPrice'|'initialNotional'|'mirrorRealizedPnl'|'remainingPnl'> & {mirrorFill?:QualityMirrorFill; marginUsdt?:number};
export function halfMirrorSummary(rule:QualityMirrorTakeProfit|undefined,result?:MirrorResult):HalfMirrorSummary {
 const filled=result?.mirrorFill;
 if(!filled && !rule?.enabled)return {state:'disabled',label:'未启用',value:null,text:'未启用',detail:'本轮未启用镜像平衡减仓，历史结果不套用当前设置。'};
 const config=rule?.enabled?`涨幅 ≥ ${rule.gainPct}%，卖出初始币数 ${rule.sellPct}%`:'镜像平衡减仓历史成交';
 const strategyReturn=result && ['open','closed'].includes(result.status) && Number.isFinite(result.returnPct)?result.returnPct!:null;
 if(result?.status==='error')return {state:'error',label:'缺数据',value:null,text:'缺数据',detail:`${config}；本次评估缺数据，不能确认镜像平衡减仓结果。`};
 if(!result || !['open','closed'].includes(result.status))return {state:'pending',label:'待评估',value:null,text:'待评估',detail:`${config}；尚无有效持仓评估结果。`};
 if(!filled)return {state:'untriggered',label:'未触发',value:null,text:'未触发',detail:`${config}；截至本次卖出 / 估值尚未触发。未触发不等于零收益。`};
 const label=`已卖 ${(filled.fraction*100).toFixed(2).replace(/\.?0+$/,'')}%`;
 const value=mirrorFillGainPct(result.entryPrice,filled);
 const notional=result.initialNotional??100;
 const mirrorPnl=result.mirrorRealizedPnl??(result.entryPrice && result.entryPrice>0?notional*filled.fraction*(filled.price/result.entryPrice-1):null);
 const remainingPnl=result.remainingPnl??(strategyReturn!=null && mirrorPnl!=null?notional*strategyReturn/100-mirrorPnl:null);
 const amounts=mirrorPnl!=null && remainingPnl!=null?`镜像平衡减仓盈亏 ${mirrorPnl.toFixed(2)} USDT + 余仓${result.status==='open'?'估值':''}盈亏 ${remainingPnl.toFixed(2)} USDT = 合计 ${(mirrorPnl+remainingPnl).toFixed(2)} USDT；除以${result.marginUsdt ? '初始保证金' : '开仓总金额'} ${(result.marginUsdt ?? notional).toFixed(2)} USDT。`:'';
 const coins=result.entryPrice && result.entryPrice>0?`；每 100 USDT 初始持仓已卖 ${(100/result.entryPrice*filled.fraction).toPrecision(8)} 币`:'';
 return {state:'filled',label,value,text:value==null?`${label} · 开仓价缺失`:`${pct(value)} · ${label}`,detail:`显示的是开仓至镜像平衡减仓成交时的实际涨幅 =（成交价 ÷ 开仓价 − 1）× 100%，不按卖出比例折算。${config}；${formatUTC8(filled.at)} 按 ${filled.price.toPrecision(9)} 成交${coins}。${amounts}${strategyReturn!=null?`整笔交易${result.status==='open'?'估值':''}回报率 ${pct(strategyReturn)}。`:''}总盈亏 = 镜像平衡减仓已兑现盈亏 + 余仓盈亏；投资回报率 = 总盈亏 ÷ ${result.marginUsdt ? '初始保证金' : '开仓总金额'}。已全部卖出时为最终收益，仍持有的余仓按本次价格估值。按实际设置比例计算，每笔持仓仅触发一次。`};
}
export const qualityHalfMirror = (plan:QualityGroup,result?:QualityResult)=>halfMirrorSummary(plan.mirrorTakeProfit,result);

export function campaignHalfMirror(campaign:Pick<TradeCampaign,'comparison'>):HalfMirrorSummary|undefined {
 const evidence=campaign.comparison?.instant ?? campaign.comparison?.sellEvidence,metrics=campaign.comparison?.holdingMetrics;
 return evidence?halfMirrorSummary(evidence.mirrorTakeProfit,metrics?{status:metrics.status,returnPct:metrics.returnPct??undefined,entryPrice:metrics.entryPrice,initialNotional:metrics.initialNotional,mirrorRealizedPnl:metrics.mirrorRealizedPnl,remainingPnl:metrics.remainingPnl,mirrorFill:evidence.mirrorFill,marginUsdt:campaign.comparison?.instant?.marginUsdt}:undefined):undefined;
}

/** Count only saved executions; absent/error evaluations never become measured zero. */
export function qualityAdditionSummary(plan:QualityGroup,result?:QualityResult){
 const fills=qualityAdditionFills(result??{}),count=fills.length;
 if(count)return {count,text:`已加仓 ${count} 次`,detail:`累计加仓 ${count} 次，${fills.reduce((n,a)=>n+a.quantity,0).toPrecision(8)} 枚；实际持仓均价 ${result?.averageEntryPrice?.toPrecision(8)??'—'}`};
 if(!plan.addition?.enabled)return {count:null,text:'未启用',detail:'本轮未启用条件加仓'};
 if(result?.status==='error')return {count:null,text:'缺数据',detail:result.reason??'加仓评估缺数据'};
 if(!result||!['open','closed'].includes(result.status))return {count:null,text:'待评估',detail:'尚无有效持仓评估结果'};
 return {count:0,text:'未加仓',detail:result.additionNote??'截至本次卖出或估值没有加仓成交'};
}
