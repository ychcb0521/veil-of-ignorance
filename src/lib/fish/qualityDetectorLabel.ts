/** A detector observation is labelled separately under each frozen sell result. No global signal mutation. */
import type { QualityGroup,QualityResult } from './quality';
export const QUALITY_LABEL_ZERO_TOLERANCE=1e-8; // Percentage points; numerical roundoff only, not a trading breakeven band.
export type QualityDetectorLabelCode='mild-false'|'severe-false'|'hit'|'unclassified'|'disabled'|'pending'|'error'|'unbought';
export interface QualityDetectorLabel {code:QualityDetectorLabelCode;label:string;detail:string;rank:number|null}
export function qualityDetectorLabel(plan:QualityGroup,result?:QualityResult,skipped=false):QualityDetectorLabel {
 const out=(code:QualityDetectorLabelCode,label:string,detail:string,rank:number|null=null)=>({code,label,detail,rank});
 if(skipped)return out('unbought','未买入','本方案未买入，不对探测作成败标记。');
 if(result?.status==='error')return out('error','缺数据','运行结果缺数据，不能判断镜像和最终盈亏。');
 if(!result||result.status==='waiting')return out('pending','待评估','尚无完整运行结果，不判定探测标签。');
 if(result.status!=='closed')return out('pending','持仓中','须等待全部余仓卖出，浮盈或已卖半仓不能作为最终结论。');
 if(!Number.isFinite(result.returnPct)||!Number.isFinite(result.entryTime)||!(result.entryTime!>0)||!Number.isFinite(result.entryPrice)||!(result.entryPrice!>0)||!Number.isFinite(result.endTime)||!(result.endTime!>=result.entryTime!)||!Number.isFinite(result.endPrice)||!(result.endPrice!>0))return out('error','缺数据','缺少有效买入、最终卖出记录或整笔收益率。');
 const fill=result.mirrorFill;
 if(!fill&&!plan.mirrorTakeProfit?.enabled)return out('disabled','未判定','本方案未启用镜像止盈，不用无镜像结果给探测下结论。镜像启用状态独立显示在半仓镜像列。');
 if(fill&&(!(fill.price>0)||!Number.isFinite(fill.price)||!(fill.fraction>0&&fill.fraction<=1)||!(fill.at>=result.entryTime!)||fill.at>result.endTime!))return out('error','镜像记录异常','镜像成交价格、比例或先后时序无效，不能判定。');
 const roi=result.returnPct!,flat=Math.abs(roi)<=QUALITY_LABEL_ZERO_TOLERANCE;
 const basis=`按本卖出方案冻结的最终整笔收益率 ${roi.toFixed(8)}% 判定，包含镜像与余仓及已有加仓结果，沿用鱼质量现有收益口径；持平容差±${QUALITY_LABEL_ZERO_TOLERANCE}个百分点。`;
 if(fill&&flat)return out('mild-false','轻微误报','先触发镜像止盈，最终持平。'+basis,1);
 if(!fill&&roi< -QUALITY_LABEL_ZERO_TOLERANCE)return out('severe-false','严重误报','未触发镜像止盈，最终亏损。'+basis,0);
 if(fill&&roi>QUALITY_LABEL_ZERO_TOLERANCE)return out('hit','准确击中','先触发镜像止盈，最终盈利结束。'+basis,2);
 return out('unclassified','未分类',(fill?'触发镜像后仍亏损':flat?'未触发镜像且最终持平':'未触发镜像但最终盈利')+'，不属于本次指定的三类。'+basis,3);
}
