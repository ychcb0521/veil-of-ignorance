import { CDA_DEF, evaluateOnBars } from '@/lib/deepDig/features';
import { accountFeatureDef } from '@/lib/featureSource';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishSnapshot } from './algorithm';
import { qualityMetricPlan } from './quality';
import { makeQualityBuyFilter } from './qualityFilters';
import type { FishReconstructionLoader } from './reconstruction';
import { validateFishBars } from './shared';

export const SCREENED_CDA_LIMIT = -10;
export const SCREENED_CDA_STEP = 300_000;

export interface ScreenedCdaTrigger { at: number; value: number; closePrice?: number }
export interface ScreenedCdaTask { id: string; source: TradeSignal; after: number }
export type OnScreenedCdaRead = (id: string, result?: ScreenedCdaRead, error?: unknown) => void | Promise<void>;
export interface ScreenedCdaRead { through: number; trigger?: ScreenedCdaTrigger }

export function freezeScreenedCda(): FishSnapshot {
  const { snapshot } = makeQualityBuyFilter('cda:CDA', '<', SCREENED_CDA_LIMIT, true, [accountFeatureDef('cda') ?? CDA_DEF]);
  qualityMetricPlan(snapshot, 'CDA');
  return snapshot;
}

export async function readScreenedCda(source: TradeSignal, after: number, end: number, snapshot: FishSnapshot,
  load: FishReconstructionLoader, signal: AbortSignal): Promise<ScreenedCdaRead> {
  const { plan } = qualityMetricPlan(snapshot, 'CDA');
  if (plan.step !== SCREENED_CDA_STEP || after % plan.step !== 0) throw Error('CDA 追踪需要对齐 5 分钟收盘');
  const through = Math.min(after + 12 * plan.step, Math.floor(end / plan.step) * plan.step);
  if (through <= after) return { through: after };
  const from = after - (plan.warm - 1) * plan.step;
  const count = (through - from) / plan.step;
  const bars = await load({ ...source, timeMs: through }, from, through, plan, signal);
  if (signal.aborted) throw new DOMException('已取消', 'AbortError');
  validateFishBars(bars, through, count, plan.step);
  const values = evaluateOnBars(bars, plan.compiled, plan.def).vars.get(plan.averageName);
  for (let i = plan.warm - 1; i < bars.length; i++) {
    const value = typeof values === 'number' ? values : values?.[i];
    if (value !== undefined && Number.isFinite(value) && value < SCREENED_CDA_LIMIT) {
      const at = bars[i].openTime + plan.step;
      return { through: at, trigger: { at, value, closePrice: bars[i].close } };
    }
  }
  return { through };
}
