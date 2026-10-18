/**
 * CBA 买方定价优势指数（−100 ~ 100）。
 *
 * 【用户要求】2026-10-18 按用户笔记新增：
 *   CBAₜ = 100·tanh( Σ_{i∈Wₜ} wᵢ,ₜ · Fᵢ · Gᵢ · Rᵢ,ₜ )
 *   时间权重   wᵢ,ₜ = 2^(−ΔTᵢ,ₜ/h) ÷ Σ_{j∈Wₜ} 2^(−ΔTⱼ,ₜ/h)          Wₜ = 截至当前的 48 小时观察窗口，ΔT = 距今小时数
 *   成交支持   Fᵢ = ln(1 + (|Dᵢ| + η(Vᵢ − |Dᵢ|)) ÷ V̄ᵢ₋₁)              Dᵢ = Bᵢ − Sᵢ（主动成交净差额），Vᵢ = Bᵢ + Sᵢ
 *   主动买入加权 Gᵢ = 1 + α·max(Aᵢ, 0)                                Aᵢ = Dᵢ ÷ Vᵢ，−1 ~ 1
 *   保留上移速度 Rᵢ,ₜ = ln[min(Eₜ, Cₜ) ÷ Eᵢ₋₁] ÷ ((t − i + 1)·σₜ₋₁)    E = 成交均价（VWAP = 成交额 ÷ 成交量），C = 收盘价
 * 正值 = 向上的价格优势仍被保留；负值 = 价格结果不支持买方优势。不是胜率。
 *
 * 笔记里没写死、这里取定的（都可以在 Deep dig 公式里改）：
 *   - h 默认 6 小时（与动态谢林点相同），η 默认 0.5，α 默认 1（与动态谢林点的 α 相同）；
 *   - V̄ᵢ₋₁ = 截至上一根、过去 24 小时的平均成交额；σₜ₋₁ = 截至上一根、过去 24 小时 5 分钟成交均价对数收益率的样本标准差；
 *   - 某根缺成交额 / 主动买入额 / 成交量：这一根的 Fᵢ·Gᵢ·Rᵢ,ₜ 记 0（不拿币数凑），权重照算；
 *   - 窗口按时长，K 线图上与动态谢林点同一约定：按 5 分钟图计，其他周期等比例缩放（每根 K 线的窗口根数相同）。
 * 与 Deep dig 公式的 retain / avg / sd / prev 同一份实现，单元测试核对逐根一致。纯函数，不读网络。
 */
import { barsForHours, retainSum, rollingMean, rollingSd, shiftBars } from '@/lib/deepDig/formula';

export const CBA_DEFAULTS = { halfLifeHours: 6, eta: 0.5, alpha: 1, windowHours: 48, normHours: 24 } as const;
export type CbaParams = { -readonly [K in keyof typeof CBA_DEFAULTS]: number };

export const CBA_DEFINITION = 'CBA 买方定价优势指数（−100 ~ 100）：过去 48 小时每根 K 线的「成交支持 × 主动买入加权 × 保留上移速度」按时间权重加总，再 100·tanh 压缩。正值 = 向上的价格优势仍被保留；负值 = 价格结果不支持买方优势。不是胜率。';
export const CBA_STEPS = [
  'CBAₜ = 100·tanh( Σ wᵢ,ₜ · Fᵢ · Gᵢ · Rᵢ,ₜ )，i 取截至当前的 48 小时观察窗口里的每一根 5 分钟 K 线',
  '时间权重 wᵢ,ₜ = 2^(−距今小时 ÷ h) 归一化（合计 1），h = 半衰期（小时，默认 6）',
  '成交支持 Fᵢ = ln(1 + (|D| + η·(V − |D|)) ÷ V̄)：D = 主动买 − 主动卖，V = 成交额，V̄ = 截至上一根过去 24 小时的平均成交额，η = 0.5',
  '主动买入加权 Gᵢ = 1 + α·max(A, 0)：A = D ÷ V，α = 1',
  '保留上移速度 Rᵢ,ₜ = ln[min(Eₜ, Cₜ) ÷ Eᵢ₋₁] ÷ ((t − i + 1)·σ)：E = 成交均价（VWAP），C = 收盘价，σ = 截至上一根过去 24 小时成交均价对数收益率的波动率',
  '正值：向上的价格优势仍被保留；负值：价格结果不支持买方优势（不是胜率）',
].join('\n');

export interface CbaBar {
  close: number;
  /** 成交量（币数）：算成交均价用。 */
  volume?: number | null;
  /** 成交额（USDT）。 */
  quoteVolume?: number | null;
  /** 主动买入成交额（USDT）。 */
  takerBuyQuoteVolume?: number | null;
}

export interface CbaPoint {
  cba: number | null;
  /** 中间量：成交支持 F、主动买入加权 G、成交均价 E、波动率 σ、tanh 之前的加总。 */
  f: number | null;
  g: number | null;
  e: number | null;
  sigma: number | null;
  sum: number | null;
}

const clean = (x: number) => (Number.isFinite(x) ? x : Number.NaN);
const fin = (x: number) => (Number.isFinite(x) ? x : null);

/** 逐根算 CBA。barMinutes = K 线周期（分钟）。 */
export function computeCba(bars: readonly CbaBar[], barMinutes: number, params: Partial<CbaParams> = {}): CbaPoint[] {
  const { halfLifeHours, eta, alpha, windowHours, normHours } = { ...CBA_DEFAULTS, ...params };
  const series = (f: (b: CbaBar) => number | null | undefined) => Float64Array.from(bars, b => {
    const v = f(b);
    return v != null && Number.isFinite(v) ? v : Number.NaN;
  });
  const c = series(b => b.close);
  const q = series(b => b.quoteVolume);
  const buy = series(b => b.takerBuyQuoteVolume);
  const e = series(b => (b.quoteVolume != null && b.volume != null && b.volume > 0 ? b.quoteVolume / b.volume : null));
  const nNorm = barsForHours(normHours, barMinutes);
  const vbar = shiftBars(rollingMean(q, nNorm), 1);
  const f = q.map((v, i) => {
    const d = Math.abs(buy[i] - (v - buy[i]));
    return clean(Math.log(clean(1 + clean((d + eta * (v - d)) / vbar[i]))));
  });
  const g = q.map((v, i) => {
    const a = clean((buy[i] - (v - buy[i])) / v);
    return Number.isNaN(a) ? Number.NaN : 1 + alpha * Math.max(a, 0);
  });
  const k = f.map((x, i) => clean(x * g[i]));
  const p = e.map((x, i) => (Number.isNaN(x) || Number.isNaN(c[i]) ? Number.NaN : Math.min(x, c[i])));
  const ePrev = shiftBars(e, 1);
  const r = e.map((x, i) => clean(Math.log(clean(x / ePrev[i]))));
  const sigma = shiftBars(rollingSd(r, nNorm), 1);
  const sum = retainSum(k, p, ePrev, 2 ** (-barMinutes / (halfLifeHours * 60)), barsForHours(windowHours, barMinutes));
  return Array.from(bars, (_, i) => {
    const ratio = clean(sum[i] / sigma[i]);
    return { cba: fin(clean(100 * Math.tanh(ratio))), f: fin(f[i]), g: fin(g[i]), e: fin(e[i]), sigma: fin(sigma[i]), sum: fin(sum[i]) };
  });
}
