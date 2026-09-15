/**
 * Legs 表「涨跌幅」列：开仓价 → 平仓价的**标的**价格变化。
 *
 * 涨跌幅 =（平仓价 − 开仓价）÷ 开仓价 × 100%。
 * 不按方向翻转——空单的价格涨了照样是正数。它说的是「这段时间币价走了多少」，
 * 不是这条腿赚了多少：盈亏看「贡献 / 盈亏」列，空单在这里为负才是赚。
 *
 * 页面与 PNG 导出共用这一份：调用方必须传入与「开仓价 / 平仓价」两格**同一对**数
 * （resolveLegExecution 的结果，含 K 线平仓价校正），三个数才永远对得上。
 */

/** 价格方向：按**显示到两位小数后**的值判定，颜色与读数永远一致（显示 0.00% 就不上色）。 */
export type LegPriceChangeDirection = 'up' | 'down' | 'flat';

function usablePrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 返回百分数（127.02 表示 +127.02%）。任一价格缺失、非有限，或开仓价 ≤ 0 时返回 null——
 * 不猜一个数出来，未平仓的腿就该是「—」。
 */
export function computeLegPriceChangePct(
  entryPrice: number | null | undefined,
  exitPrice: number | null | undefined,
): number | null {
  if (!usablePrice(entryPrice) || !usablePrice(exitPrice) || entryPrice <= 0) return null;
  const pct = ((exitPrice - entryPrice) / entryPrice) * 100;
  return Number.isFinite(pct) ? pct : null;
}

/** 两位小数取整后的值；取整为 0 时统一成 +0，避免印出「-0.00%」。 */
function roundedPct(pct: number): number {
  const rounded = Number(pct.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

/** 「+127.02%」「-3.41%」「0.00%」；缺值「—」。 */
export function formatLegPriceChangePct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const value = roundedPct(pct);
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** 缺值返回 null（中性、淡色）；取整为 0 是 flat（中性）；其余按绿涨红跌上色。 */
export function legPriceChangeDirection(pct: number | null): LegPriceChangeDirection | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const value = roundedPct(pct);
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}
