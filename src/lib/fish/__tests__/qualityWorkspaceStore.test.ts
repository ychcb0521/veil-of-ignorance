import { afterEach, expect, it, vi } from 'vitest';
import { browseInformationStudy } from '../browseInformationStudy';
import { newQualityStudy, qualityComparisonRows } from '../quality';
import { importQualityWorkspaceInformation, readQualityWorkspace } from '../qualityWorkspaceStore';
import { qualityWorkspaceData, preserveQualityWorkspace } from '../qualitySignalReadingsStore';

function storageFixture() {
  const rows = new Map<string,unknown>();
  const reads: string[] = [], writes: string[] = [];
  const options = {failWrite:false};
  const db = {close() {}, transaction() {
    const pending = new Map(rows);
    let requests = 0, aborted = false;
    const tx = {error:null, oncomplete:()=>{}, onerror:()=>{}, onabort:()=>{},
      abort() { aborted=true; queueMicrotask(()=>tx.onabort()); },
      objectStore:()=>({
        get(key:string) {
          // Any main-archive read would fail this test, even if its result were ignored.
          expect(key.endsWith(':workspace')).toBe(true); reads.push(key); requests++;
          const request = {result:undefined as unknown,onsuccess:()=>{}};
          queueMicrotask(()=>{request.result=structuredClone(pending.get(key));request.onsuccess();requests--;finish();});
          return request;
        },
        put(value:unknown,key:string) {
          writes.push(key); if(options.failWrite) throw Error('quota');
          pending.set(key,structuredClone(value));
        },
      }),
    };
    function finish() { if(!requests&&!aborted) {rows.clear();for(const [key,value] of pending)rows.set(key,value);queueMicrotask(()=>tx.oncomplete());} }
    return tx;
  }};
  vi.stubGlobal('indexedDB',{open:()=>{
    const request={result:db,onsuccess:()=>{},onerror:()=>{},onblocked:()=>{}};
    queueMicrotask(()=>request.onsuccess());return request;
  }});
  return {rows,reads,writes,options};
}
afterEach(()=>vi.unstubAllGlobals());
const reading = {metric:'BSS · avg_BSS_2',reading:0.13146699636353357,percentile:90.453877893559,sampleCount:14299};
const signalTime=1795004400000, entryTime=1795006800000;
const recordId=JSON.stringify(['original','binance','crypto','','PIEVERSEUSDT',signalTime,entryTime]);
const selected = () => browseInformationStudy('filter','chosen',[
  ['PIEVERSEUSDT',signalTime,'冻结记录',recordId,[reading]],
  ['UNPICKED',2,'','other'],
]);

it('imports exact selected information beside an existing workspace without touching the original archive or other accounts',async()=>{
  const store=storageFixture(), initial=browseInformationStudy('filter','existing',[['EXISTING',1,'','original']]);
  initial.workspaceUpdatedAt=1;
  const archive={templates:['immutable'],history:['untouched']}, other={account:'bob'};
  store.rows.set('fish-quality:alice',archive);store.rows.set('fish-quality:bob:workspace',other);
  store.rows.set('fish-quality:alice:workspace',qualityWorkspaceData(initial));
  const snapshot=selected(), original=structuredClone(snapshot), id=qualityComparisonRows(snapshot)[0].id;
  const imported=await importQualityWorkspaceInformation('alice',snapshot,[id]);
  expect(imported.samples.map(row=>row.source.symbol)).toEqual(['EXISTING','PIEVERSEUSDT']);
  expect(imported.samples[1]).toMatchObject({enteredAt:entryTime,directoryInformation:{detectors:[reading]}});
  expect(snapshot).toEqual(original);expect(store.rows.get('fish-quality:alice')).toBe(archive);
  expect(store.rows.get('fish-quality:bob:workspace')).toBe(other);
  expect(store.reads).toEqual(['fish-quality:alice:workspace']);expect(store.writes).toEqual(store.reads);
  const restored=await readQualityWorkspace('alice');
  expect(restored?.samples).toEqual(imported.samples);
  const again=await importQualityWorkspaceInformation('alice',snapshot,[id]);
  expect(again.samples).toHaveLength(2);
});

it('keeps the previous workspace and archive intact if saving fails',async()=>{
  const store=storageFixture(), initial=browseInformationStudy('filter','existing',[['EXISTING',1,'','original']]);
  initial.workspaceUpdatedAt=1;const saved=qualityWorkspaceData(initial);
  store.rows.set('fish-quality:alice:workspace',saved);store.options.failWrite=true;
  const snapshot=selected();
  await expect(importQualityWorkspaceInformation('alice',snapshot,[qualityComparisonRows(snapshot)[0].id])).rejects.toThrow('原内容已保留');
  expect(store.rows.get('fish-quality:alice:workspace')).toBe(saved);
});

it('does not invent an entry time for opaque IDs and retains frozen zero values',()=>{
  const snapshot=browseInformationStudy('filter','round',[['ZERO',1,'','opaque',[{metric:'BSS',reading:0,percentile:0}]]]);
  expect(snapshot.samples[0]).toMatchObject({enteredAt:null,basis:'missing',directoryInformation:{detectors:[{reading:0,percentile:0}]}});
  const historical={...newQualityStudy(),planTemplates:[],results:[]};
  const restored=preserveQualityWorkspace({...snapshot,workspaceUpdatedAt:1},historical);
  expect(restored.samples).toEqual(snapshot.samples);expect(restored.planTemplates).toBe(historical.planTemplates);
});
