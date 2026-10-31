/**
 * Deep RSA · 第 3 步：t₀ 之前 48 小时的 5m 观察窗与指数衰减权重。
 *
 * 只新增，不动应用现有的 K 线解析：应用里的解析器只取前 6 列，这里另写一个保留
 * 主动买入量（Binance K 线数组第 9、10 列）的研究用解析，供订单流代理特征使用。
 *
 * 防未来数据：一根 5m K 线只有在 openTime + 5m ≤ t₀（已收盘）时才进窗口；
 * 窗口下界含、上界不含：[t₀ − 48h, t₀)。
 */
import { WINDOW_MS } from '@/lib/deepRsa/grouping';

export const BAR_MS = 5 * 60_000;
/** t₀ 落在 5 分钟整点时，窗口恰好 576 根。 */
export const WINDOW_BARS = WINDOW_MS / BAR_MS;
/** 半衰期候选（小时）：在训练 / 验证集里选定后冻结，测试集不得再挑。 */
export const HALF_LIFE_CANDIDATES_H = [2, 6, 12] as const;
export type HalfLifeHours = (typeof HALF_LIFE_CANDIDATES_H)[number];

export interface ResearchBar {
  /** Exact exchange price increment, supplied only by ATI6H research adapter. */
  ATI6H_tick_size?:number|null;
  /** Strict native evidence amounts alongside the unchanged legacy normalized columns. */
  ATI6H_quoteVolume?:number|null; ATI6H_takerBuyQuoteVolume?:number|null;
  SBS5M_tick_size?:number|null; SBS5M_closed?:boolean;
  PRS6H_tick_size?:number|null; PRS6H_closed?:boolean; PRS6H_symbol?:string; PRS6H_data_source?:string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** 成交量（基础币）。 */
  volume: number;
  /** 主动买入成交量（基础币）；数据源没有这一列时为 null，绝不补 0。 */
  takerBuyVolume: number | null;
  /** 成交额（USDT，第 8 列）与主动买入成交额（USDT，第 11 列）：动态谢林点只用金额；缺失为 null / 不带。 */
  quoteVolume?: number | null;
  takerBuyQuoteVolume?: number | null;
  /** 同一根 K 线（同开盘时间）的对照币收盘价（Deep dig 公式里的 CB = BTCUSDT）；用到时流水线才另取、合进来，取不到为 null。 */
  refClose?: number | null;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * 解析一行 Binance K 线（REST 数组，或 data.binance.vision CSV 拆开后的同序字段）：
 * [openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBase, takerBuyQuote, ignore]
 * 任一 OHLCV 字段非法、high < low、价格 ≤ 0 → null（整根丢弃，留给覆盖率去体现）。
 */
export function parseBinanceKlineRow(row: readonly unknown[]): ResearchBar | null {
  if (!Array.isArray(row) || row.length < 6) return null;
  const bar = {
    openTime: num(row[0]), open: num(row[1]), high: num(row[2]), low: num(row[3]), close: num(row[4]), volume: num(row[5]),
  };
  if (Object.values(bar).some(v => !Number.isFinite(v))) return null;
  if (bar.open <= 0 || bar.close <= 0 || bar.low <= 0 || bar.high < bar.low || bar.volume < 0) return null;
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) return null;
  const tb = row.length > 9 ? num(row[9]) : Number.NaN;
  const qv = row.length > 7 ? num(row[7]) : Number.NaN;
  const tbq = row.length > 10 ? num(row[10]) : Number.NaN;
  const amountsOk = Number.isFinite(qv) && qv >= 0 && Number.isFinite(tbq) && tbq >= 0 && tbq <= qv * (1 + 1e-9);
  return {
    ...bar,
    takerBuyVolume: Number.isFinite(tb) && tb >= 0 && tb <= bar.volume * (1 + 1e-9) ? tb : null,
    quoteVolume: amountsOk ? qv : null,
    takerBuyQuoteVolume: amountsOk ? Math.min(tbq, qv) : null,
  };
}

export interface ObservationWindow {
  anchorMs: number;
  /** t₀ 是否落在 5 分钟整点（不整点时窗口最多 575 根完整 K 线）。 */
  aligned: boolean;
  /** 窗口内已收盘的 K 线，按 openTime 升序、去重。 */
  bars: ResearchBar[];
  expectedBars: number;
  missingBars: number;
  /** bars / expectedBars。 */
  coverage: number;
  /** 有多少根缺主动买入量。 */
  missingTakerBars: number;
}

/** 窗口里能完整容纳的 5m 槽位数。 */
export function expectedWindowBars(anchorMs: number, windowMs = WINDOW_MS, barMs = BAR_MS): number {
  const first = Math.ceil((anchorMs - windowMs) / barMs);
  const last = Math.floor(anchorMs / barMs) - 1;
  return Math.max(0, last - first + 1);
}

/**
 * 从任意一段 K 线里切出 [t₀ − 48h, t₀) 的已收盘 K 线。传入的 bars 可以包含 t₀ 之后的数据，
 * 这里一律丢掉——下游特征因此不可能看到未来。
 */
export function extractWindow(bars: readonly ResearchBar[], anchorMs: number, windowMs = WINDOW_MS, barMs = BAR_MS): ObservationWindow {
  const lower = anchorMs - windowMs;
  const byOpen = new Map<number, ResearchBar>();
  for (const bar of bars) {
    if (bar.openTime < lower || bar.openTime + barMs > anchorMs) continue;
    if (bar.openTime % barMs !== 0) continue;
    if (!byOpen.has(bar.openTime)) byOpen.set(bar.openTime, bar);
  }
  const inWindow = [...byOpen.values()].sort((a, b) => a.openTime - b.openTime);
  const expectedBars = expectedWindowBars(anchorMs, windowMs, barMs);
  return {
    anchorMs,
    aligned: anchorMs % barMs === 0,
    bars: inWindow,
    expectedBars,
    missingBars: expectedBars - inWindow.length,
    coverage: expectedBars > 0 ? inWindow.length / expectedBars : 0,
    missingTakerBars: inWindow.filter(b => b.takerBuyVolume == null).length,
  };
}

/**
 * w_i = 2^(−Δt_i / h) / Σ_j 2^(−Δt_j / h)，Δt_i = t₀ − (openTime_i + 5m)：
 * 从这根 K 线收盘到 t₀ 的时间。紧挨 t₀ 收盘的那根 Δt = 0，原始权重 1。
 */
export function decayWeights(bars: readonly ResearchBar[], anchorMs: number, halfLifeHours: number): number[] {
  if (!(halfLifeHours > 0)) throw new Error('halfLifeHours must be > 0');
  const hMs = halfLifeHours * 60 * 60_000;
  const raw = bars.map(bar => 2 ** (-(anchorMs - (bar.openTime + BAR_MS)) / hMs));
  const sum = raw.reduce((s, v) => s + v, 0);
  return sum > 0 ? raw.map(v => v / sum) : raw.map(() => 0);
}
