import {expect,it,vi,afterEach} from 'vitest';
import {serializePreEntryLibraryChunks} from '../preEntryArchiveStream';
import {serializeAccountBlob} from '../../accountBlobCodec';
import type {PreEntryLibrary,PreEntryRecord} from '../preEntryMonitor';
const restore=vi.hoisted(()=>vi.fn());
vi.mock('../preEntryArchive',()=>({restorePreEntryRecord:restore}));
afterEach(()=>vi.resetAllMocks());
it('restores one frozen body at a time and emits the original public shape without private references',async()=>{
  const rows=Array.from({length:30},(_,i)=>({id:String(i),status:'paused',processRef:{key:String(i),entries:1000}} as PreEntryRecord));
  const full=rows.map(({processRef,...r})=>({...r,exclusionProcess:{version:1,startedAt:1,entries:[{from:1,through:2,reason:'保留原文 '+processRef!.key}]}}));
  let live=0,maxLive=0;
  restore.mockImplementation(async(r:PreEntryRecord)=>{live++;maxLive=Math.max(maxLive,live);await Promise.resolve();live--;return full[Number(r.id)];});
  const value={version:1,rounds:[],records:rows,settings:{updatedAt:1,plans:[],hours:48}} as PreEntryLibrary;
  let text='';for await(const part of serializePreEntryLibraryChunks(value))text+=part;
  expect(text).toBe(serializeAccountBlob({...value,records:full}));expect(text).not.toContain('processRef');expect(maxLive).toBe(1);expect(rows[0].processRef!.key).toBe('0');
});
