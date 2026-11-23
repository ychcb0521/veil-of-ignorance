import type { TradeCampaign } from '@/types/journal';
import { computeSettlementPayoffRatio } from '@/lib/campaignB';
import { initialPayoffRiskThreshold, timedDrawdownPayoffPct } from './qualityStaticDrawdownSell';
import { usdtCampaignAmounts, type UsdtLiveCampaign } from './usdtLiveCampaign';

// The exchange can split one order across fills and allocate only part of a reversal to this campaign.
function measureFills(live: UsdtLiveCampaign) {
  const openingId = live.fills[0]?.orderId;
  const closingId = live.closedAt != null ? live.fills.at(-1)?.orderId : undefined;
  const additions = new Set<string>();
  const addFactors = new Map<string, number>();
  let openingSize = 0, openingNotional = 0, totalEntryNotional = 0, held = 0;
  let exitSize = 0, exitNotional = 0, firstCut = 0;
  let firstCutId: string | undefined;
  let valid = true;
  for (const fill of live.fills) {
    const qty = Number(fill.positionQuantity), price = Number(fill.price);
    if (!(qty > 0 && price > 0 && Number.isFinite(price * qty))) { valid = false; continue; }
    if (fill.action === 'reduce') {
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
    }
  }
  return { openingNotional: valid ? openingNotional : 0, openingSize: valid ? openingSize : 0,
    entryPrice: valid && openingSize > 0 ? openingNotional / openingSize : null,
    exitPrice: valid && exitSize > 0 ? exitNotional / exitSize : null,
    totalEntryNotional: valid ? totalEntryNotional : null, addCount: additions.size,
    addRatios: valid ? Array.from(addFactors.values(), factor => factor - 1) : null,
    earlyReduction: valid && openingSize > 0 ? firstCut / openingSize : null,
    ...usdtCampaignAmounts(live) };
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

export function linkedUsdtEntryRiskPct(live: UsdtLiveCampaign, owner: string, paper?: TradeCampaign) {
  if (!paper || paper.id !== live.followId || paper.user_id !== owner || paper.comparison?.section !== 'instant'
    || paper.direction !== (live.direction === 'long' ? 'main_long' : 'main_short')) return;
  const market = paper.comparison.instant?.source.binanceSymbol ?? paper.symbol;
  if (market.replace(/\//g, '').toUpperCase() !== live.symbol) return;
  const comparison = paper.comparison;
  const firstSwitch = comparison.instant?.switches?.[0];
  const plan = firstSwitch ? firstSwitch.from.plan : comparison.monitorPlan;
  return riskPercent(plan ? (timedDrawdownPayoffPct(plan) ?? initialPayoffRiskThreshold(plan)) : comparison.instant?.initialStaticStopPct);
}

export function usdtLiveRiskMetrics(campaign?: Pick<TradeCampaign, 'comparison'> | null) {
  const live = campaign?.comparison?.liveUsdt;
  if (!live) return;
  const fills = usdtLiveFillMetrics(live);
  const managed = live.management;
  const firstSwitch = managed?.switches?.[0];
  const entryPlan = managed && managed.armedAt <= live.openedAt ? (firstSwitch ? firstSwitch.from.plan : managed.monitor.plan) : undefined;
  const frozen = riskPercent(campaign.comparison?.liveEntryRiskPct) ?? (entryPlan && riskPercent(timedDrawdownPayoffPct(entryPlan) ?? initialPayoffRiskThreshold(entryPlan)));
  const percent = frozen ?? 3;
  const loss = fills.openingNotional * (percent / 100);
  const settledNet = live.closedAt != null && live.asset === 'USDT' ? fills.net : null;
  const payoff = computeSettlementPayoffRatio(settledNet, loss);
  return { ...fills, percent, frozen: frozen != null, loss, payoffRatio: payoff, payoffPercent: payoff == null ? null : payoff * 100,
    stop: fills.entryPrice == null ? undefined : fills.entryPrice * (1 + (live.direction === 'long' ? -1 : 1) * percent / 100) };
}
