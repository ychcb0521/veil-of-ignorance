import {expect,it} from 'vitest';
import {BUILTIN_FEATURES,MBI_DEF,CTBA_12H_DEF,newFeatureTemplate,copyFeatureDefinition,saveFeatureDefinition,mergeFeatureDefs,definitionKey} from '../features';
import {BUILTIN_FEATURE_CREATION,featureCreation} from '../featureCreation';
it('covers all current builtins using auditable first-registration history, never deterministic copy-ID dates',()=>{
 expect(Object.keys(BUILTIN_FEATURE_CREATION).sort()).toEqual(BUILTIN_FEATURES.map(d=>d.id).sort());
 for(const d of BUILTIN_FEATURES){const before=JSON.stringify(d),info=featureCreation(d)!;expect(info.source).toBe('version-history');expect(Number.isFinite(info.at)).toBe(true);expect(info.commit).toMatch(/^[a-f\d]{8}$/);expect(JSON.stringify(d)).toBe(before);}
 expect(featureCreation(CTBA_12H_DEF)).toMatchObject({at:Date.parse('2026-10-29T21:36:15+08:00'),commit:'318b1494'});
 expect(featureCreation(CTBA_12H_DEF)!.at).not.toBe(CTBA_12H_DEF.createdAt);
 const renamed={...MBI_DEF,createdAt:Date.now(),name:'账号改名'};expect(featureCreation(renamed)).toEqual(featureCreation(MBI_DEF));
});
it('records distinct real times for new features and independent copies',()=>{
 const a=Date.parse('2026-10-30T13:00:00+08:00'),b=a+60000,source=newFeatureTemplate(a),before=JSON.stringify(source),copy=copyFeatureDefinition(source,[source],b);
 expect(featureCreation(source)).toEqual({at:a,source:'recorded'});expect(featureCreation(copy)).toEqual({at:b,source:'recorded'});expect(JSON.stringify(source)).toBe(before);expect(copy.id).not.toBe(source.id);
});
it('preserves a saved creation time through edits or omitted metadata without changing calculation identity',()=>{
 const original=newFeatureTemplate(123456),before=JSON.stringify(original),key=definitionKey(original);
 for(const createdAt of [undefined,987654]){const saved=saveFeatureDefinition([original],{...original,name:'改名',createdAt}).find(d=>d.id===original.id)!;expect(saved.createdAt).toBe(original.createdAt);expect(definitionKey(saved)).toBe(key);expect(featureCreation(mergeFeatureDefs([saved]).find(d=>d.id===original.id)!)).toEqual(featureCreation(original));}
 expect(JSON.stringify(original)).toBe(before);
});
it('keeps unrecorded or invalid legacy creation times unknown rather than stamping the current time',()=>{
 for(const createdAt of [undefined,NaN,Infinity,0,-1,Number.MAX_VALUE,8.64e15])expect(featureCreation({id:'old-custom',createdAt})).toBeNull();
 expect(featureCreation({id:'toString'})).toBeNull();
 const old={...newFeatureTemplate(123),id:'old-custom',createdAt:undefined};expect(saveFeatureDefinition([old],{...old,name:'旧特征修改'}).find(d=>d.id===old.id)!.createdAt).toBeUndefined();
});
