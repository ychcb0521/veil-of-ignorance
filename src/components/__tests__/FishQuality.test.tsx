import { fireEvent, render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishQuality } from '@/components/FishQuality';
import { importQualityFish, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityDisplayRows, qualityResultKey } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';
import type { FishQualityState } from '@/hooks/useFishQuality';
const T = Date.UTC(2026, 9, 20);
function state(): FishQualityState {
  const signals = [1, 2, 3].map((threshold, i) => ({ id: String(i), symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: 'BSS', cutoffMs: T, threshold, average: 4, cbi2: 4, startAverage: 4, previousAverage: 0, direction: '>' as const, scale: 1 } }));
  const study = enableQualityComparison(importQualityFish(newQualityStudy(T + 1), signals));
  study.selectedRowIds = qualityDisplayRows(study).map(r => r.id);
  return { study, ready: true, running: false, progress: null, warning: '', error: '', definitionNotice: '', start: vi.fn(), cancel: vi.fn(), setRule: vi.fn(), setObserveHours: vi.fn(), setTracking: vi.fn(), selectSell: vi.fn(), setCohort: vi.fn(), setSelectedRows: vi.fn(), setPriority: vi.fn(), setBuyFilters: vi.fn() };
}
afterEach(cleanup);
it('labels automatically mined fish beside the existing library source label in detector comparison rows', () => {
  const s=state();
  s.study.samples=s.study.samples.map(row=>({...row,source:{...row.source,mined:{anchorMs:T}}}));
  const plain={...s.study.samples[0].source,id:'manual',symbol:'BBBUSDT',mined:undefined};
  s.study=importQualityFish(s.study,[plain]);
  s.study=importQualityLibrary(s.study,[{id:'library',symbol:'CCCUSDT',timeMs:T,timeLabel:'',fallbackZone:''}]);
  render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('tab',{name:/比较探测/}));
  const rows=screen.getAllByTestId('quality-fish-row');
  const mined=rows.filter(row=>within(row).queryByText('默认值挖掘'));
  expect(mined).toHaveLength(3);
  expect(rows.filter(row=>within(row).queryByText('信号库'))).toHaveLength(1);
  expect(within(rows.find(row=>row.textContent?.includes('BBBUSDT'))!).queryByText('默认值挖掘')).toBeNull();
});
it('matches the cabin row layout, with two sells, one detector column, and three detector rows for one signal', () => {
  const s = state(); render(<FishQuality state={s}/>);
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
it('compares the common sample and lets the user fix one sell plan for detector comparisons', () => {
  const s = state(), row = qualityComparisonRows(s.study)[0];
  s.study.sellPlans!.forEach((p, i) => { p.rule = { metric: p.metric, direction: '<', threshold: i ? -8 : .5 }; s.study.results.push({ key: qualityResultKey(row, p, 0), sampleId: row.id, groupId: p.id, evaluatedAt: T, status: 'closed', returnPct: i ? -5 : 10 }); });
  render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('tab', { name: /比较卖出/ })); expect(screen.getByTestId('quality-distribution')).toHaveTextContent('1 / 1 条共同已卖出');
  fireEvent.click(within(screen.getByTestId('quality-distribution')).getByRole('button', { name: /状态 S 原始值/ }));
  expect(s.selectSell).toHaveBeenCalledWith('sell-state-raw'); expect(screen.getByRole('tab', { name: /比较探测/ })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: '固定当前批次' })); expect(s.setCohort).toHaveBeenCalledWith([row.id]);
  fireEvent.change(screen.getByLabelText('筛选鱼质量信号'), { target: { value: 'ZZZ' } }); expect(screen.queryByTestId('quality-fish-row')).toBeNull();
});
it('keeps tracking/horizon controls compact and shows the paired trade metrics on demand', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button', { name: '鱼质量跟踪设置' }));
  fireEvent.change(screen.getByLabelText('鱼质量观察小时'), { target: { value: '-1' } }); fireEvent.blur(screen.getByLabelText('鱼质量观察小时')); expect(s.setObserveHours).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('鱼质量观察小时'), { target: { value: '72' } }); fireEvent.blur(screen.getByLabelText('鱼质量观察小时')); expect(s.setObserveHours).toHaveBeenCalledWith(72);
  fireEvent.click(screen.getByLabelText('自动跟踪新鱼及更新收益')); expect(s.setTracking).toHaveBeenCalledWith(false);
});

// 【用户要求】2026-10-26 信号库的信号纳入卖出比较，并与鱼舱的鱼区分
it('marks signal-library rows, filters by source and keeps them out of detector columns', () => {
  const s = state();
  s.study = importQualityLibrary(s.study, [{ id: 'lib', symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '' }, { id: 'lib2', symbol: 'ZZZUSDT', timeMs: T, timeLabel: '', fallbackZone: '' }]);
  render(<FishQuality state={s}/>);
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(5);
  const libraryRows = screen.getAllByTestId('quality-fish-row').filter(r => within(r).queryByText('信号库'));
  expect(libraryRows).toHaveLength(2);
  for (const r of libraryRows) { expect(within(r).queryByText('命中')).toBeNull(); expect(within(r).queryByTestId('fish-process-open')).toBeNull(); }
  const source = screen.getByLabelText('鱼质量的来源');
  expect(within(source).getByRole('option', { name: '信号库（2）' })).toBeInTheDocument();
  fireEvent.change(source, { target: { value: 'library' } }); expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(2);
  // 已按信号库筛选，每行不再重复标记
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
  fireEvent.click(screen.getByRole('button', {name:'全部选中'}));
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
  fireEvent.click(screen.getByRole('button', {name:'清空选择'})); expect(s.setSelectedRows).toHaveBeenLastCalledWith([]);
});

it('sorts the single detector column in both directions and filters to one exact detector/threshold row', () => {
  const s = state(); render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button', {name:'按探测算法排序'}));
  const first = () => screen.getAllByTestId('quality-detector-cell')[0];
  expect(first()).toHaveTextContent('> 1');
  fireEvent.click(screen.getByRole('button', {name:'按探测算法排序'})); expect(first()).toHaveTextContent('> 3');
  fireEvent.change(screen.getByLabelText('鱼质量的探测算法'), {target:{value:s.study.groups.find(g=>g.snapshot.threshold===2)!.id}});
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1); expect(first()).toHaveTextContent('> 2');
});

// 【用户反馈】2026-10-26「表头显示 793，但表中完全没这么多」：不再分页，所有行在同一个滚动框里
it('keeps every row reachable in one scroll box, renders only the visible window and counts months within the source filter', () => {
  const s = state();
  const lib = Array.from({ length: 300 }, (_, i) => ({ id: `l${i}`, symbol: `S${String(i).padStart(3, '0')}USDT`, timeMs: T - i * 3600_000, timeLabel: '', fallbackZone: '' }));
  s.study = importQualityLibrary(s.study, lib);
  render(<FishQuality state={s}/>);
  expect(screen.getByTestId('quality-row-count')).toHaveTextContent('共 303 行 · 301 条信号');
  expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
  const shown = screen.getAllByTestId('quality-fish-row').length;
  expect(shown).toBeGreaterThan(10); expect(shown).toBeLessThan(60);
  const box = screen.getByTestId('quality-fish-table');
  box.scrollTop = 300 * 33; fireEvent.scroll(box);
  expect(screen.getByText('S299USDT')).toBeInTheDocument(); expect(screen.queryByText('S000USDT')).toBeNull();
  fireEvent.change(screen.getByLabelText('鱼质量的来源'), { target: { value: 'fish' } });
  expect(screen.getByTestId('quality-row-count')).toHaveTextContent('共 3 行 · 1 条信号（筛选自 303 行）');
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

it('automatically opens the actual distribution after a run, supports one configured sell and maximum-rise distributions', () => {
  const s = state(), row = qualityComparisonRows(s.study)[0], p = s.study.sellPlans![0];
  p.rule = { metric: p.metric, direction: '<', threshold: .5 };
  const view = render(<FishQuality state={{ ...s, running: true }}/>);
  expect(screen.queryByTestId('quality-distribution-chart')).toBeNull();
  s.study = { ...s.study, results: [{ key: qualityResultKey(row, p, 0), sampleId: row.id, groupId: p.id, evaluatedAt: T, status: 'closed', returnPct: -12, peakPct: 24 }] };
  view.rerender(<FishQuality state={s}/>);
  expect(screen.getByTestId('quality-distribution-chart')).toHaveTextContent('收益率分布');
  expect(screen.getAllByTestId('quality-histogram')).toHaveLength(1);
  expect(screen.getByTestId('quality-histogram')).toHaveTextContent('1 条 · 均值 -12%');
  fireEvent.change(screen.getByLabelText('分布图指标'), { target: { value: 'peakPct' } });
  expect(screen.getByTestId('quality-histogram')).toHaveTextContent('1 条 · 均值 +24%');
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
  fireEvent.click(screen.getByRole('button', { name: '买入过滤' }));
  expect(screen.getByText('未设置条件：全部信号都买入')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '添加条件' }));
  expect(screen.getByLabelText('买入条件 1 指标')).toHaveValue('state:state'); expect(screen.getByLabelText('买入条件 1 门槛')).toHaveValue(.7);
  fireEvent.change(screen.getByLabelText('买入条件 1 门槛'), { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: '应用并重算' }));
  expect(screen.getByRole('alert')).toHaveTextContent('有限数字'); expect(s.setBuyFilters).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('买入条件 1 门槛'), { target: { value: '0.65' } }); fireEvent.click(screen.getByRole('button', { name: '应用并重算' }));
  expect(s.setBuyFilters).toHaveBeenCalledWith([expect.objectContaining({ label: '状态 S 原始值', metric: 'state', direction: '>', threshold: .65, enabled: true })]);
  cleanup();
  const f = makeQualityBuyFilter('state:state', '>', .65), row = qualityComparisonRows(s.study)[0];
  s.study = { ...s.study, buyFilters: [f], filterReadings: [{ key: qualityFilterReadingKey(row, f), value: .5 }] };
  render(<FishQuality state={s}/>);
  expect(screen.getByRole('button', { name: '买入过滤' })).toHaveTextContent('1');
  expect(screen.getAllByTestId('quality-filter-cell')[0]).toHaveTextContent('未买入');
  expect(screen.getAllByTestId('quality-filter-cell')[0]).toHaveAttribute('title', expect.stringContaining('状态 S 原始值 0.5 不满足 > 0.65'));
  expect(within(screen.getAllByTestId('quality-fish-row')[0]).getAllByText('未买入').length).toBeGreaterThanOrEqual(3);
  fireEvent.click(screen.getByRole('tab', { name: /比较探测/ })); expect(screen.queryByTestId('quality-filter-cell')).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: /盈亏分布/ }));
  expect(within(screen.getByTestId('quality-distribution')).getByRole('button', { name: '按平均收益排序' })).toBeInTheDocument();
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
// 【用户要求】2026-10-26 从鱼质量点进交易战役，返回时回到鱼质量原来的位置
it('opens with the remembered tab, filters and sort when coming back from a campaign', async () => {
  const { saveQualityReturn, armQualityReturn, finishQualityReturn } = await import('@/lib/fish/qualityReturn');
  window.history.replaceState({ key: 'fish-entry', idx: 1 }, '');
  saveQualityReturn({ ui: { open: true, query: 'AAA', month: '', algorithm: '', origin: '', phase: 'detect', showStats: false, closedOnly: false, sort: 'symbol', ascending: true, distributionMetric: 'returnPct', statSort: null, tableTop: 0 }, scroll: [] });
  expect(armQualityReturn()).toBe(true);
  render(<FishQuality state={state()}/>);
  expect(screen.getByRole('tab', {name: /比较探测/})).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByLabelText('筛选鱼质量信号')).toHaveValue('AAA');
  expect(screen.getByRole('columnheader', {name: /标的/})).toHaveAttribute('aria-sort', 'ascending');
  finishQualityReturn();
  cleanup();
  render(<FishQuality state={state()}/>);
  expect(screen.getByLabelText('筛选鱼质量信号')).toHaveValue('');
});
