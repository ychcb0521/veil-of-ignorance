import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CancelledOrderSnapshot, FilledOrderSnapshot, PendingOrder, TradeRecord } from '@/types/trading';

/**
 * 影子读取的对照组：**完全没盖章**的数据（今天的全部存量）走 getCampaignFullData，
 * pendingOrders / reverseHedgeOrders 必须与上线影子比对之前一字不差——
 * 登记表不存在、空登记表、登记表里只有别人的节点（哪怕 carried 里写着这些委托的 id），三种情形字节相同，
 * 且与 campaignReverseHedgeOrders.test.ts 里对应难例的期望一致；影子比对本身报 heuristic、不下任何结论。
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

import { getCampaignFullData } from '../journalApi';

const MIN = 60_000;
const SIM0 = t('2026-08-07T11:41:00.000Z');
const SIM_CLOSE = t('2026-08-08T17:46:00.000Z');
const sim = (minutes: number) => SIM0 + minutes * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const REAL_MINE = t('2026-09-13T11:34:00.000Z');
const realMine = (simAt: number) => REAL_MINE + Math.round((simAt - SIM0) / 360);
const REAL_PASS_A = t('2026-09-13T10:00:00.000Z');
const REAL_A = t('2026-09-11T10:00:00.000Z');
const REAL_DAY2 = t('2026-09-12T10:00:00.000Z');
const REAL_B = t('2026-09-13T11:33:00.000Z');
const REAL_REWIND = t('2026-09-13T11:33:50.000Z');

const hedge = (
  id: string,
  createdAt: number,
  cancelledAt: number,
  stamps: { createdRealAt?: number; cancelledRealAt?: number } = {},
  price = 0.03005,
): CancelledOrderSnapshot => ({
  id, symbol: 'TUTUSDT', side: 'SHORT', type: 'CONDITIONAL', reduceOnly: false, reduceKind: null,
  price, quantity: 10_000, leverage: 5, createdAt, cancelledAt, ...stamps,
});
const mineHedge = (id: string, createdAt: number, cancelledAt: number, price?: number) =>
  hedge(id, createdAt, cancelledAt, { createdRealAt: realMine(createdAt), cancelledRealAt: realMine(cancelledAt) }, price);
const shortFill = (
  id: string, createdAt: number, filledAt: number,
  stamps: { createdRealAt?: number; filledRealAt?: number } = {}, positionId?: string, price = 0.0299,
): FilledOrderSnapshot => ({
  id, symbol: 'TUTUSDT', side: 'SHORT', type: 'CONDITIONAL', reduceOnly: false, reduceKind: null,
  price, triggerPrice: price, quantity: 10_000, leverage: 5, createdAt, filledAt, ...(positionId ? { positionId } : {}), ...stamps,
});
const shortPending = (id: string, createdAt: number, createdRealAt: number | undefined, price = 0.0302): PendingOrder => ({
  id, side: 'SHORT', type: 'CONDITIONAL', price, stopPrice: price, quantity: 10_000, leverage: 5, marginMode: 'isolated',
  status: 'PENDING', createdAt, ...(createdRealAt != null ? { createdRealAt } : {}),
});
const mainRecord = (stamps: { openedRealAt?: number; closedRealAt?: number }): TradeRecord => ({
  id: 'tutu-main-record', positionId: 'tutu-main-position', fillId: 'tutu-main-position', symbol: 'TUTUSDT', side: 'LONG',
  type: 'MARKET', action: 'CLOSE', entryPrice: 0.0312, exitPrice: 0.0335, quantity: 10_000, leverage: 5, pnl: 23, fee: 0, slippage: 0,
  openTime: SIM0, closeTime: SIM_CLOSE, ...stamps,
} as TradeRecord);
const makeLeg = (overrides: Partial<TradeJournal>): TradeJournal => ({
  id: overrides.id ?? `leg-${Math.random().toString(36).slice(2)}`,
  user_id: 'user-1', trade_record_id: null, campaign_id: 'campaign-1', leg_role: 'hedge_rolling', leg_sequence: null,
  source: 'post_review', symbol: 'TUTUSDT', direction: 'short', leverage: 5, position_mode: 'isolated', order_kind: 'trade',
  pre_simulated_time: iso(SIM0), pre_real_time: iso(REAL_MINE), pre_entry_price: null, pre_planned_stop_loss: null,
  pre_planned_take_profit: null, pre_entry_reason: null, pre_mental_state: 3, pre_mental_trigger: null, pre_risk_awareness: null,
  pre_risk_management: null, pre_checklist_items: null, pre_checklist_passed: null, pre_position_size: null, pre_max_loss_usdt: null,
  ...overrides,
} as TradeJournal);
const mainLeg = () => makeLeg({
  id: 'tutu-main-leg', trade_record_id: 'tutu-main-record', leg_role: 'main_open', leg_sequence: 1, direction: 'long',
  source: 'retroactive_from_record', pre_real_time: '2026-09-13T12:10:00.000Z', pre_simulated_time: iso(SIM0), pre_entry_price: 0.0312,
  post_simulated_close_time: iso(SIM_CLOSE), post_real_close_time: iso(realMine(SIM_CLOSE)),
});
const liveMainLeg = (preRealTime = REAL_MINE) => makeLeg({
  id: 'tutu-live-main-leg', source: 'live', leg_role: 'main_open', leg_sequence: 1, direction: 'long',
  pre_simulated_time: iso(SIM0), pre_real_time: iso(preRealTime), pre_entry_price: 0.0312,
});

interface Fixture {
  name: string;
  open?: boolean;
  journals: () => TradeJournal[];
  tradeHistory?: TradeRecord[];
  cancelled?: CancelledOrderSnapshot[];
  filled?: FilledOrderSnapshot[];
  pending?: PendingOrder[];
  positions?: unknown[];
  expectedReverse: string[];
  /** 原测试对委托层只比较集合（.sort()）：这里同样排序后比。 */
  sortedReverse?: boolean;
  expectedPending: string[];
}

/** 与 campaignReverseHedgeOrders.test.ts 同源的无章难例与它们的期望。 */
const fixtures: Fixture[] = [
  {
    name: 'L1：8 月的无章委托不混进盖章时代的本场',
    journals: () => [mainLeg()],
    tradeHistory: [mainRecord({ openedRealAt: realMine(SIM0), closedRealAt: realMine(SIM_CLOSE) })],
    cancelled: [mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)), hedge('aug-0300500-1942', sim(1) + 15_000, sim(5 * 60))],
    pending: [
      shortPending('mine-pending-0288000', sim(20 * 60), realMine(sim(20 * 60)), 0.0288),
      shortPending('aug-pending-0288000', sim(20 * 60) + 20_000, undefined, 0.0288),
    ],
    expectedReverse: ['mine-0300500-1942', 'mine-pending-0288000'],
    expectedPending: ['mine-pending-0288000'],
  },
  {
    name: 'L4：主力 A 遍开、B 遍平，A 遍倒回点之后的单被取代',
    journals: () => [mainLeg()],
    tradeHistory: [mainRecord({ openedRealAt: REAL_PASS_A, closedRealAt: realMine(SIM_CLOSE) })],
    cancelled: [
      hedge('passA-prehedge-1939', sim(-2), sim(90), { createdRealAt: REAL_PASS_A - 30_000, cancelledRealAt: REAL_PASS_A + 5 * MIN }, 0.0301),
      hedge('passA-0300500-1942', sim(1) + 20_000, sim(3 * 60), { createdRealAt: REAL_PASS_A + 30_000, cancelledRealAt: REAL_PASS_A + 6 * MIN }),
      mineHedge('passB-0300500-1942', sim(1), sim(6 * 60)),
    ],
    expectedReverse: ['passA-prehedge-1939', 'passB-0300500-1942'],
    expectedPending: [],
  },
  {
    name: 'C：现实里停了 10 分钟才开主力的前置对冲',
    journals: () => [mainLeg()],
    tradeHistory: [mainRecord({ openedRealAt: REAL_MINE, closedRealAt: realMine(SIM_CLOSE) })],
    cancelled: [
      hedge('prehedge-paused-1939', sim(-2), sim(2 * 60), { createdRealAt: REAL_MINE - 10 * MIN, cancelledRealAt: realMine(sim(2 * 60)) }, 0.0301),
      mineHedge('mine-0300500-1942', sim(1), sim(6 * 60)),
    ],
    expectedReverse: ['prehedge-paused-1939', 'mine-0300500-1942'],
    expectedPending: [],
  },
  {
    name: '复核二 F5：进行中的战役带着主力倒回',
    open: true,
    journals: () => [liveMainLeg()],
    cancelled: [hedge('A-late', sim(590), sim(600), { createdRealAt: REAL_MINE + 5 * MIN, cancelledRealAt: REAL_MINE + 6 * MIN }, 0.0296)],
    pending: [shortPending('A-pending', sim(60), REAL_MINE + MIN, 0.0301), shortPending('B-pending', sim(130), REAL_MINE + 40 * MIN, 0.0299)],
    expectedReverse: ['A-pending', 'B-pending'],
    expectedPending: ['A-pending', 'B-pending'],
  },
  {
    name: '复核七 F1：夹在中间的另一次坐下来',
    journals: () => [mainLeg()],
    tradeHistory: [mainRecord({ openedRealAt: REAL_A, closedRealAt: REAL_B + 6 * MIN })],
    cancelled: [
      hedge('A-hedge', sim(60), sim(180), { createdRealAt: REAL_A + MIN, cancelledRealAt: REAL_A + 3 * MIN }, 0.0301),
      hedge('A-hedge-late', sim(400), sim(600), { createdRealAt: REAL_A + 5 * MIN, cancelledRealAt: REAL_A + 7 * MIN }, 0.03),
      hedge('A-leftover', sim(500), sim(600), { createdRealAt: REAL_A + 6 * MIN, cancelledRealAt: REAL_DAY2 - MIN }, 0.0303),
      hedge('day2-other-cancelled', sim(62), sim(100), { createdRealAt: REAL_DAY2, cancelledRealAt: REAL_DAY2 + 5 * MIN }, 0.0299),
      hedge('B-hedge', sim(620), sim(900), { createdRealAt: REAL_B + MIN, cancelledRealAt: REAL_B + 3 * MIN }, 0.0298),
    ],
    pending: [shortPending('day2-other-live', sim(90), REAL_DAY2 + 3 * MIN, 0.0297)],
    expectedReverse: ['A-hedge', 'A-hedge-late', 'A-leftover', 'B-hedge'],
    expectedPending: [],
  },
  {
    name: '复核七 F4：带着还开着的对冲仓位倒回',
    open: true,
    journals: () => [liveMainLeg(REAL_A), makeLeg({
      id: 'tutu-live-add-leg', source: 'live', leg_role: 'main_add_1', leg_sequence: 2, direction: 'long',
      pre_simulated_time: iso(sim(92)), pre_real_time: iso(REAL_A + 20 * MIN), pre_entry_price: 0.0312,
    })],
    filled: [
      shortFill('hedge-open', sim(172), sim(228), { createdRealAt: REAL_A + 5 * MIN, filledRealAt: REAL_A + 8 * MIN }, 'pos-hedge', 0.03),
      shortFill('hedge-merged', sim(180), sim(232), { createdRealAt: REAL_A + 6 * MIN, filledRealAt: REAL_A + 9 * MIN }, 'fill-merged', 0.0301),
      shortFill('hedge-gone', sim(175), sim(230), { createdRealAt: REAL_A + 5 * MIN + 30_000, filledRealAt: REAL_A + 8 * MIN + 30_000 }, 'pos-gone', 0.0298),
    ],
    pending: [shortPending('passB-hedge', sim(260), REAL_A + 25 * MIN, 0.0299)],
    positions: [{
      id: 'pos-hedge', side: 'SHORT', entryPrice: 0.03005, quantity: 20_000, leverage: 5, marginMode: 'isolated', margin: 120,
      fills: [
        { id: 'pos-hedge', openTime: sim(228), entryPrice: 0.03, units: 10_000 },
        { id: 'fill-merged', openTime: sim(232), entryPrice: 0.0301, units: 10_000 },
      ],
    }],
    expectedReverse: ['hedge-open', 'hedge-merged', 'passB-hedge'],
    expectedPending: ['passB-hedge'],
  },
  {
    name: '复核四 F2：主力 A 遍（09-11）开、B 遍（09-13 倒回）平，夹在中间 09-12 那次坐下来的单不算',
    journals: () => [mainLeg()],
    tradeHistory: [mainRecord({ openedRealAt: REAL_A, closedRealAt: REAL_B + 6 * MIN })],
    cancelled: [
      hedge('A-hedge', sim(60), sim(600), { createdRealAt: REAL_A + MIN, cancelledRealAt: REAL_A + 5 * MIN }, 0.0301),
      hedge('other-cancelled-in-B', sim(300), sim(270), { createdRealAt: REAL_DAY2, cancelledRealAt: REAL_B + 2 * MIN }, 0.0299),
      hedge('B-hedge', sim(260), sim(900), { createdRealAt: REAL_B + MIN, cancelledRealAt: REAL_B + 3 * MIN }, 0.0298),
    ],
    pending: [shortPending('other-live', sim(320), REAL_DAY2 + MIN, 0.0297)],
    expectedReverse: ['A-hedge', 'B-hedge'],
    expectedPending: [],
  },
  {
    name: '复核四 F3：A 遍的单在 B 遍走回它之前就撤，不与 B 遍那张成对出现',
    journals: () => [mainLeg()],
    tradeHistory: [mainRecord({ openedRealAt: REAL_PASS_A, closedRealAt: realMine(SIM_CLOSE) })],
    cancelled: [
      hedge('passA-late', sim(120), sim(180), { createdRealAt: REAL_PASS_A + 3 * MIN, cancelledRealAt: REAL_PASS_A + 5 * MIN }, 0.0297),
      hedge('passA-0300500-1942', sim(1) + 20_000, sim(-1), { createdRealAt: REAL_PASS_A + 30_000, cancelledRealAt: REAL_REWIND }),
      mineHedge('passB-0300500-1942', sim(1), sim(6 * 60)),
    ],
    expectedReverse: ['passB-0300500-1942'],
    expectedPending: [],
  },
  {
    name: '复核五 F2：A 遍挂的条件空单在倒回那一刻就触发',
    journals: () => [mainLeg()],
    tradeHistory: [mainRecord({ openedRealAt: REAL_PASS_A, closedRealAt: realMine(SIM_CLOSE) })],
    cancelled: [
      hedge('passA-abandoned', sim(200), sim(300), { createdRealAt: REAL_PASS_A + 4 * MIN, cancelledRealAt: REAL_PASS_A + 5 * MIN }, 0.0297),
      mineHedge('passB-hedge', sim(150), sim(6 * 60), 0.0298),
    ],
    filled: [shortFill('passA-cond-triggered-on-rewind', sim(120), sim(10), {
      createdRealAt: REAL_PASS_A + 3 * MIN, filledRealAt: REAL_REWIND + 2_000,
    }, 'passA-cond-position', 0.0301)],
    expectedReverse: ['passA-cond-triggered-on-rewind', 'passB-hedge'],
    sortedReverse: true,
    expectedPending: [],
  },
  {
    name: '复核六 F1：09-12 另坐下来回放同一段，09-13 往前一跳回到本场接着打到平仓',
    journals: () => [mainLeg()],
    tradeHistory: [mainRecord({ openedRealAt: REAL_A, closedRealAt: REAL_B + 6 * MIN })],
    cancelled: [
      hedge('A-hedge', sim(60), sim(180), { createdRealAt: REAL_A + MIN, cancelledRealAt: REAL_A + 3 * MIN }, 0.0301),
      hedge('A-hedge-late', sim(400), sim(600), { createdRealAt: REAL_A + 5 * MIN, cancelledRealAt: REAL_A + 7 * MIN }, 0.03),
      hedge('day2-other-cancelled', sim(62), sim(100), { createdRealAt: REAL_DAY2, cancelledRealAt: REAL_DAY2 + 5 * MIN }, 0.0299),
      hedge('B-hedge', sim(620), sim(900), { createdRealAt: REAL_B + MIN, cancelledRealAt: REAL_B + 3 * MIN }, 0.0298),
    ],
    pending: [shortPending('day2-other-live', sim(90), REAL_DAY2 + 3 * MIN, 0.0297)],
    expectedReverse: ['A-hedge', 'A-hedge-late', 'B-hedge'],
    expectedPending: [],
  },
  {
    name: '复核七 F3：A 遍挂的单活过 B 遍、又一次倒回后没等 C 遍走回它就撤掉',
    open: true,
    journals: () => [liveMainLeg(REAL_A), makeLeg({
      id: 'tutu-live-add-leg', source: 'live', leg_role: 'main_add_1', leg_sequence: 2, direction: 'long',
      pre_simulated_time: iso(sim(620)), pre_real_time: iso(REAL_A + 15 * MIN), pre_entry_price: 0.0312,
    })],
    cancelled: [
      hedge('passA-late', sim(900), sim(1000), { createdRealAt: REAL_A + 10 * MIN, cancelledRealAt: REAL_A + 12 * MIN }, 0.0301),
      hedge('passA-carried-abandoned', sim(240), sim(170), { createdRealAt: REAL_A + 5 * MIN, cancelledRealAt: REAL_A + 20 * MIN }, 0.03),
    ],
    pending: [shortPending('passC-hedge', sim(260), REAL_A + 22 * MIN, 0.0299)],
    expectedReverse: ['passC-hedge'],
    expectedPending: ['passC-hedge'],
  },
];

/** 登记表里只有别人的节点，carried 里却写着这些委托的 id：没盖章的数据不看登记表，不能因此改判。 */
const foreignRegistry = (orderIds: string[]) => ({
  v: 1,
  nodes: {
    foreign: {
      id: 'foreign', scope: 'synced', parentId: null, cause: 'bootstrap', direction: 1, forkSimTime: sim(-5),
      startedRealAt: REAL_A - 60 * MIN, endSimTime: null, endedRealAt: null,
      carried: { TUTUSDT: { positionIds: ['tutu-main-position'], fillIds: ['tutu-main-position'], orderIds } },
      lastSimTime: SIM_CLOSE, lastRealAt: REAL_B,
    },
  },
  current: { synced: 'foreign' },
});

const load = (fixture: Fixture, registry: unknown | null) => {
  localStorage.clear();
  localStorage.setItem('sim_user-1_trade_history', JSON.stringify(fixture.tradeHistory ?? []));
  localStorage.setItem('sim_user-1_cancelled_orders', JSON.stringify(fixture.cancelled ?? []));
  localStorage.setItem('sim_user-1_filled_orders', JSON.stringify(fixture.filled ?? []));
  localStorage.setItem('sim_user-1_orders_map', JSON.stringify({ TUTUSDT: fixture.pending ?? [] }));
  if (fixture.positions) localStorage.setItem('sim_user-1_positions_map', JSON.stringify({ TUTUSDT: fixture.positions }));
  if (registry !== null) localStorage.setItem('sim_user-1_replay_timelines_v1', JSON.stringify(registry));
  journals = fixture.journals();
  if (fixture.open) {
    campaign.closed_at = null;
    campaign.status = 'active';
  }
};

beforeEach(() => {
  localStorage.clear();
  journals = [];
  campaign = {
    id: 'campaign-1', user_id: 'user-1', symbol: 'TUTUSDT', direction: 'main_long', status: 'closed_profit',
    strategy_template: 'custom', title: 'TUTUSDT 2026-08-07 多战役', opened_at: iso(SIM0), closed_at: iso(SIM_CLOSE),
    initial_main_size_usdt: null, initial_leverage: null, final_realized_pnl: null, final_r_multiple: null,
    peak_unrealized_pnl: null, peak_drawdown: null, notes: null, actual_evolution: [],
    created_at: '2026-09-13T12:10:00.000Z', updated_at: '2026-09-13T12:10:00.000Z',
  } as TradeCampaign;
});

describe('【对照】没盖章的数据：影子读取不改任何结论', () => {
  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      const orderIds = [
        ...(fixture.cancelled ?? []).map(order => order.id),
        ...(fixture.filled ?? []).map(order => order.id),
        ...(fixture.pending ?? []).map(order => order.id),
      ];
      const variants: [string, unknown | null][] = [
        ['没有登记表', null],
        ['空登记表', { v: 1, nodes: {}, current: {} }],
        ['只有别人节点的登记表', foreignRegistry(orderIds)],
        ['坏掉的登记表', 'not json object'],
      ];
      const outputs: string[] = [];
      for (const [label, registry] of variants) {
        load(fixture, registry);
        const result = await getCampaignFullData(campaign.id, { heal: false });
        const reverseIds = result.reverseHedgeOrders.map(order => order.id);
        expect(fixture.sortedReverse ? [...reverseIds].sort() : reverseIds, label).toEqual(fixture.expectedReverse);
        expect(result.pendingOrders.map(order => order.id), label).toEqual(fixture.expectedPending);
        expect(result.timelineDiagnostics, label).toEqual({
          mode: 'heuristic', timelineIds: [], anchorTimelineIds: [], unstampedAnchors: 0, missingAnchorNodes: [], verdicts: {}, disagreements: [],
        });
        outputs.push(JSON.stringify({ pendingOrders: result.pendingOrders, reverseHedgeOrders: result.reverseHedgeOrders }));
      }
      // 四种登记表状态下字节相同
      expect(new Set(outputs).size).toBe(1);
    });
  }
});
