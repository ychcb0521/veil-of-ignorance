import {expect,it,vi} from 'vitest';
import {createEntryStallTurn5mReader,defaultEntryStallTurn5m,entryStallTurn5mMetrics,validateEntryStallTurn5m} from '../preEntryStallTurn5m';
import {createVersionedEntryStallTurnReader} from '../preEntryStallTurnRule';
import {createEntryStallTurnReader,defaultEntryStallTurn} from '../preEntryStallTurn';
import {freezeQualityPlan,planVersionChanges} from '../qualityPlanVersions';
import {qualityPlanFromTemplate} from '../qualityPlanTemplates';
import {emptyPreEntryThreeStage} from '../preEntryThreeStage';
import type {QualityGroup} from '../quality';
import type {ResearchBar} from '../../deepRsa/window';
import type {FishReconstructionLoader} from '../reconstruction';
const M=60000,F=5*M,T=Date.UTC(2026,10,9),row={id:'r',symbol:'TESTUSDT',timeMs:T,timeLabel:'',fallbackZone:''};
const config=()=>({...defaultEntryStallTurn5m(),pullback:undefined});
const candle=(at:number,open:number,close:number):ResearchBar=>({openTime:at,open,close,high:Math.max(open,close),low:Math.min(open,close),volume:1,takerBuyVolume:.5});
const sequence=[101,102,103,104,105,106,107,108,109,110,111,112,112,112,112,111,110];
function fixture(){
 const price=(i:number)=>i < -17?100:i<0?sequence[i+17]:i===0?111:112;
 const bar=(at:number)=>{const i=(at-T)/F;return candle(at,price(i-1),price(i));};
 const load=vi.fn<FishReconstructionLoader>(async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>bar(a+i*p.step)));
 return {load,bar};
}
it('uses 12 rising, 3 stalling and 2 weakening completed 5m candles with no overlap',()=>{
 const c=config(),bars=sequence.map((close,i)=>candle(T+i*F,i?sequence[i-1]:100,close)),value=entryStallTurn5mMetrics(bars,c)!;
 expect(value).toMatchObject({hit:true,support:112,recoveryPrice:112,progressPct:0});expect(value.risePct).toBeCloseTo(12);
 expect(entryStallTurn5mMetrics(bars.slice(1),c)).toBeUndefined();
 expect(entryStallTurn5mMetrics(bars.map(b=>({...b,open:100,high:100,low:100,close:100})),c)?.hit).toBe(false);
 expect(entryStallTurn5mMetrics(bars.map((b,i)=>i===13?{...b,low:109}:b),c)?.hit).toBe(false);
});
it('ignores unfinished 5m candles and 1m rebounds, then releases only after two rising 5m closes reclaim the frozen high',async()=>{
 const {load}=fixture(),read=createEntryStallTurn5mReader({condition:config(),row,load,signal:new AbortController().signal});
 for(let i=1;i<10;i++){
  const result=await read(T+i*M,candle(T+(i-1)*M,200,200));expect(result.blocked).toContain('滞涨转弱·5分钟');
  expect(result.readings!.every(r=>r.at===T+Math.floor(i/5)*F)).toBe(true);
 }
 expect((await read(T+10*M,candle(T+9*M,1,1))).blocked).toBeUndefined();
 expect(load.mock.calls.every(([,from,cut,p])=>p.step===F&&from%F===0&&cut%F===0)).toBe(true);
 expect(load.mock.calls.map(c=>c[2])).toEqual([T,T+F,T+2*F]);
});
it('does not trigger on an intrabar minute drop before the corresponding 5m candle closes',async()=>{
 const load=vi.fn<FishReconstructionLoader>(async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>candle(a+i*p.step,100,a+i*p.step===T?95:100)));
 const read=createEntryStallTurn5mReader({condition:{...defaultEntryStallTurn5m(),risePct:90},row,load,signal:new AbortController().signal});
 for(let i=1;i<5;i++)expect((await read(T+i*M,candle(T+(i-1)*M,100,90))).blocked).toBeUndefined();
 expect(load).toHaveBeenCalledOnce();expect((await read(T+F,candle(T+4*M,100,90))).blocked).toContain('猛烈回调未创新高·5分钟');
});
it('keeps a severe-pullback lock through window expiry, equal closes and wick breaks until a strictly higher 5m close',async()=>{
 const load:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>{
  const at=a+i*p.step,close=at<T-F?100:at<T+20*F?96:at===T+20*F?100:101;
  return {...candle(at,close,close),high:at===T-F?100:at===T+10*F?102:close};
 });
 const read=createEntryStallTurn5mReader({condition:{...defaultEntryStallTurn5m(),historyHours:1/12,risePct:90},row,load,signal:new AbortController().signal});
 for(let i=0;i<=21;i++)expect((await read(T+i*F,candle(T+i*F-M,200,200))).blocked).toContain('猛烈回调未创新高');
 expect((await read(T+22*F,candle(T+22*F-M,1,1))).blocked).toBeUndefined();
});
it('does not use highs outside the selected historical scope',async()=>{
 const load:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>({...candle(a+i*p.step,100,100),high:a+i*p.step<T-F?200:100}));
 const result=await createEntryStallTurn5mReader({condition:{...defaultEntryStallTurn5m(),historyHours:1/12,risePct:90},row,load,signal:new AbortController().signal})(T+M,candle(T,1,1));expect(result.blocked).toBeUndefined();
});
it('waits for full history, rejects missing closed bars and responds to cancellation',async()=>{
 const {load}=fixture(),options={condition:config(),row,load,signal:new AbortController().signal};
 expect((await createEntryStallTurn5mReader({...options,availableStart:T})(T+M,candle(T,100,100))).pending).toContain('历史');expect(load).not.toHaveBeenCalled();
 const broken:FishReconstructionLoader=async(...args)=>(await load(...args)).filter(b=>b.openTime!==T-F);
 await expect(createEntryStallTurn5mReader({...options,load:broken})(T+M,candle(T,100,100))).rejects.toThrow();
 const aborter=new AbortController();aborter.abort();await expect(createEntryStallTurn5mReader({...options,signal:aborter.signal})(T+M,candle(T,100,100))).rejects.toMatchObject({name:'AbortError'});
});
it.each([{riseMinutes:14},{riseMinutes:61},{stallMinutes:5},{stallMinutes:11},{turnMinutes:3},{turnMinutes:20},{historyHours:.1},{historyHours:NaN}])('rejects a partial candle or invalid window %j',patch=>{
 expect(()=>validateEntryStallTurn5m({...config(),...patch})).toThrow('参数无效');
});
it('retains the exact v1 manifest and executable route, and separately freezes every v2 time setting',async()=>{
 const old=freezeQualityPlan({id:'p',label:'原模板',snapshot:{},preEntryThreeStage:{...emptyPreEntryThreeStage(),stallTurn:defaultEntryStallTurn()}} as QualityGroup),before=JSON.stringify(old);
 expect(old.frozenVersions!.find(v=>v.key==='entry-stall-turn')!.version).toMatch(/^entry-stall-turn-v1 · 参数 #/);
 expect(planVersionChanges(old)).toEqual([]);expect(qualityPlanFromTemplate({id:'t',name:'原模板',plan:old,savedAt:1,updatedAt:1},'copy')).toEqual({...old,id:'copy'});
 const load:FishReconstructionLoader=async(_r,a,b,p)=>Array.from({length:(b-a)/p.step},(_,i)=>candle(a+i*p.step,100,100));
 const options={condition:defaultEntryStallTurn(),row,load,signal:new AbortController().signal};
 expect(await createVersionedEntryStallTurnReader(options)(T+M,candle(T,100,99))).toEqual(await createEntryStallTurnReader(options)(T+M,candle(T,100,99)));
 const next=freezeQualityPlan({...old,preEntryThreeStage:{...old.preEntryThreeStage!,stallTurn:config()}});
 expect(next.frozenVersions!.find(v=>v.key==='entry-stall-turn')!.version).toMatch(/^entry-stall-turn-5m-v2 · 参数 #/);expect(planVersionChanges(next)).toEqual([]);
 for(const key of ['riseMinutes','stallMinutes','turnMinutes'] as const){const changed=structuredClone(next);changed.preEntryThreeStage!.stallTurn![key]+=5;expect(planVersionChanges(changed).length).toBeGreaterThan(0);}
 expect(JSON.stringify(old)).toBe(before);
});
