/**
 * 「原样重跑一遍 Legs 副本」的峰值浮盈，必须和上面那格真实「盈亏概览」印出来的是同一个数。
 *
 * 用真实的页面 + 真实的编辑器 + 真实的手动 Legs 引擎跑一遍：两块面板并排摆着，
 * 未改动的副本读数对不上，用户就会把「推演引擎的口径差」误读成「方案的差别」。
 * 这里专挑多腿在同一根 K 线里换状态的形状——对冲在高点之后才于 K 线中间成交、
 * 一根 K 线内开平完的对冲——正是逐根「碰过就算同时持有」的近似会跑偏的地方。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CampaignCounterfactualParams,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

const { detailsById, runCustomCounterfactualMock, createCounterfactualMock } = vi.hoisted(() => {
  // vi.hoisted 跑在模块顶层 const 之前，时间戳只能在块内自带一份。
  const HOUR = 3_600_000;
  const T0 = Date.parse('2026-01-01T00:00:00.000Z');
  const iso = (ms: number) => new Date(ms).toISOString();

  interface LegSpec {
    role: string;
    side: 'LONG' | 'SHORT';
    entry: number;
    exit: number;
    qty: number;
    openMs: number;
    closeMs: number;
  }

  const pnlOf = (spec: LegSpec) => (spec.side === 'LONG' ? 1 : -1) * (spec.exit - spec.entry) * spec.qty;

  const makeDetail = (id: string, specs: LegSpec[]) => {
    const totalPnl = specs.reduce((sum, spec) => sum + pnlOf(spec), 0);
    const campaign = {
      id,
      user_id: 'user-1',
      campaign_code: `C-${id}`,
      symbol: 'BTCUSDT',
      direction: 'main_long',
      status: 'closed_profit',
      strategy_template: 'custom',
      title: `${id} campaign`,
      opened_at: iso(T0),
      closed_at: iso(T0 + 3 * HOUR),
      initial_main_size_usdt: 1_000,
      initial_leverage: 1,
      final_realized_pnl: totalPnl,
      final_r_multiple: null,
      peak_unrealized_pnl: null,
      peak_drawdown: null,
      importance_weight: 0,
      notes: null,
      actual_evolution: [],
      deviation_notes: {},
      deleted_at: null,
      created_at: iso(T0),
      updated_at: iso(T0 + 3 * HOUR),
    } as TradeCampaign;
    const tradeRecords = specs.map((spec, index) => ({
      id: `${id}-rec-${index}`,
      symbol: 'BTCUSDT',
      side: spec.side,
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: spec.entry,
      exitPrice: spec.exit,
      quantity: spec.qty,
      leverage: 1,
      pnl: pnlOf(spec),
      fee: 0,
      slippage: 0,
      openTime: spec.openMs,
      closeTime: spec.closeMs,
    } as unknown as TradeRecord));
    const legs = specs.map((spec, index) => ({
      id: `${id}-leg-${index}`,
      user_id: 'user-1',
      campaign_id: id,
      trade_record_id: `${id}-rec-${index}`,
      leg_role: spec.role,
      leg_sequence: index + 1,
      source: 'live',
      symbol: 'BTCUSDT',
      direction: spec.side === 'LONG' ? 'long' : 'short',
      order_kind: index === 0 ? 'main' : 'hedge',
      leverage: 1,
      pre_simulated_time: iso(spec.openMs),
      pre_entry_price: spec.entry,
      pre_position_size: spec.entry * spec.qty,
      pre_account_equity_usdt: 10_000,
      post_simulated_close_time: iso(spec.closeMs),
    } as unknown as TradeJournal));
    return {
      campaign,
      legs,
      tradeRecords,
      pendingOrders: [],
      reverseHedgeOrders: [],
      foreignLiveOrders: [],
      legExitPriceCorrections: {},
      timelineDiagnostics: {
        mode: 'heuristic' as const,
        timelineIds: [],
        anchorTimelineIds: [],
        unstampedAnchors: 0,
        missingAnchorNodes: [],
        verdicts: {},
        disagreements: [],
      },
    };
  };

  const main: LegSpec = { role: 'main_open', side: 'LONG', entry: 100, exit: 110, qty: 10, openMs: T0, closeMs: T0 + 3 * HOUR };
  const details = {
    // 对冲 01:40 才成交，而 01:00 这根的高点 130 可能早在它之前：高点时只有主力 → 300
    midbar: makeDetail('midbar', [
      main,
      { role: 'hedge_initial_a', side: 'SHORT', entry: 112, exit: 110, qty: 5, openMs: T0 + 100 * 60_000, closeMs: T0 + 3 * HOUR },
    ]),
    // 对冲 01:10 开、01:50 平，整段都在 01:00 这根里：K 线起点仍只有主力 → 300
    single: makeDetail('single', [
      main,
      { role: 'hedge_initial_a', side: 'SHORT', entry: 115, exit: 116, qty: 5, openMs: T0 + 70 * 60_000, closeMs: T0 + 110 * 60_000 },
    ]),
  };

  return {
    detailsById: details,
    runCustomCounterfactualMock: vi.fn(),
    createCounterfactualMock: vi.fn(),
  };
});

vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return { ...actual, fetchLegExitPriceCorrections: vi.fn(async () => ({})) };
});

vi.mock('@/lib/campaignListCache', () => ({ waitForCampaignListHeal: vi.fn(async () => undefined) }));

vi.mock('@/lib/journalApi', async () => {
  const engine = await import('@/lib/campaignSimulationEngine');
  const overview = await import('@/lib/counterfactualOverview');
  runCustomCounterfactualMock.mockImplementation(async (
    _campaignId: string,
    params: CampaignCounterfactualParams,
    klines: Parameters<typeof engine.simulateManualLegScenario>[1],
    interval?: string,
  ) => ({
    params: { ...params, run_context: overview.buildCounterfactualRunContext(klines, interval ?? '1h') ?? undefined },
    result: engine.simulateManualLegScenario(params, klines),
  }));
  return {
    readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
    getCampaignFullData: vi.fn(async (id: keyof typeof detailsById) => detailsById[id]),
    listAllCampaigns: vi.fn(async () => Object.values(detailsById).map(detail => detail.campaign)),
    listVisibleCampaigns: vi.fn(async () => Object.values(detailsById).map(detail => detail.campaign)),
    listCounterfactuals: vi.fn(async () => []),
    listCampaignComments: vi.fn(async () => []),
    hasMutualFollow: vi.fn(async () => true),
    runCustomCounterfactual: runCustomCounterfactualMock,
    createCounterfactual: createCounterfactualMock,
    deleteCounterfactual: vi.fn(async () => undefined),
    saveCampaignDeviationNotes: vi.fn(async () => undefined),
    syncCampaignDeviationRulesToChecklist: vi.fn(async () => ({ created: 0, drafts: 0 })),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'desk@example.com' },
    profile: { display_name: '主账户' },
  }),
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
  const hour = (h: number) => Date.parse('2026-01-01T00:00:00.000Z') + h * 3_600_000;
  const klines = [
    { time: hour(0), open: 100, high: 105, low: 99, close: 104, volume: 1 },
    { time: hour(1), open: 104, high: 130, low: 100, close: 112, volume: 1 },
    { time: hour(2), open: 112, high: 115, low: 105, close: 110, volume: 1 },
    { time: hour(3), open: 110, high: 111, low: 109, close: 110, volume: 1 },
  ];
  return {
    ...actual,
    buildCampaignKlineTimeWindow: () => ({
      fromTime: hour(-1),
      toTime: hour(4),
      defaultFromTime: hour(-1),
      defaultToTime: hour(4),
      contentStartMs: hour(0),
      contentEndMs: hour(3),
      contextMs: 3_600_000,
      availableContextMs: 600 * 60_000,
    }),
    useCampaignKlines: () => ({
      klines,
      loading: false,
      error: null,
      reload: vi.fn(),
      fromTime: hour(-1),
      toTime: hour(4),
    }),
  };
});

vi.mock('@/lib/emotionDiaryApi', () => ({
  getDecisionEmotionDiaryByDate: vi.fn(async () => null),
}));

vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: () => <div data-testid="campaign-chart" />,
}));
vi.mock('@/components/journal/CampaignLegsList', () => ({ CampaignLegsList: () => null }));
vi.mock('@/components/journal/EndCampaignDialog', () => ({ EndCampaignDialog: () => null }));

function renderPage(id: keyof typeof detailsById) {
  return render(
    <MemoryRouter initialEntries={[`/journal/campaigns/${id}`]}>
      <Routes>
        <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function metricValue(panel: HTMLElement, label: string) {
  const row = within(panel).getByRole('button', { name: `${label}说明` }).closest('div.flex');
  return row?.querySelector('span.font-mono')?.textContent ?? null;
}

/** 不改副本直接一键运行，返回（真实盈亏概览, 草稿面板）。 */
async function runUnchangedCopy(hedgeExit: string) {
  await screen.findByRole('button', { name: '一键运行' }, { timeout: 5_000 });
  await waitFor(() => expect(screen.getAllByDisplayValue(hedgeExit).length).toBeGreaterThan(0));
  await act(async () => { await Promise.resolve(); });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
  });
  const draft = await screen.findByTestId('counterfactual-draft-panel');
  const campaignPanel = screen.getByText('盈亏概览').parentElement as HTMLElement;
  return { campaignPanel, draft };
}

beforeEach(() => {
  window.localStorage.clear();
  runCustomCounterfactualMock.mockClear();
  createCounterfactualMock.mockClear();
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});

describe('JournalCampaignDetailPage：未改动的 Legs 副本与真实盈亏概览峰值一致', () => {
  it('对冲在 K 线中间、高点之后才成交：重跑的峰值浮盈 = 战役页的 300，不是两腿同在高点的 210', async () => {
    renderPage('midbar');
    const { campaignPanel, draft } = await runUnchangedCopy('112');

    expect(metricValue(campaignPanel, '已实现 P&L')).toBe('110.00 USDT');
    expect(metricValue(draft, '已实现 P&L')).toBe('110.00 USDT');
    expect(metricValue(campaignPanel, '峰值浮盈')).toBe('300.00 USDT');
    expect(metricValue(draft, '峰值浮盈')).toBe(metricValue(campaignPanel, '峰值浮盈'));
    expect(createCounterfactualMock).not.toHaveBeenCalled();
  }, 20_000);

  it('主力持有期间一根 K 线内开平完的对冲：两块面板的峰值浮盈同样对得上', async () => {
    renderPage('single');
    const { campaignPanel, draft } = await runUnchangedCopy('116');

    expect(metricValue(draft, '已实现 P&L')).toBe(metricValue(campaignPanel, '已实现 P&L'));
    expect(metricValue(campaignPanel, '峰值浮盈')).toBe('300.00 USDT');
    expect(metricValue(draft, '峰值浮盈')).toBe(metricValue(campaignPanel, '峰值浮盈'));
  }, 20_000);
});
