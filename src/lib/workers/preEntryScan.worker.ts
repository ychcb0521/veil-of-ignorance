import { collectPreEntryMonitor, type PreEntryRecord } from '../fish/preEntryMonitor';
import { screeningRecordDelta, screeningError, restoreScreeningError, type ScreeningWorkerInput, type ScreeningWorkerOutput, type ScreeningRequest } from '../fish/preEntryWorkerProtocol';
import type { FishReconstructionLoader } from '../fish/reconstruction';

const send=(message:ScreeningWorkerOutput)=>self.postMessage(message);
const aborter=new AbortController();
let requestId=0,seq=0,inFlight:number|undefined,started=false;
const replies=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();
const previous=new Map<string,PreEntryRecord>(),pending=new Map<string,PreEntryRecord>();
let drained:(()=>void)|undefined;
function drain(){
  if(inFlight!=null)return;
  const first=pending.entries().next().value as [string,PreEntryRecord]|undefined;
  if(!first){drained?.();drained=undefined;return;}
  const [id,record]=first;pending.delete(id);
  const delta=screeningRecordDelta(previous.get(id),record);previous.set(id,record);
  inFlight=++seq;send({type:'record',seq,delta});
}
const request=(body:Omit<Extract<ScreeningRequest,{method:'load'}>,'type'|'id'>|Omit<Extract<ScreeningRequest,{method:'start'|'end'}>,'type'|'id'>):Promise<unknown>=>new Promise((resolve,reject)=>{
  if(aborter.signal.aborted){reject(new DOMException('已暂停','AbortError'));return;}
  const id=++requestId;replies.set(id,{resolve,reject});send({type:'request',id,...body});
});
async function run(input:Extract<ScreeningWorkerInput,{type:'start'}>){
  input.records.forEach(record=>previous.set(record.id,record));
  const load:FishReconstructionLoader=async(row,from,cut,plan)=>await request({method:'load',row,from,cut,plan}) as Awaited<ReturnType<FishReconstructionLoader>>;
  load.turingInitialization=input.initialization;
  let error;
  try{
    await collectPreEntryMonitor({round:input.round,records:input.records,onRecord:record=>{pending.set(record.id,record);drain();}},load,input.now,aborter.signal,value=>send({type:'progress',value}),{
      start:input.bounds.start?async symbol=>await request({method:'start',symbol}) as number|undefined:undefined,
      end:input.bounds.end?async symbol=>await request({method:'end',symbol}) as number:undefined,
    });
  }catch(cause){error=screeningError(cause);}
  if(inFlight!=null||pending.size)await new Promise<void>(resolve=>{drained=resolve;});
  send({type:'done',error});
}
self.onmessage=(e:MessageEvent<ScreeningWorkerInput>)=>{
  const m=e.data;
  if(m.type==='start'){if(started)return;started=true;void run(m).catch(error=>send({type:'done',error:screeningError(error)}));}
  else if(m.type==='ack'){if(inFlight===m.seq){inFlight=undefined;drain();}}
  else if(m.type==='response'){const reply=replies.get(m.id);replies.delete(m.id);if(reply){if(m.error)reply.reject(restoreScreeningError(m.error));else reply.resolve(m.value);}}
  else if(m.type==='abort'){aborter.abort();for(const reply of replies.values())reply.reject(new DOMException('已暂停','AbortError'));replies.clear();}
};
