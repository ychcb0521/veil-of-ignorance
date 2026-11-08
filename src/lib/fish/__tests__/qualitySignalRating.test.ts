import {expect,it} from 'vitest';
import {BSS_DEF,definitionKey} from '@/lib/deepDig/features';
import type {TradeSignal} from '@/lib/signalLibrary';
import {newQualityStudy,importQualityFish,importQualityLibrary,qualityComparisonRows,qualityDisplayRows,qualityResultKey} from '../quality';
import {enableQualityComparison} from '../qualityComparison';

const T=Date.UTC(2026,10,8);
const signal:TradeSignal={id:'library',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const fish:TradeSignal={...signal,id:'fish',fish:{featureId:'bss',featureShort:'BSS',definitionKey:definitionKey(BSS_DEF),statistic:'结果',cutoffMs:T,threshold:.12,average:.2,cbi2:.2,startAverage:.2,previousAverage:.1,direction:'>',scale:1}};
it('refreshes a previously imported rating without changing identity, results, selection or frozen plans',()=>{
  const old=enableQualityComparison(importQualityLibrary(newQualityStudy(T),[signal],T));
  const row=qualityComparisonRows(old)[0],plan=old.sellPlans![0];
  old.results=[{key:qualityResultKey(row,plan,0),sampleId:row.id,groupId:plan.id,evaluatedAt:T,status:'closed',returnPct:12}];
  old.selectedRowIds=[qualityDisplayRows(old)[0].id];
  const before=structuredClone(old),updated=importQualityLibrary(old,[{...signal,quality:5}],T+1);
  expect(qualityComparisonRows(updated)[0].source.quality).toBe(5);
  expect(updated.samples[0]).toMatchObject({id:old.samples[0].id,enteredAt:T,importedAt:T});
  expect(qualityResultKey(qualityComparisonRows(updated)[0],plan,0)).toBe(old.results[0].key);
  expect(updated.results).toBe(old.results);expect(updated.sellPlans).toBe(old.sellPlans);expect(updated.selectedRowIds).toBe(old.selectedRowIds);
  expect(old).toEqual(before);
});
it('follows a changed rating and an explicit removal without resurrecting the saved snapshot',()=>{
  const old=importQualityLibrary(newQualityStudy(T),[{...signal,quality:5}],T);
  const changed=importQualityLibrary(old,[{...signal,quality:2}],T+1);
  expect(qualityComparisonRows(changed)[0].source.quality).toBe(2);
  const cleared=importQualityLibrary(changed,[signal],T+2);
  expect(qualityComparisonRows(cleared)[0].source.quality).toBeUndefined();
  expect(cleared.samples[0].source).not.toHaveProperty('quality');
  expect(old.samples[0].source.quality).toBe(5);
});
it.each([false,true])('uses the library rating when a richer fish snapshot supplies detector details (fish first: %s)',fishFirst=>{
  let study=newQualityStudy(T);
  if(fishFirst)study=importQualityFish(study,[fish],T);
  study=importQualityLibrary(study,[{...signal,quality:4}],T);
  if(!fishFirst)study=importQualityFish(study,[fish],T);
  const row=qualityComparisonRows(study)[0];
  expect(row.source.quality).toBe(4);expect(row.source.fish).toEqual(fish.fish);expect(row.groups).toHaveLength(1);
  expect(study.samples.find(s=>s.origin==='fish')!.source).toEqual(fish);
});
it.each([false,true])('a library removal overrides a stale rating on another source (fish first: %s)',fishFirst=>{
  const stale={...fish,quality:5};let study=newQualityStudy(T);
  if(fishFirst)study=importQualityFish(study,[stale],T);
  study=importQualityLibrary(study,[{...signal,quality:4}],T);
  if(!fishFirst)study=importQualityFish(study,[stale],T);
  study=importQualityLibrary(study,[signal],T+1);
  expect(qualityComparisonRows(study)[0].source.quality).toBeUndefined();
  expect(study.samples.find(s=>s.origin==='fish')!.source.quality).toBe(5);
});
it('keeps other times, exchanges and non-library sources separate and returns the same study when unchanged',()=>{
  const otherTime={...signal,id:'time',timeMs:T+60000,quality:2},otherExchange={...signal,id:'exchange',exchange:'gate' as const,quality:3};
  const study=importQualityLibrary(newQualityStudy(T),[signal,otherTime,otherExchange],T);
  const updated=importQualityLibrary(study,[{...signal,quality:5}],T+1);
  expect(updated.samples.map(s=>s.source.quality)).toEqual([5,2,3]);
  expect(importQualityLibrary(updated,[{...signal,quality:5}],T+2)).toBe(updated);
});
