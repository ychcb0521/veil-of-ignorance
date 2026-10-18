/**
 * BSS 买卖强度综合分（cis：价格事实、订单簿、成交明细）。
 *
 * 【用户要求】2026-10-18 按用户笔记新增，分量都是「当下可观察的事实」，不含对未来的预测：
 *   M 价格动量    = (Pₜ − Pₜ₋ₙ) ÷ Pₜ₋ₙ                       近 n 的涨跌幅
 *   V 相对成交量  = 近 n 的平均成交额 ÷ 窗口的平均成交额        > 1 = 有资金在参与
 *   A 成交攻击性  = (主动买 − 主动卖) ÷ (主动买 + 主动卖)，近 n   −1 ~ 1
 *   板不平衡 I 要订单簿：币安只有「此刻」的订单簿、没有历史，回放 / 历史 K 线 / Deep dig 都算不出，去掉。
 *   【用户要求】去掉 I 后的权重（原 γ = 0.25 分给其余三项，价格事实优先级最高）：
 *   BSS = 0.45·M标准化 + 0.25·V标准化 + 0.30·A，BSS ∈ [−1, 1]。
 *   【用户要求】2026-10-18「放量随价格方向加减分」：V 那一项乘上价格方向 sign(M)——
 *   涨（M > 0）时放量加分、缩量扣分；跌（M < 0）时放量扣分、缩量加分（成交量确认价格方向）；近 n 小时没涨没跌（M = 0）时这一项为 0。
 *   于是 BSS = 0.45·M标准化 + 0.25·sign(M)·V标准化 + 0.30·A，仍在 −1 ~ 1。
 *
 * 取定的几处：
 *   - 标准化 = tanh(滚动 z-score)：z-score 本身没有上下限，套一层 tanh 压到 −1 ~ 1，才有「BSS ∈ [−1, 1]」
 *     （A 本来就在 −1 ~ 1，三个权重合计 1）；
 *   - A 用 K 线自带的主动买入成交额（USDT）：主动卖 = 成交额 − 主动买；
 *   - 窗口按时长：近 n = recentHours（默认 1 小时），标准化窗口 = normHours（默认 24 小时），按 K 线周期换算根数；
 *     空值跳过，开头不满窗口用已有的（与 Deep dig 公式的 avg / ago / zscore 同一份实现，单元测试核对逐根一致）。
 * 阈值（与 cis 原则对齐，需自行验证）：BSS > 0.55 且 M > 0 买方优势明确、顺势持有；从高位明显回落到 < 0.2 或 A 转负 = 弱了，撤出；
 * |BSS| 持续低位或方向与价格矛盾 = 不交易。
 * 纯函数，不读网络。
 */
import { barsForHours, rollingMean, rollingZScore, shiftBars } from '@/lib/deepDig/formula';

/** 【用户要求】去掉 I 后的权重（合计 1）。 */
export const BSS_WEIGHTS = { alpha: 0.45, beta: 0.25, delta: 0.3 } as const;
export const BSS_DEFAULTS = { recentHours: 1, normHours: 24 } as const;
/** BSS > 0.55（且 M > 0）买方优势明确。 */
export const BSS_STRONG = 0.55;
/** 从高位回落到 0.2 以下 = 弱了。 */
export const BSS_WEAK = 0.2;

export const BSS_DEFINITION = 'BSS 买卖强度综合分（−1 ~ 1）：价格动量 M、相对成交量 V（滚动标准化，随价格方向加减分：涨时放量加分、跌时放量扣分）与成交攻击性 A 的加权和。> 0.55 且 M > 0 买方优势明确；从高位回落到 < 0.2 或 A 转负 = 弱了（阈值需自行验证）。订单簿没有历史，板不平衡 I 去掉。';
export const BSS_STEPS = [
  'M = (Pₜ − Pₜ₋ₙ) ÷ Pₜ₋ₙ：近 n 小时涨跌幅',
  'V = 近 n 小时平均成交额 ÷ 近 24 小时平均成交额',
  'A = (主动买 − 主动卖) ÷ (主动买 + 主动卖)：近 n 小时，成交额（USDT）',
  'M、V 标准化 = tanh(24 小时滚动 z-score)，落在 −1 ~ 1',
  'V 随价格方向加减分 = sign(M) × V标准化：涨时放量加分、缩量扣分；跌时放量扣分、缩量加分',
  'BSS = 0.45·M标准化 + 0.25·sign(M)·V标准化 + 0.30·A，−1 ~ 1（订单簿 I 没有历史，去掉）',
  '> 0.55 且 M > 0：买方优势明确；回落到 < 0.2 或 A 转负：弱了',
  '下方单独一个副图 avg_BSS = avg(BSS, N)：过去 N 小时 BSS 的平均，N 默认 24、在「avg」框里改',
].join('\n');

export interface BssBar {
  close: number;
  /** 成交额（USDT）；缺失为 null。 */
  quoteVolume?: number | null;
  /** 主动买入成交额（USDT）；缺失为 null。 */
  takerBuyQuoteVolume?: number | null;
}

export interface BssPoint {
  bss: number | null;
  m: number | null;
  v: number | null;
  a: number | null;
  /** M、V 的标准化值 = tanh(滚动 z-score)，−1 ~ 1。 */
  mz: number | null;
  vz: number | null;
  /** V 随价格方向加减分 = sign(M) × vz。 */
  vd: number | null;
}

const fin = (x: number) => (Number.isFinite(x) ? x : null);

/** 逐根算 BSS。barMinutes = K 线周期（分钟）。 */
export function computeBss(
  bars: readonly BssBar[],
  barMinutes: number,
  params: { recentHours?: number; normHours?: number } = {},
): BssPoint[] {
  const n = barsForHours(params.recentHours ?? BSS_DEFAULTS.recentHours, barMinutes);
  const w = barsForHours(params.normHours ?? BSS_DEFAULTS.normHours, barMinutes);
  const series = (f: (b: BssBar) => number | null | undefined) => Float64Array.from(bars, b => {
    const v = f(b);
    return v != null && Number.isFinite(v) ? v : Number.NaN;
  });
  const c = series(b => b.close);
  const q = series(b => b.quoteVolume);
  const buy = series(b => b.takerBuyQuoteVolume);
  const sell = q.map((v, i) => v - buy[i]);
  const prevC = shiftBars(c, n);
  const m = c.map((v, i) => v / prevC[i] - 1);
  const qRecent = rollingMean(q, n);
  const qWindow = rollingMean(q, w);
  const v = qRecent.map((x, i) => x / qWindow[i]);
  const bRecent = rollingMean(buy, n);
  const sRecent = rollingMean(sell, n);
  const a = bRecent.map((x, i) => (x - sRecent[i]) / qRecent[i]);
  const mz = rollingZScore(Float64Array.from(m, x => (Number.isFinite(x) ? x : Number.NaN)), w).map(Math.tanh);
  const vz = rollingZScore(Float64Array.from(v, x => (Number.isFinite(x) ? x : Number.NaN)), w).map(Math.tanh);
  return Array.from(bars, (_, i) => {
    // 【用户要求】放量随价格方向加减分
    const vd = Math.sign(m[i]) * vz[i];
    const score = BSS_WEIGHTS.alpha * mz[i] + BSS_WEIGHTS.beta * vd + BSS_WEIGHTS.delta * a[i];
    return { bss: fin(score), m: fin(m[i]), v: fin(v[i]), a: fin(a[i]), mz: fin(mz[i]), vz: fin(vz[i]), vd: fin(vd) };
  });
}
