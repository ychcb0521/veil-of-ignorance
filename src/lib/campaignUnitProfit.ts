/**
 * 交易战役的三个新指标（【用户要求】2026-10-15）：
 *   G（单位涨幅）= F − Kₘ
 *   U（单位利润）= Q × G
 *   W（仓位利润）= U × 几何仓位
 * F、Kₘ 与相对涨幅同一份（F = 最终卖出价，含对冲锁价与平仓价校正；Kₘ = 末次加仓时的成本线 / 有效止损线），
 * Q = 首仓币数（初始主力与镜像同一批开仓的总币数，即几何仓位里的那个「1」）。
 * 计算在 computeCampaignGeometricMetrics；这里只放封面、排序、散点图、盈亏概况、导出共用的文字与格式。
 */
import { getPriceDecimals } from '@/lib/formatters';

export const UNIT_RISE_FORMULA = 'G（单位涨幅）= F − Kₘ';
export const UNIT_PROFIT_FORMULA = 'U（单位利润）= Q × G';
export const POSITION_PROFIT_FORMULA = 'W（仓位利润）= U × 几何仓位';

export const UNIT_RISE_RULE = 'F 为最终卖出价、Kₘ 为末次加仓时的成本线，两者与「相对涨幅」同一份取值（F 含对冲锁价与平仓价校正）；单位是价格（U / 币）。';
export const UNIT_PROFIT_RULE = 'Q 为首仓币数：初始主力与镜像同一批开仓的总币数（几何仓位里的「1」）；单位 USDT。';
/** 【用户要求】W（仓位利润）两种算法：第一种基于几何仓位（读数括号外），第二种基于几何仓位的理论值（读数括号内）。 */
export const POSITION_PROFIT_METHOD_ONE = '方法一（读数括号外）：W = U × 几何仓位';
export const POSITION_PROFIT_METHOD_TWO = '方法二（读数括号内）：W = U × 几何仓位（理论）';
export const POSITION_PROFIT_RULE = '方法一（读数括号外）用几何仓位，方法二（读数括号内）用几何仓位（理论）；排序、分档与散点图按方法一。单位 USDT。';
export const UNIT_METRICS_MISSING_RULE = '与相对涨幅同口径：只算主多、有实际加仓且主力已平仓的战役；缺少 F、Kₘ、Q 或几何仓位时显示「—」。G 是价格差，不同标的之间不可直接比较大小；U、W 是 USDT，可以跨标的比较。';

function withThousands(text: string): string {
  const [int, frac] = text.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac != null ? `${grouped}.${frac}` : grouped;
}

/** G 按价格精度显示（与价格同一套位数：≥ 1000 两位、≥ 1 四位……），负号用「-」。 */
export function unitRiseDecimals(value: number): number {
  return getPriceDecimals(value);
}

export function formatUnitRise(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const text = Math.abs(value).toFixed(unitRiseDecimals(value));
  return `${value < 0 && Number(text) !== 0 ? '-' : ''}${withThousands(text)}`;
}

/** U、W：USDT 两位小数、千分位。 */
export function formatUnitUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const text = Math.abs(value).toFixed(2);
  return `${value < 0 && Number(text) !== 0 ? '-' : ''}${withThousands(text)}`;
}

/** 排序 / 分档用的封面读数（与上面两个格式化函数同一个取整）。 */
export function unitRiseBinValue(value: number): number {
  return Number(value.toFixed(unitRiseDecimals(value)));
}

export function unitUsdBinValue(value: number): number {
  return Number(value.toFixed(2));
}

// ── W（b）（几何增长）【用户要求】2026-10-15：替换「峰值涨幅倍数」的位置 ──

/** 固定下注比例 10%：W（b）= 1 + 0.1 × b。 */
export const GEOMETRIC_GROWTH_FRACTION = 0.1;
export const GEOMETRIC_GROWTH_FORMULA = 'W（b）= 1 + 0.1 × 相对涨幅 × 几何仓位';
/** 【用户要求】两种算法：第一种基于几何仓位（读数括号外），第二种基于几何仓位的理论值（读数括号内）。 */
export const GEOMETRIC_GROWTH_METHOD_ONE = '方法一（读数括号外）：W（b）= 1 + 0.1 × 相对涨幅 × 几何仓位';
export const GEOMETRIC_GROWTH_METHOD_TWO = '方法二（读数括号内）：W（b）= 1 + 0.1 × 相对涨幅 × 几何仓位（理论）';
export const GEOMETRIC_GROWTH_RULE = '相对涨幅 × 几何仓位就是神奇的 b，所以方法一 = 1 + 0.1 × 神奇的 b、方法二 = 1 + 0.1 × 神奇的 b（理论）：每场按 10% 固定比例下注时的资金增长因子，1.00 不增不减、> 1 增长、< 1 缩水。排序、分档与散点图按方法一。按公式原样计算、不设 0 的下限（与几何期望的 max(0, …) 不同），b < −10 时为负。';
export const GEOMETRIC_GROWTH_MISSING_RULE = '与神奇的 b 同口径：没有实际加仓、或相对涨幅 / 几何仓位缺少依据时显示「—」。';

/** W（b）= 1 + 0.1 × b；b 缺失时 null。 */
export function computeGeometricGrowth(b: number | null | undefined): number | null {
  if (b == null || !Number.isFinite(b)) return null;
  const value = 1 + GEOMETRIC_GROWTH_FRACTION * b;
  return Number.isFinite(value) ? value : null;
}

/** 两位小数；|W − 1| < 0.0005 记 1.00（与几何期望同一个取整）。 */
export function formatGeometricGrowth(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return (Math.abs(value - 1) < 0.0005 ? 1 : value).toFixed(2);
}
