import { expect, it } from 'vitest';
import { createPreEntryGate } from '../preEntryGate';
import { emptyPreEntryConditions } from '../preEntryConditions';
import type { FishReconstructionLoader } from '../reconstruction';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { QualityAdditionEntryVeto } from '../qualityAdditionVeto';

const M=60000,T=Date.UTC(2026,2,29,5);
const bar=(openTime:number,high=101,close=100):ResearchBar=>({openTime,open:100,high,low:99,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
function setup(rule:QualityAdditionEntryVeto,five:(at:number)=>ResearchBar){
  let observed=T;
  const requests:{from:number;to:number;step:number}[]=[];
  const load:FishReconstructionLoader=async(_row,from,to,p)=>{
    expect(to).toBeLessThanOrEqual(observed);
    requests.push({from,to,step:p.step});
    return Array.from({length:(to-from)/p.step},(_,i)=>p.step===5*M?five(from+i*p.step):bar(from+i*p.step));
  };
  const gate=createPreEntryGate({conditions:{...emptyPreEntryConditions(),entryVetoes:[rule]},start:T,row:{id:'a',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''},load,signal:new AbortController().signal});
  return {requests,at:async(at:number)=>{observed=at;return gate(at);}};
}
it('uses only completed 5m candles and clears a nonsticky wick veto after its lookback expires',async()=>{
  const r=setup({kind:'upper-wick',enabled:true,lookbackBars:1,atr:1,ratio:60},t=>bar(t,t===T?120:101));
  expect((await r.at(T+4*M)).blocked).toBeUndefined();
  expect((await r.at(T+5*M)).blocked).toContain('长上影');
  expect((await r.at(T+9*M)).blocked).toContain('长上影');
  expect((await r.at(T+10*M)).blocked).toBeUndefined();
  expect(r.requests.filter(r=>r.step===5*M).every(r=>r.to%(5*M)===0)).toBe(true);
});
it('applies the independent lower-wick veto only after the 5m close and clears it when its window expires',async()=>{
 const r=setup({kind:'lower-wick',enabled:true,lookbackBars:1,atr:1,ratio:60},t=>({...bar(t),low:t===T?80:99}));
 expect((await r.at(T+4*M)).blocked).toBeUndefined();
 expect((await r.at(T+5*M)).blocked).toContain('长下影线');
 expect((await r.at(T+9*M)).blocked).toContain('长下影线');
 expect((await r.at(T+10*M)).blocked).toBeUndefined();
 expect(r.requests.filter(r=>r.step===5*M).every(r=>r.to%(5*M)===0)).toBe(true);
});
it('rebuilds sticky peak locks through warmup and keeps them until a full 5m recovery close',async()=>{
  const five=(t:number)=>t<T?bar(t):t===T?bar(t,120,100):t===T+5*M?bar(t,120,119):bar(t,120,120);
  const rule:QualityAdditionEntryVeto={kind:'pullback',enabled:true,pct:10,sticky:true};
  const whole=setup(rule,five);
  expect((await whole.at(T+5*M)).blocked).toBeDefined();
  const atTen=await whole.at(T+10*M);
  expect(atTen.blocked).toContain('尚未以 5 分钟收盘收复');
  const resumed=setup(rule,five);
  expect(await resumed.at(T+10*M)).toEqual(atTen);
  expect((await resumed.at(T+14*M)).blocked).toBeDefined();
  expect((await resumed.at(T+15*M)).blocked).toBeUndefined();
});
it('does not skip a missing prefix minute while restoring the reference path',async()=>{
  const gate=createPreEntryGate({conditions:{...emptyPreEntryConditions(),entryVetoes:[{kind:'fast-drop',enabled:true,windows:[{minutes:1,pct:5}]}]},start:T,row:{id:'a',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''},load:async()=>[bar(T),bar(T+2*M)],signal:new AbortController().signal});
  await expect(gate(T+3*M)).rejects.toThrow();
});
