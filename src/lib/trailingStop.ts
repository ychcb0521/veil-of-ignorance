/**
 * 跟踪委托（Trailing Stop）的触发逻辑 —— 按币安语义。
 *
 * 卖出方向（SHORT，开空/平多）：追踪触发后的**最高价**，价格从峰值回撤
 * `回调率%` 即触发；买入方向（LONG，开多/平空）：追踪**最低价**，价格从
 * 谷底反弹 `回调率%` 即触发。可设激活价：行情先触及激活价，追踪才开始。
 *
 * 纯函数、逐根 K 线推进：输入当前极值与本根 K 线的 high/low，
 * 返回新的极值与是否触发。放在引擎的撮合循环里对每根 K 线调用。
 *
 * 保守取价：同一根 K 线内先用不利方向的端点更新极值、再判触发，
 * 避免用同一根线的有利端点自触发（回测的乐观偏差）。
 */
import type { OrderSide } from '@/types/trading';

export interface TrailingState {
  /** 是否已越过激活价开始追踪；无激活价则挂出即激活。 */
  activated: boolean;
  /** 激活后的极值：SHORT 追最高价，LONG 追最低价。未激活时为 null。 */
  extreme: number | null;
}

export interface TrailingStepInput {
  side: OrderSide;
  /** 回调率，小数：0.01 = 1%。 */
  callbackRate: number;
  /** 激活价；null/0 = 挂出即激活。 */
  activationPrice: number | null;
  state: TrailingState;
  /** 本根 K 线（或本 tick 区间）的最高 / 最低价。 */
  high: number;
  low: number;
}

export interface TrailingStepResult {
  state: TrailingState;
  /** 本步是否触发；触发价即回调线（供市价成交时参考）。 */
  triggered: boolean;
  triggerPrice: number | null;
}

export function initTrailingState(activationPrice: number | null): TrailingState {
  return { activated: !(activationPrice != null && activationPrice > 0), extreme: null };
}

export function stepTrailingStop(input: TrailingStepInput): TrailingStepResult {
  const { side, callbackRate, activationPrice, high, low } = input;
  let { activated, extreme } = input.state;

  if (!(callbackRate > 0) || !(high > 0) || !(low > 0) || high < low) {
    return { state: { activated, extreme }, triggered: false, triggerPrice: null };
  }

  // ① 激活判定：SHORT（卖出）等价格上摸激活价；LONG（买入）等价格下探激活价
  if (!activated) {
    const hit = side === 'SHORT'
      ? high >= (activationPrice as number)
      : low <= (activationPrice as number);
    if (!hit) return { state: { activated, extreme }, triggered: false, triggerPrice: null };
    activated = true;
    // 激活当根：极值从激活价起算，而不是从本根的有利端点起算——
    // 否则激活与触发可能在同一根内被同一端点虚构出来
    extreme = activationPrice as number;
  }

  // ② 先用有利方向端点推进极值（SHORT 记新高，LONG 记新低）
  extreme = side === 'SHORT'
    ? Math.max(extreme ?? high, high)
    : Math.min(extreme ?? low, low);

  // ③ 回调线与触发判定（用不利方向端点）
  const triggerPrice = side === 'SHORT'
    ? extreme * (1 - callbackRate)   // 从峰值回撤
    : extreme * (1 + callbackRate);  // 从谷底反弹
  const triggered = side === 'SHORT' ? low <= triggerPrice : high >= triggerPrice;

  return { state: { activated, extreme }, triggered, triggerPrice: triggered ? triggerPrice : null };
}
