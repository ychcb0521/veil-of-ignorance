import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  CampaignMetricScatterPlot,
  type CampaignMetricDistributionSpec,
} from '../CampaignOddsScatterPlot';
import { CHART_THRESHOLD_VAR } from '@/lib/chartTokens';

/**
 * 【用户要求】涨跌幅、涨跌幅倍数、加仓效用、算术期望的分布图：与盈亏比同一套分布机制（堆叠、密度、摘要），
 * 读法（单位、0 线、正值占比、额外参照线）由 distributionSpec 给。
 */
const SIGNED_COLORS = [
  { token: 'profit', label: '绿色：> 0。' },
  { token: 'loss', label: '红色：< 0。' },
  { token: 'neutral', label: '灰色：= 0。' },
] as const;

const ADD_SPEC: CampaignMetricDistributionSpec = {
  unit: '倍',
  zeroLabel: '0.00 盈亏平衡',
  zeroMeaning: '盈亏分界',
  positiveShareLabel: '盈利',
  references: [{ value: 1, label: '1.00 加仓没有额外放大', shareLabel: '放大（> 1）' }],
};

const PRICE_SPEC: CampaignMetricDistributionSpec = {
  unit: '%',
  zeroLabel: '0% 不涨不跌',
  zeroMeaning: '涨跌分界',
  positiveShareLabel: '顺向',
};

function formatEfficiency(value: number) {
  const rounded = Number(value.toFixed(2));
  return rounded === 0 ? '0.00' : `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}`;
}

function formatPct(value: number) {
  const rounded = Number(value.toFixed(2)) + 0;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}%`;
}

function renderChart(
  values: number[],
  metricKey: string,
  spec: CampaignMetricDistributionSpec,
  axisLabel: string,
  formatValue: (value: number) => string,
  extra: { excluded?: number; payoffRatios?: Array<number | null> } = {},
) {
  const onSelect = vi.fn();
  render(<CampaignMetricScatterPlot
    points={values.map((value, index) => ({
      campaignId: `c${String(index).padStart(2, '0')}`, title: `战役 ${index}`, symbol: 'TESTUSDT',
      value, sequence: index + 1, operationTime: 1_700_000_000_000 + index * 86_400_000,
      pnl: value, payoffRatio: extra.payoffRatios ? extra.payoffRatios[index] : value * 1.5,
    }))}
    metricKey={metricKey} metricLabel={`${axisLabel}分布`} seriesLabel={`${axisLabel}分布`}
    axisLabel={axisLabel} missingValueLabel={axisLabel} view="distribution"
    formatValue={formatValue}
    guide={{ yAxis: '场数', point: '每点一场。', colors: SIGNED_COLORS }}
    distributionSpec={spec}
    excludedMissingValueCount={extra.excluded ?? 0}
    onSelectCampaign={onSelect}
  />);
  return onSelect;
}

const AMPLIFICATION_SPEC: CampaignMetricDistributionSpec = {
  unit: '倍',
  zeroLine: false,
  references: [{ value: 1, label: '1.00 没有加仓', shareLabel: '放大（> 1）' }],
};

describe('【用户要求】仓位放大的分布图：恒为正的倍数，分界在 1.00 而不在 0', () => {
  // 六场没加仓（1.00），九场放大了，其中一场 12 倍
  const values = [1, 1, 1, 1, 1, 1, 1.2, 1.5, 1.8, 2.2, 2.6, 3.1, 3.5, 4.2, 12];
  const formatAmplification = (value: number) => `${value.toFixed(2)}x`;
  const KEY = 'positionAmplificationDistribution';

  it('不画 0 线、不报正值占比；1.00 参照线照画，摘要条报放大了的场数占比', () => {
    renderChart(values, KEY, AMPLIFICATION_SPEC, '仓位放大', formatAmplification);
    expect(document.querySelectorAll('button[data-campaign-id]')).toHaveLength(values.length);
    expect(screen.queryByTestId(`campaign-metric-break-even-${KEY}`)).toBeNull();
    expect(screen.queryByTestId(`campaign-metric-win-rate-${KEY}`)).toBeNull();
    const reference = screen.getByTestId(`campaign-metric-reference-${KEY}-1`);
    expect(reference).toHaveAttribute('data-reference-kind', 'threshold');
    expect(screen.getByTestId(`campaign-metric-reference-${KEY}-1-label`)).toHaveTextContent('1.00 没有加仓');
    expect(screen.getByTestId(`campaign-metric-reference-share-${KEY}-1`)).toHaveTextContent('放大（> 1） 60% (9/15)');
    const summary = screen.getByTestId(`campaign-metric-summary-${KEY}`);
    expect(summary).toHaveTextContent('范围 1.00x – 12.00x');
    expect(summary).toHaveTextContent('中位数 1.50x');
    // 省掉正值占比时连它前面的分隔线一起省：均值后面紧跟的就是「放大」，没有连着两条分隔线
    expect(summary.textContent).toMatch(/均值 [\d.]+x\|放大（> 1）/);
    expect(summary.textContent).not.toMatch(/\|\s*\|/);
  });

  it('恰好 1.00 的战役贴在参照线右侧，放大了的在它右边；读数与点击照旧', () => {
    const onSelect = renderChart(values, KEY, AMPLIFICATION_SPEC, '仓位放大', formatAmplification);
    const point = (index: number) => screen.getByTestId(`campaign-metric-point-${KEY}-c${String(index).padStart(2, '0')}`);
    const left = (index: number) => Number.parseFloat(point(index).style.left);
    // 六场 1.00 落在同一档
    expect(new Set([0, 1, 2, 3, 4, 5].map(index => point(index).style.left)).size).toBe(1);
    expect(left(6)).toBeGreaterThan(left(0));
    expect(left(13)).toBeGreaterThan(left(6));
    values.forEach((value, index) => expect(point(index)).toHaveAttribute('data-metric-value', String(value)));
    fireEvent.focus(point(7));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('1.50x');
    fireEvent.click(point(7));
    expect(onSelect).toHaveBeenCalledWith('c07');
  });

  it('说明面板不提 0：窗口圈进来的是参照值 1.00，档边界也是它', () => {
    renderChart(values, KEY, AMPLIFICATION_SPEC, '仓位放大', formatAmplification);
    fireEvent.click(screen.getByRole('button', { name: /说明|读图/ }));
    const text = document.body.textContent ?? '';
    expect(text).toContain('无论如何把参照值 1.00x 圈在窗口内');
    expect(text).toContain('1.00x 是档边界，点位不会吸附到参考线的另一侧');
    expect(text).not.toContain('档网格锚在 0 上');
  });
});

describe('通用连续指标的分布图', () => {
  it('涨幅未兑现同一区间内红绿连续分层，盈利在上、亏损在下，保留真实数值与战役点击', () => {
    const values = [5.1, 5.1001, 5.1002, 5.1003, 5.1004, 5.1005, 50];
    const onSelect = renderChart(values, 'unrealizedPriceChangePctDistribution', PRICE_SPEC, '涨幅未兑现', formatPct, {
      payoffRatios: [2, -1, 0, 1, -2, null, 3],
    });
    const point = (index: number) => screen.getByTestId(`campaign-metric-point-unrealizedPriceChangePctDistribution-c${String(index).padStart(2, '0')}`);
    const top = (index: number) => Number.parseFloat(point(index).style.top);
    expect(new Set(values.slice(0, 6).map((_, index) => point(index).style.left)).size).toBe(1);
    expect(Math.max(top(0), top(3))).toBeLessThan(Math.min(top(2), top(5)));
    expect(Math.max(top(2), top(5))).toBeLessThan(Math.min(top(1), top(4)));
    expect(point(0)).toHaveAttribute('data-series-token', 'profit');
    expect(point(1)).toHaveAttribute('data-series-token', 'loss');
    expect(point(2)).toHaveAttribute('data-series-token', 'neutral');
    expect(document.querySelectorAll('button[data-campaign-id]')).toHaveLength(values.length);
    values.forEach((value, index) => expect(point(index)).toHaveAttribute('data-metric-value', String(value)));
    fireEvent.focus(point(1));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('+5.10% · b -1.00R');
    fireEvent.click(point(1));
    expect(onSelect).toHaveBeenCalledWith('c01');
  });

  // 加仓效用的真实形状：主群 0.3~2.5，几场亏损（负值）、一场恰为 0、一场恰为 1、一个 +18 的离群值
  const addValues = [
    -2.4, -1.1, -0.35, 0, 0.18, 0.32, 0.41, 0.55, 0.62, 0.7, 0.78, 0.84, 0.9, 0.96, 1,
    1.04, 1.1, 1.18, 1.25, 1.33, 1.42, 1.5, 1.61, 1.75, 1.9, 2.05, 2.3, 2.6, 3.1, 3.8,
    0.66, 0.88, 1.12, 1.27, 1.48, 0.52, 0.73, 1.05, 1.36, 18,
  ];

  it('加仓效用：1.00 参照线（琥珀虚线）与 0 线并存，两条线都是档边界，点位不跨线', () => {
    const onSelect = renderChart(addValues, 'addEfficiencyDistribution', ADD_SPEC, '加仓效用', formatEfficiency, { excluded: 7 });
    const root = screen.getByTestId('campaign-metric-scatter-plot');
    expect(root.querySelectorAll('button[data-campaign-id]').length).toBe(addValues.length);

    const reference = screen.getByTestId('campaign-metric-reference-addEfficiencyDistribution-1');
    expect(reference).toHaveAttribute('data-reference-kind', 'threshold');
    expect(reference.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(reference).toHaveStyle({ stroke: CHART_THRESHOLD_VAR });
    expect(screen.getByTestId('campaign-metric-reference-addEfficiencyDistribution-1-label')).toHaveTextContent('1.00 加仓没有额外放大');
    const zero = screen.getByTestId('campaign-metric-break-even-addEfficiencyDistribution');
    expect(zero).toHaveAttribute('data-reference-kind', 'zero');
    expect(zero.getAttribute('stroke-dasharray')).toBeNull();
    expect(screen.getByTestId('campaign-metric-break-even-addEfficiencyDistribution-label')).toHaveTextContent('0.00 盈亏平衡');
    // 两个标签分在各自线的两侧，不叠
    const zeroLabel = screen.getByTestId('campaign-metric-break-even-addEfficiencyDistribution-label');
    const referenceLabel = screen.getByTestId('campaign-metric-reference-addEfficiencyDistribution-1-label');
    expect(zeroLabel).toHaveAttribute('text-anchor', 'end');
    expect(referenceLabel).toHaveAttribute('text-anchor', 'start');

    const zeroX = Number(zero.getAttribute('x1'));
    const oneX = Number(reference.getAttribute('x1'));
    expect(zeroX).toBeLessThan(oneX);
    const buttons = [...root.querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    for (const button of buttons) {
      const value = Number(button.dataset.metricValue);
      const left = Number.parseFloat(button.style.left);
      if (value < 0) expect(left).toBeLessThan(zeroX);
      else if (value < 1) {
        expect(left).toBeGreaterThan(zeroX);
        expect(left).toBeLessThan(oneX);
      } else expect(left).toBeGreaterThan(oneX);
    }
    // 着色按正负：绿圆、红菱、灰空心圈
    const byValue = (value: number) => buttons.find(button => Number(button.dataset.metricValue) === value)!;
    expect(byValue(-1.1)).toHaveAttribute('data-series-token', 'loss');
    expect(byValue(-1.1)).toHaveAttribute('data-marker-shape', 'diamond');
    expect(byValue(0)).toHaveAttribute('data-series-token', 'neutral');
    expect(byValue(0)).toHaveAttribute('data-marker-shape', 'ring');
    expect(byValue(1.5)).toHaveAttribute('data-series-token', 'profit');
    expect(byValue(1.5)).toHaveAttribute('data-marker-shape', 'circle');

    // 两端的离群值（左尾 −2.4 在 p2 之外、右尾 +18）贴边画成三角，数值、提示框与点击照旧
    expect(screen.getByText(/2 个点位超出显示区间，已贴边标记/)).toBeInTheDocument();
    const outlier = byValue(18);
    fireEvent.focus(outlier);
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('+18.00 · b +27.00R');
    fireEvent.click(outlier);
    expect(onSelect).toHaveBeenCalledWith(outlier.dataset.campaignId);

    // 摘要：范围 / 中位数 / 均值 / 盈利占比 / 放大占比
    const summary = screen.getByTestId('campaign-metric-summary-addEfficiencyDistribution');
    expect(summary).toHaveTextContent('范围 -2.40 – +18.00');
    expect(summary).toHaveTextContent('中位数');
    expect(summary).toHaveTextContent('均值');
    const positives = addValues.filter(value => value > 0).length;
    const amplified = addValues.filter(value => value > 1).length;
    expect(screen.getByTestId('campaign-metric-win-rate-addEfficiencyDistribution'))
      .toHaveTextContent(`盈利 ${Math.round((positives / addValues.length) * 100)}% (${positives}/${addValues.length})`);
    expect(screen.getByTestId('campaign-metric-reference-share-addEfficiencyDistribution-1'))
      .toHaveTextContent(`放大（> 1） ${Math.round((amplified / addValues.length) * 100)}% (${amplified}/${addValues.length})`);
    expect(summary).not.toHaveTextContent('胜率');
    expect(summary).not.toHaveTextContent('右尾');
    expect(screen.getByTestId('campaign-metric-density-curve-addEfficiencyDistribution').getAttribute('d')).toMatch(/^M /);
    expect(screen.getByTestId('campaign-metric-density-curve-addEfficiencyDistribution').getAttribute('d')).not.toMatch(/NaN|Infinity/);

    // 图下：方向提示带单位；缺值脚注与其它图同一格式
    expect(screen.getByText(/横轴 加仓效用（倍） · 纵轴 场数 · 不按时间排列/)).toBeInTheDocument();
    expect(screen.getByText(/未绘制：无加仓效用 7 场/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-addEfficiencyDistribution'));
    const guide = screen.getByTestId('campaign-metric-guide-addEfficiencyDistribution');
    expect(guide).toHaveTextContent('横轴就是加仓效用本身（单位 倍）');
    expect(guide).toHaveTextContent('把盈亏分界 0 与参照值 1.00 圈在窗口内');
    expect(guide).toHaveTextContent('1.00 也是档边界，点位不会吸附到参考线或盈亏分界的另一侧；恰好落在线上的归右侧');
    expect(guide).not.toHaveTextContent('归零线');
  });

  it('全部小于 1 时也把 1.00 参照线留在视野里，线右那一侧看得出「一场都没放大」', () => {
    renderChart([0.2, 0.35, 0.5, 0.62, 0.7, 0.81], 'addEfficiencyDistribution', ADD_SPEC, '加仓效用', formatEfficiency);
    const reference = screen.getByTestId('campaign-metric-reference-addEfficiencyDistribution-1');
    const buttons = [...screen.getByTestId('campaign-metric-scatter-plot').querySelectorAll<HTMLElement>('button[data-campaign-id]')];
    const oneX = Number(reference.getAttribute('x1'));
    expect(buttons.every(button => Number.parseFloat(button.style.left) < oneX)).toBe(true);
    // 线在绘图区内部，而不是压在右边缘（绘图区是图里最宽的那张 svg，图例小图标也带 width）
    const plotWidth = Math.max(...[...screen.getByTestId('campaign-metric-scatter-plot').querySelectorAll('svg[width]')]
      .map(node => Number(node.getAttribute('width'))));
    expect(oneX).toBeLessThan(plotWidth - 40);
    expect(screen.getByTestId('campaign-metric-reference-share-addEfficiencyDistribution-1')).toHaveTextContent('放大（> 1） 0% (0/6)');
  });

  it('涨跌幅：0% 线叫「不涨不跌」，刻度去掉小数尾零，摘要报「顺向」', () => {
    const pctValues = [
      -18.4, -9.2, -6.5, -3.1, -1.4, 0, 0.8, 2.2, 3.9, 5.1, 6.6, 7.4, 8.8, 10.5, 12.1, 14.8,
      16.2, 19.5, 22.4, 25.9, 31.2, 38.7, 44.1, 52.6, 61.3, 4.4, 9.7, 11.9, -2.6, 13.3, 17.7, 26.4,
      3.3, 6.1, 8.2, 20.8, -4.8, 1.9, 15.5, 437.2,
    ];
    renderChart(pctValues, 'mainPriceChangeDistribution', PRICE_SPEC, '涨跌幅', formatPct);
    expect(screen.getByTestId('campaign-metric-break-even-mainPriceChangeDistribution-label')).toHaveTextContent('0% 不涨不跌');
    expect(screen.queryByTestId(/campaign-metric-reference-mainPriceChangeDistribution/)).toBeNull();
    const root = screen.getByTestId('campaign-metric-scatter-plot');
    const tickTexts = [...root.querySelectorAll('span.absolute.whitespace-nowrap.pt-1')].map(node => node.textContent ?? '');
    expect(tickTexts).toContain('0%');
    expect(tickTexts.length).toBeGreaterThanOrEqual(4);
    expect(tickTexts.every(text => /^[-+]?\d+(\.\d*[1-9])?%$/.test(text))).toBe(true);
    const positives = pctValues.filter(value => value > 0).length;
    expect(screen.getByTestId('campaign-metric-win-rate-mainPriceChangeDistribution'))
      .toHaveTextContent(`顺向 ${Math.round((positives / pctValues.length) * 100)}% (${positives}/${pctValues.length})`);
    expect(screen.getByTestId('campaign-metric-summary-mainPriceChangeDistribution')).toHaveTextContent('范围 -18.40% – +437.20%');
    expect(screen.getByText(/横轴 涨跌幅（%） · 纵轴 场数 · 不按时间排列/)).toBeInTheDocument();
    // 0 恰好是档边界：0% 那一场（灰）落在 0 线右侧，负涨跌幅全在左侧
    const zeroX = Number(screen.getByTestId('campaign-metric-break-even-mainPriceChangeDistribution').getAttribute('x1'));
    for (const button of root.querySelectorAll<HTMLElement>('button[data-campaign-id]')) {
      const value = Number(button.dataset.metricValue);
      const left = Number.parseFloat(button.style.left);
      if (value < 0) expect(left).toBeLessThan(zeroX);
      else expect(left).toBeGreaterThan(zeroX);
    }
    fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-mainPriceChangeDistribution'));
    const guide = screen.getByTestId('campaign-metric-guide-mainPriceChangeDistribution');
    expect(guide).toHaveTextContent('把涨跌分界 0 圈在窗口内');
    expect(guide).toHaveTextContent('档网格锚在 0 上，涨跌分界两侧的点不会混进同一档');
  });
});

describe('【用户要求】散点颜色按这一场的盈亏比 b 的正负分，不按图上的指标', () => {
  it('指标为正、b 为负 → 红菱；指标为负、b 为正 → 绿圆；算不出 b → 灰圈', () => {
    render(<CampaignMetricScatterPlot
      points={[
        { campaignId: 'up-loss', title: '涨了却亏', symbol: 'TESTUSDT', value: 0.04, sequence: 1, operationTime: 1_700_000_000_000, pnl: -2, payoffRatio: -0.02 },
        { campaignId: 'down-win', title: '跌了却赚', symbol: 'TESTUSDT', value: -0.5, sequence: 2, operationTime: 1_700_086_400_000, pnl: 30, payoffRatio: 1.2 },
        { campaignId: 'no-b', title: '算不出 b', symbol: 'TESTUSDT', value: 2, sequence: 3, operationTime: 1_700_172_800_000, pnl: null, payoffRatio: null },
      ]}
      metricKey="mainPriceEfficiency" metricLabel="涨跌幅倍数" seriesLabel="涨跌幅倍数时序"
      axisLabel="涨跌幅倍数" missingValueLabel="涨跌幅倍数"
      formatValue={formatEfficiency}
      guide={{ yAxis: '倍数', point: '每点一场。', colors: SIGNED_COLORS }}
      onSelectCampaign={vi.fn()}
    />);
    const point = (id: string) => screen.getByTestId(`campaign-metric-point-mainPriceEfficiency-${id}`);
    expect(point('up-loss')).toHaveAttribute('data-series-token', 'loss');
    expect(point('up-loss')).toHaveAttribute('data-marker-shape', 'diamond');
    expect(point('down-win')).toHaveAttribute('data-series-token', 'profit');
    expect(point('down-win')).toHaveAttribute('data-marker-shape', 'circle');
    expect(point('no-b')).toHaveAttribute('data-series-token', 'neutral');
  });
});

describe('【用户要求】加仓效用分布：涨跌幅倍数为负的战役从 0 线往下镜像堆', () => {
  it('stackBelow 的点画在 0 线下方、上下各有一条密度曲线、下半轴刻度写场数', () => {
    const values = [0.4, 0.8, 1.1, 1.3, 1.6, 2.2, 0.9, 1.2];
    render(<CampaignMetricScatterPlot
      points={values.map((value, index) => ({
        campaignId: `c${index}`, title: `战役 ${index}`, symbol: 'TESTUSDT', value, sequence: index + 1,
        operationTime: 1_700_000_000_000 + index * 86_400_000,
        // 后三场涨跌幅倍数为负：b 与 η 都为负，读数为正，从 0 线往下堆
        pnl: index >= 5 ? -value : value, payoffRatio: index >= 5 ? -value : value, stackBelow: index >= 5,
      }))}
      metricKey="addEfficiencyDistribution" metricLabel="加仓效用分布" seriesLabel="加仓效用分布"
      axisLabel="加仓效用" missingValueLabel="加仓效用" view="distribution" formatValue={formatEfficiency}
      guide={{ yAxis: '场数', point: '每点一场。', colors: SIGNED_COLORS }}
      distributionSpec={ADD_SPEC}
      onSelectCampaign={vi.fn()}
    />);
    const top = (id: string) => Number.parseFloat(screen.getByTestId(`campaign-metric-point-addEfficiencyDistribution-${id}`).style.top);
    const zeroTick = document.querySelector('[data-grid-value="0"]');
    expect(zeroTick).not.toBeNull();
    // 往上堆的都在往下堆的上方（top% 越小越靠上）
    const upTops = ['c0', 'c1', 'c2', 'c3', 'c4'].map(top);
    const downTops = ['c5', 'c6', 'c7'].map(top);
    expect(Math.max(...upTops)).toBeLessThan(Math.min(...downTops));
    // 颜色仍按 b：往下堆的三场 b 为负 → 红菱
    expect(screen.getByTestId('campaign-metric-point-addEfficiencyDistribution-c6')).toHaveAttribute('data-series-token', 'loss');
    // 两条密度曲线，下半轴有负的网格值
    expect(screen.getByTestId('campaign-metric-density-curve-addEfficiencyDistribution')).toBeInTheDocument();
    expect(screen.getByTestId('campaign-metric-density-curve-below-addEfficiencyDistribution')).toBeInTheDocument();
    expect(document.querySelector('[data-grid-value^="-"]')).not.toBeNull();
  });
});

describe('【用户要求】柱状散点图盈亏泾渭分明：加仓次数、自评', () => {
  const renderBars = (metricKey: string, rows: Array<[string, number, number]>) => render(<CampaignMetricScatterPlot
    points={rows.map(([id, value, b], index) => ({
      campaignId: id, title: id, symbol: 'TESTUSDT', value, sequence: index + 1,
      operationTime: 1_700_000_000_000 + index * 86_400_000, pnl: b * 10, payoffRatio: b,
    }))}
    metricKey={metricKey} metricLabel={metricKey} seriesLabel={metricKey} axisLabel={metricKey} missingValueLabel={metricKey}
    view="bars" formatValue={value => `${Math.round(value)} 次`}
    guide={{ yAxis: '场数', point: '每点一场。', colors: SIGNED_COLORS }}
    onSelectCampaign={vi.fn()}
  />);
  const top = (metricKey: string, id: string) => Number.parseFloat(
    screen.getByTestId(`campaign-metric-point-${metricKey}-${id}`).style.top,
  );

  it('加仓次数：0 次到最多那一档逐次一根柱，缺的次数留空柱；柱内亏损都在盈利下方', () => {
    // 2 次没有战役，柱子照留；1 次那根柱里两亏两赚（输入顺序故意交错）
    renderBars('addCountBars', [
      ['z', 0, 0.5], ['w1', 1, 2], ['l1', 1, -0.8], ['w2', 1, 0.3], ['l2', 1, -2.5], ['t', 3, 1.2],
    ]);
    const columns = [...document.querySelectorAll('[data-testid^="chart-category-count-"]')]
      .map(node => node.getAttribute('data-testid')!.replace('chart-category-count-', ''));
    expect(columns).toEqual(['0', '1', '2', '3']);
    expect(screen.getByTestId('chart-category-count-2')).toHaveTextContent('0');
    // top% 越大越靠下：两场亏损都在两场盈利下方
    expect(Math.min(top('addCountBars', 'l1'), top('addCountBars', 'l2')))
      .toBeGreaterThan(Math.max(top('addCountBars', 'w1'), top('addCountBars', 'w2')));
  });

  it('自评柱状同样盈亏分开码放', () => {
    renderBars('importanceBars', [
      ['w1', 4, 1.5], ['l1', 4, -0.4], ['w2', 4, 0.2], ['l2', 4, -1.1],
    ]);
    expect(Math.min(top('importanceBars', 'l1'), top('importanceBars', 'l2')))
      .toBeGreaterThan(Math.max(top('importanceBars', 'w1'), top('importanceBars', 'w2')));
  });
});
