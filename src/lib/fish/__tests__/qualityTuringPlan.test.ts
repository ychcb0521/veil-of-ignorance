import { expect, it } from 'vitest';
import { BUILTIN_FEATURES, definitionKey } from '@/lib/deepDig/features';
import { createTuringQualityPlan } from '../qualityTuringPlan';
import { qualityMetricPlan, qualityResultKey, type QualityGroup } from '../quality';
import { planVersionChanges } from '../qualityPlanVersions';

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
