import type { TradeSignal } from '@/lib/signalLibrary';
import { freezeInstantPosition, instantPricePlan } from './instantCampaign';
import type { FishSnapshot } from './algorithm';
import type { FishReconstructionLoader } from './reconstruction';
import { readScreenedCda, SCREENED_CDA_STEP, SCREENED_PRICE_EXIT_RULE, SCREENED_STOP_PCT, SCREENED_MIRROR,
  type ScreenedCdaRead, type ScreenedCdaTask, type ScreenedCdaTrigger, type ScreenedPriceProgress } from './screenedCda';
import { qualityIntrabarStop, type QualityHoldingVeto } from './qualityVeto';
import { validateFishBars } from './shared';

const MINUTE = 60_000;
const risk: readonly QualityHoldingVeto[] = [{ id: 'instant-static-stop', label: '静态最大回撤', kind: 'static-drawdown', direction: '>=', threshold: SCREENED_STOP_PCT, enabled: true }];

async function readPriceExit(source: TradeSignal, buyAt: number, entry: number, end: number,
  prior: ScreenedPriceProgress | undefined, load: FishReconstructionLoader, signal: AbortSignal) {
  const from = prior?.through ?? Math.floor(buyAt / MINUTE) * MINUTE;
  if (end <= from) return { risk: prior ?? { through: from } };
  const plan = instantPricePlan('1m');
  let mirror = prior?.mirror;
  const target = entry * (1 + SCREENED_MIRROR.gainPct / 100);
  const level = entry * (1 - SCREENED_STOP_PCT / 100);
  const path = { entry, peak: entry, minimum: entry, dynamic: 0 };
  for (let cursor = from; cursor < end; cursor += 120 * MINUTE) {
    const through = Math.min(end, cursor + 120 * MINUTE);
    const bars = await load({ ...source, timeMs: through }, cursor, through, plan, signal);
    validateFishBars(bars, through, (through - cursor) / MINUTE, MINUTE);
    for (const bar of bars) {
      // A partial entry minute may contain a move that happened before the signal.
      if (bar.openTime < buyAt) continue;
      if (![bar.open, bar.high, bar.low].every(price => Number.isFinite(price) && price > 0)) throw Error('即时交易缺少有效分钟行情');
      const stopAtOpen = bar.open <= level * (1 + 1e-12);
      const mirrorAtOpen = bar.open >= target;
      const mirrorAt = Math.max(bar.openTime, buyAt + 1);
      if (!mirror && mirrorAtOpen && !stopAtOpen) {
        mirror = { at: mirrorAt, price: bar.open, fraction: SCREENED_MIRROR.sellPct / 100, gainPct: SCREENED_MIRROR.gainPct, atOpen: true };
      }
      const stop = qualityIntrabarStop(path, bar, risk);
      if (stopAtOpen || stop) {
        const at = Math.max(bar.openTime, buyAt + 1);
        const trigger: ScreenedCdaTrigger = { at, closePrice: stopAtOpen ? bar.open : stop!.price, mirror,
          evidence: { version: SCREENED_PRICE_EXIT_RULE, reason: 'static-stop',
            stop: { barOpenAt: bar.openTime, atOpen: stopAtOpen, level, openPrice: bar.open, threshold: SCREENED_STOP_PCT } },
        };
        return { risk: { through: bar.openTime + MINUTE, mirror }, trigger };
      }
      if (!mirror && bar.high >= target * (1 - 1e-12)) {
        mirror = { at: mirrorAt, price: target, fraction: SCREENED_MIRROR.sellPct / 100, gainPct: SCREENED_MIRROR.gainPct, atOpen: false };
      }
    }
  }
  return { risk: { through: end, mirror } };
}

/** Run price exits on each closed minute, in chronological order with the 5m confirmations. */
export async function readScreenedPositionExit(task: ScreenedCdaTask, end: number, snapshot: FishSnapshot,
  load: FishReconstructionLoader, signal: AbortSignal): Promise<ScreenedCdaRead> {
  const buyAt = task.observeAfter;
  if (buyAt == null) return readScreenedCda(task.source, task.after, end, snapshot, load, signal);
  const minuteEnd = Math.floor(end / MINUTE) * MINUTE;
  let indicator: ScreenedCdaRead;
  let pendingError: string | undefined;
  try { indicator = await readScreenedCda(task.source, task.after, minuteEnd, snapshot, load, signal, task); }
  catch (error) {
    if (signal.aborted) throw error;
    indicator = { through: task.after, progress: task.progress };
    pendingError = error instanceof Error ? error.message : '等待 5 分钟卖出行情';
  }
  // Any minute after the next unresolved 5m close might follow an earlier full exit.
  const priceEnd = indicator.trigger?.at ?? Math.min(minuteEnd, indicator.through + SCREENED_CDA_STEP);
  const previous = task.risk ?? (task.progress && task.after > buyAt ? { through: task.after } : undefined);
  let price: Awaited<ReturnType<typeof readPriceExit>>;
  try {
    const entry = task.entryPrice ?? previous?.entryPrice ?? (await freezeInstantPosition({
      id: task.id, recordId: task.id, source: task.source, buyAt, detectors: [],
    }, load, signal)).entryPrice;
    price = await readPriceExit(task.source, buyAt, entry, priceEnd, previous, load, signal);
    price.risk = { ...price.risk, entryPrice: entry };
  } catch (error) {
    if (signal.aborted) throw error;
    return { through: task.after, progress: task.progress, risk: previous,
      pendingError: error instanceof Error ? error.message : '等待分钟卖出行情' };
  }
  const trigger = price.trigger ?? (indicator.trigger ? { ...indicator.trigger, mirror: price.risk.mirror,
    evidence: { ...indicator.trigger.evidence!, version: SCREENED_PRICE_EXIT_RULE } } : undefined);
  return { ...indicator, trigger, risk: price.risk, pendingError: trigger ? undefined : pendingError };
}
