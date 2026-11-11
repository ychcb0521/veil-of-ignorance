import type { FishCombinationRound, FishProgress, FishScanner, FishScanSettings } from '@/lib/fishScanner';
import type { TradeSignal } from '@/lib/signalLibrary';
import { AUDITED_EXCHANGES } from './exchanges';

export const FISH_HIT_RATE_HOURS = 5;
const halfWindowMs = FISH_HIT_RATE_HOURS * 3_600_000 / 2;
const marketKey = (signal: TradeSignal) => `${signal.exchange ?? 'binance'}|${signal.market ?? 'crypto'}|${signal.symbol}`;
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
export interface FishHitRateRow {
  sample: TradeSignal;
  status: 'hit' | 'miss' | 'unverified';
  hit?: TradeSignal;
  reason?: string;
}
export interface FishHitRateWindow {
  anchorMs: number;
  rows: FishHitRateRow[];
  hits: TradeSignal[];
  notice?: string;
}
export interface FishHitRateProgress { windowsDone: number; windowsTotal: number; marketDone: number; marketTotal: number; anchorMs: number }
export interface FishHitRateOptions {
  samples: readonly TradeSignal[];
  mode: FishHitRateMode;
  settings: FishScanSettings;
  signal: AbortSignal;
  onWindow: (window: FishHitRateWindow) => void;
  onProgress: (progress: FishHitRateProgress) => void;
}

/** One production-equivalent scan per distinct event time, without archiving test catches or summaries. */
export async function runFishHitRate(scanner: Pick<FishScanner, 'scan'>, options: FishHitRateOptions) {
  const { samples, mode, signal, onWindow, onProgress } = options;
  const settings = structuredClone(options.settings);
  const groups = new Map<number, Map<string, TradeSignal>>();
  for (const sample of samples) {
    const anchorMs = sample.timeMs + halfWindowMs;
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
    const exchanges = targeted
      ? [...new Set([...group.values()].map(sample => sample.exchange ?? 'binance'))].filter(exchange => AUDITED_EXCHANGES.includes(exchange))
      : settings.exchanges ?? ['binance'];
    const includeUsStocks = targeted ? [...group.values()].some(sample => sample.market === 'us_stock') : settings.includeUsStocks;
    if (!exchanges.length) error = '样本交易所暂不支持捕捞';
    else {
      let lastProgress = 0;
      try {
        scan = await scanner.scan({
          ...settings, anchorMs, lookbackHours: FISH_HIT_RATE_HOURS, exchanges, includeUsStocks,
          includeDuplicates: targeted || settings.includeDuplicates,
          targetMarkets: targeted ? new Set(group.keys()) : undefined,
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
      const reasons = [...new Set(outcomes.flatMap(outcome => misses[outcome] ? [misses[outcome]] : []))];
      // One confirmed rejection is enough for an intersection. A union needs every member ruled out.
      if (reasons.length && (settings.combination !== 'or' || outcomes.every(outcome => misses[outcome]))) {
        return { sample, status: 'miss', reason: reasons.join('、') };
      }
      const gaps = [...new Set(outcomes.flatMap(outcome => incomplete[outcome] ? [incomplete[outcome]] : []))];
      return { sample, status: 'unverified', reason: gaps.join('、') || '未取得完整判定' };
    });

    const venueIssues = Object.values(scan?.venues ?? {}).flatMap(venue => [venue.error ?? venue.skippedReason].filter(Boolean));
    const notice = [...new Set([error, scan?.notice, ...venueIssues].filter(Boolean))].join(' · ');
    windowsDone++;
    onWindow({ anchorMs, rows, hits: [...hits.values()].sort((a, b) => a.timeMs - b.timeMs), notice: notice || undefined });
    progress(scan?.done, scan?.total);
  }
}
