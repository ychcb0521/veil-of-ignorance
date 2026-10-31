import {afterEach,expect,it,vi} from 'vitest';
import {computeDbl5} from '../dbl5m';
import {saveDbl5Checkpoint,loadDbl5Checkpoint,resumeDbl5,dbl5CheckpointKey} from '../dbl5mPersistence';
import {sample,T} from './fixtures/dblBars';
import {Dbl5ChartTimeline} from '../dbl5ChartTimeline';
import {dbl5StepPath,registerDbl5Indicator} from '../dbl5mChart';
import {accountResearchIndicators} from '../researchIndicators';
const registered=vi.hoisted(()=>new Map<string,any>());vi.mock('klinecharts',()=>({registerIndicator:(v:any)=>registered.set(v.name,v)}));
afterEach(()=>vi.unstubAllGlobals());
it('persists a full memory checkpoint, never claims disk success and isolates every identity dependency',async()=>{
 vi.stubGlobal('indexedDB',undefined);const opts={symbol:'PERSISTDBL',tickSize:1,initializationId:'origin-a',initializationStart:T},cp=computeDbl5(sample().slice(0,11),opts).checkpoint;
 expect(await saveDbl5Checkpoint(cp)).toBe(false);expect(await saveDbl5Checkpoint(cp)).toBe(false);expect(await loadDbl5Checkpoint(cp)).toEqual(cp);expect(await loadDbl5Checkpoint(cp,cp.last_time-1)).toBeNull();
 for(const changed of [{symbol:'OTHER'},{market:'spot'},{data_source:'other'},{data_version:'corrected'},{tick_size:'.1'},{initialization_id:'b'},{initialization_start:T-300000},{config_hash:'new-config'}]){const other={...cp,...changed};expect(dbl5CheckpointKey(other)).not.toBe(dbl5CheckpointKey(cp));expect(await loadDbl5Checkpoint(other)).toBeNull();}
 const resumed=await resumeDbl5(sample().slice(11),opts);expect(resumed.restored).toBe(true);expect(resumed.rows).toEqual(computeDbl5(sample(),opts).rows.slice(11));expect(resumed.warning).toBeTruthy();
 const modified={...cp,data_checksum:'conflicting-input'};expect(await saveDbl5Checkpoint(modified)).toBe(false);expect((await loadDbl5Checkpoint(cp)).last_time).toBe(resumed.checkpoint.last_time);
 await expect(resumeDbl5(sample(),{symbol:'NOINIT'})).rejects.toThrow('初始化标识');
});
it('keeps viewport prepends and future appends on one initialization, closed revisions get a new data version',()=>{
 const timeline=new Dbl5ChartTimeline(),data=sample().map(b=>({...b,time:b.openTime})),a=timeline.update(data,'DBLUSDT:5m'),prepend=[{...data[0],time:T-300000},...data];expect(timeline.update(prepend,'DBLUSDT:5m')).toEqual(a);
 expect(timeline.update([...prepend,{...data.at(-1),time:T+18*300000}],'DBLUSDT:5m')).toEqual(a);
 const revised=prepend.map(b=>b.time===T+7*300000?{...b,close:b.close-1}:b),r=timeline.update(revised,'DBLUSDT:5m');expect(r.initializationStart).toBe(a.initializationStart);expect(r.revision).toBe(1);expect(timeline.update(revised,'DBLUSDT:5m')).toEqual(r);expect(timeline.update(data,'OTHER:5m').revision).toBe(0);
});
it('draws at close instead of source open, uses backward crosshair lookup and breaks null/episode lines',()=>{
 expect(dbl5StepPath([{x:0,y:100,episode:'a'},{x:1,y:102,episode:'a'},{x:2,y:null,episode:null},{x:3,y:99,episode:'b'},{x:4,y:98,episode:'c'}])).toBe('M0,100 H1 V102 M3,99 M4,98');
 registerDbl5Indicator(accountResearchIndicators().find(i=>i.id==='DBL5'));const template=registered.get('DBL5_CUSTOM'),result=[{value:100,DBL5_upper:104,_DBL5_episode:1,_DBL5_box:1,_DBL5_baseline:1},{value:102,DBL5_upper:106,_DBL5_episode:1,_DBL5_box:2,_DBL5_up_step:1},{}];
 const pixels:number[]=[],ctx={save:vi.fn(),setLineDash:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn()};template.draw({ctx,indicator:{result},visibleRange:{from:0,to:3},xAxis:{convertToPixel:(i:number)=>{pixels.push(i);return i;}},yAxis:{convertToPixel:(i:number)=>i}});expect(Math.min(...pixels)).toBe(1);
 const atOpen=template.createTooltipDataSource({indicator:{result},crosshair:{dataIndex:1},defaultStyles:{tooltip:{icons:[]}}});expect(atOpen.values[0].value).toBe('100');expect(atOpen.calcParamsText).toContain('基准箱');
});
