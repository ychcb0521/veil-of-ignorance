import {
  isResolvedCampaign,
  selectValidCampaignPerformanceSamples,
  type CampaignPerformanceSample,
} from './kellySizing';

export interface AsymmetricRiskMetricsSummary {
  sampleCount: number;
  winCount: number;
  lossCount: number;
  excludedPayoffCount: number;
  dsi: number | null;
  usi: number | null;
  upsideStandardDeviation: number | null;
  downsideStandardDeviation: number | null;
  upsidePotential: number | null;
  downsidePotential: number | null;
  upr: number | null;
  omega: number | null;
  sortino: number | null;
  sortinoIdentityRhs: number | null;
  winSquaredSum: number;
  lossSquaredSum: number;
}

export interface AsymmetricRiskContribution {
  group: 'win' | 'loss';
  sampleCount: number;
  /** 该场进入 DSI/USI 组内均方的 b²/n 项。 */
  meanSquareTerm: number;
  /** 该场 b² 占对应组平方和的比例。 */
  meanSquareShare: number | null;
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

function safeSqrt(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const result = Math.sqrt(value);
  return Number.isFinite(result) ? result : null;
}

/**
 * 把左尾与右尾拆开统计。b > 0 为盈利；b <= 0（含盈亏平衡）为亏损组。
 * 不做截尾或缩尾，因而 b < -1 会完整进入所有下行指标。
 */
export function summarizeAsymmetricRiskMetrics(
  samples: CampaignPerformanceSample[],
): AsymmetricRiskMetricsSummary {
  const validSamples = selectValidCampaignPerformanceSamples(samples);
  const values = validSamples.map(sample => sample.payoffRatio as number);
  const wins = values.filter(value => value > 0);
  const losses = values.filter(value => value <= 0);
  const sampleCount = values.length;
  const winCount = wins.length;
  const lossCount = losses.length;
  const winSquaredSum = wins.reduce((sum, value) => sum + value ** 2, 0);
  const lossSquaredSum = losses.reduce((sum, value) => sum + value ** 2, 0);
  const winSum = wins.reduce((sum, value) => sum + value, 0);
  const absoluteLossSum = losses.reduce((sum, value) => sum + Math.max(-value, 0), 0);

  const dsi = lossCount > 0
    ? safeSqrt(lossSquaredSum / lossCount)
    : null;
  const winRootMeanSquare = winCount > 0
    ? safeSqrt(winSquaredSum / winCount)
    : null;
  const winMean = winCount > 0 ? safeDivide(winSum, winCount) : null;
  const usi = winRootMeanSquare != null && winMean != null
    ? safeDivide(winRootMeanSquare, winMean)
    : null;

  // 教科书 Sortino 口径：上下行标准差都以全部有效战役数 N 为分母。
  const upsideStandardDeviation = sampleCount > 0 && winCount > 0
    ? safeSqrt(winSquaredSum / sampleCount)
    : null;
  const downsideStandardDeviation = sampleCount > 0 && lossCount > 0
    ? safeSqrt(lossSquaredSum / sampleCount)
    : null;
  const upsidePotential = sampleCount > 0 && winCount > 0
    ? safeDivide(winSum, sampleCount)
    : null;
  const downsidePotential = sampleCount > 0 && lossCount > 0
    ? safeDivide(absoluteLossSum, sampleCount)
    : null;
  const upr = upsidePotential != null && downsideStandardDeviation != null
    ? safeDivide(upsidePotential, downsideStandardDeviation)
    : null;
  const omega = upsidePotential != null && downsidePotential != null
    ? safeDivide(upsidePotential, downsidePotential)
    : null;
  const sortino = upsidePotential != null
    && downsidePotential != null
    && downsideStandardDeviation != null
    ? safeDivide(upsidePotential - downsidePotential, downsideStandardDeviation)
    : null;
  const normalizedDownsidePotential = downsidePotential != null && downsideStandardDeviation != null
    ? safeDivide(downsidePotential, downsideStandardDeviation)
    : null;
  const sortinoIdentityRhs = upr != null && normalizedDownsidePotential != null
    ? upr - normalizedDownsidePotential
    : null;

  return {
    sampleCount,
    winCount,
    lossCount,
    excludedPayoffCount: samples.filter(sample => (
      isResolvedCampaign(sample.campaign)
      && (typeof sample.payoffRatio !== 'number' || !Number.isFinite(sample.payoffRatio))
    )).length,
    dsi,
    usi,
    upsideStandardDeviation,
    downsideStandardDeviation,
    upsidePotential,
    downsidePotential,
    upr,
    omega,
    sortino,
    sortinoIdentityRhs,
    winSquaredSum,
    lossSquaredSum,
  };
}

export interface AsymmetricRiskContributionRates {
  /** 该场 b² 占亏损组平方和的百分比；只有亏损（b ≤ 0）战役有值。 */
  dsiContributionPct: number | null;
  /** 该场 b² 占盈利组平方和的百分比；只有盈利（b > 0）战役有值。 */
  usiContributionPct: number | null;
}

const EMPTY_CONTRIBUTION_RATES: AsymmetricRiskContributionRates = {
  dsiContributionPct: null,
  usiContributionPct: null,
};

/**
 * 单场战役对 DSI / USI 的贡献率。
 *
 * DSI 与 USI 都建立在组内均方（b² 的平均）之上，因此一场战役的边际影响就是它的
 * b² 占本组平方和的比例——平方意味着大亏 / 大赚被显著放大，正是要看见的那件事。
 * 盈亏两组互斥：亏损战役只对 DSI 有贡献，盈利战役只对 USI 有贡献，另一侧为 null。
 *
 * 只对已了结且 b 有效的战役计算：未了结的战役本就不在 DSI/USI 的分母里，
 * 给它算占比会与口径不一致。
 */
export function computeAsymmetricRiskContributionRates(
  sample: CampaignPerformanceSample,
  summary: AsymmetricRiskMetricsSummary | null,
): AsymmetricRiskContributionRates {
  if (summary == null || !isResolvedCampaign(sample.campaign)) return EMPTY_CONTRIBUTION_RATES;
  const contribution = computeAsymmetricRiskContribution(sample.payoffRatio, summary);
  if (contribution == null || contribution.meanSquareShare == null) return EMPTY_CONTRIBUTION_RATES;
  const percentage = contribution.meanSquareShare * 100;
  if (!Number.isFinite(percentage)) return EMPTY_CONTRIBUTION_RATES;
  return contribution.group === 'loss'
    ? { dsiContributionPct: percentage, usiContributionPct: null }
    : { dsiContributionPct: null, usiContributionPct: percentage };
}

export function computeAsymmetricRiskContribution(
  payoffRatio: number | null,
  summary: AsymmetricRiskMetricsSummary | null,
): AsymmetricRiskContribution | null {
  if (summary == null || payoffRatio == null || !Number.isFinite(payoffRatio)) return null;
  const group = payoffRatio > 0 ? 'win' : 'loss';
  const sampleCount = group === 'win' ? summary.winCount : summary.lossCount;
  if (sampleCount <= 0) return null;
  const squared = payoffRatio ** 2;
  const squaredSum = group === 'win' ? summary.winSquaredSum : summary.lossSquaredSum;
  return {
    group,
    sampleCount,
    meanSquareTerm: squared / sampleCount,
    meanSquareShare: squaredSum > 0 ? squared / squaredSum : null,
  };
}
