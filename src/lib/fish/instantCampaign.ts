import { campaignStatusFromRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { TradeCampaign, TradeJournal, CampaignEvent } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import type { TradeSignal } from '@/lib/signalLibrary';
import { compileFishProgram, shortFishHash } from './algorithm';
import { fishCaughtBy } from './records';
import { qualitySignalTime } from './qualityAdmissionTime';
import { SCREENED_CDA_STEP, SCREENED_PRICE_EXIT_RULE, SCREENED_MIRROR, SCREENED_STOP_PCT, screenedSellReason, validScreenedSale, type ScreenedCdaTrigger } from './screenedCda';
import { mirrorPnlBreakdown } from './qualityMirror';
import { withQualityMirrorLegs } from './qualityMirrorLegs';
import { validateFishBars } from './shared';
import type { ResearchInterval } from '@/lib/deepRsa/marketData';
import type { FishReconstructionLoader } from './reconstruction';
import type { QualityCampaignData } from './qualityCampaignProjection';
import type { PreEntryRecord, PreEntryRound } from './preEntryMonitor';

const LEGACY_POSITION = { marginUsdt: 100, leverage: 5 } as const;
export const INSTANT_POSITION = { marginUsdt: 40, leverage: 5 } as const;
const MINUTE = 60_000;
const PRICE_WINDOW_MINUTES = 720;
const SELL_RULE = 'CDA 原始值首次 < -10';
const FIRST_SELL_RULE = 'CDA 原始值低于 −10 或 DBL-5 防守线断裂，也可手动卖出';
const PRICE_VERSION = 'screened-cda-campaign-v1';

export interface InstantPositionInput {
  id: string;
  recordId: string;
  source: Pick<TradeSignal, 'id' | 'symbol' | 'timeMs' | 'market' | 'exchange' | 'underlying' | 'binanceSymbol'>;
  buyAt: number;
  planLabel?: string;
  detectors: string[];
}

export type InstantCampaignInput = InstantPositionInput & { sell: ScreenedCdaTrigger; opened?: InstantPositionFill };
export type InstantPositionFill = InstantPositionInput & { entryPrice: number; marginUsdt: number; leverage: number };

interface InstantCampaignExecution extends InstantCampaignInput {
  entryPrice: number;
  exitPrice: number;
  peakPct: number;
  drawdown: number | null;
  staticDrawdown: number | null;
  recordedAt: number;
}

type SizedInstantCampaignSnapshot = InstantCampaignExecution & { version: 2; marginUsdt: number; leverage: number };
// v1 has implicit sizing; v2 freezes sizing alongside the fill prices.
export type InstantCampaignSnapshot = (InstantCampaignExecution & { version: 1 }) | SizedInstantCampaignSnapshot;

export function instantPositionInput(record: PreEntryRecord, round: PreEntryRound): InstantPositionInput | undefined {
  const buyAt = record.matchedAt;
  if (record.roundId !== round.id || record.status !== 'matched' || !round.automatic || round.state !== 'complete' || !Number.isSafeInteger(buyAt)
    || buyAt! <= 0) return;
  const { id, symbol, market, exchange, underlying, binanceSymbol } = record.sample.source;
  return {
    id: 'fish-instant-' + shortFishHash(record.id), recordId: record.id, buyAt: buyAt!,
    source: { id, symbol, market, exchange, underlying, binanceSymbol, timeMs: qualitySignalTime(record.sample.source) },
    planLabel: round.plans?.find(plan => plan.id === record.planId)?.label,
    detectors: record.sample.source.fish ? fishCaughtBy(record.sample.source) : [],
  };
}

export function instantCampaignInput(record: PreEntryRecord, round: PreEntryRound, sell: ScreenedCdaTrigger): InstantCampaignInput | undefined {
  const input = instantPositionInput(record, round);
  if (input && validScreenedSale(sell) && sell.at > input.buyAt) return { ...input, sell };
}

export const instantPricePlan = (interval: ResearchInterval) => compileFishProgram({
  id: 'instant-campaign-price', short: '价格', name: '价格', definition: '', formula: 'C', scale: 1, unit: '', positive: '1', control: '0', interval,
}, { statistic: '结果', direction: '>', threshold: 0, constraints: [] });

export async function freezeInstantPosition(input: InstantPositionInput, load: FishReconstructionLoader, signal: AbortSignal): Promise<InstantPositionFill> {
  const from = Math.floor(input.buyAt / MINUTE) * MINUTE, end = from + MINUTE;
  const source: TradeSignal = { ...input.source, timeMs: end, timeLabel: '', fallbackZone: '' };
  const bars = await load(source, from, end, instantPricePlan('1m'), signal);
  validateFishBars(bars, end, 1, MINUTE);
  const entryPrice = bars[0].open;
  if (!(entryPrice > 0 && Number.isFinite(entryPrice))) throw Error('即时交易缺少有效买入价');
  return { ...input, ...INSTANT_POSITION, entryPrice };
}

export async function readInstantMark(input: InstantPositionInput, now: number, load: FishReconstructionLoader, signal: AbortSignal) {
  const end = Math.floor(now / MINUTE) * MINUTE;
  if (end <= input.buyAt) throw Error('等待买入后首根 1 分钟 K 线收盘');
  const source: TradeSignal = { ...input.source, timeMs: end, timeLabel: '', fallbackZone: '' };
  const bars = await load(source, end - MINUTE, end, instantPricePlan('1m'), signal);
  validateFishBars(bars, end, 1, MINUTE);
  const price = bars[0].close;
  if (!(price > 0 && Number.isFinite(price))) throw Error('缺少有效行情');
  return { at: end, price };
}

/** Use the same venue as the screened signal. The sale is priced at the confirming close. */
export async function freezeInstantCampaign(input: InstantCampaignInput, load: FishReconstructionLoader, signal: AbortSignal): Promise<SizedInstantCampaignSnapshot> {
  const { buyAt, sell } = input;
  const from = Math.floor(buyAt / MINUTE) * MINUTE;
  const cut = sell.evidence?.stop?.barOpenAt ?? (sell.evidence?.reason === 'manual' ? sell.evidence.priceAt! : Math.floor(sell.at / MINUTE) * MINUTE);
  const source: TradeSignal = { ...input.source, timeMs: cut, timeLabel: '', fallbackZone: '' };
  const plan = instantPricePlan('1m');
  const read = async (start: number, end: number) => {
    const bars = await load(source, start, end, plan, signal);
    validateFishBars(bars, end, (end - start) / MINUTE, MINUTE);
    if (bars.some(bar => !(bar.high > 0 && bar.low > 0 && Number.isFinite(bar.high) && Number.isFinite(bar.low)))) throw Error('即时交易分钟行情价格无效');
    return bars;
  };
  const first = cut > from ? await read(from, Math.min(cut, from + PRICE_WINDOW_MINUTES * MINUTE)) : [];
  const entryPrice = input.opened?.entryPrice ?? first[0]?.open ??
    (await freezeInstantPosition(input, load, signal)).entryPrice;
  if (!(entryPrice > 0 && Number.isFinite(entryPrice))) throw Error('即时交易缺少有效买入价');
  let lowest = entryPrice, dynamic = 0, peakPrice = entryPrice;

  const capture = (bars: typeof first) => {
    for (const bar of bars) {
      lowest = Math.min(lowest, bar.low);
      // Only a previous candle's high can precede this candle's low.
      dynamic = Math.max(dynamic, 100 * (1 - bar.low / peakPrice));
      peakPrice = Math.max(peakPrice, bar.high);
    }
  };
  capture(first);
  const batchSize = PRICE_WINDOW_MINUTES * MINUTE;
  for (let next = from + batchSize; next < cut; next += batchSize) {
    capture(await read(next, Math.min(cut, next + batchSize)));
  }
  if (sell.evidence?.stop) peakPrice = Math.max(peakPrice, sell.evidence.stop.openPrice);
  let exitPrice = sell.closePrice;
  if (exitPrice == null) {
    const bars = await load(source, sell.at - SCREENED_CDA_STEP, sell.at, instantPricePlan('5m'), signal);
    validateFishBars(bars, sell.at, 1, SCREENED_CDA_STEP);
    exitPrice = bars[0].close;
  }
  if (!(exitPrice > 0 && Number.isFinite(exitPrice))) throw Error('即时交易缺少有效 CDA 卖出价');
  return {
    ...input, version: 2, marginUsdt: input.opened?.marginUsdt ?? INSTANT_POSITION.marginUsdt,
    leverage: input.opened?.leverage ?? INSTANT_POSITION.leverage, entryPrice, exitPrice,
    peakPct: 100 * (Math.max(peakPrice, exitPrice) / entryPrice - 1),
    drawdown: Math.max(dynamic, 100 * (1 - exitPrice / peakPrice)),
    staticDrawdown: 100 * (1 - Math.min(lowest, exitPrice) / entryPrice),
    recordedAt: Date.now(),
  };
}

export function buildInstantCampaignData(owner: string, frozen: InstantCampaignSnapshot): QualityCampaignData {
  const { id, buyAt, sell, source, entryPrice, exitPrice, recordedAt, detectors, planLabel } = frozen;
  const { symbol } = source;
  const { marginUsdt, leverage } = frozen.version === 1 ? LEGACY_POSITION : frozen;
  const notional = marginUsdt * leverage;
  const opened = new Date(buyAt).toISOString(), closed = new Date(sell.at).toISOString(), recorded = new Date(recordedAt).toISOString();
  const legId = id + '-main', recordId = id + '-close', quantity = notional / entryPrice;
  const mirror = sell.mirror, fraction = mirror?.fraction ?? 0;
  const remaining = 1 - fraction;
  const withPriceRules = sell.evidence?.version === SCREENED_PRICE_EXIT_RULE;
  const breakdown = mirrorPnlBreakdown(notional, entryPrice, exitPrice, mirror);
  const pnl = mirror ? breakdown.totalPnl : quantity * (exitPrice - entryPrice);
  const sellRule = withPriceRules ? FIRST_SELL_RULE + '，静态最大回撤 5% 止损，涨 2% 镜像平衡减仓 71.5%' : sell.evidence ? FIRST_SELL_RULE : SELL_RULE;
  const reason = sell.evidence ? screenedSellReason(sell) : `CDA 原始值 ${sell.value} < -10，5 分钟收盘确认`;
  const notes = [
    `筛选鱼 · 信号 ${new Date(source.timeMs).toISOString()}`,
    ...(planLabel ? [`筛选方案 ${planLabel}`] : []),
    `模拟多单 · 保证金 ${marginUsdt} USDT · ${leverage} 倍杠杆 · 名义仓位 ${notional} USDT`,
    sell.evidence ? '买入取首次满足时点所在分钟开盘，CDA 与防守线按 5 分钟收盘价卖出，静态回撤按止损价或跳空开盘价卖出，手动卖出取最近已收盘的 1 分钟价格。盈亏沿用持仓监测模拟成交口径，费用、滑点和强平未纳入。'
      : '买入取首次满足时点所在分钟开盘，卖出取 CDA 触发收盘。盈亏沿用持仓监测模拟成交口径，费用、滑点和强平未纳入。',
  ].join('\n');
  const opening: CampaignEvent = {
    id: id + '-entry', timestamp: opened, event_type: 'main_opened', leg_role: 'main_open',
    journal_id: legId, trade_record_id: recordId, pending_order_id: null, price: entryPrice, size_usdt: notional,
    notes: '首次满足时间', recorded_at: recorded, direction: 'long', leverage: leverage, leg_sequence: 1,
    order_kind: 'main', open_time: opened, entry_price: entryPrice,
  };
  const mirrorId = id + '-mirror-close';
  const positionRef = mirror ? id + '-position' : recordId;
  opening.trade_record_id = positionRef;
  const partial: CampaignEvent | undefined = mirror ? {
    ...opening, id: id + '-mirror', timestamp: new Date(mirror.at).toISOString(), event_type: 'main_partial_closed',
    price: mirror.price, size_usdt: notional * fraction, trade_record_id: mirrorId, realized_pnl: breakdown.mirrorPnl,
    close_time: new Date(mirror.at).toISOString(), exit_price: mirror.price, notes: '镜像平衡减仓',
  } : undefined;
  const exit: CampaignEvent = {
    ...opening, id: id + '-exit', timestamp: closed, event_type: 'main_fully_closed',
    price: exitPrice, size_usdt: notional * remaining, trade_record_id: recordId,
    realized_pnl: mirror ? breakdown.remainingPnl : pnl, close_time: closed, exit_price: exitPrice, notes: reason,
  };
  const campaign: TradeCampaign = {
    id, user_id: owner, campaign_code: 'IT-' + id.slice('fish-instant-'.length), symbol,
    direction: 'main_long', status: campaignStatusFromRealizedPnl({ settled: true, total: pnl }, closed),
    strategy_template: 'main_only', title: `${symbol} · ${planLabel ?? 'CDA 即时交易'}`,
    opened_at: opened, closed_at: closed, initial_main_size_usdt: notional, initial_leverage: leverage,
    final_realized_pnl: pnl, final_r_multiple: null, peak_unrealized_pnl: notional * frozen.peakPct / 100,
    peak_drawdown: frozen.drawdown, importance_weight: 0, notes, actual_evolution: partial ? [opening, partial, exit] : [opening, exit],
    deviation_notes: {}, deleted_at: null, created_at: recorded, updated_at: recorded,
    comparison: {
      section: 'instant', runKey: frozen.recordId, sellKey: sell.evidence?.version ?? PRICE_VERSION, planLabel: planLabel ?? 'CDA 即时交易',
      sellLabel: sellRule, detectors: detectors.map(label => ({ id: label, label })),
      category: detectors.join(' + ') || undefined, valuedAt: sell.at,
      holdingMetrics: { status: 'closed', entryPrice, initialNotional: notional, totalInvested: marginUsdt, returnPct: pnl / marginUsdt * 100, peakPct: frozen.peakPct,
        ...(mirror ? { mirrorRealizedPnl: breakdown.mirrorPnl, remainingPnl: breakdown.remainingPnl } : {}) },
      instant: { source, cdaValue: sell.value, sellEvidence: sell.evidence, marginUsdt, ...(withPriceRules ? { mirrorTakeProfit: SCREENED_MIRROR, mirrorFill: mirror } : {}), drawdown: frozen.drawdown, staticDrawdown: frozen.staticDrawdown },
    },
  };
  const leg: TradeJournal = {
    id: legId, user_id: owner, trade_record_id: positionRef, campaign_id: id, leg_role: 'main_open', leg_sequence: 1,
    source: 'retroactive_from_record', symbol, direction: 'long', leverage: leverage, position_mode: 'isolated', order_kind: 'main',
    pre_simulated_time: opened, pre_real_time: opened, pre_entry_price: entryPrice, pre_planned_stop_loss: withPriceRules ? entryPrice * (1 - SCREENED_STOP_PCT / 100) : null, pre_planned_take_profit: null,
    pre_entry_reason: notes, pre_falsification_signal: sellRule, pre_mental_state: 3, pre_mental_trigger: null,
    pre_risk_awareness: null, pre_risk_management: null, pre_checklist_items: null, pre_checklist_passed: null,
    pre_position_size: notional, pre_account_equity_usdt: marginUsdt, pre_max_loss_usdt: withPriceRules ? notional * SCREENED_STOP_PCT / 100 : null,
    pre_settlement_mode: 'usdt', pre_settlement_asset: 'USDT',
    post_outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven', post_realized_pnl: pnl, post_r_multiple: null,
    post_reflection: null, post_correct_action: null, post_reviewed_at: null, reason_was_rewritten: false,
    post_simulated_close_time: closed, post_real_close_time: closed, post_exit_price_snapshot: exitPrice,
    created_at: recorded, updated_at: recorded,
  };
  const trade: TradeRecord = {
    id: recordId, symbol, side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice, exitPrice,
    quantity: quantity * remaining, ...(mirror ? { positionId: positionRef } : {}), leverage, settlementMode: 'usdt', settlementAsset: 'USDT',
    pnl: mirror ? breakdown.remainingPnl : pnl, fee: 0, openFeeUsd: 0, openFeeRate: 0, closeFeeRate: 0, slippage: 0,
    openTime: buyAt, closeTime: sell.at, openedRealAt: buyAt, closedRealAt: sell.at, operationAt: recordedAt, exit_reason_text: reason,
  };
  const mirrorRecord: TradeRecord | undefined = mirror ? {
    ...trade, id: mirrorId, type: 'LIMIT', quantity: quantity * fraction, exitPrice: mirror.price,
    closeTime: mirror.at, closedRealAt: mirror.at, pnl: breakdown.mirrorPnl, exit_reason_text: '镜像止盈',
  } : undefined;
  return withQualityMirrorLegs({
    campaign, legs: [leg], tradeRecords: mirrorRecord ? [mirrorRecord, trade] : [trade], pendingOrders: [], reverseHedgeOrders: [], foreignLiveOrders: [], unfilledOrderIds: [],
    legExitPriceCorrections: {},
    timelineDiagnostics: { mode: 'exact', timelineIds: [], anchorTimelineIds: [], unstampedAnchors: 0, missingAnchorNodes: [], verdicts: {}, disagreements: [] },
  });
}
