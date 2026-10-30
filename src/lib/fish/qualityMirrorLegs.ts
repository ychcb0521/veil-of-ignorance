import type {QualityCampaignData} from './qualityCampaigns';
import type {CampaignEvent,TradeJournal} from '@/types/journal';

/** Partition original acquisition lots: a mirror close is a separate leg, never new invested capital. */
export function withQualityMirrorLegs(data:QualityCampaignData):QualityCampaignData{
 const fill=data.campaign.comparison?.sellEvidence?.mirrorFill;if(!fill)return data;
 let records=data.tradeRecords.map(r=>({...r})),events=data.campaign.actual_evolution.map(e=>({...e}));
 const legs:TradeJournal[]=[];
 for(const leg of data.legs){
  const mirror=records.find(r=>r.exit_reason_text==='镜像止盈'&&(r.id===leg.trade_record_id||r.positionId===leg.trade_record_id));
  if(!mirror||leg.leg_role==='mirror_tp'){legs.push(leg);continue;}
  const cost=mirror.quantity*mirror.entryPrice,remaining=Math.max(0,(leg.pre_position_size??cost)-cost),partial=remaining>1e-9*Math.max(1,cost);
  const mirrorId=partial?leg.id+'-mirror-tp':leg.id,remainingRef=leg.id+'-remaining-position';
  const target=mirror.entryPrice*(1+fill.gainPct/100);
  const mirrorLeg:TradeJournal={...leg,id:mirrorId,leg_role:'mirror_tp',trade_record_id:mirror.id,pre_position_size:cost,
   pre_planned_take_profit:target,pre_entry_reason:`${fill.fraction===.5?'半仓镜像':'镜像止盈'}：卖出原始买入币数 ${fill.fraction*100}%；由原买入仓位分出。`,
   post_simulated_close_time:new Date(mirror.closeTime).toISOString(),post_real_close_time:new Date(mirror.closedRealAt??mirror.closeTime).toISOString(),post_exit_price_snapshot:mirror.exitPrice,
   post_realized_pnl:mirror.pnl,post_outcome:mirror.pnl>0?'win':mirror.pnl<0?'loss':'breakeven'};
  if(partial){
   const closes=records.filter(r=>(r.id===leg.trade_record_id||r.positionId===leg.trade_record_id)&&r.id!==mirror.id);
   const remainingPnl=closes.length?closes.reduce((n,r)=>n+r.pnl,0):null;
   legs.push({...leg,trade_record_id:remainingRef,pre_position_size:remaining,post_realized_pnl:remainingPnl,post_outcome:remainingPnl==null?null:remainingPnl>0?'win':remainingPnl<0?'loss':'breakeven'});
   records=records.map(r=>closes.some(c=>c.id===r.id)?{...r,positionId:remainingRef}:r);
  }
  legs.push(mirrorLeg);
  events=events.flatMap((event):CampaignEvent[]=>{
   if(event.journal_id!==leg.id)return [event];
   if(event.trade_record_id===mirror.id&&event.realized_pnl!=null)return [{...event,journal_id:mirrorId,leg_role:'mirror_tp',event_type:'mirror_tp_triggered'}];
   if(event.event_type==='main_opened'){
    const placed:CampaignEvent={...event,id:mirrorId+'-placed',journal_id:mirrorId,leg_role:'mirror_tp',event_type:'mirror_tp_placed',trade_record_id:mirror.id,size_usdt:cost,price:target,notes:mirrorLeg.pre_entry_reason};
    return partial?[{...event,size_usdt:remaining,trade_record_id:remainingRef},placed]:[placed];
   }
   return [{...event,...(partial?{trade_record_id:closesRef(event.trade_record_id,leg.trade_record_id,remainingRef)}:{})}];
  });
 }
 const sequenced=legs.map((leg,i)=>({...leg,leg_sequence:i+1})),sequence=new Map(sequenced.map(leg=>[leg.id,leg.leg_sequence]));
 return {...data,legs:sequenced,tradeRecords:records,campaign:{...data.campaign,actual_evolution:events.map(event=>({...event,leg_sequence:event.journal_id?sequence.get(event.journal_id)??event.leg_sequence:event.leg_sequence}))}};
}
function closesRef(ref:string|null,old:string|null,next:string):string|null{return ref===old?next:ref;}
