// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {writeResultArchive} from '../../../../scripts/result_library_writer.mjs';
import {resultIndex,resultPage} from '../localResultFiles';
import {readBlock,type MonitorFolder} from '../localMonitorFiles';

let root:string;
const owner='account-one', scope='filter' as const;
const config={owner,scope,revision:'first',revisions:{filter:'first'},savedAt:1};
const meta={id:'round-one',title:'模板',at:12};
const settings={formula:'v2',threshold:1.5};
const row=(id:number)=>({time:id,symbol:'TEST',summary:'通过',record:{id:String(id),native:{reading:3}}});
const folder=(nameOverride?:string)=>({getFileHandle:async(name:string)=>({getFile:async()=>new File([await readFile(join(root,nameOverride??name))],name)})}) as unknown as MonitorFolder;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'veil-result-test-'));});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});

describe('local result directory',()=>{
  it('preserves native settings and records across page boundaries and rejects a damaged page or foreign index',async()=>{
    const header=await writeResultArchive({root,...config},make=>{
      const append=make(meta,settings);
      for(let i=0;i<33;i++)append(row(i));
    });
    expect(header.groups[0]).not.toHaveProperty('pages');
    const index=await resultIndex(folder(),owner,scope);
    const group=index!.groups[0];
    const file=await (await folder().getFileHandle(group.data)).getFile();
    expect(await readBlock(file,group.settings)).toEqual(settings);
    expect(await resultPage(file,group,0)).toHaveLength(32);
    expect(await resultPage(file,group,1)).toEqual([row(32)]);
    const bytes=new Uint8Array(await file.arrayBuffer());
    bytes[group.pages[1][0]]^=255;
    await expect(resultPage(new File([bytes],'damaged'),group,1)).rejects.toThrow('校验失败');
    await expect(resultIndex(folder('veil-filter-'+owner+'.json'),'account-two',scope)).rejects.toThrow('账号');
  });
  it('keeps older directories and their revisions during a merge and preserves the last valid index on failure',async()=>{
    await writeResultArchive({root,...config},make=>make(meta,settings)(row(0)));
    const next={...config,revision:'second',revisions:{filter:'second'},savedAt:2};
    const header=await writeResultArchive({root,...next,merge:true},make=>make({...meta,id:'round-two'},settings)(row(1)));
    expect(header.groups.map(group=>[group.id,group.revisions.filter])).toEqual([['round-two','second'],['round-one','first']]);
    const index=await resultIndex(folder(),owner,scope);
    await expect(writeResultArchive({root,...next,savedAt:3},make=>make(meta,settings)({}))).rejects.toThrow('native record');
    expect(await resultIndex(folder(),owner,scope)).toEqual(index);
    await expect(writeResultArchive({root,...config},()=>{})).rejects.toThrow('Existing directory changed');
  });
});
