import { expect, it, vi } from 'vitest';
import { monitorArchiveFixture } from '@/lib/fish/__tests__/monitorArchive.fixture';
import { listQualityCampaignDataFromStudy } from '@/lib/fish/qualityCampaignProjection';
import { qualityCampaignPerformanceFromStudy } from '@/lib/fish/qualityCampaignPerformance';
import { projectQualityCampaignStudy } from '@/lib/fish/qualityCampaignReader';
import { computeCampaignRealizedPnl, reconcileCampaignWithSettlement } from '@/lib/campaignRealizedPnl';
import { computeInitialExpectedMaxLoss } from '@/lib/campaignAnalysis';
import { computeSettlementPayoffRatio } from '@/lib/campaignB';
import { summarizeCampaignPerformance } from '@/lib/kellySizing';
import { summarizeAsymmetricRiskMetrics } from '@/lib/asymmetricRiskMetrics';

it.each(['quality', 'sell', 'detect'] as const)('matches the previous full-detail statistical path for %s', section => {
  const study = monitorArchiveFixture();
  const rows = listQualityCampaignDataFromStudy('owner', study, section, []).rows;
  const keys = new Set(rows.map(row => row.campaign.comparison!.sellKey));
  for (const sellKey of keys) {
    const selected = rows.filter(row => row.campaign.comparison!.sellKey === sellKey);
    const samples = selected.map(details => {
      const settlement = computeCampaignRealizedPnl(details.campaign, details.legs, details.tradeRecords, {});
      const campaign = reconcileCampaignWithSettlement(details.campaign, details.legs, settlement);
      const risk = computeInitialExpectedMaxLoss(details.campaign, details.legs, details.tradeRecords, details.reverseHedgeOrders);
      return { campaign, payoffRatio: computeSettlementPayoffRatio(campaign.final_realized_pnl, risk) };
    });
    const expected = { performance: summarizeCampaignPerformance(samples), asymmetricRisk: summarizeAsymmetricRiskMetrics(samples) };
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      const result = qualityCampaignPerformanceFromStudy('owner', study, section, sellKey);
      expect(result).toEqual(expected);
      // Other plans are filtered before a full campaign/plan can be copied.
      expect(clone.mock.calls.length).toBeLessThanOrEqual(selected.length);
      expect(JSON.stringify(result).length).toBeLessThan(2000);
      expect(projectQualityCampaignStudy(study, { owner: 'owner', kind: 'performance', section, sellKey })).toEqual({ kind: 'performance', data: expected });
    } finally { clone.mockRestore(); }
  }
});

it('returns a small empty summary without cloning unrelated campaign plans', () => {
  const study = monitorArchiveFixture(), clone = vi.spyOn(globalThis, 'structuredClone');
  try {
    const result = qualityCampaignPerformanceFromStudy('owner', study, 'quality', 'unselected-plan');
    expect(clone).not.toHaveBeenCalled();
    expect(result.performance.payoffRatioSampleCount).toBe(0);
  } finally { clone.mockRestore(); }
});
