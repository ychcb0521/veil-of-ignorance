import { describe, expect, it } from 'vitest';
import type { CampaignMetricPoint } from '@/lib/campaignMetricSeries';
import type { ScatterStackScale } from '@/components/charts/stackLayout';
import {
  CAPITAL_RUIN_THRESHOLD,
  DOMAIN_CAP,
  TAIL_THRESHOLD,
  buildOddsDistributionModel,
  DISTRIBUTION_NOMINAL_COLUMNS,
  DISTRIBUTION_NOMINAL_ROWS,
  kdeCountPath,
  isFixedBetRuin,
  metricDistributionDomain,
  oddsDistributionDomain,
  tallestColumnEstimate,
} from '@/lib/oddsDistribution';
import { FIXED_DRAWDOWN_FRACTION } from '@/lib/geometricExpectancy';

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

  it('即便归零点不足 2%，仍将 −10R 界限纳入视野，并裁边极端负尾', () => {
    const bulk = Array.from({ length: 100 }, (_, i) => 0.1 + i * 0.05);
    const domain = oddsDistributionDomain([-85.51, ...bulk]);
    expect(domain.min).toBe(-12);
    expect(domain.min).toBeLessThan(CAPITAL_RUIN_THRESHOLD);
    expect(domain.max).toBeGreaterThan(0);
    expect(domain.max).toBeLessThanOrEqual(DOMAIN_CAP);
    expect(domain.ticks[0]).toBe(domain.min);
    expect(domain.ticks[domain.ticks.length - 1]).toBe(domain.max);
    expect(domain.ticks.every((value, index) => index === 0 || value > domain.ticks[index - 1])).toBe(true);
    expect(domain.ticks.length).toBeLessThanOrEqual(8);
  });

  it('恰好 −10R 也打开归零区，只有 −9.99R 时不启用固定 −12R 左界', () => {
    const bulk = Array.from({ length: 100 }, () => 0.5);
    expect(oddsDistributionDomain([-10, ...bulk]).min).toBe(-12);
    expect(oddsDistributionDomain([-9.99, ...bulk])).toEqual({ min: -2, max: 2, ticks: [-2, -1, 0, 1, 2] });
  });
});

describe('固定 10% 下注归零判定', () => {
  it('阈值从固定下注比例推导，含等号但不吞掉临界值上方样本', () => {
    expect(FIXED_DRAWDOWN_FRACTION).toBe(0.1);
    expect(CAPITAL_RUIN_THRESHOLD).toBe(-1 / FIXED_DRAWDOWN_FRACTION);
    expect(isFixedBetRuin(-10.01)).toBe(true);
    expect(isFixedBetRuin(-10)).toBe(true);
    expect(isFixedBetRuin(-9.99)).toBe(false);
    expect(isFixedBetRuin(-10 + 1e-10)).toBe(false);
    expect(isFixedBetRuin(0)).toBe(false);
  });

  it('非有限值不能充当归零样本', () => {
    for (const value of [NaN, Infinity, -Infinity]) expect(isFixedBetRuin(value)).toBe(false);
  });
});

describe('buildOddsDistributionModel', () => {
  it('归零样本的裁边仅改变显示窗口，不改原始值、均值、样本量与胜率', () => {
    const values = [-85.51, ...Array.from({ length: 100 }, (_, i) => 0.1 + i * 0.05)];
    const model = buildOddsDistributionModel(toPoints(values));
    expect(model.domain.min).toBe(-12);
    expect(model.summary.min).toBe(-85.51);
    expect(model.summary.n).toBe(101);
    expect(model.summary.winCount).toBe(100);
    expect(model.summary.winRate).toBeCloseTo(100 / 101, 9);
    expect(model.summary.median).toBeCloseTo(2.55, 9);
    expect(model.summary.mean).toBeCloseTo(values.reduce((sum, value) => sum + value, 0) / values.length, 9);
    expect(model.values).toEqual(values);
    expect(model.sortedPoints[0]).toMatchObject({ campaignId: 'c0', value: -85.51 });
    expect(model.sortedPoints).toHaveLength(101);
  });

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

  it('刻度落在 1/2/2.5/5 × 10ⁿ 上，且不超过 ~6 格', () => {
    const domain = metricDistributionDomain([-0.36, 0.1, 0.5, 1.2, 4.65]);
    expect(domain.ticks.length).toBeLessThanOrEqual(8);
    const step = Number((domain.ticks[1] - domain.ticks[0]).toFixed(6));
    const base = step / 10 ** Math.floor(Math.log10(step));
    expect([1, 2, 2.5, 5]).toContain(Number(base.toFixed(6)));
    // 浮点脏值不能漏到刻度上
    for (const tick of domain.ticks) expect(String(tick)).not.toMatch(/\d{8,}/);
  });

  it('2.5 这一档只用在 0.25 及以上：0.025 印成两位小数会变成 0.03、0.05、0.07，刻度与标签对不上', () => {
    const stepOf = (domain: { ticks: number[] }) => Number((domain.ticks[1] - domain.ticks[0]).toFixed(6));
    // 跨度 1.4：1.4 ÷ 6 ≈ 0.23 → 0.25
    expect(stepOf(metricDistributionDomain(Array.from({ length: 29 }, (_, index) => index * 0.05)))).toBe(0.25);
    // 跨度 0.14：0.14 ÷ 6 ≈ 0.023 → 跳过 0.025，取 0.05
    expect(stepOf(metricDistributionDomain(Array.from({ length: 29 }, (_, index) => index * 0.005)))).toBe(0.05);
    // 跨度 14：14 ÷ 6 ≈ 2.3 → 2.5
    expect(stepOf(metricDistributionDomain(Array.from({ length: 29 }, (_, index) => index * 0.5)))).toBe(2.5);
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

  it('【用户要求】样本再大也不让右尾把窗口撑开：窗口留给主体，尾部贴边（原来样本一多就照 p98 走）', () => {
    // 200 场贴着 0 + 一条真实右尾：照 p98（1.2）走窗口会开到 1.5 以上，主体只占左边四分之一
    const bulk = Array.from({ length: 200 }, (_, i) => -0.1 + (i % 40) * 0.01);
    const tail = [1.2, 1.6, 2.4, 3.1, 4.5];
    const domain = metricDistributionDomain([...bulk, ...tail]);
    expect(domain.max).toBeGreaterThanOrEqual(0.3);   // 主体（−0.1 ~ 0.29）整个在窗口里
    expect(domain.max).toBeLessThanOrEqual(1);        // 右尾五场贴边，不再占着大半个横轴
  });

  it('【用户要求】照用户账户的形状（过半数贴着 0、几场上百 R）：窗口只有几个 R 宽，最高一柱比照 p98 开窗口时矮一半以上，贴边的不超过一成', () => {
    const random = lcg(20261005);
    const between = (a: number, b: number) => a + random() * (b - a);
    // 单场算术期望 = (b − 1) ÷ 2
    const values = Array.from({ length: 296 }, () => {
      const u = random();
      const b = u < 0.09 ? between(-3, -1)
        : u < 0.29 ? -(random() ** 1.6)
          : u < 0.65 ? random() ** 1.4
            : u < 0.81 ? between(1, 3)
              : u < 0.87 ? between(3, 5)
                : u < 0.93 ? between(5, 11)
                  : u < 0.98 ? between(11, 60)
                    : between(60, 300);
      return (b - 1) / 2;
    });
    const sorted = [...values].sort((a, b) => a - b);
    const domain = metricDistributionDomain(values);
    expect(domain.min).toBeGreaterThanOrEqual(-4);
    expect(domain.max).toBeLessThanOrEqual(8);         // 原来是 p98：几十 R
    expect(domain.ticks).toContain(0);
    const tallest = tallestColumnEstimate(sorted, domain.min, domain.max, DISTRIBUTION_NOMINAL_COLUMNS);
    // 对照：照 p98 开窗口时最高一柱远超一屏
    const p98 = sorted[Math.round(0.98 * (sorted.length - 1))];
    const tallestAtP98 = tallestColumnEstimate(sorted, -5, Math.ceil(p98 / 5) * 5, DISTRIBUTION_NOMINAL_COLUMNS);
    expect(tallestAtP98).toBeGreaterThan(DISTRIBUTION_NOMINAL_ROWS * 2);
    expect(tallest).toBeLessThan(tallestAtP98 / 2);
    // 【评审发现】裁掉的只能是极端值：收紧栅栏也不许让一成以上的战役贴边
    expect(sorted.filter(value => value > domain.max).length).toBeLessThanOrEqual(sorted.length * 0.1);
    expect(sorted.filter(value => value < domain.min).length).toBeLessThanOrEqual(sorted.length * 0.1);
  });

  it('【评审发现】0 压在窗口边上而边外还有战役时向外多让一格：贴边的一列画在 0 线自己那一侧', () => {
    // 主体全在 2 ~ 3，另有 3 场大亏：栅栏落在 0 以上，窗口左端被 0 钉住——贴边的三角原来会落在 0 线右边第一档（盈利区）
    const bulk = Array.from({ length: 60 }, (_, index) => 2 + index / 60);
    const domain = metricDistributionDomain([...bulk, -40, -55, -80]);
    expect(domain.min).toBeLessThan(0);
    expect(domain.min).toBeGreaterThanOrEqual(-1);
    expect(domain.ticks).toContain(0);
    // 边外没有战役时 0 照旧可以压边
    expect(metricDistributionDomain(bulk).min).toBe(0);
  });

  it('【评审发现】不足 10 场不裁：三四场战役的窗口把每一场都圈进来', () => {
    const domain = metricDistributionDomain([0.2, 0.4, 0.5, 6]);
    expect(domain.min).toBeLessThanOrEqual(0);
    expect(domain.max).toBeGreaterThanOrEqual(6);
  });

  it('远栅栏下最高一柱还是放不下时把栅栏收紧一档再试：窗口更窄、最高一柱更矮；放得下就不动', () => {
    // 主体尖在 0 上（250 场，越靠近 0 越密），另有 46 场散在 1 ~ 4：远栅栏的窗口里贴着 0 的那一列仍然太高
    const random = lcg(7);
    const values = [
      ...Array.from({ length: 250 }, () => random() ** 2.5),
      ...Array.from({ length: 46 }, () => 1 + random() * 3),
    ];
    const sorted = [...values].sort((a, b) => a - b);
    const tallestOf = (domain: { min: number; max: number }) => tallestColumnEstimate(sorted, domain.min, domain.max, DISTRIBUTION_NOMINAL_COLUMNS);
    // rows = Infinity：只用远栅栏（k = 3），不收紧
    const far = metricDistributionDomain(values, [], { rows: Number.POSITIVE_INFINITY });
    expect(tallestOf(far)).toBeGreaterThan(DISTRIBUTION_NOMINAL_ROWS);
    const fitted = metricDistributionDomain(values);
    expect(fitted.max).toBeLessThan(far.max);
    expect(tallestOf(fitted)).toBeLessThan(tallestOf(far));
    expect(fitted.ticks).toContain(0);
    // 容量够大时两者相同：收紧只在放不下时发生
    expect(metricDistributionDomain(values, [], { rows: 500 })).toEqual(far);
  });

  it('tallestColumnEstimate：窗口外的点记在最边上的一列，与图上贴边的三角同一处', () => {
    expect(tallestColumnEstimate([0.1, 0.2, 0.3, 9, 9, 9, 9], 0, 1, 10)).toBe(4);   // 四场越界都压在最右一列
    expect(tallestColumnEstimate([-5, -4, 0.55], 0, 1, 10)).toBe(2);                // 两场越界压在最左一列
    expect(tallestColumnEstimate([0.05, 0.15, 0.25], 0, 1, 10)).toBe(1);
    expect(tallestColumnEstimate([1, 2, 3], 2, 2, 10)).toBe(3);                     // 窗口塌了：全算一列
  });
});

describe('【用户要求】加仓效用的 1.00 参照：通用窗口的额外锚点', () => {
  it('不传锚点时与原来逐位相同', () => {
    const values = [-0.36, 0.1, 0.5, 1.2, 4.65];
    expect(metricDistributionDomain(values, [])).toEqual(metricDistributionDomain(values));
    expect(metricDistributionDomain(values, [0])).toEqual(metricDistributionDomain(values));
  });

  it('全部小于 1 时仍把 1 圈进窗口，而且不压在右边缘上——线外那一侧也看得见', () => {
    const domain = metricDistributionDomain([0.12, 0.3, 0.45, 0.6, 0.72], [1]);
    expect(domain.min).toBeLessThanOrEqual(0);
    expect(domain.max).toBeGreaterThan(1);
    expect(domain.ticks).toContain(1);
  });

  it('全部大于 1 时 0 与 1 都在窗口内；锚点只扩窗口，不改刻度的步距规则', () => {
    const domain = metricDistributionDomain([1.4, 1.8, 2.2, 3.1, 4.5], [1]);
    expect(domain.min).toBeLessThanOrEqual(0);
    expect(domain.max).toBeGreaterThanOrEqual(4.5);
    const steps = domain.ticks.slice(1).map((tick, index) => Number((tick - domain.ticks[index]).toFixed(6)));
    expect(new Set(steps).size).toBe(1);
  });

  it('空样本带锚点也给得出窗口，缺省仍是 [−1, 0, 1]', () => {
    expect(metricDistributionDomain([], [1]).max).toBeGreaterThan(1);
    expect(metricDistributionDomain([]).ticks).toEqual([-1, 0, 1]);
  });
});
