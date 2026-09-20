/**
 * 反事实这一段里三件「静默丢东西 / 静默错数」的事，全部用**真实的编辑器**在页面上跑一遍：
 *
 *   1. 点「保存备注」不得冲掉 Legs 副本里的腿（载入的、手改的都不行）；
 *      同时平仓价校正真的变了时，仍然要按老规矩把副本重置到新基线。
 *   2. 「相对实际」的基线要与上面那格「已实现 P&L」同一个数——未结算的战役上
 *      落库的 final_realized_pnl 和校正后的现算值不是一回事。
 *   3. 保存期间又点了一次「一键运行」，那份新草稿不能被上一次保存的收尾清掉。
 *
 * 编辑器不打桩：这三条的因果链全都穿过 CampaignWhatIfEditor 的重置 effect，
 * 换成桩就等于把被测的那一段挖掉。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CampaignCounterfactual,
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualParams,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import { deleteCounterfactual } from '@/lib/journalApi';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

const OPENED_AT = '2026-01-01T00:00:00.000Z';
const CLOSED_AT = '2026-01-01T01:00:00.000Z';

const {
  detailsById,
  savedRows,
  fetchCorrectionsMock,
  listCounterfactualsMock,
  createCounterfactualMock,
  runCustomCounterfactualMock,
  saveCampaignDeviationNotesMock,
  syncCampaignDeviationRulesToChecklistMock,
} = vi.hoisted(() => {
  // vi.hoisted 跑在模块顶层 const 之前，时间戳只能在块内自带一份。
  const OPENED_AT = '2026-01-01T00:00:00.000Z';
  const CLOSED_AT = '2026-01-01T01:00:00.000Z';
  const makeCampaign = (
    id: string,
    overrides: Partial<TradeCampaign>,
  ): TradeCampaign => ({
    id,
    user_id: 'user-1',
    campaign_code: `C-${id}`,
    symbol: 'BTCUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'custom',
    title: `${id} campaign`,
    opened_at: OPENED_AT,
    closed_at: CLOSED_AT,
    initial_main_size_usdt: 1_000,
    initial_leverage: 1,
    final_realized_pnl: 50,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: null,
    created_at: OPENED_AT,
    updated_at: CLOSED_AT,
    ...overrides,
  } as TradeCampaign);

  // 主力腿挂成交记录（开仓 100 / 平仓 105），对冲腿只有复盘快照——
  // 于是这场战役「未全部结算」，落库的 final_realized_pnl 与校正后的现算值可以分叉。
  const makeLegs = (campaignId: string): TradeJournal[] => ([
    {
      id: `${campaignId}-main`,
      user_id: 'user-1',
      campaign_id: campaignId,
      trade_record_id: `${campaignId}-rec-main`,
      leg_role: 'main_open',
      leg_sequence: 1,
      source: 'post_review',
      symbol: 'BTCUSDT',
      direction: 'long',
      order_kind: 'main',
      leverage: 1,
      pre_simulated_time: OPENED_AT,
      pre_entry_price: 100,
      pre_position_size: 1_000,
      pre_account_equity_usdt: 10_000,
      post_simulated_close_time: CLOSED_AT,
    } as unknown as TradeJournal,
    {
      id: `${campaignId}-hedge-a`,
      user_id: 'user-1',
      campaign_id: campaignId,
      trade_record_id: null,
      leg_role: 'hedge_initial_a',
      leg_sequence: 2,
      source: 'post_review',
      symbol: 'BTCUSDT',
      direction: 'short',
      order_kind: 'hedge',
      leverage: 1,
      pre_simulated_time: '2026-01-01T00:10:00.000Z',
      pre_entry_price: 90,
      pre_position_size: 500,
      post_simulated_close_time: CLOSED_AT,
    } as unknown as TradeJournal,
  ]);

  const makeRecord = (campaignId: string, exitPrice: number, pnl: number): TradeRecord => ({
    id: `${campaignId}-rec-main`,
    symbol: 'BTCUSDT',
    side: 'LONG',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 100,
    exitPrice,
    quantity: 10,
    leverage: 1,
    pnl,
    fee: 0,
    slippage: 0,
    openTime: Date.parse(OPENED_AT),
    closeTime: Date.parse(CLOSED_AT),
  } as unknown as TradeRecord);

  const emptyDiagnostics = {
    mode: 'heuristic' as const,
    timelineIds: [],
    anchorTimelineIds: [],
    unstampedAnchors: 0,
    missingAnchorNodes: [],
    verdicts: {},
    disagreements: [],
  };

  const winner = makeCampaign('winner', {});
  // 未结算：状态仍是进行中，落库的 final_realized_pnl 停在 0，
  // 而主力腿已经按 100 → 150 平掉，校正后的现算值是 500。
  const live = makeCampaign('live', {
    status: 'active',
    closed_at: null,
    final_realized_pnl: 0,
    title: 'live campaign',
  });

  const details = {
    winner: {
      campaign: winner,
      legs: makeLegs('winner'),
      tradeRecords: [makeRecord('winner', 105, 50)],
      pendingOrders: [],
      reverseHedgeOrders: [],
      foreignLiveOrders: [],
      legExitPriceCorrections: {},
      timelineDiagnostics: emptyDiagnostics,
    },
    live: {
      campaign: live,
      legs: makeLegs('live'),
      tradeRecords: [makeRecord('live', 150, 500)],
      pendingOrders: [],
      reverseHedgeOrders: [],
      foreignLiveOrders: [],
      legExitPriceCorrections: {},
      timelineDiagnostics: emptyDiagnostics,
    },
  };

  const rows: CampaignCounterfactual[] = [];
  return {
    detailsById: details,
    savedRows: rows,
    fetchCorrectionsMock: vi.fn(async () => ({})),
    listCounterfactualsMock: vi.fn(async (campaignId: string) => rows.filter(row => row.campaign_id === campaignId)),
    createCounterfactualMock: vi.fn(),
    runCustomCounterfactualMock: vi.fn(),
    saveCampaignDeviationNotesMock: vi.fn(async () => undefined),
    syncCampaignDeviationRulesToChecklistMock: vi.fn(async () => ({ created: 0, drafts: 0 })),
  };
});

vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return { ...actual, fetchLegExitPriceCorrections: fetchCorrectionsMock };
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
    params: { ...params, run_context: overview.buildCounterfactualRunContext(klines, interval ?? '1m') ?? undefined },
    result: engine.simulateManualLegScenario(params, klines),
  }));
  createCounterfactualMock.mockImplementation(async (input: {
    campaign_id: string;
    label: string;
    branch_kind: CampaignCounterfactual['branch_kind'];
    params: CampaignCounterfactualParams;
    result: CampaignCounterfactual['result'];
  }) => {
    const row: CampaignCounterfactual = {
      id: 'cf-new',
      user_id: 'user-1',
      campaign_id: input.campaign_id,
      label: input.label.slice(0, 20),
      branch_kind: input.branch_kind,
      source_deduction_id: null,
      params: input.params,
      result: input.result,
      created_at: '2026-01-01T02:00:00.000Z',
    };
    savedRows.unshift(row);
    return row;
  });
  return {
    readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
    getCampaignFullData: vi.fn(async (id: keyof typeof detailsById) => detailsById[id]),
    listAllCampaigns: vi.fn(async () => Object.values(detailsById).map(detail => detail.campaign)),
    listVisibleCampaigns: vi.fn(async () => Object.values(detailsById).map(detail => detail.campaign)),
    listCounterfactuals: listCounterfactualsMock,
    listCampaignComments: vi.fn(async () => []),
    hasMutualFollow: vi.fn(async () => true),
    runCustomCounterfactual: runCustomCounterfactualMock,
    createCounterfactual: createCounterfactualMock,
    deleteCounterfactual: vi.fn(async () => undefined),
    saveCampaignDeviationNotes: saveCampaignDeviationNotesMock,
    syncCampaignDeviationRulesToChecklist: syncCampaignDeviationRulesToChecklistMock,
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
    getEffectiveTime: () => Date.parse(CLOSED_AT),
    balance: 10_000,
    positionsMap: {},
    priceMap: {},
  }),
}));

vi.mock('@/hooks/useCampaignKlines', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useCampaignKlines')>();
  return {
    ...actual,
    buildCampaignKlineTimeWindow: () => ({
      fromTime: Date.parse('2025-12-31T23:00:00.000Z'),
      toTime: Date.parse('2026-01-01T02:00:00.000Z'),
      defaultFromTime: Date.parse('2025-12-31T23:30:00.000Z'),
      defaultToTime: Date.parse('2026-01-01T01:30:00.000Z'),
      contentStartMs: Date.parse(OPENED_AT),
      contentEndMs: Date.parse(CLOSED_AT),
      contextMs: 30 * 60_000,
      availableContextMs: 600 * 60_000,
    }),
    useCampaignKlines: () => ({
      klines: [{
        time: Date.parse(OPENED_AT),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
      }],
      loading: false,
      error: null,
      reload: vi.fn(),
      fromTime: Date.parse('2025-12-31T23:00:00.000Z'),
      toTime: Date.parse('2026-01-01T02:00:00.000Z'),
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

function manualLeg(overrides: Partial<CampaignCounterfactualManualLeg>): CampaignCounterfactualManualLeg {
  return {
    id: 'winner-main',
    leg_role: 'main_open',
    direction: 'long',
    open_time: OPENED_AT,
    close_time: CLOSED_AT,
    entry_price: 100,
    exit_price: 120,
    size_usdt: 1_000,
    leverage: 1,
    enabled: true,
    ...overrides,
  };
}

function savedBranch(
  campaignId: string,
  legs: CampaignCounterfactualManualLeg[],
  finalRealizedPnl: number,
): CampaignCounterfactual {
  return {
    id: `cf-${campaignId}`,
    user_id: 'user-1',
    campaign_id: campaignId,
    label: '已保存方案',
    branch_kind: 'custom_what_if',
    source_deduction_id: null,
    params: {
      entry: { time: OPENED_AT, price: 100, size_usdt: 1_000, direction: 'long', leverage: 1 },
      hedge_a: { offset_pct: -10, size_pct: 50 },
      hedge_b: { offset_pct: -20, size_pct: 50 },
      mirror_tp: { offset_pct: 10, size_pct: 50 },
      rolling: { enabled: false, trigger_rise_pct: 0, min_interval_minutes: 5, new_hedge_offset_pct: -2, rolling_hedge_size_pct: 50 },
      exit_rule: 'manual_only',
      manual_legs: legs,
    },
    result: {
      final_realized_pnl: finalRealizedPnl,
      final_r_multiple: 0,
      peak_unrealized_pnl: Math.max(0, finalRealizedPnl),
      peak_drawdown: 0,
      profit_capture_ratio: 100,
      events: [],
      legs_summary: [],
      state_segments: [{ state: 'manual_legs', state_label: '手动 Legs 方案', start_time: OPENED_AT, end_time: CLOSED_AT }],
      sop_score: 0,
    },
    created_at: '2025-12-31T08:15:00.000Z',
  };
}

function renderPage(id: 'winner' | 'live' = 'winner') {
  return render(
    <MemoryRouter initialEntries={[`/journal/campaigns/${id}`]}>
      <Routes>
        <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** 等编辑器把 Legs 副本铺好，并把平仓价校正那一轮 promise 冲干净。 */
async function waitForEditor(exitPrice: string) {
  await screen.findByRole('button', { name: '一键运行' }, { timeout: 5_000 });
  await waitFor(() => expect(screen.getByDisplayValue(exitPrice)).toBeInTheDocument());
  await act(async () => { await Promise.resolve(); });
}

function metricValue(panel: HTMLElement, label: string) {
  const row = within(panel).getByRole('button', { name: `${label}说明` }).closest('div.flex');
  return row?.querySelector('span.font-mono')?.textContent ?? null;
}

beforeEach(() => {
  window.localStorage.clear();
  savedRows.length = 0;
  fetchCorrectionsMock.mockReset();
  fetchCorrectionsMock.mockImplementation(async () => ({}));
  listCounterfactualsMock.mockClear();
  createCounterfactualMock.mockClear();
  runCustomCounterfactualMock.mockClear();
  saveCampaignDeviationNotesMock.mockClear();
  syncCampaignDeviationRulesToChecklistMock.mockClear();
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});

describe('JournalCampaignDetailPage：保存备注不冲掉 Legs 副本', () => {
  it('载入到 Legs 副本后点「保存备注」：载入的腿原样留着，不被重置回基线', async () => {
    savedRows.push(savedBranch('winner', [manualLeg({ exit_price: 120 })], 200));
    renderPage();
    // 基线来自成交记录：主力平仓价 105
    await waitForEditor('105');

    fireEvent.click(screen.getByTestId('counterfactual-load-legs'));
    await waitFor(() => expect(screen.getByDisplayValue('120')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('105')).not.toBeInTheDocument();

    const detailsToggle = screen.getByRole('button', { name: /偏离代价明细/ });
    expect(detailsToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '保存备注' })).toBeNull();
    fireEvent.click(detailsToggle);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存备注' }));
    });
    await waitFor(() => expect(saveCampaignDeviationNotesMock).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });

    // 「保存备注」只写 deviation_notes，推演参数一个字没变：副本不该被动过
    expect(screen.getByDisplayValue('120')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('105')).not.toBeInTheDocument();
  }, 20_000);

  it('手改到一半点「保存备注」同样不被冲掉（这一场没有任何平仓价校正）', async () => {
    savedRows.push(savedBranch('winner', [manualLeg({ exit_price: 120 })], 200));
    renderPage();
    await waitForEditor('105');

    fireEvent.change(screen.getByDisplayValue('105'), { target: { value: '118' } });
    fireEvent.click(screen.getByRole('button', { name: /偏离代价明细/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存备注' }));
    });
    await waitFor(() => expect(saveCampaignDeviationNotesMock).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByDisplayValue('118')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('105')).not.toBeInTheDocument();
  }, 20_000);

  it('平仓价校正真的变了时仍按老规矩把副本重置到新基线', async () => {
    // 校正的拉取先挂住不返回。页面上不止本场在拉（账户级样本每场也拉一次），
    // 所以把每一次的 resolve 都收起来，到点一起放。
    const pendingCorrections: Array<(value: Record<string, unknown>) => void> = [];
    fetchCorrectionsMock.mockImplementation(() => new Promise(resolve => { pendingCorrections.push(resolve); }));

    renderPage();
    await waitForEditor('105');
    fireEvent.change(screen.getByDisplayValue('105'), { target: { value: '118' } });

    // 真的拉到了一条平仓价校正（105 → 99）：内容变了，基线跟着变，副本照旧被重置
    await act(async () => {
      for (const resolve of pendingCorrections) {
        resolve({ 'winner-main': { exitPrice: 99, originalExitPrice: 105, candleLow: 98, candleHigh: 106 } });
      }
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByDisplayValue('99')).toBeInTheDocument());
    expect(screen.queryByDisplayValue('118')).not.toBeInTheDocument();
  }, 20_000);
});

describe('JournalCampaignDetailPage：相对实际的基线', () => {
  it('未结算的战役用校正后的已实现 P&L 当基线，与上面那格盈亏概览对得上', async () => {
    savedRows.push(savedBranch('live', [manualLeg({ id: 'live-main', exit_price: 180 })], 800));
    renderPage('live');
    await waitForEditor('150');

    const campaignPanel = screen.getByText('盈亏概览').parentElement as HTMLElement;
    // 落库的 final_realized_pnl 还停在 0，界面印的是校正后的现算值 500
    expect(metricValue(campaignPanel, '已实现 P&L')).toBe('500.00 USDT');

    const savedPanel = await screen.findByTestId('counterfactual-saved-panel');
    expect(within(savedPanel).getByText('+300.00 USDT')).toBeInTheDocument();
    expect(within(savedPanel).queryByText('+800.00 USDT')).not.toBeInTheDocument();
  }, 20_000);
});

describe('JournalCampaignDetailPage：保存期间再次一键运行', () => {
  it('保存还没落地就又跑了一次：新草稿留着，落库的仍是点保存那一刻的那一份', async () => {
    let releaseCreate: () => void = () => undefined;
    const pending = new Promise<void>(resolve => { releaseCreate = resolve; });
    const realCreate = createCounterfactualMock.getMockImplementation()!;
    createCounterfactualMock.mockImplementationOnce(async (input: Parameters<typeof realCreate>[0]) => {
      await pending;
      return realCreate(input);
    });

    renderPage();
    await waitForEditor('105');

    // 第一次运行：主力平仓价改到 111 → 分支已实现 = 实际 50 + 改动值的钱 10 × (111 − 105) = 110
    // （改过的腿从实际结算值出发，平仓费按这条记录自己的费率——夹具里这条记录没收平仓费，所以是 0；对冲从未成交，不计）
    fireEvent.change(screen.getByDisplayValue('105'), { target: { value: '111' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    });
    const firstDraft = await screen.findByTestId('counterfactual-draft-panel');
    expect(metricValue(firstDraft, '已实现 P&L')).toBe('110.00 USDT');

    // 点保存（插库悬着），保存期间再改再跑一次 → 分支已实现 = 50 + 10 × (122 − 105) = 220
    await act(async () => {
      fireEvent.click(screen.getByTestId('counterfactual-save'));
    });
    expect(createCounterfactualMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByDisplayValue('111'), { target: { value: '122' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    });
    await waitFor(() => expect(
      metricValue(screen.getByTestId('counterfactual-draft-panel'), '已实现 P&L'),
    ).toBe('220.00 USDT'));

    await act(async () => {
      releaseCreate();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('counterfactual-branch-row-cf-new')).toBeInTheDocument());

    // 落库的是第一份（110），页面上留着的是第二份（220），名字也没被清空
    expect(createCounterfactualMock.mock.calls[0][0].result.final_realized_pnl).toBeCloseTo(110, 6);
    expect(createCounterfactualMock.mock.calls[0][0].result.fees_total).toBe(0);
    const survivingDraft = screen.getByTestId('counterfactual-draft-panel');
    expect(metricValue(survivingDraft, '已实现 P&L')).toBe('220.00 USDT');
    expect((screen.getByTestId('counterfactual-draft-name') as HTMLInputElement).value).not.toBe('');
  }, 20_000);
});

describe('JournalCampaignDetailPage：保存与删除交错', () => {
  const removeSaved = (branchId: string) => {
    const index = savedRows.findIndex(row => row.id === branchId);
    if (index >= 0) savedRows.splice(index, 1);
  };

  it('删除还悬着时保存先落地：删除收尾只去掉被删的那一条，刚保存的分支留着并保持选中', async () => {
    savedRows.push(savedBranch('winner', [manualLeg({ exit_price: 110 })], 100));

    let releaseCreate: () => void = () => undefined;
    const createPending = new Promise<void>(resolve => { releaseCreate = resolve; });
    const realCreate = createCounterfactualMock.getMockImplementation()!;
    createCounterfactualMock.mockImplementationOnce(async (input: Parameters<typeof realCreate>[0]) => {
      await createPending;
      return realCreate(input);
    });
    let releaseDelete: () => void = () => undefined;
    const deletePending = new Promise<void>(resolve => { releaseDelete = resolve; });
    vi.mocked(deleteCounterfactual).mockImplementationOnce(async (branchId: string) => {
      await deletePending;
      removeSaved(branchId);
    });

    renderPage();
    await waitForEditor('105');
    await waitFor(() => expect(screen.getByTestId('counterfactual-branch-row-cf-winner')).toBeInTheDocument());

    fireEvent.change(screen.getByDisplayValue('105'), { target: { value: '111' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    });
    await screen.findByTestId('counterfactual-draft-panel');

    // 先点保存（插库悬着），再在已保存分支面板里删 cf-winner（删除悬着）
    await act(async () => {
      fireEvent.click(screen.getByTestId('counterfactual-save'));
    });
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('counterfactual-saved-panel')).getByTestId('counterfactual-delete'));
    });

    // 保存先落地：新分支出现并被选中
    await act(async () => { releaseCreate(); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId('counterfactual-branch-row-cf-new')).toBeInTheDocument());

    // 删除后落地：只去掉 cf-winner，cf-new 留着
    await act(async () => { releaseDelete(); await Promise.resolve(); });
    await waitFor(() => expect(screen.queryByTestId('counterfactual-branch-row-cf-winner')).not.toBeInTheDocument());
    expect(screen.getByTestId('counterfactual-branch-row-cf-new')).toBeInTheDocument();
    expect(screen.getByTestId('counterfactual-saved-panel')).toBeInTheDocument();
    expect(screen.getByTestId('counterfactual-saved-panel').textContent).not.toContain('已保存方案');
  }, 20_000);

  it('保存后的列表刷新比删除晚到：已删的分支不会死而复生', async () => {
    renderPage();
    await waitForEditor('105');

    fireEvent.change(screen.getByDisplayValue('105'), { target: { value: '111' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    });
    await screen.findByTestId('counterfactual-draft-panel');

    // 保存之后那次列表刷新：查询时 cf-new 已在库里，结果悬着晚点再回来
    let releaseList: () => void = () => undefined;
    const listPending = new Promise<void>(resolve => { releaseList = resolve; });
    const realList = listCounterfactualsMock.getMockImplementation()!;
    listCounterfactualsMock.mockImplementationOnce(async (campaignId: string) => {
      const snapshot = await realList(campaignId);
      await listPending;
      return snapshot;
    });
    vi.mocked(deleteCounterfactual).mockImplementationOnce(async (branchId: string) => {
      removeSaved(branchId);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('counterfactual-save'));
    });
    await waitFor(() => expect(screen.getByTestId('counterfactual-branch-row-cf-new')).toBeInTheDocument());

    // 刷新还悬着，先把刚保存的分支删掉
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('counterfactual-saved-panel')).getByTestId('counterfactual-delete'));
    });
    await waitFor(() => expect(screen.queryByTestId('counterfactual-branch-row-cf-new')).not.toBeInTheDocument());

    // 晚到的刷新带着 cf-new：不许把它放回来
    await act(async () => { releaseList(); await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('counterfactual-branch-row-cf-new')).not.toBeInTheDocument();
    expect(screen.queryByTestId('counterfactual-saved-panel')).not.toBeInTheDocument();
  }, 20_000);
});
