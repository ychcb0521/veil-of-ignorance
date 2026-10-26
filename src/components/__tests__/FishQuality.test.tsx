import { fireEvent, render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishQuality } from '@/components/FishQuality';
import { importQualityFish, importQualityLibrary, newQualityStudy, qualityComparisonRows, qualityResultKey } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';
import type { FishQualityState } from '@/hooks/useFishQuality';
const T = Date.UTC(2026, 9, 20);
function state(): FishQualityState {
  const signals = [1, 2, 3].map((threshold, i) => ({ id: String(i), symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: 'BSS', cutoffMs: T, threshold, average: 4, cbi2: 4, startAverage: 4, previousAverage: 0, direction: '>' as const, scale: 1 } }));
  const study = enableQualityComparison(importQualityFish(newQualityStudy(T + 1), signals));
  return { study, ready: true, running: false, progress: null, warning: '', error: '', start: vi.fn(), cancel: vi.fn(), setRule: vi.fn(), setObserveHours: vi.fn(), setTracking: vi.fn(), selectSell: vi.fn(), setCohort: vi.fn() };
}
afterEach(cleanup);
it('matches the cabin row layout, with exactly two sells and three detector columns, and one merged fish row', () => {
  const s = state(); render(<FishQuality state={s}/>);
  expect(screen.getByTestId('fish-quality').parentElement).not.toHaveAttribute('data-testid', 'fish-cabin');
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1); expect(screen.getAllByTestId('quality-sell-column')).toHaveLength(2); expect(screen.getAllByTestId('quality-detector-column')).toHaveLength(3);
  ['标的', '信号时间', '算法类型', '市场', '评分', '捕捞过程'].forEach(name => expect(screen.getByRole('columnheader', { name: new RegExp(name) })).toBeVisible());
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
  expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(3);
  const libraryRows = screen.getAllByTestId('quality-fish-row').filter(r => within(r).queryByText('信号库'));
  expect(libraryRows).toHaveLength(2);
  for (const r of libraryRows) { expect(within(r).queryByText('命中')).toBeNull(); expect(within(r).queryByTestId('fish-process-open')).toBeNull(); }
  const source = screen.getByLabelText('鱼质量的来源');
  expect(within(source).getByRole('option', { name: '信号库（2）' })).toBeInTheDocument();
  fireEvent.change(source, { target: { value: 'library' } }); expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(2);
  fireEvent.change(source, { target: { value: 'fish' } }); expect(screen.getAllByTestId('quality-fish-row')).toHaveLength(1);
  expect(within(screen.getByTestId('quality-fish-row')).queryByText('信号库')).toBeNull();
});

// 【用户反馈】2026-10-26「表头显示 793，但表中完全没这么多」：不再分页，所有行在同一个滚动框里
it('keeps every row reachable in one scroll box, renders only the visible window and counts months within the source filter', () => {
  const s = state();
  const lib = Array.from({ length: 300 }, (_, i) => ({ id: `l${i}`, symbol: `S${String(i).padStart(3, '0')}USDT`, timeMs: T - i * 3600_000, timeLabel: '', fallbackZone: '' }));
  s.study = importQualityLibrary(s.study, lib);
  render(<FishQuality state={s}/>);
  expect(screen.getByTestId('quality-row-count')).toHaveTextContent('共 301 条');
  expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
  const shown = screen.getAllByTestId('quality-fish-row').length;
  expect(shown).toBeGreaterThan(10); expect(shown).toBeLessThan(60);
  const box = screen.getByTestId('quality-fish-table');
  box.scrollTop = 300 * 33; fireEvent.scroll(box);
  expect(screen.getByText('S299USDT')).toBeInTheDocument(); expect(screen.queryByText('S000USDT')).toBeNull();
  fireEvent.change(screen.getByLabelText('鱼质量的来源'), { target: { value: 'fish' } });
  expect(screen.getByTestId('quality-row-count')).toHaveTextContent('共 1 条（筛选自 301 条）');
  expect(within(screen.getByLabelText('鱼质量的月份')).getByRole('option', { name: '全部月份（1）' })).toBeInTheDocument();
});
