import { fireEvent, render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishQuality } from '@/components/FishQuality';
import { importQualityFish, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityDisplayRows, qualityResultKey, qualityRunSamples } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';
import type { FishQualityState } from '@/hooks/useFishQuality';
const T = Date.UTC(2026, 9, 20);
function state(): FishQualityState {
  const signals = [1, 2, 3].map((threshold, i) => ({ id: String(i), symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: 'BSS', cutoffMs: T, threshold, average: 4, cbi2: 4, startAverage: 4, previousAverage: 0, direction: '>' as const, scale: 1 } }));
  const study = enableQualityComparison(importQualityFish(newQualityStudy(T + 1), signals));
  study.selectedRowIds = qualityDisplayRows(study).map(r => r.id);
  return { study, ready: true, running: false, progress: null, warning: '', error: '', start: vi.fn(), restart: vi.fn(), cancel: vi.fn(), setRule: vi.fn(), setObserveHours: vi.fn(), selectSell: vi.fn(), setSelectedRows: vi.fn(), setPriority: vi.fn(), setFilters: vi.fn() };
}
afterEach(cleanup);
it('allows a veto-only sell plan to run and be fixed for detector comparison without an ordinary threshold',async()=>{
 const {makeQualityHoldingVeto}=await import('@/lib/fish/qualityFilters');
 const s=state(),plan=s.study.sellPlans![0];plan.holdingVetoes=[makeQualityHoldingVeto('static-drawdown','>=',5)];
 render(<FishQuality state={s}/>);
 const editor=screen.getByRole('button',{name:'设置状态 S 原始值卖出算法'});expect(editor).toHaveTextContent('仅一票否决');
 fireEvent.click(editor);fireEvent.click(screen.getByRole('button',{name:'固定此方案，比较探测算法'}));
 expect(s.selectSell).toHaveBeenCalledWith(plan.id);expect(screen.queryByRole('button',{name:'清除门槛'})).toBeNull();
 fireEvent.click(editor);fireEvent.click(screen.getByRole('tab',{name:/比较探测/}));
 expect(within(screen.getByLabelText('固定卖出方案')).getByRole('option',{name:'状态 S 原始值 仅一票否决'})).toBeInTheDocument();
});
it('defaults to one row per symbol/time, toggles detector details from the header and preserves partial and bulk selection',()=>{
 const s=state(), ids=s.study.selectedRowIds!;
 s.study.selectedRowIds=[ids[0]];
 const view=render(<FishQuality state={s}/>);
 const toggle=screen.getByRole('button',{name:'展开探测算法明细'});
 expect(toggle).toHaveAttribute('aria-expanded','false');expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1);
 const checkbox=()=>within(screen.getAllByTestId('quality-fish-row')[0]).getByRole('checkbox') as HTMLInputElement;
 expect(checkbox().indeterminate).toBe(true);expect(checkbox()).not.toBeChecked();
 fireEvent.click(checkbox());expect(s.setSelectedRows).toHaveBeenLastCalledWith(expect.arrayContaining(ids));
 s.study={...s.study,selectedRowIds:vi.mocked(s.setSelectedRows).mock.calls.at(-1)![0]};view.rerender(<FishQuality state={s}/>);
 expect(qualityRunSamples(s.study)).toHaveLength(1);expect(checkbox()).toBeChecked();
 fireEvent.click(toggle);expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(3);expect(s.setSelectedRows).toHaveBeenCalledTimes(1);
 for(const row of screen.getAllByTestId('quality-fish-row'))expect(within(row).getByRole('checkbox')).toBeChecked();
 fireEvent.click(toggle);expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1);
 fireEvent.click(checkbox());expect(s.setSelectedRows).toHaveBeenLastCalledWith([]);
});
it('merges multiple entries and sources at the same signal time, displays result ranges, and expands to their original outcomes',()=>{
 const s=state(), first=s.study.samples[0];
 s.study.samples=[first,{...first,id:'later',enteredAt:first.enteredAt!+60000,groups:[s.study.groups[1].id],source:{...first.source,fish:s.study.samples[1].source.fish}}];
 s.study=importQualityLibrary(s.study,[{...first.source,id:'library',fish:undefined}]);
 const samples=qualityComparisonRows(s.study),plan=s.study.sellPlans![0];plan.rule={metric:plan.metric,direction:'<',threshold:.5};
 s.study.results=samples.map((r,i)=>({key:qualityResultKey(r,plan,0),sampleId:r.id,groupId:plan.id,evaluatedAt:T,status:'closed',returnPct:[10,-5,1][i],adversePct:-i,drawdownPct:i*2,heldHours:i+1}));
 s.study.selectedRowIds=qualityDisplayRows(s.study).map(r=>r.id);
 render(<FishQuality state={s}/>);
 expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1);expect(screen.getByTestId('quality-row-count')).toHaveTextContent('共 1 行 · 1 条信号');
 expect(screen.getByText('-5.00%～+10.00%')).toBeInTheDocument();
 expect(screen.getByTestId('quality-fish-row')).not.toHaveTextContent('信号库');
 fireEvent.click(screen.getByText('-5.00%～+10.00%'));expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(3);
 for(const label of ['+10.00%','-5.00%','+1.00%'])expect(screen.getByText(label)).toBeInTheDocument();
});
it('keeps source filters working without source badges in detector comparison rows', () => {
  const s=state();
  s.study.samples=s.study.samples.map(row=>({...row,source:{...row.source,mined:{anchorMs:T}}}));
  const plain={...s.study.samples[0].source,id:'manual',symbol:'BBBUSDT',mined:undefined};
  s.study=importQualityFish(s.study,[plain]);
  s.study=importQualityLibrary(s.study,[{id:'library',symbol:'CCCUSDT',timeMs:T,timeLabel:'',fallbackZone:''}]);
  render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('tab',{name:/比较探测/}));
  fireEvent.click(screen.getByRole('button',{name:'展开探测算法明细'}));
  const rows=screen.getAllByTestId('quality-fish-row');
  for(const row of rows) {
    expect(within(row).queryByText('默认值挖掘')).toBeNull();
    expect(within(row).queryByText('信号库')).toBeNull();
  }
  const source = screen.getByLabelText('鱼质量的来源');
  for (const label of ['全部来源（3）', '鱼（1）', '信号库（1）', '默认值（1）']) expect(within(source).getByRole('option', { name: label })).toBeInTheDocument();
  fireEvent.change(source, { target: { value: 'mined' } });
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(3);
  for(const row of screen.getAllByTestId('quality-fish-row')) { expect(row).toHaveTextContent('AAAUSDT'); expect(within(row).queryByText('默认值挖掘')).toBeNull(); }
  fireEvent.change(source, { target: { value: 'fish' } });
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1);
  expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('BBBUSDT');
  fireEvent.change(source, { target: { value: 'library' } });
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1);
  expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('CCCUSDT');
});
it('matches the cabin row layout, with two sells, one detector column, and three detector rows for one signal', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button',{name:'展开探测算法明细'}));
  expect(screen.getByTestId('fish-quality').parentElement).not.toHaveAttribute('data-testid', 'fish-cabin');
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(3); expect(screen.getAllByTestId('quality-sell-column')).toHaveLength(2); expect(screen.getAllByTestId('quality-detector-column')).toHaveLength(1);
  ['标的', '信号时间', '探测算法', '市场', '评分', '捕捞过程'].forEach(name => expect(screen.getByRole('columnheader', { name: new RegExp(name) })).toBeVisible());
  expect(screen.queryByTestId('quality-distribution')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^鱼质量/, expanded: true })); expect(screen.queryByTestId('quality-fish-table')).toBeNull();
  expect(s.study.samples).toHaveLength(3);
});
it('edits raw S and CDA sell thresholds from their headers, applies explicitly, and does not configure detectors as exits', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button', { name: '设置状态 S 原始值卖出算法' }));
  fireEvent.click(screen.getByRole('button', { name: '0.45' }));
  expect(s.setRule).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '应用并重算' }));
  expect(s.setRule).toHaveBeenCalledWith('sell-state-raw', { metric: 'state', direction: '<', threshold: .45 });
  fireEvent.change(screen.getByLabelText('状态 S 原始值卖出门槛'), { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: '应用并重算' }));
  expect(screen.getByRole('alert')).toHaveTextContent('有限数字');
});
it('lets the user fix one sell plan for detector comparisons from its header (no profit-distribution panel)', () => {
  const s = state(), row = qualityComparisonRows(s.study)[0];
  s.study.cohortIds = []; // Old saved batches must not hide the list after removing this feature.
  s.study.sellPlans!.forEach((p, i) => { p.rule = { metric: p.metric, direction: '<', threshold: i ? -8 : .5 }; s.study.results.push({ key: qualityResultKey(row, p, 0), sampleId: row.id, groupId: p.id, evaluatedAt: T, status: 'closed', returnPct: i ? -5 : 10 }); });
  render(<FishQuality state={s}/>);
  // 【用户要求】2026-10-26 盈亏分布模块删掉
  expect(screen.queryByRole('button', { name: /盈亏分布/ })).toBeNull(); expect(screen.queryByTestId('quality-distribution')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '设置状态 S 原始值卖出算法' }));
  fireEvent.click(screen.getByRole('button', { name: '固定此方案，比较探测算法' }));
  expect(s.selectSell).toHaveBeenCalledWith('sell-state-raw');
  expect(screen.queryByRole('button', { name: /固定当前批次|换用全部/ })).toBeNull();
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('筛选鱼质量信号'), { target: { value: 'ZZZ' } }); expect(screen.queryByTestId('quality-fish-row')).toBeNull();
});
it('keeps tracking/horizon controls compact and shows the paired trade metrics on demand', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button', { name: '鱼质量观察设置' }));
  fireEvent.change(screen.getByLabelText('鱼质量观察小时'), { target: { value: '-1' } }); fireEvent.blur(screen.getByLabelText('鱼质量观察小时')); expect(s.setObserveHours).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('鱼质量观察小时'), { target: { value: '72' } }); fireEvent.blur(screen.getByLabelText('鱼质量观察小时')); expect(s.setObserveHours).toHaveBeenCalledWith(72);
  expect(screen.queryByLabelText('自动跟踪新鱼及更新收益')).toBeNull();
});

// 【用户要求】2026-10-26 信号库的信号纳入卖出比较，并与鱼舱的鱼区分
it('filters library rows by source without symbol badges and keeps them out of detector columns', () => {
  const s = state();
  s.study = importQualityLibrary(s.study, [{ id: 'lib', symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '' }, { id: 'lib2', symbol: 'ZZZUSDT', timeMs: T, timeLabel: '', fallbackZone: '' }]);
  render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button',{name:'展开探测算法明细'}));
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(5);
  for(const row of screen.getAllByTestId('quality-fish-row')) expect(within(row).queryByText('信号库')).toBeNull();
  const source = screen.getByLabelText('鱼质量的来源');
  expect(within(source).getByRole('option', { name: '信号库（2）' })).toBeInTheDocument();
  fireEvent.change(source, { target: { value: 'library' } }); expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(2);
  for (const row of screen.getAllByTestId('quality-fish-row')) { expect(within(row).getByTestId('quality-detector-cell')).toHaveTextContent('—'); expect(within(row).queryByTestId('fish-process-open')).toBeNull(); }
  for (const r of screen.getAllByTestId('quality-fish-row')) expect(within(r).queryByText('信号库')).toBeNull();
  fireEvent.change(source, { target: { value: 'fish' } }); expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(3);
  expect(within(screen.getAllByTestId('quality-fish-row')[0]).queryByText('信号库')).toBeNull();
});

it('allows selecting only a filtered source across the scroll window, shows checked rows, and clears selection before a new run', () => {
  const s = state();
  s.study = importQualityLibrary(s.study, Array.from({length: 61}, (_,i) => ({id:`lib-${i}`,symbol:`COIN${i}USDT`,timeMs:T+i*60000,timeLabel:'',fallbackZone:''})));
  s.study.selectedRowIds = [];
  const view = render(<FishQuality state={s}/>);
  expect(screen.getByRole('button', {name:'更新收益'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('鱼质量的来源'), {target:{value:'library'}});
  fireEvent.click(screen.getByLabelText('全选当前筛选信号'));
  const ids = (s.setSelectedRows as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as string[];
  expect(ids).toHaveLength(61); expect(ids).not.toContain(qualityComparisonRows(s.study).find(r => r.origin !== 'library')!.id);
  s.study = {...s.study, selectedRowIds: ids}; view.rerender(<FishQuality state={s}/>);
  expect(screen.getByRole('button', {name:'更新收益'})).toBeEnabled();
  expect(screen.getByLabelText('全选当前筛选信号')).toBeChecked();
  const box = screen.getByTestId('quality-fish-table');
  box.scrollTop = 61 * 33; fireEvent.scroll(box);
  expect(screen.getByText('COIN0USDT')).toBeInTheDocument();
  expect(screen.getAllByRole('checkbox').every(el => (el as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getAllByRole('checkbox')[1]); expect((s.setSelectedRows as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toHaveLength(60);
  fireEvent.click(screen.getByLabelText('全选当前筛选信号')); expect(s.setSelectedRows).toHaveBeenLastCalledWith([]);
});

it('sorts the single detector column in both directions and filters to one exact detector/threshold row', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button',{name:'展开探测算法明细'}));
  fireEvent.click(screen.getByRole('button', {name:'按探测算法排序'}));
  const first = () => screen.getAllByTestId('quality-detector-cell')[0];
  expect(first()).toHaveTextContent('> 1');
  fireEvent.click(screen.getByRole('button', {name:'按探测算法排序'})); expect(first()).toHaveTextContent('> 3');
  fireEvent.click(screen.getByRole('button', {name:'鱼质量的探测算法'}));
  fireEvent.click(within(screen.getByTestId('quality-detector-picker')).getByRole('button', {name:/^只看 .* > 2$/}));
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1); expect(first()).toHaveTextContent('> 2');
});

// 【用户反馈】2026-10-26「表头显示 793，但表中完全没这么多」：不再分页，所有行在同一个滚动框里
it('keeps every row reachable in one scroll box, renders only the visible window and counts months within the source filter', () => {
  const s = state();
  const lib = Array.from({ length: 300 }, (_, i) => ({ id: `l${i}`, symbol: `S${String(i).padStart(3, '0')}USDT`, timeMs: T - i * 3600_000, timeLabel: '', fallbackZone: '' }));
  s.study = importQualityLibrary(s.study, lib);
  render(<FishQuality state={s}/>);
  expect(screen.getByTestId('quality-row-count')).toHaveTextContent('共 301 行 · 301 条信号');
  expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
  const shown = screen.getAllByTestId('quality-fish-row').length;
  expect(shown).toBeGreaterThan(10); expect(shown).toBeLessThan(60);
  const box = screen.getByTestId('quality-fish-table');
  box.scrollTop = 300 * 33; fireEvent.scroll(box);
  expect(screen.getByText('S299USDT')).toBeInTheDocument(); expect(screen.queryByText('S000USDT')).toBeNull();
  fireEvent.change(screen.getByLabelText('鱼质量的来源'), { target: { value: 'fish' } });
  expect(screen.getByTestId('quality-row-count')).toHaveTextContent('共 1 行 · 1 条信号 · 已合并探测明细（筛选自 301 条信号）');
  expect(within(screen.getByLabelText('鱼质量的月份')).getByRole('option', { name: '全部月份（1）' })).toBeInTheDocument();
});

it('sorts each sell header by numeric return in both directions, keeps missing results last, and links sold trades to campaigns', () => {
  const s = state();
  s.study = importQualityLibrary(s.study, ['LOSS', 'GAIN', 'MISSING'].map((symbol, i) => ({ id: `lib-${i}`, symbol, timeMs: T, timeLabel: '', fallbackZone: '' })));
  s.study.sellPlans!.forEach(p => { p.rule = { metric: p.metric, direction: '<', threshold: .5 }; });
  const rows = qualityComparisonRows(s.study);
  s.study.results = rows.filter(r => r.source.symbol !== 'MISSING').flatMap(row => s.study.sellPlans!.map(p => {
    const value = row.source.symbol === 'GAIN' ? 30 : row.source.symbol === 'LOSS' ? -20 : 10;
    return { key: qualityResultKey(row, p, 0), sampleId: row.id, groupId: p.id, evaluatedAt: T + 600000, status: 'closed' as const, entryTime: T, entryPrice: 100, endTime: T + 600000, endPrice: 100 + value, returnPct: value, pnl: value, peakPct: 40 };
  }));
  render(<FishQuality state={s}/>);
  const symbols = () => screen.getAllByTestId('quality-fish-row').map(r => r.textContent);
  for (const label of ['状态 S 原始值', 'CDA 原始值']) {
    fireEvent.click(screen.getByRole('button', { name: `按${label}收益率排序` }));
    expect(symbols()[0]).toContain('GAIN'); expect(symbols().at(-1)).toContain('MISSING');
    fireEvent.click(screen.getByRole('button', { name: `按${label}收益率排序` }));
    expect(symbols()[0]).toContain('LOSS'); expect(symbols().at(-1)).toContain('MISSING');
  }
  const link = screen.getAllByRole('link', { name: /已卖出/ })[0];
  expect(link.getAttribute('href')).toMatch(/^\/journal\/campaigns\/fish-sell-.*\?section=sell$/);
  expect(screen.getAllByTestId('quality-sell-column')[1]).toHaveAttribute('aria-sort', 'ascending');
});

// 【用户要求】2026-10-26 盈亏分布模块与卖出方案同步提示都删掉，盘面保持干净
it('shows no profit-distribution panel or definition-sync notice, even after a run finishes', () => {
  const s = state(), row = qualityComparisonRows(s.study)[0], p = s.study.sellPlans![0];
  p.rule = { metric: p.metric, direction: '<', threshold: .5 };
  const view = render(<FishQuality state={{ ...s, running: true }}/>);
  s.study = { ...s.study, results: [{ key: qualityResultKey(row, p, 0), sampleId: row.id, groupId: p.id, evaluatedAt: T, status: 'closed', returnPct: -12, peakPct: 24 }] };
  view.rerender(<FishQuality state={s}/>);
  expect(screen.queryByTestId('quality-distribution')).toBeNull();
  expect(screen.queryByText(/卖出方案已同步/)).toBeNull(); expect(screen.queryByText(/正在纠错/)).toBeNull();
});
it('hands the evaluator the on-screen rows first and updates that order after scrolling', () => {
  const s = state();
  s.study = importQualityLibrary(s.study, Array.from({ length: 200 }, (_, i) => ({ id: `l${i}`, symbol: `S${String(i).padStart(3, '0')}USDT`, timeMs: T - (i + 1) * 3600_000, timeLabel: '', fallbackZone: '' })));
  render(<FishQuality state={s}/>);
  const rows = qualityComparisonRows(s.study), byId = new Map(rows.map(r => [r.id, r.source.symbol]));
  const firstCall = vi.mocked(s.setPriority).mock.calls.at(-1)![0];
  expect(byId.get(firstCall[0])).toBe('AAAUSDT'); expect(new Set(firstCall).size).toBe(rows.length);
  const box = screen.getByTestId('quality-fish-table'); box.scrollTop = 200 * 33; fireEvent.scroll(box);
  const afterScroll = vi.mocked(s.setPriority).mock.calls.at(-1)![0];
  expect(byId.get(afterScroll[0])).not.toBe('AAAUSDT'); expect(screen.getByText(byId.get(afterScroll[0])!)).toBeInTheDocument();
});

// 【用户要求】2026-10-26 比较卖出时的买入过滤（条件由用户设）
it('lets the user add, edit and apply buy conditions, then marks rows that were not bought', async () => {
  const { makeQualityBuyFilter } = await import('@/lib/fish/qualityFilters');
  const { qualityFilterReadingKey } = await import('@/lib/fish/quality');
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button', { name: '过滤与持仓否决' }));
  expect(screen.getByText('未设置条件：全部信号都买入')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '添加条件' }));
  expect(screen.getByLabelText('买入条件 1 指标')).toHaveValue('state:state'); expect(screen.getByLabelText('买入条件 1 门槛')).toHaveValue(.7);
  fireEvent.change(screen.getByLabelText('买入条件 1 门槛'), { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: /^应用到「状态 S 原始值」筛选$/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('有限数字'); expect(s.setFilters).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('买入条件 1 门槛'), { target: { value: '0.65' } }); fireEvent.click(screen.getByRole('button', { name: /^应用到「状态 S 原始值」筛选$/ }));
  expect(s.setFilters).toHaveBeenCalledWith(s.study.sellPlans![0].id, [expect.objectContaining({ label: '状态 S 原始值', metric: 'state', direction: '>', threshold: .65, enabled: true })],[]);
  cleanup();
  const f = makeQualityBuyFilter('state:state', '>', .65), row = qualityComparisonRows(s.study)[0];
  s.study = { ...s.study, buyFilters: [f], filterReadings: [{ key: qualityFilterReadingKey(row, f), value: .5 }] };
  render(<FishQuality state={s}/>);
  // 旧版本的全局过滤沿用到每套方案
  expect(screen.getByRole('button', { name: '过滤与持仓否决' })).toHaveTextContent('2');
  const notBought = within(screen.getAllByTestId('quality-fish-row')[0]).getAllByText('未买入');
  expect(notBought.length).toBeGreaterThanOrEqual(2);
  expect(notBought[0]).toHaveAttribute('title', expect.stringContaining('状态 S 原始值 0.5 不满足 > 0.65'));
  fireEvent.click(screen.getByRole('tab', { name: /比较探测/ })); expect(within(screen.getAllByTestId('quality-fish-row')[0]).queryByText('未买入')).toBeNull();
});
// 【用户要求】2026-10-26「鱼质量中的所有表头都要能够排序」
it('sorts by every header, keeping empty values last in both directions', () => {
  const s = state();
  s.study = importQualityLibrary(s.study, [{ id: 'l1', symbol: 'BBBUSDT', timeMs: T - 3600_000, timeLabel: '', fallbackZone: '', quality: 5 }, { id: 'l2', symbol: 'CCCUSDT', timeMs: T - 7200_000, timeLabel: '', fallbackZone: '', quality: 2 }]);
  const plan = s.study.sellPlans![0]; plan.rule = { metric: plan.metric, direction: '<', threshold: .5 };
  const rows = qualityComparisonRows(s.study), lib1 = rows.find(r => r.source.symbol === 'BBBUSDT')!, lib2 = rows.find(r => r.source.symbol === 'CCCUSDT')!;
  s.study.results.push({ key: qualityResultKey(lib1, plan, 0), sampleId: lib1.id, groupId: plan.id, evaluatedAt: T, status: 'closed', returnPct: -3 }, { key: qualityResultKey(lib2, plan, 0), sampleId: lib2.id, groupId: plan.id, evaluatedAt: T, status: 'closed', returnPct: 8 });
  render(<FishQuality state={s}/>);
  const symbols = () => [...new Set(screen.getAllByTestId('quality-fish-row').map(r => r.textContent!.match(/[A-Z]{3}USDT/)![0]))];
  for (const label of ['标的', '信号时间', '市场', '评分', '捕捞过程', '探测算法']) expect(screen.getByRole('button', { name: `按${label}排序` })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '按评分排序' })); expect(symbols()).toEqual(['BBBUSDT', 'CCCUSDT', 'AAAUSDT']);
  fireEvent.click(screen.getByRole('button', { name: '按评分排序' })); expect(symbols()).toEqual(['CCCUSDT', 'BBBUSDT', 'AAAUSDT']); // 无评分仍在最后
  fireEvent.click(screen.getByRole('button', { name: '按状态 S 原始值收益率排序' })); expect(symbols()).toEqual(['CCCUSDT', 'BBBUSDT', 'AAAUSDT']);
  fireEvent.click(screen.getByRole('button', { name: '按状态 S 原始值收益率排序' })); expect(symbols()).toEqual(['BBBUSDT', 'CCCUSDT', 'AAAUSDT']);
  fireEvent.click(screen.getByRole('button', { name: '按捕捞过程排序' })); expect(symbols()[0]).toBe('AAAUSDT');
  fireEvent.click(screen.getByRole('button', { name: '按标的排序' })); expect(symbols()).toEqual(['AAAUSDT', 'BBBUSDT', 'CCCUSDT']);
  expect(screen.getByRole('columnheader', { name: /标的/ })).toHaveAttribute('aria-sort', 'ascending');
});
it('sorts sell returns among bought signals only; not-bought and pending rows stay last', async () => {
  const { makeQualityBuyFilter } = await import('@/lib/fish/qualityFilters');
  const { qualityFilterReadingKey } = await import('@/lib/fish/quality');
  const s = state();
  s.study = importQualityLibrary(s.study, ['BBB', 'CCC', 'DDD'].map((b, i) => ({ id: b, symbol: `${b}USDT`, timeMs: T - (i + 1) * 3600_000, timeLabel: '', fallbackZone: '' })));
  const plan = s.study.sellPlans![0], f = makeQualityBuyFilter('state:state', '>', .7); plan.rule = { metric: plan.metric, direction: '<', threshold: .5 };
  const rows = qualityComparisonRows(s.study), by = (sym: string) => rows.find(r => r.source.symbol === sym)!;
  // BBB 收益最高但没买入，CCC 待判断，DDD 买入
  s.study.results.push(...[['BBBUSDT', 50], ['CCCUSDT', 40], ['DDDUSDT', 1]].map(([sym, v]) => ({ key: qualityResultKey(by(sym as string), plan, 0), sampleId: by(sym as string).id, groupId: plan.id, evaluatedAt: T, status: 'closed' as const, returnPct: v as number })));
  s.study = { ...s.study, buyFilters: [f], filterReadings: [{ key: qualityFilterReadingKey(by('BBBUSDT'), f), value: .1 }, { key: qualityFilterReadingKey(by('DDDUSDT'), f), value: .9 }] };
  render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button', { name: '按状态 S 原始值收益率排序' }));
  expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('DDDUSDT');
});
it('links only sold or held trades to their campaign; a registered buy waiting for a threshold is not a link', () => {
  const s = state(), row = qualityComparisonRows(s.study)[0], [sPlan, cPlan] = s.study.sellPlans!;
  sPlan.rule = { metric: sPlan.metric, direction: '<', threshold: .5 };
  s.study.results.push({ key: qualityResultKey(row, sPlan, 0), sampleId: row.id, groupId: sPlan.id, evaluatedAt: T, status: 'closed', entryTime: T, entryPrice: 10, endTime: T + 60_000, endPrice: 11, pnl: 10, returnPct: 10 },
    { key: qualityResultKey(row, cPlan, 0), sampleId: row.id, groupId: cPlan.id, evaluatedAt: T, status: 'waiting', entryTime: T, entryPrice: 10 });
  render(<FishQuality state={s}/>);
  const first = screen.getAllByTestId('quality-fish-row')[0];
  expect(within(first).getByText('已卖出').closest('a')).not.toBeNull();
  expect(within(first).getByText('待设门槛').closest('a')).toBeNull();
});
it('shows and independently sorts both drawdown columns next to each sell return, preserving zero and missing values',()=>{
 const s=state();s.study=importQualityLibrary(s.study,['HIGH','LOW','MISSING'].map(symbol=>({id:symbol,symbol,timeMs:T,timeLabel:'',fallbackZone:''})));
 const [sp,cp]=s.study.sellPlans!;sp.rule={metric:sp.metric,direction:'<',threshold:.5};cp.rule={metric:cp.metric,direction:'<',threshold:-8};
 for(const row of qualityComparisonRows(s.study).filter(r=>['HIGH','LOW'].includes(r.source.symbol))) for(const p of [sp,cp]){
  const high=row.source.symbol==='HIGH',state=p===sp;
  s.study.results.push({key:qualityResultKey(row,p,0),sampleId:row.id,groupId:p.id,evaluatedAt:T,status:'closed',returnPct:high?10:-5,adversePct:state?(high?-25:0):(high?-2:-40),drawdownPct:state?(high?35:8):(high?6:50)});
 }
 render(<FishQuality state={s}/>);
 const high=()=>screen.getAllByTestId('quality-fish-row').find(r=>r.textContent?.includes('HIGH'))!;
 const low=()=>screen.getAllByTestId('quality-fish-row').find(r=>r.textContent?.includes('LOW'))!;
 const missing=()=>screen.getAllByTestId('quality-fish-row').find(r=>r.textContent?.includes('MISSING'))!;
 expect(within(high()).getAllByTestId('quality-static-drawdown').map(x=>x.textContent)).toEqual(['25.00%','2.00%']);
 expect(within(high()).getAllByTestId('quality-dynamic-drawdown').map(x=>x.textContent)).toEqual(['35.00%','6.00%']);
 expect(within(low()).getAllByTestId('quality-static-drawdown')[0]).toHaveTextContent('0.00%');
 expect(within(missing()).getAllByTestId('quality-static-drawdown').every(x=>x.textContent==='—')).toBe(true);
 for(const type of ['静态','动态']){
  fireEvent.click(screen.getByRole('button',{name:`按状态 S 原始值${type}最大回撤排序`}));expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('HIGH');
  fireEvent.click(screen.getByRole('button',{name:`按状态 S 原始值${type}最大回撤排序`}));expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('LOW');
  expect(screen.getAllByTestId('quality-fish-row').at(-1)).toHaveTextContent('MISSING');
  fireEvent.click(screen.getByRole('button',{name:`按CDA 原始值${type}最大回撤排序`}));expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('LOW');
 }
 fireEvent.click(screen.getByRole('tab',{name:/比较探测/}));expect(screen.queryByTestId('quality-static-drawdown')).toBeNull();expect(screen.queryByTestId('quality-dynamic-drawdown')).toBeNull();
});
// 【用户要求】2026-10-26「卖出比较的列表，我希望可以批量选中，比如按住 shift 就可以进行连续选择」
it('shift-click selects (or clears) the whole run of rows between the last clicked row and this one, in on-screen order', () => {
  const s = state();
  s.study = importQualityLibrary(s.study, Array.from({length: 8}, (_,i) => ({id:`lib-${i}`,symbol:`COIN${i}USDT`,timeMs:T+i*60000,timeLabel:'',fallbackZone:''})));
  s.study.selectedRowIds = [];
  const view = render(<FishQuality state={s}/>);
  fireEvent.change(screen.getByLabelText('鱼质量的来源'), {target:{value:'library'}});
  const set = s.setSelectedRows as ReturnType<typeof vi.fn>;
  const boxes = () => screen.getAllByTestId('quality-fish-row').map(row => within(row).getByRole('checkbox'));
  const symbols = () => screen.getAllByTestId('quality-fish-row').map(row => row.textContent!.match(/COIN\d+USDT/)![0]);
  const shown = symbols();
  fireEvent.click(boxes()[1]);
  let ids = set.mock.calls.at(-1)![0] as string[];
  expect(ids).toHaveLength(1);
  s.study = {...s.study, selectedRowIds: ids}; view.rerender(<FishQuality state={s}/>);
  fireEvent.click(boxes()[5], {shiftKey: true});
  ids = set.mock.calls.at(-1)![0] as string[];
  expect(ids).toHaveLength(5);
  s.study = {...s.study, selectedRowIds: ids}; view.rerender(<FishQuality state={s}/>);
  expect(boxes().map(b => (b as HTMLInputElement).checked)).toEqual(shown.map((_, i) => i >= 1 && i <= 5));
  // 再按住 Shift 往回点一行已选的：从上次点的那行到这一行一起取消
  fireEvent.click(boxes()[3], {shiftKey: true});
  ids = set.mock.calls.at(-1)![0] as string[];
  s.study = {...s.study, selectedRowIds: ids}; view.rerender(<FishQuality state={s}/>);
  expect(boxes().map(b => (b as HTMLInputElement).checked)).toEqual(shown.map((_, i) => i >= 1 && i <= 2));
  expect(boxes()[0]).toHaveAttribute('title', '按住 Shift 点另一行可连续选择');
});
it('provides two unconfigured drawdown vetoes, validates the user threshold, and can add an account indicator veto', () => {
 const s=state();render(<FishQuality state={s}/>);fireEvent.click(screen.getByRole('button',{name:'过滤与持仓否决'}));
 const editor=screen.getByTestId('quality-holding-veto-editor');
 expect(within(editor).getByLabelText('持仓否决 1 指标')).toHaveValue('static-drawdown');
 expect(within(editor).getByLabelText('持仓否决 2 指标')).toHaveValue('dynamic-drawdown');
 expect(within(editor).getByLabelText('持仓否决 1 阈值')).toHaveValue(null);expect(within(editor).getByLabelText('启用持仓否决 1')).not.toBeChecked();
 fireEvent.click(within(editor).getByLabelText('启用持仓否决 1'));fireEvent.click(screen.getByRole('button',{name:/^应用到「状态 S 原始值」并重算$/}));
 expect(screen.getByRole('alert')).toHaveTextContent('填写有限数字');expect(s.setFilters).not.toHaveBeenCalled();
 fireEvent.change(within(editor).getByLabelText('持仓否决 1 阈值'),{target:{value:'-10'}});fireEvent.click(screen.getByRole('button',{name:/^应用到「状态 S 原始值」并重算$/}));
 expect(screen.getByRole('alert')).toHaveTextContent('大于 0');
 fireEvent.change(within(editor).getByLabelText('持仓否决 1 阈值'),{target:{value:'12'}});
 fireEvent.click(within(editor).getByRole('button',{name:'添加否决条件'}));
 fireEvent.change(within(editor).getByLabelText('持仓否决 3 指标'),{target:{value:'state:state'}});
 fireEvent.change(within(editor).getByLabelText('持仓否决 3 方向'),{target:{value:'<='}});
 fireEvent.change(within(editor).getByLabelText('持仓否决 3 阈值'),{target:{value:'.4'}});fireEvent.click(within(editor).getByLabelText('启用持仓否决 3'));
 fireEvent.click(screen.getByRole('button',{name:/^应用到「状态 S 原始值」并重算$/}));
 expect(s.setFilters).toHaveBeenCalledWith(s.study.sellPlans![0].id,[],[expect.objectContaining({kind:'static-drawdown',threshold:12,enabled:true}),expect.objectContaining({kind:'indicator',metric:'state',direction:'<=',threshold:.4,enabled:true})]);
});
it('shows the effective decimal threshold for duplicate static vetoes without silently enabling a dynamic veto',async()=>{
 const {makeQualityHoldingVeto}=await import('@/lib/fish/qualityFilters');
 const s=state();s.study.sellPlans![0].holdingVetoes=[makeQualityHoldingVeto('static-drawdown','>=',7.7),makeQualityHoldingVeto('static-drawdown','>=',30)];
 render(<FishQuality state={s}/>);fireEvent.click(screen.getByRole('button',{name:'过滤与持仓否决'}));
 const summary=screen.getByTestId('quality-veto-risk-summary');
 expect(summary).toHaveTextContent('静态回撤 ≥ 7.7%（同类条件中较小阈值先触发）；动态回撤否决未启用');
 expect(s.setFilters).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('持仓否决 2 指标'),{target:{value:'dynamic-drawdown'}});
 expect(summary).toHaveTextContent('静态回撤 ≥ 7.7%；动态回撤 ≥ 30%');
 fireEvent.click(screen.getByRole('button',{name:'应用到「状态 S 原始值」并重算'}));
 expect(s.setFilters).toHaveBeenCalledWith('sell-state-raw',[],[expect.objectContaining({kind:'static-drawdown',threshold:7.7}),expect.objectContaining({kind:'dynamic-drawdown',threshold:30})]);
});
// 【用户要求】2026-10-26 从鱼质量点进交易战役，返回时回到鱼质量原来的位置
it('opens with the remembered tab, filters and sort when coming back from a campaign', async () => {
  const { saveQualityReturn, armQualityReturn, finishQualityReturn } = await import('@/lib/fish/qualityReturn');
  window.history.replaceState({ key: 'fish-entry', idx: 1 }, '');
  saveQualityReturn({ ui: { open: true, query: 'AAA', month: '', algorithm: '', origin: '', phase: 'detect', detectorExpanded: true, sort: 'symbol', ascending: true, tableTop: 0 }, scroll: [] });
  expect(armQualityReturn()).toBe(true);
  render(<FishQuality state={state()}/>);
  expect(screen.getByRole('tab', {name: /比较探测/})).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('筛选鱼质量信号')).toHaveValue('AAA');
  expect(screen.getByRole('columnheader', {name: /标的/})).toHaveAttribute('aria-sort', 'ascending');
  expect(screen.getByRole('button',{name:'展开探测算法明细'})).toHaveAttribute('aria-expanded','true');
  finishQualityReturn();
  cleanup();
  render(<FishQuality state={state()}/>);
  expect(screen.getByLabelText('筛选鱼质量信号')).toHaveValue('');
});
// 【用户要求】2026-10-26「每一个过滤门槛与卖出算法绑定」「在每个卖出算法的动态最大回撤的后面，再增加一个持仓时间」
it('edits buy filters per sell plan, marks not-bought only under the plan that filters, and shows a sortable holding time after each dynamic drawdown', async () => {
  const { makeQualityBuyFilter } = await import('@/lib/fish/qualityFilters');
  const { qualityFilterReadingKey } = await import('@/lib/fish/quality');
  const s = state();
  s.study = importQualityLibrary(s.study, [{ id: 'l1', symbol: 'BBBUSDT', timeMs: T - 3600_000, timeLabel: '', fallbackZone: '' }, { id: 'l2', symbol: 'CCCUSDT', timeMs: T - 7200_000, timeLabel: '', fallbackZone: '' }]);
  const [sPlan, cPlan] = s.study.sellPlans!, f = makeQualityBuyFilter('state:state', '>', .7);
  for (const p of [sPlan, cPlan]) p.rule = { metric: p.metric, direction: '<', threshold: .5 };
  sPlan.buyFilters = [f]; cPlan.buyFilters = [];
  const rows = qualityComparisonRows(s.study), by = (sym: string) => rows.find(r => r.source.symbol === sym)!;
  s.study.filterReadings = [{ key: qualityFilterReadingKey(by('BBBUSDT'), f), value: .1 }, { key: qualityFilterReadingKey(by('CCCUSDT'), f), value: .9 }];
  s.study.results = ['BBBUSDT', 'CCCUSDT'].flatMap((sym, i) => [sPlan, cPlan].map(p => ({ key: qualityResultKey(by(sym), p, 0), sampleId: by(sym).id, groupId: p.id, evaluatedAt: T, status: 'closed' as const, entryTime: T, entryPrice: 100, endTime: T + 1, endPrice: 101, returnPct: 1, pnl: 1, heldHours: i ? 30 : .5 })));
  render(<FishQuality state={s}/>);
  const row = (sym: string) => screen.getAllByTestId('quality-fish-row').find(r => r.textContent!.includes(sym))!;
  // BBB 在状态 S 方案下没买入（不满足 > 0.7），在 CDA 方案（不过滤）下照常有结果
  const held = (sym: string) => within(row(sym)).getAllByTestId('quality-held-time').map(c => c.textContent);
  expect(held('BBBUSDT')).toEqual(['—', '30 分钟']);
  expect(held('CCCUSDT')).toEqual(['30.0 小时', '30.0 小时']);
  expect(within(row('BBBUSDT')).getAllByText('未买入')).toHaveLength(1);
  // 持仓时间列紧跟动态最大回撤，并且能排序
  const headers = screen.getAllByRole('columnheader').map(h => h.textContent ?? '');
  const dyn = headers.findIndex(h => h.startsWith('动态最大回撤'));
  expect(headers[dyn + 1]).toMatch(/^持仓时间/);
  fireEvent.click(screen.getByRole('button', { name: '按CDA 原始值持仓时间排序' }));
  const order = () => [...new Set(screen.getAllByTestId('quality-fish-row').map(r => r.textContent!.match(/[A-Z]{3}USDT/)![0]))];
  expect(order().slice(0, 2)).toEqual(['CCCUSDT', 'BBBUSDT']);
  // 表头的「不过滤」直接打开这套方案的过滤设置
  expect(screen.getByRole('button', { name: '设置状态 S 原始值的买入过滤' })).toHaveTextContent('买入过滤 1 条');
  fireEvent.click(screen.getByRole('button', { name: '设置CDA 原始值的买入过滤' }));
  expect(await screen.findByRole('tab', { name: 'CDA 原始值' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('未设置条件：全部信号都买入')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '添加条件' }));
  fireEvent.click(screen.getByRole('button', { name: /^应用到「CDA 原始值」筛选$/ }));
  expect(s.setFilters).toHaveBeenLastCalledWith(cPlan.id, [expect.objectContaining({ metric: 'state', threshold: .7 })], expect.any(Array));
});

it('offers restart during a sell run, uses a separate action and requires a selected row', () => {
  const s = state(); s.running = true; s.progress = { done: 3, total: 6, current: 'AAAUSDT' };
  const view = render(<FishQuality state={s}/>);
  const restart = screen.getByRole('button', { name: '重新开始' });
  expect(restart).toBeEnabled();
  fireEvent.click(restart); expect(s.restart).toHaveBeenCalledOnce(); expect(s.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('tab', { name: /比较探测/ })); expect(screen.queryByRole('button', { name: '重新开始' })).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /比较卖出/ }));
  s.study = { ...s.study, selectedRowIds: [] }; view.rerender(<FishQuality state={s}/>);
  expect(screen.getByRole('button', { name: '重新开始' })).toBeDisabled();
});
// 【用户要求】2026-10-26「比较探测中，我希望可以在列表中的表头直接选中对应的算法（可以选中一个，也可以选中多个）」
it('picks one or several detectors straight from the detector header, keeps the toolbar in sync and clears with 全部', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('tab', { name: /比较探测/ }));
  fireEvent.click(screen.getByRole('button', { name: '展开探测算法明细' }));
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: '在表头选择探测算法' }));
  const picker = screen.getByTestId('quality-detector-picker');
  expect(within(picker).getAllByRole('checkbox')).toHaveLength(3);
  fireEvent.click(within(picker).getByRole('checkbox', { name: /> 1$/ }));
  fireEvent.click(within(picker).getByRole('checkbox', { name: /> 3$/ }));
  const thresholds = () => screen.getAllByTestId('quality-detector-cell').map(c => c.textContent!.match(/> (\d)/)![1]).sort();
  expect(thresholds()).toEqual(['1', '3']);
  expect(screen.getByRole('button', { name: '鱼质量的探测算法' })).toHaveTextContent('探测算法 · 已选 2 个');
  expect(screen.getByRole('button', { name: '在表头选择探测算法' })).toHaveTextContent('2');
  expect(within(picker).getByText('已选 2 / 3')).toBeInTheDocument();
  // 再点一次取消其中一个
  fireEvent.click(within(picker).getByRole('checkbox', { name: /> 1$/ }));
  expect(thresholds()).toEqual(['3']);
  expect(screen.getByRole('button', { name: '鱼质量的探测算法' })).toHaveTextContent(/> 3$/);
  fireEvent.click(within(picker).getByRole('button', { name: '全部' }));
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(3);
  expect(screen.getByRole('button', { name: '鱼质量的探测算法' })).toHaveTextContent('全部探测算法');
});

it('places independent filter results immediately after capture, runs without sell rules and sorts readings with missing values last', async () => {
  const { makeQualityBuyFilter } = await import('@/lib/fish/qualityFilters');
  const { qualityFilterReadingKey } = await import('@/lib/fish/quality');
  const s = state(), f = makeQualityBuyFilter('state:state', '>', .7);
  s.study = importQualityLibrary(s.study, ['LOWUSDT', 'HIGHUSDT', 'PENDINGUSDT'].map((symbol, i) => ({ id: symbol, symbol, timeMs: T + i * 60000, timeLabel: '', fallbackZone: '' })));
  s.study.sellPlans = s.study.sellPlans!.map(p => ({ ...p, buyFilters: [f] }));
  s.study.selectedRowIds = qualityDisplayRows(s.study).map(r => r.id);
  s.study.filterReadings = qualityComparisonRows(s.study).filter(r => r.source.symbol !== 'PENDINGUSDT').map(r => ({ key: qualityFilterReadingKey(r, f), value: r.source.symbol === 'LOWUSDT' ? .5 : .9, at: T }));
  const view = render(<FishQuality state={s}/>);
  const headers = screen.getAllByRole('columnheader'), filterColumn = screen.getByTestId('quality-filter-column');
  expect(headers[4]).toHaveTextContent('捕捞过程'); expect(headers[5]).toBe(filterColumn); expect(filterColumn).toHaveTextContent('过滤 · 状态 S 原始值'); expect(filterColumn).toHaveTextContent('> 0.7');
  expect(screen.getAllByTestId('quality-filter-column')).toHaveLength(1);
  const run = screen.getByRole('button', { name: '运行过滤' }); expect(run).toBeEnabled(); fireEvent.click(run); expect(s.start).toHaveBeenCalledTimes(1);
  const reading = (symbol: string) => within(screen.getAllByTestId('quality-fish-row').find(row => row.textContent!.includes(symbol))!).getByTestId('quality-filter-cell');
  expect(reading('LOWUSDT')).toHaveTextContent('0.5不满足'); expect(reading('HIGHUSDT')).toHaveTextContent('0.9满足'); expect(reading('PENDINGUSDT')).toHaveTextContent('—待计算');
  const sorter = within(filterColumn).getByRole('button'); fireEvent.click(sorter);
  expect(filterColumn).toHaveAttribute('aria-sort', 'descending'); expect(screen.getAllByTestId('quality-fish-row').at(-1)).toHaveTextContent('PENDINGUSDT');
  fireEvent.click(sorter); expect(filterColumn).toHaveAttribute('aria-sort', 'ascending'); expect(screen.getAllByTestId('quality-fish-row')[0]).toHaveTextContent('LOWUSDT');
  s.study = { ...s.study, sellPlans: s.study.sellPlans.map(p => ({ ...p, buyFilters: [{ ...f, threshold: .4 }] })) };
  view.rerender(<FishQuality state={s}/>); expect(reading('LOWUSDT')).toHaveTextContent('0.5满足'); expect(s.start).toHaveBeenCalledTimes(1);
});
