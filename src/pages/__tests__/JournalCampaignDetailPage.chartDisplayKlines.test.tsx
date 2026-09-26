/**
 * 【用户要求】交易战役原始盘面默认 5 分钟线、2.1 倍。
 * 【用户已定】计算与显示分开：峰值浮盈、决策准确度、反事实副本与一键运行只读「计算用 K 线」
 * （改版前默认打开时的那一份：基准窗口 + 自动周期），盘面只管显示。
 *
 * 整页真跑：真实 useCampaignKlines / useReplayKlines，fetch 换成本地合成 fapi 数据的垫片（不发真实请求），
 * 合成 K 线的影线按周期放大——哪一处计算偷读了盘面那一份，峰值浮盈就会变，这里就会翻红。
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useNavigate, type NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { KlineData } from '@/hooks/useBinanceData';
import { buildCampaignKlineTimeWindow } from '@/hooks/useCampaignKlines';
import { computeDecisionAccuracy } from '@/lib/campaignAnalysis';
import { buildCampaignChartContentTimeSpan, pickCampaignOverviewInterval } from '@/lib/campaignChartContentSpan';
import { buildManualLegs, simulateManualLegScenario } from '@/lib/campaignSimulationEngine';
import { listCounterfactuals, runCustomCounterfactual } from '@/lib/journalApi';
import type { CampaignCounterfactual } from '@/types/journal';
import {
  SYNTH_INTERVAL_MS,
  countCallsByInterval,
  createSynthFapiFetch,
  synthCampaign,
  synthKlineRange,
  type SynthCampaignId,
} from '@/test/fixtures/syntheticCampaignKlines';
import JournalCampaignDetailPage from '../JournalCampaignDetailPage';

const { probeProps } = vi.hoisted(() => ({
  probeProps: new WeakMap<Element, { klines: KlineData[]; intervalMs: number }>(),
}));

vi.mock('@/lib/campaignAnalysis', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignAnalysis')>();
  return { ...actual, computeDecisionAccuracy: vi.fn(actual.computeDecisionAccuracy) };
});
vi.mock('@/lib/campaignSimulationEngine', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignSimulationEngine')>();
  return { ...actual, buildManualLegs: vi.fn(actual.buildManualLegs) };
});
vi.mock('@/lib/campaignLegExecution', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/campaignLegExecution')>();
  return { ...actual, fetchLegExitPriceCorrections: vi.fn(async () => ({})) };
});
vi.mock('@/lib/campaignListCache', () => ({ waitForCampaignListHeal: vi.fn(async () => undefined) }));
vi.mock('@/lib/journalApi', async () => {
  const fixtures = await import('@/test/fixtures/syntheticCampaignKlines');
  const engine = await import('@/lib/campaignSimulationEngine');
  const detail = async (id: string) => ({
    ...fixtures.synthCampaign(id as SynthCampaignId),
    pendingOrders: [],
    reverseHedgeOrders: [],
    foreignLiveOrders: [],
    legExitPriceCorrections: {},
    timelineDiagnostics: {
      mode: 'heuristic' as const, timelineIds: [], anchorTimelineIds: [], unstampedAnchors: 0,
      missingAnchorNodes: [], verdicts: {}, disagreements: [],
    },
  });
  return {
    readUserLocalSnapshot: () => ({ tradeHistory: [], ordersMap: {}, cancelledOrders: [], filledOrders: [] }),
    getCampaignFullData: vi.fn(async (id: string) => detail(id)),
    listAllCampaigns: vi.fn(async () => [fixtures.synthCampaign('tut-1h').campaign]),
    listVisibleCampaigns: vi.fn(async () => []),
    listCounterfactuals: vi.fn(async () => []),
    listCampaignComments: vi.fn(async () => []),
    hasMutualFollow: vi.fn(async () => true),
    runCustomCounterfactual: vi.fn(async (_id: string, params: Parameters<typeof engine.simulateManualLegScenario>[0], klines: KlineData[]) => ({
      params,
      result: engine.simulateManualLegScenario(params, klines),
    })),
    createCounterfactual: vi.fn(),
    deleteCounterfactual: vi.fn(async () => undefined),
    saveCampaignDeviationNotes: vi.fn(async () => undefined),
    syncCampaignDeviationRulesToChecklist: vi.fn(async () => ({ created: 0, drafts: 0 })),
  };
});
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'desk@example.com' }, profile: { display_name: '主账户' } }),
}));
vi.mock('@/contexts/TradingContext', () => ({
  useTradingContext: () => ({
    getEffectiveTime: () => Date.parse('2026-02-01T00:00:00.000Z'),
    balance: 50_000,
    positionsMap: {},
    priceMap: {},
  }),
}));
vi.mock('@/lib/emotionDiaryApi', () => ({ getDecisionEmotionDiaryByDate: vi.fn(async () => null) }));
// 盘面探针：记下收到的 K 线数组（按引用）与周期，原始盘面与反事实盘面各一个
vi.mock('@/components/journal/ReplayKlineChart', () => ({
  ReplayKlineChart: (props: { klines: KlineData[]; intervalMs: number }) => (
    <div
      data-testid="kline-probe"
      data-interval-ms={props.intervalMs}
      data-count={props.klines.length}
      ref={element => { if (element) probeProps.set(element, { klines: props.klines, intervalMs: props.intervalMs }); }}
    />
  ),
}));
vi.mock('@/components/journal/CampaignLegsList', () => ({ CampaignLegsList: () => null }));
vi.mock('@/components/journal/EndCampaignDialog', () => ({ EndCampaignDialog: () => null }));

/** 【硬性规则】新写的整页测试用 15 秒超时。 */
const PAGE_TEST_TIMEOUT_MS = 15_000;
const WAIT = 12_000;

let synth = createSynthFapiFetch();
let navigateRef: NavigateFunction | null = null;

function NavigateProbe() {
  const navigate = useNavigate();
  useEffect(() => { navigateRef = navigate; }, [navigate]);
  return null;
}

function renderPage(id: SynthCampaignId) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[`/journal/campaigns/${id}`]}>
        <NavigateProbe />
        <Routes>
          <Route path="/journal/campaigns/:id" element={<JournalCampaignDetailPage />} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

/**
 * 改版前「默认打开、没手动改周期」时喂给全部计算的那一份 K 线：基准窗口 + 6000 根拉取预算的自动周期。
 * branch：详情页选中的已保存反事实分支（改版前就进内容区间，越出 Legs 跨度时撑宽基准窗口）。
 */
function legacyDefaultKlines(id: SynthCampaignId, branch: CampaignCounterfactual | null = null) {
  const { campaign, legs, tradeRecords } = synthCampaign(id);
  const span = buildCampaignChartContentTimeSpan(campaign, legs, tradeRecords, [], branch);
  const base = buildCampaignKlineTimeWindow(Date.parse(campaign.opened_at), Date.parse(campaign.closed_at!), span.startMs, span.endMs);
  const interval = pickCampaignOverviewInterval({ startMs: base.fromTime, endMs: base.toTime }, 6_000);
  return { interval, base, klines: synthKlineRange(interval, base.fromTime, base.toTime) };
}

function mainProbe() {
  return within(screen.getByTestId('campaign-chart-frame')).queryByTestId('kline-probe');
}

async function waitMainProbe(interval: string) {
  await waitFor(() => expect(mainProbe()).toHaveAttribute('data-interval-ms', String(SYNTH_INTERVAL_MS[interval])), { timeout: WAIT });
  return mainProbe()!;
}

/** 等计算用 K 线到位：computeDecisionAccuracy 收到非空 K 线。 */
async function waitComputeLoaded() {
  await waitFor(() => expect(accuracyCallsWithKlines().length).toBeGreaterThan(0), { timeout: WAIT });
}

function accuracyCallsWithKlines() {
  const mock = vi.mocked(computeDecisionAccuracy).mock;
  return mock.calls.map((args, index) => ({ args, result: mock.results[index]?.value })).filter(call => call.args[3].length > 0);
}

function metricValue(label: string) {
  const panel = screen.getByText('盈亏概览').parentElement as HTMLElement;
  const row = within(panel).getByRole('button', { name: `${label}说明` }).closest('div.flex');
  return row?.querySelector('span.font-mono')?.textContent ?? null;
}

function intervalGroup() {
  return screen.getByRole('group', { name: '盘面 K 线周期' });
}

function counterfactualProbe() {
  return within(screen.getByTestId('counterfactual-chart-section')).queryByTestId('kline-probe');
}

async function waitCounterfactualProbe(interval: string) {
  await waitFor(() => expect(counterfactualProbe()).toHaveAttribute('data-interval-ms', String(SYNTH_INTERVAL_MS[interval])), { timeout: WAIT });
  return counterfactualProbe()!;
}

function counterfactualIntervalGroup() {
  return screen.getByRole('group', { name: '反事实盘面 K 线周期' });
}

/** 计算用那一份只在打开时拉过一次：首页请求（startTime = 基准窗口左端、计算用周期）恰好一个。 */
function computeFirstPageRequests(id: SynthCampaignId) {
  const { interval, base } = legacyDefaultKlines(id);
  return synth.calls.filter(call => call.interval === interval && call.startTime === base.fromTime).length;
}

/**
 * 对照：所有带 K 线的 computeDecisionAccuracy 调用都用改版前默认那一份（逐根相同、同一个数组），
 * 结果与拿那一份重算逐位相同；「峰值浮盈」一格也还是打开时的字。
 */
async function expectComputationsUnchanged(id: SynthCampaignId, peakAtOpen: string | null) {
  const actual = await vi.importActual<typeof import('@/lib/campaignAnalysis')>('@/lib/campaignAnalysis');
  const { klines: reference } = legacyDefaultKlines(id);
  const calls = accuracyCallsWithKlines();
  expect(new Set(calls.map(call => call.args[3])).size).toBe(1);
  const [campaignArg, legsArg, recordsArg, klinesArg, ...rest] = calls[calls.length - 1].args;
  expect(klinesArg).toEqual(reference);
  expect(calls[calls.length - 1].result).toEqual(actual.computeDecisionAccuracy(campaignArg, legsArg, recordsArg, reference, ...rest));
  expect(metricValue('峰值浮盈')).toBe(peakAtOpen);
  expect(computeFirstPageRequests(id)).toBe(1);
}

beforeEach(() => {
  synth = createSynthFapiFetch();
  vi.stubGlobal('fetch', vi.fn(synth.fetchImpl));
  vi.mocked(computeDecisionAccuracy).mockClear();
  vi.mocked(buildManualLegs).mockClear();
  vi.mocked(runCustomCounterfactual).mockClear();
  window.localStorage.clear();
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
});
afterEach(() => {
  vi.unstubAllGlobals();
  navigateRef = null;
});

describe('原始盘面默认 5 分钟线、2.1 倍；显示与计算同周期时只拉一次', () => {
  it.each([
    // [战役, 默认显示周期, 计算用周期, 请求次数（按周期）]
    ['tut-1h', '5m', '1m', { '1m': 3, '5m': 1 }],
    ['tut-5h', '5m', '5m', { '5m': 3 }],
    ['tut-8d', '1h', '1h', { '1h': 7 }],
  ] as const)('%s：盘面 %s、计算 %s，请求 %o', async (id, displayInterval, computeInterval, counts) => {
    renderPage(id);
    const probe = await waitMainProbe(displayInterval);
    await waitComputeLoaded();
    expect(legacyDefaultKlines(id).interval).toBe(computeInterval);

    // 2.1 倍按下；新档 2.1x / 3.1x 在，旧的 2x / 3x 不在
    const pressed = screen.getByRole('button', { name: '显示 2.1 倍战役时间范围' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(pressed).toHaveTextContent('2.1x');
    expect(screen.getByRole('button', { name: '显示 3.1 倍战役时间范围' })).toHaveTextContent('3.1x');
    expect(screen.queryByRole('button', { name: '显示 2 倍战役时间范围' })).toBeNull();
    expect(screen.queryByRole('button', { name: '显示 3 倍战役时间范围' })).toBeNull();

    // 工具栏选中态 = 实际显示周期；悬停提示写明默认规则
    for (const item of ['1m', '5m', '15m', '1h']) {
      const button = within(intervalGroup()).getByRole('button', { name: item });
      expect(button).toHaveAttribute('aria-pressed', String(item === displayInterval));
      expect(button.getAttribute('title')).toContain('默认 5 分钟线，放不下时自动放宽');
    }
    if (displayInterval !== '5m') {
      expect(within(intervalGroup()).getByRole('button', { name: displayInterval }).getAttribute('title'))
        .toContain(`当前视窗放不下 5 分钟线，已自动放宽到 1 小时`);
    }

    // 请求次数：同周期同窗口时只有一份（计算那一份的分页），两边共用同一个数组
    expect(countCallsByInterval(synth.calls)).toEqual(counts);
    const computeKlines = accuracyCallsWithKlines().at(-1)!.args[3];
    if (displayInterval === computeInterval) expect(probeProps.get(probe)!.klines).toBe(computeKlines);
    else expect(probeProps.get(probe)!.klines).not.toBe(computeKlines);
    // 反事实盘面画显示用 K 线（它自己的倍数默认 1.1，不跟随原始盘面的 2.1）
    const editorProbe = within(screen.getByTestId('counterfactual-chart-section')).getByTestId('kline-probe');
    expect(probeProps.get(editorProbe)!.klines).toBe(probeProps.get(probe)!.klines);
    expect(screen.getByRole('button', { name: '反事实盘面显示 1.1 倍战役时间范围' })).toHaveAttribute('aria-pressed', 'true');
  }, PAGE_TEST_TIMEOUT_MS);

  it('手动点回与计算相同的周期：不再发请求，盘面直接用计算那一份', async () => {
    renderPage('tut-1h');
    await waitMainProbe('5m');
    await waitComputeLoaded();
    const before = synth.calls.length;
    fireEvent.click(within(intervalGroup()).getByRole('button', { name: '1m' }));
    const probe = await waitMainProbe('1m');
    expect(synth.calls.length).toBe(before);
    expect(probeProps.get(probe)!.klines).toBe(accuracyCallsWithKlines().at(-1)!.args[3]);
    expect(within(intervalGroup()).getByRole('button', { name: '1m' })).toHaveAttribute('aria-pressed', 'true');
  }, PAGE_TEST_TIMEOUT_MS);

  it('没手动选过时，点当前已选中的周期不算手动：之后切 51x 仍自动放宽；点别的周期才按手动', async () => {
    renderPage('tut-5h');
    await waitMainProbe('5m');
    // 原始盘面工具栏与反事实盘面的周期按钮各点一次已选中的 5m：画面不变，也不关掉自动放宽
    fireEvent.click(within(intervalGroup()).getByRole('button', { name: '5m' }));
    fireEvent.click(within(screen.getByRole('group', { name: '反事实盘面 K 线周期' })).getByRole('button', { name: '5m' }));
    fireEvent.click(screen.getByRole('button', { name: '显示 51 倍战役时间范围' }));
    await waitMainProbe('15m');
    expect(within(intervalGroup()).getByRole('button', { name: '15m' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(intervalGroup()).getByRole('button', { name: '15m' }).getAttribute('title'))
      .toContain('当前视窗放不下 5 分钟线，已自动放宽到 15 分钟');
    // 放宽之后再点 5m：这回是真的手动选择，按手动显示
    fireEvent.click(within(intervalGroup()).getByRole('button', { name: '5m' }));
    await waitMainProbe('5m');
    expect(within(intervalGroup()).getByRole('button', { name: '5m' })).toHaveAttribute('aria-pressed', 'true');
  }, PAGE_TEST_TIMEOUT_MS);

  it('换战役时倍数回到 2.1', async () => {
    renderPage('tut-1h');
    await waitMainProbe('5m');
    fireEvent.click(screen.getByRole('button', { name: '显示 5 倍战役时间范围' }));
    expect(screen.getByRole('button', { name: '显示 5 倍战役时间范围' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { navigateRef!('/journal/campaigns/tut-5h'); });
    await waitFor(() => expect(screen.getByText('TUTUSDT 约 5 小时')).toBeInTheDocument(), { timeout: WAIT });
    expect(screen.getByRole('button', { name: '显示 2.1 倍战役时间范围' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '显示 5 倍战役时间范围' })).toHaveAttribute('aria-pressed', 'false');
  }, PAGE_TEST_TIMEOUT_MS);
});

describe('反事实盘面按自己的视窗选周期，不被原始盘面的倍数牵着走', () => {
  it('5 小时战役：原始盘面切 51x 放宽到 15m，反事实盘面仍是 1.1x、5m，直接用计算那一份', async () => {
    renderPage('tut-5h');
    await waitMainProbe('5m');
    await waitComputeLoaded();
    fireEvent.click(screen.getByRole('button', { name: '显示 51 倍战役时间范围' }));
    await waitMainProbe('15m');
    const cf = await waitCounterfactualProbe('5m');
    expect(probeProps.get(cf)!.klines).toBe(accuracyCallsWithKlines().at(-1)!.args[3]);
    expect(screen.getByRole('button', { name: '反事实盘面显示 1.1 倍战役时间范围' })).toHaveAttribute('aria-pressed', 'true');
    const cfFive = within(counterfactualIntervalGroup()).getByRole('button', { name: '5m' });
    expect(cfFive).toHaveAttribute('aria-pressed', 'true');
    expect(cfFive.getAttribute('title')).not.toContain('已自动放宽');
    expect(within(intervalGroup()).getByRole('button', { name: '15m' })).toHaveAttribute('aria-pressed', 'true');
    // 5m 只有计算那一份（3 页）；15m 只有原始盘面那一份
    expect(countCallsByInterval(synth.calls)['5m']).toBe(3);
    expect(synth.calls.filter(call => call.interval === '15m' && call.startTime === legacyDefaultKlines('tut-5h').base.fromTime)).toHaveLength(1);
  }, PAGE_TEST_TIMEOUT_MS);

  it('5 小时战役：反事实盘面自己拉到 51x 才放宽到 15m（原始盘面不动）；原始盘面随后也到 15m 时共用那一份、不重拉', async () => {
    renderPage('tut-5h');
    await waitMainProbe('5m');
    await waitComputeLoaded();
    const { base } = legacyDefaultKlines('tut-5h');
    fireEvent.click(screen.getByRole('button', { name: '反事实盘面显示 51 倍战役时间范围' }));
    const cf = await waitCounterfactualProbe('15m');
    expect(probeProps.get(cf)!.klines).toEqual(synthKlineRange('15m', base.fromTime, base.toTime));
    expect(mainProbe()).toHaveAttribute('data-interval-ms', String(SYNTH_INTERVAL_MS['5m']));
    expect(within(intervalGroup()).getByRole('button', { name: '5m' })).toHaveAttribute('aria-pressed', 'true');
    const cfFifteen = within(counterfactualIntervalGroup()).getByRole('button', { name: '15m' });
    expect(cfFifteen).toHaveAttribute('aria-pressed', 'true');
    expect(cfFifteen.getAttribute('title')).toContain('当前视窗放不下 5 分钟线，已自动放宽到 15 分钟');
    const fifteenCalls = () => synth.calls.filter(call => call.interval === '15m').length;
    expect(fifteenCalls()).toBe(1);

    // 点反事实那组里自动选中的 15m：没手动选过，不算手动，原始盘面仍是 5m
    fireEvent.click(cfFifteen);
    expect(within(intervalGroup()).getByRole('button', { name: '5m' })).toHaveAttribute('aria-pressed', 'true');
    expect(mainProbe()).toHaveAttribute('data-interval-ms', String(SYNTH_INTERVAL_MS['5m']));

    // 原始盘面也切到 51x → 15m：两块共用同一个数组，反事实盘面不重载，也不再多拉
    fireEvent.click(screen.getByRole('button', { name: '显示 51 倍战役时间范围' }));
    const main = await waitMainProbe('15m');
    expect(probeProps.get(main)!.klines).toBe(probeProps.get(counterfactualProbe()!)!.klines);
    expect(counterfactualProbe()).toBe(cf);
    expect(fifteenCalls()).toBe(1);

    // 反事实盘面回到 1.1x（5m = 计算那一份）：原始盘面接着用那份 15m，不重拉
    fireEvent.click(screen.getByRole('button', { name: '反事实盘面显示 1.1 倍战役时间范围' }));
    const cfBack = await waitCounterfactualProbe('5m');
    expect(probeProps.get(cfBack)!.klines).toBe(accuracyCallsWithKlines().at(-1)!.args[3]);
    expect(mainProbe()).toBe(main);
    expect(fifteenCalls()).toBe(1);
  }, PAGE_TEST_TIMEOUT_MS);

  it('手动选的周期两块盘面共用：在反事实那组点 1m，原始盘面也按 1m', async () => {
    renderPage('tut-5h');
    await waitMainProbe('5m');
    fireEvent.click(within(counterfactualIntervalGroup()).getByRole('button', { name: '1m' }));
    await waitMainProbe('1m');
    await waitCounterfactualProbe('1m');
    expect(probeProps.get(counterfactualProbe()!)!.klines).toBe(probeProps.get(mainProbe()!)!.klines);
  }, PAGE_TEST_TIMEOUT_MS);

  it('换战役时反事实盘面倍数回到 1.1', async () => {
    renderPage('tut-5h');
    await waitMainProbe('5m');
    fireEvent.click(screen.getByRole('button', { name: '反事实盘面显示 51 倍战役时间范围' }));
    await waitCounterfactualProbe('15m');
    await act(async () => { navigateRef!('/journal/campaigns/tut-1h'); });
    await waitFor(() => expect(screen.getByText('TUTUSDT 约 1 小时')).toBeInTheDocument(), { timeout: WAIT });
    expect(screen.getByRole('button', { name: '反事实盘面显示 1.1 倍战役时间范围' })).toHaveAttribute('aria-pressed', 'true');
    await waitCounterfactualProbe('5m');
  }, PAGE_TEST_TIMEOUT_MS);
});

describe('放宽边界两侧来回切倍数：已拉到手的那份原样接着用，不重拉、不闪加载', () => {
  const fifteenCalls = () => synth.calls.filter(call => call.interval === '15m').length;

  it('5 小时战役：原始盘面 21x → 11x → 21x → 11x → 21x，15m 只拉一次，回到 21x 当场就是那份 15m', async () => {
    renderPage('tut-5h');
    await waitMainProbe('5m');
    await waitComputeLoaded();
    fireEvent.click(screen.getByRole('button', { name: '显示 21 倍战役时间范围' }));
    const first = await waitMainProbe('15m');
    const fifteen = probeProps.get(first)!.klines;
    const pages = fifteenCalls();
    expect(pages).toBeGreaterThan(0);

    for (let round = 0; round < 2; round++) {
      // 11x 放得下 5 分钟线，盘面回到计算那一份，另拉的槽空出来
      fireEvent.click(screen.getByRole('button', { name: '显示 11 倍战役时间范围' }));
      await waitMainProbe('5m');
      fireEvent.click(screen.getByRole('button', { name: '显示 21 倍战役时间范围' }));
      // 点下去这一刻（act 已把 effect 跑完）就是现成那份 15m，不经过「加载 K 线…」
      expect(screen.getByTestId('campaign-chart-frame')).not.toHaveTextContent('加载 K 线…');
      const probe = mainProbe();
      expect(probe).toHaveAttribute('data-interval-ms', String(SYNTH_INTERVAL_MS['15m']));
      expect(probeProps.get(probe!)!.klines).toBe(fifteen);
      // 之后也不再重挂、不再发请求
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
      expect(mainProbe()).toBe(probe);
      expect(fifteenCalls()).toBe(pages);
    }
  }, PAGE_TEST_TIMEOUT_MS);

  it('5 小时战役：反事实盘面 51x → 1.1x → 51x，15m 只拉一次，回到 51x 当场就是那份 15m', async () => {
    renderPage('tut-5h');
    await waitMainProbe('5m');
    await waitComputeLoaded();
    fireEvent.click(screen.getByRole('button', { name: '反事实盘面显示 51 倍战役时间范围' }));
    const first = await waitCounterfactualProbe('15m');
    const fifteen = probeProps.get(first)!.klines;
    const pages = fifteenCalls();
    expect(pages).toBeGreaterThan(0);

    for (let round = 0; round < 2; round++) {
      fireEvent.click(screen.getByRole('button', { name: '反事实盘面显示 1.1 倍战役时间范围' }));
      await waitCounterfactualProbe('5m');
      fireEvent.click(screen.getByRole('button', { name: '反事实盘面显示 51 倍战役时间范围' }));
      expect(screen.getByTestId('counterfactual-chart-section')).not.toHaveTextContent('加载 K 线…');
      const probe = counterfactualProbe();
      expect(probe).toHaveAttribute('data-interval-ms', String(SYNTH_INTERVAL_MS['15m']));
      expect(probeProps.get(probe!)!.klines).toBe(fifteen);
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
      expect(counterfactualProbe()).toBe(probe);
      expect(fifteenCalls()).toBe(pages);
    }
    // 原始盘面一直是 2.1x / 5m（计算那一份），没被牵动
    expect(mainProbe()).toHaveAttribute('data-interval-ms', String(SYNTH_INTERVAL_MS['5m']));
  }, PAGE_TEST_TIMEOUT_MS);
});

describe('悬停提示说对放宽的原因', () => {
  it('12 小时战役：2.1 倍视窗放得下 5 分钟线，是整段拉取超过 6000 根才放宽到 15 分钟', async () => {
    renderPage('tut-12h');
    await waitMainProbe('15m');
    const title = within(intervalGroup()).getByRole('button', { name: '15m' }).getAttribute('title');
    expect(title).toContain('整段拉取范围按 5 分钟线超过 6000 根，已自动放宽到 15 分钟');
    expect(title).not.toContain('当前视窗放不下');
    // 计算用周期同是 15m：只拉一份
    expect(countCallsByInterval(synth.calls)).toEqual({ '15m': 2 });
  }, PAGE_TEST_TIMEOUT_MS);
});

describe('单张 PNG：计算用 K 线没到之前不让导出（免得峰值浮盈写成「加载中…」）', () => {
  it('盘面已画好、计算用 K 线还在路上：PNG 按钮停用，到位后恢复', async () => {
    synth.holdIntervals.add('1m');
    renderPage('tut-1h');
    await waitMainProbe('5m');
    const png = screen.getByRole('button', { name: 'PNG' });
    expect(png).toBeDisabled();
    synth.releaseHeld();
    await waitComputeLoaded();
    await waitFor(() => expect(screen.getByRole('button', { name: 'PNG' })).toBeEnabled(), { timeout: WAIT });
  }, PAGE_TEST_TIMEOUT_MS);
});

describe('计算与显示分开：任意显示周期、任意倍数下，读数与改版前默认打开时逐位相同', () => {
  it.each([
    ['tut-1h', ['1m', '15m', '1h', '5m']],
    ['tut-5h', ['1m', '15m', '1h', '5m']],
    ['tut-8d', ['15m', '5m', '1h']],
  ] as const)('%s：切换显示周期 %o', async (id, intervals) => {
    renderPage(id);
    await waitComputeLoaded();
    await waitFor(() => expect(mainProbe()).not.toBeNull(), { timeout: WAIT });
    const peakAtOpen = metricValue('峰值浮盈');
    await expectComputationsUnchanged(id, peakAtOpen);
    const legsTableAtOpen = screen.getByTestId('counterfactual-legs-table').textContent;

    // 夹具确实能抓到泄漏：换成盘面那一份（1 小时线）重算，峰值浮盈就不是这个数
    const actual = await vi.importActual<typeof import('@/lib/campaignAnalysis')>('@/lib/campaignAnalysis');
    const { base, klines: reference } = legacyDefaultKlines(id);
    const args = accuracyCallsWithKlines().at(-1)!.args;
    const leaked = actual.computeDecisionAccuracy(args[0], args[1], args[2], synthKlineRange(id === 'tut-8d' ? '15m' : '1h', base.fromTime, base.toTime), ...args.slice(4) as []);
    expect(leaked.campaign_max_profit_real).not.toBe(actual.computeDecisionAccuracy(args[0], args[1], args[2], reference, ...args.slice(4) as []).campaign_max_profit_real);

    for (const interval of intervals) {
      fireEvent.click(within(intervalGroup()).getByRole('button', { name: interval }));
      await waitMainProbe(interval);
      await expectComputationsUnchanged(id, peakAtOpen);
      // 「还原 Legs」重建副本基线：仍按计算用那一份
      fireEvent.click(screen.getByRole('button', { name: /还原 Legs/ }));
      const manualCalls = vi.mocked(buildManualLegs).mock.calls.filter(call => call[2].length > 0);
      expect(manualCalls.at(-1)![2]).toEqual(reference);
      expect(screen.getByTestId('counterfactual-legs-table').textContent).toBe(legsTableAtOpen);
    }
  }, PAGE_TEST_TIMEOUT_MS);

  // 倍数与预设拆成两条：合在一条里全量负载下会超过 15 秒
  it.each(['tut-1h', 'tut-5h', 'tut-8d'] as const)('%s：切换倍数，读数不变', async id => {
    renderPage(id);
    await waitComputeLoaded();
    await waitFor(() => expect(mainProbe()).not.toBeNull(), { timeout: WAIT });
    const peakAtOpen = metricValue('峰值浮盈');
    for (const multiplier of [1.1, 3.1, 5, 21, 51]) {
      fireEvent.click(screen.getByRole('button', { name: `显示 ${multiplier} 倍战役时间范围` }));
      await waitFor(() => expect(mainProbe()).not.toBeNull(), { timeout: WAIT });
      await expectComputationsUnchanged(id, peakAtOpen);
    }
  }, PAGE_TEST_TIMEOUT_MS);

  it.each(['tut-1h', 'tut-5h', 'tut-8d'] as const)('%s：切到时间预设，读数不变；预设下也能一键运行、用的是计算那一份', async id => {
    renderPage(id);
    await waitComputeLoaded();
    await waitFor(() => expect(mainProbe()).not.toBeNull(), { timeout: WAIT });
    const peakAtOpen = metricValue('峰值浮盈');
    const legsBefore = vi.mocked(buildManualLegs).mock.calls.filter(call => call[2].length > 0);
    const { interval: computeInterval, klines: reference } = legacyDefaultKlines(id);
    fireEvent.click(screen.getByRole('button', { name: '显示 1周 K 线范围' }));
    await waitFor(() => expect(mainProbe()).not.toBeNull(), { timeout: WAIT });
    await expectComputationsUnchanged(id, peakAtOpen);
    for (const call of legsBefore) expect(call[2]).toEqual(reference);

    // 改版前绝对预设下禁止运行（K 线跟着预设变）；分开之后直接跑，用的是计算那一份与计算周期
    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    await waitFor(() => expect(runCustomCounterfactual).toHaveBeenCalledTimes(1), { timeout: WAIT });
    const [, , runKlines, runInterval] = vi.mocked(runCustomCounterfactual).mock.calls[0];
    expect(runKlines).toEqual(reference);
    expect(runInterval).toBe(computeInterval);
  }, PAGE_TEST_TIMEOUT_MS);
});

describe('唯一的例外：选中的已保存反事实分支越出 Legs 跨度时撑宽计算窗口（改版前就是这样，指南写明）', () => {
  it('tut-5h：存一条「主力多拿 30 小时」的分支，默认选中时读数按撑宽后的那一份；取消选中回到只按战役本身的那一份（批量导出读的就是它）', async () => {
    // 先按页面一键运行拿到一份真实的反事实参数，把主力的平仓时间挪到战役结束后 30 小时
    const first = renderPage('tut-5h');
    await waitComputeLoaded();
    await waitFor(() => expect(metricValue('峰值浮盈')).toMatch(/USDT$/), { timeout: WAIT });
    const peakWithoutBranch = metricValue('峰值浮盈');
    fireEvent.click(screen.getByRole('button', { name: '一键运行' }));
    await waitFor(() => expect(runCustomCounterfactual).toHaveBeenCalledTimes(1), { timeout: WAIT });
    const [, params, runKlines] = vi.mocked(runCustomCounterfactual).mock.calls[0];
    first.unmount();

    const closedAtMs = Date.parse(synthCampaign('tut-5h').campaign.closed_at!);
    const branchParams = {
      ...params,
      manual_legs: params.manual_legs!.map((leg, index) => (
        index === 0 ? { ...leg, close_time: new Date(closedAtMs + 30 * 60 * 60_000).toISOString() } : leg
      )),
    };
    const branch: CampaignCounterfactual = {
      id: 'cf-long', user_id: 'user-1', campaign_id: 'tut-5h', label: '主力多拿 30 小时',
      branch_kind: 'custom_what_if', source_deduction_id: null,
      params: branchParams, result: simulateManualLegScenario(branchParams, runKlines),
      created_at: '2026-01-02T00:00:00.000Z',
    };
    const widened = legacyDefaultKlines('tut-5h', branch);
    const plain = legacyDefaultKlines('tut-5h');
    // 夹具确实越出了 Legs 跨度：撑宽后的计算周期更粗
    expect(widened.base.toTime).toBeGreaterThan(plain.base.toTime);
    expect(widened.interval).not.toBe(plain.interval);

    vi.mocked(listCounterfactuals).mockResolvedValue([branch]);
    try {
      renderPage('tut-5h');
      const row = await screen.findByTestId('counterfactual-branch-row-cf-long', {}, { timeout: WAIT });
      // 打开时自动选中第一条分支：计算用那一份按撑宽后的窗口与周期拉，读数随之变
      await waitFor(() => expect(accuracyCallsWithKlines().at(-1)!.args[3]).toEqual(widened.klines), { timeout: WAIT });
      const peakWithBranch = `${accuracyCallsWithKlines().at(-1)!.result.campaign_max_profit_real.toFixed(2)} USDT`;
      await waitFor(() => expect(metricValue('峰值浮盈')).toBe(peakWithBranch), { timeout: WAIT });
      expect(peakWithBranch).not.toBe(peakWithoutBranch);

      // 取消选中：回到只按战役本身的那一份，读数与没有分支时（也就是批量导出）逐位相同
      fireEvent.click(row);
      await waitFor(() => expect(accuracyCallsWithKlines().at(-1)!.args[3]).toEqual(plain.klines), { timeout: WAIT });
      await waitFor(() => expect(metricValue('峰值浮盈')).toBe(peakWithoutBranch), { timeout: WAIT });
    } finally {
      vi.mocked(listCounterfactuals).mockResolvedValue([]);
    }
  }, PAGE_TEST_TIMEOUT_MS);
});

describe('加载与错误：显示用失败不影响读数；计算用失败单独提示', () => {
  it('盘面已画好、计算用 K 线还在路上：峰值浮盈显示「加载中…」，不拿兜底值冒充读数', async () => {
    synth.holdIntervals.add('1m');
    renderPage('tut-1h');
    await waitMainProbe('5m');
    expect(metricValue('峰值浮盈')).toBe('加载中…');
    // 不读 K 线的项照常显示
    expect(metricValue('已实现 P&L')).toMatch(/USDT$/);
    synth.releaseHeld();
    await waitComputeLoaded();
    const { result } = accuracyCallsWithKlines().at(-1)!;
    await waitFor(() => expect(metricValue('峰值浮盈')).toBe(`${result.campaign_max_profit_real.toFixed(2)} USDT`), { timeout: WAIT });
  }, PAGE_TEST_TIMEOUT_MS);

  it('显示用 K 线加载失败：盘面显示错误与重试，峰值浮盈照常按计算那一份', async () => {
    synth.failIntervals.add('5m');
    renderPage('tut-1h');
    await waitComputeLoaded();
    const frame = screen.getByTestId('campaign-chart-frame');
    await waitFor(() => expect(frame).toHaveTextContent('K 线加载失败：API 429'), { timeout: WAIT });
    await expectComputationsUnchanged('tut-1h', metricValue('峰值浮盈'));
    expect(screen.queryByTestId('campaign-compute-klines-error')).toBeNull();
    synth.failIntervals.clear();
    fireEvent.click(within(frame).getByRole('button', { name: '重试' }));
    await waitMainProbe('5m');
  }, PAGE_TEST_TIMEOUT_MS);

  it('计算用 K 线加载失败而盘面正常：盘面下方单独提示，可重试', async () => {
    synth.failIntervals.add('1m');
    renderPage('tut-1h');
    await waitMainProbe('5m');
    const notice = await screen.findByTestId('campaign-compute-klines-error', {}, { timeout: WAIT });
    expect(notice).toHaveTextContent('峰值浮盈等读数所用的 1m K 线加载失败：API 429');
    synth.failIntervals.clear();
    fireEvent.click(within(notice).getByRole('button', { name: '重试' }));
    await waitComputeLoaded();
    await waitFor(() => expect(screen.queryByTestId('campaign-compute-klines-error')).toBeNull(), { timeout: WAIT });
    const actual = await vi.importActual<typeof import('@/lib/campaignAnalysis')>('@/lib/campaignAnalysis');
    const call = accuracyCallsWithKlines().at(-1)!;
    expect(call.args[3]).toEqual(legacyDefaultKlines('tut-1h').klines);
    expect(call.result).toEqual(actual.computeDecisionAccuracy(call.args[0], call.args[1], call.args[2], legacyDefaultKlines('tut-1h').klines, ...call.args.slice(4) as []));
  }, PAGE_TEST_TIMEOUT_MS);
});
