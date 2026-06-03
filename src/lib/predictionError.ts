/**
 * 预测 vs 实际 —— 错题集的核心。
 *
 * 决策记录的唯一目的：看见错误、消除错误。
 * 所以错题集只算一件事：快照时「你的预测」与最终「实际结果」之间的误差。
 * 其余聚类 / 统计 / 时间分布全部退场，把注意力焊死在误差上。
 *
 * 所有 P&L 单位为 USDT；纯函数，无副作用，便于测试。
 */
import type { OddsStructure, TradeJournal } from '@/types/journal';

/** 预测的赔率结构 → 近似 R 目标（用于「预测 R 目标 vs 实际 R」缺口）。 */
const ODDS_TARGET_R: Partial<Record<OddsStructure, number>> = {
  r1_easy: 1,
  r2_supported: 2,
  r3_open: 3,
};

export interface TradeErrorAnalysis {
  journal: TradeJournal;

  // —— 快照时的预测 ——
  /** 快照时预测的胜率（0-100）；旧版快照 / 对冲单为 null。 */
  predictedWinPct: number | null;
  /** 由赔率结构推断的目标 R；未分类为 null。 */
  predictedTargetR: number | null;

  // —— 最终实际结果 ——
  /** win=true，loss=false，breakeven / 无结果=null（不进校准）。 */
  actualWin: boolean | null;
  actualR: number | null;
  actualPnl: number | null;

  // —— 误差 ——
  /** 校准误差：预测胜率(0-1) − 实际命中(0/1)，带方向。正 = 偏过度自信。 */
  calibrationGap: number | null;
  /** 高预测胜率却亏损：典型过度自信误差。 */
  overconfident: boolean;
  /** R 目标缺口：预测目标 R − 实际 R。正 = 没打到自己定的目标。 */
  rShortfall: number | null;
  /** 证伪信号触发了，但你反应晚了 —— 纪律误差（你看见了却没动）。 */
  falsificationLate: boolean;
  /** 盲区候选：亏损，且证伪信号从未触发 —— 杀死你的东西不在你盯的信号里。 */
  blindSpotCandidate: boolean;
  /** 危险的幸运：坏决策却赢了 —— 运气掩盖了过程错误，最该警惕。 */
  luckyBadDecision: boolean;

  /** 综合误差分（越大越该先看），仅用于排序。 */
  errorScore: number;
}

/** 该笔交易是否进入「预测 vs 实际」分析：真实交易、已复盘、有真实结果（排除未入场）。 */
export function isAnalyzableTrade(j: TradeJournal): boolean {
  if ((j.journal_kind ?? 'trade') !== 'trade') return false;
  if ((j.order_kind ?? 'main') === 'hedge') return false; // 对冲单是辅助，不进误差核心
  if (!j.post_reviewed_at) return false;
  if (!j.post_outcome || j.post_outcome === 'no_entry') return false;
  return true;
}

export function analyzeTradeError(j: TradeJournal): TradeErrorAnalysis | null {
  if (!isAnalyzableTrade(j)) return null;

  const predictedWinPct =
    typeof j.pre_calibration_win_pct === 'number' ? j.pre_calibration_win_pct : null;
  const predictedTargetR = j.pre_odds_structure
    ? ODDS_TARGET_R[j.pre_odds_structure] ?? null
    : null;

  const actualWin =
    j.post_outcome === 'win' ? true : j.post_outcome === 'loss' ? false : null;
  const actualR = typeof j.post_r_multiple === 'number' ? j.post_r_multiple : null;
  const actualPnl = typeof j.post_realized_pnl === 'number' ? j.post_realized_pnl : null;

  // 校准误差：只在 win/loss 且有预测时有意义。
  const calibrationGap =
    predictedWinPct != null && actualWin != null
      ? predictedWinPct / 100 - (actualWin ? 1 : 0)
      : null;
  const overconfident = predictedWinPct != null && predictedWinPct >= 60 && actualWin === false;

  const rShortfall =
    predictedTargetR != null && actualR != null ? predictedTargetR - actualR : null;

  const falsificationLate = j.exit_falsification_status === 'triggered_late';
  const blindSpotCandidate =
    actualWin === false && j.exit_falsification_status === 'not_triggered';
  const luckyBadDecision = j.post_decision_quality === 'bad' && actualWin === true;

  const errorScore =
    (calibrationGap != null ? Math.abs(calibrationGap) * 100 : 0) +
    (rShortfall != null && rShortfall > 0 ? Math.min(rShortfall, 5) * 10 : 0) +
    (falsificationLate ? 40 : 0) +
    (blindSpotCandidate ? 50 : 0) +
    (luckyBadDecision ? 30 : 0);

  return {
    journal: j,
    predictedWinPct,
    predictedTargetR,
    actualWin,
    actualR,
    actualPnl,
    calibrationGap,
    overconfident,
    rShortfall,
    falsificationLate,
    blindSpotCandidate,
    luckyBadDecision,
    errorScore,
  };
}

/** 批量分析并按误差从大到小排序（最该先看的错误排最前）。 */
export function analyzeTrades(journals: TradeJournal[]): TradeErrorAnalysis[] {
  return journals
    .map(analyzeTradeError)
    .filter((a): a is TradeErrorAnalysis => a !== null)
    .sort((a, b) => b.errorScore - a.errorScore);
}

export interface CalibrationSummary {
  reviewedCount: number;
  /** 进入校准的样本数（有预测胜率且 win/loss）。 */
  calibratedCount: number;
  /** 平均预测胜率（百分比）。 */
  avgPredictedWinPct: number | null;
  /** 实际胜率（百分比）。 */
  actualWinRatePct: number | null;
  /** 过度自信缺口（百分点）= 平均预测胜率 − 实际胜率。正 = 系统性高估自己。 */
  overconfidenceGapPP: number | null;
  /** 平均预测目标 R。 */
  avgPredictedTargetR: number | null;
  /** 平均实际 R。 */
  avgActualR: number | null;
  /** 证伪纪律：信号触发后「按时反应」的比例（百分比）。 */
  falsificationOnTimeRatePct: number | null;
  /** 盲区候选笔数。 */
  blindSpotCount: number;
  /** 危险幸运笔数（坏决策却赢）。 */
  luckyBadCount: number;
}

function mean(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export function summarizeCalibration(analyses: TradeErrorAnalysis[]): CalibrationSummary {
  const winLoss = analyses.filter(a => a.actualWin != null);
  const calibrated = winLoss.filter(a => a.predictedWinPct != null);

  const avgPredictedWinPct = mean(calibrated.map(a => a.predictedWinPct as number));
  const wins = winLoss.filter(a => a.actualWin === true).length;
  const actualWinRatePct = winLoss.length ? (wins / winLoss.length) * 100 : null;
  const overconfidenceGapPP =
    avgPredictedWinPct != null && actualWinRatePct != null
      ? avgPredictedWinPct - actualWinRatePct
      : null;

  const avgPredictedTargetR = mean(
    analyses.map(a => a.predictedTargetR).filter((v): v is number => v != null),
  );
  const avgActualR = mean(
    analyses.map(a => a.actualR).filter((v): v is number => v != null),
  );

  const triggered = analyses.filter(
    a =>
      a.journal.exit_falsification_status === 'triggered_reacted' ||
      a.journal.exit_falsification_status === 'triggered_late',
  );
  const onTime = triggered.filter(
    a => a.journal.exit_falsification_status === 'triggered_reacted',
  ).length;
  const falsificationOnTimeRatePct = triggered.length
    ? (onTime / triggered.length) * 100
    : null;

  return {
    reviewedCount: analyses.length,
    calibratedCount: calibrated.length,
    avgPredictedWinPct,
    actualWinRatePct,
    overconfidenceGapPP,
    avgPredictedTargetR,
    avgActualR,
    falsificationOnTimeRatePct,
    blindSpotCount: analyses.filter(a => a.blindSpotCandidate).length,
    luckyBadCount: analyses.filter(a => a.luckyBadDecision).length,
  };
}
