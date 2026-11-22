// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest';
import {rebuildHistoricalScreenCatalog} from '../historicalScreenBrowse';
import {emptyPreEntryLibrary} from '../preEntryMonitor';

const mocks=vi.hoisted(()=>({blob:vi.fn(),directory:vi.fn(),revisions:vi.fn(),page:vi.fn(),save:vi.fn()}));
vi.mock('../../accountBlobSync',()=>({readImmutableAccountBlobForVerification:mocks.blob}));
vi.mock('../preEntryMonitorV5Store',()=>({preEntryV5AccountBlob:{name:'v5'}}));
vi.mock('../preEntryMonitorV6Store',()=>({preEntryTableClearsAccountBlob:{name:'clears'}}));
vi.mock('../qualityRecentLibraryStore',()=>({readRecentMonitorDirectory:mocks.directory}));
vi.mock('../libraryBrowse',async original=>({...await original<typeof import('../libraryBrowse')>(),readBrowseRevisions:mocks.revisions}));
vi.mock('../libraryBrowsePublisher',()=>({writeBrowsePage:mocks.page}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({upsert:(row:unknown,options:unknown)=>({abortSignal:(signal:AbortSignal)=>mocks.save(row,options,signal)})})}}));
const rev={'idb:pre-entry-monitor-v5':'v','idb:pre-entry-table-clears-v1':'c','idb:fish-quality':'q'};
beforeEach(()=>{
 vi.resetAllMocks();
 const library={...emptyPreEntryLibrary(),rounds:[{id:'r',startedAt:123}],records:[{id:'a',roundId:'r',status:'matched',sample:{source:{symbol:'BTC',timeMs:123}}}]};
 mocks.blob.mockImplementation(async adapter=>adapter.name==='v5'?{value:library,revision:'v'}:{value:{a:42},revision:'c'});
 mocks.directory.mockResolvedValue({sourceRevision:'q',edits:{r:{name:'旧轮次'}}});
 mocks.revisions.mockResolvedValue(rev);mocks.page.mockResolvedValue('hash');mocks.save.mockResolvedValue({error:null});
});
it('publishes only the verified version-specific directory after writing its pages',async()=>{
 const signal=new AbortController().signal;
 await rebuildHistoricalScreenCatalog('owner',signal);
 expect(mocks.page).toHaveBeenCalledWith('owner',[['BTC',123,'已入选 · 组合表已清除','a']],signal);
 expect(mocks.save).toHaveBeenCalledWith({user_id:'owner',key:'idb:fish-library-browse-v1/full/screen/v/c/q',value:{browse:{
   version:1,owner:'owner',scope:'screen',revisions:rev,groups:[{id:'r',title:'旧轮次',at:123,count:1,pages:['hash']}],
 }}},{onConflict:'user_id,key',ignoreDuplicates:true},signal);
});
it('does not expose a directory if the source changes during publication',async()=>{
 mocks.revisions.mockResolvedValueOnce(rev).mockResolvedValueOnce({...rev,'idb:pre-entry-monitor-v5':'changed'});
 await expect(rebuildHistoricalScreenCatalog('owner',new AbortController().signal)).rejects.toThrow('已更新');
 expect(mocks.save).not.toHaveBeenCalled();
});
it('never writes a directory after an incomplete page or cancellation',async()=>{
 mocks.page.mockResolvedValue(undefined);
 await expect(rebuildHistoricalScreenCatalog('owner',new AbortController().signal)).rejects.toThrow('记录页未保存');
 await expect(rebuildHistoricalScreenCatalog('owner',AbortSignal.abort())).rejects.toThrow();
 expect(mocks.save).not.toHaveBeenCalled();
});
