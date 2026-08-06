export interface AnalysisAutoFitPriceLine {
  price: number;
  startTime: number;
  endTime: number;
}

export interface AnalysisAutoFitPriceBounds {
  min: number;
  max: number;
}

interface BuildAnalysisOrderPriceBoundsOptions {
  lines?: AnalysisAutoFitPriceLine[];
  visibleStartTime?: number | null;
  visibleEndTime?: number | null;
}

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === "number" && Number.isFinite(value)
);

/**
 * Returns only the price bounds contributed by pending-order lines that cross
 * the current native time window. Candle prices remain owned by KLineCharts.
 */
export function buildAnalysisOrderPriceBounds({
  lines,
  visibleStartTime,
  visibleEndTime,
}: BuildAnalysisOrderPriceBoundsOptions): AnalysisAutoFitPriceBounds | null {
  const hasVisibleRange = isFiniteNumber(visibleStartTime)
    && isFiniteNumber(visibleEndTime)
    && visibleEndTime >= visibleStartTime;

  const prices = (lines ?? []).flatMap((line) => {
    if (!isFiniteNumber(line.price)) return [];

    if (hasVisibleRange) {
      if (!isFiniteNumber(line.startTime) || !isFiniteNumber(line.endTime)) return [];
      const startTime = Math.min(line.startTime, line.endTime);
      const endTime = Math.max(line.startTime, line.endTime);
      if (endTime < visibleStartTime || startTime > visibleEndTime) return [];
    }

    return [line.price];
  });

  if (prices.length === 0) return null;

  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
  };
}
