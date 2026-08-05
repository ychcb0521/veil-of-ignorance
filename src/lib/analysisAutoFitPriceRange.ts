export interface AnalysisAutoFitCandle {
  time: number;
  high: number;
  low: number;
}

export interface AnalysisAutoFitAnnotations {
  markers?: Array<{ time: number; price: number }>;
  priceLines?: Array<{ price: number }>;
  timeBoundPriceLines?: Array<{
    price: number;
    startTime: number;
    endTime: number;
  }>;
}

export interface AnalysisAutoFitPriceRange {
  min: number;
  max: number;
}

interface BuildAnalysisAutoFitPriceRangeOptions {
  data: AnalysisAutoFitCandle[];
  visibleStartTime?: number | null;
  visibleEndTime?: number | null;
  annotations?: AnalysisAutoFitAnnotations;
  draggablePriceLines?: Array<{ price: number }>;
}

const addFinite = (values: number[], value: number | undefined) => {
  if (typeof value === "number" && Number.isFinite(value)) values.push(value);
};

export function buildAnalysisAutoFitPriceRange({
  data,
  visibleStartTime,
  visibleEndTime,
  annotations,
  draggablePriceLines,
}: BuildAnalysisAutoFitPriceRangeOptions): AnalysisAutoFitPriceRange | null {
  const hasVisibleRange = typeof visibleStartTime === "number"
    && Number.isFinite(visibleStartTime)
    && typeof visibleEndTime === "number"
    && Number.isFinite(visibleEndTime)
    && visibleEndTime > visibleStartTime;

  const visibleCandles = hasVisibleRange
    ? data.filter(item => item.time >= visibleStartTime && item.time <= visibleEndTime)
    : data;
  const candles = visibleCandles.length > 0 ? visibleCandles : data;
  const values: number[] = [];

  for (const item of candles) {
    addFinite(values, item.low);
    addFinite(values, item.high);
  }

  for (const marker of annotations?.markers ?? []) {
    if (!hasVisibleRange || (marker.time >= visibleStartTime && marker.time <= visibleEndTime)) {
      addFinite(values, marker.price);
    }
  }

  for (const line of annotations?.priceLines ?? []) addFinite(values, line.price);
  for (const line of draggablePriceLines ?? []) addFinite(values, line.price);

  for (const line of annotations?.timeBoundPriceLines ?? []) {
    const start = Math.min(line.startTime, line.endTime);
    const end = Math.max(line.startTime, line.endTime);
    if (!hasVisibleRange || (end >= visibleStartTime && start <= visibleEndTime)) {
      addFinite(values, line.price);
    }
  }

  if (values.length === 0) return null;

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const span = rawMax - rawMin;
  const padding = span > 0
    ? span * 0.04
    : Math.max(Math.abs(rawMax) * 0.01, 1e-8);

  return {
    min: rawMin - padding,
    max: rawMax + padding,
  };
}
