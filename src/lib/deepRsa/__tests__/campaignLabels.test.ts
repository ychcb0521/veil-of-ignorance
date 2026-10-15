import { describe, expect, it } from 'vitest';
import { buildCampaignCardData } from '@/lib/campaignListCache';
import { buildCampaignLabelRecord, CODE_VERSION, resolveCampaignAnchors } from '@/lib/deepRsa/campaignLabels';
import { groupCampaign } from '@/lib/deepRsa/grouping';
import { BUILD_STAMP } from '@/lib/buildStamp';
import { correctedLossLegs, correctedLossStoredCampaign, correctedLossTradeRecords, CORRECTED_LOSS_OPENED_AT } from '@/test/fixtures/correctedLossCampaign';

function details(over: { deleted?: boolean } = {}) {
  return {
    campaign: correctedLossStoredCampaign(over.deleted ? { deleted_at: '2026-07-01T00:00:00.000Z' } : {}),
    legs: correctedLossLegs(),
    tradeRecords: correctedLossTradeRecords(),
    pendingOrders: [],
    reverseHedgeOrders: [],
    foreignLiveOrders: [],
  } as unknown as Parameters<typeof buildCampaignCardData>[0];
}

describe('战役标签：复用应用现有口径，同时交出「这个数有多硬」', () => {
  it('盈亏比 = 已实现 ÷ L₀，与列表的 profitCaptureRatio 同一个数（不经 ×100 往返）', () => {
    const d = details();
    const record = buildCampaignLabelRecord(d, {}, true);
    const card = buildCampaignCardData(d, {});
    expect(record.input.payoffRatio).toBeCloseTo(card.profitCaptureRatio! / 100, 12);
    expect(record.input.payoffRatio).toBe(card.settlement.total! / card.initialExpectedMaxLoss);
    expect(record.input.payoffBasis).toBe('records');
    expect(record.input.settled).toBe(true);
    expect(record.codeVersion).toBe(BUILD_STAMP);
    expect(CODE_VERSION).toBe(BUILD_STAMP);
  });

  it('锚点：B = 最早 main_open 的 pre_simulated_time，A = opened_at，D = 主力成交 openTime', () => {
    const d = details();
    const card = buildCampaignCardData(d, {});
    const anchors = resolveCampaignAnchors(d, card.settlement.recordsByLeg);
    expect(anchors.B).toBe(Date.parse(CORRECTED_LOSS_OPENED_AT));
    expect(anchors.D).toBe(Date.parse(CORRECTED_LOSS_OPENED_AT));
    const record = buildCampaignLabelRecord(d, {}, true);
    expect(record.input.anchorMs).toBe(anchors.B);
    expect(record.anchorSource).toBe('B');
  });

  it('有成交加仓的主多战役：理论 b 结构上可能存在；单主力 L₀ 不是下限', () => {
    const record = buildCampaignLabelRecord(details(), {}, true);
    expect(record.input.theoreticalBApplicable).toBe(true);
    expect(record.mainOpenCount).toBe(1);
    expect(record.l0IsLowerBound).toBe(false);
  });

  it('校正状态未知时分组为待判定；回收站战役排除', () => {
    expect(groupCampaign(buildCampaignLabelRecord(details(), {}, null).input).pendingReasons).toContain('corrections_unknown');
    expect(groupCampaign(buildCampaignLabelRecord(details({ deleted: true }), {}, true).input).group).toBe('excluded');
  });
});
