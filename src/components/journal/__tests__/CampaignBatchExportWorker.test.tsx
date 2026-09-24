import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignBatchExportWorker, createCampaignBatchExportSnapshot } from '../CampaignBatchExportWorker';
import type { CampaignBatchExportWorkerProps } from '@/lib/campaignBatchExportContext';
import { parityFixture } from '@/test/fixtures/counterfactualParityFixtures';
import * as api from '@/lib/journalApi';
import { waitForCampaignListHeal } from '@/lib/campaignListCache';
import { fetchLegExitPriceCorrections, fetchLegExitPriceCorrectionsResult } from '@/lib/campaignLegExecution';
import { renderCampaignBoardPng } from '@/lib/campaignLegsPngExport';
import { getDecisionEmotionDiaryByDate, listDecisionEmotionDiaries } from '@/lib/emotionDiaryApi';
import { operationDateKey } from '@/lib/assetReport';
import { campaignOperationTime } from '@/lib/objectiveOperationTime';
import type { DecisionEmotionDiary } from '@/types/emotionDiary';
import { ThemeOverride } from '@/contexts/ThemeContext';

const state = vi.hoisted(() => ({
  userId: 'user-1', klineError: null as string | null, klineLoading: false, correctionsComplete: true,
  correctionsFetchFailed: false, noKlines: false, throwInRender: false,
  /** 账户样本里额外的战役（标题）及其中读不出的 id：模拟账户里一场没选中的坏数据。 */
  extraSamples: [] as Array<{ id: string; title: string }>, brokenIds: [] as string[], includeSelf: true,
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: state.userId, email: 'desk@example.com' }, profile: { display_name: '主账户' } }) }));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => ({
  getEffectiveTime: () => Date.parse('2026-01-01T03:00:00Z'), balance: 999999, positionsMap: {}, priceMap: {},
}) }));
vi.mock('@/lib/campaignListCache', () => ({ waitForCampaignListHeal: vi.fn(async () => undefined) }));
vi.mock('@/lib/campaignLegExecution', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/campaignLegExecution')>(),
  fetchLegExitPriceCorrections: vi.fn(async () => (await import('@/test/fixtures/counterfactualParityFixtures')).parityFixture('exit-correction').corrections),
  fetchLegExitPriceCorrectionsResult: vi.fn(async () => ({
    complete: state.correctionsComplete, fetchFailed: state.correctionsFetchFailed,
    corrections: (await import('@/test/fixtures/counterfactualParityFixtures')).parityFixture('exit-correction').corrections,
  })),
}));
vi.mock('@/lib/journalApi', () => ({
  getCampaignWithLegs: vi.fn(async (id: string) => {
    if (state.brokenIds.includes(id)) throw new Error(`读取失败（测试）：${id}`);
    const fixture = (await import('@/test/fixtures/counterfactualParityFixtures')).parityFixture('exit-correction');
    return { campaign: fixture.campaign, legs: fixture.legs };
  }),
  readUserLocalSnapshot: vi.fn(() => ({ tradeHistory: [], ordersMap: {}, filledOrders: [], cancelledOrders: [] })),
  getCampaignFullData: vi.fn(async () => {
    const fixture = (await import('@/test/fixtures/counterfactualParityFixtures')).parityFixture('exit-correction');
    return { ...fixture, pendingOrders: [], foreignLiveOrders: [], timelineDiagnostics: { disagreements: [] } };
  }),
  listAllCampaigns: vi.fn(async () => {
    const self = (await import('@/test/fixtures/counterfactualParityFixtures')).parityFixture('exit-correction').campaign;
    return [...(state.includeSelf ? [self] : []), ...state.extraSamples.map(item => ({ ...self, ...item }))];
  }),
  listVisibleCampaigns: vi.fn(async () => []), hasMutualFollow: vi.fn(async () => true),
  listCounterfactuals: vi.fn(async () => []),
  createCounterfactual: vi.fn(), deleteCounterfactual: vi.fn(), detachCampaignLegFromCampaign: vi.fn(),
  saveCampaignDeviationNotes: vi.fn(), syncCampaignDeviationRulesToChecklist: vi.fn(), runCustomCounterfactual: vi.fn(),
}));
vi.mock('@/hooks/useCampaignKlines', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useCampaignKlines')>(),
  useCampaignKlines: () => {
    if (state.throwInRender) throw new Error('详情页计算异常（测试）');
    return {
    klines: state.noKlines ? [] : parityFixture('exit-correction').klines,
    loading: state.klineLoading, error: state.klineError, reload: vi.fn(), fromTime: 1, toTime: 2,
    };
  },
}));
vi.mock('@/lib/emotionDiaryApi', () => ({
  getDecisionEmotionDiaryByDate: vi.fn(async () => null), listDecisionEmotionDiaries: vi.fn(async () => []),
}));
vi.mock('@/components/journal/ReplayKlineChart', async () => {
  // 替身读 useTheme()：与真 K 线图一样按主题上下文选配色，测试据此核对屏幕外盘面用的是哪套主题
  const { useTheme } = await import('@/contexts/ThemeContext');
  return { ReplayKlineChart: ({ onRenderReady }: { onRenderReady?: () => void }) => {
    const { theme } = useTheme();
    return <button data-testid="native-chart" data-theme={theme} onClick={onRenderReady}>native ready</button>;
  } };
});
vi.mock('@/lib/campaignLegsPngExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/campaignLegsPngExport')>(),
  renderCampaignBoardPng: vi.fn(async () => ({ blob: new Blob(['png']), fileName: 'campaign.png' })),
}));

function workerProps(overrides: Partial<CampaignBatchExportWorkerProps> = {}): CampaignBatchExportWorkerProps {
  return {
    campaignId: parityFixture('exit-correction').campaign.id,
    userId: 'user-1',
    options: { interval: '15m', sections: {} },
    snapshot: createCampaignBatchExportSnapshot({ exportedAt: '2026-09-20T12:00:00Z', currentAccountEquity: 80_000 }),
    onComplete: vi.fn(), onError: vi.fn(), ...overrides,
  };
}
function mount(props: CampaignBatchExportWorkerProps) {
  return render(<MemoryRouter><CampaignBatchExportWorker {...props} /></MemoryRouter>);
}
async function finishChart() {
  fireEvent.click(await screen.findByTestId('native-chart'));
}

describe('CampaignBatchExportWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.userId = 'user-1'; state.klineError = null; state.klineLoading = false; state.correctionsComplete = true;
    state.correctionsFetchFailed = false; state.noKlines = false; state.throwInRender = false;
    state.extraSamples = []; state.brokenIds = []; state.includeSelf = true;
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('uses the detail calculations read-only and waits for the native chart before producing a PNG', async () => {
    const props = workerProps();
    mount(props);
    await screen.findByTestId('native-chart');
    expect(renderCampaignBoardPng).not.toHaveBeenCalled();
    await finishChart();
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(props.onError).not.toHaveBeenCalled();
    expect(api.getCampaignFullData).toHaveBeenCalled();
    for (const call of vi.mocked(api.getCampaignFullData).mock.calls) expect(call[1]).toMatchObject({ heal: false, local: expect.any(Object), source: expect.any(Object) });
    expect(api.listCounterfactuals).not.toHaveBeenCalled();
    expect(waitForCampaignListHeal).not.toHaveBeenCalled();
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(api.saveCampaignDeviationNotes).not.toHaveBeenCalled();
    const input = vi.mocked(renderCampaignBoardPng).mock.calls[0][0];
    expect(input.legExitPriceCorrections).toEqual(parityFixture('exit-correction').corrections);
    expect(input.chartElement?.getAttribute('style')).toContain('width: 1440px');
    expect(input.chartInterval).toBe('15m');
    expect(input.exportedAt).toBe(props.snapshot.exportedAt);
    // 与详情页同一个 14 项盈亏概览，按两栏次序（左栏递进链 → 右栏结果与仓位；见 PNL_OVERVIEW_LEFT_COLUMN / RIGHT_COLUMN），
    // 右栏各项带 rightColumn：导出图与页面一样按两栏从上往下排。
    expect(input.pnlOverview.items.map(item => item.key)).toEqual([
      'expectedMaxDrawdownPct', 'mainPriceChange', 'mainPriceEfficiency', 'payoffRatio', 'addEfficiency',
      'geometricExpectancy', 'arithmeticExpectancy',
      'initialExpectedMaxLoss', 'realizedPnl', 'peakUnrealizedPnl', 'initialMainExposureNotional',
      'mainSideNotional', 'mainLeverage', 'asymmetricRiskContribution',
    ]);
    expect(input.pnlOverview.items.map(item => Boolean(item.rightColumn))).toEqual([
      false, false, false, false, false, false, false,
      true, true, true, true, true, true, true,
    ]);
    expect(input.chartUnavailableNote).toBeUndefined();
    expect(vi.mocked(props.onComplete).mock.calls[0][0].chartOmitted).toBeUndefined();
  });

  it('mounts the off-screen surface outside the page flow at a fixed 1440×480 that viewport fitting never resizes', async () => {
    const props = workerProps();
    const view = render(<MemoryRouter><div data-testid="host"><CampaignBatchExportWorker {...props} /></div></MemoryRouter>);
    const frame = await screen.findByTestId('campaign-batch-chart-frame');
    expect(view.getByTestId('host')).not.toContainElement(frame);
    expect(frame.closest('[data-testid="campaign-batch-export-surface"]')?.parentElement).toBe(document.body);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(frame.style.width).toBe('1440px');
    expect(frame.style.height).toBe('480px');
    await finishChart();
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(vi.mocked(renderCampaignBoardPng).mock.calls[0][0].chartElement).toBe(frame);
    expect(frame.style.height).toBe('480px');
  });

  it('draws the off-screen chart in the light theme even when the app is dark, matching the light board', async () => {
    const props = workerProps();
    // 应用是深色主题（默认）：外层上下文给 dark
    render(<MemoryRouter><ThemeOverride theme="dark"><CampaignBatchExportWorker {...props} /></ThemeOverride></MemoryRouter>);
    const chart = await screen.findByTestId('native-chart');
    expect(chart).toHaveAttribute('data-theme', 'light');
    // 盘面容器里的 CSS 变量也按浅色解析
    expect(screen.getByTestId('campaign-batch-export-surface')).toHaveClass('light');
    await finishChart();
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
  });

  it('only mentions the peak-unrealized fallback in the no-K-line note when the board draws the P&L overview', async () => {
    state.noKlines = true;
    const props = workerProps({ options: { interval: 'auto', sections: { overview: false } } });
    mount(props);
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    const note = vi.mocked(renderCampaignBoardPng).mock.calls[0][0].chartUnavailableNote!;
    expect(note).toMatch(/^交易所没有这段时间的 .+ K 线，盘面从略。$/);
    expect(note).not.toContain('峰值浮盈');
    expect(vi.mocked(props.onComplete).mock.calls[0][0].chartOmitted).toBe(note);
  });

  it('with the P&L overview but no K-line chart, a symbol without K-lines says under the overview that the peak falls back to realized P&L', async () => {
    state.noKlines = true;
    const props = workerProps({ options: { interval: 'auto', sections: { chart: false } } });
    mount(props);
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(props.onError).not.toHaveBeenCalled();
    const input = vi.mocked(renderCampaignBoardPng).mock.calls[0][0];
    // 没画盘面：不画「盘面从略」，但「峰值浮盈」按已实现盈亏兜底这件事要写在盈亏概览下面
    expect(input.chartUnavailableNote).toBeUndefined();
    expect(input.pnlOverview.note).toMatch(/^交易所没有这段时间的 .+ K 线：「峰值浮盈」缺少 K 线路径，按已实现盈亏兜底。$/);
    const result = vi.mocked(props.onComplete).mock.calls[0][0];
    // 弹窗据此在队列里标「无 K 线」、进度区报场数；但它不是账户样本说明，不能混进弹窗的样本提示
    expect(result.peakFallback).toBe(input.pnlOverview.note);
    expect(result.chartOmitted).toBeUndefined();
    expect(result.sampleNote).toBeUndefined();
  });

  it('keeps the peak-fallback note and the account-sample note apart: both under the overview, only the sample note goes to the dialog', async () => {
    state.noKlines = true;
    state.extraSamples = [{ id: 'sample-ok', title: '正常样本' }, { id: 'sample-broken', title: 'ETH 镜像止盈' }];
    state.brokenIds = ['sample-broken'];
    const props = workerProps({ options: { interval: 'auto', sections: { chart: false } } });
    mount(props);
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    const sample = '账户样本缺 1 场（「ETH 镜像止盈」读取失败），不对称风险贡献按其余 2 场计算。';
    const note = vi.mocked(renderCampaignBoardPng).mock.calls[0][0].pnlOverview.note!;
    // 兜底说明在前、样本说明在后，两句都以「。」收尾，直接相接
    expect(note).toMatch(/^交易所没有这段时间的 .+ K 线：「峰值浮盈」缺少 K 线路径，按已实现盈亏兜底。账户样本缺/);
    expect(note.endsWith(sample)).toBe(true);
    const result = vi.mocked(props.onComplete).mock.calls[0][0];
    expect(result.sampleNote).toBe(sample);
    expect(result.peakFallback).toContain('按已实现盈亏兜底');
    expect(result.peakFallback).not.toContain('账户样本');
  });

  it('neither the overview nor the chart drawn: no K-line note anywhere', async () => {
    state.noKlines = true;
    const props = workerProps({ options: { interval: 'auto', sections: { chart: false, overview: false } } });
    mount(props);
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    const input = vi.mocked(renderCampaignBoardPng).mock.calls[0][0];
    expect(input.chartUnavailableNote).toBeUndefined();
    expect(input.pnlOverview.note).toBeUndefined();
    const result = vi.mocked(props.onComplete).mock.calls[0][0];
    expect(result.peakFallback).toBeUndefined();
    expect(result.chartOmitted).toBeUndefined();
  });

  it('still exports a campaign whose symbol has no K-lines, drawing an explanation instead of the chart', async () => {
    state.noKlines = true;
    const props = workerProps();
    mount(props);
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(props.onError).not.toHaveBeenCalled();
    expect(screen.queryByTestId('native-chart')).toBeNull();
    const input = vi.mocked(renderCampaignBoardPng).mock.calls[0][0];
    expect(input.chartElement).toBeNull();
    expect(input.chartUnavailableNote).toMatch(/交易所没有这段时间的 .+ K 线，盘面从略；「峰值浮盈」缺少 K 线路径，按已实现盈亏兜底。$/);
    expect(vi.mocked(props.onComplete).mock.calls[0][0].chartOmitted).toBe(input.chartUnavailableNote);
    // 盘面位置已经写了兜底，盈亏概览下不再重复一遍
    expect(input.pnlOverview.note).toBeUndefined();
    expect(vi.mocked(props.onComplete).mock.calls[0][0].peakFallback).toBeUndefined();
  });

  it('turns a render error inside the detail page into this campaign’s failure instead of crashing the list', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    state.throwInRender = true;
    const props = workerProps();
    mount(props);
    await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(1));
    expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: '详情页计算异常（测试）' }));
    expect(props.onComplete).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('checks this campaign’s exit prices with the completeness flag, but reads account-wide samples as leniently as the detail page', async () => {
    const props = workerProps();
    mount(props);
    await finishChart();
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(fetchLegExitPriceCorrectionsResult).toHaveBeenCalledTimes(1);
    expect(fetchLegExitPriceCorrections).toHaveBeenCalled();
  });

  it('keeps one full-account metrics snapshot for every campaign in a batch', async () => {
    const props = workerProps();
    const first = mount(props);
    await finishChart();
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    first.unmount();
    mount({ ...props, onComplete: vi.fn() });
    await finishChart();
    await waitFor(() => expect(renderCampaignBoardPng).toHaveBeenCalledTimes(2));
    expect(api.listAllCampaigns).toHaveBeenCalledTimes(1);
    expect(api.readUserLocalSnapshot).toHaveBeenCalledTimes(1);
    expect(props.snapshot.accountMetrics.size).toBe(1);
  });

  it('does not wait for a hidden chart, while retaining the same metrics calculations', async () => {
    const props = workerProps({ options: { interval: 'auto', sections: { chart: false, emotionDiary: false } } });
    mount(props);
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('native-chart')).toBeNull();
    expect(getDecisionEmotionDiaryByDate).not.toHaveBeenCalled();
    expect(listDecisionEmotionDiaries).not.toHaveBeenCalled();
    expect(vi.mocked(renderCampaignBoardPng).mock.calls[0][0].sections).toMatchObject({ chart: false, emotionDiary: false });
  });

  it('reads the emotion diaries once per batch and read-only (no local mirror write-back, no cloud sync push per campaign)', async () => {
    const fixture = parityFixture('exit-correction');
    const diaryDate = operationDateKey(campaignOperationTime(fixture.legs, fixture.tradeRecords)!)!;
    const diary = (id: string, diary_date: string, event_text: string) => ({
      id, user_id: 'user-1', diary_date, event_text, sam_valence: null, sam_arousal: null,
      poms_item_scores: [], pi_item_scores: [], panas_item_scores: [], hads_anxiety_score: 3, hads_depression_score: 2,
    }) as unknown as DecisionEmotionDiary;
    vi.mocked(listDecisionEmotionDiaries).mockResolvedValue([diary('d-other', '2020-01-01', '别的日子'), diary('d-op', diaryDate, '操作日的记录')]);
    const props = workerProps();
    const first = mount(props);
    await finishChart();
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = { ...props, onComplete: vi.fn() };
    mount(second);
    await finishChart();
    await waitFor(() => expect(second.onComplete).toHaveBeenCalledTimes(1));
    // 两场只读一次整份日记，而且是只读版本；详情页那个会回写本机镜像、推 user_sim_state 的读法一次都没走
    expect(listDecisionEmotionDiaries).toHaveBeenCalledTimes(1);
    expect(listDecisionEmotionDiaries).toHaveBeenCalledWith('user-1', { mirror: false });
    expect(getDecisionEmotionDiaryByDate).not.toHaveBeenCalled();
    for (const [input] of vi.mocked(renderCampaignBoardPng).mock.calls) {
      expect(input.emotionDiary).toMatchObject({ date: diaryDate, eventText: '操作日的记录' });
    }
  });

  it('a failed emotion-diary read is not cached: the retried campaign reads it again', async () => {
    vi.mocked(listDecisionEmotionDiaries).mockRejectedValueOnce(new Error('断网（测试）'));
    const props = workerProps();
    const first = mount(props);
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: '操作日情绪日记读取失败，请重试' })));
    first.unmount();
    await waitFor(() => expect(props.snapshot.emotionDiaries.size).toBe(0));
    const retry = { ...props, onError: vi.fn(), onComplete: vi.fn() };
    mount(retry);
    await finishChart();
    await waitFor(() => expect(retry.onComplete).toHaveBeenCalledTimes(1));
    expect(listDecisionEmotionDiaries).toHaveBeenCalledTimes(2);
  });

  it('reports real K-line failures rather than exporting an empty or misleading board', async () => {
    state.klineError = 'exchange unavailable';
    const props = workerProps();
    mount(props);
    await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(1));
    expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('K 线加载失败') }));
    expect(renderCampaignBoardPng).not.toHaveBeenCalled();
  });

  it('exports metadata and Legs without fetching account-wide metrics or requiring K-lines', async () => {
    state.klineLoading = true;
    state.klineError = 'unneeded K-lines unavailable';
    const props = workerProps({ options: { interval: 'auto', sections: { chart: false, overview: false, emotionDiary: false } } });
    mount(props);
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(api.listAllCampaigns).not.toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();
  });

  it('fails (retryably) when a K-line request during exit-price verification fails', async () => {
    state.correctionsComplete = false;
    state.correctionsFetchFailed = true;
    const props = workerProps();
    mount(props);
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('平仓价核验时 K 线接口出错') })));
    expect(renderCampaignBoardPng).not.toHaveBeenCalled();
  });

  it('exports like the detail page when only the local trade records are missing (a retry would never help)', async () => {
    state.correctionsComplete = false;
    state.correctionsFetchFailed = false;
    const props = workerProps();
    mount(props);
    await finishChart();
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(props.onError).not.toHaveBeenCalled();
    expect(vi.mocked(renderCampaignBoardPng).mock.calls[0][0].legExitPriceCorrections).toEqual(parityFixture('exit-correction').corrections);
  });

  it('honours a chosen 1-minute interval on a short campaign instead of coarsening it to the auto fetch budget, and reports it', async () => {
    const props = workerProps({ options: { interval: '1m', sections: {} } });
    mount(props);
    await finishChart();
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(vi.mocked(renderCampaignBoardPng).mock.calls[0][0].chartInterval).toBe('1m');
    expect(vi.mocked(props.onComplete).mock.calls[0][0].chartInterval).toBe('1m');
  });

  it('does not report a chart interval when the chart section is off', async () => {
    const props = workerProps({ options: { interval: '1m', sections: { chart: false } } });
    mount(props);
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(vi.mocked(props.onComplete).mock.calls[0][0].chartInterval).toBeUndefined();
  });

  it('exports with the remaining account samples when one unselected campaign keeps failing, and names it in the board', async () => {
    state.extraSamples = [{ id: 'sample-ok', title: '正常样本' }, { id: 'sample-broken', title: 'ETH 镜像止盈' }];
    state.brokenIds = ['sample-broken'];
    const props = workerProps();
    mount(props);
    await finishChart();
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(props.onError).not.toHaveBeenCalled();
    // 读不出的那一场原地重读过一次
    expect(vi.mocked(api.getCampaignWithLegs).mock.calls.filter(([id]) => id === 'sample-broken')).toHaveLength(2);
    const note = '账户样本缺 1 场（「ETH 镜像止盈」读取失败），不对称风险贡献按其余 2 场计算。';
    expect(vi.mocked(renderCampaignBoardPng).mock.calls[0][0].pnlOverview.note).toBe(note);
    expect(vi.mocked(props.onComplete).mock.calls[0][0].sampleNote).toBe(note);
    expect(props.snapshot.accountMetrics.size).toBe(1);
  });

  it('a campaign missing from the shared sample (unreadable earlier, retried fine now) re-reads the sample for its own board only', async () => {
    const self = parityFixture('exit-correction').campaign;
    state.extraSamples = [{ id: 'sample-ok', title: '正常样本' }];
    state.brokenIds = [self.id];
    // 先导出另一场：整批样本在本场读不出时汇总，缺本场
    const other = workerProps({ campaignId: 'sample-ok' });
    const first = mount(other);
    await finishChart();
    await waitFor(() => expect(other.onComplete).toHaveBeenCalledTimes(1));
    expect(vi.mocked(renderCampaignBoardPng).mock.calls[0][0].pnlOverview.note).toBe(`账户样本缺 1 场（「${self.title}」读取失败），不对称风险贡献按其余 1 场计算。`);
    first.unmount();
    // 本场恢复、重试：它的图不能写「样本缺本场」，占比的分母要含它自己——只为它重读一次样本
    state.brokenIds = [];
    const retry = workerProps({ snapshot: other.snapshot });
    mount(retry);
    await finishChart();
    await waitFor(() => expect(retry.onComplete).toHaveBeenCalledTimes(1));
    expect(retry.onError).not.toHaveBeenCalled();
    expect(vi.mocked(renderCampaignBoardPng).mock.calls[1][0].pnlOverview.note).toBeUndefined();
    expect(vi.mocked(retry.onComplete).mock.calls[0][0].sampleNote).toBeUndefined();
    expect(api.listAllCampaigns).toHaveBeenCalledTimes(2);
    // 重读的那份不进缓存：其余场次仍共用原来那一份（各自注明缺场）
    expect(other.snapshot.accountMetrics.size).toBe(1);
    const shared = await [...other.snapshot.accountMetrics.values()][0];
    expect(shared.missingSampleIds).toEqual([self.id]);
  });

  it('writes no sample note when every account sample was read', async () => {
    state.extraSamples = [{ id: 'sample-ok', title: '正常样本' }];
    const props = workerProps();
    mount(props);
    await finishChart();
    await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1));
    expect(vi.mocked(renderCampaignBoardPng).mock.calls[0][0].pnlOverview.note).toBeUndefined();
    expect(vi.mocked(props.onComplete).mock.calls[0][0].sampleNote).toBeUndefined();
  });

  it('still fails (retryably) when not a single account sample can be read', async () => {
    state.includeSelf = false;
    state.extraSamples = [{ id: 'sample-broken-1', title: '坏 1' }, { id: 'sample-broken-2', title: '坏 2' }];
    state.brokenIds = ['sample-broken-1', 'sample-broken-2'];
    const props = workerProps();
    mount(props);
    await waitFor(() => expect(props.onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('一场都没读出来') })));
    expect(renderCampaignBoardPng).not.toHaveBeenCalled();
    // 失败的那份不留在缓存里：重试时重新读
    await waitFor(() => expect(props.snapshot.accountMetrics.size).toBe(0));
  });

  it('rejects a changed login before reading any campaign', async () => {
    state.userId = 'another-user';
    const props = workerProps();
    mount(props);
    await waitFor(() => expect(props.onError).toHaveBeenCalledTimes(1));
    expect(api.getCampaignFullData).not.toHaveBeenCalled();
  });

  it('drops a late renderer response after cancellation/unmount', async () => {
    let resolve: (result: { blob: Blob; fileName: string }) => void;
    vi.mocked(renderCampaignBoardPng).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const props = workerProps();
    const view = mount(props);
    await finishChart();
    await waitFor(() => expect(renderCampaignBoardPng).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => resolve!({ blob: new Blob(['png']), fileName: 'late.png' }));
    expect(props.onComplete).not.toHaveBeenCalled();
    expect(props.onError).not.toHaveBeenCalled();
  });
});
