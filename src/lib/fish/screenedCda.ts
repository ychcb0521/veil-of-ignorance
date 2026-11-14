import { CDA_DEF, DBL5_DEF, evaluateOnBars, featureWindowMs } from '@/lib/deepDig/features';
import { accountFeatureDef } from '@/lib/featureSource';
import type { TradeSignal } from '@/lib/signalLibrary';
import { DBL5_RETEST_GUARD_VERSION, dbl5Parameters, type Dbl5Checkpoint } from '@/lib/dbl5m';
import { compileFishProgram, type FishSnapshot } from './algorithm';
import { qualityHistoryFrom } from './qualityInitialization';
import { qualityMetricPlan } from './quality';
import { makeQualityBuyFilter } from './qualityFilters';
import type { QualityMirrorFill } from './qualityMirror';
import type { FishReconstructionLoader } from './reconstruction';
import { validateFishBars } from './shared';

import { INSTANT_TEMPLATE_MONITOR } from './instantMonitorSettings';
import { INSTANT_MANUAL_EXECUTION, instantManualReason, validInstantManualSale, type InstantManualExecution } from './instantManualExecution';

export const SCREENED_CDA_LIMIT = -10;
export const SCREENED_CDA_STEP = 300_000;

export const SCREENED_CDA_GUARD_RULE = 'screened-first-exit-v3' as const;
export const SCREENED_PRICE_EXIT_RULE = 'screened-price-exit-v4' as const;
export const SCREENED_STOP_PCT = 5;
export const SCREENED_MIRROR = { enabled: true, gainPct: 2, sellPct: 71.5 } as const;
export const SCREENED_CDA_GUARD_LABEL = '防守线-20261112';
const GUARD_DEF = { ...DBL5_DEF, DBL5_config: dbl5Parameters({ guard_version: DBL5_RETEST_GUARD_VERSION }) };
export interface ScreenedCdaGuardProgress {
  version: typeof SCREENED_CDA_GUARD_RULE;
  guard?: Dbl5Checkpoint;
}
export interface ScreenedCdaGuardEvidence {
  version: typeof SCREENED_CDA_GUARD_RULE | typeof SCREENED_PRICE_EXIT_RULE | typeof INSTANT_TEMPLATE_MONITOR | typeof INSTANT_MANUAL_EXECUTION;
  reason: 'cda' | 'guard' | 'both' | 'manual' | 'static-stop' | 'template' | 'take-profit' | 'stop-loss';
  detail?: string;
  stop?: { barOpenAt: number; atOpen: boolean; level: number; openPrice: number; threshold: number };
  guardVersion?: typeof DBL5_RETEST_GUARD_VERSION;
  priceAt?: number;
}
export interface ScreenedCdaTrigger {
  at: number;
  /** Wall clock when the application confirmed the simulated fill. */
  observedAt?: number;
  value?: number;
  closePrice?: number;
  evidence?: ScreenedCdaGuardEvidence;
  mirror?: QualityMirrorFill;
  manual?: InstantManualExecution;
}
export function screenedSellReason(sell: ScreenedCdaTrigger) {
  switch (sell.evidence?.reason) {
    case 'template': return sell.evidence.detail || '持仓监测模板触发卖出';
    case 'static-stop': return `静态最大回撤达到 ${sell.evidence.stop?.threshold ?? 5}%`;
    case 'manual': return '手动卖出';
    case 'take-profit': return instantManualReason('take-profit');
    case 'stop-loss': return instantManualReason('stop-loss');
    case 'guard': return 'DBL-5 防守线断裂';
    case 'both': return 'CDA 低于 −10，且同根 DBL-5 防守线断裂';
    default: return 'CDA 原始值低于 −10';
  }
}
export function validScreenedSale(sell?: ScreenedCdaTrigger): sell is ScreenedCdaTrigger {
  if (!sell || !Number.isSafeInteger(sell.at) || sell.at <= 0) return false;
  const e = sell.evidence;
  const cda = typeof sell.value === 'number' && Number.isFinite(sell.value) && sell.value < SCREENED_CDA_LIMIT;
  if (e?.version === INSTANT_TEMPLATE_MONITOR) return e.reason === 'template' && typeof e.detail === 'string'
    && !!e.detail && Number.isFinite(sell.closePrice) && sell.closePrice! > 0;
  if (!e) return cda && sell.at % SCREENED_CDA_STEP === 0;
  if (!sell.closePrice || !Number.isFinite(sell.closePrice) || sell.closePrice <= 0) return false;
  if (sell.mirror && (!Number.isSafeInteger(sell.mirror.at) || sell.mirror.at <= 0 || sell.mirror.at > sell.at
    || !Number.isFinite(sell.mirror.price) || sell.mirror.price <= 0 || sell.mirror.fraction <= 0 || sell.mirror.fraction >= 1
    || !Number.isFinite(sell.mirror.fraction) || !Number.isFinite(sell.mirror.gainPct) || sell.mirror.gainPct <= 0)) return false;
  if (e.version === INSTANT_MANUAL_EXECUTION) return validInstantManualSale(sell.manual, sell.at, sell.closePrice, e.reason);
  if (e.version !== SCREENED_CDA_GUARD_RULE && e.version !== SCREENED_PRICE_EXIT_RULE) return false;
  if (e.reason === 'static-stop') {
    const stop = e.stop;
    return e.version === SCREENED_PRICE_EXIT_RULE && !!stop && Number.isSafeInteger(stop.barOpenAt)
      && stop.barOpenAt % 60_000 === 0 && stop.barOpenAt <= sell.at && sell.at < stop.barOpenAt + 60_000
      && [stop.level, stop.openPrice, stop.threshold].every(n => Number.isFinite(n) && n > 0);
  }
  if (e.reason === 'manual') return Number.isSafeInteger(e.priceAt) && e.priceAt! > 0 && e.priceAt! <= sell.at;
  if (sell.at % SCREENED_CDA_STEP !== 0) return false;
  if (e.reason === 'cda') return cda;
  return (e.reason === 'guard' || (e.reason === 'both' && cda)) && e.guardVersion === DBL5_RETEST_GUARD_VERSION;
}
export interface ScreenedCdaTask { id: string; source: TradeSignal; after: number; observeAfter?: number; progress?: ScreenedCdaGuardProgress; risk?: ScreenedPriceProgress; entryPrice?: number }
export interface ScreenedPriceProgress { through: number; entryPrice?: number; mirror?: QualityMirrorFill }
export type OnScreenedCdaRead = (id: string, result?: ScreenedCdaRead, error?: unknown) => void | Promise<void>;
export interface ScreenedCdaRead { through: number; trigger?: ScreenedCdaTrigger; progress?: ScreenedCdaGuardProgress; risk?: ScreenedPriceProgress; pendingError?: string }

export function freezeScreenedCda(): FishSnapshot {
  const { snapshot } = makeQualityBuyFilter('cda:CDA', '<', SCREENED_CDA_LIMIT, true, [accountFeatureDef('cda') ?? CDA_DEF]);
  qualityMetricPlan(snapshot, 'CDA');
  return snapshot;
}

export async function readScreenedCda(source: TradeSignal, after: number, end: number, snapshot: FishSnapshot,
  load: FishReconstructionLoader, signal: AbortSignal, watch?: Pick<ScreenedCdaTask, 'observeAfter' | 'progress'>): Promise<ScreenedCdaRead> {
  const { plan } = qualityMetricPlan(snapshot, 'CDA');
  if (plan.step !== SCREENED_CDA_STEP || after % plan.step !== 0) throw Error('CDA 追踪需要对齐 5 分钟收盘');
  const through = Math.min(after + 12 * plan.step, Math.floor(end / plan.step) * plan.step);
  if (through <= after) return { through: after };
  const from = after - (plan.warm - 1) * plan.step;
  const count = (through - from) / plan.step;
  const readCda = async () => {
    const bars = await load({ ...source, timeMs: through }, from, through, plan, signal);
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    validateFishBars(bars, through, count, plan.step);
    const values = evaluateOnBars(bars, plan.compiled, plan.def).vars.get(plan.averageName);
    return { bars, values };
  };
  if (watch?.observeAfter !== undefined) {
    const { observeAfter } = watch;
    const [cdaRead, guardRead] = await Promise.allSettled([
      readCda(), readNativeGuard(source, after, through, observeAfter, watch.progress?.guard, load, signal),
    ]);
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    const cdaData = cdaRead.status === 'fulfilled' ? cdaRead.value : undefined;
    const guardData = guardRead.status === 'fulfilled' ? guardRead.value : undefined;
    for (let at = after + plan.step; at <= through; at += plan.step) {
      if (at <= observeAfter) continue;
      const i = (at - from) / plan.step - 1;
      const value = typeof cdaData?.values === 'number' ? cdaData.values : cdaData?.values?.[i];
      const cda = typeof value === 'number' && Number.isFinite(value) && value < SCREENED_CDA_LIMIT;
      const guardPrice = guardData?.breaks.get(at);
      const guard = guardPrice !== undefined;
      if (cda || guard) return { through: at, trigger: { at, closePrice: guardPrice ?? cdaData!.bars[i].close,
        ...(typeof value === 'number' && Number.isFinite(value) ? { value } : {}),
        evidence: { version: SCREENED_CDA_GUARD_RULE, reason: guard ? (cda ? 'both' : 'guard') : 'cda',
          ...(guard ? { guardVersion: DBL5_RETEST_GUARD_VERSION } : {}) },
      } };
    }
    // Never advance over an unresolved period unless the other condition has
    // already provided a confirmed exit.
    if (cdaRead.status === 'rejected') throw cdaRead.reason;
    if (guardRead.status === 'rejected') throw guardRead.reason;
    return { through, progress: { version: SCREENED_CDA_GUARD_RULE, guard: guardRead.value.checkpoint } };
  }
  const { bars, values } = await readCda();
  for (let i = plan.warm - 1; i < bars.length; i++) {
    const value = typeof values === 'number' ? values : values?.[i];
    if (value !== undefined && Number.isFinite(value) && value < SCREENED_CDA_LIMIT) {
      const at = bars[i].openTime + plan.step;
      return { through: at, trigger: { at, value, closePrice: bars[i].close } };
    }
  }
  return { through };
}

/** Uses the same native red-cross event as the chart; the watch only observes it. */
async function readNativeGuard(source: TradeSignal, after: number, through: number, observeAfter: number,
  previous: Dbl5Checkpoint | undefined, load: FishReconstructionLoader, signal: AbortSignal) {
  const step = SCREENED_CDA_STEP;
  const definition = GUARD_DEF;
  const plan = compileFishProgram(definition, { statistic: '结果', direction: '>', threshold: 0, constraints: [] });
  const start = previous?.initialization_start ?? qualityHistoryFrom(load,
    Math.floor(observeAfter / step) * step - Math.ceil(featureWindowMs(definition) / step) * step, step);
  const from = previous?.last_time ?? start;
  if (from < 0 || from >= through || (previous && from !== after)) throw Error('DBL-5 防守线追踪初始化或检查点无效');
  const bars = await load({ ...source, timeMs: through }, from, through, plan, signal);
  validateFishBars(bars, through, (through - from) / step, step);
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  const result = evaluateOnBars(bars, plan.compiled, { ...definition, DBL5_symbol: source.symbol,
    DBL5_initialization_start: start, DBL5_initialization_id: `screened-sale:${start}`, DBL5_checkpoint: previous });
  if (!result.DBL5_checkpoint || result.DBL5_details?.length !== bars.length
    || result.DBL5_details.some(row => !row.data_valid)) throw Error('DBL-5 防守线行情或报价精度无效');
  const breaks = new Map<number, number>();
  result.DBL5_details.forEach((row, i) => {
    if (row.darvas_5m_guard_broken && row.at > observeAfter && row.at > after) breaks.set(row.at, bars[i].close);
  });
  // Past output ledgers are unused when appending new bars. Keep only active engine state.
  const checkpoint = { ...result.DBL5_checkpoint, confirmed_boxes: [], ended: [], events: [] };
  return { breaks, checkpoint };
}
