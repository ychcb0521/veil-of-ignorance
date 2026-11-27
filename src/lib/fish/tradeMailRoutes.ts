import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { getUserId,getUserPrefix } from '@/lib/userStoragePrefix';
import { readPersistedStateRaw,subscribePersistedStateHydration,writePersistedStateRaw } from '@/lib/persistedStateStorage';
import { queueSimStatePush } from '@/lib/simStateSync';
import { FISH_NOTIFY_MAX_EMAILS,isEmail } from './notify';

export const tradeMailLabels = {paperBuy:'模拟买入',paperSell:'模拟卖出',liveBuy:'实盘买入',liveSell:'实盘卖出'} as const;
export type MailRoute = keyof typeof tradeMailLabels;
export const routeNames = Object.keys(tradeMailLabels) as MailRoute[];
export interface TradeRoute { enabledAt:number; recipients:{email:string;since:number}[] }
export type TradeRoutes = Partial<Record<MailRoute,TradeRoute>>;
const key = 'fish_trade_email_routes_v1';
const localKey=(owner:string)=>getUserPrefix(owner)+key;
export function parseTradeRoutes(raw:string|null):TradeRoutes {
  let saved;
  try { saved=JSON.parse(raw??'{}'); } catch {return {};}
  const routes:TradeRoutes={};
  for(const name of routeNames){
    const value=saved?.[name];
    if(!value||!Number.isSafeInteger(value.enabledAt)||value.enabledAt<0||!Array.isArray(value.recipients))continue;
    const recipients:TradeRoute['recipients']=[];
    for(const r of value.recipients){
      if(typeof r?.email!=='string'||!isEmail(r.email)||!Number.isSafeInteger(r.since)||r.since<=0)continue;
      const email=r.email.trim().toLowerCase();
      if(!recipients.some(item=>item.email===email))recipients.push({email,since:r.since});
      if(recipients.length>=FISH_NOTIFY_MAX_EMAILS)break;
    }
    routes[name]={enabledAt:value.enabledAt,recipients};
  }
  return routes;
}
export const readTradeRoutes=(owner:string)=>parseTradeRoutes(readPersistedStateRaw(localKey(owner)));
export function saveTradeRoute(owner:string,name:MailRoute,edit:(prior:TradeRoute)=>TradeRoute){
  if(!owner||owner!==getUserId())return;
  const routes=readTradeRoutes(owner);
  routes[name]=edit(routes[name]??{enabledAt:0,recipients:[]});
  const next=parseTradeRoutes(JSON.stringify(routes));
  writePersistedStateRaw(localKey(owner),JSON.stringify(next));
  queueSimStatePush(owner,key,next);
}
export function useTradeRoutes(owner?:string){
  const subscribe=useCallback((refresh:()=>void)=>{
    if(!owner)return ()=>{};
    const full=localKey(owner);
    const onStorage=(event:StorageEvent)=>{if(event.key===full)refresh();};
    window.addEventListener('storage',onStorage);
    const unsubscribe=subscribePersistedStateHydration(full,refresh);
    return ()=>{unsubscribe();window.removeEventListener('storage',onStorage);};
  },[owner]);
  const raw=useSyncExternalStore(subscribe,()=>owner?readPersistedStateRaw(localKey(owner)):null,()=>null);
  return useMemo(()=>parseTradeRoutes(raw),[raw]);
}
