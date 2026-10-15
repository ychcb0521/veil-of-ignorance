/**
 * Deep RSA · 第 5 步：冻结模型、样本外打分、逐 5m 扫描、基线对照。纯离线，不自动实盘。
 *
 * 模型只在训练集上拟合：同一套标准化 + 正样本 / 对照组的表征中心。
 * 打分 = 到对照中心的距离 − 到正样本中心的距离（越大越像正样本）。
 * 阈值在验证集上按分位数定下后冻结；测试集只读一次。
 * 这是 RSA 通过之后的「应用」，不是 RSA 本身；打分不是盈利概率。
 */
import { computeFeatures } from '@/lib/deepRsa/features';
import { fitStandardizer, standardize, type Row, type Standardizer } from '@/lib/deepRsa/rsa';
import { simulateLongTrade, summarizeTrades, type CostModel, type ExitRule, type TradeResult, type TradeSummary } from '@/lib/deepRsa/backtest';
import { BAR_MS, expectedWindowBars, type ObservationWindow, type ResearchBar } from '@/lib/deepRsa/window';
import { WINDOW_MS } from '@/lib/deepRsa/grouping';

export interface CentroidModel {
  keys: string[];
  standardizer: Standardizer;
  halfLifeHours: number;
  positive: (number | null)[];
  control: (number | null)[];
  minDims: number;
  trainCounts: { positive: number; control: number };
}

function centroid(z: readonly (number | null)[][], dims: number): (number | null)[] {
  return Array.from({ length: dims }, (_, k) => {
    const xs = z.map(r => r[k]).filter((v): v is number => v != null);
    return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
  });
}

/** 任一组为空 → null（不拟合）。 */
export function fitCentroidModel(
  trainRows: readonly Row[], labels: readonly (string | null)[], keys: readonly string[], halfLifeHours: number, minDims = 2,
): CentroidModel | null {
  const idx = labels.map((l, i) => [l, i] as const).filter(([l]) => l === 'positive' || l === 'control');
  const rows = idx.map(([, i]) => trainRows[i]);
  const standardizer = fitStandardizer(rows, keys);
  const z = standardize(rows, standardizer);
  const pos = z.filter((_, k) => idx[k][0] === 'positive');
  const ctl = z.filter((_, k) => idx[k][0] === 'control');
  if (!pos.length || !ctl.length || !standardizer.keys.length) return null;
  return {
    keys: standardizer.keys, standardizer, halfLifeHours, minDims,
    positive: centroid(pos, standardizer.keys.length),
    control: centroid(ctl, standardizer.keys.length),
    trainCounts: { positive: pos.length, control: ctl.length },
  };
}

function scaledDistance(a: readonly (number | null)[], b: readonly (number | null)[], minDims: number): number | null {
  let ss = 0; let common = 0;
  for (let k = 0; k < a.length; k++) {
    if (a[k] == null || b[k] == null) continue;
    ss += (a[k]! - b[k]!) ** 2;
    common++;
  }
  return common >= Math.max(1, minDims) ? Math.sqrt((ss * a.length) / common) : null;
}

export function centroidScore(model: CentroidModel, row: Row): number | null {
  const [z] = standardize([row], model.standardizer);
  const dc = scaledDistance(z, model.control, model.minDims);
  const dp = scaledDistance(z, model.positive, model.minDims);
  return dc != null && dp != null ? dc - dp : null;
}

/** 验证集打分的分位数作阈值（线性插值）；有效分数不足 5 个 → null（不定阈值，不硬凑）。 */
export function pickThreshold(validationScores: readonly (number | null)[], quantile = 0.8): number | null {
  const xs = validationScores.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length < 5) return null;
  const pos = quantile * (xs.length - 1);
  const lo = Math.floor(pos);
  return xs[lo] + (xs[Math.min(lo + 1, xs.length - 1)] - xs[lo]) * (pos - lo);
}

export type Scorer = (window: ObservationWindow) => number | null;

export function modelScorer(model: CentroidModel): Scorer {
  return window => centroidScore(model, computeFeatures(window, { halfLifeHours: model.halfLifeHours }));
}

/** 基线 1：48h 涨幅 ln(C_N / O_1)。 */
export const momentumScorer: Scorer = window => {
  const bars = window.bars;
  return bars.length ? Math.log(bars[bars.length - 1].close / bars[0].open) : null;
};

/** 基线 2：不挑时机，冷却期一过就买（相当于定期买入、到期卖出）。 */
export const alwaysScorer: Scorer = () => 0;

/** 预先排好序、去重的 K 线，用二分切窗口，避免每一步都扫全量。 */
export function prepareBars(bars: readonly ResearchBar[]): ResearchBar[] {
  const byOpen = new Map<number, ResearchBar>();
  for (const b of bars) if (b.openTime % BAR_MS === 0 && !byOpen.has(b.openTime)) byOpen.set(b.openTime, b);
  return [...byOpen.values()].sort((a, b) => a.openTime - b.openTime);
}

function lowerBound(sorted: readonly ResearchBar[], t: number): number {
  let lo = 0; let hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid].openTime < t) lo = mid + 1; else hi = mid; }
  return lo;
}

/** 与 extractWindow 同口径（[t − 48h, t)，只收已收盘），但要求输入已 prepareBars。 */
export function windowFromSorted(sorted: readonly ResearchBar[], anchorMs: number): ObservationWindow {
  const from = lowerBound(sorted, anchorMs - WINDOW_MS);
  const to = lowerBound(sorted, anchorMs - BAR_MS + 1);
  const bars = sorted.slice(from, to);
  const expectedBars = expectedWindowBars(anchorMs);
  return {
    anchorMs, aligned: anchorMs % BAR_MS === 0, bars, expectedBars,
    missingBars: expectedBars - bars.length,
    coverage: expectedBars > 0 ? bars.length / expectedBars : 0,
    missingTakerBars: bars.filter(b => b.takerBuyVolume == null).length,
  };
}

export interface ScanOptions {
  fromMs: number;
  toMs: number;
  threshold: number;
  scorer: Scorer;
  stepMs?: number;
  /** 一次信号后同标的冷却多久（默认 = 结果期），保证同标的持仓不重叠。 */
  cooldownMs: number;
  /** 观察窗覆盖率低于此值不打分（默认 0.95）。 */
  minCoverage?: number;
}

export interface ScanSignal {
  t: number;
  score: number;
  coverage: number;
}

/** 逐步扫描一个标的；每一步只看该时刻之前已收盘的 K 线。 */
export function scanSymbol(sortedBars: readonly ResearchBar[], options: ScanOptions): ScanSignal[] {
  const step = options.stepMs ?? BAR_MS;
  const minCoverage = options.minCoverage ?? 0.95;
  const out: ScanSignal[] = [];
  let nextAllowed = Number.NEGATIVE_INFINITY;
  for (let t = Math.ceil(options.fromMs / step) * step; t <= options.toMs; t += step) {
    if (t < nextAllowed) continue;
    const w = windowFromSorted(sortedBars, t);
    if (w.coverage < minCoverage) continue;
    const score = options.scorer(w);
    if (score == null || !Number.isFinite(score) || score < options.threshold) continue;
    out.push({ t, score, coverage: w.coverage });
    nextAllowed = t + options.cooldownMs;
  }
  return out;
}

export interface StrategySpec {
  name: string;
  scorer: Scorer;
  threshold: number;
}

export interface StrategyReport {
  name: string;
  signals: number;
  /** 进场那根缺行情而没成交的信号数。 */
  skipped: number;
  trades: TradeResult[];
  summary: TradeSummary;
}

/**
 * 同一时间段、同一标的池、同一出场规则与成本，把模型和各基线放在一起比。
 * 测试集上只调用一次；不同的出场 / 成本假设作为敏感性分析另行列出，不用来挑最好看的。
 */
export function compareStrategies(
  barsBySymbol: Readonly<Record<string, readonly ResearchBar[]>>,
  strategies: readonly StrategySpec[],
  scan: Omit<ScanOptions, 'threshold' | 'scorer'>,
  exit: ExitRule,
  cost: CostModel & { fundingBySymbol?: Readonly<Record<string, readonly { fundingTime: number; rate: number }[]>> } = {},
): StrategyReport[] {
  const prepared = Object.fromEntries(Object.entries(barsBySymbol).map(([s, b]) => [s, prepareBars(b)]));
  return strategies.map(strategy => {
    const trades: TradeResult[] = [];
    let signals = 0;
    let skipped = 0;
    for (const [symbol, bars] of Object.entries(prepared)) {
      for (const sig of scanSymbol(bars, { ...scan, threshold: strategy.threshold, scorer: strategy.scorer })) {
        signals++;
        const trade = simulateLongTrade(bars, sig.t, exit, { ...cost, funding: cost.fundingBySymbol?.[symbol] ?? cost.funding ?? null });
        if (trade) trades.push(trade); else skipped++;
      }
    }
    return { name: strategy.name, signals, skipped, trades, summary: summarizeTrades(trades) };
  });
}
