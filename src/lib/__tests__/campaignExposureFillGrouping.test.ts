import { describe, expect, it } from 'vitest';
import {
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
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

/**
 * 「初始敞口按开仓成交并组」这条规则的边界。
 *
 * 主用例（XLMUSDT 一笔仓位拆成 main_open + mirror_tp）在
 * campaignMirrorTpSplitExposure.test.ts；这里钉住它周围**容易反向踩错**的几种形状：
 * 修翻倍的时候只要把「各腿自己那一刀」相加，就会在「剩下的 40% 又切成两刀」上少算——
 * 那是「L 会随止盈缩水」这个老 bug 换了个方向重来。
 */
const SYMBOL = 'XLMUSDT';
const ENTRY = 0.269522;
const GUARD = 0.252333;
const LEVERAGE = 5;
const CONTRACT_SIZE_USD = 10;
const CONTRACTS = 67_358;                                   // 673,580 USDT
const EXPOSURE = CONTRACTS * CONTRACT_SIZE_USD;
const DRAWDOWN = (ENTRY - GUARD) / ENTRY;                   // 6.378%

const t = (hhmm: string) => Date.parse(`2026-05-30T${hhmm}:00+08:00`);
const T_OPEN = t('08:54');
const toIso = (ms: number) => new Date(ms).toISOString();
const recordSize = (record: TradeRecord) =>
  Math.abs(getPositionNotionalUsd(record.symbol, record, record.entryPrice));

/** 开一笔仓，然后按给定的张数依次切刀平掉，返回每刀的记录。 */
function openThenClose(
  cuts: Array<{ contracts: number; at: number; price: number }>,
  opts: { contracts?: number; side?: 'LONG' | 'SHORT' } = {},
): TradeRecord[] {
  const side = opts.side ?? 'LONG';
  const total = opts.contracts ?? CONTRACTS;
  const opened = executeSettlementFill(SYMBOL, ENTRY, {
    side, quantity: total, contracts: total, leverage: LEVERAGE,
    marginMode: 'isolated', settlementMode: 'coin', settlementAsset: 'XLM',
    contractSizeUsd: CONTRACT_SIZE_USD,
  }, true, T_OPEN);
  let position = mergeFilledPosition(SYMBOL, [], opened.position).positions[0];
  const records: TradeRecord[] = [];
  for (const cut of cuts) {
    const settled = settlePositionClose(SYMBOL, position, cut.price, cut.contracts, cut.at, 'manual');
    if (!settled) throw new Error('settlement returned null');
    records.push(...settled.records);
    position = scaleSettlementPosition(position, settled.remainingUnits);
  }
  return records;
}

function legFromRecord(record: TradeRecord, role: LegRole, sequence: number): TradeJournal {
  const now = '2026-09-07T00:00:00.000Z';
  return {
    id: `record-${record.id}`,
    user_id: 'u',
    trade_record_id: record.id,
    campaign_id: 'c',
    leg_role: role,
    leg_sequence: sequence,
    source: 'retroactive_from_record',
    symbol: record.symbol,
    direction: record.side === 'SHORT' ? 'short' : 'long',
    leverage: record.leverage,
    position_mode: 'isolated',
    order_kind: 'main',
    pre_simulated_time: toIso(record.openTime),
    pre_real_time: now,
    pre_entry_price: record.entryPrice,
    pre_position_size: recordSize(record),
    pre_settlement_mode: record.settlementMode ?? 'usdt',
    pre_contracts: record.contracts ?? null,
    pre_contract_size_usd: record.contractSizeUsd ?? null,
    post_realized_pnl: record.pnl,
    post_simulated_close_time: toIso(record.closeTime),
    post_exit_price_snapshot: record.exitPrice,
    created_at: now,
    updated_at: now,
  } as TradeJournal;
}

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
    notes: null,
    recorded_at: '2026-09-07T00:00:00.000Z',
    direction: record.side === 'SHORT' ? 'short' : 'long',
    leverage: record.leverage,
    order_kind: 'main',
    leg_sequence: sequence,
    open_time: toIso(record.openTime),
    close_time: toIso(record.closeTime),
    entry_price: record.entryPrice,
    exit_price: record.exitPrice,
    realized_pnl: record.pnl,
    r_multiple: null,
  } as CampaignEvent;
}

function buildCampaign(events: CampaignEvent[], direction: 'main_long' | 'main_short' = 'main_long'): TradeCampaign {
  return {
    id: 'c',
    user_id: 'u',
    campaign_code: 'X',
    symbol: SYMBOL,
    direction,
    status: 'closed_profit',
    strategy_template: 'main_dual_hedge_mirror_tp',
    title: 'grouping fixture',
    opened_at: toIso(T_OPEN),
    closed_at: toIso(t('12:29')),
    initial_main_size_usdt: null,
    initial_leverage: LEVERAGE,
    final_realized_pnl: null,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: events,
    deviation_notes: {},
    deleted_at: null,
    created_at: '2026-09-07T00:00:00.000Z',
    updated_at: '2026-09-07T00:00:00.000Z',
  } as TradeCampaign;
}

const guards = (price = GUARD): CampaignReverseHedgeOrder[] => ([{
  id: 'guard', tradeRecordId: null, side: 'SHORT', price,
  createdAt: T_OPEN, triggeredAt: null, cancelledAt: t('11:55'), status: 'cancelled',
}]);

describe('初始敞口按开仓成交并组', () => {
  it('【判据】镜像吃 60%，剩下的 40% 又切成两刀、主力腿只认领其中一刀 —— 敞口仍是全额', () => {
    // 40,415 (镜像) + 13,472 + 13,471 = 67,358 张。主力腿只挂在第二刀上。
    const [mirror, firstHalf, secondHalf] = openThenClose([
      { contracts: 40_415, at: t('10:57'), price: 0.287948 },
      { contracts: 13_472, at: t('12:00'), price: 0.281 },
      { contracts: 13_471, at: t('12:29'), price: 0.279864 },
    ]);
    expect(recordSize(mirror) + recordSize(firstHalf) + recordSize(secondHalf)).toBeCloseTo(EXPOSURE, 6);

    const legs = [legFromRecord(secondHalf, 'main_open', 1), legFromRecord(mirror, 'mirror_tp', 2)];
    const campaign = buildCampaign([
      eventFromRecord(secondHalf, 'main_open', 1),
      eventFromRecord(mirror, 'mirror_tp', 2),
    ]);
    const records = [mirror, firstHalf, secondHalf];

    // 按「各腿自己那一刀」求和会得到 404,150 + 134,710 = 538,860，少算未被认领的 134,720。
    expect(computeInitialMainExposureNotional(campaign, legs, records)).toBeCloseTo(EXPOSURE, 0);
    expect(computeInitialExpectedMaxLoss(campaign, legs, records, guards()))
      .toBeCloseTo(DRAWDOWN * EXPOSURE, 0);
    // 分子仍是镜像自己平掉的那一刀
    expect(computeMirrorTpReductionPct(campaign, legs[1], legs, records)!).toBeCloseTo(60, 1);
  });

  it('【回归】只有主力一条腿、仓位分三刀平掉 —— 敞口不随平仓缩水', () => {
    const cuts = openThenClose([
      { contracts: 20_000, at: t('10:00'), price: 0.28 },
      { contracts: 20_000, at: t('11:00'), price: 0.281 },
      { contracts: 27_358, at: t('12:29'), price: 0.279864 },
    ]);
    // 主力腿挂在最后一刀上：那一刀只有 273,580，但开仓开的是 673,580。
    const legs = [legFromRecord(cuts[2], 'main_open', 1)];
    const campaign = buildCampaign([eventFromRecord(cuts[2], 'main_open', 1)]);
    expect(computeInitialMainExposureNotional(campaign, legs, cuts)).toBeCloseTo(EXPOSURE, 0);
  });

  it('镜像独立成仓（老式 50/50 两个仓位）：敞口相加，减仓比例 50%', () => {
    const half = CONTRACTS / 2;                       // 33,679 张 = 336,790 USDT
    const [mainRecord] = openThenClose([{ contracts: half, at: t('12:29'), price: 0.279864 }], { contracts: half });
    const [mirrorRecord] = openThenClose([{ contracts: half, at: t('10:57'), price: 0.287948 }], { contracts: half });
    expect(mainRecord.fillId).not.toBe(mirrorRecord.fillId);

    const legs = [legFromRecord(mainRecord, 'main_open', 1), legFromRecord(mirrorRecord, 'mirror_tp', 2)];
    const campaign = buildCampaign([
      eventFromRecord(mainRecord, 'main_open', 1),
      eventFromRecord(mirrorRecord, 'mirror_tp', 2),
    ]);
    const records = [mainRecord, mirrorRecord];

    expect(computeInitialMainExposureNotional(campaign, legs, records)).toBeCloseTo(EXPOSURE, 0);
    expect(computeMirrorTpReductionPct(campaign, legs[1], legs, records)!).toBeCloseTo(50, 1);
  });

  it('镜像独立成仓且自己被分两刀平掉：分子取它整笔仓位，不是其中一刀', () => {
    const mainContracts = 27_358;                     // 273,580
    const mirrorContracts = 40_000;                   // 400,000
    const [mainRecord] = openThenClose(
      [{ contracts: mainContracts, at: t('12:29'), price: 0.279864 }], { contracts: mainContracts });
    const mirrorCuts = openThenClose([
      { contracts: 25_000, at: t('10:57'), price: 0.287948 },
      { contracts: 15_000, at: t('11:20'), price: 0.288 },
    ], { contracts: mirrorContracts });

    const legs = [legFromRecord(mainRecord, 'main_open', 1), legFromRecord(mirrorCuts[0], 'mirror_tp', 2)];
    const campaign = buildCampaign([
      eventFromRecord(mainRecord, 'main_open', 1),
      eventFromRecord(mirrorCuts[0], 'mirror_tp', 2),
    ]);
    const records = [mainRecord, ...mirrorCuts];

    const total = mainContracts * CONTRACT_SIZE_USD + mirrorContracts * CONTRACT_SIZE_USD;
    expect(computeInitialMainExposureNotional(campaign, legs, records)).toBeCloseTo(total, 0);
    // 镜像整笔 400,000 ÷ 673,580 ≈ 59.4%，而不是第一刀的 250,000 ÷ 673,580 ≈ 37.1%
    expect(computeMirrorTpReductionPct(campaign, legs[1], legs, records)!)
      .toBeCloseTo(mirrorContracts * CONTRACT_SIZE_USD / total * 100, 1);
  });

  it('做空战役对称：一笔空仓拆成 main_open + mirror_tp 也只数一次', () => {
    const [mirror, final] = openThenClose([
      { contracts: 40_415, at: t('10:57'), price: 0.25 },
      { contracts: 26_943, at: t('12:29'), price: 0.26 },
    ], { side: 'SHORT' });

    const legs = [legFromRecord(final, 'main_open', 1), legFromRecord(mirror, 'mirror_tp', 2)];
    const campaign = buildCampaign([
      eventFromRecord(final, 'main_open', 1),
      eventFromRecord(mirror, 'mirror_tp', 2),
    ], 'main_short');
    const records = [mirror, final];

    expect(computeInitialMainExposureNotional(campaign, legs, records)).toBeCloseTo(EXPOSURE, 0);
    expect(computeMirrorTpReductionPct(campaign, legs[1], legs, records)!).toBeCloseTo(60, 1);
  });

  it('镜像只剩事件、没有腿：事件兜底照旧生效（并组不能把这条路堵死）', () => {
    const [mirror, final] = openThenClose([
      { contracts: 40_415, at: t('10:57'), price: 0.287948 },
      { contracts: 26_943, at: t('12:29'), price: 0.279864 },
    ]);
    // 只有主力一条腿；镜像那一档仅存在于事件流里。
    const legs = [legFromRecord(final, 'main_open', 1)];
    const campaign = buildCampaign([
      eventFromRecord(final, 'main_open', 1),
      eventFromRecord(mirror, 'mirror_tp', 2),
    ]);
    // 主力腿沿 fillId 展开已是整笔 673,580；镜像事件不能再加一遍。
    expect(computeInitialMainExposureNotional(campaign, legs, [mirror, final])).toBeCloseTo(EXPOSURE, 0);
  });
});
