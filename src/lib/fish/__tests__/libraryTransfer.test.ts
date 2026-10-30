import {beforeAll,afterAll,describe,expect,it,vi} from 'vitest';import {webcrypto} from 'node:crypto';
import {makeLibraryPackage,parseLibraryPackage,parseLibraryFile,aggregateLibraryPackages,transferPreview,validateLibraryPayload,mergeLibraryCollections,EMPTY_COLLECTION,stringifyLibraryFile,type LibraryPayload} from '../libraryTransfer';
import {STATE_DEF,definitionKey} from '@/lib/deepDig/features';
beforeAll(()=>vi.stubGlobal('crypto',webcrypto));afterAll(()=>vi.unstubAllGlobals());
import {payload} from './libraryTransfer.fixture';
import {deletionKey} from '../libraryDeletion';
describe('fish-quality three-library packages',()=>{
 it('roundtrips all records, delta rounds, exact formulas, zero readings, mirror fields and counterfactual data',async()=>{
  const data=payload(),before=structuredClone(data),p=await makeLibraryPackage('account-a','电脑A',data),restored=await parseLibraryPackage(JSON.stringify(p));expect(restored).toEqual(p);expect(restored.libraries).toEqual(before);expect(data).toEqual(before);expect(restored.libraries.filter!.records[0].readings[0]!.value).toBe(0);
 });
 it('preserves non-finite diagnostic values without converting them to zero or null',async()=>{const data=payload();data.monitor!.records[0].result!.returnPct=Infinity;data.observations!.entryReadings![0].value=NaN;const p=await makeLibraryPackage('a','A',data),r=await parseLibraryPackage(stringifyLibraryFile(p));expect(r.libraries.monitor!.records[0].result!.returnPct).toBe(Infinity);expect(r.libraries.observations!.entryReadings![0].value).toBeNaN();});
 it.each(['mining','filter','monitor'] as const)('downloads %s as a self-contained complete library',async scope=>{const p=await makeLibraryPackage('a','A',payload(),scope);expect(p.libraries[scope]!.records).toHaveLength(1);expect(await parseLibraryPackage(JSON.stringify(p))).toEqual(p);expect(Object.keys(p.libraries).filter(k=>k!=='observations')).toEqual([scope]);});
 it('ignores file export times and repeated uploads; latest record timestamp wins across accounts',async()=>{
  const a=await makeLibraryPackage('a','A',payload(100,10),'all',9000),same=await makeLibraryPackage('a','A',payload(100,10),'all',99999),b=await makeLibraryPackage('b','B',payload(200,-4),'all',1000);
  expect(same.id).toBe(a.id);const rows=aggregateLibraryPackages([a,b]);expect(rows).toHaveLength(3);const r=rows.find(r=>r.scope==='monitor')!;expect(r.result!.returnPct).toBe(-4);expect(r.account).toEqual(['a','b']);expect(r.variants).toBe(2);expect(aggregateLibraryPackages([b,a]).find(r=>r.scope==='monitor')!.result!.returnPct).toBe(-4);
  expect(transferPreview([a],[a,same,b])).toMatchObject({duplicates:2,added:0,updated:3,rows:3});expect(mergeLibraryCollections(EMPTY_COLLECTION(),{version:1,packages:[a,same]}).packages).toHaveLength(1);
 });
 it('never merges different full algorithm thresholds, exchanges or actual entry times',async()=>{
  const a=await makeLibraryPackage('a','A',payload()),other=payload(200,20,.6);other.monitor!.records[0].source.id='different-display-id';const b=await makeLibraryPackage('b','B',other);expect(aggregateLibraryPackages([a,b]).filter(r=>r.scope==='monitor')).toHaveLength(2);
  for(const kind of ['exchange','entry']){const x=payload();if(kind==='exchange')x.monitor!.records[0].source.exchange='okx';else x.monitor!.records[0].enteredAt=1400000;expect(aggregateLibraryPackages([a,await makeLibraryPackage('b','B',x)]).filter(r=>r.scope==='monitor')).toHaveLength(2);}
 });
 it('preserves unrecorded legacy formulas but never merges them as proven-equivalent trials',async()=>{const x=payload();delete x.monitor!.settings[0].plan.snapshot.definitionKey;const a=await makeLibraryPackage('a','A',x),b=await makeLibraryPackage('b','B',x);expect(aggregateLibraryPackages([a,b]).filter(r=>r.scope==='monitor')).toHaveLength(2);});
 it('keeps account B results when the same source signal is deleted only in account A',async()=>{const original=payload(),a=await makeLibraryPackage('a','A',original),b=await makeLibraryPackage('b','B',original),gone=payload();const r=gone.monitor!.records[0];gone.deletedSources={[deletionKey({source:r.source,entry:r.enteredAt})]:9999};const deletion=await makeLibraryPackage('a','A',gone);const rows=aggregateLibraryPackages([a,b,deletion]);expect(rows.find(r=>r.scope==='monitor')!.account).toEqual(['b']);});
 it('re-exports multiple imported source packages as one portable file without changing their origins',async()=>{const a=await makeLibraryPackage('a','A',payload()),b=await makeLibraryPackage('b','B',payload(200));const text=JSON.stringify({format:'veil-fish-quality-library-collection',version:1,packages:[a,b,a]});expect(await parseLibraryFile(text)).toEqual([a,b]);});
 it('rejects partial/foreign files, altered contents, dangling records and circular rounds before import',async()=>{
  await expect(parseLibraryPackage('{"format":"other"}')).rejects.toThrow();const p=await makeLibraryPackage('a','A',payload());const changed=structuredClone(p);changed.libraries.monitor!.records[0].result!.returnPct=999;await expect(parseLibraryPackage(JSON.stringify(changed))).rejects.toThrow('校验失败');
  const broken=payload();broken.filter!.rounds[0].recordIds=['missing'];expect(()=>validateLibraryPayload(broken)).toThrow('引用不存在');
  const loop=payload();loop.filter!.rounds[0].base='f-round-2';expect(()=>validateLibraryPayload(loop)).toThrow('循环');
  await expect(parseLibraryPackage('{"__proto__":{"polluted":true}}')).rejects.toThrow('非法');expect(({} as any).polluted).toBeUndefined();
 });
});
