import {expect,it} from 'vitest';
import {advanceDoubleDrop,doubleDropState,emptyDoubleDropState,DOUBLE_DROP_VERSION} from '../qualityDoubleDrop';
import {additionVetoIdentity,evaluateAdditionVetoes,validateAdditionVetoes,type VetoBar} from '../qualityAdditionVeto';
import {chartAtr} from '@/lib/atr';
import {SAPIEN_5M} from './fixtures/doubleDropSAPIEN';
import {freezeQualityPlan,planVersionChanges} from '../qualityPlanVersions';
import {defaultQualityAddition} from '../qualityAddition';
import {makeQualitySellPlan} from '../qualitySellPlans';
import {qualityFilterChoices} from '../qualityFilters';
import {BUILTIN_FEATURES} from '@/lib/deepDig/features';
import {definitionKey} from '@/lib/deepDig/features';
import {evaluateQualitySample,type QualityGroup,type QualitySample} from '../quality';
import type {FishReconstructionLoader} from '../reconstruction';
const T=Date.UTC(2026,0,1),STEP=300000;
const series=(closes:number[],high=100):VetoBar[]=>closes.map((close,i)=>({openTime:T+i*STEP,open:i?closes[i-1]:100,high:Math.max(high,close,i?closes[i-1]:100),low:Math.min(close,i?closes[i-1]:100),close}));
const state=(closes:number[])=>doubleDropState(series(closes),closes.map(()=>1),T,{pct:4});
it('counts one continuous decline once; a rebound must leave the drop zone before another fall counts',()=>{
 expect(state([100,95,94,93]).count).toBe(1);
 expect(state([100,95,96.1,95]).count).toBe(2);
 expect(state([100,95,95.5,95]).count).toBe(1);
});
it('keeps the two-drop veto through a small recovery, clears only on a 5m recovery close, and starts a new cycle',()=>{
 expect(state([100,95,97,95,99])).toMatchObject({count:2,lockedPeak:100});
 expect(state([100,95,97,95,100])).toMatchObject({count:0});
 expect(state([100,95,97,95,100,95])).toMatchObject({count:1});
});
it('does not count an upper wick above the old high as a recovery',()=>{
 const bars=series([100,95,97,95,99]);bars[4].high=105;
 expect(doubleDropState(bars,bars.map(()=>1),T,{pct:4})).toMatchObject({count:2,lockedPeak:100});
});
it('freezes ATR at the first drop so later volatility cannot erase or manufacture the second crossing',()=>{
 const bars=series([100,95,97,95]);
 expect(doubleDropState(bars,[1,1,100,100],T,{atr:2.5,pct:4})).toMatchObject({count:2,referenceAtr:1});
});
it('resumes from state identically and uses only closed prefix observations',()=>{
 const bars=series([100,95,97,95,99,100,95]),atr=bars.map(()=>1);
 let prefix=doubleDropState(bars.slice(0,3),atr.slice(0,3),T,{pct:4});
 expect(prefix.count).toBe(1);
 for(const b of bars.slice(3))prefix=advanceDoubleDrop(prefix,b,1,{pct:4});
 expect(prefix).toEqual(doubleDropState(bars,atr,T,{pct:4}));
});
it('does not import damage from before entry and rejects gaps, invalid prices or missing required ATR',()=>{
 const bars=series([100,95,97,95]);
 expect(doubleDropState(bars,bars.map(()=>1),T+3*STEP,{pct:4}).count).toBe(1);
 expect(()=>doubleDropState([bars[0],bars[2]],[1,1],T,{pct:4})).toThrow('连续');
 expect(()=>advanceDoubleDrop(emptyDoubleDropState(),{...bars[0],low:NaN},1,{pct:4})).toThrow('行情');
 expect(()=>doubleDropState(bars,bars.map(()=>NaN),T,{atr:2})).toThrow('ATR');
});
it('supports ATR, percentage, AND and OR without merging identities or inventing an empty threshold',()=>{
 const bars=series([100,95,97,95]);
 const run=(rule:Parameters<typeof doubleDropState>[3])=>doubleDropState(bars,bars.map(()=>3),T,rule);
 expect(run({pct:4,atr:2,join:'and'}).count).toBe(0);
 expect(run({pct:4,atr:2,join:'or'}).count).toBe(2);
 expect(run({atr:1.2}).count).toBe(2);
 expect(()=>validateAdditionVetoes([{kind:'double-drop',enabled:true}])).toThrow('请填写');
 expect(()=>validateAdditionVetoes([{kind:'double-drop',enabled:true,pct:0}])).toThrow('大于 0');
 const a={kind:'double-drop' as const,enabled:true,pct:4,atr:2};
 expect(additionVetoIdentity([{...a,join:'and'}])).not.toEqual(additionVetoIdentity([{...a,join:'or'}]));
 expect(JSON.stringify(additionVetoIdentity([a]))).toContain(DOUBLE_DROP_VERSION);
});
it('returns a durable, self-explaining veto at a later add even after the immediate pullback has recovered',()=>{
 const bars=series([100,95,97,95,99]);
 expect(evaluateAdditionVetoes([{kind:'double-drop',enabled:true,pct:4}],bars,bars.map(()=>1),T)).toMatchObject({kind:'double-drop',reading:expect.stringContaining('尚未以 5 分钟收盘收复 100')});
 expect(evaluateAdditionVetoes([{kind:'double-drop',enabled:true,pct:4}],bars,bars.map(()=>100),T)).toMatchObject({kind:'double-drop'});
 expect(evaluateAdditionVetoes([{kind:'double-drop',enabled:false,pct:4}],bars,bars.map(()=>1),T)).toBeUndefined();
 const plan={...makeQualitySellPlan(qualityFilterChoices(BUILTIN_FEATURES)[0].key,'>',0,BUILTIN_FEATURES),addition:{...defaultQualityAddition(),enabled:true,entryVetoes:[{kind:'double-drop' as const,enabled:true,pct:4}]}};
 const frozen=freezeQualityPlan(plan);
 expect(planVersionChanges(frozen)).toEqual([]);
 expect(JSON.stringify(frozen.frozenVersions)).toContain(DOUBLE_DROP_VERSION);
 frozen.addition!.entryVetoes![0].pct=5;
 expect(planVersionChanges(frozen).length).toBeGreaterThan(0);
});
it('actually prevents a calculator fill, preserves the disabled path, and resumes to the same veto evidence',async()=>{
 const M=60000,points=[80,100,95,97,95,99,99],def={id:'late-add',name:'late-add',short:'add',definition:'',formula:`raw=if(T>=${T+20*M},1,0)`,scale:1,unit:'',positive:'1',control:'0',interval:'1m'};
 const snapshot={featureId:def.id,definitionKey:definitionKey(def),statistic:'raw',interval:'1m',scale:1,threshold:.5,cutoffMs:T,average:0,cbi2:0,startAverage:0,previousAverage:0};
 const sample:QualitySample={id:'a',enteredAt:T,basis:'signal',importedAt:T,groups:[],source:{id:'s',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''}};
 const group=(enabled:boolean):QualityGroup=>({id:'g',label:'test',metric:'raw',snapshot,rule:{metric:'raw',direction:'<',threshold:-1},execution:'intrabar-1m',mirrorTakeProfit:{enabled:true,gainPct:5,sellPct:50},addition:{...defaultQualityAddition(),enabled:true,source:'custom',condition:{id:'trigger',label:'late',metric:'raw',direction:'>',threshold:.5,enabled:true,snapshot},entryVetoes:[{kind:'double-drop',enabled,pct:4}]}});
 const minute=(at:number)=>{
   const k=(at-T)/M,block=Math.floor(k/5),within=k%5;
   const start=k<0?80:points[Math.min(block,points.length-1)],end=k<0?80:points[Math.min(block+1,points.length-1)];
   const open=start+(end-start)*(within/5),close=start+(end-start)*((within+1)/5);
   return {openTime:at,open,close,high:k<0?81:Math.max(open,close),low:k<0?79:Math.min(open,close),volume:1,quoteVolume:100,takerBuyVolume:.5,takerBuyQuoteVolume:50};
 };
 const load:FishReconstructionLoader=async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>{
   const at=from+i*p.step,a=Array.from({length:p.step/M},(_,j)=>minute(at+j*M));
   return {...a[0],close:a.at(-1)!.close,high:Math.max(...a.map(b=>b.high)),low:Math.min(...a.map(b=>b.low)),volume:a.length,quoteVolume:100*a.length,takerBuyVolume:.5*a.length,takerBuyQuoteVolume:50*a.length};
 });
 const run=(g:QualityGroup,end:number,previous?:Awaited<ReturnType<typeof evaluateQualitySample>>)=>evaluateQualitySample(sample,g,0,end,load,new AbortController().signal,previous);
 const baseline=await run(group(false),T+23*M),blocked=await run(group(true),T+23*M);
 expect(baseline.status).toBe('open');expect(baseline.additionFills?.length).toBeGreaterThan(0);
 expect(blocked.status).toBe('open');expect(blocked.additionFills??[]).toEqual([]);
 expect(blocked.additionVetoes?.some(v=>v.kind==='double-drop')).toBe(true);
 const resumed=await run(group(true),T+23*M,await run(group(true),T+20*M));
 expect(resumed.additionFills??[]).toEqual([]);expect(resumed.additionVetoes).toEqual(blocked.additionVetoes);
});
it('matches the screenshot candle on public prices and rejects the selected later prefix without reading future candles',()=>{
 const bars=SAPIEN_5M.map(([openTime,open,high,low,close])=>({openTime,open,high,low,close}));
 const caption=Date.UTC(2025,8,6,12,15);
 expect(bars.find(b=>b.openTime===caption)).toMatchObject({open:.19164,high:.1918,low:.18884,close:.18934});
 const prefix=bars.filter(b=>b.openTime+STEP<=caption+STEP),atr=chartAtr(prefix);
 const result=doubleDropState(prefix,atr,prefix[0].openTime,{pct:4});
 expect(result).toMatchObject({count:2,lockedPeak:.1961});
 expect(result.secondAt).toBeLessThanOrEqual(caption);
 const both=doubleDropState(prefix,atr,prefix[0].openTime,{pct:4,atr:2.5});
 expect(both).toMatchObject({count:2,lockedPeak:.1961});
 expect(evaluateAdditionVetoes([{kind:'double-drop',enabled:true,pct:4}],prefix,atr,prefix[0].openTime)).toMatchObject({kind:'double-drop'});
});
