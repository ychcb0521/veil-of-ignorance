import {expect,it,vi} from 'vitest';
import {definitionKey} from '@/lib/deepDig/features';
import {qualityEntryKey,qualityEntryParts,evaluateQualityEntry,mergeQualityEntryReading,preserveQualityEntry,type QualityEntryTarget} from '@/lib/fish/qualityEntry';
import {collectFishQuality,evaluateQualitySample,newQualityStudy,type QualityGroup,type QualityResult,type QualitySample} from '@/lib/fish/quality';
import {qualitySalePriceChangePct} from '@/lib/fish/qualityPresentation';
import type {FishReconstructionLoader} from '@/lib/fish/reconstruction';
const T=Date.UTC(2026,9,20),M=60000;
const def={id:'entry-test',name:'价格',short:'价格',formula:'raw = C',definition:'',scale:1,unit:'',positive:'1',control:'0',interval:'5m' as const};
const plan:QualityGroup={id:'p',label:'价格',metric:'raw',execution:'intrabar-1m',snapshot:{featureId:def.id,definitionKey:definitionKey(def),statistic:'raw',interval:'5m',scale:1,threshold:0,average:0,cbi2:0,previousAverage:0,startAverage:0,cutoffMs:T},rule:{metric:'raw',direction:'<',threshold:104}};
const source={id:'s',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:''},result:QualityResult={key:'frozen',sampleId:'s',groupId:plan.id,status:'closed',entryTime:T+2*M,entryPrice:100,endTime:T+10*M,endPrice:110,returnPct:10,evaluatedAt:T+10*M};
const target=(p=plan):QualityEntryTarget=>({source,result,plan:p,part:qualityEntryParts(p)[0]});
const load:FishReconstructionLoader=async(_s,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>{const time=a+i*p.step,close=p.step===M?time===T?102:time===T+M?103:999999:101;return {openTime:time,open:100,high:Math.max(100,close),low:100,close,volume:1,quoteVolume:100,takerBuyQuoteVolume:50,takerBuyVolume:.5};});
const signal=()=>new AbortController().signal;
it('replays only completed pre-entry minutes, matches the sell engine entry observation, and retains close-only cadence',async()=>{
 const spy=vi.fn(load),reading=await evaluateQualityEntry(target(),spy,T+20*M,signal());expect(reading.value).toBe(103);expect(reading.at).toBe(T+2*M);expect(spy.mock.calls.every(c=>c[2]<=result.entryTime!)).toBe(true);
 const sample:QualitySample={id:'s',source,enteredAt:result.entryTime!,importedAt:T,basis:'signal',groups:[]};const actual=await evaluateQualitySample(sample,plan,0,T+20*M,load,signal());expect(actual.exitReading).toBe(reading.value);
 const closed={...plan,execution:undefined};expect(await evaluateQualityEntry(target(closed),load,T+20*M,signal())).toMatchObject({mode:'closed',value:101,at:T});
 const mirrored={...closed,mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50}};expect((await evaluateQualityEntry(target(mirrored),load,T+20*M,signal())).mode).toBe('closed');
 const boundary={...target(),result:{...result,entryTime:T}};expect(await evaluateQualityEntry(boundary,load,T+20*M,signal())).toMatchObject({value:101,at:T});
});
it('keys frozen formula, interval, metric, mode, entry and venue while thresholds and exits do not change an entry value',()=>{
 const key=qualityEntryKey(source,result,plan,target().part);expect(qualityEntryKey(source,{...result,endPrice:50}, {...plan,rule:{...plan.rule!,threshold:999}},target().part)).toBe(key);
 for(const t of [{...target(),source:{...source,exchange:'bybit' as const}},{...target(),result:{...result,entryTime:T+M}},{...target(),plan:{...plan,execution:undefined}},{...target(),part:{...target().part,metric:'capture'}},{...target(),part:{...target().part,snapshot:{...plan.snapshot,definitionKey:definitionKey({...def,formula:'raw = C * 2'})}}}])expect(qualityEntryKey(t.source,t.result,t.plan,t.part)).not.toBe(key);
 expect(qualityEntryKey(source,{...result,status:'error'},plan,target().part)).toBeNull();
});
it('evaluates both combination parts at the same entry time, carries minute amount/BTC inputs and reports missing history',async()=>{
 const afterDef={...def,formula:'raw = C * 2'},combo={...plan,combo:{switchPct:5,beforeLabel:'前',after:{label:'后',metric:'raw',snapshot:{...plan.snapshot,definitionKey:definitionKey(afterDef)},rule:{metric:'raw',direction:'<' as const,threshold:1}}}};
 const parts=qualityEntryParts(combo);expect(parts).toHaveLength(2);expect((await evaluateQualityEntry({...target(combo),part:parts[1]},load,T+20*M,signal())).value).toBe(206);
 const amountDef={...def,formula:'raw = Q + B + S + CB'},p={...plan,snapshot:{...plan.snapshot,definitionKey:definitionKey(amountDef)}};const calls:Parameters<FishReconstructionLoader>[]=[];
 const transport:FishReconstructionLoader=async(...args)=>{calls.push(args);return (await load(...args)).map(b=>({...b,refClose:200}));};
 expect((await evaluateQualityEntry(target(p),transport,T+20*M,signal())).value).toBe(600);const minute=calls.find(c=>c[3].step===M)![3];expect(minute.usesTaker).toBe(true);expect(minute.compiled.usesBtc).toBe(true);expect(minute.compiled.usesAmounts).toBe(true);
 expect((await evaluateQualityEntry(target(),async()=>[],T+20*M,signal())).error).toBeTruthy();
});
it('preserves independent entry cache success, including zero, across failures without touching monetary results',async()=>{
 const ok={...await evaluateQualityEntry(target(),load,T+20*M,signal()),value:0},bad={...ok,value:undefined,error:'断线',evaluatedAt:ok.evaluatedAt+1};expect(mergeQualityEntryReading(ok,bad)).toBe(ok);
 const study={...newQualityStudy(),results:[result],entryReadings:[ok]},before=JSON.stringify(study.results),merged=preserveQualityEntry(study,{...study,entryReadings:[bad]});expect(merged.entryReadings![0].value).toBe(0);expect(JSON.stringify(merged.results)).toBe(before);
 const onResult=vi.fn(),onEntryReading=vi.fn(),spy=vi.fn(load);await collectFishQuality({study,task:'entry',entryTargets:[target(),target()],signal:signal(),onProgress:()=>{},onResult,onEntryReading},spy,T+20*M);expect(onEntryReading).toHaveBeenCalledTimes(1);expect(onResult).not.toHaveBeenCalled();expect(JSON.stringify(study.results)).toBe(before);
 const aborter=new AbortController();aborter.abort();await expect(evaluateQualityEntry(target(),load,T+20*M,aborter.signal)).rejects.toThrow('已取消');
});
it('keeps final sale price change separate from ROI, mirror/addition sizing, unfinished positions and missing data',()=>{
 expect(qualitySalePriceChangePct({...result,endPrice:90,returnPct:20,averageEntryPrice:80,mirrorFill:{at:T+3*M,price:150,fraction:.5,gainPct:50,atOpen:false}})).toBeCloseTo(-10);
 expect(qualitySalePriceChangePct({...result,endPrice:100})).toBe(0);expect(qualitySalePriceChangePct({...result,status:'open'})).toBeNull();expect(qualitySalePriceChangePct({...result,entryPrice:0})).toBeNull();expect(qualitySalePriceChangePct({...result,endPrice:NaN})).toBeNull();
});
