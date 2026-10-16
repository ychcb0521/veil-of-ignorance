/**
 * 动态谢林点指标（Dynamic Schelling Point, DSP）。
 *
 * 【用户要求】2026-10-15 按用户给定的规格实现，公式逐条对应：
 *   Bₜ / Sₜ：主动买入 / 卖出成交金额（USDT；Sₜ = 成交额 − Bₜ），禁止用币数代替；
 *   Nₜ = |Bₜ − Sₜ|                                  主动净资金绝对值
 *   Fₜ = ln(1 + Nₜ ÷ (EMA(Bₜ + Sₜ) + ε))             资金力量
 *   Aₜ = (Bₜ − Sₜ) ÷ (Bₜ + Sₜ + ε)                   主动买方优势，−1 ~ 1
 *   Gₜ = 1 + α · max(Aₜ, 0)                          买方优势权重，α 默认 1
 *   Rₜ = ln(Cₜ ÷ Cₜ₋₁)                               价格变化（有正负）
 *   Uₜ = Fₜ × Gₜ × Rₜ                                单周期共识推动力
 *   Vₜ = ρ·Vₜ₋₁ + (1 − ρ)·Uₜ，ρ = 2^(−周期 ÷ h)      谢林点迁移速度，h 默认 6 小时（5 分钟线 ρ = 2^(−5/360)）
 *   DSPₜ = DSPₜ₋₁ × e^(κ·Vₜ)，DSP₀ = C₀               动态谢林点价格，κ 默认 1
 *
 * 规格里没写死、这里取定的三处（都在 DSP_SPEC_NOTES 里写给界面）：
 *   - EMA(Bₜ + Sₜ) 用同一个 ρ（同一个半衰期），首根取当根成交额，含当根；
 *   - 周期不是 5 分钟时，ρ 按实际周期换算，保持「半衰期 = h 小时」不变；
 *   - 某根缺成交额 / 主动买入额：不拿币数凑，Aₜ 记为空、Fₜ = 0（这一根不推动共识），Vₜ 照常衰减。
 * 纯函数，不读网络。
 */

export const DSP_DEFAULTS = { halfLifeHours: 6, alpha: 1, kappa: 1, epsilon: 1e-9 } as const;
export type DspParams = { halfLifeHours: number; alpha: number; kappa: number; epsilon: number };

export interface DspBar {
  /** 开盘时间（毫秒）。 */
  time: number;
  close: number;
  /** 成交额（USDT）：Bₜ + Sₜ。 */
  quoteVolume?: number | null;
  /** 主动买入成交额（USDT）：Bₜ。 */
  takerBuyQuoteVolume?: number | null;
}

export interface DspPoint {
  dsp: number | null;
  /** 谢林点迁移速度（对数 / 根）。 */
  v: number | null;
  /** 主动买方优势；这一根缺成交额时为 null。 */
  a: number | null;
  /** 中间量，便于核对与测试。 */
  f: number;
  g: number;
  r: number;
  u: number;
}

export const DSP_SPEC_NOTES = [
  'EMA(Bₜ + Sₜ) 与 Vₜ 用同一个半衰期，首根取当根成交额',
  '非 5 分钟周期：ρ 按实际周期换算，半衰期仍是 h 小时',
  '缺成交额或主动买入额的 K 线：不用币数代替，这一根不推动共识（Fₜ = 0），A 留空',
  'DSP₀ 取图上最早一根的收盘价：图表往左加载更早的 K 线时，整条曲线会按新的起点重算',
];

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 相邻开盘时间差的中位数：推断 K 线周期（毫秒）。 */
export function inferIntervalMs(bars: readonly { time: number }[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < bars.length && gaps.length < 64; i++) {
    const d = bars[i].time - bars[i - 1].time;
    if (d > 0) gaps.push(d);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

export function dspDecay(intervalMs: number, halfLifeHours: number): number {
  return 2 ** (-intervalMs / (halfLifeHours * 3_600_000));
}

export function computeDsp(bars: readonly DspBar[], params: Partial<DspParams> = {}, intervalMs?: number): DspPoint[] {
  const { halfLifeHours, alpha, kappa, epsilon } = { ...DSP_DEFAULTS, ...params };
  const out: DspPoint[] = [];
  if (bars.length === 0 || !(halfLifeHours > 0)) return out;
  const interval = intervalMs ?? inferIntervalMs(bars) ?? 5 * 60_000;
  const rho = dspDecay(interval, halfLifeHours);
  let emaQ: number | null = null;
  let v = 0;
  let dsp: number | null = null;
  let prevClose: number | null = null;
  for (const bar of bars) {
    const close = finite(bar.close) && bar.close > 0 ? bar.close : null;
    const q = bar.quoteVolume;
    const b = bar.takerBuyQuoteVolume;
    const hasAmounts = finite(q) && q >= 0 && finite(b) && b >= 0;
    let f = 0;
    let a: number | null = null;
    if (hasAmounts) {
      const buy = Math.min(b, q);
      const sell = q - buy;
      emaQ = emaQ == null ? q : rho * emaQ + (1 - rho) * q;
      const n = Math.abs(buy - sell);
      f = Math.log(1 + n / (emaQ + epsilon));
      a = (buy - sell) / (q + epsilon);
    }
    const g = 1 + alpha * Math.max(a ?? 0, 0);
    const r = close != null && prevClose != null ? Math.log(close / prevClose) : 0;
    const u = f * g * r;
    v = rho * v + (1 - rho) * u;
    if (dsp == null) dsp = close;
    else dsp *= Math.exp(kappa * v);
    if (close != null) prevClose = close;
    out.push({ dsp, v: dsp == null ? null : v, a, f, g, r, u });
  }
  return out;
}

/** V 的显示单位：基点 / 根（× 10⁴），只换单位不改数值。 */
export const DSP_V_DISPLAY_SCALE = 1e4;

/**
 * 「谢林点迁移速度 V」的说明文字：指标面板这一项的下方、图上 DSP 小标签的悬停提示共用。
 * 【用户要求】2026-10-16「定义、计算过程……要在旁边的说明那里注明」。
 */
export const DSP_V_DEFINITION = '谢林点迁移速度 V：共识价每根 K 线往上（+）或往下（−）移动多少，是近 h 小时里「净资金力量 × 买方优势权重 × 涨跌幅」的指数加权平均；副图单位 基点 / 根。';
export const DSP_V_STEPS = [
  '谢林点迁移速度 V 的计算（每根 K 线一次，成交量一律用成交金额 USDT）：',
  '① 主动净资金 Nₜ = |Bₜ − Sₜ|（B / S = 主动买入 / 卖出成交额）',
  '② 资金力量 Fₜ = ln(1 + Nₜ ÷ EMA(Bₜ + Sₜ))：这根的净资金比平时的成交额异常多少',
  '③ 买方优势 Aₜ = (Bₜ − Sₜ) ÷ (Bₜ + Sₜ)，权重 Gₜ = 1 + max(Aₜ, 0)：买方占优时加权，卖方占优时不加不减',
  '④ 价格变化 Rₜ = ln(Cₜ ÷ Cₜ₋₁)，有正负',
  '⑤ 单根推动力 Uₜ = Fₜ × Gₜ × Rₜ',
  '⑥ 迁移速度 Vₜ = ρ·Vₜ₋₁ + (1 − ρ)·Uₜ，ρ = 2^(−周期 ÷ h)；5 分钟线、h = 6 小时时 ρ ≈ 0.9904，每根新推动占约 0.96%',
  '⑦ 动态谢林点 DSPₜ = DSPₜ₋₁ × e^(Vₜ)：V 就是 DSP 每根 K 线的对数变化',
  '读法：V > 0 共识价上移、V < 0 下移，|V| 越大移得越快；副图按 基点 / 根 显示（× 10⁴），1 基点 / 根 ≈ 每小时 0.12%。',
  '例：B = 60 万、S = 40 万、EMA(B + S) = 80 万、收盘从 1.000 到 1.010、上一根 V = 2 基点 → F = 0.223、A = 0.2、G = 1.2、R = 0.995%、U = 26.6 基点、V = 2.24 基点 / 根。',
].join('\n');
