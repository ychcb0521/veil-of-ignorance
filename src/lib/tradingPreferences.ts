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
  /** 下单确认弹窗：关闭后市价单不再二次确认（币安「下单确认」）。 */
  orderConfirm: boolean;
}

export const DEFAULT_TRADING_PREFERENCES: TradingPreferences = {
  useDefaultLeverage: false,
  defaultLeverage: 10,
  defaultMarginMode: DEFAULT_MARGIN_MODE,
  orderConfirm: true,
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
