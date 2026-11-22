// @vitest-environment node
import {beforeEach,expect,it,vi} from 'vitest';
import {publishMiningBrowse} from '../libraryBrowsePublisher';
import {emptyMiningLibrary} from '../miningLibrary';
import {miningSeriesCatalogKey,miningSeriesRevisionKey} from '../libraryBrowse';

const calls=vi.hoisted(()=>({writes:[] as {key:string;value:any}[],fail:''}));
const revisions={'idb:fish-mining-library':'m1','idb:fish-mining-deletions-v1':'d1','idb:fish-quality':'q1'};
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>({upsert:async(row:any)=>{
 const rows=Array.isArray(row)?row:[row];calls.writes.push(...rows);
 return {error:calls.fail&&rows.some((r:any)=>r.key===calls.fail||calls.fail==='/refs'&&r.key.endsWith('/refs'))?{message:'offline'}:null};
}})}}));
vi.mock('@/lib/accountBlobSync',()=>({syncedImmutableAccountBlobRevision:async(key:string)=>key.includes('deletions')?'d1':'m1'}));
vi.mock('@/lib/accountSyncTransport',()=>({runAccountSyncRequest:async(read:()=>Promise<unknown>)=>read()}));
vi.mock('../directoryTrash',()=>({retiredDirectoryIds:async()=>new Set()}));
vi.mock('../qualityRecentLibraryStore',()=>({readRecentMonitorDirectory:async()=>({sourceRevision:'q1',edits:{}})}));
vi.mock('../libraryBrowse',async()=>({...await vi.importActual('../libraryBrowse'),readBrowseCatalog:async()=>undefined,
 readBrowseRevisions:async()=>({'idb:fish-mining-library':'m1','idb:fish-mining-deletions-v1':'d1','idb:fish-quality':'q1'})}));
const library=()=>({...emptyMiningLibrary(),records:[{id:'saved',runId:'run',catchKey:'saved',anchorMs:2,firstSavedAt:3,updatedAt:3,
 signal:{id:'signal',symbol:'BTCUSDT',timeMs:1,timeLabel:'',fallbackZone:'',fish:{featureId:'bss',featureShort:'BSS',statistic:'avg_BSS_2',average:0,scale:1,cbi2:0,startAverage:0,previousAverage:0,cutoffMs:1,direction:'>' as const,threshold:-1}}}]});
beforeEach(()=>{calls.writes=[];calls.fail='';});
it('stages pages and purge references before publishing subtype metadata, keeping legacy parent pages readable',async()=>{
 const source=library(),before=structuredClone(source);
 await publishMiningBrowse('owner',source);
 const index=calls.writes.find(row=>row.key===miningSeriesCatalogKey())!,parent=index.value.browse.groups[0];
 expect(parent.children.map((c:any)=>[c.title,c.count])).toEqual([['原值',0],['avg',0],['avg-2',1]]);
 expect(parent.pages).toEqual(parent.children[2].pages);
 const refs=calls.writes.find(row=>row.key.endsWith('/refs'))!;
 expect(refs.value.browse.version).toBeUndefined();expect(refs.value.browse.groups[0].pages).toEqual(parent.children[2].pages);
 expect(calls.writes.indexOf(refs)).toBeLessThan(calls.writes.indexOf(index));
 expect(calls.writes.some(row=>row.key==='idb:fish-library-browse-v1/mining')).toBe(false);
 expect(source).toEqual(before);
});
it.each(['/refs',miningSeriesRevisionKey(revisions)])('does not publish the current directory after a staged write fails (%s)',async failure=>{
 calls.fail=failure;await publishMiningBrowse('owner',library());
 expect(calls.writes.some(row=>row.key===miningSeriesCatalogKey())).toBe(false);
});
