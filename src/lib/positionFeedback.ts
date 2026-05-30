/**
 * 持仓反馈体检 — 负反馈维稳 / 正反馈顺势（批次 25）
 *
 * 失败模式往往是正反馈失控：报复性加仓、向下摊平、杠杆螺旋。本模块在
 * 【开仓快照】这一决策闸口，把"即将下的这一单"和现有持仓 + 近期平仓做对照，
 * 标出三类负反馈失控信号；同时把"给盈利持仓顺势加仓"识别为健康的正反馈，
 * 但提醒它仍要服从毁灭概率封顶。
 *
 * 纯函数、与交易引擎解耦：调用方把现有持仓/标记价/近期平仓喂进来即可。
 * 全部为软性提示，绝不阻塞提交、绝不写库。
 */

export type PositionSideLite = 'LONG' | 'SHORT';

export type FeedbackSignalKind =
  | 'averaging_down'   // 向下摊平：给亏损中的同向持仓加仓
  | 'revenge_trade'    // 报复交易：刚在该标的亏损平仓后又立刻下单
  | 'leverage_spiral'  // 杠杆螺旋：新单杠杆高于现有持仓
  | 'healthy_pyramid'; // 顺势加仓：给盈利中的同向持仓加仓（健康，但需服从封顶）

export type FeedbackPolarity = 'danger' | 'caution' | 'healthy';

export interface FeedbackSignal {
  kind: FeedbackSignalKind;
  polarity: FeedbackPolarity;
  title: string;
  detail: string;
}

export interface ExistingPositionLite {
  side: PositionSideLite;
  entryPrice: number;
  quantity: number;
  leverage: number;
}

export interface RecentCloseLite {
  pnlUsdt: number;
  /** 平仓时间（模拟时钟，毫秒）。 */
  closeTimeMs: number;
}

export interface PositionFeedbackInput {
  /** 即将下单方向；none / 未知传 null。 */
  proposedSide: PositionSideLite | null;
  proposedLeverage: number;
  /** 标记价（用于算同向持仓的浮盈浮亏）；未知传 null。 */
  markPrice: number | null;
  /** 该标的现有持仓。 */
  positions: ExistingPositionLite[];
  /** 该标的近期平仓（用于报复交易检测）。 */
  recentCloses: RecentCloseLite[];
  /** 当前模拟时钟（毫秒）。 */
  nowMs: number;
  /** 报复检测窗口（毫秒），默认 4h。 */
  revengeWindowMs?: number;
}

export interface PositionFeedbackResult {
  signals: FeedbackSignal[];
  hasExistingPosition: boolean;
  /** 同向持仓的浮动盈亏合计（USDT），无同向持仓 / 无标记价为 null。 */
  sameSideUnrealizedPnl: number | null;
}

const DEFAULT_REVENGE_WINDOW_MS = 4 * 60 * 60_000;

const POLARITY_RANK: Record<FeedbackPolarity, number> = { danger: 0, caution: 1, healthy: 2 };

function unrealizedPnl(position: ExistingPositionLite, markPrice: number): number {
  return position.side === 'LONG'
    ? (markPrice - position.entryPrice) * position.quantity
    : (position.entryPrice - markPrice) * position.quantity;
}

export function analyzePositionFeedback(input: PositionFeedbackInput): PositionFeedbackResult {
  const windowMs = input.revengeWindowMs ?? DEFAULT_REVENGE_WINDOW_MS;
  const signals: FeedbackSignal[] = [];

  const sameSide = input.proposedSide == null
    ? []
    : input.positions.filter(p => p.side === input.proposedSide);

  // 同向持仓浮动盈亏（需标记价）。
  let sameSideUnrealizedPnl: number | null = null;
  if (sameSide.length > 0 && input.markPrice != null && Number.isFinite(input.markPrice)) {
    sameSideUnrealizedPnl = sameSide.reduce((sum, p) => sum + unrealizedPnl(p, input.markPrice as number), 0);
  }

  // 1) 向下摊平 / 顺势加仓：取决于同向持仓当前是亏是盈。
  if (sameSideUnrealizedPnl != null) {
    if (sameSideUnrealizedPnl < 0) {
      signals.push({
        kind: 'averaging_down',
        polarity: 'danger',
        title: '向下摊平',
        detail: `正在给浮亏中的同向持仓加仓（当前浮亏约 ${Math.abs(sameSideUnrealizedPnl).toFixed(0)} USDT）。这是正反馈失控的典型起点——加仓应基于趋势更强，而不是为了摊低成本。`,
      });
    } else if (sameSideUnrealizedPnl > 0) {
      signals.push({
        kind: 'healthy_pyramid',
        polarity: 'healthy',
        title: '顺势加仓',
        detail: `同向持仓正在盈利（浮盈约 ${sameSideUnrealizedPnl.toFixed(0)} USDT）。只有在趋势确认更强时才加仓，且新增部分仍要服从毁灭概率封顶。`,
      });
    }
  }

  // 2) 杠杆螺旋：新单杠杆高于该标的现有持仓最高杠杆。
  if (input.positions.length > 0 && Number.isFinite(input.proposedLeverage)) {
    const maxExistingLeverage = Math.max(...input.positions.map(p => p.leverage));
    if (input.proposedLeverage > maxExistingLeverage) {
      signals.push({
        kind: 'leverage_spiral',
        polarity: 'caution',
        title: '杠杆螺旋',
        detail: `新单 ${input.proposedLeverage}× 高于现有持仓最高 ${maxExistingLeverage}×。加仓时抬杠杆会成倍放大毁灭概率——仓位上限要由毁灭概率封顶，而非信心。`,
      });
    }
  }

  // 3) 报复交易：窗口内在该标的有亏损平仓。
  const recentLosses = input.recentCloses.filter(
    close => close.pnlUsdt < 0 && input.nowMs - close.closeTimeMs <= windowMs && input.nowMs - close.closeTimeMs >= 0,
  );
  if (recentLosses.length > 0) {
    const hours = Math.round(windowMs / 3_600_000);
    signals.push({
      kind: 'revenge_trade',
      polarity: 'danger',
      title: '报复交易',
      detail: `最近 ${hours}h 内在该标的有 ${recentLosses.length} 笔亏损平仓。紧接着再下单，先确认这是新证据下的独立决策，而不是想把刚亏的赚回来。`,
    });
  }

  signals.sort((a, b) => POLARITY_RANK[a.polarity] - POLARITY_RANK[b.polarity]);

  return {
    signals,
    hasExistingPosition: input.positions.length > 0,
    sameSideUnrealizedPnl,
  };
}
