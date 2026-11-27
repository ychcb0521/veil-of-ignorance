// @vitest-environment node
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { diskRounds, readDiskPage, validDiskRound, type DiskRound, type MonitorFolder } from '../localMonitorFiles';

const owner='one', id='monitor-123';
const bytes=gzipSync(JSON.stringify([{id:id+':1',source:{symbol:'TEST'}}]));
const digest=createHash('sha256').update(bytes).digest('hex');
const round:DiskRound={version:1,owner,id,at:123,title:'test',count:1,bodyId:'recent-v1-'+digest,
  data:digest+'.vmon',pageSize:32,pages:[[0,bytes.length,digest]],settings:[bytes.length,10,digest]};
const file=new File([Buffer.from(bytes)],'round');

describe('disk monitor round',()=>{
  it('reads only the selected range and detects truncation, corruption and foreign rows',async()=>{
    expect((await readDiskPage(file,round,0))[0].source.symbol).toBe('TEST');
    await expect(readDiskPage(new File([],'short'),round,0)).rejects.toThrow('不完整');
    await expect(readDiskPage(file,{...round,pages:[[0,bytes.length,'0'.repeat(64)]]},0)).rejects.toThrow('校验失败');
    await expect(readDiskPage(file,{...round,id:'monitor-other'},0)).rejects.toThrow('轮次不符');
  });
  it('isolates accounts and never opens data files when listing the directory',async()=>{
    expect(validDiskRound({...round,data:'../other'},owner)).toBe(false);
    const folder={async *values(){for(const [n,o] of [owner,'two'].entries())yield {
      kind:'file',name:String(n).repeat(64)+'.index.json',
      getFile:async()=>new File([JSON.stringify({...round,owner:o})],'index')};
      yield {kind:'file',name:round.data,getFile:()=>{throw Error('unexpected read');}};}};
    expect(await diskRounds(folder as unknown as MonitorFolder,owner)).toEqual([round]);
  });
});
