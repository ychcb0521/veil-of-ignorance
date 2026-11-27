/** Write native background results first, then atomically replace the account's local directory.
 * Callers provide the frozen native record and the same group IDs used by the web directory.
 * The returned header is the only payload needed at idb:fish-local-result-directory-v1/<scope>.
 */
import {createHash} from 'node:crypto';
import {closeSync,existsSync,readFileSync,mkdtempSync,mkdirSync,openSync,readSync,renameSync,statSync,unlinkSync,writeFileSync,writeSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digestFile=path=>{
  const fd=openSync(path,'r'), digest=createHash('sha256'), buffer=Buffer.alloc(1024*1024);
  try {let n;while((n=readSync(fd,buffer))>0)digest.update(buffer.subarray(0,n));}
  finally {closeSync(fd);}
  return digest.digest('hex');
};
export function writeResultArchive({root,owner,scope,revision,savedAt,source,revisions,merge=false},produce){
  if(!/^[a-z0-9-]+$/i.test(owner)||!['mining','filter','screen'].includes(scope)||!revision||!Number.isSafeInteger(savedAt))
    throw Error('Invalid archive identity');
  mkdirSync(root,{recursive:true});
  const temp=mkdtempSync(join(root,'.result-')),writers=new Map(),lock=join(root,'veil-'+scope+'-'+owner+'.lock');
  let locked=false;
  function block(writer,value){
    const bytes=gzipSync(JSON.stringify(value),{level:4}),part=[writer.offset,bytes.length,hash(bytes)];
    let n=0;while(n<bytes.length)n+=writeSync(writer.fd,bytes,n,bytes.length-n);
    writer.offset+=n;return part;
  }
  function group(meta,settings){
    if(typeof meta?.id!=='string'||!meta.id||typeof meta.title!=='string'||!Number.isSafeInteger(meta.at))
      throw Error('Invalid directory metadata');
    if(writers.has(meta.id))throw Error('Duplicate directory '+meta.id);
    const path=join(temp,String(writers.size)),fd=openSync(path,'wx');
    const w={meta,settings,path,fd,offset:0,buffer:[],pages:[],count:0};
    writers.set(meta.id,w);
    return row=>{
      if(typeof row?.record?.id!=='string'||typeof row.symbol!=='string'||!Number.isFinite(row.time)||typeof row.summary!=='string')
        throw Error('Invalid native record in '+meta.id);
      w.count++;w.buffer.push(row);
      if(w.buffer.length===32){w.pages.push(block(w,w.buffer));w.buffer=[];}
    };
  }
  return (async()=>{
    try{
      const guard=openSync(lock,'wx');locked=true;closeSync(guard);
      await produce(group);
      const groups=[];
      for(const w of writers.values()){
        if(w.buffer.length)w.pages.push(block(w,w.buffer));
        const settings=block(w,typeof w.settings==='function'?w.settings():w.settings);
        closeSync(w.fd);w.fd=undefined;
        const digest=digestFile(w.path),data=digest+'.vlib',dest=join(root,data);
        const fd=openSync(w.path,'r');let rows=0;
        try{for(const [offset,size,expected] of [...w.pages,settings]){
          const bytes=Buffer.alloc(size);
          if(readSync(fd,bytes,0,size,offset)!==size||hash(bytes)!==expected)throw Error('Block verification failed');
          const value=JSON.parse(gunzipSync(bytes));if(offset!==settings[0])rows+=value.length;
        }}finally{closeSync(fd);}
        if(rows!==w.count)throw Error('Record count mismatch');
        if(existsSync(dest)){if(statSync(dest).size!==w.offset||digestFile(dest)!==digest)throw Error('Existing file differs');}
        else renameSync(w.path,dest);
        const {id,title,at,parent}=w.meta;
        groups.push({id,title,at,parent,revisions,count:w.count,data,pages:w.pages,settings});
      }
      const index='veil-'+scope+'-'+owner+'.json',current=join(root,index);
      if(existsSync(current)){
        const previousBytes=readFileSync(current),previous=JSON.parse(previousBytes);
        if(previous.version!==1||previous.owner!==owner||previous.scope!==scope||previous.savedAt>=savedAt)
          throw Error('Existing directory changed; re-read before retrying');
        if(merge){const replaced=new Set(groups.map(g=>g.id));groups.push(...previous.groups.filter(g=>!replaced.has(g.id)).map(g=>({...g,revisions:g.revisions??previous.revisions??{}})));}
        const prior=join(root,'snapshot-'+hash(previousBytes)+'.json');
        if(!existsSync(prior))writeFileSync(prior,previousBytes,{flag:'wx'});
      }
      const manifest={version:1,owner,scope,source,revisions,revision,savedAt,groups};
      writeFileSync(join(temp,'index'),JSON.stringify(manifest));renameSync(join(temp,'index'),join(root,index));
      return {...manifest,groups:groups.map(({pages,settings,...meta})=>meta)};
    }finally{
      for(const w of writers.values())if(w.fd!==undefined)closeSync(w.fd);
      rmSync(temp,{recursive:true,force:true});if(locked)unlinkSync(lock);
    }
  })();
}
