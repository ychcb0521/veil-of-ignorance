import {readFishPreferenceEntries,updateFishPreference} from './fishPreferencesDb';
import {fishEmailQuotaRetryAt,fishNotifyMissing,readFishNotify,sendFishEmail} from './notify';
import {getUserId,getUserPrefix} from '@/lib/userStoragePrefix';
import {tradeMailContent,type TradeNotice} from './tradeMailEvents';
import {readTradeRoutes,type TradeRoutes} from './tradeMailRoutes';

interface Delivery {notice:TradeNotice; sent:string[]; pending:string[]; retryAt:number}
export function tradeRecipients(notice:TradeNotice,routes:TradeRoutes){
  const route=routes[notice.route];
  if(!route?.enabledAt||notice.at<route.enabledAt)return [];
  return route.recipients.filter(r=>notice.at>=r.since).map(r=>r.email);
}
export async function deliverTradeNotices(owner:string,notices:TradeNotice[],signal:AbortSignal,recorded:Set<string>){
  const active=()=>!signal.aborted&&getUserId()===owner;
  if(!active())return;
  const prefix='instant-trade-mail/v1/'+encodeURIComponent(owner)+'/';
  const routes=readTradeRoutes(owner);
  for(const notice of notices){
    if(!active())return;
    if(recorded.has(notice.id))continue;
    const pending=tradeRecipients(notice,routes);
    if(!pending.length)continue;
    await updateFishPreference<Delivery>(prefix+notice.id,old=>old??{notice,pending,sent:[],retryAt:0});
    recorded.add(notice.id);
  }
  const jobs=await readFishPreferenceEntries<Delivery>(prefix,job=>job.pending.length>0&&Date.now()>=job.retryAt);
  let problem:Error|undefined;
  for(const [id] of jobs){
    if(!active())return;
    // Claim and checkpoint a single delivery even in browsers without Web Locks.
    const lease=crypto.randomUUID();
    type Claimed=Delivery & {lease?:string};
    const mutate=(fn:(job:Claimed)=>Claimed)=>updateFishPreference<Claimed>(prefix+id,fn);
    const job=await mutate(current=>current.pending.length&&Date.now()>=current.retryAt?{...current,lease,retryAt:Date.now()+90_000}:current);
    if(job.lease!==lease)continue;
    try{
      for(const email of job.pending){
        if(!active())return;
        const subscribed=tradeRecipients(job.notice,readTradeRoutes(owner)).includes(email);
        if(subscribed){
          const config={...readFishNotify(),emails:[email]};
          const missing=fishNotifyMissing(config);
          if(missing){problem=new Error(missing);break;}
          if(fishEmailQuotaRetryAt(config,getUserPrefix(owner))){problem=new Error('发信额度暂时用完');break;}
          // Single-recipient requests never expose another subscription's address.
          try{await sendFishEmail(config,tradeMailContent(job.notice),undefined,{signal,onRecipient:()=>mutate(current=>({...current,
            sent:[...new Set([...current.sent,email])],pending:current.pending.filter(e=>e!==email),retryAt:Date.now()+90_000})).then(()=>{})});}
          catch(error){if(signal.aborted)return;problem=error instanceof Error?error:new Error('邮件发送失败');}
        }else await mutate(current=>({...current,pending:current.pending.filter(e=>e!==email)}));
      }
    }finally{
      await mutate(current=>current.lease===lease?{...current,lease:undefined,retryAt:Date.now()+60_000}:current);
    }
  }
  if(problem)throw problem;
}
