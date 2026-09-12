import { fixedBetGrowthFactor } from '@/lib/geometricExpectancy';
import { computeRealizedOpportunityQuality } from '@/lib/opportunityQuality';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import { pickPrimaryMainLeg } from '@/lib/campaignPrimaryMainLeg';

export interface CampaignExpectancies {
  arithmeticExpectancy: number | null;
  geometricExpectancy: number | null;
}

function positiveFinite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Resolve the initial main-position leverage, including legacy campaign fallbacks. */
export function resolveCampaignMainLeverage(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): number | null {
  // 多笔主仓时取名义金额最大的那笔——杠杆要跟着真正的主力走
  const mainLeg = pickPrimaryMainLeg(legs);
  const mainEvent = (campaign.actual_evolution ?? []).find(event => (
    event.event_type === 'main_opened' || event.event_type === 'reentry_main_opened'
  )) ?? null;
  const linkedRecordIds = new Set([
    mainLeg?.trade_record_id,
    mainEvent?.trade_record_id,
  ].filter((id): id is string => typeof id === 'string' && id.length > 0));
  const linkedRecord = tradeRecords.find(record => linkedRecordIds.has(record.id)) ?? null;

  const candidates = [
    mainLeg?.leverage,
    linkedRecord?.leverage,
    campaign.initial_leverage,
    mainEvent?.leverage,
  ];
  return candidates.find(positiveFinite) ?? null;
}

export function formatCampaignLeverage(value: number | null): string {
  if (!positiveFinite(value)) return '—';
  const rounded = Number.isInteger(value)
    ? value.toFixed(0)
    : value.toFixed(2).replace(/\.?0+$/, '');
  return `${rounded}x`;
}

export function resolveCampaignOpportunityQuality(
  campaign: TradeCampaign,
  profitCaptureRatio: number | null,
  initialExpectedMaxDrawdownPct: number,
): number | null {
  const resolved = ['closed_profit', 'closed_loss', 'closed_breakeven'].includes(campaign.status)
    && Number.isFinite(campaign.final_realized_pnl);
  if (
    !resolved
    || profitCaptureRatio == null
    || !Number.isFinite(profitCaptureRatio)
    || !Number.isFinite(initialExpectedMaxDrawdownPct)
    || initialExpectedMaxDrawdownPct <= 0
  ) {
    return null;
  }

  return computeRealizedOpportunityQuality({
    payoffRatio: profitCaptureRatio / 100,
    drawdownPct: initialExpectedMaxDrawdownPct,
  });
}

/**
 * 单场资本增长因子：Gᵢ = 1 + bᵢ·x，x 每场统一取 10%。
 *
 * 这是「这一场把本金乘成了多少」的直接口径：按固定 10% 的资金比例下这一注，
 * 赚 bᵢ 个 R 就等于本金变成 1 + bᵢ×0.1 倍。它与汇总那条 G 不同——汇总那条要
 * 按胜率把「赢的一腿」和「亏的一腿」加权，因为它推演的是重复下注的长期路径；
 * 单场的结果已经发生，bᵢ 就是它的全部，不需要再乘概率。
 *
 * 1 + bᵢ·x ≤ 0（bᵢ ≤ −10）代表这一注亏光了本金，因子按 0 记、几何期望记 −100%。
 */
export function campaignGrowthFactor(payoffRatio: number): number {
  return fixedBetGrowthFactor(payoffRatio);
}

/**
 * 单场的两个期望。
 *
 * 几何那一项不再看该场真实的 Lᵢ ÷ Aᵢ：真实 xᵢ 把「这场赔率结构好不好」和
 * 「当时账户有多大」搅在一起——同样一场 +2R，早期小账户算出来像重仓豪赌、
 * 后期大账户算出来几乎没下注，两个数没法横向比。固定 x 之后只剩 bᵢ 在动。
 * 附带好处：不再需要开仓时的账户资产快照，老战役也算得出来。
 */
export function computeCampaignExpectancies(
  profitCaptureRatio: number | null,
  winRate: number | null,
): CampaignExpectancies {
  if (profitCaptureRatio == null || !Number.isFinite(profitCaptureRatio)) {
    return { arithmeticExpectancy: null, geometricExpectancy: null };
  }

  const payoffRatio = profitCaptureRatio / 100;
  // 算术期望要按账户胜率加权，没有胜率就给不出；几何那一项只由 bᵢ 决定，照常算。
  const arithmeticExpectancy = winRate != null && Number.isFinite(winRate)
    ? winRate * payoffRatio - (1 - winRate)
    : null;

  return {
    arithmeticExpectancy,
    geometricExpectancy: campaignGrowthFactor(payoffRatio) - 1,
  };
}

export function formatArithmeticExpectancy(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(2)}R`;
}

export function formatGeometricExpectancy(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return `${normalized >= 0 ? '+' : ''}${(normalized * 100).toFixed(1)}%/笔`;
}
