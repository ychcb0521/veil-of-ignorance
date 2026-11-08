import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as features from '@/lib/deepDig/features';
import { createBoxStopReader, defaultBoxStop, boxStopIdentity, validateBoxStop, type BoxStopRule } from '@/lib/fish/qualityBoxStop';
import { evaluateQualitySample, type QualityGroup, type QualitySample } from '@/lib/fish/quality';
import { freezeQualityPlan, planVersionChanges, qualityPlanVersions } from '@/lib/fish/qualityPlanVersions';
import { holdingVetoDraft, parseHoldingVetoDraft } from '@/lib/fish/qualityFilters';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
import type { QualityHoldingVeto } from '@/lib/fish/qualityVeto';
const M=60000,T=Date.UTC(2026,9,20),signal=new AbortController().signal;
const row={id:'a',symbol:'RAVEUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const sample:QualitySample={id:'a',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:row};
const bar=(at:number,open=100,low=open,close=open):ResearchBar=>({openTime:at,open,high:Math.max(open,close),low,close,volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50});
let support:(at:number)=>number|null,invalid=false;
beforeEach(()=>{
 support=()=>90;invalid=false;
 vi.spyOn(features,'evaluateOnBars').mockImplementation(bars=>({vars:new Map(),DBL5_details:bars.map(b=>{const n=support(b.openTime+5*M);return {at:b.openTime+5*M,data_valid:!invalid,darvas_5m_available:n!=null,active:n==null?null:{box_id:String(n),D:n},darvas_5m_guard:n==null?null:n-1};})} as unknown as ReturnType<typeof features.evaluateOnBars>));
});
afterEach(()=>vi.restoreAllMocks());
const veto=(rule=defaultBoxStop()):QualityHoldingVeto=>({id:'box',label:'箱体终止',kind:'box-stop',direction:'<=',threshold:0,enabled:true,boxStop:rule});
const load=(minute:(t:number)=>ResearchBar=bar):FishReconstructionLoader=>async(_row,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===M?minute(a+i*M):bar(a+i*p.step));
const reader=(rule=defaultBoxStop(),previous?:Parameters<typeof createBoxStopReader>[0]['previous'],since=T)=>createBoxStopReader({vetoes:[veto(rule)],row,entry:T,since,load:load(),signal,previous});
const plan=(rule=defaultBoxStop()):QualityGroup=>({id:'g',label:'box',metric:'raw',vetoFill:'stop',holdingVetoes:[veto(rule)],snapshot:{featureId:'p',definitionKey:'C',statistic:'raw',interval:'5m',scale:1,threshold:0,direction:'<',average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:T}});
it('touch means an exact K wick fills at K in that minute, without a mirror or any addition',async()=>{
 const result=await evaluateQualitySample(sample,plan(),0,T+3*M,load(t=>t===T?bar(t,100,90,99):bar(t)),signal);
 expect(result).toMatchObject({status:'closed',endTime:T,endPrice:90,exitSnapshot:{cause:{kind:'box-stop',threshold:90,boxStopEvidence:{version:'holding-box-stop-v1',confirmedAt:T}}}});
 expect(result.reason).not.toContain('90%');
});
it('a gap through K fills at the observed open rather than a nonexistent K price',async()=>{
 expect(await reader().read(bar(T,80,75,79))).toMatchObject({at:T,fillPrice:80,atOpen:true});
});
it('never uses a box confirmed at the end of this minute to stop an earlier wick',async()=>{
 support=at=>at<T+5*M?90:99;
 const r=reader();expect(await r.read(bar(T+4*M,100,95,100))).toBeUndefined();
 expect(await r.read(bar(T+5*M,100,95,100))).toMatchObject({fillPrice:99});
 expect(r.statesAt(T+4*M).box.line).toBe(90);
});
it('fixed, raise-only and freely following lines are independent user choices',async()=>{
 support=at=>at<=T?90:80;
 for(const [update,expected] of [['fixed',90],['raise-only',90],['follow',80]] as const){const r=reader({...defaultBoxStop(),update});await r.read(bar(T));await r.read(bar(T+5*M));expect(r.states().box.line).toBe(expected);}
});
it('a v7 observation restart binds the current native line and clears confirmations without replaying native history',async()=>{
 support=at=>at<=T?90:80;const rule={...defaultBoxStop(),update:'fixed' as const,confirmation:'close-1m' as const,closes:2};
 const loaded=vi.fn(load()),r=createBoxStopReader({vetoes:[veto(rule)],row,entry:T,since:T,load:loaded,signal});
 await r.read(bar(T,100,88,89));expect(r.states().box.count).toBe(1);await r.read(bar(T+5*M));expect(r.states().box.line).toBe(90);
 const calls=loaded.mock.calls.length;r.restartObservation(T+6*M);expect(r.states().box).toMatchObject({line:80,count:0});await r.read(bar(T+6*M,100,90,100));expect(loaded.mock.calls).toHaveLength(calls);
});
it('waits when no confirmed structure exists; once placed, K survives a broken box',async()=>{
 support=()=>null;expect(await reader().read(bar(T,100,1,100))).toBeUndefined();
 support=at=>at<=T?90:null;const r=reader();await r.read(bar(T));expect(await r.read(bar(T+5*M,100,89,99))).toMatchObject({fillPrice:90});
});
it('1m close confirmations resume without losing the count and fill on the following minute open',async()=>{
 const rule:BoxStopRule={...defaultBoxStop(),confirmation:'close-1m',closes:2};
 const r=reader(rule);expect(await r.read(bar(T,100,88,89))).toBeUndefined();
 const resumed=reader(rule,r.states(),T+M);expect(await resumed.read(bar(T+M,89,88,89))).toMatchObject({at:T+2*M});
 const l=load(t=>t<T+2*M?bar(t,100,88,89):bar(t,85));
 const first=await evaluateQualitySample(sample,plan(rule),0,T+M,l,signal);
 expect(first.boxStopStates?.box.count).toBe(1);
 const continued=await evaluateQualitySample(sample,plan(rule),0,T+4*M,l,signal,first);
 expect(continued).toMatchObject({status:'closed',endTime:T+2*M,endPrice:85});
 expect(continued).toEqual(await evaluateQualitySample(sample,plan(rule),0,T+4*M,l,signal));
});
it('5m confirmation ignores intraminute and non-boundary closes and resets on a recovered close',async()=>{
 const r=reader({...defaultBoxStop(),confirmation:'close-5m',closes:2});
 expect(await r.read(bar(T,100,80,89))).toBeUndefined();expect(r.states().box.count).toBe(0);
 expect(await r.read(bar(T+4*M,100,80,89))).toBeUndefined();expect(r.states().box.count).toBe(1);
 expect(await r.read(bar(T+9*M,100,80,100))).toBeUndefined();expect(r.states().box.count).toBe(0);
});
it('rejects missing data instead of inventing or skipping a line',async()=>{invalid=true;await expect(reader().read(bar(T))).rejects.toThrow('不能跳过缺口');});
it('freezes rules in plans and roundtrips drafts; changing parameters creates a distinct result identity',()=>{
 const original=plan(),frozen=freezeQualityPlan(original);expect(planVersionChanges(frozen)).toEqual([]);
 expect(qualityPlanVersions(frozen).find(v=>v.key==='hard-stop-box-0')?.version).toContain('holding-box-stop-v1');
 const saved=parseHoldingVetoDraft(holdingVetoDraft(original.holdingVetoes));expect(saved[0].boxStop).toEqual(original.holdingVetoes![0].boxStop);
 const changed={...defaultBoxStop(),closes:3};expect(boxStopIdentity(changed)).not.toEqual(boxStopIdentity(defaultBoxStop()));
 expect(()=>validateBoxStop({...changed,closes:0})).toThrow();
});
