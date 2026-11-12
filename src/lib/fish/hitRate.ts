import type { FishCombinationRound, FishProgress, FishScanner, FishScanSettings } from '@/lib/fishScanner';
import type { TradeSignal } from '@/lib/signalLibrary';
import { AUDITED_EXCHANGES } from './exchanges';
import type { FishWickRejection } from './downwardWick';
import type { FishTurnoverDetail } from './turnoverRejections';
import { formatUTC8 } from '@/lib/timeFormat';
import type { PreEntryRecord } from './preEntryMonitor';
import type { LibraryDirectoryEdits } from './libraryDirectoryEdits';
import { fishSourceLabel } from './records';
import { qualitySignalTime } from './qualityAdmissionTime';

export interface FishHitRateTimeWindow { beforeHours: number; afterHours: number }
export const DEFAULT_FISH_HIT_RATE_WINDOW: Readonly<FishHitRateTimeWindow> = { beforeHours: 2.5, afterHours: 2.5 };

export function validateFishHitRateWindow({ beforeHours, afterHours }: FishHitRateTimeWindow): number {
  const duration = beforeHours + afterHours;
  if (!Number.isFinite(duration) || beforeHours < 0 || afterHours < 0 || duration <= 0 || duration > 8784) {
    throw new Error('样本前后时长均须为非负数字，合计须大于 0 且不超过 8784 小时');
  }
  return duration;
}
const marketKey = (signal: Pick<TradeSignal, 'symbol' | 'exchange' | 'market'>) => `${signal.exchange ?? 'binance'}|${signal.market ?? 'crypto'}|${signal.symbol}`;
export function monitorHitRateSample(source: TradeSignal): TradeSignal | undefined {
  const { symbol, exchange, market, underlying, binanceSymbol, fallbackZone, quality } = source;
  const timeMs = qualitySignalTime(source);
  if (!Number.isFinite(timeMs) || timeMs <= 0) return;
  return {
    id: `monitor-sample:${marketKey(source)}|${timeMs}`, symbol, exchange, market,
    underlying, binanceSymbol, timeMs, timeLabel: formatUTC8(timeMs), fallbackZone, quality,
  };
}

export function screeningHitRateSamples(records: readonly PreEntryRecord[], selectedIds: readonly string[], edits?: LibraryDirectoryEdits): TradeSignal[] {
  if (!selectedIds.length) return [];
  const selected = new Set(selectedIds);
  const samples = new Map<string, TradeSignal>();
  for (const record of records) {
    if (!selected.has(record.id) || record.status !== 'matched' || edits?.[record.roundId]?.hidden) continue;
    const { symbol, exchange, market, underlying, binanceSymbol, timeMs, fallbackZone, quality } = record.sample.source;
    if (!Number.isFinite(timeMs) || timeMs <= 0) continue;
    const identity = `${marketKey({ symbol, exchange, market })}|${timeMs}`;
    if (!samples.has(identity)) samples.set(identity, {
      id: `screening-sample:${record.id}`, symbol, exchange, market, underlying, binanceSymbol,
      timeMs, timeLabel: formatUTC8(timeMs), fallbackZone, quality,
    });
  }
  return [...samples.values()].sort((a, b) => b.timeMs - a.timeMs);
}

const misses: Record<string, string> = {
  below: '截止时未达到算法门槛',
  blocked: '被算法附加条件挡下',
  outside: '信号起点超出测试窗口',
  wick: '被插针过滤排除',
  thin: '成交额未达门槛',
};
const incomplete: Record<string, string> = {
  missing: '算法或市场未覆盖',
  history: '交易所历史不足',
  gap: 'K 线缺段',
  readings: '指标读数不全',
  failed: '行情请求失败',
  unknown: '信号起点无法确认',
};

export type FishHitRateMode = 'targets' | 'market';
export interface FishHitRateThresholdDetail {
  algorithm: string;
  statistic: string;
  threshold: number;
  direction: '>' | '<';
  unit: string;
  cutoffMs: number;
  cutoffReading: number;
  maximum?: { value: number; timeMs: number };
}
export type FishHitRateOutsideDetail = Omit<FishHitRateThresholdDetail, 'maximum'> & { startMs: number };

export interface FishHitRateRow {
  sample: TradeSignal;
  status: 'hit' | 'miss' | 'unverified';
  hit?: TradeSignal;
  reason?: string;
  rejections?: { kind: string; label: string }[];
  wick?: FishWickRejection;
  thresholds?: FishHitRateThresholdDetail[];
  outside?: FishHitRateOutsideDetail[];
  turnover?: FishTurnoverDetail[];
}
export interface FishHitRateWindow {
  startMs: number;
  anchorMs: number;
  rows: FishHitRateRow[];
  hits: TradeSignal[];
  notice?: string;
}
export type FishMarketHitGroup = 'outside' | 'other-window' | 'sample';
export interface FishMarketHit {
  signal: TradeSignal;
  anchorMs: number;
  marketKey: string;
  group: FishMarketHitGroup;
}

export function fishMarketHits(windows: readonly FishHitRateWindow[], samples: readonly TradeSignal[]): FishMarketHit[] {
  const sampleKeys = new Set(samples.map(marketKey));
  return windows.flatMap(window => {
    const windowKeys = new Set(window.rows.map(row => marketKey(row.sample)));
    return window.hits.map(signal => {
      const key = marketKey(signal);
      const group = windowKeys.has(key) ? 'sample' : sampleKeys.has(key) ? 'other-window' : 'outside';
      return { signal, anchorMs: window.anchorMs, marketKey: key, group };
    });
  });
}

export function countFishMarketHits(rows: readonly FishMarketHit[]) {
  return {
    markets: new Set(rows.map(row => row.marketKey)).size,
    signals: new Set(rows.map(row => `${row.marketKey}|${row.signal.timeMs}`)).size,
  };
}

export interface FishHitRateProgress { windowsDone: number; windowsTotal: number; marketDone: number; marketTotal: number; anchorMs: number }
export interface FishHitRateOptions {
  samples: readonly TradeSignal[];
  mode: FishHitRateMode;
  settings: FishScanSettings;
  window?: FishHitRateTimeWindow;
  signal: AbortSignal;
  onWindow: (window: FishHitRateWindow) => void;
  onProgress: (progress: FishHitRateProgress) => void;
  onWaiting?: (reason: string | null) => void;
}

/** One production-equivalent scan per distinct event time, without archiving test catches or summaries. */
export async function runFishHitRate(scanner: Pick<FishScanner, 'scan'>, options: FishHitRateOptions) {
  const { samples, mode, signal, onWindow, onProgress } = options;
  const settings = structuredClone(options.settings);
  const window = options.window ?? DEFAULT_FISH_HIT_RATE_WINDOW;
  const lookbackHours = validateFishHitRateWindow(window);
  const afterMs = window.afterHours * 3_600_000;
  const groups = new Map<number, Map<string, TradeSignal>>();
  for (const sample of samples) {
    const anchorMs = sample.timeMs + afterMs;
    const group = groups.get(anchorMs) ?? new Map<string, TradeSignal>();
    group.set(marketKey(sample), sample);
    groups.set(anchorMs, group);
  }
  let windowsDone = 0;
  for (const [anchorMs, group] of groups) {
    if (signal.aborted) return;
    const progress = (marketDone = 0, marketTotal = 0) => onProgress({ windowsDone, windowsTotal: groups.size, marketDone, marketTotal, anchorMs });
    progress();

    const hits = new Map<string, TradeSignal>();
    let round: FishCombinationRound | undefined;
    let scan: FishProgress | undefined;
    let error: string | undefined;
    const targeted = mode === 'targets';
    const sampleMarkets = new Set(group.keys());
    const exchanges = targeted
      ? [...new Set([...group.values()].map(sample => sample.exchange ?? 'binance'))].filter(exchange => AUDITED_EXCHANGES.includes(exchange))
      : settings.exchanges ?? ['binance'];
    const includeUsStocks = targeted ? [...group.values()].some(sample => sample.market === 'us_stock') : settings.includeUsStocks;
    if (!exchanges.length) error = '样本交易所暂不支持捕捞';
    else {
      let lastProgress = 0;
      try {
        scan = await scanner.scan({
          ...settings, anchorMs, lookbackHours, exchanges, includeUsStocks,
          includeDuplicates: targeted || settings.includeDuplicates,
          targetMarkets: targeted ? sampleMarkets : undefined,
          windowPeakMarkets: sampleMarkets,
          retainMembers: true, saveSummary: false, signal,
          onSignal: hit => { hits.set(marketKey(hit), hit); },
          onRound: value => { round = value; },
          onProgress: value => {
            const now = Date.now();
            if (now - lastProgress < 150 && value.status === 'running') return;
            lastProgress = now;
            progress(value.done, value.total);
          },
        });
        if (scan.status !== 'complete') error = scan.error ?? '本窗口扫描未完成';
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }
    if (signal.aborted) return;

    const rows = [...group].map(([key, sample]): FishHitRateRow => {
      const hit = hits.get(key);
      if (hit) return { sample, status: 'hit', hit };
      const venue = scan?.venues?.[sample.exchange ?? 'binance'];
      const members = round?.results.get(key);
      if (error || !members || !round) {
        return { sample, status: 'unverified', reason: error ?? venue?.error ?? venue?.skippedReason ?? '当前市场范围或可交易标的未覆盖该样本' };
      }
      const outcomes = round.plans.map((_, index) => members.get(index)?.outcome ?? 'missing');
      const rejections = [...new Set(outcomes)].flatMap(kind => misses[kind] ? [{ kind, label: misses[kind] }] : []);
      // One confirmed rejection is enough for an intersection. A union needs every member ruled out.
      if (rejections.length && (settings.combination !== 'or' || outcomes.every(outcome => misses[outcome]))) {
        const wick = [...members.values()].find(member => member.outcome === 'wick' && member.wick)?.wick;
        const thresholds: FishHitRateThresholdDetail[] = [];
        const outside: FishHitRateOutsideDetail[] = [];
        round.plans.forEach((plan, index) => {
          const member = members.get(index);
          if (member?.reading === undefined || (member.outcome !== 'below' && member.outcome !== 'outside')) return;
          const statistic = plan.settings.statistic ?? '结果';
          const comparison = {
            algorithm: fishSourceLabel({ featureId: plan.def.id, featureShort: plan.def.short, statistic }),
            statistic, threshold: plan.settings.threshold, direction: plan.settings.direction, unit: plan.unit,
            cutoffReading: member.reading * plan.scale,
          };
          if (member.outcome === 'below' && member.windowPeak) {
            const { maximum, cutoffMs } = member.windowPeak;
            thresholds.push({ ...comparison, cutoffMs, maximum: maximum && { ...maximum, value: maximum.value * plan.scale } });
          }
          if (member.outcome === 'outside' && member.outsideStartMs !== undefined && member.snapshot) {
            outside.push({ ...comparison, cutoffMs: member.snapshot.cutoffMs, startMs: member.outsideStartMs });
          }
        });
        const turnover = rejections.some(({ kind }) => kind === 'thin')
          ? scan?.turnoverDetails?.filter(detail => marketKey(detail) === key)
          : undefined;
        return { sample, status: 'miss', rejections, wick, thresholds, outside, turnover };
      }
      const gaps = [...new Set(outcomes.flatMap(outcome => incomplete[outcome] ? [incomplete[outcome]] : []))];
      return { sample, status: 'unverified', reason: gaps.join('、') || '未取得完整判定' };
    });

    const venueIssues = Object.values(scan?.venues ?? {}).flatMap(venue => [venue.error ?? venue.skippedReason].filter(Boolean));
    const notice = [...new Set([error, scan?.notice, ...venueIssues].filter(Boolean))].join(' · ');
    windowsDone++;
    onWindow({ startMs: anchorMs - lookbackHours * 3_600_000, anchorMs, rows, hits: [...hits.values()].sort((a, b) => a.timeMs - b.timeMs), notice: notice || undefined });
    progress(scan?.done, scan?.total);
  }
}
