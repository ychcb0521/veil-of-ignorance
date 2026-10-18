/**
 * CBI 买方优势指数（−1 ~ 1）：CBI = P × D，> 0 买方占优。
 *
 * 【用户要求】2026-10-18 按用户笔记新增：
 *   D = (α_F·u_F + α_A·u_A + α_K·u_K + α_S·u_S) ÷ Σα          方向；α：F 0.30、A 0.30、S 0.25、K 0.15
 *   u_j = tanh(z_j ÷ 2)，z_j = (X_j − c_j) ÷ (1.4826·MAD_j)      稳健 z；c_j：F 取基线中位数，其余 0；MAD_j：基线期的中位数绝对偏差
 *   F = Σw(Vᵇ − Vˢ) ÷ ΣwV                                       主动性
 *   A = (λ⁺ − λ⁻) ÷ (|λ⁺| + |λ⁻|)                               吸收
 *     λ⁺ = [Σ_{x>0} w·r + κλ₀] ÷ [Σ_{x>0} w·x + κ]，λ⁻ = [Σ_{x<0} w·r − κλ₀] ÷ [Σ_{x<0} w·x − κ]
 *     x = (Vᵇ − Vˢ) ÷ V̄，r = (Cᵢ − Cᵢ₋₁) ÷ ATR，λ₀ = Σ r·sgn(x) ÷ Σ|x|
 *   K = Σw·V·CLV ÷ Σw·V，CLV = (2C − H − L) ÷ (H − L)           收盘控制
 *   u_S = ½[tanh(z_d ÷ 2) + tanh(z_v ÷ 2)]，d = (C − M) ÷ ATR，v = (Mₜ − Mₜ₋ₘ) ÷ (m·ATR)   结构
 *   M = Σw·V·(H + L + C)/3 ÷ Σw·V                               窗口成交量加权均价
 *   P = RVᵏ ÷ (1 + RVᵏ)                                         参与度（可信度），k = 2
 *   w = 2^(−(t − i) ÷ h)，求和都在最近 N 根内；ATR 14 根
 *
 * 笔记里没写死、这里取定的（都可以在 Deep dig 公式里改）：
 *   - h = 12 根、N = 48 根、m = 12 根（5 分钟图上 1 小时 / 4 小时 / 1 小时）、κ = 1；
 *   - 成交量一律用成交金额（USDT），与其他指标一致：V = 成交额，Vᵇ / Vˢ = 主动买入 / 卖出成交额；
 *   - 基线：V̄ 原文是「同时段、过去 20 天中位数」，研究与图表拿不到每个时点前 20 天的 5 分钟 K 线，改用截至上一根、过去 24 小时成交额的中位数；
 *     各分量的基线中位数与 MAD、λ₀ 也都用截至上一根、过去 24 小时（λ₀ 不加时间权重，与原文一致）；
 *   - 稳健 z 的分母 = 1.4826·MAD；MAD = 0（基线里一半以上的值相同）时改用 1.2533·平均绝对偏差——吸收分量 A 只要买卖两侧斜率一正一负就正好是 ±1，
 *     单边行情里过去 24 小时一半以上都是 1，MAD = 0，不补这一条 A 就算不出来；
 *   - RV = Σw·V ÷ Σw·V̄（窗口内加权的相对成交量）；ATR = Wilder 平滑 14 根；H = L 时 CLV 记 0；
 *   - 缺成交额的那根不进各个加权和（不拿币数凑）。
 * K 线图上 h、N、m、ATR 都按根计（所有周期一样），基线 24 小时按 5 分钟图计（288 根）。与 Deep dig 公式同一套函数，单元测试核对逐根一致。
 */
import { atrSeries, barsForHours, rollingMedian, rollingRobustScale, rollingSum, shiftBars, wsumBars } from '@/lib/deepDig/formula';

export const CBI_WEIGHTS = { F: 0.3, A: 0.3, K: 0.15, S: 0.25 } as const;
export const CBI_DEFAULTS = { h: 12, n: 48, m: 12, kappa: 1, k: 2, atrBars: 14, baseHours: 24 } as const;
export type CbiParams = { -readonly [K in keyof typeof CBI_DEFAULTS]: number };

export const CBI_DEFINITION = 'CBI 买方优势指数（−1 ~ 1）= 参与度 P × 方向 D：D 由主动性 F、吸收 A、收盘控制 K、结构 S 四个分量（稳健 z 压到 −1 ~ 1）按 0.30 / 0.30 / 0.15 / 0.25 加权；P = RV² ÷ (1 + RV²)，量越大越可信。> 0 买方占优。';
export const CBI_STEPS = [
  'CBI = P × D，−1 ~ 1；w = 2^(−(t − i) ÷ h)，求和都在最近 N 根内（h = 12、N = 48 根）',
  'F 主动性 = Σw(主动买 − 主动卖) ÷ Σw·成交额',
  'A 吸收 = (λ⁺ − λ⁻) ÷ (|λ⁺| + |λ⁻|)：λ± = 买 / 卖一侧每单位主动净流量推动的价格（以 ATR 计），向基线对称冲击 λ₀ 收缩（κ = 1）',
  'K 收盘控制 = Σw·V·CLV ÷ Σw·V，CLV = (2C − H − L) ÷ (H − L)',
  'S 结构 = ½[tanh(z_d ÷ 2) + tanh(z_v ÷ 2)]：d = (C − M) ÷ ATR，v = (Mₜ − Mₜ₋₁₂) ÷ (12·ATR)，M = 窗口成交额加权均价',
  '各分量 u = tanh(z ÷ 2)，z = (X − 中性点) ÷ (1.4826 × MAD)（MAD = 0 时用 1.2533 × 平均绝对偏差）；中性点：F 取基线中位数、其余 0；基线 = 截至上一根过去 24 小时',
  'D = 0.30·u_F + 0.30·u_A + 0.15·u_K + 0.25·u_S；P = RV² ÷ (1 + RV²)，RV = Σw·V ÷ Σw·V̄，V̄ = 截至上一根过去 24 小时成交额中位数（原文 20 天同时段，拿不到）',
].join('\n');

export interface CbiBar {
  high: number;
  low: number;
  close: number;
  /** 成交额（USDT）。 */
  quoteVolume?: number | null;
  /** 主动买入成交额（USDT）。 */
  takerBuyQuoteVolume?: number | null;
}

export interface CbiPoint {
  cbi: number | null;
  d: number | null;
  p: number | null;
  /** 四个分量的原始值。 */
  f: number | null;
  a: number | null;
  k: number | null;
  /** 四个分量压到 (−1, 1) 之后。 */
  uF: number | null;
  uA: number | null;
  uK: number | null;
  uS: number | null;
}

// 与 Deep dig 公式的运算同一口径：四则 / 乘方结果非有限 → 空；比较、sign 遇空 → 空
const clean = (x: number) => (Number.isFinite(x) ? x : Number.NaN);
const fin = (x: number) => (Number.isFinite(x) ? x : null);
type S = Float64Array;
const map = (n: number, f: (i: number) => number): S => Float64Array.from({ length: n }, (_, i) => f(i));

export function computeCbi(bars: readonly CbiBar[], barMinutes: number, params: Partial<CbiParams> = {}): CbiPoint[] {
  const { h, n, m, kappa, k, atrBars, baseHours } = { ...CBI_DEFAULTS, ...params };
  const len = bars.length;
  const series = (f: (b: CbiBar) => number | null | undefined) => Float64Array.from(bars, b => {
    const v = f(b);
    return v != null && Number.isFinite(v) ? v : Number.NaN;
  });
  const H = series(b => b.high);
  const L = series(b => b.low);
  const C = series(b => b.close);
  const Q = series(b => b.quoteVolume);
  const B = series(b => b.takerBuyQuoteVolume);
  const Sv = map(len, i => Q[i] - B[i]);
  const base = barsForHours(baseHours, barMinutes);
  const W = (x: S) => wsumBars(x, h, n);
  const div = (a: S, b: S) => map(len, i => clean(a[i] / b[i]));
  // 稳健尺度 = 1.4826·MAD（MAD = 0 时 1.2533·平均绝对偏差），截至上一根
  const baseScale = (x: S) => shiftBars(rollingRobustScale(x, base), 1);

  const ATR = atrSeries(H, L, C, atrBars);
  const vbar = shiftBars(rollingMedian(Q, base), 1);
  const net = map(len, i => clean(B[i] - Sv[i]));
  const x = div(net, vbar);
  const Cprev = shiftBars(C, 1);
  const r = map(len, i => clean(clean(C[i] - Cprev[i]) / ATR[i]));
  const wQ = W(Q);
  const F = div(W(net), wQ);
  const sgnX = map(len, i => (Number.isNaN(x[i]) ? Number.NaN : Math.sign(x[i])));
  const lam0 = div(rollingSum(map(len, i => clean(r[i] * sgnX[i])), base), rollingSum(map(len, i => Math.abs(x[i])), base));
  const pick = (cond: (v: number) => boolean, val: S) => map(len, i => (Number.isNaN(x[i]) ? Number.NaN : cond(x[i]) ? val[i] : 0));
  const lp = new Float64Array(len);
  const lm = new Float64Array(len);
  const rUp = W(pick(v => v > 0, r));
  const xUp = W(pick(v => v > 0, x));
  const rDn = W(pick(v => v < 0, r));
  const xDn = W(pick(v => v < 0, x));
  for (let i = 0; i < len; i++) {
    const kl = clean(kappa * lam0[i]);
    lp[i] = clean(clean(rUp[i] + kl) / clean(xUp[i] + kappa));
    lm[i] = clean(clean(rDn[i] - kl) / clean(xDn[i] - kappa));
  }
  const A = map(len, i => clean(clean(lp[i] - lm[i]) / clean(Math.abs(lp[i]) + Math.abs(lm[i]))));
  const CLV = map(len, i => (Number.isNaN(H[i]) || Number.isNaN(L[i]) ? Number.NaN : H[i] > L[i] ? clean(clean(clean(clean(2 * C[i]) - H[i]) - L[i]) / clean(H[i] - L[i])) : 0));
  const K = div(W(map(len, i => clean(Q[i] * CLV[i]))), wQ);
  const M = div(W(map(len, i => clean(Q[i] * clean(clean(clean(H[i] + L[i]) + C[i]) / 3)))), wQ);
  const d = map(len, i => clean(clean(C[i] - M[i]) / ATR[i]));
  const Mprev = shiftBars(M, m);
  const v = map(len, i => clean(clean(M[i] - Mprev[i]) / clean(m * ATR[i])));
  const u = (z: (i: number) => number) => map(len, i => clean(Math.tanh(clean(z(i) / 2))));
  const medF = shiftBars(rollingMedian(F, base), 1);
  const sF = baseScale(F);
  const sA = baseScale(A);
  const sK = baseScale(K);
  const sD = baseScale(d);
  const sV = baseScale(v);
  const uF = u(i => clean(clean(F[i] - medF[i]) / sF[i]));
  const uA = u(i => clean(A[i] / sA[i]));
  const uK = u(i => clean(K[i] / sK[i]));
  const ud = u(i => clean(d[i] / sD[i]));
  const uv = u(i => clean(v[i] / sV[i]));
  const uS = map(len, i => clean(clean(ud[i] + uv[i]) / 2));
  const { F: aF, A: aA, K: aK, S: aS } = CBI_WEIGHTS;
  const sumW = aF + aA + aK + aS;
  const D = map(len, i => clean(clean(clean(clean(clean(aF * uF[i]) + clean(aA * uA[i])) + clean(aK * uK[i])) + clean(aS * uS[i])) / sumW));
  const RV = div(wQ, W(vbar));
  const P = map(len, i => { const rk = clean(RV[i] ** k); return clean(rk / clean(1 + rk)); });
  return Array.from(bars, (_, i) => ({
    cbi: fin(clean(P[i] * D[i])), d: fin(D[i]), p: fin(P[i]), f: fin(F[i]), a: fin(A[i]), k: fin(K[i]),
    uF: fin(uF[i]), uA: fin(uA[i]), uK: fin(uK[i]), uS: fin(uS[i]),
  }));
}
