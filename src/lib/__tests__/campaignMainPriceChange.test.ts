/**
 * 【用户要求】战役的涨幅：开仓价按主力开仓最有利的那笔（主多最低）；主力平仓时若有滚动对冲在手（仍持有、或与主力同一次操作里平掉），
 * 平仓价按滚动对冲的开仓价；否则按主力自己的平仓价。涨幅效率、加仓效率、反事实都从它派生。
 */
import { describe, expect, it } from 'vitest';
import {
  campaignHasMainAdd,
  campaignMainLegPriceChangePct,
  campaignPriceChange,
  campaignPriceChangeLegInputs,
  computeAddEfficiency,
  computeMainPriceEfficiency,
  counterfactualHasMainAdd,
  counterfactualMainLegPriceChangePct,
  counterfactualPriceChange,
  formatEfficiency,
  SAME_CLOSE_TOLERANCE_MS,
} from '@/lib/campaignMainPriceChange';
import type { CampaignCounterfactualManualLeg, CampaignEvent, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const leg = (over: Partial<TradeJournal>): TradeJournal => ({
  id: 'main', leg_role: 'main_open', direction: 'long', trade_record_id: 'r-main',
  pre_simulated_time: '2026-01-01T00:00:00.000Z', pre_entry_price: 100, pre_position_size: 10_000,
  ...over,
} as TradeJournal);

const record = (over: Partial<TradeRecord>): TradeRecord => ({
  id: 'r-main', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE',
  entryPrice: 100, exitPrice: 112, quantity: 100, leverage: 10, pnl: 1200, fee: 0, slippage: 0,
  openTime: Date.parse('2026-01-01T00:00:00.000Z'), closeTime: Date.parse('2026-01-02T00:00:00.000Z'),
  ...over,
});

const T_OPEN = 1700000000000;
const T_CLOSE = 1700000000000 + 4 * 3_600_000;
const openIso = new Date(T_OPEN).toISOString();
const closeIso = new Date(T_CLOSE).toISOString();
const closedRecord = (id: string, over: Partial<TradeRecord>) => record({ id, openTime: T_OPEN, closeTime: T_CLOSE, ...over });
/** 一场进行中的主多战役壳子：挂单判定与触发时刻走权益路径（resolveCampaignEquityPathLegFacts），事件按需塞进 actual_evolution。 */
const campaignOf = (events: CampaignEvent[] = []): TradeCampaign => ({
  id: 'c', user_id: 'u', symbol: 'BTCUSDT', direction: 'main_long', status: 'active',
  opened_at: '2023-01-01T00:00:00.000Z', closed_at: null, actual_evolution: events,
} as unknown as TradeCampaign);
const CAMPAIGN = campaignOf();
const pct = (legs: TradeJournal[], records: TradeRecord[], corrections = {}) => campaignMainLegPriceChangePct(CAMPAIGN, legs, records, corrections);
const change = (legs: TradeJournal[], records: TradeRecord[], campaign = CAMPAIGN) => campaignPriceChange(campaign, legs, records);

describe('战役涨幅（列表「涨幅」排序、封面、盈亏概览同一个数）', () => {
  it('只有一笔主力、没有滚动对冲：（平仓价 − 开仓价）÷ 开仓价', () => {
    expect(pct([leg({})], [record({})])).toBeCloseTo(12, 9);
    const detail = change([leg({})], [record({})]);
    expect(detail).toMatchObject({ side: 'long', entryPrice: 100, entryLegId: 'main', exitPrice: 112, exitSource: 'main', exitLegId: 'main' });
  });

  it('主空战役：按主力方向计，价格跌了是正数', () => {
    const short = leg({ direction: 'short' });
    expect(pct([short], [record({ side: 'SHORT', exitPrice: 90 })])).toBeCloseTo(10, 9);
    expect(pct([short], [record({ side: 'SHORT', exitPrice: 105 })])).toBeCloseTo(-5, 9);
  });

  it('主力都还没平仓：null（显示「—」）；没有主力也是 null', () => {
    expect(pct([leg({ trade_record_id: null })], [])).toBeNull();
    expect(change([leg({ trade_record_id: null })], []).entryPrice).toBe(100);
    expect(pct([], [])).toBeNull();
  });

  it('用与 Legs 表同一份平仓价校正：错记的平仓价按 K 线校正后的价算', () => {
    const corrections = { main: { exitPrice: 104, originalExitPrice: 160, candleLow: 99, candleHigh: 105 } };
    expect(pct([leg({})], [record({ exitPrice: 160 })], corrections)).toBeCloseTo(4, 9);
  });

  it('【用户要求】BIO 那场：主力平仓时滚动对冲还在手（同一次操作里平掉）→ 平仓价按滚动对冲的开仓价', () => {
    // 主力 0.0527506 → 0.0549040（Legs 表那一行 +4.08%）；滚动对冲 1 在 23:14 开于 0.0633073，与主力同在 00:10 平掉
    const legs = [
      leg({ id: 'main', pre_entry_price: 0.0527506 }),
      leg({ id: 'roll', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: 'r-roll', pre_entry_price: 0.0633073 }),
      leg({ id: 'add', leg_role: 'main_add_1', trade_record_id: 'r-add', pre_entry_price: 0.0592112 }),
    ];
    const records = [
      closedRecord('r-main', { entryPrice: 0.0527506, exitPrice: 0.0549040 }),
      closedRecord('r-roll', { side: 'SHORT', entryPrice: 0.0633073, exitPrice: 0.0549530, openTime: T_CLOSE - 56 * 60_000, closeTime: T_CLOSE + 20_000 }),
      closedRecord('r-add', { entryPrice: 0.0592112, exitPrice: 0.0549040 }),
    ];
    const detail = change(legs, records);
    expect(detail.pct).toBeCloseTo(((0.0633073 - 0.0527506) / 0.0527506) * 100, 9);   // +20.01%
    expect(detail).toMatchObject({ entryLegId: 'main', exitSource: 'rolling_hedge', exitLegId: 'roll', exitPrice: 0.0633073 });
    // 加仓腿不参与开仓价的挑选
    expect(detail.entryPrice).toBe(0.0527506);
  });

  it('滚动对冲在主力平仓之前就平掉了（相差超过一分钟）：主力后面又裸露了，平仓价按主力自己的', () => {
    const legs = [leg({}), leg({ id: 'roll', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: 'r-roll' })];
    // 主力在 T_CLOSE 平（默认的 record 平仓时间是另一天，这里要与对冲同一条时间线）
    const main = closedRecord('r-main', {});
    const early = [main, closedRecord('r-roll', { side: 'SHORT', entryPrice: 120, exitPrice: 118, openTime: T_CLOSE - 3_600_000, closeTime: T_CLOSE - SAME_CLOSE_TOLERANCE_MS - 1 })];
    expect(change(legs, early)).toMatchObject({ exitSource: 'main', exitPrice: 112 });
    // 恰好在容差之内：算同一次操作
    const together = [main, closedRecord('r-roll', { side: 'SHORT', entryPrice: 120, exitPrice: 118, openTime: T_CLOSE - 3_600_000, closeTime: T_CLOSE - SAME_CLOSE_TOLERANCE_MS })];
    expect(change(legs, together)).toMatchObject({ exitSource: 'rolling_hedge', exitPrice: 120 });
    // 主力平了对冲还没平（没有平仓价）：同样在手——前提是它真的成交过（事件流里有 hedge_triggered），按触发时刻持有
    const legsOpen = [leg({}), leg({ id: 'roll', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: null, pre_entry_price: 120, pre_simulated_time: new Date(T_CLOSE - 7_200_000).toISOString() })];
    const triggered = campaignOf([{
      id: 'e-roll', event_type: 'hedge_triggered', timestamp: new Date(T_CLOSE - 3_600_000).toISOString(),
      journal_id: 'roll', leg_role: 'hedge_rolling', direction: 'short', price: 120, size_usdt: 10_000,
    } as unknown as CampaignEvent]);
    expect(change(legsOpen, [main], triggered)).toMatchObject({ exitSource: 'rolling_hedge', exitPrice: 120 });
    // 同一张对冲只是挂着、从未触发（Legs 表「挂单中」）：不是对冲在手，平仓价按主力自己的
    expect(change(legsOpen, [main])).toMatchObject({ exitSource: 'main', exitPrice: 112 });
    // 触发时刻在主力平仓之后：主力平仓那一刻它还不存在
    const late = campaignOf([{
      id: 'e-roll', event_type: 'hedge_triggered', timestamp: new Date(T_CLOSE + 300_000).toISOString(),
      journal_id: 'roll', leg_role: 'hedge_rolling', direction: 'short', price: 120, size_usdt: 10_000,
    } as unknown as CampaignEvent]);
    expect(change(legsOpen, [main], late)).toMatchObject({ exitSource: 'main', exitPrice: 112 });
  });

  it('几张滚动对冲都在手：取最早开的那张的开仓价；主力平仓之后才开的不算；初始对冲 A/B 不算', () => {
    const legs = [
      leg({}),
      leg({ id: 'roll-2', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: 'r-2' }),
      leg({ id: 'roll-1', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: 'r-1' }),
      leg({ id: 'roll-late', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: 'r-late' }),
      leg({ id: 'a', leg_role: 'hedge_initial_a', direction: 'short', trade_record_id: 'r-a' }),
    ];
    const records = [
      closedRecord('r-main', {}),
      closedRecord('r-2', { side: 'SHORT', entryPrice: 125, exitPrice: 112, openTime: T_CLOSE - 1_800_000 }),
      closedRecord('r-1', { side: 'SHORT', entryPrice: 118, exitPrice: 112, openTime: T_CLOSE - 3_600_000 }),
      closedRecord('r-late', { side: 'SHORT', entryPrice: 130, exitPrice: 112, openTime: T_CLOSE + 60_000, closeTime: T_CLOSE + 3_600_000 }),
      closedRecord('r-a', { side: 'SHORT', entryPrice: 90, exitPrice: 112, openTime: T_OPEN }),
    ];
    expect(change(legs, records)).toMatchObject({ exitSource: 'rolling_hedge', exitLegId: 'roll-1', exitPrice: 118 });
  });

  it('几笔主力：开仓价取最有利的一笔（主多最低、主空最高），平仓时刻取最晚平的那笔', () => {
    const legs = [
      leg({ id: 'm1', trade_record_id: 'r-1', pre_entry_price: 110 }),
      leg({ id: 'm2', trade_record_id: 'r-2', pre_entry_price: 100 }),
      leg({ id: 'm3', trade_record_id: 'r-3', pre_entry_price: 105 }),
    ];
    const records = [
      closedRecord('r-1', { entryPrice: 110, exitPrice: 130 }),                                   // 最后平：130
      closedRecord('r-2', { entryPrice: 100, exitPrice: 120, closeTime: T_CLOSE - 3_600_000 }),   // 先平
      closedRecord('r-3', { entryPrice: 105, exitPrice: 128 }),                                   // 与 m1 同时平，价低一点
    ];
    const detail = change(legs, records);
    expect(detail).toMatchObject({ entryLegId: 'm2', entryPrice: 100, exitLegId: 'm1', exitPrice: 130, exitSource: 'main', mainCloseTime: T_CLOSE });
    expect(detail.pct).toBeCloseTo(30, 9);
    // 主空：开仓价取最高，最后平的几笔里取最低的平仓价
    const shorts = legs.map(item => ({ ...item, direction: 'short' } as TradeJournal));
    const shortRecords = records.map(item => ({ ...item, side: 'SHORT' as const }));
    expect(change(shorts, shortRecords)).toMatchObject({ entryLegId: 'm1', entryPrice: 110, exitLegId: 'm3', exitPrice: 128 });
  });

  it('主力有的平了有的没平：按已平的那几笔算；没有 main_open 时才退到 reentry_main', () => {
    const legs = [leg({ id: 'a', trade_record_id: 'r-a' }), leg({ id: 'open', trade_record_id: null, pre_entry_price: 90 })];
    const detail = change(legs, [closedRecord('r-a', { exitPrice: 97 })]);
    // 开仓价仍取最低（未平的那笔 90 也参与挑开仓价），平仓价来自已平的那笔
    expect(detail).toMatchObject({ entryLegId: 'open', entryPrice: 90, exitLegId: 'a', exitPrice: 97 });
    const reentry = [leg({ id: 're', leg_role: 'reentry_main', trade_record_id: 'r-re' })];
    expect(pct(reentry, [record({ id: 'r-re', exitPrice: 108 })])).toBeCloseTo(8, 9);
    const mixed = [leg({ id: 'main' }), ...reentry];
    expect(pct(mixed, [record({}), record({ id: 'r-re', exitPrice: 150 })])).toBeCloseTo(12, 9);
  });

  it('只有平仓价快照、没有平仓时间的主力照样按平仓价算（Legs 表也判已平仓）；对冲有平仓价没时间的不当在手', () => {
    const snapMain = leg({ trade_record_id: null, post_exit_price_snapshot: 112, post_realized_pnl: 120, post_outcome: 'win' } as Partial<TradeJournal>);
    expect(pct([snapMain], [])).toBeCloseTo(12, 9);
    const legs = [leg({}), leg({ id: 'roll', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: null, pre_entry_price: 120, post_exit_price_snapshot: 112, post_realized_pnl: 40, post_outcome: 'win' } as Partial<TradeJournal>)];
    expect(change(legs, [closedRecord('r-main', {})])).toMatchObject({ exitSource: 'main', exitPrice: 112 });
  });

  it('逐腿输入只含主力与滚动对冲；挂着没成交的腿不进来；还没平仓的腿平仓价与平仓时间为 null', () => {
    const legs = [
      leg({}),
      leg({ id: 'roll', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: 'r-roll' }),
      leg({ id: 'pending', leg_role: 'hedge_rolling', direction: 'short', trade_record_id: null }),
      leg({ id: 'add', leg_role: 'main_add_1' }),
      leg({ id: 'tp', leg_role: 'mirror_tp' }),
    ];
    // 滚动对冲成交了但还没平：记录里没有平仓
    const openRoll = record({ id: 'r-roll', side: 'SHORT', entryPrice: 120, exitPrice: 0, closeTime: null as never, action: 'OPEN' as never });
    const inputs = campaignPriceChangeLegInputs(CAMPAIGN, legs, [record({}), openRoll]);
    expect(inputs.map(input => input.id)).toEqual(['main', 'roll']);
    expect(inputs[1]).toMatchObject({ role: 'hedge_rolling', side: 'short', entryPrice: 120 });
  });
});

describe('涨幅效率 / 加仓效率', () => {
  it('涨幅效率 = 主力涨幅 ÷ 预期回撤；加仓效率 = 盈亏比 ÷ 涨幅效率', () => {
    expect(computeMainPriceEfficiency(12, 4)).toBeCloseTo(3, 9);
    expect(computeAddEfficiency(6, 3)).toBeCloseTo(2, 9);
    // 只拿主力不加仓：b 就是涨幅效率，加仓效率恰为 1
    expect(computeAddEfficiency(3, computeMainPriceEfficiency(12, 4))).toBeCloseTo(1, 9);
  });

  it('算不出就是 null：主力未平仓、预期回撤不为正、涨幅效率为 0', () => {
    expect(computeMainPriceEfficiency(null, 4)).toBeNull();
    expect(computeMainPriceEfficiency(12, 0)).toBeNull();
    expect(computeAddEfficiency(null, 3)).toBeNull();
    expect(computeAddEfficiency(2, 0)).toBeNull();
    expect(computeAddEfficiency(2, null)).toBeNull();
  });

  it('读数带符号、两位小数，取整为 0 写 0.00，缺值「—」', () => {
    expect(formatEfficiency(3)).toBe('+3.00');
    expect(formatEfficiency(-0.754)).toBe('-0.75');
    expect(formatEfficiency(0.001)).toBe('0.00');
    expect(formatEfficiency(null)).toBe('—');
  });
});

describe('反事实里的涨幅', () => {
  const manual = (over: Partial<CampaignCounterfactualManualLeg>): CampaignCounterfactualManualLeg => ({
    id: 'main', leg_role: 'main_open', direction: 'long',
    open_time: openIso, close_time: closeIso,
    entry_price: 100, exit_price: 112, size_usdt: 10_000, leverage: 10, enabled: true,
    actual: {
      source: 'records', direction: 'long',
      open_time: openIso, close_time: closeIso,
      entry_price: 100, exit_price: 112, size_usdt: 10_000, realized_pnl_usdt: 1200,
      close_fee_usdt: 0, open_fee_usdt: 0,
    },
    ...over,
  } as CampaignCounterfactualManualLeg);
  const rolling = (over: Partial<CampaignCounterfactualManualLeg> = {}) => manual({
    id: 'roll', leg_role: 'hedge_rolling', direction: 'short',
    open_time: new Date(T_CLOSE - 3_600_000).toISOString(), entry_price: 120, exit_price: 112,
    actual: { ...manual({}).actual!, direction: 'short', open_time: new Date(T_CLOSE - 3_600_000).toISOString(), entry_price: 120, exit_price: 112 },
    ...over,
  });
  /** 真实一侧：副本还原的开平价与 Legs 表那一行不是同一对（这里故意给不同的数） */
  const actual = {
    byLegId: {
      main: { id: 'main', role: 'main_open', side: 'long' as const, entryPrice: 99.5, exitPrice: 112.4, openTime: T_OPEN, closeTime: T_CLOSE },
      roll: { id: 'roll', role: 'hedge_rolling', side: 'short' as const, entryPrice: 119.7, exitPrice: 111.9, openTime: T_CLOSE - 3_600_000, closeTime: T_CLOSE + 10_000 },
    },
    pct: ((119.7 - 99.5) / 99.5) * 100,
  };

  it('原样重跑：没改过的腿沿用真实一侧那一份，与上方「盈亏概览」逐位相同', () => {
    expect(counterfactualMainLegPriceChangePct([manual({}), rolling()], actual)).toBe(actual.pct);
    expect(counterfactualPriceChange([manual({}), rolling()], actual)).toMatchObject({ entryPrice: 99.5, exitPrice: 119.7, exitSource: 'rolling_hedge' });
  });

  it('停用滚动对冲、或把它的平仓时间改到主力平仓之前：平仓价退回主力自己的', () => {
    expect(counterfactualPriceChange([manual({}), rolling({ enabled: false })], actual)).toMatchObject({ exitSource: 'main', exitPrice: 112.4 });
    const earlier = rolling({ close_time: new Date(T_CLOSE - 3_600_000 + 60_000).toISOString() });
    expect(counterfactualPriceChange([manual({}), earlier], actual)).toMatchObject({ exitSource: 'main', exitPrice: 112.4 });
    // 标着「挂单中」的对冲从未成交，不参与
    expect(counterfactualPriceChange([manual({}), rolling({ filled: false })], actual)).toMatchObject({ exitSource: 'main' });
  });

  it('改了主力的开仓价 / 平仓价：逐字段对账——只换改过的那一格，其余沿用真实一侧', () => {
    expect(counterfactualPriceChange([manual({ entry_price: 95 }), rolling()], actual)).toMatchObject({ entryPrice: 95, exitPrice: 119.7 });
    // 只改平仓价：开仓价仍沿用真实侧的 99.5（副本还原的 100 不是 Legs 表那一对）
    expect(counterfactualPriceChange([manual({ exit_price: 130 })], actual)).toMatchObject({ entryPrice: 99.5, exitPrice: 130, exitSource: 'main' });
    // 只改主力开仓价：平仓价与主力平仓时刻不动，滚动对冲「在手」的判定也不动
    expect(counterfactualPriceChange([manual({ entry_price: 95 }), rolling()], actual)).toMatchObject({ mainCloseTime: T_CLOSE, exitSource: 'rolling_hedge' });
    // 真实一侧没有平仓价的主力（一条腿都结算不了 / 还没平），平仓价没改：仍视为未平仓，不拿副本的占位价算
    const unsettled = { byLegId: { main: { ...actual.byLegId.main, exitPrice: null, closeTime: null } }, pct: null };
    expect(counterfactualPriceChange([manual({ exit_price: 100, actual: { ...manual({}).actual!, exit_price: 100, source: 'campaign_total' } })], unsettled).pct).toBeNull();
    expect(counterfactualPriceChange([manual({ entry_price: 99, exit_price: 100, actual: { ...manual({}).actual!, exit_price: 100, source: 'campaign_total' } })], unsettled).pct).toBeNull();
    // 给它定了平仓价：按改后的价、副本的平仓时间
    expect(counterfactualPriceChange([manual({ exit_price: 130, actual: { ...manual({}).actual!, exit_price: 100, source: 'campaign_total' } })], unsettled)).toMatchObject({ exitPrice: 130, mainCloseTime: T_CLOSE });
    const short = manual({ direction: 'short', exit_price: 90, actual: { ...manual({}).actual!, direction: 'short', exit_price: 95 } });
    expect(counterfactualMainLegPriceChangePct([short], null)).toBeCloseTo(10, 9);
  });

  it('新增的主力按副本算并参与挑开仓价；实际未平仓、平仓价没改的主力视为未平仓', () => {
    const added = manual({ id: 'new', entry_price: 90, exit_price: 112, actual: undefined });
    expect(counterfactualPriceChange([manual({}), added], actual)).toMatchObject({ entryLegId: 'new', entryPrice: 90, exitPrice: 112.4 });
    const stillOpen = [manual({ id: 'big', exit_price: 105, actual: { ...manual({}).actual!, exit_price: 105, still_open: true } })];
    expect(counterfactualMainLegPriceChangePct(stillOpen, null)).toBeNull();
    // 用户给这条未平仓的主力定了平仓价：按改后的价算
    expect(counterfactualMainLegPriceChangePct([{ ...stillOpen[0], exit_price: 130 }], null)).toBeCloseTo(30, 9);
  });

  it('没有主力：null', () => {
    expect(counterfactualMainLegPriceChangePct([manual({ leg_role: 'hedge_initial_a' })], null)).toBeNull();
    expect(counterfactualMainLegPriceChangePct([], null)).toBeNull();
  });
});

describe('【用户要求】加仓效率只算做过加仓的战役', () => {
  const journal = (over: Partial<TradeJournal>) => ({ leg_role: 'main_open', trade_record_id: null, ...over } as TradeJournal);

  it('有成交过的加仓腿（带成交 id 或已有结算结果）才算做过加仓', () => {
    expect(campaignHasMainAdd([journal({}), journal({ leg_role: 'main_add_1', trade_record_id: 'r-add' })])).toBe(true);
    expect(campaignHasMainAdd([journal({ leg_role: 'main_add_2', post_realized_pnl: 12 })])).toBe(true);
    expect(campaignHasMainAdd([journal({ leg_role: 'main_add_1', post_real_close_time: '2026-01-02T00:00:00.000Z' })])).toBe(true);
  });

  it('只有主力 / 对冲 / 镜像，或加仓腿连成交 id 都没有：不算', () => {
    expect(campaignHasMainAdd([journal({}), journal({ leg_role: 'hedge_initial_a', trade_record_id: 'h' }), journal({ leg_role: 'mirror_tp', trade_record_id: 'm' })])).toBe(false);
    expect(campaignHasMainAdd([journal({ leg_role: 'main_add_1' })])).toBe(false);
    expect(campaignHasMainAdd([])).toBe(false);
  });

  it('反事实：参与运行、成交了的加仓腿才算', () => {
    const add = { leg_role: 'main_add_1', enabled: true } as CampaignCounterfactualManualLeg;
    expect(counterfactualHasMainAdd([add])).toBe(true);
    expect(counterfactualHasMainAdd([{ ...add, enabled: false }])).toBe(false);
    expect(counterfactualHasMainAdd([{ ...add, filled: false }])).toBe(false);
    expect(counterfactualHasMainAdd([{ ...add, leg_role: 'main_open' }])).toBe(false);
  });
});

describe('【用户要求】加仓效率门槛：涨幅效率为正才算', () => {
  it('涨幅效率为负：不算（亏损战役负负得正不再排到最前）', () => {
    expect(computeAddEfficiency(-0.68, -0.05)).toBeNull();
    expect(computeAddEfficiency(2, -1)).toBeNull();
  });
  it('涨幅效率显示为 0.00（接近 0）：不算，分母过小不再把比值放大成十几倍', () => {
    expect(computeAddEfficiency(0.59, 0.004)).toBeNull();
    expect(computeAddEfficiency(0.59, 0)).toBeNull();
  });
  it('涨幅效率为正：照算，盈亏比为负时读数为负', () => {
    expect(computeAddEfficiency(0.59, 0.04)).toBeCloseTo(14.75, 9);
    expect(computeAddEfficiency(-1, 2)).toBeCloseTo(-0.5, 9);
  });
});
