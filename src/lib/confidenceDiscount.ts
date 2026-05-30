/**
 * 芒格折扣 — 批次 24 置信度侧安全边际
 * 主观置信度系统性偏高，行动前先折扣。优先用本人校准数据，样本不足回落到 Tetlock 经验默认值。
 *
 * 关键：折扣值【绝不写库】，仅用于显示。存库的永远是滑块原值，
 * 否则校准曲线会被擦花，无法持续暴露真实的偏高程度。
 */
import type { TradeJournal } from '@/types/journal';

/** Tetlock 经验默认折扣（百分点）。 */
export const DEFAULT_CONFIDENCE_DISCOUNT = 15;
/** 用个人校准前需要的最小相近样本数。 */
export const MIN_PERSONALIZED_SAMPLES = 10;
/** 相近置信度的区间半径（百分点）。 */
const CONFIDENCE_BAND = 10;

export interface DiscountResult {
  /** 折扣后展示的"真实可能"，下限 0。 */
  discountedPct: number;
  /** 折扣幅度（百分点），可正可负（个人校准下可能为负，即你反而偏保守）。 */
  discount: number;
  source: 'personalized' | 'default';
  /** 用于个人校准的相近样本数。 */
  sampleSize: number;
}

/**
 * 取该用户所有已平仓的 'trade' journal（有置信度且有结果），筛出落在
 * [conf-10, conf+10] 的样本；≥10 笔用个人实际胜率，否则用 -15pt 默认。
 */
export function computeDiscount(
  currentConfidencePct: number,
  journals: TradeJournal[],
): DiscountResult {
  const closed = journals.filter(j =>
    (j.journal_kind ?? 'trade') === 'trade'
    && typeof j.pre_calibration_win_pct === 'number'
    && (j.post_outcome === 'win' || j.post_outcome === 'loss' || j.post_outcome === 'breakeven'),
  );

  const inBand = closed.filter(j => {
    const conf = j.pre_calibration_win_pct as number;
    return conf >= currentConfidencePct - CONFIDENCE_BAND
      && conf <= currentConfidencePct + CONFIDENCE_BAND;
  });

  if (inBand.length >= MIN_PERSONALIZED_SAMPLES) {
    const wins = inBand.filter(j => j.post_outcome === 'win').length;
    const actualWinRate = (wins / inBand.length) * 100;
    const discount = currentConfidencePct - actualWinRate;
    return {
      discountedPct: clampPct(currentConfidencePct - discount),
      discount,
      source: 'personalized',
      sampleSize: inBand.length,
    };
  }

  return {
    discountedPct: clampPct(currentConfidencePct - DEFAULT_CONFIDENCE_DISCOUNT),
    discount: DEFAULT_CONFIDENCE_DISCOUNT,
    source: 'default',
    sampleSize: inBand.length,
  };
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
