import {beforeEach,expect,it,vi} from 'vitest';
import type {PreEntryTableClears} from '../preEntryTableClears';
const mock=vi.hoisted(()=>({read:vi.fn(),write:vi.fn(),note:vi.fn(),sync:vi.fn(),snapshot:vi.fn(),persist:vi.fn()}));
vi.mock('@/lib/accountBlobSync',()=>({noteAccountBlobSaved:mock.note,syncAccountBlobOnLoad:mock.sync}));
vi.mock('../preEntryPersistence',()=>({readPreEntryTableClears:mock.read,writePreEntryTableClears:mock.write,readPreEntrySnapshot:mock.snapshot,validPreEntryLibrary:()=>true}));
vi.mock('../preEntryPersistenceClient',()=>({persistPreEntrySnapshot:mock.persist}));
import {savePreEntryTableClears,preEntryTableClearsAccountBlob,loadPreEntryLibraryV6} from '../preEntryMonitorV6Store';
beforeEach(()=>{vi.clearAllMocks();mock.sync.mockResolvedValue('unchanged');mock.read.mockResolvedValue({});mock.write.mockResolvedValue(undefined);mock.note.mockResolvedValue(undefined);mock.snapshot.mockResolvedValue({version:1,records:[],rounds:[]});});
it('backs up only the small independent markers and never checkpoints the full screening library',async()=>{
 const marks:PreEntryTableClears={a:10,b:20};await savePreEntryTableClears('alice',marks);
 expect(mock.write).toHaveBeenCalledWith('alice',marks);expect(mock.note).toHaveBeenCalledWith(preEntryTableClearsAccountBlob,'alice');expect(preEntryTableClearsAccountBlob.name).toBe('pre-entry-table-clears-v1');expect(mock.persist).not.toHaveBeenCalled();expect(mock.snapshot).not.toHaveBeenCalled();
});
it('reports failed saves before backup notification and merges restored marks through the same monotonic writer',async()=>{
 mock.write.mockRejectedValueOnce(Error('磁盘繁忙'));await expect(savePreEntryTableClears('alice',{a:10})).rejects.toThrow('磁盘繁忙');expect(mock.note).not.toHaveBeenCalled();
 await preEntryTableClearsAccountBlob.mergeRemote!('alice',{a:20},{preferRemote:true});expect(mock.write).toHaveBeenLastCalledWith('alice',{a:20});
 await expect(preEntryTableClearsAccountBlob.write('alice',{a:NaN})).rejects.toThrow('格式无效');
});
it('restores the independent clear marks before returning the screening library',async()=>{
 await loadPreEntryLibraryV6('alice');expect(mock.sync.mock.calls.map(([adapter])=>adapter.name)).toEqual(['pre-entry-monitor-v6','pre-entry-table-clears-v1']);expect(mock.snapshot).toHaveBeenCalledOnce();
});
