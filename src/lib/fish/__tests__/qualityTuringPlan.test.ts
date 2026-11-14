import { expect, it } from 'vitest';
import { BUILTIN_FEATURES, definitionKey } from '@/lib/deepDig/features';
import { createTuringPreEntryPlan, createTuringQualityPlan } from '../qualityTuringPlan';
import { activeStandaloneBuyFilters, collectFishQuality, newQualityStudy, qualityComparisonRows, qualityFilterReadingKey, qualityMetricPlan, qualityResultKey, type QualityFilterReading, type QualityGroup, type QualitySample } from '../quality';
import { freezeQualityPlan, planVersionChanges } from '../qualityPlanVersions';
import { createTuringStaticFilterPlan } from '../qualityStaticFilterPlan';
import { activeSignalMetrics, signalReadingKey } from '../qualitySignalReadings';
import { entryCondition, emptyPreEntryThreeStage, signalAnchoredPreEntryThreeStage } from '../preEntryThreeStage';
import { makeQualityBuyFilter, makeQualitySignalMetrics } from '../qualityFilters';
import { qualityFilterSettingSignature } from '../qualityFilterLibrary';
import { qualityPlanFromTemplate, saveQualityPlanTemplate } from '../qualityPlanTemplates';
import type { FishReconstructionLoader } from '../reconstruction';

it('copies a BTC-dependent rule into its existing independent no-BTC variant and versions initialization',()=>{
 const state=BUILTIN_FEATURES.find(d=>d.id==='state')!;
 const source:QualityGroup={id:'original',label:'原方案',metric:'state',rule:{metric:'state',direction:'<',threshold:.5},snapshot:{featureId:state.id,definitionKey:definitionKey(state),statistic:'state',interval:'5m',scale:1,threshold:.5,direction:'<',cutoffMs:1,average:0,cbi2:0,startAverage:0,previousAverage:0}};
 const old=structuredClone(source),copy=createTuringQualityPlan(source,BUILTIN_FEATURES,'copy');
 expect(source).toEqual(old);expect(copy.snapshot.featureId).toBe('state-no-btc-v1');expect(copy.rule).toEqual(source.rule);
 expect(qualityMetricPlan(copy.snapshot,'state').plan.compiled.usesBtc).toBe(false);
 expect(copy.initialization).toBe('turing-origin-v1');expect(copy.frozenVersions!.some(v=>v.key==='initialization')).toBe(true);expect(planVersionChanges(copy)).toEqual([]);
 const sample={id:'s',enteredAt:1,basis:'signal' as const,importedAt:1,groups:[],source:{id:'s',symbol:'TURING:TURING 50',timeMs:1,timeLabel:'',fallbackZone:''}};
 expect(qualityResultKey(sample,copy,0)).not.toBe(qualityResultKey(sample,{...copy,initialization:undefined},0));
 expect(()=>createTuringQualityPlan(source,[state],'copy')).toThrow('没有可用的独立无 BTC 版本');
 expect(()=>createTuringQualityPlan({...source,frozenVersions:[{key:'execution',part:'执行',name:'旧版',version:'unknown',summary:''}]},BUILTIN_FEATURES)).toThrow('冻结版本已变化');
});

it('freezes a separate three-stage copy, including nested formulas and unchanged gates', () => {
 const condition = entryCondition(makeQualityBuyFilter('state:state', '>', .75, true, BUILTIN_FEATURES));
 const config = signalAnchoredPreEntryThreeStage(emptyPreEntryThreeStage(), [{ ...condition, id:'admission' }]);
 config.required = [condition];
 config.sellRules = [{id:'sell',label:'sell',enabled:true,expression:{join:'any',children:[{condition:{...condition,id:'sell-condition'}}]},confirmation:{samples:2,minutes:5}}];
 const source = freezeQualityPlan({ id:'real',label:'real',metric:condition.metric,snapshot:condition.snapshot,preEntryThreeStage:config });
 const original = structuredClone(source);
 const copy = createTuringPreEntryPlan(source, BUILTIN_FEATURES, 'turing');
 expect(copy.initialization).toBe('turing-screening-origin-v1');
 expect(planVersionChanges(copy)).toEqual([]);
 expect(copy.preEntryThreeStage?.required[0]).toMatchObject({threshold:.75,snapshot:{featureId:'state-no-btc-v1'}});
 expect(copy.preEntryThreeStage?.admission?.algorithms[0].snapshot.featureId).toBe('state-no-btc-v1');
 expect(copy.preEntryThreeStage?.sellRules[0]).toMatchObject({confirmation:{samples:2,minutes:5},expression:{children:[{condition:{snapshot:{featureId:'state-no-btc-v1'}}}]}});
 expect(copy.preEntryThreeStage?.guard).toEqual(original.preEntryThreeStage?.guard);
 expect(source).toEqual(original);
});

it('runs both static tasks from the archive origin, retains old cache keys and rejects changed frozen settings', async () => {
 const start = Date.UTC(2026,2,29,5), step = 300000, time = start + 2*step;
 const def = {id:'fixture',name:'fixture',short:'fixture',definition:'',formula:'raw=C',scale:1,unit:'',positive:'1',control:'0',interval:'5m' as const};
 const filter = makeQualityBuyFilter('fixture:raw', '>', 100, true, [def]);
 const [metric] = makeQualitySignalMetrics(['fixture:raw'], [def]);
 const plan = createTuringStaticFilterPlan([filter], [metric], [def]);
 const source = {id:'s',symbol:'TURING:TURING 50',timeMs:time,timeLabel:'',fallbackZone:''};
 const sample: QualitySample = {id:'row',source,enteredAt:time,basis:'signal',importedAt:time,groups:[],origin:'turing'};
 const row = qualityComparisonRows({samples:[sample]})[0];
 const study = {...newQualityStudy(),independentFilters:true as const,samples:[sample],selectedRowIds:[row.id],buyFilters:[filter],
  turingStaticSettings:{active:true,plan,updatedAt:time},filterReadings:[{key:qualityFilterReadingKey(row,filter),value:999}]};
 const active = activeStandaloneBuyFilters(study)[0], signalMetric = activeSignalMetrics(study)[0];
 const load: FishReconstructionLoader = async (_row,from,to,p) => {
  expect(from).toBe(start); expect(to).toBe(time); expect(p.step).toBe(step);
  return [100,101].map((close,index)=>({openTime:from+index*step,open:close,close,high:close,low:close,volume:1}));
 };
 const filterReadings: QualityFilterReading[] = [], signalReadings: QualityFilterReading[] = [];
 const common = {study,signal:new AbortController().signal,marketStart:async()=>start,onProgress:()=>{},onResult:()=>{}};
 await collectFishQuality({...common,task:'filter',onFilterReading:r=>filterReadings.push(r)},load,time);
 await collectFishQuality({...common,task:'signal-values',signalReadingBatches:[{metric:signalMetric,rows:[row]}],
  onSignalReading:r=>signalReadings.push(r)},load,time);
 expect(qualityFilterReadingKey(row,active)).not.toBe(qualityFilterReadingKey(row,filter));
 expect(signalReadingKey(row,signalMetric)).not.toBe(signalReadingKey(row,metric));
 expect(qualityFilterSettingSignature([active])).not.toBe(qualityFilterSettingSignature([filter]));
 expect(filterReadings).toEqual([{key:qualityFilterReadingKey(row,active),value:101,at:time}]);
 expect(signalReadings).toEqual([{key:signalReadingKey(row,signalMetric),value:101,at:time}]);
 const template = saveQualityPlanTemplate(study,plan,'fixture template').planTemplates![0];
 const roundTripped = JSON.parse(JSON.stringify(template));
 expect(qualityPlanFromTemplate(roundTripped,'copy').staticFilter).toEqual(plan.staticFilter);
 roundTripped.plan.staticFilter.filters[0].threshold = 999;
 expect(()=>qualityPlanFromTemplate(roundTripped,'copy')).toThrow('算法版本');
});
