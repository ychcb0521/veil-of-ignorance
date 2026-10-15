import { describe, expect, it } from 'vitest';
import { buildCampaignCardData } from '@/lib/campaignListCache';
import { buildCampaignGroupReport } from '@/lib/deepRsa/report';
import { correctedLossLegs, correctedLossStoredCampaign, correctedLossTradeRecords } from '@/test/fixtures/correctedLossCampaign';

function row(over: Record<string, unknown> = {}) {
  return buildCampaignCardData({
    campaign: correctedLossStoredCampaign(over),
    legs: correctedLossLegs(),
    tradeRecords: correctedLossTradeRecords(),
    pendingOrders: [], reverseHedgeOrders: [], foreignLiveOrders: [],
  } as unknown as Parameters<typeof buildCampaignCardData>[0], {});
}

describe('Deep RSA 页面汇总', () => {
  it('计数与逐场分组一致；回收站排除且不进条件分布', () => {
    const report = buildCampaignGroupReport([row(), row({ id: 'gone', deleted_at: '2026-07-01T00:00:00.000Z' })], true);
    expect(report.rows).toHaveLength(2);
    expect(report.counts.excluded).toBe(1);
    const total = Object.values(report.counts).reduce((s, v) => s + v, 0);
    expect(total).toBe(2);
    const b = report.breakdown.payoff;
    expect(b.gt3 + b.lt05 + b.mid + b.missing + b.na).toBe(1);
    expect(report.rows.at(-1)!.grouping.group).toBe('excluded');
  });

  it('校正状态未知 → 全部待判定，并按原因计数', () => {
    const report = buildCampaignGroupReport([row()], null);
    expect(report.counts.pending).toBe(1);
    expect(report.pendingReasons.corrections_unknown).toBe(1);
  });
});
