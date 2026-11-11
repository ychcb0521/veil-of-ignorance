/** 【用户要求】2026-11-04「开始监测点不了」：勾选的信号都在筛选外时写明在哪、各多少条，并能一键切过去。 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishQuality } from '@/components/FishQuality';
import { importQualityFish, newQualityStudy, qualityDisplayRows } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';
import type { FishQualityState } from '@/hooks/useFishQuality';

afterEach(cleanup);
const T = Date.UTC(2026, 9, 20);
function state(): FishQualityState {
  const signals = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'].map((symbol, i) => ({ id: String(i), symbol, timeMs: T + i * 60000, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: 'BSS', cutoffMs: T, threshold: 1, average: 4, cbi2: 4, startAverage: 4, previousAverage: 0, direction: '>' as const, scale: 1 } }));
  const study = enableQualityComparison(importQualityFish(newQualityStudy(T + 1), signals));
  study.selectedRowIds = qualityDisplayRows(study).map(r => r.id);
  return { study, ready: true, running: false, progress: null, filterRunning: false, filterProgress: null, filterError: '', startFilter: vi.fn(), cancelFilter: vi.fn(), warning: '', error: '', start: vi.fn(), restart: vi.fn(), cancel: vi.fn(), setRule: vi.fn(), setCombo: vi.fn(), setObserveHours: vi.fn(), selectSell: vi.fn(), setSelectedRows: vi.fn(), setPriority: vi.fn(), setScope: vi.fn(), setFilters: vi.fn(), setHoldingVetoes: vi.fn(), setSellPlans: vi.fn() };
}
it('勾选的都在筛选外：写明来源与条数，开始监测是灰的；点「切到包含勾选的筛选」后可以开始', () => {
  const s = state(); render(<FishQuality state={s}/>);
  const start = () => screen.getByRole('button', { name: '开始监测' });
  expect(start()).not.toBeDisabled();
  chooseSource('library');
  const hint = screen.getByTestId('quality-outside-selection');
  expect(hint).toHaveTextContent('勾选的 3 条都在当前筛选外（鱼舱 3）');
  expect(start()).toBeDisabled(); expect(start()).toHaveAttribute('title', expect.stringContaining('切到包含勾选的筛选'));
  fireEvent.click(within(hint).getByRole('button', { name: '切到包含勾选的筛选' }));
  expect(screen.getByLabelText('鱼质量的来源')).toHaveTextContent('鱼舱');
  expect(screen.queryByTestId('quality-outside-selection')).toBeNull();
  expect(screen.getByTestId('quality-run-scope')).toHaveTextContent('本轮处理已勾选 3 条');
  expect(start()).not.toBeDisabled();
});
it('只清挡住勾选的标的搜索，不动别的筛选', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.change(screen.getByLabelText('筛选鱼质量信号'), { target: { value: 'AAA' } });
  expect(screen.getByTestId('quality-outside-selection')).toHaveTextContent('筛选外另有 2 条已勾选（鱼舱 2）');
  fireEvent.click(screen.getByRole('button', { name: '切到包含勾选的筛选' }));
  expect(screen.getByLabelText('筛选鱼质量信号')).toHaveValue('');
  expect(screen.getByLabelText('鱼质量的来源')).toHaveTextContent('全部来源');
});

function chooseSource(value:string){const names:Record<string,string>={library:'信号库',fish:'鱼舱',mined:'捕捞库',turing:'图灵杯','pre-entry':'筛选库','':'全部来源'};fireEvent.click(screen.getByRole('combobox',{name:'鱼质量的来源'}));fireEvent.click(screen.getByRole('option',{name:new RegExp('^'+names[value])}));}

it('隐藏未选行只改变当前视图，仍可清除显示行的勾选并保留筛选外的勾选', () => {
  const s = state();
  const rows = qualityDisplayRows(s.study);
  const outside = rows.find(row => row.source.symbol === 'CCCUSDT')!.id;
  s.study.selectedRowIds = rows.filter(row => row.source.symbol !== 'BBBUSDT').map(row => row.id);
  const view = render(<FishQuality state={s}/>);
  const row = (symbol: string) => screen.queryByRole('checkbox', { name: new RegExp('^选择 ' + symbol) });
  const search = screen.getByLabelText('筛选鱼质量信号');
  fireEvent.change(search, { target: { value: 'AAA' } });
  const scope = vi.mocked(s.setScope!).mock.calls.at(-1);
  fireEvent.click(screen.getByRole('button', { name: '隐藏未选行' }));
  expect(vi.mocked(s.setScope!).mock.calls.at(-1)).toBe(scope);
  expect(s.setSelectedRows).not.toHaveBeenCalled();
  expect(row('AAAUSDT')).toBeChecked();
  fireEvent.change(search, { target: { value: 'BBB' } });
  expect(screen.getByText(/当前筛选内没有已选行/)).toBeInTheDocument();
  fireEvent.change(search, { target: { value: 'AA' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '全选显示的行' }));
  expect(s.setSelectedRows).toHaveBeenCalledWith([outside]);
  s.study = {...s.study, selectedRowIds: [outside]};
  view.rerender(<FishQuality state={s}/>);
  expect(row('AAAUSDT')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '显示未选行' }));
  expect(row('AAAUSDT')).not.toBeChecked();
  expect(search).toHaveValue('AA');
  fireEvent.change(search, { target: { value: '' } });
  expect(row('CCCUSDT')).toBeChecked();
  expect(row('BBBUSDT')).not.toBeChecked();
});
