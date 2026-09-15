/**
 * TUTUSDT 2026-08-09 那一场的形状（数字按原事故等比复刻）：
 *
 *   主力开仓 +5528.52 · 镜像止盈 +5621.17 · 加仓1 −3304.78 · 滚动对冲 −1610.56 / −5764.39
 *   未校正合计 = +469.96 → 落库 closed_profit
 *
 * 镜像止盈那一刀的平仓价 0.0966898 落在平仓时刻 1 分钟 K 线区间 [0.0889838, 0.0912760] 之外，
 * 按收盘价 0.0904979 重算：Δ = (0.0904979 − 0.0966898) × 359600 = −2226.61，
 * 校正后合计 = −1756.65 → 亏损结束。
 *
 * 详情页页眉 / 导出 PNG / 结束对话框 / 列表卡片 / 落库自愈 的回归测试共用这一份，
 * 任何一处再读到未校正的落库状态，都会在这里同一个夹具上翻红。
 */
// 只引类型：这个夹具会被 vi.mock('@/lib/campaignLegExecution') 的工厂函数动态 import，
// 若在运行时依赖那个模块，会在它自己的 mock 工厂里递归解析它。
import type { LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import type { CanonicalTimePrice } from '@/lib/canonicalTimePrice';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

export const CORRECTED_LOSS_USER_ID = 'user-1';
export const CORRECTED_LOSS_CAMPAIGN_ID = 'tut-1';
export const CORRECTED_LOSS_OPENED_AT = '2026-01-01T00:00:00.000Z';
/** 全部腿里最晚的一刀平仓时刻 —— derive 会把它算成 closed_at，夹具必须与之一致。 */
export const CORRECTED_LOSS_CLOSED_AT = '2026-01-01T01:00:00.000Z';
export const MIRROR_CLOSE_MS = Date.parse('2026-01-01T00:30:00.000Z');
export const MIRROR_ORIGINAL_EXIT_PRICE = 0.0966898;
export const MIRROR_QUANTITY = 359_600;
export const MIRROR_CANDLE: CanonicalTimePrice = { low: 0.0889838, high: 0.091276, close: 0.0904979 };

export const UNCORRECTED_TOTAL = 5528.52 + 5621.17 - 3304.78 - 1610.56 - 5764.39; // +469.96
export const CORRECTED_TOTAL = UNCORRECTED_TOTAL
  + (MIRROR_CANDLE.close - MIRROR_ORIGINAL_EXIT_PRICE) * MIRROR_QUANTITY; // −1756.65
/** Σ 各腿计划最大亏损，最终 R 的分母。 */
export const PLANNED_MAX_LOSS_TOTAL = 4_000 + 1_500 + 2_000 + 1_500 + 1_000;

const ms = (iso: string) => Date.parse(iso);

function record(over: Partial<TradeRecord> & Pick<TradeRecord, 'id' | 'side' | 'entryPrice' | 'exitPrice' | 'quantity' | 'pnl' | 'openTime' | 'closeTime'>, symbol: string): TradeRecord {
  return {
    type: 'MARKET',
    action: 'CLOSE',
    leverage: 5,
    fee: 0,
    slippage: 0,
    ...over,
    symbol,
  } as TradeRecord;
}

export function correctedLossTradeRecords(symbol = 'TUTUSDT'): TradeRecord[] {
  return [
    record({
      id: 'r-main', positionId: 'pos-main', side: 'LONG',
      entryPrice: 0.085, exitPrice: 0.0916, quantity: 900_000, pnl: 5528.52,
      openTime: ms(CORRECTED_LOSS_OPENED_AT), closeTime: ms(CORRECTED_LOSS_CLOSED_AT),
    }, symbol),
    // 镜像止盈：平仓价被错记在 K 线区间之外，是这场的病灶。
    record({
      id: 'r-mirror', positionId: 'pos-mirror', side: 'LONG',
      entryPrice: 0.085, exitPrice: MIRROR_ORIGINAL_EXIT_PRICE, quantity: MIRROR_QUANTITY, pnl: 5621.17,
      openTime: ms(CORRECTED_LOSS_OPENED_AT), closeTime: MIRROR_CLOSE_MS,
    }, symbol),
    record({
      id: 'r-add', positionId: 'pos-add', side: 'LONG',
      entryPrice: 0.0905, exitPrice: 0.0868, quantity: 900_000, pnl: -3304.78,
      openTime: ms('2026-01-01T00:10:00.000Z'), closeTime: ms(CORRECTED_LOSS_CLOSED_AT),
    }, symbol),
    record({
      id: 'r-hedge-a', positionId: 'pos-hedge-a', side: 'SHORT',
      entryPrice: 0.088, exitPrice: 0.09, quantity: 800_000, pnl: -1610.56,
      openTime: ms('2026-01-01T00:20:00.000Z'), closeTime: ms('2026-01-01T00:50:00.000Z'),
    }, symbol),
    record({
      id: 'r-hedge-b', positionId: 'pos-hedge-b', side: 'SHORT',
      entryPrice: 0.087, exitPrice: 0.094, quantity: 820_000, pnl: -5764.39,
      openTime: ms('2026-01-01T00:25:00.000Z'), closeTime: ms('2026-01-01T00:55:00.000Z'),
    }, symbol),
  ];
}

function leg(over: Partial<TradeJournal> & Pick<TradeJournal, 'id' | 'leg_role' | 'direction' | 'order_kind' | 'pre_simulated_time'>, symbol: string): TradeJournal {
  return {
    user_id: CORRECTED_LOSS_USER_ID,
    campaign_id: CORRECTED_LOSS_CAMPAIGN_ID,
    trade_record_id: null,
    source: 'post_review',
    leverage: 5,
    pre_real_time: '2026-07-19T10:00:00.000Z',
    pre_account_equity_usdt: 50_000,
    pre_mental_state: 3,
    post_realized_pnl: null,
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-19T10:00:00.000Z',
    ...over,
    symbol,
  } as unknown as TradeJournal;
}

export function correctedLossLegs(symbol = 'TUTUSDT'): TradeJournal[] {
  return [
    leg({
      id: 'leg-main', leg_role: 'main_open', direction: 'long', order_kind: 'main', leg_sequence: 1,
      trade_record_id: 'r-main', pre_simulated_time: CORRECTED_LOSS_OPENED_AT,
      pre_entry_price: 0.085, pre_position_size: 76_500, pre_max_loss_usdt: 4_000,
    }, symbol),
    leg({
      id: 'leg-mirror', leg_role: 'mirror_tp', direction: 'long', order_kind: 'main', leg_sequence: 2,
      trade_record_id: 'r-mirror', pre_simulated_time: '2026-01-01T00:01:00.000Z',
      pre_entry_price: 0.085, pre_position_size: 30_566, pre_max_loss_usdt: 1_500,
    }, symbol),
    leg({
      id: 'leg-add', leg_role: 'main_add_1', direction: 'long', order_kind: 'main', leg_sequence: 3,
      trade_record_id: 'r-add', pre_simulated_time: '2026-01-01T00:10:00.000Z',
      pre_entry_price: 0.0905, pre_position_size: 81_450, pre_max_loss_usdt: 2_000,
    }, symbol),
    // 初始对冲的计划价在主力入场价下方 10%：预期最大亏损 > 0，盈亏比 b 才算得出来。
    leg({
      id: 'leg-hedge-a', leg_role: 'hedge_initial_a', direction: 'short', order_kind: 'hedge', leg_sequence: 4,
      trade_record_id: 'r-hedge-a', pre_simulated_time: '2026-01-01T00:20:00.000Z',
      pre_entry_price: 0.0765, pre_position_size: 61_200, pre_max_loss_usdt: 1_500,
    }, symbol),
    leg({
      id: 'leg-hedge-b', leg_role: 'hedge_initial_b', direction: 'short', order_kind: 'hedge', leg_sequence: 5,
      trade_record_id: 'r-hedge-b', pre_simulated_time: '2026-01-01T00:25:00.000Z',
      pre_entry_price: 0.0765, pre_position_size: 62_730, pre_max_loss_usdt: 1_000,
    }, symbol),
  ];
}

/** 落库的那一行：状态与金额都还是**未校正**的（closed_profit / +469.96）。 */
export function correctedLossStoredCampaign(over: Partial<TradeCampaign> = {}, symbol = 'TUTUSDT'): TradeCampaign {
  return {
    id: CORRECTED_LOSS_CAMPAIGN_ID,
    user_id: CORRECTED_LOSS_USER_ID,
    campaign_code: 'C-TUT',
    symbol,
    direction: 'main_long',
    status: 'closed_profit',
    strategy_template: 'main_dual_hedge_mirror_tp',
    title: `${symbol} 2026-01-01 战役`,
    opened_at: CORRECTED_LOSS_OPENED_AT,
    closed_at: CORRECTED_LOSS_CLOSED_AT,
    initial_main_size_usdt: 76_500,
    initial_leverage: 5,
    final_realized_pnl: UNCORRECTED_TOTAL,
    final_r_multiple: UNCORRECTED_TOTAL / PLANNED_MAX_LOSS_TOTAL,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    importance_weight: 0,
    notes: null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: null,
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-19T11:00:00.000Z',
    ...over,
  } as TradeCampaign;
}

/**
 * 真实拉取会给出的校正表：只有镜像那条腿被校正，形状与 buildLegExitPriceCorrection 一致
 * （campaignLegExecution 的测试守那个构造函数；这里守的是用它的各个界面）。
 */
export function correctedLossCorrections(): LegExitPriceCorrections {
  return {
    'leg-mirror': {
      exitPrice: MIRROR_CANDLE.close,
      originalExitPrice: MIRROR_ORIGINAL_EXIT_PRICE,
      candleLow: MIRROR_CANDLE.low,
      candleHigh: MIRROR_CANDLE.high,
    },
  };
}

/**
 * 进行中的变体：最后一条对冲还没平（没有成交记录、没有 closed_at）。
 * 未结算的战役不能用半场数据定性，页眉必须保留落库的 active。
 */
export function activeVariant(symbol = 'TUTUSDT'): { campaign: TradeCampaign; legs: TradeJournal[]; tradeRecords: TradeRecord[] } {
  const legs = correctedLossLegs(symbol).map(item => (
    item.id === 'leg-hedge-b' ? { ...item, trade_record_id: null } : item
  ));
  return {
    campaign: correctedLossStoredCampaign({
      id: 'tut-active',
      status: 'active',
      closed_at: null,
      final_realized_pnl: null,
      final_r_multiple: null,
    }, symbol),
    legs: legs.map(item => ({ ...item, campaign_id: 'tut-active' })),
    tradeRecords: correctedLossTradeRecords(symbol).filter(item => item.id !== 'r-hedge-b'),
  };
}
