import type { TradeCampaign } from '@/types/journal';
import { computeSettlementPayoffRatio } from '@/lib/campaignB';
import { isSelectedL0, L0_DRAWDOWN } from './qualityVeto';
import { initialLimitedDrawdownPct, initialPayoffRiskThreshold, timedDrawdownPayoffPct } from './qualityStaticDrawdownSell';
import { usdtCampaignAmounts, type UsdtLiveCampaign } from './usdtLiveCampaign';

// Match the two-decimal loss amounts in Binance position history while keeping full precision for calculations.
export function positionHistoryPnlText(net: number): string {
  const cents = Number((net * 100).toFixed(8));
  return (Math.floor(cents) / 100).toFixed(2);
}

// The exchange can split one order across fills and allocate only part of a reversal to this campaign.
function measureFills(live: UsdtLiveCampaign) {
  const openingId = live.fills[0]?.orderId;
  const closingId = live.closedAt != null ? live.fills.at(-1)?.orderId : undefined;
  const additions = new Set<string>();
  const addFactors = new Map<string, number>();
  let openingSize = 0, openingNotional = 0, totalEntryNotional = 0, held = 0;
  let exitSize = 0, exitNotional = 0, firstCut = 0;
  let firstCutId: string | undefined;
  let acquired = 0, reduced = 0, proceeds = 0, peakQuantity = 0;
  let valid = true;
  for (const fill of live.fills) {
    const qty = Number(fill.positionQuantity), price = Number(fill.price);
    if (!(qty > 0 && price > 0 && Number.isFinite(price * qty))) { valid = false; continue; }
    if (fill.action === 'reduce') {
      reduced += qty;
      proceeds += qty * price;
      if (fill.orderId === closingId) {
        exitSize += qty;
        exitNotional += qty * price;
      } else if (!additions.size) {
        firstCutId ??= fill.orderId;
        if (firstCutId === fill.orderId) firstCut += qty;
      }
      held -= qty;
    } else {
      totalEntryNotional += qty * price;
      if (fill.orderId === openingId) {
        openingSize += qty;
        openingNotional += qty * price;
      } else {
        additions.add(fill.orderId);
        addFactors.set(fill.orderId, (addFactors.get(fill.orderId) ?? 1) * (1 + qty / held));
      }
      held += qty;
      acquired += qty;
      peakQuantity = Math.max(peakQuantity, held);
    }
  }
  const amounts = usdtCampaignAmounts(live);
  // For a single entry order the entire initial margin can be reconstructed from confirmed fills.
  const roi = live.closedAt && valid && !additions.size && openingNotional > 0 && live.executionLeverage && amounts.net != null
    ? amounts.net * live.executionLeverage / openingNotional * 100 : null;
  return { averageOpen:valid && acquired ? totalEntryNotional / acquired : null,
    averageClose:valid && reduced ? proceeds / reduced : null, closedQuantity:valid ? reduced : null,
    peakQuantity:valid ? peakQuantity : null, roi, openingNotional: valid ? openingNotional : 0, openingSize: valid ? openingSize : 0,
    entryPrice: valid && openingSize > 0 ? openingNotional / openingSize : null,
    exitPrice: valid && exitSize > 0 ? exitNotional / exitSize : null,
    totalEntryNotional: valid ? totalEntryNotional : null, addCount: additions.size,
    addRatios: valid ? Array.from(addFactors.values(), factor => factor - 1) : null,
    earlyReduction: valid && openingSize > 0 ? firstCut / openingSize : null,
    ...amounts };
}

const fillsCache = new WeakMap<UsdtLiveCampaign, ReturnType<typeof measureFills>>();
export function usdtLiveFillMetrics(live: UsdtLiveCampaign) {
  const cached = fillsCache.get(live);
  if (cached) return cached;
  const metrics = measureFills(live);
  fillsCache.set(live, metrics);
  return metrics;
}

function riskPercent(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0 && value <= 100 ? value : undefined;
}

export function matchesUsdtFollowCampaign(live: UsdtLiveCampaign, owner: string, paper?: TradeCampaign): paper is TradeCampaign {
  if (!paper || paper.id !== live.followId || paper.user_id !== owner || paper.comparison?.section !== 'instant'
    || paper.direction !== (live.direction === 'long' ? 'main_long' : 'main_short')) return false;
  const market = paper.comparison.instant?.source.binanceSymbol ?? paper.symbol;
  return market.replace(/\//g, '').toUpperCase() === live.symbol;
}

export function linkedUsdtEntryRiskPct(live: UsdtLiveCampaign, owner: string, paper?: TradeCampaign) {
  if (!matchesUsdtFollowCampaign(live, owner, paper)) return;
  const comparison = paper.comparison!;
  const firstSwitch = comparison.instant?.switches?.[0];
  const plan = firstSwitch ? firstSwitch.from.plan : comparison.monitorPlan;
  const opening = plan?.router?.structure ?? plan;
  if (opening && isSelectedL0(opening.payoffRiskVersion)) {
    if (opening.payoffRiskVersion === L0_DRAWDOWN) return riskPercent(initialLimitedDrawdownPct(opening)) ?? null;
    return riskPercent(firstSwitch ? firstSwitch.openingSelectedL0Pct : comparison.sellEvidence?.selectedL0Pct) ?? null;
  }
  return riskPercent(plan ? (timedDrawdownPayoffPct(plan) ?? initialPayoffRiskThreshold(plan)) : comparison.instant?.initialStaticStopPct);
}

export function usdtLiveRiskMetrics(campaign?: Pick<TradeCampaign, 'comparison'> | null) {
  const live = campaign?.comparison?.liveUsdt;
  if (!live) return;
  const fills = usdtLiveFillMetrics(live);
  const managed = live.management;
  const firstSwitch = managed?.switches?.[0];
  const entryPlan = managed && managed.armedAt <= live.openedAt ? (firstSwitch ? firstSwitch.from.plan : managed.monitor.plan) : undefined;
  const opening = entryPlan?.router?.structure ?? entryPlan;
  const linked = campaign.comparison?.liveEntryRiskPct;
  const frozen = linked !== undefined ? linked : opening && isSelectedL0(opening.payoffRiskVersion)
    ? riskPercent(opening.payoffRiskVersion === L0_DRAWDOWN ? initialLimitedDrawdownPct(opening)
      : firstSwitch ? firstSwitch.openingSelectedL0Pct : managed?.selectedL0Pct) ?? null
    : entryPlan && riskPercent(timedDrawdownPayoffPct(entryPlan) ?? initialPayoffRiskThreshold(entryPlan));
  const percent = frozen === null ? null : riskPercent(frozen) ?? 3;
  const loss = percent == null ? 0 : fills.openingNotional * (percent / 100);
  const settledNet = live.closedAt != null && live.asset === 'USDT' ? fills.net : null;
  const payoff = computeSettlementPayoffRatio(settledNet, loss);
  return { ...fills, percent, frozen: frozen != null, loss, payoffRatio: payoff, payoffPercent: payoff == null ? null : payoff * 100,
    stop: fills.entryPrice == null || percent == null ? undefined : fills.entryPrice * (1 + (live.direction === 'long' ? -1 : 1) * percent / 100) };
}
