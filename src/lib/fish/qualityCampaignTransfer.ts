import {deserializeAccountBlob,serializeAccountBlob,serializeAccountBlobChunks} from '../accountBlobCodec';
import type {TradeCampaign} from '@/types/journal';
import type {QualityCampaignData} from './qualityCampaignProjection';
import type {QualityCampaignReadResult} from './qualityCampaignReader';

type Comparison=NonNullable<TradeCampaign['comparison']>;
type Evidence=NonNullable<Comparison['sellEvidence']>;
const comparisonKeys=['section','planLabel','monitorPlan','sellKey','sellLabel','detectors','category'] as const;
const evidenceKeys=['initialStaticStopPct','formula','definitionKey','featureId','metric','version','interval','halfLifeHours','avgHours','source','direction','threshold','execution','mirrorTakeProfit','addition','holdingVetoes'] as const;
type Shared={comparison:Partial<Comparison>;evidence:Partial<Evidence>};
type ListData=Extract<QualityCampaignReadResult,{kind:'list'}>['data'];
export type QualityCampaignPacket=
 | {kind:'shared';id:number;value:Shared}
 | {kind:'row';row:QualityCampaignData;shared?:number}
 | {kind:'list';data:Omit<ListData,'rows'>}
 | {kind:'result';result:QualityCampaignReadResult};
export type QualityCampaignChunk={type:'chunk';sequence:number;buffer:ArrayBuffer;last:boolean};
export type QualityCampaignReply=QualityCampaignChunk|{type:'complete'}|{type:'error';error:string};
export type QualityCampaignAck={type:'ack';sequence:number};

/** Per-read dictionary. Full frozen values are shared only after exact encoded
 * content equality; no hash, template rewrite, record omission or truncation. */
export class QualityCampaignPacketEncoder {
 private shared=new Map<string,number>();
 *row(row:QualityCampaignData):Generator<QualityCampaignPacket>{
  const comparison=row.campaign.comparison;
  if(!comparison){yield{kind:'row',row};return;}
  const own={...comparison},evidence={...comparison.sellEvidence},common:Shared={comparison:{},evidence:{}};
  for(const key of comparisonKeys)if(Object.prototype.hasOwnProperty.call(own,key)){
   Object.assign(common.comparison,{[key]:own[key]});delete own[key];
  }
  for(const key of evidenceKeys)if(Object.prototype.hasOwnProperty.call(evidence,key)){
   Object.assign(common.evidence,{[key]:evidence[key]});delete evidence[key];
  }
  const encoded=serializeAccountBlob(common);let id=this.shared.get(encoded);
  if(id===undefined){id=this.shared.size;this.shared.set(encoded,id);yield{kind:'shared',id,value:common};}
  yield{kind:'row',shared:id,row:{...row,campaign:{...row.campaign,comparison:{...own,...(comparison.sellEvidence?{sellEvidence:evidence}:{})}}}};
 }
}

/** <=256 KiB UTF-8 buffers, transferred rather than structured-cloned graphs.
 * Only one buffer may be in flight; the worker waits for its acknowledgement. */
export function* encodeQualityCampaignPacket(packet:QualityCampaignPacket):Generator<{buffer:ArrayBuffer;last:boolean}>{
 const encoder=new TextEncoder(),limit=65_536;let pending='';
 for(const piece of serializeAccountBlobChunks(packet)){
  pending+=piece;
  while(pending.length>limit){
   let end=limit;const c=pending.charCodeAt(end-1);if(c>=0xd800&&c<=0xdbff)end--;
   yield{buffer:encoder.encode(pending.slice(0,end)).buffer as ArrayBuffer,last:false};pending=pending.slice(end);
  }
 }
 yield{buffer:encoder.encode(pending).buffer as ArrayBuffer,last:true};
}

export class QualityCampaignPacketDecoder {
 private shared=new Map<number,Shared>();
 private decoder=new TextDecoder('utf-8',{fatal:true});
 private parts:string[]=[];
 private sequence=0;
 private rows:QualityCampaignData[]=[];
 private metadata:Omit<ListData,'rows'>|undefined;
 private result:QualityCampaignReadResult|undefined;
 push(chunk:QualityCampaignChunk):void{
  if(chunk.sequence!==this.sequence++||Object.prototype.toString.call(chunk.buffer)!=='[object ArrayBuffer]'||chunk.buffer.byteLength>262_144)throw Error('持仓监测传输不完整，原数据仍保留，请重试');
  this.parts.push(this.decoder.decode(chunk.buffer,{stream:!chunk.last}));
  if(!chunk.last)return;
  const packet=deserializeAccountBlob(this.parts.join('')) as QualityCampaignPacket;this.parts=[];
  if(packet.kind==='shared'){
   if(this.shared.has(packet.id))throw Error('持仓监测方案传输重复，请重试');this.shared.set(packet.id,packet.value);
  }else if(packet.kind==='row'){
   const common=packet.shared===undefined?undefined:this.shared.get(packet.shared);
   if(packet.shared!==undefined&&!common)throw Error('持仓监测方案传输不完整，原数据仍保留，请重试');
   if(common){const comparison=packet.row.campaign.comparison!;
    packet.row.campaign.comparison={...common.comparison,...comparison,
     ...(comparison.sellEvidence?{sellEvidence:{...common.evidence,...comparison.sellEvidence}}:{})} as Comparison;
   }
   this.rows.push(packet.row);
  }else if(packet.kind==='list')this.metadata=packet.data;
  else if(packet.kind==='result')this.result=packet.result;
  else throw Error('持仓监测传输格式异常，请重试');
 }
 finish():QualityCampaignReadResult{
  if(this.parts.length)throw Error('持仓监测传输未完成，原数据仍保留，请重试');
  if(this.metadata)return{kind:'list',data:{...this.metadata,rows:this.rows}};
  if(this.result)return this.result;
  throw Error('持仓监测读取未完成，原数据仍保留，请重试');
 }
}
