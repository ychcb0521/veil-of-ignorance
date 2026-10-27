import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishMonitorLibrary } from '@/components/FishMonitorLibrary';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { importQualityLibrary, newQualityStudy, qualityDisplayRows, qualityFilterReadingKey, qualityResultKey, qualityRunSamples, type FishQualityStudy } from '@/lib/fish/quality';
import { makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { beginQualityMonitorRound, captureQualityMonitorResult, finishQualityMonitorRound } from '@/lib/fish/qualityMonitorLibrary';
afterEach(cleanup);
const T = Date.UTC(2026, 9, 27);
function archived(): FishQualityStudy {
  let s = enableQualityComparison(importQualityLibrary(newQualityStudy(T), ['AAAUSDT', 'BBBUSDT'].map((symbol, i) => ({ id: symbol, symbol, timeMs: T + i * 60000, timeLabel: '', fallbackZone: '' }))));
  s.sellPlans = [{ ...s.sellPlans![0], rule: { metric: 'state', direction: '<', threshold: .5 }, buyFilters: [makeQualityBuyFilter('state:state', '>', .7)] }];
  s.selectedRowIds = qualityDisplayRows(s).map(r => r.id);
  for (const threshold of [.5, .4]) {
    s = { ...s, sellPlans: [{ ...s.sellPlans![0], rule: { metric: 'state', direction: '<', threshold } }] };
    const begun = beginQualityMonitorRound(s, s, T + (threshold === .5 ? 1 : 1000)); let saved = begun.study;
    for (const row of qualityRunSamples(s)) {
      const plan = s.sellPlans![0], f = plan.buyFilters![0], key = qualityFilterReadingKey(row, f);
      begun.capture.readings.set(key, { key, value: .9 });
      saved = captureQualityMonitorResult(saved, begun.capture, { key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, status: 'closed', complete: true, evaluatedAt: T + 5000, entryTime: row.enteredAt!, entryPrice: 100, endTime: T + 600000, endPrice: 110, returnPct: 10, pnl: 10 }, T + 5000);
    }
    s = finishQualityMonitorRound(saved, begun.capture, 'complete', T + 6000);
  }
  return s;
}
it('keeps its entry compact, searches frozen outcomes and browses each saved round and its original conditions', () => {
  const study = archived(); study.sellPlans![0].rule!.threshold = .1;
  render(<FishMonitorLibrary study={study}/>);
  expect(screen.queryByRole('dialog')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: '打开监测库' }));
  const dialog = screen.getByRole('dialog', { name: '监测库' });
  expect(within(dialog).getByText('4 条记录 · 2 轮监测')).toBeInTheDocument(); expect(screen.getAllByTestId('monitor-library-row')).toHaveLength(4);
  fireEvent.change(screen.getByLabelText('搜索监测库'), { target: { value: 'AAA' } }); expect(screen.getAllByTestId('monitor-library-row')).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('监测库轮次'), { target: { value: study.monitorLibrary!.rounds[0].id } }); expect(screen.getAllByTestId('monitor-library-row')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: '查看 AAAUSDT 状态 S 原始值 < 0.5 监测条件' }));
  const detail = screen.getByTestId('monitor-library-details'); expect(detail).toHaveTextContent('状态 S 原始值 < 0.5'); expect(detail).toHaveTextContent('买前过滤：状态 S 原始值 > 0.7');
  expect(detail).not.toHaveTextContent('< 0.1'); expect(within(detail).getByText('公式快照')).toBeInTheDocument();
});
it('retains every record through paging, opens its source chart and labels an empty library', () => {
  const study = archived(), prototype = study.monitorLibrary!.records[0];
  study.monitorLibrary!.records = Array.from({ length: 61 }, (_, i) => ({ ...prototype, id: `row-${i}`, source: { ...prototype.source, id: String(i), symbol: `COIN${i}USDT` } }));
  const jump = vi.fn(); const view = render(<FishMonitorLibrary study={study} onJump={jump}/>);
  fireEvent.click(screen.getByRole('button', { name: '打开监测库' })); expect(screen.getAllByTestId('monitor-library-row')).toHaveLength(50);
  fireEvent.click(screen.getByRole('button', { name: '下一页' })); expect(screen.getAllByTestId('monitor-library-row')).toHaveLength(11); expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  fireEvent.click(within(screen.getAllByTestId('monitor-library-row')[0]).getByRole('button', { name: /^COIN/ })); expect(jump).toHaveBeenCalledOnce(); expect(screen.queryByRole('dialog')).toBeNull();
  view.unmount(); render(<FishMonitorLibrary study={newQualityStudy(T)}/>); fireEvent.click(screen.getByRole('button', { name: '打开监测库' })); expect(screen.getByText(/暂无监测记录/)).toBeInTheDocument();
});
it('does not present returns as bought outcomes when frozen buy conditions failed', () => {
  const study = archived(); study.monitorLibrary!.records = [{ ...study.monitorLibrary!.records[0], filterStatus: { state: 'fail', detail: '未满足 > 0.7' } }];
  render(<FishMonitorLibrary study={study}/>); fireEvent.click(screen.getByRole('button', { name: '打开监测库' }));
  const row = screen.getByTestId('monitor-library-row'); expect(row).toHaveTextContent('未买入'); expect(row).not.toHaveTextContent('+10.00%');
});

it('filters exact monitoring algorithms, resets paging, and sorts every data header before paging', () => {
  const study = archived();
  const prototypes = study.monitorLibrary!.records;
  study.monitorLibrary!.records = Array.from({ length: 61 }, (_, i) => ({ ...prototypes[i % prototypes.length], id: `row-${i}`, source: { ...prototypes[0].source, symbol: `COIN${i}USDT` }, result: { ...prototypes[0].result!, returnPct: i } }));
  render(<FishMonitorLibrary study={study}/>); fireEvent.click(screen.getByRole('button', { name: '打开监测库' }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  const select = screen.getByLabelText('监测库的监测算法');
  const exact = within(select).getAllByRole('option').find(o => o.textContent?.includes('< 0.4')) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: exact.value } });
  expect(screen.getAllByTestId('monitor-library-row').length).toBeLessThan(50);
  expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
  for (const r of screen.getAllByTestId('monitor-library-row')) expect(r).toHaveTextContent('< 0.4');
  fireEvent.change(select, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '监测库按收益率排序' }));
  expect(within(screen.getAllByTestId('monitor-library-row')[0]).getByRole('button', { name: 'COIN60USDT' })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: /收益率/ })).toHaveAttribute('aria-sort', 'descending');
  fireEvent.click(screen.getByRole('button', { name: '监测库按收益率排序' }));
  expect(within(screen.getAllByTestId('monitor-library-row')[0]).getByRole('button', { name: 'COIN0USDT' })).toBeInTheDocument();
  for (const h of screen.getAllByRole('columnheader').filter(h => h.textContent !== '跳转')) expect(within(h).getByRole('button')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '导出监测库数据' })).toHaveTextContent('61');
  fireEvent.change(screen.getByLabelText('搜索监测库'), { target: { value: 'no-such-symbol' } });
  expect(screen.getByRole('button', { name: '导出监测库数据' })).toBeDisabled();
});

it('filters detector snapshots separately without changing the frozen records', () => {
  const study = archived(), library = study.monitorLibrary!;
  library.settings.forEach((s, i) => { s.detectorsKnown = true; s.detectors = [{ ...s.plan, label: '同名探测', snapshot: { ...s.plan.snapshot, threshold: i + 1 } }]; });
  render(<FishMonitorLibrary study={study}/>); fireEvent.click(screen.getByRole('button', { name: '打开监测库' }));
  const select = screen.getByLabelText('监测库的探测算法'), options = within(select).getAllByRole('option') as HTMLOptionElement[];
  expect(options).toHaveLength(3);
  fireEvent.change(select, { target: { value: options[1].value } });
  expect(screen.getAllByTestId('monitor-library-row')).toHaveLength(2);
  expect(library.records).toHaveLength(4);
});
