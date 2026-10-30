import {act,renderHook,cleanup} from '@testing-library/react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {useFishQuality} from '../useFishQuality';
import {monitorArchiveFixture} from '@/lib/fish/__tests__/monitorArchive.fixture';
import {newQualityStudy,qualityDisplayRows,type QualityRunOptions} from '@/lib/fish/quality';
const storage=vi.hoisted(()=>({load:vi.fn(),save:vi.fn()}));
vi.mock('@/lib/fish/qualityStore',()=>({loadQualityStudy:storage.load,saveQualityStudy:storage.save}));
beforeEach(()=>{vi.useFakeTimers();storage.load.mockReset().mockImplementation(async()=>({study:monitorArchiveFixture()}));storage.save.mockReset().mockResolvedValue(true);});
afterEach(()=>{cleanup();vi.clearAllTimers();vi.useRealTimers();localStorage.clear();});
const flush=async()=>{await act(async()=>{await vi.advanceTimersByTimeAsync(0);});};
it('waits for a full-table archive to persist before starting the selected subset, and ignores duplicate clicks',async()=>{
 const runner=vi.fn(async(_o:QualityRunOptions)=>{}),h=renderHook(()=>useFishQuality('a',[],runner));await flush();const rows=qualityDisplayRows(h.result.current.study);act(()=>{h.result.current.setScope([rows[0].id]);h.result.current.setSelectedRows([rows[0].id]);});
 let release!:(ok:boolean)=>void,held=false;storage.save.mockImplementation(async(_owner,s)=>{if(s.monitorLibrary?.archives?.length&&!held){held=true;return new Promise<boolean>(r=>{release=r;});}return true;});
 act(()=>{void h.result.current.restart();void h.result.current.restart();});await flush();expect(h.result.current.archiving).toBe(true);expect(runner).not.toHaveBeenCalled();
 const saved=storage.save.mock.calls.find(([,s])=>s.monitorLibrary?.archives?.length)![1];expect(saved.monitorLibrary.archives[0].study.results).toHaveLength(4);expect(saved.monitorLibrary.archives[0].study.samples).toHaveLength(2);
 await act(async()=>{release(true);});await flush();expect(runner).toHaveBeenCalledOnce();expect(h.result.current.study.monitorLibrary!.archives).toHaveLength(1);expect(h.result.current.archiving).toBe(false);expect(runner.mock.calls[0][0].mode).toBe('restart');
});
it('keeps results and refuses to run when archive storage fails, including with no selected rows',async()=>{
 const runner=vi.fn(async(_o:QualityRunOptions)=>{}),h=renderHook(()=>useFishQuality('a',[],runner));await flush();const old=structuredClone(h.result.current.study.results);act(()=>h.result.current.setSelectedRows([]));storage.save.mockResolvedValue(false);act(()=>{void h.result.current.restart();});await flush();expect(h.result.current.error).toContain('归档失败');expect(h.result.current.study.results).toEqual(old);expect(runner).not.toHaveBeenCalled();expect(h.result.current.archiving).toBe(false);
});
it('never installs an old account archive or starts its calculation after an account switch',async()=>{
 storage.load.mockImplementation(async(owner)=>({study:owner==='a'?monitorArchiveFixture():newQualityStudy()}));const runner=vi.fn(async(_o:QualityRunOptions)=>{}),h=renderHook(({owner})=>useFishQuality(owner,[],runner),{initialProps:{owner:'a'}});await flush();let release!:(ok:boolean)=>void;storage.save.mockImplementation(async(_owner,s)=>s.monitorLibrary?.archives?.length?new Promise<boolean>(r=>{release=r;}):true);
 act(()=>{void h.result.current.restart();});await flush();h.rerender({owner:'b'});await flush();await act(async()=>{release(true);});await flush();expect(h.result.current.account).toBe('b');expect(h.result.current.study.monitorLibrary?.archives??[]).toEqual([]);expect(runner).not.toHaveBeenCalled();expect(h.result.current.archiving).toBe(false);
});

it('persists the prior table and copied study before replacing the live view, without starting a run',async()=>{
 const runner=vi.fn(async(_o:QualityRunOptions)=>{}),h=renderHook(()=>useFishQuality('a',[],runner));await flush();const snapshot=monitorArchiveFixture();snapshot.results=snapshot.results.map(r=>({...r,returnPct:77}));let release!:(ok:boolean)=>void;
 storage.save.mockImplementation(async(_owner,s)=>s.results[0]?.returnPct===77?new Promise<boolean>(r=>{release=r;}):true);
 act(()=>{void h.result.current.restoreMonitorStudy(snapshot);});await flush();expect(h.result.current.archiving).toBe(true);expect(h.result.current.study.results[0].returnPct).not.toBe(77);
 await act(async()=>release(true));await flush();expect(h.result.current.study.results[0].returnPct).toBe(77);expect(h.result.current.study.selectedRowIds).toEqual(qualityDisplayRows(h.result.current.study).map(row=>row.id));expect(h.result.current.study.monitorLibrary!.archives!.at(-1)!.reason).toBe('copy');expect(runner).not.toHaveBeenCalled();expect(h.result.current.archiving).toBe(false);
});
it('retains the active table if copying fails and never installs a previous account copy after switching',async()=>{
 storage.load.mockImplementation(async owner=>({study:owner==='a'?monitorArchiveFixture():newQualityStudy()}));const runner=vi.fn(async(_o:QualityRunOptions)=>{}),h=renderHook(({owner})=>useFishQuality(owner,[],runner),{initialProps:{owner:'a'}});await flush();const before=structuredClone(h.result.current.study.results),snapshot=monitorArchiveFixture();snapshot.results[0].returnPct=77;storage.save.mockResolvedValue(false);
 await act(async()=>{expect(await h.result.current.restoreMonitorStudy(snapshot)).toBe(false);});expect(h.result.current.study.results).toEqual(before);expect(h.result.current.error).toContain('副本未保存');
 let release!:(ok:boolean)=>void;storage.save.mockImplementation(async()=>new Promise<boolean>(r=>{release=r;}));act(()=>{void h.result.current.restoreMonitorStudy(snapshot);});await flush();h.rerender({owner:'b'});await flush();await act(async()=>release(true));await flush();expect(h.result.current.study.results).toEqual([]);expect(h.result.current.account).toBe('b');expect(runner).not.toHaveBeenCalled();
});
