import { useState, useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { ChartImperativeApi } from "./CandlestickChart";
import { CandlestickChart } from "./CandlestickChart";
import { TimeframeSelector } from "./TimeframeSelector";
import { LayoutGrid, Columns, Square, Maximize2, Minimize2, Clock3, Gauge, ChevronDown } from "lucide-react";
import type { KlineData } from "@/hooks/useBinanceData";
import type { TradeRecord, PendingOrder } from "@/types/trading";

type LayoutMode = "1x1" | "1x2" | "2x2";

const INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"];
const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60, 180, 300, 900];
const FULLSCREEN_SESSION_KEY = "veil.mainChart.fullscreen";

const readFullscreenSession = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(FULLSCREEN_SESSION_KEY) === "1";
  } catch {
    return false;
  }
};

const writeFullscreenSession = (active: boolean) => {
  if (typeof window === "undefined") return;
  try {
    if (active) {
      window.sessionStorage.setItem(FULLSCREEN_SESSION_KEY, "1");
    } else {
      window.sessionStorage.removeItem(FULLSCREEN_SESSION_KEY);
    }
  } catch {
    // Fullscreen still works when browser storage is unavailable.
  }
};

interface Props {
  mainData: KlineData[];
  mainSymbol: string;
  rawSymbol: string;
  onLoadOlder: () => void;
  loadingOlder: boolean;
  tradeHistory: TradeRecord[];
  isRunning: boolean;
  currentSimulatedTime: number;
  mainInterval: string;
  onMainIntervalChange?: (interval: string) => void;
  speed?: number;
  onSetSpeed?: (speed: number) => void;
  pricePrecision?: number;
  quantityPrecision?: number;
  pendingOrders?: PendingOrder[];
  onCancelOrder?: (orderId: string) => void;
  chartApiRef?: MutableRefObject<ChartImperativeApi | null>;
  onCrosshairPriceChange?: (price: number | null) => void;
  pickMode?: boolean;
  onPricePicked?: (price: number) => void;
}

interface SubChart {
  interval: string;
  data: KlineData[];
  loading: boolean;
}

export function MultiChartLayout({
  mainData,
  mainSymbol,
  rawSymbol,
  onLoadOlder,
  loadingOlder,
  tradeHistory,
  isRunning,
  currentSimulatedTime,
  mainInterval,
  onMainIntervalChange,
  speed = 1,
  onSetSpeed,
  pricePrecision,
  quantityPrecision,
  pendingOrders,
  onCancelOrder,
  chartApiRef,
  onCrosshairPriceChange,
  pickMode,
  onPricePicked,
}: Props) {
  const [layout, setLayout] = useState<LayoutMode>("1x1");
  const [subCharts, setSubCharts] = useState<SubChart[]>([
    { interval: "15m", data: [], loading: false },
    { interval: "1h", data: [], loading: false },
    { interval: "4h", data: [], loading: false },
  ]);

  const loadSubChart = useCallback(
    async (index: number, interval: string) => {
      if (!isRunning) return;
      setSubCharts((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], interval, loading: true };
        return next;
      });

      try {
        const endTime = currentSimulatedTime;
        const intervalMs: Record<string, number> = {
          "1m": 60000,
          "3m": 180000,
          "5m": 300000,
          "15m": 900000,
          "30m": 1800000,
          "1h": 3600000,
          "2h": 7200000,
          "4h": 14400000,
          "1d": 86400000,
        };
        const ms = intervalMs[interval] || 60000;
        const startTime = endTime - ms * 300;

        const res = await fetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${rawSymbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=300`,
        );
        const raw = await res.json();
        const data: KlineData[] = raw.map((k: any[]) => ({
          time: k[0],
          open: +k[1],
          high: +k[2],
          low: +k[3],
          close: +k[4],
          volume: +k[5],
        }));
        setSubCharts((prev) => {
          const next = [...prev];
          next[index] = { interval, data, loading: false };
          return next;
        });
      } catch {
        setSubCharts((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], loading: false };
          return next;
        });
      }
    },
    [isRunning, currentSimulatedTime, rawSymbol],
  );

  useEffect(() => {
    if (layout === "1x1" || !isRunning) return;
    const count = layout === "1x2" ? 1 : 3;
    for (let i = 0; i < count; i++) {
      if (subCharts[i].data.length === 0) {
        loadSubChart(i, subCharts[i].interval);
      }
    }
  }, [layout, isRunning]);

  const getVisibleSubData = (data: KlineData[]) => {
    if (!data || data.length === 0) return data;

    // Filter data up to currentSimulatedTime
    const filtered = data.filter((d) => d.time <= currentSimulatedTime);
    if (filtered.length === 0) return filtered;

    // Get the latest price from mainData to sync the close price of the last sub-candle
    if (mainData && mainData.length > 0) {
      const latestMain = mainData[mainData.length - 1];
      const lastSub = { ...filtered[filtered.length - 1] };

      // Update the current sub-candle with the latest real-time price from main chart
      // Only do this if the main data's time is within or after the last sub-candle's time
      if (latestMain.time >= lastSub.time) {
        lastSub.close = latestMain.close;
        lastSub.high = Math.max(lastSub.high, latestMain.high, latestMain.close);
        lastSub.low = Math.min(lastSub.low, latestMain.low, latestMain.close);
        filtered[filtered.length - 1] = lastSub;
      }
    }

    return filtered;
  };

  const handleSubIntervalChange = (index: number, newInterval: string) => {
    loadSubChart(index, newInterval);
  };

  const [isFullscreen, setIsFullscreen] = useState(readFullscreenSession);
  const chartViewportRevision = `${isFullscreen ? "fullscreen" : "embedded"}:${layout}`;
  const updateFullscreen = useCallback((active: boolean) => {
    writeFullscreenSession(active);
    setIsFullscreen(active);
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") updateFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen, updateFullscreen]);

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-[9999] bg-white dark:bg-[#0b0e11] flex flex-col w-full h-full"
          : "h-full flex flex-col relative"
      }
    >
      <div
        className={`absolute right-2 top-1 z-30 flex items-center ${
          isFullscreen
            ? "gap-2"
            : "gap-0.5 rounded border border-border/50 bg-card/90 px-1 py-0.5"
        }`}
      >
        {isFullscreen && onMainIntervalChange && (
          <div
            role="group"
            aria-label="周期选择"
            className="flex items-center gap-1 rounded-md border border-border/70 bg-card/95 p-1 shadow-sm"
          >
            <span className="flex h-6 items-center gap-1 border-r border-border/60 px-1.5 text-[10px] font-medium text-muted-foreground">
              <Clock3 className="h-3 w-3" />
              周期
            </span>
            <TimeframeSelector interval={mainInterval} onIntervalChange={onMainIntervalChange} />
          </div>
        )}
        {isFullscreen && onSetSpeed && (
          <FullscreenSpeedSelector speed={speed} onSetSpeed={onSetSpeed} />
        )}
        <div
          role="group"
          aria-label="视图布局"
          className={`flex items-center ${
            isFullscreen
              ? "rounded-md border border-border/70 bg-card/95 p-1 shadow-sm"
              : ""
          }`}
        >
          {[
            { mode: "1x1" as LayoutMode, icon: <Square className="w-3 h-3" />, label: "单图" },
            { mode: "1x2" as LayoutMode, icon: <Columns className="w-3 h-3" />, label: "双图" },
            { mode: "2x2" as LayoutMode, icon: <LayoutGrid className="w-3 h-3" />, label: "四图" },
          ].map((opt) => (
            <button
              key={opt.mode}
              onClick={() => setLayout(opt.mode)}
              title={opt.label}
              className={`p-1 rounded transition-colors ${layout === opt.mode ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {opt.icon}
            </button>
          ))}
          <button
            type="button"
            onClick={() => updateFullscreen(!isFullscreen)}
            title={isFullscreen ? "退出全屏 (Esc)" : "全屏"}
            aria-pressed={isFullscreen}
            className="p-1 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/50"
          >
            {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {layout === "1x1" ? (
        <div className="flex-1 min-h-0">
          <CandlestickChart
            data={mainData}
            symbol={mainSymbol}
            viewportRevision={chartViewportRevision}
            onLoadOlder={onLoadOlder}
            loadingOlder={loadingOlder}
            tradeHistory={tradeHistory}
            rawSymbol={rawSymbol}
            pricePrecision={pricePrecision}
            quantityPrecision={quantityPrecision}
            pendingOrders={pendingOrders}
            onCancelOrder={onCancelOrder}
            chartApiRef={chartApiRef}
            onCrosshairPriceChange={onCrosshairPriceChange}
            pickMode={pickMode}
            onPricePicked={onPricePicked}
          />
        </div>
      ) : layout === "1x2" ? (
        <div className="flex-1 min-h-0 grid grid-cols-2 gap-px" style={{ background: "hsl(var(--border))" }}>
          <div className="bg-background min-h-0 overflow-hidden">
            <CandlestickChart
              data={mainData}
              symbol={`${mainSymbol} ${mainInterval}`}
              viewportRevision={chartViewportRevision}
              onLoadOlder={onLoadOlder}
              loadingOlder={loadingOlder}
              tradeHistory={tradeHistory}
              rawSymbol={rawSymbol}
              pricePrecision={pricePrecision}
              quantityPrecision={quantityPrecision}
              pendingOrders={pendingOrders}
              onCancelOrder={onCancelOrder}
              chartApiRef={chartApiRef}
              onCrosshairPriceChange={onCrosshairPriceChange}
              pickMode={pickMode}
              onPricePicked={onPricePicked}
            />
          </div>
          <div className="bg-background min-h-0 overflow-hidden relative">
            <SubChartIntervalSelector
              interval={subCharts[0].interval}
              onChange={(v) => handleSubIntervalChange(0, v)}
            />
            {subCharts[0].loading ? (
              <div className="h-full flex items-center justify-center text-xs text-muted-foreground animate-pulse">
                加载中...
              </div>
            ) : (
              <CandlestickChart
                data={getVisibleSubData(subCharts[0].data)}
                symbol={`${mainSymbol} ${subCharts[0].interval}`}
                viewportRevision={chartViewportRevision}
                tradeHistory={tradeHistory}
                rawSymbol={rawSymbol}
                pricePrecision={pricePrecision}
                quantityPrecision={quantityPrecision}
              />
            )}
          </div>
        </div>
      ) : (
        <div
          className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-px"
          style={{ background: "hsl(var(--border))" }}
        >
          <div className="bg-background min-h-0 overflow-hidden">
            <CandlestickChart
              data={mainData}
              symbol={`${mainSymbol} ${mainInterval}`}
              viewportRevision={chartViewportRevision}
              onLoadOlder={onLoadOlder}
              loadingOlder={loadingOlder}
              tradeHistory={tradeHistory}
              rawSymbol={rawSymbol}
              pricePrecision={pricePrecision}
              quantityPrecision={quantityPrecision}
              pendingOrders={pendingOrders}
              onCancelOrder={onCancelOrder}
            />
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-background min-h-0 overflow-hidden relative">
              <SubChartIntervalSelector
                interval={subCharts[i].interval}
                onChange={(v) => handleSubIntervalChange(i, v)}
              />
              {subCharts[i].loading ? (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground animate-pulse">
                  加载中...
                </div>
              ) : (
                <CandlestickChart
                  data={getVisibleSubData(subCharts[i].data)}
                  symbol={`${mainSymbol} ${subCharts[i].interval}`}
                  viewportRevision={chartViewportRevision}
                  tradeHistory={tradeHistory}
                  rawSymbol={rawSymbol}
                  pricePrecision={pricePrecision}
                  quantityPrecision={quantityPrecision}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FullscreenSpeedSelector({ speed, onSetSpeed }: { speed: number; onSetSpeed: (speed: number) => void }) {
  const [open, setOpen] = useState(false);
  const [visualSpeed, setVisualSpeed] = useState(speed);
  const panelRef = useRef<HTMLDivElement>(null);
  const speedPointerDownRef = useRef<number | null>(null);

  useEffect(() => {
    setVisualSpeed(speed);
  }, [speed]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [open]);

  const selectSpeed = (nextSpeed: number) => {
    setVisualSpeed(nextSpeed);
    onSetSpeed(nextSpeed);
    setOpen(false);
  };

  return (
    <div
      ref={panelRef}
      role="group"
      aria-label="倍速选择"
      className="relative rounded-md border border-primary/25 bg-card/95 p-1 shadow-sm"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`加速器，当前 ${visualSpeed} 倍`}
        aria-expanded={open}
        title="调整时间机器倍速"
        className={`flex h-6 items-center gap-1 rounded px-2 text-[10px] transition-colors ${
          open
            ? "bg-primary text-primary-foreground"
            : "bg-primary/10 text-primary hover:bg-primary/15"
        }`}
      >
        <Gauge className="h-3 w-3" />
        <span className="font-medium">倍速</span>
        <span className="font-mono">{visualSpeed}x</span>
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 grid w-44 grid-cols-3 gap-1.5 rounded-md border border-border bg-card p-2 shadow-xl">
          {SPEED_OPTIONS.map((option) => (
            <button
              type="button"
              key={option}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                speedPointerDownRef.current = option;
                setVisualSpeed(option);
                onSetSpeed(option);
              }}
              onClick={() => {
                if (speedPointerDownRef.current === option) {
                  speedPointerDownRef.current = null;
                  setOpen(false);
                  return;
                }
                selectSpeed(option);
              }}
              className={`h-7 whitespace-nowrap rounded px-1 font-mono text-[10px] transition-all duration-100 ease-out active:scale-[0.96] ${
                visualSpeed === option
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              {option}x
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SubChartIntervalSelector({ interval, onChange }: { interval: string; onChange: (v: string) => void }) {
  return (
    <div className="absolute top-1 left-10 z-20 flex gap-0.5">
      {INTERVALS.map((iv) => (
        <button
          key={iv}
          onClick={() => onChange(iv)}
          className={`px-1 py-0.5 rounded text-[9px] font-mono transition-colors ${
            interval === iv ? "bg-primary/20 text-primary font-bold" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {iv}
        </button>
      ))}
    </div>
  );
}
