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
  | 'chase_after_close'// 刚平就开：刚在该标的平仓（盈/平）后又立刻下单（持单 = 耐心）
  | 'leverage_spiral'  // 杠杆螺旋：新单杠杆高于现有持仓
  | 'healthy_pyramid'  // 顺势加仓：给盈利中的同向持仓加仓（健康，但需服从封顶）
  | 'mathematical_lockin'; // 双边结构已锁定盈利，可考虑加仓/滚仓

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
  /** 即将下单类型：主力单 or 对冲单。 */
  proposedOrderKind?: 'main' | 'hedge';
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
  /** 「刚平就开」连续单检测窗口（毫秒），默认 1h —— 比报复窗口更紧，强调「刚」。 */
  chaseWindowMs?: number;
  /** 当前建议单笔最大亏损，用于在正反馈提示里回显约束。 */
  recommendedMaxLossUsdt?: number | null;
}

export interface PositionFeedbackResult {
  signals: FeedbackSignal[];
  hasExistingPosition: boolean;
  /** 同向持仓的浮动盈亏合计（USDT），无同向持仓 / 无标记价为 null。 */
  sameSideUnrealizedPnl: number | null;
  /** 全部持仓的浮动盈亏合计（USDT），无标记价为 null。 */
  totalUnrealizedPnl: number | null;
  hasTwoSidedStructure: boolean;
}

const DEFAULT_REVENGE_WINDOW_MS = 4 * 60 * 60_000;
const DEFAULT_CHASE_WINDOW_MS = 60 * 60_000;

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

  const hasLong = input.positions.some(p => p.side === 'LONG');
  const hasShort = input.positions.some(p => p.side === 'SHORT');
  const hasTwoSidedStructure = hasLong && hasShort;

  let totalUnrealizedPnl: number | null = null;
  if (input.positions.length > 0 && input.markPrice != null && Number.isFinite(input.markPrice)) {
    totalUnrealizedPnl = input.positions.reduce((sum, p) => sum + unrealizedPnl(p, input.markPrice as number), 0);
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
      const capNote = input.recommendedMaxLossUsdt != null && Number.isFinite(input.recommendedMaxLossUsdt)
        ? `新增部分仍要服从当前建议上沿 ${input.recommendedMaxLossUsdt.toFixed(0)} USDT。`
        : '新增部分仍要服从毁灭概率封顶。';
      signals.push({
        kind: 'healthy_pyramid',
        polarity: 'healthy',
        title: '顺势加仓',
        detail: `同向持仓正在盈利（浮盈约 ${sameSideUnrealizedPnl.toFixed(0)} USDT）。只有在趋势确认更强时才加仓，${capNote}`,
      });
    }
  }

  // 1.5) 数学盈利已锁定：当前标的存在多空双边结构，且合计浮盈已为正。
  if (hasTwoSidedStructure && totalUnrealizedPnl != null && totalUnrealizedPnl > 0) {
    const capNote = input.recommendedMaxLossUsdt != null && Number.isFinite(input.recommendedMaxLossUsdt)
      ? `任何新增风险仍不应超过建议上沿 ${input.recommendedMaxLossUsdt.toFixed(0)} USDT。`
      : '任何新增风险仍应继续服从毁灭概率封顶。';
    const title = input.proposedOrderKind === 'hedge' ? '可考虑滚仓' : '可考虑加仓';
    const action = input.proposedOrderKind === 'hedge'
      ? '若你是在继续上移对冲止损线，这更像滚动风险管理，而不是重新开一个纯赌方向的新仓。'
      : '若主方向证据更强，此时允许把仓位继续放在赢家一侧，而不是因为已经有利润就过早封顶。';
    signals.push({
      kind: 'mathematical_lockin',
      polarity: 'healthy',
      title,
      detail: `当前双边结构合计已锁定约 ${totalUnrealizedPnl.toFixed(0)} USDT 的数学盈利。${action}${capNote}`,
    });
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

  // 3.5) 刚平就开（连续单）：很短窗口内刚在该标的平仓后又要下单。亏损平仓已升级为报复交易
  //      (danger)，这里只覆盖盈利 / 打平的快速再进场——它不是报复，而是「持单 = 耐心」的失守。
  const chaseWindowMs = input.chaseWindowMs ?? DEFAULT_CHASE_WINDOW_MS;
  const inChaseWindow = (close: RecentCloseLite) =>
    input.nowMs - close.closeTimeMs <= chaseWindowMs && input.nowMs - close.closeTimeMs >= 0;
  const hasRecentLossInChase = input.recentCloses.some(c => c.pnlUsdt < 0 && inChaseWindow(c));
  const recentNonLossReentry = input.recentCloses.filter(c => c.pnlUsdt >= 0 && inChaseWindow(c));
  if (recentNonLossReentry.length > 0 && !hasRecentLossInChase) {
    const minutes = Math.max(1, Math.round(chaseWindowMs / 60_000));
    signals.push({
      kind: 'chase_after_close',
      polarity: 'caution',
      title: '刚平就开',
      detail: `最近 ${minutes} 分钟内刚在该标的平仓后又要下单。持单本身是一种耐心——先确认这是新结构给的独立机会，而不是刚平掉就手痒的连续单。`,
    });
  }

  signals.sort((a, b) => POLARITY_RANK[a.polarity] - POLARITY_RANK[b.polarity]);

  return {
    signals,
    hasExistingPosition: input.positions.length > 0,
    sameSideUnrealizedPnl,
    totalUnrealizedPnl,
    hasTwoSidedStructure,
  };
}
