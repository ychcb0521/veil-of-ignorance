import type {QualityAdditionFill,QualityReductionFill} from './qualityAddition';
import type {QualityMirrorFill} from './qualityMirror';

/** New, opt-in execution basis. Missing version always means the frozen legacy
 * mirror-first engine; reading a saved plan never upgrades it. */
export const HOLDING_LEDGER_ADDITION_VERSION='holding-ledger-addition-v1' as const;
export interface HoldingSale {
  kind:'mirror'|'reduce';at:number;price:number;quantity:number;costRemoved:number;realizedPnl:number;
  lots:{index:number;quantity:number;costRemoved:number;realizedPnl:number}[];
}
export interface HoldingLedgerInput {
  notional:number;entryPrice:number;entryAt:number;
  additions:readonly QualityAdditionFill[];mirror?:Pick<QualityMirrorFill,'at'|'price'|'fraction'>&Partial<QualityMirrorFill>;
  reductions?:readonly QualityReductionFill[];
  /** Open-time decisions cannot use a later intraminute mirror execution. */
  through?:number;includeIntraminute?:boolean;
  details?:boolean;
}

/** Replay actual fills in time order. Sales remove average cost proportionally
 * from the inventory that exists then, including additions made before mirror.
 * A partial mirror sells the configured initial coin count, capped by inventory;
 * 100% mirror closes all currently held coins, matching the strategy's full exit. */
export function replayQualityHoldingLedger(o:HoldingLedgerInput){
  if(![o.notional,o.entryPrice,o.entryAt].every(Number.isFinite)||!(o.notional>0)||!(o.entryPrice>0)||o.entryAt<=0)throw Error('持仓账初始状态无效');
  const through=o.through??Infinity,initialQuantity=o.notional/o.entryPrice;
  if((!Number.isFinite(through)&&through!==Infinity)||through<o.entryAt)throw Error('持仓账读取时点无效或早于建仓');
  const lots=o.details===false?[]:[{index:0,at:o.entryAt,price:o.entryPrice,quantity:initialQuantity,cost:o.notional}];
  let held=initialQuantity,cost=o.notional,realized=0,totalInvested=o.notional,totalQuantity=initialQuantity;
  let mirrorQuantity=0,mirrorCost=0,mirrorProfit=0,reductionProfit=0;
  const sales:HoldingSale[]=[];
  type Event={at:number;priority:number;index:number;kind:'add'|'mirror'|'reduce'};
  const events:Event[]=[];
  const validAt=(at:number)=>{if(!Number.isFinite(at)||at<o.entryAt)throw Error('持仓成交时间无效');};
  o.additions.forEach((f,index)=>{validAt(f.at);if(f.at<=through)events.push({at:f.at,priority:2,index,kind:'add'});});
  o.reductions?.forEach((f,index)=>{validAt(f.at);if(f.at<=through)events.push({at:f.at,priority:1,index,kind:'reduce'});});
  const m=o.mirror;
  if(m)validAt(m.at);
  if(m&&(m.at<through||m.at===through&&(o.includeIntraminute||m.atOpen)))events.push({at:m.at,priority:m.atOpen?0:3,index:0,kind:'mirror'});
  events.sort((a,b)=>a.at-b.at||a.priority-b.priority||a.index-b.index);
  for(const event of events){
    if(!Number.isFinite(event.at)||event.at<o.entryAt)throw Error('持仓成交时间无效');
    if(event.kind==='add'){
      const f=o.additions[event.index];
      if(!(held>0)||![f.price,f.quantity,f.notional].every(Number.isFinite)||!(f.price>0)||!(f.quantity>0)||!(f.notional>0))throw Error('加仓成交或剩余持仓无效');
      if(Math.abs(f.quantity*f.price-f.notional)>1e-9*Math.max(1,f.notional))throw Error('加仓币数与金额不一致');
      held+=f.quantity;cost+=f.notional;totalInvested+=f.notional;totalQuantity+=f.quantity;
      if(o.details!==false)lots.push({index:event.index+1,at:f.at,price:f.price,quantity:f.quantity,cost:f.notional});continue;
    }
    const cut=event.kind==='reduce'?o.reductions![event.index]:undefined;
    const price=cut?.price??m!.price,fraction=cut?.fraction??m!.fraction;
    if(!Number.isFinite(price)||!(price>0)||!Number.isFinite(fraction)||fraction<0||fraction>1)throw Error('减仓成交无效');
    const quantity=event.kind==='mirror'?(fraction===1?held:Math.min(held,initialQuantity*fraction)):held*fraction;
    if(!(quantity>0))continue;
    const proportion=quantity/held,sold=lots.filter(l=>l.quantity>0).map(l=>{
      const q=l.quantity*proportion,c=l.cost*proportion,pnl=q*price-c;
      l.quantity*=1-proportion;l.cost*=1-proportion;return {index:l.index,quantity:q,costRemoved:c,realizedPnl:pnl};
    });
    const costRemoved=cost*proportion,pnl=quantity*price-costRemoved;
    held*=1-proportion;cost*=1-proportion;realized+=pnl;
    if(event.kind==='mirror'){mirrorQuantity+=quantity;mirrorCost+=costRemoved;mirrorProfit+=pnl;}else reductionProfit+=pnl;
    if(o.details!==false)sales.push({kind:event.kind,at:event.at,price,quantity,costRemoved,realizedPnl:pnl,lots:sold});
  }
  if(![initialQuantity,held,cost,realized,totalInvested,totalQuantity,mirrorQuantity,mirrorCost,mirrorProfit,reductionProfit].every(Number.isFinite)||held<0||cost<0)throw Error('持仓账金额或币数超出可计算范围');
  return {initialQuantity,held,cost,realized,totalInvested,totalQuantity,mirrorQuantity,mirrorCost,mirrorProfit,reductionProfit,lots,sales};
}

/** One balance sheet for every mirror state:
 * q=(Q*K-C+G)/(T-K). G is signed realized PnL, C is remaining acquisition cost.
 * All past additions remain in C, so previously spent gains cannot fund an add
 * twice. No mirror means G=0 and the full unsold inventory remains Q. */
export function calculateHoldingLedgerAddition(p:{held:number;cost:number;realized:number},T:number,K:number){
  const blank=(error:'invalid_input'|'position_closed'|'price_not_above_support'|'risk_budget_insufficient',shortfall=0)=>({error,addCoins:0,baseCoins:0,mirrorCoins:0,mirrorUsed:0,coverageGap:0,oldLossShortfall:shortfall});
  if(![p.held,p.cost,p.realized,T,K].every(Number.isFinite)||p.held<0||p.cost<0||T<=0||K<=0)return blank('invalid_input');
  if(!(p.held>0))return blank('position_closed');
  if(!(T>K))return blank('price_not_above_support');
  const cushion=p.held*K-p.cost,raw=cushion+p.realized,risk=T-K;
  if(!Number.isFinite(raw))return blank('invalid_input');
  const tolerance=64*Number.EPSILON*Math.max(1,p.held*K,p.cost,Math.abs(p.realized));
  if(raw < -tolerance)return blank('risk_budget_insufficient',-raw);
  const budget=Math.max(0,raw);
  const addCoins=budget/risk,baseCoins=Math.max(0,cushion+Math.min(0,p.realized))/risk,mirrorCoins=Math.max(0,p.realized-Math.max(0,-cushion))/risk;
  if(![addCoins,baseCoins,mirrorCoins].every(Number.isFinite))return blank('invalid_input');
  return {error:null,addCoins,baseCoins,mirrorCoins,mirrorUsed:0,coverageGap:budget-addCoins*risk,oldLossShortfall:0};
}
