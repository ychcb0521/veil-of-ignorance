import {Prs6hEngine,PRS6H_ID,type PrsCheckpoint,type PrsOptions,type PrsBar} from './prs6h';
import {getUserPrefix} from './userStoragePrefix';
const key=(c:Pick<PrsCheckpoint,'config_hash'|'symbol'|'minutes'|'data_source'|'data_version'>)=>getUserPrefix()+[PRS6H_ID,'checkpoint-v1',c.config_hash,c.symbol,c.minutes,c.data_source,c.data_version].join('|');
const memory=new Map<string,PrsCheckpoint>();
// Independent database: no schema changes, deletes or quota pressure on existing research/localStorage.
const DATABASE='veil-prs6h-state-v1';
function disk(mode:IDBTransactionMode,k:string,value?:PrsCheckpoint):Promise<PrsCheckpoint|null>{
 if(typeof indexedDB==='undefined')return Promise.resolve(null);
 return new Promise(resolve=>{let database:IDBDatabase|undefined,done=false;
  const finish=(v:PrsCheckpoint|null)=>{if(done)return;done=true;clearTimeout(timer);database?.close();resolve(v);};
  const timer=setTimeout(()=>finish(null),5000);
  try{const request=indexedDB.open(DATABASE,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('checkpoints'))request.result.createObjectStore('checkpoints');};request.onerror=request.onblocked=()=>finish(null);
   request.onsuccess=()=>{database=request.result;if(done){database.close();return;}database.onversionchange=()=>database?.close();const tx=database.transaction('checkpoints',mode),store=tx.objectStore('checkpoints');let result:PrsCheckpoint|null=null;
    // Compare in one transaction, so an older tab cannot overwrite a newer closed-bar checkpoint.
    const get=store.get(k);get.onsuccess=()=>{const previous=get.result as PrsCheckpoint|undefined;if(mode==='readwrite'&&value){if(!previous?.last_time||(value.last_time??0)>previous.last_time)store.put(value,k);result=value;}else result=previous??null;};
    tx.oncomplete=()=>finish(result);tx.onabort=tx.onerror=()=>finish(null);
   };
  }catch{finish(null);}
 });
}
/** Dedicated bounded session cache plus durable closed-bar state. */
export async function savePrsCheckpoint(c:PrsCheckpoint):Promise<void>{
 const k=key(c),previous=memory.get(k);if(previous?.last_time!=null&&previous.last_time>=(c.last_time??0))return;
 const copy=structuredClone(c);memory.set(k,copy);if(memory.size>32)memory.delete(memory.keys().next().value!);
 await disk('readwrite',k,copy);
}
export async function loadPrsCheckpoint(identity:Pick<PrsCheckpoint,'config_hash'|'symbol'|'minutes'|'data_source'|'data_version'>,before=Infinity):Promise<PrsCheckpoint|null>{
 const k=key(identity),value=memory.get(k)??await disk('readonly',k);
 if(!value||value.checkpoint_version!==1||value.feature_id!==PRS6H_ID||(value.last_time??Infinity)>before)return null;
 return structuredClone(value);
}
/** Explicit incremental consumer: old/retried closes are skipped, a future checkpoint is never applied to a past replay. */
export async function resumePrs6h(bars:readonly PrsBar[],options:PrsOptions={}){
 const empty=new Prs6hEngine(options),identity=empty.checkpoint();
 const checkpoint=options.checkpoint??await loadPrsCheckpoint(identity,bars[0]?.openTime??Infinity);
 const engine=checkpoint?new Prs6hEngine({...options,checkpoint}):empty;
 const rows=bars.filter(b=>checkpoint?.last_time==null||b.openTime+engine.step>checkpoint.last_time).flatMap(bar=>{const row=engine.push(bar);return row?[row]:[];});
 const next=engine.checkpoint();await savePrsCheckpoint(next);return {rows,checkpoint:next,restored:!!checkpoint};
}
