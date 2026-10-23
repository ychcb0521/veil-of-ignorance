import { beforeEach, expect, it } from 'vitest';
import { STATE_DEF, STATE_FORMULA, STATE2_DEF, STATE2_FORMULA, CDA_FORMULA, BUILTIN_FEATURES, checkDefinition, compileFeatureFormula, evaluateOnBars, mergeFeatureDefs, definitionKey } from '../features';
import { compileFishProgram, evaluateFishProgram } from '@/lib/fish/algorithm';
import { chartFeatureSeries } from '@/lib/featureSource';
import type { ResearchBar } from '@/lib/deepRsa/window';
const bars:ResearchBar[]=[];let close=100;
for(let i=0;i<1800;i++){const open=close;close*=Math.exp(.001*Math.sin(i*.29)+.0003*Math.sin(i/140));const q=10000*(1.4+.3*Math.sin(i*.17)),e=close*(1+.001*Math.cos(i*.19));bars.push({openTime:i*300000,open,close,high:Math.max(open,close)*1.002,low:Math.min(open,close)*.998,volume:q/e,quoteVolume:q,takerBuyQuoteVolume:q*(.5+.3*Math.sin(i*.13)),takerBuyVolume:null,refClose:50000*Math.exp(.001*Math.sin(i*.23))});}
const evaluate=(formula:string,params={})=>evaluateOnBars(bars,compileFeatureFormula(formula),params);
const s=evaluate(STATE_FORMULA),s2=evaluate(STATE2_FORMULA),cda=evaluate(CDA_FORMULA);
function values(out:ReturnType<typeof evaluate>,name:string){const v=out.vars.get(name)!;return typeof v==='number'?bars.map(()=>v):Array.from(v);}
beforeEach(()=>localStorage.clear());
it('registers independent S2 beside S, with independently editable and removable definitions',()=>{
 expect(checkDefinition(STATE2_DEF)).toEqual({formula:null,groups:null,scale:null});
 expect(BUILTIN_FEATURES[BUILTIN_FEATURES.indexOf(STATE_DEF)+1]).toBe(STATE2_DEF);
 expect(STATE2_DEF).toMatchObject({id:'state2',short:'状态 S2',scale:1,unit:''});
 const edited={...STATE2_DEF,formula:STATE2_FORMULA+'\navg_state2 = avg(state2, 24)'};
 const defs=mergeFeatureDefs([edited]);expect(defs.find(d=>d.id==='state2')?.formula).toBe(edited.formula);expect(defs.find(d=>d.id==='state')?.formula).toBe(STATE_FORMULA);
 expect(mergeFeatureDefs([{...STATE2_DEF,removed:true}]).some(d=>d.id==='state2')).toBe(false);
 expect(definitionKey(STATE_DEF)).not.toBe(definitionKey(STATE2_DEF));
});
it('first two components, weights and smoothing remain exactly equal to S',()=>{
 for(const name of ['Lcs','La','wc','wa','wb','sh','ka'])expect(values(s2,name)).toEqual(values(s,name));
 expect(s2.vars.has('Sb')).toBe(false);expect(s2.vars.has('state')).toBe(false);
});
it('third component matches standalone CDA before tanh, keeping the original sign, clip and sum',()=>{
 const raw=values(s2,'Ss'),third=values(s2,'Lb'),CDA=values(cda,'CDA'),Lc=values(s2,'Lcs'),La=values(s2,'La'),out=values(s2,'state2'),original=values(s,'state');let checked=0,different=0;
 for(let i=1000;i<bars.length;i++){
  expect(100*Math.tanh(raw[i])).toBeCloseTo(CDA[i],9);
  expect(third[i]).toBe(Math.max(-3,Math.min(3,raw[i])));
  expect(out[i]).toBeCloseTo(1/(1+Math.exp(-(3*Lc[i]+.4*La[i]+third[i]))),12);
  expect(out[i]).toBeGreaterThanOrEqual(0);expect(out[i]).toBeLessThanOrEqual(1);checked++;
  if(Math.abs(out[i]-original[i])>1e-8)different++;
 }
 expect(checked).toBe(800);expect(different).toBeGreaterThan(0);
});
it('Deep dig, fishing and chart use the same formula and baseline parameter',()=>{
 const algorithm={direction:'>' as const,threshold:.6,constraints:[]},plan=compileFishProgram(STATE2_DEF,algorithm);
 expect(plan.unavailable).toBeFalsy();expect(plan.N).toBeLessThanOrEqual(5000);
 const fish=evaluateFishProgram(bars,plan);expect(Array.from(fish.value)).toEqual(values(s2,'state2'));
 const data=bars.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,turnover:b.quoteVolume!,takerBuyTurnover:b.takerBuyQuoteVolume!}));
 const chart=chartFeatureSeries(data,'state2',12,bars.map(b=>b.refClose!))!;
 const reference=evaluate(STATE2_FORMULA,{avgHours:12}),expected=values(reference,'state2');
 for(let i=1000;i<bars.length;i++)expect(chart.core[i]).toBeCloseTo(expected[i],12);
});
