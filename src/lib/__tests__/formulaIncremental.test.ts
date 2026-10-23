import { describe, expect, it } from 'vitest';
import { createFormulaEvaluationCache, evaluateProgramVars, parseFormula } from '../deepDig/formula';
import { BUILTIN_FEATURES, compileFeatureFormula, evaluateOnBars } from '../deepDig/features';
import type { ResearchBar } from '../deepRsa/window';
const bars = (n: number): ResearchBar[] => Array.from({ length:n }, (_,i) => { const close=100+3*Math.sin(i/29)+i/1000, volume=500+200*Math.cos(i/17), quoteVolume=volume*close;return{openTime:i*300000,open:close-.1,high:close+.4,low:close-.5,close,volume,quoteVolume,takerBuyQuoteVolume:quoteVolume*(.5+.15*Math.sin(i/11)),takerBuyVolume:null,refClose:40000+100*Math.sin(i/25)} });
const equal = (actual: ReturnType<typeof evaluateProgramVars>, expected: ReturnType<typeof evaluateProgramVars>) => { for(const [key,value] of expected.vars) expect(actual.vars.get(key),key).toEqual(value); };
describe('exact reuse of historical formula prefixes',()=>{
 it.each(['cbi2','cdi2','drift-speed-z','seller-control','state','bss','dss','cba','cda'])('%s matches full evaluation for a forming candle, append, correction and rewind',id=>{
  const def=BUILTIN_FEATURES.find(d=>d.id===id)!,compiled=compileFeatureFormula(def.formula),cache=createFormulaEvaluationCache(),data=bars(900);
  const check=()=>equal(evaluateOnBars(data,compiled,{},cache),evaluateOnBars(data,compiled));
  check();data.at(-1)!.close+=.13;data.at(-1)!.quoteVolume!+=30;check();data.push(bars(901)[900]);check();data[610].high+=.2;check();data.splice(800);check();
 });
 it('handles in-place inputs, missing values, growing windows and changed scalar parameters',()=>{
  const p=parseFormula('a = median(C, h)\nb = rscale(C, h)\nc = wsum(C, 8, 12)\nd = retain(C, C, C, h, 4)\ne = highest(C, 17)\nf = lowest(C, 17)', new Set(['C','h'])),cache=createFormulaEvaluationCache();
  let C=Float64Array.from({length:80},(_,i)=>i%7?100+i/10:NaN),h=1;
  const check=()=>equal(evaluateProgramVars(p,{C,h},{cache}),evaluateProgramVars(p,{C,h}));
  check();C[79]=NaN;check();C[71]=125;check();C=Float64Array.from([...C,110]);check();h=2;check();C=C.slice(15);check();
 });
});
