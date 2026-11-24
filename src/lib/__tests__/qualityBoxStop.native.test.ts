import { expect, it } from 'vitest';
import { makeQualitySellPlan } from '@/lib/fish/qualitySellPlans';
import { evaluateQualitySample, type QualitySample } from '@/lib/fish/quality';
import { freezeQualityPlan, planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { computeDbl5 } from '@/lib/dbl5m';
import { computeSbs5m } from '@/lib/sbs5m';
import { sample as dblSample, T } from './fixtures/dblBars';
import { sbsComplete } from './fixtures/sbsBars';
import { createBoxStopReader, defaultBoxStop, freezeBoxStop } from '@/lib/fish/qualityBoxStop';
import { defaultStructureAddition } from '@/lib/fish/qualityAdditionStructure';
import type { FishReconstructionLoader } from '@/lib/fish/reconstruction';
import type { ResearchBar } from '@/lib/deepRsa/window';
for (const algorithm of ['dbl5','sbs5m'] as const) it(`uses the unchanged native ${algorithm} output as K`,async()=>{
 const fixtures=algorithm==='dbl5'?dblSample():sbsComplete(), entry=T+(algorithm==='dbl5'?15:48)*300000;
 const byTime=new Map(fixtures.map(b=>[b.openTime,b]));
 const at=(t:number):ResearchBar=>({...byTime.get(t)??{openTime:t,open:100,high:100,low:100,close:100,volume:10,takerBuyVolume:5,quoteVolume:1000,takerBuyQuoteVolume:500},DBL5_tick_size:1,SBS5M_tick_size:.1} as ResearchBar);
 const load:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>at(a+i*p.step));
 const history=Array.from({length:288},(_,i)=>at(entry-(288-i)*300000));
 const native=algorithm==='dbl5'?computeDbl5(history,{symbol:'TESTUSDT',tickSize:1}).rows.at(-1)?.active?.D:computeSbs5m(history,{symbol:'TESTUSDT',tickSize:.1}).rows.at(-1)?.active?.s;
 expect(native).toBeGreaterThan(0);
 const rule=freezeBoxStop({...defaultBoxStop(),structure:{...defaultStructureAddition(algorithm),kSource:'current'}});
 const veto={id:'v',kind:'box-stop' as const,label:'box',enabled:true,direction:'<=' as const,threshold:0,boxStop:rule};
 const row={id:'row',symbol:'TESTUSDT',timeMs:entry,timeLabel:'',fallbackZone:''};
 const reader=createBoxStopReader({vetoes:[veto],row,entry,since:entry,load,signal:new AbortController().signal});
 const hit=await reader.read({openTime:entry,open:200,high:200,low:1,close:200,volume:10,takerBuyVolume:5});
 expect(hit?.fillPrice).toBe(native);expect(reader.states().v.line).toBe(native);
});

it('executes a buffered defence line as the primary holding seller',async()=>{
 const entry=T+15*300000, bars=new Map(dblSample().map(b=>[b.openTime,b]));
 const at=(t:number):ResearchBar=>({...bars.get(t)??{openTime:t,open:100,high:100,low:100,close:100,volume:10,takerBuyVolume:5,quoteVolume:1000,takerBuyQuoteVolume:500},DBL5_tick_size:1} as ResearchBar);
 const load:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>p.step===60000
  ? {...at(a+i*p.step),open:200,high:200,low:1,close:200} : at(a+i*p.step));
 const source={id:'row',symbol:'TESTUSDT',timeMs:entry,timeLabel:'',fallbackZone:''};
 const sample:QualitySample={id:'row',source,enteredAt:entry,basis:'signal',groups:[],importedAt:entry};
 const plan=(atr:number)=>freezeQualityPlan(makeQualitySellPlan('sell-dbl5-guard:line','<',atr,[]));
 const evaluate=(atr:number)=>evaluateQualitySample(sample,plan(atr),0,entry+60000,load,new AbortController().signal);
 const unbuffered=await evaluate(0), buffered=await evaluate(.25);
 expect(unbuffered).toMatchObject({status:'closed',exitSnapshot:{cause:{label:'DBL-5 防守线',boxStopEvidence:{confirmation:'touch'}}}});
 expect(buffered).toMatchObject({status:'closed'});
 expect(buffered.endPrice).toBeLessThan(unbuffered.endPrice!);
 expect(planVersionChanges(plan(.25))).toEqual([]);
});

it('reads buffered static distances from closed bars only and keys cached values by ATR',async()=>{
 const cut=T+15*300000, enteredAt=cut+17000;
 const bars=new Map(dblSample().map(b=>[b.openTime,b]));
 const load:FishReconstructionLoader=async(_r,a,b,p)=>{
   expect(b).toBeLessThanOrEqual(cut);
   return Array.from({length:(b-a)/p.step},(_,i)=>{
     const openTime=a+i*p.step;
     return {...bars.get(openTime)??{openTime,open:100,high:100,low:100,close:100,volume:10,takerBuyVolume:5,quoteVolume:1000,takerBuyQuoteVolume:500},DBL5_tick_size:1};
   });
 };
 const source={id:'row',symbol:'TESTUSDT',timeMs:enteredAt,timeLabel:'',fallbackZone:''};
 const sample:QualitySample={id:'row',source,enteredAt,basis:'signal',groups:[],importedAt:enteredAt};
 const {makeStaticDblDistance,staticDblDistanceChoices}=await import('@/lib/fish/qualityStaticDblDistance');
 const {evaluateQualityFilter}=await import('@/lib/fish/quality');
 const guard=staticDblDistanceChoices.find(choice=>choice.metric==='guard')!;
 const nearest=staticDblDistanceChoices.find(choice=>choice.metric==='nearest')!;
 const read=(choice:typeof guard,atr:number)=>evaluateQualityFilter(sample,makeStaticDblDistance(choice,'<',10,true,atr),enteredAt,load,new AbortController().signal);
 const raw=await read(guard,0), buffered=await read(guard,.25), selected=await read(nearest,.25);
 expect(raw).toMatchObject({at:cut,value:expect.any(Number)});
 expect(buffered).toMatchObject({at:cut,value:expect.any(Number)});
 expect(buffered.key).not.toBe(raw.key);
 expect(buffered.value).not.toBe(raw.value);
 expect(selected.value).toBeLessThanOrEqual(buffered.value!);
});
