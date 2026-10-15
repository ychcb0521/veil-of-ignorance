/**
 * Deep RSA · 第 5 步：只做多的离线回测（含手续费、滑点、资金费）。纯模拟，不下任何单。
 *
 * 规则（全部事先固定，不在测试集上调）：
 * - 信号时刻 t 之后第一根完整 5m K 线开盘进场；进场价 × (1 + 滑点)。
 * - 出场：止损 / 止盈（可选）或到期；同一根 K 线里止损、止盈都碰到 → 按止损算（保守）。
 *   到期按最后一根收盘 × (1 − 滑点) 出；行情数据提前断了 → 'data_end'，照实记。
 * - 手续费：进出两边都按吃单费率（应用的 TAKER_FEE）。
 * - 资金费：持仓期间每个结算时刻按「费率 × 当时价格 / 进场价」扣（多头费率为正时付钱）。
 *   有真实资金费历史就用真实的；没有就按应用的常数 FUNDING_RATE / 8h 假设，并标 'assumed'。
 */
import { FUNDING_RATE, TAKER_FEE } from '@/types/trading';
import { mulberry32 } from '@/lib/deepRsa/grouping';
import { BAR_MS, type ResearchBar } from '@/lib/deepRsa/window';

export const FUNDING_INTERVAL_MS = 8 * 60 * 60_000;

export interface FundingEvent {
  fundingTime: number;
  rate: number;
}

export interface CostModel {
  /** 每边手续费率，默认应用的吃单费率 0.05%。 */
  feeRate?: number;
  /** 每边滑点（比例），默认 0.0005（5 个基点）；报告时另做 0 / 10 个基点的敏感性。 */
  slippage?: number;
  /** 真实资金费历史；null / 不传 → 用假设费率。 */
  funding?: readonly FundingEvent[] | null;
  /** 假设资金费率（每 8h），默认应用的 FUNDING_RATE。 */
  assumedFundingRate?: number;
}

export interface ExitRule {
  horizonMs: number;
  /** 止损：相对进场成交价的跌幅比例（例如 0.05）；null 不设。 */
  stopLoss?: number | null;
  /** 止盈：相对进场成交价的涨幅比例；null 不设。 */
  takeProfit?: number | null;
}

export type ExitReason = 'stop' | 'take' | 'time' | 'data_end';

export interface TradeResult {
  signalMs: number;
  entryTime: number;
  entryFill: number;
  exitTime: number;
  exitFill: number;
  exitReason: ExitReason;
  /** exitFill / entryFill − 1（已含滑点）。 */
  grossReturn: number;
  feeCost: number;
  fundingCost: number;
  fundingSource: 'real' | 'assumed';
  /** 占进场名义价值的净收益率。 */
  netReturn: number;
}

/** 进场那根 K 线缺失 → null（不另找价格凑）。 */
export function simulateLongTrade(bars: readonly ResearchBar[], signalMs: number, exit: ExitRule, cost: CostModel = {}): TradeResult | null {
  const feeRate = cost.feeRate ?? TAKER_FEE;
  const slippage = cost.slippage ?? 0.0005;
  const entryTime = Math.ceil(signalMs / BAR_MS) * BAR_MS;
  const end = entryTime + exit.horizonMs;
  const byOpen = new Map<number, ResearchBar>();
  for (const bar of bars) {
    if (bar.openTime < entryTime || bar.openTime + BAR_MS > end || bar.openTime % BAR_MS !== 0) continue;
    if (!byOpen.has(bar.openTime)) byOpen.set(bar.openTime, bar);
  }
  const path = [...byOpen.values()].sort((a, b) => a.openTime - b.openTime);
  if (!path.length || path[0].openTime !== entryTime) return null;

  const entryFill = path[0].open * (1 + slippage);
  const stopPx = exit.stopLoss != null ? entryFill * (1 - exit.stopLoss) : null;
  const takePx = exit.takeProfit != null ? entryFill * (1 + exit.takeProfit) : null;
  let exitFill = Number.NaN;
  let exitTime = Number.NaN;
  let exitReason: ExitReason = 'time';
  for (const bar of path) {
    const hitStop = stopPx != null && bar.low <= stopPx;
    const hitTake = takePx != null && bar.high >= takePx;
    if (hitStop) {
      // 跳空低开到止损价下方：按开盘价成交，而不是假装在止损价成交
      exitFill = Math.min(stopPx!, bar.open) * (1 - slippage);
      exitTime = bar.openTime + BAR_MS;
      exitReason = 'stop';
      break;
    }
    if (hitTake) {
      exitFill = Math.max(takePx!, bar.open) * (1 - slippage);
      exitTime = bar.openTime + BAR_MS;
      exitReason = 'take';
      break;
    }
  }
  if (!Number.isFinite(exitFill)) {
    const last = path[path.length - 1];
    exitFill = last.close * (1 - slippage);
    exitTime = last.openTime + BAR_MS;
    exitReason = exitTime < end ? 'data_end' : 'time';
  }

  const fundingSource: 'real' | 'assumed' = cost.funding ? 'real' : 'assumed';
  const events: FundingEvent[] = cost.funding
    ? cost.funding.filter(f => f.fundingTime > entryTime && f.fundingTime <= exitTime)
    : fundingGrid(entryTime, exitTime).map(t => ({ fundingTime: t, rate: cost.assumedFundingRate ?? FUNDING_RATE }));
  let fundingCost = 0;
  for (const f of events) {
    const bar = path.find(b => b.openTime <= f.fundingTime && f.fundingTime < b.openTime + BAR_MS)
      ?? [...path].reverse().find(b => b.openTime < f.fundingTime);
    const px = bar ? bar.open : entryFill;
    fundingCost += f.rate * (px / entryFill);
  }

  const grossReturn = exitFill / entryFill - 1;
  const feeCost = feeRate * (1 + exitFill / entryFill);
  return {
    signalMs, entryTime, entryFill, exitTime, exitFill, exitReason, grossReturn, feeCost, fundingCost, fundingSource,
    netReturn: grossReturn - feeCost - fundingCost,
  };
}

/** (from, to] 内的 8h 结算时刻（UTC 00:00 / 08:00 / 16:00）。 */
export function fundingGrid(fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  for (let t = Math.floor(fromMs / FUNDING_INTERVAL_MS + 1) * FUNDING_INTERVAL_MS; t <= toMs; t += FUNDING_INTERVAL_MS) out.push(t);
  return out;
}

export interface TradeSummary {
  n: number;
  meanNet: number;
  medianNet: number;
  winRate: number;
  sumNet: number;
  /** 盈利总和 / 亏损总和的绝对值；没有亏损 → Infinity，没有交易 → NaN。 */
  profitFactor: number;
  /** 按时间顺序累加净收益的最大回撤（同一名义价值逐笔累加，不复利）。 */
  maxDrawdown: number;
  /** 平均净收益的 95% 自助法区间（按交易重抽，固定 seed）。 */
  meanNetCi95: [number, number];
  exitReasons: Record<ExitReason, number>;
  fundingAssumed: number;
}

export function summarizeTrades(trades: readonly TradeResult[], options: { bootstrap?: number; seed?: number } = {}): TradeSummary {
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const r = sorted.map(t => t.netReturn);
  const n = r.length;
  const exitReasons: Record<ExitReason, number> = { stop: 0, take: 0, time: 0, data_end: 0 };
  sorted.forEach(t => { exitReasons[t.exitReason]++; });
  if (n === 0) {
    return { n, meanNet: Number.NaN, medianNet: Number.NaN, winRate: Number.NaN, sumNet: 0, profitFactor: Number.NaN, maxDrawdown: 0, meanNetCi95: [Number.NaN, Number.NaN], exitReasons, fundingAssumed: 0 };
  }
  const sum = r.reduce((s, v) => s + v, 0);
  const s2 = [...r].sort((a, b) => a - b);
  const median = n % 2 ? s2[(n - 1) / 2] : (s2[n / 2 - 1] + s2[n / 2]) / 2;
  const wins = r.filter(v => v > 0).reduce((s, v) => s + v, 0);
  const losses = -r.filter(v => v < 0).reduce((s, v) => s + v, 0);
  let peak = 0; let equity = 0; let mdd = 0;
  for (const v of r) { equity += v; peak = Math.max(peak, equity); mdd = Math.max(mdd, peak - equity); }
  const B = options.bootstrap ?? 2000;
  const random = mulberry32(options.seed ?? 1);
  const means: number[] = [];
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += r[Math.floor(random() * n)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return {
    n,
    meanNet: sum / n,
    medianNet: median,
    winRate: r.filter(v => v > 0).length / n,
    sumNet: sum,
    profitFactor: losses > 0 ? wins / losses : wins > 0 ? Number.POSITIVE_INFINITY : Number.NaN,
    maxDrawdown: mdd,
    meanNetCi95: [means[Math.floor(0.025 * (B - 1))], means[Math.ceil(0.975 * (B - 1))]],
    exitReasons,
    fundingAssumed: sorted.filter(t => t.fundingSource === 'assumed').length,
  };
}
