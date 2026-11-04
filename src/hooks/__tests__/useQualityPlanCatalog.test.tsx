import {act,renderHook,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
const push=vi.hoisted(()=>vi.fn());
vi.mock('@/lib/simStateSync',()=>({queueSimStatePush:push}));
import {useQualityPlanCatalog} from '../useQualityPlanCatalog';
import {writePersistedStateRaw,notifyPersistedStateHydrated,clearPersistedStateMemoryForTests,readPersistedStateRaw} from '@/lib/persistedStateStorage';
afterEach(()=>{cleanup();localStorage.clear();clearPersistedStateMemoryForTests();push.mockClear();});
const t={id:'tpl',name:'结构为底',savedAt:1,updatedAt:1};
it('adopts cloud templates without uploading defaults, and clears them across accounts',async()=>{
 const h=renderHook(({owner})=>useQualityPlanCatalog(owner),{initialProps:{owner:'a'}});
 expect(h.result.current[0]).toEqual([]);expect(push).not.toHaveBeenCalled();
 act(()=>{writePersistedStateRaw('sim_a_quality_plan_templates_v1',JSON.stringify([t]),{source:'remote'});notifyPersistedStateHydrated('sim_a_quality_plan_templates_v1');});
 await waitFor(()=>expect(h.result.current[0]).toEqual([t]));expect(push).not.toHaveBeenCalled();
 h.rerender({owner:'b'});await waitFor(()=>expect(h.result.current[0]).toEqual([]));
 act(()=>h.result.current[1]([{...t,name:'B模板'}]));expect(push).toHaveBeenCalledExactlyOnceWith('b','quality_plan_templates_v1',[{...t,name:'B模板'}]);
 expect(JSON.parse(readPersistedStateRaw('sim_a_quality_plan_templates_v1')!)).toEqual([t]);
});
