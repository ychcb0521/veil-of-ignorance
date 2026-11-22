import { renderFishQuality as render } from '@/test/renderFishQuality';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimeControl } from '@/components/TimeControl';
import { FISH_STORAGE_KEY } from '@/lib/fishSignals';
import { SIGNAL_LIBRARY_STORAGE_KEY } from '@/lib/signalLibrary';
import { initialFishProgress } from '@/lib/fishScanner';
import { saveFishAuto } from '@/lib/fish/autoScan';
import { saveFishPreference } from '@/lib/fish/preferences';

const mocks = vi.hoisted(() => ({ scan: vi.fn(), enqueue: vi.fn(), schedules: vi.fn() }));
vi.mock('@/lib/fishScanner', async original => ({ ...await original<typeof import('@/lib/fishScanner')>(),
  FishScanner: class { scan = mocks.scan; isBusy = () => false; } }));
vi.mock('@/contexts/FishQualityContext', async original => {
  const actual = await original<typeof import('@/contexts/FishQualityContext')>();
  return { ...actual, useFishCaptureAutomation: () => ({ ...actual.useFishCaptureAutomation(), enqueue: mocks.enqueue }) };
});
vi.mock('@/hooks/useFishAutoScan', async original => {
  const actual = await original<typeof import('@/hooks/useFishAutoScan')>();
  return { ...actual, useFishAutoScan: (options: Parameters<typeof actual.useFishAutoScan>[0]) => {
    mocks.schedules(options); return actual.useFishAutoScan(options);
  } };
});
vi.mock('@/lib/simStateSync', () => ({ queueSimStatePush: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'capture-isolation' } }) }));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => ({ tradeHistory: [], positionsMap: {}, priceMap: {},
  getEffectiveTime: () => 0, getTimelineId: () => null }) }));
vi.mock('@/hooks/useLatestInstantReplay', () => ({ useLatestInstantReplay: () => undefined }));
vi.mock('@/lib/journalApi', () => ({ listAllCampaigns: vi.fn(async () => []) }));
vi.mock('@/components/journal/PreTradeSnapshotDialog', () => ({ PreTradeSnapshotDialog: () => null }));
vi.mock('@/lib/signalJumpDiagnostics', async original => ({ ...await original<typeof import('@/lib/signalJumpDiagnostics')>(),
  preflightSignalJumpIssues: vi.fn(async () => new Map()) }));

const T = Date.UTC(2026,10,22,12,30);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T);
  saveFishAuto({ mode:'manual', hours:1, lastRunAt:T });
  localStorage.setItem(SIGNAL_LIBRARY_STORAGE_KEY,'[]');
  localStorage.setItem(FISH_STORAGE_KEY,'[]');
  saveFishPreference('cbi2',{statistic:'结果',direction:'>',threshold:'0.3',constraints:[]});
  mocks.scan.mockImplementation(async options => {
    const at = options.anchorMs ?? T;
    options.onProgress({...initialFishProgress(),anchorMs:at,cutoffMs:at,status:'running'});
    options.onSignal({id:'new-JTO',symbol:'JTOUSDT',timeMs:at-60_000,timeLabel:'',fallbackZone:'',
      fish:{average:.35,cbi2:.4,startAverage:.31,previousAverage:.29,threshold:.3,cutoffMs:at}});
    const progress = {...initialFishProgress(),anchorMs:at,cutoffMs:at,total:1,done:1,status:'complete' as const};
    options.onProgress(progress); return progress;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function mount(status:'playing'|'paused'|'stopped') {
  const onPause=vi.fn(),onStop=vi.fn(),onResume=vi.fn();
  render(<TimeControl status={status} currentSimulatedTime={Date.UTC(2026,3,20)} speed={1}
    onStart={vi.fn()} onPause={onPause} onResume={onResume} onStop={onStop} onSetSpeed={vi.fn()}/>);
  return {onPause,onStop,onResume};
}

it.each(['playing','paused','stopped'] as const)('keeps real-time manual capture eligible while replay is %s',async status => {
  const replay=mount(status);
  fireEvent.click(screen.getByRole('button',{name:/^渔/}));
  fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
  await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({symbol:'JTOUSDT'}),T));
  expect(replay.onPause).not.toHaveBeenCalled(); expect(replay.onStop).not.toHaveBeenCalled();
  expect(replay.onResume).not.toHaveBeenCalled();
});

it('keeps scheduled real-time capture eligible while historical replay is running',async () => {
  mount('playing');
  const schedule = mocks.schedules.mock.calls.at(-1)![0];
  await act(async () => { await schedule.start({lookbackHours:5/60}); });
  await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({symbol:'JTOUSDT'}),T));
});

it.each(['playing','stopped'] as const)('never gives an explicit historical capture live eligibility when replay is %s',async status => {
  mount(status);
  fireEvent.click(screen.getByRole('button',{name:/^渔/}));
  fireEvent.change(screen.getByLabelText('捕捞时间（UTC+8）'),{target:{value:'2026-10-18 12:34:56'}});
  fireEvent.click(screen.getByRole('button',{name:'开始捕捞'}));
  await waitFor(() => expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({symbol:'JTOUSDT'}),undefined));
  expect(mocks.scan).toHaveBeenCalledWith(expect.objectContaining({anchorMs:Date.UTC(2026,9,18,4,34,56)}));
});
