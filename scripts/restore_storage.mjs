#!/usr/bin/env node
// Default: local validation only. --apply uploads missing objects; never overwrites/deletes.
import {readFile,realpath} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), apply=args.includes('--apply');
const pos=args.indexOf('--manifest');
if(pos<0||!args[pos+1]||args.some((a,i)=>!['--manifest','--apply'].includes(a)&&i!==pos+1))throw Error('Usage: node scripts/restore_storage.mjs --manifest /absolute/storage/manifest.json [--apply]');
const manifestPath=await realpath(resolve(args[pos+1]));
const base=dirname(manifestPath),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
if(manifest.complete!==true||!Array.isArray(manifest.buckets)||!Array.isArray(manifest.files))throw Error('Storage backup is incomplete');
const target=JSON.parse(await readFile(resolve(root,'deployment-target.json'),'utf8')).supabaseProjectId;
if(target!=='elynuzxnvjzypjgzkemc')throw Error('Unexpected migration destination');
const excluded=new Set(manifest.buckets.filter(b=>b.migration_artifact===true||b.id.startsWith('database_export_')).map(b=>b.id));
const files=manifest.files.filter(f=>!excluded.has(f.bucket));
const buckets=manifest.buckets.filter(b=>!excluded.has(b.id));
const validated=[];
for(const f of files){
 if(!buckets.some(b=>b.id===f.bucket)||[f.bucket,...String(f.path).split('/')].some(s=>!s||s==='.'||s==='..'||s.includes('\\')||s.includes('\0')))throw Error('Invalid storage path');
 const local=await realpath(resolve(base,f.bucket,f.path)),rel=relative(base,local);
 if(rel==='..'||rel.startsWith('..'+sep))throw Error('Storage path escapes backup');
 const data=await readFile(local);
 if(data.length!==f.bytes||createHash('sha256').update(data).digest('hex')!==f.sha256)throw Error('Local storage checksum mismatch');
 validated.push({f,data});
}
if(!apply){console.log(JSON.stringify({mode:'dry-run',complete:true,buckets:buckets.length,files:files.length,excluded_artifact_buckets:excluded.size}));process.exit(0);}
const origin=process.env.TARGET_SUPABASE_URL,key=process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
if(origin!==`https://${target}.supabase.co`||!key||key.startsWith('sb_publishable_'))throw Error('Missing target-only server credentials; no uploads attempted');
const headers={apikey:key,Authorization:`Bearer ${key}`};
async function request(path,opts={}){return fetch(origin+path,{...opts,headers:{...headers,...opts.headers},signal:AbortSignal.timeout(120000)});}
const listing=await request('/storage/v1/bucket');
if(!listing.ok)throw Error('Cannot read target bucket configuration: HTTP '+listing.status);
const existing=await listing.json();
for(const b of buckets){
 const a=existing.find(x=>x.id===b.id);
 // Bucket metadata was restored with the database. Refuse to guess or change access settings.
 if(!a||a.public!==b.public||a.file_size_limit!==b.file_size_limit||JSON.stringify(a.allowed_mime_types??null)!==JSON.stringify(b.allowed_mime_types??null))throw Error('Target bucket missing or permissions differ; stopped before uploads');
}
let uploaded=0,unchanged=0;
for(const {f,data} of validated){
 const path='/storage/v1/object/'+encodeURIComponent(f.bucket)+'/'+f.path.split('/').map(encodeURIComponent).join('/');
 const old=await request(path);
 if(old.ok){const current=Buffer.from(await old.arrayBuffer());if(createHash('sha256').update(current).digest('hex')!==f.sha256)throw Error('Existing target object differs; refusing overwrite');unchanged++;continue;}
 if(old.status!==400&&old.status!==404)throw Error('Target object check failed: HTTP '+old.status);
 const result=await request(path,{method:'POST',headers:{'Content-Type':f.content_type||'application/octet-stream','x-upsert':'false',...(f.cache_control?{'Cache-Control':f.cache_control}:{})},body:data});
 if(!result.ok)throw Error('Upload failed without overwrite: HTTP '+result.status);
 const verify=await request(path);if(!verify.ok||createHash('sha256').update(Buffer.from(await verify.arrayBuffer())).digest('hex')!==f.sha256)throw Error('Uploaded object verification failed');
 uploaded++;
}
console.log(JSON.stringify({complete:true,uploaded,unchanged,excluded_artifact_buckets:excluded.size}));
