/**
 * 交易偏好 —— 对应币安右上角「⋯ → 交易偏好」抽屉里的设置。
 *
 * 目前落地的是真正影响下单行为的两项：
 *   · 默认杠杆（启用后，新标的按此杠杆起手）
 *   · 默认保证金模式（新标的的逐仓 / 全仓）
 * 与 DEFAULT_MARGIN_MODE 的关系：常量是「出厂默认」，这里是「用户覆盖」，
 * 用户没开启开关时仍走常量。
 *
 * 币安的语义细节照搬：默认杠杆只对「尚未访问过的币对」生效，已有持仓或挂单
 * 的币对不受影响——否则会把已建仓位的风险参数在背后改掉。
 */
import type { MarginMode } from '@/types/trading';
import { DEFAULT_MARGIN_MODE } from '@/types/trading';

export interface TradingPreferences {
  /** 是否启用「应用默认杠杆」。关闭时新标的沿用系统默认。 */
  useDefaultLeverage: boolean;
  /** 默认杠杆倍数（1–50，与币安该面板的滑条范围一致）。 */
  defaultLeverage: number;
  /** 默认保证金模式。 */
  defaultMarginMode: MarginMode;
  /** 下单确认：按订单类型分别控制是否二次确认（币安「下单确认」页）。 */
  orderConfirm: Record<OrderConfirmKey, boolean>;
  /** 默认触发类型：止损/条件单以哪个价格判定触发（币安「默认触发类型」页）。 */
  defaultTriggerType: 'LAST' | 'MARK';
  /** 仓位模式：单向 = 同一合约只允许一个方向；双向 = 可同时持多空（币安「仓位模式」页）。 */
  positionMode: 'oneway' | 'hedge';
}

/** 下单确认可分别开关的订单类型——与币安该页逐项对应。 */
export type OrderConfirmKey =
  | 'limit' | 'market' | 'tpsl' | 'marketTpsl' | 'conditional' | 'trailing' | 'twap' | 'reverse';

export const ORDER_CONFIRM_ITEMS: { key: OrderConfirmKey; label: string }[] = [
  { key: 'limit', label: '限价 订单' },
  { key: 'market', label: '市价 订单' },
  { key: 'tpsl', label: '止盈止损 订单' },
  { key: 'marketTpsl', label: '市价止盈止损 订单' },
  { key: 'conditional', label: '条件委托 订单' },
  { key: 'trailing', label: '跟踪委托 订单' },
  { key: 'twap', label: 'TWAP 订单' },
  { key: 'reverse', label: '反手交易' },
];

/**
 * 可显隐的面板。币安列了七个模块，本系统只有这两个**真的能藏**：
 * 图表 / 下单 / 仓位是交易页的骨架，藏了页面就没法用；
 * 「最新成交」「保证金比率」本系统压根没有这两个模块。
 * 与其摆五个拨不动的开关，不如只留能兑现的。
 */
export type PanelKey = 'orderBook' | 'pGap';

export const PANEL_ITEMS: { key: PanelKey; label: string; desc: string }[] = [
  { key: 'orderBook', label: '订单簿', desc: '关闭后隐藏右侧盘口，图表占满整个上半区。' },
  { key: 'pGap', label: 'P_gap 优势边际', desc: '关闭后收起为标题栏，空间让给盘口。' },
];

export const DEFAULT_TRADING_PREFERENCES: TradingPreferences = {
  useDefaultLeverage: false,
  defaultLeverage: 10,
  defaultMarginMode: DEFAULT_MARGIN_MODE,
  // 币安默认全部关闭（不弹二次确认）；本系统的决策记录模式另有强制快照，不受此影响
  orderConfirm: {
    limit: false, market: false, tpsl: false, marketTpsl: false,
    conditional: false, trailing: false, twap: false, reverse: false,
  },
  defaultTriggerType: 'LAST',
  // 本系统主仓做多 + 对冲做空并存，天然是双向持仓
  positionMode: 'hedge',
};

/** 币安该面板的杠杆刻度。 */
export const LEVERAGE_MARKS = [1, 10, 20, 30, 40, 50] as const;
export const MIN_PREF_LEVERAGE = 1;
export const MAX_PREF_LEVERAGE = 50;

export function clampPrefLeverage(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TRADING_PREFERENCES.defaultLeverage;
  return Math.min(MAX_PREF_LEVERAGE, Math.max(MIN_PREF_LEVERAGE, Math.round(value)));
}

/**
 * 某标的开新仓时应采用的杠杆 / 保证金模式。
 * 已为该标的显式设置过（symbolLeverage / symbolMarginMode 有值）时一律以其为准——
 * 默认设置只作用于「还没碰过」的币对，这与币安一致。
 */
export function resolveInitialSymbolSetup(
  prefs: TradingPreferences,
  explicitLeverage: number | null,
  explicitMarginMode: MarginMode | null,
): { leverage: number | null; marginMode: MarginMode } {
  return {
    leverage: explicitLeverage != null
      ? explicitLeverage
      : (prefs.useDefaultLeverage ? clampPrefLeverage(prefs.defaultLeverage) : null),
    marginMode: explicitMarginMode ?? prefs.defaultMarginMode,
  };
}
