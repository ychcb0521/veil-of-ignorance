import { expect, it } from 'vitest';
import { CUSTOM_INDICATOR_GROUPS, groupDeepDigFeatures } from '@/lib/customIndicatorGroups';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
const def=(id:string,removed=false)=>({id,name:id,removed} as DeepDigFeatureDef);
it('directory uses exactly the custom indicator group membership and order, keeping original objects',()=>{
 const ids=['cbi2','cdi2','drift-speed-z','seller-control','state','state2','bss','dss','cba','cda'];
 const input=ids.map(id=>def(id)).reverse(),before=[...input],groups=groupDeepDigFeatures(input);
 expect(groups.map(g=>g.title)).toEqual(CUSTOM_INDICATOR_GROUPS.map(g=>g.title));
 expect(groups.map(g=>g.items.map(d=>d.id))).toEqual([ids.slice(0,6),ids.slice(6,8),ids.slice(8)]);
 expect(groups.flatMap(g=>g.items).every(d=>input.includes(d))).toBe(true);expect(input).toEqual(before);
});
it('empty categories disappear, removed definitions stay removed, new features remain accessible',()=>{
 const custom=def('my-feature'),groups=groupDeepDigFeatures([def('state',true),custom,def('cda')]);
 expect(groups.map(g=>g.key)).toEqual(['advantage','other']);expect(groups.at(-1)!.items).toEqual([custom]);
 expect(groupDeepDigFeatures([])).toEqual([]);
});
