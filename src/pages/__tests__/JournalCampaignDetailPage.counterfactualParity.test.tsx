/**
 * 整页黄金对账：真实页面 + 真实「Legs 副本」编辑器 + 真实手动 Legs 引擎，不改一格直接「一键运行」，
 * 「反事实盈亏概览 · 未保存」逐项印出与上方「盈亏概览」相同的字，「相对实际」是 +0.00。
 *
 * 夹具与库级黄金测试（src/lib/__tests__/counterfactualParity.test.ts）共用一份：平仓价校正、
 * 从未成交的初始对冲、每条记录都带手续费、币本位空单——三处曾经的分叉都在里面。
 * 库级测试逐项比到 1 分钱；这里比的是用户真正看到的文字，外加「挂单中」开关的一次往返。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { CampaignCounterfactual, CampaignCounterfactualManualLeg, CampaignCounterfactualParams } from '@/types/journal';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

const { state, runCustomCounterfactualMock, createCounterfactualMock } = vi.hoisted(() => ({
  state: {
    fixtureId: 'exit-correction',
    savedRows: [] as CampaignCounterfactual[],
    /** 换到这个周期时 K 线多拉一根（窗口末根变了），用来验证老行的兜底平仓时间不被读成改动。 */
    widerInterval: null as string | null,
    /** 一打开就多拉一根（任何周期）：分支保存之后 K 线窗口已经往后长了。 */
    widerFromStart: false,
  },
  runCustomCounterfactualMock: vi.fn(),
  createCounterfactualMock: vi.fn(),
}));

async function currentFixture() {
  const { parityFixture } = await import('@/test/fixtures/counterfactualParityFixtures');
  return parityFixture(state.fixtureId);
}

vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return {
    ...actual,
    // 页面按腿去拉 K 线校验平仓价：这里直接给夹具里的那一份校正。
    fetchLegExitPriceCorrections: vi.fn(async () => (await currentFixture()).corrections),
  };
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
  return {
    readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
    getCampaignFullData: vi.fn(async () => detail()),
    listAllCampaigns: vi.fn(async () => [(await currentFixture()).campaign]),
    listVisibleCampaigns: vi.fn(async () => [(await currentFixture()).campaign]),
    listCounterfactuals: vi.fn(async () => state.savedRows),
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
  const fixtures = await import('@/test/fixtures/counterfactualParityFixtures');
  const hour = (h: number) => fixtures.PARITY_T0 + h * fixtures.PARITY_HOUR;
  return {
    ...actual,
    buildCampaignKlineTimeWindow: () => ({
      fromTime: hour(-1),
      toTime: hour(4),
      defaultFromTime: hour(-1),
      defaultToTime: hour(4),
      contentStartMs: hour(0),
      contentEndMs: hour(3),
      contextMs: fixtures.PARITY_HOUR,
      availableContextMs: 600 * fixtures.PARITY_MINUTE,
    }),
    useCampaignKlines: (_symbol: string, _openedAt: string, _closedAt: string | null, interval?: string) => ({
      klines: state.widerFromStart || (interval != null && interval === state.widerInterval)
        ? [...fixtures.parityFixture(state.fixtureId).klines, {
          time: hour(4), open: 110, high: 111, low: 109, close: 110, volume: 1,
        }]
        : fixtures.parityFixture(state.fixtureId).klines,
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

/** 整页渲染 + 一键运行在负载高的机器上单条就要十几秒；并行跑全量时留足余量，免得超时被读成对账失败。 */
const PAGE_TEST_TIMEOUT_MS = 60_000;
/** 单次等待的上限：页面要先拉完详情、校正与 K 线，编辑器才按带校正的基线建好。 */
const WAIT = 15_000;

// 逐项比对的清单（不管先后）；【用户要求】新增多方总名义仓位，原样重跑也要逐位相同
const OVERVIEW_LABELS = [
  '已实现 P&L',
  '杠杆倍数',
  '主力开仓名义仓位',
  '峰值浮盈',
  '最大预期亏损',
  '多方总名义仓位',
  '预期回撤',
  '涨幅',
  '涨幅效率',
  '盈亏比',
  '加仓&止盈效用',
  'DSI/USI 贡献',
  '算术期望',
  '几何期望',
];

function metricValue(panel: HTMLElement, label: string) {
  // 主空战役里「多方总名义仓位」叫「空方总名义仓位」
  const button = within(panel).queryByRole('button', { name: `${label}说明` })
    ?? (label === '多方总名义仓位' ? within(panel).getByRole('button', { name: '空方总名义仓位说明' }) : within(panel).getByRole('button', { name: `${label}说明` }));
  const row = button.closest('div.flex');
  return row?.querySelector('span.font-mono')?.textContent ?? null;
}

function panelValues(panel: HTMLElement) {
  return Object.fromEntries(OVERVIEW_LABELS.map(label => [label, metricValue(panel, label)]));
}

/** 与 App 根部一样包一层 TooltipProvider：历史归类的战役在页眉上带提示气泡。 */
function renderPage() {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[`/journal/campaigns/${state.fixtureId}`]}>
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/** 等编辑器按带校正的基线建好（exitShown 是某条腿平仓价格子里应有的值），再一键运行。 */
async function runCopy(exitShown: string) {
  await screen.findByRole('button', { name: '一键运行' }, { timeout: WAIT });
  await waitFor(() => expect(screen.getAllByDisplayValue(exitShown).length).toBeGreaterThan(0), { timeout: WAIT });
  await act(async () => { await Promise.resolve(); });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
  });
  await waitFor(() => expect(runCustomCounterfactualMock).toHaveBeenCalled(), { timeout: WAIT });
  const draft = await screen.findByTestId('counterfactual-draft-panel', {}, { timeout: WAIT });
  const campaignPanel = screen.getByText('盈亏概览').parentElement as HTMLElement;
  return { campaignPanel, draft };
}

beforeEach(() => {
  state.savedRows = [];
  state.widerInterval = null;
  state.widerFromStart = false;
  window.localStorage.clear();
  runCustomCounterfactualMock.mockClear();
  createCounterfactualMock.mockClear();
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});

/** 模拟器实跑的夹具：编辑器里主力那一格平仓价就是它最后一刀成交记录的平仓价（带滑点，不是整数）。 */
async function mainExitShown(fixtureId: string) {
  const { parityFixture } = await import('@/test/fixtures/counterfactualParityFixtures');
  const records = parityFixture(fixtureId).tradeRecords.filter(record => record.fillId === 'pos-main');
  return String(records.reduce((latest, record) => (record.closeTime > latest.closeTime ? record : latest), records[0]).exitPrice);
}

describe('JournalCampaignDetailPage：不改一格的 Legs 副本逐项复现盈亏概览', () => {
  it.each([
    // [夹具, 编辑器里应出现的平仓价（null = 取主力最后一刀的成交价）, 真实面板的已实现, 真实面板的峰值浮盈]
    ['exit-correction', '104', '120.00 USDT', '320.00'],
    ['unfilled-hedge', '110', '100.00 USDT', '300.00'],
    ['fees-everywhere', '106', '23.20 USDT', '300.00'],
    ['coin-short', '50500', '68.70 USDT', '89.70'],
    // 主力与镜像并仓、镜像止盈按比例减仓：真实峰值按两刀各自的时点还原
    ['sim-merged-mirror', null, null, '299.90'],
    // 市价滑点：主力开仓名义仓位按成交记录
    ['sim-slippage', null, null, '299.90'],
    // 对冲 B 只在反向委托里：止损线照样由它定义
    ['sim-reverse-order-only', null, null, '299.90'],
    // 两笔主力先后开、第二笔先挂后成交：各自的 A/B 归各自的主力
    ['sim-two-mains-sequential', null, '77.71 USDT', '439.05'],
    // 一条腿都结算不了：已实现读落库值，副本把它摊到腿上
    ['sim-no-settlement-stored', '100', '99.40 USDT', '300.00'],
    // 并进主力却没有腿的加仓：名义仓位不算它
    ['sim-merged-add-no-leg', null, '128.86 USDT', '429.85'],
    // 历史归类、本地没有成交记录：只在事件里的对冲照样持有（峰值 140）
    ['sim-hist-event-hedge', '110', '39.17 USDT', '140.00'],
    // 历史归类、每条腿都只在事件里：同一个仓位只持有一次（峰值 300，不是 600）
    ['sim-hist-event-only', '110', '84.20 USDT', '300.00'],
    // 从日志腿归类、A/B 归类时还挂着：战役页不持有这两张挂单（峰值与实时战役同为 299.90，不是 99.24）
    ['sim-journal-classified-pending', null, '99.24 USDT', '299.90'],
    // 归类时对冲还没平、腿后来补了平仓：按腿上的 00:50 放下它（峰值 294.75，不是持有到结束的 140）
    ['sim-hist-stale-event', '110', '94.20 USDT', '294.75'],
    // 结束时间记早 8 小时 / 20 分钟的老战役：窗口补到最后一次平仓（峰值 299.90 / 400，不是 99.24 / 300）
    ['sim-slippage-closed-8h-early', null, '99.24 USDT', '299.90'],
    ['unfilled-hedge-closed-20m-early', '110', '100.00 USDT', '400.00'],
    // A/B 挂着委托 id、本地委托记录显示已撤单：两边都不持有（峰值 299.90，不是 99.24）
    ['sim-journal-classified-order-id', null, '99.24 USDT', '299.90'],
    // 主力的最后一刀被回填的加仓腿认领：副本按主力自己的 00:30 那一刀平（峰值 169.59，不是 299.90）
    ['sim-close-claimed-by-add-leg', null, '69.26 USDT', '169.59'],
  ])('%s', async (fixtureId, exitShownOrNull, realized, peak) => {
    state.fixtureId = fixtureId;
    renderPage();
    const exitShown = exitShownOrNull ?? await mainExitShown(fixtureId);
    const { campaignPanel, draft } = await runCopy(exitShown);

    const real = panelValues(campaignPanel);
    if (realized) expect(real['已实现 P&L']).toBe(realized);
    // 【用户要求】峰值浮盈带单位 USDT
    expect(real['峰值浮盈']).toBe(`${peak} USDT`);
    // 真实面板有止损线：这些夹具都挂着初始对冲 A，L 派生项有数
    expect(real['最大预期亏损']).not.toBe('—');
    expect(panelValues(draft)).toEqual(real);
    expect(within(draft).getByText('+0.00 USDT')).toBeInTheDocument();
    expect(within(draft).getByText('与原始 Legs 无差异')).toBeInTheDocument();
    expect(createCounterfactualMock).not.toHaveBeenCalled();
  }, PAGE_TEST_TIMEOUT_MS);

  it('挂单中的初始对冲：带「挂单中」标签；切成「已成交」再跑，改动摘要记下这一笔，峰值按持有它重算', async () => {
    state.fixtureId = 'unfilled-hedge';
    renderPage();
    await runCopy('110');

    const toggle = screen.getByTestId('counterfactual-leg-filled-toggle-hedge-a');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(within(toggle.parentElement as HTMLElement).getByText('挂单中')).toBeInTheDocument();
    // 成交过的腿没有这个开关
    expect(screen.queryByTestId('counterfactual-leg-filled-toggle-main')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(within(toggle.parentElement as HTMLElement).queryByText('挂单中')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    });
    await waitFor(() => expect(runCustomCounterfactualMock).toHaveBeenCalledTimes(2), { timeout: WAIT });
    const draft = screen.getByTestId('counterfactual-draft-panel');
    // 空单 95 × 5 按持有算：01:00 那根高点 130 上 300 − 175 = 125；开平价相同，只多一笔平仓费 5 × 95 × 0.05%
    await waitFor(() => expect(metricValue(draft, '峰值浮盈')).toBe('125.00 USDT'), { timeout: WAIT });
    expect(metricValue(draft, '已实现 P&L')).toBe('99.76 USDT');
    expect(within(draft).getByText('-0.24 USDT')).toBeInTheDocument();
    expect(within(draft).getByText('改 初始对冲 A：成交 未成交 → 已成交')).toBeInTheDocument();
    // 止损线没动
    expect(metricValue(draft, '最大预期亏损')).toBe(metricValue(screen.getByText('盈亏概览').parentElement as HTMLElement, '最大预期亏损'));
  }, PAGE_TEST_TIMEOUT_MS);

  it('进行中的战役：原样重跑与上方逐项相同，运行时记下「未了结」', async () => {
    state.fixtureId = 'sim-active-all-closed';
    renderPage();
    const { campaignPanel, draft } = await runCopy(await mainExitShown('sim-active-all-closed'));
    expect(panelValues(draft)).toEqual(panelValues(campaignPanel));
    expect(runCustomCounterfactualMock.mock.calls[0][1]).toMatchObject({ actual_resolved: false });
  }, PAGE_TEST_TIMEOUT_MS);

  it('没有腿的加仓与主力同一时刻平掉：不列成「先平」', async () => {
    state.fixtureId = 'sim-merged-add-no-leg';
    renderPage();
    await runCopy(await mainExitShown('sim-merged-add-no-leg'));
    expect(screen.queryByTestId('counterfactual-leg-cuts-main')).not.toBeInTheDocument();
  }, PAGE_TEST_TIMEOUT_MS);
});

describe('JournalCampaignDetailPage：口径统一之前保存的分支', () => {
  /** 老行：腿上没有 actual / filled / 结算方式，挂单的平仓时间是保存那一刻 K 线窗口的末根，结果是毛盈亏、没有风险锚字段。 */
  async function legacyRow(fixtureId: string, windowEnd: string): Promise<CampaignCounterfactual> {
    const { parityFixture } = await import('@/test/fixtures/counterfactualParityFixtures');
    const engine = await import('@/lib/campaignSimulationEngine');
    const fx = parityFixture(fixtureId);
    const base = engine.buildActualSimulationParams(fx.campaign, fx.legs, fx.tradeRecords)!;
    const legs = engine.buildManualLegs(base, fx.legs, fx.klines, fx.tradeRecords, fx.corrections, { campaign: fx.campaign })
      .map(leg => {
        const { actual: _actual, filled, settlement_mode: _mode, contract_size_usd: _face, ...rest } = leg;
        return (filled === false ? { ...rest, close_time: windowEnd } : rest) as CampaignCounterfactualManualLeg;
      });
    const params: CampaignCounterfactualParams = { ...base, manual_legs: legs };
    const {
      fees_total: _fees,
      open_fees_total: _openFees,
      initial_expected_max_loss: _l,
      initial_main_exposure_notional: _n,
      expected_max_drawdown_pct: _d,
      main_leverage: _lev,
      ...result
    } = engine.simulateManualLegScenario(params, fx.klines);
    return {
      id: 'legacy-1',
      user_id: 'user-1',
      campaign_id: fx.campaign.id,
      label: '老分支',
      branch_kind: 'custom_what_if',
      source_deduction_id: null,
      params,
      result,
      created_at: '2026-01-01T05:00:00.000Z',
    };
  }

  it('没动过的挂单：换了 K 线周期不印假代价；载回副本重跑与上方同一峰值，挂单开关停在「未成交」', async () => {
    state.fixtureId = 'unfilled-hedge';
    state.savedRows = [await legacyRow('unfilled-hedge', '2026-01-01T03:45:00.000Z')];
    state.widerInterval = '15m';
    renderPage();
    await screen.findByTestId('counterfactual-saved-panel', {}, { timeout: WAIT });
    await screen.findByText('偏离代价明细（手动调整 vs 原始）', {}, { timeout: WAIT });
    fireEvent.click(screen.getByRole('button', { name: /偏离代价明细/ }));
    expect(screen.getByText('本次手动调整与原始战役无差异（合计 0）')).toBeInTheDocument();

    // 换一个周期：K 线窗口的末根变了，没动过的挂单仍不算改动
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: '15m' })[0]);
    });
    await waitFor(() => expect(screen.getByText('本次手动调整与原始战役无差异（合计 0）')).toBeInTheDocument(), { timeout: WAIT });

    fireEvent.click(screen.getByTestId('counterfactual-load-legs'));
    await waitFor(() => expect(screen.getByTestId('counterfactual-leg-filled-toggle-hedge-a')).toHaveAttribute('aria-pressed', 'false'), { timeout: WAIT });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    });
    const draft = await screen.findByTestId('counterfactual-draft-panel', {}, { timeout: WAIT });
    const campaignPanel = screen.getByText('盈亏概览').parentElement as HTMLElement;
    expect(metricValue(draft, '峰值浮盈')).toBe(metricValue(campaignPanel, '峰值浮盈'));
    expect(metricValue(draft, '峰值浮盈')).toBe('300.00 USDT');
    expect(metricValue(draft, '已实现 P&L')).toBe('100.00 USDT');
    expect(within(draft).getByText('+0.00 USDT')).toBeInTheDocument();
    expect(within(draft).getByText('与原始 Legs 无差异')).toBeInTheDocument();
  }, PAGE_TEST_TIMEOUT_MS);

  it('进行中的战役：分支记着「未改动」，K 线窗口之后长了也不把未平仓腿的兜底平仓时间读成改动；载回重跑同样无差异、不算已了结', async () => {
    const { buildCounterfactualChangeSummary } = await import('@/lib/counterfactualChangeSummary');
    state.fixtureId = 'sim-active-open-main';
    const row = await legacyRow('sim-active-open-main', '2026-01-01T03:00:00.000Z');
    const savedLegs = row.params.manual_legs ?? [];
    // 保存时主力的兜底平仓时间是当时编辑器窗口的末根（03:00），运行时窗口已经多了半根（03:30）
    expect(savedLegs.find(leg => leg.id === 'main')?.close_time).toBe('2026-01-01T03:00:00.000Z');
    state.savedRows = [{
      ...row,
      params: {
        ...row.params,
        change_summary: buildCounterfactualChangeSummary(savedLegs, savedLegs, savedLegs),
        run_context: {
          interval: '30m',
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-01-01T03:30:00.000Z',
          kline_count: 8,
          ran_at: '2026-01-01T03:40:00.000Z',
        },
      },
    }];
    // 现在打开：窗口末根是 04:00，基线里主力的兜底平仓时间跟着是 04:00
    state.widerFromStart = true;
    renderPage();
    await screen.findByTestId('counterfactual-saved-panel', {}, { timeout: WAIT });
    await screen.findByText('偏离代价明细（手动调整 vs 原始）', {}, { timeout: WAIT });
    fireEvent.click(screen.getByRole('button', { name: /偏离代价明细/ }));
    await waitFor(() => expect(screen.getByText('本次手动调整与原始战役无差异（合计 0）')).toBeInTheDocument(), { timeout: WAIT });
    await screen.findByRole('button', { name: '一键运行' }, { timeout: WAIT });

    fireEvent.click(screen.getByTestId('counterfactual-load-legs'));
    await act(async () => { await Promise.resolve(); });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    });
    const draft = await screen.findByTestId('counterfactual-draft-panel', {}, { timeout: WAIT });
    const sent = runCustomCounterfactualMock.mock.calls[0][1] as CampaignCounterfactualParams;
    expect(sent.manual_legs?.find(leg => leg.id === 'main')?.close_time).toBe('2026-01-01T04:00:00.000Z');
    expect(within(draft).getByText('与原始 Legs 无差异')).toBeInTheDocument();
    expect(within(draft).getByText('+0.00 USDT')).toBeInTheDocument();
  }, PAGE_TEST_TIMEOUT_MS);

  it('主力与镜像并仓：副本在平仓价下方列出先平的那一刀', async () => {
    state.fixtureId = 'sim-merged-mirror';
    renderPage();
    await runCopy(await mainExitShown('sim-merged-mirror'));
    expect(screen.getByTestId('counterfactual-leg-cuts-main').textContent).toContain('另有 1 刀先平');
    expect(screen.getByTestId('counterfactual-leg-cuts-mirror').textContent).toContain('另有 1 刀先平');
  }, PAGE_TEST_TIMEOUT_MS);
});
