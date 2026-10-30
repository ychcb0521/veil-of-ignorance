import {it,expect,vi,afterEach} from 'vitest';
import {qualityMirrorCampaignFixture} from '@/test/fixtures/qualityMirrorCampaign';
import {qualityCampaignStaticRisk,campaignLegDeltaLabel} from '@/lib/fish/qualityCampaignRisk';
import {computeInitialExpectedMaxLoss,computeInitialExpectedMaxDrawdownPct,computeProfitCaptureRatio} from '@/lib/campaignAnalysis';
import {buildCampaignLegsExportRows} from '@/lib/campaignLegsPngExport';
afterEach(()=>vi.restoreAllMocks());
it('prices frozen static stop risk using original principal, including the sold mirror slice and excluding additions',()=>{
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({measureText:(text:string)=>({width:text.length*7})} as CanvasRenderingContext2D);
 const d=qualityMirrorCampaignFixture();d.campaign.comparison!.sellEvidence!.holdingVetoes=[{id:'s',label:'静态止损',kind:'static-drawdown',direction:'>=',threshold:5}];
 expect(qualityCampaignStaticRisk(d.campaign)).toMatchObject({notional:100,percent:5,loss:5,stop:95});expect(computeInitialExpectedMaxLoss(d.campaign,d.legs,d.tradeRecords)).toBe(5);expect(computeInitialExpectedMaxDrawdownPct(d.campaign,d.legs,d.tradeRecords)).toBe(5);expect(computeProfitCaptureRatio(d.campaign,d.legs,d.tradeRecords)).toBeCloseTo(650);
 const rows=buildCampaignLegsExportRows({...d,unfilledOrderIds:new Set(d.unfilledOrderIds??[])});expect(rows.find(r=>r.kind==='total')!.cells[3][0].text).toContain('6.50');expect(campaignLegDeltaLabel(d.campaign)).toBe('Δb');
 d.campaign.comparison!.holdingMetrics!.totalInvested=8856;expect(computeInitialExpectedMaxLoss(d.campaign,d.legs,d.tradeRecords)).toBe(5);
});
it('keeps manual campaigns and missing static-stop settings explicit and uses the tightest configured static stop',()=>{
 const d=qualityMirrorCampaignFixture(),e=d.campaign.comparison!.sellEvidence!;expect(qualityCampaignStaticRisk(d.campaign)).toBeUndefined();
 e.holdingVetoes=[{id:'d',label:'动态',kind:'dynamic-drawdown',direction:'>=',threshold:30}];expect(qualityCampaignStaticRisk(d.campaign)).toBeUndefined();e.holdingVetoes.push({id:'s8',label:'静态',kind:'static-drawdown',direction:'>=',threshold:8},{id:'s5',label:'静态',kind:'static-drawdown',direction:'>=',threshold:5});expect(qualityCampaignStaticRisk(d.campaign)?.loss).toBe(5);
 const manual={...d.campaign,comparison:undefined};expect(qualityCampaignStaticRisk(manual)).toBeUndefined();expect(campaignLegDeltaLabel(manual)).toBe('ΔR');
});
