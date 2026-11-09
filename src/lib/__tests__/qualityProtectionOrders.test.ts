import { expect, it } from 'vitest';
import { qualityMirrorCampaignFixture, QUALITY_MIRROR_FIXTURE_TIME as T } from '@/test/fixtures/qualityMirrorCampaign';
import { qualityProtectionOrders } from '../fish/qualityProtectionOrders';
import { buildCampaignReverseOrderPriceLines } from '../campaignReverseOrderLines';
const M=60000;
it('projects the existing saved protection into the exact personal-order style without adding trades or mutating the campaign',()=>{
  const data=qualityMirrorCampaignFixture(),before=structuredClone(data),orders=qualityProtectionOrders(data.campaign,data.legs);
  expect(orders).toHaveLength(1);expect(orders[0]).toMatchObject({side:'SHORT',price:107,createdAt:T+2*M,status:'cancelled',cancelledAt:T+10*M});
  expect(buildCampaignReverseOrderPriceLines(orders,[],T+10*M)).toEqual([{price:107,color:'#F0B90B',startTime:T+2*M,endTime:T+10*M,dashed:true,endMarker:'x',title:'委托空',orderIds:[orders[0].id]}]);
  expect(data).toEqual(before);expect(data.reverseHedgeOrders).toEqual([]);
});
it('retains each historical K move and draws only the actually triggered F as solid',()=>{
  const data=qualityMirrorCampaignFixture(),fill=data.legs.find(l=>l.quality_addition_fill)!.quality_addition_fill!;
  fill.sizing={...fill.sizing!,guardK:107,support:105};
  const evidence=data.campaign.comparison!.sellEvidence!;evidence.additionFills=[fill];
  evidence.additionReductions=[{at:T+5*M,price:109,fraction:.1,quantity:.1,costRemoved:10,realizedPnl:.9,breakeven:100,previousK:105,newK:103,newGuardK:104,previousSupport:107,newSupport:104,atr:1}];
  evidence.triggerCause={id:'addition-floor',kind:'addition-support',label:'F',direction:'<=',threshold:103};
  const orders=qualityProtectionOrders(data.campaign,data.legs);expect(orders).toHaveLength(4);
  expect(orders.find(o=>o.price===107)).toMatchObject({status:'cancelled',cancelledAt:T+5*M});
  expect(orders.find(o=>o.price===104)).toMatchObject({status:'cancelled',createdAt:T+5*M});
  expect(orders.find(o=>o.price===103)).toMatchObject({status:'triggered',triggeredAt:T+10*M});
  const lines=buildCampaignReverseOrderPriceLines(orders,[],T+10*M),solid=lines.filter(l=>!l.dashed);
  expect(solid).toHaveLength(1);expect(solid[0]).toMatchObject({price:103,color:'#F0B90B',title:'触发空',startTime:T+10*M,endTime:T+10*M+1});
});
it('keeps open protection pending and de-duplicates mirror partitions of one acquisition lot',()=>{
  const data=qualityMirrorCampaignFixture();data.campaign.closed_at=null;
  const leg=data.legs.find(l=>l.quality_addition_fill)!;
  const orders=qualityProtectionOrders(data.campaign,[...data.legs,{...leg,id:'mirror-partition'}]);
  expect(orders).toHaveLength(1);expect(orders[0].status).toBe('pending');
  expect(buildCampaignReverseOrderPriceLines(orders,[],T+20*M)[0]).toMatchObject({endTime:T+20*M,endMarker:null,dashed:true});
});
it('does not invent orders for personal campaigns, missing price evidence, or invalid saved timestamps',()=>{
  const data=qualityMirrorCampaignFixture();expect(qualityProtectionOrders({...data.campaign,comparison:undefined},data.legs)).toEqual([]);
  expect(qualityProtectionOrders(data.campaign,data.legs.map(l=>({...l,quality_addition_fill:undefined})))).toEqual([]);
  const leg=data.legs.find(l=>l.quality_addition_fill)!;leg.quality_addition_fill!.at=NaN;expect(qualityProtectionOrders(data.campaign,data.legs)).toEqual([]);
});
