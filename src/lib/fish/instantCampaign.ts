import { campaignStatusFromRealizedPnl } from '@/lib/campaignRealizedPnl';
import type { TradeCampaign, TradeJournal, CampaignEvent } from '@/types/journal';
import type { Position, TradeRecord } from '@/types/trading';
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
import { isAutomaticPreEntryRound, type PreEntryRecord, type PreEntryRound } from './preEntryMonitor';

import { instantCampaignMetadata, type InstantCampaignMetadata } from './instantCampaignMetadata';
import { INSTANT_TEMPLATE_MONITOR, type InstantMonitorSettings } from './instantMonitorSettings';
import { instantMonitorSize, INSTANT_POSITION } from './instantMonitorExecution';
import { qualityDrawdownPct, type QualityResult, type QualitySample } from './quality';
import { buildQualityCampaignData } from './qualityCampaignProjection';
import { additionPosition, qualityAdditionFills } from './qualityAddition';
import type { QualityMirrorFill } from './qualityMirror';
import { hasQualityCampaign } from './qualityCampaignArchive';
import { INSTANT_MANUAL_EXECUTION, type InstantManualExecution } from './instantManualExecution';
import { projectInstantManualFills, valueInstantManualFills } from './instantManualCampaign';

export { INSTANT_POSITION };
const LEGACY_POSITION = { marginUsdt: 100, leverage: 5 } as const;
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
  monitor?: InstantMonitorSettings;
  metadata?: InstantCampaignMetadata;
  detectors: string[];
}

export type InstantCampaignInput = InstantPositionInput & { sell: ScreenedCdaTrigger; opened?: InstantPositionFill; monitorResult?: QualityResult };
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
  if (record.roundId !== round.id || record.status !== 'matched' || !isAutomaticPreEntryRound(round) || round.state !== 'complete' || !Number.isSafeInteger(buyAt)
    || buyAt! <= 0) return;
  const { id, symbol, market, exchange, underlying, binanceSymbol } = record.sample.source;
  return {
    id: 'fish-instant-' + shortFishHash(record.id), recordId: record.id, buyAt: buyAt!,
    source: { id, symbol, market, exchange, underlying, binanceSymbol, timeMs: qualitySignalTime(record.sample.source) },
    planLabel: round.plans?.find(plan => plan.id === record.planId)?.label,
    ...(round.instantMonitor ? { monitor: round.instantMonitor } : {}),
    detectors: record.sample.source.fish ? fishCaughtBy(record.sample.source) : [],
    metadata: instantCampaignMetadata(record, round),
  };
}

export function instantCampaignInput(record: PreEntryRecord, round: PreEntryRound, sell: ScreenedCdaTrigger, monitorResult?: QualityResult): InstantCampaignInput | undefined {
  const input = instantPositionInput(record, round);
  if (!input || !validScreenedSale(sell)) return;
  if (input.monitor && validInstantMonitorClose({ ...input, sell, monitorResult })) {
    return { ...input, sell, monitorResult, metadata: instantCampaignMetadata(record, round) };
  }
  if (!input.monitor && sell.evidence?.version !== INSTANT_TEMPLATE_MONITOR && sell.at > input.buyAt) return { ...input, sell, metadata: instantCampaignMetadata(record, round) };
}

export function validInstantMonitorClose(input: InstantCampaignInput) {
  const result = input.monitorResult;
  if (input.sell.evidence?.version === INSTANT_MANUAL_EXECUTION) {
    return input.monitor?.version === INSTANT_TEMPLATE_MONITOR && validScreenedSale(input.sell)
      && input.sell.manual!.startedAt >= input.buyAt && input.sell.at > input.buyAt
      && (!result || result.status === 'open' && hasQualityCampaign(result)
        && result.entryTime === Math.floor(input.buyAt / MINUTE) * MINUTE
        && (result.endTime ?? result.entryTime) <= input.sell.manual!.fills[0].at);
  }
  return input.monitor?.version === INSTANT_TEMPLATE_MONITOR && !!input.monitor.plan?.frozenVersions?.length
    && Number.isSafeInteger(input.buyAt) && input.buyAt > 0
    && !!result && result.status === 'closed' && hasQualityCampaign(result)
    && result.entryTime === Math.floor(input.buyAt / MINUTE) * MINUTE
    && input.sell.evidence?.version === INSTANT_TEMPLATE_MONITOR
    && result.endTime === input.sell.at && result.endPrice === input.sell.closePrice;
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
  return { ...input, ...instantMonitorSize(input.monitor), entryPrice };
}

export async function readInstantMark(input: Pick<InstantPositionInput, 'source' | 'buyAt'>, now: number, load: FishReconstructionLoader, signal: AbortSignal) {
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
  if (sell.evidence?.version === INSTANT_MANUAL_EXECUTION && (!validScreenedSale(sell) || sell.manual!.startedAt < buyAt || sell.at <= buyAt
    || input.monitor && !validInstantMonitorClose(input))) throw Error('即时交易缺少手动成交快照');
  if (input.monitor && !sell.manual) {
    if (!validScreenedSale(input.sell) || !validInstantMonitorClose(input)) throw Error('即时交易缺少持仓监测成交快照');
    const result = input.monitorResult!;
    return { ...input, version: 2, ...instantMonitorSize(input.monitor), entryPrice: result.entryPrice!, exitPrice: result.endPrice!,
      peakPct: result.peakPct ?? 0, drawdown: qualityDrawdownPct(result, 'dynamic'),
      staticDrawdown: qualityDrawdownPct(result, 'static'), recordedAt: Date.now() };
  }
  const from = Math.floor(buyAt / MINUTE) * MINUTE;
  const manualPriceAt = sell.manual?.fills.at(-1)?.priceAt;
  const cut = manualPriceAt != null ? Math.floor(manualPriceAt / MINUTE) * MINUTE
    : sell.evidence?.stop?.barOpenAt ?? (sell.evidence?.reason === 'manual' ? sell.evidence.priceAt! : Math.floor(sell.at / MINUTE) * MINUTE);
  const source: TradeSignal = { ...input.source, timeMs: cut, timeLabel: '', fallbackZone: '' };
  const plan = instantPricePlan('1m');
  const read = async (start: number, end: number) => {
    const bars = await load(source, start, end, plan, signal);
    validateFishBars(bars, end, (end - start) / MINUTE, MINUTE);
    if (bars.some(bar => !(bar.high > 0 && bar.low > 0 && Number.isFinite(bar.high) && Number.isFinite(bar.low)))) throw Error('即时交易分钟行情价格无效');
    return bars;
  };
  const first = cut > from ? await read(from, Math.min(cut, from + PRICE_WINDOW_MINUTES * MINUTE)) : [];
  const entryPrice = input.monitorResult?.entryPrice ?? sell.manual?.entryPrice ?? input.opened?.entryPrice ?? first[0]?.open ??
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
  const sizing = input.opened ?? instantMonitorSize(input.monitor);
  // Keep the simulation's observed execution prices even when a quote, and
  // not the minute's close, was used for a manual fill.
  for (const fill of sell.manual?.fills ?? []) {
    lowest = Math.min(lowest, fill.price);
    peakPrice = Math.max(peakPrice, fill.price);
  }
  return {
    ...input, version: 2, marginUsdt: sizing.marginUsdt, leverage: sizing.leverage, entryPrice, exitPrice,
    peakPct: 100 * (Math.max(peakPrice, exitPrice) / entryPrice - 1),
    drawdown: Math.max(dynamic, 100 * (1 - exitPrice / peakPrice)),
    staticDrawdown: 100 * (1 - Math.min(lowest, exitPrice) / entryPrice),
    recordedAt: Date.now(),
  };
}

export function instantPositionValuation(position: InstantPositionFill, monitor?: QualityResult, legacyMirror?: QualityMirrorFill, mark?: number, manual?: InstantManualExecution) {
  const entryPrice = monitor?.entryPrice ?? position.entryPrice;
  const notional = position.marginUsdt * position.leverage;
  const mirror = monitor?.mirrorFill ?? legacyMirror;
  const additions = qualityAdditionFills(monitor ?? {});
  const reductions = monitor?.additionReductions ?? [];
  const entryAt = monitor?.entryTime ?? position.buyAt;
  const base = additionPosition(notional, entryPrice, mark ?? entryPrice, false, additions, mirror, reductions, entryAt);
  const held = valueInstantManualFills(base, mark ?? entryPrice, manual?.fills);
  const margin = held.remainingCost / position.leverage;
  const pnl = mark == null ? null : held.remainingPnl;
  const roe = pnl != null && margin > 0 ? pnl / margin * 100 : null;
  return { ...held, entryPrice, mirror, additions, reductions, margin, pnl, roe };
}

export function instantPositionDisplay(position: InstantPositionInput & { leverage: number }, held: Pick<ReturnType<typeof instantPositionValuation>, 'averageEntryPrice' | 'remainingQuantity' | 'margin'>): Position {
  return {
    id: position.id, side: 'LONG', entryPrice: held.averageEntryPrice, quantity: held.remainingQuantity,
    leverage: position.leverage, marginMode: 'isolated', settlementMode: 'usdt', settlementAsset: 'USDT',
    margin: held.margin, isolatedMargin: held.margin, openTime: position.buyAt,
  };
}

export function buildSettlingInstantCampaignData(owner: string, position: InstantPositionFill, sale: InstantCampaignInput): QualityCampaignData | undefined {
  const { sell, monitorResult } = sale;
  let data: QualityCampaignData;
  if (sell.manual && validScreenedSale(sell)) {
    data = buildOpenInstantCampaignData(owner, position, monitorResult, sell.mirror, sell.at, sell.manual);
    data.campaign.comparison!.instant!.sellEvidence = sell.evidence;
  } else if (position.monitor && monitorResult && validInstantMonitorClose(sale)) {
    data = buildTemplateInstantCampaignData(owner, position, monitorResult, { sell, recordedAt: monitorResult.evaluatedAt,
      drawdown: qualityDrawdownPct(monitorResult, 'dynamic'), staticDrawdown: qualityDrawdownPct(monitorResult, 'static') });
  } else if (!position.monitor && validScreenedSale(sell) && sell.closePrice != null && sell.at > position.buyAt) {
    data = buildDefaultInstantCampaignData(owner, position, { sell, exitPrice: sell.closePrice, mirror: sell.mirror,
      recordedAt: sell.at, valuedAt: sell.at, peakPct: null, drawdown: null, staticDrawdown: null });
  } else return;
  data.campaign.comparison!.instant!.settlementPending = true;
  return data;
}

export function buildOpenInstantCampaignData(owner: string, position: InstantPositionFill, monitor?: QualityResult, mirror?: QualityMirrorFill, through?: number, manual?: InstantManualExecution): QualityCampaignData {
  const { recordId, buyAt } = position;
  const valuation = instantPositionValuation(position, monitor, mirror);
  const valuedAt = Math.max(buyAt, monitor?.endTime ?? 0, through ?? 0, valuation.mirror?.at ?? 0, manual?.fills.at(-1)?.at ?? 0);
  const result: QualityResult = {
    key: recordId, sampleId: recordId, groupId: position.monitor?.plan.id ?? PRICE_VERSION, evaluatedAt: valuedAt,
    ...monitor,
    status: 'open', entryTime: monitor?.entryTime ?? (position.monitor ? Math.floor(buyAt / MINUTE) * MINUTE : buyAt),
    entryPrice: valuation.entryPrice, endTime: valuedAt, endPrice: monitor?.endPrice ?? valuation.entryPrice,
    mirrorFill: valuation.mirror, realizedPnl: valuation.realizedPnl, mirrorRealizedPnl: valuation.mirrorPnl,
    pnl: undefined, returnPct: undefined, remainingPnl: undefined,
  };
  const data = position.monitor
    ? buildTemplateInstantCampaignData(owner, position, result, { recordedAt: buyAt,
      drawdown: qualityDrawdownPct(monitor, 'dynamic'), staticDrawdown: qualityDrawdownPct(monitor, 'static') })
    : buildDefaultInstantCampaignData(owner, position, { recordedAt: buyAt, valuedAt, mirror: valuation.mirror,
      peakPct: null, drawdown: null, staticDrawdown: null });
  if (manual) return projectInstantManualFills(data, manual, valuation, valuedAt, buyAt);
  data.campaign.comparison!.instant!.openPosition = {
    buyAt, quantity: valuation.remainingQuantity, cost: valuation.remainingCost, realizedPnl: valuation.realizedPnl,
  };
  return data;
}

export function buildInstantCampaignData(owner: string, frozen: InstantCampaignSnapshot): QualityCampaignData {
  const sizing = frozen.version === 1 ? LEGACY_POSITION : frozen;
  const position = { ...frozen, marginUsdt: sizing.marginUsdt, leverage: sizing.leverage };
  if (frozen.sell.manual) {
    const data = buildOpenInstantCampaignData(owner, position, frozen.monitorResult, frozen.sell.mirror, frozen.sell.at, frozen.sell.manual);
    const comparison = data.campaign.comparison!;
    Object.assign(comparison.instant!, { sellEvidence: frozen.sell.evidence, drawdown: frozen.drawdown, staticDrawdown: frozen.staticDrawdown });
    comparison.holdingMetrics!.peakPct = frozen.peakPct;
    data.campaign.peak_drawdown = frozen.drawdown;
    return data;
  }
  if (frozen.monitor && frozen.monitorResult) return buildTemplateInstantCampaignData(owner, position, frozen.monitorResult, frozen);
  return buildDefaultInstantCampaignData(owner, position, { ...frozen, valuedAt: frozen.sell.at, mirror: frozen.sell.mirror });
}

function buildTemplateInstantCampaignData(owner: string, position: InstantPositionFill, result: QualityResult, evidence: {
  recordedAt: number; drawdown: number | null; staticDrawdown: number | null; sell?: ScreenedCdaTrigger;
}): QualityCampaignData {
  const { id, source, buyAt, marginUsdt, leverage, monitor, recordId, detectors, metadata } = position;
  const notional = marginUsdt * leverage;
  const sample: QualitySample = { id: recordId, source: { ...source, timeLabel: '', fallbackZone: '' },
    groups: [], enteredAt: buyAt, basis: 'signal', importedAt: buyAt };
  const data = buildQualityCampaignData(owner, { sample, plan: monitor!.plan, result,
    detectors: [], observeHours: 0, firstEvaluatedAt: evidence.recordedAt }, 'sell', id, { notional, marginUsdt, leverage });
  const comparison = data.campaign.comparison!;
  return { ...data, campaign: { ...data.campaign, campaign_code: 'IT-' + id.slice('fish-instant-'.length),
    title: source.symbol + ' · ' + monitor!.name,
    comparison: { ...comparison, section: 'instant', planLabel: monitor!.name,
      ...(comparison.holdingMetrics ? { holdingMetrics: { ...comparison.holdingMetrics, returnPct: result.status === 'closed' ? (result.pnl ?? 0) / marginUsdt * 100 : null } } : {}),
      detectors: detectors.map(label => ({ id: label, label })),
      instant: { source, marginUsdt, metadata, sellEvidence: evidence.sell?.evidence, mirrorFill: result.mirrorFill,
        drawdown: evidence.drawdown, staticDrawdown: evidence.staticDrawdown },
    } } };
}

function buildDefaultInstantCampaignData(owner: string, position: InstantPositionFill, frozen: {
  sell?: ScreenedCdaTrigger; exitPrice?: number; recordedAt: number; valuedAt: number; mirror?: QualityMirrorFill;
  peakPct: number | null; drawdown: number | null; staticDrawdown: number | null;
}): QualityCampaignData {
  const { id, recordId: runKey, buyAt, source, entryPrice, detectors, planLabel, marginUsdt, leverage } = position;
  const { sell, recordedAt, valuedAt, mirror } = frozen;
  const { symbol } = source;
  const notional = marginUsdt * leverage;
  const exitPrice = frozen.exitPrice ?? entryPrice;
  const opened = new Date(buyAt).toISOString(), closed = sell ? new Date(sell.at).toISOString() : null, recorded = new Date(recordedAt).toISOString();
  const legId = id + '-main', recordId = id + '-close', quantity = notional / entryPrice;
  const fraction = mirror?.fraction ?? 0;
  const remaining = 1 - fraction;
  const withPriceRules = !sell || sell.evidence?.version === SCREENED_PRICE_EXIT_RULE;
  const breakdown = mirrorPnlBreakdown(notional, entryPrice, exitPrice, mirror);
  const pnl = sell ? (mirror ? breakdown.totalPnl : quantity * (exitPrice - entryPrice)) : null;
  const sellRule = withPriceRules ? FIRST_SELL_RULE + '，静态最大回撤 5% 止损，涨 2% 镜像平衡减仓 71.5%' : sell?.evidence ? FIRST_SELL_RULE : SELL_RULE;
  const reason = !sell ? null : sell.evidence ? screenedSellReason(sell) : `CDA 原始值 ${sell.value} < -10，5 分钟收盘确认`;
  const notes = [
    `筛选鱼 · 信号 ${new Date(source.timeMs).toISOString()}`,
    ...(planLabel ? [`筛选方案 ${planLabel}`] : []),
    `模拟多单 · 保证金 ${marginUsdt} USDT · ${leverage} 倍杠杆 · 名义仓位 ${notional} USDT`,
    withPriceRules || sell?.evidence ? '买入取首次满足时点所在分钟开盘，CDA 与防守线按 5 分钟收盘价卖出，静态回撤按止损价或跳空开盘价卖出，手动卖出取最近已收盘的 1 分钟价格。盈亏沿用持仓监测模拟成交口径，费用、滑点和强平未纳入。'
      : '买入取首次满足时点所在分钟开盘，卖出取 CDA 触发收盘。盈亏沿用持仓监测模拟成交口径，费用、滑点和强平未纳入。',
  ].join('\n');
  const opening: CampaignEvent = {
    id: id + '-entry', timestamp: opened, event_type: 'main_opened', leg_role: 'main_open',
    journal_id: legId, trade_record_id: recordId, pending_order_id: null, price: entryPrice, size_usdt: notional,
    notes: '首次满足时间', recorded_at: recorded, direction: 'long', leverage: leverage, leg_sequence: 1,
    order_kind: 'main', open_time: opened, entry_price: entryPrice,
  };
  const mirrorId = id + '-mirror-close';
  const positionRef = mirror ? id + '-position' : sell ? recordId : null;
  opening.trade_record_id = positionRef;
  const partial: CampaignEvent | undefined = mirror ? {
    ...opening, id: id + '-mirror', timestamp: new Date(mirror.at).toISOString(), event_type: 'main_partial_closed',
    price: mirror.price, size_usdt: notional * fraction, trade_record_id: mirrorId, realized_pnl: breakdown.mirrorPnl,
    close_time: new Date(mirror.at).toISOString(), exit_price: mirror.price, notes: '镜像平衡减仓',
  } : undefined;
  const exit: CampaignEvent | undefined = closed ? {
    ...opening, id: id + '-exit', timestamp: closed, event_type: 'main_fully_closed',
    price: exitPrice, size_usdt: notional * remaining, trade_record_id: recordId,
    realized_pnl: mirror ? breakdown.remainingPnl : pnl ?? undefined, close_time: closed, exit_price: exitPrice, notes: reason,
  } : undefined;
  const campaign: TradeCampaign = {
    id, user_id: owner, campaign_code: 'IT-' + id.slice('fish-instant-'.length), symbol,
    direction: 'main_long', status: closed ? campaignStatusFromRealizedPnl({ settled: true, total: pnl }, closed) : 'active',
    strategy_template: 'main_only', title: `${symbol} · ${planLabel ?? 'CDA 即时交易'}`,
    opened_at: opened, closed_at: closed, initial_main_size_usdt: notional, initial_leverage: leverage,
    final_realized_pnl: pnl, final_r_multiple: null, peak_unrealized_pnl: frozen.peakPct == null ? null : notional * frozen.peakPct / 100,
    peak_drawdown: frozen.drawdown, importance_weight: 0, notes, actual_evolution: [opening, ...(partial ? [partial] : []), ...(exit ? [exit] : [])],
    deviation_notes: {}, deleted_at: null, created_at: recorded, updated_at: recorded,
    comparison: {
      section: 'instant', runKey, sellKey: sell?.evidence?.version ?? (sell ? PRICE_VERSION : SCREENED_PRICE_EXIT_RULE), planLabel: planLabel ?? 'CDA 即时交易',
      sellLabel: sellRule, detectors: detectors.map(label => ({ id: label, label })),
      category: detectors.join(' + ') || undefined, valuedAt,
      holdingMetrics: { status: sell ? 'closed' : 'open', entryPrice, initialNotional: notional, totalInvested: marginUsdt, returnPct: pnl == null ? null : pnl / marginUsdt * 100, peakPct: frozen.peakPct,
        ...(mirror ? { mirrorRealizedPnl: breakdown.mirrorPnl, remainingPnl: sell ? breakdown.remainingPnl : undefined } : {}) },
      instant: { source, metadata: position.metadata, cdaValue: sell?.value, sellEvidence: sell?.evidence, marginUsdt,
        ...(withPriceRules ? { initialStaticStopPct: SCREENED_STOP_PCT, mirrorTakeProfit: SCREENED_MIRROR, mirrorFill: mirror } : {}),
        drawdown: frozen.drawdown, staticDrawdown: frozen.staticDrawdown },
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
    post_outcome: pnl == null ? null : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven', post_realized_pnl: pnl, post_r_multiple: null,
    post_reflection: null, post_correct_action: null, post_reviewed_at: null, reason_was_rewritten: false,
    post_simulated_close_time: closed, post_real_close_time: closed, post_exit_price_snapshot: sell ? exitPrice : null,
    created_at: recorded, updated_at: recorded,
  };
  const trade: TradeRecord | undefined = sell && pnl != null ? {
    id: recordId, symbol, side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice, exitPrice,
    quantity: quantity * remaining, ...(mirror ? { positionId: positionRef } : {}), leverage, settlementMode: 'usdt', settlementAsset: 'USDT',
    pnl: mirror ? breakdown.remainingPnl : pnl, fee: 0, openFeeUsd: 0, openFeeRate: 0, closeFeeRate: 0, slippage: 0,
    openTime: buyAt, closeTime: sell.at, openedRealAt: buyAt, closedRealAt: sell.at, operationAt: recordedAt, exit_reason_text: reason ?? undefined,
  } : undefined;
  const mirrorRecord: TradeRecord | undefined = mirror ? {
    id: mirrorId, symbol, side: 'LONG', type: 'LIMIT', action: 'CLOSE', entryPrice, positionId: positionRef ?? undefined,
    leverage, settlementMode: 'usdt', settlementAsset: 'USDT', fee: 0, openFeeUsd: 0, openFeeRate: 0, closeFeeRate: 0, slippage: 0,
    openTime: buyAt, openedRealAt: buyAt, operationAt: recordedAt, quantity: quantity * fraction, exitPrice: mirror.price,
    closeTime: mirror.at, closedRealAt: mirror.at, pnl: breakdown.mirrorPnl, exit_reason_text: '镜像止盈',
  } : undefined;
  return withQualityMirrorLegs({
    campaign, legs: [leg], tradeRecords: [...(mirrorRecord ? [mirrorRecord] : []), ...(trade ? [trade] : [])], pendingOrders: [], reverseHedgeOrders: [], foreignLiveOrders: [], unfilledOrderIds: [],
    legExitPriceCorrections: {},
    timelineDiagnostics: { mode: 'exact', timelineIds: [], anchorTimelineIds: [], unstampedAnchors: 0, missingAnchorNodes: [], verdicts: {}, disagreements: [] },
  });
}
