import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishQuality } from '@/components/FishQuality';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { definitionKey } from '@/lib/deepDig/features';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { importQualityFish, importQualityLibrary, newQualityStudy, qualityDisplayRows } from '@/lib/fish/quality';
import { finishQualityReturn } from '@/lib/fish/qualityReturn';

const T = Date.UTC(2026, 9, 28);
const specs = [
  ['state', 'S', 'avg_state_2', .6], ['cbi2', 'CBI-2', 'avg_CBI2', .06],
  ['cbi2', 'CBI-2', 'avg_CBI2', .04], ['cba', 'CBA', 'avg_CBA', 8],
  ['cbi2', 'CBI-2', 'avg_CBI2_2', .04], ['cba', 'CBA', 'avg_CBA_2', 8],
] as const;
function state(empty = false): FishQualityState {
  const signals = empty ? [] : specs.map(([featureId, featureShort, statistic, threshold], i) => ({ id: `detector-${i}`, symbol: `COIN${i}USDT`, timeMs: T - i * 60000, timeLabel: '', fallbackZone: '', fish: { featureId, featureShort, statistic, threshold, definitionKey: definitionKey({ formula: 'X = C', positive: '1', control: '0' }), direction: '>' as const, interval: '5m', scale: 1, cutoffMs: T, average: 10, cbi2: 10, startAverage: 10, previousAverage: 0 } }));
  const study = enableQualityComparison(importQualityFish(newQualityStudy(T), signals));
  study.selectedRowIds = qualityDisplayRows(study).map(row => row.id);
  return { study, ready: !empty, running: false, progress: null, filterRunning: false, filterProgress: null, filterError: '', error: '', warning: '', start: vi.fn(), restart: vi.fn(), cancel: vi.fn(), startFilter: vi.fn(), cancelFilter: vi.fn(), setSelectedRows: vi.fn(), setPriority: vi.fn(), setScope: vi.fn(), setFilters: vi.fn(), setHoldingVetoes: vi.fn(), setSellPlans: vi.fn(), setRule: vi.fn(), setCombo: vi.fn(), setObserveHours: vi.fn(), selectSell: vi.fn() };
}
afterEach(() => { cleanup(); finishQualityReturn(); });
const open = () => { fireEvent.click(screen.getByRole('button', { name: '鱼质量的探测算法' })); return screen.getByTestId('quality-detector-picker'); };

it('checks the four photographed levels after async hydration and scopes the table and monitoring to them', () => {
  const view = render(<FishQuality state={state(true)}/>), s = state();
  view.rerender(<FishQuality state={s}/>);
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(4);
  expect(s.setScope).toHaveBeenLastCalledWith(expect.arrayContaining(qualityDisplayRows(s.study).filter(row => !['COIN0USDT', 'COIN1USDT'].includes(row.source.symbol)).map(row => row.id)));
  expect(vi.mocked(s.setScope!).mock.calls.at(-1)![0]).toHaveLength(4);
  const picker = open(); expect(within(picker).getAllByRole('checkbox', { checked: true })).toHaveLength(4);
  // 【用户要求】2026-10-28 下拉只列默认算法与数值，非默认的（CBI-2·avg > 0.06、S·avg₂ > 0.6）不再出现
  expect(within(picker).getAllByRole('checkbox')).toHaveLength(4);
  expect(within(picker).queryByRole('checkbox', { name: '探测算法 CBI-2·avg > 0.06' })).toBeNull();
  expect(within(picker).queryByRole('checkbox', { name: '探测算法 S·avg₂ > 0.6' })).toBeNull();
});

it('respects an explicit 全部 or manual choice during subsequent result updates', () => {
  const s = state(), view = render(<FishQuality state={s}/>), picker = open();
  fireEvent.click(within(picker).getByRole('button', { name: '全部' }));
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(6);
  s.study = { ...s.study, groups: [...s.study.groups], results: [] }; view.rerender(<FishQuality state={s}/>);
  expect(within(picker).queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
  fireEvent.click(within(picker).getByRole('checkbox', { name: '探测算法 CBA·avg > 8' }));
  expect(screen.getByTestId('quality-fish-row')).toHaveTextContent('COIN3USDT');
  s.study = { ...s.study, results: [] }; view.rerender(<FishQuality state={s}/>);
  expect(within(picker).getByRole('checkbox', { name: '探测算法 CBA·avg > 8' })).toBeChecked();
  expect(within(picker).getAllByRole('checkbox', { checked: true })).toHaveLength(1);
});

it('keeps the unclassified signal library accessible when the four-detector default is active', () => {
  const s = state(); s.study = importQualityLibrary(s.study, [{ id: 'library', symbol: 'LIBRARYUSDT', timeMs: T, timeLabel: '', fallbackZone: '' }]);
  render(<FishQuality state={s}/>);
  fireEvent.change(screen.getByLabelText('鱼质量的来源'), { target: { value: 'library' } });
  expect(screen.getByTestId('quality-fish-row')).toHaveTextContent('LIBRARYUSDT');
  fireEvent.change(screen.getByLabelText('鱼质量的来源'), { target: { value: 'fish' } });
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(4);
});
