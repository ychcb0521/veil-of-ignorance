/**
 * Deep RSA · 第 3 步：48h 观察窗上的 15 个特征（价格 / 订单流代理 / 谢林候选三类表征）。
 *
 * 规则：
 * - 只用 [t₀ − 48h, t₀) 内已收盘的 5m K 线（extractWindow 已保证）。
 * - 带 _w 的特征用指数衰减权重 w_i（见 window.ts），对参与求和的子集重新归一；
 *   半衰期 h ∈ {2, 6, 12} 小时在训练 / 验证集里选定后冻结。
 * - 算不出来就是 null（例如没有下跌 K 线、缺主动买入量），绝不补 0。
 * - 收益只在相邻 5m K 线之间算；中间缺 K 线时跨缺口的那一段不算。
 * - 订单流特征是「K 线级主动买入量代理」，不是逐笔成交 / 盘口；谢林特征是「候选代理」，
 *   未经你确认前不当作真实均衡。
 *
 * 每个特征的公式写在 FEATURE_DEFINITIONS 里，与实现一一对应（测试逐条核对）。
 */
import { BAR_MS, decayWeights, type ObservationWindow, type ResearchBar } from '@/lib/deepRsa/window';

export type FeatureFamily = 'price' | 'orderFlow' | 'schelling';

export type FeatureKey =
  | 'ret_w' | 'vol_w' | 'trend_r2_w' | 'range_pos' | 'drawdown_high' | 'compression_w' | 'lower_wick_w'
  | 'taker_imb_w' | 'taker_imb_shift_w' | 'absorb_down_w' | 'vol_surge_w' | 'updown_vol_w'
  | 'vwap12_dev' | 'poc_dev_w' | 'fallback_dev';

export interface FeatureDefinition {
  key: FeatureKey;
  family: FeatureFamily;
  label: string;
  formula: string;
  /** 是否使用衰减权重（随 h 变化）。 */
  weighted: boolean;
  /** 需要主动买入量列。 */
  needsTaker: boolean;
  /** 候选代理，需用户确认。 */
  candidate: boolean;
}

export const FEATURE_DEFINITIONS: readonly FeatureDefinition[] = [
  { key: 'ret_w', family: 'price', label: '加权平均对数收益', formula: 'Σ w_i r_i，r_i = ln(C_i / C_{i−1})（仅相邻 K 线）', weighted: true, needsTaker: false, candidate: false },
  { key: 'vol_w', family: 'price', label: '加权波动率', formula: '√Σ w_i (r_i − ret_w)²', weighted: true, needsTaker: false, candidate: false },
  { key: 'trend_r2_w', family: 'price', label: '加权趋势线性度（带符号 R²）', formula: 'ln C_i 对时间做加权线性回归，sign(斜率) × R²', weighted: true, needsTaker: false, candidate: false },
  { key: 'range_pos', family: 'price', label: '48h 区间位置', formula: '(C_N − min L) / (max H − min L)；区间为 0 时 null', weighted: false, needsTaker: false, candidate: false },
  { key: 'drawdown_high', family: 'price', label: '距 48h 高点', formula: 'ln(C_N / max H)（≤ 0）', weighted: false, needsTaker: false, candidate: false },
  { key: 'compression_w', family: 'price', label: '波动收缩', formula: 'ln(Σ w_i tr_i / mean tr_i)，tr_i = (max(H_i, C_{i−1}) − min(L_i, C_{i−1})) / C_{i−1}', weighted: true, needsTaker: false, candidate: false },
  { key: 'lower_wick_w', family: 'price', label: '加权下影线占比', formula: 'Σ w_i (min(O_i, C_i) − L_i) / (H_i − L_i)（仅 H > L 的 K 线）', weighted: true, needsTaker: false, candidate: false },
  { key: 'taker_imb_w', family: 'orderFlow', label: '加权主动买卖失衡', formula: 'Σ w_i (2·TB_i − V_i) / Σ w_i V_i，∈ [−1, 1]', weighted: true, needsTaker: true, candidate: false },
  { key: 'taker_imb_shift_w', family: 'orderFlow', label: '失衡的近期偏移', formula: 'taker_imb_w − Σ (2·TB_i − V_i) / Σ V_i（近期相对整窗）', weighted: true, needsTaker: true, candidate: false },
  { key: 'absorb_down_w', family: 'orderFlow', label: '下跌 K 线的买方吸收', formula: '仅 C_i < O_i：Σ w_i TB_i / Σ w_i V_i − 0.5', weighted: true, needsTaker: true, candidate: false },
  { key: 'vol_surge_w', family: 'orderFlow', label: '成交量放大', formula: 'ln(Σ w_i V_i / mean V_i)', weighted: true, needsTaker: false, candidate: false },
  { key: 'updown_vol_w', family: 'orderFlow', label: '涨跌 K 线量比', formula: 'ln(Σ_{C>O} w_i V_i / Σ_{C<O} w_i V_i)；任一侧为 0 时 null', weighted: true, needsTaker: false, candidate: false },
  { key: 'vwap12_dev', family: 'schelling', label: '偏离 12h 滚动 VWAP（候选 a）', formula: 'ln(C_N / VWAP)，VWAP = Σ V_i·TP_i / Σ V_i，TP = (H + L + C) / 3，取最后 144 根', weighted: false, needsTaker: false, candidate: true },
  { key: 'poc_dev_w', family: 'schelling', label: '偏离成交密集区 POC（候选 b）', formula: 'ln(C_N / POC)，每根 w_i V_i 均摊到 [L_i, H_i] 的 48 个价格档，POC = 量最大档的中点', weighted: true, needsTaker: false, candidate: true },
  { key: 'fallback_dev', family: 'schelling', label: '偏离人工兜底价（候选 c）', formula: 'ln(C_N / 兜底价)；仅信号库来源且有数值时', weighted: false, needsTaker: false, candidate: true },
];

export type FeatureVector = Record<FeatureKey, number | null>;

export const VWAP_BARS = 144;
export const POC_BINS = 48;

const finiteOrNull = (v: number): number | null => (Number.isFinite(v) ? v : null);

/** Σ w·x / Σ w over the provided pairs（子集重新归一）；没有正权重时 null。 */
function weightedMean(pairs: readonly [number, number][]): number | null {
  let sw = 0;
  let sx = 0;
  for (const [w, x] of pairs) { sw += w; sx += w * x; }
  return sw > 0 ? finiteOrNull(sx / sw) : null;
}

function mean(xs: readonly number[]): number | null {
  return xs.length ? finiteOrNull(xs.reduce((s, v) => s + v, 0) / xs.length) : null;
}

interface Step { w: number; r: number; tr: number; }

/** 相邻 K 线的收益与真实波幅（跨缺口不算）。 */
function adjacentSteps(bars: readonly ResearchBar[], w: readonly number[]): Step[] {
  const steps: Step[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1];
    const cur = bars[i];
    if (cur.openTime - prev.openTime !== BAR_MS) continue;
    steps.push({
      w: w[i],
      r: Math.log(cur.close / prev.close),
      tr: (Math.max(cur.high, prev.close) - Math.min(cur.low, prev.close)) / prev.close,
    });
  }
  return steps;
}

function signedWeightedR2(bars: readonly ResearchBar[], w: readonly number[]): number | null {
  if (bars.length < 3) return null;
  const sw = w.reduce((s, v) => s + v, 0);
  if (!(sw > 0)) return null;
  const xs = bars.map(b => (b.openTime - bars[0].openTime) / BAR_MS);
  const ys = bars.map(b => Math.log(b.close));
  const mx = xs.reduce((s, x, i) => s + w[i] * x, 0) / sw;
  const my = ys.reduce((s, y, i) => s + w[i] * y, 0) / sw;
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += w[i] * (xs[i] - mx) * (ys[i] - my);
    sxx += w[i] * (xs[i] - mx) ** 2;
    syy += w[i] * (ys[i] - my) ** 2;
  }
  if (!(sxx > 0)) return null;
  if (!(syy > 0)) return 0;
  return finiteOrNull(Math.sign(sxy) * (sxy * sxy) / (sxx * syy));
}

/** 成交密集区 POC：每根 K 线的 wᵢVᵢ 按 [L, H] 与各档的重叠长度均摊到 48 个价格档，取量最大那一档的中点。 */
export function weightedPoc(bars: readonly ResearchBar[], w: readonly number[]): number | null {
  const lo = Math.min(...bars.map(b => b.low));
  const hi = Math.max(...bars.map(b => b.high));
  if (!(hi > lo)) return null;
  const width = (hi - lo) / POC_BINS;
  const hist = new Array<number>(POC_BINS).fill(0);
  bars.forEach((bar, i) => {
    const mass = w[i] * bar.volume;
    if (!(mass > 0)) return;
    if (!(bar.high > bar.low)) {
      hist[Math.min(POC_BINS - 1, Math.floor((bar.close - lo) / width))] += mass;
      return;
    }
    // 按 [L, H] 与各档的重叠长度均摊
    const first = Math.max(0, Math.floor((bar.low - lo) / width));
    const last = Math.min(POC_BINS - 1, Math.floor((bar.high - lo) / width));
    for (let k = first; k <= last; k++) {
      const overlap = Math.min(bar.high, lo + (k + 1) * width) - Math.max(bar.low, lo + k * width);
      if (overlap > 0) hist[k] += mass * overlap / (bar.high - bar.low);
    }
  });
  let best = -1;
  let bestMass = 0;
  hist.forEach((m, k) => { if (m > bestMass) { bestMass = m; best = k; } });
  return best >= 0 ? lo + (best + 0.5) * width : null;
}

/** t₀ 前 12 小时（最后 144 根 5m K 线）的成交量加权均价，典型价 TP = (H + L + C) ÷ 3；没有成交量时 null。 */
export function rollingVwap(bars: readonly ResearchBar[], anchorMs: number): number | null {
  let pv = 0; let v = 0;
  for (const b of bars) {
    if (b.openTime < anchorMs - VWAP_BARS * BAR_MS) continue;
    pv += b.volume * (b.high + b.low + b.close) / 3; v += b.volume;
  }
  return v > 0 ? pv / v : null;
}

export interface FeatureOptions {
  halfLifeHours: number;
  /** 信号库人工兜底价（候选 c）；没有就不传。 */
  fallbackPrice?: number | null;
}

/** 只算加权波动率 vol_w（与 computeFeatures 的 vol_w 同一算法）：Deep dig 只用这一项，不必把整套表征都算一遍。 */
export function weightedVolatility(window: ObservationWindow, halfLifeHours: number): number | null {
  const bars = window.bars;
  if (bars.length === 0) return null;
  const steps = adjacentSteps(bars, decayWeights(bars, window.anchorMs, halfLifeHours));
  const ret = weightedMean(steps.map(s => [s.w, s.r]));
  if (ret == null) return null;
  const variance = weightedMean(steps.map(s => [s.w, (s.r - ret) ** 2]));
  return variance != null ? Math.sqrt(variance) : null;
}

export function computeFeatures(window: ObservationWindow, options: FeatureOptions): FeatureVector {
  const bars = window.bars;
  const empty = Object.fromEntries(FEATURE_DEFINITIONS.map(d => [d.key, null])) as FeatureVector;
  if (bars.length === 0) return empty;
  const w = decayWeights(bars, window.anchorMs, options.halfLifeHours);
  const last = bars[bars.length - 1];
  const out: FeatureVector = { ...empty };

  // ── 价格表征 ──
  const steps = adjacentSteps(bars, w);
  out.ret_w = weightedMean(steps.map(s => [s.w, s.r]));
  if (out.ret_w != null) {
    const variance = weightedMean(steps.map(s => [s.w, (s.r - out.ret_w!) ** 2]));
    out.vol_w = variance != null ? Math.sqrt(variance) : null;
  }
  out.trend_r2_w = signedWeightedR2(bars, w);
  const maxH = Math.max(...bars.map(b => b.high));
  const minL = Math.min(...bars.map(b => b.low));
  out.range_pos = maxH > minL ? (last.close - minL) / (maxH - minL) : null;
  out.drawdown_high = finiteOrNull(Math.log(last.close / maxH));
  const trW = weightedMean(steps.map(s => [s.w, s.tr]));
  const trMean = mean(steps.map(s => s.tr));
  out.compression_w = trW != null && trMean != null && trW > 0 && trMean > 0 ? Math.log(trW / trMean) : null;
  out.lower_wick_w = weightedMean(bars.flatMap((b, i) => (b.high > b.low
    ? [[w[i], (Math.min(b.open, b.close) - b.low) / (b.high - b.low)] as [number, number]] : [])));

  // ── 订单流表征（K 线级主动买入量代理）──
  // 任一根缺主动买入量就整组不算：缺失的那几根偏偏可能是关键几根，不能悄悄跳过
  const takerComplete = bars.every(b => b.takerBuyVolume != null);
  if (takerComplete) {
    let wImb = 0; let wVol = 0; let imb = 0; let vol = 0; let wTbDown = 0; let wVolDown = 0;
    bars.forEach((b, i) => {
      const tb = b.takerBuyVolume!;
      wImb += w[i] * (2 * tb - b.volume); wVol += w[i] * b.volume;
      imb += 2 * tb - b.volume; vol += b.volume;
      if (b.close < b.open) { wTbDown += w[i] * tb; wVolDown += w[i] * b.volume; }
    });
    out.taker_imb_w = wVol > 0 ? wImb / wVol : null;
    out.taker_imb_shift_w = out.taker_imb_w != null && vol > 0 ? out.taker_imb_w - imb / vol : null;
    out.absorb_down_w = wVolDown > 0 ? wTbDown / wVolDown - 0.5 : null;
  }
  const volW = bars.reduce((s, b, i) => s + w[i] * b.volume, 0);
  const volMean = mean(bars.map(b => b.volume));
  out.vol_surge_w = volMean != null && volW > 0 && volMean > 0 ? Math.log(volW / volMean) : null;
  let up = 0; let down = 0;
  bars.forEach((b, i) => {
    if (b.close > b.open) up += w[i] * b.volume;
    else if (b.close < b.open) down += w[i] * b.volume;
  });
  out.updown_vol_w = up > 0 && down > 0 ? Math.log(up / down) : null;

  // ── 谢林表征（候选代理，待确认）──
  const vwap = rollingVwap(bars, window.anchorMs);
  out.vwap12_dev = vwap != null && vwap > 0 ? finiteOrNull(Math.log(last.close / vwap)) : null;
  const poc = weightedPoc(bars, w);
  out.poc_dev_w = poc != null && poc > 0 ? finiteOrNull(Math.log(last.close / poc)) : null;
  const fb = options.fallbackPrice;
  out.fallback_dev = fb != null && Number.isFinite(fb) && fb > 0 ? Math.log(last.close / fb) : null;

  return out;
}
