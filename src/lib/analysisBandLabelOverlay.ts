import {
  LineType,
  PolygonType,
  getSupportedOverlays,
  registerOverlay,
  type OverlayCreateFiguresCallbackParams,
  type OverlayFigure,
} from "klinecharts";
import {
  FLOATING_LABEL_HEIGHT,
  layoutAnalysisFloatingLabels,
  type AnalysisFloatingLabelCandidate,
} from "@/lib/analysisFloatingLabels";

export const ANALYSIS_BAND_LABEL_OVERLAY = "analysisBandLabels";

export interface AnalysisBandLabelOverlayData {
  labels: AnalysisFloatingLabelCandidate[];
  theme: "light" | "dark";
}

const withOpacity = (color: string, opacity: number) => {
  const hex = color.trim().match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (hex) {
    return `rgba(${Number.parseInt(hex[1], 16)}, ${Number.parseInt(hex[2], 16)}, ${Number.parseInt(hex[3], 16)}, ${opacity})`;
  }
  const rgba = color.trim().match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)$/i);
  if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${opacity})`;
  return color;
};

const isOverlayData = (value: unknown): value is AnalysisBandLabelOverlayData => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AnalysisBandLabelOverlayData>;
  return Array.isArray(candidate.labels) && (candidate.theme === "light" || candidate.theme === "dark");
};

/**
 * Draws every campaign label inside KlineCharts' own canvas pass. The X coordinate
 * comes exclusively from the overlay point timestamp, so candles and labels cannot
 * drift onto separate viewport transforms during a historical zoom or pan.
 */
export function createAnalysisBandLabelFigures({
  overlay,
  coordinates,
  bounding,
}: Pick<OverlayCreateFiguresCallbackParams, "overlay" | "coordinates" | "bounding">): OverlayFigure[] {
  if (!isOverlayData(overlay.extendData) || bounding.width <= 0) return [];

  const labelsById = new Map(overlay.extendData.labels.map(label => [label.id, label]));
  const laidOut = layoutAnalysisFloatingLabels(
    overlay.extendData.labels.flatMap((label, index) => {
      const x = coordinates[index]?.x;
      return typeof x === "number" && Number.isFinite(x) ? [{ ...label, x }] : [];
    }),
    { minTime: 0, maxTime: 1, width: bounding.width },
  );

  return laidOut.map((label) => {
    const source = labelsById.get(label.id) ?? label;
    const emphasized = source.emphasis === "main-add";
    const opacity = emphasized ? 0.96 : 0.76;
    const backgroundColor = overlay.extendData.theme === "light"
      ? emphasized ? "rgba(255, 255, 255, 0.44)" : "rgba(255, 255, 255, 0.21)"
      : emphasized ? "rgba(11, 14, 17, 0.35)" : "rgba(11, 14, 17, 0.17)";

    return {
      key: source.id,
      type: "text",
      attrs: {
        x: label.left + label.width / 2,
        y: label.top + FLOATING_LABEL_HEIGHT / 2,
        text: source.text,
        align: "center",
        baseline: "middle",
      },
      styles: {
        style: PolygonType.StrokeFill,
        color: withOpacity(source.color, opacity),
        size: emphasized ? 8 : 7,
        family: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        weight: emphasized ? 800 : 600,
        borderStyle: LineType.Solid,
        borderSize: 1,
        borderColor: withOpacity(source.color, opacity),
        borderRadius: 3,
        backgroundColor,
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 1,
        paddingBottom: 1,
      },
      ignoreEvent: true,
    };
  });
}

export function registerAnalysisBandLabelOverlay() {
  if (getSupportedOverlays().includes(ANALYSIS_BAND_LABEL_OVERLAY)) return;
  registerOverlay({
    name: ANALYSIS_BAND_LABEL_OVERLAY,
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: createAnalysisBandLabelFigures,
  });
}
