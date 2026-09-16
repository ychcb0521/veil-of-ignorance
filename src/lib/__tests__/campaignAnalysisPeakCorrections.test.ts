/**
 * 战役页「峰值浮盈」的已落袋部分与「已实现 P&L」吃同一份平仓价校正。
 *
 * 校正按腿存、只改这条腿收盘的那一刀（认领记录里最晚的一条）。结算一直是这么叠的；
 * 峰值权益路径以前直接读 record.pnl，于是被错记平仓价的那条腿平掉之后，
 * 每一个时点都带着未校正的盈亏——同一块面板上峰值与已实现各说各话。
 *
 * 权益路径也按结算的认领逐刀持有：主力这条腿认领了两刀（主力那一片 + 加仓并进来的那一片），
 * 两刀都在路径上。上一版这里只放 buildTradeRecordLookup 折叠出来的主力那一片，
 * 加仓那一片的 +300 从不进峰值（期望值曾写成 1320 / 1600，正是少了这 300）。
 */
import { describe, expect, it } from 'vitest';
import type { KlineData } from '@/hooks/useBinanceData';
import {
  computeCampaignPnlReconciliation,
  computeDecisionAccuracy,
  computeInitialMainExposureNotional,
  resolveCampaignEquityPathLegFacts,
  resolveInitialExposureLegAttribution,
  resolveUnfilledLegIds,
} from '@/lib/campaignAnalysis';
import type { LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { parityFixture } from '@/test/fixtures/counterfactualParityFixtures';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const bar = (hours: number, open: number, high: number, low: number, close: number): KlineData => ({
  time: T0 + hours * HOUR,
  open,
  high,
  low,
  close,
  volume: 1,
});

const campaign = {
  id: 'c',
  user_id: 'u',
  campaign_code: 'C',
  symbol: 'TESTUSDT',
  direction: 'main_long',
  status: 'closed_profit',
  strategy_template: 'custom',
  title: 'c',
  opened_at: iso(T0),
  closed_at: iso(T0 + 3 * HOUR),
  initial_main_size_usdt: 1000,
  initial_leverage: 1,
  final_realized_pnl: null,
  final_r_multiple: null,
  peak_unrealized_pnl: null,
  peak_drawdown: null,
  importance_weight: 0,
  notes: null,
  actual_evolution: [],
  deviation_notes: {},
  deleted_at: null,
  created_at: iso(T0),
  updated_at: iso(T0),
} as unknown as TradeCampaign;

const record = (over: Partial<TradeRecord>): TradeRecord => ({
  symbol: 'TESTUSDT',
  side: 'LONG',
  type: 'MARKET',
  action: 'CLOSE',
  entryPrice: 100,
  leverage: 1,
  fee: 0,
  slippage: 0,
  openTime: T0,
  ...over,
} as TradeRecord);

const leg = (over: Partial<TradeJournal>): TradeJournal => ({
  user_id: 'u',
  campaign_id: 'c',
  source: 'live',
  symbol: 'TESTUSDT',
  direction: 'long',
  leverage: 1,
  pre_simulated_time: iso(T0),
  pre_entry_price: 100,
  ...over,
} as TradeJournal);

/**
 * 主力一个仓位两刀：主力那一片 10 个、加仓并进来的那一片 5 个，都记成在 160 平掉（00:30 那一分钟只有 99–105），
 * 加仓那一片更晚落账（00:30:01），所以校正落在它身上：Δ = (104 − 160) × 5 = −280。
 * 另一条加仓腿 20 个一直拿到 02:00，01:00 这根冲到 150。
 */
const records = [
  record({ id: 'main-fill', positionId: 'pos-main', fillId: 'pos-main', exitPrice: 160, quantity: 10, pnl: 600, closeTime: T0 + HOUR / 2 }),
  record({ id: 'add-fill', positionId: 'pos-main', fillId: 'fill-add', exitPrice: 160, quantity: 5, pnl: 300, closeTime: T0 + HOUR / 2 + 1000 }),
  record({ id: 'hold', positionId: 'pos-hold', fillId: 'pos-hold', exitPrice: 101, quantity: 20, pnl: 20, closeTime: T0 + 2 * HOUR }),
];
const legs = [
  leg({ id: 'main', trade_record_id: 'pos-main', leg_role: 'main_open', leg_sequence: 1, pre_position_size: 1500 }),
  leg({ id: 'hold', trade_record_id: 'pos-hold', leg_role: 'main_add_1', leg_sequence: 2, pre_position_size: 2000 }),
];
const klines = [
  bar(0, 100, 105, 99, 104),
  bar(1, 104, 150, 100, 110),
  bar(2, 110, 111, 100, 101),
];
const corrections: LegExitPriceCorrections = {
  main: { exitPrice: 104, originalExitPrice: 160, candleLow: 99, candleHigh: 105 },
};

describe('峰值浮盈与已实现 P&L 共用平仓价校正', () => {
  it('校正叠在结算认领的收盘那一刀上：峰值路径与已实现用同一个 Δ', () => {
    const reconciliation = computeCampaignPnlReconciliation(campaign, legs, records, corrections);
    // 结算：600 + 300 + 20 − 280 = 640
    expect(reconciliation.priceCorrectionDelta).toBeCloseTo(-280, 9);
    expect(reconciliation.correctedPnl).toBeCloseTo(640, 9);

    const accuracy = computeDecisionAccuracy(campaign, legs, records, klines, [], corrections);
    // 01:00 这根高点：主力两刀都已落袋 600 + 300 − 280 = 620（Δ 只叠在更晚的加仓那一刀上），
    // 另一条腿 20 × (150 − 100) = 1000 → 1620。按主力那一片自己的数量算 Δ 会得到 −560（1340）；不叠校正是 1900。
    expect(accuracy.campaign_max_profit_real).toBeCloseTo(1620, 9);
    // 峰值路径上已平部分之和 = 结算里这两条腿的合计：01:00 之后主力的落袋额就是 byLeg 的 620
    expect(accuracy.campaign_max_profit_real - 1000).toBeCloseTo(reconciliation.correctedPnl - 20, 9);
  });

  it('不带校正时照旧按记录盈亏：同一场的峰值是 1900（两刀 600 + 300 都在路径上）', () => {
    expect(computeDecisionAccuracy(campaign, legs, records, klines, []).campaign_max_profit_real).toBeCloseTo(1900, 9);
    expect(computeDecisionAccuracy(campaign, legs, records, klines, [], {}).campaign_max_profit_real).toBeCloseTo(1900, 9);
  });

  it('校正只作用于它所属的腿：挂在别的腿（或不存在的腿）上的校正不改变这条路径', () => {
    const elsewhere: LegExitPriceCorrections = {
      ghost: { exitPrice: 104, originalExitPrice: 160, candleLow: 99, candleHigh: 105 },
    };
    const plain = computeDecisionAccuracy(campaign, legs, records, klines, []);
    expect(computeDecisionAccuracy(campaign, legs, records, klines, [], elsewhere)).toEqual(plain);
  });
});

describe('老数据两条腿指向同一条记录', () => {
  /**
   * 实时腿存仓位 id、回填腿存记录 id，两条都指向 rec-a；结算把它归回填腿（精确命中优先）。
   * 路径上 rec-a 仍排在实时腿（第一条腿）的位置，与改动之前逐字节相同：
   * 0.1 + 0.2 + 0.3 与 0.2 + 0.3 + 0.1 在浮点上不相等，顺序一变峰值的末位就跟着变。
   */
  const flat = [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 100, 100, 100, 100)];
  const shared = [
    record({ id: 'rec-a', positionId: 'pos-a', fillId: 'pos-a', exitPrice: 100.1, quantity: 1, pnl: 0.1, closeTime: T0 + HOUR / 2 }),
    record({ id: 'rec-b', positionId: 'pos-b', fillId: 'pos-b', exitPrice: 100.2, quantity: 1, pnl: 0.2, closeTime: T0 + HOUR / 2 }),
    record({ id: 'rec-c', positionId: 'pos-c', fillId: 'pos-c', exitPrice: 100.3, quantity: 1, pnl: 0.3, closeTime: T0 + HOUR / 2 }),
  ];
  const sharedLegs = [
    leg({ id: 'live-a', trade_record_id: 'pos-a', leg_role: 'main_open', leg_sequence: 1, pre_position_size: 100 }),
    leg({ id: 'b', trade_record_id: 'pos-b', leg_role: 'main_add_1', leg_sequence: 2, pre_position_size: 100 }),
    leg({ id: 'c', trade_record_id: 'pos-c', leg_role: 'main_add_2', leg_sequence: 3, pre_position_size: 100 }),
    leg({ id: 'backfilled-a', trade_record_id: 'rec-a', leg_role: 'main_add_3', leg_sequence: 4, pre_position_size: 100 }),
  ];

  it('记录只计一次，位置沿用它第一次出现的地方（峰值的末位与改动之前相同）', () => {
    const accuracy = computeDecisionAccuracy(campaign, sharedLegs, shared, flat, []);
    expect(accuracy.campaign_max_profit_real).toBe(0.1 + 0.2 + 0.3);
    expect(accuracy.campaign_max_profit_real).not.toBe(0.2 + 0.3 + 0.1);
    // 实时腿仍算作「路径上有它」，不会被判成挂单
    expect(resolveUnfilledLegIds(campaign, sharedLegs, shared).size).toBe(0);
  });
});

describe('主力开仓名义仓位按腿拆开（反事实副本的合成战役用）', () => {
  it('并进主力、没有腿的加仓不算；同一笔开仓被拆成两条腿时共用一组、份额之和等于组的名义；方向相反的镜像不算', () => {
    const merged = [
      record({ id: 'final-1', positionId: 'pos-main', fillId: 'pos-main', exitPrice: 110, quantity: 10, pnl: 100, closeTime: T0 + HOUR }),
      record({ id: 'final-2', positionId: 'pos-main', fillId: 'fill-add', entryPrice: 104, exitPrice: 110, quantity: 5, pnl: 30, closeTime: T0 + HOUR }),
    ];
    const mainOnly = [leg({ id: 'main', trade_record_id: 'pos-main', leg_role: 'main_open', leg_sequence: 1, pre_position_size: 1000 })];
    const single = resolveInitialExposureLegAttribution(campaign, mainOnly, merged);
    expect(single.shares.get('main')).toMatchObject({ notionalUsd: 1000, groupSize: 1 });

    // 历史归类：一笔开仓的两刀分别标成主力（收尾 40%）与镜像（60%），两条腿都存记录 id
    const split = [
      record({ id: 'tp', positionId: 'pos-x', fillId: 'fill-x', exitPrice: 104, quantity: 6, pnl: 24, closeTime: T0 + HOUR / 2 }),
      record({ id: 'rest', positionId: 'pos-x', fillId: 'fill-x', exitPrice: 110, quantity: 4, pnl: 40, closeTime: T0 + HOUR }),
    ];
    const splitLegs = [
      leg({ id: 'main', trade_record_id: 'rest', leg_role: 'main_open', leg_sequence: 1, pre_position_size: 400 }),
      leg({ id: 'mirror', trade_record_id: 'tp', leg_role: 'mirror_tp', leg_sequence: 2, pre_position_size: 600 }),
      leg({ id: 'short-mirror', trade_record_id: null, leg_role: 'mirror_tp', direction: 'short', leg_sequence: 3, pre_position_size: 300 }),
    ];
    const attribution = resolveInitialExposureLegAttribution(campaign, splitLegs, split);
    const main = attribution.shares.get('main');
    const mirror = attribution.shares.get('mirror');
    expect(main?.groupKey).toBe(mirror?.groupKey);
    expect(main?.groupSize).toBe(2);
    expect((main?.notionalUsd ?? 0) + (mirror?.notionalUsd ?? 0)).toBeCloseTo(computeInitialMainExposureNotional(campaign, splitLegs.slice(0, 2), split), 9);
    expect(attribution.excludedLegIds).toEqual(new Set(['short-mirror']));
  });
});

describe('历史归类的战役、本地没有成交记录：事件快照还原的持仓', () => {
  it('按事件合成的主力已经以复盘快照上了路径，描述同一笔的事件快照不再放一遍：峰值 300，不是 600', () => {
    const fx = parityFixture('sim-hist-event-only');
    const accuracy = computeDecisionAccuracy(fx.campaign, fx.legs, fx.tradeRecords, fx.klines, fx.reverseHedgeOrders, fx.corrections);
    // 01:00 那根高点 130 上只有主力 10 个：(130 − 100) × 10
    expect(accuracy.campaign_max_profit_real).toBeCloseTo(300, 9);
    // 已实现不受影响
    expect(computeCampaignPnlReconciliation(fx.campaign, fx.legs, fx.tradeRecords, fx.corrections).correctedPnl).toBeCloseTo(84.2, 9);
  });

  it('只在事件里的对冲按同一个成交 id 归到合成的那条腿（record-<成交 id>）：它在路径上，开平时刻与成交取事件', () => {
    const fx = parityFixture('sim-hist-event-hedge');
    const facts = resolveCampaignEquityPathLegFacts(fx.campaign, fx.legs, fx.tradeRecords);
    expect(facts.offPathLegIds.has('record-rec-a')).toBe(false);
    expect(facts.heldStartMsByLeg.get('record-rec-a')).toBe(T0 + HOUR / 2);
    expect(facts.heldWithoutRecordByLeg.get('record-rec-a')).toEqual({
      endMs: T0 + 3 * HOUR,
      eventFill: { entryPrice: 98, quantity: 5 },
    });
    // 主力是复盘快照上的路径：平仓时刻是它自己的，不带事件成交
    expect(facts.heldWithoutRecordByLeg.get('main')).toEqual({ endMs: T0 + 3 * HOUR, eventFill: null });
    const accuracy = computeDecisionAccuracy(fx.campaign, fx.legs, fx.tradeRecords, fx.klines, fx.reverseHedgeOrders, fx.corrections);
    expect(accuracy.campaign_max_profit_real).toBeCloseTo(140, 9);
  });

  it('触发后又撤单的老对冲：路径上的那一段按撤单时刻结束，这是它自己的平仓时刻', () => {
    const fx = parityFixture('sim-hedge-cancelled-after-trigger');
    const facts = resolveCampaignEquityPathLegFacts(fx.campaign, fx.legs, fx.tradeRecords);
    expect(facts.heldWithoutRecordByLeg.get('hedge-a')).toEqual({ endMs: T0 + HOUR / 3, eventFill: null });
    // 有成交记录的主力不在这张表里；从未成交的 B 也不在
    expect(facts.heldWithoutRecordByLeg.has('main')).toBe(false);
    expect(facts.unfilledLegIds).toEqual(new Set(['hedge-b']));
  });
});
