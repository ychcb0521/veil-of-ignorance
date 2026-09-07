import { describe, expect, it } from 'vitest';
import {
  computeInitialExpectedMaxDrawdownPct,
  computeInitialExpectedMaxLoss,
  computeInitialMainExposureNotional,
  computeMirrorTpReductionPct,
} from '@/lib/campaignAnalysis';
import {
  executeSettlementFill,
  getPositionNotionalUsd,
  mergeFilledPosition,
  scaleSettlementPosition,
  settlePositionClose,
} from '@/lib/tradingSettlement';
import type { CampaignEvent, LegRole, TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, Position, TradeRecord } from '@/types/trading';

/**
 * 事故 XLMUSDT 2026-05-30（分类页从仓位历史记录建的战役，用户导出的快照）：
 *
 * 一笔 5x 多单 08:54 开在 0.269522，2,499,166 币 = 67,358 张 × 10 USD = **673,580 USDT**。
 * 镜像止盈 10:57 平掉 60%（40,415 张 = 404,150 USDT → 记录 A），
 * 12:29 收尾平掉剩下 40%（26,943 张 = 269,430 USDT → 记录 B）。
 * 同一个仓位的两刀，所以 A、B **同 positionId、同 fillId**——这是 buildCloseRecords 的写法。
 * 回填腿：main_open → B（收尾那条），mirror_tp → A（镜像那条）。
 * 两张 0.252333 的空单保护线后来撤掉了 → 预期回撤 = (0.269522−0.252333)/0.269522 = 6.378%。
 *
 * 界面显示：主力开仓名义仓位 **1,347,160**（恰好 2.000 × 673,580）、
 * 最大预期亏损 **85,915.89**、图上标记「M 减仓 **50%**」。
 * 真值：敞口 673,580、L ≈ 42,958、减仓 60%。
 *
 * 病根：settlementSlicesFor 精确命中一条之后把同 fillId 的兄弟分片一并带上。
 * 这对「一笔成交经多刀平仓、只有主力一条腿」是对的——L 是 ex-ante 量，不能随止盈缩水
 * （133.85 → 53.54 那次事故）。但当同一笔仓位的两刀分别挂在 main_open 与 mirror_tp
 * 两条腿上时，两条腿各自都展开成 [A, B] = 673,580，按角色求和就把整笔仓位数了两遍；
 * 镜像的分子同样被展开成整笔，于是 673,580 / 1,347,160 = 50%。
 *
 * 「恰好 2.000 倍」这个整数比本身就是判据：价格、滑点、取整的误差不会给出整洁的 2。
 */
const SYMBOL = 'XLMUSDT';
const ENTRY = 0.269522;
const GUARD = 0.252333;                       // 委托栏里那两张「空 0.252333」
const LEVERAGE = 5;
const CONTRACT_SIZE_USD = 10;                 // 非 BTC 的币本位合约面值
const CONTRACTS = 67_358;                     // × 10 = 673,580 USDT
const MIRROR_CONTRACTS = 40_415;              // 60% → 404,150 USDT
const FINAL_CONTRACTS = CONTRACTS - MIRROR_CONTRACTS;   // 26,943 → 269,430 USDT
const TP_PRICE = 0.287948;
const FINAL_PRICE = 0.279864;

const t = (hhmm: string) => Date.parse(`2026-05-30T${hhmm}:00+08:00`);
const T_OPEN = t('08:54');
const T_TP = t('10:57');
const T_FINAL = t('12:29');

const TRUE_EXPOSURE = CONTRACTS * CONTRACT_SIZE_USD;            // 673,580
const TRUE_DRAWDOWN_PCT = ((ENTRY - GUARD) / ENTRY) * 100;      // 6.378%
const TRUE_LOSS = (TRUE_DRAWDOWN_PCT / 100) * TRUE_EXPOSURE;    // ≈ 42,958
const TRUE_REDUCTION_PCT = (MIRROR_CONTRACTS / CONTRACTS) * 100; // 60.0%

/**
 * 用真实结算代码走一遍：开仓 → mergeFilledPosition 入账 → 镜像止盈 60% →
 * scaleSettlementPosition 缩仓 → 收尾平掉剩下的。
 * 开仓用 maker 价免掉滑点，让开仓价就是 0.269522；平仓走引擎同一条 taker 路径
 * （滑点只影响盈亏，名义完全由张数决定，与本题无关）。
 */
function buildXlmRecords(): { position: Position; recordA: TradeRecord; recordB: TradeRecord } {
  const opened = executeSettlementFill(SYMBOL, ENTRY, {
    side: 'LONG', quantity: CONTRACTS, contracts: CONTRACTS, leverage: LEVERAGE,
    marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'XLM',
    contractSizeUsd: CONTRACT_SIZE_USD,
  }, true, T_OPEN);
  const position = mergeFilledPosition(SYMBOL, [], opened.position).positions[0];

  const tp = settlePositionClose(SYMBOL, position, TP_PRICE, MIRROR_CONTRACTS, T_TP, 'tp1');
  if (!tp) throw new Error('mirror TP settlement returned null');
  const remaining = scaleSettlementPosition(position, tp.remainingUnits);
  const final = settlePositionClose(SYMBOL, remaining, FINAL_PRICE, FINAL_CONTRACTS, T_FINAL, 'manual');
  if (!final) throw new Error('final settlement returned null');

  expect(tp.records).toHaveLength(1);
  expect(final.records).toHaveLength(1);
  return { position, recordA: tp.records[0], recordB: final.records[0] };
}

const toIso = (ms: number) => new Date(ms).toISOString();
/** journalApi.tradeRecordPositionSize 的口径：币本位完全由张数 × 面值决定。 */
const recordSize = (record: TradeRecord) =>
  Math.abs(getPositionNotionalUsd(record.symbol, record, record.entryPrice));

/** 照 journalApi.synthesizeJournalFromRecord 合成的回填腿（事件 journal_id 为 null → id 取 record-…）。 */
function legFromRecord(record: TradeRecord, role: LegRole, sequence: number, campaignId: string): TradeJournal {
  const now = '2026-09-07T00:00:00.000Z';
  return {
    id: `record-${record.id}`,
    user_id: 'u',
    trade_record_id: record.id,
    campaign_id: campaignId,
    leg_role: role,
    leg_sequence: sequence,
    source: 'retroactive_from_record',
    symbol: record.symbol,
    direction: 'long',
    leverage: record.leverage,
    position_mode: 'isolated',
    order_kind: 'main',
    pre_simulated_time: toIso(record.openTime),
    pre_real_time: now,
    pre_entry_price: record.entryPrice,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: '[历史记录归类] 由仓位历史记录直接组成交易战役',
    pre_mental_state: 3,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: null,
    pre_position_size: recordSize(record),
    pre_settlement_mode: record.settlementMode ?? 'usdt',
    pre_settlement_asset: record.settlementAsset ?? null,
    pre_contract_size_usd: record.contractSizeUsd ?? null,
    pre_contracts: record.contracts ?? null,
    pre_max_loss_usdt: null,
    hedge_type: null,
    hedge_necessity_pct: null,
    post_outcome: record.pnl > 0 ? 'win' : record.pnl < 0 ? 'loss' : 'breakeven',
    post_realized_pnl: record.pnl,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    post_real_close_time: null,
    post_simulated_close_time: toIso(record.closeTime),
    post_exit_price_snapshot: record.exitPrice,
    reason_was_rewritten: false,
    created_at: now,
    updated_at: now,
  } as TradeJournal;
}

/** 照 journalApi.campaignEventFromTradeRecord：分类页给每条记录发一个 historical_leg_attached。 */
function eventFromRecord(record: TradeRecord, role: LegRole, sequence: number): CampaignEvent {
  return {
    id: `event-${record.id}`,
    timestamp: toIso(record.openTime),
    event_type: 'historical_leg_attached',
    leg_role: role,
    journal_id: null,
    trade_record_id: record.id,
    pending_order_id: null,
    price: record.entryPrice,
    size_usdt: recordSize(record),
    notes: 'classified retroactively · 仓位历史记录',
    recorded_at: '2026-09-07T00:00:00.000Z',
    direction: 'long',
    leverage: record.leverage,
    order_kind: 'main',
    leg_sequence: sequence,
    open_time: toIso(record.openTime),
    close_time: toIso(record.closeTime),
    entry_price: record.entryPrice,
    exit_price: record.exitPrice,
    realized_pnl: record.pnl,
    r_multiple: null,
  };
}

/** 照 journalApi.createCampaignFromTradeRecords：initial_main_size_usdt 取 main_open 那条记录的名义。 */
function buildCampaign(recordA: TradeRecord, recordB: TradeRecord): TradeCampaign {
  const id = 'campaign-xlm-2026-05-30';
  return {
    id,
    user_id: 'u',
    campaign_code: 'XLM-0530',
    symbol: SYMBOL,
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'main_dual_hedge_mirror_tp',
    title: 'XLMUSDT 2026-05-30 profit',
    opened_at: toIso(T_OPEN),
    closed_at: toIso(T_FINAL),
    // 分类页把 main_open 归到收尾那条记录（B），于是这里写进去的是 40% 残仓的 269,430。
    initial_main_size_usdt: recordSize(recordB),
    initial_leverage: LEVERAGE,
    final_realized_pnl: recordA.pnl + recordB.pnl,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [
      {
        id: 'event-created',
        timestamp: toIso(T_OPEN),
        event_type: 'historical_classification_created',
        leg_role: null, journal_id: null, trade_record_id: null, pending_order_id: null,
        price: null, size_usdt: null, notes: null,
        recorded_at: '2026-09-07T00:00:00.000Z',
      },
      eventFromRecord(recordB, 'main_open', 1),
      eventFromRecord(recordA, 'mirror_tp', 2),
    ],
    deviation_notes: {},
    deleted_at: null,
    created_at: '2026-09-07T00:00:00.000Z',
    updated_at: '2026-09-07T00:00:00.000Z',
  };
}

/** 两张撤掉的保护空单（getCampaignFullData 对已撤委托的输出形状）。 */
const GUARDS: CampaignReverseHedgeOrder[] = [
  {
    id: 'guard-a', tradeRecordId: null, side: 'SHORT', price: GUARD,
    createdAt: T_OPEN, triggeredAt: null, cancelledAt: t('11:55'), status: 'cancelled',
  },
  {
    id: 'guard-b', tradeRecordId: null, side: 'SHORT', price: GUARD,
    createdAt: t('08:55'), triggeredAt: null, cancelledAt: T_FINAL, status: 'cancelled',
  },
];

function setup() {
  const { position, recordA, recordB } = buildXlmRecords();
  const campaign = buildCampaign(recordA, recordB);
  const mainLeg = legFromRecord(recordB, 'main_open', 1, campaign.id);
  const mirrorLeg = legFromRecord(recordA, 'mirror_tp', 2, campaign.id);
  return { position, recordA, recordB, campaign, legs: [mainLeg, mirrorLeg], mirrorLeg, records: [recordA, recordB] };
}

describe('同一笔仓位拆成 main_open + mirror_tp 两条腿时，敞口只能数一次', () => {
  it('【前提】真实结算代码产出的两条记录：同仓位、同 fillId、名义 404,150 / 269,430', () => {
    const { position, recordA, recordB } = setup();
    expect(recordSize(recordA)).toBeCloseTo(404_150, 6);
    expect(recordSize(recordB)).toBeCloseTo(269_430, 6);
    expect(recordSize(recordA) + recordSize(recordB)).toBeCloseTo(TRUE_EXPOSURE, 6);
    // 单笔成交的仓位：两刀都写 positionId = fillId = 仓位 id，记录 id 互不相同
    expect(recordA.positionId).toBe(position.id);
    expect(recordB.positionId).toBe(position.id);
    expect(recordA.fillId).toBe(position.id);
    expect(recordB.fillId).toBe(position.id);
    expect(recordA.id).not.toBe(recordB.id);
    expect(recordA.entryPrice).toBeCloseTo(ENTRY, 9);
    expect(recordB.entryPrice).toBeCloseTo(ENTRY, 9);
    expect(recordA.settlementMode).toBe('coin');
  });

  it('【回归】主力开仓名义仓位 = 673,580，不是 2 × 673,580', () => {
    const { campaign, legs, records } = setup();
    const exposure = computeInitialMainExposureNotional(campaign, legs, records);
    expect(exposure).toBeCloseTo(TRUE_EXPOSURE, 0);
    expect(exposure).not.toBeCloseTo(2 * TRUE_EXPOSURE, 0);   // 界面上那个 1,347,160
  });

  it('【回归】镜像减仓比例 = 60%，不是 50%', () => {
    const { campaign, legs, records, mirrorLeg } = setup();
    const pct = computeMirrorTpReductionPct(campaign, mirrorLeg, legs, records);
    expect(pct).not.toBeNull();
    expect(pct!).toBeCloseTo(TRUE_REDUCTION_PCT, 1);   // 404,150 / 673,580
  });

  it('预期回撤比例本来就是对的：6.378%', () => {
    const { campaign, legs, records } = setup();
    const drawdown = computeInitialExpectedMaxDrawdownPct(campaign, legs, records, GUARDS);
    expect(drawdown).toBeCloseTo(TRUE_DRAWDOWN_PCT, 2);
    expect(TRUE_DRAWDOWN_PCT).toBeCloseTo(6.378, 3);
  });

  it('【判据】最大预期亏损 ≈ 42,958 = 6.378% × 673,580，不是 85,915.89', () => {
    const { campaign, legs, records } = setup();
    const L = computeInitialExpectedMaxLoss(campaign, legs, records, GUARDS);
    expect(Math.abs(L - TRUE_LOSS)).toBeLessThanOrEqual(10);
    expect(L).not.toBeCloseTo(2 * TRUE_LOSS, -2);      // 界面上那个 85,915.89
  });
});
