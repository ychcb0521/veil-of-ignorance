import {SBS5M_STEP,type SbsRow,type SbsBar} from './sbs5m';
/** Retrospective labels start strictly after confirmation; never count the confirming rebound. */
export function evaluateSbs5m(rows:readonly SbsRow[],future:readonly SbsBar[]=[]){
 const confirmations=rows.flatMap(r=>r.events.filter(e=>['BASELINE_CONFIRMED','STEP_CONFIRMED'].includes(e.type)).map(e=>({row:r,event:e})));
 const available=rows.filter(r=>r.data_valid),active=available.filter(r=>r.support_status==='ACTIVE');
 const horizons=confirmations.map(({row,event})=>({box_id:event.box_id,confirmed_at:event.at,delay_minutes:row.frozen_at!==null&&event.at!==null?(event.at-row.frozen_at)/60000:null,
   labels:[15,30,60].map(minutes=>{const bars=future.filter(b=>b.openTime+SBS5M_STEP>(event.at??Infinity)&&b.openTime+SBS5M_STEP<=(event.at??0)+minutes*60000).sort((a,b)=>a.openTime-b.openTime);
    const complete=event.at!==null&&bars.length===minutes/5&&bars.every((b,i)=>b.openTime===event.at!+i*SBS5M_STEP&&Number.isFinite(b.low)&&b.low>0&&b.SBS5M_closed!==false);
    return {minutes,complete,max_under_support:complete?Math.max(0,...bars.map(b=>event.support_price-b.low)):null,max_under_support_atr:complete&&row.active?.a0?Math.max(0,...bars.map(b=>event.support_price-b.low))/row.active.a0:null,invalidation_touched:complete?bars.some(b=>b.low<=event.invalidation_price):null};})}));
 const events=new Map(rows.flatMap(r=>r.events).map(e=>[e.id,e]));
 const count=(type:string)=>[...events.values()].filter(e=>e.type===type).length;
 const confirmed=confirmations.length,confirmedIds=new Set(confirmations.map(x=>x.event.box_id));
 const stepParents=new Set([...events.values()].filter(e=>e.type==='STEP_CONFIRMED').map(e=>e.parent_box_id));
 const invalidBoxes=new Set([...events.values()].filter(e=>e.type==='INVALID'&&confirmedIds.has(e.box_id)).map(e=>e.box_id));
 const retestCompleted=count('RETEST_SUCCEEDED')+count('RETEST_FAILED');
 const missedRallies=[...new Set(active.filter(r=>r.breakout_at!==null).map(r=>r.box_id))].flatMap(id=>{const selected=active.filter(r=>r.box_id===id&&r.breakout_at!==null),first=selected[0],start=future.find(b=>b.openTime+SBS5M_STEP===first.at)?.close;
   const closes=selected.map(r=>future.find(b=>b.openTime+SBS5M_STEP===r.at)?.close).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));
   return start&&closes.length?[{box_id:id,verified_bars:selected.length,max_close_rise_fraction:Math.max(0,...closes.map(c=>c/start-1)),formed_next_step:stepParents.has(id)}]:[];});
 const horizon_summary=[15,30,60].map(minutes=>{const complete=horizons.flatMap(h=>h.labels.filter(l=>l.minutes===minutes&&l.complete));return {minutes,n:complete.length,invalidation_touch_ratio:complete.length?complete.filter(l=>l.invalidation_touched).length/complete.length:null,mean_max_under_support_atr:complete.length?complete.reduce((s,l)=>s+(l.max_under_support_atr??0),0)/complete.length:null};});
 return {method:'post-confirmation-v1',bars:rows.length,valid_bars:available.length,active_bars:active.length,coverage:available.length?active.length/available.length:null,
   no_structure:rows.filter(r=>r.support_status==='NO_STRUCTURE').length,invalid:rows.filter(r=>r.support_status==='INVALID').length,stale:rows.filter(r=>r.support_status==='STALE').length,data_unavailable:rows.filter(r=>!r.data_valid).length,
   new_step_ratio:confirmed?[...confirmedIds].filter(id=>stepParents.has(id)).length/confirmed:null,confirmed_invalidation_ratio:confirmed?invalidBoxes.size/confirmed:null,subsequent_retest_recovery_ratio:retestCompleted?count('RETEST_SUCCEEDED')/retestCompleted:null,missedRallies,horizon_summary,baseline_confirmed:count('BASELINE_CONFIRMED'),steps:count('STEP_CONFIRMED'),invalidations:count('INVALID'),retests_succeeded:count('RETEST_SUCCEEDED'),retests_failed:count('RETEST_FAILED'),horizons,
   comparison_status:'未做匹配对照或调参；需要按确认距离、事前波动与趋势背景匹配，并按时间划分验证集。',
   missing_data:horizons.some(h=>h.labels.some(l=>!l.complete))?'确认后的连续15/30/60分钟行情不足；缺失标签为null。':confirmations.length?'未经收益或胜率验证。':'本窗口未形成确认结构，不能推断有效性。'};
}
