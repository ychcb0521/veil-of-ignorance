import { compileFishProgram } from './algorithm';
import { validateFishBars } from './shared';
import { screeningTimeSlice } from './screeningYield';
import { formatUTC8 } from '../timeFormat';
import type { ResearchBar } from '../deepRsa/window';
import type { TradeSignal } from '../signalLibrary';
import type { FishReconstructionLoader } from './reconstruction';
import type { EntryProcessReading } from './preEntryExclusionProcess';

export const ENTRY_STALL_TURN_VERSION = 'entry-stall-turn-v1' as const;
export interface EntryStallTurn {
  version: typeof ENTRY_STALL_TURN_VERSION;
  enabled: boolean;
  historyHours: number;
  riseMinutes: number;
  risePct: number;
  stallMinutes: number;
  maxProgressPct: number;
  turnMinutes: number;
  pullback?: {enabled: boolean; pct: number};
}
/** Research starting values, never attached to an existing plan automatically. */
export const defaultEntryStallTurn = (): EntryStallTurn => ({
  version: ENTRY_STALL_TURN_VERSION, enabled: true, historyHours: 6,
  riseMinutes: 60, risePct: 1, stallMinutes: 10, maxProgressPct: 20, turnMinutes: 3,
  pullback: {enabled: true, pct: 3},
});
export function validateEntryStallTurn(c: EntryStallTurn) {
  const integer = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (c.version !== ENTRY_STALL_TURN_VERSION || typeof c.enabled !== 'boolean') throw Error('上涨后滞涨转弱版本不可用，请保留原方案');
  if (!Number.isFinite(c.historyHours) || c.historyHours < 1 / 12 || c.historyHours > 72
    || !integer(c.riseMinutes, 5, 1440) || !integer(c.stallMinutes, 2, 240) || !integer(c.turnMinutes, 2, 30)
    || c.turnMinutes > c.stallMinutes || !Number.isFinite(c.risePct) || c.risePct <= 0 || c.risePct >= 100
    || !Number.isFinite(c.maxProgressPct) || c.maxProgressPct < 0 || c.maxProgressPct >= 100
    || (c.pullback != null && (typeof c.pullback.enabled !== 'boolean' || !Number.isFinite(c.pullback.pct) || c.pullback.pct <= 0 || c.pullback.pct >= 100))) {
    throw Error('滞涨转弱参数无效：历史 5 分钟～72 小时；上涨 5～1440 分钟、涨幅大于 0；滞涨 2～240 分钟；转弱 2～30 分钟且不长于滞涨；推进速度比例 0～小于100%；猛烈回调门槛大于0且小于100%');
  }
}
export interface StallTurnMetrics {
  risePct: number; progressPct: number; meanChangePct: number; support: number; close: number;
  hit: boolean; recoveryPrice: number; recovering: boolean;
}
/** Three NON-overlapping, chronological segments, all completed 1m candles.
 * Rise = first segment's open-to-close gain. Stall = signed gain per minute
 * relative to the rise segment. Turn = lower mean close AND a close below
 * the preceding turnMinutes lows. No future pivot or eventual drawdown. */
export function entryStallTurnMetrics(bars: readonly ResearchBar[], c: EntryStallTurn): StallTurnMetrics | undefined {
  const total = c.riseMinutes + c.stallMinutes + c.turnMinutes;
  if (bars.length < total) return;
  const start = bars.length - total, riseEnd = start + c.riseMinutes, turnStart = riseEnd + c.stallMinutes;
  const last = bars.at(-1)!;
  const risePct = (bars[riseEnd - 1].close / bars[start].open - 1) * 100;
  const stallPct = (bars[turnStart - 1].close / bars[riseEnd].open - 1) * 100;
  const progressPct = risePct > 0 ? (stallPct / c.stallMinutes) / (risePct / c.riseMinutes) * 100 : 0;
  let previousMean = 0, currentMean = 0, support = Infinity, recoveryPrice = -Infinity, recovering = true;
  for (let i = 0; i < c.turnMinutes; i++) {
    const prior = bars[turnStart - c.turnMinutes + i], current = bars[turnStart + i];
    previousMean += prior.close; currentMean += current.close;
    support = Math.min(support, prior.low); recoveryPrice = Math.max(recoveryPrice, prior.close);
    if (current.close <= bars[turnStart + i - 1].close) recovering = false;
  }
  const meanChangePct = (currentMean / previousMean - 1) * 100;
  return { risePct, progressPct, meanChangePct, support, close: last.close, recoveryPrice, recovering,
    hit: risePct >= c.risePct && progressPct <= c.maxProgressPct && meanChangePct < 0 && last.close < support };
}
const M = 60000;
const number = (n: number) => +n.toFixed(5);
const price = (n: number) => +n.toPrecision(10);
export function createEntryStallTurnReader(o: {condition: EntryStallTurn; row: TradeSignal; load: FishReconstructionLoader; signal: AbortSignal; availableStart?: number}) {
  validateEntryStallTurn(o.condition);
  const c = o.condition, size = c.riseMinutes + c.stallMinutes + c.turnMinutes;
  const plan = compileFishProgram({id: ENTRY_STALL_TURN_VERSION, name: '上涨后滞涨转弱', short: '转弱', definition: '', formula: 'C', interval: '1m', scale: 1, unit: '', positive: '1', control: '0'}, {statistic: '结果', direction: '>', threshold: 0, constraints: []});
  const bars: ResearchBar[] = [], slice = screeningTimeSlice(o.signal);
  let cursor: number | undefined, lastAt = -Infinity, metrics: StallTurnMetrics | undefined;
  let lock: {at: number; metrics: StallTurnMetrics} | undefined;
  let pullbackLock: {at: number; peak: number; pct: number} | undefined;
  let historyFrom = Infinity, peakHead = 0, currentPullback = 0;
  const peaks: {at: number; high: number}[] = [];
  const consume = (bar: ResearchBar) => {
    if (![bar.open, bar.high, bar.low, bar.close].every(p => Number.isFinite(p) && p > 0)
      || bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) throw Error('滞涨转弱行情价格无效');
    if (c.pullback?.enabled && bar.openTime >= historyFrom) {
      const from = Math.ceil((bar.openTime + M - c.historyHours * 3600000) / M) * M;
      while (peakHead < peaks.length && peaks[peakHead].at < from) peakHead++;
      while (peaks.length > peakHead && peaks.at(-1)!.high <= bar.high) peaks.pop();
      peaks.push({at: bar.openTime, high: bar.high});
      // A monotonic queue keeps this linear, with bounded memory across long runs.
      if (peakHead > 1024) {peaks.splice(0, peakHead); peakHead = 0;}
      const peak = peaks[peakHead].high;
      currentPullback = (peak - bar.close) / peak * 100;
      if (pullbackLock) {
        // A wick, equal close, rebound, retry or window expiry cannot clear this lock.
        if (bar.close > pullbackLock.peak) pullbackLock = undefined;
      } else if (currentPullback >= c.pullback.pct) {
        pullbackLock = {at: bar.openTime + M, peak, pct: currentPullback};
      }
    }
    bars.push(bar); if (bars.length > size) bars.shift();
    metrics = entryStallTurnMetrics(bars, c);
    if (!metrics) return;
    if (lock) {
      if (metrics.recovering && bar.close >= lock.metrics.recoveryPrice) lock = undefined;
    } else if (metrics.hit) lock = {at: bar.openTime + M, metrics};
  };
  return async (at: number, minute: ResearchBar): Promise<{pending?: string; blocked?: string; readings?: EntryProcessReading[]}> => {
    if (o.signal.aborted) throw new DOMException('已暂停', 'AbortError');
    if (at < lastAt || at % M !== 0 || minute.openTime + M !== at) throw Error('滞涨转弱须按已收盘分钟顺序判断');
    lastAt = at;
    const riskFrom = Math.ceil((at - c.historyHours * 3600000) / M) * M;
    const seed = riskFrom - size * M;
    const available = o.availableStart ?? o.load.turingInitialization?.startMs;
    if (cursor == null) {
      if (available != null && seed < available) return {pending: '上涨后滞涨转弱：历史不足完整回看及三段观察时长，等待后再判断'};
      historyFrom = riskFrom;
      cursor = seed;
    }
    while (cursor < at) {
      if (o.signal.aborted) throw new DOMException('已暂停', 'AbortError');
      if (cursor === minute.openTime) {validateFishBars([minute], at, 1, M); consume(minute); cursor = at; break;}
      const cut = Math.min(minute.openTime, cursor + 500 * M);
      const chunk = await o.load(o.row, cursor, cut, plan, o.signal);
      validateFishBars(chunk, cut, (cut - cursor) / M, M);
      for (const bar of chunk) {const pause = slice(); if (pause) await pause; consume(bar);}
      cursor = cut;
    }
    if (o.signal.aborted) throw new DOMException('已暂停', 'AbortError');
    if (!metrics) return {pending: '上涨后滞涨转弱：等待完整的上涨、滞涨和转弱三段行情'};
    const label = '上涨后滞涨转弱', prefix = ENTRY_STALL_TURN_VERSION;
    const readings: EntryProcessReading[] = [
      {id: prefix, label: label + '／回调未创新高锁定', at, value: lock || pullbackLock ? 1 : 0, threshold: 1, direction: '>=', met: !!(lock || pullbackLock), role: 'veto'},
      {id: prefix + ':rise', label: '前段涨幅（%）', at, value: metrics.risePct, threshold: c.risePct, direction: '>=', met: metrics.risePct >= c.risePct, role: 'veto'},
      {id: prefix + ':stall', label: '近期推进速度／前段速度（%）', at, value: metrics.progressPct, threshold: c.maxProgressPct, direction: '<=', met: metrics.progressPct <= c.maxProgressPct, role: 'veto'},
      {id: prefix + ':turn', label: '短线平均收盘变化（%）', at, value: metrics.meanChangePct, threshold: 0, direction: '<', met: metrics.meanChangePct < 0, role: 'veto'},
      {id: prefix + ':support', label: '当前收盘／转弱前局部低点', at, value: metrics.close, threshold: metrics.support, direction: '<', met: metrics.close < metrics.support, role: 'veto'},
    ];
    if (c.pullback?.enabled) {
      readings.push({id: prefix + ':pullback', label: '历史前高至当前收盘回调（%）', at, value: currentPullback, threshold: c.pullback.pct, direction: '>=', met: currentPullback >= c.pullback.pct, role: 'veto'});
      if (pullbackLock) readings.push({id: prefix + ':peak-lock', label: '回调锁定前高（收盘未突破）', at, value: metrics.close, threshold: pullbackLock.peak, direction: '<=', met: true, role: 'veto'});
    }
    const reasons: string[] = [];
    if (pullbackLock) reasons.push(`猛烈回调未创新高：${formatUTC8(pullbackLock.at)} 自前高 ${price(pullbackLock.peak)} 回调 ${number(pullbackLock.pct)}%；等待已收盘价格严格突破该前高（影线、反弹及重筛均不解除）`);
    if (lock) reasons.push(`${label}：${formatUTC8(lock.at)} 前段涨 ${number(lock.metrics.risePct)}%，推进速度降至 ${number(lock.metrics.progressPct)}%，短线重心下移并跌破 ${price(lock.metrics.support)}；等待连续 ${c.turnMinutes} 分钟收盘递升且收复 ${price(lock.metrics.recoveryPrice)}（重筛不清除）`);
    return {readings, ...(reasons.length ? {blocked: reasons.join('；')} : {})};
  };
}
