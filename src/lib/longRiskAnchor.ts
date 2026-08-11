/**
 * 多单风险锚 K₀ —— b_可落袋 的分母来源。
 *
 * 「预期最大亏损」由这笔多单**最早设定**的止损位定义：后来把止损上移是管理动作，
 * 不改变入场时承担的风险；与战役指标里「初始风险边界不随后续修改移动」同一口径。
 * 因此锚 = 当前多单关联的全部止损委托（在挂 + 已触发）里 createdAt 最早那张的触发价。
 *
 * 已撤销的止损单不在可见状态里，找不到时返回 null——面板允许手动补录，
 * 手动值永远优先于自动锚。
 */
import type { FilledOrderSnapshot, PendingOrder, Position } from '@/types/trading';

type StopCandidate = {
  price: number;
  createdAt: number;
};

function collectFromPending(
  orders: PendingOrder[],
  longPositionIds: Set<string>,
): StopCandidate[] {
  const out: StopCandidate[] = [];
  for (const order of orders) {
    if (order.reduceKind !== 'SL' || order.reducePositionSide !== 'LONG') continue;
    if (order.linkedPositionId && !longPositionIds.has(order.linkedPositionId)) continue;
    if (!Number.isFinite(order.stopPrice) || order.stopPrice <= 0) continue;
    out.push({ price: order.stopPrice, createdAt: order.createdAt });
  }
  return out;
}

function collectFromFilled(
  filled: FilledOrderSnapshot[],
  symbol: string,
  longPositionIds: Set<string>,
): StopCandidate[] {
  const out: StopCandidate[] = [];
  for (const order of filled) {
    if (order.symbol !== symbol) continue;
    if (order.reduceKind !== 'SL') continue;
    // 已触发的止损若挂在仍持有的多单上（部分止损后仓位未平），其最初触发价仍是风险锚
    if (order.linkedPositionId && !longPositionIds.has(order.linkedPositionId)) continue;
    if (!order.linkedPositionId) continue;
    if (!Number.isFinite(order.triggerPrice) || order.triggerPrice <= 0) continue;
    out.push({ price: order.triggerPrice, createdAt: order.createdAt });
  }
  return out;
}

/**
 * 当前多单最早设定的止损价；无可追溯止损时返回 null。
 */
export function earliestLongStopPrice(
  symbol: string,
  positions: Position[],
  pendingOrders: PendingOrder[],
  filledOrders: FilledOrderSnapshot[],
): number | null {
  const longIds = new Set(
    positions.filter(p => p.side === 'LONG' && p.id).map(p => p.id),
  );
  if (longIds.size === 0) return null;

  const candidates = [
    ...collectFromPending(pendingOrders, longIds),
    ...collectFromFilled(filledOrders, symbol, longIds),
  ];
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.createdAt - b.createdAt);
  return candidates[0].price;
}
