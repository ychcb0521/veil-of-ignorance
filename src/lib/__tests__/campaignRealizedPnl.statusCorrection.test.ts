/**
 * 平仓价校正翻转盈亏符号时，状态必须跟着翻——
 * TUTUSDT 2026-08-09：未校正 +469.96 / 盈利结束，校正后 −1756.65 / 亏损结束。
 * 这里守的是纯函数层：结算、状态推导、把结算套回战役对象、以及回写用的容差比较。
 */
import { describe, expect, it } from 'vitest';
import {
  campaignStatusFromRealizedPnl,
  computeCampaignRealizedPnl,
  materiallyDifferentPnl,
  reconcileCampaignWithSettlement,
} from '@/lib/campaignRealizedPnl';
import {
  CORRECTED_LOSS_CLOSED_AT,
  CORRECTED_TOTAL,
  PLANNED_MAX_LOSS_TOTAL,
  UNCORRECTED_TOTAL,
  activeVariant,
  correctedLossCorrections,
  correctedLossLegs,
  correctedLossStoredCampaign,
  correctedLossTradeRecords,
} from '@/test/fixtures/correctedLossCampaign';

describe('平仓价校正与结束状态同源', () => {
  const campaign = correctedLossStoredCampaign();
  const legs = correctedLossLegs();
  const records = correctedLossTradeRecords();
  const corrections = correctedLossCorrections();

  it('不叠校正时合计为 +469.96，叠上镜像止盈的平仓价校正后为 −1756.65', () => {
    const raw = computeCampaignRealizedPnl(campaign, legs, records);
    const corrected = computeCampaignRealizedPnl(campaign, legs, records, corrections);
    expect(raw.total).toBeCloseTo(UNCORRECTED_TOTAL, 6);
    expect(raw.settled).toBe(true);
    expect(corrected.total).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(corrected.total).toBeCloseTo(-1756.65, 1);
    expect(corrected.settled).toBe(true);
    // 校正只落在镜像那一条腿上；Σ(byLeg) 仍恒等于 total
    expect(corrected.byLeg.get('leg-mirror')).toBeCloseTo(3394.56, 1);
    const sum = [...corrected.byLeg.values()].reduce<number>((acc, v) => acc + (v ?? 0), 0);
    expect(sum).toBeCloseTo(corrected.total as number, 8);
  });

  it('状态由校正后的合计推出：closed_profit → closed_loss', () => {
    const raw = computeCampaignRealizedPnl(campaign, legs, records);
    const corrected = computeCampaignRealizedPnl(campaign, legs, records, corrections);
    expect(campaignStatusFromRealizedPnl(raw, CORRECTED_LOSS_CLOSED_AT)).toBe('closed_profit');
    expect(campaignStatusFromRealizedPnl(corrected, CORRECTED_LOSS_CLOSED_AT)).toBe('closed_loss');
  });

  it('reconcileCampaignWithSettlement 把状态 / 金额 / R 一并套回战役对象', () => {
    const corrected = computeCampaignRealizedPnl(campaign, legs, records, corrections);
    const reconciled = reconcileCampaignWithSettlement(campaign, legs, corrected);
    expect(reconciled.status).toBe('closed_loss');
    expect(reconciled.final_realized_pnl).toBeCloseTo(CORRECTED_TOTAL, 6);
    expect(reconciled.final_r_multiple).toBeCloseTo(CORRECTED_TOTAL / PLANNED_MAX_LOSS_TOTAL, 8);
    // 其它字段原样保留
    expect(reconciled.id).toBe(campaign.id);
    expect(reconciled.closed_at).toBe(campaign.closed_at);
    expect(reconciled.title).toBe(campaign.title);
  });

  it('未结算（进行中）的战役保留落库状态，不用半场数据定性', () => {
    const active = activeVariant();
    const settlement = computeCampaignRealizedPnl(active.campaign, active.legs, active.tradeRecords, corrections);
    expect(settlement.settled).toBe(false);
    const reconciled = reconcileCampaignWithSettlement(active.campaign, active.legs, settlement);
    expect(reconciled.status).toBe('active');
    expect(reconciled.final_realized_pnl).toBeNull();
    expect(reconciled.final_r_multiple).toBeNull();
  });

  it('计划最大亏损为 0 时不算 R，保留落库值', () => {
    const corrected = computeCampaignRealizedPnl(campaign, legs, records, corrections);
    const noRisk = legs.map(item => ({ ...item, pre_max_loss_usdt: null }));
    const reconciled = reconcileCampaignWithSettlement({ ...campaign, final_r_multiple: 0.42 }, noRisk, corrected);
    expect(reconciled.status).toBe('closed_loss');
    expect(reconciled.final_r_multiple).toBe(0.42);
  });
});

describe('materiallyDifferentPnl —— 回写与差额提示共用的容差', () => {
  it('差 1 分钱以内、或量级百万分之一以内，视为相同', () => {
    expect(materiallyDifferentPnl(469.96, 469.965)).toBe(false);
    expect(materiallyDifferentPnl(-1756.647, -1756.6470000001)).toBe(false);
    expect(materiallyDifferentPnl(5_000_000, 5_000_002)).toBe(false); // 2 / 5e6 = 4e-7 < 1e-6
  });

  it('超过容差、或一边有数一边没有，视为不同；两边都没有视为相同', () => {
    expect(materiallyDifferentPnl(469.96, -1756.65)).toBe(true);
    expect(materiallyDifferentPnl(0, 0.02)).toBe(true);
    expect(materiallyDifferentPnl(null, 0)).toBe(true);
    expect(materiallyDifferentPnl(12, null)).toBe(true);
    expect(materiallyDifferentPnl(null, null)).toBe(false);
  });
});
