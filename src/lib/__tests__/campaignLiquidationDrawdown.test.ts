/**
 * 爆仓腿在战役权益路径上的封顶：账户在一条逐仓强平的腿上亏掉的**恰好是隔离保证金**，
 * 强平价之下的价格从来不属于它。
 *
 * 事故：权益路径把强平腿一路按 K 线最低价重估、且用的就是强平那根 K 线的极值——
 * 20 倍杠杆、保证金 1000 的多单，强平价 0.9540、那根 K 线砸到 0.8000，
 * 「今日最大回撤」读出 4000（名义 20000 × 20% 的价差），而钱包只少了 1000。
 * 这个数会流进 campaign.peak_drawdown、SOP 扣分与反事实的「原样重跑」。
 */
import { describe, expect, it } from 'vitest';
import type { KlineData } from '@/hooks/useBinanceData';
import { computeCampaignPnlPathExtremes, computeDecisionAccuracy } from '@/lib/campaignAnalysis';
import { liquidationPnlFloorUsd } from '@/lib/liquidationRecord';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-03-01T00:00:00.000Z');
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
  status: 'closed_loss',
  strategy_template: 'custom',
  title: 'c',
  opened_at: iso(T0),
  closed_at: iso(T0 + 2 * HOUR),
  initial_main_size_usdt: 20_000,
  initial_leverage: 20,
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

/** 逐仓多单：开仓 1.0000 × 20000 币、20 倍，隔离保证金 1000；强平价 0.9540 上按破产价结算。 */
const liquidationRecord: TradeRecord = {
  id: 'liq',
  positionId: 'pos-liq',
  fillId: 'pos-liq',
  symbol: 'TESTUSDT',
  side: 'LONG',
  type: 'MARKET',
  action: 'LIQUIDATION',
  exit_method: 'liquidation',
  liquidationSettlement: 'bankruptcy',
  entryPrice: 1,
  exitPrice: 0.954,
  quantity: 20_000,
  leverage: 20,
  pnl: -1000,
  fee: 12,
  liquidationFeeUsd: 8,
  slippage: 0,
  openTime: T0,
  closeTime: T0 + HOUR + HOUR / 2,
} as TradeRecord;

const legs: TradeJournal[] = [{
  id: 'main',
  user_id: 'u',
  campaign_id: 'c',
  source: 'live',
  symbol: 'TESTUSDT',
  direction: 'long',
  leverage: 20,
  leg_role: 'main_open',
  leg_sequence: 1,
  trade_record_id: 'pos-liq',
  pre_simulated_time: iso(T0),
  pre_entry_price: 1,
  pre_position_size: 20_000,
} as unknown as TradeJournal];

// 强平那根 K 线砸到 0.8000（远低于强平价 0.9540）后收回。
const klines = [
  bar(0, 1, 1.01, 0.99, 1),
  bar(1, 0.99, 0.99, 0.8, 0.95),
  bar(2, 0.95, 0.96, 0.94, 0.95),
];

describe('爆仓腿的最大回撤按保证金封顶', () => {
  it('逐仓强平：回撤 = 隔离保证金 1000，不是按 K 线最低价重估的 4000', () => {
    const accuracy = computeDecisionAccuracy(campaign, legs, [liquidationRecord], klines, []);
    expect(accuracy.campaign_max_drawdown_real).toBeCloseTo(1000, 6);
    // 爆仓之前那根 K 线冲到 1.01：浮盈 200 照算，封顶只截亏损这一侧
    expect(accuracy.campaign_max_profit_real).toBeCloseTo(200, 6);
  });

  it('封顶取这条记录自己结算掉的那笔钱（带符号），不是按名义 ÷ 杠杆估的保证金', () => {
    expect(liquidationPnlFloorUsd(liquidationRecord)).toBeCloseTo(-1000, 9);
    // 持仓中途提过杠杆：record.leverage 恒为开仓杠杆，按它估保证金会超报（1000），实际结算掉的是 500
    expect(liquidationPnlFloorUsd({ ...liquidationRecord, pnl: -500 } as TradeRecord)).toBeCloseTo(-500, 9);
    // 盈亏坏了的老记录才退回「开仓名义 ÷ 开仓杠杆」
    expect(liquidationPnlFloorUsd({ ...liquidationRecord, pnl: Number.NaN } as TradeRecord)).toBeCloseTo(-1000, 9);
    // 全仓强平没有保证金兜底：不封顶
    expect(liquidationPnlFloorUsd({
      ...liquidationRecord,
      liquidationSettlement: undefined,
      pnl: -4253,
    } as TradeRecord)).toBeNull();
    // 普通平仓不封顶
    expect(liquidationPnlFloorUsd({ ...liquidationRecord, action: 'CLOSE', exit_method: 'manual' } as TradeRecord)).toBeNull();
  });

  it('封顶只在强平那根 K 线内生效：更早的 K 线按真实浮亏算（中途提杠杆 / 加仓前的回撤不能被截浅）', () => {
    // 20 倍、保证金 1000 时先跌到 0.9600（浮亏 800，没爆）；之后提到 40 倍、保证金变 500，再在 0.9770 被强平结算 −500。
    // 封顶 −500 只对强平那根 K 线成立，更早那根 K 线的 −800 是账户真实经历过的回撤。
    const raisedLeverage = { ...liquidationRecord, exitPrice: 0.977, pnl: -500, closeTime: T0 + 2 * HOUR + HOUR / 2 } as TradeRecord;
    const path = [
      bar(0, 1, 1.01, 0.99, 1),
      bar(1, 0.99, 0.99, 0.96, 0.98),
      bar(2, 0.98, 0.98, 0.9, 0.95),
    ];
    const accuracy = computeDecisionAccuracy(campaign, legs, [raisedLeverage], path, []);
    expect(accuracy.campaign_max_drawdown_real).toBeCloseTo(800, 6);
    // 强平那根 K 线砸到 0.9000（浮亏 2000）：这根才截到 −500
    const extremes = computeCampaignPnlPathExtremes(
      [{ side: 'LONG', quantity: 20_000, entryPrice: 1, startMs: T0, endMs: T0 + 2 * HOUR + HOUR / 2, realizedPnl: -500, pnlFloorUsd: -500 }],
      [path[0], path[2]],
      T0,
      T0 + 3 * HOUR,
    );
    expect(extremes.maxDrawdown).toBeCloseTo(-500, 6);
  });

  it('反事实「Legs 副本」的极值算法同一条封顶，两块面板并排时读数一致', () => {
    const extremes = computeCampaignPnlPathExtremes(
      [{
        side: 'LONG',
        quantity: 20_000,
        entryPrice: 1,
        startMs: T0,
        endMs: T0 + HOUR + HOUR / 2,
        realizedPnl: -1000,
        pnlFloorUsd: -1000,
      }],
      klines,
      T0,
      T0 + 2 * HOUR,
    );
    expect(extremes.maxDrawdown).toBeCloseTo(-1000, 6);
  });
});
