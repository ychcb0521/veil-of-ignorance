import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CampaignMetricScatterPlot, type CampaignMetricChartView } from '../CampaignOddsScatterPlot';

function renderChart(values: number[], {
  view = 'distribution',
  metricKey = view === 'distribution' ? 'oddsDistribution' : 'odds',
}: { view?: CampaignMetricChartView; metricKey?: string } = {}) {
  const onSelect = vi.fn();
  render(<CampaignMetricScatterPlot
    points={values.map((value, index) => ({
      campaignId: `c${index}`, title: `战役 ${index}`, symbol: 'TESTUSDT',
      value, payoffRatio: value, sequence: index + 1,
      operationTime: 1_700_000_000_000 + index,
    }))}
    metricKey={metricKey} metricLabel="盈亏比" seriesLabel="盈亏比"
    axisLabel="盈亏比" missingValueLabel="盈亏比" view={view}
    formatValue={value => `${value.toFixed(2)}R`}
    guide={{ yAxis: '盈亏比', point: '每点一场', colors: [
      { token: 'profit', label: '盈利' }, { token: 'loss', label: '亏损' }, { token: 'neutral', label: '持平' },
    ] }}
    onSelectCampaign={onSelect}
  />);
  return {
    onSelect,
    point: (index: number) => screen.getByTestId(`campaign-metric-point-${metricKey}-c${index}`),
    boundary: () => screen.getByTestId(`campaign-metric-capital-ruin-${metricKey}`),
  };
}

describe('盈亏比分布的固定 10% 下注归零界限', () => {
  it('包含 −10 等号，硬分档让临界值两侧的散点不跨过黄线', () => {
    const { point, boundary } = renderChart([-10.01, -10, -9.99, -1, 0, 1]);
    const line = boundary();
    expect(line).toHaveAttribute('data-reference-value', '-10');
    expect(line).toHaveAttribute('data-reference-kind', 'threshold');
    expect(line).toHaveAttribute('data-reference-axis', 'x');
    expect(line).toHaveStyle({ stroke: 'var(--chart-threshold)' });
    expect(line.getAttribute('x1')).toBe(line.getAttribute('x2'));
    const boundaryX = Number(line.getAttribute('x1'));
    expect(parseFloat(point(0).style.left)).toBeLessThan(boundaryX);
    expect(parseFloat(point(1).style.left)).toBeLessThan(boundaryX);
    expect(parseFloat(point(2).style.left)).toBeGreaterThan(boundaryX);
    for (const index of [0, 1]) {
      expect(point(index)).toHaveAttribute('data-capital-ruin', 'true');
      expect(point(index)).toHaveAttribute('data-series-id', 'capital-ruin');
      expect(point(index)).toHaveAttribute('data-marker-shape', 'square');
      expect(point(index)).toHaveAttribute('data-series-token', 'loss');
      expect(screen.getByTestId(`chart-warning-ring-c${index}`)).toHaveStyle({ stroke: 'var(--chart-threshold)' });
    }
    expect(point(2)).toHaveAttribute('data-capital-ruin', 'false');
    expect(point(2)).toHaveAttribute('data-marker-shape', 'diamond');
    expect(screen.queryByTestId('chart-warning-ring-c2')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-metric-capital-ruin-count-oddsDistribution')).toHaveTextContent('10% 下注归零 2 场');
    expect(screen.getByTestId('campaign-metric-loss-wall-oddsDistribution')).toHaveAttribute('data-reference-value', '-1');
  });

  it('提示和读屏保留真实 b，并明确假设，不把模拟归零误写成实际强平', () => {
    const { point, onSelect } = renderChart([-10.01, -10, -9.99]);
    fireEvent.focus(point(0));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('-10.01R');
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('按 10% 下注，本金归零');
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('非实际账户强平判定');
    expect(point(0)).toHaveAccessibleName(/-10\.01R.*按 10% 下注，本金归零/);
    expect(point(0)).toHaveAttribute('data-metric-value', '-10.01');
    fireEvent.click(point(0));
    expect(onSelect).toHaveBeenCalledWith('c0');
    fireEvent.focus(point(2));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('-9.99R');
    expect(screen.getByTestId('chart-tooltip')).not.toHaveTextContent('本金归零');
    fireEvent.click(point(2));
    expect(onSelect).toHaveBeenLastCalledWith('c2');
  });

  it('极少数 −85.51R 不被 p2 隐去，贴边后仍有警示和原始统计', () => {
    const values = [-85.51, ...Array.from({ length: 100 }, (_, i) => 0.1 + i * 0.05)];
    const { point, boundary, onSelect } = renderChart(values);
    const boundaryX = Number(boundary().getAttribute('x1'));
    expect(parseFloat(point(0).style.left)).toBeLessThan(boundaryX);
    expect(parseFloat(point(1).style.left)).toBeGreaterThan(boundaryX);
    expect(screen.getByTestId('chart-warning-ring-c0')).toBeInTheDocument();
    expect(point(0)).toHaveAttribute('data-metric-value', '-85.51');
    const summary = screen.getByTestId('campaign-metric-summary-oddsDistribution');
    expect(summary).toHaveTextContent('范围 -85.51R – 5.05R');
    expect(summary).toHaveTextContent('中位数 2.55R');
    expect(summary).toHaveTextContent(`均值 ${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)}R`);
    expect(summary).toHaveTextContent('胜率 99% (100/101)');
    expect(summary).toHaveTextContent('10% 下注归零 1 场');
    expect(screen.getByTestId('campaign-metric-scatter-plot').querySelectorAll('button[data-campaign-id]')).toHaveLength(101);
    fireEvent.focus(point(0));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('-85.51R');
    fireEvent.click(point(0));
    expect(onSelect).toHaveBeenCalledWith('c0');
    expect(screen.getByTestId('campaign-metric-density-curve-oddsDistribution').getAttribute('d')).not.toMatch(/NaN|Infinity/);
  });

  it('无归零样本时不加 −10R 线，不把普通亏损改成风险方点', () => {
    const { point } = renderChart([-9.99, -1, -0.5, 0, 1]);
    expect(screen.queryByTestId('campaign-metric-capital-ruin-oddsDistribution')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-warning-ring-c0')).not.toBeInTheDocument();
    expect(point(0)).toHaveAttribute('data-marker-shape', 'diamond');
    expect(screen.getByTestId('campaign-metric-capital-ruin-count-oddsDistribution')).toHaveTextContent('10% 下注归零 0 场');
    expect(screen.getByTestId('campaign-metric-loss-wall-oddsDistribution')).toBeInTheDocument();
  });

  it('时序视图也标出 −10R 横线、固定刻度和特殊点，保留 −1R 止损线', () => {
    const { point, boundary } = renderChart([-10.01, -10, -9.99, 1], { view: 'time' });
    const line = boundary();
    expect(line).toHaveAttribute('data-reference-value', '-10');
    expect(line).not.toHaveAttribute('data-reference-axis', 'x');
    expect(line.getAttribute('y1')).toBe(line.getAttribute('y2'));
    expect(line.getAttribute('x1')).not.toBe(line.getAttribute('x2'));
    expect(line).toHaveStyle({ stroke: 'var(--chart-threshold)' });
    expect(screen.getByTestId('campaign-odds-capital-ruin-label')).toHaveTextContent('-10R');
    expect(screen.getByTestId('campaign-odds-loss-boundary-line')).toHaveAttribute('data-reference-value', '-1');
    expect(screen.getByTestId('campaign-metric-capital-ruin-count-odds')).toHaveTextContent('10% 下注归零 2 场');
    expect(point(1)).toHaveAttribute('data-capital-ruin', 'true');
    expect(point(2)).toHaveAttribute('data-capital-ruin', 'false');
    expect(screen.getByTestId('chart-warning-ring-c1')).toBeInTheDocument();
  });

  it('时序中即便归零点被稳健窗口裁边，−10R 线仍留在可视纵轴内', () => {
    renderChart([-85.51, ...Array.from({ length: 100 }, (_, i) => 0.1 + i * 0.05)], { view: 'time' });
    const ruinY = Number(screen.getByTestId('campaign-metric-capital-ruin-odds').getAttribute('y1'));
    const lossY = Number(screen.getByTestId('campaign-odds-loss-boundary-line').getAttribute('y1'));
    expect(ruinY).toBeGreaterThan(lossY);
    const tickValues = screen.getAllByTestId('campaign-odds-y-tick').map(tick => Number(tick.getAttribute('data-tick-value')));
    expect(Math.min(...tickValues)).toBeLessThanOrEqual(-10);
  });

  it('不把其他指标的 −10 误当盈亏比归零界限', () => {
    const { point } = renderChart([-12, -10, -1, 1], { metricKey: 'expectancyDistribution' });
    expect(screen.queryByTestId('campaign-metric-capital-ruin-expectancyDistribution')).not.toBeInTheDocument();
    expect(screen.queryByTestId('campaign-metric-capital-ruin-count-expectancyDistribution')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-warning-ring-c0')).not.toBeInTheDocument();
    expect(point(0)).not.toHaveAttribute('data-capital-ruin');
    expect(point(0)).toHaveAttribute('data-marker-shape', 'diamond');
  });
});
