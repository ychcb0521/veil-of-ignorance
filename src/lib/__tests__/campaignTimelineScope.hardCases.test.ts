import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CampaignTimelineDiagnostics } from '@/lib/campaignTimelineScope';
import type { ReplayTimelineNode, ReplayTimelineRegistry } from '@/lib/replayTimeline';
import type { CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';
import type { CancelledOrderSnapshot, FilledOrderSnapshot, PendingOrder, TradeRecord } from '@/types/trading';

/**
 * campaignReverseHedgeOrders.test.ts 里每一个能用**盖了章的数据**表达的难例（L1~L4、C、复核二~七），
 * 这里各建一份带回放时间线登记表的等价版本：
 *   · 启发式的结论必须与原测试一字不差（盖章不改变启发式的输入）；
 *   · 精确判定（timelineDiagnostics）给出的 'in' 集合必须等于原测试期望的本场委托，没有分歧；
 *   · 锚点全盖了章的战役一律 'exact'，不留 'defer'。
 * 取代按用户政策 a：仓位跨过倒回时第一遍的对冲照算，除非之后那一遍有章为证地重走了它挂单的时刻。
 */
const t = (iso: string) => Date.parse(iso);

let campaign: TradeCampaign;
let journals: TradeJournal[];

vi.mock('@/integrations/supabase/client', () => {
  function from(table: string) {
    const resolveResult = () => {
      if (table === 'trade_campaigns') return { data: campaign, error: null };
      if (table === 'trade_journals') return { data: journals, error: null };
      return { data: null, error: null };
    };
    const builder = {
      select() { return builder; },
      update() { return builder; },
      eq() { return builder; },
      order() { return builder; },
      single() { return Promise.resolve(resolveResult()); },
      maybeSingle() { return Promise.resolve(resolveResult()); },
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolveResult()).then(resolve);
      },
    };
    return builder;
  }
  return {
    supabase: {
      from,
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }) },
    },
  };
});

// 汇总自愈现在会按每条腿的平仓时刻拉 1 分钟 K 线校验平仓价；测试不碰网络，一律当作「这一分钟没有 K 线」。
vi.mock('@/lib/canonicalTimePrice', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/canonicalTimePrice')>()),
  fetchCanonicalTimePriceAt: vi.fn(async () => null),
}));

import { getCampaignFullData } from '../journalApi';

const MIN = 60_000;
/** 模拟时钟：北京 2026-08-07 19:41 开主力 → 2026-08-09 01:46 平仓。 */
const SIM0 = t('2026-08-07T11:41:00.000Z');
const SIM_CLOSE = t('2026-08-08T17:46:00.000Z');
const sim = (minutes: number) => SIM0 + minutes * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
/** 本场这遍回放：北京 2026-09-13 19:34 起、约 360 倍速。 */
const REAL_MINE = t('2026-09-13T11:34:00.000Z');
const realMine = (simAt: number) => REAL_MINE + Math.round((simAt - SIM0) / 360);
/** 另一遍盖了章的回放：北京 2026-09-10 21:00 起、600 倍速。 */
const REAL_OTHER = t('2026-09-10T13:00:00.000Z');
const realOther = (simAt: number) => REAL_OTHER + Math.round((simAt - SIM0) / 600);
const REAL_PASS_A = t('2026-09-13T10:00:00.000Z');
const REAL_REWIND = t('2026-09-13T11:33:50.000Z');
const REAL_A = t('2026-09-11T10:00:00.000Z');
const REAL_DAY1 = REAL_A;
const REAL_DAY2 = t('2026-09-12T10:00:00.000Z');
const REAL_B = t('2026-09-13T11:33:00.000Z');
const MAIN_POSITION = 'tutu-main-position';

// ===== 登记表 =====
const tl = (id: string, over: Partial<ReplayTimelineNode> = {}): ReplayTimelineNode => ({
  id,
  scope: 'synced',
  parentId: null,
  cause: 'start',
  direction: 1,
  forkSimTime: sim(-5),
  startedRealAt: REAL_MINE - 15 * MIN,
  endSimTime: null,
  endedRealAt: null,
  carried: {},
  lastSimTime: null,
  lastRealAt: null,
  ...over,
});
const carry = (positionIds: string[], orderIds: string[] = [], fillIds: string[] = positionIds) => ({
  TUTUSDT: { positionIds, fillIds, orderIds },
});
const registryOf = (...nodes: ReplayTimelineNode[]): ReplayTimelineRegistry => ({
  v: 1,
  nodes: Object.fromEntries(nodes.map(node => [node.id, node])),
  current: {},
});
/** 本场这遍：从停着的钟起步的根，主力开前 15 分钟就跑着。 */
const mineRoot = (over: Partial<ReplayTimelineNode> = {}) => tl('mine', { lastSimTime: SIM_CLOSE + 30 * MIN, ...over });
/** 09-10 那遍：另一个根。 */
const otherRoot = (over: Partial<ReplayTimelineNode> = {}) =>
  tl('other', { startedRealAt: REAL_OTHER - 5 * MIN, lastSimTime: SIM_CLOSE, endSimTime: SIM_CLOSE, endedRealAt: realOther(SIM_CLOSE), ...over });
/** 跳回信号：在跑的钟上分叉，挂在当前那条下面、带着此刻开着的仓位与挂着的单。 */
const rewind = (id: string, parentId: string, startedRealAt: number, forkSimTime: number, carried: ReturnType<typeof carry>, over: Partial<ReplayTimelineNode> = {}) =>
  tl(id, { parentId, cause: 'jump', forkSimTime, startedRealAt, carried, ...over });

// ===== 委托 / 成交 / 记录 =====
type LineStamps = {
  createdRealAt?: number;
  cancelledRealAt?: number;
  createdTimelineId?: string | null;
  cancelledTimelineId?: string | null;
};
const hedge = (id: string, createdAt: number, cancelledAt: number, stamps: LineStamps = {}, price = 0.03005): CancelledOrderSnapshot => ({
  id,
  symbol: 'TUTUSDT',
  side: 'SHORT',
  type: 'CONDITIONAL',
  reduceOnly: false,
  reduceKind: null,
  price,
  quantity: 10_000,
  leverage: 5,
  createdAt,
  cancelledAt,
  ...stamps,
});
/** 挂与撤都在同一条时间线上、现实时刻按那遍的倍速换算。 */
const onLine = (line: string, realOf: (simAt: number) => number) =>
  (id: string, createdAt: number, cancelledAt: number, price?: number) =>
    hedge(id, createdAt, cancelledAt, {
      createdRealAt: realOf(createdAt), cancelledRealAt: realOf(cancelledAt), createdTimelineId: line, cancelledTimelineId: line,
    }, price);
const mineHedge = onLine('mine', realMine);
const otherHedge = onLine('other', realOther);
/** 挂与撤各自给定现实时刻与时间线。 */
const stampedHedge = (
  id: string,
  created: [simAt: number, realAt: number, line: string],
  cancelled: [simAt: number, realAt: number, line: string],
  price?: number,
) => hedge(id, created[0], cancelled[0], {
  createdRealAt: created[1], cancelledRealAt: cancelled[1], createdTimelineId: created[2], cancelledTimelineId: cancelled[2],
}, price);

const shortFill = (
  id: string,
  createdAt: number,
  filledAt: number,
  stamps: { createdRealAt?: number; filledRealAt?: number; createdTimelineId?: string | null; filledTimelineId?: string | null } = {},
  positionId?: string,
  price = 0.0299,
): FilledOrderSnapshot => ({
  id,
  symbol: 'TUTUSDT',
  side: 'SHORT',
  type: 'CONDITIONAL',
  reduceOnly: false,
  reduceKind: null,
  price,
  triggerPrice: price,
  quantity: 10_000,
  leverage: 5,
  createdAt,
  filledAt,
  ...(positionId ? { positionId } : {}),
  ...stamps,
});
const shortPending = (id: string, createdAt: number, createdRealAt: number | undefined, line: string | null, price = 0.0302): PendingOrder => ({
  id,
  side: 'SHORT',
  type: 'CONDITIONAL',
  price,
  stopPrice: price,
  quantity: 10_000,
  leverage: 5,
  marginMode: 'isolated',
  status: 'PENDING',
  createdAt,
  ...(createdRealAt != null ? { createdRealAt } : {}),
  ...(line ? { createdTimelineId: line } : {}),
});

type RecordStamps = { openedRealAt?: number; closedRealAt?: number; openedTimelineId?: string | null; closedTimelineId?: string | null };
const mainRecord = (stamps: RecordStamps): TradeRecord => ({
  id: 'tutu-main-record',
  positionId: MAIN_POSITION,
  fillId: MAIN_POSITION,
  symbol: 'TUTUSDT',
  side: 'LONG',
  type: 'MARKET',
  action: 'CLOSE',
  entryPrice: 0.0312,
  exitPrice: 0.0335,
  quantity: 10_000,
  leverage: 5,
  pnl: 23,
  fee: 0,
  slippage: 0,
  openTime: SIM0,
  closeTime: SIM_CLOSE,
  ...stamps,
} as TradeRecord);
/** 本场这遍打完整场：开在 mine、平在 mine。 */
const mineMainRecord = () => mainRecord({
  openedRealAt: realMine(SIM0), closedRealAt: realMine(SIM_CLOSE), openedTimelineId: 'mine', closedTimelineId: 'mine',
});
/** 主力在 A 遍开、B 遍平。 */
const rewoundMainRecord = (openedRealAt: number, closedRealAt = realMine(SIM_CLOSE)) => mainRecord({
  openedRealAt, closedRealAt, openedTimelineId: 'A', closedTimelineId: 'B',
});

// ===== 腿 / 事件 =====
const makeLeg = (overrides: Partial<TradeJournal>): TradeJournal => ({
  id: overrides.id ?? `leg-${Math.random().toString(36).slice(2)}`,
  user_id: 'user-1',
  trade_record_id: null,
  campaign_id: 'campaign-1',
  leg_role: 'hedge_rolling',
  leg_sequence: null,
  source: 'post_review',
  symbol: 'TUTUSDT',
  direction: 'short',
  leverage: 5,
  position_mode: 'isolated',
  order_kind: 'trade',
  pre_simulated_time: iso(SIM0),
  pre_real_time: iso(REAL_MINE),
  pre_entry_price: null,
  pre_planned_stop_loss: null,
  pre_planned_take_profit: null,
  pre_entry_reason: null,
  pre_mental_state: 3,
  pre_mental_trigger: null,
  pre_risk_awareness: null,
  pre_risk_management: null,
  pre_checklist_items: null,
  pre_checklist_passed: null,
  pre_position_size: null,
  pre_max_loss_usdt: null,
  ...overrides,
} as TradeJournal);
const retroLeg = (overrides: Partial<TradeJournal>) => makeLeg({
  source: 'retroactive_from_record',
  pre_real_time: '2026-09-13T12:10:00.000Z',
  ...overrides,
});
const mainLeg = () => retroLeg({
  id: 'tutu-main-leg',
  trade_record_id: 'tutu-main-record',
  leg_role: 'main_open',
  leg_sequence: 1,
  direction: 'long',
  pre_simulated_time: iso(SIM0),
  pre_entry_price: 0.0312,
  post_simulated_close_time: iso(SIM_CLOSE),
  post_real_close_time: iso(realMine(SIM_CLOSE)),
});
const mirrorLeg = () => retroLeg({
  id: 'tutu-mirror-leg',
  trade_record_id: 'tutu-mirror-record',
  leg_role: 'mirror_tp',
  leg_sequence: 2,
  direction: 'long',
  pre_simulated_time: iso(sim(1)),
  pre_entry_price: 0.0313,
  post_simulated_close_time: iso(sim(8)),
  post_real_close_time: iso(realMine(sim(8))),
});
/** 实时主力腿：记录决策时锁定的时间线在本地镜像里（pre_timeline_id）；trade_record_id 是下单返回的仓位 id。 */
const liveMainLeg = (line: string, preRealTime = REAL_MINE, over: Partial<TradeJournal> = {}) => makeLeg({
  id: 'tutu-live-main-leg',
  trade_record_id: MAIN_POSITION,
  source: 'live',
  leg_role: 'main_open',
  leg_sequence: 1,
  direction: 'long',
  pre_simulated_time: iso(SIM0),
  pre_real_time: iso(preRealTime),
  pre_entry_price: 0.0312,
  pre_timeline_id: line,
  ...over,
});
const liveAddLeg = (line: string, simAt: number, preRealTime: number) => makeLeg({
  id: 'tutu-live-add-leg',
  trade_record_id: null,
  source: 'live',
  leg_role: 'main_add_1',
  leg_sequence: 2,
  direction: 'long',
  pre_simulated_time: iso(simAt),
  pre_real_time: iso(preRealTime),
  pre_entry_price: 0.0312,
  pre_timeline_id: line,
});
/** 归类时写下的腿事件：时间线从成交上抄来（recordEventTimelineId）。 */
const attachedEvent = (leg: TradeJournal, timelineId: string, simAt: number): CampaignEvent => ({
  id: `evt-${leg.id}`,
  timestamp: iso(simAt),
  event_type: 'historical_leg_attached',
  leg_role: leg.leg_role,
  journal_id: leg.id,
  trade_record_id: leg.trade_record_id,
  pending_order_id: null,
  price: null,
  size_usdt: null,
  notes: null,
  recorded_at: '2026-09-13T12:10:00.000Z',
  timeline_id: timelineId,
});

const store = (data: {
  tradeHistory?: TradeRecord[];
  cancelled?: CancelledOrderSnapshot[];
  filled?: FilledOrderSnapshot[];
  pending?: PendingOrder[];
  positions?: unknown[];
  registry: ReplayTimelineRegistry;
}) => {
  localStorage.setItem('sim_user-1_trade_history', JSON.stringify(data.tradeHistory ?? []));
  localStorage.setItem('sim_user-1_cancelled_orders', JSON.stringify(data.cancelled ?? []));
  localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(data.filled ?? []));
  localStorage.setItem('sim_user-1_orders_map', JSON.stringify({ TUTUSDT: data.pending ?? [] }));
  if (data.positions) localStorage.setItem('sim_user-1_positions_map', JSON.stringify({ TUTUSDT: data.positions }));
  localStorage.setItem('sim_user-1_replay_timelines_v1', JSON.stringify(data.registry));
};
const openCampaign = () => {
  campaign.closed_at = null;
  campaign.status = 'active';
};

const idsWhere = (diagnostics: CampaignTimelineDiagnostics, verdict: 'in' | 'out' | 'defer') =>
  Object.keys(diagnostics.verdicts).filter(id => diagnostics.verdicts[id].exact === verdict).sort();
/** 精确判定的 'in' 集合 = 期望的本场委托；没有分歧；不留 defer（除非指明）。 */
const expectExact = (
  diagnostics: CampaignTimelineDiagnostics,
  expected: string[],
  options: { mode?: CampaignTimelineDiagnostics['mode']; defer?: string[] } = {},
) => {
  expect(diagnostics.mode).toBe(options.mode ?? 'exact');
  expect(diagnostics.disagreements).toEqual([]);
  expect(idsWhere(diagnostics, 'in')).toEqual([...expected].sort());
  expect(idsWhere(diagnostics, 'defer')).toEqual([...(options.defer ?? [])].sort());
};

beforeEach(() => {
  localStorage.clear();
  journals = [];
  campaign = {
    id: 'campaign-1',
    user_id: 'user-1',
    symbol: 'TUTUSDT',
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'custom',
    title: 'TUTUSDT 2026-08-07 多战役',
    opened_at: iso(SIM0),
    closed_at: iso(SIM_CLOSE),
    initial_main_size_usdt: null,
    initial_leverage: null,
    final_realized_pnl: null,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    notes: null,
    actual_evolution: [],
    created_at: '2026-09-13T12:10:00.000Z',
    updated_at: '2026-09-13T12:10:00.000Z',
  } as TradeCampaign;
});

describe('【盖章等价】L1 ~ L4、C：同一段行情多次回放', () => {
  it('【L1】8 月留下的无章委托（撤掉的 / 至今挂着、被 start 起步的根带上的）不算；本场自己的算', async () => {
    journals = [mainLeg(), mirrorLeg()];
    // 镜像止盈的成交不在本地：它的平仓操作靠归类事件上抄来的章代表（否则是没盖章的锚点 → mixed）
    campaign.actual_evolution = [attachedEvent(journals[0], 'mine', SIM0), attachedEvent(journals[1], 'mine', sim(1))];
    const minePending = shortPending('mine-pending-0288000', sim(20 * 60), realMine(sim(20 * 60)), 'mine', 0.0288);
    const augPending = shortPending('aug-pending-0288000', sim(20 * 60) + 20_000, undefined, null, 0.0288);
    store({
      tradeHistory: [mineMainRecord()],
      cancelled: [mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)), hedge('aug-0300500-1942', sim(1) + 15_000, sim(5 * 60))],
      pending: [minePending, augPending],
      // 从停着的钟起步：分叉快照带上了还挂着的 8 月旧单——只有 bootstrap 带的才算本场
      registry: registryOf(mineRoot({ carried: carry([], ['aug-pending-0288000']) })),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942', 'mine-pending-0288000']);
    expect(pendingOrders.map(order => order.id)).toEqual(['mine-pending-0288000']);
    expectExact(timelineDiagnostics, ['mine-0300500-1942', 'mine-pending-0288000']);
    expect(idsWhere(timelineDiagnostics, 'out')).toEqual(['aug-0300500-1942', 'aug-pending-0288000']);
  });

  it('【L2】挂单没章、撤单 / 成交盖在 09-10 那遍上：不是本场', async () => {
    journals = [mainLeg(), mirrorLeg()];
    campaign.actual_evolution = [attachedEvent(journals[0], 'mine', SIM0), attachedEvent(journals[1], 'mine', sim(1))];
    store({
      tradeHistory: [mineMainRecord()],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        hedge('partial-cancelled-0300500-1942', sim(1) + 15_000, sim(5 * 60), {
          cancelledRealAt: realOther(sim(5 * 60)), cancelledTimelineId: 'other',
        }),
      ],
      filled: [shortFill('partial-filled-0299000', sim(3), sim(4 * 60), { filledRealAt: realOther(sim(4 * 60)), filledTimelineId: 'other' })],
      registry: registryOf(mineRoot(), otherRoot()),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942']);
    expectExact(timelineDiagnostics, ['mine-0300500-1942']);
  });

  it('【L3】本地成交被清掉：腿的平仓操作从归类事件上取章，照样认得出本场那条时间线', async () => {
    journals = [mainLeg(), mirrorLeg()];
    campaign.actual_evolution = [attachedEvent(journals[0], 'mine', SIM0), attachedEvent(journals[1], 'mine', sim(1))];
    store({
      tradeHistory: [],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        mineHedge('mine-0290000-late', sim(20 * 60), sim(22 * 60), 0.029),
        otherHedge('other-0300500-1942', sim(1) + 15_000, sim(6 * 60)),
        otherHedge('other-0290000-late', sim(20 * 60) + 30_000, sim(22 * 60), 0.029),
      ],
      registry: registryOf(mineRoot(), otherRoot()),
    });

    const { tradeRecords, reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(tradeRecords).toEqual([]);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942', 'mine-0290000-late']);
    expectExact(timelineDiagnostics, ['mine-0300500-1942', 'mine-0290000-late']);
  });

  it('【L4】主力在 A 遍开、跳回信号后 B 遍平：A 遍倒回点之后挂的单被 B 遍重走、取代；倒回点之前的前置对冲照算', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [rewoundMainRecord(REAL_PASS_A)],
      cancelled: [
        stampedHedge('passA-prehedge-1939', [sim(-2), REAL_PASS_A - 30_000, 'A'], [sim(90), REAL_PASS_A + 5 * MIN, 'A'], 0.0301),
        stampedHedge('passA-0300500-1942', [sim(1) + 20_000, REAL_PASS_A + 30_000, 'A'], [sim(3 * 60), REAL_PASS_A + 6 * MIN, 'A']),
        hedge('passB-0300500-1942', sim(1), sim(6 * 60), {
          createdRealAt: realMine(sim(1)), cancelledRealAt: realMine(sim(6 * 60)), createdTimelineId: 'B', cancelledTimelineId: 'B',
        }),
      ],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_PASS_A - 2 * MIN, forkSimTime: sim(-3), lastSimTime: sim(3 * 60) }),
        rewind('B', 'A', REAL_MINE - MIN, sim(-1), carry([MAIN_POSITION])),
      ),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passA-prehedge-1939', 'passB-0300500-1942']);
    expectExact(timelineDiagnostics, ['passA-prehedge-1939', 'passB-0300500-1942']);
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'B']);
  });

  it('【C】挂好前置对冲后停了 10 分钟（现实）才开主力：同一条时间线上，照算', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_MINE, closedRealAt: realMine(SIM_CLOSE), openedTimelineId: 'mine', closedTimelineId: 'mine' })],
      cancelled: [
        stampedHedge('prehedge-paused-1939', [sim(-2), REAL_MINE - 10 * MIN, 'mine'], [sim(2 * 60), realMine(sim(2 * 60)), 'mine'], 0.0301),
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
      ],
      registry: registryOf(mineRoot()),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['prehedge-paused-1939', 'mine-0300500-1942']);
    expectExact(timelineDiagnostics, ['prehedge-paused-1939', 'mine-0300500-1942']);
  });

  it('【复核 C】进行中的战役还没有任何平仓：实时腿记录决策时的章是锚点；09-10 那遍留下、被本场根带上的旧挂单不算', async () => {
    openCampaign();
    journals = [liveMainLeg('mine')];
    store({
      tradeHistory: [],
      pending: [
        shortPending('other-replay-pending', sim(1) + 15_000, realOther(sim(1)), 'other'),
        shortPending('paused-prehedge', sim(-2), REAL_MINE - 10 * MIN, 'mine', 0.0301),
        shortPending('after-main', sim(1), REAL_MINE + MIN, 'mine'),
      ],
      registry: registryOf(otherRoot({ endedRealAt: null, endSimTime: null }), mineRoot({ carried: carry([], ['other-replay-pending']) })),
    });

    const { pendingOrders, reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(pendingOrders.map(order => order.id)).toEqual(['paused-prehedge', 'after-main']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['paused-prehedge', 'after-main']);
    expectExact(timelineDiagnostics, ['paused-prehedge', 'after-main']);
  });

  it('战役事件恢复的委托：有快照按快照的章判；没有快照的只记在事件流里，精确判定不下结论', async () => {
    journals = [mainLeg()];
    const event = (id: string, orderId: string, eventType: 'hedge_placed' | 'hedge_cancelled', at: number): CampaignEvent => ({
      id,
      timestamp: iso(at),
      event_type: eventType,
      leg_role: 'hedge_initial_a',
      journal_id: null,
      trade_record_id: null,
      pending_order_id: orderId,
      price: 0.03005,
      size_usdt: 300,
      notes: null,
      recorded_at: iso(at),
      direction: 'short',
    });
    campaign.actual_evolution = [
      event('other-placed', 'other-evt-0300500-1942', 'hedge_placed', sim(1) + 15_000),
      event('other-cancelled', 'other-evt-0300500-1942', 'hedge_cancelled', sim(6 * 60)),
      event('orphan-placed', 'orphan-evt-0300500-1942', 'hedge_placed', sim(1) + 30_000),
      event('orphan-cancelled', 'orphan-evt-0300500-1942', 'hedge_cancelled', sim(5 * 60)),
    ];
    store({
      tradeHistory: [mineMainRecord()],
      cancelled: [mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)), otherHedge('other-evt-0300500-1942', sim(1) + 15_000, sim(6 * 60))],
      registry: registryOf(mineRoot(), otherRoot()),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942', 'orphan-evt-0300500-1942']);
    expectExact(timelineDiagnostics, ['mine-0300500-1942']);
    expect(timelineDiagnostics.verdicts['orphan-evt-0300500-1942']).toBeUndefined();
  });
});

describe('【盖章等价】复核：上线前后 / 活过倒回 / 绕路跳转', () => {
  it('【复核】8 月的无章老委托被这遍撤掉 / ⏹ 停止撤掉 / 触发成交：撤单 / 成交盖在本场上也不算——它们不是 bootstrap 带进来的', async () => {
    journals = [mainLeg(), mirrorLeg()];
    campaign.actual_evolution = [attachedEvent(journals[0], 'mine', SIM0), attachedEvent(journals[1], 'mine', sim(1))];
    store({
      tradeHistory: [mineMainRecord()],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        hedge('aug-carried-cancelled-1942', sim(1) + 15_000, sim(5 * 60), { cancelledRealAt: realMine(sim(5 * 60)), cancelledTimelineId: 'mine' }),
        hedge('aug-stop-cancelled-1943', sim(2), SIM_CLOSE, { cancelledRealAt: realMine(SIM_CLOSE) + 10_000, cancelledTimelineId: 'mine' }),
      ],
      filled: [shortFill('aug-carried-filled-0299000', sim(3), sim(4 * 60), { filledRealAt: realMine(sim(4 * 60)), filledTimelineId: 'mine' })],
      registry: registryOf(mineRoot({ carried: carry([], ['aug-carried-cancelled-1942', 'aug-stop-cancelled-1943', 'aug-carried-filled-0299000']) })),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942']);
    expectExact(timelineDiagnostics, ['mine-0300500-1942']);
  });

  it('【复核 L4】活过倒回的不被取代：A 遍挂、B 遍才成交的对冲，与 A 遍成交后仓位带进 B 遍的对冲都保留', async () => {
    journals = [
      mainLeg(),
      retroLeg({
        id: 'passA-hedge-leg', trade_record_id: 'passA-hedge-record', leg_role: 'hedge_initial_a', leg_sequence: 2,
        direction: 'short', pre_simulated_time: iso(sim(31)), pre_entry_price: 0.0302,
      }),
    ];
    const hedgeRecord = {
      ...rewoundMainRecord(REAL_PASS_A + 3 * MIN, realMine(sim(10 * 60))),
      id: 'passA-hedge-record', positionId: 'passA-hedge-position', fillId: 'passA-hedge-position',
      side: 'SHORT', entryPrice: 0.0302, exitPrice: 0.0298, openTime: sim(31), closeTime: sim(10 * 60),
    } as TradeRecord;
    store({
      tradeHistory: [rewoundMainRecord(REAL_PASS_A), hedgeRecord],
      cancelled: [
        stampedHedge('passA-0300500-1942', [sim(1) + 20_000, REAL_PASS_A + 30_000, 'A'], [sim(3 * 60), REAL_PASS_A + 6 * MIN, 'A']),
        hedge('passB-0300500-1942', sim(1), sim(6 * 60), {
          createdRealAt: realMine(sim(1)), cancelledRealAt: realMine(sim(6 * 60)), createdTimelineId: 'B', cancelledTimelineId: 'B',
        }),
      ],
      filled: [
        shortFill('passA-carried-filled-in-B', sim(30), sim(60), {
          createdRealAt: REAL_PASS_A + MIN, filledRealAt: realMine(sim(60)), createdTimelineId: 'A', filledTimelineId: 'B',
        }, undefined, 0.0301),
        shortFill('passA-hedge-filled', sim(30) + 30_000, sim(31), {
          createdRealAt: REAL_PASS_A + 2 * MIN, filledRealAt: REAL_PASS_A + 3 * MIN, createdTimelineId: 'A', filledTimelineId: 'A',
        }, 'passA-hedge-position', 0.0302),
      ],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_PASS_A - 2 * MIN, forkSimTime: sim(-3), lastSimTime: sim(3 * 60) }),
        rewind('B', 'A', REAL_MINE - MIN, sim(-1), carry([MAIN_POSITION, 'passA-hedge-position'], ['passA-carried-filled-in-B'])),
      ),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passB-0300500-1942', 'passA-carried-filled-in-B', 'passA-hedge-filled']);
    expectExact(timelineDiagnostics, ['passB-0300500-1942', 'passA-carried-filled-in-B', 'passA-hedge-filled']);
    expect(timelineDiagnostics.verdicts['passA-hedge-filled']).toEqual({ heuristic: true, exact: 'in', exempt: true });
  });

  it('【复核 L4】A 遍挂出、倒回后至今仍挂着的对冲：持仓面板与委托层都保留', async () => {
    openCampaign();
    journals = [mainLeg()];
    store({
      tradeHistory: [rewoundMainRecord(REAL_PASS_A)],
      cancelled: [hedge('passB-0300500-1942', sim(1), sim(6 * 60), {
        createdRealAt: realMine(sim(1)), cancelledRealAt: realMine(sim(6 * 60)), createdTimelineId: 'B', cancelledTimelineId: 'B',
      })],
      pending: [shortPending('passA-pending-still-live', sim(30), REAL_PASS_A + MIN, 'A')],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_PASS_A - 2 * MIN, forkSimTime: sim(-3), lastSimTime: sim(3 * 60) }),
        rewind('B', 'A', REAL_MINE - MIN, sim(-1), carry([MAIN_POSITION], ['passA-pending-still-live'])),
      ),
    });

    const { pendingOrders, reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(pendingOrders.map(order => order.id)).toEqual(['passA-pending-still-live']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passB-0300500-1942', 'passA-pending-still-live']);
    expectExact(timelineDiagnostics, ['passB-0300500-1942', 'passA-pending-still-live']);
  });

  it('【复核 L4】B 遍先绕去 08-01 的信号、再一跳到 08-08 继续：A 遍 20:41 的对冲从没被重走，保留', async () => {
    const SIM_DETOUR = t('2026-08-01T04:00:00.000Z');
    const SIM_CONTINUE = t('2026-08-08T08:46:00.000Z');
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_PASS_A, closedRealAt: REAL_PASS_A + 30 * MIN, openedTimelineId: 'A', closedTimelineId: 'C' })],
      cancelled: [
        stampedHedge('passA-hedge-2041', [sim(60), REAL_PASS_A + MIN, 'A'], [sim(70), REAL_PASS_A + 2 * MIN, 'A']),
        stampedHedge('detour-0801', [SIM_DETOUR, REAL_PASS_A + 10 * MIN, 'B'], [SIM_DETOUR + 10 * MIN, REAL_PASS_A + 11 * MIN, 'B']),
        stampedHedge('continuation-0808', [SIM_CONTINUE, REAL_PASS_A + 20 * MIN, 'C'], [SIM_CONTINUE + 20 * MIN, REAL_PASS_A + 21 * MIN, 'C']),
      ],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_PASS_A - MIN, forkSimTime: sim(-3), lastSimTime: sim(75) }),
        rewind('B', 'A', REAL_PASS_A + 9 * MIN, SIM_DETOUR, carry([MAIN_POSITION]), { lastSimTime: SIM_DETOUR + 12 * MIN }),
        rewind('C', 'B', REAL_PASS_A + 19 * MIN, SIM_CONTINUE, carry([MAIN_POSITION])),
      ),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passA-hedge-2041', 'continuation-0808']);
    expectExact(timelineDiagnostics, ['passA-hedge-2041', 'continuation-0808']);
    // 绕路那一段不带本场的操作、也没往前接回本场停下处：不是本场的时间线（它的单在模拟窗口外，本来就不显示）
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'C']);
  });
});

describe('【盖章等价】复核二 ~ 复核三', () => {
  it('【复核二 F1】三天前在同一信号上挂了前置对冲又放弃：那次的单（撤了的 / 至今挂着的）都不算', async () => {
    const REAL_SEPT10 = t('2026-09-10T13:00:00.000Z');
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_MINE, closedRealAt: realMine(SIM_CLOSE), openedTimelineId: 'mine', closedTimelineId: 'mine' })],
      cancelled: [
        stampedHedge('sept10-prehedge-1938', [sim(-3), REAL_SEPT10, 'sept10'], [sim(-2), REAL_SEPT10 + 10_000, 'sept10'], 0.0301),
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
      ],
      pending: [shortPending('sept10-live-1939', sim(-2.5), REAL_SEPT10 + 5_000, 'sept10', 0.0301)],
      registry: registryOf(
        tl('sept10', { startedRealAt: REAL_SEPT10 - MIN, forkSimTime: sim(-5), lastSimTime: sim(-2), endedRealAt: REAL_SEPT10 + MIN, endSimTime: sim(-2) }),
        mineRoot({ carried: carry([], ['sept10-live-1939']) }),
      ),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942']);
    expect(pendingOrders).toEqual([]);
    expectExact(timelineDiagnostics, ['mine-0300500-1942']);
  });

  it('【复核二 F2】取代不看同一分钟里谁先谁后：A 遍那张的模拟时刻比 B 遍早几秒，照样被 B 遍取代', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [rewoundMainRecord(REAL_PASS_A)],
      cancelled: [
        stampedHedge('passA-0300500-1942', [sim(1), REAL_PASS_A + 30_000, 'A'], [sim(3 * 60), REAL_PASS_A + 6 * MIN, 'A']),
        hedge('passB-0300500-1942', sim(1) + 15_000, sim(6 * 60), {
          createdRealAt: realMine(sim(1) + 15_000), cancelledRealAt: realMine(sim(6 * 60)), createdTimelineId: 'B', cancelledTimelineId: 'B',
        }),
      ],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_PASS_A - MIN, forkSimTime: sim(-3), lastSimTime: sim(3 * 60) }),
        rewind('B', 'A', REAL_MINE - MIN, sim(-1), carry([MAIN_POSITION])),
      ),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passB-0300500-1942']);
    expectExact(timelineDiagnostics, ['passB-0300500-1942']);
  });

  it('【复核二 F3】8 月留在开主力前 5 分钟回看窗里的无章委托（撤了 / ⏹ 停止撤的 / 至今挂着）都不算', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [mineMainRecord()],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        hedge('aug-prehedge-1938', sim(-3), sim(-1), {}, 0.0301),
        hedge('aug-carried-prehedge-stop', sim(-4), SIM_CLOSE, { cancelledRealAt: realMine(SIM_CLOSE) + 10_000, cancelledTimelineId: 'mine' }, 0.0302),
      ],
      pending: [shortPending('aug-live-prehedge', sim(-2), undefined, null, 0.0303)],
      registry: registryOf(mineRoot({ carried: carry([], ['aug-carried-prehedge-stop', 'aug-live-prehedge']) })),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942']);
    expect(pendingOrders).toEqual([]);
    expectExact(timelineDiagnostics, ['mine-0300500-1942']);
  });

  it('【复核二 F4】本地成交被清掉、本场这遍没留下盖章委托：归类事件上的章照样证明本场是哪条线，8 月的无章委托全部排除', async () => {
    journals = [mainLeg(), mirrorLeg()];
    campaign.actual_evolution = [attachedEvent(journals[0], 'mine', SIM0), attachedEvent(journals[1], 'mine', sim(1))];
    store({
      tradeHistory: [],
      cancelled: [
        hedge('aug-0300500-1942', sim(1) + 15_000, sim(5)),
        hedge('aug-0290000-2141', sim(120), sim(150), {}, 0.029),
        otherHedge('other-0300500-1942', sim(1) + 15_000, sim(6 * 60)),
      ],
      registry: registryOf(mineRoot(), otherRoot()),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders).toEqual([]);
    expectExact(timelineDiagnostics, []);
    expect(idsWhere(timelineDiagnostics, 'out')).toEqual(['aug-0290000-2141', 'aug-0300500-1942', 'other-0300500-1942']);
  });

  it('【复核二 F5】进行中的战役带着主力倒回：同一次坐下来倒回出来的那一遍是本场，A 遍里就结束的单子被取代', async () => {
    openCampaign();
    journals = [liveMainLeg('A')];
    store({
      tradeHistory: [],
      cancelled: [stampedHedge('A-late', [sim(590), REAL_MINE + 5 * MIN, 'A'], [sim(600), REAL_MINE + 6 * MIN, 'A'], 0.0296)],
      pending: [
        shortPending('A-pending', sim(60), REAL_MINE + MIN, 'A', 0.0301),
        shortPending('B-pending', sim(130), REAL_MINE + 40 * MIN, 'B', 0.0299),
      ],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_MINE - MIN, forkSimTime: sim(-2), lastSimTime: sim(600) }),
        rewind('B', 'A', REAL_MINE + 30 * MIN, sim(120), carry([MAIN_POSITION], ['A-pending'])),
      ),
    });

    const { pendingOrders, reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(pendingOrders.map(order => order.id)).toEqual(['A-pending', 'B-pending']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['A-pending', 'B-pending']);
    expectExact(timelineDiagnostics, ['A-pending', 'B-pending']);
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'B']);
  });

  it('【复核二 F6】两笔成交合并成一个对冲仓位、带过倒回在 B 遍平掉：并进去的那笔不被取代；A 遍里就结束的单照样取代', async () => {
    journals = [
      mainLeg(),
      retroLeg({
        id: 'merged-hedge-leg', trade_record_id: 'P1', leg_role: 'hedge_initial_a', leg_sequence: 2,
        direction: 'short', pre_simulated_time: iso(sim(10)), pre_entry_price: 0.0302,
      }),
    ];
    const hedgeFillRecord = (id: string, fillId: string, openTime: number, openedRealAt: number, entryPrice: number) => ({
      ...mainRecord({ openedRealAt, closedRealAt: realMine(sim(300)), openedTimelineId: 'A', closedTimelineId: 'B' }),
      id, positionId: 'P1', fillId, side: 'SHORT', entryPrice, exitPrice: 0.0295, openTime, closeTime: sim(300),
    } as TradeRecord);
    store({
      tradeHistory: [
        rewoundMainRecord(REAL_PASS_A),
        hedgeFillRecord('h1', 'P1', sim(10), REAL_PASS_A + MIN, 0.0302),
        hedgeFillRecord('h2', 'P2', sim(50), REAL_PASS_A + 4 * MIN, 0.0303),
      ],
      cancelled: [
        stampedHedge('A-late', [sim(100), REAL_PASS_A + 6 * MIN, 'A'], [sim(110), REAL_PASS_A + 7 * MIN, 'A'], 0.0297),
        hedge('B-hedge', sim(25), sim(200), {
          createdRealAt: realMine(sim(25)), cancelledRealAt: realMine(sim(200)), createdTimelineId: 'B', cancelledTimelineId: 'B',
        }, 0.0298),
      ],
      filled: [
        shortFill('o1', sim(5), sim(10), { createdRealAt: REAL_PASS_A + 30_000, filledRealAt: REAL_PASS_A + MIN, createdTimelineId: 'A', filledTimelineId: 'A' }, 'P1', 0.0302),
        shortFill('o2-merged', sim(40), sim(50), { createdRealAt: REAL_PASS_A + 3 * MIN, filledRealAt: REAL_PASS_A + 4 * MIN, createdTimelineId: 'A', filledTimelineId: 'A' }, 'P2', 0.0303),
      ],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_PASS_A - MIN, forkSimTime: sim(-3), lastSimTime: sim(110) }),
        rewind('B', 'A', REAL_MINE - MIN, sim(20), carry([MAIN_POSITION, 'P1'], [], [MAIN_POSITION, 'P1', 'P2'])),
      ),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['o1', 'B-hedge', 'o2-merged']);
    expectExact(timelineDiagnostics, ['o1', 'B-hedge', 'o2-merged']);
  });

  it('【复核三 F1】持仓跨过资金费时段：资金费记录带的章不是锚点也不是证据；8 月回看窗里的无章委托照样排除', async () => {
    const SIM_FUNDING = t('2026-08-07T16:00:30.000Z');
    journals = [mainLeg()];
    store({
      tradeHistory: [
        mineMainRecord(),
        {
          id: 'funding-0807-16', symbol: 'TUTUSDT', side: 'LONG', type: 'FUNDING', action: 'FUNDING',
          entryPrice: 0.0315, exitPrice: 0, quantity: 10_000, leverage: 5, pnl: -0.03, fee: 0.03, slippage: 0,
          openTime: SIM_FUNDING, closeTime: SIM_FUNDING, closedRealAt: realMine(SIM_FUNDING), closedTimelineId: 'mine',
        } as TradeRecord,
      ],
      cancelled: [
        mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
        hedge('aug-prehedge-1938', sim(-3), sim(-1), {}, 0.0301),
        hedge('aug-carried-prehedge-stop', sim(-4), SIM_CLOSE, { cancelledRealAt: realMine(SIM_CLOSE) + 10_000, cancelledTimelineId: 'mine' }, 0.0302),
      ],
      pending: [shortPending('aug-live-prehedge', sim(-2), undefined, null, 0.0303)],
      registry: registryOf(mineRoot({ carried: carry([], ['aug-carried-prehedge-stop', 'aug-live-prehedge']) })),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942']);
    expect(pendingOrders).toEqual([]);
    expectExact(timelineDiagnostics, ['mine-0300500-1942']);
    expect(timelineDiagnostics.anchorTimelineIds).toEqual(['mine']);
  });

  it('【复核三 F2】进行中的战役隔天回来接着往后打（没有分叉）：第二天挂的对冲仍在同一条时间线上', async () => {
    openCampaign();
    journals = [liveMainLeg('mine')];
    store({
      tradeHistory: [],
      pending: [
        shortPending('day1-after-main', sim(1), REAL_MINE + MIN, 'mine'),
        shortPending('day2-continued-hedge', sim(180), REAL_MINE + 20 * 60 * MIN, 'mine', 0.0299),
      ],
      registry: registryOf(mineRoot({ startedRealAt: REAL_MINE - MIN, lastSimTime: sim(180) })),
    });

    const { pendingOrders, reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(pendingOrders.map(order => order.id)).toEqual(['day1-after-main', 'day2-continued-hedge']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['day1-after-main', 'day2-continued-hedge']);
    expectExact(timelineDiagnostics, ['day1-after-main', 'day2-continued-hedge']);
  });

  it('【复核三 F4】挂好对冲后把时间机器倒回几分钟再开主力：至今挂着的那张活进了本场的时间线；倒回前就撤掉的不算', async () => {
    openCampaign();
    journals = [liveMainLeg('B')];
    store({
      tradeHistory: [],
      cancelled: [stampedHedge('pre-rewind-cancelled', [sim(6), REAL_MINE - 3 * MIN, 'R0'], [sim(7), REAL_MINE - 2.5 * MIN, 'R0'], 0.0304)],
      pending: [
        shortPending('pre-rewind-hedge-live', sim(8), REAL_MINE - 2 * MIN, 'R0', 0.0301),
        shortPending('after-main', sim(3), REAL_MINE + MIN, 'B'),
      ],
      registry: registryOf(
        tl('R0', { startedRealAt: REAL_MINE - 4 * MIN, forkSimTime: sim(5), lastSimTime: sim(8) }),
        rewind('B', 'R0', REAL_MINE - MIN, sim(2), carry([], ['pre-rewind-hedge-live'])),
      ),
    });

    const { pendingOrders, reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(pendingOrders.map(order => order.id)).toEqual(['pre-rewind-hedge-live', 'after-main']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['after-main', 'pre-rewind-hedge-live']);
    expectExact(timelineDiagnostics, ['pre-rewind-hedge-live', 'after-main']);
    expect(timelineDiagnostics.timelineIds).toEqual(['B']);
  });
});

describe('【盖章等价】复核四 ~ 复核五', () => {
  it('【复核四 F1】同一个暂停的模拟分钟里先挂又撤、再记录决策重新挂：都在同一条时间线上，都算', async () => {
    const SIM_DECISION = sim(600);
    const REAL_DECISION = realMine(SIM_DECISION);
    const decisionLeg = makeLeg({
      id: 'tutu-live-hedge-decision', source: 'live', trade_record_id: 'dh-order', leg_role: 'hedge_initial_a', leg_sequence: 2,
      direction: 'short', pre_simulated_time: iso(SIM_DECISION), pre_real_time: iso(REAL_DECISION), pre_entry_price: 0.03005,
      pre_timeline_id: 'mine',
    });
    journals = [mainLeg(), decisionLeg];
    campaign.actual_evolution = [attachedEvent(journals[0], 'mine', SIM0), { ...attachedEvent(decisionLeg, 'mine', SIM_DECISION), close_time: null, operation_time: iso(REAL_DECISION) }];
    store({
      tradeHistory: [mineMainRecord()],
      cancelled: [
        stampedHedge('first-try', [SIM_DECISION, REAL_DECISION - 60_000, 'mine'], [SIM_DECISION, REAL_DECISION - 30_000, 'mine']),
        stampedHedge('dh-order', [SIM_DECISION, REAL_DECISION + 1_000, 'mine'], [SIM_CLOSE, realMine(SIM_CLOSE) + 1_000, 'mine']),
      ],
      registry: registryOf(mineRoot()),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => order.id).sort()).toEqual(['dh-order', 'first-try']);
    expectExact(timelineDiagnostics, ['dh-order', 'first-try']);
  });

  it('【复核四 F2】主力 A 遍（09-11）开、B 遍（09-13 倒回）平：夹在中间 09-12 那次坐下来的单（撤在 B 遍 / 至今挂着）不算', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_A, closedRealAt: REAL_B + 6 * MIN, openedTimelineId: 'A', closedTimelineId: 'B' })],
      cancelled: [
        stampedHedge('A-hedge', [sim(60), REAL_A + MIN, 'A'], [sim(600), REAL_A + 5 * MIN, 'A'], 0.0301),
        stampedHedge('other-cancelled-in-B', [sim(300), REAL_DAY2, 'day2'], [sim(270), REAL_B + 2 * MIN, 'B'], 0.0299),
        stampedHedge('B-hedge', [sim(260), REAL_B + MIN, 'B'], [sim(900), REAL_B + 3 * MIN, 'B'], 0.0298),
      ],
      pending: [shortPending('other-live', sim(320), REAL_DAY2 + MIN, 'day2', 0.0297)],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_A - MIN, forkSimTime: sim(-3), lastSimTime: sim(600) }),
        rewind('day2', 'A', REAL_DAY2 - MIN, sim(250), carry([MAIN_POSITION]), { lastSimTime: sim(320) }),
        rewind('B', 'day2', REAL_B - MIN, sim(250), carry([MAIN_POSITION], ['other-cancelled-in-B', 'other-live'])),
      ),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['A-hedge', 'B-hedge']);
    expect(pendingOrders).toEqual([]);
    expectExact(timelineDiagnostics, ['A-hedge', 'B-hedge']);
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'B']);
  });

  it('【复核四 F3】A 遍 19:42 挂的单在跳回之后、B 遍走回 19:42 之前就撤：没活进 B 遍，被取代', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [rewoundMainRecord(REAL_PASS_A)],
      cancelled: [
        stampedHedge('passA-late', [sim(120), REAL_PASS_A + 3 * MIN, 'A'], [sim(180), REAL_PASS_A + 5 * MIN, 'A'], 0.0297),
        stampedHedge('passA-0300500-1942', [sim(1) + 20_000, REAL_PASS_A + 30_000, 'A'], [sim(-1), REAL_REWIND, 'B']),
        hedge('passB-0300500-1942', sim(1), sim(6 * 60), {
          createdRealAt: realMine(sim(1)), cancelledRealAt: realMine(sim(6 * 60)), createdTimelineId: 'B', cancelledTimelineId: 'B',
        }),
      ],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_PASS_A - MIN, forkSimTime: sim(-3), lastSimTime: sim(180) }),
        rewind('B', 'A', REAL_REWIND - 10_000, sim(-1), carry([MAIN_POSITION], ['passA-0300500-1942'])),
      ),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passB-0300500-1942']);
    expectExact(timelineDiagnostics, ['passB-0300500-1942']);
  });

  it('【复核四 F4】进行中的战役隔天回来先撤掉前一天的旧单、再倒回另起一遍：那一遍不算本场，也不取代前一天本场的单', async () => {
    const REAL_DAY3 = t('2026-09-13T11:34:00.000Z');
    openCampaign();
    journals = [liveMainLeg('A', REAL_DAY1)];
    store({
      tradeHistory: [],
      cancelled: [
        stampedHedge('day1-hedge', [sim(5), REAL_DAY1 + MIN, 'A'], [sim(10), REAL_DAY1 + 2 * MIN, 'A'], 0.0301),
        stampedHedge('day1-leftover', [sim(60), REAL_DAY1 + 3 * MIN, 'A'], [sim(61), REAL_DAY3, 'A'], 0.0299),
      ],
      pending: [shortPending('day3-rewound-replay', sim(20), REAL_DAY3 + 3 * MIN, 'B', 0.0298)],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_DAY1 - MIN, forkSimTime: sim(-2), lastSimTime: sim(61) }),
        rewind('B', 'A', REAL_DAY3 + MIN, sim(20), carry([MAIN_POSITION])),
      ),
    });

    const { pendingOrders, reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(pendingOrders).toEqual([]);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['day1-hedge', 'day1-leftover']);
    expectExact(timelineDiagnostics, ['day1-hedge', 'day1-leftover']);
    expect(timelineDiagnostics.timelineIds).toEqual(['A']);
  });

  it('【复核五 F1】当天带着主力倒回出来的那一遍隔天接着打（没有分叉）仍是本场；隔天再倒回另起的一遍不算', async () => {
    openCampaign();
    journals = [liveMainLeg('A', REAL_DAY1)];
    store({
      tradeHistory: [],
      cancelled: [
        stampedHedge('passA-hedge', [sim(60), REAL_DAY1 + MIN, 'A'], [sim(70), REAL_DAY1 + 2 * MIN, 'A'], 0.0301),
        stampedHedge('day2-passB-cancelled', [sim(140), REAL_DAY2 + MIN, 'B'], [sim(150), REAL_DAY2 + 2 * MIN, 'B'], 0.0298),
        stampedHedge('day2-rewound-replay', [sim(20), REAL_DAY2 + 30 * MIN, 'C'], [sim(25), REAL_DAY2 + 31 * MIN, 'C'], 0.0297),
      ],
      pending: [
        shortPending('day1-passB-live', sim(15), REAL_DAY1 + 11 * MIN, 'B', 0.03),
        shortPending('day2-passB-live', sim(40), REAL_DAY2, 'B', 0.0299),
      ],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_DAY1 - MIN, forkSimTime: sim(-2), lastSimTime: sim(70) }),
        rewind('B', 'A', REAL_DAY1 + 10 * MIN, sim(15), carry([MAIN_POSITION]), { lastSimTime: sim(150) }),
        rewind('C', 'B', REAL_DAY2 + 29 * MIN, sim(20), carry([MAIN_POSITION], ['day1-passB-live', 'day2-passB-live'])),
      ),
    });

    const { pendingOrders, reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(pendingOrders.map(order => order.id)).toEqual(['day1-passB-live', 'day2-passB-live']);
    expect(reverseHedgeOrders.map(order => order.id).sort()).toEqual(['day1-passB-live', 'day2-passB-cancelled', 'day2-passB-live']);
    expectExact(timelineDiagnostics, ['day1-passB-live', 'day2-passB-cancelled', 'day2-passB-live']);
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'B']);
  });

  it('【复核五 F2】A 遍挂的条件空单在倒回那一刻就触发：成交盖在 B 遍上，它活进了 B 遍', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [rewoundMainRecord(REAL_PASS_A)],
      cancelled: [
        stampedHedge('passA-abandoned', [sim(200), REAL_PASS_A + 4 * MIN, 'A'], [sim(300), REAL_PASS_A + 5 * MIN, 'A'], 0.0297),
        hedge('passB-hedge', sim(150), sim(6 * 60), {
          createdRealAt: realMine(sim(150)), cancelledRealAt: realMine(sim(6 * 60)), createdTimelineId: 'B', cancelledTimelineId: 'B',
        }, 0.0298),
      ],
      filled: [shortFill('passA-cond-triggered-on-rewind', sim(120), sim(10), {
        createdRealAt: REAL_PASS_A + 3 * MIN, filledRealAt: REAL_REWIND + 2_000, createdTimelineId: 'A', filledTimelineId: 'B',
      }, 'passA-cond-position', 0.0301)],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_PASS_A - MIN, forkSimTime: sim(-3), lastSimTime: sim(300) }),
        rewind('B', 'A', REAL_REWIND, sim(10), carry([MAIN_POSITION], ['passA-cond-triggered-on-rewind'])),
      ),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => order.id).sort()).toEqual(['passA-cond-triggered-on-rewind', 'passB-hedge']);
    expectExact(timelineDiagnostics, ['passA-cond-triggered-on-rewind', 'passB-hedge']);
  });
});

describe('【盖章等价】复核六 ~ 复核七：夹在本场两次坐下来之间的另一次回放', () => {
  const aHedge = () => stampedHedge('A-hedge', [sim(60), REAL_A + MIN, 'A'], [sim(180), REAL_A + 3 * MIN, 'A'], 0.0301);
  const aHedgeLate = () => stampedHedge('A-hedge-late', [sim(400), REAL_A + 5 * MIN, 'A'], [sim(600), REAL_A + 7 * MIN, 'A'], 0.03);
  const day2OtherCancelled = () => stampedHedge('day2-other-cancelled', [sim(62), REAL_DAY2, 'day2'], [sim(100), REAL_DAY2 + 5 * MIN, 'day2'], 0.0299);
  const bHedge = () => stampedHedge('B-hedge', [sim(620), REAL_B + MIN, 'C'], [sim(900), REAL_B + 3 * MIN, 'C'], 0.0298);
  const day2OtherLive = () => shortPending('day2-other-live', sim(90), REAL_DAY2 + 3 * MIN, 'day2', 0.0297);
  /** A 遍 09-11 停在 sim+600m；09-12 另坐下来倒回回放同一段（带着主力）；09-13 往前一跳到 sim+620m 回到本场。 */
  const threeDayTree = (
    carriedIntoC: string[],
    over: { day2?: Partial<ReplayTimelineNode>; c?: Partial<ReplayTimelineNode> } = {},
  ) => registryOf(
    tl('A', { startedRealAt: REAL_A - MIN, forkSimTime: sim(-3), lastSimTime: sim(600) }),
    rewind('day2', 'A', REAL_DAY2, sim(60), carry([MAIN_POSITION]), { lastSimTime: sim(100), ...over.day2 }),
    rewind('C', 'day2', REAL_B - 20_000, sim(620), carry([MAIN_POSITION], carriedIntoC), over.c),
  );
  const closedOnC = () => mainRecord({ openedRealAt: REAL_A, closedRealAt: REAL_B + 6 * MIN, openedTimelineId: 'A', closedTimelineId: 'C' });

  it('【复核六 F1】已结束：09-12 的单不算本场，09-11 本场的单也不被它取代；09-13 往前一跳接回本场的算', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [closedOnC()],
      cancelled: [aHedge(), aHedgeLate(), day2OtherCancelled(), bHedge()],
      pending: [day2OtherLive()],
      registry: threeDayTree(['day2-other-live']),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['A-hedge', 'A-hedge-late', 'B-hedge']);
    expect(pendingOrders).toEqual([]);
    expectExact(timelineDiagnostics, ['A-hedge', 'A-hedge-late', 'B-hedge']);
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'C']);
  });

  it('【复核六 F1】进行中：09-13 往前一跳回到本场记录加仓、挂对冲：持仓面板与委托层都不混进 09-12 的单', async () => {
    openCampaign();
    journals = [liveMainLeg('A', REAL_A), liveAddLeg('C', sim(610), REAL_B)];
    store({
      tradeHistory: [],
      cancelled: [aHedge(), aHedgeLate(), day2OtherCancelled()],
      pending: [
        shortPending('A-live', sim(300), REAL_A + 4 * MIN, 'A', 0.0302),
        day2OtherLive(),
        shortPending('day3-hedge-live', sim(615), REAL_B + 2 * MIN, 'C', 0.0296),
      ],
      registry: threeDayTree(['A-live', 'day2-other-live'], { day2: { carried: carry([MAIN_POSITION], ['A-live']) } }),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(pendingOrders.map(order => order.id)).toEqual(['A-live', 'day3-hedge-live']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['A-hedge', 'A-live', 'A-hedge-late', 'day3-hedge-live']);
    expectExact(timelineDiagnostics, ['A-hedge', 'A-live', 'A-hedge-late', 'day3-hedge-live']);
  });

  it('【复核六 F2】两张对冲只有一张平掉：还开着的那张不借用另一张的平仓记录；精确联结（fillId + 章）与从前同一结果', async () => {
    journals = [mainLeg()];
    const hedgeCloseRecord = (id: string, positionId: string, openTime: number, closeTime: number, realOf: (simAt: number) => number, line: string) => ({
      ...mainRecord({ openedRealAt: realOf(openTime), closedRealAt: realOf(closeTime), openedTimelineId: line, closedTimelineId: line }),
      id, positionId, fillId: positionId, side: 'SHORT', entryPrice: 0.0299, exitPrice: 0.0295, openTime, closeTime,
    } as TradeRecord);
    store({
      tradeHistory: [mineMainRecord(), hedgeCloseRecord('rec-hedge-a', 'pos-a', sim(360), sim(540), realMine, 'mine')],
      filled: [
        shortFill('hedge-a', sim(350), sim(360), { createdRealAt: realMine(sim(350)), filledRealAt: realMine(sim(360)), createdTimelineId: 'mine', filledTimelineId: 'mine' }, 'pos-a', 0.0299),
        shortFill('hedge-b', sim(355), sim(363), { createdRealAt: realMine(sim(355)), filledRealAt: realMine(sim(363)), createdTimelineId: 'mine', filledTimelineId: 'mine' }, 'pos-b', 0.03),
      ],
      registry: registryOf(mineRoot()),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => [order.id, order.tradeRecordId, order.cancelledAt])).toEqual([
      ['hedge-a', 'rec-hedge-a', sim(540)],
      ['hedge-b', null, null],
    ]);
    expectExact(timelineDiagnostics, ['hedge-a', 'hedge-b']);

    // 另一次回放同一段行情留下的平仓记录：章不同、fillId 不同，接不上
    store({
      tradeHistory: [mineMainRecord(), hedgeCloseRecord('rec-other-replay', 'pos-other-replay', sim(366), sim(540), realOther, 'other')],
      filled: [shortFill('hedge-mine', sim(350), sim(360), { createdRealAt: realMine(sim(350)), filledRealAt: realMine(sim(360)), createdTimelineId: 'mine', filledTimelineId: 'mine' }, 'pos-mine', 0.0299)],
      registry: registryOf(mineRoot(), otherRoot()),
    });
    const second = await getCampaignFullData(campaign.id, { heal: false });
    expect(second.reverseHedgeOrders.map(order => [order.id, order.tradeRecordId, order.cancelledAt])).toEqual([['hedge-mine', null, null]]);
    expectExact(second.timelineDiagnostics, ['hedge-mine']);
  });

  it('【复核七 F1】已结束：09-12 一回来先撤掉本场的旧单（钟还停在 A 遍）、再倒回回放同一段：那一遍不算本场，本场的单一张不少', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [closedOnC()],
      cancelled: [
        aHedge(), aHedgeLate(),
        stampedHedge('A-leftover', [sim(500), REAL_A + 6 * MIN, 'A'], [sim(600), REAL_DAY2 - MIN, 'A'], 0.0303),
        day2OtherCancelled(), bHedge(),
      ],
      pending: [day2OtherLive()],
      registry: threeDayTree(['day2-other-live']),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['A-hedge', 'A-hedge-late', 'A-leftover', 'B-hedge']);
    expect(pendingOrders).toEqual([]);
    expectExact(timelineDiagnostics, ['A-hedge', 'A-hedge-late', 'A-leftover', 'B-hedge']);
  });

  it('【复核七 F1】进行中：09-12 一回来撤掉本场挂着的单、再倒回回放同一段，09-13 往前一跳回到本场：持仓面板不混进 09-12 的单', async () => {
    openCampaign();
    journals = [liveMainLeg('A', REAL_A), liveAddLeg('C', sim(610), REAL_B)];
    store({
      tradeHistory: [],
      cancelled: [
        aHedge(), aHedgeLate(),
        stampedHedge('A-live', [sim(300), REAL_A + 4 * MIN, 'A'], [sim(600), REAL_DAY2 - MIN, 'A'], 0.0302),
        day2OtherCancelled(),
      ],
      pending: [day2OtherLive(), shortPending('day3-hedge-live', sim(615), REAL_B + 2 * MIN, 'C', 0.0296)],
      registry: threeDayTree(['day2-other-live']),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(pendingOrders.map(order => order.id)).toEqual(['day3-hedge-live']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['A-hedge', 'A-live', 'A-hedge-late', 'day3-hedge-live']);
    expectExact(timelineDiagnostics, ['A-hedge', 'A-live', 'A-hedge-late', 'day3-hedge-live']);
  });

  it('【复核七 F2】已结束：09-13 一回来先撤掉 / 触发了 09-12 留下的旧单（钟还停在那次），再往前一跳回到本场：09-11 本场的单不被取代', async () => {
    journals = [mainLeg()];
    const leftoverVariants: { cancelled: CancelledOrderSnapshot[]; filled: FilledOrderSnapshot[]; carriedIntoC: string[] }[] = [
      {
        cancelled: [stampedHedge('day2-other-leftover', [sim(90), REAL_DAY2 + 3 * MIN, 'day2'], [sim(100), REAL_B - 30_000, 'day2'], 0.0297)],
        filled: [],
        carriedIntoC: [],
      },
      {
        cancelled: [],
        filled: [shortFill('day2-other-leftover', sim(90), sim(100) + 20_000, {
          createdRealAt: REAL_DAY2 + 3 * MIN, filledRealAt: REAL_B - MIN, createdTimelineId: 'day2', filledTimelineId: 'day2',
        }, 'day2-other-position', 0.0297)],
        carriedIntoC: ['day2-other-position'],
      },
    ];
    for (const leftover of leftoverVariants) {
      store({
        tradeHistory: [closedOnC()],
        cancelled: [aHedge(), aHedgeLate(), day2OtherCancelled(), bHedge(), ...leftover.cancelled],
        filled: leftover.filled,
        registry: threeDayTree([], { c: { carried: carry([MAIN_POSITION, ...leftover.carriedIntoC]) } }),
      });

      const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

      expect(reverseHedgeOrders.map(order => order.id)).toEqual(['A-hedge', 'A-hedge-late', 'B-hedge']);
      expectExact(timelineDiagnostics, ['A-hedge', 'A-hedge-late', 'B-hedge']);
    }
  });

  it('【复核七 F2】进行中：09-13 先撤掉 09-12 留下的旧单，再往前一跳回到本场挂对冲（没有记录新的决策）：这张对冲仍是本场', async () => {
    openCampaign();
    journals = [liveMainLeg('A', REAL_A)];
    store({
      tradeHistory: [],
      cancelled: [
        aHedge(), aHedgeLate(), day2OtherCancelled(),
        stampedHedge('day2-other-leftover', [sim(90), REAL_DAY2 + 3 * MIN, 'day2'], [sim(100), REAL_B - 30_000, 'day2'], 0.0297),
      ],
      pending: [
        shortPending('A-live', sim(300), REAL_A + 4 * MIN, 'A', 0.0302),
        shortPending('day3-hedge-live', sim(615), REAL_B + 2 * MIN, 'C', 0.0296),
      ],
      registry: threeDayTree(['A-live'], { day2: { carried: carry([MAIN_POSITION], ['A-live']) }, c: { forkSimTime: sim(612) } }),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(pendingOrders.map(order => order.id)).toEqual(['A-live', 'day3-hedge-live']);
    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['A-hedge', 'A-live', 'A-hedge-late', 'day3-hedge-live']);
    expectExact(timelineDiagnostics, ['A-hedge', 'A-live', 'A-hedge-late', 'day3-hedge-live']);
    // 没有新的决策，C 靠「往前一跳回到本场停下处」进本场
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'C']);
  });

  it('【复核七 F3】A 遍挂的单活过了倒回出来的 B 遍，又一次倒回后没等 C 遍走回它就撤掉：仍是被放弃的时间线；至今挂着的保留', async () => {
    openCampaign();
    journals = [liveMainLeg('A', REAL_A), liveAddLeg('B', sim(620), REAL_A + 15 * MIN)];
    store({
      tradeHistory: [],
      cancelled: [
        stampedHedge('passA-late', [sim(900), REAL_A + 10 * MIN, 'A'], [sim(1000), REAL_A + 12 * MIN, 'A'], 0.0301),
        stampedHedge('passA-carried-abandoned', [sim(240), REAL_A + 5 * MIN, 'A'], [sim(170), REAL_A + 20 * MIN, 'C'], 0.03),
      ],
      pending: [shortPending('passC-hedge', sim(260), REAL_A + 22 * MIN, 'C', 0.0299)],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_A - MIN, forkSimTime: sim(-2), lastSimTime: sim(1000) }),
        rewind('B', 'A', REAL_A + 13 * MIN, sim(600), carry([MAIN_POSITION], ['passA-carried-abandoned']), { lastSimTime: sim(620) }),
        rewind('C', 'B', REAL_A + 18 * MIN, sim(140), carry([MAIN_POSITION], ['passA-carried-abandoned'])),
      ),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passC-hedge']);
    expect(pendingOrders.map(order => order.id)).toEqual(['passC-hedge']);
    expectExact(timelineDiagnostics, ['passC-hedge']);
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'B', 'C']);
  });

  it('【复核七 F4】进行中的战役带着还开着的对冲仓位倒回：开出它的委托（含并进同一仓位的后一笔）仍在；仓位已不在的照样被取代', async () => {
    openCampaign();
    journals = [liveMainLeg('A', REAL_A), liveAddLeg('B', sim(92), REAL_A + 20 * MIN)];
    store({
      tradeHistory: [],
      filled: [
        shortFill('hedge-open', sim(172), sim(228), { createdRealAt: REAL_A + 5 * MIN, filledRealAt: REAL_A + 8 * MIN, createdTimelineId: 'A', filledTimelineId: 'A' }, 'pos-hedge', 0.03),
        shortFill('hedge-merged', sim(180), sim(232), { createdRealAt: REAL_A + 6 * MIN, filledRealAt: REAL_A + 9 * MIN, createdTimelineId: 'A', filledTimelineId: 'A' }, 'fill-merged', 0.0301),
        shortFill('hedge-gone', sim(175), sim(230), { createdRealAt: REAL_A + 5 * MIN + 30_000, filledRealAt: REAL_A + 8 * MIN + 30_000, createdTimelineId: 'A', filledTimelineId: 'A' }, 'pos-gone', 0.0298),
      ],
      pending: [shortPending('passB-hedge', sim(260), REAL_A + 25 * MIN, 'B', 0.0299)],
      positions: [{
        id: 'pos-hedge', side: 'SHORT', entryPrice: 0.03005, quantity: 20_000, leverage: 5, marginMode: 'isolated', margin: 120,
        openTimelineId: 'A',
        fills: [
          { id: 'pos-hedge', openTime: sim(228), entryPrice: 0.03, units: 10_000, timelineId: 'A' },
          { id: 'fill-merged', openTime: sim(232), entryPrice: 0.0301, units: 10_000, timelineId: 'A' },
        ],
      }],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_A - MIN, forkSimTime: sim(-2), lastSimTime: sim(240) }),
        rewind('B', 'A', REAL_A + 19 * MIN, sim(90), carry([MAIN_POSITION, 'pos-hedge'], [], [MAIN_POSITION, 'pos-hedge', 'fill-merged'])),
      ),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['hedge-open', 'hedge-merged', 'passB-hedge']);
    expect(pendingOrders.map(order => order.id)).toEqual(['passB-hedge']);
    expectExact(timelineDiagnostics, ['hedge-open', 'hedge-merged', 'passB-hedge']);
  });
});

describe('【盖章等价】复核六：本场停下处被之后接上 / 回到本场时低于停下处 / 倒放', () => {
  const H = 60;
  const REAL_DAY3 = t('2026-09-13T10:00:00.000Z');

  it('【复核六】已结束：当天带着主力倒回出来的 B 遍隔两天接着打到平仓，中间那天回放到比 B 遍更晚的行情：B 遍照样是本场、照样取代 A 遍', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_DAY1, closedRealAt: REAL_DAY3 + 30 * MIN, openedTimelineId: 'A', closedTimelineId: 'day3' })],
      cancelled: [
        // A 遍 sim+8h 挂的，倒回之后在 B 遍的钟上（sim+3h）撤掉：没活进 B 遍，被 B 遍重走
        stampedHedge('passA-late', [sim(8 * H), REAL_DAY1 + 5 * MIN, 'A'], [sim(3 * H), REAL_DAY1 + 10 * MIN, 'B'], 0.0301),
        // B 遍挂的，第三天接着 B 遍打到 sim+15h 才撤
        stampedHedge('passB', [sim(3 * H + 6), REAL_DAY1 + 12 * MIN, 'B'], [sim(15 * H), REAL_DAY3 + 10 * MIN, 'day3'], 0.03),
        stampedHedge('other-early', [sim(2 * H), REAL_DAY2, 'day2'], [sim(10 * H), REAL_DAY2 + 5 * MIN, 'day2'], 0.0299),
        stampedHedge('other-late', [sim(25 * H), REAL_DAY2 + 10 * MIN, 'day2'], [sim(28 * H), REAL_DAY2 + 15 * MIN, 'day2'], 0.0298),
      ],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_DAY1 - MIN, forkSimTime: sim(-3), lastSimTime: sim(8 * H) }),
        rewind('B', 'A', REAL_DAY1 + 9 * MIN, sim(3 * H), carry([MAIN_POSITION])),
        rewind('day2', 'B', REAL_DAY2 - MIN, sim(2 * H), carry([MAIN_POSITION]), { lastSimTime: sim(28 * H) }),
        rewind('day3', 'day2', REAL_DAY3 + 9 * MIN, sim(15 * H), carry([MAIN_POSITION])),
      ),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passB']);
    expectExact(timelineDiagnostics, ['passB']);
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'B', 'day3']);
    expect(idsWhere(timelineDiagnostics, 'out')).toEqual(['other-early', 'other-late', 'passA-late']);
  });

  it('【复核六】回到本场时低于本场停下处（倒回另起一遍）：那一遍是新的时间线、取代 A 遍，中间那次回放同样不算本场', async () => {
    journals = [mainLeg()];
    store({
      tradeHistory: [mainRecord({ openedRealAt: REAL_DAY1, closedRealAt: REAL_DAY3 + 30 * MIN, openedTimelineId: 'A', closedTimelineId: 'day3' })],
      cancelled: [
        stampedHedge('passA-late', [sim(20 * H), REAL_DAY1 + 20 * MIN, 'A'], [sim(25 * H), REAL_DAY1 + 25 * MIN, 'A'], 0.0301),
        stampedHedge('other-day2', [sim(5 * H), REAL_DAY2 + 5 * MIN, 'day2'], [sim(8 * H), REAL_DAY2 + 6 * MIN, 'day2'], 0.0299),
        // 第三天回到 sim+15h：高于那次回放、低于本场停下的 sim+25h，是倒回重打本场
        stampedHedge('passB', [sim(15 * H), REAL_DAY3, 'day3'], [sim(25 * H), REAL_DAY3 + 10 * MIN, 'day3'], 0.03),
      ],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_DAY1 - MIN, forkSimTime: sim(-3), lastSimTime: sim(25 * H) }),
        rewind('day2', 'A', REAL_DAY2 + 4 * MIN, sim(5 * H), carry([MAIN_POSITION]), { lastSimTime: sim(8 * H) }),
        rewind('day3', 'day2', REAL_DAY3 - MIN, sim(15 * H), carry([MAIN_POSITION])),
      ),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['passB']);
    expectExact(timelineDiagnostics, ['passB']);
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'day3']);
  });

  it('【倒放】翻转方向是分叉、重走判据镜像：正放到 sim+5h 翻转倒放，A 遍高于倒放有证据入口的单保留、入口以下的被取代；启发式把倒放里每次盖章都当成回落切段，分歧只进影子比对', async () => {
    openCampaign();
    journals = [liveMainLeg('A')];
    const S = 1_000;
    store({
      tradeHistory: [],
      cancelled: [
        stampedHedge('a-2h', [sim(2 * H), REAL_MINE + 10 * S, 'A'], [sim(2 * H + 5), REAL_MINE + 20 * S, 'A'], 0.0301),
        stampedHedge('a-4h', [sim(4 * H), REAL_MINE + 30 * S, 'A'], [sim(4 * H + 5), REAL_MINE + 40 * S, 'A'], 0.03),
        stampedHedge('a-4h50', [sim(4 * H + 50), REAL_MINE + 50 * S, 'A'], [sim(4 * H + 55), REAL_MINE + 60 * S, 'A'], 0.0299),
        // 倒放里挂了又撤：撤单的模拟时刻低于挂单（钟往下走）
        stampedHedge('rev-4h30', [sim(4 * H + 30), REAL_MINE + 80 * S, 'rev'], [sim(4 * H + 20), REAL_MINE + 90 * S, 'rev'], 0.0298),
      ],
      pending: [shortPending('rev-3h', sim(3 * H), REAL_MINE + 100 * S, 'rev', 0.0297)],
      registry: registryOf(
        tl('A', { startedRealAt: REAL_MINE - MIN, forkSimTime: sim(-5), lastSimTime: sim(5 * H) }),
        tl('rev', { parentId: 'A', cause: 'direction', direction: -1, forkSimTime: sim(5 * H), startedRealAt: REAL_MINE + 70 * S, carried: carry([MAIN_POSITION]) }),
      ),
    });

    const { reverseHedgeOrders, pendingOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id, { heal: false });

    expect(timelineDiagnostics.mode).toBe('exact');
    expect(timelineDiagnostics.timelineIds).toEqual(['A', 'rev']);
    expect(idsWhere(timelineDiagnostics, 'in')).toEqual(['a-4h50', 'rev-3h', 'rev-4h30']);
    expect(idsWhere(timelineDiagnostics, 'out')).toEqual(['a-2h', 'a-4h']);
    expect(pendingOrders.map(order => order.id)).toEqual(['rev-3h']);
    // 启发式：倒放里的每一次盖章都是一次模拟回落，各自切成不含锚点的段（进行中的战役照样保留），
    // 于是 a-4h50 被 sim+4h30 那一段「重走」，a-2h 反倒低于每一段的重走起点而保留——与精确判定正好相反
    expect(reverseHedgeOrders.map(order => order.id).sort()).toEqual(['a-2h', 'rev-3h', 'rev-4h30']);
    expect([...timelineDiagnostics.disagreements].sort((a, b) => a.orderId.localeCompare(b.orderId))).toEqual([
      { orderId: 'a-2h', heuristic: true, exact: 'out' },
      { orderId: 'a-4h50', heuristic: false, exact: 'in' },
    ]);
  });
});

describe('【盖章等价】老战役 / 跨上线的 mixed / 登记表缺节点的 defer', () => {
  it('【老战役】本场一个盖了章的锚点都没有：精确判定不开工（heuristic），启发式照旧', async () => {
    const REAL_JUNE = t('2026-06-20T12:00:00.000Z');
    journals = [retroLeg({
      id: 'tutu-june-main-leg', trade_record_id: 'tutu-main-record', leg_role: 'main_open', direction: 'long',
      pre_simulated_time: iso(SIM0), pre_entry_price: 0.0312,
    })];
    store({
      tradeHistory: [mainRecord({ closedRealAt: REAL_JUNE + 5 * MIN })],
      cancelled: [hedge('june-0300500-1942', sim(1), sim(6 * 60)), otherHedge('other-0300500-1942', sim(1) + 15_000, sim(6 * 60))],
      registry: registryOf(otherRoot()),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['june-0300500-1942']);
    expect(timelineDiagnostics).toEqual({
      mode: 'heuristic', timelineIds: [], anchorTimelineIds: [], unstampedAnchors: 0, missingAnchorNodes: [], verdicts: {}, disagreements: [],
    });
  });

  it('【复核二 F8】6 月的老战役之后 9 月从它平仓后的行情接着打：同样是老战役，精确判定不开工', async () => {
    const REAL_JUNE = t('2026-06-20T12:00:00.000Z');
    const REAL_SEPT = t('2026-09-10T13:00:00.000Z');
    journals = [retroLeg({
      id: 'tutu-june-main-leg', trade_record_id: 'tutu-main-record', leg_role: 'main_open', direction: 'long',
      pre_simulated_time: iso(SIM0), pre_entry_price: 0.0312,
    })];
    store({
      tradeHistory: [mainRecord({ closedRealAt: REAL_JUNE + 5 * MIN })],
      cancelled: [
        hedge('june-hedge', sim(30), SIM_CLOSE + 120 * MIN),
        stampedHedge('sept-unrelated', [SIM_CLOSE + 60 * MIN, REAL_SEPT, 'sept'], [SIM_CLOSE + 70 * MIN, REAL_SEPT + MIN, 'sept']),
      ],
      registry: registryOf(tl('sept', { startedRealAt: REAL_SEPT - MIN, forkSimTime: SIM_CLOSE + 50 * MIN })),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => `${order.id}|${order.status}`)).toEqual(['june-hedge|cancelled']);
    expect(timelineDiagnostics.mode).toBe('heuristic');
  });

  it('【复核·跨上线 → mixed】主力在时间线上线之前开、刷新到新代码后在 bootstrap 根上平：盖了章的算，没章的一律 defer，无关的根 out', async () => {
    const REAL_POST_ROLLOUT = t('2026-09-08T02:00:00.000Z');
    journals = [retroLeg({
      id: 'tutu-straddle-main-leg', trade_record_id: 'tutu-main-record', leg_role: 'main_open', direction: 'long',
      pre_simulated_time: iso(SIM0), pre_entry_price: 0.0312,
    })];
    store({
      tradeHistory: [mainRecord({ closedRealAt: REAL_POST_ROLLOUT + 30 * MIN, closedTimelineId: 'boot' })],
      cancelled: [
        hedge('pre-rollout-hedge', sim(1), sim(30)),
        stampedHedge('post-rollout-hedge', [sim(60), REAL_POST_ROLLOUT, 'boot'], [sim(90), REAL_POST_ROLLOUT + MIN, 'boot']),
        hedge('unstamped-after-rollout', sim(120), sim(150), {}, 0.0296),
        stampedHedge('foreign-root-hedge', [sim(100), REAL_OTHER, 'other'], [sim(130), REAL_OTHER + MIN, 'other'], 0.0295),
      ],
      registry: registryOf(
        tl('boot', { cause: 'bootstrap', startedRealAt: REAL_POST_ROLLOUT - MIN, forkSimTime: sim(55), carried: carry([MAIN_POSITION]) }),
        otherRoot(),
      ),
    });

    const { reverseHedgeOrders, timelineDiagnostics } = await getCampaignFullData(campaign.id);

    expect(reverseHedgeOrders.map(order => order.id)).toEqual(['pre-rollout-hedge', 'post-rollout-hedge']);
    expectExact(timelineDiagnostics, ['post-rollout-hedge'], { mode: 'mixed', defer: ['pre-rollout-hedge', 'unstamped-after-rollout'] });
    expect(idsWhere(timelineDiagnostics, 'out')).toEqual(['foreign-root-hedge']);
    expect(timelineDiagnostics.unstampedAnchors).toBe(1);
  });

  it('【defer】章指向登记表里没有的节点：那张委托 defer；登记表整个没同步过来时锚点也找不到，一律 defer、没有分歧', async () => {
    journals = [mainLeg()];
    const orders = [
      mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
      stampedHedge('ghost-hedge', [sim(30), realMine(sim(30)), 'ghost'], [sim(40), realMine(sim(40)), 'ghost'], 0.0301),
    ];
    store({ tradeHistory: [mineMainRecord()], cancelled: orders, registry: registryOf(mineRoot()) });
    const withRoot = await getCampaignFullData(campaign.id);
    expect(withRoot.reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942', 'ghost-hedge']);
    expectExact(withRoot.timelineDiagnostics, ['mine-0300500-1942'], { defer: ['ghost-hedge'] });

    localStorage.removeItem('sim_user-1_replay_timelines_v1');
    const withoutRegistry = await getCampaignFullData(campaign.id);
    expect(withoutRegistry.reverseHedgeOrders.map(order => order.id)).toEqual(['mine-0300500-1942', 'ghost-hedge']);
    expect(withoutRegistry.timelineDiagnostics).toMatchObject({
      mode: 'mixed', timelineIds: [], anchorTimelineIds: ['mine'], missingAnchorNodes: ['mine'], disagreements: [],
    });
    expect(idsWhere(withoutRegistry.timelineDiagnostics, 'defer')).toEqual(['ghost-hedge', 'mine-0300500-1942']);
  });
});
