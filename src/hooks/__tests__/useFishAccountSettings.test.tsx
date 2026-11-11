import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const cloud = vi.hoisted(() => ({ rows: new Map<string, {key:string;value:unknown;updated_at:string}>(), fail: false, writes: 0 }));
vi.mock('@/integrations/supabase/client', () => ({supabase:{from:()=>({
  upsert:async (row:{user_id:string;key:string;value:unknown;updated_at:string})=>{
    cloud.writes++;
    if(cloud.fail)return {error:{code:'500',message:'offline'}};
    cloud.rows.set(row.user_id+row.key,row);return {error:null};
  },
  select:()=>({not:()=>({eq:(_field:string,uid:string)=>{
    const result={data:[...cloud.rows.entries()].filter(([id])=>id.startsWith(uid)).map(([,row])=>row),error:null};
    return {then:(resolve:(r:unknown)=>void)=>Promise.resolve(result).then(resolve),in:(_key:string,keys:string[])=>Promise.resolve({...result,data:result.data.filter(row=>keys.includes(row.key))})};
  }})})
})}}));
import { useFishAccountSettings } from '../useFishAccountSettings';
import { __resetSimStateSyncForTests, hydrateSimState } from '@/lib/simStateSync';
import { FISH_ACCOUNT_SETTINGS_KEY, type FishAccountSettings } from '@/lib/fish/accountSettings';
import { readFishCards, readFishCombination } from '@/lib/fish/cards';
import { readFishLookback } from '@/lib/fish/lookback';
import { resetFishAuto } from '@/lib/fish/autoScan';
import { FISH_WICK_SETTINGS_KEY, readFishDownwardWick } from '@/lib/fish/downwardWick';
const login=(id:string)=>localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id}}));
const value:FishAccountSettings={version:1,cards:[{id:'first',featureId:'cbi2',enabled:true,pref:{statistic:'avg_CBI2_2',direction:'<',threshold:'0.987',constraints:[]}}],combination:'or',lookbackHours:24,downwardWick:{enabled:false,hours:12,atrMultiple:2},selection:{exchanges:['binance'],includeDuplicates:true},auto:{mode:'manual',hours:8}};
beforeEach(()=>{localStorage.clear();__resetSimStateSyncForTests();cloud.rows.clear();cloud.fail=false;cloud.writes=0;login('A');});
afterEach(()=>__resetSimStateSyncForTests());
it('explicit save is acknowledged by the account server; a clean second computer restores the entire configuration',async()=>{
  const first=renderHook(()=>useFishAccountSettings());
  expect(cloud.writes).toBe(0);
  await act(async()=>first.result.current.save(value));
  expect(cloud.rows.get('A'+FISH_ACCOUNT_SETTINGS_KEY)?.value).toEqual(value);
  first.unmount();localStorage.clear();__resetSimStateSyncForTests();login('A');
  await hydrateSimState('A');
  const second=renderHook(()=>useFishAccountSettings());
  expect(second.result.current.settings).toEqual(value);
  expect(readFishCards()).toEqual(value.cards);expect(readFishCombination()).toBe('or');
  expect(readFishLookback()).toBe(24);expect(readFishDownwardWick()).toEqual(value.downwardWick);
  expect(resetFishAuto()).toMatchObject({mode:'manual',hours:8});
  // Opening cannot republish a preset over the saved server configuration.
  expect(cloud.writes).toBe(1);
});
it('an already open computer adopts another computer’s save on focus, while other accounts stay isolated',async()=>{
  await hydrateSimState('A');
  const view=renderHook(()=>useFishAccountSettings(true));
  await act(async()=>{await Promise.resolve();});
  cloud.rows.set('A'+FISH_ACCOUNT_SETTINGS_KEY,{key:FISH_ACCOUNT_SETTINGS_KEY,value,updated_at:new Date(Date.now()+1000).toISOString()});
  await act(async()=>{window.dispatchEvent(new Event('focus'));});
  await waitFor(()=>expect(view.result.current.settings).toEqual(value));
  login('B');view.rerender();
  await waitFor(()=>expect(view.result.current.settings).toBeNull());
  expect(readFishCards()).toEqual([]);
});
it('a failed cloud save reports failure and keeps the local value available for retry',async()=>{
  cloud.fail=true;const view=renderHook(()=>useFishAccountSettings());
  await act(async()=>{await expect(view.result.current.save(value)).rejects.toThrow('云端尚未确认');});
  expect(view.result.current.settings).toEqual(value);expect(cloud.rows.size).toBe(0);
  cloud.fail=false;
  await act(async()=>view.result.current.save(value));
  expect(cloud.rows.get('A'+FISH_ACCOUNT_SETTINGS_KEY)?.value).toEqual(value);
});

it('server preferences win even when the other computer’s clock is behind',async()=>{
 const view=renderHook(()=>useFishAccountSettings());
 await act(async()=>view.result.current.save(value));
 const remote={...value,lookbackHours:48};
 cloud.rows.set('A'+FISH_ACCOUNT_SETTINGS_KEY,{key:FISH_ACCOUNT_SETTINGS_KEY,value:remote,updated_at:'2000-01-01T00:00:00.000Z'});
 await act(async()=>{await hydrateSimState('A',[FISH_ACCOUNT_SETTINGS_KEY]);});
 expect(view.result.current.settings).toEqual(remote);
});

it('updates coverage in saved account settings without replacing fixed algorithms and restores it on another computer', async () => {
 const first=renderHook(()=>useFishAccountSettings());
 await act(()=>first.result.current.save(value));
 await act(()=>first.result.current.saveLookback(1));
 expect(cloud.rows.get('A'+FISH_ACCOUNT_SETTINGS_KEY)?.value).toEqual({...value,lookbackHours:1});
 expect(readFishLookback()).toBe(1);
 first.unmount();localStorage.clear();__resetSimStateSyncForTests();login('A');
 await hydrateSimState('A');
 expect(readFishLookback()).toBe(1);
 expect(readFishCards()).toEqual(value.cards);
 login('B');
 expect(readFishLookback()).toBe(1);
 const second=renderHook(()=>useFishAccountSettings());
 await act(()=>second.result.current.saveLookback(4));
 expect(readFishLookback()).toBe(4);
 login('A');
 expect(readFishLookback()).toBe(1);
 second.unmount();
});

it('persists coverage for an account without a fixed algorithm snapshot', async () => {
 const first=renderHook(()=>useFishAccountSettings());
 expect(readFishLookback()).toBe(1);
 await act(()=>first.result.current.saveLookback(2));
 expect(first.result.current.settings).toBeNull();
 first.unmount();localStorage.clear();__resetSimStateSyncForTests();login('A');
 await hydrateSimState('A');
 expect(readFishLookback()).toBe(2);
 const second=renderHook(()=>useFishAccountSettings());
 await act(async()=>{await expect(second.result.current.saveLookback(0)).rejects.toThrow('扫描覆盖时间');});
 expect(readFishLookback()).toBe(2);
 second.unmount();
});

it('saves custom wick settings separately and adopts them on another device without replacing the existing account settings', async () => {
  const first = renderHook(() => useFishAccountSettings());
  await act(() => first.result.current.save(value));
  const original = first.result.current.settings;
  const wick = { enabled:true, hours:1, atrMultiple:4.25 };
  await act(() => first.result.current.saveDownwardWick(wick));
  expect(first.result.current.settings).toBe(original);
  expect(first.result.current.downwardWick).toEqual(wick);
  expect(cloud.rows.get('A'+FISH_ACCOUNT_SETTINGS_KEY)?.value).toEqual(value);
  expect(cloud.rows.get('A'+FISH_WICK_SETTINGS_KEY)?.value).toEqual(wick);
  await act(() => first.result.current.saveLookback(2));
  expect(readFishDownwardWick()).toEqual(wick);

  first.unmount();localStorage.clear();__resetSimStateSyncForTests();login('A');
  await hydrateSimState('A');
  const second=renderHook(()=>useFishAccountSettings(true));
  expect(second.result.current.downwardWick).toEqual(wick);
  expect(second.result.current.settings).toEqual({...value,lookbackHours:2});
  const remote = {...wick,hours:24,atrMultiple:3.75};
  cloud.rows.set('A'+FISH_WICK_SETTINGS_KEY,{key:FISH_WICK_SETTINGS_KEY,value:remote,updated_at:'2000-01-01T00:00:00.000Z'});
  await act(()=>hydrateSimState('A',[FISH_WICK_SETTINGS_KEY]));
  expect(second.result.current.downwardWick).toEqual(remote);
  login('B');second.rerender();
  expect(second.result.current.downwardWick).toEqual({enabled:true,hours:48,atrMultiple:3});
});
