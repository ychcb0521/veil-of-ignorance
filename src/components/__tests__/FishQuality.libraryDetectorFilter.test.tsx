import { fireEvent, render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { FishQuality } from '@/components/FishQuality';
import { importQualityFish, importQualityLibrary, newQualityStudy, qualityDisplayRows, qualityResultKey } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { defaultQualityDetectorIds } from '@/lib/fish/qualityDetectorSelection';
import { armQualityReturn, finishQualityReturn, saveQualityReturn, QUALITY_RETURN_KEY, type QualityReturnUi } from '@/lib/fish/qualityReturn';
import { CBA_DEF, CBI2_DEF, definitionKey } from '@/lib/deepDig/features';
import type { FishQualityState } from '@/hooks/useFishQuality';
const T = Date.UTC(2026, 9, 20), M = 60000;
afterEach(() => { cleanup(); finishQualityReturn(); sessionStorage.clear(); });
/** 鱼舱两条默认探测算法（CBI-2·avg₂ / CBA·avg₂）的鱼，再加两条信号库自己的信号（没有探测算法）。 */
function state(): FishQualityState {
  const fish = (def: typeof CBI2_DEF, statistic: string, threshold: number) => ({ featureId: def.id, featureShort: def.short, definitionKey: definitionKey({ ...def, interval: '5m' }), statistic, cutoffMs: T, threshold, average: 4, cbi2: 4, startAverage: 4, previousAverage: 0, direction: '>' as const });
  const signals = [fish(CBI2_DEF, 'avg_CBI2_2', .04), fish(CBA_DEF, 'avg_CBA_2', 8)].map((f, i) => ({ id: `d${i}`, symbol: `D${i}USDT`, timeMs: T + i * M, timeLabel: '', fallbackZone: '', fish: f }));
  let study = enableQualityComparison(importQualityFish(newQualityStudy(T + 1), signals as never));
  study = importQualityLibrary(study, [{ id: 'lib-a', symbol: 'LIBAUSDT', timeMs: T, timeLabel: '', fallbackZone: '' }, { id: 'lib-b', symbol: 'LIBBUSDT', timeMs: T + M, timeLabel: '', fallbackZone: '' }]);
  study.selectedRowIds = qualityDisplayRows(study).map(r => r.id);
  const plan = study.sellPlans![0], row = qualityDisplayRows(study).find(r => r.detectorId)!;
  study.results = [{ key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, evaluatedAt: T, status: 'closed', returnPct: 5, entryTime: T, entryPrice: 1, endTime: T + M, endPrice: 1.05, pnl: 5 }];
  return { study, ready: true, running: false, progress: null, filterRunning: false, filterProgress: null, filterError: '', startFilter: vi.fn(), cancelFilter: vi.fn(), warning: '', error: '', start: vi.fn(), restart: vi.fn(), cancel: vi.fn(), setRule: vi.fn(), setCombo: vi.fn(), setObserveHours: vi.fn(), setSelectedRows: vi.fn(), setSellPlans: vi.fn(), selectSellPlan: vi.fn(), setBuyFilters: vi.fn(), clearFilterResults: vi.fn(), clearMonitorResults: vi.fn() } as unknown as FishQualityState;
}
const symbols = () => screen.queryAllByTestId('quality-fish-row').map(r => r.textContent ?? '');
const back = (ui: Partial<QualityReturnUi>) => { window.history.replaceState({ key: 'fish-entry', idx: 1 }, ''); saveQualityReturn({ ui: { open: true, query: '', month: '', origin: '', sort: 'time', ascending: false, tableTop: 0, ...ui }, scroll: [] }); expect(armQualityReturn()).toBe(true); };

// 【用户要求】2026-11-03「组合表中，选择了信号库，为什么没信息呢？」
it('remembers only the user’s own detector choice, so 信号库 still shows its own signals after coming back from a campaign', () => {
  window.history.replaceState({ key: 'fish-entry', idx: 1 }, '');
  const s = state();
  render(<MemoryRouter><FishQuality state={s}/></MemoryRouter>);
  // 没有主动选择算法时，全部来源应直接包含信号库的记录。
  expect(symbols().filter(t => t.includes('LIB'))).toHaveLength(2);
  fireEvent.click(screen.getAllByTitle(/打开交易战役/)[0]);
  expect(JSON.parse(sessionStorage.getItem(QUALITY_RETURN_KEY)!).ui.algorithms).toEqual([]);
  cleanup(); expect(armQualityReturn()).toBe(true);
  render(<MemoryRouter><FishQuality state={s}/></MemoryRouter>);
  chooseSource('library');
  expect(symbols().filter(t => t.includes('LIB'))).toHaveLength(2);
  expect(screen.queryByTestId('quality-empty-detector-filter')).toBeNull();
});
it('says which header filter emptied the table and clears it from the empty state, since the header is not shown', () => {
  const s = state(), ids = defaultQualityDetectorIds(s.study.groups);expect(ids.length).toBeGreaterThan(0);
  // 用户明确选过探测算法，又切到信号库
  back({ origin: 'library', algorithms: ids });
  render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByLabelText('鱼质量的来源'));expect(screen.getByRole('option',{name:'信号库 2'})).toBeInTheDocument();fireEvent.click(screen.getByLabelText('鱼质量的来源'));
  expect(symbols()).toEqual([]);
  const hint = screen.getByTestId('quality-empty-detector-filter');
  expect(hint).toHaveTextContent('表头「探测算法」筛选');expect(hint).toHaveTextContent('信号库自己的信号没有探测算法');
  fireEvent.click(within(hint).getByRole('button', { name: '清除探测算法筛选' }));
  expect(symbols().filter(t => t.includes('LIB'))).toHaveLength(2);
  cleanup(); finishQualityReturn();
  // Old return snapshots must not keep an invisible status filter after its column is removed.
  back({origin:'library',runState:'done',sort:'run'});render(<FishQuality state={state()}/>);
  expect(symbols().filter(t=>t.includes('LIB'))).toHaveLength(2);expect(screen.queryByTestId('quality-empty-run-state')).toBeNull();

});

function chooseSource(value:string){const names:Record<string,string>={library:'信号库',fish:'鱼舱',mined:'捕捞库',turing:'图灵杯','pre-entry':'筛选库','':'全部来源'};fireEvent.click(screen.getByRole('combobox',{name:'鱼质量的来源'}));fireEvent.click(screen.getByRole('option',{name:new RegExp('^'+names[value])}));}
