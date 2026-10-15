/**
 * Deep RSA · 第 4 步：按时间切分训练 / 验证 / 测试，切口之间留隔离带。
 *
 * 不随机打乱：同一段行情、同一个月的市场状态会在训练与测试之间泄漏。
 * 隔离带 = 观察窗（48h）+ 结果期：切口前最后一个训练锚点的结果期，
 * 不会与切口后第一个验证锚点的观察窗重叠。落在隔离带里的事件不进任何一组，如实计数。
 */
import { WINDOW_MS } from '@/lib/deepRsa/grouping';
import { OUTCOME_HORIZON_MS } from '@/lib/deepRsa/outcome';

export interface TimedItem {
  id: string;
  anchorMs: number;
}

export interface SplitConfig {
  trainFrac?: number;
  valFrac?: number;
  embargoMs?: number;
}

export interface TimeSplit<T extends TimedItem> {
  train: T[];
  val: T[];
  test: T[];
  embargoed: T[];
  /** 验证集、测试集的起点（切口时刻）；样本不足时为 null。 */
  cutoffs: { val: number | null; test: number | null };
  embargoMs: number;
}

export const DEFAULT_EMBARGO_MS = WINDOW_MS + OUTCOME_HORIZON_MS;

export function chronologicalSplit<T extends TimedItem>(items: readonly T[], config: SplitConfig = {}): TimeSplit<T> {
  const trainFrac = config.trainFrac ?? 0.6;
  const valFrac = config.valFrac ?? 0.2;
  const embargoMs = config.embargoMs ?? DEFAULT_EMBARGO_MS;
  const sorted = [...items].sort((a, b) => a.anchorMs - b.anchorMs || a.id.localeCompare(b.id));
  const out: TimeSplit<T> = { train: [], val: [], test: [], embargoed: [], cutoffs: { val: null, test: null }, embargoMs };
  if (sorted.length === 0) return out;
  const valCut = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * trainFrac))].anchorMs;
  const testCut = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (trainFrac + valFrac)))].anchorMs;
  out.cutoffs = { val: valCut, test: testCut };
  for (const item of sorted) {
    const t = item.anchorMs;
    if (t < valCut) out.train.push(item);
    else if (t < valCut + embargoMs) out.embargoed.push(item);
    else if (t < testCut) out.val.push(item);
    else if (t < testCut + embargoMs && testCut > valCut) out.embargoed.push(item);
    else out.test.push(item);
  }
  return out;
}
