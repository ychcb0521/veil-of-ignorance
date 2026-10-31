import {SBS5M_ID,SBS5M_VERSION,Sbs5mEngine,type SbsCheckpoint,type SbsOptions,type SbsBar} from './sbs5m';
import {getUserPrefix} from './userStoragePrefix';
const DATABASE='veil-sbs5m-state-v1',STORE='checkpoints';
type Identity=Pick<SbsCheckpoint,'config_hash'|'symbol'|'timeframe'|'data_source'|'data_version'|'volume_mode'|'tick_size'|'initialization_id'>;
export const sbsCheckpointKey=(c:Identity)=>getUserPrefix()+JSON.stringify([SBS5M_ID,SBS5M_VERSION,'checkpoint-v1',c.config_hash,c.symbol,c.timeframe,c.data_source,c.data_version,c.volume_mode,c.tick_size,c.initialization_id]);
const memory=new Map<string,SbsCheckpoint>();
const durable=new Map<string,string>();
const revision=(c:SbsCheckpoint)=>String(c.last_time)+':'+c.data_checksum;
function disk(mode:IDBTransactionMode,k:string,value?:SbsCheckpoint):Promise<{value:SbsCheckpoint|null;persisted:boolean}>{
 if(typeof indexedDB==='undefined')return Promise.resolve({value:null,persisted:false});
 return new Promise(resolve=>{let database:IDBDatabase|undefined,done=false;const finish=(v:SbsCheckpoint|null,persisted=false)=>{if(done)return;done=true;clearTimeout(timer);database?.close();resolve({value:v,persisted});};
  const timer=setTimeout(()=>finish(null),5000);
  try{const request=indexedDB.open(DATABASE,1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(STORE))request.result.createObjectStore(STORE);};request.onerror=request.onblocked=()=>finish(null);
   request.onsuccess=()=>{database=request.result;if(done){database.close();return;}database.onversionchange=()=>database?.close();const tx=database.transaction(STORE,mode),store=tx.objectStore(STORE);let result:SbsCheckpoint|null=null,conflict=false;
    const get=store.get(k);get.onsuccess=()=>{const old=get.result as SbsCheckpoint|undefined;result=old??null;
     if(mode==='readwrite'&&value){if(old?.last_time===value.last_time&&old.data_checksum!==value.data_checksum){store.put(value,k+'|revised-input:'+value.data_checksum);conflict=true;return;}
      if(!old||old.last_time===null||(value.last_time??-1)>=old.last_time){store.put(value,k);result=value;}}
    };tx.oncomplete=()=>finish(result,!conflict);tx.onerror=tx.onabort=()=>finish(null);
   };
  }catch{finish(null);}
 });
}
export async function saveSbsCheckpoint(value:SbsCheckpoint):Promise<boolean>{
 const k=sbsCheckpointKey(value),old=memory.get(k);
 if(old?.last_time===value.last_time&&old.data_checksum!==value.data_checksum){await disk('readwrite',k+'|revised-input:'+value.data_checksum,value);return false;}
 const candidate=old?.last_time!==null&&old?.last_time!==undefined&&old.last_time>(value.last_time??-1)?old:structuredClone(value);
 if(durable.get(k)===revision(candidate))return true;
 memory.set(k,candidate);const result=await disk('readwrite',k,candidate);
 if(result.value)memory.set(k,result.value);
 if(result.persisted&&result.value)durable.set(k,revision(result.value));
 return result.persisted&&!!result.value&&revision(result.value)===revision(candidate);
}
export async function loadSbsCheckpoint(identity:Identity,before=Infinity):Promise<SbsCheckpoint|null>{
 const k=sbsCheckpointKey(identity),value=memory.get(k)??(await disk('readonly',k)).value;
 if(!value||value.checkpoint_version!==1||value.feature_id!==SBS5M_ID||value.feature_version!==SBS5M_VERSION||(value.last_time??Infinity)>before)return null;
 return structuredClone(value);
}
/** Durable resume requires an explicit initialization identity, rather than an arbitrary recent-six-hour seed. */
export async function resumeSbs5m(bars:readonly SbsBar[],options:SbsOptions){
 if(!options.initializationId)throw new Error('SBS-5M 恢复检查点需要明确的初始化标识');
 const empty=new Sbs5mEngine(options),identity=empty.checkpoint(),stored=options.checkpoint??await loadSbsCheckpoint(identity,bars[0]?.openTime??Infinity);
 const engine=stored?new Sbs5mEngine({...options,checkpoint:stored}):empty;
 const rows=bars.flatMap(b=>{const r=engine.push(b);return r?[r]:[];});const checkpoint=engine.checkpoint(),persisted=await saveSbsCheckpoint(checkpoint);
 return {rows,checkpoint,restored:!!stored,persisted,warning:persisted?undefined:'SBS-5M 检查点未确认写入磁盘；保留此页并导出完整结果。'};
}
