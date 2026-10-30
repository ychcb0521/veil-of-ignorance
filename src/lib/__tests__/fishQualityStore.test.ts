import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newQualityStudy } from '@/lib/fish/quality';
import {payload} from '@/lib/fish/__tests__/libraryTransfer.fixture';
import {markSourceDeletions} from '@/lib/fish/libraryDeletion';
const disk = new Map<string, unknown>();
let fail = false;
beforeEach(() => {
  disk.clear(); localStorage.clear(); fail = false;
  const db = { close() {}, createObjectStore() {}, transaction() {
    const tx: any = {};
    tx.objectStore = () => ({ get(k: string) { const req: any = {}; queueMicrotask(() => { req.result = structuredClone(disk.get(k)); req.onsuccess?.(); }); return req; },
      put(v: unknown, k: string) { queueMicrotask(() => { if (fail) tx.onabort?.(); else { disk.set(k, structuredClone(v)); tx.oncomplete?.(); } }); } });
    return tx;
  } };
  vi.stubGlobal('indexedDB', { open() { const req: any = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req; } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('retains deletion markers through stale saves and remote history merges while preserving current settings',async()=>{
 const store=await import('@/lib/fish/qualityStore'),p=payload(),old={...newQualityStudy(),observeHours:72,filterLibrary:p.filter,monitorLibrary:p.monitor},r=p.monitor!.records[0];
 await store.saveQualityStudy('a',old);await store.saveQualityStudy('a',markSourceDeletions(old,[{source:r.source,entry:r.enteredAt}],2000));await store.saveQualityStudy('a',old);
 let s=(await store.loadQualityStudy('a')).study;expect(s.filterLibrary!.records).toEqual([]);expect(s.monitorLibrary!.records).toEqual([]);expect(s.monitorLibrary!.rounds[0].recordIds).toEqual([]);
 await store.qualityAccountBlob.mergeRemote!('a',{...old,observeHours:1});s=(await store.loadQualityStudy('a')).study;expect(s.observeHours).toBe(72);expect(s.monitorLibrary!.records).toEqual([]);expect((await store.loadQualityStudy('b')).study.deletedSources).toBeUndefined();
});
it('persists independently of full localStorage, restores rules/results after reload, and isolates accounts', async () => {
  const store = await import('@/lib/fish/qualityStore');
  const study = newQualityStudy(); study.observeHours = 72; study.tracking = false;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(await store.saveQualityStudy('a', study)).toBe(true);
  vi.resetModules(); const reloaded = await import('@/lib/fish/qualityStore');
  expect((await reloaded.loadQualityStudy('a')).study).toEqual(study);
  expect((await reloaded.loadQualityStudy('b')).study.observeHours).toBe(0);
  expect((await reloaded.loadQualityStudy()).study.observeHours).toBe(0);
});
it('serializes rapid account writes, falls back on database failure and reports loss of both storage options', async () => {
  const store = await import('@/lib/fish/qualityStore');
  await Promise.all([1, 2, 3].map(n => store.saveQualityStudy('a', { ...newQualityStudy(), observeHours: n })));
  expect((await store.loadQualityStudy('a')).study.observeHours).toBe(3);
  fail = true;
  expect(await store.saveQualityStudy('a', { ...newQualityStudy(), observeHours: 5 })).toBe(true);
  expect((await store.loadQualityStudy('a')).study.observeHours).toBe(5);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(await store.saveQualityStudy('a', newQualityStudy())).toBe(false);
});
it('preserves the durable correction log even if a stale tab hits IDB quota and falls back to localStorage',async()=>{
  const store=await import('@/lib/fish/qualityStore'), old=newQualityStudy(100);
  const fixed={...old,campaignRepair:{id:'r',startedAt:200,updatedAt:201,revision:2,targetVersion:'v',state:'complete' as const,targetKeys:[],completedKeys:[],changedKeys:[],failures:{}}};
  expect(await store.saveQualityStudy('a',fixed)).toBe(true);
  fail=true;
  expect(await store.saveQualityStudy('a',{...old,tracking:false})).toBe(true);
  const loaded=(await store.loadQualityStudy('a')).study;
  expect(loaded.campaignRepair?.revision).toBe(2); expect(loaded.tracking).toBe(false);
});
it('writes only repair fields so a long correction cannot overwrite new samples, filters or selections',async()=>{
  const store=await import('@/lib/fish/qualityStore'), old=newQualityStudy(100);
  const latest={...old,tracking:false,selectedRowIds:['new-selection']};
  await store.saveQualityStudy('a',latest);
  const progress={...old,campaignRepair:{id:'r',startedAt:200,updatedAt:201,revision:1,targetVersion:'v',state:'running' as const,targetKeys:[],completedKeys:[],changedKeys:[],failures:{}}};
  expect(await store.saveQualityStudy('a',progress,{repairOnly:true})).toBe(true);
  const loaded=(await store.loadQualityStudy('a')).study;
  expect(loaded.tracking).toBe(false); expect(loaded.selectedRowIds).toEqual(['new-selection']); expect(loaded.campaignRepair?.id).toBe('r');
});

it('persists monitor history across reloads, account sync writes and stale or repair-only saves', async () => {
  const { beginQualityMonitorRound, finishQualityMonitorRound } = await import('@/lib/fish/qualityMonitorLibrary');
  const store = await import('@/lib/fish/qualityStore');
  const base = newQualityStudy(100), begun = beginQualityMonitorRound(base, base, 200);
  const completed = finishQualityMonitorRound(begun.study, begun.capture, 'complete', 201);
  expect(await store.saveQualityStudy('monitor-owner', completed)).toBe(true);
  expect(await store.saveQualityStudy('monitor-owner', base)).toBe(true);
  expect((await store.loadQualityStudy('monitor-owner')).study.monitorLibrary?.rounds[0].state).toBe('complete');
  expect(await store.saveQualityStudy('monitor-owner', base, { repairOnly: true })).toBe(true);
  await store.qualityAccountBlob.write('monitor-owner', base);
  const restored = (await store.loadQualityStudy('monitor-owner')).study;
  expect(restored.monitorLibrary?.rounds).toHaveLength(1);
  expect(store.qualityAccountBlob.weight(restored)).toBe(1);
  expect((await store.loadQualityStudy('other-owner')).study.monitorLibrary).toBeUndefined();
  fail = true;
  expect(await store.saveQualityStudy('monitor-owner', base)).toBe(true);
  expect((await store.loadQualityStudy('monitor-owner')).study.monitorLibrary?.rounds).toHaveLength(1);
});

it('preserves ready post-sale windows through stale-tab, fallback and cloud writes without changing trades',async()=>{
 const store=await import('@/lib/fish/qualityStore'),base=newQualityStudy(100);
 const reading={key:'post-exit-v1-test',evaluatedAt:300,exitTime:100,exitPrice:200,startMs:100,excludedExitMinute:false,windows:[{hours:.5 as const,status:'ready' as const,peakPct:2,drawdown2Pct:1}]};
 await store.saveQualityStudy('post-owner',{...base,postExitReadings:[reading]});await store.saveQualityStudy('post-owner',base);
 await store.qualityAccountBlob.write('post-owner',base);
 expect((await store.loadQualityStudy('post-owner')).study.postExitReadings![0].windows[0]).toMatchObject({status:'ready',peakPct:2});
 fail=true;await store.saveQualityStudy('post-owner',base);expect((await store.loadQualityStudy('post-owner')).study.postExitReadings).toHaveLength(1);
 expect((await store.loadQualityStudy('other-post-owner')).study.postExitReadings).toBeUndefined();
});
