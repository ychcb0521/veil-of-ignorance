import { computeGeometricExpectancy } from '@/lib/geometricExpectancy';
import { computeRealizedOpportunityQuality } from '@/lib/opportunityQuality';
import type { TradeCampaign } from '@/types/journal';

export interface CampaignExpectancies {
  arithmeticExpectancy: number | null;
  geometricExpectancy: number | null;
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
