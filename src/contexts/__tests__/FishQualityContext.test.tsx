import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FishQualityProvider, usePageFishQuality } from '@/contexts/FishQualityContext';
import { newQualityStudy, qualityDisplayRows, qualityResultKey, qualityRunSamples, type QualityRunOptions } from '@/lib/fish/quality';
import { makeQualityBuyFilter } from '@/lib/fish/qualityFilters';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/fish/qualityStore', () => ({ loadQualityStudy: storage.load, saveQualityStudy: storage.save }));
const T = Date.UTC(2026, 9, 20), EMPTY = [];
const fish = [{ id: 'a', symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: '结果', cutoffMs: T, threshold: .12, average: .2, cbi2: .2, startAverage: .2, previousAverage: .1, direction: '>' as const, scale: 1 } }];
function Controls() {
  const q = usePageFishQuality(fish, EMPTY), navigate = useNavigate();
  return <><button onClick={() => { q.setSelectedRows(qualityDisplayRows(q.study).map(r => r.id)); void q.start(); }}>更新收益</button><button onClick={() => { q.setSelectedRows(qualityDisplayRows(q.study).map(r => r.id)); q.setFilters([makeQualityBuyFilter('state:state', '>', .7)]); void q.startFilter(); }}>开始过滤</button><button onClick={() => navigate('/other')}>其他页面</button><span>结果 {q.study.results.length}</span><span>{q.running ? '运行中' : '已结束'}</span></>;
}
function Other() { const navigate = useNavigate(); return <button onClick={() => navigate('/')}>返回</button>; }
beforeEach(() => { vi.useFakeTimers(); storage.load.mockReset().mockResolvedValue({ study: newQualityStudy(T) }); storage.save.mockReset().mockResolvedValue(true); });
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
it('keeps evaluating and persisting through route unmounts and restores live progress on return', async () => {
  let task!: QualityRunOptions, finish!: () => void;
  const run = vi.fn(async (o: QualityRunOptions) => { task = o; await new Promise<void>(resolve => { finish = resolve; }); });
  render(<MemoryRouter><FishQualityProvider owner="a" run={run}><Routes><Route path="/" element={<Controls/>}/><Route path="/other" element={<Other/>}/></Routes></FishQualityProvider></MemoryRouter>);
  await flush(); fireEvent.click(screen.getByRole('button', { name: '更新收益' })); await flush();
  fireEvent.click(screen.getByRole('button', { name: '其他页面' })); await flush();
  expect(task.signal.aborted).toBe(false); expect(screen.getByRole('status')).toHaveTextContent('收益后台更新中');
  const row = qualityRunSamples(task.study)[0], plan = task.study.sellPlans![0];
  act(() => { task.onProgress({ done: 1, total: 2, current: 'AAAUSDT' }); task.onResult({ key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, evaluatedAt: T, status: 'open', entryTime: T, entryPrice: 100, returnPct: 1 }); });
  await flush(500); expect(storage.save).toHaveBeenLastCalledWith('a', expect.objectContaining({ results: expect.arrayContaining([expect.objectContaining({ sampleId: row.id })]) }));
  expect(screen.getByRole('status')).toHaveTextContent('1/2');
  fireEvent.click(screen.getByRole('button', { name: '返回' })); await flush();
  expect(screen.getByText('结果 1')).toBeInTheDocument(); expect(screen.getByText('运行中')).toBeInTheDocument(); expect(run).toHaveBeenCalledTimes(1);
  finish(); await flush(); expect(screen.getByText('已结束')).toBeInTheDocument();
});

it('keeps both independent tasks alive across navigation and reports their separate progress', async () => {
  const tasks: QualityRunOptions[] = [], releases: (() => void)[] = [];
  const run = vi.fn(async (o: QualityRunOptions) => { tasks.push(o); await new Promise<void>(resolve => releases.push(resolve)); });
  render(<MemoryRouter><FishQualityProvider owner="a" run={run}><Routes><Route path="/" element={<Controls/>}/><Route path="/other" element={<Other/>}/></Routes></FishQualityProvider></MemoryRouter>);
  await flush(); fireEvent.click(screen.getByRole('button', { name: '开始过滤' })); fireEvent.click(screen.getByRole('button', { name: '更新收益' })); await flush();
  const filter = tasks.find(t => t.task === 'filter')!, monitor = tasks.find(t => t.task === 'monitor')!;
  expect(tasks).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '其他页面' })); await flush();
  act(() => { filter.onProgress({ done: 1, total: 2, current: '' }); monitor.onProgress({ done: 0, total: 2, current: '' }); });
  expect(filter.signal.aborted).toBe(false); expect(monitor.signal.aborted).toBe(false);
  expect(screen.getByRole('status')).toHaveTextContent('过滤后台运行中 · 1/2'); expect(screen.getByRole('status')).toHaveTextContent('收益后台更新中 · 0/2');
  releases[0](); await flush();
  expect(screen.getByRole('status')).not.toHaveTextContent('过滤后台运行中'); expect(screen.getByRole('status')).toHaveTextContent('收益后台更新中');
  expect(monitor.signal.aborted).toBe(false); releases[1](); await flush();
  expect(screen.queryByRole('status')).toBeNull();
});
