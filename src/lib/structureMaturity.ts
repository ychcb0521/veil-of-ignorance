/**
 * 结构成熟度 · 建模台。
 *
 * 错题集把预测误差按「错误种类」切；这一层把同一份误差按「结构（edge 源头）」切，
 * 回答另一个问题：哪个结构我已经建好、误差低且稳，稳到可以当过滤器去捕捉匹配标的。
 *
 * 这是「错误模式 → 拦截规则」负向回路（criticalPatternDetector）的正向镜像：
 * 不是把反复的错误升级成规则去封杀，而是把收敛的结构毕业成模型去复用。
 *
 * 下注的是一个「结构闭环」，不是一个期望值：正（最大概率的正向走势预期）/ 反（与预期不符
 * 的判断准则）/ 止（什么信号一出就意味预期失效）。期望值只是「正 / 胜率」这一片的标量。
 * 因此成熟 = 闭环成熟：胜率要校准（Brier 低且稳），止损也要走「前门」——真亏时是按预案
 * 触发的，而不是「死法不在预案内」。后门死法过半 → 一票压档，胜率再准也不给毕业。
 *
 * 全部由现有字段派生（edge 源头 / 预测胜率 / 赔率结构 / 实际结果），不依赖任何数据库改动。
 * 纯函数、无副作用，便于测试。
 */
import type { EdgeSource, TradeJournal } from '@/types/journal';
import { EDGE_SOURCE_LABELS } from '@/lib/edgeSource';
import { analyzeTradeError, isAnalyzableTrade, type TradeErrorAnalysis } from '@/lib/predictionError';
import { aggregateErrorTypes, type ErrorFamily } from '@/lib/errorTypes';
import { classifyDeathDoor } from '@/lib/structureLoop';

/** 成熟度档：混沌（还没建好）→ 成形中（误差在收敛）→ 成熟（可作过滤器）。 */
export type MaturityTier = 'chaos' | 'forming' | 'mature';

export interface StructureDominantError {
  id: string;
  title: string;
  family: ErrorFamily;
  count: number;
}

export interface StructureMaturity {
  edge: EdgeSource;
  label: string;
  /** 押注过、已复盘、有真实结果的样本数（这个结构你真实下注过几次）。 */
  trades: number;
  /** 进入胜率校准的样本数（有预测胜率且 win/loss）。 */
  calibratedN: number;
  /** 平均预测胜率（%）。 */
  avgPredictedWinPct: number | null;
  /** 实际胜率（%）。 */
  actualWinRatePct: number | null;
  /** 过度自信缺口（pp）= 预测胜率 − 实际胜率。正 = 高估自己。 */
  winGapPP: number | null;
  /** Brier 分（0..1，越低越准；0.25 = 永远拍 50% 的基线）。 */
  brier: number | null;
  /** 平均校准误差 |预测 − 实际|（0..1）。 */
  meanAbsError: number | null;
  /** 平均 R 兑现缺口（目标 R − 实际 R）；正 = 没打到自己定的目标。 */
  rShortfall: number | null;
  /** 误差趋势：新半段平均 |误差| − 旧半段。负 = 在收敛（变好）；样本 < 4 为 null。 */
  errorTrend: number | null;
  /** 止 · 前门死法：亏损里按预案触发并止损（triggered_reacted）的笔数 —— 干净的死法。 */
  deathFront: number;
  /** 止 · 晚门死法：看见了却晚动（triggered_late）的笔数。 */
  deathLate: number;
  /** 止 · 后门死法：死法不在预案内（not_triggered）的笔数 —— 没建模的失败模式。 */
  deathBack: number;
  /** 能判定死法的亏损样本数（前门 + 晚门 + 后门）。 */
  judgedDeaths: number;
  /** 前门死法占比（越高越好）；judgedDeaths = 0 时为 null。 */
  frontDoorDeathRate: number | null;
  /** 后门死法占比（越高越危险，过半压档）；judgedDeaths = 0 时为 null。 */
  backDoorDeathRate: number | null;
  /** 该结构最常栽的那类错（来自错题集，scope 到本结构）；无则 null。 */
  dominantError: StructureDominantError | null;
  /** 成熟度档。 */
  tier: MaturityTier;
  /** 档位说明（视图可直接渲染）。 */
  tierReason: string;
  /** 押注该结构的交易，最近在前（证据）。 */
  journals: TradeJournal[];
}

export interface StructureMaturityResult {
  /** 全部结构：成熟在前、同档按样本数降序。 */
  structures: StructureMaturity[];
  /** 已成熟的结构（tier === 'mature'）—— 你已建好、可作过滤器的模型。 */
  matured: StructureMaturity[];
}

// ===== 成熟度阈值（命名常量，便于调参与测试） =====
/** 判定成熟度所需的最少校准样本（plural of anecdote is not data）。 */
export const MATURITY_MIN_SAMPLES = 5;
/** Brier ≤ 此视为「准」。0.25 是永远拍 50% 的基线，0.18 明显优于基线。 */
export const MATURE_BRIER_MAX = 0.18;
/** 近期（新半段）平均 |误差| ≤ 此视为「当下仍准」。 */
export const MATURE_RECENT_ERR_MAX = 0.30;
/** Brier ≤ 此（基线附近）至少算「成形中」。 */
export const FORMING_BRIER_MAX = 0.25;
/** 误差趋势 < 此视为「在收敛」。 */
export const IMPROVING_EPS = -0.02;
/** 误差趋势 > 此视为「在恶化」，即使当前准也不算成熟。 */
export const WORSENING_EPS = 0.05;
/** 判定「后门死法」需要的最少可判定亏损样本（少了不下结论）。 */
export const LOOP_MIN_DEATHS = 3;
/** 亏损里「死法不在预案内」超过此比例 → 一票压档，胜率再准也不给毕业。 */
export const BACKDOOR_VETO_RATE = 0.5;

function tsOf(j: TradeJournal): number {
  const s = j.post_reviewed_at ?? j.pre_real_time ?? j.created_at;
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

interface TierOutcome {
  tier: MaturityTier;
  reason: string;
}

/** 由「样本量 + Brier + 近期误差 + 误差趋势」判档。纯函数，便于单测。 */
export function decideMaturityTier(args: {
  calibratedN: number;
  brier: number | null;
  recentErr: number | null;
  errorTrend: number | null;
  backDoorRate?: number | null;
  judgedDeaths?: number;
}): TierOutcome {
  const { calibratedN, brier, recentErr, errorTrend, backDoorRate = null, judgedDeaths = 0 } = args;
  if (calibratedN < MATURITY_MIN_SAMPLES || brier == null) {
    return {
      tier: 'chaos',
      reason: `校准样本 ${calibratedN}/${MATURITY_MIN_SAMPLES} —— 还在混沌里，先攒样本`,
    };
  }
  const accurate =
    brier <= MATURE_BRIER_MAX && (recentErr == null || recentErr <= MATURE_RECENT_ERR_MAX);
  const notWorsening = errorTrend == null || errorTrend <= WORSENING_EPS;
  if (accurate && notWorsening) {
    // 止 闭环未闭合：亏损多从「后门」走（死法不在预案内）→ 胜率再准也不给毕业。
    const loopBroken =
      judgedDeaths >= LOOP_MIN_DEATHS && backDoorRate != null && backDoorRate > BACKDOOR_VETO_RATE;
    if (loopBroken) {
      return {
        tier: 'forming',
        reason: `胜率准（Brier ${brier.toFixed(2)}），但 ${Math.round(
          (backDoorRate as number) * 100,
        )}% 的亏损死在预案外 —— 失败模式还没建模，先把止损前置`,
      };
    }
    return { tier: 'mature', reason: `误差低且稳（Brier ${brier.toFixed(2)}）—— 可作过滤器` };
  }
  const improving = errorTrend != null && errorTrend < IMPROVING_EPS;
  if (brier <= FORMING_BRIER_MAX || improving) {
    return {
      tier: 'forming',
      reason: improving
        ? '误差在收敛，但还没稳 —— 成形中'
        : `误差接近基线（Brier ${brier.toFixed(2)}）—— 成形中`,
    };
  }
  return {
    tier: 'chaos',
    reason: `误差大${errorTrend != null && errorTrend > WORSENING_EPS ? '且在恶化' : '且不稳'} —— 结构还没建好`,
  };
}

const TIER_RANK: Record<MaturityTier, number> = { mature: 0, forming: 1, chaos: 2 };

/**
 * 把已复盘交易按结构（edge 源头）聚合成「结构成熟度目录」。
 * 只纳入押注过、已复盘、有真实结果、且标了 edge 源头的主力单。
 */
export function aggregateStructureMaturity(journals: TradeJournal[]): StructureMaturityResult {
  const analyses: TradeErrorAnalysis[] = [];
  for (const j of journals) {
    if (!isAnalyzableTrade(j)) continue;
    if (!j.pre_edge_source) continue;
    const a = analyzeTradeError(j);
    if (a) analyses.push(a);
  }

  // 按 edge 分桶。
  const byEdge = new Map<EdgeSource, TradeErrorAnalysis[]>();
  for (const a of analyses) {
    const edge = a.journal.pre_edge_source as EdgeSource;
    const bucket = byEdge.get(edge);
    if (bucket) bucket.push(a);
    else byEdge.set(edge, [a]);
  }

  const structures: StructureMaturity[] = [];
  for (const [edge, group] of byEdge) {
    const sorted = [...group].sort((a, b) => tsOf(a.journal) - tsOf(b.journal));
    const journalsAsc = sorted.map(a => a.journal);

    // 胜率校准子集：有预测胜率且 win/loss（calibrationGap 才有值）。
    const calibrated = sorted.filter(a => a.calibrationGap != null);
    const calibratedN = calibrated.length;
    const gaps = calibrated.map(a => a.calibrationGap as number);
    const errs = gaps.map(g => Math.abs(g));
    const brier = calibratedN ? mean(gaps.map(g => g * g)) : null;
    const meanAbsError = mean(errs);

    // 误差趋势 + 近期误差（新半段）。样本 < 4 时趋势不下结论。
    let errorTrend: number | null = null;
    let recentErr: number | null = meanAbsError;
    if (errs.length >= 4) {
      const mid = Math.floor(errs.length / 2);
      const olderMean = mean(errs.slice(0, mid))!;
      const newerMean = mean(errs.slice(mid))!;
      errorTrend = newerMean - olderMean;
      recentErr = newerMean;
    }

    // 胜率：预测 vs 实际。
    const winLoss = sorted.filter(a => a.actualWin != null);
    const withPred = winLoss.filter(a => a.predictedWinPct != null);
    const avgPredictedWinPct = mean(withPred.map(a => a.predictedWinPct as number));
    const wins = winLoss.filter(a => a.actualWin === true).length;
    const actualWinRatePct = winLoss.length ? (wins / winLoss.length) * 100 : null;
    const winGapPP =
      avgPredictedWinPct != null && actualWinRatePct != null
        ? avgPredictedWinPct - actualWinRatePct
        : null;

    // R 兑现缺口（目标 R − 实际 R）。
    const rShortfall = mean(
      sorted.map(a => a.rShortfall).filter((v): v is number => v != null),
    );

    // 主导误差类型（复用错题集，scope 到本结构）。
    const top = aggregateErrorTypes(journalsAsc).find(t => t.count > 0);
    const dominantError: StructureDominantError | null = top
      ? { id: top.id, title: top.title, family: top.family, count: top.count }
      : null;

    // 止 · 死法门：这个结构「怎么死的」，只在亏损上判（赢时止损本就不必触发）。
    // 前门=按预案触发并执行；晚门=看见了却晚动；后门=死法不在预案内（没建模的失败模式）。
    let deathFront = 0;
    let deathLate = 0;
    let deathBack = 0;
    for (const a of sorted) {
      // 与单笔闭环判读共用同一死法门口径（未评价证伪状态 → null，不计入分母）。
      const door = classifyDeathDoor(a.journal.post_outcome, a.journal.exit_falsification_status);
      if (door === 'front') deathFront += 1;
      else if (door === 'late') deathLate += 1;
      else if (door === 'back') deathBack += 1;
    }
    const judgedDeaths = deathFront + deathLate + deathBack;
    const frontDoorDeathRate = judgedDeaths ? deathFront / judgedDeaths : null;
    const backDoorDeathRate = judgedDeaths ? deathBack / judgedDeaths : null;

    const { tier, reason } = decideMaturityTier({
      calibratedN,
      brier,
      recentErr,
      errorTrend,
      backDoorRate: backDoorDeathRate,
      judgedDeaths,
    });

    structures.push({
      edge,
      label: EDGE_SOURCE_LABELS[edge] ?? edge,
      trades: group.length,
      calibratedN,
      avgPredictedWinPct,
      actualWinRatePct,
      winGapPP,
      brier,
      meanAbsError,
      rShortfall,
      errorTrend,
      deathFront,
      deathLate,
      deathBack,
      judgedDeaths,
      frontDoorDeathRate,
      backDoorDeathRate,
      dominantError,
      tier,
      tierReason: reason,
      journals: [...journalsAsc].reverse(), // 最近在前
    });
  }

  structures.sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      b.trades - a.trades ||
      a.label.localeCompare(b.label),
  );

  return {
    structures,
    matured: structures.filter(s => s.tier === 'mature'),
  };
}
