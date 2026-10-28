import type { TradeCampaign } from '@/types/journal';
/** Presentation of frozen monitor results; never infer a fill from a price peak. */
import type { QualityGroup, QualityResult } from './quality';
import type { QualityMirrorFill, QualityMirrorTakeProfit } from './qualityMirror';
import { formatUTC8 } from '@/lib/timeFormat';
export const qualityPeakPct = (result?: QualityResult): number | null => result && ['open','closed'].includes(result.status) && result.peakPct != null && Number.isFinite(result.peakPct) ? Math.max(0,result.peakPct) : null;
export interface HalfMirrorSummary { state:'disabled'|'pending'|'error'|'untriggered'|'filled'; label:string; value:number|null; text:string; detail:string }
const pct=(value:number)=>`${value>0?'+':''}${value.toFixed(2)}%`;
type MirrorResult = Pick<QualityResult,'status'|'returnPct'|'entryPrice'|'initialNotional'|'mirrorRealizedPnl'|'remainingPnl'> & {mirrorFill?:QualityMirrorFill};
export function halfMirrorSummary(rule:QualityMirrorTakeProfit|undefined,result?:MirrorResult):HalfMirrorSummary {
 const filled=result?.mirrorFill;
 if(!filled && !rule?.enabled)return {state:'disabled',label:'未启用',value:null,text:'未启用',detail:'本轮未启用镜像止盈，历史结果不套用当前设置。'};
 const config=rule?.enabled?`涨幅 ≥ ${rule.gainPct}%，卖出初始币数 ${rule.sellPct}%`:'镜像止盈历史成交';
 const value=result && ['open','closed'].includes(result.status) && Number.isFinite(result.returnPct)?result.returnPct!:null;
 if(result?.status==='error')return {state:'error',label:'缺数据',value:null,text:'缺数据',detail:`${config}；本次评估缺数据，不能确认镜像止盈结果。`};
 if(!result || !['open','closed'].includes(result.status))return {state:'pending',label:'待评估',value:null,text:'待评估',detail:`${config}；尚无有效持仓评估结果。`};
 if(!filled)return {state:'untriggered',label:'未触发',value:null,text:'未触发',detail:`${config}；截至本次卖出 / 估值尚未触发。未触发不等于零收益。`};
 const label=`已卖 ${(filled.fraction*100).toFixed(2).replace(/\.?0+$/,'')}%`;
 const notional=result.initialNotional??100;
 const mirrorPnl=result.mirrorRealizedPnl??(result.entryPrice && result.entryPrice>0?notional*filled.fraction*(filled.price/result.entryPrice-1):null);
 const remainingPnl=result.remainingPnl??(value!=null && mirrorPnl!=null?notional*value/100-mirrorPnl:null);
 const amounts=mirrorPnl!=null && remainingPnl!=null?`镜像止盈盈亏 ${mirrorPnl.toFixed(2)} USDT + 余仓${result.status==='open'?'估值':''}盈亏 ${remainingPnl.toFixed(2)} USDT = 合计 ${(mirrorPnl+remainingPnl).toFixed(2)} USDT；除以开仓总金额 ${notional.toFixed(2)} USDT。`:'';
 const coins=result.entryPrice && result.entryPrice>0?`；每 100 USDT 初始持仓已卖 ${(100/result.entryPrice*filled.fraction).toPrecision(8)} 币`:'';
 return {state:'filled',label,value,text:value==null?label:`${pct(value)} · ${label}`,detail:`${config}；${formatUTC8(filled.at)} 按 ${filled.price.toPrecision(9)} 成交${coins}。${amounts}总盈亏 = 镜像止盈已兑现盈亏 + 余仓盈亏；投资回报率 = 总盈亏 ÷ 开仓总金额。已全部卖出时为最终收益，仍持有的余仓按本次价格估值。按实际设置比例计算，每笔持仓仅触发一次。`};
}
export const qualityHalfMirror = (plan:QualityGroup,result?:QualityResult)=>halfMirrorSummary(plan.mirrorTakeProfit,result);

export function campaignHalfMirror(campaign:Pick<TradeCampaign,'comparison'>):HalfMirrorSummary|undefined {
 const evidence=campaign.comparison?.sellEvidence,metrics=campaign.comparison?.holdingMetrics;
 return evidence?halfMirrorSummary(evidence.mirrorTakeProfit,metrics?{status:metrics.status,returnPct:metrics.returnPct??undefined,entryPrice:metrics.entryPrice,initialNotional:metrics.initialNotional,mirrorRealizedPnl:metrics.mirrorRealizedPnl,remainingPnl:metrics.remainingPnl,mirrorFill:evidence.mirrorFill}:undefined):undefined;
}
