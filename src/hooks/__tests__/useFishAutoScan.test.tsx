// 【用户要求】2026-10-21「渔这里增设一个定时自动（&手动）捕捉的功能……只要电脑联着网，就进行自动捕捉。手动捕捉模式下，与现在的保持一致。」
import {act,renderHook,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {BSS_DEF,CDA_DEF,CBI2_DEF,DRIFT_SPEED_Z_DEF,STATE_DEF} from '@/lib/deepDig/features';
import {fishFeatureDefinitions} from '@/lib/fish/features';
const DEFS=fishFeatureDefinitions([CBI2_DEF,DRIFT_SPEED_Z_DEF,CDA_DEF,BSS_DEF,STATE_DEF]);
vi.mock('@/hooks/useFishFeatures',()=>({useFishFeatures:()=>DEFS}));
import {useFishAutoScan} from '@/hooks/useFishAutoScan';
import {readFishAuto,saveFishAuto,FISH_AUTO_INTERVALS,fishAutoKey} from '@/lib/fish/autoScan';
import {writePersistedStateRaw} from '@/lib/persistedStateStorage';
import {buildFishScanSettings} from '@/lib/fish/scanPlan';
import {readFishCards} from '@/lib/fish/cards';
import {FishPanel,FISH_DEFAULT_ALGORITHMS} from '@/components/FishPanel';
import {fishDelay} from '@/lib/fish/shared';
const HOUR=3_600_000,selection={exchanges:['binance' as const],includeDuplicates:false};
let online=true;
beforeEach(()=>{localStorage.clear();sessionStorage.clear();online=true;vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);vi.useFakeTimers({shouldAdvanceTime:false});vi.setSystemTime(Date.UTC(2026,9,21,0,0));});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
const hook=(start=vi.fn(async(_s:unknown)=>{}),busy=()=>false)=>({start,view:renderHook(()=>useFishAutoScan({account:'a',selection,start,busy}))});
const flush=async(ms=0)=>{await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});};
it('默认自动、每 1 小时：立即捕第一次，未到下一次时间不重复',async()=>{
 expect([...FISH_AUTO_INTERVALS]).toEqual([0.5,1,2,4,8,16,32,64]);
 const {start,view}=hook();await flush();
 expect(view.result.current.mode).toBe('auto');expect(view.result.current.hours).toBe(1);expect(start).toHaveBeenCalledTimes(1);
 await flush(HOUR-60_000);expect(start).toHaveBeenCalledTimes(1);
 await flush(90_000);expect(start).toHaveBeenCalledTimes(2);
});
it('手动选择仍然保存，刷新后手动模式不自动捕',async()=>{
 saveFishAuto({mode:'manual',hours:2,lastRunAt:null});
 const {start,view}=hook();await flush(10*HOUR);
 expect(view.result.current.mode).toBe('manual');expect(view.result.current.hours).toBe(2);expect(start).not.toHaveBeenCalled();
});
it('旧版手动设置升级到自动一次，保留间隔和上次时间；之后再选手动不会重置',()=>{
 const old={mode:'manual',hours:4,lastRunAt:Date.now()-HOUR};
 writePersistedStateRaw(fishAutoKey(),JSON.stringify(old));
 expect(readFishAuto()).toEqual({...old,mode:'auto'});
 saveFishAuto({...old,mode:'manual'});
 expect(readFishAuto()).toEqual(old);
});
it('切到自动立刻捕第一次（时间 = 现在，六条规则），之后每隔所选时长一次，没到点不捕',async()=>{
 saveFishAuto({mode:'manual',hours:1,lastRunAt:null});
 const {start,view}=hook();
 act(()=>{view.result.current.setHours(2);});act(()=>{view.result.current.setMode('auto');});await flush();
 expect(start).toHaveBeenCalledTimes(1);
 const s=start.mock.calls[0][0] as any;expect(s.anchorMs).toBeUndefined();expect(s.algorithms.map((a:any)=>a.feature.id)).toEqual(['cbi2','drift-speed-z','cda','bss','state','state']);expect(s.turnoverFloors).toHaveLength(3);expect(s.downwardWick).toEqual({enabled:true,hours:48,atrMultiple:3});
 expect(readFishAuto()).toMatchObject({mode:'auto',hours:2,lastRunAt:Date.now()});
 await flush(2*HOUR-60_000);expect(start).toHaveBeenCalledTimes(1);
 await flush(90_000);expect(start).toHaveBeenCalledTimes(2);
 expect(view.result.current.nextAt).toBe(readFishAuto().lastRunAt!+2*HOUR);
});
it('电脑睡眠 / 关着错过好几次：打开后只补一次；断网时等着，联网后马上捕；取数器忙时等它结束',async()=>{
 saveFishAuto({mode:'auto',hours:1,lastRunAt:Date.now()-5*HOUR});online=false;
 let busy=true;const {start,view}=hook(undefined,()=>busy);await flush(60_000);
 expect(start).not.toHaveBeenCalled();expect(view.result.current.online).toBe(false);
 online=true;await act(async()=>{window.dispatchEvent(new Event('online'));});await flush();
 expect(start).not.toHaveBeenCalled();expect(view.result.current.waiting).toBe(true);
 busy=false;await flush(30_000);expect(start).toHaveBeenCalledTimes(1);
 await flush(30*60_000);expect(start).toHaveBeenCalledTimes(1);
});
it('同一台电脑开了两个标签页只有一个去捕；自动模式下手动点开始，下次从手动那次往后数',async()=>{
 saveFishAuto({mode:'auto',hours:1,lastRunAt:null});
 let release!:()=>void;const slow=vi.fn(()=>new Promise<void>(r=>{release=r;}));
 const a=hook(slow),b=hook(slow);await flush();
 expect(slow).toHaveBeenCalledTimes(1);
 await act(async()=>{release();});await flush();
 act(()=>{vi.setSystemTime(Date.now()+30*60_000);a.view.result.current.noteManualRun();});
 await flush(45*60_000);expect(slow).toHaveBeenCalledTimes(1);
 await flush(20*60_000);expect(slow).toHaveBeenCalledTimes(2);
});
it('设置拼不出来时不捕，写明原因，5 分钟后再试',async()=>{
 saveFishAuto({mode:'auto',hours:1,lastRunAt:null});
 const start=vi.fn(async()=>{});const view=renderHook(()=>useFishAutoScan({account:'a',selection:{exchanges:[],includeDuplicates:false},start,busy:()=>false}));await flush();
 expect(start).not.toHaveBeenCalled();expect(view.result.current.error).toContain('请至少选择一家交易所');
});
it('自动捕捞与「开始捕捞」按钮拼出的设置逐项相同',async()=>{
 vi.useRealTimers();
 const onStart=vi.fn();
 render(<FishPanel defaultAlgorithms={FISH_DEFAULT_ALGORITHMS} onRecombine={()=>true} signals={[]} progress={null} inputs={{time:'',threshold:''}} onInputsChange={()=>{}} selection={selection} onSelectionChange={()=>{}} onStart={onStart} onCancel={()=>{}} onJump={()=>{}} onDelete={()=>{}} onRate={()=>{}} jumpingSignalId={null} tradedDayIndex={new Set()} campaignDayIndex={new Set()}/>);
 fireEvent.click(screen.getByLabelText('启用算法 3',{selector:'input'}));
 fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));await waitFor(()=>expect(onStart).toHaveBeenCalled());
 const built=buildFishScanSettings({cards:readFishCards(),defs:DEFS,combination:'or',selection,time:''});
 expect(built.settings).toEqual(onStart.mock.calls[0][0]);
});
it('后台标签页里逐币让出不走计时器（不受浏览器节流），前台照旧',async()=>{
 const hidden=vi.spyOn(document,'hidden','get').mockReturnValue(true);
 let done=false;void fishDelay(0,new AbortController().signal).then(()=>{done=true;});
 await vi.waitFor(()=>expect(done).toBe(true));
 hidden.mockReturnValue(false);done=false;void fishDelay(0,new AbortController().signal).then(()=>{done=true;});
 await Promise.resolve();expect(done).toBe(false);await flush(1);expect(done).toBe(true);
});
