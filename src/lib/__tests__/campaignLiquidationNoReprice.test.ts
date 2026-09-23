/**
 * 强平记录**永远不按 1 分钟 K 线重新定价**——不论它带不带 'bankruptcy' 标记。
 *
 * 事故：平仓价校正只挡了逐仓破产价结算的记录（liquidationSettlement === 'bankruptcy'），
 * 于是每一条**全仓**强平、以及标记上线之前的老逐仓强平，都会被收线后那一分钟的 K 线改写盈亏：
 * BTC 全仓多单实际亏 4253（交易所在强平价上收走仓位），K 线收在 97,200 时页面读成 −1653，
 * 这个数还会一路进合计、Δb、b、R、战役状态与自愈回写的 final_realized_pnl。
 *
 * 价不在 K 线里仍要报出来，但只作为「强平异常」的警示，不改数——
 * 连**显示**的平仓价也不换：盈亏按交易所的强平结算，价格三格若换成 K 线价，同一行就成了两对价
 * （平仓价 97,200 / 涨跌幅 −2.80%，盈亏却是占名义 −8.51% 的 −4253），
 * 副本里的 cut.exit_price 也会落在一个交易所从未成交过的价上，改「仓位」一格就按它定价。
 */
import { describe, expect, it } from 'vitest';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import {
  buildTradeRecordPnlCorrection,
  resolveLegExecution,
  type LegExitPriceCorrections,
} from '@/lib/campaignLegExecution';
import { buildManualLegs, resolveManualLegEconomics } from '@/lib/campaignSimulationEngine';
import type { CampaignCounterfactualParams } from '@/types/journal';
import type { KlineData } from '@/hooks/useBinanceData';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const T0 = Date.parse('2026-04-01T00:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

/** 全仓强平：净盈亏 = 标记盈亏 − 平仓费 − 强平费，没有保证金封顶，所以记录不带 bankruptcy 标记。 */
const crossLiquidation: TradeRecord = {
  id: 'rec-cross-liq',
  positionId: 'pos-cross',
  fillId: 'pos-cross',
  symbol: 'BTCUSDT',
  side: 'LONG',
  type: 'MARKET',
  action: 'LIQUIDATION',
  exit_method: 'liquidation',
  entryPrice: 100_000,
  exitPrice: 92_000,
  quantity: 0.5,
  leverage: 20,
  pnl: -4253,
  fee: 253,
  liquidationFeeUsd: 230,
  slippage: 0,
  openTime: T0,
  closeTime: T0 + 3_600_000,
} as TradeRecord;

const correction: LegExitPriceCorrections[string] = {
  exitPrice: 97_200,
  originalExitPrice: 92_000,
  candleLow: 97_000,
  candleHigh: 97_500,
};

const campaign = {
  id: 'c',
  final_realized_pnl: null,
  actual_evolution: [],
} as unknown as TradeCampaign;

const leg = {
  id: 'main',
  campaign_id: 'c',
  symbol: 'BTCUSDT',
  direction: 'long',
  leg_role: 'main_open',
  leg_sequence: 1,
  trade_record_id: 'pos-cross',
  pre_simulated_time: iso(T0),
  pre_entry_price: 100_000,
  pre_position_size: 50_000,
} as unknown as TradeJournal;

const MIN = 60_000;

const k = (index: number, open: number, high: number, low: number, close: number): KlineData => ({
  time: T0 + index * MIN, open, high, low, close, volume: 0,
});

const klines = [k(0, 100_000, 100_100, 99_900, 100_000), k(60, 98_000, 98_000, 92_000, 97_200)];

const cfCampaign = {
  id: 'c',
  symbol: 'BTCUSDT',
  direction: 'main_long',
  status: 'closed_loss',
  strategy_template: 'custom',
  opened_at: iso(T0),
  closed_at: iso(T0 + 3_600_000),
  final_realized_pnl: -4253,
  actual_evolution: [],
} as unknown as TradeCampaign;

const params = (): CampaignCounterfactualParams => ({
  entry: { time: iso(T0), price: 100_000, size_usdt: 50_000, direction: 'long', leverage: 20 },
  hedge_a: { offset_pct: -2, size_pct: 50 },
  hedge_b: { offset_pct: -4, size_pct: 50 },
  mirror_tp: { offset_pct: 2, size_pct: 50 },
  rolling: {
    enabled: false,
    trigger_rise_pct: 10,
    min_interval_minutes: 60,
    new_hedge_offset_pct: -2,
    rolling_hedge_size_pct: 100,
  },
  exit_rule: 'close_all_on_hedge_trigger',
});

describe('强平记录不被 1 分钟 K 线重新定价', () => {
  it('全仓强平（没有 bankruptcy 标记）：校正不产生盈亏差额', () => {
    expect(buildTradeRecordPnlCorrection(crossLiquidation, correction)).toBeNull();
  });

  it('老的逐仓强平（标记上线之前）同样不重算', () => {
    const legacy = { ...crossLiquidation, id: 'rec-legacy', action: 'CLOSE' } as TradeRecord;
    expect(buildTradeRecordPnlCorrection(legacy, correction)).toBeNull();
  });

  it('战役已实现 P&L 读的仍是交易所结算的 −4253，不是按 K 线改出来的 −1653', () => {
    const settled = computeCampaignRealizedPnl(campaign, [leg], [crossLiquidation], { main: correction });
    expect(settled.total).toBeCloseTo(-4253, 6);
    expect(settled.byLeg.get('main')).toBeCloseTo(-4253, 6);
  });

  it('显示的平仓价仍是记录里的强平价：一行里三个价格格子与盈亏同用一对价', () => {
    const execution = resolveLegExecution(leg, crossLiquidation, { main: correction });
    expect(execution.exitPrice).toBe(92_000);
    // 「强平异常」照常报出来（警示），K 线区间留在悬停说明里
    expect(execution.exitCorrection).toEqual(correction);
  });

  it('副本的那一刀也按交易所成交价定价：改「仓位」一格不再按 K 线价算', () => {
    const [manual] = buildManualLegs(
      params(),
      [leg],
      klines,
      [crossLiquidation],
      { main: correction },
      { campaign: cfCampaign },
    );
    expect(manual.exit_price).toBe(92_000);
    expect(manual.actual?.cuts?.[0].exit_price).toBe(92_000);
    // 仓位 50,000 → 100,000：按 92,000 定价约 −8506（按 K 线价 97,200 只有约 −5677）
    const doubled = resolveManualLegEconomics({ ...manual, size_usdt: 100_000 });
    expect(doubled.netPnl).toBeLessThan(-8_000);
    expect(doubled.netPnl).toBeGreaterThan(-9_000);
  });

  it('普通平仓照常按 K 线校正（这条规则只针对强平）', () => {
    const normal = { ...crossLiquidation, id: 'rec-normal', action: 'CLOSE', exit_method: 'sl' } as TradeRecord;
    const delta = buildTradeRecordPnlCorrection(normal, correction);
    // 毛盈亏 (97,200 − 100,000) × 0.5 = −1400，原 (92,000 − 100,000) × 0.5 = −4000
    expect(delta?.pnlDelta).toBeCloseTo(2600, 6);
  });
});
