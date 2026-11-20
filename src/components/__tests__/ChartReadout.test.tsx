import { createRef } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Chart, IndicatorCreateTooltipDataSourceParams } from 'klinecharts';
import { ChartReadout, routeOverlayReadout, type ChartReadoutHandle } from '../ChartReadout';

it('keeps a precise quote in the bar and the dated volume and indicator readings in the disclosure', () => {
  const ref = createRef<ChartReadoutHandle>();
  const props = { hasData: true, precision: 7, timezone: 'Asia/Shanghai', onToggle: vi.fn(), children: null };
  const view = render(<ChartReadout {...props} ref={ref} expanded={false} />);
  const bar = { timestamp: Date.UTC(2026, 10, 19, 17, 25), close: 0.0811234, open: 0.08, high: 0.09, low: 0.07, volume: 987 };
  act(() => ref.current!.quote(bar, 0.08));
  const summary = screen.getByRole('button', { name: '行情与指标读数' });
  expect(summary).toHaveTextContent('11-20 01:25');
  expect(summary).toHaveTextContent('0.0811234');
  expect(summary).toHaveTextContent('+1.40%');
  expect(screen.queryByRole('region')).toBeNull();
  view.rerender(<ChartReadout {...props} ref={ref} expanded />);
  act(() => ref.current!.indicator('DBL', { name: '急拉线', params: '5m 已收盘', values: ['分类: 二类'], classified: true }));
  const details = within(screen.getByRole('region', { name: '行情与指标读数' }));
  expect(details.getByText('2026-11-20 01:25')).toBeVisible();
  expect(details.getByText('987')).toBeVisible();
  expect(details.getByText('分类: 二类')).toBeVisible();
  act(() => ref.current!.remove('DBL'));
  expect(details.queryByText('分类: 二类')).toBeNull();
});

it('uses the overlay’s native crosshair formatter only in the open readout and writes no legend on the canvas', () => {
  const formatter = vi.fn(() => ({ name: '箱体', calcParamsText: '5m 已收盘', values: [{title:'下轨: ', value:'0.0812'}], icons: [] }));
  const chart = { getIndicatorByPaneId: () => ({createTooltipDataSource: formatter}), overrideIndicator: vi.fn() };
  const handle = { quote: vi.fn(), indicator: vi.fn(), remove: vi.fn() };
  let open = false;
  routeOverlayReadout(chart as unknown as Chart, 'DBL5_CUSTOM', 'DBL5', false, () => open ? handle : null);
  const callback = chart.overrideIndicator.mock.calls[0][0].createTooltipDataSource;
  const params = {crosshair: {dataIndex: 7}, indicator: {result: []}} as unknown as IndicatorCreateTooltipDataSourceParams;
  expect(callback(params).values).toEqual([]);
  expect(formatter).not.toHaveBeenCalled();
  open = true;
  expect(callback(params)).toEqual({name: '', calcParamsText: '', values: [], icons: []});
  expect(formatter).toHaveBeenCalledWith(params);
  expect(handle.indicator).toHaveBeenCalledWith('DBL5', {name: '箱体', params: '5m 已收盘', values: ['下轨: 0.0812'], classified: false});
});
