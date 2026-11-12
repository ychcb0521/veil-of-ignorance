import {expect,it,vi} from 'vitest';
import {definitionKey} from '@/lib/deepDig/features';
import {computeDbl5, DBL5_STEP, DBL5_RETEST_GUARD_VERSION} from '@/lib/dbl5m';
import {sample as dblBars} from './fixtures/dblBars';
import {guardDistanceConfig} from '@/lib/fish/qualityAdditionVeto';
import {makeQualitySignalMetrics,qualityFilterMenuChoices} from '@/lib/fish/qualityFilters';
import {signalReadingCell,signalReadingKey} from '@/lib/fish/qualitySignalReadings';
import {preserveQualitySignalReadings} from '@/lib/fish/qualitySignalReadingsStore';
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

it('reads the original signal in the configured algorithm period, with no future candles or filter writes', async () => {
  const original = T + 2 * M + 19_000;
  const matched = T + 10 * M;
  const sample: QualitySample = {
    id: 'screened', enteredAt: matched, importedAt: matched, basis: 'signal', groups: [],
    source: {...source, timeMs: matched, preEntryMonitor: {recordId:'r',roundId:'p',sourceId:source.id,sourceTime:original,matchedAt:matched}},
  };
  const definitions = [
    {...def,interval:'15m' as const},
    {...def,id:'entry-closed',interval:'15m' as const,chartTemplate:'ctba' as const},
  ];
  const choice = qualityFilterMenuChoices(definitions,true).find(choice=>choice.label.endsWith('原值'));
  expect(choice?.key).toBe('entry-test:raw');
  const [metric, closed] = makeQualitySignalMetrics([choice!.key, 'entry-closed:raw'], definitions);
  expect([metric.snapshot.interval, closed.snapshot.interval]).toEqual(['15m','5m']);
  const onSignalReading = vi.fn(), onResult = vi.fn(), onProgress = vi.fn(), spy = vi.fn(load);
  const study = newQualityStudy();
  await collectFishQuality({study,task:'signal-values',signalReadingBatches:[
    {metric,rows:[sample,{...sample,id:'duplicate'}]}, {metric:closed,rows:[sample]},
  ],signal:signal(),onProgress,onResult,onSignalReading},spy,T+20*M);
  expect(onSignalReading.mock.calls).toEqual([
    [{key:signalReadingKey(sample,metric),value:103,at:T+2*M}],
    [{key:signalReadingKey(sample,closed),value:101,at:T}],
  ]);
  expect(onProgress).toHaveBeenLastCalledWith({done:2,total:2,current:''});
  expect(onResult).not.toHaveBeenCalled();
  expect(spy.mock.calls.map(([, ,to, program])=>[to,program.step])).toEqual([[T,15*M],[T+2*M,M],[T,5*M]]);
});

it('retains stored signal values through a failed retry or an old tab save and preserves column removal', () => {
  const study = newQualityStudy(), [metric] = makeQualitySignalMetrics(['entry-test:raw'], [def]);
  const saved = {...study,signalMetrics:[metric],signalMetricsUpdatedAt:T,signalReadings:[{key:'r',value:0,at:T}]};
  expect(preserveQualitySignalReadings(saved,study)).toMatchObject(saved);
  const removed = {...study,signalMetrics:[],signalMetricsUpdatedAt:T+1,signalReadings:[{key:'r',error:'断线'}]};
  expect(preserveQualitySignalReadings(saved,removed)).toMatchObject({signalMetrics:[],signalMetricsUpdatedAt:T+1,signalReadings:saved.signalReadings});
});

it('adds versioned DBL-5 ATR distance only to signal readings and reads signed values at the original signal time', async () => {
  const choices = qualityFilterMenuChoices([],true);
  expect(choices.map(choice=>choice.label)).toEqual([
    '距 DBL-5 防守线（ATR） · 防守线 v1',
    '距 DBL-5 防守线（ATR） · 防守线-20261112',
  ]);
  expect(qualityFilterMenuChoices([])).toEqual([]);
  const [metric,retest] = makeQualitySignalMetrics(choices.map(choice=>choice.key),[]);
  expect(metric.id).not.toBe(retest.id);
  expect(JSON.parse(retest.snapshot.definitionKey).some((value:unknown)=>typeof value==='string'&&value.includes(DBL5_RETEST_GUARD_VERSION))).toBe(true);

  const five=DBL5_STEP, structure=new Map(dblBars().map((bar,i)=>[T+(i-14)*five,{...bar,openTime:T+(i-14)*five,volume:1}]));
  const barAt=(openTime:number)=>structure.get(openTime)??{
    openTime,open:100,high:101,low:99,close:100,volume:1,takerBuyVolume:.5,DBL5_tick_size:1,
  };
  const native=computeDbl5(Array.from({length:288},(_,i)=>barAt(T-288*five+i*five)),{
    symbol:source.symbol,config:guardDistanceConfig().parameters,
  }).rows.at(-1)!;
  expect(native.darvas_5m_guard).toBeGreaterThan(0);
  const line=native.darvas_5m_guard!,atr=native.darvas_5m_guard_atr!;
  const load:FishReconstructionLoader=async(_row,from,to,program)=>Array.from({length:(to-from)/program.step},(_,i)=>{
    const openTime=from+i*program.step;
    if(program.step===five)return barAt(openTime);
    const close=openTime===T?line+2*atr:openTime===T+M?line-3*atr:line;
    return {openTime,open:close,high:close,low:close,close,volume:1,takerBuyVolume:.5};
  });
  const samples=[1,2,3].map(i=>{
    const original=T+i*M+19_000,matched=T+20*M;
    return {id:'screened-'+i,enteredAt:matched,importedAt:matched,basis:'signal' as const,groups:[],
      source:{...source,timeMs:matched,preEntryMonitor:{recordId:'r'+i,roundId:'p',sourceId:source.id,sourceTime:original,matchedAt:matched}}};
  });
  const spy=vi.fn(load),onSignalReading=vi.fn(),onResult=vi.fn();
  const options={study:newQualityStudy(),task:'signal-values' as const,signalReadingBatches:[{metric,rows:samples}],signal:signal(),
    onProgress:vi.fn(),onResult,onSignalReading};
  await collectFishQuality(options,spy,T+25*M);
  const readings=onSignalReading.mock.calls.map(([reading])=>reading);
  expect(readings.map(reading=>reading.at)).toEqual([T+M,T+2*M,T+3*M]);
  expect(readings[0].value).toBeCloseTo(2);
  expect(readings[1].value).toBeCloseTo(-3);
  expect(readings[2].value).toBe(0);
  expect(spy.mock.calls.filter(([, , ,p])=>p.step===five).map(([, ,to])=>to)).toEqual([T,T,T]);
  expect(spy.mock.calls.filter(([, , ,p])=>p.step===M).map(([, ,to])=>to)).toEqual([T+M,T+2*M,T+3*M]);
  expect(spy.mock.calls.every(([, , ,p])=>!p.compiled.usesBtc)).toBe(true);
  expect(signalReadingCell(samples[0],metric,new Map([[readings[0].key,readings[0]]])).text).toBe('+2 ATR');
  expect(onResult).not.toHaveBeenCalled();
  onSignalReading.mockClear();
  await collectFishQuality({...options,signalReadingBatches:[{metric,rows:[samples[0]]}],marketStart:async()=>T},load,T+25*M);
  expect(onSignalReading).toHaveBeenCalledWith({key:signalReadingKey(samples[0],metric),error:expect.stringContaining('等待有效防守线')});
});
