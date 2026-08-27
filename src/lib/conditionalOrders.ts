import type { OrderSide, PendingOrder } from '@/types/trading';

interface ConditionalTriggerDecision {
  currentPriceNum: number;
  triggerPriceNum: number;
  triggered: boolean;
}

interface ConditionalTriggerRange {
  high: number;
  low: number;
}

type LegacyConditionalOrder = PendingOrder & {
  direction?: string;
  triggerPrice?: number | string;
  side?: PendingOrder['side'] | 'BUY' | 'SELL' | 'buy' | 'sell' | 'long' | 'short';
  type?: PendingOrder['type'] | string;
  status?: PendingOrder['status'] | string;
};

function normalizeConditionalDirection(direction?: string): OrderSide | null {
  const normalized = direction?.toUpperCase();

  if (normalized === 'LONG' || normalized === 'BUY') return 'LONG';
  if (normalized === 'SHORT' || normalized === 'SELL') return 'SHORT';

  return null;
}

function getLegacyConditionalOrder(order: PendingOrder): LegacyConditionalOrder {
  return order as LegacyConditionalOrder;
}

export function resolveConditionalOrderSide(order: PendingOrder): OrderSide | null {
  const legacyOrder = getLegacyConditionalOrder(order);
  return normalizeConditionalDirection(legacyOrder.direction ?? legacyOrder.side);
}

export function resolveConditionalTriggerPrice(order: PendingOrder): number {
  const legacyOrder = getLegacyConditionalOrder(order);
  return Number(legacyOrder.triggerPrice ?? legacyOrder.stopPrice);
}

export function isConditionalPendingOrder(order: PendingOrder): boolean {
  const legacyOrder = getLegacyConditionalOrder(order);
  return String(legacyOrder.type ?? '').toUpperCase() === 'CONDITIONAL'
    && String(legacyOrder.status ?? '').toUpperCase() === 'PENDING';
}

export function getConditionalTriggerDecisionForPrices(
  side: OrderSide,
  latestPrice: number,
  triggerPrice: number,
): ConditionalTriggerDecision | null {
  const currentPriceNum = Number(latestPrice);
  const triggerPriceNum = Number(triggerPrice);

  if (!Number.isFinite(currentPriceNum) || !Number.isFinite(triggerPriceNum)) {
    return null;
  }

  const triggered = side === 'LONG'
    ? currentPriceNum >= triggerPriceNum
    : currentPriceNum <= triggerPriceNum;

  return {
    currentPriceNum,
    triggerPriceNum,
    triggered,
  };
}

export function getConditionalTriggerDecisionForRange(
  side: OrderSide,
  triggerPrice: number,
  range: ConditionalTriggerRange,
): ConditionalTriggerDecision | null {
  const highNum = Number(range.high);
  const lowNum = Number(range.low);
  const triggerPriceNum = Number(triggerPrice);

  if (!Number.isFinite(highNum) || !Number.isFinite(lowNum) || !Number.isFinite(triggerPriceNum)) {
    return null;
  }

  const triggered = side === 'LONG'
    ? highNum >= triggerPriceNum
    : lowNum <= triggerPriceNum;

  return {
    currentPriceNum: side === 'LONG' ? highNum : lowNum,
    triggerPriceNum,
    triggered,
  };
}

/**
 * 下单当刻会不会立即成交（下单闸门）。
 *
 * 条件单的触发方向**不是由买卖方向决定的**，而是在下单这一刻由「触发价 vs 现价」
 * 锁定的——这正是 handlePlaceOrder 里 getTriggerOperator(stopPrice, 现价) 干的事：
 *     触发价 > 现价 → ">="：要price涨上来才触发
 *     触发价 < 现价 → "<="：要price跌下去才触发
 * 两种情况在下单当刻都**不满足**。所以唯一会当场成交的只有「触发价 == 现价」。
 *
 * 旧实现复用了 getConditionalTriggerDecisionForPrices 的**按 side 硬编码方向**规则
 * （LONG 只认向上、SHORT 只认向下），于是四个象限里有两个被误杀：
 *     开多 · 触发价低于现价 → 「跌到 X 买入」抄底加仓  → 被拒
 *     开空 · 触发价高于现价 → 「涨到 X 做空」反弹做空  → 被拒
 * 两者都是完全正常的挂单，而且真挂出去之后运行期判据（getConditionalTriggerDecisionFromRange
 * 的 AUTHORITATIVE PATH）读的是锁定的 operator，本来就会正确等待。
 * 也就是说：只有这道闸门拦错了，引擎其余部分一直是对的。
 *
 * 用相对误差判等：价格量级从 1e-5 到 1e5 都有，绝对误差在任一端都失效。
 *
 * ⚠ 但只比标量是**不够**的，这一点差点让本次修复变成一个更糟的 bug：
 * 本引擎的撮合基准不是标量现价，而是**当前这根未收 K 线的完整 high/low**
 * （Index.tsx 的 runConditionalMatchingForSymbol 收到的就是 matchHigh/matchLow），
 * 里面**包含下单之前就已经走完的那段价格**。于是「现价 0.3946、挂抄底多单 0.36」
 * 若这根 4h/1d K 线早些时候已经下探到 0.35，锁定的 '<=' 会在下一帧就被
 * low=0.35 满足，以 0.36 成交而市价 0.3946 —— 凭空 +9.6%，无等待无滑点。
 * 所以闸门必须和撮合看**同一个区间**：调用方把当刻的撮合区间传进来，
 * 只要锁定的 operator 在这个区间上已经成立，就是「会立即触发」，必须拒。
 * 这同时把四个象限里本来就存在的那两个立即成交窗口一并关掉。
 */
export function shouldRejectImmediateConditionalPlacement(
  latestPrice: number,
  triggerPrice: number,
  matchRange?: ConditionalTriggerRange | null,
): boolean {
  const current = Number(latestPrice);
  const trigger = Number(triggerPrice);
  if (!Number.isFinite(current) || !Number.isFinite(trigger)) return false;

  const scale = Math.max(Math.abs(current), Math.abs(trigger));
  if (Math.abs(current - trigger) <= Math.max(Number.EPSILON, scale * 1e-9)) return true;

  // 与 handlePlaceOrder 锁定 operator 的规则同源（types/trading.ts 的 getTriggerOperator）
  const operator: '>=' | '<=' = trigger > current ? '>=' : '<=';
  const high = Number(matchRange?.high);
  const low = Number(matchRange?.low);
  if (!Number.isFinite(high) || !Number.isFinite(low)) return false;

  // 与 isTriggerConditionMet（types/trading.ts）逐字同构，别让两处判据漂开
  return operator === '>=' ? high >= trigger : low <= trigger;
}

export function getConditionalTriggerDecision(
  order: PendingOrder,
  chartCurrentPrice: number,
): ConditionalTriggerDecision | null {
  if (!isConditionalPendingOrder(order)) return null;

  const normalizedSide = resolveConditionalOrderSide(order);
  const triggerPrice = resolveConditionalTriggerPrice(order);

  if (!normalizedSide) return null;

  return getConditionalTriggerDecisionForPrices(normalizedSide, chartCurrentPrice, triggerPrice);
}

export function getConditionalTriggerDecisionFromRange(
  order: PendingOrder,
  range: ConditionalTriggerRange,
): ConditionalTriggerDecision | null {
  if (!isConditionalPendingOrder(order)) return null;

  const triggerPrice = resolveConditionalTriggerPrice(order);
  const highNum = Number(range.high);
  const lowNum = Number(range.low);

  if (!Number.isFinite(highNum) || !Number.isFinite(lowNum) || !Number.isFinite(triggerPrice)) {
    return null;
  }

  // ===== AUTHORITATIVE PATH: explicit operator / triggerDirection =====
  // For reduce-only TP/SL orders, `order.side` is the *closing* side (opposite of position),
  // which inverts the natural side-based trigger logic. The placement code (handlePlaceTpSl)
  // sets `operator` and `triggerDirection` to encode the correct quadrant per
  // (positionSide × TP/SL). Honor these whenever present — they are the ground truth.
  const op = (order as any).operator as '>=' | '<=' | undefined;
  const dir = order.triggerDirection as 'UP' | 'DOWN' | undefined;
  const useUp = op === '>=' || dir === 'UP';
  const useDown = op === '<=' || dir === 'DOWN';

  if (useUp || useDown) {
    const triggered = useUp ? highNum >= triggerPrice : lowNum <= triggerPrice;
    if (order.reduceOnly && order.reduceKind) {
      // Debug breadcrumb for TP/SL audits — silent in production logs unless triggered or near-miss
      const posSide = (order as any).reducePositionSide ?? 'N/A';
      // eslint-disable-next-line no-console
      console.log(
        `[TP/SL Check] kind=${order.reduceKind} posSide=${posSide} dir=${useUp ? 'UP' : 'DOWN'} ` +
          `low=${lowNum} high=${highNum} trigger=${triggerPrice} fired=${triggered}`,
      );
    }
    return {
      currentPriceNum: useUp ? highNum : lowNum,
      triggerPriceNum: triggerPrice,
      triggered,
    };
  }

  // ===== FALLBACK: legacy side-based decision (open-side conditional orders only) =====
  const normalizedSide = resolveConditionalOrderSide(order);
  if (!normalizedSide) return null;
  return getConditionalTriggerDecisionForRange(normalizedSide, triggerPrice, range);
}