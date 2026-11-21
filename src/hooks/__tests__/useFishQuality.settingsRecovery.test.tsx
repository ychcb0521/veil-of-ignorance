import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const storage=vi.hoisted(()=>({load:vi.fn(),save:vi.fn()}));
vi.mock('@/lib/fish/qualityStore',()=>({loadQualityStudy:storage.load,saveQualityStudy:storage.save}));
vi.mock('@/hooks/usePreEntryMonitor',()=>({usePreEntryMonitor:()=>({ready:false,library:{version:1,rounds:[],records:[]}})}));
vi.mock('@/lib/simStateSync',()=>({queueSimStatePush:vi.fn()}));
import {useFishQuality} from '../useFishQuality';
import {newQualityStudy,type FishQualityStudy} from '@/lib/fish/quality';
import {makeQualitySellPlan} from '@/lib/fish/qualitySellPlans';
import {freezeQualityPlan} from '@/lib/fish/qualityPlanVersions';
import {qualityPlanFromTemplate} from '@/lib/fish/qualityPlanTemplates';
import {STATIC_DRAWDOWN_SELL_CHOICE} from '@/lib/fish/qualityStaticDrawdownSell';
import {readSavedQualityPlans,writeSavedQualityPlans} from '@/lib/fish/qualitySavedPlans';
import {clearPersistedStateMemoryForTests,readPersistedStateRaw,writePersistedStateRaw} from '@/lib/persistedStateStorage';
const plan=()=>freezeQualityPlan(makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE,'>=',3,[],undefined,'saved-plan'));
let finish:(value:{study:FishQualityStudy})=>void;
const flush=async()=>{await act(async()=>{await vi.advanceTimersByTimeAsync(0);});};
beforeEach(()=>{
 vi.useFakeTimers();storage.save.mockReset().mockResolvedValue(true);
 storage.load.mockReset().mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
});
afterEach(()=>{cleanup();vi.clearAllTimers();vi.useRealTimers();localStorage.clear();clearPersistedStateMemoryForTests();});
function seed(owner:string){const saved=plan();writeSavedQualityPlans(owner,[{id:saved.id,updatedAt:1,position:0,plan:saved}]);return saved;}

it('edits saved settings while the historical archive is pending without writing a partial study or running monitoring',async()=>{
 const saved=seed('early'),run=vi.fn();
 const h=renderHook(()=>useFishQuality('early',[],run));await flush();
 expect(h.result.current.ready).toBe(false);
 expect(h.result.current.monitorSettings.ready).toBe(true);
 expect(h.result.current.monitorSettings.study.sellPlans).toEqual([saved]);
 act(()=>h.result.current.setSellPlans([{...saved,label:'先保存的修改'}]));await flush();
 expect(readSavedQualityPlans('early')[0].plan?.label).toBe('先保存的修改');
 expect(h.result.current.monitorSettings.study.sellPlans?.[0].frozenVersions).toEqual(saved.frozenVersions);
 await act(async()=>{await h.result.current.start();});
 expect(run).not.toHaveBeenCalled();expect(storage.save).not.toHaveBeenCalled();
 const unknown={...saved,id:'history-only',label:'历史方案'};
 await act(async()=>finish({study:{...newQualityStudy(),sellPlansConfigured:true,sellPlans:[saved,unknown]}}));await flush();
 expect(h.result.current.ready).toBe(true);
 expect(h.result.current.study.sellPlans?.find(p=>p.id===saved.id)?.label).toBe('先保存的修改');
 expect(h.result.current.study.sellPlans?.find(p=>p.id===unknown.id)).toEqual(unknown);
 expect(run).not.toHaveBeenCalled();
});

it('deleting a known settings entry during recovery retains unknown historical plans',async()=>{
 const saved=seed('delete-early'),h=renderHook(()=>useFishQuality('delete-early',[],async()=>{}));await flush();
 act(()=>h.result.current.setSellPlans([]));await flush();
 expect(readSavedQualityPlans('delete-early')[0].deleted).toBe(true);
 expect(storage.save).not.toHaveBeenCalled();
 const unknown={...saved,id:'untouched',label:'未读取的历史方案'};
 await act(async()=>finish({study:{...newQualityStudy(),sellPlansConfigured:true,sellPlans:[saved,unknown]}}));await flush();
 expect(h.result.current.study.sellPlans).toEqual([unknown]);
});

it('creates and saves a template copy before history loads while preserving the original frozen template byte for byte',async()=>{
 const saved=seed('template-owner'),template={id:'original-template',name:'原模板',savedAt:1,updatedAt:1,plan:saved};
 const key='sim_template-owner_quality_plan_templates_v1',raw=JSON.stringify([template]);
 writePersistedStateRaw(key,raw,{source:'remote'});
 const h=renderHook(()=>useFishQuality('template-owner',[],async()=>{}));await flush();
 const copy=qualityPlanFromTemplate(template,'new-copy','新方案');
 act(()=>h.result.current.setSellPlans([saved,copy]));await flush();
 expect(h.result.current.ready).toBe(false);
 expect(h.result.current.monitorSettings.study.sellPlans?.[1]).toEqual(copy);
 expect(readPersistedStateRaw(key)).toBe(raw);
 expect(h.result.current.templateCatalog[0]).toEqual(template);
 expect(storage.save).not.toHaveBeenCalled();
});

it('exposes only the selected account settings and ignores the previous account archive response',async()=>{
 const a=seed('account-a'),b={...plan(),id:'account-b-plan',label:'B方案'};
 writeSavedQualityPlans('account-b',[{id:b.id,updatedAt:1,position:0,plan:b}]);
 const h=renderHook(({owner})=>useFishQuality(owner,[],async()=>{}),{initialProps:{owner:'account-a'}});await flush();
 const finishA=finish;
 h.rerender({owner:'account-b'});await flush();
 expect(h.result.current.monitorSettings.study.sellPlans).toEqual([b]);
 await act(async()=>finishA({study:{...newQualityStudy(),sellPlans:[a]}}));await flush();
 expect(h.result.current.ready).toBe(false);
 expect(h.result.current.monitorSettings.study.sellPlans).toEqual([b]);
 expect(storage.save).not.toHaveBeenCalled();
});
