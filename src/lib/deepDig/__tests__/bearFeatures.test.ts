import { beforeEach, describe, expect, it } from 'vitest';
import { MBI_DEF, MBI_BEAR_DEF, CTBA_DEF, CTBA_BEAR_DEF, LEGACY_MBI_BEAR_FORMULA, LEGACY_CTBA_BEAR_FORMULA, compileFeatureFormula, evaluateOnBars, featureWindowMs, intervalOf, copyFeatureDefinition, BUILTIN_FEATURES, mergeFeatureDefs, FEATURES_KEY, definitionKey } from '../features';
import { snapshotOf } from '../analysis';
import { sellerResponse } from '@/lib/sellerResponse';
import { accountFeatureDefs } from '@/lib/featureSource';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { researchChartSeries, researchIndicatorForFeature, syncResearchIndicatorConfigs } from '@/lib/researchIndicators';
import { compileFishProgram, evaluateFishProgram } from '@/lib/fish/algorithm';
import { qualityDefinition } from '@/lib/fish/quality';
import { createFormulaEvaluationCache } from '../formula';
const bars = (n = 1900) => Array.from({ length: n }, (_, i) => {
  const close = 100 * Math.exp(.06 * Math.sin(i / 35) + .01 * Math.sin(i / 5)), amount = 10000 + 2000 * Math.sin(i / 13);
  return { openTime: i * 300000, open: close, high: close * 1.005, low: close * .995, close, volume: amount / close, quoteVolume: amount, takerBuyVolume: null, takerBuyQuoteVolume: amount * (.5 + .35 * Math.sin(i / 31)) };
});
const pairs=[[MBI_DEF,MBI_BEAR_DEF,'MBI','MBI_bear',1,LEGACY_MBI_BEAR_FORMULA],[CTBA_DEF,CTBA_BEAR_DEF,'CTBA','CTBA_bear',100,LEGACY_CTBA_BEAR_FORMULA]] as const;
beforeEach(()=>localStorage.clear());
describe('seller-sensitive full signed MBI and CTBA',()=>{
 it('keeps zero and positive readings, smoothly strengthens negative ones and rejects missing/invalid inputs',()=>{
  expect(sellerResponse(-.5,2,1)).toBe(-.8);expect(sellerResponse(-50,2,100)).toBe(-80);
  for(const scale of [1,100]){
   expect(sellerResponse(0,2,scale)).toBe(0);expect(sellerResponse(scale/2,2,scale)).toBe(scale/2);expect(sellerResponse(-scale,2,scale)).toBe(-scale);
   for(let i=-100;i<=100;i++){const value=i/100*scale,out=sellerResponse(value,2,scale);expect(Math.sign(out)).toBe(Math.sign(value));expect(Math.abs(out)).toBeLessThanOrEqual(scale);if(value<0)expect(out).toBeLessThanOrEqual(value);}
   for(const value of [-scale,-.999*scale,-.01*scale]){expect(sellerResponse(value,1,scale)).toBe(value);expect(sellerResponse(value,3,scale)).toBeLessThanOrEqual(sellerResponse(value,2,scale));}
  }
  for(const args of [[NaN,2,1],[Infinity,2,1],[-2,2,1],[-.5,0,1],[-.5,2,0]])expect(sellerResponse(...args as [number,number,number])).toBeNaN();
  expect(sellerResponse(-1e-10,2,1)/-1e-10).toBeCloseTo(2,10);
 });
 it.each(pairs)('$1.id preserves every window and zero crossing, while expanding negative amplitude and retaining positive values', (original,bear,source,core,scale,legacyFormula)=>{
  const data=bars(),old=evaluateOnBars(data,compileFeatureFormula(original.formula),original).vars.get(source) as Float64Array;
  const actual=evaluateOnBars(data,compileFeatureFormula(bear.formula),bear),values=actual.vars.get(core) as Float64Array;
  let positive=0,negative=0,missing=0;
  for(let i=0;i<data.length;i++){
   if(!Number.isFinite(old[i])){expect(values[i]).toBeNaN();missing++;continue;}
   expect(Math.sign(values[i])).toBe(Math.sign(old[i]));
   if(old[i]>=0){expect(values[i]).toBe(old[i]);positive++;}
   else {const x=old[i]/scale;expect(values[i]).toBeCloseTo(scale*2*x/(1+x*x),12);if(old[i]>-.99*scale)expect(values[i]).toBeLessThan(old[i]);negative++;}
  }
  expect(positive).toBeGreaterThan(0);expect(negative).toBeGreaterThan(0);expect(missing).toBeGreaterThan(0);
  expect(featureWindowMs(bear)).toBe(featureWindowMs({...bear,formula:legacyFormula}));expect(intervalOf(bear)).toBe(intervalOf(original));
  for(const name of ['avg_'+core,'avg_'+core+'_2']){const avg=actual.vars.get(name) as Float64Array;expect(Array.from(avg).some(v=>v>0)).toBe(true);expect(Array.from(avg).some(v=>v<0)).toBe(true);}
  const prefix=evaluateOnBars(data.slice(0,1500),compileFeatureFormula(bear.formula),bear).vars.get(core) as Float64Array;
  expect(values.slice(0,1500)).toEqual(prefix);
  const identity={...bear,formula:bear.formula.replace('seller_gain = 2','seller_gain = 1')};
  expect(evaluateOnBars(data,compileFeatureFormula(identity.formula),identity).vars.get(core)).toEqual(old);
  expect(evaluateOnBars(data,compileFeatureFormula(original.formula),original).vars.get(source)).toEqual(old);
 });
 it.each(pairs)('$1.id evaluates balanced observations as zero, and never turns missing prices or flow into zero',(_original,bear,_source,core)=>{
  const flat=bars().map(b=>({...b,open:100,high:101,low:99,close:100,volume:100,quoteVolume:10000,takerBuyQuoteVolume:5000}));
  const values=evaluateOnBars(flat,compileFeatureFormula(bear.formula),bear).vars.get(core) as Float64Array;expect(values.at(-1)).toBe(0);
  const broken=flat.map((b,i)=>i===flat.length-1?{...b,...(bear.id==='mbi-bear'?{close:NaN}:{takerBuyQuoteVolume:null})}:b);
  expect((evaluateOnBars(broken,compileFeatureFormula(bear.formula),bear).vars.get(core) as Float64Array).at(-1)).toBeNaN();
 });
 it.each(pairs)('$1.id shares chart, fish, incremental evaluation and independent-copy calculations',(_original,bear,_source,core,_scale,legacyFormula)=>{
  const data=bars(),compiled=compileFeatureFormula(bear.formula),expected=evaluateOnBars(data,compiled,bear).vars.get(core) as Float64Array;
  const cache=createFormulaEvaluationCache();evaluateOnBars(data.slice(0,1400),compiled,bear,cache);expect(evaluateOnBars(data,compiled,bear,cache).vars.get(core)).toEqual(expected);
  const plan=compileFishProgram(bear,{statistic:core,direction:'<',threshold:-.3,constraints:[]});
  expect(evaluateFishProgram(data,plan).average).toEqual(expected);
  const item=researchIndicatorForFeature(bear),candles=data.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,turnover:b.quoteVolume,takerBuyTurnover:b.takerBuyQuoteVolume!}));
  const chart=researchChartSeries(candles,item,item.period,{fetchReference:false});expect(chart.core).toEqual(Array.from(expected,v=>Number.isFinite(v)?v:null));
  expect(item.max).toBeGreaterThan(0);expect(item.neutral).toBe(0);expect(item.avgRange).toEqual([item.min,item.max]);
  const copy=copyFeatureDefinition(bear,BUILTIN_FEATURES,100);expect(copy.formula).toBe(bear.formula);expect(featureWindowMs(copy)).toBe(featureWindowMs(bear));expect(snapshotOf(copy).chartTemplate).toBe(bear.chartTemplate);
  const legacy={...bear,formula:legacyFormula},historical=qualityDefinition({featureId:bear.id,definitionKey:definitionKey(legacy),scale:1,threshold:0,average:0,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:0});
  expect(historical.formula).toContain(`min(${_source}, 0)`);
 });
 it('upgrades only the clipping statement, preserving custom windows, means, copies and already authored formulas',()=>{
  const mbi={...MBI_BEAR_DEF,formula:LEGACY_MBI_BEAR_FORMULA,MBI_N:37,MBI_Z0:.9,avgHours:12,name:'我的空方MBI'};
  const ctba={...CTBA_BEAR_DEF,formula:LEGACY_CTBA_BEAR_FORMULA.replace('N = 576','N = 360').replace('avg(CTBA_bear, 24)','avg(CTBA_bear, 12)')};
  const copy=copyFeatureDefinition(mbi,BUILTIN_FEATURES,123),custom={...MBI_BEAR_DEF,id:'f-custom',formula:'MBI_bear = -C'},before=structuredClone([mbi,ctba,copy,custom]);
  const merged=mergeFeatureDefs(before),a=merged.find(d=>d.id===mbi.id)!,b=merged.find(d=>d.id===ctba.id)!;
  expect(a).toMatchObject({MBI_N:37,MBI_Z0:.9,avgHours:12,name:'我的空方MBI'});expect(a.formula).toContain('seller_response(MBI, seller_gain, 1)');
  expect(b.formula).toContain('N = 360');expect(b.formula).toContain('avg(CTBA_bear, 12)');expect(b.formula).toContain('seller_response(CTBA, seller_gain, 100)');
  expect(featureWindowMs(b)).toBe(featureWindowMs(ctba));expect(mergeFeatureDefs(merged).find(d=>d.id===a.id)!.formula).toBe(a.formula);
  expect(merged.find(d=>d.id===copy.id)!.formula).toBe(copy.formula);expect(merged.find(d=>d.id===custom.id)!.formula).toBe(custom.formula);expect(before).toEqual([mbi,ctba,copy,custom]);
  const authored={...MBI_BEAR_DEF,formula:'MBI_bear = -C'};expect(mergeFeatureDefs([authored]).find(d=>d.id===authored.id)!.formula).toBe(authored.formula);
 });
 it('preserves existing chart period and average overrides on response-only upgrades, while still syncing explicit period edits',()=>{
  const key=getUserPrefix()+FEATURES_KEY;
  localStorage.setItem(key,JSON.stringify([{...MBI_BEAR_DEF,formula:LEGACY_MBI_BEAR_FORMULA}]));
  const first=syncResearchIndicatorConfigs([{type:'MBI_BEAR',period:50,avgHours:12,featureDefinitionVersion:123}],accountFeatureDefs())[0];
  expect(first).toMatchObject({period:50,avgHours:12,featureWindowPeriod:25});
  localStorage.setItem(key,JSON.stringify([{...MBI_BEAR_DEF,formula:MBI_BEAR_DEF.formula.replace('seller_gain = 2','seller_gain = 3')}]));
  const response=syncResearchIndicatorConfigs([first],accountFeatureDefs())[0];expect(response).toMatchObject({period:50,avgHours:12,featureWindowPeriod:25});
  localStorage.setItem(key,JSON.stringify([{...MBI_BEAR_DEF,MBI_N:37}]));
  expect(syncResearchIndicatorConfigs([response],accountFeatureDefs())[0]).toMatchObject({period:37,featureWindowPeriod:37});
  const ctba=syncResearchIndicatorConfigs([{type:'CTBA_BEAR',period:720,avgHours:48,featureDefinitionVersion:123}],accountFeatureDefs())[0];
  expect(ctba).toMatchObject({period:720,avgHours:48,featureWindowPeriod:576});
 });
});
