import {expect,it} from 'vitest';
import {definitionKey} from '@/lib/deepDig/features';
import {FOCUS_SIGNAL_SEEDS,focusDetector,focusSignalKey,qualityFocusSignals} from '@/lib/fish/qualityFocusSignals';
import {newQualityStudy,type QualityGroup} from '@/lib/fish/quality';
import type {QualityMonitorRecord,QualityMonitorSetting} from '@/lib/fish/qualityMonitorLibrary';
import type {FishSnapshot} from '@/lib/fish/algorithm';
const T=Date.parse('2026-10-27T21:00:00+08:00');
function group(id:'cbi2'|'cba',statistic=id==='cbi2'?'avg_CBI2_2':'avg_CBA_2'):QualityGroup {
 const name=id==='cbi2'?'CBI2':'CBA';
 return {id,metric:statistic,label:id,snapshot:{featureId:id,statistic,definitionKey:definitionKey({formula:`${name} = C\navg_${name} = avg(${name}, 24)\navg_${name}_2 = avg(${name}, 12)`,positive:'1',control:'0'}),interval:'5m',scale:1,threshold:id==='cbi2'?.04:8,direction:'>',cutoffMs:T,average:1,cbi2:1,startAverage:1,previousAverage:0}};
}
const source=(symbol='NEWUSDT',timeMs=T,exchange:'binance'|'okx'='binance')=>({id:`${symbol}-${timeMs}-${exchange}`,symbol,timeMs,timeLabel:'',fallbackZone:'',exchange});
function setting(id:string,detectors:QualityGroup[]):QualityMonitorSetting {return {id,signature:id,plan:group('cba'),detectors,entryMode:'capture',observeHours:0,filtersKnown:true,detectorsKnown:true,notional:100,leverage:1};}
function record(id:string,settingId:string,signal=source()):QualityMonitorRecord{return {id,settingId,source:signal,enteredAt:signal.timeMs,basis:'capture',filterStatus:{state:'none',detail:''},readings:[],firstSavedAt:T,updatedAt:T};}
function study(records:QualityMonitorRecord[],settings:QualityMonitorSetting[]){return {...newQualityStudy(T),monitorLibrary:{version:1 as const,importedLegacy:true,records,settings,rounds:[]}};}
it('pins all 12 screenshot events, with both GALA events and explicit UTC+8 times, as references only',()=>{
 const entries=qualityFocusSignals(newQualityStudy(T));
 expect(entries).toHaveLength(12);expect(new Set(entries.map(e=>e.key)).size).toBe(12);
 expect(new Set(entries.map(e=>e.source.symbol)).size).toBe(11);expect(entries.filter(e=>e.source.symbol==='GALAUSDT')).toHaveLength(2);
 expect(FOCUS_SIGNAL_SEEDS[0].timeMs).toBe(Date.parse('2026-04-05T20:40:00+08:00'));
 expect(entries.every(e=>e.specified&&!e.resonance&&!e.found&&!e.recordIds.length)).toBe(true);
});
it('backfills every existing resonant event across saved detector settings, including events absent from the screenshot, without changing results',()=>{
 const a=setting('a',[group('cbi2')]),b=setting('b',[group('cba')]);
 const s=study([record('1','a'),record('2','b'),record('3','a')],[a,b]),before=JSON.stringify(s);
 const event=qualityFocusSignals(s).find(e=>e.source.symbol==='NEWUSDT')!;
 expect(event.resonance).toBe(true);expect(event.specified).toBe(false);expect(event.recordIds).toEqual(['1','2','3']);expect(JSON.stringify(s)).toBe(before);
});
it('finds already-caught resonance before monitoring, and then picks up new saved results automatically',()=>{
 const a=group('cbi2'),b=group('cba'),signal=source();
 const s=study([],[]);s.groups=[a,b];s.samples=[{id:'sample',source:signal,groups:[a.id,b.id],enteredAt:T,basis:'capture',importedAt:T}];
 const event=qualityFocusSignals(s).find(e=>e.source.symbol==='NEWUSDT')!;expect(event.resonance).toBe(true);expect(event.recordIds).toEqual([]);
 s.monitorLibrary.settings=[setting('saved',[a,b])];s.monitorLibrary.records=[record('now','saved')];
 expect(qualityFocusSignals(s).find(e=>e.source.symbol==='NEWUSDT')?.recordIds).toEqual(['now']);
});
it.each(['time','exchange','market'] as const)('does not create resonance across different %s',difference=>{
 const other={...source(),...(difference==='time'?{timeMs:T+60_000}:difference==='exchange'?{exchange:'okx' as const}:{market:'us_stock' as const})};
 const s=study([record('1','a'),record('2','b',other)],[setting('a',[group('cbi2')]),setting('b',[group('cba')])]);
 expect(qualityFocusSignals(s).some(e=>!e.specified)).toBe(false);
});
it('resolves 结果 from the frozen formula but rejects avg, raw, external averages and misleading names',()=>{
 const a=group('cbi2').snapshot;expect(focusDetector({...a,statistic:'结果'})).toBe('avg_CBI2_2');
 expect(focusDetector({...a,statistic:'avg_CBI2'})).toBeUndefined();expect(focusDetector({...a,statistic:'CBI2'})).toBeUndefined();
 expect(focusDetector({...a,H:24})).toBeUndefined();expect(focusDetector({...a,featureId:'state'})).toBeUndefined();
 const bad={...a,definitionKey:JSON.stringify(['avg_CBI2_2 = C\navg_CBI2 = C','1','0']),statistic:'结果'} as FishSnapshot;
 expect(focusDetector(bad)).toBeUndefined();
});
it('uses actual union hits and ignores seller and buy-filter algorithms as resonance evidence',()=>{
 const a=group('cbi2'),b=group('cba'),s=study([record('1','a')],[{...setting('a',[a]),plan:b,detectorsKnown:true}]);
 s.samples=[{id:'union',source:{...source(),fish:{...a.snapshot,combination:'or',algorithms:[a.snapshot,b.snapshot],hitAlgorithms:[1]}},groups:[],enteredAt:T,basis:'capture',importedAt:T}];
 expect(qualityFocusSignals(s).some(e=>!e.specified)).toBe(false);
});
it('matches screenshot events to all actual monitoring variants while keeping a later same-symbol event separate',()=>{
 const saved=setting('a',[]),seed=FOCUS_SIGNAL_SEEDS[1];
 const s=study([record('seed','a',seed),record('later','a',{...seed,timeMs:seed.timeMs+60_000})],[saved]);
 const event=qualityFocusSignals(s).find(e=>e.key===focusSignalKey(seed))!;
 expect(event.found).toBe(true);expect(event.recordIds).toEqual(['seed']);expect(event.resonance).toBe(false);
});
