import {expect,it} from 'vitest';
import {newQualityStudy,importQualityLibrary} from '../quality';
import {rateQualitySource,preserveQualitySourceRatings,setMatchingSourceQuality} from '../qualitySourceRatings';
import {signalDedupKey,type TradeSignal} from '../../signalLibrary';
const source:TradeSignal={id:'source',symbol:'BTCUSDT',timeMs:1000,timeLabel:'',fallbackZone:'',quality:2};
it('persists a signal annotation across stale imports and removal, independently of original formula/plan/archive evidence',()=>{
 const initial=importQualityLibrary(newQualityStudy(),[source,{...source,id:'another-time',timeMs:2000},{...source,id:'another-venue',exchange:'okx'}]);
 const original=JSON.stringify(initial),rated=rateQualitySource(initial,source,4,10);
 expect(rated.samples.map(s=>s.source.quality)).toEqual([4,2,2]);expect(JSON.stringify(initial)).toBe(original);expect(rated.groups).toBe(initial.groups);expect(rated.results).toBe(initial.results);
 const stale=importQualityLibrary(rated,[source]),merged=preserveQualitySourceRatings(rated,stale);expect(merged.samples[0].source.quality).toBe(4);
 const cleared=rateQualitySource(merged,source,undefined,10);expect(cleared.sourceRatings![signalDedupKey(source)]).toEqual({quality:null,updatedAt:11});
 expect(preserveQualitySourceRatings(cleared,rated).samples[0].source.quality).toBeUndefined();expect(preserveQualitySourceRatings(cleared,initial).samples[0].source.quality).toBeUndefined();
});
it('updates every live occurrence of the same signal and preserves different dates/venues and immutable input objects',()=>{
 const list=[source,{...source,id:'same-signal-other-capture'},{...source,id:'different-time',timeMs:2000}];
 const next=setMatchingSourceQuality(list,source,5);expect(next.map(s=>s.quality)).toEqual([5,5,2]);expect(list.every(s=>s.quality===2)).toBe(true);
 expect(setMatchingSourceQuality(next,source,5)).toBe(next);expect(setMatchingSourceQuality(next,source,undefined).slice(0,2).every(s=>s.quality===undefined)).toBe(true);
});
