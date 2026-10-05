import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CampaignMetricScatterPlot } from '../CampaignOddsScatterPlot';

/**
 * 【用户要求】散点图要看得清分布的比例：几场极端值不能把坐标轴撑开几十倍、把主体挤成一柱 / 一条线。
 * 窗口留给主体，极端值贴边画成三角并报数——与盈亏比分布（+10R 封顶）同一个思路，推广到所有图。
 */
type ChartProps = Parameters<typeof CampaignMetricScatterPlot>[0];

function points(values: number[]): ChartProps['points'] {
  return values.map((value, index) => ({
    campaignId: `c${index}`, title: `战役 ${index}`, symbol: 'TESTUSDT',
    value, sequence: index + 1, operationTime: 1_700_000_000_000 + index, payoffRatio: value * 2 + 1,
  }));
}

const BASE: Omit<ChartProps, 'points' | 'metricKey' | 'view'> = {
  metricLabel: '算术期望', seriesLabel: '算术期望', missingValueLabel: '算术期望',
  formatValue: value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}R`,
  guide: { yAxis: '算术期望', point: '每点一场', colors: [
    { token: 'profit', label: '盈利' }, { token: 'loss', label: '亏损' }, { token: 'neutral', label: '持平' },
  ] },
  distributionSpec: { unit: 'R', zeroLabel: '0R 盈亏平衡', zeroMeaning: '盈亏分界', positiveShareLabel: '正期望' },
  onSelectCampaign: () => {},
};

/** 用户账户的形状：过半数贴着 0，几场上百 R。确定性的，不用随机数。 */
function heavyTailed() {
  const body = Array.from({ length: 250 }, (_, index) => -1.5 + (index % 125) * 0.024 + (index % 7) * 0.01);   // −1.5 ~ +1.6
  const tail = [4.5, 6, 8, 11, 14, 19, 25, 33, 47, 62, 88, 125];
  return [...body, ...tail];
}

const tickValues = (testId: string) => screen.getAllByTestId(testId).map(node => Number(node.getAttribute('data-tick-value')));

describe('【用户要求】坐标轴留给主体，极端值贴边', () => {
  it('分布图：横轴窗口只有几个 R 宽（原来开到 +30R 以上），尾部贴边报数，主体不再挤进一两档', () => {
    const values = heavyTailed();
    render(<CampaignMetricScatterPlot {...BASE} points={points(values)} metricKey="arithmeticExpectancyDistribution" view="distribution" />);
    const plot = screen.getByTestId('campaign-metric-scatter-plot');
    const buttons = [...plot.querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    expect(buttons).toHaveLength(values.length);
    // 没有合并三角，行距没有被压到点位相互压住（≥ 12px）
    expect(screen.queryByTestId('chart-stack-overflow')).not.toBeInTheDocument();
    expect(Number(screen.getByTestId('campaign-metric-scroll-area').getAttribute('data-stack-pitch'))).toBeGreaterThanOrEqual(12);
    // 主体铺开在很多列上，而不是一两列
    const columns = new Map<string, number>();
    for (const button of buttons) columns.set(button.style.left, (columns.get(button.style.left) ?? 0) + 1);
    expect(columns.size).toBeGreaterThan(20);
    expect(Math.max(...columns.values())).toBeLessThanOrEqual(40);
    // 尾部贴边、如实报数
    expect(plot.textContent).toMatch(/\d+ 个点位超出显示区间，已贴边标记/);
  });

  it('时序图：纵轴停在主体上方的栅栏处，越过它的点贴在上边缘；各档场数之和仍等于总场数', () => {
    const values = heavyTailed();
    render(<CampaignMetricScatterPlot {...BASE} points={points(values)} metricKey="arithmeticExpectancy" view="time" />);
    const ticks = tickValues('campaign-metric-y-tick-arithmeticExpectancy');
    expect(Math.max(...ticks)).toBeLessThan(15);          // 原来是 150 上下：其余的点全压在 0 附近一条线上
    expect(Math.min(...ticks)).toBeGreaterThanOrEqual(-4);
    const plot = screen.getByTestId('campaign-metric-scatter-plot');
    const clamped = Number(/(\d+) 个点位超出显示区间/.exec(plot.textContent ?? '')?.[1]);
    expect(clamped).toBeGreaterThanOrEqual(8);
    expect(clamped).toBeLessThanOrEqual(12);
    // 贴边的点算进最上面一档，并在读屏标签里说明
    const bands = screen.getAllByTestId('campaign-metric-band-count');
    const total = bands.reduce((sum, band) => sum + Number(/n=(\d+)/.exec(band.textContent ?? '')?.[1] ?? 0), 0);
    expect(total).toBe(values.length);
    expect(bands.some(band => new RegExp(`及以上（含贴边的 ${clamped} 场）`).test(band.getAttribute('aria-label') ?? ''))).toBe(true);
    // 每一场仍是一个可点的点
    expect(plot.querySelectorAll('button[data-campaign-id]')).toHaveLength(values.length);
  });

  it('没有离群值时一个点都不贴边，纵轴与原来一样留边距', () => {
    const values = Array.from({ length: 60 }, (_, index) => -1 + index * 0.05);     // −1 ~ +1.95 均匀
    render(<CampaignMetricScatterPlot {...BASE} points={points(values)} metricKey="arithmeticExpectancy" view="time" />);
    const plot = screen.getByTestId('campaign-metric-scatter-plot');
    expect(plot.textContent).not.toMatch(/超出显示区间/);
    const ticks = tickValues('campaign-metric-y-tick-arithmeticExpectancy');
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(1.95);
    expect(Math.min(...ticks)).toBeLessThanOrEqual(-1);
    for (const band of screen.getAllByTestId('campaign-metric-band-count')) {
      expect(band.getAttribute('aria-label') ?? '').not.toContain('贴边');
    }
  });

  it('【评审发现】只有几场战役时不裁：四场里最大的那一场不是离群值，照常画在轴内', () => {
    render(<CampaignMetricScatterPlot {...BASE} points={points([0.2, 0.3, 0.5, 9])} metricKey="arithmeticExpectancy" view="time" />);
    const plot = screen.getByTestId('campaign-metric-scatter-plot');
    expect(plot.textContent).not.toMatch(/超出显示区间/);
    expect(Math.max(...tickValues('campaign-metric-y-tick-arithmeticExpectancy'))).toBeGreaterThanOrEqual(9);
    for (const band of screen.getAllByTestId('campaign-metric-band-count')) {
      expect(band.getAttribute('aria-label') ?? '').not.toContain('贴边');
    }
  });

  it('【评审发现】取值只有几种的计数指标（加仓次数）不裁：多数场 0 次时 3 次、5 次不是离群值', () => {
    const values = [...Array.from({ length: 40 }, () => 0), ...Array.from({ length: 8 }, () => 1), 2, 2, 3, 5];
    render(<CampaignMetricScatterPlot {...BASE} metricLabel="加仓次数" seriesLabel="加仓次数" missingValueLabel="加仓次数"
      formatValue={value => `${value} 次`} points={points(values)} metricKey="addCount" view="time" />);
    expect(screen.getByTestId('campaign-metric-scatter-plot').textContent).not.toMatch(/超出显示区间/);
    expect(Math.max(...tickValues('campaign-metric-y-tick-addCount'))).toBeGreaterThanOrEqual(5);
  });

  it('【评审发现】每一侧最多约一成贴边：亏损都挤在 −1R、盈利散得很开时，盈利的点大半仍画在轴内', () => {
    const losses = Array.from({ length: 40 }, (_, index) => -1 + index * 0.0025);
    const wins = Array.from({ length: 10 }, (_, index) => 1 + index * 5);
    const values = [...losses, ...wins];
    render(<CampaignMetricScatterPlot {...BASE} points={points(values)} metricKey="arithmeticExpectancy" view="time" />);
    const plot = screen.getByTestId('campaign-metric-scatter-plot');
    const clamped = Number(/(\d+) 个点位超出显示区间/.exec(plot.textContent ?? '')?.[1] ?? 0);
    expect(clamped).toBeLessThanOrEqual(5);               // 50 场的一成；原来 10 场盈利全部贴边
    const ticks = tickValues('campaign-metric-y-tick-arithmeticExpectancy');
    expect(ticks).toContain(0);                           // 有正有负：0 线在图上
    expect(Math.max(...ticks)).toBeGreaterThanOrEqual(20);
  });

  it('【评审发现】有正有负时 0 线一定留在图上，而且不压在边上：主体远离 0、另一侧只有几场极端值', () => {
    const values = [...Array.from({ length: 40 }, (_, index) => 5 + index * 0.025), -60, -90];
    render(<CampaignMetricScatterPlot {...BASE} points={points(values)} metricKey="arithmeticExpectancy" view="time" />);
    const plot = screen.getByTestId('campaign-metric-scatter-plot');
    expect(plot.textContent).toMatch(/2 个点位超出显示区间，已贴边标记/);
    const ticks = screen.getAllByTestId('campaign-metric-y-tick-arithmeticExpectancy');
    const zero = ticks.find(node => Number(node.getAttribute('data-tick-value')) === 0);
    expect(zero).toBeDefined();
    // 0 线离下边缘至少一成：贴在下边缘的两场不会被读成「0」
    expect(Number.parseFloat(zero!.style.top)).toBeLessThan(92);
    expect(Math.max(...ticks.map(node => Number(node.getAttribute('data-tick-value'))))).toBeLessThan(10);
  });

  it('【评审发现】栅栏只比 0 低一点点（−0.05）时 0 线同样不压边；最低的点就在边距里面时这一侧干脆不裁', () => {
    // Q1 − 3·IQR = 3.1 − 3.15 = −0.05：原来轴的下端就停在 −0.05，0 线离下边缘不到 1%
    const nearZero = [...Array.from({ length: 40 }, (_, index) => 2.7 + index * 0.05), -60, -90];
    const first = render(<CampaignMetricScatterPlot {...BASE} points={points(nearZero)} metricKey="arithmeticExpectancy" view="time" />);
    const zero = screen.getAllByTestId('campaign-metric-y-tick-arithmeticExpectancy').find(node => Number(node.getAttribute('data-tick-value')) === 0);
    expect(zero).toBeDefined();
    expect(Number.parseFloat(zero!.style.top)).toBeLessThan(92);
    expect(screen.getByTestId('campaign-metric-scatter-plot').textContent).toMatch(/2 个点位超出显示区间，已贴边标记/);
    first.unmount();
    // 唯一的负值只有 −0.01：不是极端值，画在轴内，不报贴边
    const barelyNegative = [...Array.from({ length: 40 }, (_, index) => 96.1 + index * 0.1), -0.01];
    render(<CampaignMetricScatterPlot {...BASE} points={points(barelyNegative)} metricKey="arithmeticExpectancy" view="time" />);
    expect(screen.getByTestId('campaign-metric-scatter-plot').textContent).not.toMatch(/超出显示区间/);
  });

  it('【评审发现】右侧各档的「含贴边的 N 场」与脚注的贴边场数一致：恰在轴端点上的那一场不算贴边', () => {
    const losses = Array.from({ length: 40 }, (_, index) => -1 + index * 0.0025);
    const wins = Array.from({ length: 10 }, (_, index) => 1.1234567890123 + index * 5);       // 轴上端 = p90 = 21.1234567890123
    const values = [...losses, ...wins];
    render(<CampaignMetricScatterPlot {...BASE} points={points(values)} metricKey="arithmeticExpectancy" view="time" />);
    const plot = screen.getByTestId('campaign-metric-scatter-plot');
    const clamped = Number(/(\d+) 个点位超出显示区间/.exec(plot.textContent ?? '')?.[1]);
    expect(clamped).toBe(5);
    const bands = screen.getAllByTestId('campaign-metric-band-count');
    const edgeLabels = bands.map(band => band.getAttribute('aria-label') ?? '').filter(label => label.includes('贴边'));
    expect(edgeLabels).toHaveLength(1);
    expect(edgeLabels[0]).toContain('含贴边的 5 场');
    expect(bands.reduce((sum, band) => sum + Number(/n=(\d+)/.exec(band.textContent ?? '')?.[1] ?? 0), 0)).toBe(values.length);
  });

  it('【评审发现】分布图：恰在窗口端点上、带浮点尾差的样本（12 × 0.1 = 1.2000000000000002）不算越界', () => {
    const values = Array.from({ length: 13 }, (_, index) => index * 0.1);
    expect(values[12]).toBeGreaterThan(1.2);
    render(<CampaignMetricScatterPlot {...BASE} points={points(values)} metricKey="arithmeticExpectancyDistribution" view="distribution" />);
    const plot = screen.getByTestId('campaign-metric-scatter-plot');
    expect(plot.querySelectorAll('button[data-campaign-id]')).toHaveLength(13);
    expect(plot.textContent).not.toMatch(/超出显示区间/);
  });

  it('盈亏比时序图同样不被极端值撑开，−1R 止损线仍在视野里', () => {
    const values = [...Array.from({ length: 120 }, (_, index) => -1.2 + (index % 60) * 0.06), 40, 95, 180, 260];
    render(<CampaignMetricScatterPlot {...BASE} points={points(values)} metricKey="odds" metricLabel="盈亏比" seriesLabel="盈亏比" missingValueLabel="盈亏比" view="time" legacyOddsTestIds />);
    const ticks = tickValues('campaign-odds-y-tick');
    expect(Math.max(...ticks)).toBeLessThan(20);
    expect(screen.getByTestId('campaign-odds-loss-boundary-line')).toBeInTheDocument();
    expect(screen.getByTestId('campaign-odds-scatter-plot').textContent).toMatch(/4 个点位超出显示区间，已贴边标记/);
  });
});
