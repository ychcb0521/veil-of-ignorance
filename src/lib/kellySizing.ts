/**
 * 下注规模 — 分数 Kelly + 毁灭概率封顶（批次 25）
 *
 * 核心原则（Munger / Buffett / Taleb）：
 *   1. 少下注、下大注：只在赔率明显被错误定价（折扣后仍有正期望）时才出手。
 *   2. 带杠杆时，仓位上限必须由【毁灭概率】封顶，而不是由【信心】封顶——
 *      因为信心会系统性偏高，而 ergodicity 下的破产是不可逆终点。
 *
 * 关键：本模块所有数字【绝不写库】，仅用于开仓快照里的实时显示。
 * 输入的胜率应当是【折扣后】的诚实胜率（confidenceDiscount.discountedPct / 100），
 * 而不是滑块原值，否则会把已知的偏高再喂回 Kelly，放大下注。
 */
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import { estimateBankruptcy } from './bankruptcyEstimator';

/** 目标：按当前下注规模连打 100 笔，破产概率不超过这个上限。 */
export const RUIN_PROBABILITY_TARGET = 0.05;
/** 分数 Kelly 系数：半 Kelly，吸收估计误差与路径波动，避免被自己的过度自信反噬。 */
export const KELLY_FRACTION = 0.5;
/** 个人历史样本不足时的默认盈亏比 b = 平均盈利 / 平均亏损。 */
export const DEFAULT_PAYOFF_RATIO = 2;
/** 估计个人盈亏比所需的最小盈/亏样本数（各自）。 */
export const MIN_PAYOFF_SAMPLES = 5;
/** 估计战役胜率所需的最小已结束战役样本数。 */
export const MIN_CAMPAIGN_WINRATE_SAMPLES = 5;

export interface CampaignSizingStats {
  winRate: number | null;
  winRateSampleCount: number;
  payoffRatio: number | null;
  payoffWinCount: number;
  payoffLossCount: number;
}

export type BetSizingVerdict =
  /** 折扣后无正期望 → 不该下注。 */
  | 'no_edge'
  /** 计划亏损超过毁灭概率封顶 → 用信心而非毁灭概率定仓位，最危险。 */
  | 'over_ruin_cap'
  /** 计划亏损未破毁灭概率封顶，但高于半 Kelly 上限。 */
  | 'over_kelly'
  /** 计划亏损在建议上限内。 */
  | 'within';

export interface BetSizingInput {
  /** 折扣后的诚实胜率 0-1。 */
  winProb: number;
  /** 盈亏比 b = 平均盈利 / 平均亏损（> 0）。 */
  payoffRatio: number;
  /** 账户净值估算 USDT。 */
  equity: number;
  /** 用户当前计划承受的单笔最大亏损 USDT；未填为 null。 */
  plannedMaxLossUsdt: number | null;
}

export interface BetSizingResult {
  /** 完整 Kelly 比例 f* = (p·b − q) / b，可为负（负 = 无优势）。 */
  kellyFraction: number;
  /** 半 Kelly 对应的单笔最大亏损 USDT（占净值 f*·KELLY_FRACTION），下限 0。 */
  halfKellyMaxLossUsdt: number;
  /** 毁灭概率封顶对应的单笔最大亏损 USDT（令破产概率 ≤ target 的最大值）。 */
  ruinCapMaxLossUsdt: number;
  /** 建议单笔最大亏损 = min(半 Kelly, 毁灭概率封顶)，下限 0。 */
  recommendedMaxLossUsdt: number;
  /** 在【用户计划亏损】下、连打 100 笔的破产概率；plannedMaxLossUsdt 为空时为 null。 */
  ruinProbabilityAtPlanned: number | null;
  /** 在【建议亏损】下的破产概率，用于展示封顶后的安全水平。 */
  ruinProbabilityAtRecommended: number;
  /** 盈亏比（回显用）。 */
  payoffRatio: number;
  verdict: BetSizingVerdict;
}

/** 破产概率随单笔亏损单调上升 → 二分求"令 ruin ≤ target 的最大单笔亏损"。 */
function solveRuinCapMaxLoss(winProb: number, payoffRatio: number, equity: number): number {
  if (equity <= 0) return 0;
  let lo = 0;
  let hi = equity; // 单笔不可能合理地拿全部净值去冒险，作为上界
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const { ruinProbability } = estimateBankruptcy({
      winProb,
      maxLossUsdt: mid,
      availableBalance: equity,
      payoffRatio,
    });
    if (ruinProbability <= RUIN_PROBABILITY_TARGET) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function computeBetSizing(input: BetSizingInput): BetSizingResult {
  const p = Math.max(0, Math.min(1, input.winProb));
  const b = input.payoffRatio > 0 ? input.payoffRatio : DEFAULT_PAYOFF_RATIO;
  const equity = Number.isFinite(input.equity) && input.equity > 0 ? input.equity : 0;
  const planned = input.plannedMaxLossUsdt != null && Number.isFinite(input.plannedMaxLossUsdt) && input.plannedMaxLossUsdt > 0
    ? input.plannedMaxLossUsdt
    : null;

  // Kelly：f* = (p·b − q) / b，其中 q = 1 − p。
  const kellyFraction = (p * b - (1 - p)) / b;
  const halfKellyMaxLossUsdt = Math.max(0, equity * kellyFraction * KELLY_FRACTION);
  const ruinCapMaxLossUsdt = kellyFraction > 0 ? solveRuinCapMaxLoss(p, b, equity) : 0;
  const recommendedMaxLossUsdt = Math.max(0, Math.min(halfKellyMaxLossUsdt, ruinCapMaxLossUsdt));

  const ruinProbabilityAtPlanned = planned == null || equity <= 0
    ? null
    : estimateBankruptcy({ winProb: p, maxLossUsdt: planned, availableBalance: equity, payoffRatio: b }).ruinProbability;
  const ruinProbabilityAtRecommended = recommendedMaxLossUsdt <= 0 || equity <= 0
    ? 0
    : estimateBankruptcy({ winProb: p, maxLossUsdt: recommendedMaxLossUsdt, availableBalance: equity, payoffRatio: b }).ruinProbability;

  let verdict: BetSizingVerdict;
  if (kellyFraction <= 0) {
    verdict = 'no_edge';
  } else if (planned == null) {
    verdict = 'within';
  } else if (planned > ruinCapMaxLossUsdt + 1e-6) {
    verdict = 'over_ruin_cap';
  } else if (planned > halfKellyMaxLossUsdt + 1e-6) {
    verdict = 'over_kelly';
  } else {
    verdict = 'within';
  }

  return {
    kellyFraction,
    halfKellyMaxLossUsdt,
    ruinCapMaxLossUsdt,
    recommendedMaxLossUsdt,
    ruinProbabilityAtPlanned,
    ruinProbabilityAtRecommended,
    payoffRatio: b,
    verdict,
  };
}

/**
 * 从历史已平仓 'trade' journal 估个人盈亏比 b = 平均盈利 / 平均亏损。
 * 盈/亏样本各需 ≥ MIN_PAYOFF_SAMPLES，否则返回 null（调用方回落到默认值）。
 */
export function estimatePayoffRatio(journals: TradeJournal[]): number | null {
  const wins: number[] = [];
  const losses: number[] = [];
  for (const journal of journals) {
    if ((journal.journal_kind ?? 'trade') !== 'trade') continue;
    const pnl = journal.post_realized_pnl;
    if (typeof pnl !== 'number' || !Number.isFinite(pnl)) continue;
    if (pnl > 0) wins.push(pnl);
    else if (pnl < 0) losses.push(-pnl);
  }
  if (wins.length < MIN_PAYOFF_SAMPLES || losses.length < MIN_PAYOFF_SAMPLES) return null;
  const avgWin = wins.reduce((sum, value) => sum + value, 0) / wins.length;
  const avgLoss = losses.reduce((sum, value) => sum + value, 0) / losses.length;
  if (avgLoss <= 0) return null;
  return avgWin / avgLoss;
}

function isResolvedCampaign(campaign: TradeCampaign): boolean {
  return (
    ['closed_profit', 'closed_loss', 'closed_breakeven'].includes(campaign.status)
    && typeof campaign.final_realized_pnl === 'number'
    && Number.isFinite(campaign.final_realized_pnl)
  );
}

/**
 * 用已结束战役估下注规模的两个基础统计：
 *   1. 胜率 = 盈利战役 / 全部已结束战役
 *   2. 盈亏比 = 平均盈利战役 PnL / 平均亏损战役 |PnL|
 */
export function estimateCampaignSizingStats(campaigns: TradeCampaign[]): CampaignSizingStats {
  const resolved = campaigns.filter(isResolvedCampaign);
  const wins = resolved.filter(campaign => (campaign.final_realized_pnl ?? 0) > 0);
  const losses = resolved.filter(campaign => (campaign.final_realized_pnl ?? 0) < 0);

  const winRate = resolved.length >= MIN_CAMPAIGN_WINRATE_SAMPLES
    ? wins.length / resolved.length
    : null;

  let payoffRatio: number | null = null;
  if (wins.length >= MIN_PAYOFF_SAMPLES && losses.length >= MIN_PAYOFF_SAMPLES) {
    const avgWin = wins.reduce((sum, campaign) => sum + (campaign.final_realized_pnl ?? 0), 0) / wins.length;
    const avgLoss = losses.reduce((sum, campaign) => sum + Math.abs(campaign.final_realized_pnl ?? 0), 0) / losses.length;
    if (avgLoss > 0) payoffRatio = avgWin / avgLoss;
  }

  return {
    winRate,
    winRateSampleCount: resolved.length,
    payoffRatio,
    payoffWinCount: wins.length,
    payoffLossCount: losses.length,
  };
}
