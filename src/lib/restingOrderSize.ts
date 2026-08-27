import type { PendingOrder } from '@/types/trading';
import { getPositionUnits, isCoinSettled } from '@/lib/tradingSettlement';

/**
 * 一张挂单**还剩多少**没成交。
 *
 * 除 TWAP 外，挂单要么全成、要么还在，quantity 就是剩余量。
 * TWAP 是唯一的例外：切片引擎（Index.tsx:1330-1399）只累加 twapFilledQty，
 * **从不递减 order.quantity / order.contracts**。于是「当前委托」里一张
 * 已经走完九成的 TWAP，显示的仍是最初的总量——它和一张还没开始的单子长得一模一样。
 * hedgeLines.ts:114 早就在注释里写下过这个坑（quantity 是未扣已成交的总量），
 * 但委托列表从来不知道。
 *
 * 这里只做**读侧**换算，不去动 order.quantity：切片量、总片数、结束条件
 * 全都从 twapTotalQty / quantity 推，改字段会把切片引擎本身算错。
 */
export interface RestingOrderSize {
  /** 还没成交的量（币本位为张，U 本位为币）。 */
  units: number;
  /** 挂出时的总量。 */
  totalUnits: number;
  /** 已成交的量。 */
  filledUnits: number;
  /** 是否已经部分成交——只有这时才值得把「剩余 / 总」两个数都写出来。 */
  partial: boolean;
}

export function restingOrderSize(order: PendingOrder): RestingOrderSize {
  const totalUnits = Math.max(0, getPositionUnits(order));

  if (order.type !== 'TWAP') {
    return { units: totalUnits, totalUnits, filledUnits: 0, partial: false };
  }

  const declaredTotal = Number(order.twapTotalQty);
  const total = Number.isFinite(declaredTotal) && declaredTotal > 0 ? declaredTotal : totalUnits;
  const filledRaw = Number(order.twapFilledQty);
  const filled = Number.isFinite(filledRaw) && filledRaw > 0 ? Math.min(filledRaw, total) : 0;
  const remaining = Math.max(0, total - filled);

  return {
    units: remaining,
    totalUnits: total,
    filledUnits: filled,
    // 浮点噪声不该被读成「部分成交」；币本位的量是整数张，阈值取半张之下。
    partial: filled > (isCoinSettled(order) ? 0.5 : 1e-8),
  };
}

/** 把挂单按「剩余量」重新表述，供折算名义 / 币数的读侧使用。 */
export function withRemainingUnits<T extends PendingOrder>(order: T): T {
  const { units, partial } = restingOrderSize(order);
  if (!partial) return order;
  return isCoinSettled(order)
    ? { ...order, quantity: units, contracts: units }
    : { ...order, quantity: units };
}
