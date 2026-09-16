/**
 * 反事实战役的「运行 → 未保存草稿 → 保存 / 丢弃 → 已保存分支面板」全流程。
 *
 * 用户要求：一键运行之后显示的结果要与「盈亏概览」同一套模式（同 12 项、同脚注），并且能保存。
 * 这里把编辑器换成一个能触发 onRunWhatIf 并递出基线腿的桩，journalApi 的运行走真引擎，
 * 只把 create / list / delete 换成记账的桩：什么时候插库、插了什么，一目了然。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CampaignCounterfactual,
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualParams,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return {
    ...actual,
    fetchLegExitPriceCorrections: vi.fn(async () => ({})),
  };
});

vi.mock('@/lib/campaignListCache', () => ({ waitForCampaignListHeal: vi.fn(async () => undefined) }));

const {
  campaigns,
  detailsById,
  baselineLegs,
  runParams,
  savedRows,
  listCounterfactualsMock,
  createCounterfactualMock,
  deleteCounterfactualMock,
  runCustomCounterfactualMock,
  editorLatest,
} = vi.hoisted(() => {
  const makeCampaign = (id: string, status: TradeCampaign['status'], realizedPnl: number): TradeCampaign => ({
    id,
    user_id: 'user-1',
    campaign_code: `C-${id}`,
    symbol: 'BTCUSDT',
    direction: 'main_long',
    status,
    strategy_template: 'custom',
    title: `${id} campaign`,
    opened_at: '2026-01-01T00:00:00.000Z',
    closed_at: '2026-01-01T01:00:00.000Z',
    initial_main_size_usdt: 1_000,
    initial_leverage: 1,
    final_realized_pnl: realizedPnl,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T01:00:00.000Z',
  });
  const makeLegs = (campaignId: string): TradeJournal[] => ([
    {
      id: `${campaignId}-main`,
      user_id: 'user-1',
      campaign_id: campaignId,
      trade_record_id: null,
      leg_role: 'main_open',
      source: 'post_review',
      symbol: 'BTCUSDT',
      direction: 'long',
      order_kind: 'main',
      pre_simulated_time: '2026-01-01T00:00:00.000Z',
      pre_real_time: '2026-07-19T10:00:00.000Z',
      pre_entry_price: 100,
      pre_position_size: 1_000,
      pre_account_equity_usdt: 10_000,
      post_simulated_close_time: '2026-01-01T01:00:00.000Z',
      post_real_close_time: '2026-07-19T11:00:00.000Z',
      post_realized_pnl: null,
      post_reviewed_at: '2026-07-19T11:05:00.000Z',
    } as unknown as TradeJournal,
    {
      id: `${campaignId}-hedge-a`,
      user_id: 'user-1',
      campaign_id: campaignId,
      trade_record_id: null,
      leg_role: 'hedge_initial_a',
      source: 'post_review',
      symbol: 'BTCUSDT',
      direction: 'short',
      order_kind: 'hedge',
      pre_simulated_time: '2026-01-01T00:01:00.000Z',
      pre_real_time: '2026-07-19T10:01:00.000Z',
      pre_entry_price: 90,
      pre_position_size: 1_000,
      post_simulated_close_time: '2026-01-01T01:00:00.000Z',
      post_real_close_time: '2026-07-19T11:00:00.000Z',
      post_realized_pnl: null,
    } as unknown as TradeJournal,
  ]);
  const rows = [
    makeCampaign('winner', 'closed_profit', 200),
    makeCampaign('loser', 'closed_loss', -100),
  ];
  const baseline: CampaignCounterfactualManualLeg[] = [
    {
      id: 'winner-main',
      leg_role: 'main_open',
      direction: 'long',
      open_time: '2026-01-01T00:00:00.000Z',
      close_time: '2026-01-01T01:00:00.000Z',
      entry_price: 100,
      exit_price: 100,
      size_usdt: 1_000,
      leverage: 1,
      enabled: true,
    },
    {
      id: 'winner-hedge-a',
      leg_role: 'hedge_initial_a',
      direction: 'short',
      open_time: '2026-01-01T00:01:00.000Z',
      close_time: '2026-01-01T01:00:00.000Z',
      entry_price: 90,
      exit_price: 90,
      size_usdt: 1_000,
      leverage: 1,
      enabled: true,
      // 页面上这张对冲没有成交记录、没有快照、没有触发事件：buildManualLegs 会把它标成挂单
      filled: false,
    },
  ];
  const params: CampaignCounterfactualParams = {
    entry: { time: '2026-01-01T00:00:00.000Z', price: 100, size_usdt: 1_000, direction: 'long', leverage: 1 },
    hedge_a: { offset_pct: 2, size_pct: 50 },
    hedge_b: { offset_pct: 4, size_pct: 50 },
    mirror_tp: { offset_pct: 2, size_pct: 50 },
    rolling: { enabled: false, trigger_rise_pct: 0, min_interval_minutes: 5, new_hedge_offset_pct: 2, rolling_hedge_size_pct: 50 },
    exit_rule: 'manual_only',
    // 只改主力平仓价：100 → 110，分支已实现 = 1000 × 10% − 平仓费 10 × 110 × 0.05% = 99.45（挂单中的对冲不计）
    manual_legs: [{ ...baseline[0], exit_price: 110 }, baseline[1]],
  };
  const saved: CampaignCounterfactual[] = [];
  return {
    campaigns: rows,
    detailsById: Object.fromEntries(rows.map(campaign => [campaign.id, {
      campaign,
      legs: makeLegs(campaign.id),
      tradeRecords: [],
      pendingOrders: [],
      reverseHedgeOrders: [],
      foreignLiveOrders: [],
      timelineDiagnostics: {
        mode: 'heuristic' as const,
        timelineIds: [],
        anchorTimelineIds: [],
        unstampedAnchors: 0,
        missingAnchorNodes: [],
        verdicts: {},
        disagreements: [],
      },
    }])),
    baselineLegs: baseline,
    runParams: params,
    savedRows: saved,
    // 与真实 listCounterfactuals 一样按战役过滤：换战役后另一场的行不该出现
    listCounterfactualsMock: vi.fn(async (campaignId: string) => saved.filter(row => row.campaign_id === campaignId)),
    createCounterfactualMock: vi.fn(),
    deleteCounterfactualMock: vi.fn(async (_id: string) => undefined),
    runCustomCounterfactualMock: vi.fn(),
    editorLatest: { props: null as null | { loadLegsRequest?: { nonce: number; legs: CampaignCounterfactualManualLeg[] } | null } },
  };
});

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
  deleteCounterfactualMock.mockImplementation(async (id: string) => {
    const index = savedRows.findIndex(row => row.id === id);
    if (index >= 0) savedRows.splice(index, 1);
  });
  return {
    readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
    getCampaignFullData: vi.fn(async (id: string) => detailsById[id]),
    listAllCampaigns: vi.fn(async () => campaigns),
    listVisibleCampaigns: vi.fn(async () => campaigns),
    listCounterfactuals: listCounterfactualsMock,
    listCampaignComments: vi.fn(async () => []),
    hasMutualFollow: vi.fn(async () => true),
    runCustomCounterfactual: runCustomCounterfactualMock,
    createCounterfactual: createCounterfactualMock,
    deleteCounterfactual: deleteCounterfactualMock,
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
    getEffectiveTime: () => Date.parse('2026-01-01T01:00:00.000Z'),
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
      fromTime: Date.parse('2025-12-31T07:30:00.000Z'),
      toTime: Date.parse('2026-01-01T17:30:00.000Z'),
      defaultFromTime: Date.parse('2025-12-31T23:30:00.000Z'),
      defaultToTime: Date.parse('2026-01-01T01:30:00.000Z'),
      contentStartMs: Date.parse('2026-01-01T00:10:00.000Z'),
      contentEndMs: Date.parse('2026-01-01T00:50:00.000Z'),
      contextMs: 40 * 60_000,
      availableContextMs: 1_000 * 60_000,
    }),
    useCampaignKlines: () => ({
      klines: [{
        time: Date.parse('2026-01-01T00:00:00.000Z'),
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
      }],
      loading: false,
      error: null,
      reload: vi.fn(),
      fromTime: Date.parse('2025-12-31T07:30:00.000Z'),
      toTime: Date.parse('2026-01-01T17:30:00.000Z'),
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

// 编辑器桩：一个按钮触发 onRunWhatIf，并把基线腿 / 编辑器全部腿一起递出去；记下最新 props 以便看 loadLegsRequest。
vi.mock('@/components/journal/CampaignWhatIfEditor', () => ({
  CampaignWhatIfEditor: (props: {
    onRunWhatIf: (
      label: string,
      params: CampaignCounterfactualParams,
      context: { baselineLegs: CampaignCounterfactualManualLeg[]; manualLegs: CampaignCounterfactualManualLeg[] },
    ) => void;
    loadLegsRequest?: { nonce: number; legs: CampaignCounterfactualManualLeg[] } | null;
  }) => {
    editorLatest.props = props;
    return (
      <button
        type="button"
        onClick={() => props.onRunWhatIf('手动调整', runParams, {
          baselineLegs,
          manualLegs: runParams.manual_legs ?? [],
        })}
      >
        stub-run
      </button>
    );
  },
}));

const OVERVIEW_LABELS = [
  '已实现 P&L',
  '杠杆倍数',
  '主力开仓名义仓位',
  '峰值浮盈',
  '最大预期亏损',
  '预期回撤',
  '盈亏比',
  '本场 b 对 DSI/USI 的贡献',
  '机会质量',
  '算术期望',
  '几何期望',
  '今日账户总资产',
];

function helpButtonLabels(panel: HTMLElement) {
  return within(panel)
    .getAllByRole('button', { name: /说明$/ })
    .map(button => button.getAttribute('aria-label')?.replace(/说明$/, ''));
}

function metricValue(panel: HTMLElement, label: string) {
  const row = within(panel).getByRole('button', { name: `${label}说明` }).closest('div.flex');
  return row?.querySelector('span.font-mono')?.textContent ?? null;
}

function renderPage(id = 'winner') {
  return render(
    <MemoryRouter initialEntries={[`/journal/campaigns/${id}`]}>
      <Routes>
        <Route
          path="/journal/campaigns/:id"
          element={(
            <>
              <Link to="/journal/campaigns/loser">go-loser</Link>
              <JournalCampaignDetailPage />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

async function runFromEditor() {
  const runButton = await screen.findByRole('button', { name: 'stub-run' });
  await act(async () => {
    fireEvent.click(runButton);
  });
  return screen.findByTestId('counterfactual-draft-panel');
}

/** 老行：params 里只有主力腿（没有初始对冲 → L = 0），result 没有四个风险锚字段，也没有 run_context / change_summary。 */
function oldShapeRow(): CampaignCounterfactual {
  return {
    id: 'old-1',
    user_id: 'user-1',
    campaign_id: 'winner',
    label: '手动调整',
    branch_kind: 'custom_what_if',
    source_deduction_id: null,
    params: {
      ...runParams,
      manual_legs: [{ ...baselineLegs[0], exit_price: 120 }],
    },
    result: {
      final_realized_pnl: 200,
      final_r_multiple: 0,
      peak_unrealized_pnl: 200,
      peak_drawdown: 0,
      profit_capture_ratio: 100,
      events: [],
      legs_summary: [],
      state_segments: [{ state: 'manual_legs', state_label: '手动 Legs 方案', start_time: '2026-01-01T00:00:00.000Z', end_time: '2026-01-01T01:00:00.000Z' }],
      sop_score: 0,
    },
    created_at: '2025-12-30T08:15:00.000Z',
  };
}

/** 早期自动生成的「补齐 X」修正分支：列表里隐藏，元监控「战役 SOP 经济成本」却读它；比 old-1 更新，放在列表最前。 */
function hiddenFixRow(): CampaignCounterfactual {
  const base = oldShapeRow();
  return {
    ...base,
    id: 'fix-1',
    label: '补齐 hedge_b',
    branch_kind: 'fix_one_deviation',
    source_deduction_id: 'winner:hedge_b:missing_hedge_b',
    params: { ...runParams, manual_legs: [] },
    result: { ...base.result, final_realized_pnl: 250, peak_unrealized_pnl: 250, state_segments: [] },
    created_at: '2026-01-01T03:00:00.000Z',
  };
}

beforeEach(() => {
  window.localStorage.clear();
  savedRows.length = 0;
  listCounterfactualsMock.mockClear();
  createCounterfactualMock.mockClear();
  deleteCounterfactualMock.mockClear();
  runCustomCounterfactualMock.mockClear();
  editorLatest.props = null;
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});

describe('JournalCampaignDetailPage counterfactual overview flow', () => {
  it('一键运行 → 「反事实盈亏概览 · 未保存」：同 12 项说明按钮、相对实际、默认分支名；保存前没有插库', async () => {
    renderPage();
    const panel = await runFromEditor();

    expect(within(panel).getByText('反事实盈亏概览 · 未保存')).toBeInTheDocument();
    expect(helpButtonLabels(panel)).toEqual(OVERVIEW_LABELS);
    // 分支已实现 99.45（净额），实际 200 → 相对实际 −100.55
    expect(metricValue(panel, '已实现 P&L')).toBe('99.45 USDT');
    expect(within(panel).getByText('-100.55 USDT')).toBeInTheDocument();
    expect(within(panel).getByText('改 主力开仓：平仓价 100 → 110')).toBeInTheDocument();
    expect(within(panel).getByText(/1m K 线 1 根/)).toBeInTheDocument();
    // 有初始对冲 A → 有止损线，L 派生项不是「—」
    expect(metricValue(panel, '最大预期亏损')).not.toBe('—');
    expect(metricValue(panel, '盈亏比')).not.toBe('—');
    expect(metricValue(panel, '今日账户总资产')).toBe('10000.00 USDT');
    // 期望口径脚注与真实面板同一句
    await waitFor(() => expect(within(panel).getByText(/2 场有效战役，实时胜率 50.00%/)).toBeInTheDocument());

    const nameInput = screen.getByTestId('counterfactual-draft-name') as HTMLInputElement;
    expect(nameInput.value).toMatch(/^主力开仓 平仓价 \d{2}-\d{2} \d{2}:\d{2}$/);
    expect(nameInput).toHaveAttribute('maxlength', '20');

    expect(runCustomCounterfactualMock).toHaveBeenCalledTimes(1);
    expect(runCustomCounterfactualMock.mock.calls[0][3]).toBe('1m');
    expect(createCounterfactualMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('counterfactual-saved-panel')).not.toBeInTheDocument();
  }, 15_000);

  it('保存 → createCounterfactual 一次（名字 + change_summary + run_context），列表出现该行，面板切成已保存', async () => {
    renderPage();
    await runFromEditor();

    fireEvent.change(screen.getByTestId('counterfactual-draft-name'), { target: { value: '我的方案' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('counterfactual-save'));
    });

    await waitFor(() => expect(createCounterfactualMock).toHaveBeenCalledTimes(1));
    const input = createCounterfactualMock.mock.calls[0][0];
    expect(input).toEqual(expect.objectContaining({
      campaign_id: 'winner',
      label: '我的方案',
      branch_kind: 'custom_what_if',
    }));
    expect(input.params.change_summary).toEqual(expect.objectContaining({
      short: '主力开仓 平仓价',
      lines: ['改 主力开仓：平仓价 100 → 110'],
      legs: [{ id: 'winner-main', role: 'main_open', kind: 'edited', changedFields: ['exit_price'] }],
    }));
    expect(input.params.run_context).toEqual(expect.objectContaining({ interval: '1m', kline_count: 1 }));
    expect(input.result.initial_expected_max_loss).toBeGreaterThan(0);

    const row = await screen.findByTestId('counterfactual-branch-row-cf-new');
    expect(within(row).getByText('我的方案')).toBeInTheDocument();
    expect(within(row).getByText(/What-if · 主力开仓 平仓价 · \d{2}-\d{2} \d{2}:\d{2}/)).toBeInTheDocument();
    // 手动分支不显示 SOP 分数
    expect(within(row).queryByText(/^SOP /)).not.toBeInTheDocument();

    const savedPanel = await screen.findByTestId('counterfactual-saved-panel');
    expect(within(savedPanel).getByText('反事实盈亏概览 · 我的方案')).toBeInTheDocument();
    expect(helpButtonLabels(savedPanel)).toEqual(OVERVIEW_LABELS);
    expect(screen.queryByTestId('counterfactual-draft-panel')).not.toBeInTheDocument();
  }, 15_000);

  it('丢弃 → 不插库，草稿面板消失', async () => {
    renderPage();
    await runFromEditor();

    fireEvent.click(screen.getByTestId('counterfactual-discard'));

    await waitFor(() => expect(screen.queryByTestId('counterfactual-draft-panel')).not.toBeInTheDocument());
    expect(createCounterfactualMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('counterfactual-branch-row-cf-new')).not.toBeInTheDocument();
  }, 15_000);

  it('选中老行（没有风险锚字段、没有初始对冲）：面板照常渲染，L 派生项印「—」；载入到 Legs 副本把腿递给编辑器', async () => {
    savedRows.push(oldShapeRow());
    renderPage();

    const panel = await screen.findByTestId('counterfactual-saved-panel');
    expect(within(panel).getByText('反事实盈亏概览 · 手动调整')).toBeInTheDocument();
    expect(helpButtonLabels(panel)).toEqual(OVERVIEW_LABELS);
    expect(metricValue(panel, '已实现 P&L')).toBe('200.00 USDT');
    for (const label of ['最大预期亏损', '预期回撤', '盈亏比', '机会质量', '算术期望', '几何期望']) {
      expect(metricValue(panel, label)).toBe('—');
    }
    expect(within(panel).getByText('早期分支未记录改动摘要')).toBeInTheDocument();
    expect(within(panel).getByText('+0.00 USDT')).toBeInTheDocument();
    expect(screen.getByTestId('counterfactual-branch-row-old-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('counterfactual-load-legs'));
    await waitFor(() => expect(editorLatest.props?.loadLegsRequest?.legs).toEqual([{ ...baselineLegs[0], exit_price: 120 }]));
    expect(typeof editorLatest.props?.loadLegsRequest?.nonce).toBe('number');
  }, 15_000);

  it('删除 → deleteCounterfactual 被调用，行与面板一起消失；不会顺势选中列表里隐藏的修正分支', async () => {
    savedRows.push(hiddenFixRow(), oldShapeRow());
    renderPage();
    const panel = await screen.findByTestId('counterfactual-saved-panel');
    expect(within(panel).getByText('反事实盈亏概览 · 手动调整')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('counterfactual-delete'));
    });

    await waitFor(() => expect(deleteCounterfactualMock).toHaveBeenCalledWith('old-1'));
    await waitFor(() => expect(screen.queryByTestId('counterfactual-branch-row-old-1')).not.toBeInTheDocument());
    expect(deleteCounterfactualMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('counterfactual-saved-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('counterfactual-delete')).not.toBeInTheDocument();
  }, 15_000);

  it('列表里隐藏的修正分支不会被默认选中：只有它时没有面板与「删除」，有可见分支时选可见的那条', async () => {
    savedRows.push(hiddenFixRow());
    const onlyHidden = renderPage();
    await screen.findByRole('button', { name: 'stub-run' });
    await screen.findByText(/还没有反事实分支/);
    expect(screen.queryByTestId('counterfactual-branch-row-fix-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('counterfactual-saved-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('counterfactual-delete')).not.toBeInTheDocument();
    onlyHidden.unmount();

    // 隐藏行更新（排在最前），可见的老行在后：默认选中可见的那条
    savedRows.push(oldShapeRow());
    renderPage();
    const panel = await screen.findByTestId('counterfactual-saved-panel');
    expect(within(panel).getByText('反事实盈亏概览 · 手动调整')).toBeInTheDocument();
    expect(screen.getByTestId('counterfactual-branch-row-old-1')).toBeInTheDocument();
    expect(screen.queryByTestId('counterfactual-branch-row-fix-1')).not.toBeInTheDocument();
    expect(screen.queryByText('反事实盈亏概览 · 补齐 hedge_b')).not.toBeInTheDocument();
  }, 15_000);

  it('保存期间切到另一场战役：插库仍归原战役，新战役的列表与面板不会被塞进那一行', async () => {
    let releaseCreate: () => void = () => undefined;
    createCounterfactualMock.mockImplementationOnce(async (input: {
      campaign_id: string;
      label: string;
      branch_kind: CampaignCounterfactual['branch_kind'];
      params: CampaignCounterfactualParams;
      result: CampaignCounterfactual['result'];
    }) => {
      await new Promise<void>(resolve => { releaseCreate = resolve; });
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

    renderPage();
    await runFromEditor();
    fireEvent.change(screen.getByTestId('counterfactual-draft-name'), { target: { value: '赢家方案' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('counterfactual-save'));
    });
    expect(createCounterfactualMock).toHaveBeenCalledTimes(1);
    expect(createCounterfactualMock.mock.calls[0][0].campaign_id).toBe('winner');

    // 插库还没返回，用户已经切到 loser
    await act(async () => {
      fireEvent.click(screen.getByText('go-loser'));
    });
    await screen.findByText('loser campaign');
    await waitFor(() => expect(listCounterfactualsMock).toHaveBeenCalledWith('loser'));
    expect(screen.queryByTestId('counterfactual-draft-panel')).not.toBeInTheDocument();

    await act(async () => {
      releaseCreate();
    });
    await waitFor(() => expect(savedRows.some(row => row.id === 'cf-new' && row.campaign_id === 'winner')).toBe(true));
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByTestId('counterfactual-branch-row-cf-new')).not.toBeInTheDocument();
    expect(screen.queryByTestId('counterfactual-saved-panel')).not.toBeInTheDocument();
    expect(screen.getByText(/还没有反事实分支/)).toBeInTheDocument();
    // 保存后的刷新不会再拿 winner 去覆盖 loser 的列表
    expect(listCounterfactualsMock.mock.calls.at(-1)?.[0]).toBe('loser');
    expect(listCounterfactualsMock.mock.calls.filter(call => call[0] === 'winner')).toHaveLength(1);
  }, 15_000);
});
