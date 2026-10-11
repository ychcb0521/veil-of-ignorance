import { isClosingOrder, PRE_MAIN_LOOKBACK_MS } from '@/lib/hedgeLines';
import { orderReferencePrice } from '@/lib/orderReferencePrice';
import type { PendingOrder } from '@/types/trading';

/**
 * 最新挂着的对冲委托：主多看空单、主空看多单。
 *
 * 【用户要求】加仓计算器的「新支撑线 / 止损线」缺省取最新委托空单的价格（可以手动改）；减仓计算器的 K 取同一张。
 * 这套打法里止损是换成对冲做的——加仓前先把对冲空单挂到新的支撑位，那张单的价格就是这一轮的止损线。
 *
 * 哪些委托算数，与盘口对冲线（hedgeLines）、Legs「加仓校验」认止损线是同一套判据，只是多条里取**最新挂的**那张：
 *   · 还挂着（NEW / PENDING / ACTIVE）、会开出反向仓位：平仓性质的止盈止损不是止损线；
 *   · 在**亏损侧**（主多：低于加仓线 T；主空：高于 T）：挂在现价上方的限价空单是高位锁仓，不是支撑线；
 *   · 有事前确定的价位：条件委托看触发价，限价 / 只做 Maker 看委托价（不读面板残留在限价单上的触发价）；
 *     跟踪委托与 TWAP 没有确定的线，不算；
 *   · 属于本场：早于主力开仓 5 分钟之前的挂单是上一场留下的，不算；
 *   · 「最新」按真实挂单时刻比——回放倒带之后模拟时间会重叠，真实时钟不会。没盖真实时刻的是老委托，
 *     一律排在盖了的之前；都没盖才比模拟时间。同刻的取排在后面的那张。
 */
const LIVE_STATUSES: ReadonlySet<PendingOrder['status']> = new Set(['NEW', 'PENDING', 'ACTIVE']);
const NO_FIXED_LINE: ReadonlySet<PendingOrder['type']> = new Set(['TRAILING_STOP', 'TWAP']);

export interface LatestHedgeOrder {
  price: number;
  /** 真实挂单时刻（Date.now()）；老委托没有。 */
  placedRealAt: number | null;
}

export interface LatestHedgeOrderOptions {
  /** 加仓线 / 现价 T：只在它的亏损侧找。不给（或不为正）时不分侧。 */
  referencePrice?: number | null;
  /** 当前持仓最早的开仓时刻（模拟时间）：早于它 5 分钟之前的挂单不算本场的。 */
  heldSinceMs?: number | null;
}

/** 这张委托事前确定的那个价；没有（跟踪 / TWAP / 读不出）时为 null。 */
function fixedLinePrice(order: PendingOrder): number | null {
  if (NO_FIXED_LINE.has(order.type)) return null;
  const reference = orderReferencePrice(order, 0);
  return reference.kind !== 'market' && Number.isFinite(reference.price) && reference.price > 0 ? reference.price : null;
}

const realStamp = (order: PendingOrder): number | null => (
  order.createdRealAt != null && Number.isFinite(order.createdRealAt) ? order.createdRealAt : null
);

/** a 是不是比 b 挂得晚（或同刻）。 */
function placedNoEarlier(a: PendingOrder, b: PendingOrder): boolean {
  const realA = realStamp(a);
  const realB = realStamp(b);
  if (realA != null && realB != null) return realA >= realB;
  if (realA != null || realB != null) return realA != null;
  return a.createdAt >= b.createdAt;
}

export function latestHedgeOrder(
  orders: readonly (PendingOrder | null | undefined)[] | null | undefined,
  mainSide: 'LONG' | 'SHORT',
  options: LatestHedgeOrderOptions = {},
): LatestHedgeOrder | null {
  const hedgeSide = mainSide === 'SHORT' ? 'LONG' : 'SHORT';
  const reference = options.referencePrice != null && options.referencePrice > 0 ? options.referencePrice : null;
  const since = options.heldSinceMs != null && Number.isFinite(options.heldSinceMs) ? options.heldSinceMs - PRE_MAIN_LOOKBACK_MS : null;
  let latest: { order: PendingOrder; price: number } | null = null;
  for (const order of orders ?? []) {
    if (!order || order.side !== hedgeSide || !LIVE_STATUSES.has(order.status) || isClosingOrder(order)) continue;
    if (since != null && Number.isFinite(order.createdAt) && order.createdAt < since) continue;
    const price = fixedLinePrice(order);
    if (price == null) continue;
    if (reference != null && !(mainSide === 'SHORT' ? price > reference : price < reference)) continue;
    if (!latest || placedNoEarlier(order, latest.order)) latest = { order, price };
  }
  return latest ? { price: latest.price, placedRealAt: realStamp(latest.order) } : null;
}

export function latestHedgeOrderPrice(
  orders: readonly (PendingOrder | null | undefined)[] | null | undefined,
  mainSide: 'LONG' | 'SHORT',
  options: LatestHedgeOrderOptions = {},
): number | null {
  return latestHedgeOrder(orders, mainSide, options)?.price ?? null;
}

/**
 * 把一个价格原样写出来至少要几位小数（最多 12 位）：缺省值不能把委托价四舍五入掉。
 * 浮点尾差（0.1 + 0.2 = 0.30000000000000004）不算进位数。
 */
export function exactPriceDecimals(price: number): number {
  if (!Number.isFinite(price)) return 0;
  const tolerance = Math.abs(price) * 1e-12;
  for (let digits = 0; digits <= 12; digits += 1) {
    if (Math.abs(Number(price.toFixed(digits)) - price) <= tolerance) return digits;
  }
  return 12;
}
