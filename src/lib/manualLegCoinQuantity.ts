import type { CampaignCounterfactualManualLeg } from '@/types/journal';

/**
 * 【用户要求】反事实编辑器的「仓位」列改成「币量」：上行币量、下行 USD 名义，与 Legs 表「币量 / 仓位」同写法同数。
 *
 * 存储仍是名义 size_usdt（保存过的分支、引擎、偏离代价都不动）：
 *   · 币量 = 名义 ÷ 开仓价——与 Legs 表同一个式子（buildLegPositionShareInputs：pre_position_size ÷ 成交开仓价），
 *     副本的 size_usdt 就是腿上的 pre_position_size、entry_price 就是同一个成交开仓价，所以两边逐位同数；
 *   · 改币量 → 名义 = 币量 × 开仓价；
 *   · **只改开仓价时币数不变**：名义随价同比例变。引擎按「名义比例 ÷ 开仓价比例」缩放每一刀的币数
 *     （见 resolveManualLegEconomics），两个比例相等时每一刀的币数都不变，盈亏 = 币数 × 价差；
 *   · 没动过的腿一个字段都不改，原样重跑与实际逐位相同。
 */

/** 这条腿的币量；名义或开仓价不是正数时不猜，返回 null。 */
export function manualLegCoinQuantity(leg: Pick<CampaignCounterfactualManualLeg, 'size_usdt' | 'entry_price'>): number | null {
  const { size_usdt: size, entry_price: entry } = leg;
  if (!Number.isFinite(size) || !Number.isFinite(entry) || size <= 0 || entry <= 0) return null;
  return size / entry;
}

/** 改开仓价、币量不变：名义按新旧开仓价同比例缩放。旧价或新价无效时只改价（不猜名义）。 */
export function patchEntryPriceKeepingQuantity(
  leg: Pick<CampaignCounterfactualManualLeg, 'size_usdt' | 'entry_price'>,
  nextEntryPrice: number,
): Pick<CampaignCounterfactualManualLeg, 'entry_price'> & Partial<Pick<CampaignCounterfactualManualLeg, 'size_usdt'>> {
  if (!Number.isFinite(nextEntryPrice) || nextEntryPrice <= 0 || !(leg.entry_price > 0) || !(leg.size_usdt > 0)) {
    return { entry_price: nextEntryPrice };
  }
  if (nextEntryPrice === leg.entry_price) return { entry_price: nextEntryPrice };
  return { entry_price: nextEntryPrice, size_usdt: leg.size_usdt * (nextEntryPrice / leg.entry_price) };
}

/** 改币量：名义 = 币量 × 当前开仓价。 */
export function patchCoinQuantity(
  leg: Pick<CampaignCounterfactualManualLeg, 'entry_price'>,
  quantity: number,
): Pick<CampaignCounterfactualManualLeg, 'size_usdt'> {
  return { size_usdt: quantity * leg.entry_price };
}

/** 输入框里显示的币量：十位有效数字，去掉浮点尾巴（1.2300000000001 → 1.23），不改存储。 */
export function coinQuantityInputValue(quantity: number | null): number | '' {
  if (quantity == null || !Number.isFinite(quantity)) return '';
  return Number(quantity.toPrecision(10));
}

/** 摘要与说明里念币量：八位有效数字、千分位。 */
export function formatManualLegCoinQuantity(quantity: number | null): string {
  if (quantity == null || !Number.isFinite(quantity)) return '—';
  return Number(quantity.toPrecision(8)).toLocaleString('en-US', { maximumFractionDigits: 8 });
}
