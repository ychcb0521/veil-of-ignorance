/** Preserve each acquisition lot in campaign events, partial closes and realized profit. */
import type { QualityCampaignData } from './qualityCampaigns';
import type { QualityCampaignRun } from './qualityCampaignArchive';
import type { TradeRecord } from '@/types/trading';
import type { CampaignEvent, TradeJournal, LegRole } from '@/types/journal';
import { additionPosition, additionLabel, qualityAdditionFills } from './qualityAddition';
const iso=(at:number)=>new Date(at).toISOString();
export function withQualityAdditionCampaign(data:QualityCampaignData,run:QualityCampaignRun):QualityCampaignData {
 const {result:r,plan}=run,adds=qualityAdditionFills(r);
 const entry=r.entryTime!,closed=r.status==='closed',end=r.endTime!,id=data.campaign.id;
 const summary=additionPosition(100,r.entryPrice!,r.endPrice!,closed,adds,r.mirrorFill);
 const lots=[{at:entry,price:r.entryPrice!,notional:100,quantity:100/r.entryPrice!,role:'main_open' as const,id:data.legs[0].id},
   ...adds.map((add,i)=>({at:add.at,price:add.price,notional:add.notional,quantity:add.quantity,role:`main_add_${i+1}` as LegRole,id:id+'-add-'+(i+1)}))];
 const tradeRecords:TradeRecord[]=[],events:CampaignEvent[]=[],legs:TradeJournal[]=[];
 for(const [index,lot] of lots.entries()) {
   const positionId=lot.id+'-position',mirror=r.mirrorFill;
   const fraction=mirror?(mirror.fraction===1?1:index===0?mirror.fraction:0):0;
   const mirrorQty=lot.quantity*fraction,remaining=lot.quantity-mirrorQty;
   const add=adds[index-1];
   const note=index===0?data.campaign.notes:`第 ${index} 轮条件加仓：${add.label} · 读数 ${add.reading} ${add.direction} ${add.threshold} · ${add.quantity} 枚，成交 ${add.notional} USDT${add.sizing?` · T=${add.price} · S=${add.sizing.previousSupport} · K=${add.sizing.support} · 5m ATR(14)=${add.sizing.atr}`:''}`;
   const leg:TradeJournal={...data.legs[0],id:lot.id,trade_record_id:positionId,leg_role:lot.role,leg_sequence:index+1,
     pre_simulated_time:iso(lot.at),pre_entry_price:lot.price,pre_planned_stop_loss:add?.sizing?.support??null,pre_position_size:lot.notional,pre_entry_reason:note,
     pre_account_equity_usdt:summary.totalInvested,post_realized_pnl:closed?lot.quantity*r.endPrice!-lot.notional:null};
   let realized=0;
   const opening:CampaignEvent={...data.campaign.actual_evolution[0],id:lot.id+'-entry',timestamp:iso(lot.at),event_type:'main_opened',journal_id:lot.id,leg_role:lot.role,leg_sequence:index+1,
     trade_record_id:positionId,price:lot.price,size_usdt:lot.notional,open_time:iso(lot.at),entry_price:lot.price,notes:note};
   events.push(opening);
   const close=(at:number,price:number,quantity:number,kind:'mirror'|'exit')=>{
     const pnl=quantity*(price-lot.price),recordId=lot.id+'-'+kind;realized+=pnl;
     tradeRecords.push({id:recordId,positionId,symbol:data.campaign.symbol,side:'LONG',type:kind==='mirror'?'LIMIT':'MARKET',action:'CLOSE',entryPrice:lot.price,exitPrice:price,
       quantity,leverage:1,settlementMode:'usdt',settlementAsset:'USDT',pnl,fee:0,openFeeUsd:0,openFeeRate:0,closeFeeRate:0,slippage:0,
       openTime:lot.at,closeTime:at,openedRealAt:run.firstEvaluatedAt,closedRealAt:r.evaluatedAt,exit_reason_text:kind==='mirror'?'镜像止盈':r.reason??'卖出'});
     events.push({...opening,id:recordId,timestamp:iso(at),trade_record_id:recordId,event_type:kind==='mirror'&&fraction<1?'main_partial_closed':'main_fully_closed',
       price,size_usdt:quantity*lot.price,realized_pnl:pnl,close_time:iso(at),exit_price:price,notes:kind==='mirror'?'镜像止盈':r.reason??'卖出',recorded_at:iso(r.evaluatedAt)});
   };
   if(mirror&&mirrorQty>0)close(mirror.at,mirror.price,mirrorQty,'mirror');
   if(closed&&remaining>0)close(end,r.endPrice!,remaining,'exit');
   if(closed){leg.post_realized_pnl=realized;leg.post_outcome=realized>0?'win':realized<0?'loss':'breakeven';}
   legs.push(leg);
 }
 const campaign={...data.campaign,notes:data.campaign.notes+'\n'+additionLabel(plan.addition)+`；累计投入 ${summary.totalInvested} USDT，收益按累计投入计算。`,
   actual_evolution:events.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)),peak_unrealized_pnl:null,
   comparison:{...data.campaign.comparison!,holdingMetrics:{...data.campaign.comparison!.holdingMetrics!,totalInvested:summary.totalInvested},
     sellEvidence:{...data.campaign.comparison!.sellEvidence!,addition:plan.addition,additionFill:adds[0],additionFills:[...adds],totalInvested:summary.totalInvested,averageEntryPrice:r.averageEntryPrice}}};
 return {...data,campaign,legs,tradeRecords};
}
