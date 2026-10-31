/** Post-event labels only. This module is never imported by the market evidence engine. */
import type {PrsBar,PrsRow} from './prs6h';
export function evaluatePrs6h(rows:readonly PrsRow[],bars:readonly PrsBar[],minutes=5){
 const step=minutes*60000,reasons:Record<string,number>={},events=rows.flatMap(r=>r.PRS6H_event?[r.PRS6H_event]:[]);
 for(const r of rows)for(const reason of r.PRS6H_reasons)reasons[reason]=(reasons[reason]??0)+1;
 const labels=events.map(event=>{
  const result:Record<string,unknown>={event_id:event.event_id,signal_time:event.signal_time,reference_price:event.reference_price,execution_note:'信号收盘后才可执行；此处只报告事后价格，不假设收盘价无摩擦成交'};
  for(const horizon of [15,30,60]){
   const until=event.signal_time+horizon*60000,window=bars.filter(b=>b.openTime>=event.signal_time&&b.openTime+step<=until),expected=Math.ceil(horizon/minutes);
   const complete=window.length===expected&&window.every((b,i)=>b.PRS6H_closed!==false&&b.openTime===event.signal_time+i*step&&[b.high,b.low,b.close].every(v=>Number.isFinite(v)&&v>0));
   result[horizon+'m']=complete?{return:window.at(-1)!.close/event.reference_price-1,MFE:Math.max(...window.map(b=>b.high))/event.reference_price-1,MAE:Math.min(...window.map(b=>b.low))/event.reference_price-1,support_failed:window.some((b,i)=>b.low<=event.invalidation||(i>0&&b.close<event.support&&window[i-1].close<event.support))}:null;
  }return result;
 });
 return {feature:'PRS-6H',parameters:'研究初值；未按样本内结果优化',bars:rows.length,valid_coverage:rows.length?rows.filter(r=>r.PRS6H_data_complete).length/rows.length:null,event_count:events.length,veto_frequencies:reasons,labels,
 diagnostic_counts:{frozen:rows.filter(r=>r.PRS6H_events.some(e=>e.type==='FROZEN')).length,tested:rows.filter(r=>r.PRS6H_events.some(e=>e.type==='VERIFIED')).length,breakout_but_spike_veto:rows.filter(r=>r.PRS6H_gates.breakout&&r.PRS6H_gates.spike===false).length,breakout_but_space_veto:rows.filter(r=>r.PRS6H_gates.breakout&&r.PRS6H_gates.space===false).length},
 limits:['诊断频率不是经过控制的策略消融收益；未建立新的加仓回测或自动订单流程','未来标签仅用于事后评估；重叠标签需在既有按时间划分的研究流程中隔离','样本不足的期限返回null，不虚构收益或有效性']};
}
