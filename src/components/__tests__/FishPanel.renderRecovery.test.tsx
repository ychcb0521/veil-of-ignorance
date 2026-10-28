import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishPanel, type FishPanelProps } from '@/components/FishPanel';
import { useFishQuality } from '@/hooks/useFishQuality';
import { importQualityFish, newQualityStudy, qualityDisplayRows, qualityResultKey, qualityRunSamples, type QualityRunOptions } from '@/lib/fish/quality';
import { BSS_DEF, definitionKey } from '@/lib/deepDig/features';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), failOnRun: true }));
vi.mock('@/lib/fish/qualityStore', () => ({ loadQualityStudy: mocks.load, saveQualityStudy: mocks.save }));
vi.mock('@/components/FishQuality', () => ({ FishQuality: ({ state: q }) => {
  if (mocks.failOnRun && q.running) throw new Error('模拟监测启动后的显示异常');
  return <><button onClick={() => void q.start()}>开始监测</button><p>显示结果 {q.study.results.length}</p><p>{q.running ? '监测仍在运行' : '监测已结束'}</p></>;
} }));
const T = Date.UTC(2026, 9, 20);
const fish = [{ id: 'a', symbol: 'AAAUSDT', timeMs: T, timeLabel: '', fallbackZone: '', fish: { featureId: 'bss', featureShort: 'BSS', definitionKey: definitionKey(BSS_DEF), statistic: '结果', cutoffMs: T, threshold: .12, average: .2, cbi2: .2, startAverage: .2, previousAverage: .1, direction: '>' as const, scale: 1 } }];
const props: Omit<FishPanelProps, 'quality'> = { signals: fish, progress: null, inputs: { time: '', threshold: '' }, onInputsChange: () => {}, selection: { exchanges: ['binance'], includeDuplicates: false }, onSelectionChange: () => {}, onStart: () => {}, onCancel: () => {}, onJump: () => {}, onDelete: () => {}, onRate: () => {}, jumpingSignalId: null, tradedDayIndex: new Set(), campaignDayIndex: new Set() };
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); });

it('keeps the real monitor running, saving and completing when its display fails immediately after Start', async () => {
  vi.useFakeTimers(); vi.spyOn(console, 'error').mockImplementation(() => {});
  const study = enableQualityComparison(importQualityFish(newQualityStudy(T), fish));
  study.selectedRowIds = qualityDisplayRows(study).map(row => row.id);
  study.sellPlans![0].rule = { metric: 'state', direction: '<', threshold: .5 };
  mocks.load.mockResolvedValue({ study }); mocks.save.mockResolvedValue(true); mocks.failOnRun = true;
  let task!: QualityRunOptions, finish!: () => void;
  const run = vi.fn(async (options: QualityRunOptions) => { task = options; await new Promise<void>(resolve => { finish = resolve; }); });
  function Owner() { const q = useFishQuality('render-recovery', fish, run); return <><output data-testid="saved-results">{q.study.results.length}</output><FishPanel {...props} quality={q}/></>; }
  render(<Owner/>); await flush();
  fireEvent.click(screen.getByRole('button', { name: '开始监测' })); await flush();
  expect(screen.getByRole('alert')).toHaveTextContent('鱼质量显示暂时异常');
  expect(screen.getByRole('button', { name: '开始捕捞' })).toBeVisible(); expect(task.signal.aborted).toBe(false);
  const row = qualityRunSamples(task.study)[0], plan = task.study.sellPlans![0];
  act(() => {
    task.onProgress({ done: 1, total: 2, current: 'AAAUSDT' });
    task.onResult({ key: qualityResultKey(row, plan, 0), sampleId: row.id, groupId: plan.id, evaluatedAt: T, status: 'open', entryTime: T, entryPrice: 100, returnPct: 1 });
  });
  await flush(500); expect(screen.getByTestId('saved-results')).toHaveTextContent('1');
  expect(mocks.save).toHaveBeenLastCalledWith('render-recovery', expect.objectContaining({ results: expect.arrayContaining([expect.objectContaining({ sampleId: row.id })]) }));
  mocks.failOnRun = false; fireEvent.click(screen.getByRole('button', { name: '恢复鱼质量显示' }));
  expect(screen.getByText('监测仍在运行')).toBeVisible(); expect(screen.getByText('显示结果 1')).toBeVisible();
  expect(task.signal.aborted).toBe(false); expect(run).toHaveBeenCalledTimes(1);
  finish(); await flush(); expect(screen.getByText('监测已结束')).toBeVisible();
});
