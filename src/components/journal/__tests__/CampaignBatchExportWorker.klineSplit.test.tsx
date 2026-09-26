/**
 * 批量导出：盘面按指定周期 / 视窗倍数显示；盈亏概览（峰值浮盈等）读计算用 K 线，与详情页逐位一致。
 * 真实 useCampaignKlines / useReplayKlines + 本地合成 fapi 数据的 fetch 垫片（不发真实请求），按周期数请求次数。
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CampaignBatchExportWorker, createCampaignBatchExportSnapshot } from '../CampaignBatchExportWorker';
import type { CampaignBatchExportWorkerProps } from '@/lib/campaignBatchExportContext';
import { renderCampaignBoardPng } from '@/lib/campaignLegsPngExport';
import {
  countCallsByInterval,
  createSynthFapiFetch,
  type SynthCampaignId,
} from '@/test/fixtures/syntheticCampaignKlines';
import JournalCampaignDetailPage from '@/pages/JournalCampaignDetailPage';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1', email: 'desk@example.com' }, profile: { display_name: '主账户' } }) }));
vi.mock('@/contexts/TradingContext', () => ({ useTradingContext: () => ({
  getEffectiveTime: () => Date.parse('2026-02-01T00:00:00Z'), balance: 50_000, positionsMap: {}, priceMap: {},
}) }));
vi.mock('@/lib/campaignListCache', () => ({ waitForCampaignListHeal: vi.fn(async () => undefined) }));
vi.mock('@/lib/campaignLegExecution', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/campaignLegExecution')>(),
  fetchLegExitPriceCorrections: vi.fn(async () => ({})),
  fetchLegExitPriceCorrectionsResult: vi.fn(async () => ({ complete: true, fetchFailed: false, corrections: {} })),
}));
vi.mock('@/lib/journalApi', async () => {
  const fixtures = await import('@/test/fixtures/syntheticCampaignKlines');
  const full = async (id: string) => ({
    ...fixtures.synthCampaign(id as SynthCampaignId),
    pendingOrders: [], reverseHedgeOrders: [], foreignLiveOrders: [], legExitPriceCorrections: {},
    timelineDiagnostics: { disagreements: [] },
  });
  return {
    getCampaignWithLegs: vi.fn(async (id: string) => {
      const { campaign, legs } = fixtures.synthCampaign(id as SynthCampaignId);
      return { campaign, legs };
    }),
    readUserLocalSnapshot: vi.fn(() => ({ tradeHistory: [], ordersMap: {}, filledOrders: [], cancelledOrders: [] })),
    getCampaignFullData: vi.fn(async (id: string) => full(id)),
    listAllCampaigns: vi.fn(async () => [fixtures.synthCampaign('tut-1h').campaign]),
    listVisibleCampaigns: vi.fn(async () => []), hasMutualFollow: vi.fn(async () => true),
    listCounterfactuals: vi.fn(async () => []), listCampaignComments: vi.fn(async () => []),
    createCounterfactual: vi.fn(), deleteCounterfactual: vi.fn(), detachCampaignLegFromCampaign: vi.fn(),
    saveCampaignDeviationNotes: vi.fn(), syncCampaignDeviationRulesToChecklist: vi.fn(), runCustomCounterfactual: vi.fn(),
  };
});
vi.mock('@/lib/emotionDiaryApi', () => ({
  getDecisionEmotionDiaryByDate: vi.fn(async () => null), listDecisionEmotionDiaries: vi.fn(async () => []),
}));
// 盘面替身：记下周期，画完立刻回报
vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: ({ onRenderReady, intervalMs }: { onRenderReady?: () => void; intervalMs: number }) => {
    useEffect(() => { onRenderReady?.(); }, [onRenderReady]);
    return <div data-testid="kline-probe" data-interval-ms={intervalMs} />;
  },
}));
vi.mock('@/components/journal/CampaignLegsList', () => ({ CampaignLegsList: () => null }));
vi.mock('@/components/journal/EndCampaignDialog', () => ({ EndCampaignDialog: () => null }));
vi.mock('@/lib/campaignLegsPngExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/campaignLegsPngExport')>(),
  renderCampaignBoardPng: vi.fn(async () => ({ blob: new Blob(['png']), fileName: 'campaign.png' })),
}));

const PAGE_TEST_TIMEOUT_MS = 15_000;
const WAIT = 12_000;
let synth = createSynthFapiFetch();

function workerProps(id: SynthCampaignId, options: CampaignBatchExportWorkerProps['options']): CampaignBatchExportWorkerProps {
  return {
    campaignId: id,
    userId: 'user-1',
    options,
    snapshot: createCampaignBatchExportSnapshot({ exportedAt: '2026-09-25T12:00:00Z', currentAccountEquity: 80_000 }),
    onComplete: vi.fn(), onError: vi.fn(),
  };
}

async function runBatch(id: SynthCampaignId, options: CampaignBatchExportWorkerProps['options']) {
  vi.mocked(renderCampaignBoardPng).mockClear();
  synth.calls.length = 0;
  const props = workerProps(id, options);
  const view = render(<MemoryRouter><CampaignBatchExportWorker {...props} /></MemoryRouter>);
  await waitFor(() => expect(props.onComplete).toHaveBeenCalledTimes(1), { timeout: WAIT });
  expect(props.onError).not.toHaveBeenCalled();
  const input = vi.mocked(renderCampaignBoardPng).mock.calls[0][0];
  const result = vi.mocked(props.onComplete).mock.calls[0][0];
  const calls = countCallsByInterval(synth.calls);
  view.unmount();
  return { input, result, calls };
}

/** 详情页里「盈亏概览」逐项的字（与导出图同一份清单）。 */
async function detailOverview(id: SynthCampaignId) {
  const view = render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[`/journal/campaigns/${id}`]}>
        <Routes><Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} /></Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
  const panel = (await screen.findByText('盈亏概览', {}, { timeout: WAIT })).parentElement as HTMLElement;
  const peakValue = () => within(panel).getByRole('button', { name: '峰值浮盈说明' }).closest('div.flex')?.querySelector('span.font-mono')?.textContent;
  // 计算用 K 线到位之前峰值浮盈按已实现兜底：等请求停下再读
  await waitFor(() => expect(within(screen.getByTestId('campaign-chart-frame')).queryByTestId('kline-probe')).not.toBeNull(), { timeout: WAIT });
  await waitFor(() => expect(synth.calls.length).toBeGreaterThan(0), { timeout: WAIT });
  const settled = synth.calls.length;
  await waitFor(() => expect(synth.calls.length).toBe(settled), { timeout: WAIT });
  const rows = [...panel.querySelectorAll('span.font-mono')].map(node => node.textContent);
  const peak = peakValue();
  view.unmount();
  return { rows, peak };
}

beforeEach(() => {
  synth = createSynthFapiFetch();
  vi.stubGlobal('fetch', vi.fn(synth.fetchImpl));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('批量导出：盘面按指定周期，盈亏概览按计算用 K 线（与详情页逐位一致）', () => {
  it('约 1 小时的战役：指定 1m / 15m / 1h 与「自动」，盘面周期各不相同，盈亏概览逐项相同且等于详情页', async () => {
    const detail = await detailOverview('tut-1h');
    const runs = [];
    for (const interval of ['auto', '1m', '15m', '1h'] as const) {
      runs.push({ interval, ...await runBatch('tut-1h', { interval, sections: {} }) });
    }
    // 盘面：「自动」默认 5 分钟线；指定的周期照画（短战役放得下）
    expect(runs.map(run => run.result.chartInterval)).toEqual(['5m', '1m', '15m', '1h']);
    expect(runs.map(run => run.input.chartInterval)).toEqual(['5m', '1m', '15m', '1h']);
    // 盈亏概览：每一次都与第一次逐项相同，且峰值浮盈与详情页那一格同字
    const itemsOf = (run: (typeof runs)[number]) => run.input.pnlOverview.items.map(item => [item.key, item.value]);
    for (const run of runs) expect(itemsOf(run)).toEqual(itemsOf(runs[0]));
    const peak = runs[0].input.pnlOverview.items.find(item => item.key === 'peakUnrealizedPnl')!.value;
    expect(peak).toBe(detail.peak);
    // 请求：计算用 1m 一份（3 页）；盘面周期不同时另拉一份，相同（1m）时共用、不再重复
    expect(runs.map(run => run.calls)).toEqual([
      { '1m': 3, '5m': 1 },
      { '1m': 3 },
      { '1m': 3, '15m': 1 },
      { '1m': 3, '1h': 1 },
    ]);
  }, PAGE_TEST_TIMEOUT_MS);

  it('约 5 小时的战役：「自动」盘面与计算都是 5 分钟线，只拉一份', async () => {
    const run = await runBatch('tut-5h', { interval: 'auto', sections: {} });
    expect(run.result.chartInterval).toBe('5m');
    expect(run.calls).toEqual({ '5m': 3 });
  }, PAGE_TEST_TIMEOUT_MS);

  it('只画盘面不拉计算用那份；只画盈亏概览不拉盘面那份', async () => {
    const chartOnly = await runBatch('tut-1h', { interval: 'auto', sections: { overview: false } });
    expect(chartOnly.calls).toEqual({ '5m': 1 });
    const overviewOnly = await runBatch('tut-1h', { interval: '15m', sections: { chart: false } });
    expect(overviewOnly.calls).toEqual({ '1m': 3 });
    // 没画盘面：周期不进图
    expect(overviewOnly.result.chartInterval).toBeUndefined();
  }, PAGE_TEST_TIMEOUT_MS);

  it('【用户要求】批量默认仍是 1.1 倍视窗；旧档 3 读成 3.1', async () => {
    const byDefault = await runBatch('tut-5h', { interval: 'auto', sections: {} });
    expect(byDefault.input.chartViewLabel).toBe('1.1 倍视窗');
    const legacy = await runBatch('tut-5h', { interval: 'auto', viewMultiplier: 3 as never, sections: {} });
    expect(legacy.input.chartViewLabel).toBe('3.1 倍视窗');
  }, PAGE_TEST_TIMEOUT_MS);
});
