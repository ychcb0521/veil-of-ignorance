import {expect,it} from 'vitest';
import {firstMatchFixture,SIGNAL_AT,MATCHED_AT} from './qualityFirstMatch.fixture';
import {prepareFilterTime,staticTimeSample} from '../qualityFilterTime';
import {evaluateQualityFilter,qualityFilterReadingKey,qualityRunSamples,type QualityBuyFilter} from '../quality';
import {signalReadingCell,signalReadingKey,collectQualitySignalReadings} from '../qualitySignalReadings';
import {withQualityScreeningEntries} from '../qualityScreeningResults';
import {beginQualityFilterRound} from '../qualityFilterLibrary';
import {qualityFilterCell} from '../qualityFilterColumns';
import type {FishReconstructionLoader} from '../reconstruction';

it('uses all three frozen anchors for static conditions and signal readings, keeping the original entry identity',async()=>{
  const {study,library,plan}=firstMatchFixture();
  const input=withQualityScreeningEntries(study,library,{});
  const counterfactualAt=MATCHED_AT+300000;
  input.samples=input.samples.map(row=>({...row,counterfactualAt}));
  const filter:QualityBuyFilter={id:'f',enabled:true,label:'收盘价',metric:'raw',direction:'>',threshold:1,snapshot:plan.snapshot};
  const now=counterfactualAt+600000, signal=new AbortController().signal;
  const load:FishReconstructionLoader=async(_source,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{
    const openTime=from+i*p.step;
    return {openTime,open:2,high:2,low:2,close:2,volume:1,quoteVolume:2,takerBuyVolume:0,takerBuyQuoteVolume:0};
  });
  const keys=new Set<string>();
  for(const [basis,time] of [['signal',SIGNAL_AT],['screening',MATCHED_AT],['counterfactual',counterfactualAt]] as const){
    const batch=prepareFilterTime(input,basis,'static'),[row]=qualityRunSamples(batch.study);
    expect([row.enteredAt,row.source.timeMs]).toEqual([SIGNAL_AT,SIGNAL_AT]);
    expect(batch.skipped).toBe(0);
    const read=await evaluateQualityFilter(row,filter,now,load,signal);
    expect(read).toMatchObject({value:2,at:Math.floor(time/300000)*300000});
    keys.add(read.key);
    const frozen={...batch.study,buyFilters:[filter],filterReadings:[read]};
    const archive=beginQualityFilterRound(study,frozen,now)!.study.filterLibrary!;
    const saved=archive.rounds[0].filterSnapshot!.records[0];
    expect(saved).toMatchObject({status:{state:'pass'},sample:{enteredAt:SIGNAL_AT,staticTime:{basis,at:time}},readings:[{key:read.key}]});
    const original=qualityRunSamples(input)[0];
    expect(qualityFilterCell(original,filter,new Map([[read.key,read]]),batch.times)).toMatchObject({state:'pass'});
    const signalReadings=new Map();
    await collectQualitySignalReadings({study:batch.study,signal,onProgress:()=>{},onResult:()=>{},
      signalReadingBatches:[{metric:filter,rows:[row]}],onSignalReading:r=>signalReadings.set(r.key,r)},load,now);
    const view=staticTimeSample(original,batch.times);
    expect(signalReadingCell(view,filter,signalReadings)).toMatchObject({value:2});
    expect(signalReadings.get(signalReadingKey(view,filter)).at).toBe(Math.floor(time/60000)*60000);
    expect(qualityFilterReadingKey(original,filter)).not.toBe(read.key);
  }
  expect(keys.size).toBe(3);
});
it('skips a missing or ambiguous optional time without falling back to the original signal',()=>{
  const {study}=firstMatchFixture();
  for(const basis of ['screening','counterfactual'] as const){
    study.samples=study.samples.map(row=>({...row,monitorEntry:{at:null,error:'多个入选时点',records:[]}}));
    const result=prepareFilterTime(study,basis,'static');
    expect(result).toMatchObject({eligible:0,skipped:1});
    expect(result.study.samples).toEqual([]);
    expect(staticTimeSample(qualityRunSamples(study)[0],result.times).staticTime?.at).toBeNull();
  }
});
