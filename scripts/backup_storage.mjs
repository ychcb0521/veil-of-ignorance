#!/usr/bin/env node
// Source GET/POST-list only; never uploads, removes, or changes bucket settings.
import {mkdir,writeFile,open} from 'node:fs/promises';
import {dirname,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const origin=process.env.SOURCE_SUPABASE_URL,key=process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY;
if(!origin||!key){console.error('Missing SOURCE_SUPABASE_URL or SOURCE_SUPABASE_SERVICE_ROLE_KEY. Do not paste secrets into chat.');process.exit(2);}
const api=new URL(origin);if(api.protocol!=='https:'||!api.hostname.endsWith('.supabase.co')||api.username||api.password||api.pathname!=='/')throw Error('Expected a hosted Supabase project origin');
const stamp=new Date().toISOString().replaceAll(':','-');
const destination=resolve(root,'backups',stamp,'storage');
await mkdir(destination,{recursive:true,mode:0o700});
const headers={apikey:key,Authorization:`Bearer ${key}`};
async function request(path,options={}){const response=await fetch(new URL(path,api),{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Storage request failed with HTTP '+response.status);return response;}
const buckets=await(await request('/storage/v1/bucket')).json();
if(!Array.isArray(buckets))throw Error('Invalid bucket listing; backup not complete');
const manifest={created_at:new Date().toISOString(),complete:false,buckets:[],files:[]};
function safePath(bucket,name){if(!bucket||[bucket,...name.split('/')].some(p=>!p||p==='.'||p==='..'||p.includes('\\')||p.includes('\0')))throw Error('Unsafe object path');const result=resolve(destination,bucket,...name.split('/'));const rel=relative(destination,result);if(rel.startsWith('..'+sep)||rel==='..')throw Error('Object path escaped backup directory');return result;}
for(const bucket of buckets){
  manifest.buckets.push({id:bucket.id,name:bucket.name,public:bucket.public,file_size_limit:bucket.file_size_limit,allowed_mime_types:bucket.allowed_mime_types});
  const queue=[''];
  while(queue.length){const prefix=queue.shift();let offset=0;
    while(true){const page=await(await request('/storage/v1/object/list/'+encodeURIComponent(bucket.id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefix,limit:1000,offset,sortBy:{column:'name',order:'asc'}})})).json();if(!Array.isArray(page))throw Error('Invalid object listing');
      for(const item of page){const name=prefix?prefix+'/'+item.name:item.name;if(item.id==null){safePath(bucket.id,name);queue.push(name);continue;}
        const path=safePath(bucket.id,name);await mkdir(dirname(path),{recursive:true,mode:0o700});
        const response=await request('/storage/v1/object/'+encodeURIComponent(bucket.id)+'/'+name.split('/').map(encodeURIComponent).join('/'));const data=Buffer.from(await response.arrayBuffer());
        const handle=await open(path,'wx',0o600);try{await handle.writeFile(data);}finally{await handle.close();}
        manifest.files.push({bucket:bucket.id,path:name,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),content_type:response.headers.get('content-type'),cache_control:response.headers.get('cache-control')});}
      if(page.length<1000)break;offset+=page.length;
    }
  }
}
manifest.complete=true;await writeFile(resolve(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({complete:true,buckets:manifest.buckets.length,files:manifest.files.length}));
