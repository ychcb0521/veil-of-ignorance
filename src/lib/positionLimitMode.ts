/**
 * 持仓限制模式——两套规则，使用者在主屏幕顶栏「直接交易」右边自己选（SessionModeControls）。
 *
 *   · 'unlimited' 无限制（**默认**，从没选过的老用户也是它）：
 *       任何币种（U 本位、币本位、合成币本位一样）杠杆 1–150x（UNLIMITED_MAX_LEVERAGE），
 *       不设持仓上限、不设单笔市价 / 限价上限，有持仓时也能降杠杆（只要可用余额补得上保证金）；
 *       在这个模式下首笔成交开出的仓位盖 'unlimited-v1'，按旧的统一 0.4% 计维持保证金
 *       （positionRiskModel）——大名义、高杠杆不会因为分层维持保证金一开出来就被强平。
 *   · 'binance' 币安标准：positionLimit / marketLotSize / leverageTiers 里写的全部规则——
 *       各币种杠杆分层、「持仓 + 当前委托 + 本单」的持仓上限、单笔市价 / 限价上限、分层维持保证金。
 *
 * 口径：
 *   · 每一次判定（下单、触发、成交、改杠杆）都按**判定那一刻**的模式；切换本身不改写任何现有仓位与挂单。
 *   · 仓位开出来之后不换维持保证金模型（与 positionRiskModel 规则一相同）：切到币安标准之后，无限制模式下开的仓位
 *     仍按 0.4%，并与更新前的仓位一样当作对冲豁免的底。
 *   · 纯函数库把模式当**显式参数**收，缺省（undefined）一律按币安标准——库的口径与已有测试不变；
 *     使用者的选择由 TradingContext 保存（缺省无限制）并传进各个判定。
 */
import { resolveSymbolTiers, type TierSettlement } from '@/lib/leverageTiers';

export type PositionLimitMode = 'unlimited' | 'binance';

/** 没选过的使用者（含升级前的老用户）按无限制。 */
export const DEFAULT_POSITION_LIMIT_MODE: PositionLimitMode = 'unlimited';

/**
 * 无限制模式下所有币种的最高杠杆：币安全部合约里最高的那一档（快照里 U 本位最高 150x、币本位最高 125x），
 * 所以没有哪个币种在无限制模式下比币安更严。
 */
export const UNLIMITED_MAX_LEVERAGE = 150;

export const POSITION_LIMIT_MODE_LABEL: Readonly<Record<PositionLimitMode, string>> = Object.freeze({
  unlimited: '无限制',
  binance: '币安标准',
});

/** 两个选项的说明（顶栏按钮的 aria-label、切换时的提示、使用说明共用）。 */
export const POSITION_LIMIT_MODE_HINT: Readonly<Record<PositionLimitMode, string>> = Object.freeze({
  unlimited: `无限制：任何币种杠杆 1–${UNLIMITED_MAX_LEVERAGE}x，不设持仓上限、不设单笔下单上限，新仓维持保证金固定 0.4%`,
  binance: '币安标准：按币安各币种杠杆分层、持仓上限、单笔市价 / 限价上限与分层维持保证金',
});

/** 切换提示的第一句（短：提示标题已经说了切到哪一种，不再重复模式名）。 */
export const POSITION_LIMIT_MODE_SWITCH_LINE: Readonly<Record<PositionLimitMode, string>> = Object.freeze({
  unlimited: `杠杆 1–${UNLIMITED_MAX_LEVERAGE}x，不设持仓与单笔上限，新仓按 0.4% 计维持保证金`,
  binance: '按币安杠杆分层、持仓上限与单笔上限，新仓按分层计维持保证金',
});

/** 存下来的值读回来时收口：只认 'binance'，其余（缺省、旧数据、写坏的）一律按无限制。 */
export function normalizePositionLimitMode(value: unknown): PositionLimitMode {
  return value === 'binance' ? 'binance' : 'unlimited';
}

/** 纯函数库的判据：只有显式传了 'unlimited' 才放开；缺省按币安标准。 */
export function isUnlimitedLimitMode(mode?: PositionLimitMode | null): boolean {
  return mode === 'unlimited';
}

/** 这个合约（这种结算方式）在该模式下的最高杠杆：无限制 150x，币安标准按合约分层的第 1 档。 */
export function symbolMaxLeverageFor(
  symbol: string,
  settlement: TierSettlement,
  mode?: PositionLimitMode | null,
): number {
  return isUnlimitedLimitMode(mode) ? UNLIMITED_MAX_LEVERAGE : resolveSymbolTiers(symbol, settlement).maxLeverage;
}
