import {beforeEach,expect,it,vi} from 'vitest';
import {FishScanner,combineFishRound,deriveFishRound,type FishCombinationRound} from '@/lib/fishScanner';
import {CBI2_DEF} from '@/lib/deepDig/features';
import {compileFishProgram} from '@/lib/fish/algorithm';
import {fishProgramForLookback,readFishLookback,saveFishLookback,fishLookbackKey} from '@/lib/fish/lookback';
import {buildFishScanSettings} from '@/lib/fish/scanPlan';
import type {FishDataAdapter} from '@/lib/fish/adapters';
const T=Date.UTC(2026,9,28),H=3600000,step=300000;
const feature={...CBI2_DEF,id:'test-close',formula:'X = C\nX',scale:1,unit:'',interval:'5m' as const};
const algorithm={statistic:'结果',direction:'>' as const,threshold:1,constraints:[]};
const coins=['RECENT','BOUNDARY','OLD','STALE','ENDED'].map(symbol=>({symbol:symbol+'USDT',instrument:symbol,base:symbol,multiplier:1}));
const adapter:FishDataAdapter={exchange:'binance',list:async()=>coins,btc:()=>coins[0],taker:async(_m,b)=>b,candles:async(m,cut,_s,q)=>Array.from({length:q.count},(_,i)=>{
 const at=cut-(q.count-i)*step,age={RECENT:.5,BOUNDARY:1,OLD:2,STALE:30,ENDED:.5}[m.instrument]!,start=T-age*H;
 const close=at+step>=start?at+step>=T-.25*H?3:2:0.5;
 return {openTime:at,open:close,high:close,low:close,close:m.instrument==='ENDED'&&at+step===cut?.5:close,volume:100,quoteVolume:1e9,takerBuyVolume:50,takerBuyQuoteVolume:5e8};
})};
const makeScanner=()=>new FishScanner(vi.fn(async()=>new Response(JSON.stringify({serverTime:T+1}))) as typeof fetch,undefined,undefined,{binance:adapter});
async function scan(hours:number|undefined,multi=false,threshold=1){
 const hits:any[]=[];let round:FishCombinationRound|undefined;
 const p=await makeScanner().scan({feature,algorithm:{...algorithm,threshold},...(multi?{algorithms:[{feature,algorithm},{feature:{...feature,id:'second'},algorithm}],combination:'and' as const}:{}),anchorMs:T,lookbackHours:hours,includeDuplicates:true,signal:new AbortController().signal,onProgress:()=>{},onSignal:s=>hits.push(s),onRound:r=>{round=r;}});
 return {hits,p,round:round!};
}
beforeEach(()=>localStorage.clear());
it('defaults to one hour, persists custom numeric hours per account, and rejects invalid input',()=>{
 expect(readFishLookback()).toBe(1);saveFishLookback('10');expect(readFishLookback()).toBe(10);
 for(const value of ['',0,-1,NaN,Infinity,8785])expect(()=>saveFishLookback(value)).toThrow('扫描覆盖时间');
 expect(readFishLookback()).toBe(10);const key=fishLookbackKey();localStorage.setItem('sb-test-auth-token',JSON.stringify({user:{id:'second'}}));expect(fishLookbackKey()).not.toBe(key);expect(readFishLookback()).toBe(1);
});
it('limits real scan results by exact signal start, includes the lower boundary and excludes already ended signals',async()=>{
 const one=await scan(1);expect(one.p.status).toBe('complete');expect(one.hits.map(s=>s.symbol)).toEqual(['RECENTUSDT','BOUNDARYUSDT']);expect(one.p.counts.outside).toBe(2);
 const ten=await scan(10);expect(ten.hits.map(s=>s.symbol)).toEqual(['RECENTUSDT','BOUNDARYUSDT','OLDUSDT']);
 const legacy=await scan(undefined);expect(legacy.hits).toHaveLength(4);
 expect(one.hits.every(s=>s.fish.lookbackHours===1&&s.fish.lookbackAnchorMs===T)).toBe(true);
});
it('preserves the window through intersection, changing combination and threshold refinement',async()=>{
 const multi=await scan(1,true);expect(multi.hits.map(s=>s.symbol)).toEqual(['RECENTUSDT','BOUNDARYUSDT']);expect(multi.round.lookbackHours).toBe(1);
 expect(combineFishRound(multi.round,'or').signals.map(s=>s.symbol)).toEqual(['RECENTUSDT','BOUNDARYUSDT']);
 const single=await scan(1),tight=compileFishProgram(feature,{...algorithm,threshold:2.5});
 const derived=deriveFishRound(single.round,[tight])!;
 const fresh=await scan(1,false,2.5);
 expect(combineFishRound(derived,'and').signals.map(s=>[s.symbol,s.timeMs])).toEqual(fresh.hits.map(s=>[s.symbol,s.timeMs]));
 expect(fresh.hits).toHaveLength(4); // Old episodes can acquire a genuinely recent start at a stricter threshold.
});
it('expands history for longer coverage and validates capacity without shortening formula warm-up',()=>{
 const base=compileFishProgram(feature,algorithm),short=fishProgramForLookback(base,1),long=fishProgramForLookback(base,72,[{hours:24,min:1}]);
 expect(short.N).toBe(base.N);expect(short.warm).toBe(base.warm);expect(long.N).toBeGreaterThan(base.N);expect(long.N).toBeGreaterThanOrEqual(Math.ceil(96*H/step)+1);
 expect(fishProgramForLookback(base,8784).unavailable).toContain('12000');
});
it('uses saved capture hours in the shared builder, while mining can explicitly preserve its own unbounded anchor logic',()=>{
 saveFishLookback(2);const cards=[{id:'first',featureId:feature.id,enabled:true,pref:{...algorithm,threshold:'1'}}];
 const input={cards,defs:[feature],combination:'and' as const,selection:{exchanges:['binance' as const],includeDuplicates:false},time:''};
 expect(buildFishScanSettings(input).settings?.lookbackHours).toBe(2);expect(buildFishScanSettings({...input,lookbackHours:null}).settings?.lookbackHours).toBeUndefined();
 expect(buildFishScanSettings({...input,lookbackHours:8784}).error).toContain('12000');
});
it('diagnoses out-of-window signals using the same gate as a scan',async()=>{
 const result=await makeScanner().diagnose({symbol:'OLDUSDT',feature,algorithm,anchorMs:T,lookbackHours:1,signal:new AbortController().signal});expect(result.outcome).toBe('outside');expect(result.lines.join(' ')).toContain('不在过去 1 小时内');
});

it('upgrades only the previous 12h default once and preserves other custom choices and later explicit 12h edits',()=>{
 localStorage.setItem(fishLookbackKey(),'12');expect(readFishLookback()).toBe(1);
 saveFishLookback(12);expect(readFishLookback()).toBe(12);
 localStorage.clear();localStorage.setItem(fishLookbackKey(),'10');expect(readFishLookback()).toBe(10);
 localStorage.clear();saveFishLookback(12);expect(readFishLookback()).toBe(12);
});
