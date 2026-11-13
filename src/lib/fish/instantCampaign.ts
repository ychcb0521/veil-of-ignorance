import { campaignStatusFromRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { TradeCampaign, TradeJournal, CampaignEvent } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import type { TradeSignal } from '@/lib/signalLibrary';
import { compileFishProgram, shortFishHash } from './algorithm';
import { fishCaughtBy } from './records';
import { qualitySignalTime } from './qualityAdmissionTime';
import { SCREENED_CDA_LIMIT, SCREENED_CDA_STEP, type ScreenedCdaTrigger } from './screenedCda';
import { validateFishBars } from './shared';
import type { ResearchInterval } from '@/lib/deepRsa/marketData';
import type { FishReconstructionLoader } from './reconstruction';
import type { QualityCampaignData } from './qualityCampaignProjection';
import type { PreEntryRecord, PreEntryRound } from './preEntryMonitor';

export const INSTANT_MARGIN = 100;
export const INSTANT_LEVERAGE = 5;
export const INSTANT_NOTIONAL = INSTANT_MARGIN * INSTANT_LEVERAGE;
const MINUTE = 60_000;
const PRICE_WINDOW_MINUTES = 720;
const SELL_RULE = 'CDA 原始值首次 < -10';
const PRICE_VERSION = 'screened-cda-campaign-v1';

export interface InstantCampaignInput {
  id: string;
  recordId: string;
  source: Pick<TradeSignal, 'id' | 'symbol' | 'timeMs' | 'market' | 'exchange' | 'underlying' | 'binanceSymbol'>;
  buyAt: number;
  sell: ScreenedCdaTrigger;
  planLabel?: string;
  detectors: string[];
}

export interface InstantCampaignSnapshot extends InstantCampaignInput {
  version: 1;
  entryPrice: number;
  exitPrice: number;
  peakPct: number;
  drawdown: number | null;
  staticDrawdown: number | null;
  recordedAt: number;
}

export function instantCampaignInput(record: PreEntryRecord, round: PreEntryRound, sell: ScreenedCdaTrigger): InstantCampaignInput | undefined {
  const buyAt = record.matchedAt;
  if (record.roundId !== round.id || record.status !== 'matched' || !round.automatic || round.state !== 'complete' || !Number.isSafeInteger(buyAt)
    || buyAt! <= 0 || !Number.isSafeInteger(sell.at) || sell.at % SCREENED_CDA_STEP !== 0 || sell.at <= buyAt!
    || !Number.isFinite(sell.value) || sell.value >= SCREENED_CDA_LIMIT) return;
  const { id, symbol, market, exchange, underlying, binanceSymbol } = record.sample.source;
  return {
    id: 'fish-instant-' + shortFishHash(record.id), recordId: record.id, buyAt: buyAt!, sell,
    source: { id, symbol, market, exchange, underlying, binanceSymbol, timeMs: qualitySignalTime(record.sample.source) },
    planLabel: round.plans?.find(plan => plan.id === record.planId)?.label,
    detectors: record.sample.source.fish ? fishCaughtBy(record.sample.source) : [],
  };
}

export const instantPricePlan = (interval: ResearchInterval) => compileFishProgram({
  id: 'instant-campaign-price', short: '价格', name: '价格', definition: '', formula: 'C', scale: 1, unit: '', positive: '1', control: '0', interval,
}, { statistic: '结果', direction: '>', threshold: 0, constraints: [] });

/** Use the same venue as the screened signal. The sale is priced at the confirming close. */
export async function freezeInstantCampaign(input: InstantCampaignInput, load: FishReconstructionLoader, signal: AbortSignal): Promise<InstantCampaignSnapshot> {
  const { buyAt, sell } = input;
  const from = Math.floor(buyAt / MINUTE) * MINUTE;
  const source: TradeSignal = { ...input.source, timeMs: sell.at, timeLabel: '', fallbackZone: '' };
  const plan = instantPricePlan('1m');
  const read = async (start: number, end: number) => {
    const bars = await load(source, start, end, plan, signal);
    validateFishBars(bars, end, (end - start) / MINUTE, MINUTE);
    if (bars.some(bar => !(bar.high > 0 && bar.low > 0 && Number.isFinite(bar.high) && Number.isFinite(bar.low)))) throw Error('即时交易分钟行情价格无效');
    return bars;
  };
  const first = await read(from, Math.min(sell.at, from + PRICE_WINDOW_MINUTES * MINUTE));
  const entryPrice = first[0].open;
  if (!(entryPrice > 0 && Number.isFinite(entryPrice))) throw Error('即时交易缺少有效买入价');
  let lowest = entryPrice, dynamic = 0, peakPrice = entryPrice;
  let last = first.at(-1)!;
  const capture = (bars: typeof first) => {
    for (const bar of bars) {
      lowest = Math.min(lowest, bar.low);
      // Only a previous candle's high can precede this candle's low.
      dynamic = Math.max(dynamic, 100 * (1 - bar.low / peakPrice));
      peakPrice = Math.max(peakPrice, bar.high);
    }
  };
  capture(first);
  for (let next = last.openTime + MINUTE; next < sell.at; next = last.openTime + MINUTE) {
    const batch = await read(next, Math.min(sell.at, next + PRICE_WINDOW_MINUTES * MINUTE));
    capture(batch);
    last = batch.at(-1)!;
  }
  let exitPrice = sell.closePrice;
  if (exitPrice == null) {
    const bars = await load(source, sell.at - SCREENED_CDA_STEP, sell.at, instantPricePlan('5m'), signal);
    validateFishBars(bars, sell.at, 1, SCREENED_CDA_STEP);
    exitPrice = bars[0].close;
  }
  if (!(exitPrice > 0 && Number.isFinite(exitPrice))) throw Error('即时交易缺少有效 CDA 卖出价');
  return {
    ...input, version: 1, entryPrice, exitPrice,
    peakPct: 100 * (Math.max(peakPrice, exitPrice) / entryPrice - 1),
    drawdown: Math.max(dynamic, 100 * (1 - exitPrice / peakPrice)),
    staticDrawdown: 100 * (1 - Math.min(lowest, exitPrice) / entryPrice),
    recordedAt: Date.now(),
  };
}

export function buildInstantCampaignData(owner: string, frozen: InstantCampaignSnapshot): QualityCampaignData {
  const { id, buyAt, sell, source, entryPrice, exitPrice, recordedAt, detectors, planLabel } = frozen;
  const { symbol } = source;
  const opened = new Date(buyAt).toISOString(), closed = new Date(sell.at).toISOString(), recorded = new Date(recordedAt).toISOString();
  const legId = id + '-main', recordId = id + '-close', quantity = INSTANT_NOTIONAL / entryPrice;
  const pnl = quantity * (exitPrice - entryPrice);
  const reason = `CDA 原始值 ${sell.value} < -10，5 分钟收盘确认`;
  const notes = [
    `筛选鱼 · 信号 ${new Date(source.timeMs).toISOString()}`,
    ...(planLabel ? [`筛选方案 ${planLabel}`] : []),
    '模拟多单 · 保证金 100 USDT · 5 倍杠杆 · 名义仓位 500 USDT',
    '买入取首次满足时点所在分钟开盘，卖出取 CDA 触发收盘。盈亏沿用持仓监测模拟成交口径，费用、滑点和强平未纳入。',
  ].join('\n');
  const opening: CampaignEvent = {
    id: id + '-entry', timestamp: opened, event_type: 'main_opened', leg_role: 'main_open',
    journal_id: legId, trade_record_id: recordId, pending_order_id: null, price: entryPrice, size_usdt: INSTANT_NOTIONAL,
    notes: '首次满足时间', recorded_at: recorded, direction: 'long', leverage: INSTANT_LEVERAGE, leg_sequence: 1,
    order_kind: 'main', open_time: opened, entry_price: entryPrice,
  };
  const exit: CampaignEvent = {
    ...opening, id: id + '-exit', timestamp: closed, event_type: 'main_fully_closed',
    price: exitPrice, realized_pnl: pnl, close_time: closed, exit_price: exitPrice, notes: reason,
  };
  const campaign: TradeCampaign = {
    id, user_id: owner, campaign_code: 'IT-' + id.slice('fish-instant-'.length), symbol,
    direction: 'main_long', status: campaignStatusFromRealizedPnl({ settled: true, total: pnl }, closed),
    strategy_template: 'main_only', title: `${symbol} · ${planLabel ?? 'CDA 即时交易'}`,
    opened_at: opened, closed_at: closed, initial_main_size_usdt: INSTANT_NOTIONAL, initial_leverage: INSTANT_LEVERAGE,
    final_realized_pnl: pnl, final_r_multiple: null, peak_unrealized_pnl: INSTANT_NOTIONAL * frozen.peakPct / 100,
    peak_drawdown: frozen.drawdown, importance_weight: 0, notes, actual_evolution: [opening, exit],
    deviation_notes: {}, deleted_at: null, created_at: recorded, updated_at: recorded,
    comparison: {
      section: 'instant', runKey: frozen.recordId, sellKey: PRICE_VERSION, planLabel: planLabel ?? 'CDA 即时交易',
      sellLabel: SELL_RULE, detectors: detectors.map(label => ({ id: label, label })),
      category: detectors.join(' + ') || undefined, valuedAt: sell.at,
      holdingMetrics: { status: 'closed', entryPrice, initialNotional: INSTANT_NOTIONAL, totalInvested: INSTANT_MARGIN, returnPct: pnl / INSTANT_MARGIN * 100, peakPct: frozen.peakPct },
      instant: { source, cdaValue: sell.value, marginUsdt: INSTANT_MARGIN, drawdown: frozen.drawdown, staticDrawdown: frozen.staticDrawdown },
    },
  };
  const leg: TradeJournal = {
    id: legId, user_id: owner, trade_record_id: recordId, campaign_id: id, leg_role: 'main_open', leg_sequence: 1,
    source: 'retroactive_from_record', symbol, direction: 'long', leverage: INSTANT_LEVERAGE, position_mode: 'isolated', order_kind: 'main',
    pre_simulated_time: opened, pre_real_time: opened, pre_entry_price: entryPrice, pre_planned_stop_loss: null, pre_planned_take_profit: null,
    pre_entry_reason: notes, pre_falsification_signal: SELL_RULE, pre_mental_state: 3, pre_mental_trigger: null,
    pre_risk_awareness: null, pre_risk_management: null, pre_checklist_items: null, pre_checklist_passed: null,
    pre_position_size: INSTANT_NOTIONAL, pre_account_equity_usdt: INSTANT_MARGIN, pre_max_loss_usdt: null,
    pre_settlement_mode: 'usdt', pre_settlement_asset: 'USDT',
    post_outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven', post_realized_pnl: pnl, post_r_multiple: null,
    post_reflection: null, post_correct_action: null, post_reviewed_at: null, reason_was_rewritten: false,
    post_simulated_close_time: closed, post_real_close_time: closed, post_exit_price_snapshot: exitPrice,
    created_at: recorded, updated_at: recorded,
  };
  const trade: TradeRecord = {
    id: recordId, symbol, side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice, exitPrice,
    quantity, leverage: INSTANT_LEVERAGE, settlementMode: 'usdt', settlementAsset: 'USDT',
    pnl, fee: 0, openFeeUsd: 0, openFeeRate: 0, closeFeeRate: 0, slippage: 0,
    openTime: buyAt, closeTime: sell.at, openedRealAt: buyAt, closedRealAt: sell.at, operationAt: recordedAt, exit_reason_text: reason,
  };
  return {
    campaign, legs: [leg], tradeRecords: [trade], pendingOrders: [], reverseHedgeOrders: [], foreignLiveOrders: [], unfilledOrderIds: [],
    legExitPriceCorrections: {},
    timelineDiagnostics: { mode: 'exact', timelineIds: [], anchorTimelineIds: [], unstampedAnchors: 0, missingAnchorNodes: [], verdicts: {}, disagreements: [] },
  };
}
