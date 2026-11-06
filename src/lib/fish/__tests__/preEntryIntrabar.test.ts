import { expect, it, vi } from 'vitest';
import { definitionKey } from '@/lib/deepDig/features';
import { collectPreEntryMonitor, PRE_ENTRY_INTRABAR_VERSION, mergePreEntryLibraries, emptyPreEntryLibrary, type PreEntryRecord } from '../preEntryMonitor';
import { qualityMetricPlan, type QualityGroup } from '../quality';
import { findQualityIntrabarExit } from '../qualityIntrabar';
import type { FishReconstructionLoader } from '../reconstruction';

const M=60000,T=Date.UTC(2026,2,29,5);
const plan=(id='buy',threshold=108,formula='raw = C'):QualityGroup=>({id,label:id,metric:'raw',execution:'intrabar-1m',rule:{metric:'raw',direction:'>',threshold},snapshot:{featureId:'test',definitionKey:definitionKey({formula,positive:'1',control:'0',interval:'5m'}),statistic:'raw',interval:'5m',scale:1,threshold,direction:'>',cutoffMs:T,average:0,cbi2:0,startAverage:0,previousAverage:0}});
const sample={id:'sample',enteredAt:T,basis:'signal' as const,importedAt:T,groups:[],source:{id:'source',symbol:'TURING:TURING 50',timeMs:T,timeLabel:'',fallbackZone:''}};
const row=(at:number,close:number)=>({openTime:at,open:100,high:Math.max(close,100),low:Math.min(close,100),close,volume:1,quoteVolume:20,takerBuyQuoteVolume:10,takerBuyVolume:.5});
const load:FishReconstructionLoader=async(_source,from,cut,p)=>Array.from({length:(cut-from)/p.step},(_,i)=>{const at=from+i*p.step;return row(at,p.step===M&&at>=T+M&&at<T+3*M?109:100);});
async function run(plans:QualityGroup[],loader=load,start?:number) {
 const records:PreEntryRecord[]=plans.map(p=>({id:p.id,roundId:'round',planId:p.id,sample,status:'queued',startTime:T,cursor:T,readings:[],updatedAt:T}));
 await collectPreEntryMonitor({round:{id:'round',engine:PRE_ENTRY_INTRABAR_VERSION,plans,filters:[],hours:0,state:'running',startedAt:T,updatedAt:T},records,onRecord:r=>{records[records.findIndex(x=>x.id===r.id)]=r;}},loader,T+10*M,new AbortController().signal,vi.fn(),{start:async()=>start,end:async()=>T+10*M});
 return records;
}
it('uses the same forming-candle observation as holding and stops before a five-minute reversal',async()=>{
 const p=plan(),[record]=await run([p]);
 const held=await findQualityIntrabarExit({row:sample.source,...qualityMetricPlan(p.snapshot,p.metric),rule:p.rule,entry:T,since:T,end:T+10*M,resumed:false,load,signal:new AbortController().signal});
 expect(record.status).toBe('matched');expect(record.matchedAt).toBe(T+2*M);expect(record.matchedAt).toBe(held.trigger?.at);
 expect(record.readings).toEqual([{key:'primary',value:109,at:T+2*M}]);
});
it('requires the main rule and every enabled confirmation at the same minute, independently per plan',async()=>{
 const p=plan(),volume=plan('volume',50,'raw = Q');
 p.buyFilters=[{id:'amount',label:'成交额',metric:'raw',snapshot:volume.snapshot,enabled:true,direction:'>',threshold:50}];
 const records=await run([p,plan('never',200)]);
 expect(records[0]).toMatchObject({status:'matched',matchedAt:T+3*M});
 expect(records[0].readings.map(r=>r.key).sort()).toEqual(['amount','primary']);
 expect(records[1].status).toBe('unmatched');
});
it('only initializes from the archive origin for the explicit new version',async()=>{
 const original=plan('original',0,'raw = ema(C,6)'),copy={...original,id:'special',initialization:'turing-origin-v1' as const};
 const requests:number[]=[];const read:FishReconstructionLoader=async(...args)=>{requests.push(args[1]);if(args[1]<T)throw Error('不存在的历史');return load(...args);};
 const records=await run([original,copy],read,T);
 expect(records[0].status).toBe('warming');expect(records[1]).toMatchObject({status:'matched',matchedAt:T+M});
 expect(requests.every(from=>from>=T)).toBe(true);
});
it('does not cross a missing minute to find a later match',async()=>{
 const read:FishReconstructionLoader=async(...args)=>(await load(...args)).filter(b=>b.openTime!==T+M);
 const [record]=await run([plan()],read);
 expect(record.status).toBe('error');expect(record.matchedAt).toBeUndefined();
});
it('keeps the newer independent dynamic settings while merging legacy records',()=>{
 const old={...emptyPreEntryLibrary(),settings:{updatedAt:1,hours:3,plans:[plan('old')]}},fresh={...emptyPreEntryLibrary(),settings:{updatedAt:2,hours:9,plans:[plan('new')]}};
 expect(mergePreEntryLibraries(fresh,old).settings).toEqual(fresh.settings);
 expect(mergePreEntryLibraries(fresh,emptyPreEntryLibrary()).settings).toEqual(fresh.settings);
});
