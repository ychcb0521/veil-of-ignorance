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
 *   Vₜ = ρ·Vₜ₋₁ + (1 − ρ)·Uₜ，ρ = 2^(−周期 ÷ h)      买方推力的加速度，h 默认 6 小时（5 分钟线 ρ = 2^(−5/360)；图表上按周期等比例缩放 h，见下）
 *   DSPₜ = DSPₜ₋₁ × e^(κ·Vₜ)，DSP₀ = C₀               动态谢林点价格，κ 默认 1
 *
 * 规格里没写死、这里取定的三处（都在 DSP_SPEC_NOTES 里写给界面）：
 *   - EMA(Bₜ + Sₜ) 用同一个 ρ（同一个半衰期），首根取当根成交额，含当根；
 *   - 【用户要求】2026-10-16 记忆长度随周期等比例缩放、以 5 分钟为准：图表上的 h 是「5 分钟图上的半衰期」，
 *     其他周期的半衰期 = h × 周期 ÷ 5 分钟（dspHalfLifeForInterval），于是每根 K 线的 ρ 在所有周期上相同；
 *     computeDsp 本身仍按传入的小时数算（Deep dig 用 5 分钟数据，不受影响）；
 *   - 某根缺成交额 / 主动买入额：不拿币数凑，Aₜ 记为空、Fₜ = 0（这一根不推动共识），Vₜ 照常衰减。
 *
 * 【用户要求】2026-10-18「把 DSP 也做成可以基于 Z 分数的，具体哪一步需要标准化处理，你来定」——Z 分数版 aᶻ（computeDsp 传 zWindowHours 时另算一条）：
 *   Rᶻₜ = Rₜ ÷ σ(R，过去 24 小时)          只把价格变化换成「几个标准差」：fₜ 本来就是和自己的平均成交额比、Aₜ 本来就在 −1 ~ 1，
 *                                          只有 Rₜ 带着各个币自己的波动大小（波动大的币 a 天然大），所以只标准化这一步；
 *                                          均值按 0、不减滚动均值——减掉会把要测的趋势本身减掉（持续上涨时 Rᶻ 被拉回 0）；
 *                                          也不对 a 本身做 z-score——那样 0 不再是「多空平衡」，而是「和过去 24 小时一样」。
 *   aᶻₜ = ρ·aᶻₜ₋₁ + (1 − ρ)·fₜ·Gₜ·Rᶻₜ        同一个 ρ（同一个半衰期）；单位：标准差 / 根，副图 × 100 显示。
 *   σ 用含当根的样本标准差，空值跳过；不满 2 根、或 σ = 0 时这一根 Rᶻ 记 0。主图 DSP 线仍用原始 a（它是价格，不能用标准差单位）。
 * 纯函数，不读网络。
 */
import { barsForHours, rollingSd } from '@/lib/deepDig/formula';

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
  /** 买方推力的加速度（对数 / 根）。 */
  v: number | null;
  /** 主动买方优势；这一根缺成交额时为 null。 */
  a: number | null;
  /** Z 分数版的买方推力的加速度（标准差 / 根）；没传 zWindowHours 时不算（undefined）。 */
  vz?: number | null;
  /** 中间量，便于核对与测试。 */
  f: number;
  g: number;
  r: number;
  u: number;
}

export const DSP_SPEC_NOTES = [
  'EMA(Bₜ + Sₜ) 与 Vₜ 用同一个半衰期，首根取当根成交额',
  '记忆长度以 5 分钟图为准、随周期等比例缩放：半衰期 = h × 周期 ÷ 5 分钟（15 分钟图 ×3、1 小时图 ×12），每根 K 线的权重在所有周期上相同',
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

/** 记忆长度的基准周期：5 分钟。 */
export const DSP_BASE_INTERVAL_MS = 5 * 60_000;

/**
 * 【用户要求】不同周期的记忆长度等比例缩放、以 5 分钟为准：h 是 5 分钟图上的半衰期（小时），
 * 这个周期上的半衰期 = h × 周期 ÷ 5 分钟。例：h = 6 → 15 分钟图 18 小时、1 小时图 72 小时、1 分钟图 1.2 小时。
 */
export function dspHalfLifeForInterval(halfLifeHoursAt5m: number, intervalMs: number): number {
  return halfLifeHoursAt5m * (intervalMs / DSP_BASE_INTERVAL_MS);
}

export function dspDecay(intervalMs: number, halfLifeHours: number): number {
  return 2 ** (-intervalMs / (halfLifeHours * 3_600_000));
}

export function computeDsp(bars: readonly DspBar[], params: Partial<DspParams> & { zWindowHours?: number } = {}, intervalMs?: number): DspPoint[] {
  const { halfLifeHours, alpha, kappa, epsilon } = { ...DSP_DEFAULTS, ...params };
  const out: DspPoint[] = [];
  if (bars.length === 0 || !(halfLifeHours > 0)) return out;
  const interval = intervalMs ?? inferIntervalMs(bars) ?? 5 * 60_000;
  const rho = dspDecay(interval, halfLifeHours);
  // Z 分数版：先把每根的 Rₜ 排成一列，按过去 zWindowHours 小时算滚动标准差
  const zHours = params.zWindowHours;
  let sdR: Float64Array | null = null;
  let rs: Float64Array | null = null;
  if (zHours != null && zHours > 0) {
    rs = new Float64Array(bars.length);
    let pc: number | null = null;
    bars.forEach((bar, i) => {
      const c = finite(bar.close) && bar.close > 0 ? bar.close : null;
      rs![i] = c != null && pc != null ? Math.log(c / pc) : Number.NaN;
      if (c != null) pc = c;
    });
    sdR = rollingSd(rs, barsForHours(zHours, interval / 60_000));
  }
  let vz = 0;
  let i = -1;
  let emaQ: number | null = null;
  let v = 0;
  let dsp: number | null = null;
  let prevClose: number | null = null;
  for (const bar of bars) {
    i++;
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
    let zOut: number | null | undefined;
    if (sdR && rs) {
      const sd = sdR[i];
      const rz = Number.isFinite(rs[i]) && sd > 0 ? rs[i] / sd : 0;
      vz = rho * vz + (1 - rho) * f * g * rz;
      zOut = vz;
    }
    if (dsp == null) dsp = close;
    else dsp *= Math.exp(kappa * v);
    if (close != null) prevClose = close;
    out.push({ dsp, v: dsp == null ? null : v, ...(zOut === undefined ? {} : { vz: dsp == null ? null : zOut }), a, f, g, r, u });
  }
  return out;
}

/** V 的显示单位：基点 / 根（× 10⁴），只换单位不改数值。 */
export const DSP_V_DISPLAY_SCALE = 1e4;
/** Z 分数版 aᶻ 的显示单位：% 标准差 / 根（× 100）。 */
export const DSP_VZ_DISPLAY_SCALE = 100;
/** Z 分数版里 σ 的窗口：过去 24 小时（按 5 分钟图计，其他周期等比例缩放）。 */
export const DSP_Z_WINDOW_HOURS = 24;
export const DSP_VZ_DEFINITION = 'Z 分数版 az：把每根的涨跌 R 先除以它过去 24 小时的标准差（几个 σ），再按同样的「净资金力量 × 买方优势权重」加权、同一个半衰期平滑。不同币的波动大小不再左右读数，可以横向比较；0 仍是多空平衡。副图单位 % 标准差 / 根（× 100）。';

/**
 * 「买方推力的加速度 a」的说明文字：指标面板这一项的下方、图上 DSP 小标签的悬停提示共用。
 * 【用户要求】2026-10-16「定义、计算过程……要在旁边的说明那里注明」。
 */
export const DSP_V_DEFINITION = '买方推力的加速度 a：共识价每根 K 线往上（+）或往下（−）移动多少，是近期（5 分钟图上半衰期 h 小时，其他周期按比例缩放）「净资金力量 × 买方优势权重 × 涨跌幅」的指数加权平均；副图单位 基点 / 根。';
export const DSP_V_STEPS = [
  '买方推力的加速度 a 的计算（每根 K 线一次，成交量一律用成交金额 USDT）：',
  '① 主动净资金 Nₜ = |Bₜ − Sₜ|（B / S = 主动买入 / 卖出成交额）',
  '② 资金力量 fₜ = ln(1 + Nₜ ÷ EMA(Bₜ + Sₜ))：这根的净资金比平时的成交额异常多少',
  '③ 买方优势 Aₜ = (Bₜ − Sₜ) ÷ (Bₜ + Sₜ)，权重 Gₜ = 1 + max(Aₜ, 0)：买方占优时加权，卖方占优时不加不减',
  '④ 价格变化 Rₜ = ln(Cₜ ÷ Cₜ₋₁)，有正负',
  '⑤ 单根推力 Fₜ = fₜ × Gₜ × Rₜ',
  '⑥ 买方推力的加速度 aₜ = ρ·aₜ₋₁ + (1 − ρ)·Fₜ，ρ = 2^(−5 分钟 ÷ h)：h 按 5 分钟图计，其他周期的记忆时间等比例缩放（h = 6 时 5 分钟图 6 小时、15 分钟图 18 小时、1 小时图 72 小时），每根 K 线都是 ρ ≈ 0.9904、新推动占约 0.96%，半衰期都是 72 根',
  '⑦ 动态谢林点 DSPₜ = DSPₜ₋₁ × e^(aₜ)：a 就是 DSP 每根 K 线的对数变化',
  '读法：a > 0 共识价上移、a < 0 下移，|a| 越大移得越快；副图按 基点 / 根 显示（× 10⁴），5 分钟图上 1 基点 / 根 ≈ 每小时 0.12%。',
  '例：B = 60 万、S = 40 万、EMA(B + S) = 80 万、收盘从 1.000 到 1.010、上一根 a = 2 基点 → f = 0.223、A = 0.2、G = 1.2、R = 0.995%、F = 26.6 基点、a = 2.24 基点 / 根。',
].join('\n');
