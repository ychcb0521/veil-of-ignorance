import type { FilledOrderSnapshot, PendingOrder, Position, TradeRecord } from '@/types/trading';
import {
  POSITION_DUST_EPSILON,
  getPositionUnits,
  isCoinSettled,
  isPositionOpen,
  scaleSettlementPosition,
  settlePositionClose,
} from '@/lib/tradingSettlement';

export type ReduceOnlyTriggerFailureReason =
  | 'not_reduce_only'
  | 'order_missing'
  | 'linked_position_missing'
  | 'position_side_mismatch'
  | 'invalid_close_quantity'
  | 'settlement_failed';

export interface ReduceOnlyTriggerFailure {
  ok: false;
  reason: ReduceOnlyTriggerFailureReason;
}

export interface ReduceOnlyTriggerSuccess {
  ok: true;
  targetSymbol: string;
  linkedPositionId: string;
  positions: Position[];
  orders: PendingOrder[];
  record: TradeRecord;
  filledOrder: FilledOrderSnapshot;
  returnedMargin: number;
  fillPrice: number;
  netPnl: number;
  fullyClosed: boolean;
}

export type ReduceOnlyTriggerExecution = ReduceOnlyTriggerFailure | ReduceOnlyTriggerSuccess;

interface PlanReduceOnlyTriggerParams {
  symbol: string;
  order: PendingOrder;
  triggerPrice: number;
  closeTime: number;
  positions: Record<string, Position[]>;
  orders: Record<string, PendingOrder[]>;
  closedRealAt?: number;
}

/**
 * Plans one reduce-only trigger as an all-or-nothing state transition.
 * Callers must apply every returned field together; failures intentionally leave
 * the source order untouched so a temporarily stale position snapshot cannot eat it.
 */
export function planReduceOnlyTrigger({
  symbol,
  order,
  triggerPrice,
  closeTime,
  positions,
  orders,
  closedRealAt = Date.now(),
}: PlanReduceOnlyTriggerParams): ReduceOnlyTriggerExecution {
  if (!order.reduceOnly || !order.linkedPositionId) {
    return { ok: false, reason: 'not_reduce_only' };
  }

  const targetSymbol = order.reduceSymbol || symbol;
  const targetOrders = orders[targetSymbol] || [];
  const liveOrder = targetOrders.find((candidate) => candidate.id === order.id);
  if (!liveOrder) {
    return { ok: false, reason: 'order_missing' };
  }

  const linkedPositionId = liveOrder.linkedPositionId || order.linkedPositionId;
  const targetPositions = positions[targetSymbol] || [];
  const position = targetPositions.find((candidate) => candidate.id === linkedPositionId && isPositionOpen(candidate));
  if (!position) {
    return { ok: false, reason: 'linked_position_missing' };
  }

  if (liveOrder.reducePositionSide && liveOrder.reducePositionSide !== position.side) {
    return { ok: false, reason: 'position_side_mismatch' };
  }

  const positionUnits = getPositionUnits(position);
  const closeUnits = Math.min(positionUnits, getPositionUnits(liveOrder));
  if (!Number.isFinite(closeUnits) || closeUnits <= POSITION_DUST_EPSILON) {
    return { ok: false, reason: 'invalid_close_quantity' };
  }

  const exitMethod = liveOrder.reduceKind === 'TP' ? 'tp1' : liveOrder.reduceKind === 'SL' ? 'sl' : 'manual';
  const settled = settlePositionClose(
    targetSymbol,
    position,
    Number(triggerPrice),
    closeUnits,
    closeTime,
    exitMethod,
    closedRealAt,
  );
  if (!settled) {
    return { ok: false, reason: 'settlement_failed' };
  }

  const nextPositions = settled.willFullyClose
    ? targetPositions.filter((candidate) => candidate.id !== linkedPositionId && isPositionOpen(candidate))
    : targetPositions
        .map((candidate) => (
          candidate.id === linkedPositionId
            ? scaleSettlementPosition(candidate, settled.remainingUnits)
            : candidate
        ))
        .filter(isPositionOpen);

  const nextOrders: PendingOrder[] = [];
  for (const candidate of targetOrders) {
    if (candidate.id === liveOrder.id) continue;

    if (candidate.reduceOnly && candidate.linkedPositionId === linkedPositionId) {
      if (settled.willFullyClose) continue;

      const remainingQuantity = isCoinSettled(position)
        ? Math.max(1, Math.round(getPositionUnits(candidate) * (1 - settled.pct)))
        : getPositionUnits(candidate) * (1 - settled.pct);
      if (remainingQuantity <= POSITION_DUST_EPSILON) continue;

      nextOrders.push({
        ...candidate,
        quantity: remainingQuantity,
        contracts: isCoinSettled(position) ? remainingQuantity : candidate.contracts,
      });
      continue;
    }

    nextOrders.push(candidate);
  }

  return {
    ok: true,
    targetSymbol,
    linkedPositionId,
    positions: nextPositions,
    orders: nextOrders,
    record: settled.record,
    filledOrder: {
      id: liveOrder.id,
      symbol: targetSymbol,
      side: liveOrder.side,
      type: liveOrder.type,
      reduceOnly: true,
      reduceKind: liveOrder.reduceKind ?? null,
      linkedPositionId,
      price: settled.fillPrice,
      triggerPrice: Number(triggerPrice),
      quantity: settled.closeQty,
      contracts: isCoinSettled(position) ? settled.closeQty : liveOrder.contracts,
      leverage: liveOrder.leverage,
      settlementMode: liveOrder.settlementMode,
      settlementAsset: liveOrder.settlementAsset,
      contractSizeUsd: liveOrder.contractSizeUsd,
      createdAt: liveOrder.createdAt,
      filledAt: closeTime,
      positionId: linkedPositionId,
    },
    returnedMargin: settled.returnedMargin,
    fillPrice: settled.fillPrice,
    netPnl: settled.netPnl,
    fullyClosed: settled.willFullyClose,
  };
}
