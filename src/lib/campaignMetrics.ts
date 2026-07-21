import { computeGeometricExpectancy } from '@/lib/geometricExpectancy';
import { computeRealizedOpportunityQuality } from '@/lib/opportunityQuality';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

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
  const mainLeg = legs.find(leg => leg.leg_role === 'main_open')
    ?? legs.find(leg => leg.leg_role === 'reentry_main')
    ?? null;
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

export function computeCampaignExpectancies(
  profitCaptureRatio: number | null,
  winRate: number | null,
  campaignDrawdownFraction: number | null,
): CampaignExpectancies {
  if (
    profitCaptureRatio == null
    || winRate == null
    || !Number.isFinite(profitCaptureRatio)
    || !Number.isFinite(winRate)
  ) {
    return { arithmeticExpectancy: null, geometricExpectancy: null };
  }

  const payoffRatio = profitCaptureRatio / 100;
  const arithmeticExpectancy = winRate * payoffRatio - (1 - winRate);
  const geometric = campaignDrawdownFraction != null && Number.isFinite(campaignDrawdownFraction)
    ? computeGeometricExpectancy(winRate, payoffRatio, campaignDrawdownFraction)
    : null;

  return {
    arithmeticExpectancy,
    geometricExpectancy: geometric?.geometricEdge ?? null,
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
