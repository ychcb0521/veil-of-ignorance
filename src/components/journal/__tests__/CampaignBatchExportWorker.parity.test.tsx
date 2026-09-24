/**
 * 批量导出看板的「盈亏概览」与详情页逐位相同：同一场战役，批量工人交给 renderCampaignBoardPng 的 14 项读数，
 * 等于详情页面板上印出来的字。两边走的是详情页同一个构造器（campaignPnlOverviewItems），这里用真实夹具把它钉住：
 * 涨跌幅的取价（初始对冲 A/B、滚动对冲锁价、平仓价校正、币本位空单）、盈亏比只写倍数 b（不再带百分比）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import JournalCampaignDetailPage from '@/pages/JournalCampaignDetailPage';
import { CampaignBatchExportWorker, createCampaignBatchExportSnapshot } from '../CampaignBatchExportWorker';
import { renderCampaignBoardPng } from '@/lib/campaignLegsPngExport';
import { computeCurrentAccountEquity } from '@/lib/accountEquity';

const state = vi.hoisted(() => ({ fixtureId: 'exit-correction', lockByHedgeA: false }));
const BALANCE = 10_000;

/**
 * 从「滚动对冲成交」派生：那张对冲改成已成交的初始对冲 A，与主力同一刻（02:00）在 110 平掉，
 * 于是主力平仓时它锁住行情，涨跌幅的平仓价取 A 的开仓价 120（+20%），而不是主力的平仓价 110（+10%）。
 */
async function currentFixture() {
  const { parityFixture, PARITY_T0, PARITY_MINUTE } = await import('@/test/fixtures/counterfactualParityFixtures');
  const base = parityFixture(state.fixtureId);
  if (!state.lockByHedgeA) return base;
  const closeMs = PARITY_T0 + 180 * PARITY_MINUTE;
  return {
    ...base,
    legs: base.legs.filter(leg => leg.id !== 'hedge-a').map(leg => (leg.id === 'rolling'
      ? { ...leg, leg_role: 'hedge_initial_a', post_simulated_close_time: new Date(closeMs).toISOString(), post_exit_price_snapshot: 110 } as typeof leg
      : leg)),
    tradeRecords: base.tradeRecords.map(record => (record.id === 'rolling-rec'
      ? { ...record, closeTime: closeMs, exitPrice: 110, pnl: (120 - 110) * 5 }
      : record)),
  };
}

vi.mock('@/lib/campaignLegExecution', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/campaignLegExecution')>(),
  fetchLegExitPriceCorrections: vi.fn(async () => (await currentFixture()).corrections),
  fetchLegExitPriceCorrectionsResult: vi.fn(async () => ({ corrections: (await currentFixture()).corrections, complete: true, fetchFailed: false })),
}));
vi.mock('@/lib/campaignListCache', () => ({ waitForCampaignListHeal: vi.fn(async () => undefined) }));
vi.mock('@/lib/journalApi', () => {
  const detail = async () => {
    const fixture = await currentFixture();
    return {
      campaign: fixture.campaign,
      legs: fixture.legs,
      tradeRecords: fixture.tradeRecords,
      pendingOrders: [],
      reverseHedgeOrders: fixture.reverseHedgeOrders,
      foreignLiveOrders: [],
      unfilledOrderIds: fixture.unfilledOrderIds,
      legExitPriceCorrections: fixture.corrections,
      timelineDiagnostics: {
        mode: 'heuristic' as const, timelineIds: [], anchorTimelineIds: [], unstampedAnchors: 0,
        missingAnchorNodes: [], verdicts: {}, disagreements: [],
      },
    };
  };
  return {
    readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
    getCampaignWithLegs: vi.fn(async () => {
      const fixture = await currentFixture();
      return { campaign: fixture.campaign, legs: fixture.legs };
    }),
    getCampaignFullData: vi.fn(async () => detail()),
    listAllCampaigns: vi.fn(async () => [(await currentFixture()).campaign]),
    listVisibleCampaigns: vi.fn(async () => [(await currentFixture()).campaign]),
    listCounterfactuals: vi.fn(async () => []),
    listCampaignComments: vi.fn(async () => []),
    hasMutualFollow: vi.fn(async () => true),
    runCustomCounterfactual: vi.fn(),
    createCounterfactual: vi.fn(),
    deleteCounterfactual: vi.fn(async () => undefined),
    detachCampaignLegFromCampaign: vi.fn(),
    saveCampaignDeviationNotes: vi.fn(async () => undefined),
    syncCampaignDeviationRulesToChecklist: vi.fn(async () => ({ created: 0, drafts: 0 })),
  };
});
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'desk@example.com' }, profile: { display_name: '主账户' } }),
}));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    getEffectiveTime: () => Date.parse('2026-01-01T03:00:00.000Z'),
    balance: 10_000,
    positionsMap: {},
    priceMap: {},
  }),
}));
vi.mock('@/hooks/useCampaignKlines', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useCampaignKlines')>();
  const fixtures = await import('@/test/fixtures/counterfactualParityFixtures');
  const hour = (h: number) => fixtures.PARITY_T0 + h * fixtures.PARITY_HOUR;
  return {
    ...actual,
    buildCampaignKlineTimeWindow: () => ({
      fromTime: hour(-1), toTime: hour(4), defaultFromTime: hour(-1), defaultToTime: hour(4),
      contentStartMs: hour(0), contentEndMs: hour(3), contextMs: fixtures.PARITY_HOUR, availableContextMs: 600 * fixtures.PARITY_MINUTE,
    }),
    useCampaignKlines: () => ({
      klines: fixtures.parityFixture(state.fixtureId).klines,
      loading: false, error: null, reload: vi.fn(), fromTime: hour(-1), toTime: hour(4),
    }),
  };
});
vi.mock('@/lib/emotionDiaryApi', () => ({
  getDecisionEmotionDiaryByDate: vi.fn(async () => null), listDecisionEmotionDiaries: vi.fn(async () => []),
}));
vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: ({ onRenderReady }: { onRenderReady?: () => void }) => (
    <button type="button" data-testid="native-chart" onClick={onRenderReady}>native ready</button>
  ),
}));
vi.mock('@/components/journal/CampaignLegsList', () => ({ CampaignLegsList: () => null }));
vi.mock('@/components/journal/EndCampaignDialog', () => ({ EndCampaignDialog: () => null }));
vi.mock('@/lib/campaignLegsPngExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/campaignLegsPngExport')>(),
  renderCampaignBoardPng: vi.fn(async () => ({ blob: new Blob(['png']), fileName: 'campaign.png' })),
}));

/** 与 App 根部一样包一层 TooltipProvider：历史归类的战役在页眉上带提示气泡。 */
function renderDetailPage(id: string) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[`/journal/campaigns/${id}`]}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/** 详情页「盈亏概览」面板上逐项印出来的字：名称 → 读数。 */
function panelValues() {
  const panel = screen.getByText('盈亏概览').parentElement as HTMLElement;
  return Object.fromEntries([...panel.querySelectorAll<HTMLElement>('[data-column]')].map(row => [
    row.querySelector('span.truncate')?.textContent ?? '',
    row.querySelector('span.font-mono')?.textContent ?? '',
  ]));
}

beforeEach(() => {
  vi.mocked(renderCampaignBoardPng).mockClear();
  window.localStorage.clear();
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});

describe('批量导出看板的盈亏概览 ↔ 详情页', () => {
  it.each([
    ['平仓价校正 + 从未成交的初始对冲', 'exit-correction', false, '+10.00%'],
    ['初始对冲 A 成交后、主力平仓前平掉，每条记录带手续费', 'fees-everywhere', false, '+10.00%'],
    ['滚动对冲在主力平仓前已平：按主力平仓价', 'rolling-hedge', false, '+10.00%'],
    ['已成交的初始对冲 A 与主力同平：按 A 的开仓价', 'rolling-hedge', true, '+20.00%'],
    ['币本位空单，初始对冲 A 先平、B 挂着', 'coin-short', false, '+4.00%'],
  ] as const)('%s：14 项读数逐位相同，盈亏比只写倍数 b', async (_label, fixtureId, lockByHedgeA, priceChange) => {
    state.fixtureId = fixtureId;
    state.lockByHedgeA = lockByHedgeA;
    const fixture = await currentFixture();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const worker = render(
      <MemoryRouter>
        <CampaignBatchExportWorker
          campaignId={fixture.campaign.id}
          userId="user-1"
          options={{ interval: 'auto', sections: {} }}
          snapshot={createCampaignBatchExportSnapshot({
            exportedAt: '2026-09-20T12:00:00Z',
            currentAccountEquity: computeCurrentAccountEquity(BALANCE, {}, {}),
          })}
          onComplete={onComplete}
          onError={onError}
        />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId('native-chart', {}, { timeout: 15_000 }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    expect(onError).not.toHaveBeenCalled();
    const items = vi.mocked(renderCampaignBoardPng).mock.calls[0][0].pnlOverview.items;
    expect(items).toHaveLength(14);
    const boardValues = Object.fromEntries(items.map(item => [item.label, item.value]));
    expect(boardValues['涨跌幅']).toBe(priceChange);
    // 盈亏比只写倍数 b（如「34.60」），不带百分比
    expect(items.find(item => item.key === 'payoffRatio')?.value).toMatch(/^(-?\d+\.\d{2}|—)$/);
    expect(Object.values(boardValues).join(' ')).not.toMatch(/盈亏比.*%/);
    worker.unmount();

    renderDetailPage(fixture.campaign.id);
    await waitFor(() => expect(panelValues()).toEqual(boardValues), { timeout: 15_000 });
  }, 60_000);
});
