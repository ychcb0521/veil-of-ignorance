import { expect, it, vi } from 'vitest';
import { createEntryStallTurnReader, defaultEntryStallTurn, entryStallTurnMetrics, validateEntryStallTurn } from '../preEntryStallTurn';
import { emptyPreEntryThreeStage } from '../preEntryThreeStage';
import { freezeQualityPlan, planVersionChanges, qualityPlanVersions } from '../qualityPlanVersions';
import { definitionKey } from '../../deepDig/features';
import type { ResearchBar } from '../../deepRsa/window';
import type { FishReconstructionLoader } from '../reconstruction';
import type { QualityGroup } from '../quality';

const M = 60000, T = Date.UTC(2026, 10, 9), row = {id:'r',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const config = () => ({...defaultEntryStallTurn(), pullback:undefined, historyHours:1/12, riseMinutes:5, risePct:3, stallMinutes:4, turnMinutes:2});
const candle = (at:number, open:number, close:number):ResearchBar => ({openTime:at,open,close,high:Math.max(open,close),low:Math.min(open,close),volume:1,takerBuyVolume:.5});
const sequence = (closes:number[], start=100) => closes.map((close,i)=>candle(T+i*M,i?closes[i-1]:start,close));
const reversal = [101,102,103,104,105,105,105,105,105,104,103];
function fixture(recovery=false) {
  const price = (k:number) => k < -12 ? 100 : k <= -2 ? reversal[k+12] : recovery && k>=3 ? Math.min(106,104+k-3) : 103;
  const bar = (at:number) => {const k=(at-T)/M;return candle(at,price(k-1),price(k));};
  const load = vi.fn<FishReconstructionLoader>(async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>bar(from+i*p.step)));
  return {bar,load};
}
it('requires the ordered rise, slowing progress, lower short mean AND a broken local low',()=>{
  const c=config(),bars=sequence(reversal),m=entryStallTurnMetrics(bars,c)!;
  expect(m).toMatchObject({hit:true,progressPct:0,support:105,recoveryPrice:105});expect(m.risePct).toBeCloseTo(5);
  expect(entryStallTurnMetrics(sequence(Array(9).fill(100).concat([99,98])),c)?.hit).toBe(false);
  expect(entryStallTurnMetrics(sequence([101,102,103,104,105,106,107,108,109,108,107]),c)?.hit).toBe(false);
  expect(entryStallTurnMetrics(sequence(reversal.slice(0,9).concat([105,105])),c)?.hit).toBe(false);
  const unbroken=bars.map((b,i)=>i===7?{...b,low:102}:b);expect(entryStallTurnMetrics(unbroken,c)?.hit).toBe(false);
  expect(entryStallTurnMetrics(sequence(reversal.slice(0,9).concat([110,103])),c)?.hit).toBe(false);
});
it('detects a reversal before screening, retains its lock beyond window expiry, and uses bounded transport',async()=>{
  const f=fixture(),read=createEntryStallTurnReader({condition:config(),row,load:f.load,signal:new AbortController().signal});
  for(let i=0;i<100;i++){
    const result=await read(T+(i+1)*M,f.bar(T+i*M));expect(result.blocked).toContain('上涨后滞涨转弱');
    expect(result.readings?.[0]).toMatchObject({role:'veto',value:1,met:true});
  }
  expect(f.load).toHaveBeenCalledOnce();expect(f.load.mock.calls[0][2]).toBe(T);
});
it('only releases on completed consecutive rising closes which reclaim the frozen local price',async()=>{
  const f=fixture(true),read=createEntryStallTurnReader({condition:config(),row,load:f.load,signal:new AbortController().signal});
  for(let i=0;i<4;i++)expect((await read(T+(i+1)*M,f.bar(T+i*M))).blocked).toBeDefined();
  const result=await read(T+5*M,f.bar(T+4*M));expect(result.blocked).toBeUndefined();expect(result.readings?.[0].value).toBe(0);
});
it('freezes a severe pullback high through rebounds, window expiry, wick breaks and equal closes, until a strictly higher close',async()=>{
  const c={...config(),risePct:50,pullback:{enabled:true,pct:3}};
  const past=(at:number)=>candle(at,100,at===T-2*M?96:100);
  const load=vi.fn<FishReconstructionLoader>(async(_row,from,to)=>Array.from({length:(to-from)/M},(_,i)=>past(from+i*M)));
  const read=createEntryStallTurnReader({condition:c,row,load,signal:new AbortController().signal});
  for(let i=0;i<105;i++){
    const close=i===0?96:i===1?97:98;
    const result=await read(T+(i+1)*M,candle(T+i*M,close,close));
    expect(result.blocked).toContain('猛烈回调未创新高');
    expect(result.readings?.find(r=>r.id.endsWith(':peak-lock'))).toMatchObject({threshold:100,met:true});
  }
  const wick={...candle(T+105*M,98,99),high:100.5};
  expect((await read(T+106*M,wick)).blocked).toContain('猛烈回调未创新高');
  expect((await read(T+107*M,candle(T+106*M,99,100))).blocked).toContain('猛烈回调未创新高');
  expect((await read(T+108*M,candle(T+107*M,100,101))).blocked).toBeUndefined();
  expect(load).toHaveBeenCalledOnce();expect(load.mock.calls[0][2]).toBe(T);
});
it('does not create a severe-pullback lock from peaks outside the selected history, and supports disabling just that branch',async()=>{
  const c={...config(),risePct:50,pullback:{enabled:true,pct:3}},signal=new AbortController().signal;
  const load:FishReconstructionLoader=async(_row,from,to)=>Array.from({length:(to-from)/M},(_,i)=>{
    const at=from+i*M;return {...candle(at,100,100),high:at<T-4*M?200:100};
  });
  expect((await createEntryStallTurnReader({condition:c,row,load,signal})(T+M,candle(T,100,100))).blocked).toBeUndefined();
  const disabled={...c,pullback:{enabled:false,pct:3}};
  expect((await createEntryStallTurnReader({condition:disabled,row,load,signal})(T+M,candle(T,100,90))).blocked).toBeUndefined();
  expect((await createEntryStallTurnReader({condition:c,row,load,signal})(T+M,candle(T,100,90))).blocked).toContain('猛烈回调未创新高');
});
it('waits for complete history, rejects gaps or invalid prices, and honors cancellation',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  const young=createEntryStallTurnReader({condition:config(),row,load:f.load,signal,availableStart:T});
  expect((await young(T+M,f.bar(T))).pending).toContain('历史不足');expect(f.load).not.toHaveBeenCalled();
  const broken:FishReconstructionLoader=async(...args)=>(await f.load(...args)).filter(b=>b.openTime!==T-3*M);
  await expect(createEntryStallTurnReader({condition:config(),row,load:broken,signal})(T+M,f.bar(T))).rejects.toThrow();
  await expect(createEntryStallTurnReader({condition:config(),row,load:f.load,signal})(T+M,{...f.bar(T),close:NaN})).rejects.toThrow('价格无效');
  const aborter=new AbortController();aborter.abort();await expect(createEntryStallTurnReader({condition:config(),row,load:f.load,signal:aborter.signal})(T+M,f.bar(T))).rejects.toMatchObject({name:'AbortError'});
});
it('can pause during historical reconstruction and reconstruct the exact same causal result',async()=>{
  const f=fixture(),aborter=new AbortController(),signal=aborter.signal;
  const cancelling:FishReconstructionLoader=async(...args)=>{const bars=await f.load(...args);aborter.abort();return bars;};
  await expect(createEntryStallTurnReader({condition:config(),row,load:cancelling,signal})(T+M,f.bar(T))).rejects.toMatchObject({name:'AbortError'});
  const a=createEntryStallTurnReader({condition:config(),row,load:f.load,signal:new AbortController().signal});
  const b=createEntryStallTurnReader({condition:config(),row,load:f.load,signal:new AbortController().signal});
  for(let i=0;i<10;i++)expect(await a(T+(i+1)*M,f.bar(T+i*M))).toEqual(await b(T+(i+1)*M,f.bar(T+i*M)));
});
it('freezes the new algorithm only by opt-in and detects every changed parameter without rewriting old plans',()=>{
  const p:QualityGroup={id:'p',label:'p',metric:'raw',snapshot:{featureId:'fixture',definitionKey:definitionKey({formula:'raw=C',positive:'1',control:'0',interval:'1m'}),statistic:'raw',interval:'1m',scale:1,threshold:0,cutoffMs:T,average:0,cbi2:0,startAverage:0,previousAverage:0},preEntryThreeStage:emptyPreEntryThreeStage()};
  const old=freezeQualityPlan(p),before=structuredClone(old),next=freezeQualityPlan({...p,preEntryThreeStage:{...p.preEntryThreeStage!,stallTurn:{...config(),pullback:{enabled:true,pct:3}}}});
  expect(qualityPlanVersions(old).some(v=>v.key==='entry-stall-turn')).toBe(false);expect(planVersionChanges(old)).toEqual([]);
  expect(next.frozenVersions?.find(v=>v.key==='entry-stall-turn')?.version).toContain('entry-stall-turn-v1');
  for(const key of ['historyHours','riseMinutes','risePct','stallMinutes','maxProgressPct','turnMinutes'] as const){const changed=structuredClone(next);changed.preEntryThreeStage!.stallTurn![key]++;expect(planVersionChanges(changed).length).toBeGreaterThan(0);}
  for(const patch of [{enabled:false},{pct:4}]){const changed=structuredClone(next);Object.assign(changed.preEntryThreeStage!.stallTurn!.pullback!,patch);expect(planVersionChanges(changed).length).toBeGreaterThan(0);}
  expect(old).toEqual(before);
});
it.each([{riseMinutes:4},{risePct:0},{historyHours:NaN},{maxProgressPct:100},{turnMinutes:1},{turnMinutes:5},{pullback:{enabled:true,pct:0}},{pullback:{enabled:true,pct:100}},{pullback:{enabled:true,pct:NaN}}])('rejects invalid or ambiguous segment configuration %j',patch=>{
  expect(()=>validateEntryStallTurn({...config(),...patch})).toThrow('参数无效');
});
