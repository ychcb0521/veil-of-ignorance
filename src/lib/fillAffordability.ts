import type { PendingOrder, Position } from '@/types/trading';

/** 与 TradingContext 的 PositionsMap 同形；这里只需要能遍历。 */
type PositionsBySymbol = Record<string, Position[]>;
import { getSettlementFeeParts, getSettlementMarginParts } from '@/lib/tradingSettlement';

/**
 * 一笔成交付不付得起。
 *
 * 挂单在这个模拟器里**不预留保证金**：calcAvailable 只遍历 positionsMap，
 * ordersMap 从来没有任何记账函数读过。于是「下单时的余额检查」是一次**检查**，
 * 不是一次**冻结**——两条各自都过得了检查的腿，可以一起触发、一起扣款：
 *
 *   余额 100,000，两条条件单各需 60,120 → 下单时各自 ≤ 100,000，都放行；
 *   同时触发 → 扣 120,480 → 余额 −20,480。
 *
 * 负余额之后没有任何东西把它捞回来。**有全仓仓位**时，crossEquity 会被它自己
 * 拖到 0 以下，下一跳就把所有标的的全仓仓位全部强平、并清空所有挂单；
 * **只有逐仓仓位**时那一支根本不跑，负余额就永久留在账上并同步进云端，
 * 此后每一笔下单都被「可用余额不足」永久拒掉——一个退不出去的死局。
 */
export interface FillAffordability {
  ok: boolean;
  requiredUsd: number;
  availableUsd: number;
  shortfallUsd: number;
}

/**
 * 一笔成交要动的钱，能不能从**钱包自由现金**里出。
 *
 * 这个模拟器的记账约定：保证金在开仓那一刻就已经从 balance 里扣走了，
 * **两种模式都一样**（开仓的 setBalance(prev - requiredMargin) 不分 marginMode，
 * 平仓也不分模式退还）。所以「还能再花多少」就是 balance 本身——
 * 再去减仓位占用的保证金，那是把同一笔钱扣两遍。
 *
 * （TradingContext 的 calcAvailable 与 AccountInfo / OrderPanel 的「可用」
 * 各自又减了一遍：前者减全仓、后者减全部。两处都是真实缺陷，但它们是
 * **下单侧**的偏严，可重试；这里是成交侧，失败即撤单，不可逆，所以不能跟着错。）
 */
export function evaluateFillAffordability(args: {
  availableUsd: number;
  marginUsd: number;
  feeUsd: number;
  /** 允许的浮点毛刺；不是宽容额度。 */
  epsilon?: number;
}): FillAffordability {
  const { availableUsd: avail, marginUsd, feeUsd, epsilon = 1e-8 } = args;
  const safeAvail = Number.isFinite(avail) ? avail : 0;
  /**
   * 数字坏掉时**一律判付不起**,绝不当成 0。
   *
   * 把 NaN 折成 0 会让 required 变成 0、判定为「付得起」,
   * 于是 setBalance(prev - NaN) 把余额本身变成 NaN——正是这道闸门要挡的
   * 那种不可恢复的死状态,而且是它自己造出来的。
   * 线性分支的 marginUsd 在 leverage <= 0 时就会给出非有限值。
   */
  if (!Number.isFinite(marginUsd) || !Number.isFinite(feeUsd)) {
    return { ok: false, requiredUsd: Number.NaN, availableUsd: safeAvail, shortfallUsd: Number.NaN };
  }
  const required = marginUsd + feeUsd;
  const ok = required <= safeAvail + epsilon;
  return {
    ok,
    requiredUsd: required,
    availableUsd: safeAvail,
    shortfallUsd: ok ? 0 : required - safeAvail,
  };
}

/**
 * 挂单在**成交价**上要占多少钱。
 *
 * isMaker 一律按 false：条件单 / 止损单 / 跟踪单成交时全都走 taker
 * （Index.tsx 与 useBackgroundPrices 的成交点都传 false）。
 * 下单时的预检此前按 maker(0.0002) 估,成交按 taker(0.0004) 收,
 * 差的那一半是白放行的——这一项与价无关,币本位同样中招。
 */
export function fillCostUsd(symbol: string, order: PendingOrder, fillPrice: number, isMaker = false) {
  const { marginUsd } = getSettlementMarginParts(symbol, order, fillPrice);
  const { feeUsd } = getSettlementFeeParts(symbol, order, fillPrice, isMaker);
  return { marginUsd, feeUsd, totalUsd: marginUsd + feeUsd };
}
