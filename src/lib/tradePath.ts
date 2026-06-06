/**
 * 路径判读 · 平仓后从 K 线还原「这一单是怎么走的」。
 *
 * 录音稿的第一性原理：一笔对的交易，从第一手就是盈利的，不该有浮亏；
 *   浮亏 = 主动权不在自己手里。胜率高却靠扛单 / 摊低成本换来的 = 变相马丁，
 *   是把「赢」做成了爆仓引擎 —— 最危险的恰恰是「扛单赢」。
 *
 * 终点指标（赢 / 亏、R 倍数）看不见这些：扛单赢和干净赢，终点都是赢。
 * 但模拟器握有完整历史 K 线 + 开 / 平仓时间，浮盈浮亏的整条路径是「免费」可算的：
 *   MAE（最大浮亏）/ MFE（最大浮盈）/ 浸亏时长 / 反馈速度 / 是否破过止损 / 主动权。
 * 这个库只读 OHLC，把路径收口成一组读数 + 一句裁决。纯函数、无副作用。
 *
 * 注意：这里不预测顶底，也不评判「点位猜得对不对」；只描述
 *   「按当时已知信息，这条路径把主动权握住了，还是交了出去」。
 */
import type { LegTone } from '@/lib/structureLoop';
import type { TradeOutcome } from '@/types/journal';

/** MAE ≤ 0.5R：基本没怎么浮亏，上来即顺 —— 干净。 */
export const SHALLOW_MAE_R = 0.5;
/** MAE > 1.2R：浮亏跑过了一倍风险，已经在扛 —— 主动权交出去了。 */
export const OVERRUN_MAE_R = 1.2;
/** 浸在水下的时间 ≥ 70%：大半程在浮亏里熬 —— 扛单的体感证据。 */
export const DROWN_TIME_PCT = 0.7;

export interface TradePathBar {
  high: number;
  low: number;
  close: number;
}

/**
 * 路径解析：按当时已知信息，这条结构「证实 / 证伪 / 还没给答案」。
 *   confirmed  先够到了确认距离（盈利方向先兑现）；
 *   falsified  先够到了证伪距离（不利方向先打穿）；
 *   unresolved 持仓期内两边都没够到（没有止损则无证伪距离，常落这里）。
 */
export type PathResolution = 'confirmed' | 'falsified' | 'unresolved';

/**
 * N 字判读（接对冲探针的口径）：触发后随后是 N 字上行还是下行。
 *   continuation 续势（先确认）；breakdown 破位（破过止损）；chop 反复（都没给答案）。
 */
export type NShape = 'continuation' | 'breakdown' | 'chop';

/** 主动权：held 握住（浮亏浅、没久熬）；surrendered 交出去（扛过了 / 久熬水下）。 */
export type PathInitiative = 'held' | 'surrendered';

/** 赢的质量（仅在赢时有意义）：clean 干净赢；dragged 扛出来的赢（变相马丁的味道）。 */
export type WinQuality = 'clean' | 'dragged';

/**
 * 路径裁决：
 *   clean_win       干净赢 —— 几乎没浮亏，主动权一直在手；
 *   dragged_win     扛单赢 —— 赢了，但靠扛过止损 / 大幅浮亏换来，最危险的赢；
 *   controlled_loss 受控亏 —— 亏了，但按预案干净止损，主动权握住；
 *   overrun_loss    失控亏 —— 止损被跑穿 / 浮亏失控，主动权交了出去；
 *   flat            走平 —— 保本 / 无足够数据下结论。
 */
export type PathVerdict =
  | 'clean_win'
  | 'dragged_win'
  | 'controlled_loss'
  | 'overrun_loss'
  | 'flat';

export interface TradePathInput {
  side: 'long' | 'short';
  entryPrice: number;
  /** 预设止损价；无则证伪距离缺失，MAE 无法折算成 R。 */
  plannedStop: number | null;
  /** 预设止盈价；无则确认距离退回用一倍风险。 */
  plannedTarget: number | null;
  /** 平仓价；无则用结果粗判（保本）。 */
  exitPrice: number | null;
  /** 持仓期内的 K 线（开仓到平仓，含两端）。 */
  bars: TradePathBar[];
  /** 已知的结果（赢 / 亏 / 保本）。不传则按 entry / exit 粗判。 */
  outcome?: TradeOutcome | null;
}

export interface TradePathReadout {
  /** 一倍风险的价距（|entry − stop|）；无止损为 null。 */
  riskPerR: number | null;
  /** 最大浮亏价距。 */
  maeAbs: number;
  /** 最大浮盈价距。 */
  mfeAbs: number;
  /** 最大浮亏 / R；无止损为 null。 */
  maeR: number | null;
  /** 最大浮盈 / R；无止损为 null。 */
  mfeR: number | null;
  /** 浸在水下（收盘仍浮亏）的 K 线占比，0–1。 */
  timeInLossPct: number;
  resolution: PathResolution;
  /** 第几根 K 线给出 confirmed / falsified 答案（从 0 计）；unresolved 为 null。 */
  barsToResolution: number | null;
  nShape: NShape;
  /** 浮亏是否打穿过止损（MAE ≥ 一倍风险）。 */
  breachedStop: boolean;
  /** 是否扛过了头（平仓还在止损外，或 MAE > 1.2R）。 */
  overran: boolean;
  initiative: PathInitiative;
  /** 赢的质量；非赢为 null。 */
  winQuality: WinQuality | null;
  verdict: PathVerdict;
  tone: LegTone;
}

/** 朝盈利方向走了多远（long 看 high，short 看 low）。 */
function favorableOf(side: 'long' | 'short', entry: number, bar: TradePathBar): number {
  const raw = side === 'long' ? bar.high - entry : entry - bar.low;
  return Math.max(0, raw);
}

/** 朝不利方向走了多远（long 看 low，short 看 high）。 */
function adverseOf(side: 'long' | 'short', entry: number, bar: TradePathBar): number {
  const raw = side === 'long' ? entry - bar.low : bar.high - entry;
  return Math.max(0, raw);
}

/** 收盘仍浮亏。 */
function underwater(side: 'long' | 'short', entry: number, bar: TradePathBar): boolean {
  return side === 'long' ? bar.close < entry : bar.close > entry;
}

/** 不传 outcome 时，按 entry / exit 粗判赢 / 亏 / 保本。 */
function coarseOutcome(
  side: 'long' | 'short',
  entry: number,
  exit: number | null,
): TradeOutcome {
  if (exit == null) return 'breakeven';
  const pnl = side === 'long' ? exit - entry : entry - exit;
  if (pnl > 0) return 'win';
  if (pnl < 0) return 'loss';
  return 'breakeven';
}

/** 把持仓期的 OHLC 路径，收口成一份路径判读。纯函数。 */
export function deriveTradePath(input: TradePathInput): TradePathReadout {
  const { side, entryPrice: entry, plannedStop, plannedTarget, exitPrice, bars } = input;

  const riskPerR = plannedStop != null ? Math.abs(entry - plannedStop) || null : null;

  // 逐根扫出 MAE / MFE / 浸亏时长。
  let maeAbs = 0;
  let mfeAbs = 0;
  let lossBars = 0;
  for (const bar of bars) {
    maeAbs = Math.max(maeAbs, adverseOf(side, entry, bar));
    mfeAbs = Math.max(mfeAbs, favorableOf(side, entry, bar));
    if (underwater(side, entry, bar)) lossBars += 1;
  }
  const timeInLossPct = bars.length > 0 ? lossBars / bars.length : 0;

  const maeR = riskPerR != null ? maeAbs / riskPerR : null;
  const mfeR = riskPerR != null ? mfeAbs / riskPerR : null;

  // 证伪 = 一倍风险；确认 = 有止盈用 |target − entry|，否则退回一倍风险。
  const invalidateDist = riskPerR;
  const confirmDist =
    plannedTarget != null ? Math.abs(plannedTarget - entry) || null : riskPerR;

  // 逐根判 resolution：哪一边先够到。同一根两边都够到时，保守判证伪（先认错）。
  let resolution: PathResolution = 'unresolved';
  let barsToResolution: number | null = null;
  for (let i = 0; i < bars.length; i += 1) {
    const bar = bars[i];
    const hitInvalidate =
      invalidateDist != null && adverseOf(side, entry, bar) >= invalidateDist;
    const hitConfirm =
      confirmDist != null && favorableOf(side, entry, bar) >= confirmDist;
    if (hitInvalidate) {
      resolution = 'falsified';
      barsToResolution = i;
      break;
    }
    if (hitConfirm) {
      resolution = 'confirmed';
      barsToResolution = i;
      break;
    }
  }

  const breachedStop = invalidateDist != null && maeAbs >= invalidateDist;

  const outcome = input.outcome ?? coarseOutcome(side, entry, exitPrice);

  // 扛过头：平仓还在止损外（exit 越过 stop），或 MAE 跑过 1.2R。
  const exitBeyondStop =
    plannedStop != null && exitPrice != null
      ? side === 'long'
        ? exitPrice < plannedStop
        : exitPrice > plannedStop
      : false;
  const overran = exitBeyondStop || (maeR != null && maeR > OVERRUN_MAE_R);

  // N 字：破过止损 → 破位；先确认 → 续势；都没有 → 反复。
  const nShape: NShape = breachedStop
    ? 'breakdown'
    : resolution === 'confirmed'
      ? 'continuation'
      : 'chop';

  const drowned = timeInLossPct >= DROWN_TIME_PCT;
  const initiative: PathInitiative = overran || drowned ? 'surrendered' : 'held';

  const winQuality: WinQuality | null =
    outcome === 'win' ? (overran ? 'dragged' : 'clean') : null;

  let verdict: PathVerdict;
  let tone: LegTone;
  if (outcome === 'win') {
    if (winQuality === 'dragged') {
      verdict = 'dragged_win';
      tone = 'bad';
    } else {
      verdict = 'clean_win';
      tone = 'good';
    }
  } else if (outcome === 'loss') {
    if (overran) {
      verdict = 'overrun_loss';
      tone = 'bad';
    } else {
      verdict = 'controlled_loss';
      tone = 'warn';
    }
  } else {
    verdict = 'flat';
    tone = 'muted';
  }

  return {
    riskPerR,
    maeAbs,
    mfeAbs,
    maeR,
    mfeR,
    timeInLossPct,
    resolution,
    barsToResolution,
    nShape,
    breachedStop,
    overran,
    initiative,
    winQuality,
    verdict,
    tone,
  };
}
