import {
  IndicatorSeries,
  TooltipShowRule,
  TooltipShowType,
  registerIndicator,
  type IndicatorCreate,
} from "klinecharts";

export const ANALYSIS_AUTO_FIT_BOUNDS_INDICATOR = "ANALYSIS_AUTO_FIT_BOUNDS";

let registered = false;

export function registerAnalysisAutoFitBoundsIndicator() {
  if (registered) return;

  try {
    registerIndicator({
      name: ANALYSIS_AUTO_FIT_BOUNDS_INDICATOR,
      shortName: "",
      precision: 8,
      calcParams: [0, 0],
      shouldOhlc: false,
      shouldFormatBigNumber: false,
      visible: true,
      zLevel: -100,
      series: IndicatorSeries.Price,
      minValue: null,
      maxValue: null,
      figures: [
        { key: "lower", title: "", type: "line" },
        { key: "upper", title: "", type: "line" },
      ],
      styles: {
        lines: [
          { color: "rgba(0, 0, 0, 0)", size: 0 },
          { color: "rgba(0, 0, 0, 0)", size: 0 },
        ],
        lastValueMark: { show: false },
        tooltip: {
          showRule: TooltipShowRule.None,
          showType: TooltipShowType.Standard,
          showName: false,
          showParams: false,
        },
      },
      calc: (dataList, indicator) => {
        const lower = Number(indicator.calcParams?.[0]);
        const upper = Number(indicator.calcParams?.[1]);
        if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
          return dataList.map(() => ({}));
        }
        return dataList.map(() => ({ lower, upper }));
      },
    } as IndicatorCreate);
    registered = true;
  } catch {
    // KLineCharts throws when another mounted chart registered the same name.
    registered = true;
  }
}
