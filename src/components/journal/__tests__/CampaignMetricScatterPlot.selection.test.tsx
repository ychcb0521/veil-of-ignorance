import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CampaignMetricScatterPlot } from '../CampaignOddsScatterPlot';

type ChartProps = Parameters<typeof CampaignMetricScatterPlot>[0];
const POINTS: ChartProps['points'] = Array.from({ length: 8 }, (_, index) => ({
  campaignId: `c${index}`, title: `战役 ${index}`, symbol: 'TESTUSDT',
  value: index - 3, sequence: index + 1, operationTime: 1_700_000_000_000 + index,
  payoffRatio: index - 3,
}));
const BASE: ChartProps = {
  points: POINTS, metricKey: 'oddsDistribution', metricLabel: '盈亏比分布', seriesLabel: '盈亏比分布',
  missingValueLabel: '盈亏比', view: 'distribution', formatValue: value => `${value.toFixed(2)}R`,
  guide: { yAxis: '场数', point: '每点一场', colors: [
    { token: 'profit', label: '盈利' }, { token: 'loss', label: '亏损' }, { token: 'neutral', label: '持平' },
  ] },
  onSelectCampaign: () => {},
};
const point = (id: string, key = 'oddsDistribution') => screen.getByTestId(`campaign-metric-point-${key}-${id}`);

function SelectionHarness(props: Partial<ChartProps>) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return <CampaignMetricScatterPlot {...BASE} {...props} selectionMode selectedCampaignIds={selected}
    onToggleCampaign={id => setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    })} />;
}

describe('CampaignMetricScatterPlot batch selection', () => {
  it('keeps default point navigation unchanged and does not show selection rings', () => {
    const navigate = vi.fn();
    const toggle = vi.fn();
    render(<CampaignMetricScatterPlot {...BASE} onSelectCampaign={navigate} onToggleCampaign={toggle}
      selectedCampaignIds={new Set(['c2'])} />);
    fireEvent.click(point('c2'));
    expect(navigate).toHaveBeenCalledWith('c2');
    expect(toggle).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chart-selection-ring-c2')).not.toBeInTheDocument();
  });

  it('click, Enter and Space toggle only selection; hovering never selects or navigates', () => {
    const navigate = vi.fn();
    render(<SelectionHarness onSelectCampaign={navigate} />);
    expect(screen.getByText('批量选择：点击点位选择或取消，外圈表示已选择')).toBeInTheDocument();
    fireEvent.mouseEnter(point('c2'));
    expect(point('c2')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('点击选择此战役');
    fireEvent.click(point('c2'));
    expect(point('c2')).toHaveAttribute('aria-pressed', 'true');
    expect(point('c2')).not.toHaveAccessibleName(/进入战役/);
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('已选择 · 点击取消选择');
    expect(screen.getByTestId('chart-selection-ring-c2')).toHaveStyle({ stroke: 'var(--chart-info)', fill: 'none' });
    fireEvent.mouseEnter(point('c1'));
    expect(point('c2')).toHaveAttribute('aria-pressed', 'true');
    expect(point('c1')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(point('c2'), { key: 'Enter' });
    expect(point('c2')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(point('c1'), { key: ' ' });
    expect(point('c1')).toHaveAttribute('aria-pressed', 'true');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('retains controlled selection across chart/view/mode changes without changing plotted positions', () => {
    const selection = new Set(['c2', 'c4']);
    const toggle = vi.fn();
    const navigate = vi.fn();
    const renderChart = (overrides: Partial<ChartProps>) => <CampaignMetricScatterPlot {...BASE}
      onSelectCampaign={navigate} onToggleCampaign={toggle} selectedCampaignIds={selection} {...overrides} />;
    const { rerender } = render(renderChart({ selectionMode: true }));
    const before = [point('c2').style.left, point('c2').style.top];
    rerender(renderChart({ selectionMode: false }));
    expect(screen.queryByTestId('chart-selection-ring-c2')).not.toBeInTheDocument();
    expect([point('c2').style.left, point('c2').style.top]).toEqual(before);
    fireEvent.click(point('c2'));
    expect(navigate).toHaveBeenCalledWith('c2');
    rerender(renderChart({ selectionMode: true, view: 'time', metricKey: 'odds' }));
    expect(point('c2', 'odds')).toHaveAttribute('aria-pressed', 'true');
    expect(point('c4', 'odds')).toHaveAttribute('aria-pressed', 'true');
    rerender(renderChart({ selectionMode: true }));
    expect([point('c2').style.left, point('c2').style.top]).toEqual(before);
    expect(point('c2')).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).not.toHaveBeenCalled();
    expect([...selection]).toEqual(['c2', 'c4']);
  });

  it('never falls back to navigation when selection mode has no toggle handler', () => {
    const navigate = vi.fn();
    render(<CampaignMetricScatterPlot {...BASE} selectionMode onSelectCampaign={navigate} />);
    fireEvent.click(point('c2'));
    fireEvent.keyDown(point('c2'), { key: 'Enter' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('preserves a selected ruin point’s red shape and yellow risk ring', () => {
    render(<CampaignMetricScatterPlot {...BASE}
      points={[{ ...POINTS[0], value: -12, payoffRatio: -12 }, ...POINTS.slice(1)]}
      selectionMode selectedCampaignIds={new Set(['c0'])} />);
    expect(point('c0')).toHaveAttribute('data-series-token', 'loss');
    expect(point('c0')).toHaveAttribute('data-marker-shape', 'square');
    expect(screen.getByTestId('chart-warning-ring-c0')).toHaveStyle({ stroke: 'var(--chart-threshold)' });
    expect(screen.getByTestId('chart-selection-ring-c0')).toHaveStyle({ stroke: 'var(--chart-info)' });
  });

  it('opens overflow to select actual hidden campaign IDs, including keyboard deselection', () => {
    const navigate = vi.fn();
    const points = Array.from({ length: 90 }, (_, index) => ({ ...POINTS[0], campaignId: `c${index}`, title: `战役 ${index}`, sequence: index + 1, value: 0.5 }));
    render(<SelectionHarness points={points} onSelectCampaign={navigate} />);
    const overflow = screen.getByTestId('chart-stack-overflow-hit');
    fireEvent.click(overflow);
    expect(overflow).toHaveAttribute('aria-expanded', 'true');
    const picker = screen.getByTestId('chart-overflow-picker');
    expect(picker).toHaveFocus();
    const hidden = picker.querySelector<HTMLButtonElement>('button[data-campaign-id]')!;
    const campaignId = hidden.dataset.campaignId!;
    expect(campaignId).toMatch(/^c\d+$/);
    expect(screen.queryByTestId(`campaign-metric-point-oddsDistribution-${campaignId}`)).not.toBeInTheDocument();
    fireEvent.click(hidden);
    expect(hidden).toHaveAttribute('aria-pressed', 'true');
    expect(overflow).toHaveAccessibleName(/已选择 1 场/);
    fireEvent.keyDown(hidden, { key: ' ' });
    expect(hidden).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(hidden, { key: 'Enter' });
    expect(hidden).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(picker).getByRole('button', { name: '收起' }));
    expect(screen.queryByTestId('chart-overflow-picker')).not.toBeInTheDocument();
    expect(overflow).toHaveFocus();
    fireEvent.click(overflow);
    expect(screen.getByTestId(`chart-overflow-point-${campaignId}`)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(screen.getByTestId('chart-overflow-picker'), { key: 'Escape' });
    expect(screen.queryByTestId('chart-overflow-picker')).not.toBeInTheDocument();
    expect(overflow).toHaveFocus();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('overflow entries navigate normally outside selection mode', () => {
    const navigate = vi.fn();
    const points = Array.from({ length: 90 }, (_, index) => ({ ...POINTS[0], campaignId: `c${index}`, title: `战役 ${index}`, value: 0.5 }));
    render(<CampaignMetricScatterPlot {...BASE} points={points} onSelectCampaign={navigate} />);
    fireEvent.click(screen.getByTestId('chart-stack-overflow-hit'));
    const hidden = screen.getByTestId('chart-overflow-picker').querySelector<HTMLButtonElement>('button[data-campaign-id]')!;
    fireEvent.click(hidden);
    expect(navigate).toHaveBeenCalledWith(hidden.dataset.campaignId);
  });

  it.each(['light', 'dark'])('retains theme-aware selection and risk rings on a narrow %s chart', theme => {
    const previousObserver = globalThis.ResizeObserver;
    const previousClass = document.documentElement.className;
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240);
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(288);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      render(<CampaignMetricScatterPlot {...BASE}
        points={[{ ...POINTS[0], value: -12, payoffRatio: -12 }, ...POINTS.slice(1)]}
        selectionMode selectedCampaignIds={new Set(['c0', 'c5'])} onToggleCampaign={() => {}} />);
      expect(screen.getByTestId('chart-selection-ring-c0')).toHaveStyle({ stroke: 'var(--chart-info)' });
      expect(screen.getByTestId('chart-warning-ring-c0')).toHaveStyle({ stroke: 'var(--chart-threshold)' });
      for (const id of ['c0', 'c5']) {
        expect(Number.isFinite(parseFloat(point(id).style.left))).toBe(true);
        expect(Number.isFinite(parseFloat(point(id).style.top))).toBe(true);
        expect(point(id)).toHaveAttribute('aria-pressed', 'true');
      }
      fireEvent.focus(point('c0'));
      expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('已选择 · 点击取消选择');
      expect(parseFloat(screen.getByTestId('chart-tooltip').style.maxWidth)).toBeLessThanOrEqual(240);
    } finally {
      width.mockRestore();
      height.mockRestore();
      globalThis.ResizeObserver = previousObserver;
      document.documentElement.className = previousClass;
    }
  });
});
