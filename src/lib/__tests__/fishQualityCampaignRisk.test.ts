import {it,expect,vi,afterEach} from 'vitest';
import {qualityMirrorCampaignFixture} from '@/test/fixtures/qualityMirrorCampaign';
import {qualityCampaignStaticRisk,campaignLegDeltaLabel} from '@/lib/fish/qualityCampaignRisk';
import {computeInitialExpectedMaxLoss,computeInitialExpectedMaxDrawdownPct,computeProfitCaptureRatio} from '@/lib/campaignAnalysis';
import {buildCampaignLegsExportRows} from '@/lib/campaignLegsPngExport';
import {evaluateCampaignAddSizing} from '@/lib/campaignAddSizingCheck';
import {HOLDING_LEDGER_ADDITION_VERSION} from '@/lib/fish/qualityHoldingLedger';
import {makeQualitySellPlan} from '@/lib/fish/qualitySellPlans';
import {STATIC_DRAWDOWN_SELL_CHOICE} from '@/lib/fish/qualityStaticDrawdownSell';
afterEach(()=>vi.restoreAllMocks());
it('keeps Legs risk and the chart threshold aligned, while replaying the saved add budget', () => {
 const data = qualityMirrorCampaignFixture(), { campaign, legs } = data;
 campaign.comparison!.monitorPlan = makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE, '>=', 3, []);
 const add = legs.find(leg => leg.quality_addition_fill)!;
 const fill = add.quality_addition_fill!;
 fill.positionVersion = HOLDING_LEDGER_ADDITION_VERSION;
 fill.ledger = { costBefore: 48, realizedBefore: -1.25, mirrorQuantityBefore: 0.5, breakevenBefore: 98.5 };
 fill.sizing!.coinsBefore = 0.5;
 for (const leg of legs) leg.campaign_id = 'fish-instant-test';
 const verdict = evaluateCampaignAddSizing({ legs, tradeRecords: [], reverseHedgeOrders: [] }).get(add.id)!;
 expect(verdict).toMatchObject({ banked: -1.25, x1Coins: 0.5, s1: fill.sizing!.support,
   cushion: expect.closeTo(0.5 * fill.sizing!.support - 48) });
 expect(qualityCampaignStaticRisk(campaign)).toMatchObject({ loss: 3, stop: 97 });
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({measureText:(text:string)=>({width:text.length*7})} as CanvasRenderingContext2D);
 const rows = buildCampaignLegsExportRows({...data,unfilledOrderIds:new Set(data.unfilledOrderIds??[])});
 expect(rows.flatMap(row => row.cells.flat().map(cell => cell.text)).join(' ')).toContain('3% @ 97');
});
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
