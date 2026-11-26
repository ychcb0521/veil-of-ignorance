import {afterEach, expect, it, vi} from 'vitest';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {FishInstantTrading} from '../FishInstantTrading';
import type {FishQualityState} from '@/hooks/useFishQuality';
import {newQualityStudy} from '@/lib/fish/quality';
import {emptyPreEntryLibrary} from '@/lib/fish/preEntryMonitor';
import {TooltipProvider} from '../ui/tooltip';
import {InstantPositionsContext} from '@/contexts/FishQualityContext';
import type {ComponentProps} from 'react';

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
it('shows screening while the archive is loading and identifies the specific prerequisite when blocked', () => {
  const automatic = {paused:false,pending:1,awaitingMail:0,screeningPending:true,storageIssue:false,setAutoPaused:vi.fn()};
  const page = render(view(setup({instantPreferenceStatus:'ready', automaticScreening:automatic})));
  expect(screen.getByText('筛选中')).toBeVisible();
  expect(screen.queryByText('等待筛选库')).toBeNull();
  page.rerender(view(setup({automaticScreening:{...automatic,waitingReason:'正在核对实盘连接与持仓'}})));
  expect(screen.getByText('正在核对实盘连接与持仓')).toBeVisible();
  expect(screen.queryByText('筛选中')).toBeNull();
  page.rerender(view(setup({automaticScreening:{...automatic,paused:true}})));
  expect(screen.getByText('筛选已暂停')).toBeVisible();
});

it('opens the separate verified instant settings while research and screening are still loading', () => {
  render(view(setup({instantPreferenceStatus:'ready'})));
  openAfter();
  expect(screen.getByRole('combobox')).toBeEnabled();
  expect(screen.getByRole('button',{name:'保存设置'})).toBeEnabled();
});
it('edits position sizing inside after-buy settings and resets only simulated capital', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(view(setup({instantPreferenceStatus:'ready', instantPosition: {settings:{version:1,availableUsdt:1234,marginPct:5,leverage:8},save}})));
  openAfter();
  expect(screen.getByRole('checkbox',{name:'仓位设置'})).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox',{name:'仓位设置'}));
  fireEvent.change(screen.getByLabelText('模拟可用资金（USDT）'),{target:{value:'2000'}});
  expect(screen.getByText(/模拟首仓保证金 100 USDT · 首仓名义仓位 800 USDT/)).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'重置模拟资金'}));
  fireEvent.click(screen.getByRole('button',{name:'保存仓位设置'}));
  expect(await screen.findByText('仓位设置已保存，下次入选时生效。')).toBeVisible();
  expect(save).toHaveBeenCalledWith({version:1,availableUsdt:800,marginPct:5,leverage:8});
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

it('shows the settled balance without issuing a new account request when opening position settings', () => {
  const readDeskQuote=vi.fn(),save=vi.fn().mockResolvedValue(undefined);
  const live={positions:[],monitorResults:new Map(),mirrorFills:new Map(),manualPositions:new Map(),
    usdtFollow:{connected:true,owner:'cached',orderDesk:1,readDeskQuote},
    balanceCalibration:{ready:true,refreshing:false,availableUsdt:1200,balanceObservedAt:Date.UTC(2026,10,22,10),campaigns:vi.fn(),refresh:vi.fn()}} as unknown as NonNullable<ComponentProps<typeof InstantPositionsContext.Provider>['value']>;
  render(<InstantPositionsContext.Provider value={live}>{view(setup({instantPreferenceStatus:'ready',instantPosition:{settings:{version:1,availableUsdt:800,marginPct:5,leverage:8},save}}))}</InstantPositionsContext.Provider>);
  openAfter();fireEvent.click(screen.getByRole('checkbox',{name:'仓位设置'}));
  expect(screen.getByText(/币安已校准可用资金\s+1200 USDT/)).toBeVisible();
  expect(screen.getByText('预计首仓保证金 60 USDT · 首仓名义仓位 480 USDT')).toBeVisible();
  expect(screen.getByLabelText('模拟可用资金（USDT）')).toHaveValue(800);
  expect(readDeskQuote).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

it('closes after a confirmed save while background synchronization is still pending', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const instantMonitor = {restoreStatus:'ready', settings:undefined, save, pendingCloud:true} as const;
  render(view(setup({instantPreferenceStatus:'ready', instantMonitor})));
  openAfter();
  fireEvent.click(screen.getByRole('button',{name:'保存设置'}));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(save).toHaveBeenCalledOnce();
  expect(screen.getByText('买后设置 · 云端同步中')).toBeVisible();
});

it('keeps the dialog and restores the save button when persistence fails', async () => {
  const save = vi.fn().mockRejectedValue(new Error('本机和云端暂未确认保存，请保留页面并重试。'));
  const instantMonitor = {restoreStatus:'ready', settings:undefined, save, pendingCloud:false} as const;
  render(view(setup({instantPreferenceStatus:'ready', instantMonitor})));
  openAfter();
  fireEvent.click(screen.getByRole('button',{name:'保存设置'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('本机和云端暂未确认保存');
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByRole('button',{name:'保存设置'})).toBeEnabled();
});
