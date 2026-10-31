import {beforeEach,expect,it} from 'vitest';
import {ATI6H_DEF,MBI2_DEF,MBI_DEF,compileFeatureFormula,evaluateOnBars,featureWindowMs,definitionKey,mergeFeatureDefs,formulaVariables} from '../features';
import {computeMbi2Core,computeMbi2} from '@/lib/mbi2';
import {computeEventSeries,seriesOffsets,seriesRangeOf} from '../series';
import {snapshotOf,collectDeepDigRun} from '../analysis';
import {deepDigCsv} from '../export';
import {mbiBars} from './fixtures/mbiBars';
import {clearMarketDataCache,fetchResearchKlines} from '@/lib/deepRsa/marketData';
import {clearAti6hMarketCache} from '@/lib/ati6hMarketData';
import type {CampaignGroupReport} from '@/lib/deepRsa/report';
import type {TradeSignal} from '@/lib/signalLibrary';
beforeEach(()=>{localStorage.clear();clearMarketDataCache();clearAti6hMarketCache();});
it('registers one independent ATI6H with no inherited average or 48h aggregation; versions include mode and params',()=>{
 expect(mergeFeatureDefs([]).filter(d=>d.id==='ati6h')).toHaveLength(1);
 expect(formulaVariables(ATI6H_DEF.formula).names).toContain('ATI6H_sF');expect(ATI6H_DEF.formula).not.toMatch(/\bavg\s*\(/);
 expect(featureWindowMs(ATI6H_DEF)).toBe((72+125+2)*300000);
 expect(definitionKey({...ATI6H_DEF,ATI6H_volume_mode:'bar_direction_proxy'})).not.toBe(definitionKey(ATI6H_DEF));
 expect(definitionKey({...ATI6H_DEF,ATI6H_parameters:{BAND_SIGMA:1}})).not.toBe(definitionKey(ATI6H_DEF));
});
it('sigma adapter is the square root of pre-update single-return second moment without changing existing MBI/MBI2 values',()=>{
 const bars=mbiBars(900),C=bars.map(b=>b.close),core=computeMbi2Core(C),copy=computeMbi2(C);
 let S=Array.from({length:25},(_,k)=>(Math.log(C[k+1])-Math.log(C[k]))**2).reduce((a,b)=>a+b,0)/25;
 for(let t=1;t<C.length;t++){if(t>=125)expect(core.sigmaBefore[t]).toBe(Math.sqrt(S));const r=Math.log(C[t])-Math.log(C[t-1]);S=.96*S+.04*r*r;}
 const a=evaluateOnBars(bars,compileFeatureFormula(MBI_DEF.formula),MBI_DEF),b=evaluateOnBars(bars,compileFeatureFormula(MBI2_DEF.formula),MBI2_DEF);
 expect(b.vars.get('MBI2')).toEqual(a.vars.get('MBI'));expect(copy.mbi).toEqual(core.mbi);
});
it('evaluates native evidence through the existing formula variables, preserves missing sigma and full-precision time series',()=>{
 const bars=mbiBars(900).map(b=>({...b,ATI6H_tick_size:.0001})),compiled=compileFeatureFormula(ATI6H_DEF.formula),out=evaluateOnBars(bars,compiled,ATI6H_DEF);
 expect(compiled.usesAti6h).toBe(true);expect(out.ATI6H_details).toHaveLength(bars.length);
 expect(out.ATI6H_details![20].ATI6H).toBeNull();expect(out.ATI6H_details!.at(-1)!.ATI6H_sA).not.toBeNull();
 const names=formulaVariables(ATI6H_DEF.formula).names,offsets=seriesOffsets(seriesRangeOf(ATI6H_DEF));
 const series=computeEventSeries(bars,900*300000,compiled,ATI6H_DEF,names,offsets);expect(series).toBeInstanceOf(Float64Array);
 expect((out.vars.get('ATI6H') as Float64Array).at(-1)).toBe(out.ATI6H_details!.at(-1)!.ATI6H??NaN);
 const missing=evaluateOnBars(bars.map(b=>({...b,ATI6H_tick_size:null})),compiled,ATI6H_DEF);expect(missing.ATI6H_details!.at(-1)!.ATI6H_reason_codes).toContain('missing_tick_size');
});
it('strict ATI amount adapter rejects out-of-range values without changing the existing parser behavior',async()=>{
 const fetchFn=async()=>({ok:true,status:200,json:async()=>[[0,100,101,99,100,1,299999,100,1,.5,100.00000001,0]]});
 const old=await fetchResearchKlines('STRICTUSDT',0,300000,fetchFn,undefined,'5m');
 const strict=await fetchResearchKlines('STRICTUSDT',0,300000,fetchFn,undefined,'5m',true);
 expect(old[0].takerBuyQuoteVolume).toBe(100);expect(strict[0].takerBuyQuoteVolume).toBe(100.00000001);
});
it('production collection saves and exports parameters, external dependency, per-event structure details and chart windows',async()=>{
 const bars=mbiBars(2200),anchor=1700*300000;
 const fetchFn=async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith('exchangeInfo'))return{ok:true,status:200,json:async()=>({symbols:[{symbol:'ATIINTEGRATIONUSDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.001'}]}]})};const a=+u.searchParams.get('startTime')!,z=+u.searchParams.get('endTime')!,limit=+u.searchParams.get('limit')!;return{ok:true,status:200,json:async()=>bars.filter(b=>b.openTime>=a&&b.openTime<=z).slice(0,limit).map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume,b.openTime+299999,b.quoteVolume,1,0,b.takerBuyQuoteVolume,0])};};
 const def={...ATI6H_DEF,source:'signals' as const,positive:'s >= 3',control:'s < 3'};
 const run=await collectDeepDigRun({rows:[]} as unknown as CampaignGroupReport,def,{signals:[{id:'ati-integration',symbol:'ATIINTEGRATIONUSDT',timeMs:anchor,quality:5} as TradeSignal],fetchFn,backgroundCap:0});
 const row=run.data.rows[0];expect(row).toBeDefined();expect(row.ATI6H_details?.ATI6H_tick_size).toBe(.001);expect(row.ATI6H_details?.ATI6H_parameters.WINDOW_HOURS).toBe(6);expect(run.data.definition.ATI6H_dependency?.formula).toContain('MBI2_state');
 expect(run.series.ATI6H_windows?.[row.id].rows).toHaveLength(72);expect(run.series.byEvent[row.id]).toBeInstanceOf(Float64Array);
 expect(deepDigCsv(run.data)).toContain('ATI6H_details,ATI6H_archive,ATI6H_dependency');expect(deepDigCsv(run.data)).toContain('taker');
 expect(snapshotOf({...def,ATI6H_parameters:{WICK_BAD:4}}).ATI6H_parameters).toEqual({WICK_BAD:4});
},30000);
