import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {payload} from './libraryTransfer.fixture';
import {deleteMiningRecords} from '../libraryDeletion';
vi.mock('@/lib/accountBlobSync',()=>({syncAccountBlobOnLoad:vi.fn(),noteAccountBlobSaved:vi.fn()}));
beforeEach(()=>{vi.resetModules();const disk=new Map<string,unknown>(),db={close(){},transaction(){const tx:any={};tx.objectStore=()=>({get(k:string){const r:any={};queueMicrotask(()=>{r.result=structuredClone(disk.get(k));r.onsuccess?.();});return r;},put(v:unknown,k:string){disk.set(k,structuredClone(v));queueMicrotask(()=>tx.oncomplete?.());}});return tx;}};vi.stubGlobal('indexedDB',{open(){const r:any={};queueMicrotask(()=>{r.result=db;r.onsuccess?.();});return r;}});});
afterEach(()=>vi.unstubAllGlobals());
it('keeps selected records deleted after a stale update and cloud merge, with another account isolated',async()=>{
 const store=await import('../miningLibraryStore'),old=payload().mining!;expect(await store.updateMiningLibrary('a',()=>old)).toBe(true);expect(await store.updateMiningLibrary('a',l=>deleteMiningRecords(l,['mined'],2000))).toBe(true);
 await store.updateMiningLibrary('a',()=>old);expect((await store.loadMiningLibraryForTransfer('a')).records).toEqual([]);await store.miningLibraryAccountBlob.mergeRemote!('a',old);expect((await store.loadMiningLibraryForTransfer('a')).anchors[0].recordIds).toEqual([]);
 await store.updateMiningLibrary('b',()=>old);expect((await store.loadMiningLibraryForTransfer('b')).records).toHaveLength(1);
});
