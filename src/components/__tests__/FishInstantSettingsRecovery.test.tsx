import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen} from '@testing-library/react';
import {FishInstantTrading} from '../FishInstantTrading';
import type {FishQualityState} from '@/hooks/useFishQuality';
import {newQualityStudy} from '@/lib/fish/quality';
import {emptyPreEntryLibrary} from '@/lib/fish/preEntryMonitor';
import {TooltipProvider} from '../ui/tooltip';

afterEach(cleanup);
const setup = (overrides: Partial<FishQualityState>) => ({
  ready: false, study: newQualityStudy(), instantMonitor: {save: vi.fn(), pendingCloud:false},
  preEntry:{ready:false,library:emptyPreEntryLibrary()}, ...overrides,
} as FishQualityState);
const view = (state:FishQualityState) => <TooltipProvider><FishInstantTrading state={state}>{null}</FishInstantTrading></TooltipProvider>;
function openAfter() {
  fireEvent.click(screen.getByRole('button',{name:'即时交易条件设置'}));
  fireEvent.click(screen.getByRole('button',{name:'买后设置'}));
}
it('opens the separate verified instant settings while research and screening are still loading', () => {
  render(view(setup({instantPreferenceStatus:'ready'})));
  openAfter();
  expect(screen.getByRole('combobox')).toBeEnabled();
  expect(screen.getByRole('button',{name:'保存设置'})).toBeEnabled();
});
it('exposes a retry without an editable default when instant settings could not be read', () => {
  const retry=vi.fn();
  render(view(setup({instantPreferenceStatus:'error',retryInstantPreferences:retry})));
  openAfter();
  expect(screen.getByRole('alert')).toHaveTextContent('即时交易设置读取失败');
  expect(screen.queryByRole('button',{name:'保存设置'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'重试读取'}));
  expect(retry).toHaveBeenCalledOnce();
});
