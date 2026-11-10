import {expect,it} from 'vitest';
import {monitorArchiveFixture} from '../fish/__tests__/monitorArchive.fixture';
import {listQualityCampaignDataFromStudy} from '../fish/qualityCampaignProjection';
import {encodeQualityCampaignPacket,QualityCampaignPacketDecoder,QualityCampaignPacketEncoder,type QualityCampaignPacket} from '../fish/qualityCampaignTransfer';
import {buildCampaignCardData} from '../campaignListCache';

function roundtrip(packets:Iterable<QualityCampaignPacket>){
 const decoder=new QualityCampaignPacketDecoder();let sequence=0,maxBytes=0,chunks=0;
 for(const packet of packets)for(const chunk of encodeQualityCampaignPacket(packet)){
  maxBytes=Math.max(maxBytes,chunk.buffer.byteLength);chunks++;
  decoder.push({type:'chunk',sequence:sequence++,...chunk});
 }
 return{result:decoder.finish(),maxBytes,chunks};
}
it.each(['sell','detect','quality'] as const)('preserves every field, record, formula, plan and card metric for %s',section=>{
 const study=monitorArchiveFixture(),before=JSON.stringify(study),expected=listQualityCampaignDataFromStudy('owner',study,section,[]);
 const encoder=new QualityCampaignPacketEncoder(),{rows,...metadata}=expected;
 const packets:QualityCampaignPacket[]=[{kind:'list',data:metadata}];for(const row of rows)packets.push(...encoder.row(row));
 const {result,maxBytes}=roundtrip(packets);expect(result).toEqual({kind:'list',data:expected});expect(maxBytes).toBeLessThanOrEqual(262144);
 expect(result.kind==='list'&&result.data.rows.map(r=>buildCampaignCardData(r))).toEqual(rows.map(r=>buildCampaignCardData(r)));
 expect(JSON.stringify(study)).toBe(before);
});
it('shares exact frozen content across many rows without merging a genuine parameter/formula difference',()=>{
 const row=listQualityCampaignDataFromStudy('owner',monitorArchiveFixture(),'quality',[]).rows[0];
 const encoder=new QualityCampaignPacketEncoder(),packets:QualityCampaignPacket[]=[{kind:'list',data:{buyFilterLabel:'',repair:undefined,selectedSellKey:undefined}}];
 for(let i=0;i<100;i++)packets.push(...encoder.row({...structuredClone(row),campaign:{...structuredClone(row.campaign),id:'row-'+i}}));
 const changed=structuredClone(row);changed.campaign.comparison!.monitorPlan!.label+=' 参数不同';changed.campaign.comparison!.monitorPlan!.snapshot.threshold=0.123456789;
 packets.push(...encoder.row(changed));expect(packets.filter(p=>p.kind==='shared')).toHaveLength(2);
 const {result}=roundtrip(packets);if(result.kind!=='list')throw Error('list');
 expect(result.data.rows).toHaveLength(101);expect(result.data.rows[0].campaign.comparison!.monitorPlan).toBe(result.data.rows[99].campaign.comparison!.monitorPlan);
 expect(result.data.rows[100]).toEqual(changed);expect(result.data.rows[100].campaign.comparison!.monitorPlan).not.toBe(result.data.rows[0].campaign.comparison!.monitorPlan);
});
it('streams even an oversized individual detail with Unicode, special numeric values and complete audit history',()=>{
 const row=listQualityCampaignDataFromStudy('owner',monitorArchiveFixture(),'quality',[]).rows[0];
 row.campaign.notes='防守线😀\ud83d\ude00'.repeat(100000);
 row.campaign.comparison!.sellEvidence!.additionSkips=Array.from({length:10000},(_,i)=>({at:i,round:i,kind:'test',label:'全部审计',reading:String(i)}));
 row.campaign.peak_drawdown=NaN;
 const r=roundtrip([{kind:'result',result:{kind:'detail',data:row}}]);
 expect(r.result).toEqual({kind:'detail',data:row});expect(r.maxBytes).toBeLessThanOrEqual(262144);expect(r.chunks).toBeGreaterThan(10);
});
it('rejects truncated or reordered data instead of returning a partial/empty successful list',()=>{
 const decoder=new QualityCampaignPacketDecoder(),chunk=[...encodeQualityCampaignPacket({kind:'list',data:{buyFilterLabel:'中'.repeat(100000),repair:undefined,selectedSellKey:undefined}})][0];
 decoder.push({type:'chunk',sequence:0,...chunk});expect(()=>decoder.finish()).toThrow('未完成');
 expect(()=>new QualityCampaignPacketDecoder().push({type:'chunk',sequence:2,...chunk})).toThrow('不完整');
});
