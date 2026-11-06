import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FishPreEntryMonitor } from '../FishPreEntryMonitor';
import { TooltipProvider } from '../ui/tooltip';
import { emptyPreEntryLibrary } from '@/lib/fish/preEntryMonitor';
import type { FishQualityState } from '@/hooks/useFishQuality';

it('exposes an independent start action, pause, library and retry controls', async () => {
  const start = vi.fn(), pause = vi.fn();
  const state = { ready: true, preEntry: { library: emptyPreEntryLibrary(), ready: true, running: false, error: '', progress: null, start, pause, resume: vi.fn(), retry: vi.fn() } } as unknown as FishQualityState;
  const view = render(<TooltipProvider><FishPreEntryMonitor state={state} selectedCount={2} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.change(screen.getByLabelText('买前监测时长（小时）'), { target: { value: '48' } });
  fireEvent.click(screen.getByText('开始买前监测'));
  expect(start).toHaveBeenCalledWith(48);
  fireEvent.click(screen.getByLabelText('打开买前监测'));
  await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  expect(screen.getByText('暂无买前监测记录。设置买前条件、勾选信号后开始监测。')).toBeInTheDocument();
  view.unmount();
  render(<TooltipProvider><FishPreEntryMonitor state={{ ...state, preEntry: { ...state.preEntry!, running: true } }} selectedCount={2} filtersOn onSelected={vi.fn()}/></TooltipProvider>);
  fireEvent.click(screen.getByText('暂停买前监测'));
  expect(pause).toHaveBeenCalledOnce();
});
