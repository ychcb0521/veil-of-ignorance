/**
 * 交易战役的三个新指标（【用户要求】2026-10-15）：
 *   ΔP（单位涨幅）= F − Kₘ
 *   U（单位利润）= Q × ΔP
 *   W（仓位利润）= U × 几何仓位
 * F、Kₘ 与相对涨幅同一份（F = 最终卖出价，含对冲锁价与平仓价校正；Kₘ = 末次加仓时的成本线 / 有效止损线），
 * Q = 首仓币数（初始主力与镜像同一批开仓的总币数，即几何仓位里的那个「1」）。
 * 计算在 computeCampaignGeometricMetrics；这里只放封面、排序、散点图、盈亏概况、导出共用的文字与格式。
 */
import { getPriceDecimals } from '@/lib/formatters';

export const UNIT_RISE_FORMULA = 'ΔP（单位涨幅）= F − Kₘ';
export const UNIT_PROFIT_FORMULA = 'U（单位利润）= Q × ΔP';
export const POSITION_PROFIT_FORMULA = 'W（仓位利润）= U × 几何仓位';

export const UNIT_RISE_RULE = 'F 为最终卖出价、Kₘ 为末次加仓时的成本线，两者与「相对涨幅」同一份取值（F 含对冲锁价与平仓价校正）；单位是价格（U / 币）。';
export const UNIT_PROFIT_RULE = 'Q 为首仓币数：初始主力与镜像同一批开仓的总币数（几何仓位里的「1」）；单位 USDT。';
/** 【用户要求】W（仓位利润）两种算法：第一种基于几何仓位（读数括号外），第二种基于几何仓位的理论值（读数括号内）。 */
export const POSITION_PROFIT_METHOD_ONE = '方法一（读数括号外）：W = U × 几何仓位';
export const POSITION_PROFIT_METHOD_TWO = '方法二（读数括号内）：W = U × 几何仓位（理论）';
export const POSITION_PROFIT_RULE = '方法一（读数括号外）用几何仓位，方法二（读数括号内）用几何仓位（理论）；排序、分档与散点图按方法一。单位 USDT。';
export const UNIT_METRICS_MISSING_RULE = '与相对涨幅同口径：只算主多、有实际加仓且主力已平仓的战役；缺少 F、Kₘ、Q 或几何仓位时显示「—」。ΔP 是价格差，不同标的之间不可直接比较大小；U、W 是 USDT，可以跨标的比较。';

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

// ── 封面上的紧凑读数【用户要求】2026-10-15：「数字太长了，可以后面加上 w（万）；单位涨幅 ΔP 都不统一」 ──
// 详情页盈亏概览、Excel 仍写完整精度；封面、排序分档（档界写法）用下面这一套，排序 / 分档按同一个取整读，
// 封面读数相同的战役必在同一档。

const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const toSubscript = (n: number) => String(n).split('').map(d => SUBSCRIPT_DIGITS[Number(d)]).join('');

function signed(value: number, text: string): string {
  return `${value < 0 && /[1-9]/.test(text) ? '-' : ''}${text}`;
}

/** |x| ≥ 1 万写成「x.xxw」（两位小数）。 */
const WAN = 10_000;

/**
 * U、W（USDT）：≥ 1 万「2.80w」；1000–1 万取整「8225」；< 1000 两位小数「800.00」。最长 7 个字符左右。
 */
export function formatCompactUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return signed(value, compactUsdText(Math.abs(value)));
}

function compactUsdText(abs: number): string {
  if (abs >= WAN) return `${(abs / WAN).toFixed(2)}w`;
  if (abs >= 1000) return abs.toFixed(0);
  return abs.toFixed(2);
}

export function compactUsdBinValue(value: number): number {
  const abs = Math.abs(value);
  const rounded = abs >= WAN ? Math.round(abs / 100) * 100 : abs >= 1000 ? Math.round(abs) : Number(abs.toFixed(2));
  return rounded === 0 ? 0 : Math.sign(value) * rounded;
}

/** G 的小数位：约 4 位有效数字；< 1 时首个非零数字起留 3 位。 */
function unitRiseDigits(abs: number): number {
  if (abs >= 1000) return 0;
  if (abs >= 100) return 1;
  if (abs >= 10) return 2;
  if (abs >= 1) return 3;
  if (abs === 0) return 2;
  return Math.min(12, Math.max(0, -Math.floor(Math.log10(abs)) - 1) + 3);
}

/**
 * G（价格差）：≥ 1 万「1.80w」；1–1 万约 4 位有效数字（84.00、140.0、1234）；
 * < 1 时留 3 位有效数字（0.0500、0.0120），小数点后连着 3 个及以上的 0 时用下标记 0 的个数（0.0₄123 = 0.0000123）。
 */
export function formatCompactUnitRise(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= WAN) return signed(value, `${(abs / WAN).toFixed(2)}w`);
  const digits = unitRiseDigits(abs);
  const text = abs.toFixed(digits);
  if (abs < 1) {
    const zeros = /^0\.(0*)/.exec(text)?.[1].length ?? 0;
    if (zeros >= 3) return signed(value, `0.0${toSubscript(zeros)}${text.slice(2 + zeros)}`);
  }
  return signed(value, text);
}

export function compactUnitRiseBinValue(value: number): number {
  const abs = Math.abs(value);
  const rounded = abs >= WAN ? Math.round(abs / 100) * 100 : Number(abs.toFixed(unitRiseDigits(abs)));
  return rounded === 0 ? 0 : Math.sign(value) * rounded;
}

/** 排序 / 分档用的封面读数（与封面紧凑读数同一个取整）。 */
export function unitRiseBinValue(value: number): number {
  return compactUnitRiseBinValue(value);
}

export function unitUsdBinValue(value: number): number {
  return compactUsdBinValue(value);
}

// ── 几何期望【用户要求】2026-10-15：先以「W（b）（几何增长）」替换「峰值涨幅倍数」的位置，
//    随后与原「几何期望」合并（两者本质一样），统一叫「几何期望」、留在这个位置，按这里的三种算法 ──

/** 固定下注比例 10%：几何期望 = 1 + 0.1 × b。 */
export const GEOMETRIC_GROWTH_FRACTION = 0.1;
export const GEOMETRIC_GROWTH_FORMULA = '几何期望 = 1 + 0.1 × b';
/**
 * 【用户要求】三种算法，读数写成「方法一（方法二/方法三）」：
 * 方法一基于盈亏比（2026-10-15 新增，作为第一种）；方法二基于几何仓位；方法三基于几何仓位的理论值。
 */
export const GEOMETRIC_GROWTH_METHOD_ONE = '方法一（读数括号外）：几何期望 = 1 + 0.1 × 盈亏比';
export const GEOMETRIC_GROWTH_METHOD_TWO = '方法二（括号内第一个）：几何期望 = 1 + 0.1 × 相对涨幅 × 几何仓位';
export const GEOMETRIC_GROWTH_METHOD_THREE = '方法三（括号内第二个）：几何期望 = 1 + 0.1 × 相对涨幅 × 几何仓位（理论）';
export const GEOMETRIC_GROWTH_RULE = '每场按 10% 固定比例下注时的资金增长因子：1.00 不增不减、> 1 增长、< 1 缩水。相对涨幅 × 几何仓位就是神奇的 b，所以方法二 = 1 + 0.1 × 神奇的 b、方法三 = 1 + 0.1 × 神奇的 b（理论）。盈亏比、神奇的 b 都可以是负数，按公式原样计算、不设 0 的下限，b < −10 时几何期望为负。排序、分档、散点图与统计概览按方法一。';
export const GEOMETRIC_GROWTH_MISSING_RULE = '方法一缺少有效盈亏比（没有初始风险 L₀）时写「—」；方法二、方法三与神奇的 b 同口径，没有实际加仓、或相对涨幅 / 几何仓位缺少依据时写「—」，括号里对应位置也写「—」。';

/** 几何期望 = 1 + 0.1 × b；b 缺失时 null。 */
export function computeGeometricGrowth(b: number | null | undefined): number | null {
  if (b == null || !Number.isFinite(b)) return null;
  const value = 1 + GEOMETRIC_GROWTH_FRACTION * b;
  return Number.isFinite(value) ? value : null;
}

/** 显示位数：两位小数，|W| ≥ 10 时一位（封面格子放得下三个读数）。 */
function geometricGrowthDigits(value: number): number {
  return Math.abs(Number(value.toFixed(2))) >= 10 ? 1 : 2;
}

/** |因子 − 1| < 0.0005 记 1.00；|因子| ≥ 10 只留一位小数。 */
export function formatGeometricGrowth(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const v = Math.abs(value - 1) < 0.0005 ? 1 : value;
  return v.toFixed(geometricGrowthDigits(v));
}

/** 排序 / 分档读数：与 formatGeometricGrowth 同一个取整。 */
export function geometricGrowthBinValue(value: number): number {
  const v = Math.abs(value - 1) < 0.0005 ? 1 : value;
  return Number(v.toFixed(geometricGrowthDigits(v)));
}

/** 三种算法的读数：「方法一（方法二/方法三）」；括号里两个都算不出时不写括号。 */
export function formatGeometricGrowthMethods(one: number | null | undefined, two: number | null | undefined, three: number | null | undefined): string {
  const head = formatGeometricGrowth(one);
  const inner = [two, three].map(formatGeometricGrowth);
  if (inner.every(text => text === '—')) return head;
  // 分隔符不带空格：封面格子窄（1280px 时约 112px），三个读数要放得下
  return `${head}（${inner.join('/')}）`;
}

/**
 * 统计概览的几何期望【用户要求】2026-10-15：「统计概览中的几何期望，也要基于新的数据和逻辑」。
 * 不再用「盈利侧平均 b + 胜率」推演，而是把这批战役每一场的几何期望（单场因子）直接连乘：
 *   连乘 ∏ᵢ 几何期望ᵢ —— 每场按 10% 下注、这一串战役走下来本金变成几倍；
 *   几何平均 (∏)^(1/n) —— 平均每场把本金乘上几倍，与封面单场读数同一个尺度（1.00 不增不减）。
 * 有一场因子 ≤ 0（盈亏比 ≤ −10，这一注亏光本金）时连乘与几何平均都记 0（归零）。
 * 用 exp(Σ ln) 求连乘，几百场也不会中途上溢 / 下溢。
 */
export interface GeometricExpectancySummary {
  /** 参与的场数（因子算得出的战役）。 */
  count: number;
  /** ∏ 因子；没有样本时 null。 */
  product: number | null;
  /** 几何平均 = product^(1/n)；没有样本时 null。 */
  mean: number | null;
  /** 因子 ≤ 0 的场数（> 0 即归零）。 */
  ruinCount: number;
}

export function summarizeGeometricExpectancy(factors: Iterable<number | null | undefined>): GeometricExpectancySummary {
  let count = 0;
  let ruinCount = 0;
  let logSum = 0;
  for (const factor of factors) {
    if (factor == null || !Number.isFinite(factor)) continue;
    count += 1;
    if (factor <= 0) ruinCount += 1;
    else logSum += Math.log(factor);
  }
  if (count === 0) return { count, product: null, mean: null, ruinCount };
  if (ruinCount > 0) return { count, product: 0, mean: 0, ruinCount };
  return { count, product: Math.exp(logSum), mean: Math.exp(logSum / count), ruinCount };
}
