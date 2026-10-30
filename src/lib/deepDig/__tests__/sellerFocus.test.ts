import {afterEach,describe,expect,it} from 'vitest';
import {createFormulaEvaluationCache,evaluateProgram,parseFormula,programHistoryBars} from '../formula';
import {BUILTIN_FEATURES,SELLER_FOCUS_FEATURES,SELLER_FEATURE_CORES,FEATURES_KEY,createSellerFocusCopy,ensureFeatureCopies,mergeFeatureDefs,saveFeatureDefinition,definitionKey,checkDefinition,compileFeatureFormula,evaluateOnBars,featureWindowMs,CDI2_DEF,CDA_DEF,STATE_DEF} from '../features';
import {compileFishProgram,evaluateFishProgram,fishStatistics} from '@/lib/fish/algorithm';
import {readFishPreference} from '@/lib/fish/preferences';
import {accountResearchIndicators,researchIndicatorForFeature,researchChartSeries} from '@/lib/researchIndicators';
import {accountFeatureDefs} from '@/lib/featureSource';
import {clearPersistedStateMemoryForTests} from '@/lib/persistedStateStorage';
import {groupDeepDigFeatures} from '@/lib/customIndicatorGroups';
import {focusMbiKappa} from '@/lib/recentFocusMath';
import type {ResearchBar} from '@/lib/deepRsa/window';
const S=(v:number[])=>Float64Array.from(v);
const calc=(src:string,x=S([1,2,3,4,5]),minutes=60)=>evaluateProgram(parseFormula(src,new Set(['x'])),{x},{barMinutes:minutes}) as Float64Array;
function bars(count=1100):ResearchBar[]{let c=100;return Array.from({length:count},(_,i)=>{const open=c;c*=Math.exp(.001*Math.sin(i*.8)-(i>800?.0003:0));const q=10000*(1+.2*Math.sin(i/11));return {openTime:i*300000,open,close:c,high:Math.max(open,c)*1.001,low:Math.min(open,c)*.999,volume:q/c,quoteVolume:q,takerBuyQuoteVolume:q*(.5+.2*Math.sin(i/20)),takerBuyVolume:null,refClose:20000*Math.exp(.00003*i)};});}
const run=(d:typeof CDI2_DEF,data:ResearchBar[],cache?:ReturnType<typeof createFormulaEvaluationCache>)=>evaluateOnBars(data,compileFeatureFormula(d.formula),d,cache);
const value=(d:typeof CDI2_DEF,data:ResearchBar[])=>{const out=run(d,data),v=out.vars.get(d.chartCore??(d.id==='state'?'state':SELLER_FEATURE_CORES[d.id]));return typeof v==='number'?Array(data.length).fill(v):Array.from(v??[]);};
afterEach(()=>{localStorage.clear();clearPersistedStateMemoryForTests();});
describe('relative recent temporal kernels',()=>{
 it('uses exactly 3:1 observation weights and reliability-weighted sample variance',()=>{
  const weights=[1,1,1,3,3],mean=33/9,variance=[1,2,3,4,5].reduce((n,x,i)=>n+weights[i]*(x-mean)**2,0)/(9-21/9);
  expect(calc('avg(x,5,2,3)').at(-1)).toBeCloseTo(mean,13);expect(calc('sd(x,5,2,3)').at(-1)).toBeCloseTo(Math.sqrt(variance),13);
  expect(calc('sum(x,5,2,3)').at(-1)).toBeCloseTo(mean*5,13);
  expect(calc('median(x,5,2,3)').at(-1)).toBe(4);
  expect(calc('avg(x,5,2,3)',S([NaN,NaN])).every(Number.isNaN)).toBe(true);
 });
 it('matches a hand-expanded EMA kernel including skipped missing samples and an explicit seed',()=>{
  const x=[10,NaN,20,5,30],rho=.5;
  for(const seed of [undefined,7]){
   const terms:{at:number;mass:number;x:number}[]=seed===undefined?[]:[{at:-100,mass:1,x:seed}];let started=seed!==undefined;
   for(let t=0;t<x.length;t++)if(Number.isFinite(x[t])){for(const term of terms)term.mass*=rho;terms.push({at:t,mass:started?1-rho:1,x:x[t]});started=true;}
   const total=terms.reduce((s,v)=>s+v.mass*(v.at>=3?3:1),0),expected=terms.reduce((s,v)=>s+v.mass*(v.at>=3?3:1)*v.x,0)/total;
   expect(calc(seed===undefined?'ema(x,1,2,3)':'ema(x,1,7,2,3)',S(x)).at(-1)).toBeCloseTo(expected,12);
  }
 });
 it('preserves weighted-sum units and recomputes current-price retained displacement',()=>{
  const expected=Array.from({length:5},(_,j)=>2**(-j/2)).reduce((a,b)=>a+b,0)*7;
  expect(calc('wsum(x,2,5,2,3)',S([7,7,7,7,7])).at(-1)).toBeCloseTo(expected,12);
  const rho=.5,den=Array.from({length:5},(_,j)=>rho**j*(j<2?3:1)).reduce((a,b)=>a+b,0),sum=Array.from({length:5},(_,j)=>rho**j*(j<2?3:1)*Math.log(90/100)/(j+1)).reduce((a,b)=>a+b,0);
  expect(calc('retain(1,x,100,1,5,2,3)',S([100,100,100,100,90])).at(-1)).toBeCloseTo(sum/den,12);
  // Implicit 48h retain must not mistake focus_h for its original window.
  const p=parseFormula('retain(1,x,100,1,2,3)',new Set(['x']));expect(programHistoryBars(p,{},60)).toBe(47);
 });
 it('calibrates MBI with the weighted price-kernel tail, without shrinking its n',()=>{
  const n=25,rho=1-1/n,L=24,q=3,D=1+(q-1)*(1-rho**L);
  const weights=Array.from({length:2500},(_,j)=>(1-rho)*rho**j*(j<L?q:1)/D);
  const coefficients=weights.map((_,j)=>weights.slice(j).reduce((a,b)=>a+b,0));
  const expected=Math.sqrt(coefficients.reduce((s,v)=>s+v*v,0));expect(focusMbiKappa(n,{bars:L,weight:q})).toBeCloseTo(expected,11);
  expect(focusMbiKappa(n,{bars:L,weight:1})).toBeCloseTo(1/Math.sqrt(1/n*(2-1/n)),12);
 });
 it('weights the actual MBI variance seed observations and Wilder seed instead of treating their timestamps as ancient',()=>{
  const n=5,r=.001,rho=1-1/n,x=S(Array.from({length:26},(_,i)=>100*Math.exp(r*i)));let mean=0,mass=0;
  for(let j=0;j<=24;j++){const age=24-j,w=(j===0?rho**24:(1-rho)*rho**age)*(age<24?3:1);mean+=w*Math.log(x[j]);mass+=w;}
  // Every observed squared return, including all n seed observations, is r²: weighting cannot change that variance.
  const expected=(Math.log(x[25])-mean/mass)/(focusMbiKappa(n,{bars:24,weight:3})*r);
  expect(calc('mbiz(x,5,2,3)',x,5).at(-1)).toBeCloseTo(expected,10);
  const atr=(.125*1+.125*2+3*.25*3+3*.5*4)/(.125+.125+3*.25+3*.5);
  expect(calc('atr(x,0,0/0,2,2,3)',S([1,2,3,4])).at(-1)).toBeCloseTo(atr,13);
 });
 it('validates argument counts and focus settings without broadening legacy syntax gaps',()=>{
  expect(()=>calc('avg(x,5,2)')).toThrow();expect(()=>calc('avg(x,5,2,0)')).toThrow();expect(()=>calc('ema(x,5,0,2,3,4)')).toThrow();
  expect(()=>calc('avg(x,5,-2,3)')).toThrow();
 });
});
describe('independent seller versions 2',()=>{
 it('adds S once without negating its scale, changing S/S2 or rebasing the existing 15 account copies',()=>{
  const existing=ensureFeatureCopies([]).filter(d=>d.id!=='state-v2'),before=structuredClone(existing),original=structuredClone(STATE_DEF);
  const source={...STATE_DEF,formula:'state = avg(C, avgh)',halfLifeHours:9,avgHours:7},saved=ensureFeatureCopies([...existing,source]),copy=saved.find(d=>d.id==='state-v2')!;
  expect(copy).toMatchObject({focusSourceId:'state',focusVersion:2,chartCore:'state',short:'状态 S·版本2',halfLifeHours:9,avgHours:7});
  expect(copy.formula).toContain('avg(C, avgh, focus2_h, focus2_weight)');expect(copy.definition).toContain('0.5为均衡');expect(copy.definition).not.toContain('卖方仍为负值');
  const data=bars(100).map(b=>({...b,close:.5}));expect(value(copy,data).at(-1)).toBe(.5);
  expect(saved.filter(d=>d.id!=='state-v2'&&d.id!=='state')).toEqual(before);expect(saved.some(d=>d.id==='state2-v2')).toBe(false);expect(ensureFeatureCopies(saved)).toBe(saved);
  expect(saveFeatureDefinition(saved,{...source,formula:'state = 0.1'}).find(d=>d.id==='state-v2')).toEqual(copy);
  expect(saveFeatureDefinition(saved,{...copy,formula:'state = 0.9'}).find(d=>d.id==='state')).toEqual(source);expect(STATE_DEF).toEqual(original);
  const actual=SELLER_FOCUS_FEATURES.find(d=>d.id==='state-v2')!,values=value(actual,bars()).filter(Number.isFinite);expect(values.length).toBeGreaterThan(100);expect(values.every(v=>v>=0&&v<=1)).toBe(true);
  expect(researchIndicatorForFeature(actual)).toMatchObject({neutral:.6,avgNeutral:.6,min:0,max:1,avgRange:[0,1],templateId:'STATE',seller:false});
 });
 it('creates all 16, including CDA and S; freezes account formulas once, retains hidden copies and original configs',()=>{
  expect(SELLER_FOCUS_FEATURES).toHaveLength(16);expect(SELLER_FOCUS_FEATURES.some(d=>d.focusSourceId==='cda')).toBe(true);
  const source={...CDA_DEF,name:'账号CDA',formula:'CDA = avg(ln(C), avgh)',halfLifeHours:9,avgHours:17},before=structuredClone(source);
  const saved=ensureFeatureCopies([source]),copy=saved.find(d=>d.id==='cda-v2')!;
  expect(copy).toMatchObject({name:'账号CDA｜版本2',halfLifeHours:9,avgHours:17,focusSourceId:'cda',focusVersion:2});expect(copy.formula).toContain('avg(ln(C), avgh, focus2_h, focus2_weight)');
  expect(ensureFeatureCopies(saved)).toBe(saved);expect(ensureFeatureCopies([...saved.filter(d=>d.id!==copy.id),{...copy,removed:true}]).filter(d=>d.focusSourceId==='cda')).toHaveLength(1);
  expect(saveFeatureDefinition(saved,{...source,formula:'CDA = 123'}).find(d=>d.id===copy.id)).toEqual(copy);
  expect(saveFeatureDefinition(saved,{...copy,avgHours:11}).find(d=>d.id===source.id)).toEqual(source);expect(source).toEqual(before);
  const custom={...CDA_DEF,id:'f-custom',chartCore:'CDA',createdAt:42};const own=ensureFeatureCopies([custom]).find(d=>d.focusSourceId==='f-custom')!;expect(own.id).toBe('seller-focus-v2--f-custom');
  expect(readFishPreference(own.id)).toMatchObject({direction:'<',threshold:''});
  expect(ensureFeatureCopies(ensureFeatureCopies([custom])).filter(d=>d.focusSourceId==='f-custom')).toHaveLength(1);
  const invalid=ensureFeatureCopies([{...CDA_DEF,formula:'CDA = nope'}]).find(d=>d.id==='cda-v2')!;expect(checkDefinition(invalid).formula).not.toBeNull();expect(invalid.formula).toContain('CDA = nope');
  const collision=createSellerFocusCopy({...CDA_DEF,formula:'focus2_h = 9\nCDA = avg(C,9)'});expect(collision.focusPrefix).toBe('focus2_');
 });
 it.each(SELLER_FOCUS_FEATURES)('$id restores the exact original with weight1, has independent identity and no future access',d=>{
  const original=BUILTIN_FEATURES.find(s=>s.id===d.focusSourceId)!,data=bars(),off={...d,formula:d.formula.replace(d.focusPrefix+'_weight = 3',d.focusPrefix+'_weight = 1')};
  const raw=value(original,data),same=value(off,data),focused=value(d,data);expect(same).toEqual(raw);expect(focused.some(Number.isFinite)).toBe(true);expect(focused).not.toEqual(raw);
  expect(value(d,data.slice(0,1000))).toEqual(focused.slice(0,1000));expect(definitionKey(d)).not.toBe(definitionKey(original));
  expect(checkDefinition(d).formula).toBeNull();expect(featureWindowMs(d)).toBe(featureWindowMs(original));expect(readFishPreference(d.id)).toMatchObject({direction:d.focusSourceId==='state'?'>':'<',threshold:''});
  const constants=(def:typeof d)=>run(def,[]).vars,old=constants(original),updated=constants(d);for(const [name,v] of old)if(typeof v==='number')expect(updated.get(name)).toBe(v);
 },20000);
 it('keeps zero neutral, missing CTBA inputs missing, and original T range/window untouched',()=>{
  const d=SELLER_FOCUS_FEATURES.find(d=>d.id==='ctba_12h-bear-v2')!,data=bars().map(b=>({...b,open:100,close:100,high:100,low:100,volume:100,quoteVolume:10000,takerBuyQuoteVolume:5000}));
  expect(value(d,data).at(-1)).toBe(0);const out=run(d,data).vars;for(const [key,v] of Object.entries({N:144,f:8,s:24,m:48,lambda:Math.LN2/24}))expect(out.get(key)).toBe(v);
  data[data.length-1].quoteVolume=null;expect(Number.isNaN(value(d,data).at(-1)!)).toBe(true);
 });
 it('uses independent incremental state, matches fresh replay after append and a changed current bar',()=>{
  for(const id of ['cda-v2','mbi2-bear-v2','ctba_12h-bear-v2','cdi2-retain-v2']){
   const d=SELLER_FOCUS_FEATURES.find(d=>d.id===id)!,data=bars(),cache=createFormulaEvaluationCache(),compiled=compileFeatureFormula(d.formula);
   evaluateOnBars(data.slice(0,1000),compiled,d,cache);expect(evaluateOnBars(data,compiled,d,cache).vars).toEqual(run(d,data).vars);
   data[data.length-1]={...data.at(-1)!,close:data.at(-1)!.close*.98};expect(evaluateOnBars(data,compiled,d,cache).vars).toEqual(run(d,data).vars);
  }
 },20000);
 it.each(SELLER_FOCUS_FEATURES)('$id is selectable with own names in chart, fishing, mining and sell monitoring',d=>{
  localStorage.setItem('sim_anon_'+FEATURES_KEY,JSON.stringify([d]));const defs=accountFeatureDefs(),item=researchIndicatorForFeature(d),data=bars().map(b=>({...b,refClose:null}));
  expect(item).toMatchObject({id:'FEATURE_'+d.id,featureId:d.id,seller:d.focusSourceId!=='state',name:d.name,short:d.short});expect(accountResearchIndicators(defs).filter(i=>i.featureId===d.id)).toHaveLength(1);
  expect(groupDeepDigFeatures(defs).find(g=>g.key==='seller-focus-v2')!.items.some(x=>x.id===d.id)).toBe(true);
  const stats=fishStatistics(d).map(x=>x.name);expect(stats).toContain(d.chartCore!);
  const plan=compileFishProgram(d,{statistic:d.chartCore!,direction:'<',threshold:0,constraints:[]});expect(plan.unavailable).toBeFalsy();
  const actual=evaluateFishProgram(data,plan).average.at(-1),expected=value(d,data).at(-1)!;expect(actual).toBeCloseTo(expected,8);
  const candles=data.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume!,turnover:b.quoteVolume!,takerBuyTurnover:b.takerBuyQuoteVolume!,cba2Closed:true}));
  const chart=researchChartSeries(candles,item,item.period,{fetchReference:false});expect(chart.core.at(-1)).toBeCloseTo(expected*d.scale,8);
 },20000);
});
