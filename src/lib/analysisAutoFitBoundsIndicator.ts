import {
  registerIndicator,
  type IndicatorTemplate,
} from "klinecharts";

export const ANALYSIS_AUTO_FIT_BOUNDS_INDICATOR = "ANALYSIS_AUTO_FIT_BOUNDS";

let registered = false;

/**
 * A bounds-only indicator. It contributes explicit Y-axis limits without
 * producing figures or per-candle values, so it cannot affect the time axis.
 */
export function registerAnalysisAutoFitBoundsIndicator() {
  if (registered) return;

  try {
    registerIndicator({
      name: ANALYSIS_AUTO_FIT_BOUNDS_INDICATOR,
      shortName: "",
      precision: 8,
      calcParams: [],
      shouldOhlc: false,
      shouldFormatBigNumber: false,
      visible: false,
      zLevel: -100,
      minValue: null,
      maxValue: null,
      figures: [],
      calc: () => [],
    } as IndicatorTemplate);
  } catch {
    // Another mounted chart may already have registered this global template.
  }

  registered = true;
}
