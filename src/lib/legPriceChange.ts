/**
 * Legs 表「涨跌幅」列：开仓价 → 平仓价的价格变化，**按这条腿的方向计**。
 *
 * 多单：涨跌幅 =（平仓价 − 开仓价）÷ 开仓价 × 100%；
 * 空单：涨跌幅 =（开仓价 − 平仓价）÷ 开仓价 × 100%。
 * 正数即这条腿在价格上占优——空单的价格跌了是正数、涨了是负数，按所示的这一对开平价看与「贡献 / 盈亏」同号
 * （不计手续费；一个仓位分几刀平掉时平仓价取最后一刀、盈亏是各刀合计，符号可能不同）。
 * 不再只印标的自身的涨跌：那样对冲空单价格涨了 3% 会印成绿色「+3.27%」，读起来像是这条腿赚了。
 *
 * 页面与 PNG 导出共用这一份：调用方必须传入与「开仓价 / 平仓价」两格**同一对**数
 * （resolveLegExecution 的结果，含 K 线平仓价校正）以及这条腿的方向（阶段子行沿用主力的方向），
 * 三个数才永远对得上。
 */

/** 读数方向：按**显示到两位小数后**的值判定，颜色与读数永远一致（显示 0.00% 就不上色）。up 即正数（占优）、down 即负数。 */
export type LegPriceChangeDirection = 'up' | 'down' | 'flat';

function usablePrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 返回百分数（127.02 表示 +127.02%）。任一价格缺失、非有限，或开仓价 ≤ 0 时返回 null——
 * 不猜一个数出来，未平仓的腿就该是「—」。
 * side 是这条腿的持仓方向：多单看平仓价比开仓价高了多少，空单看平仓价比开仓价低了多少。
 */
export function computeLegPriceChangePct(
  entryPrice: number | null | undefined,
  exitPrice: number | null | undefined,
  side: 'long' | 'short',
): number | null {
  if (!usablePrice(entryPrice) || !usablePrice(exitPrice) || entryPrice <= 0) return null;
  const move = side === 'short' ? entryPrice - exitPrice : exitPrice - entryPrice;
  const pct = (move / entryPrice) * 100;
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

/** 缺值返回 null（中性、淡色）；取整为 0 是 flat（中性）；其余正绿负红上色。 */
export function legPriceChangeDirection(pct: number | null): LegPriceChangeDirection | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const value = roundedPct(pct);
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}
