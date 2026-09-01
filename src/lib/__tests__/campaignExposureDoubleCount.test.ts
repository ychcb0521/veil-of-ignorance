import { describe, expect, it } from 'vitest';
import { computeInitialExpectedMaxLoss, computeInitialMainExposureNotional } from '@/lib/campaignAnalysis';
import type { CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

/**
 * 事故 BMTUSDT 2025-04-28（用户导出的战役快照）：
 * 开仓敞口显示 13,543,000，而两条腿相加只有 6,771,500——**恰好 2.000 倍**。
 * 预期最大亏损因此是 564,753 而不是 282,372，盈亏比从 29.6% 塌成 14.8%。
 *
 * 「恰好 2.000」这个整数比本身就是判据：价格、滑点、精度的误差不会给出整洁的 2，
 * 只有同一笔敞口被数了两次才会。
 */
const OPEN = '2025-04-28T08:35:00.000Z';
const ENTRY = 0.135657;
const GUARD = 0.130000;              // 委托栏里那张「空 0.130000」
const N_MAIN = 2_708_600;
const N_MIRROR = 4_062_900;
const TRUE_EXPOSURE = N_MAIN + N_MIRROR;                       // 6,771,500
const TRUE_FRACTION = (ENTRY - GUARD) / ENTRY;                 // 4.170%
const TRUE_LOSS = TRUE_FRACTION * TRUE_EXPOSURE;               // ≈ 282,372

const rec = (id: string, notional: number, closeAt: string): TradeRecord => ({
  id, symbol: 'BMTUSDT', side: 'LONG', action: 'CLOSE', positionId: `pos-${id}`,
  openTime: Date.parse(OPEN), closeTime: Date.parse(closeAt),
  entryPrice: ENTRY, exitPrice: 0.13, quantity: notional / ENTRY, leverage: 5, pnl: 1,
} as unknown as TradeRecord);
const R_MAIN = rec('rm', N_MAIN, '2025-04-28T09:21:00.000Z');
const R_MIRROR = rec('rr', N_MIRROR, '2025-04-28T08:51:00.000Z');

const leg = (id: string, role: string, notional: number, ref: string | null): TradeJournal => ({
  id, leg_role: role, leg_sequence: 1, direction: 'long',
  order_kind: role === 'mirror_tp' ? 'tp' : 'main',
  pre_simulated_time: OPEN, pre_entry_price: ENTRY, pre_position_size: notional, trade_record_id: ref,
} as unknown as TradeJournal);

const ev = (role: string, notional: number, ref: string | null, journalId: string | null): CampaignEvent => ({
  id: `e-${role}-${ref}-${journalId}`, timestamp: OPEN, event_type: 'historical_leg_attached',
  leg_role: role, journal_id: journalId, trade_record_id: ref,
  price: ENTRY, size_usdt: notional, direction: 'long',
} as unknown as CampaignEvent);

const campaign = (events: CampaignEvent[]): TradeCampaign => ({
  id: 'c', user_id: 'u', campaign_code: 'C', symbol: 'BMTUSDT', direction: 'main_long',
  status: 'closed_profit', strategy_template: 'main_dual_hedge_mirror_tp', title: 't',
  opened_at: OPEN, closed_at: '2025-04-28T09:21:00.000Z',
  initial_main_size_usdt: N_MAIN, initial_leverage: 5,
  final_realized_pnl: 83_471.19, actual_evolution: events,
} as unknown as TradeCampaign);

const guard: CampaignReverseHedgeOrder = {
  id: 'g', side: 'SHORT', price: GUARD, createdAt: Date.parse(OPEN) + 60_000,
  triggeredAt: null, cancelledAt: Date.parse(OPEN) + 120_000, status: 'cancelled',
};

const LEGS_LINKED = [leg('m', 'main_open', N_MAIN, 'rm'), leg('r', 'mirror_tp', N_MIRROR, 'rr')];
const LEGS_UNLINKED = [leg('m', 'main_open', N_MAIN, null), leg('r', 'mirror_tp', N_MIRROR, null)];
const RECORDS = [R_MAIN, R_MIRROR];

const exposureOf = (legs: TradeJournal[], recs: TradeRecord[], events: CampaignEvent[]) =>
  computeInitialMainExposureNotional(campaign(events), legs, recs);

describe('同一笔敞口不得被数两次', () => {
  it('【回归】腿关联了记录、事件只带 journal_id——用户那张快照的形状', () => {
    // 回填流程是「先建 journal、发事件、**再**关联记录」，发事件那一刻 ref 还是 null，
    // 于是腿算出 `record:rm`、事件算出 `journal:m`，两个字符串不等，去重失效。
    const events = [ev('main_open', N_MAIN, null, 'm'), ev('mirror_tp', N_MIRROR, null, 'r')];
    expect(exposureOf(LEGS_LINKED, RECORDS, events)).toBeCloseTo(TRUE_EXPOSURE, 2);
    expect(exposureOf(LEGS_LINKED, RECORDS, events)).not.toBeCloseTo(2 * TRUE_EXPOSURE, 0);
  });

  it('【回归】腿没有记录引用、事件也没有 journal_id——两边一个 id 都不共享', () => {
    // 记录派生的事件 journal_id 恒为 null，这时只能靠「角色+名义+开仓分钟」的内容指纹链接。
    const events = [ev('main_open', N_MAIN, 'rm', null), ev('mirror_tp', N_MIRROR, 'rr', null)];
    expect(exposureOf(LEGS_UNLINKED, RECORDS, events)).toBeCloseTo(TRUE_EXPOSURE, 2);
  });

  it('其余形状同样只记一次', () => {
    const both = [ev('main_open', N_MAIN, 'rm', 'm'), ev('mirror_tp', N_MIRROR, 'rr', 'r')];
    const refOnly = [ev('main_open', N_MAIN, 'rm', null), ev('mirror_tp', N_MIRROR, 'rr', null)];
    expect(exposureOf(LEGS_LINKED, RECORDS, both)).toBeCloseTo(TRUE_EXPOSURE, 2);
    expect(exposureOf(LEGS_LINKED, RECORDS, refOnly)).toBeCloseTo(TRUE_EXPOSURE, 2);
    expect(exposureOf(LEGS_LINKED, [], refOnly)).toBeCloseTo(TRUE_EXPOSURE, 2);   // 记录被过滤掉
    expect(exposureOf(LEGS_LINKED, RECORDS, [])).toBeCloseTo(TRUE_EXPOSURE, 2);   // 没有事件
  });

  it('【判据】预期最大亏损回到用户手算的那一半', () => {
    const events = [ev('main_open', N_MAIN, null, 'm'), ev('mirror_tp', N_MIRROR, null, 'r')];
    const L = computeInitialExpectedMaxLoss(campaign(events), LEGS_LINKED, RECORDS, [guard])!;
    expect(L).toBeCloseTo(TRUE_LOSS, 0);          // ≈ 282,372，不是 564,753
    expect(TRUE_FRACTION).toBeCloseTo(0.0417, 4); // 回撤率本来就是对的
    // 盈亏比随之从 14.8% 回到 29.6%
    expect((83_471.19 / L) * 100).toBeCloseTo(29.56, 1);
  });

  it('真正不同的两笔仓位不会被内容指纹误并', () => {
    // 同角色、同分钟，但名义不同 → 是两笔，必须各记各的。
    const a = leg('m1', 'main_open', N_MAIN, 'rm');
    const b = { ...leg('m2', 'main_open', 999_999, null), id: 'm2' } as TradeJournal;
    expect(exposureOf([a, b], [R_MAIN], [])).toBeCloseTo(N_MAIN + 999_999, 2);
  });

  it('对冲腿不计入 ex-ante 敞口', () => {
    const hedge = leg('h', 'hedge_rolling', 2_640_000, null);
    expect(exposureOf([...LEGS_LINKED, hedge], RECORDS, [])).toBeCloseTo(TRUE_EXPOSURE, 2);
  });
});
