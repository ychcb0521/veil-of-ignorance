import { beforeEach, expect, it, vi } from 'vitest';
import { DRIFT_SPEED_DEF, DRIFT_SPEED_Z_DEF, FEATURES_KEY, mergeFeatureDefs, removedBuiltins, definitionKey, compileFeatureFormula, evaluateOnBars } from '@/lib/deepDig/features';
import { fishFeatureDefinitions } from '@/lib/fish/features';
import { fishStatistics, compileFishProgram, evaluateFishProgram } from '@/lib/fish/algorithm';
import { fishProgramForLookback } from '@/lib/fish/lookback';
import { CUSTOM_RESEARCH_INDICATORS, researchChartFormula } from '@/lib/researchIndicators';
import { accountFeatureDefs } from '@/lib/featureSource';
import { makeQualityBuyFilter, qualityFilterChoices, makeQualityHoldingVeto } from '@/lib/fish/qualityFilters';
import { buildFishScanSettings } from '@/lib/fish/scanPlan';
import { miningCards } from '@/lib/fish/mining';
import { groupDeepDigFeatures } from '@/lib/customIndicatorGroups';
import { mbiBars } from '@/lib/deepDig/__tests__/fixtures/mbiBars';
import { FishAdapter } from '@/lib/fish/adapters';
import { FISH_MAX_HISTORY_BARS } from '@/lib/fish/shared';
beforeEach(()=>localStorage.clear());
const saved={...DRIFT_SPEED_DEF,visibilityVersion:undefined,removed:true,halfLifeHours:24,avgHours:24,formula:DRIFT_SPEED_DEF.formula+'\navg_a = avg(a, 6)'};

it('restores legacy DSP·a visibility everywhere without replacing account formula, parameters or result keys',()=>{
 const before=JSON.stringify(saved),defs=mergeFeatureDefs([saved]),restored=defs.find(d=>d.id==='drift-speed')!;
 expect(restored).toMatchObject({removed:false,visibilityVersion:1,halfLifeHours:24,avgHours:24,formula:saved.formula});
 expect(definitionKey(restored)).toBe(definitionKey(saved));expect(JSON.stringify(saved)).toBe(before);
 expect(removedBuiltins([saved])).toEqual([]);
 expect(groupDeepDigFeatures(defs).find(g=>g.key==='balance')!.items.map(d=>d.id)).toContain('drift-speed');
 localStorage.setItem('sim_anon_'+FEATURES_KEY,JSON.stringify([saved]));
 expect(accountFeatureDefs().find(d=>d.id==='drift-speed')!.formula).toBe(saved.formula);
 expect(qualityFilterChoices().map(c=>c.key)).toEqual(expect.arrayContaining(['drift-speed:a','drift-speed:avg_a','drift-speed:avg_a_2']));
 expect(makeQualityBuyFilter('drift-speed:avg_a_2','>',.001).snapshot.featureId).toBe('drift-speed');
 expect(makeQualityHoldingVeto('drift-speed:a','<',0).snapshot?.featureId).toBe('drift-speed');
 expect(mergeFeatureDefs([{...restored,removed:true}]).some(d=>d.id==='drift-speed')).toBe(false);
 expect(mergeFeatureDefs([{...DRIFT_SPEED_Z_DEF,removed:true}]).some(d=>d.id==='drift-speed-z')).toBe(false);
});

it('capture and mining support original/avg/avg₂ with the pictured 24h parameters and the unchanged evaluator',()=>{
 const def=fishFeatureDefinitions(mergeFeatureDefs([saved])).find(d=>d.id==='drift-speed')!,indicator=CUSTOM_RESEARCH_INDICATORS.find(i=>i.featureId===def.id)!;
 expect(def.formula).toBe(researchChartFormula(indicator,saved.formula));
 expect(fishStatistics(def).map(s=>s.name)).toEqual(expect.arrayContaining(['a','avg_a','avg_a_2']));
 const bars=mbiBars(12000),chart=evaluateOnBars(bars,compileFeatureFormula(def.formula),def);
 for(const statistic of ['a','avg_a','avg_a_2']){
  const plan=fishProgramForLookback(compileFishProgram(def,{statistic,direction:'>',threshold:0,constraints:[]}),1);
  expect(plan.unavailable).toBeUndefined();expect(plan.N).toBeGreaterThan(5000);
  expect(evaluateFishProgram(bars,plan).value).toEqual(chart.vars.get(statistic));
 }
 const rules=[{id:'restore-dsp-a',featureId:def.id,statistic:'avg_a_2',threshold:'0.001'}];
 const mining=buildFishScanSettings({cards:miningCards(rules),defs:[def],combination:'or',selection:{exchanges:['binance'],includeDuplicates:false},time:'',lookbackHours:null});
 expect(mining.error).toBeUndefined();expect(mining.settings?.algorithms?.[0].feature.id).toBe('drift-speed');
 const old=evaluateOnBars(bars,compileFeatureFormula(saved.formula),saved);
 expect(chart.vars.get('a')).toEqual(old.vars.get('a'));expect(chart.vars.get('avg_a')).toEqual(old.vars.get('avg_a'));
});

it('the existing paginated transport and cache retain all 12000 closed candles',async()=>{
 const step=300000,cut=Date.UTC(2026,9,29),request=vi.fn(async(path:string)=>{
  const u=new URL(path,'https://test/'),a=Number(u.searchParams.get('startTime')),b=Number(u.searchParams.get('endTime'));
  const count=Math.floor((b-a)/step)+1;expect(count).toBeLessThanOrEqual(1000);
  return Array.from({length:count},(_,i)=>[a+i*step,100,101,99,100,100,a+(i+1)*step-1,10000,1,50,5000,0]);
 });
 const adapter=new FishAdapter('binance',request),market={symbol:'AAAUSDT',instrument:'AAAUSDT',base:'AAA',multiplier:1},signal=new AbortController().signal;
 const rows=await adapter.candles(market,cut,signal,{interval:'5m',count:FISH_MAX_HISTORY_BARS});
 expect(rows).toHaveLength(12000);expect(rows[0].openTime).toBe(cut-12000*step);expect(rows.at(-1)!.openTime).toBe(cut-step);
 expect(request).toHaveBeenCalledTimes(12);
 expect(await adapter.candles(market,cut,signal,{interval:'5m',count:12000})).toEqual(rows);expect(request).toHaveBeenCalledTimes(12);
});
