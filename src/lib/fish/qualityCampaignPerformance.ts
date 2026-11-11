import { computeInitialExpectedMaxLoss } from '@/lib/campaignAnalysis';
import { computeSettlementPayoffRatio } from '@/lib/campaignB';
import { computeCampaignRealizedPnl, reconcileCampaignWithSettlement } from '@/lib/campaignRealizedPnl';
import { summarizeCampaignPerformance, type CampaignPerformanceSample } from '@/lib/kellySizing';
import { summarizeAsymmetricRiskMetrics } from '@/lib/asymmetricRiskMetrics';
import type { FishQualityStudy } from './quality';
import { iterateQualityCampaignData } from './qualityCampaignProjection';
import { qualityCampaignTrashKey } from '@/lib/campaignSections';

/** Same frozen fills, risk denominator and statistical formulas as campaign details.
 * Comparison fills bypass market-price correction in campaignLegExecution.
 * Only the scalar samples remain alive between campaigns; no plans/legs cross to the UI.
 */
export function qualityCampaignPerformanceFromStudy(owner: string, study: FishQualityStudy, section: 'sell' | 'detect' | 'quality', sellKey: string, excluded: readonly string[] = []) {
  const samples: CampaignPerformanceSample[] = [];
  const excludedKeys = new Set(excluded);
  for (const details of iterateQualityCampaignData(owner, study, section, sellKey)) {
    if (excludedKeys.has(qualityCampaignTrashKey(details.campaign.id))) continue;
    try {
      const settlement = computeCampaignRealizedPnl(details.campaign, details.legs, details.tradeRecords, {});
      const campaign = reconcileCampaignWithSettlement(details.campaign, details.legs, settlement);
      const risk = computeInitialExpectedMaxLoss(details.campaign, details.legs, details.tradeRecords, details.reverseHedgeOrders);
      samples.push({
        campaign: { id: campaign.id, status: campaign.status, final_realized_pnl: campaign.final_realized_pnl } as typeof campaign,
        payoffRatio: computeSettlementPayoffRatio(campaign.final_realized_pnl, risk),
      });
    } catch { /* Detail summaries historically omit individual unreadable samples. */ }
  }
  return { performance: summarizeCampaignPerformance(samples), asymmetricRisk: summarizeAsymmetricRiskMetrics(samples) };
}
