import {formatUTC8} from '@/lib/timeFormat';
import {qualityAdditionFills} from './qualityAddition';
import {shortFishHash} from './algorithm';
import type {FishCdaTracking} from '@/hooks/useFishCdaTracking';
import type {readLocalInstantCampaignJobs} from './instantCampaignStore';
import type {UsdtFollowStatus} from './usdtFollow';
import {tradeMailLabels,type MailRoute} from './tradeMailRoutes';

type Job = Awaited<ReturnType<typeof readLocalInstantCampaignJobs>>[number];
type Tracking = Pick<FishCdaTracking,'mirrorFills'|'monitorResults'|'manualPositions'>;
export interface TradeFill {at:number;price:number;quantity?:number}
export interface TradeNotice {id:string;route:MailRoute;symbol:string;at:number;paper?:TradeFill;exchange?:TradeFill;orderId?:string}
const positive=(v:number)=>Number.isFinite(v)&&v>0;
function confirmed(fill:TradeFill){return positive(fill.price)&&Number.isSafeInteger(fill.at)&&fill.at>0;}
export function tradeMailEvents(jobs:readonly Job[],tracking:Tracking,statuses:readonly UsdtFollowStatus[]){
  const result=new Map<string,TradeNotice>();
  const paper=new Map<string,TradeNotice>();
  for(const job of jobs){
    const {input,snapshot}=job;
    const open=snapshot??job.opened??('sell' in input?input.opened:undefined);
    if(!open)continue;
    const {id,recordId}=input;
    const symbol=input.source.symbol;
    const add=(action:string,route:'paperBuy'|'paperSell',fill:TradeFill)=>{
      if(!confirmed(fill))return;
      const key=JSON.stringify([id,action]);
      const notice={id:key,route,symbol,at:fill.at,paper:{at:fill.at,price:fill.price,...(fill.quantity&&positive(fill.quantity)?{quantity:fill.quantity}:{})}};
      result.set(key,notice);paper.set(key,notice);
    };
    add('open','paperBuy',{at:input.buyAt,price:open.entryPrice});
    const sell=snapshot?.sell??('sell' in input?input.sell:undefined);
    const monitor=snapshot?.monitorResult??('sell' in input?input.monitorResult:undefined)??tracking.monitorResults?.get(recordId);
    const manual=sell?.manual??tracking.manualPositions?.get(recordId);
    const mirror=monitor?.mirrorFill??sell?.mirror??tracking.mirrorFills?.get(recordId);
    if(mirror)add('mirror','paperSell',mirror);
    qualityAdditionFills(monitor??{}).forEach((fill,i)=>{
      const evidence=fill.structureEvidence;
      const impulse=evidence?.guardPlus?.early_impulse_event;
      const action=evidence?.impulseClassification?'add-class-'+shortFishHash(evidence.eventId):impulse?'add-'+impulse.impulse_id:'add-'+(i+1);
      add(action,'paperBuy',fill);
    });
    monitor?.additionReductions?.forEach((fill,i)=>add('support-'+(i+1),'paperSell',fill));
    manual?.fills.forEach((fill,i)=>add('manual-'+(i+1),'paperSell',fill));
    if(snapshot&&mirror?.fraction!==1&&!manual?.fills.some(fill=>fill.fraction===1)){
      add('close','paperSell',{at:snapshot.sell.at,price:snapshot.exitPrice});
    }
  }
  for(const status of statuses){
    for(const execution of status.executions??[]){
      if(!execution.orderId||!['BUY','SELL'].includes(execution.side))continue;
      const simulated=paper.get(JSON.stringify([status.id,execution.actionId.replace(/:\d+$/,'')]));
      if(!simulated||simulated.route!==(execution.side==='BUY'?'paperBuy':'paperSell'))continue;
      const fill=execution.fills.filter(f=>confirmed(f)&&positive(f.quantity)).sort((a,b)=>a.at-b.at)[0];
      if(!fill)continue;
      const id=JSON.stringify([status.id,execution.orderId,execution.side]);
      result.set(id,{id,route:execution.side==='BUY'?'liveBuy':'liveSell',symbol:simulated.symbol,at:Math.max(simulated.at,fill.at),
        paper:simulated.paper,exchange:{at:fill.at,price:fill.price,quantity:fill.quantity},orderId:execution.orderId});
    }
  }
  return [...result.values()].sort((a,b)=>a.at-b.at);
}
export function tradeMailContent(notice:TradeNotice){
  const subject=tradeMailLabels[notice.route]+' · '+notice.symbol;
  const lines=[subject];
  function describe(label:string,fill?:TradeFill){
    if(fill)lines.push(label+' '+formatUTC8(fill.at)+'（北京时间） · 成交价 '+fill.price+(fill.quantity?' · 数量 '+fill.quantity:''));
  }
  describe('模拟成交',notice.paper);
  describe('币安首笔成交',notice.exchange);
  if(notice.orderId)lines.push('币安订单号 '+notice.orderId);
  const message=lines.join('\n');
  const escaped=message.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return {subject,message,message_html:'<pre>'+escaped+'</pre>',count:1};
}
