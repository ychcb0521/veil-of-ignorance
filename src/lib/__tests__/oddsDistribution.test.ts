import { describe, expect, it } from 'vitest';
import type { CampaignMetricPoint } from '@/lib/campaignMetricSeries';
import type { ScatterStackScale } from '@/components/charts/stackLayout';
import {
  DOMAIN_CAP,
  TAIL_THRESHOLD,
  buildOddsDistributionModel,
  kdeCountPath,
  metricDistributionDomain,
  oddsDistributionDomain,
} from '@/lib/oddsDistribution';

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** 真实形状的 192 个 b 值：亏损堆在 −1..0，少数越过 −1R，右尾拉到 +38。 */
function realShaped() {
  const rand = lcg(11);
  const values: number[] = [];
  for (let i = 0; i < 8; i += 1) values.push(-1 - 0.61 * rand());
  for (let i = 0; i < 78; i += 1) values.push(-rand());
  for (let i = 0; i < 4; i += 1) values.push(0);
  for (let i = 0; i < 90; i += 1) values.push(2 * rand() ** 1.6);
  values.push(2.3, 2.9, 3.6, 4.4, 5.2, 6.1, 7.4, 9.6, 12.5, 17, 24, 38.19);
  return values;
}

function toPoints(values: number[]): CampaignMetricPoint[] {
  return values.map((value, index) => ({
    campaignId: `c${index}`,
    title: `战役 ${index}`,
    symbol: 'BTCUSDT',
    value,
    operationTime: index,
    sequence: index + 1,
    pnl: value,
  }));
}

function makeScale(domain: { min: number; max: number }): ScatterStackScale {
  const left = 12;
  const right = 840;
  const usable = right - left;
  const binPx = usable / Math.floor(usable / 14);
  const plotTop = 12;
  const plotBottom = 504;
  return {
    x: value => left + ((value - domain.min) / (domain.max - domain.min)) * usable,
    countY: count => plotBottom - count * 12,
    binWidth: (binPx / usable) * (domain.max - domain.min),
    binPx,
    pitchY: 12,
    rowsFit: 41,
    n: 192,
    plot: { left, right, top: plotTop, bottom: plotBottom },
    clipPathId: 'clip',
  };
}

describe('oddsDistributionDomain', () => {
  it('右尾很重时窗口封顶在 +10R，且 −1..+1 主群至少占横轴 1/6', () => {
    const domain = oddsDistributionDomain(realShaped());
    expect(domain.min).toBeLessThanOrEqual(-2);
    expect(domain.max).toBeLessThanOrEqual(DOMAIN_CAP);
    expect(domain.max).toBeGreaterThanOrEqual(2);
    expect(2 / (domain.max - domain.min)).toBeGreaterThanOrEqual(1 / 6);
    // −1 与 −1.61 都在窗口内：止损墙永远画得出来，墙外亏损照常落在墙左侧。
    expect(domain.min).toBeLessThan(-1.61);
    // 刻度升序、等步距、覆盖两端。
    expect(domain.ticks[0]).toBe(domain.min);
    expect(domain.ticks[domain.ticks.length - 1]).toBe(domain.max);
    const steps = new Set(domain.ticks.slice(1).map((value, index) => value - domain.ticks[index]));
    expect(steps.size).toBe(1);
    expect(domain.ticks.length).toBeLessThanOrEqual(8);
  });

  it('全部落在 −1..+1 时给最小窗口 −2..+2', () => {
    expect(oddsDistributionDomain([-0.9, -0.2, 0.1, 0.8])).toEqual({ min: -2, max: 2, ticks: [-2, -1, 0, 1, 2] });
  });
});

describe('buildOddsDistributionModel', () => {
  it('胜率 = b>0 占比，右尾 = b>+5R 场数，范围 / 中位数 / 均值按原始值', () => {
    const values = [-1.5, -0.5, 0, 0.5, 1, 6, 38];
    const model = buildOddsDistributionModel(toPoints(values));
    expect(model.summary.n).toBe(7);
    expect(model.summary.winCount).toBe(4);
    expect(model.summary.winRate).toBeCloseTo(4 / 7, 9);
    expect(model.summary.tailCount).toBe(values.filter(value => value > TAIL_THRESHOLD).length);
    expect(model.summary.min).toBe(-1.5);
    expect(model.summary.max).toBe(38);
    expect(model.summary.median).toBe(0.5);
    expect(model.summary.mean).toBeCloseTo(values.reduce((a, b) => a + b, 0) / 7, 9);
    expect(model.sortedPoints.map(point => point.value)).toEqual([...values].sort((a, b) => a - b));
    expect(model.bandwidth).toBeGreaterThan(0);
  });

  it('同值按 campaignId 排，键盘漫游顺序稳定', () => {
    const model = buildOddsDistributionModel(toPoints([0.3, 0.3, 0.3]).reverse());
    expect(model.sortedPoints.map(point => point.campaignId)).toEqual(['c0', 'c1', 'c2']);
  });
});

describe('kdeCountPath', () => {
  function parse(path: string) {
    return path.split(/(?=[ML])/).map(segment => {
      const [cmd, x, y] = segment.trim().split(/\s+/);
      return { cmd, x: Number(x), y: Number(y) };
    });
  }

  it('采样点绝不越出 [max(min, 数据最小), min(max, 数据最大)]，也绝不高过绘图区顶', () => {
    const values = realShaped();
    const domain = oddsDistributionDomain(values);
    const scale = makeScale(domain);
    const segments = parse(kdeCountPath(values, domain, scale));
    expect(segments.length).toBeGreaterThan(10);
    const start = scale.x(Math.max(domain.min, Math.min(...values)));
    const end = scale.x(Math.min(domain.max, Math.max(...values)));
    for (const segment of segments) {
      expect(segment.x).toBeGreaterThanOrEqual(start - 0.01);
      expect(segment.x).toBeLessThanOrEqual(end + 0.01);
      expect(segment.y).toBeLessThanOrEqual(scale.plot.bottom + 0.01);
    }
    // 曲线与柱共用场数轴：峰值换算成场数后不超过样本总数。
    const peakCount = (scale.plot.bottom - Math.min(...segments.map(segment => segment.y))) / scale.pitchY;
    expect(peakCount).toBeLessThan(values.length);
    expect(peakCount).toBeGreaterThan(1);
  });

  it('远离主群的孤立鼓包仍保持一条连续曲线，不会被误读成只加载了一半', () => {
    const values = [...Array.from({ length: 60 }, (_, index) => -0.5 + index * 0.01), 7.5, 7.52, 7.48];
    const domain = { min: -2, max: 10 };
    const path = kdeCountPath(values, domain, makeScale(domain), 0.05);
    expect((path.match(/M /g) ?? []).length).toBe(1);
    expect((path.match(/L /g) ?? []).length).toBeGreaterThan(100);
  });

  it('无样本给空路径', () => {
    expect(kdeCountPath([], { min: -2, max: 2 }, makeScale({ min: -2, max: 2 }))).toBe('');
  });
});

describe('【用户要求】通用分布窗口（盈亏比之外的指标）', () => {
  it('不再硬撑到 −2，也不套 +10R 封顶——几何期望永远 ≥ −1，左边那一半是空的', () => {
    const values = [-0.36, -0.2, 0, 0.05, 0.1, 0.35, 0.6, 1.1, 2.3, 4.65];
    const generic = metricDistributionDomain(values);
    const odds = oddsDistributionDomain(values);
    expect(odds.min).toBe(-2);                       // 盈亏比那一套的硬下界
    expect(generic.min).toBeGreaterThan(-2);         // 通用窗口贴着数据走
    expect(generic.min).toBeLessThanOrEqual(-0.36);
    expect(generic.max).toBeGreaterThanOrEqual(2.3);
  });

  it('无论如何把 0 圈进窗口——它是盈亏分界，挤出视野就没有参照点了', () => {
    const allPositive = metricDistributionDomain([1.2, 1.5, 2.0, 3.4]);
    expect(allPositive.min).toBeLessThanOrEqual(0);
    expect(allPositive.ticks).toContain(0);
    const allNegative = metricDistributionDomain([-0.8, -0.5, -0.3]);
    expect(allNegative.max).toBeGreaterThanOrEqual(0);
    expect(allNegative.ticks).toContain(0);
  });

  it('刻度落在 1/2/5 × 10ⁿ 上，且不超过 ~6 格', () => {
    const domain = metricDistributionDomain([-0.36, 0.1, 0.5, 1.2, 4.65]);
    expect(domain.ticks.length).toBeLessThanOrEqual(8);
    const step = Number((domain.ticks[1] - domain.ticks[0]).toFixed(6));
    const base = step / 10 ** Math.floor(Math.log10(step));
    expect([1, 2, 5]).toContain(Number(base.toFixed(6)));
    // 浮点脏值不能漏到刻度上
    for (const tick of domain.ticks) expect(String(tick)).not.toMatch(/\d{8,}/);
  });

  it('窄样本也给得出窗口，空样本不炸', () => {
    const narrow = metricDistributionDomain([0.02, 0.03, 0.04]);
    expect(narrow.max).toBeGreaterThan(narrow.min);
    expect(narrow.ticks.length).toBeGreaterThanOrEqual(2);
    expect(metricDistributionDomain([]).ticks).toEqual([-1, 0, 1]);
  });

  it('右尾阈值可以换：不传就是 +5R', () => {
    const points = [1, 3, 6, 12].map((value, index) => ({
      campaignId: `c${index}`, title: 't', symbol: 'S', value, operationTime: index, sequence: index + 1,
    }));
    expect(buildOddsDistributionModel(points).summary.tailCount).toBe(2);        // > 5
    expect(buildOddsDistributionModel(points, { tailThreshold: 10 }).summary.tailCount).toBe(1);
  });
});

describe('【评审发现】通用窗口的两个退化情形', () => {
  it('全是 0（时间段里全是进行中战役）不塌成一个点', () => {
    const domain = metricDistributionDomain([0, 0, 0, 0, 0]);
    expect(domain.max).toBeGreaterThan(domain.min);
    expect(domain.ticks).toContain(0);
    expect(domain.ticks.length).toBeGreaterThanOrEqual(3);
    expect(metricDistributionDomain([0]).max).toBeGreaterThan(metricDistributionDomain([0]).min);
  });

  it('小样本里的极端值不把窗口撑成二十几倍：p98 切不动时用 Tukey 栅栏兜底', () => {
    // 9 场贴着 0，1 场 11.6 —— 没有兜底的话窗口会一路开到 12，其余 9 场挤进第一档
    const values = [-0.05, -0.02, 0, 0.01, 0.03, 0.05, 0.08, 0.12, 0.2, 11.6];
    const domain = metricDistributionDomain(values);
    expect(domain.max).toBeLessThan(6);
    expect(domain.max).toBeGreaterThanOrEqual(0.2);   // 主群仍在窗口内
    expect(domain.ticks).toContain(0);
  });

  it('样本够大时仍按 p98 走，不被栅栏提前收紧', () => {
    // 200 场贴着 0 + 一条真实右尾：右尾要看得见，这正是分布图的用途
    const bulk = Array.from({ length: 200 }, (_, i) => -0.1 + (i % 40) * 0.01);
    const tail = [1.2, 1.6, 2.4, 3.1, 4.5];
    const domain = metricDistributionDomain([...bulk, ...tail]);
    expect(domain.max).toBeGreaterThanOrEqual(0.3);
  });
});
