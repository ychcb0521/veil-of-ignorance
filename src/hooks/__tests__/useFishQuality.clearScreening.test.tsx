import {act,renderHook,cleanup} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {useFishQuality} from '../useFishQuality';
import {monitorArchiveFixture} from '@/lib/fish/__tests__/monitorArchive.fixture';
import {newQualityStudy} from '@/lib/fish/quality';
import {emptyPreEntryLibrary} from '@/lib/fish/preEntryMonitor';
const storage=vi.hoisted(()=>({load:vi.fn(),save:vi.fn(),clear:vi.fn()}));
vi.mock('@/lib/fish/qualityStore',()=>({loadQualityStudy:storage.load,saveQualityStudy:storage.save}));
vi.mock('../usePreEntryMonitor',()=>({usePreEntryMonitor:()=>({ready:true,library:emptyPreEntryLibrary(),clearTableResults:storage.clear})}));
beforeEach(()=>{vi.useFakeTimers();storage.load.mockReset().mockImplementation(async()=>({study:monitorArchiveFixture()}));storage.save.mockReset().mockResolvedValue(true);storage.clear.mockReset().mockResolvedValue(true);});
afterEach(()=>{cleanup();vi.clearAllTimers();vi.useRealTimers();localStorage.clear();});
const flush=async()=>{await act(async()=>{await vi.advanceTimersByTimeAsync(0);});};
it('clears dynamic table snapshots while preserving static readings, holdings and saved plan assets',async()=>{
 const runner=vi.fn(),h=renderHook(()=>useFishQuality('a',[],runner));await flush();const before=structuredClone(h.result.current.study);
 await act(async()=>{expect(await h.result.current.clearScreeningResults()).toBe(true);});
 expect(storage.clear).toHaveBeenCalledOnce();expect(h.result.current.study.screeningResults).toEqual([]);
 for(const key of ['filterReadings','results','sellPlans','buyFilters','planTemplates','monitorLibrary','filterLibrary'] as const)expect(h.result.current.study[key]).toEqual(before[key]);expect(runner).not.toHaveBeenCalled();
});
it('retains the study when clearing cannot persist and refuses an old account completion',async()=>{
 storage.load.mockImplementation(async owner=>({study:owner==='a'?monitorArchiveFixture():newQualityStudy()}));const h=renderHook(({owner})=>useFishQuality(owner,[],vi.fn()),{initialProps:{owner:'a'}});await flush();const before=structuredClone(h.result.current.study);
 storage.clear.mockResolvedValueOnce(false);await act(async()=>{expect(await h.result.current.clearScreeningResults()).toBe(false);});expect(h.result.current.study).toEqual(before);
 let release!:(ok:boolean)=>void;storage.clear.mockImplementationOnce(()=>new Promise<boolean>(resolve=>{release=resolve;}));let pending!:Promise<boolean>;act(()=>{pending=h.result.current.clearScreeningResults();});h.rerender({owner:'b'});await flush();await act(async()=>{release(true);expect(await pending).toBe(false);});expect(h.result.current.account).toBe('b');expect(h.result.current.study.screeningResults).toBeUndefined();
});
