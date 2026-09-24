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
  extra: { excluded?: number } = {},
) {
  const onSelect = vi.fn();
  render(<CampaignMetricScatterPlot
    points={values.map((value, index) => ({
      campaignId: `c${String(index).padStart(2, '0')}`, title: `战役 ${index}`, symbol: 'TESTUSDT',
      value, sequence: index + 1, operationTime: 1_700_000_000_000 + index * 86_400_000,
      pnl: value, payoffRatio: value * 1.5,
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

describe('通用连续指标的分布图', () => {
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
