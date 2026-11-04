import {expect,it} from 'vitest';
import {mergeQualityPlanCatalogValues as merge} from '../qualityPlanCatalogMerge';
it('preserves independent templates and newer deletion tombstones through stale device hydration',()=>{
 const a={id:'a',updatedAt:1,plan:{frozen:true}},b={id:'b',updatedAt:2},removed={id:'a',updatedAt:3,deleted:true};
 expect(merge([a],[b])).toEqual([a,b]);expect(merge([removed],[a,b])).toEqual([removed,b]);expect(merge([a,b],[removed])).toEqual([removed,b]);
 expect(merge([{...a,deleted:true}],[a])).toEqual([{...a,deleted:true}]);expect(merge(null,[null,{id:'bad'},a])).toEqual([a]);
});
