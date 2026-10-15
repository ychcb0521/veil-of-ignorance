import { describe, expect, it } from 'vitest';
import { fundingGrid, simulateLongTrade, summarizeTrades, type TradeResult } from '@/lib/deepRsa/backtest';
import {
  alwaysScorer, centroidScore, compareStrategies, fitCentroidModel, momentumScorer, pickThreshold, prepareBars, scanSymbol,
  windowFromSorted,
} from '@/lib/deepRsa/scan';
import { BAR_MS, extractWindow, type ResearchBar } from '@/lib/deepRsa/window';
import { FUNDING_RATE, TAKER_FEE } from '@/types/trading';
import { WINDOW_MS } from '@/lib/deepRsa/grouping';

const HOUR = 60 * 60_000;
const T0 = Date.parse('2026-05-06T12:00:00Z');

function flat(n: number, start: number, px = 100): ResearchBar[] {
  return Array.from({ length: n }, (_, i) => ({ openTime: start + i * BAR_MS, open: px, high: px, low: px, close: px, volume: 1, takerBuyVolume: 0.5 }));
}

describe('只做多回测：成本与出场规则', () => {
  it('横盘到期：净收益 = −滑点往返 − 两边手续费 − 资金费（假设费率、8h 结算）', () => {
    const bars = flat(300, T0);
    const t = simulateLongTrade(bars, T0, { horizonMs: 24 * HOUR }, { slippage: 0.001 })!;
    expect(t.entryFill).toBeCloseTo(100.1, 12);
    expect(t.exitFill).toBeCloseTo(99.9, 12);
    expect(t.exitReason).toBe('time');
    expect(t.feeCost).toBeCloseTo(TAKER_FEE * (1 + 99.9 / 100.1), 12);
    // T0 = 12:00 UTC，(12:00, 次日 12:00] 内有 16:00、00:00、08:00 三次结算
    expect(t.fundingSource).toBe('assumed');
    expect(t.fundingCost).toBeCloseTo(3 * FUNDING_RATE * (100 / 100.1), 12);
    expect(t.netReturn).toBeCloseTo(99.9 / 100.1 - 1 - t.feeCost - t.fundingCost, 12);
  });

  it('信号不整点：下一根整点 K 线开盘进场', () => {
    const t = simulateLongTrade(flat(300, T0), T0 - 60_000, { horizonMs: HOUR })!;
    expect(t.entryTime).toBe(T0);
  });

  it('同一根 K 线同时碰到止损和止盈 → 按止损（保守）', () => {
    const bars = flat(50, T0);
    bars[3] = { ...bars[3], high: 120, low: 80 };
    const t = simulateLongTrade(bars, T0, { horizonMs: 2 * HOUR, stopLoss: 0.05, takeProfit: 0.1 }, { slippage: 0 })!;
    expect(t.exitReason).toBe('stop');
    expect(t.exitFill).toBeCloseTo(95, 12);
    expect(t.exitTime).toBe(T0 + 4 * BAR_MS);
  });

  it('跳空低开到止损价下方：按开盘价成交，不假装在止损价成交', () => {
    const bars = flat(50, T0);
    bars[2] = { ...bars[2], open: 90, high: 91, low: 89, close: 90 };
    const t = simulateLongTrade(bars, T0, { horizonMs: 2 * HOUR, stopLoss: 0.05 }, { slippage: 0 })!;
    expect(t.exitFill).toBe(90);
  });

  it('止盈：碰到即出；数据提前断了 → data_end', () => {
    const bars = flat(50, T0);
    bars[5] = { ...bars[5], high: 111 };
    expect(simulateLongTrade(bars, T0, { horizonMs: 2 * HOUR, takeProfit: 0.1 }, { slippage: 0 })!.exitReason).toBe('take');
    expect(simulateLongTrade(flat(10, T0), T0, { horizonMs: 2 * HOUR }, { slippage: 0 })!.exitReason).toBe('data_end');
  });

  it('真实资金费：只算持仓期间的结算；负费率多头收钱', () => {
    const funding = [
      { fundingTime: T0 - HOUR, rate: 0.01 },
      { fundingTime: T0 + 4 * HOUR, rate: -0.0003 },
      { fundingTime: T0 + 30 * HOUR, rate: 0.01 },
    ];
    const t = simulateLongTrade(flat(300, T0), T0, { horizonMs: 24 * HOUR }, { slippage: 0, funding })!;
    expect(t.fundingSource).toBe('real');
    expect(t.fundingCost).toBeCloseTo(-0.0003, 12);
  });

  it('进场那根缺失 → null', () => {
    expect(simulateLongTrade(flat(10, T0 + BAR_MS), T0, { horizonMs: HOUR })).toBeNull();
  });

  it('8h 结算网格', () => {
    expect(fundingGrid(T0, T0 + 24 * HOUR).map(t => new Date(t).toISOString().slice(11, 16))).toEqual(['16:00', '00:00', '08:00']);
  });
});

describe('交易汇总', () => {
  const mk = (entryTime: number, netReturn: number): TradeResult => ({
    signalMs: entryTime, entryTime, entryFill: 1, exitTime: entryTime + 1, exitFill: 1, exitReason: 'time',
    grossReturn: netReturn, feeCost: 0, fundingCost: 0, fundingSource: 'assumed', netReturn,
  });

  it('均值 / 中位数 / 胜率 / 盈亏因子 / 最大回撤（按时间顺序，不复利）', () => {
    const s = summarizeTrades([mk(3, -0.02), mk(1, 0.05), mk(2, -0.04), mk(4, 0.01)]);
    expect(s.n).toBe(4);
    expect(s.meanNet).toBeCloseTo(0, 12);
    expect(s.medianNet).toBeCloseTo(-0.005, 12);
    expect(s.winRate).toBe(0.5);
    expect(s.profitFactor).toBeCloseTo(0.06 / 0.06, 12);
    expect(s.maxDrawdown).toBeCloseTo(0.06, 12);
    expect(s.meanNetCi95[0]).toBeLessThanOrEqual(s.meanNet);
    expect(s.meanNetCi95[1]).toBeGreaterThanOrEqual(s.meanNet);
    expect(s.fundingAssumed).toBe(4);
    expect(summarizeTrades([mk(1, 0.01)], { seed: 3 })).toEqual(summarizeTrades([mk(1, 0.01)], { seed: 3 }));
  });

  it('没有交易：不编数', () => {
    const s = summarizeTrades([]);
    expect(s.n).toBe(0);
    expect(s.meanNet).toBeNaN();
  });
});

describe('冻结模型与阈值', () => {
  it('中心模型：像正样本的打分为正，像对照组的为负；任一组为空不拟合', () => {
    const rows = [{ a: 2, b: 2 }, { a: 2.2, b: 1.8 }, { a: -2, b: -2 }, { a: -1.8, b: -2.2 }];
    const model = fitCentroidModel(rows, ['positive', 'positive', 'control', 'control'], ['a', 'b'], 6)!;
    expect(model.trainCounts).toEqual({ positive: 2, control: 2 });
    expect(centroidScore(model, { a: 2, b: 2 })!).toBeGreaterThan(0);
    expect(centroidScore(model, { a: -2, b: -2 })!).toBeLessThan(0);
    expect(centroidScore(model, { a: null, b: null })).toBeNull();
    expect(fitCentroidModel(rows, ['positive', 'positive', null, null], ['a', 'b'], 6)).toBeNull();
  });

  it('阈值取验证集分位数；有效分数不足 5 个不定阈值', () => {
    expect(pickThreshold([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(pickThreshold([1, 2, 3, 4, 5, null], 0.8)).toBeCloseTo(4.2, 12);
    expect(pickThreshold([1, 2, null])).toBeNull();
  });
});

describe('扫描：每一步只看已收盘 K 线，同标的不重叠', () => {
  const start = T0 - WINDOW_MS;
  const bars: ResearchBar[] = Array.from({ length: 2000 }, (_, i) => {
    const c = 100 + 10 * Math.sin(i / 50);
    return { openTime: start + i * BAR_MS, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: 1 + (i % 7), takerBuyVolume: 0.5 };
  });
  const sorted = prepareBars(bars);

  it('二分切窗口与 extractWindow 完全一致', () => {
    for (const k of [0, 1, 577, 1234]) {
      const anchor = T0 + k * BAR_MS + (k % 2 ? 60_000 : 0);
      expect(windowFromSorted(sorted, anchor)).toEqual(extractWindow(bars, anchor));
    }
  });

  it('冷却期内不重复发信号；覆盖率不足不打分', () => {
    const sigs = scanSymbol(sorted, { fromMs: T0, toMs: T0 + 1000 * BAR_MS, threshold: 0, scorer: alwaysScorer, cooldownMs: 24 * HOUR });
    for (let i = 1; i < sigs.length; i++) expect(sigs[i].t - sigs[i - 1].t).toBeGreaterThanOrEqual(24 * HOUR);
    expect(scanSymbol(sorted, { fromMs: start, toMs: start + HOUR, threshold: 0, scorer: alwaysScorer, cooldownMs: 0 })).toEqual([]);
  });

  it('防未来数据：截掉 t 之后的行情，t 及之前的信号不变', () => {
    const cut = T0 + 800 * BAR_MS;
    const opts = { fromMs: T0, toMs: cut, threshold: 0.05, scorer: momentumScorer, cooldownMs: 6 * HOUR };
    expect(scanSymbol(prepareBars(bars.filter(b => b.openTime + BAR_MS <= cut)), opts)).toEqual(scanSymbol(sorted, opts));
  });

  it('模型与基线放在同一组条件下比较', () => {
    const reports = compareStrategies(
      { AAAUSDT: bars },
      [{ name: '定期买入', scorer: alwaysScorer, threshold: 0 }, { name: '48h 动量', scorer: momentumScorer, threshold: 0 }],
      { fromMs: T0, toMs: T0 + 1000 * BAR_MS, cooldownMs: 24 * HOUR },
      { horizonMs: 24 * HOUR },
    );
    expect(reports.map(r => r.name)).toEqual(['定期买入', '48h 动量']);
    for (const r of reports) {
      expect(r.trades.length + r.skipped).toBe(r.signals);
      expect(r.summary.n).toBe(r.trades.length);
    }
  });
});
