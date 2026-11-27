import {useState} from 'react';
import {getUserId} from '@/lib/userStoragePrefix';
import {FISH_NOTIFY_MAX_EMAILS,isEmail} from '@/lib/fish/notify';
import {routeNames,saveTradeRoute,tradeMailLabels,useTradeRoutes,type MailRoute,type TradeRoute} from '@/lib/fish/tradeMailRoutes';
import {FishCheck} from './FishAlgorithmCard';

function RouteRow({owner,name,route}:{owner:string;name:MailRoute;route?:TradeRoute}){
  const [draft,setDraft]=useState(''),[issue,setIssue]=useState('');
  const label=tradeMailLabels[name];
  const add=()=>{
    const addresses=[...new Set(draft.trim().toLowerCase().split(/[\s,;，；]+/).filter(Boolean))];
    if(!addresses.length)return;
    if(addresses.some(email=>!isEmail(email))){setIssue('请检查邮箱格式');return;}
    if(new Set([...(route?.recipients??[]).map(r=>r.email),...addresses]).size>FISH_NOTIFY_MAX_EMAILS){
      setIssue('每类最多 '+FISH_NOTIFY_MAX_EMAILS+' 个邮箱');return;
    }
    const since=Date.now();
    saveTradeRoute(owner,name,prior=>({...prior,recipients:[...prior.recipients,...addresses.filter(email=>!prior.recipients.some(r=>r.email===email)).map(email=>({email,since}))]}));
    setDraft('');setIssue('');
  };
  return <div className="flex flex-wrap items-center gap-2">
    <label className="inline-flex w-24 items-center gap-1.5"><FishCheck checked={!!route?.enabledAt} onChange={e=>{
      const enabledAt=e.target.checked?Date.now():0;
      saveTradeRoute(owner,name,prior=>({...prior,enabledAt}));
    }}/>{label}</label>
    {route?.recipients.map(({email})=><button key={email} type="button" className="rounded bg-muted px-2 py-1" aria-label={'删除'+label+'邮箱 '+email}
      onClick={()=>saveTradeRoute(owner,name,prior=>({...prior,recipients:prior.recipients.filter(r=>r.email!==email)}))}>{email} ×</button>)}
    <input className="h-7 w-48 rounded border bg-background px-2" value={draft} aria-label={label+'收件邮箱'} placeholder="收件邮箱，可添加多个"
      onChange={e=>{setDraft(e.target.value);setIssue('');}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add();}}}/>
    <button type="button" disabled={!draft.trim()} className="rounded border px-2 py-1 disabled:opacity-40" aria-label={'添加'+label+'邮箱'} onClick={add}>添加</button>
    {issue?<span role="alert">{issue}</span>:!!route?.enabledAt&&!route.recipients.length&&<span className="text-muted-foreground">请添加收件邮箱</span>}
  </div>;
}
export function FishTradeMailSettings(){
  const owner=getUserId();
  const routes=useTradeRoutes(owner??undefined);
  if(!owner)return null;
  return <fieldset className="space-y-2 rounded-md border p-2"><legend className="px-1 font-medium">即时交易成交通知</legend>
    <p className="text-muted-foreground">勾选需要推送的类型，并分别添加收件人。实盘通知在同一操作的模拟成交和币安成交都确认后发送。四类共用下方 EmailJS 发信设置。</p>
    {routeNames.map(name=><RouteRow key={owner+name} owner={owner} name={name} route={routes[name]}/>)}
  </fieldset>;
}
