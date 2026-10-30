/** Retrospective seller labels. Never used to choose or change an actual exit. */
import type { TradeSignal } from '@/lib/signalLibrary';
import type { QualityGroup, QualityResult } from './quality';
import { qualityConditionMet } from './qualityVeto';
import { POST_EXIT_HOURS, qualityPostExitKey, postExitWindow, type PostExitHours, type QualityPostExitReading } from './qualityPostExit';

export const SELL_ERROR_MULTIPLIER = 2;
export type SellErrorCode = 'false-exit' | 'not-met' | 'other-exit' | 'unknown-cause' | 'pending' | 'error' | 'unbought';
export interface QualitySellError { code:SellErrorCode; label:string; detail:string; value:0|1|null }
const label = (code:SellErrorCode,text:string,detail:string,value:0|1|null=null):QualitySellError => ({code,label:text,detail,value});

/** Require saved trigger evidence; a threshold that could have fired is not proof that it did. */
export function qualityAlgorithmExit(plan:QualityGroup,result?:QualityResult,skipped=false):QualitySellError|null {
 if(skipped)return label('unbought','未买入','本方案没有买入，不评估卖出误报。');
 if(result?.status==='error')return label('error','缺数据','本次运行缺数据，没有可用的最终卖出记录。');
 if(!result||result.status==='waiting')return label('pending','待卖出','尚无最终卖出，不能读取卖后反事实。');
 if(result.status!=='closed')return label('pending','持仓中','半仓镜像不作为本标签起点，须等待余仓最终卖出。');
 if(!Number.isFinite(result.entryTime)||!(result.entryTime!>0)||!Number.isFinite(result.entryPrice)||!(result.entryPrice!>0)||!Number.isFinite(result.endTime)||!(result.endTime!>=result.entryTime!)||!Number.isFinite(result.endPrice)||!(result.endPrice!>0))return label('error','缺数据','缺少有效的买入或最终卖出时间、价格。');
 const snapshot=result.exitSnapshot,cause=snapshot?.cause;
 if(cause)return label('other-exit','非算法触发',`实际离场由${cause.kind==='mirror-take-profit'?'镜像止盈':'一票否决'}「${cause.label}」触发，不归因于本卖出算法。`);
 if(result.mirrorFill?.fraction===1&&result.mirrorFill.at===result.endTime)return label('other-exit','非算法触发','镜像止盈卖出全部币数，不归因于本卖出算法。');
 if(/^(一票否决：|镜像止盈：)/.test(result.reason??''))return label('other-exit','非算法触发',`实际离场记录：${result.reason}。不归因于本卖出算法。`);
 const stage=snapshot?.stage;
 const rule=plan.combo ? stage==='before'?plan.rule:stage==='after'?plan.combo.after.rule:undefined : plan.rule;
 const observed=snapshot&&Number.isFinite(snapshot.barOpenTime)&&snapshot.barOpenTime<=snapshot.observedAt&&snapshot.observedAt===result.endTime;
 const legacy=!snapshot&&!plan.combo&&['指标收盘确认，下一分钟开盘卖出','盘中指标按已完成分钟复原，首次达标时按下一分钟开盘价卖出'].includes(result.reason??'');
 if(!rule||!['<','>'].includes(rule.direction)||!Number.isFinite(rule.threshold)||!Number.isFinite(result.exitReading)||!qualityConditionMet(result.exitReading!,rule.direction,rule.threshold)||!(observed||legacy))return label('unknown-cause','触发原因未知','现有记录不足以证明由本卖出算法（或组合相应阶段）的条件触发，不用当前行情或门槛反推触发原因。');
 return null;
}

/** Each horizon is judged only from its own completed, sale-price-based price window. */
export function qualitySellError(source:TradeSignal,plan:QualityGroup,result:QualityResult|undefined,reading:QualityPostExitReading|undefined,hours:PostExitHours,skipped=false,now=Date.now()):QualitySellError {
 const excluded=qualityAlgorithmExit(plan,result,skipped);if(excluded)return excluded;
 const key=qualityPostExitKey(source,result,plan),end=result!.endTime!;
 if(end+hours*3600000>Math.floor(now/60000)*60000)return label('pending',`待满${hours}h`,'只判定已完整结束的卖后窗口，未到期不提前下结论。');
 const current=key&&reading?.key===key&&reading.exitTime===end&&reading.exitPrice===result!.endPrice?reading:undefined;
 const window=postExitWindow(current,hours);
 if(window?.status==='error')return label('error','缺数据',window.error??'该卖后窗口行情不完整，不能判定。');
 if(window?.status!=='ready')return label('pending','待补算','缺少该次最终卖出的完整反事实窗口；展开卖出误报可补算。');
 const peak=window.peakPct,drawdown=window.drawdown2Pct;
 if(peak==null||drawdown==null||!Number.isFinite(peak)||!Number.isFinite(drawdown)||peak<0||drawdown<0||drawdown>100)return label('error','缺数据','峰值涨幅或静态最大回撤2无效，不将缺失当作0。');
 // Strict >, with only machine-roundoff equality tolerance; never divide by a zero drawdown.
 const twice=SELL_ERROR_MULTIPLIER*drawdown,tolerance=Number.EPSILON*32*Math.max(1,Math.abs(peak),Math.abs(twice));
 const wrong=peak-twice>tolerance;
 const stage=plan.combo?result!.exitSnapshot?.stage==='after'?`组合后段：${plan.combo.after.label}。`:`组合前段：${plan.combo.beforeLabel}。`:'';
 const detail=`${stage}卖后${hours}h，以最终卖出价${result!.endPrice}为基准：峰值涨幅${peak.toFixed(8)}%，静态最大回撤2为${drawdown.toFixed(8)}%。严格比较峰值涨幅 > ${SELL_ERROR_MULTIPLIER} × 静态最大回撤2；等于不算误报，零回撤时仍直接比较。${current!.excludedExitMinute?'成交所在分钟先后不明，沿用反事实规则排除该分钟。':''}这是本窗口下的事后标签，不证明其他窗口或卖出时点判断必然错误。`;
 return label(wrong?'false-exit':'not-met',wrong?'卖出误报':'未达误报',detail,wrong?1:0);
}

export function sellErrorExportValues(source:TradeSignal,result:QualityResult|undefined,plan:QualityGroup,readings:readonly QualityPostExitReading[]=[],skipped=false,now=Date.now()):string[]{
 const key=qualityPostExitKey(source,result,plan),reading=key?readings.find(r=>r.key===key):undefined;
 return POST_EXIT_HOURS.map(h=>qualitySellError(source,plan,result,reading,h,skipped,now).label);
}
