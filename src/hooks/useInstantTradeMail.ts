import {useEffect,useRef,useState} from 'react';
import {readLocalInstantCampaignJobs,subscribeInstantCampaigns} from '@/lib/fish/instantCampaignStore';
import {tradeMailEvents} from '@/lib/fish/tradeMailEvents';
import {deliverTradeNotices} from '@/lib/fish/tradeMailDelivery';
import {useTradeRoutes} from '@/lib/fish/tradeMailRoutes';
import type {UsdtFollowStatus} from '@/lib/fish/usdtFollow';
import type {FishCdaTracking} from './useFishCdaTracking';

export function useInstantTradeMail(owner:string|undefined,tracking:FishCdaTracking,statuses:UsdtFollowStatus[]){
  const routes=useTradeRoutes(owner);
  const enabled=Object.values(routes).some(route=>route.enabledAt&&route.recipients.length);
  const [status,setStatus]=useState<{owner:string;issue:string}>();
  const wake=useRef<()=>void>();
  const current=useRef({tracking,statuses});
  current.current={tracking,statuses};
  useEffect(()=>{
    if(!owner||!enabled||typeof indexedDB==='undefined')return;
    const controller=new AbortController();
    const signal=controller.signal;
    let running=false,again=false;
    let jobs:Awaited<ReturnType<typeof readLocalInstantCampaignJobs>>=[];
    let dirty=true;
    const recorded=new Set<string>();
    const run=async()=>{
      if(dirty){dirty=false;try{jobs=await readLocalInstantCampaignJobs(owner);}catch(error){dirty=true;throw error;}}
      if(signal.aborted)return;
      const {tracking,statuses}=current.current;
      const deliver=()=>deliverTradeNotices(owner,tradeMailEvents(jobs,tracking,statuses),signal,recorded);
      if(navigator.locks)await navigator.locks.request('veil-trade-mail:'+owner,{ifAvailable:true},lock=>lock?deliver():undefined);
      else await deliver();
    };
    const refresh=()=>{
      if(signal.aborted)return;
      if(running){again=true;return;}
      running=true;
      void run().then(()=>{if(!signal.aborted)setStatus(old=>old?.issue?undefined:old);},error=>{
        if(!signal.aborted)setStatus({owner,issue:error instanceof Error?error.message:'成交通知待重试'});
      }).finally(()=>{
        running=false;
        if(again){again=false;refresh();}
      });
    };
    wake.current=refresh;
    const unsubscribe=subscribeInstantCampaigns(owner,()=>{dirty=true;refresh();});
    const interval=window.setInterval(refresh,60_000);
    window.addEventListener('online',refresh);
    refresh();
    return ()=>{controller.abort();wake.current=undefined;unsubscribe();window.clearInterval(interval);window.removeEventListener('online',refresh);};
  },[owner,enabled,routes]);
  useEffect(()=>{wake.current?.();},[statuses,tracking.monitorResults,tracking.mirrorFills,tracking.manualPositions]);
  return enabled&&status?.owner===owner?status?.issue:undefined;
}
