import {beforeEach,it,expect} from 'vitest';
import {PRS6H_DEF,ATI6H_DEF,compileFeatureFormula,evaluateOnBars,definitionKey,mergeFeatureDefs,featureWindowMs,formulaVariables} from '../features';
import {computeEventSeries,seriesOffsets,seriesRangeOf} from '../series';
import {collectDeepDigRun} from '../analysis';
import {deepDigCsv} from '../export';
import {clearMarketDataCache} from '@/lib/deepRsa/marketData';
import {clearAti6hMarketCache} from '@/lib/ati6hMarketData';
import {Prs6hEngine,PRS6H_ID,computePrs6h} from '@/lib/prs6h';
import {savePrsCheckpoint,loadPrsCheckpoint,resumePrs6h} from '@/lib/prs6hPersistence';
import {evaluatePrs6h} from '@/lib/prs6hEvaluation';
import {prsPositive,prsBar,STEP} from './fixtures/prsBars';
import {compileFishProgram,evaluateFishProgram} from '@/lib/fish/algorithm';
import {qualityDefinition} from '@/lib/fish/quality';
import {findQualityAdditionTrigger} from '@/lib/fish/qualityAdditionScan';
import type {CampaignGroupReport} from '@/lib/deepRsa/report';
import type {TradeSignal} from '@/lib/signalLibrary';
beforeEach(()=>{localStorage.clear();clearMarketDataCache();clearAti6hMarketCache();});
it('is independently registered, configured and versioned, while its full causal series matches the core',()=>{
 const {bars,rows}=prsPositive(),compiled=compileFeatureFormula(PRS6H_DEF.formula),out=evaluateOnBars(bars,compiled,{...PRS6H_DEF,PRS6H_symbol:'TESTUSDT'});
 expect(mergeFeatureDefs([]).some(d=>d.id===PRS6H_ID)).toBe(true);expect(compiled.usesPrs6h).toBe(true);expect(out.PRS6H_details).toEqual(rows);
 expect(featureWindowMs(PRS6H_DEF)).toBe(24*3600000);expect(definitionKey({...PRS6H_DEF,PRS6H_config:{scoreThreshold:71}})).not.toBe(definitionKey(PRS6H_DEF));
 const names=formulaVariables(PRS6H_DEF.formula).names,offsets=seriesOffsets(seriesRangeOf(PRS6H_DEF));const series=computeEventSeries(bars,rows.at(-1)!.PRS6H_at,compiled,{...PRS6H_DEF,PRS6H_symbol:'TESTUSDT'} as typeof PRS6H_DEF,names,offsets);
 expect(series).toBeInstanceOf(Float64Array);expect(out.vars.get('PRS6H')).toEqual(Float64Array.from(rows,r=>r.PRS6H??NaN));
 expect(definitionKey(ATI6H_DEF)).not.toBe(definitionKey(PRS6H_DEF));
});
it('persists and resumes closed state, rejects a future checkpoint for past replay, and retries cannot duplicate the event',async()=>{
 const {bars,rows}=prsPositive(),cut=bars.length-2,options={symbol:'PERSIST-PRSUSDT'},first=computePrs6h(bars.slice(0,cut),options);
 await savePrsCheckpoint(first.checkpoint);expect(await loadPrsCheckpoint(first.checkpoint,bars[0].openTime)).toBeNull();
 const out=await resumePrs6h(bars.slice(cut),options);expect(out.restored).toBe(true);expect(out.rows).toEqual(computePrs6h(bars,options).rows.slice(cut));
 const retry=await resumePrs6h([bars.at(-1)!],{...options,checkpoint:out.checkpoint});expect(retry.rows).toEqual([]);
 expect(await loadPrsCheckpoint({...out.checkpoint,symbol:'OTHER'})).toBeNull();
});
it('existing fish snapshots and condition-add replay consume actual readiness and retain the frozen evidence',async()=>{
 const {bars,rows}=prsPositive(),def={...PRS6H_DEF,PRS6H_config:{scoreThreshold:70}},plan=compileFishProgram(def,{statistic:'结果',direction:'>',threshold:69.99,constraints:[]}),values=evaluateFishProgram(bars,plan);
 expect(plan.compiled.usesPrs6h).toBe(true);expect(values.condition.at(-1)).toBe(1);expect(values.PRS6H_details!.at(-1)!.PRS6H_event).not.toBeNull();
 const frozen=qualityDefinition({featureId:def.id,definitionKey:definitionKey(def),scale:1,unit:'分',average:84,cbi2:84,startAverage:84,previousAverage:0,cutoffMs:rows.at(-1)!.PRS6H_at,threshold:69.99});expect(frozen.PRS6H_config).toEqual(def.PRS6H_config);
 const event=rows.at(-1)!.PRS6H_event!,candidate={plan,scale:1,threshold:69.99,direction:'>' as const,metric:'结果',label:'PRS-6H'};
 const hit=await findQualityAdditionTrigger({candidates:[candidate],row:{} as TradeSignal,entry:bars.at(-4)!.openTime+STEP,end:event.signal_time+STEP,priceAt:new Map([[event.signal_time,113]]),load:async(_row,from,to)=>{const byTime=new Map(bars.map(b=>[b.openTime,b]));return Array.from({length:(to-from)/STEP},(_,i)=>byTime.get(from+i*STEP)??{...prsBar(0,95),openTime:from+i*STEP});},signal:new AbortController().signal});
 expect(hit?.prsEvidence?.PRS6H_event?.event_id).toBeDefined();expect(hit?.at).toBe(event.signal_time);
});
it('post-event labels never enter market scores and incomplete horizons stay null',()=>{
 const {bars,rows}=prsPositive(),last=bars.at(-1)!,future=Array.from({length:12},(_,i)=>({...prsBar(bars.length+i,last.close+.01*(i+1)),low:last.close-.01}));
 const out=evaluatePrs6h(rows,[...bars,...future]);expect(out.event_count).toBe(1);expect(out.labels[0]['60m']).not.toBeNull();expect(evaluatePrs6h(rows,bars).labels[0]['15m']).toBeNull();
 expect(computePrs6h([...bars,...future],{symbol:'TESTUSDT'}).rows.slice(0,bars.length)).toEqual(rows);
});
it('production research collects tick metadata, complete six-hour explanations, CSV state and future-only outcome labels',async()=>{
 const positive=prsPositive(),anchor=positive.rows.at(-1)!.PRS6H_at,bars=[...positive.bars,...Array.from({length:288},(_,i)=>prsBar(positive.bars.length+i,positive.bars.at(-1)!.close+.01*(i+1)))];
 // Prefix only supplies the common research pipeline's unchanged 48h coverage; PRS starts from its own explicit 24h request.
 const first=positive.bars[0].openTime;for(let i=1;i<=600;i++)bars.unshift({...prsBar(0,95),openTime:first-i*STEP});
 const fetchFn=async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith('exchangeInfo'))return{ok:true,status:200,json:async()=>({symbols:[{symbol:'PRSINTEGRATIONUSDT',filters:[{filterType:'PRICE_FILTER',tickSize:'0.01'}]}]})};const a=+u.searchParams.get('startTime')!,z=+u.searchParams.get('endTime')!,limit=+u.searchParams.get('limit')!;return{ok:true,status:200,json:async()=>bars.filter(b=>b.openTime>=a&&b.openTime<=z).slice(0,limit).map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume,b.openTime+STEP-1,b.quoteVolume,1,.6,b.takerBuyQuoteVolume,0])};};
 const def={...PRS6H_DEF,source:'signals' as const,positive:'s >= 3',control:'s < 3'},run=await collectDeepDigRun({rows:[]} as unknown as CampaignGroupReport,def,{signals:[{id:'prs-integration',symbol:'PRSINTEGRATIONUSDT',timeMs:anchor,quality:5} as TradeSignal],fetchFn,backgroundCap:0}),row=run.data.rows[0];
 expect(row?.PRS6H_details).toBeDefined();expect(row.PRS6H_details?.PRS6H_debug.tick).toBe(.01);expect(row.PRS6H_checkpoint?.feature_id).toBe(PRS6H_ID);expect(run.series.PRS6H_windows?.[row.id].rows).toHaveLength(72);
 expect(deepDigCsv(run.data)).toContain('PRS6H_state');expect(deepDigCsv(run.data)).toContain('PRS6H_checkpoint');expect(run.data.PRS6H_evaluation?.[0].bars).toBeGreaterThan(72);
},30000);

it('shared native amount metadata cannot change old formula inputs and flow never clamps invalid raw buy amounts',()=>{
 const {bars}=prsPositive(),shared=bars.map(b=>({...b,ATI6H_quoteVolume:b.quoteVolume,ATI6H_takerBuyQuoteVolume:b.quoteVolume!+1}));
 const old=compileFeatureFormula('X=B/Q');expect(evaluateOnBars(shared,old).vars.get('X')).toEqual(evaluateOnBars(bars,old).vars.get('X'));
 const native=evaluateOnBars(shared,compileFeatureFormula(PRS6H_DEF.formula),{...PRS6H_DEF,PRS6H_config:{volumeMode:'flow'}});expect(native.PRS6H_details!.at(-1)!.PRS6H_V).toBeNull();
});
