import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Optional private fixture is only sent to this ephemeral loopback origin.
const sample = Object.fromEntries(['trade_history','cancelled_orders','filled_orders','trade_campaigns','campaign_counterfactuals'].map((key,i) =>
  ['sim_example_'+key,JSON.stringify(Array.from({length:2000},(_,j)=>({id:i+'-'+j,value:'交易原文'})))]));
const data = process.env.HISTORY_QA_FIXTURE ? JSON.parse(await readFile(process.env.HISTORY_QA_FIXTURE,'utf8')) : sample;
const bytes = (await build({stdin:{contents:`
import {prepareTradeHistory} from './src/lib/tradeHistoryStorage';
import {readPersistedStateRaw as read,writePersistedStateRaw as write,removePersistedStateRaw as drop} from './src/lib/persistedStateStorage';
import {prepareLoginStorage,isolatedLoginOptions} from './src/lib/loginStorage';
import {getUserId} from './src/lib/userStoragePrefix';

Object.assign(window,{prepareTradeHistory,read,write,drop,getUserId});
`, resolveDir:process.cwd()},bundle:true,write:false,format:'iife',
 define:{'import.meta.env.PROD':'false','import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://fixture.supabase.co'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('fixture')},
})).outputFiles[0].contents;
const auth = (await build({stdin:{contents:`
import {prepareLoginStorage} from './src/lib/loginStorage';
prepareLoginStorage();
const {supabase} = require('./src/integrations/supabase/client');
window.login=()=>supabase.auth.signInWithPassword({email:'qa@example.invalid',password:'fixture-password'});
window.session=()=>supabase.auth.getSession();
`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',define:{'import.meta.env.PROD':'false','import.meta.env.VITE_SUPABASE_URL':JSON.stringify('https://fixture.supabase.co'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('fixture')}})).outputFiles[0].contents;
const worker = await readFile('public/history-windows.js');
const server=createServer(async (req,res)=>{
  if(req.url==='/app' || /^\/assets\/[\w.-]+$/.test(req.url)){
    try {
      const file=req.url==='/app'?'index.html':req.url.slice(1);
      const contents=await readFile('dist/'+file);
      res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
      res.end(contents);return;
    }catch{res.writeHead(404);res.end();return;}
  }
  const asset={'/history-windows.js':worker,'/code':bytes,'/auth':auth}[req.url];
  res.writeHead(200,{'content-type':asset?'application/javascript':'text/html','cache-control':'no-store'});
  res.end(asset??'<!doctype html><title>History isolation test</title>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try {
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
 const context=await browser.newContext();
 const user={id:'c8fe237c-0667-4139-92ed-68044c4bc61d',aud:'authenticated',email_confirmed_at:'2026-01-01T00:00:00Z',email:'qa@example.invalid',user_metadata:{},app_metadata:{}};
 await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('/profiles'))return route.fulfill({json:{user_id:user.id,is_initialized:false}});
   if(url.pathname.endsWith('/token')) return route.fulfill({json:{access_token:'qa.access.token',refresh_token:'qa-refresh',expires_in:3600,token_type:'bearer',user}});
   if(url.origin===origin)return route.continue();
   return route.abort();
 });
 context.setDefaultTimeout(15000);
 const old=await context.newPage();await old.goto(origin);
 await old.evaluate(data=>{for(const [k,v] of Object.entries(data))localStorage.setItem(k,v);
   for(let n=1<<20;n>=1;n>>=1){try{localStorage.setItem('fixture-space',(localStorage.getItem('fixture-space')??'')+'x'.repeat(n));n*=2;}catch{}}
 },data);
 const keys=Object.keys(data), key=keys[0];
 const check=async(page,reader,values)=>assert.equal(await page.evaluate(({reader,values})=>Object.entries(values).every(([key,value])=>(reader==='legacy'?localStorage.getItem(key):window.read(key))===value),{reader,values}),true,'exact history comparison');
 const page=await context.newPage();await page.goto(origin);const load=()=>page.addScriptTag({url:origin+'/code'});await load();
 await page.evaluate(()=>window.prepareTradeHistory());await check(old,'legacy',data);
 await page.addScriptTag({url:origin+'/auth'});assert.equal(await page.evaluate(async()=>(await window.login()).data.user?.id),user.id);
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('sb-tab-')).length),1);
 await page.reload();await load();await page.addScriptTag({url:origin+'/auth'});
 assert.equal(await page.evaluate(async()=>(await window.session()).data.session?.user.id),user.id);
 const before=data[key];data[key]=JSON.stringify(JSON.parse(before).slice(1));
 await old.evaluate(([k,v])=>localStorage.setItem(k,v),[key,data[key]]);await check(page,'current',data);
  await old.evaluate(()=>{
   for(let n=8192;n>=1;n>>=1){try{localStorage.setItem('fixture-space',localStorage.getItem('fixture-space')+'x'.repeat(n));n*=2;}catch{}}
 });
 const ui=await context.newPage();
 await ui.goto(origin+'/app');
 await ui.locator('input[type=email]').fill('qa@example.invalid');
 await ui.locator('input[type=password]').fill('fixture-password');
 await ui.locator('form button[type=submit]').click();
 console.log('Login form submitted');
 await ui.locator('input[type=email]').waitFor({state:'detached'});
 assert.equal(await ui.evaluate(()=>Object.keys(sessionStorage).some(k=>k.startsWith('sb-tab-')&&JSON.parse(sessionStorage[k]).user.id==='c8fe237c-0667-4139-92ed-68044c4bc61d')),true);
 await check(old,'legacy',data);await ui.close();
 console.log('Legacy and isolated UI login verified');
 await old.close();
 await page.evaluate(async()=>{
   const original=IDBObjectStore.prototype.add; IDBObjectStore.prototype.add=function(){throw Error('fixture interruption');};
   try{await window.prepareTradeHistory();}finally{IDBObjectStore.prototype.add=original;}
 });
 await check(page,'legacy',data);
 await page.evaluate(()=>window.prepareTradeHistory());
 assert.equal(await page.evaluate(keys=>keys.every(k=>localStorage.getItem(k).startsWith('@veil/history/1:')),keys),true);
 await check(page,'current',data);
 // Clear the test tab's isolated login, then exercise normal shared-session login.
 await page.evaluate(()=>sessionStorage.clear());await page.reload();await load();await page.evaluate(()=>window.prepareTradeHistory());
 await page.addScriptTag({url:origin+'/auth'});assert.equal(await page.evaluate(async()=>(await window.login()).data.user?.id),user.id);
 assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('sb-')&&k.endsWith('-auth-token'))),true);
 const peer=await context.newPage();await peer.goto(origin);await peer.addScriptTag({url:origin+'/code'});await peer.evaluate(()=>window.prepareTradeHistory());
 for(const k of keys){data[k]=JSON.stringify([...JSON.parse(data[k]),{id:'qa-edit',note:'多标签页写入'}]);
   assert.equal(await page.evaluate(([k,v])=>window.write(k,v),[k,data[k]]),true);}
 await check(peer,'current',data);
 await peer.reload();await peer.addScriptTag({url:origin+'/code'});await peer.evaluate(()=>window.prepareTradeHistory());await check(peer,'current',data);
 const peerKey=keys[1];data[peerKey]=JSON.stringify(JSON.parse(data[peerKey]).slice(1));
 assert.equal(await peer.evaluate(([k,v])=>window.write(k,v),[peerKey,data[peerKey]]),true);
 await check(page,'current',data);
 console.log('Bidirectional read/write verified');
 await peer.close();
 await page.evaluate(()=>window.prepareTradeHistory());
 // A small edit can remain in the synchronous journal until its next checkpoint.
 const updated=JSON.stringify([...JSON.parse(data[key]),{id:'qa-final'}]);
 await page.evaluate(([k,v])=>window.write(k,v),[key,updated]);data[key]=updated;
 await page.waitForFunction(async ({key,raw})=>{
   const marker=localStorage.getItem(key);
   if(!marker?.startsWith('@veil/history/1:'))return false;
   const [id]=JSON.parse(marker.slice('@veil/history/1:'.length));
   return await new Promise(resolve=>{
     const r=indexedDB.open('veil-trade-history');r.onsuccess=()=>{
       const db=r.result;const tx=db.transaction('bases');const get=tx.objectStore('bases').get(key+'/'+id);
       tx.oncomplete=()=>{db.close();resolve(get.result===raw);};
     };
   });
 },{key,raw:updated});
 console.log('PASS: full quota, old-tab read/write, isolated and normal SDK login, interrupted copy, exact readback, edits and reload');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
