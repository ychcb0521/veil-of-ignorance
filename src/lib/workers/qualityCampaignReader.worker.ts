import {cleanQualityCampaignStudy,projectQualityCampaignStudy,withStoredQualityCampaignStudy,type QualityCampaignReadRequest} from '../fish/qualityCampaignReader';
import {iterateQualityCampaignData,qualityCampaignListMetadata} from '../fish/qualityCampaignProjection';
import {encodeQualityCampaignPacket,QualityCampaignPacketEncoder,type QualityCampaignPacket,type QualityCampaignAck} from '../fish/qualityCampaignTransfer';

let sequence=0,acknowledge:((sequence:number)=>void)|undefined,started=false;
async function send(packet:QualityCampaignPacket){
 for(const chunk of encodeQualityCampaignPacket(packet)){
  const current=sequence++;
  await new Promise<void>(resolve=>{
   acknowledge=received=>{if(received===current){acknowledge=undefined;resolve();}};
   self.postMessage({type:'chunk',sequence:current,...chunk},{transfer:[chunk.buffer]});
  });
 }
}
self.onmessage=(event:MessageEvent<QualityCampaignReadRequest|QualityCampaignAck>)=>{
 if('type' in event.data&&event.data.type==='ack'){acknowledge?.(event.data.sequence);return;}
 if(started)return;started=true;
 const request=event.data as QualityCampaignReadRequest;
 void withStoredQualityCampaignStudy(request,async study=>{
  if(request.kind==='list'){
   const clean=cleanQualityCampaignStudy(study),encoder=new QualityCampaignPacketEncoder();
   await send({kind:'list',data:qualityCampaignListMetadata(clean,request.section,request.definitions)});
   for(const row of iterateQualityCampaignData(request.owner,clean,request.section))for(const packet of encoder.row(row))await send(packet);
  }else await send({kind:'result',result:projectQualityCampaignStudy(study,request)});
 }).then(()=>self.postMessage({type:'complete'})).catch(error=>self.postMessage({type:'error',error:error instanceof Error?error.message:'持仓监测读取失败，原数据仍保留，请重试'}));
};
