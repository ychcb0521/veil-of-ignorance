import {expect,it} from 'vitest';
import {CBI2_DEF,definitionKey} from '@/lib/deepDig/features';
import {fishAlgorithmKey,constraintFingerprint} from '@/lib/fish/algorithm';
import {libraryCondition,filterLibraryCondition,miningLibraryConditions} from '@/lib/fish/libraryConditions';
import {makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
const T=Date.UTC(2026,9,28);
const definition={...CBI2_DEF,formula:'CBI2 = C\navg_CBI2_2 = avg(CBI2, 7)',interval:'15m' as const,halfLifeHours:9,avgHours:7};
const snap={featureId:'cbi2',featureShort:'CBI-2',statistic:'结果',definitionKey:definitionKey(definition),threshold:.04,direction:'>' as const,scale:1,average:.061,interval:'15m',cutoffMs:T,cbi2:0,startAverage:0,previousAverage:0};
const record=(fish:any)=>({id:'record',runId:'old',anchorMs:T,catchKey:'x',source:undefined,signal:{id:'s',symbol:'AAAUSDT',timeMs:T,timeLabel:'',fallbackZone:'',fish},firstSavedAt:T,updatedAt:T});
it('resolves result from the saved formula and preserves its exact parameters, period and threshold',()=>{
 const before=JSON.stringify(snap),c=libraryCondition(snap);
 expect(c.text).toContain('avg_CBI2_2 > 0.04');expect(c.context).toContain('15m');expect(c.halfLifeHours).toBe(9);expect(c.avgHours).toBe(7);expect(c.formula).toContain('avg(CBI2, 7)');expect(c.reading).toBe(.061);expect(JSON.stringify(snap)).toBe(before);
});
it('uses executable frozen filter fields instead of generic labels or stale snapshot fields',()=>{
 const f=makeQualityBuyFilter('cbi2:avg_CBI2_2','>',.04,true,[definition]);
 f.label='笼统名称';f.snapshot.statistic='CBI2';f.snapshot.threshold=999;
 const c=filterLibraryCondition(f);expect(c.metric).toBe('avg_CBI2_2');expect(c.text).toContain('avg_CBI2_2 > 0.04');expect(c.text).not.toContain('999');expect(c.context).toContain('5m');
});
it('only lists actual union hits, gives each its own threshold and reading, and does not mutate legacy rows',()=>{
 const other={...snap,featureId:'cba',featureShort:'CBA',statistic:'avg_CBA_2',threshold:8,average:10.5};
 const r=record({...snap,combination:'or',hitAlgorithms:[2],algorithms:[snap,other]}),before=JSON.stringify(r),result=miningLibraryConditions(r);
 expect(result.conditions).toHaveLength(1);expect(result.conditions[0].text).toContain('avg_CBA_2 > 8');expect(result.conditions[0].reading).toBe(10.5);expect(result.combination).toContain('仅列实际命中');expect(JSON.stringify(r)).toBe(before);
});
it('can recover missing legacy settings from an exact saved key or a uniquely matching historical run, but never guesses ambiguous slots',()=>{
 const keyed=libraryCondition({featureShort:'CBI-2',algorithmKey:fishAlgorithmKey('cbi2',undefined,'>',.04,constraintFingerprint([]),'avg_CBI2_2'),average:.08});
 expect(keyed.text).toContain('avg_CBI2_2 > 0.04');expect(keyed.reading).toBe(.08);
 const run={id:'old',signature:'x',startMs:T,stepMs:1,firstAt:T,updatedAt:T,rules:[{id:'a',featureId:'cbi2',statistic:'avg_CBI2_2',threshold:'.05'}]};
 const missing=record({featureId:'cbi2',statistic:'avg_CBI2_2',average:.08});expect(miningLibraryConditions(missing,run).conditions[0].rule).toBe('> 0.05');
 const ambiguous=record({featureId:'cbi2',average:.08});
 const uncertain=miningLibraryConditions(ambiguous,{...run,rules:[...run.rules,{...run.rules[0],id:'b',statistic:'avg_CBI2',threshold:'.07'}]});
 expect(uncertain.conditions[0].text).toContain('门槛未记录');expect(uncertain.conditions[0].context).toContain('公式未记录');
});
it('distinguishes the same named algorithm at different thresholds, periods, formulas and combinations',()=>{
 const a=miningLibraryConditions(record(snap));
 for(const next of [{...snap,threshold:.05},{...snap,interval:'1h'},{...snap,definitionKey:definitionKey({...definition,halfLifeHours:8})}])expect(miningLibraryConditions(record(next)).identity).not.toBe(a.identity);
 expect(miningLibraryConditions(record({...snap,combination:'or',algorithms:[snap],hitAlgorithms:[]})).conditions).toEqual([]);
});
it('keeps displayed units aligned with readings and preserves external legacy averages',()=>{
 const c=libraryCondition({...snap,statistic:'结果',scale:100,threshold:4});expect(c.reading).toBe(6.1);expect(c.rule).toBe('> 4');expect(c.context).toContain('原值 × 100');
 const old=libraryCondition({...snap,H:24});expect(old.metric).toContain('24h');expect(old.metric).toContain('旧版外层均值');
});
