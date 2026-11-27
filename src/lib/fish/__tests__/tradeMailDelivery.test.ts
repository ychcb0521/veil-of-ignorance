import {expect,it,vi} from 'vitest';
import {deliverTradeNotices} from '../tradeMailDelivery';
const state=vi.hoisted(()=>({store:new Map(),owner:'one',send:vi.fn()}));
vi.mock('../fishPreferencesDb',()=>({
  updateFishPreference:async(k:string,fn:Function)=>{const next=fn(state.store.get(k));state.store.set(k,next);return next;},
  readFishPreferenceEntries:async(prefix:string,keep:Function)=>[...state.store].filter(([k,v])=>k.startsWith(prefix)&&keep(v)).map(([k,v])=>[k.slice(prefix.length),v])
}));
vi.mock('@/lib/userStoragePrefix',()=>({getUserId:()=>state.owner,getUserPrefix:(id:string)=>id}));
vi.mock('../tradeMailRoutes',()=>({tradeMailLabels:{paperBuy:'模拟买入'},readTradeRoutes:()=>({paperBuy:{enabledAt:1,recipients:['a@site.com','b@site.com'].map(email=>({email,since:1}))}})}));
vi.mock('../notify',()=>({fishEmailQuotaRetryAt:()=>0,fishNotifyMissing:()=>'',readFishNotify:()=>({}),sendFishEmail:state.send}));
it('retries only the failed address, deduplicates repeats, and never delivers another account’s job',async()=>{
  let fail=true;
  state.send.mockImplementation(async({emails},_content,_request,delivery)=>{
    if(fail&&emails[0]==='a@site.com')throw Error('network');
    await delivery.onRecipient(emails[0]);
  });
  const notices=[{id:'campaign-open',route:'paperBuy' as const,symbol:'TEST',at:2,paper:{at:2,price:1}}];
  const run=()=>deliverTradeNotices('one',notices,new AbortController().signal,new Set());
  await expect(run()).rejects.toThrow('network');
  expect(state.send.mock.calls.map(([config])=>config.emails)).toEqual([['a@site.com'],['b@site.com']]);
  fail=false;
  for(const job of state.store.values())job.retryAt=0;
  state.owner='other';await run();expect(state.send).toHaveBeenCalledTimes(2);
  state.owner='one';await run();await run();
  expect(state.send).toHaveBeenCalledTimes(3);
  expect(state.send.mock.lastCall?.[0].emails).toEqual(['a@site.com']);
});
