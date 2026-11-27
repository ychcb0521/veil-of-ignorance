/** Publish just the directory from a completed local archive using the signed-in account's access token.
 * node scripts/publish_local_result_directory.mjs <root> <mining|filter|screen>
 * SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_ACCESS_TOKEN must refer to the same app/account.
 */
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const [root,scope]=process.argv.slice(2);
if(!root||!['mining','filter','screen'].includes(scope))throw Error('Expected archive root and library scope');
const url=new URL(process.env.SUPABASE_URL),headers={apikey:process.env.SUPABASE_ANON_KEY,
  Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'};
async function request(path,options){
  const r=await fetch(new URL(path,url),{...options,headers:{...headers,...options?.headers}});
  if(!r.ok)throw Error('Directory request failed, HTTP '+r.status);
  const text=await r.text();return text?JSON.parse(text):null;
}
const {id:owner}=await request('/auth/v1/user');
if(!/^[a-f0-9-]{36}$/i.test(owner))throw Error('Invalid signed-in account');
const manifest=JSON.parse(await readFile(join(root,'veil-'+scope+'-'+owner+'.json'),'utf8'));
if(manifest.owner!==owner||manifest.scope!==scope||manifest.version!==1||!Array.isArray(manifest.groups))throw Error('Archive identity mismatch');
const {groups,version,revision,revisions,source,savedAt}=manifest;
const summary=[];
for(const g of groups){
  if(!/^[a-f0-9]{64}\.vlib$/.test(g.data)||g.pages.length!==Math.ceil(g.count/32))throw Error('Invalid local directory entry');
  const digest=createHash('sha256');
  for await(const bytes of createReadStream(join(root,g.data)))digest.update(bytes);
  if(digest.digest('hex')+'.vlib'!==g.data)throw Error('Incomplete local data for '+g.id);
  const {id,title,at,count,parent,data,revisions}=g;summary.push({id,title,at,count,parent,data,revisions});
}
const value=JSON.parse(JSON.stringify({version,scope,owner,revision,revisions,source,savedAt,groups:summary})),key='idb:fish-local-result-directory-v1/'+scope;
const table='/rest/v1/user_sim_state',path=table+'?user_id=eq.'+owner+'&key=eq.'+encodeURIComponent(key);
const read=async()=>(await request(path+'&select=value'))[0]?.value;
const previous=await read();
if(previous&&previous.savedAt>value.savedAt)throw Error('The account already has a newer directory');
if(!previous){
  await request(table+'?on_conflict=user_id,key',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({user_id:owner,key,value})});
}else if(previous.savedAt!==value.savedAt){
  await request(path+'&value->>savedAt=eq.'+encodeURIComponent(previous.savedAt),{method:'PATCH',body:JSON.stringify({value})});
}
const stored=await read();
const {isDeepStrictEqual}=await import('node:util');
if(!isDeepStrictEqual(stored,value))throw Error('Directory changed during publication; keep the local archive and retry from the latest directory');
console.log(scope,summary.length,'directories verified');
