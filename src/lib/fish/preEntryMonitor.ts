/** Independent first-match scan. Values use the existing closed-candle buy-filter calculation. */
import type { TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import { evaluateFishProgram } from './algorithm';
import { qualityMetricPlan, type QualityBuyFilter, type QualityFilterReading, type QualitySample, type QualityProgress, type QualityGroup } from './quality';
import type { FishReconstructionLoader } from './reconstruction';
import { fishDelay, validateFishBars } from './shared';

export type PreEntryStatus = 'queued' | 'scanning' | 'paused' | 'matched' | 'unmatched' | 'warming' | 'error';
export interface PreEntryRecord {
  planId?: string;
  id: string; roundId: string; sample: QualitySample; status: PreEntryStatus;
  startTime: number; cursor: number; endTime?: number; matchedAt?: number;
  readings: QualityFilterReading[]; detail?: string; updatedAt: number;
}
export const PRE_ENTRY_INTRABAR_VERSION = 'pre-entry-intrabar-v2' as const;
export interface PreEntrySettings { updatedAt: number; plans: QualityGroup[]; hours: number }
export interface PreEntryRound {
  engine?: typeof PRE_ENTRY_INTRABAR_VERSION; plans?: QualityGroup[];
  id: string; startedAt: number; updatedAt: number; filters: QualityBuyFilter[];
  hours: number; state: 'running' | 'paused' | 'complete';
}
export interface PreEntryLibrary { settings?: PreEntrySettings; version: 1; rounds: PreEntryRound[]; records: PreEntryRecord[] }
export const emptyPreEntryLibrary = (): PreEntryLibrary => ({ version: 1, rounds: [], records: [] });
export function mergePreEntryLibraries(a: PreEntryLibrary, b: PreEntryLibrary): PreEntryLibrary {
  const merge = <T extends { id: string; updatedAt: number }>(left: T[], right: T[]) => {
    const all = new Map(left.map(item => [item.id, item]));
    for (const item of right) if (!all.has(item.id) || item.updatedAt >= all.get(item.id)!.updatedAt) all.set(item.id, item);
    return [...all.values()];
  };
  const settings = !a.settings || (b.settings?.updatedAt ?? 0) >= a.settings.updatedAt ? b.settings : a.settings;
  return { version: 1, rounds: merge(a.rounds, b.rounds), records: merge(a.records, b.records), ...(settings ? {settings} : {}) };
}
export function preEntrySignal(record: PreEntryRecord): TradeSignal | null {
  if (record.status !== 'matched' || !record.matchedAt) return null;
  const source = record.sample.source;
  return { id: `pre-entry:${record.id}`, symbol: source.symbol, exchange: source.exchange, market: source.market,
    underlying: source.underlying, binanceSymbol: source.binanceSymbol,
    timeMs: record.matchedAt, timeLabel: formatUTC8(record.matchedAt), fallbackZone: source.fallbackZone,
    preEntryMonitor: { recordId: record.id, roundId: record.roundId, sourceId: source.id, sourceTime: source.timeMs } };
}
export interface PreEntryRun {
  round: PreEntryRound; records: readonly PreEntryRecord[];
  onRecord: (record: PreEntryRecord) => void;
}
const MINUTE = 60_000;
const check = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException('已取消', 'AbortError'); };

export async function collectPreEntryMonitor(
  task: PreEntryRun, load: FishReconstructionLoader, now: number, signal: AbortSignal,
  onProgress: (progress: QualityProgress) => void,
  bounds?: { start?: (symbol: string) => Promise<number | undefined>; end?: (symbol: string) => Promise<number> },
): Promise<void> {
  if (task.round.engine === PRE_ENTRY_INTRABAR_VERSION) {
    const { collectPreEntryIntrabar } = await import('./preEntryIntrabar');
    return collectPreEntryIntrabar(task, load, now, signal, onProgress, bounds);
  }
  const filters = task.round.filters.filter(f => f.enabled);
  if (!filters.length) throw new Error('请先设置并启用买前过滤条件');
  if (!Number.isFinite(task.round.hours) || task.round.hours < 0 || task.round.hours > 8784) throw new Error('监测时长须为 0～8784 小时，0 表示扫描至当前可用行情末尾');
  const plans = filters.map(filter => ({ filter, ...qualityMetricPlan(filter.snapshot, filter.metric) }));
  let done = 0;
  for (const original of task.records) {
    check(signal);
    if (['matched', 'unmatched', 'warming'].includes(original.status)) { done++; continue; }
    let record = { ...original, status: 'scanning' as PreEntryStatus, detail: undefined as string | undefined };
    const publish = (patch: Partial<PreEntryRecord>) => {
      record = { ...record, ...patch, updatedAt: Date.now() };
      task.onRecord(record);
    };
    try {
      const source = record.sample.source;
      const availableStart = await bounds?.start?.(source.symbol);
      const availableEnd = await bounds?.end?.(source.symbol) ?? now;
      check(signal);
      const end = record.endTime ?? Math.floor(Math.min(now, availableEnd,
        task.round.hours ? record.startTime + task.round.hours * 3_600_000 : Infinity) / MINUTE) * MINUTE;
      if (!(record.startTime > 0) || !Number.isFinite(record.startTime)) throw new Error('缺少有效监测起点');
      // Initial offline warmup is expected. Internal gaps and missing dependencies remain errors.
      const readyAt = availableStart == null ? record.startTime : Math.max(record.startTime,
        ...plans.map(({ plan }) => Math.ceil(availableStart / plan.step) * plan.step + (plan.warm + 1) * plan.step));
      let cursor = Math.max(Math.ceil(record.cursor / MINUTE) * MINUTE, Math.ceil(readyAt / MINUTE) * MINUTE);
      publish({ endTime: end, cursor, detail: readyAt > record.startTime ? `等待指标预热，最早可判断时间：${formatUTC8(readyAt)}` : undefined });
      if (cursor > end) {
        publish({ status: readyAt > end ? 'warming' : 'unmatched', detail: readyAt > end
          ? `现有行情不足以完成预热；最早可判断时间：${formatUTC8(readyAt)}。可缩短指标历史窗口或使用更长的原始行情。`
          : '本次范围内没有可判断的已收盘 K 线' });
      } else {
        const caches = plans.map(() => ({ cut: NaN, reading: undefined as QualityFilterReading | undefined,
          from: 0, to: 0, bars: [] as Awaited<ReturnType<FishReconstructionLoader>> }));
        let yields = 0;
        for (; cursor <= end; cursor += MINUTE) {
          check(signal);
          const readings: QualityFilterReading[] = [];
          for (let i = 0; i < plans.length; i++) {
            const { filter, plan, scale } = plans[i], cache = caches[i];
            const cut = Math.floor(cursor / plan.step) * plan.step;
            if (cache.cut !== cut) {
              const from = cut - (plan.warm + 1) * plan.step;
              if (from < 0) throw new Error('公式预热所需历史不足');
              if (!cache.bars.length || from < cache.from || cut > cache.to) {
                const to = Math.min(Math.floor(end / plan.step) * plan.step, cut + 63 * plan.step);
                let fetchedTo = to;
                let bars: Awaited<ReturnType<FishReconstructionLoader>>;
                const read = async (until: number) => {
                  const result = await load({ ...source, timeMs: now }, from, until, plan, signal);
                  validateFishBars(result, until, (until - from) / plan.step, plan.step);
                  return result;
                };
                try { bars = await read(to); }
                catch (error) {
                  check(signal);
                  if (to === cut) throw error;
                  // A later gap must not hide a valid match before it. Retry only the current window.
                  fetchedTo = cut;
                  bars = await read(cut);
                }
                check(signal);
                Object.assign(cache, { from, to: fetchedTo, bars });
              }
              const window = cache.bars.slice((from - cache.from) / plan.step, (cut - cache.from) / plan.step);
              // Exact parity with static buy filtering: identical warm+1 window and unmodified formula.
              const value = evaluateFishProgram(window, plan).average.at(-1)! * scale;
              if (!Number.isFinite(value)) throw new Error(`${filter.label} 在 ${formatUTC8(cut)} 的读数缺失，已停止，未跳过缺口`);
              cache.cut = cut; cache.reading = { key: filter.id, value, at: cut };
            }
            readings.push(cache.reading!);
          }
          if (readings.every((reading, i) => filters[i].direction === '>' ? reading.value! > filters[i].threshold : reading.value! < filters[i].threshold)) {
            publish({ status: 'matched', matchedAt: cursor, cursor, readings, detail: '全部启用条件首次同时满足；此时间之前的 K 线已收盘，可作为持仓监测入场节点' });
            break;
          }
          // Persist the next unevaluated minute; resume never skips a candidate.
          record = { ...record, cursor: cursor + MINUTE, readings };
          if (++yields % 8 === 0) {
            publish({ detail: `正在判断 ${formatUTC8(cursor)}` });
            onProgress({ done, total: task.records.length, current: `${source.symbol} · ${formatUTC8(cursor)}` });
            await fishDelay(0, signal);
          }
        }
        if (record.status !== 'matched') publish({ status: 'unmatched', cursor, detail: '本次行情范围内，启用条件未同时满足' });
      }
    } catch (error) {
      if (signal.aborted) { publish({ status: 'paused', detail: '已暂停，继续时使用本轮冻结条件' }); throw error; }
      publish({ status: 'error', detail: error instanceof Error ? error.message : '行情读取失败' });
    }
    done++;
    onProgress({ done, total: task.records.length, current: record.sample.source.symbol });
    await fishDelay(0, signal);
  }
}
