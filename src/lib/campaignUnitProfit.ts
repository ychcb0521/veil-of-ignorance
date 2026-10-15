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
export const POSITION_PROFIT_RULE = '几何仓位为实际值；括号里是 U × 几何仓位（理论）。单位 USDT。';
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
