import { createFormulaEvaluationCache } from '../formula';
import { afterEach,describe,expect,it } from 'vitest';
import { BUILTIN_FEATURES,CDA_DEF,CDI2_DEF,SELLER_RETENTION_FEATURES,createSellerRetentionCopy,ensureSellerRetentionCopies,mergeFeatureDefs,saveFeatureDefinition,definitionKey,checkDefinition,compileFeatureFormula,evaluateOnBars,featureWindowMs,FEATURES_KEY } from '../features';
import { SELLER_RETENTION_SPECS } from '@/lib/sellerRetention';
import { compileFishProgram,evaluateFishProgram,fishStatistics } from '@/lib/fish/algorithm';
import { readFishPreference } from '@/lib/fish/preferences';
import { accountFeatureDefs,chartFeatureSeries,chartFeatureHistoryBars } from '@/lib/featureSource';
import { researchIndicatorForFeature,researchChartSeries,accountResearchIndicators } from '@/lib/researchIndicators';
import { clearPersistedStateMemoryForTests } from '@/lib/persistedStateStorage';
import type { ResearchBar } from '@/lib/deepRsa/window';
const spec=SELLER_RETENTION_SPECS[0];
afterEach(()=>{localStorage.clear();clearPersistedStateMemoryForTests();});
function bars(count=1800):ResearchBar[]{let c=100;return Array.from({length:count},(_,i)=>{const open=c;c*=Math.exp((i<500?0:-.0001)+.001*Math.sin(i*.8));const q=10000*(1+.2*Math.sin(i/11));return {openTime:i*300000,open,close:c,high:Math.max(open,c)*1.001,low:Math.min(open,c)*.999,volume:q/c,quoteVolume:q,takerBuyQuoteVolume:q*(.5+.2*Math.sin(i/20)),takerBuyVolume:null,refClose:20000*Math.exp(.00003*i)};});}
const series=(out:ReturnType<typeof evaluateOnBars>,name:string)=>{const v=out.vars.get(name)!;return typeof v==='number'?Array(1800).fill(v):Array.from(v);};
const run=(d:typeof CDI2_DEF,data:ResearchBar[])=>evaluateOnBars(data,compileFeatureFormula(d.formula),d);
function fixture(){const copy=createSellerRetentionCopy({...CDI2_DEF,formula:'CDI2 = 0',avgHours:1,halfLifeHours:1},spec);return {...copy,formula:copy.formula.replace('sr_window_h = 48','sr_window_h = 2')};}
describe('independent seller retained-outcome copies',()=>{
 it('creates exactly seven own identities from the effective saved definitions, freezes once, and never copies CDA',()=>{
  const source={...CDI2_DEF,formula:'CDI2 = -0.123',halfLifeHours:3,avgHours:9},before=structuredClone(source),cdaBefore=structuredClone(CDA_DEF);
  const saved=ensureSellerRetentionCopies([source]),copy=saved.find(d=>d.id===spec.id)!;
  expect(saved).toHaveLength(8);expect(copy).toMatchObject({retentionSourceId:source.id,halfLifeHours:3,avgHours:9,chartCore:spec.core});expect(copy.formula).toContain(source.formula);
  expect(ensureSellerRetentionCopies(saved)).toBe(saved);expect(SELLER_RETENTION_FEATURES).toHaveLength(7);expect(SELLER_RETENTION_FEATURES.some(d=>d.retentionSourceId==='cda')).toBe(false);
  const changed=saveFeatureDefinition(saved,{...source,formula:'CDI2 = 0.77'});expect(changed.find(d=>d.id===copy.id)).toEqual(copy);
  const modified=saveFeatureDefinition(saved,{...copy,formula:copy.formula.replace('sr_gain = 0.5','sr_gain = 2')});expect(modified.find(d=>d.id===source.id)).toEqual(before);expect(source).toEqual(before);expect(CDA_DEF).toEqual(cdaBefore);
  expect(definitionKey(copy)).not.toBe(definitionKey(source));expect(new Set(SELLER_RETENTION_FEATURES.map(definitionKey)).size).toBe(7);
  for(const d of SELLER_RETENTION_FEATURES){expect(checkDefinition(d).formula).toBeNull();expect(readFishPreference(d.id)).toMatchObject({direction:'<',threshold:''});expect(mergeFeatureDefs(mergeFeatureDefs([])).filter(x=>x.id===d.id)).toHaveLength(1);for(const statistic of [d.chartCore!,'avg_'+d.chartCore,'avg_'+d.chartCore+'_2'])expect(compileFishProgram(d,{statistic,direction:'<',threshold:0,constraints:[]}).unavailable).toBeFalsy();}
 });
 it('keeps zero as neutral, reacts immediately to a break and removes the negative retention after a full reclaim',()=>{
  const d=fixture(),data=bars(240).map((b,i)=>({...b,open:100,close:100,volume:b.quoteVolume!/100}));
  const at=(price:number)=>{const x=data.map(b=>({...b}));x[x.length-1]={...x.at(-1)!,open:price,close:price,volume:x.at(-1)!.quoteVolume!/price};return run(d,x);};
  expect(series(at(100),spec.core).at(-1)).toBe(0);expect(series(at(99),'sr_retention_z').at(-1)).toBeLessThan(0);expect(series(at(101),'sr_retention_z').at(-1)).toBeGreaterThan(0);
  expect(series(at(99),spec.core).at(-1)).toBeLessThan(0);expect(series(at(101),spec.core).at(-1)).toBeGreaterThan(0);
  // Independent one-root calculation: all previous VWAPs are 100, so every historical displacement changes together.
  const price=99,out=at(price),ks=series(out,'sr_weight'),rho=2**(-5/60);let sum=0,weights=0;
  for(let j=0;j<24;j++){sum+=rho**j*ks[239-j]*Math.log(price/100)/(j+1);weights+=rho**j;}
  const sigma=series(out,'sr_denom').at(-1)!;expect(series(out,'sr_retention_z').at(-1)).toBeCloseTo(sum/weights/sigma,8);
 });
 it('identifies stronger volume-backed sell displacement, prior-volatility surprise and directional trade-impact proxies',()=>{
  const d=fixture(),data=bars(240);const make=(multiple:number,share:number)=>data.map((b,i)=>{if(i<216)return b;const e=b.quoteVolume!/b.volume!*.99,q=b.quoteVolume!*multiple;return {...b,close:e,volume:q/e,quoteVolume:q,takerBuyQuoteVolume:q*share};});
  const weak=run(d,make(1,.5)),strong=run(d,make(4,.2));
  expect(series(strong,'sr_support')[216]).toBeGreaterThan(series(weak,'sr_support')[216]);expect(series(strong,'sr_flow')[216]).toBeCloseTo(-.6,10);expect(series(strong,'sr_impact')[216]).toBeLessThan(0);expect(series(strong,'sr_retention_z')[216]).toBeLessThan(series(weak,'sr_retention_z')[216]);
  const calm=bars(240).map((b,i)=>{const c=100*Math.exp(.00001*Math.sin(i));return {...b,close:c,volume:b.quoteVolume!/c};});const volatile=bars(240);
  const shock=(x:ResearchBar[])=>{const prev=x.at(-2)!,c=prev.close*.99;x[x.length-1]={...x.at(-1)!,close:c,volume:x.at(-1)!.quoteVolume!/c};return series(run(d,x),'sr_anomaly_z').at(-1)!;};expect(shock(calm)).toBeLessThan(shock(volatile));
 });
 it.each(SELLER_RETENTION_FEATURES)('$id preserves its original calculation and never sees future bars',d=>{
  const source=BUILTIN_FEATURES.find(s=>s.id===d.retentionSourceId)!,data=bars(),original=run(source,data),enhanced=run(d,data),base=series(enhanced,d.retentionPrefix+'_base');
  const origin=series(original,SELLER_RETENTION_SPECS.find(s=>s.id===d.id)!.sourceCore);
  expect(base).toEqual(origin);const off={...d,formula:d.formula.replace(d.retentionPrefix+'_gain = 0.5',d.retentionPrefix+'_gain = 0')};expect(series(run(off,data),d.chartCore!)).toEqual(origin);
  const short=run(d,data.slice(0,1500));expect(series(enhanced,d.chartCore!).slice(0,1500)).toEqual(series(short,d.chartCore!));expect(series(enhanced,d.chartCore!).some(Number.isFinite)).toBe(true);
  const bounded=SELLER_RETENTION_SPECS.find(s=>s.id===d.id)!.bound;if(bounded)expect(series(enhanced,d.chartCore!).filter(Number.isFinite).every(v=>Math.abs(v)<=bounded)).toBe(true);
  expect(featureWindowMs(d)).toBeGreaterThanOrEqual(featureWindowMs(source));
 });
 it('does not turn absent volume, time gaps, warmup or invalid prices into zero observations',()=>{
  const d=fixture();expect(Number.isNaN(series(run(d,bars(25)),spec.core).at(-1)!)).toBe(true);
  for(const kind of ['amount','time','price']){const x=bars(240);if(kind==='amount')x[230]={...x[230],quoteVolume:null};if(kind==='time')x[230]={...x[230],openTime:x[230].openTime+1};if(kind==='price')x[230]={...x[230],close:0};expect(Number.isNaN(series(run(d,x),spec.core).at(-1)!)).toBe(true);}
 });
 it('keeps namespaced account formulas collision-free, chart diagnostics and fishing tied to each copy',()=>{
  const d=createSellerRetentionCopy({...CDI2_DEF,formula:'sr_base = 777\nCDI2 = -0.1',avgHours:1,halfLifeHours:1},spec);expect(d.retentionPrefix).toBe('sr_');
  localStorage.setItem('sim_anon_'+FEATURES_KEY,JSON.stringify([d]));const defs=accountFeatureDefs(),item=researchIndicatorForFeature(d);expect(item.components).toContain('sr__retention_z');expect(accountResearchIndicators(defs).filter(i=>i.featureId===d.id)).toHaveLength(1);
  const data=bars(),candles=data.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume!,turnover:b.quoteVolume!,takerBuyTurnover:b.takerBuyQuoteVolume!}));
  const graph=researchChartSeries(candles,item,item.period,{fetchReference:false}),expected=run(d,data);expect(graph.core.at(-1)).toBeCloseTo(series(expected,d.chartCore!).at(-1)!,10);expect(graph.components?.sr__retention_z.at(-1)).toBeCloseTo(series(expected,'sr__retention_z').at(-1)!,10);
  expect(fishStatistics(d).map(x=>x.name)).toContain('sr__retention_z');const plan=compileFishProgram(d,{statistic:d.chartCore!,direction:'<',threshold:0,constraints:[]});expect(plan.unavailable).toBeFalsy();expect(evaluateFishProgram(data,plan).value.at(-1)).toBeCloseTo(graph.core.at(-1)!,10);
  expect(chartFeatureHistoryBars(d.id,item.period,d.formula)).toBeGreaterThan(576);
 });
 it('invalid saved originals remain visibly invalid, and early account copies do not silently use default formulas',()=>{
  const source={...CDI2_DEF,formula:'CDI2 = missing_input'};const saved=ensureSellerRetentionCopies([source]),copy=mergeFeatureDefs(saved).find(d=>d.id===spec.id)!;
  expect(copy.formula).toContain(source.formula);expect(copy.formula).not.toContain('sr_retention_z');expect(checkDefinition(copy).formula).not.toBeNull();expect(saved.find(d=>d.id===source.id)).toEqual(source);
 });
 it.each(SELLER_RETENTION_FEATURES)('$id charts, diagnostics, independent averages and research agree on closed data',d=>{
  localStorage.setItem('sim_anon_'+FEATURES_KEY,JSON.stringify([d]));const item=researchIndicatorForFeature(d),data=bars().map(b=>({...b,refClose:null}));
  const candles=data.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume!,turnover:b.quoteVolume!,takerBuyTurnover:b.takerBuyQuoteVolume!,cba2Closed:true}));
  const actual=researchChartSeries(candles,item,item.period,{fetchReference:false}),expected=run(d,data);expect(actual.core.at(-1)).toBeCloseTo(series(expected,d.chartCore!).at(-1)!*d.scale,8);expect(actual.avg.at(-1)).not.toBeNull();expect(actual.avg2.at(-1)).not.toBeNull();
  const forming=candles.map((b,i)=>({...b,cba2Closed:i!==candles.length-1}));const masked=chartFeatureSeries(forming,d.id,item.period)!;expect(masked.core.at(-1)).toBeNull();expect(masked.vars.get(d.retentionPrefix+'_retention_z')!.at(-1)).toBeNull();
 });

 it('invalid enhancement parameters stay missing, and incremental calculation revalues the current price exactly',()=>{
  const d=fixture(),data=bars(240),cache=createFormulaEvaluationCache(),compiled=compileFeatureFormula(d.formula);
  evaluateOnBars(data.slice(0,200),compiled,d,cache);const incremental=evaluateOnBars(data,compiled,d,cache),full=run(d,data);expect(series(incremental,spec.core)).toEqual(series(full,spec.core));
  const changed=data.map((b,i)=>i===239?{...b,close:b.close*1.02,volume:b.volume!/1.02}:b);const updated=evaluateOnBars(changed,compiled,d,cache);expect(series(updated,spec.core)).toEqual(series(run(d,changed),spec.core));
  for(const [name,value] of [['gain','-1'],['eta','2'],['alpha','-1'],['impact_weight','-1'],['flow_floor','0'],['sigma_floor','0']] as const){const altered={...d,formula:d.formula.replace(new RegExp('sr_'+name+' = [^\\n]+'),'sr_'+name+' = '+value)};expect(Number.isNaN(series(run(altered,data),spec.core).at(-1)!)).toBe(true);}
 });

 it('uses existing hour-to-bar rounding for fractional account baselines and independent retention windows',()=>{
  const d={...fixture(),avgHours:.13,formula:fixture().formula.replace('sr_window_h = 2','sr_window_h = 2.13')},out=run(d,bars(240));expect(series(out,spec.core).some(Number.isFinite)).toBe(true);expect(out.vars.get('sr_baseline_n')).toBe(2);expect(out.vars.get('sr_window_n')).toBe(26);
 });

});
