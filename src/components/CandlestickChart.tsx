/**
 * KlineCharts v9 based candlestick chart with native drawing tools and indicators.
 * Uses applyNewData / updateData / applyMoreData for data feeding.
 */

import React, { useEffect, useRef, useCallback, useMemo, useState, memo } from "react";
import {
  init,
  dispose,
  CandleType,
  LineType,
  ActionType,
  DomPosition,
  TooltipShowRule,
  TooltipShowType,
  type Chart,
  type KLineData,
  type OverlayCreate,
} from "klinecharts";
import type { KlineData } from "@/hooks/useBinanceData";
import type { PendingOrder } from "@/types/trading";
import { useTheme } from "@/contexts/ThemeContext";
import { DrawingToolbar } from "./DrawingToolbar";
import { IndicatorMenu } from "./IndicatorMenu";
import { BarChart3, X, ListOrdered, Eye, EyeOff } from "lucide-react";
import { usePersistedState } from "@/hooks/usePersistedState";
import type { TradeRecord } from "@/types/trading";
import { registerCustomIndicators, CUSTOM_INDICATOR_MAP } from "@/lib/customIndicators";
import {
  type AnalysisFloatingLabelCandidate,
} from "@/lib/analysisFloatingLabels";
import {
  ANALYSIS_BAND_LABEL_OVERLAY,
  registerAnalysisBandLabelOverlay,
  type AnalysisBandLabelOverlayData,
} from "@/lib/analysisBandLabelOverlay";
import {
  installKlineChartPointerInteraction,
  type InteractionController,
} from "@/lib/klineChartInteraction";

// Mapping from our indicator IDs to klinecharts indicator names (built-in + custom)
const KLINE_INDICATOR_MAP: Record<string, string> = { ...CUSTOM_INDICATOR_MAP };

// Keep right-axis prices readable. KlineCharts otherwise folds consecutive
// decimal zeros into notation such as `0.0{3}8`, which resembles corrupted text.
const DECIMAL_FOLD_THRESHOLD = 12;

// IDs that render on the main (candle) pane as overlays
const OVERLAY_INDICATOR_IDS = new Set([
  "MA",
  "EMA",
  "SMA",
  "WMA",
  "BOLL",
  "SAR",
  "DEMA",
  "TEMA",
  "SMMA",
  "HMA",
  "ALMA",
  "LSMA",
  "KAMA",
  "HAMA",
  "MCGD",
  "DMA",
  "TMA",
  "MMA",
  "GMMA",
  "MACHAN",
  "EMA_CROSS",
  "MA_EMA_CROSS",
  "KC",
  "DC",
  "PC",
  "ENV",
  "SEB",
  "ICH",
  "ST",
  "ZIGZAG",
  "CRSI_STOP",
  "PIVOT",
  "W52HL",
  "FRAC",
  "ALLIGATOR",
  "LRC",
  "MEDP",
  "TYPP",
  "AVGP",
  "VWAP",
]);

const MAIN_ADD_MARKER_PATTERN = /^A\d+$/;
const ANALYSIS_ANNOTATION_GROUP_ID = "analysis_annotations";

const isMainAddLabel = (label?: string) => MAIN_ADD_MARKER_PATTERN.test(label?.trim() ?? "");

const strengthenAnalysisColor = (color: string) => {
  const normalized = color.trim();
  if (normalized.toUpperCase() === "#0ECB81") return "#008F5A";
  if (normalized.toUpperCase() === "#2B80FF") return "#005BD6";
  const rgba = normalized.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)$/i);
  if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, 0.92)`;
  return color;
};

// Overlay tool name mapping for klinecharts built-in overlays
const OVERLAY_MAP: Record<string, string> = {
  TrendLine: "segment",
  Ray: "rayLine",
  ExtendedLine: "straightLine",
  HorizontalLine: "horizontalStraightLine",
  VerticalLine: "verticalStraightLine",
  ParallelChannel: "parallelStraightLine",
  FibRetracement: "fibonacciLine",
  Rectangle: "rect",
  Circle: "circle",
  Brush: "segment",
  Text: "simpleAnnotation",
  Marker: "simpleTag",
  Measure: "priceLine",
  LongPosition: "priceLine",
  ShortPosition: "priceLine",
  PriceLine: "priceLine",
};

export interface IndicatorConfig {
  type: string;
  period: number;
  color?: string;
  enabled: boolean;
}

/** Imperative API exposed to parent for direct chart manipulation (bypasses React). */
export interface ChartImperativeApi {
  updateData: (candle: KLineData) => void;
}

export interface AnalysisChartMarker {
  time: number;
  price: number;
  color: string;
  label?: string;
  shape?: "triangle-up" | "triangle-down" | "circle" | "square";
}

export interface AnalysisPriceLine {
  price: number;
  color: string;
  title?: string;
  dim?: boolean;
}

export interface AnalysisTimeBoundPriceLine extends AnalysisPriceLine {
  startTime: number;
  endTime: number;
  dashed?: boolean;
  endMarker?: "x" | null;
}

export interface AnalysisVerticalLine {
  time: number;
  color: string;
  width?: number;
  /** Solid when false, dashed otherwise. Defaults to dashed for backward compat. */
  dashed?: boolean;
  label?: string;
  labelColor?: string;
  /** Keep important campaign anchors visible by clamping them to the rendered data edge. */
  alwaysVisible?: boolean;
}

export interface AnalysisChartAnnotations {
  markers?: AnalysisChartMarker[];
  priceLines?: AnalysisPriceLine[];
  timeBoundPriceLines?: AnalysisTimeBoundPriceLine[];
  verticalLines?: AnalysisVerticalLine[];
}

/** A horizontal price line the user can drag up/down (campaign What-if hedge/TP triggers). */
export interface AnalysisDraggablePriceLine {
  id: string;
  price: number;
  color: string;
  label?: string;
}

/** A vertical time line the user can drag left/right (campaign What-if leg timing). */
export interface AnalysisDraggableVerticalLine {
  id: string;
  time: number;
  color: string;
  width?: number;
  dashed?: boolean;
  label?: string;
  labelColor?: string;
  selected?: boolean;
}

interface Props {
  data: KlineData[];
  symbol: string;
  /** Changes when the host switches viewport/layout so native panes can reflow after CSS settles. */
  viewportRevision?: string | number;
  onLoadOlder?: () => void;
  loadingOlder?: boolean;
  tradeHistory?: TradeRecord[];
  rawSymbol?: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  pendingOrders?: PendingOrder[];
  onCancelOrder?: (orderId: string) => void;
  /** Ref assigned with imperative chart API for direct candle pushing. */
  chartApiRef?: React.MutableRefObject<ChartImperativeApi | null>;
  /** Called when crosshair moves over chart — provides Y-axis price */
  onCrosshairPriceChange?: (price: number | null) => void;
  /** When true, clicking on chart picks the crosshair price */
  pickMode?: boolean;
  /** Called when user clicks chart in pick mode */
  onPricePicked?: (price: number) => void;
  /** Use the main chart engine in read-only analysis surfaces such as replay/campaign review. */
  analysisMode?: boolean;
  /** Non-trading overlays rendered by replay and campaign review pages. */
  analysisAnnotations?: AnalysisChartAnnotations;
  /** Optional analysis anchor used to center short replay/campaign windows instead of snapping to the latest candle. */
  analysisFocusTime?: number | null;
  /** Analysis surfaces only: fit the requested initial range, or the entire dataset when no range is supplied. */
  analysisFitAll?: boolean;
  /** Optional initial range fitted by analysisFitAll while retaining data outside it for later zoom-out/panning. */
  analysisVisibleStartTime?: number | null;
  analysisVisibleEndTime?: number | null;
  /** Whether to show the chart engine's latest-price horizontal mark. Campaign review turns this off to keep the extracted board clean. */
  showLastPriceLine?: boolean;
  /** Draggable horizontal price lines (campaign What-if hedge/TP triggers). Drag up/down to change the trigger price. */
  draggablePriceLines?: AnalysisDraggablePriceLine[];
  /** Fired on drag release with the line id and its new price. */
  onDragPriceLine?: (id: string, price: number) => void;
  /** Draggable vertical time lines (campaign What-if leg open/close timing). */
  draggableVerticalLines?: AnalysisDraggableVerticalLine[];
  /** Fired on drag release with the line id and its new timestamp. */
  onDragVerticalLine?: (id: string, time: number) => void;
  /** Fired when a draggable vertical line is selected on the chart. */
  onSelectVerticalLine?: (id: string) => void;
  /** K 线时间轴的显示时区（IANA 名）。默认 Asia/Shanghai，与主交易页一致；战役页用 UTC。 */
  timezone?: string;
}

// Convert our KlineData to klinecharts KLineData
function toKLineData(d: KlineData): KLineData {
  return {
    timestamp: d.time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
    volume: d.volume,
  };
}

// Dark theme styles
const DARK_STYLES = {
  grid: {
    show: true,
    horizontal: { color: "#2B3139" },
    vertical: { color: "#2B3139" },
  },
  candle: {
    type: CandleType.CandleSolid,
    bar: {
      upColor: "#0ECB81",
      downColor: "#F6465D",
      upBorderColor: "#0ECB81",
      downBorderColor: "#F6465D",
      upWickColor: "#0ECB81",
      downWickColor: "#F6465D",
    },
    priceMark: {
      show: true,
      last: {
        show: true,
        upColor: "#0ECB81",
        downColor: "#F6465D",
        line: { show: true, style: LineType.Dashed, dashedValue: [4, 4] },
      },
    },
    tooltip: {
      showRule: TooltipShowRule.FollowCross,
      showType: TooltipShowType.Standard,
    },
  },
  xAxis: { show: true, tickText: { color: "#848E9C" } },
  yAxis: { show: true, tickText: { color: "#848E9C" } },
  crosshair: {
    show: true,
    horizontal: {
      show: true,
      line: { show: true, color: "#F0B90B33", style: LineType.Dashed },
      text: { show: true, color: "#FFFFFF", borderColor: "#F0B90B", backgroundColor: "#363A45" },
    },
    vertical: {
      show: true,
      line: { show: true, color: "#F0B90B33", style: LineType.Dashed },
      text: { show: true, color: "#FFFFFF", borderColor: "#F0B90B", backgroundColor: "#363A45" },
    },
  },
  indicator: {
    lastValueMark: {
      show: true,
      text: {
        show: true,
        color: "#FFFFFF",
        borderColor: "inherit",
        borderRadius: 2,
        size: 10,
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 2,
        paddingBottom: 2,
      },
    },
    tooltip: {
      showRule: TooltipShowRule.FollowCross,
      showType: TooltipShowType.Standard,
    },
  },
  separator: { color: "#1B1F26" },
};

// Light theme styles
const LIGHT_STYLES = {
  grid: {
    show: true,
    horizontal: { color: "#EAECEF" },
    vertical: { color: "#EAECEF" },
  },
  candle: {
    type: CandleType.CandleSolid,
    bar: {
      upColor: "#0ECB81",
      downColor: "#F6465D",
      upBorderColor: "#0ECB81",
      downBorderColor: "#F6465D",
      upWickColor: "#0ECB81",
      downWickColor: "#F6465D",
    },
    priceMark: {
      show: true,
      last: {
        show: true,
        upColor: "#0ECB81",
        downColor: "#F6465D",
        line: { show: true, style: LineType.Dashed, dashedValue: [4, 4] },
      },
    },
    tooltip: {
      showRule: TooltipShowRule.FollowCross,
      showType: TooltipShowType.Standard,
    },
  },
  xAxis: { show: true, tickText: { color: "#474D57" } },
  yAxis: { show: true, tickText: { color: "#474D57" } },
  crosshair: {
    show: true,
    horizontal: {
      show: true,
      line: { show: true, color: "#B7BDC6", style: LineType.Dashed },
      text: { show: true, color: "#1E2329", borderColor: "#B7BDC6", backgroundColor: "#F0F1F2" },
    },
    vertical: {
      show: true,
      line: { show: true, color: "#B7BDC6", style: LineType.Dashed },
      text: { show: true, color: "#1E2329", borderColor: "#B7BDC6", backgroundColor: "#F0F1F2" },
    },
  },
  indicator: {
    lastValueMark: {
      show: true,
      text: {
        show: true,
        color: "#1E2329",
        borderColor: "inherit",
        borderRadius: 2,
        size: 10,
        paddingLeft: 4,
        paddingRight: 4,
        paddingTop: 2,
        paddingBottom: 2,
      },
    },
    tooltip: {
      showRule: TooltipShowRule.FollowCross,
      showType: TooltipShowType.Standard,
    },
  },
  separator: { color: "#EAECEF" },
};

function chartStylesForMode(theme: string | undefined, showLastPriceLine: boolean) {
  const baseStyle = theme === "light" ? LIGHT_STYLES : DARK_STYLES;
  return {
    ...baseStyle,
    candle: {
      ...baseStyle.candle,
      priceMark: {
        ...baseStyle.candle.priceMark,
        last: {
          ...baseStyle.candle.priceMark.last,
          show: showLastPriceLine,
          line: {
            ...baseStyle.candle.priceMark.last.line,
            show: showLastPriceLine,
          },
        },
      },
    },
  };
}

/**
 * Cheap, order-sensitive signature of a candle time axis. An integer FNV-1a
 * rolling hash over every timestamp detects any inserted / removed / shifted
 * candle (middle corrections included) without allocating a large array or a
 * ~180KB comma-joined string. This matters because the analysis-overlay effect
 * compares the prop axis against KlineCharts' async-committed native axis and
 * can retry up to 120× while a large legacy snapshot commits — building join
 * strings there cost ~4ms each at 15k candles (~1s of jank per historical
 * campaign); the hash keeps each pass sub-millisecond so historical charts are
 * as smooth as the newest ones.
 */
export function hashTimeAxis(count: number, timeAt: (index: number) => number): string {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < count; index += 1) {
    const time = timeAt(index);
    hash = (hash ^ (time & 0xffffffff)) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
    const high = Math.floor(time / 0x100000000);
    hash = (hash ^ high) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${count}:${hash}`;
}

function CandlestickChartComponent({
  data,
  symbol,
  viewportRevision,
  onLoadOlder,
  loadingOlder,
  tradeHistory,
  rawSymbol,
  pricePrecision = 2,
  quantityPrecision = 3,
  pendingOrders,
  onCancelOrder,
  chartApiRef,
  onCrosshairPriceChange,
  pickMode,
  onPricePicked,
  analysisMode = false,
  analysisAnnotations,
  analysisFocusTime = null,
  analysisFitAll = false,
  analysisVisibleStartTime = null,
  analysisVisibleEndTime = null,
  showLastPriceLine = true,
  draggablePriceLines,
  onDragPriceLine,
  draggableVerticalLines,
  onDragVerticalLine,
  onSelectVerticalLine,
  timezone = "Asia/Shanghai",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const prevDataLenRef = useRef(0);
  const prevOldestRef = useRef<number>(0);
  const prevNewestRef = useRef<number>(0);
  const prevLastSigRef = useRef("");
  const prevTimeAxisSigRef = useRef("");
  const prevSymbolRef = useRef<string>(symbol);
  const liveUpdateQueueRef = useRef<KLineData[]>([]);
  const liveUpdateInFlightRef = useRef(false);
  const liveUpdateGenerationRef = useRef(0);
  const analysisOverlayIdsRef = useRef<string[]>([]);
  const dragOverlayIdsRef = useRef<string[]>([]);
  const onDragPriceLineRef = useRef(onDragPriceLine);
  onDragPriceLineRef.current = onDragPriceLine;
  const onDragVerticalLineRef = useRef(onDragVerticalLine);
  onDragVerticalLineRef.current = onDragVerticalLine;
  const onSelectVerticalLineRef = useRef(onSelectVerticalLine);
  onSelectVerticalLineRef.current = onSelectVerticalLine;
  const analysisOverlayRunRef = useRef(0);
  const pointerInteractionRef = useRef<InteractionController | null>(null);
  const viewportReflowFrameRef = useRef<number | null>(null);
  const viewportPrimeFrameRef = useRef<number | null>(null);
  const lastViewportSizeRef = useRef({ width: 0, height: 0 });
  const analysisCommitFinalizerRef = useRef<() => boolean>(() => false);
  const analysisLifecycleRef = useRef({
    requestedAxisSignature: "",
    requestedSnapshotKey: "",
    scheduledSnapshotKey: "",
    settledSnapshotKey: "",
    needsViewport: false,
    finalizeFrame: null as number | null,
    primeFrame: null as number | null,
  });

  const [indicators, setIndicators] = usePersistedState<IndicatorConfig[]>("indicators", []);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(false);
  const [showOrderLines, setShowOrderLines] = usePersistedState("show_order_lines", true);
  const [showTradeMarkers, setShowTradeMarkers] = usePersistedState("show_trade_markers", false);
  const [drawingsVisible, setDrawingsVisible] = useState(true);
  const [activeDrawingTool, setActiveDrawingTool] = useState<string | null>(null);
  const { theme } = useTheme();
  const [analysisDataReadyRevision, setAnalysisDataReadyRevision] = useState(0);
  const crosshairPriceRef = useRef<number | null>(null);
  const onCrosshairPriceChangeRef = useRef(onCrosshairPriceChange);
  onCrosshairPriceChangeRef.current = onCrosshairPriceChange;
  const pickModeRef = useRef(pickMode);
  pickModeRef.current = pickMode;
  const pricePrecisionRef = useRef(pricePrecision);
  pricePrecisionRef.current = pricePrecision;

  const activeIndicatorPanes = useRef<Map<string, string | null>>(new Map());

  const scheduleViewportReflow = useCallback((force = false) => {
    if (viewportReflowFrameRef.current != null) {
      window.cancelAnimationFrame(viewportReflowFrameRef.current);
    }

    viewportReflowFrameRef.current = window.requestAnimationFrame(() => {
      viewportReflowFrameRef.current = null;
      const chart = chartRef.current;
      const host = containerRef.current;
      if (!chart || !host) return;

      const bounds = host.getBoundingClientRect();
      const nativeSize = chart.getSize();
      const width = Math.round(bounds.width || nativeSize?.width || 0);
      const height = Math.round(bounds.height || nativeSize?.height || 0);
      if (width <= 0 || height <= 0) return;

      const previous = lastViewportSizeRef.current;
      if (!force && previous.width === width && previous.height === height) return;
      lastViewportSizeRef.current = { width, height };

      chart.resize();
      pointerInteractionRef.current?.invalidate();

      if (viewportPrimeFrameRef.current != null) {
        window.cancelAnimationFrame(viewportPrimeFrameRef.current);
      }
      viewportPrimeFrameRef.current = window.requestAnimationFrame(() => {
        viewportPrimeFrameRef.current = null;
        if (chartRef.current !== chart) return;
        pointerInteractionRef.current?.prime();
      });
    });
  }, []);

  const hasAnalysisVisibleRange = typeof analysisVisibleStartTime === "number"
    && Number.isFinite(analysisVisibleStartTime)
    && typeof analysisVisibleEndTime === "number"
    && Number.isFinite(analysisVisibleEndTime)
    && analysisVisibleEndTime > analysisVisibleStartTime;
  const analysisVisibleCandleCount = hasAnalysisVisibleRange
    ? data.reduce((count, item) => (
        item.time >= analysisVisibleStartTime && item.time <= analysisVisibleEndTime
          ? count + 1
          : count
      ), 0)
    : data.length;

  // Prop-axis signature is stable across the async-commit retry loop (data is
  // unchanged while the native index catches up), so memoize it once instead of
  // rehashing every retry.
  const propTimeAxisSignature = useMemo(
    () => hashTimeAxis(data.length, index => data[index].time),
    [data],
  );

  const centerAnalysisWindow = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || typeof analysisFocusTime !== "number" || !Number.isFinite(analysisFocusTime)) return false;

    chart.scrollToTimestamp(analysisFocusTime, 0);

    const size = chart.getSize();
    const chartWidth = size?.width ?? 0;
    const dataWidth = data.length * chart.getBarSpace();
    const centeredRightOffset = (chartWidth - dataWidth) / 2;
    if (Number.isFinite(centeredRightOffset) && centeredRightOffset > 0) {
      chart.setOffsetRightDistance(centeredRightOffset);
    }
    return true;
  }, [analysisFocusTime, data.length]);

  // Campaign review: keep the complete prefetched dataset, but initially fit only the requested
  // three-part range. Users can then zoom out/pan into the wider prefetched context.
  const fitAnalysisWindow = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return false;
    const size = chart.getSize("candle_pane", DomPosition.Main) ?? chart.getSize();
    const chartWidth = size?.width ?? 0;
    if (chartWidth <= 0 || data.length === 0) return false;

    const fittedCount = analysisVisibleCandleCount > 0 ? analysisVisibleCandleCount : data.length;
    // Bar space that makes the initial range span the viewport (klinecharts clamps to [1, 50]).
    const target = chartWidth / fittedCount;
    const barSpace = Number.isFinite(target) && target > 0 ? Math.min(Math.max(target, 1), 50) : 50;
    chart.setBarSpace(barSpace);

    if (hasAnalysisVisibleRange) {
      chart.setOffsetRightDistance(0);
      const visibleCenterTime = (analysisVisibleStartTime + analysisVisibleEndTime) / 2;
      chart.scrollToTimestamp(visibleCenterTime, 0);

      // KlineCharts aligns scrollToTimestamp with the right edge. Correct that native
      // position in pixels so the campaign (the middle third of the default window)
      // sits at the exact center while candles and annotations keep one time scale.
      const centerPixel = chart.convertToPixel(
        { timestamp: visibleCenterTime },
        { paneId: "candle_pane" },
      );
      const centerX = Array.isArray(centerPixel) ? centerPixel[0]?.x : centerPixel?.x;
      if (typeof centerX === "number" && Number.isFinite(centerX)) {
        const centerCorrection = chartWidth / 2 - centerX;
        if (Math.abs(centerCorrection) > 0.5) {
          chart.scrollByDistance(centerCorrection, 0);
        }
      }
      return true;
    }

    // No explicit range: retain the previous fit-all behavior.
    const dataWidth = data.length * chart.getBarSpace();
    const rightOffset = dataWidth < chartWidth ? (chartWidth - dataWidth) / 2 : 0;
    chart.setOffsetRightDistance(rightOffset);
    return true;
  }, [
    analysisVisibleCandleCount,
    analysisVisibleEndTime,
    analysisVisibleStartTime,
    data.length,
    hasAnalysisVisibleRange,
  ]);

  const applyAnalysisViewport = useCallback(
    () => (analysisFitAll ? fitAnalysisWindow() : centerAnalysisWindow()),
    [analysisFitAll, fitAnalysisWindow, centerAnalysisWindow],
  );

  /**
   * Complete an analysis snapshot only after KlineCharts exposes the exact
   * native time axis requested by React. This is the single lifecycle owner for
   * viewport fitting, annotation revision and pointer re-activation.
   */
  const finalizeAnalysisSnapshot = useCallback(() => {
    const chart = chartRef.current;
    const host = containerRef.current;
    const lifecycle = analysisLifecycleRef.current;
    if (!analysisMode || !chart || !host || !lifecycle.requestedSnapshotKey) return false;

    const nativeData = chart.getDataList();
    const nativeAxisSignature = hashTimeAxis(
      nativeData.length,
      index => nativeData[index].timestamp as number,
    );
    if (nativeAxisSignature !== lifecycle.requestedAxisSignature) return false;

    const snapshotKey = lifecycle.requestedSnapshotKey;
    if (lifecycle.scheduledSnapshotKey === snapshotKey) return true;
    if (lifecycle.settledSnapshotKey === snapshotKey && !lifecycle.needsViewport) return true;

    if (lifecycle.finalizeFrame != null) window.cancelAnimationFrame(lifecycle.finalizeFrame);
    if (lifecycle.primeFrame != null) window.cancelAnimationFrame(lifecycle.primeFrame);
    lifecycle.scheduledSnapshotKey = snapshotKey;
    pointerInteractionRef.current?.invalidate();

    lifecycle.finalizeFrame = window.requestAnimationFrame(() => {
      lifecycle.finalizeFrame = null;
      if (
        chartRef.current !== chart
        || analysisLifecycleRef.current.requestedSnapshotKey !== snapshotKey
      ) return;

      chart.resize();
      if (lifecycle.needsViewport) {
        if (!applyAnalysisViewport()) chart.scrollToRealTime();
        lifecycle.needsViewport = false;
      }
      chart.scrollByDistance(0, 0);
      lifecycle.settledSnapshotKey = snapshotKey;
      lifecycle.scheduledSnapshotKey = "";

      // React rebuilds the timestamp-bound native overlays from this revision.
      setAnalysisDataReadyRevision(revision => revision + 1);

      // Wait one more paint so overlays, pane bounds and hit-test canvases all
      // share the final geometry before restoring first-hover interaction.
      lifecycle.primeFrame = window.requestAnimationFrame(() => {
        lifecycle.primeFrame = null;
        if (
          chartRef.current !== chart
          || analysisLifecycleRef.current.requestedSnapshotKey !== snapshotKey
        ) return;
        pointerInteractionRef.current?.invalidate();
        pointerInteractionRef.current?.prime();
      });
    });
    return true;
  }, [analysisMode, applyAnalysisViewport]);
  analysisCommitFinalizerRef.current = finalizeAnalysisSnapshot;

  // ============================================================
  // Clear overlays on symbol change to prevent cross-symbol pollution
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (prevSymbolRef.current !== symbol) {
      liveUpdateGenerationRef.current += 1;
      liveUpdateQueueRef.current = [];
      liveUpdateInFlightRef.current = false;
      // Wipe all user-drawn overlays from the canvas
      chart.removeOverlay();
      // Reset data tracking refs so applyNewData fires cleanly for the new symbol
      prevDataLenRef.current = 0;
      prevOldestRef.current = 0;
      prevNewestRef.current = 0;
      prevLastSigRef.current = "";
      prevTimeAxisSigRef.current = "";
      prevSymbolRef.current = symbol;
      const lifecycle = analysisLifecycleRef.current;
      lifecycle.requestedAxisSignature = "";
      lifecycle.requestedSnapshotKey = "";
      lifecycle.scheduledSnapshotKey = "";
      lifecycle.settledSnapshotKey = "";
      lifecycle.needsViewport = false;
      pointerInteractionRef.current?.invalidate();
    }
  }, [symbol]);

  // ============================================================
  // Chart creation (once)
  // ============================================================
  useEffect(() => {
    if (!containerRef.current) return;

    // Register custom indicators before chart init to ensure klinecharts knows them
    registerCustomIndicators();
    registerAnalysisBandLabelOverlay();

    const chart = init(containerRef.current, {
      styles: chartStylesForMode(theme, showLastPriceLine),
      timezone,
      decimalFoldThreshold: DECIMAL_FOLD_THRESHOLD,
    });

    if (!chart) return;

    chartRef.current = chart;

    // KlineCharts v9 attaches pointer listeners lazily. Synchronize its pane
    // bounds before the first real hit and repair the stationary-pointer case.
    const pointerInteraction = installKlineChartPointerInteraction(
      containerRef.current,
      () => {
        if (chartRef.current !== chart) return;
        chart.resize();
        chart.scrollByDistance(0, 0);
      },
    );
    pointerInteractionRef.current = pointerInteraction;
    pointerInteraction.prime();
    const interactionFrame = window.requestAnimationFrame(() => {
      if (chartRef.current !== chart || !containerRef.current) return;
      chart.resize();
      pointerInteraction.prime();
    });

    // KLineCharts recalculates indicators asynchronously after updateData. At
    // high replay speeds, concurrent calls can therefore finish out of order
    // and leave the right-axis last-price mark on an older candle. Serialize
    // different timestamps and coalesce repeated updates of the active candle.
    if (chartApiRef) {
      const drainLiveUpdates = () => {
        if (chartRef.current !== chart || liveUpdateInFlightRef.current) return;
        const nextCandle = liveUpdateQueueRef.current.shift();
        if (!nextCandle) return;

        liveUpdateInFlightRef.current = true;
        const generation = liveUpdateGenerationRef.current;
        chart.updateData(nextCandle, () => {
          if (
            chartRef.current !== chart
            || generation !== liveUpdateGenerationRef.current
          ) return;
          liveUpdateInFlightRef.current = false;
          drainLiveUpdates();
        });
      };

      chartApiRef.current = {
        updateData: (candle: KLineData) => {
          const queue = liveUpdateQueueRef.current;
          const lastPending = queue[queue.length - 1];
          if (lastPending?.timestamp === candle.timestamp) {
            queue[queue.length - 1] = candle;
          } else {
            queue.push(candle);
          }
          drainLiveUpdates();
        },
      };
    }

    // ResizeObserver for responsive container sizing
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          scheduleViewportReflow();
        }
      }
    });
    ro.observe(containerRef.current);

    // Subscribe to crosshair for price sync — use pixel-to-value conversion, NOT kline data
    const crosshairCb = (data: any) => {
      const priceChangeHandler = onCrosshairPriceChangeRef.current;
      // Read-only replay/campaign charts do not consume the crosshair price.
      // Avoid a convertFromPixel pass on every mousemove; this is especially
      // costly while KlineCharts holds a large historical index.
      if (!priceChangeHandler && !pickModeRef.current) return;
      try {
        // Only process when mouse is over the main candle pane
        const paneId = data?.paneId;
        if (paneId && paneId !== "candle_pane") {
          // Mouse is over a sub-pane (Volume, MACD etc.) — ignore
          crosshairPriceRef.current = null;
          priceChangeHandler?.(null);
          return;
        }

        // Use convertFromPixel to get precise Y-axis price from pixel coordinate
        if (chart && typeof data?.y === "number") {
          const converted = chart.convertFromPixel([{ y: data.y }], { paneId: "candle_pane" }) as any;
          const result = Array.isArray(converted) ? converted[0] : converted;
          if (result && typeof result.value === "number" && isFinite(result.value)) {
            const rawPrice = result.value;
            // Format to symbol's tick size precision
            const formatted = parseFloat(rawPrice.toFixed(pricePrecisionRef.current));
            crosshairPriceRef.current = formatted;
            priceChangeHandler?.(formatted);
            return;
          }
        }
      } catch {
        // convertFromPixel may not be available in all versions — fallback silently
      }
      crosshairPriceRef.current = null;
      priceChangeHandler?.(null);
    };
    chart.subscribeAction("onCrosshairChange" as any, crosshairCb);
    const dataReadyCb = () => analysisCommitFinalizerRef.current();
    chart.subscribeAction(ActionType.OnDataReady, dataReadyCb);
    const analysisLifecycle = analysisLifecycleRef.current;

    return () => {
      window.cancelAnimationFrame(interactionFrame);
      if (viewportReflowFrameRef.current != null) {
        window.cancelAnimationFrame(viewportReflowFrameRef.current);
        viewportReflowFrameRef.current = null;
      }
      if (viewportPrimeFrameRef.current != null) {
        window.cancelAnimationFrame(viewportPrimeFrameRef.current);
        viewportPrimeFrameRef.current = null;
      }
      if (analysisLifecycle.finalizeFrame != null) {
        window.cancelAnimationFrame(analysisLifecycle.finalizeFrame);
      }
      if (analysisLifecycle.primeFrame != null) {
        window.cancelAnimationFrame(analysisLifecycle.primeFrame);
      }
      pointerInteraction.destroy();
      pointerInteractionRef.current = null;
      ro.disconnect();
      liveUpdateGenerationRef.current += 1;
      liveUpdateQueueRef.current = [];
      liveUpdateInFlightRef.current = false;
      if (chartApiRef) chartApiRef.current = null;
      try {
        chart.unsubscribeAction("onCrosshairChange" as any, crosshairCb);
      } catch {}
      try {
        chart.unsubscribeAction(ActionType.OnDataReady, dataReadyCb);
      } catch {
        // The chart may already have disposed its action store.
      }
      dispose(containerRef.current!);
      chartRef.current = null;
    };
  }, [scheduleViewportReflow]);

  // Fullscreen and multi-pane switches can emit several resize signals in one
  // paint. Route them through the same coalesced scheduler so the native chart
  // applies exactly one settled geometry and never nudges the time axis.
  useEffect(() => {
    if (viewportRevision == null) return;
    scheduleViewportReflow(true);
  }, [scheduleViewportReflow, viewportRevision]);

  // ============================================================
  // Theme reactivity & Tooltip customization
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const baseStyle = chartStylesForMode(theme, showLastPriceLine);

    // Inject custom tooltip formatter to use shorter labels (prevent overlap) and add Price Change Rate
    const styles = {
      ...baseStyle,
      candle: {
        ...baseStyle.candle,
        tooltip: {
          ...baseStyle.candle.tooltip,
          custom: (data: any) => {
            const current = data.current;
            if (!current) return [];

            const prev = data.prev;
            let changePct = 0;
            if (prev && prev.close > 0) {
              changePct = ((current.close - prev.close) / prev.close) * 100;
            }
            const isUp = changePct >= 0;
            const color = isUp ? "#0ECB81" : "#F6465D";
            const sign = isUp ? "+" : "";

            // Format time: YYYY-MM-DD HH:mm
            const d = new Date(current.timestamp);
            const timeStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

            return [
              { title: "时间 ", value: timeStr },
              { title: "开 ", value: current.open.toFixed(pricePrecision) },
              { title: "高 ", value: current.high.toFixed(pricePrecision) },
              { title: "低 ", value: current.low.toFixed(pricePrecision) },
              { title: "收 ", value: current.close.toFixed(pricePrecision) },
              { title: "量 ", value: current.volume.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
              { title: "幅 ", value: { text: `${sign}${changePct.toFixed(2)}%`, color } },
            ];
          },
        },
      },
    };

    chart.setStyles(styles);
  }, [theme, pricePrecision, showLastPriceLine]);

  // ============================================================
  // Price/Volume precision
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setPriceVolumePrecision(pricePrecision, quantityPrecision);
  }, [pricePrecision, quantityPrecision]);

  // ============================================================
  // Feed data to chart when props change (v9 API)
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || data.length === 0) return;

    const klineData = data.map(toKLineData);
    const currentOldest = data[0].time;
    const lastCandle = klineData[klineData.length - 1];
    const lastSig = `${lastCandle.timestamp}|${lastCandle.open}|${lastCandle.high}|${lastCandle.low}|${lastCandle.close}|${lastCandle.volume}`;
    // Analysis windows are static snapshots and can be replaced with corrected
    // historical candles while retaining the same first/last candle. Hash every
    // timestamp so that replacement cannot be mistaken for a last-bar update,
    // without paying an O(n) string join on large historical snapshots.
    const timeAxisSig = analysisMode ? propTimeAxisSignature : "";
    const sameTimeAxis = !analysisMode || timeAxisSig === prevTimeAxisSigRef.current;

    const wasPrepend =
      prevDataLenRef.current > 0 &&
      data.length > prevDataLenRef.current &&
      currentOldest < prevOldestRef.current &&
      lastCandle.timestamp === prevNewestRef.current;
    const isSmallAppend =
      data.length > prevDataLenRef.current &&
      data.length - prevDataLenRef.current <= 2 &&
      currentOldest === prevOldestRef.current;
    const isSameBarUpdate =
      data.length === prevDataLenRef.current &&
      currentOldest === prevOldestRef.current &&
      lastCandle.timestamp === prevNewestRef.current &&
      sameTimeAxis;

    const unchangedSnapshot =
      data.length === prevDataLenRef.current &&
      currentOldest === prevOldestRef.current &&
      lastSig === prevLastSigRef.current &&
      sameTimeAxis;

    if (unchangedSnapshot) return;

    const needsFit = prevDataLenRef.current === 0 || (!wasPrepend && !isSmallAppend && !isSameBarUpdate);
    if (analysisMode) {
      const lifecycle = analysisLifecycleRef.current;
      lifecycle.requestedAxisSignature = timeAxisSig;
      lifecycle.requestedSnapshotKey = `${timeAxisSig}|${lastSig}`;
      lifecycle.needsViewport = lifecycle.needsViewport || needsFit;
      lifecycle.scheduledSnapshotKey = "";
      pointerInteractionRef.current?.invalidate();
    }

    if (wasPrepend) {
      // Older data prepended — feed older portion via applyMoreData
      const newCount = data.length - prevDataLenRef.current;
      const olderData = klineData.slice(0, newCount);
      chart.applyMoreData(olderData, true);
    } else if (prevDataLenRef.current === 0) {
      // Initial load
      chart.applyNewData(klineData, true);
    } else if (isSmallAppend) {
      // The main replay chart is already updated by its imperative loop. A
      // second prop-driven update would race the async indicator calculation
      // and can restore a stale right-axis price.
      if (!chartApiRef) chart.updateData(lastCandle);
    } else if (isSameBarUpdate) {
      // Same bar evolving: only update last candle to keep crosshair/interaction state stable
      if (!chartApiRef) chart.updateData(lastCandle);
    } else {
      // Data replaced (symbol/interval/window replacement)
      chart.applyNewData(klineData, true);
    }

    prevDataLenRef.current = data.length;
    prevOldestRef.current = currentOldest;
    prevNewestRef.current = lastCandle.timestamp as number;
    prevLastSigRef.current = lastSig;
    prevTimeAxisSigRef.current = timeAxisSig;
    if (analysisMode) analysisCommitFinalizerRef.current();
  }, [analysisMode, data, propTimeAxisSignature]);

  // Range presets (1.1x / 2x / ... / 51x) deliberately reuse the same complete
  // K-line snapshot. A range-only change therefore never enters the data-feed
  // branch above. Request a viewport pass explicitly so the preset changes bar
  // space and centering without replacing data or rebuilding annotations.
  useEffect(() => {
    if (!analysisMode || !analysisFitAll || !hasAnalysisVisibleRange) return;
    const lifecycle = analysisLifecycleRef.current;
    if (!chartRef.current || !lifecycle.requestedSnapshotKey) return;

    lifecycle.needsViewport = true;
    lifecycle.scheduledSnapshotKey = "";
    pointerInteractionRef.current?.invalidate();
    analysisCommitFinalizerRef.current();
  }, [
    analysisFitAll,
    analysisMode,
    analysisVisibleEndTime,
    analysisVisibleStartTime,
    hasAnalysisVisibleRange,
  ]);

  // ============================================================
  // TRADE MARKERS — data-driven: clear all then redraw from tradeHistory
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Step 1: Atomic clear — always remove old markers first
    try {
      chart.removeOverlay("trade_markers");
    } catch {}

    // Step 2: If hidden or no data, stop after clearing
    if (!showTradeMarkers || !tradeHistory || !rawSymbol || data.length === 0) return;

    // Step 3: Redraw from single source of truth (tradeHistory)
    const symbolTrades = tradeHistory.filter((t) => t.symbol === rawSymbol);
    for (const trade of symbolTrades) {
      const ts = trade.action === "OPEN" ? trade.openTime : trade.closeTime;
      if (ts <= 0) continue;
      const isBuy =
        (trade.action === "OPEN" && trade.side === "LONG") || (trade.action === "CLOSE" && trade.side === "SHORT");
      const price = trade.action === "OPEN" ? trade.entryPrice : trade.exitPrice;

      // Financial semantics: Buy=green below candle, Sell=red above candle
      const color = isBuy ? "#0ECB81" : "#F6465D";
      const label = isBuy ? "▲ B" : "▼ S";
      // Offset: buy markers below price, sell markers above price
      const offset = isBuy ? -8 : 8;

      chart.createOverlay({
        name: "simpleAnnotation",
        id: "trade_markers",
        points: [{ timestamp: ts, value: price }],
        lock: true,
        extendData: label,
        styles: {
          text: {
            color: "#FFFFFF",
            size: 10,
            borderColor: color,
            backgroundColor: color,
            borderRadius: 2,
            paddingLeft: 3,
            paddingRight: 3,
            paddingTop: 1,
            paddingBottom: 1,
          },
          point: {
            color: color,
          },
        },
      } as OverlayCreate);
    }
  }, [tradeHistory, rawSymbol, data, showTradeMarkers]);

  // ============================================================
  // PENDING ORDER LINES on chart
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Always clear previous order line overlays
    try {
      chart.removeOverlay("order_lines");
    } catch {}

    if (!showOrderLines || !pendingOrders || pendingOrders.length === 0 || data.length === 0) return;

    const lastTime = data[data.length - 1].time;

    for (const order of pendingOrders) {
      const displayPrice = order.price > 0 ? order.price : order.stopPrice;
      if (displayPrice <= 0) continue;

      const isLong = order.side === "LONG";
      const typeLabel =
        order.type === "LIMIT" || order.type === "POST_ONLY"
          ? isLong
            ? "Limit Buy"
            : "Limit Sell"
          : order.type === "MARKET_TP_SL" || order.type === "LIMIT_TP_SL"
            ? isLong
              ? "TP/SL Buy"
              : "TP/SL Sell"
            : order.type === "CONDITIONAL"
              ? isLong
                ? "Cond Buy"
                : "Cond Sell"
              : order.type === "TRAILING_STOP"
                ? isLong
                  ? "Trail Buy"
                  : "Trail Sell"
                : isLong
                  ? "Buy"
                  : "Sell";

      chart.createOverlay({
        name: "horizontalStraightLine",
        id: "order_lines",
        points: [{ timestamp: lastTime, value: displayPrice }],
        lock: true,
        styles: {
          line: {
            style: "dashed" as any,
            dashedValue: [6, 4],
            size: 1,
            color: isLong ? "#0ECB8180" : "#F6465D80",
          },
          text: {
            color: isLong ? "#0ECB81" : "#F6465D",
            size: 10,
            borderColor: isLong ? "#0ECB8140" : "#F6465D40",
            backgroundColor: isLong ? "#0ECB8118" : "#F6465D18",
          },
        },
        extendData: `${typeLabel} ${order.quantity.toFixed(4)} @ ${displayPrice.toFixed(pricePrecision)}`,
      } as OverlayCreate);

      // If there's also a stopPrice different from price (e.g. TP/SL orders), draw trigger line
      if (order.stopPrice > 0 && order.price > 0 && order.stopPrice !== order.price) {
        chart.createOverlay({
          name: "horizontalStraightLine",
          id: "order_lines",
          points: [{ timestamp: lastTime, value: order.stopPrice }],
          lock: true,
          styles: {
            line: {
              style: "dashed" as any,
              dashedValue: [3, 3],
              size: 1,
              color: "#F0B90B60",
            },
            text: {
              color: "#F0B90B",
              size: 9,
              borderColor: "#F0B90B40",
              backgroundColor: "#F0B90B18",
            },
          },
          extendData: `Trigger @ ${order.stopPrice.toFixed(pricePrecision)}`,
        } as OverlayCreate);
      }
    }
  }, [pendingOrders, showOrderLines, data, pricePrecision]);

  // ============================================================
  // ANALYSIS / REPLAY ANNOTATIONS — read-only overlays for review surfaces
  // ============================================================
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Invalidate pending native-axis retries before clearing the old layer.
    const runId = ++analysisOverlayRunRef.current;

    for (const overlayId of analysisOverlayIdsRef.current) {
      try {
        chart.removeOverlay(overlayId);
      } catch {
        // It may already have been removed by a chart reset.
      }
    }
    analysisOverlayIdsRef.current = [];
    try {
      // IDs returned by KlineCharts are not guaranteed to match caller-supplied IDs in
      // every reset path. Group removal is the authoritative, atomic cleanup and removes
      // markers, vertical lines and bounded price lines together.
      chart.removeOverlay({ groupId: ANALYSIS_ANNOTATION_GROUP_ID });
    } catch {}
    if (!analysisAnnotations || data.length === 0) return;

    const nextOverlayIds: string[] = [];
    const floatingLabelCandidates: AnalysisFloatingLabelCandidate[] = [];
    const createAnalysisOverlay = (key: string, overlay: OverlayCreate) => {
      const id = `analysis_annotations_${runId}_${nextOverlayIds.length}_${key}`;
      const createdId = chart.createOverlay({
        ...overlay,
        id,
        groupId: ANALYSIS_ANNOTATION_GROUP_ID,
        paneId: "candle_pane",
      } as OverlayCreate);
      const overlayId = typeof createdId === "string" ? createdId : id;
      nextOverlayIds.push(overlayId);
      return overlayId;
    };

    // Use the chart engine's committed data list as the single time-coordinate
    // authority. Every line, marker and label binds to these exact timestamps.
    const nativeData = chart.getDataList();
    const propTimeAxisSig = propTimeAxisSignature;
    const nativeTimeAxisSig = hashTimeAxis(nativeData.length, index => nativeData[index].timestamp as number);
    if (
      nativeData.length === 0
      || nativeData.length !== data.length
      || nativeTimeAxisSig !== propTimeAxisSig
    ) {
      // Large legacy snapshots are committed asynchronously by KlineCharts. Never
      // create timestamp overlays against an empty or stale native index: doing so
      // makes the engine cache a screen position and is the reason some historical
      // campaigns could move their labels independently from their candles.
      // The authoritative OnDataReady lifecycle will rerun this effect after
      // the native axis matches. Frame-by-frame polling made large legacy
      // campaigns contend with pointer and canvas work for up to two seconds.
      return;
    }
    const newestNative = nativeData[nativeData.length - 1];
    const newest = { time: newestNative.timestamp, close: newestNative.close };
    const inferredInterval = nativeData.length > 1
      ? Math.max(0, newest.time - nativeData[nativeData.length - 2].timestamp)
      : 0;
    const minTime = nativeData[0].timestamp;
    const maxTime = newest.time + inferredInterval;
    const lastValue = newest.close;
    const formatPrice = (value: number) => value.toFixed(pricePrecision);
    const clampTime = (time: number) => Math.min(Math.max(time, minTime), maxTime);
    const bindTimeToCandle = (time: number) => {
      const target = clampTime(time);
      let low = 0;
      let high = nativeData.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (nativeData[middle].timestamp < target) low = middle + 1;
        else high = middle;
      }
      const rightIndex = low;
      const leftIndex = Math.max(0, rightIndex - 1);
      const dataIndex = Math.abs(nativeData[leftIndex].timestamp - target) <= Math.abs(nativeData[rightIndex].timestamp - target)
        ? leftIndex
        : rightIndex;
      return nativeData[dataIndex].timestamp;
    };
    const visibleMarkerCandidates = (analysisAnnotations.markers ?? []).filter(
      (m) => Number.isFinite(m.price) && m.time >= minTime && m.time <= maxTime,
    ).map(marker => ({ ...marker, time: bindTimeToCandle(marker.time) }));
    const visibleMarkerLabelTimes = new Set(
      visibleMarkerCandidates
        .filter((marker) => !!marker.label)
        .map((marker) => marker.time),
    );
    const floatingLabelKeys = new Set<string>();
    const addFloatingLabel = (
      id: string,
      time: number,
      text: string | undefined,
      color: string,
      emphasis?: AnalysisFloatingLabelCandidate["emphasis"],
    ) => {
      if (!text || !Number.isFinite(time)) return;
      const labelTime = bindTimeToCandle(time);
      const normalizedText = text.trim();
      const labelKey = `${Math.round(labelTime / 1000)}:${normalizedText}:${emphasis ?? ""}`;
      if (floatingLabelKeys.has(labelKey)) return;
      floatingLabelKeys.add(labelKey);
      floatingLabelCandidates.push({
        id: `${floatingLabelCandidates.length}-${id}`,
        time: labelTime,
        text: normalizedText,
        color,
        emphasis,
      });
    };
    const timePriceEventVerticalKeys = new Set<string>();
    for (const line of analysisAnnotations.priceLines ?? []) {
      if (!Number.isFinite(line.price)) continue;
      createAnalysisOverlay("price", {
        name: "horizontalStraightLine",
        points: [{ timestamp: newest.time, value: line.price }],
        lock: true,
        styles: {
          line: {
            style: LineType.Dashed,
            dashedValue: [6, 4],
            size: 1,
            color: line.dim ? `${line.color}55` : line.color,
          },
          text: {
            color: line.dim ? `${line.color}88` : line.color,
            size: 10,
            borderColor: `${line.color}40`,
            backgroundColor: `${line.color}18`,
          },
        },
        extendData: line.title ? `${line.title} ${formatPrice(line.price)}` : formatPrice(line.price),
      } as OverlayCreate);
    }

    for (const line of analysisAnnotations.timeBoundPriceLines ?? []) {
      if (!Number.isFinite(line.price)) continue;
      const startTime = bindTimeToCandle(line.startTime);
      const endTime = bindTimeToCandle(line.endTime);
      if (endTime <= startTime) continue;
      const color = line.dim ? `${line.color}55` : line.color;

      createAnalysisOverlay("time-price", {
        name: "segment",
        points: [
          { timestamp: startTime, value: line.price },
          { timestamp: endTime, value: line.price },
        ],
        lock: true,
        styles: {
          line: {
            style: line.dashed ? LineType.Dashed : LineType.Solid,
            dashedValue: [5, 4],
            size: 1,
            color,
          },
        },
      } as OverlayCreate);

      if (line.title === "委托空") {
        const startVerticalKey = `${line.title}:${Math.round(startTime / 1000)}`;
        if (!timePriceEventVerticalKeys.has(startVerticalKey)) {
          timePriceEventVerticalKeys.add(startVerticalKey);
          createAnalysisOverlay("time-price-start", {
            name: "verticalStraightLine",
            points: [{ timestamp: startTime, value: line.price }],
            lock: true,
            styles: {
              line: {
                style: LineType.Dashed,
                dashedValue: [2, 3],
                size: 0.75,
                color: `${line.color}66`,
              },
            },
          } as OverlayCreate);
        }

        if (line.endMarker === "x") {
          const cancelVerticalKey = `${line.title}:cancel:${Math.round(endTime / 1000)}`;
          if (!timePriceEventVerticalKeys.has(cancelVerticalKey)) {
            timePriceEventVerticalKeys.add(cancelVerticalKey);
            createAnalysisOverlay("time-price-cancel", {
              name: "verticalStraightLine",
              points: [{ timestamp: endTime, value: line.price }],
              lock: true,
              styles: {
                line: {
                  style: LineType.Dashed,
                  dashedValue: [2, 3],
                  size: 0.75,
                  color: `${line.color}88`,
                },
              },
            } as OverlayCreate);
          }
          addFloatingLabel(`time-price-cancel-${endTime}-${line.price}`, endTime, "×", line.color);
        }
      }

      if (line.title) {
        addFloatingLabel(`time-price-${startTime}-${line.price}-${line.title}`, startTime, line.title, line.color);
      }

    }

    for (const vertical of analysisAnnotations.verticalLines ?? []) {
      if (!Number.isFinite(vertical.time)) continue;
      if (!vertical.alwaysVisible && (vertical.time < minTime || vertical.time > maxTime)) continue;
      const verticalTime = bindTimeToCandle(vertical.time);
      createAnalysisOverlay("vertical", {
        name: "verticalStraightLine",
        points: [{ timestamp: verticalTime, value: lastValue }],
        lock: true,
        styles: {
          line: {
            style: (vertical.dashed ?? true) ? LineType.Dashed : LineType.Solid,
            dashedValue: [3, 3],
            size: vertical.width ?? 1,
            color: vertical.color,
          },
        },
      } as OverlayCreate);

      if (vertical.label && !visibleMarkerLabelTimes.has(verticalTime)) {
        addFloatingLabel(
          `vertical-${verticalTime}-${vertical.label}`,
          verticalTime,
          vertical.label,
          vertical.labelColor ?? vertical.color,
          vertical.label.includes("加仓") ? "main-add" : undefined,
        );
      }
    }

    // Same-time event labels are laid out in a fixed pixel band below; keep the
    // tiny glyphs anchored to their exact prices. Do not nudge marker values for
    // overlap avoidance, because these anchors are used to audit fill prices.
    const visibleMarkers = visibleMarkerCandidates;
    for (const marker of visibleMarkers) {
      const glyph =
        marker.shape === "triangle-up" ? "▲" :
        marker.shape === "triangle-down" ? "▼" :
        marker.shape === "square" ? "■" :
        "●";
      const isMainAddMarker = isMainAddLabel(marker.label);
      const markerColor = isMainAddMarker ? strengthenAnalysisColor(marker.color) : marker.color;

      addFloatingLabel(
        `marker-${marker.time}-${marker.price}-${marker.label ?? glyph}`,
        marker.time,
        marker.label ? `${glyph} ${marker.label}` : glyph,
        markerColor,
        isMainAddMarker ? "main-add" : undefined,
      );

      createAnalysisOverlay("marker", {
        name: "simpleAnnotation",
        points: [{ timestamp: marker.time, value: marker.price }],
        lock: true,
        extendData: glyph,
        styles: {
          text: {
            color: "#FFFFFF",
            size: isMainAddMarker ? 10 : 8,
            borderColor: `${markerColor}70`,
            backgroundColor: markerColor,
            borderRadius: 2,
            paddingLeft: 2,
            paddingRight: 2,
            paddingTop: 1,
            paddingBottom: 1,
          },
          point: { color: markerColor },
        },
      } as OverlayCreate);
    }
    if (floatingLabelCandidates.length > 0) {
      createAnalysisOverlay("band-labels", {
        name: ANALYSIS_BAND_LABEL_OVERLAY,
        points: floatingLabelCandidates.map(label => ({
          timestamp: label.time,
          value: lastValue,
        })),
        lock: true,
        zLevel: 20,
        extendData: {
          labels: floatingLabelCandidates,
          theme,
        } satisfies AnalysisBandLabelOverlayData,
      } as OverlayCreate);
    }
    analysisOverlayIdsRef.current = nextOverlayIds;

    return () => {
      if (analysisOverlayRunRef.current === runId) {
        try {
          chart.removeOverlay({ groupId: ANALYSIS_ANNOTATION_GROUP_ID });
        } catch {}
        analysisOverlayIdsRef.current = [];
      }
    };
  }, [analysisAnnotations, data, pricePrecision, analysisDataReadyRevision, theme, propTimeAxisSignature]);

  // Campaign What-if: draggable horizontal price lines and vertical timing lines.
  // Drag a price line up/down or a time line left/right, then report the new value on release.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    for (const id of dragOverlayIdsRef.current) {
      try { chart.removeOverlay(id); } catch {}
    }
    dragOverlayIdsRef.current = [];
    const priceLines = draggablePriceLines ?? [];
    const verticalLines = draggableVerticalLines ?? [];
    if ((priceLines.length === 0 && verticalLines.length === 0) || data.length === 0) return;

    const newest = data[data.length - 1];
    const lastValue = newest.close;
    const minTime = data[0].time;
    const inferredInterval = data.length > 1 ? Math.max(0, newest.time - data[data.length - 2].time) : 0;
    const maxTime = newest.time + inferredInterval;
    // Loop, not Math.min(...data.map()): spreading a large historical window as
    // function args is both slow and can overflow the argument-count limit.
    let visibleLow = Infinity;
    let visibleHigh = -Infinity;
    for (let index = 0; index < data.length; index += 1) {
      const item = data[index];
      if (item.low < visibleLow) visibleLow = item.low;
      if (item.high > visibleHigh) visibleHigh = item.high;
    }
    const visibleRange = Math.max(visibleHigh - visibleLow, Math.abs(visibleHigh) * 0.0001, 1);
    const verticalLabelValue = visibleLow + visibleRange * 0.025;
    const ids: string[] = [];
    for (const line of priceLines) {
      if (!Number.isFinite(line.price)) continue;
      const id = `whatif_drag_${line.id}`;
      chart.createOverlay({
        id,
        name: "horizontalStraightLine",
        paneId: "candle_pane",
        points: [{ timestamp: newest.time, value: line.price }],
        lock: false,
        styles: {
          line: { style: LineType.Dashed, dashedValue: [4, 4], size: 1.5, color: line.color },
          text: {
            color: "#FFFFFF",
            size: 10,
            borderColor: `${line.color}60`,
            backgroundColor: line.color,
            borderRadius: 2,
            paddingLeft: 3,
            paddingRight: 3,
            paddingTop: 1,
            paddingBottom: 1,
          },
        },
        extendData: line.label ?? "",
        onPressedMoveEnd: (event: { overlay?: { points?: Array<{ value?: number }> } }) => {
          const next = event?.overlay?.points?.[0]?.value;
          if (typeof next === "number" && Number.isFinite(next)) {
            onDragPriceLineRef.current?.(line.id, next);
          }
          return false;
        },
      } as OverlayCreate);
      ids.push(id);
    }
    for (const line of verticalLines) {
      if (!Number.isFinite(line.time)) continue;
      if (line.time < minTime || line.time > maxTime) continue;
      const id = `whatif_drag_time_${line.id}`;
      const isSelected = line.selected === true;
      const lineSize = (line.width ?? 0.85) + (isSelected ? 0.75 : 0);
      chart.createOverlay({
        id,
        name: "verticalStraightLine",
        paneId: "candle_pane",
        points: [{ timestamp: line.time, value: lastValue }],
        lock: false,
        styles: {
          line: {
            style: line.dashed ? LineType.Dashed : LineType.Solid,
            dashedValue: isSelected ? [4, 3] : [3, 3],
            size: lineSize,
            color: line.color,
          },
        },
        extendData: "",
        onClick: () => {
          onSelectVerticalLineRef.current?.(line.id);
          return false;
        },
        onPressedMoveStart: () => {
          onSelectVerticalLineRef.current?.(line.id);
          return false;
        },
        onSelected: () => {
          onSelectVerticalLineRef.current?.(line.id);
          return false;
        },
        onPressedMoveEnd: (event: { overlay?: { points?: Array<{ timestamp?: number }> } }) => {
          onSelectVerticalLineRef.current?.(line.id);
          const next = event?.overlay?.points?.[0]?.timestamp;
          if (typeof next === "number" && Number.isFinite(next)) {
            onDragVerticalLineRef.current?.(line.id, next);
          }
          return false;
        },
      } as OverlayCreate);
      ids.push(id);

      if (line.label) {
        const labelId = `whatif_drag_label_${line.id}`;
        chart.createOverlay({
          id: labelId,
          name: "simpleAnnotation",
          paneId: "candle_pane",
          points: [{ timestamp: line.time, value: verticalLabelValue }],
          lock: true,
          extendData: line.label,
          styles: {
            text: {
              color: line.labelColor ?? line.color,
              size: isSelected ? 8 : 7,
              borderColor: isSelected ? `${line.color}66` : "rgba(132, 142, 156, 0.14)",
              backgroundColor: isSelected ? `${line.color}1F` : "rgba(11, 14, 17, 0.26)",
              borderRadius: 2,
              paddingLeft: 2,
              paddingRight: 2,
              paddingTop: 1,
              paddingBottom: 1,
            },
            point: { color: "rgba(0,0,0,0)" },
          },
        } as OverlayCreate);
        ids.push(labelId);
      }
    }
    dragOverlayIdsRef.current = ids;
  }, [draggablePriceLines, draggableVerticalLines, data]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const currentActive = new Set<string>();

    for (const ind of indicators) {
      if (!ind.enabled) continue;
      currentActive.add(ind.type);

      const isOverlay = OVERLAY_INDICATOR_IDS.has(ind.type);
      // Determine the klinecharts indicator name: mapped, or fallback
      let kcName = KLINE_INDICATOR_MAP[ind.type];
      if (!kcName) {
        kcName = isOverlay ? "FALLBACK_OVERLAY" : "FALLBACK_OSCILLATOR";
      }

      if (!activeIndicatorPanes.current.has(ind.type)) {
        try {
          const paneId = chart.createIndicator(
            { name: kcName, calcParams: [ind.period] },
            isOverlay,
            isOverlay ? { id: "candle_pane" } : { height: 80 },
          );
          activeIndicatorPanes.current.set(ind.type, paneId);
        } catch (e) {
          console.warn(`Failed to create indicator ${ind.type}:`, e);
        }
      } else {
        try {
          chart.overrideIndicator({ name: kcName, calcParams: [ind.period] });
        } catch {}
      }
    }

    // Remove indicators that are no longer active
    for (const [type, paneId] of activeIndicatorPanes.current.entries()) {
      if (!currentActive.has(type)) {
        try {
          const isOverlay = OVERLAY_INDICATOR_IDS.has(type);
          let kcName = KLINE_INDICATOR_MAP[type];
          if (!kcName) kcName = isOverlay ? "FALLBACK_OVERLAY" : "FALLBACK_OSCILLATOR";
          if (paneId) {
            chart.removeIndicator(paneId, kcName);
          }
        } catch {}
        activeIndicatorPanes.current.delete(type);
      }
    }
  }, [indicators]);

  // ============================================================
  // Drawing tool activation — binds to klinecharts overlay API
  // ============================================================
  const stayInDrawingRef = useRef(false);

  const handleToolChange = useCallback((tool: string | null, opts?: { stayInDrawing?: boolean }) => {
    setActiveDrawingTool(tool);
    if (opts?.stayInDrawing !== undefined) stayInDrawingRef.current = opts.stayInDrawing;
    const chart = chartRef.current;
    if (!chart) return;

    if (!tool) {
      // Exiting drawing mode — remove any in-progress (unfinished) overlay
      // klinecharts auto-cleans unfinished overlays when we don't create a new one
      return;
    }

    const overlayName = OVERLAY_MAP[tool];
    if (overlayName) {
      chart.createOverlay({
        name: overlayName,
        mode: "weak_magnet",
        onDrawEnd: () => {
          // Auto-reset tool after drawing completes (unless stay-in-drawing mode)
          if (!stayInDrawingRef.current) {
            setActiveDrawingTool(null);
          } else {
            // In stay mode, immediately start a new overlay of the same type
            setTimeout(() => {
              const c = chartRef.current;
              if (c && overlayName) {
                c.createOverlay({
                  name: overlayName,
                  mode: "weak_magnet",
                  onDrawEnd: () => {
                    if (!stayInDrawingRef.current) setActiveDrawingTool(null);
                  },
                } as any);
              }
            }, 50);
          }
        },
      } as any);
    }
  }, []);

  const handleClearDrawings = useCallback(() => {
    const chart = chartRef.current;
    if (chart) {
      chart.removeOverlay();
      setActiveDrawingTool(null);
    }
  }, []);

  const handleToggleDrawingsVisible = useCallback(() => {
    setDrawingsVisible((prev) => {
      const newVal = !prev;
      const chart = chartRef.current;
      if (chart) {
        chart.overrideOverlay({ visible: newVal });
      }
      return newVal;
    });
  }, []);

  // ============================================================
  // ESC key & right-click to cancel drawing mode
  // ============================================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && activeDrawingTool) {
        const chart = chartRef.current;
        if (chart) {
          // Remove any in-progress overlay by creating nothing
          chart.removeOverlay();
          // Re-add completed trade markers / order lines will re-render via effects
        }
        setActiveDrawingTool(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeDrawingTool]);

  // Right-click on chart cancels drawing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      if (activeDrawingTool) {
        e.preventDefault();
        setActiveDrawingTool(null);
      }
    };
    el.addEventListener("contextmenu", handler);
    return () => el.removeEventListener("contextmenu", handler);
  }, [activeDrawingTool]);

  // Pick mode: click on chart to pick crosshair price
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pickMode) return;
    const handler = () => {
      if (crosshairPriceRef.current != null && onPricePicked) {
        onPricePicked(crosshairPriceRef.current);
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [pickMode, onPricePicked]);

  // ============================================================
  // Price info — header moved to global TickerBar
  // ============================================================

  return (
    <div className="flex flex-col h-full bg-card">
      {loadingOlder && (
        <div className="absolute top-1 left-1/2 -translate-x-1/2 z-30 text-[10px] text-primary animate-pulse font-mono px-2 py-0.5 rounded bg-card/80 border border-border/50">
          加载更早数据...
        </div>
      )}

      {/* Chart area with toolbar */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{
            left: analysisMode ? 0 : 34,
            backgroundColor: theme === "light" ? "#FFFFFF" : "#1E2329",
            cursor: activeDrawingTool || pickMode ? "crosshair" : "default",
          }}
        />

        {!analysisMode && (
          <DrawingToolbar
            activeTool={activeDrawingTool}
            onToolChange={handleToolChange}
            onClearDrawings={handleClearDrawings}
            drawingsVisible={drawingsVisible}
            onToggleDrawingsVisible={handleToggleDrawingsVisible}
          />
        )}

        {/* Right side: indicator buttons */}
        <div className="absolute right-12 top-0 z-10 flex items-center gap-2 py-1.5 px-2 max-w-[60%] overflow-visible">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setShowIndicatorPanel((prev) => !prev);
            }}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-150 ease-out origin-top active:scale-[0.98] ${
              showIndicatorPanel
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>指标</span>
          </button>

          {!analysisMode && (
            <>
              {/* Show order lines toggle */}
              <button
                type="button"
                onClick={() => setShowOrderLines((prev) => !prev)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors duration-150 ease-out active:scale-[0.98] ${
                  showOrderLines
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
                title={showOrderLines ? "隐藏挂单线" : "显示挂单线"}
              >
                <ListOrdered className="w-3.5 h-3.5" />
                <span>挂单</span>
              </button>

              {/* Show/hide trade markers toggle */}
              <button
                type="button"
                onClick={() => setShowTradeMarkers((prev) => !prev)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors duration-150 ease-out active:scale-[0.98] ${
                  showTradeMarkers
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                }`}
                title={showTradeMarkers ? "隐藏交易标记" : "显示交易标记"}
              >
                {showTradeMarkers ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>标记</span>
              </button>
            </>
          )}

          <div className="flex items-center gap-1 max-w-full overflow-x-auto">
            {indicators.map((ind) => (
              <span
                key={ind.type}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-medium whitespace-nowrap shrink-0"
                style={{ background: `${ind.color}20`, color: ind.color }}
              >
                {ind.type} {ind.period}
                <button
                  type="button"
                  onClick={() => setIndicators(indicators.filter((i) => i.type !== ind.type))}
                  className="hover:opacity-70"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>

          <IndicatorMenu
            open={showIndicatorPanel}
            onClose={() => setShowIndicatorPanel(false)}
            indicators={indicators}
            onIndicatorsChange={setIndicators}
          />
        </div>
      </div>
    </div>
  );
}

function areChartPropsEqual(prev: Props, next: Props) {
  const prevLen = prev.data.length;
  const nextLen = next.data.length;

  const prevFirst = prevLen > 0 ? prev.data[0].time : 0;
  const nextFirst = nextLen > 0 ? next.data[0].time : 0;
  const prevLast = prevLen > 0 ? prev.data[prevLen - 1] : null;
  const nextLast = nextLen > 0 ? next.data[nextLen - 1] : null;

  const sameDataShape = (prev.analysisMode || next.analysisMode)
    ? prev.data === next.data
    : prevLen === nextLen &&
      prevFirst === nextFirst &&
      (prevLast?.time ?? 0) === (nextLast?.time ?? 0) &&
      (prevLast?.open ?? 0) === (nextLast?.open ?? 0) &&
      (prevLast?.high ?? 0) === (nextLast?.high ?? 0) &&
      (prevLast?.low ?? 0) === (nextLast?.low ?? 0) &&
      (prevLast?.close ?? 0) === (nextLast?.close ?? 0) &&
      (prevLast?.volume ?? 0) === (nextLast?.volume ?? 0);

  return (
    sameDataShape &&
    prev.symbol === next.symbol &&
    prev.viewportRevision === next.viewportRevision &&
    prev.loadingOlder === next.loadingOlder &&
    prev.rawSymbol === next.rawSymbol &&
    prev.pricePrecision === next.pricePrecision &&
    prev.quantityPrecision === next.quantityPrecision &&
    prev.tradeHistory === next.tradeHistory &&
    prev.onLoadOlder === next.onLoadOlder &&
    prev.pendingOrders === next.pendingOrders &&
    prev.onCancelOrder === next.onCancelOrder &&
    prev.onCrosshairPriceChange === next.onCrosshairPriceChange &&
    prev.pickMode === next.pickMode &&
    prev.onPricePicked === next.onPricePicked &&
    prev.analysisMode === next.analysisMode &&
    prev.analysisAnnotations === next.analysisAnnotations &&
    prev.analysisFocusTime === next.analysisFocusTime &&
    prev.analysisFitAll === next.analysisFitAll &&
    prev.analysisVisibleStartTime === next.analysisVisibleStartTime &&
    prev.analysisVisibleEndTime === next.analysisVisibleEndTime &&
    prev.draggablePriceLines === next.draggablePriceLines &&
    prev.onDragPriceLine === next.onDragPriceLine &&
    prev.draggableVerticalLines === next.draggableVerticalLines &&
    prev.onDragVerticalLine === next.onDragVerticalLine &&
    prev.onSelectVerticalLine === next.onSelectVerticalLine &&
    prev.timezone === next.timezone
  );
}

export const CandlestickChart = memo(CandlestickChartComponent, areChartPropsEqual);
export default CandlestickChart;
