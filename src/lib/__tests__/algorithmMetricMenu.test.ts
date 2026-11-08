import {expect,it} from 'vitest';
import {BUILTIN_FEATURES,CBI2_DEF, type DeepDigFeatureDef} from '@/lib/deepDig/features';
import {algorithmMetricMenu} from '@/lib/fish/algorithmMetricMenu';
import {fishStatistics,compileFishProgram} from '@/lib/fish/algorithm';
import {qualityFilterChoices,qualityFilterMenuChoices,makeQualityBuyFilter} from '@/lib/fish/qualityFilters';

const def:DeepDigFeatureDef={...CBI2_DEF,id:'menu-fixture',chartCore:'signal',formula:'helper = C - O\nsignal = helper / O\navg_signal = avg(signal, 1)\navg_signal_2 = avg(signal, 2)',scale:100};
it('offers only canonical series and retains every old series for execution without changing formulas or scale',()=>{
 const before=structuredClone(def),all=fishStatistics(def);
 expect(algorithmMetricMenu(def,all)).toEqual([{name:'signal',label:'原值'},{name:'avg_signal',label:'avg'},{name:'avg_signal_2',label:'avg_2'}]);
 for(const statistic of ['helper','结果','signal','avg_signal','avg_signal_2']){
   const program=compileFishProgram(def,{statistic,direction:'>',threshold:.07,constraints:[]});
   expect(program.settings.statistic).toBe(statistic);expect(program.def.formula).toBe(def.formula);
 }
 const full=qualityFilterChoices([def]),menu=qualityFilterMenuChoices([def]);
 expect(menu.map(c=>c.metric)).toEqual(['signal','avg_signal','avg_signal_2']);
 const legacy=full.find(c=>c.metric==='helper')!;expect(legacy).toBeDefined();
 expect(makeQualityBuyFilter(legacy.key,'>',.3,true,[def])).toMatchObject({metric:'helper',snapshot:{statistic:'helper',scale:1,threshold:.3}});
 expect(def).toEqual(before);
});
it('keeps the old named-series variant for customized Z formulas and does not invent unavailable averages',()=>{
 const customized={...def,id:'drift-speed-z',chartCore:undefined,formula:'helper = C - O\na = helper / O\navg_a = avg(a, 1)\navg_a_2 = avg(a, 2)'};
 expect(algorithmMetricMenu(customized,fishStatistics(customized)).map(s=>s.name)).toEqual(['a','avg_a','avg_a_2']);
 const raw={...def,formula:'signal = C - O'};
 expect(algorithmMetricMenu(raw,fishStatistics(raw))).toEqual([{name:'signal',label:'原值'}]);
 expect(algorithmMetricMenu({...raw,formula:'broken('},[])).toEqual([]);
});
it('bounds every built-in algorithm menu to the three series and leaves the full registry available',()=>{
 const choices=qualityFilterMenuChoices(BUILTIN_FEATURES);
 expect(choices.length).toBeGreaterThan(0);
 for(const def of BUILTIN_FEATURES){
   const own=choices.filter(c=>c.featureId===def.id);
   expect(own.length).toBeLessThanOrEqual(3);
   for(const c of own)expect(['原值','avg','avg_2']).toContain(c.label.slice(c.group.length+1));
   const all=fishStatistics(def),menu=algorithmMetricMenu(def,all);
   expect(menu.length).toBeLessThanOrEqual(3);
   for(const metric of menu)expect(all.some(s=>s.name===metric.name)).toBe(true);
 }
});
