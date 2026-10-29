import {expect,it} from 'vitest';
import {MBI_DEF,MBI2_DEF,compileFeatureFormula,evaluateOnBars,featureWindowMs,definitionKey,mergeFeatureDefs} from '../features';
import {mbi2NOf,mbi2HoursOf,MBI2_KEYS} from '@/lib/mbi2';
import {mbiBars} from './fixtures/mbiBars';
import {researchChartSeries,CUSTOM_RESEARCH_INDICATORS,syncMbi2ChartHours} from '@/lib/researchIndicators';
import {recommendMbi2,scanMbi2,finishMbi2Evaluation,mbi2EvaluationCsv} from '../mbi2Evaluation';
import {snapshotOf,collectDeepDigRun} from '../analysis';
import {makeData} from './fixtures';
import {deepDigCsv} from '../export';
import {qualityFilterChoices,makeQualityBuyFilter} from '@/lib/fish/qualityFilters';
import {qualityDefinition} from '@/lib/fish/quality';
import type {CampaignGroupReport} from '@/lib/deepRsa/report';
import type {TradeSignal} from '@/lib/signalLibrary';
it('B/G: independent full-precision values, averages, settings, snapshots and ordered exports',()=>{
 const bars=mbiBars(1800),old=evaluateOnBars(bars,compileFeatureFormula(MBI_DEF.formula),MBI_DEF);
 const run=(d:typeof MBI2_DEF)=>evaluateOnBars(bars,compileFeatureFormula(d.formula),d);
 const copy=run(MBI2_DEF);for(const [a,b] of [['MBI','MBI2'],['avg_MBI_2','avg_MBI2_2']])expect(copy.vars.get(b)).toEqual(old.vars.get(a));
 expect(featureWindowMs(MBI2_DEF)/300000).toBe(701);expect(featureWindowMs({...MBI2_DEF,MBI2_T_HOURS:12})/300000).toBe(1296);
 expect(definitionKey({...MBI2_DEF,MBI2_T_HOURS:12})).not.toBe(definitionKey(MBI2_DEF));
 expect(run({...MBI2_DEF,MBI2_T_HOURS:12}).vars.get('MBI2')).not.toEqual(copy.vars.get('MBI2'));
 expect(evaluateOnBars(bars,compileFeatureFormula(MBI_DEF.formula),MBI_DEF).vars).toEqual(old.vars);
 expect(mergeFeatureDefs([]).filter(d=>d.id==='mbi2')).toHaveLength(1);
 const choices=qualityFilterChoices([MBI_DEF,MBI2_DEF]);for(const name of MBI2_KEYS)expect(choices.some(c=>c.key==='mbi2:'+name)).toBe(true);
 const filter=makeQualityBuyFilter('mbi2:MBI2_state','>',0,true,[{...MBI2_DEF,MBI2_T_HOURS:12}]);expect(qualityDefinition(filter.snapshot)).toMatchObject({MBI2_T_HOURS:12,MBI2_BAND:.2,MBI2_CONFIRM:.8});
 const data=makeData();data.definition=snapshotOf(MBI2_DEF);data.rows=[{...data.rows[1],v:.5,vars:{MBI2:.5,avg_MBI2_2:.3,MBI2_state:2,MBI2_lead_h:3,MBI2_confirm_h:1}}];
 expect(deepDigCsv(data).split('\r\n')[0]).toContain(MBI2_KEYS.join(','));
});
it('native raw and averages match at each timeframe; custom hours and forming candles stay isolated',()=>{
 const item=CUSTOM_RESEARCH_INDICATORS.find(d=>d.id==='MBI2')!;
 for(const [minutes,interval] of [[5,'5m'],[15,'15m'],[60,'1h']] as const){
  const bars=mbiBars(1800,minutes*60000),data=bars.map(b=>({timestamp:b.openTime,open:b.open,high:b.high,low:b.low,close:b.close}));
  const out=researchChartSeries(data,item,mbi2HoursOf({},minutes),{fetchReference:false});
  const expected=evaluateOnBars(bars,compileFeatureFormula(MBI_DEF.formula),{...MBI_DEF,interval});
  const asArray=(name:string)=>Array.from(expected.vars.get(name) as Float64Array,v=>Number.isFinite(v)?v:null);
  expect(out.core).toEqual(asArray('MBI'));expect(out.avg2).toEqual(asArray('avg_MBI_2'));
  const live=data.map((b,i)=>({...b,cba2Closed:i!==data.length-1}));expect(researchChartSeries(live,item,mbi2HoursOf({},minutes),{fetchReference:false}).core.at(-1)).toBeNull();
 }
 const initial=[{type:'MBI2',period:25*5/60,mbi2AutoHours:true},{type:'MBI',period:25}];
 expect(syncMbi2ChartHours(initial,[MBI2_DEF],15)[0].period).toBe(6.25);expect(syncMbi2ChartHours(initial,[MBI2_DEF],60)[1]).toBe(initial[1]);
 expect(syncMbi2ChartHours([{...initial[0],period:12,mbi2AutoHours:false}],[MBI2_DEF],60)[0].period).toBe(12);
});
it('E: n recommendation matches the published numerical example and excludes nonpositive drift',()=>{
 const out=recommendMbi2(100,106,288,.003,5);expect(out.delta).toBeCloseTo(.067441,6);expect(out.nMin).toBeCloseTo(207.82,1);expect(out.ceilN).toBe(208);expect(out.hours).toBeCloseTo(17.333333333333332,12);
 expect(recommendMbi2(106,100,288,.003).reason).toBe('nonpositive_delta');expect(recommendMbi2(106,100,288,.003,5,true).delta).toBeGreaterThan(0);
 console.info('MBI2 E recommendation',JSON.stringify(out));
});
it('report scans 6 calendar settings and 4 buffer settings using only their own prefixes, with unchanged defaults',()=>{
 const bars=mbiBars(4100),anchor=3900*300000;
 const samples=Array.from({length:12},(_,i)=>({id:'sample'+i,group:i<6?'positive' as const:'control' as const,anchorMs:anchor-i*300000,bars}));
 const def=snapshotOf(MBI2_DEF),before=JSON.stringify(MBI2_DEF),scan=scanMbi2(samples,def,5);
 expect(scan.map(r=>r.n)).toEqual([24,48,96,144,288,576,25,25,25,25]);expect(scan.map(r=>r.band)).toEqual([.2,.2,.2,.2,.2,.2,0,.1,.2,.3]);
 const limited=samples.map(s=>({...s,bars:s.bars.filter(b=>b.openTime+300000<=s.anchorMs)}));expect(scanMbi2(limited,def,5)).toEqual(scan);
 expect(JSON.stringify(MBI2_DEF)).toBe(before);expect(scan.every(r=>r.positiveN===6&&r.controlN===6)).toBe(true);
 const report=finishMbi2Evaluation(scan,[{campaignId:'a',delta:.1,nMin:1,ceilN:1,hours:1},{campaignId:'b',delta:.2,nMin:3,ceilN:3,hours:3}],def,5);
 expect([report.q25,report.q50,report.q75]).toEqual([1.5,2,2.5]);expect(mbi2EvaluationCsv(report)).toContain('balancedAccuracy');
 console.info('MBI2 scan test',JSON.stringify(scan.map(r=>({kind:r.kind,n:r.n,missing:r.missing,positiveN:r.positiveN,controlN:r.controlN}))));
});
it('production collection keeps default raw equality and attaches independent scan metadata without future leakage',async()=>{
 const bars=mbiBars(9000),anchor=6000*300000;
 const fetchFn=async(url:string)=>{const u=new URL(url),a=+u.searchParams.get('startTime')!,z=+u.searchParams.get('endTime')!,limit=+u.searchParams.get('limit')!;return{ok:true,status:200,json:async()=>bars.filter(b=>b.openTime>=a&&b.openTime<=z).slice(0,limit).map(b=>[b.openTime,b.open,b.high,b.low,b.close,b.volume,b.openTime+299999,b.quoteVolume,1,0,b.takerBuyQuoteVolume,0])};};
 const def={...MBI2_DEF,source:'signals' as const,positive:'s >= 3',control:'s < 3'};
 const run=await collectDeepDigRun({rows:[]} as unknown as CampaignGroupReport,def,{signals:[{id:'mbi2-integration',symbol:'MBI2INTEGRATIONUSDT',timeMs:anchor,quality:5} as TradeSignal],fetchFn,backgroundCap:0});
 const own=bars.filter(b=>b.openTime>=anchor-featureWindowMs(MBI_DEF)&&b.openTime+300000<=anchor),old=evaluateOnBars(own,compileFeatureFormula(MBI_DEF.formula),MBI_DEF);
 expect(run.data.rows[0].vars!.MBI2).toBe((old.vars.get('MBI') as Float64Array).at(-1));expect(run.series.offsets.at(-1)).toBe(0);expect(run.data.mbi2Evaluation!.scan).toHaveLength(10);
},20000);
