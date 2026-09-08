import { describe, expect, it } from 'vitest';
import type { CampaignMetricPoint } from '@/lib/campaignMetricSeries';
import type { ScatterStackScale } from '@/components/charts/stackLayout';
import {
  DOMAIN_CAP,
  TAIL_THRESHOLD,
  buildOddsDistributionModel,
  kdeCountPath,
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

  it('远离主群的孤立鼓包会断成第二段子路径，空档上不留发丝线', () => {
    const values = [...Array.from({ length: 60 }, (_, index) => -0.5 + index * 0.01), 7.5, 7.52, 7.48];
    const domain = { min: -2, max: 10 };
    const path = kdeCountPath(values, domain, makeScale(domain), 0.05);
    expect((path.match(/M /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('无样本给空路径', () => {
    expect(kdeCountPath([], { min: -2, max: 2 }, makeScale({ min: -2, max: 2 }))).toBe('');
  });
});
