import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CampaignMetricScatterPlot } from '../CampaignOddsScatterPlot';

function renderChart(factors: number[], metricKey = 'geometricExpectancyDistribution') {
  const onSelect = vi.fn();
  render(<CampaignMetricScatterPlot
    points={factors.map((factor, index) => ({
      campaignId: `c${index}`, title: `战役 ${index}`, symbol: 'TESTUSDT',
      value: factor - 1, sequence: index + 1, operationTime: 1_700_000_000_000 + index,
      payoffRatio: (factor - 1) * 10,
    }))}
    metricKey={metricKey} metricLabel="几何期望分布" seriesLabel="几何期望分布"
    axisLabel="几何期望" missingValueLabel="几何期望" view="distribution"
    formatValue={value => (1 + value).toFixed(2)}
    guide={{ yAxis: '场数', point: '每点一场', colors: [
      { token: 'profit', label: '盈利' }, { token: 'loss', label: '亏损' }, { token: 'neutral', label: '持平' },
    ] }}
    onSelectCampaign={onSelect}
  />);
  return onSelect;
}

describe('campaign geometric distribution', () => {
  it('renders log spacing, separate zeros, original summaries and navigable points', () => {
    const onSelect = renderChart([0, 0.1, 0.2, 0.5, 0.8, 1, 2, 20, 50]);
    const root = screen.getByTestId('campaign-metric-scatter-plot');
    expect(root).toHaveAttribute('data-x-scale', 'log');
    expect(root.querySelectorAll('button[data-campaign-id]')).toHaveLength(9);
    const point = (index: number) => screen.getByTestId(`campaign-metric-point-geometricExpectancyDistribution-c${index}`);
    const x = (index: number) => parseFloat(point(index).style.left);
    expect(x(0)).toBeLessThan(x(1));
    expect(new Set([1, 2, 3, 4].map(x)).size).toBe(4);
    const breakEvenX = Number(screen.getByTestId('campaign-metric-break-even-geometricExpectancyDistribution').getAttribute('x1'));
    expect([1, 2, 3, 4].every(index => x(index) < breakEvenX)).toBe(true);
    expect([6, 7, 8].every(index => x(index) > breakEvenX)).toBe(true);
    expect(screen.getByTestId('chart-isolated-bucket-label')).toHaveTextContent('0本金归零');
    const summary = screen.getByTestId('campaign-metric-summary-geometricExpectancyDistribution');
    expect(summary).toHaveTextContent('范围 0.00 – 50.00');
    expect(summary).toHaveTextContent('中位数 0.80');
    expect(summary).toHaveTextContent('胜率 33% (3/9)');
    expect(summary).toHaveTextContent('本金归零 1 场');
    fireEvent.focus(point(3));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('0.50 · b -5.00R');
    fireEvent.click(point(3));
    expect(onSelect).toHaveBeenCalledWith('c3');
    fireEvent.focus(point(0));
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('0.00');
    fireEvent.click(point(0));
    expect(onSelect).toHaveBeenLastCalledWith('c0');
    expect(screen.getByTestId('campaign-metric-density-curve-geometricExpectancyDistribution').getAttribute('d')).not.toMatch(/NaN|Infinity/);
    fireEvent.click(screen.getByTestId('campaign-metric-guide-toggle-geometricExpectancyDistribution'));
    expect(screen.getByTestId('campaign-metric-guide-geometricExpectancyDistribution')).toHaveTextContent('ln(Gᵢ) 对数刻度');
  });

  it('shows all-zero results without a misleading continuous density', () => {
    renderChart([0, 0, 0]);
    expect(screen.getByTestId('campaign-metric-summary-geometricExpectancyDistribution')).toHaveTextContent('本金归零 3 场');
    expect(screen.getByTestId('campaign-metric-density-curve-geometricExpectancyDistribution')).toHaveAttribute('d', '');
    const points = screen.getByTestId('campaign-metric-scatter-plot').querySelectorAll<HTMLButtonElement>('button[data-campaign-id]');
    expect(points).toHaveLength(3);
    expect(new Set([...points].map(point => point.style.left)).size).toBe(1);
  });

  it('has no zero rail when no factor is zero', () => {
    renderChart([0.5, 1, 2]);
    expect(screen.queryByTestId('chart-isolated-bucket-label')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-metric-summary-geometricExpectancyDistribution')).toHaveTextContent('范围 0.50 – 2.00');
  });

  it('does not transform other distribution metrics', () => {
    renderChart([0, 0.5, 1, 2], 'oddsDistribution');
    expect(screen.getByTestId('campaign-metric-scatter-plot')).not.toHaveAttribute('data-x-scale');
    expect(screen.queryByTestId('chart-isolated-bucket-label')).not.toBeInTheDocument();
    expect(screen.getByTestId('campaign-metric-loss-wall-oddsDistribution')).toBeInTheDocument();
  });
});
