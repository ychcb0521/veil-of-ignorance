import { describe, expect, it } from 'vitest';
import { computeInitialExpectedMaxLoss, computeInitialMainExposureNotional } from '@/lib/campaignAnalysis';
import type { CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

/**
 * 实盘 VIRTUALUSDT 2025-04-29（用户导出图）。这一场同时踩中两件事：
 *   · 有**加仓腿**——它不该计入 ex-ante 敞口（INITIAL_MAIN_EXPOSURE_ROLES 只有
 *     main_open + mirror_tp），但界面把加仓也归在「主仓」那一栏里显示，容易被误以为算了；
 *   · 敞口曾被记两遍——截图上 19,565,000 = 2.0000 × (主力 + 镜像)。
 * 两件事叠在一起时更难分辨，所以这里把「不含加仓」与「不翻倍」一起钉住。
 */
const OPEN = '2025-04-29T07:20:00.000Z';
const E = 1.4004, GUARD = 1.3600;
const N_MAIN = 3_913_000, N_MIRROR = 5_869_500, N_ADD = 4_900_730, N_HEDGE = 8_913_270;
const TRUE_EXPOSURE = N_MAIN + N_MIRROR;          // 9,782,500
const WITH_ADD = TRUE_EXPOSURE + N_ADD;           // 14,683,230 —— 绝不能等于它
const REALIZED = 197_777.40;

const rec = (id: string, n: number, e: number, openAt: string, closeAt: string): TradeRecord => ({
  id, symbol: 'VIRTUALUSDT', side: 'LONG', action: 'CLOSE', positionId: `pos-${id}`,
  openTime: Date.parse(openAt), closeTime: Date.parse(closeAt),
  entryPrice: e, exitPrice: 1.4788, quantity: n / e, leverage: 7, pnl: 1,
} as unknown as TradeRecord);

const leg = (id: string, role: string, n: number, e: number, openAt: string, ref: string): TradeJournal => ({
  id, leg_role: role, leg_sequence: 1, direction: 'long',
  order_kind: role === 'mirror_tp' ? 'tp' : 'main',
  pre_simulated_time: openAt, pre_entry_price: e, pre_position_size: n, trade_record_id: ref,
} as unknown as TradeJournal);

const ev = (
  role: string, n: number, e: number, ts: string,
  jid: string | null, ref: string | null, type = 'historical_leg_attached',
): CampaignEvent => ({
  id: `e-${role}-${jid}-${ref}-${type}`, timestamp: ts, event_type: type,
  leg_role: role, journal_id: jid, trade_record_id: ref, price: e, size_usdt: n, direction: 'long',
} as unknown as CampaignEvent);

const ADD_AT = '2025-04-29T08:28:00.000Z';
const LEGS = [
  leg('m', 'main_open', N_MAIN, E, OPEN, 'rm'),
  leg('r', 'mirror_tp', N_MIRROR, E, OPEN, 'rr'),
  leg('a', 'main_add_1', N_ADD, 1.5026, ADD_AT, 'ra'),
  leg('h', 'hedge_rolling', N_HEDGE, 1.4691, '2025-04-29T08:49:00.000Z', 'rh'),
];
const RECORDS = [
  rec('rm', N_MAIN, E, OPEN, '2025-04-29T09:13:00.000Z'),
  rec('rr', N_MIRROR, E, OPEN, '2025-04-29T08:10:00.000Z'),
  rec('ra', N_ADD, 1.5026, ADD_AT, '2025-04-29T09:13:00.000Z'),
  rec('rh', N_HEDGE, 1.4691, '2025-04-29T08:49:00.000Z', '2025-04-29T09:13:00.000Z'),
];

const campaign = (events: CampaignEvent[]): TradeCampaign => ({
  id: 'c', user_id: 'u', campaign_code: 'C', symbol: 'VIRTUALUSDT', direction: 'main_long',
  status: 'closed_profit', strategy_template: 'main_dual_hedge_mirror_tp', title: 't',
  opened_at: OPEN, closed_at: '2025-04-29T09:13:00.000Z',
  initial_main_size_usdt: N_MAIN, initial_leverage: 7,
  final_realized_pnl: REALIZED, actual_evolution: events,
} as unknown as TradeCampaign);

const guard: CampaignReverseHedgeOrder = {
  id: 'g', side: 'SHORT', price: GUARD, createdAt: Date.parse(OPEN) + 60_000,
  triggeredAt: null, cancelledAt: Date.parse(OPEN) + 3_600_000, status: 'cancelled',
};

const exposureOf = (events: CampaignEvent[]) =>
  computeInitialMainExposureNotional(campaign(events), LEGS, RECORDS);

/** 事件流的五种形状——同一笔仓位从 legs 与事件流两条路走出来时，id 可能一个都不共享。 */
const SHAPES: Array<[string, CampaignEvent[]]> = [
  ['无事件流', []],
  ['事件带 journal_id', [
    ev('main_open', N_MAIN, E, OPEN, 'm', null), ev('mirror_tp', N_MIRROR, E, OPEN, 'r', null),
    ev('main_add_1', N_ADD, 1.5026, ADD_AT, 'a', null)]],
  ['事件带 trade_record_id', [
    ev('main_open', N_MAIN, E, OPEN, null, 'rm'), ev('mirror_tp', N_MIRROR, E, OPEN, null, 'rr'),
    ev('main_add_1', N_ADD, 1.5026, ADD_AT, null, 'ra')]],
  ['事件两个 id 都没有', [
    ev('main_open', N_MAIN, E, OPEN, null, null), ev('mirror_tp', N_MIRROR, E, OPEN, null, null),
    ev('main_add_1', N_ADD, 1.5026, ADD_AT, null, null)]],
  ['开仓事件与回填事件并存', [
    ev('main_open', N_MAIN, E, OPEN, 'm', null), ev('mirror_tp', N_MIRROR, E, OPEN, 'r', null),
    ev('main_open', N_MAIN, E, OPEN, null, null, 'main_opened'),
    ev('mirror_tp', N_MIRROR, E, OPEN, null, null, 'mirror_tp_placed')]],
];

describe('ex-ante 敞口：不含加仓，也不重复计数', () => {
  it.each(SHAPES)('【回归】%s', (_name, events) => {
    expect(exposureOf(events)).toBeCloseTo(TRUE_EXPOSURE, 2);
  });

  it('【判据】加仓的名义一分都不能进——它有自己的角色，本就被排除在外', () => {
    for (const [, events] of SHAPES) {
      const n = exposureOf(events)!;
      expect(n).not.toBeCloseTo(WITH_ADD, 0);
      expect(n).toBeLessThan(WITH_ADD);
    }
  });

  it('【回归】不得翻倍——截图上的 19,565,000 正是 2.0000 × 真值', () => {
    for (const [, events] of SHAPES) {
      expect(exposureOf(events)!).not.toBeCloseTo(TRUE_EXPOSURE * 2, 0);
    }
  });

  it('滚动对冲同样不计入', () => {
    expect(exposureOf([])!).toBeLessThan(TRUE_EXPOSURE + N_HEDGE);
  });

  it('L 与盈亏比落在手算值上', () => {
    const fraction = (E - GUARD) / E;                       // 2.885%
    const L = computeInitialExpectedMaxLoss(campaign([]), LEGS, RECORDS, [guard]);
    expect(L).toBeCloseTo(fraction * TRUE_EXPOSURE, 0);     // ≈ 282,214
    expect((REALIZED / L) * 100).toBeCloseTo(70.1, 1);      // 截图是 35.0%（分母大了一倍）
  });
});
