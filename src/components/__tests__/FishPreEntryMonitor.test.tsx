import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FishPreEntryMonitor } from '../FishPreEntryMonitor';
import { TooltipProvider } from '../ui/tooltip';
import { emptyPreEntryLibrary } from '@/lib/fish/preEntryMonitor';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { qualitySplitPrimaryAction, qualitySplitPauseAction } from '../FishQualityModule';

afterEach(cleanup);
it('orders start, conditions and selected library like holding monitoring, with duration inside settings', async () => {
  const start = vi.fn(), pause = vi.fn();
  const state = { ready: true, preEntry: { library: {...emptyPreEntryLibrary(),settings:{updatedAt:1,hours:48,plans:[]}}, ready: true, running: false, error: '', progress: null, start, pause, resume: vi.fn(), retry: vi.fn() } } as unknown as FishQualityState;
  const view = render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={2} filtersOn onSelected={vi.fn()} renderConditions={done => <button onClick={done}>保存条件</button>}/></TooltipProvider>);
  expect(within(screen.getByTestId('pre-entry-controls')).getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['开始筛选', '开始筛选的其他方式', '动态筛选条件', '打开入选库']);
  expect(screen.getByText('开始筛选').className).toBe(qualitySplitPrimaryAction);
  expect(screen.queryByLabelText('筛选时长（小时）')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('动态筛选条件'));
  fireEvent.click(screen.getByText('保存条件'));
  fireEvent.click(screen.getByText('开始筛选'));
  expect(start).toHaveBeenCalledWith(48);
  fireEvent.click(screen.getByLabelText('打开入选库'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  expect(screen.getByText('暂无入选记录。设置条件、勾选信号后开始筛选。')).toBeInTheDocument();
  view.unmount();
  render(<TooltipProvider><FishPreEntryMonitor state={{ ...state, preEntry: { ...state.preEntry!, running: true } }} selectedCount={2} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  expect(screen.getByText('暂停筛选').className).toBe(qualitySplitPauseAction);
  fireEvent.click(screen.getByText('暂停筛选'));
  expect(pause).toHaveBeenCalledOnce();
});

it('continues a frozen paused round from the main action and exposes restart in the split menu', () => {
  const resume = vi.fn(), restart = vi.fn(), start = vi.fn();
  const library = { ...emptyPreEntryLibrary(), rounds: [{ id: 'paused', startedAt: 1, updatedAt: 1, filters: [], hours: 12, state: 'paused' as const }] };
  const state = { ready: true, preEntry: { library, ready: true, running: false, error: '', progress: null, start, resume, restart } } as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={2} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.click(screen.getByText('开始筛选'));
  expect(resume).toHaveBeenCalledWith('paused'); expect(start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('开始筛选的其他方式'));
  fireEvent.click(screen.getByText('从头重新筛选'));
  expect(restart).toHaveBeenCalledWith(0);
});

it('does not resume an older paused round after a newer restart has completed', () => {
  const start = vi.fn(), resume = vi.fn();
  const library = { ...emptyPreEntryLibrary(), rounds: [
    { id: 'old', startedAt: 1, updatedAt: 1, filters: [], hours: 12, state: 'paused' as const },
    { id: 'new', startedAt: 2, updatedAt: 3, filters: [], hours: 24, state: 'complete' as const },
  ] };
  const state = { ready: true, preEntry: { library, ready: true, running: false, error: '', progress: null, start, resume } } as unknown as FishQualityState;
  render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={2} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.click(screen.getByText('开始筛选'));
  expect(start).toHaveBeenCalledWith(0); expect(resume).not.toHaveBeenCalled();
});
