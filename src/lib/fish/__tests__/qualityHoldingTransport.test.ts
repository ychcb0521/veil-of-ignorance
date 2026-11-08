import {expect,it,vi} from 'vitest';
import {firstMatchFixture,MATCHED_AT} from './qualityFirstMatch.fixture';
import {withQualityScreeningEntries} from '../qualityScreeningResults';
import {collectFishQuality,evaluateQualitySample,qualityRunSamples,type QualityResult,type QualitySample,type QualityGroup} from '../quality';
import {sample as nativeSample,T} from '@/lib/__tests__/fixtures/dblBars';
import {defaultQualityAddition} from '../qualityAddition';
import {defaultStructureAddition} from '../qualityAdditionStructure';
import {definitionKey} from '@/lib/deepDig/features';
import {defaultBoxBreak} from '../qualityBoxStop';
import {freezeQualityPlan} from '../qualityPlanVersions';
import {preEntryWindowLoader} from '../preEntryWindowLoader';
import {compileFishProgram} from '../algorithm';
import {FishError} from '../shared';
import type {FishReconstructionLoader} from '../reconstruction';

const STEP=300000;
const bar=(openTime:number)=>({openTime,open:100,high:100,low:100,close:100,volume:10,quoteVolume:1000,takerBuyVolume:5,takerBuyQuoteVolume:500,DBL5_tick_size:1,SBS5M_tick_size:1});
it('replays the same native-box holding result with fewer 5m requests and the first-match buy time intact',async()=>{
 const {study:original,library,plan}=firstMatchFixture(),study=withQualityScreeningEntries(original,library),end=MATCHED_AT+2*86400000;
 const holding=freezeQualityPlan({...plan,rule:undefined,holdingVetoes:[{id:'break',label:'支撑断裂',kind:'box-stop',enabled:true,direction:'<=',threshold:0,boxStop:defaultBoxBreak()}]});
 study.sellPlans=[holding];const row=qualityRunSamples(study)[0];
 const makeLoader=()=>vi.fn<FishReconstructionLoader>(async(_r,from,cut,p)=>{
  // Controlled network latency; timing is reported, correctness and request counts are asserted.
  if(p.step===STEP)await new Promise(resolve=>setTimeout(resolve,3));
  return Array.from({length:(cut-from)/p.step},(_,i)=>bar(from+i*p.step));
 });
 const baselineLoad=makeLoader(),optimizedLoad=makeLoader(),signal=new AbortController().signal;
 const start=performance.now(),baseline=await evaluateQualitySample(row,holding,0,end,baselineLoad,signal),baselineMs=performance.now()-start;
 const results:QualityResult[]=[],next=performance.now();
 await collectFishQuality({study,task:'monitor',signal,onProgress:()=>{},onResult:r=>results.push(r)},optimizedLoad,end);
 const optimizedMs=performance.now()-next;
 expect(baseline).toMatchObject({status:'open',entryTime:MATCHED_AT,entryPrice:100});
 expect(results).toEqual([baseline]);
 const before=baselineLoad.mock.calls.filter(c=>c[3].step===STEP).length,after=optimizedLoad.mock.calls.filter(c=>c[3].step===STEP).length;
 expect(before).toBeGreaterThan(500);expect(after).toBeLessThan(before/20);
 console.log(JSON.stringify({baselineMs:Math.round(baselineMs),optimizedMs:Math.round(optimizedMs),baseline5mRequests:before,optimized5mRequests:after,resultExactlyEqual:true}));
});

it('returns only the requested closed prefix and never lets a later gap reject an earlier valid observation',async()=>{
 const plan=compileFishProgram({id:'p',name:'p',short:'p',definition:'',formula:'C',scale:1,unit:'',positive:'1',control:'0',interval:'5m'},{statistic:'结果',direction:'>',threshold:0,constraints:[]});
 const row={id:'x',symbol:'TESTUSDT',timeMs:MATCHED_AT+200*STEP,timeLabel:'',fallbackZone:''},signal=new AbortController().signal;
 const base=vi.fn<FishReconstructionLoader>(async(_r,from,cut,p)=>{
  if(cut>MATCHED_AT+2*STEP)throw new FishError('future missing','gap');
  return Array.from({length:(cut-from)/p.step},(_,i)=>bar(from+i*p.step));
 });
 const load=preEntryWindowLoader(base,row.timeMs);
 expect(await load(row,MATCHED_AT,MATCHED_AT+STEP,plan,signal)).toEqual([bar(MATCHED_AT)]);
 await expect(load(row,MATCHED_AT+2*STEP,MATCHED_AT+3*STEP,plan,signal)).rejects.toThrow('future missing');
 const complete:FishReconstructionLoader=async(_r,from,cut,p)=>Array.from({length:(cut-from)/p.step},(_,i)=>bar(from+i*p.step));
 const cached=preEntryWindowLoader(complete,row.timeMs);
 expect(await cached(row,MATCHED_AT,MATCHED_AT+STEP,plan,signal)).toHaveLength(1);
 const controller=new AbortController();controller.abort();
 await expect(cached(row,MATCHED_AT,MATCHED_AT+STEP,plan,controller.signal)).rejects.toMatchObject({name:'AbortError'});
 expect(MATCHED_AT%STEP).toBe(0);
});

it.each([50,67])('preserves native structure additions, mirror %s%%, exits, quantities and pause/resume results exactly',async sellPct=>{
 const fixtures=nativeSample(),byTime=new Map(fixtures.map(b=>[b.openTime,b])),entry=T-STEP,end=T+17*STEP;
 const plain=(at:number)=>({...bar(at),open:90,high:91,low:89,close:90});
 const load:FishReconstructionLoader=async(_row,from,cut,p)=>Array.from({length:(cut-from)/p.step},(_,i)=>{
  const at=from+i*p.step;
  if(p.step===STEP)return {...byTime.get(at)??plain(at),DBL5_tick_size:1,SBS5M_tick_size:.1};
  if(at<T)return plain(at);
  const b=byTime.get(Math.floor(at/STEP)*STEP)??fixtures.at(-1)!;
  return {...b,openTime:at,open:b.close,low:b.close-.1,high:b.close+.1};
 });
 const def={id:'never-sell',name:'不卖',short:'不卖',definition:'',formula:'raw = C',scale:1,unit:'',positive:'1',control:'0',interval:'1m' as const};
 const snapshot={featureId:def.id,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:0,average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:entry};
 const sample:QualitySample={id:'structure-run',enteredAt:entry,basis:'capture',importedAt:entry,groups:[],source:{id:'x',symbol:'TESTUSDT',timeMs:entry,timeLabel:'',fallbackZone:'',fish:snapshot}};
 const group:QualityGroup={id:'g',label:'箱体加仓',snapshot,metric:'raw',rule:{metric:'raw',direction:'<',threshold:0},mirrorTakeProfit:{enabled:true,gainPct:5,sellPct},addition:{...defaultQualityAddition(),enabled:true,source:'structure',structure:{...defaultStructureAddition('dbl5'),buffer:0},entryBufferAtr:0,maxRounds:1}};
 const before=structuredClone(group),signal=new AbortController().signal;
 const baseline=await evaluateQualitySample(sample,group,0,end,load,signal);
 const optimized=await evaluateQualitySample(sample,group,0,end,preEntryWindowLoader(load,end),signal);
 expect(baseline.status).not.toBe('error');expect(baseline.additionFills).toHaveLength(1);
 expect(optimized).toEqual(baseline);expect(group).toEqual(before);
 const cut=T+13*STEP,partial=await evaluateQualitySample(sample,group,0,cut,load,signal);
 const resumed=await evaluateQualitySample(sample,group,0,end,load,signal,partial);
 const fastPartial=await evaluateQualitySample(sample,group,0,cut,preEntryWindowLoader(load,cut),signal);
 expect(fastPartial).toEqual(partial);
 expect(await evaluateQualitySample(sample,group,0,end,preEntryWindowLoader(load,end),signal,fastPartial)).toEqual(resumed);
});
