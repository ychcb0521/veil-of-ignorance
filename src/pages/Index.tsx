import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { formatUTC8 } from "@/lib/timeFormat";
import { useTradingContext, type PlaceOrderParams, type CoinTimelineState } from "@/contexts/TradingContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBinanceData, intervalToMs, type KlineData } from "@/hooks/useBinanceData";
import { useBackgroundPrices } from "@/hooks/useBackgroundPrices";
import { loadPersistedSimState } from "@/hooks/usePersistedState";
import { usePersistedState, clearSimState } from "@/hooks/usePersistedState";
import { useIsMobile } from "@/hooks/use-mobile";
import { TimeControl } from "@/components/TimeControl";
import { SessionModeControls } from "@/components/SessionModeControls";
import { CandlestickChart, type ChartImperativeApi } from "@/components/CandlestickChart";
import { MultiChartLayout } from "@/components/MultiChartLayout";
import { MarketDataPanel, type MarketDataTab } from "@/components/MarketDataPanel";
import { PGapPanel } from "@/components/PGapPanel";
import { useCampaignWinRate } from "@/hooks/useCampaignWinRate";
import { TickerBar } from "@/components/TickerBar";
import { OrderPanel } from "@/components/OrderPanel";
import { PositionPanel } from "@/components/PositionPanel";
import { SymbolSelector } from "@/components/SymbolSelector";
import { AccountInfo } from "@/components/AccountInfo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MobileLayout } from "@/components/mobile/MobileLayout";
import { AssetOverview } from "@/components/AssetOverview";
import { LiquidationModal } from "@/components/LiquidationModal";
import { TradeInsightsPanel } from "@/components/TradeInsightsPanel";
import { CoolingOffModal, useCoolingOff } from "@/components/CoolingOffModal";
import { getConditionalTriggerDecisionFromRange } from "@/lib/conditionalOrders";
import { fetchCanonicalTimePriceAt } from "@/lib/canonicalTimePrice";
import { applyCurrentPriceToVisibleData } from "@/lib/visibleDataPrice";
import { earliestLongStopPrice } from "@/lib/longRiskAnchor";
import { getPriceDecimals } from "@/lib/formatters";
import {
  getReverseVisibleData,
  mirrorSettledBar,
  mirrorTime,
  reverseFormingBar,
  snapToBarStart,
} from "@/lib/reversePlayback";
import { isForwardExhausted, needsForwardPreload, needsReversePreload } from "@/lib/streamingWindow";
import { stepTrailingStop } from "@/lib/trailingStop";
import { upsertOrderSnapshot } from "@/lib/orderSnapshotHistory";
import {
  diagnoseSignalJump,
  hasKlineCoveringSignalTime,
  type SignalJumpResult,
} from "@/lib/signalJumpDiagnostics";
import { buildOperationAssetHistory, buildOperationDailyPnl, buildOperationDailyPnlDetails, pnlForOperationDate } from "@/lib/assetReport";
import { toast } from "sonner";
import { Wallet, Crosshair, BookOpen, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { JournalNavMenu } from "@/components/journal/JournalNavMenu";
import type { PendingOrder, TradeRecord } from "@/types/trading";
import { calcUnrealizedPnl } from "@/types/trading";
import type { ExecutionTradeSnapshot } from "@/lib/executionAssets";
import type { AssetState } from "@/types/assets";
import {
  executeSettlementFill,
  formatSettlementQuantity,
  getPositionNotionalUsd,
  getPositionUnits,
  isCoinSettled,
  isPositionOpen,
} from "@/lib/tradingSettlement";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

// Price protection threshold: reject conditional triggers if |last - mark| / mark > 2%
const PRICE_PROTECTION_THRESHOLD = 0.02;
// 倒放（镜像视图）下传给图表的空成交列表——标记按真实时间戳定位会在镜像轴上错位。
const EMPTY_TRADE_HISTORY: TradeRecord[] = [];

// ===== Offline matching for restore =====
function matchOrdersOffline(pendingOrders: PendingOrder[], klines: KlineData[], balance: number) {
  const newPositions: any[] = [];
  let remaining = [...pendingOrders];
  let bal = balance;

  for (const kline of klines) {
    const stillPending: PendingOrder[] = [];
    for (const order of remaining) {
      let triggered = false;
      let fillPrice = 0;

      if (order.type === "LIMIT" || order.type === "POST_ONLY") {
        if (order.side === "LONG" && kline.low <= order.price) {
          triggered = true;
          fillPrice = order.price;
        } else if (order.side === "SHORT" && kline.high >= order.price) {
          triggered = true;
          fillPrice = order.price;
        }
      } else if (order.type === "MARKET_TP_SL") {
        const dir = order.triggerDirection || (order.side === "LONG" ? "UP" : "DOWN");
        if (dir === "UP" && kline.high >= order.stopPrice) {
          triggered = true;
          fillPrice = order.stopPrice;
        } else if (dir === "DOWN" && kline.low <= order.stopPrice) {
          triggered = true;
          fillPrice = order.stopPrice;
        }
      } else if (order.type === "CONDITIONAL") {
        const decision = getConditionalTriggerDecisionFromRange(order as any, kline);
        if (!decision) {
          stillPending.push(order);
          continue;
        }

        if (decision.triggered) {
          triggered = true;
          fillPrice = decision.triggerPriceNum;
        }
      }

      if (triggered) {
        const symbol = (order as PendingOrder & { symbol?: string }).symbol || "BTCUSDT";
        const { fee, margin, position } = executeSettlementFill(symbol, fillPrice, order, false, kline.time);
        bal -= margin + fee;
        newPositions.push(position);
      } else {
        stillPending.push(order);
      }
    }
    remaining = stillPending;
  }

  return { positions: newPositions, remainingOrders: remaining, newBalance: bal };
}

const Index = () => {
  const { user, profile, signOut } = useAuth();
  const ctx = useTradingContext();
  const {
    sim,
    activeSymbol,
    setActiveSymbol,
    interval,
    setInterval: setIntervalVal,
    positionsMap,
    setPositionsMap,
    ordersMap,
    setOrdersMap,
    filledOrders,
    setFilledOrders,
    priceMap,
    setPriceMap,
    balance,
    spotBalance,
    fundingBalance,
    setBalance,
    isolatedBalances,
    tradeHistory,
    activeSymbolPositions,
    activeSymbolOrders,
    allPositions,
    allOrders,
    currentPrice,
    activeSymbols,
    pricePrecision,
    quantityPrecision,
    setPricePrecision,
    setQuantityPrecision,
    handlePlaceOrder,
    handleClosePosition,
    handleCancelOrder,
    handlePlaceTpSl,
    executeReduceOnlyTrigger,
    handleAddIsolatedMargin,
    handleAdjustMargin,
    handleClearSymbolData,
    liquidationOpen,
    liquidationDetails,
    closeLiquidationModal,
    timeMode,
    setTimeMode,
    timeDirection,
    reverseCapTime,
    setReverseCapTime,
    tradingMode,
    recordExecutionTrade,
    coinTimelines,
    setCoinTimelines,
    totalPositionCount,
    getEffectiveTime,
    getCoinState,
    getEffectiveBalance,
    getEffectiveAvailable,
  } = ctx;

  const { allData, allDataRef, loading, loadingOlder, error, initLoad, loadOlder, loadNewer, getVisibleData, reset } =
    useBinanceData();

  // Background price polling for non-active symbols
  useBackgroundPrices();

  const [bottomTab, setBottomTab] = useState("positions");
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [pickedPrice, setPickedPrice] = useState<number | null>(null);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [perfSymbol, setPerfSymbol] = useState<string | null>(null);
  const [coolingOffModalOpen, setCoolingOffModalOpen] = useState(false);
  const [priceProtection, setPriceProtection] = usePersistedState("price_protection", true);
  // 盘口开合走持久化：这是「界面设置 → 模块显隐」的真值来源，
  // 页内的关闭按钮和抽屉里的开关改的是同一个状态，刷新后也保留。
  const [isOrderBookOpen, setIsOrderBookOpen] = usePersistedState<boolean>('panel_orderbook_open_v1', true);
  // 盘口（订单簿/最新成交/市场异动）默认折叠、位于下方；P_gap 在上且默认完整显示。
  const [isMarketDataCollapsed, setIsMarketDataCollapsed] = useState(true);
  const [isPGapCollapsed, setIsPGapCollapsed] = usePersistedState<boolean>('panel_pgap_collapsed_v1', false);
  const campaignWinRate = useCampaignWinRate();
  // 当前标的多单的加权平均开仓价，供 P_gap 的「可落袋 R」使用。
  // 按数量加权正是让「总未实现盈亏 ÷ 总预期最大亏损」成立的那个均价。
  const activeLongEntry = useMemo(() => {
    let qty = 0;
    let notional = 0;
    for (const position of activeSymbolPositions) {
      if (position.side !== "LONG") continue;
      const q = Number(position.quantity);
      const e = Number(position.entryPrice);
      if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(e) || e <= 0) continue;
      qty += q;
      notional += q * e;
      }
    return qty > 0
      ? { price: notional / qty, count: activeSymbolPositions.filter(p => p.side === "LONG").length }
      : { price: null as number | null, count: 0 };
  }, [activeSymbolPositions]);
  // b_可落袋 的风险锚：该多单最早设定的止损（在挂 + 已触发里 createdAt 最早）。
  const activeLongRiskAnchor = useMemo(
    () => earliestLongStopPrice(activeSymbol, activeSymbolPositions, activeSymbolOrders, filledOrders),
    [activeSymbol, activeSymbolPositions, activeSymbolOrders, filledOrders],
  );
  const [marketDataTab, setMarketDataTab] = useState<MarketDataTab>("orderBook");

  const coolingOff = useCoolingOff();
  const hasRestoredRef = useRef(false);
  const persistedSim = useMemo(() => loadPersistedSimState(), []);
  const restoredActive = persistedSim?.status === "playing" || persistedSim?.status === "paused";

  useEffect(() => {
    if (!restoredActive || hasRestoredRef.current || !persistedSim) return;
    hasRestoredRef.current = true;

    (async () => {
      const targetTime = persistedSim.currentSimulatedTime || persistedSim.historicalAnchorTime!;
      const data = await initLoad(persistedSim.symbol, persistedSim.interval, targetTime, { reverse: persistedSim.direction === -1 });
      if (data.length > 0) {
        toast.info("已恢复模拟会话");
      }
    })();
  }, []);

  const iMs = useMemo(() => intervalToMs(interval), [interval]);

  // Track the original start time for synced mode
  const [syncedOriginTime, setSyncedOriginTime] = usePersistedState<number | null>("synced_origin_time", null);

  // ===== ACTIVE COIN STATE (isolation-aware) =====
  // This is the single source of truth for UI: status, time, speed
  const activeCoinState = useMemo(() => {
    if (timeMode === "synced") {
      return { status: sim.status, time: sim.currentSimulatedTime, speed: sim.speed, originTime: syncedOriginTime };
    }
    const ct = coinTimelines[activeSymbol];
    if (!ct || ct.status === "stopped")
      return { status: "stopped" as const, time: 0, speed: 1, originTime: null as number | null };
    return { status: ct.status, time: ct.time, speed: ct.speed, originTime: ct.originTime };
  }, [timeMode, sim.status, sim.currentSimulatedTime, sim.speed, coinTimelines, activeSymbol, syncedOriginTime]);

  // Effective time for data filtering
  const effectiveSimTime = useMemo(() => {
    if (timeMode === "synced") return sim.currentSimulatedTime;
    const ct = coinTimelines[activeSymbol];
    return ct?.time ?? 0;
  }, [timeMode, sim.currentSimulatedTime, coinTimelines, activeSymbol]);

  // 倒放镜面：本次倒放的起点（对齐 K 线开盘）。同步模式用全局值，隔离模式各币种自带。
  const activeReverseCap = useMemo(() => {
    if (timeDirection !== -1) return null;
    if (timeMode === 'isolated') return coinTimelines[activeSymbol]?.reverseCapTime ?? null;
    return reverseCapTime;
  }, [timeDirection, timeMode, coinTimelines, activeSymbol, reverseCapTime]);

  const visibleData = useMemo(() => {
    if (timeDirection === -1) {
      // 镜像视图：真实时间更晚的作为主观历史铺在图上，更早的逐帧从右侧出现。
      if (activeReverseCap == null) return [];
      return getReverseVisibleData(allData, effectiveSimTime, activeReverseCap, iMs);
    }
    return getVisibleData(effectiveSimTime, iMs);
  }, [timeDirection, activeReverseCap, allData, getVisibleData, effectiveSimTime, iMs]);

  const [activeDisplayPrice, setActiveDisplayPrice] = useState(() => currentPrice || 0);
  const displayCurrentPrice = activeDisplayPrice > 0 ? activeDisplayPrice : currentPrice;
  const displayPriceMap = useMemo(() => {
    if (!displayCurrentPrice || displayCurrentPrice <= 0) return priceMap;
    if (priceMap[activeSymbol] === displayCurrentPrice) return priceMap;
    return { ...priceMap, [activeSymbol]: displayCurrentPrice };
  }, [activeSymbol, displayCurrentPrice, priceMap]);

  const displayData = useMemo(
    () => applyCurrentPriceToVisibleData(visibleData, displayCurrentPrice),
    [visibleData, displayCurrentPrice],
  );

  // 倒放坐标轴换算：镜像时间 → 真实时间（对合函数，正反同式）。
  // 图表内部时间轴用镜像时间（严格递增），标签与十字线显示真实时间——从左到右递减。
  const reverseAxisTransform = useMemo(
    () => (timeDirection === -1 && activeReverseCap != null
      ? (ts: number) => mirrorTime(activeReverseCap, ts)
      : null),
    [timeDirection, activeReverseCap],
  );

  const latestVisiblePrice = useMemo(() => {
    const latest = visibleData[visibleData.length - 1];
    return Number(latest?.close ?? 0);
  }, [visibleData]);

  // 价格精度的数据回退：换币时会清掉 priceMap 里的旧价防串价，此时 context 的
  // pricePrecision 退回 2 位——klinecharts 的刻度步长受精度限制，0.0128 的币按
  // 0.01 画刻度会把 Y 轴撑爆、蜡烛挤成一条。实时价缺位时改用最新可见 K 线的
  // 收盘价推导精度，保证新币种一进来盘面就自适应。
  const chartPricePrecision = useMemo(() => {
    if (currentPrice > 0) return pricePrecision;
    const vis = Number(latestVisiblePrice || 0);
    return vis > 0 ? getPriceDecimals(vis) : pricePrecision;
  }, [currentPrice, latestVisiblePrice, pricePrecision]);

  // Should the RAF engine be running?
  const shouldRunEngine = useMemo(() => {
    if (timeMode === "synced") return sim.status === "playing";
    return Object.values(coinTimelines).some((ct) => ct.status === "playing");
  }, [timeMode, sim.status, coinTimelines]);

  // ===== REFS =====
  const chartApiRef = useRef<{ updateData: (candle: any) => void } | null>(null);
  const cursorRef = useRef(0);
  const gameLoopInitRef = useRef(false);
  const clockRef = useRef<HTMLSpanElement>(null);

  const lastReactFlushRef = useRef(0);
  const lastDisplayPriceFrameRef = useRef(0);
  const lastDisplayPriceFlushRef = useRef(0);
  const lastPersistRef = useRef(0);
  const timeModeRef = useRef(timeMode);
  const timeDirectionRef = useRef(timeDirection);
  const activeReverseCapRef = useRef(activeReverseCap);
  // 倒放追踪上一帧的模拟时刻（按时间而非下标——loadOlder 前插会移动下标）。
  const lastReverseSimTimeRef = useRef<number | null>(null);
  const activeSymbolRef = useRef(activeSymbol);
  const coinTimelinesRef = useRef(coinTimelines);
  // 正放触顶自动补更晚的 K 线：节流 + 由 loadNewer 自身的 noMore/inflight 守卫兜底。
  const loadNewerRef = useRef(loadNewer);
  const forwardLoadNewerAtRef = useRef(0);
  // 只在「喂完最后一根」的那一刻提示一次，避免暂停后每帧重复弹 toast。
  const forwardExhaustedRef = useRef(false);
  // 倒放触底自动补更早的 K 线：节流 + 由 loadOlder 自身的 noMore/inflight 守卫兜底。
  const reverseLoadOlderAtRef = useRef(0);
  const loadOlderRef = useRef(loadOlder);
  const handlePauseRef = useRef<() => void>(() => {});
  const latestChartPriceRef = useRef(currentPrice || 0);
  const activeDisplayPriceRef = useRef(activeDisplayPrice || currentPrice || 0);
  const renderedDisplayPriceRef = useRef(activeDisplayPrice || currentPrice || 0);
  const canonicalPriceSampleRef = useRef<{ symbol: string; simTime: number; wallTime: number } | null>(null);
  // Keep ref synced with currentPrice from context as a fallback
  useEffect(() => {
    if (currentPrice > 0 && latestChartPriceRef.current <= 0) {
      latestChartPriceRef.current = currentPrice;
    }
  }, [currentPrice]);
  useEffect(() => {
    activeDisplayPriceRef.current = activeDisplayPrice;
    renderedDisplayPriceRef.current = activeDisplayPrice;
  }, [activeDisplayPrice]);
  const effectiveSimTimeRef = useRef(effectiveSimTime);
  const priceProtectionRef = useRef(priceProtection);
  const ordersMapRef = useRef(ordersMap);
  const priceMapRef = useRef(priceMap);
  const currentPriceRef = useRef(currentPrice);
  const latestVisiblePriceRef = useRef(latestVisiblePrice);
  const canonicalPriceRequestRef = useRef(0);
  const conditionalTriggerLocksRef = useRef<Set<string>>(new Set());
  const conditionalTriggerRetryAtRef = useRef(new Map<string, number>());

  useEffect(() => {
    timeModeRef.current = timeMode;
  }, [timeMode]);
  useEffect(() => {
    timeDirectionRef.current = timeDirection;
    // 方向切换 = 图表视图整体重建（正常↔镜像），游标与倒放追踪都重新初始化。
    gameLoopInitRef.current = false;
    lastReverseSimTimeRef.current = null;
  }, [timeDirection]);
  useEffect(() => {
    activeReverseCapRef.current = activeReverseCap;
  }, [activeReverseCap]);
  useEffect(() => {
    loadOlderRef.current = loadOlder;
  }, [loadOlder]);
  useEffect(() => {
    loadNewerRef.current = loadNewer;
  }, [loadNewer]);
  useEffect(() => {
    activeSymbolRef.current = activeSymbol;
  }, [activeSymbol]);
  useEffect(() => {
    coinTimelinesRef.current = coinTimelines;
  }, [coinTimelines]);
  useEffect(() => {
    effectiveSimTimeRef.current = effectiveSimTime;
  }, [effectiveSimTime]);
  useEffect(() => {
    priceProtectionRef.current = priceProtection;
  }, [priceProtection]);
  useEffect(() => {
    ordersMapRef.current = ordersMap;
  }, [ordersMap]);
  useEffect(() => {
    priceMapRef.current = priceMap;
  }, [priceMap]);
  useEffect(() => {
    currentPriceRef.current = currentPrice;
  }, [currentPrice]);
  useEffect(() => {
    latestVisiblePriceRef.current = latestVisiblePrice;
  }, [latestVisiblePrice]);

  const refreshCanonicalPrice = useCallback(
    async (symbol: string, time: number) => {
      if (!symbol || !Number.isFinite(time) || time <= 0) return;
      const requestId = ++canonicalPriceRequestRef.current;
      const price = await fetchCanonicalTimePriceAt(symbol, time).catch(() => null);
      if (requestId !== canonicalPriceRequestRef.current || !price || price.close <= 0) return;

      canonicalPriceSampleRef.current = { symbol, simTime: time, wallTime: Date.now() };
      latestChartPriceRef.current = price.close;
      setPriceMap((prev) => {
        if (prev[symbol] === price.close) return prev;
        return { ...prev, [symbol]: price.close };
      });
    },
    [setPriceMap],
  );

  const canonicalPriceRefreshTime = useMemo(() => {
    if (activeCoinState.status === "playing") {
      return Math.floor(effectiveSimTime / 1000) * 1000;
    }
    return effectiveSimTime;
  }, [activeCoinState.status, effectiveSimTime]);

  useEffect(() => {
    if (activeCoinState.status === "stopped" || canonicalPriceRefreshTime <= 0) return;
    void refreshCanonicalPrice(activeSymbol, canonicalPriceRefreshTime);
  }, [activeSymbol, interval, activeCoinState.status, canonicalPriceRefreshTime, refreshCanonicalPrice]);

  useEffect(() => {
    const activeOrderIds = new Set(
      Object.values(ordersMap).flatMap((symbolOrders) => symbolOrders.map((order) => order.id)),
    );
    conditionalTriggerLocksRef.current.forEach((orderId) => {
      if (!activeOrderIds.has(orderId)) {
        conditionalTriggerLocksRef.current.delete(orderId);
      }
    });
    conditionalTriggerRetryAtRef.current.forEach((_retryAt, orderId) => {
      if (!activeOrderIds.has(orderId)) {
        conditionalTriggerRetryAtRef.current.delete(orderId);
      }
    });
  }, [ordersMap]);

  const DISPLAY_PRICE_FLUSH_MS = 33;
  const DISPLAY_PRICE_SMOOTHING_MS = 42;
  const DISPLAY_PRICE_SNAP_RATIO = 0.08;
  const REACT_FLUSH_MS = 250;
  // 正放时距最晚已加载 K 线还剩多少根就开始预取更晚数据。取得比倒放宽裕些：
  // 高倍速下消耗极快（3m 周期 180x 恰为 1 根/秒，1m 周期 900x 达 15 根/秒），
  // 240 根足以覆盖一次取数的往返，且取数本身有 2s 节流与在途锁兜底。
  const FORWARD_PRELOAD_BARS = 240;
  // 倒放时距最早已加载 K 线还剩多少根就开始预取更早数据
  const REVERSE_PRELOAD_BARS = 120;
  // 倒放（镜像视图）：图表左沿 = 主观深处历史 = 真实更晚的数据，向左拖动补 loadNewer。
  const loadNewerVoid = useCallback(() => { void loadNewer(); }, [loadNewer]);
  const PERSIST_MS = 500;
  const CANONICAL_PRICE_MAX_SIM_AGE_MS = 90_000;

  const flushDisplayPrice = useCallback((price: number, now: number) => {
    if (!Number.isFinite(price) || price <= 0) return price;
    const previous = activeDisplayPriceRef.current;
    const base = Number.isFinite(previous) && previous > 0 ? previous : price;
    const minStep = Math.max(1e-10, price * 1e-7);
    const elapsed =
      lastDisplayPriceFrameRef.current > 0
        ? Math.max(0, Math.min(120, now - lastDisplayPriceFrameRef.current))
        : DISPLAY_PRICE_FLUSH_MS;
    lastDisplayPriceFrameRef.current = now;

    const ratioGap = Math.abs(price - base) / price;
    const alpha = 1 - Math.exp(-elapsed / DISPLAY_PRICE_SMOOTHING_MS);
    let next =
      base <= 0 || ratioGap >= DISPLAY_PRICE_SNAP_RATIO
        ? price
        : base + (price - base) * Math.max(0.18, Math.min(0.72, alpha));
    if (Math.abs(price - next) < minStep) next = price;

    activeDisplayPriceRef.current = next;
    const rendered = renderedDisplayPriceRef.current;
    if (now - lastDisplayPriceFlushRef.current < DISPLAY_PRICE_FLUSH_MS && Math.abs(next - rendered) < minStep) {
      return next;
    }
    lastDisplayPriceFlushRef.current = now;
    renderedDisplayPriceRef.current = next;
    setActiveDisplayPrice((prev) => (Math.abs(prev - next) < minStep ? prev : next));
    return next;
  }, []);

  const createTriggeredConditionalPosition = useCallback(
    (symbol: string, order: PendingOrder, triggerPrice: number, openTime: number) => {
      const entryPrice = Number(triggerPrice);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) return false;

      if (order.reduceOnly && order.linkedPositionId) {
        return executeReduceOnlyTrigger(symbol, order, entryPrice, openTime).ok;
      }

      const liveOrder = (ordersMapRef.current[symbol] || []).find((candidate) => candidate.id === order.id);
      if (!liveOrder) return false;

      const { fee, margin, position } = executeSettlementFill(symbol, entryPrice, order, false, openTime);

      setFilledOrders(prev => upsertOrderSnapshot(prev, {
          id: order.id,
          symbol,
          side: order.side,
          type: order.type,
          reduceOnly: order.reduceOnly ?? false,
          reduceKind: order.reduceKind ?? null,
          linkedPositionId: order.linkedPositionId ?? null,
          price: entryPrice,
          triggerPrice,
          quantity: order.quantity,
          contracts: order.contracts,
          leverage: order.leverage,
          settlementMode: order.settlementMode,
          settlementAsset: order.settlementAsset,
          contractSizeUsd: order.contractSizeUsd,
          createdAt: order.createdAt,
          filledAt: openTime,
          positionId: position.id,
        }));
      setBalance((prev) => prev - margin - fee);
      setPositionsMap((prev) => {
        const existing = (prev[symbol] || []).filter(isPositionOpen);
        return {
          ...prev,
          [symbol]: [...existing, position],
        };
      });
      const nextOrdersMap = {
        ...ordersMapRef.current,
        [symbol]: (ordersMapRef.current[symbol] || []).filter((candidate) => candidate.id !== order.id),
      };
      ordersMapRef.current = nextOrdersMap;
      setOrdersMap(nextOrdersMap);
      toast.success(`条件单已触发：${symbol} ${order.side} ${formatSettlementQuantity(position, symbol)} @ ${entryPrice.toFixed(2)}`);
      return true;
    },
    [executeReduceOnlyTrigger, setBalance, setFilledOrders, setOrdersMap, setPositionsMap],
  );

  const runConditionalMatchingForSymbol = useCallback(
    (symbol: string, candle: Pick<KlineData, "high" | "low">, openTime: number) => {
      const symbolOrders = ordersMapRef.current[symbol] || [];

      // ===== 跟踪委托：逐根 K 线推进极值，回调触及即按市价成交 =====
      // 状态映射：SHORT 追最高价存 peakPrice，LONG 追最低价存 troughPrice。
      if (symbolOrders.some(o => o.type === 'TRAILING_STOP' && o.status === 'PENDING')) {
        for (const order of symbolOrders) {
          if (order.type !== 'TRAILING_STOP' || order.status !== 'PENDING') continue;
          if (conditionalTriggerLocksRef.current.has(order.id)) continue;
          const extreme = order.side === 'SHORT' ? (order.peakPrice ?? null) : (order.troughPrice ?? null);
          const result = stepTrailingStop({
            side: order.side,
            callbackRate: order.callbackRate ?? 0,
            activationPrice: order.stopPrice > 0 ? order.stopPrice : null,
            state: { activated: order.trailingActivated ?? false, extreme },
            high: candle.high,
            low: candle.low,
          });
          const nextPeak = order.side === 'SHORT' ? result.state.extreme ?? undefined : order.peakPrice;
          const nextTrough = order.side === 'LONG' ? result.state.extreme ?? undefined : order.troughPrice;
          const stateChanged = result.state.activated !== (order.trailingActivated ?? false)
            || nextPeak !== order.peakPrice
            || nextTrough !== order.troughPrice;

          if (result.triggered && result.triggerPrice != null) {
            conditionalTriggerLocksRef.current.add(order.id);
            const executed = createTriggeredConditionalPosition(symbol, order, result.triggerPrice, openTime);
            if (!executed) {
              conditionalTriggerLocksRef.current.delete(order.id);
            }
            continue;
          }
          if (stateChanged) {
            setOrdersMap(prev => {
              const list = prev[symbol] || [];
              return {
                ...prev,
                [symbol]: list.map(item => item.id === order.id
                  ? { ...item, trailingActivated: result.state.activated, peakPrice: nextPeak, troughPrice: nextTrough }
                  : item),
              };
            });
          }
        }
      }

      if (
        !symbolOrders.some(
          (order) =>
            order.type === "CONDITIONAL" &&
            order.status === "PENDING" &&
            !conditionalTriggerLocksRef.current.has(order.id),
        )
      ) {
        return;
      }

      for (const order of symbolOrders) {
        try {
          if (order.type !== "CONDITIONAL" || order.status !== "PENDING") continue;
          if (conditionalTriggerLocksRef.current.has(order.id)) continue;
          if ((conditionalTriggerRetryAtRef.current.get(order.id) || 0) > Date.now()) continue;

          const decision = getConditionalTriggerDecisionFromRange(order, candle);
          if (!decision?.triggered) continue;

          conditionalTriggerLocksRef.current.add(order.id);
          const executed = createTriggeredConditionalPosition(symbol, order, decision.triggerPriceNum, openTime);
          if (!executed) {
            conditionalTriggerLocksRef.current.delete(order.id);
            conditionalTriggerRetryAtRef.current.set(order.id, Date.now() + 500);
          } else {
            conditionalTriggerRetryAtRef.current.delete(order.id);
          }
        } catch (err) {
          console.error("[TP/SL Execute Error]", { orderId: order?.id, err });
          conditionalTriggerLocksRef.current.delete(order.id);
          conditionalTriggerRetryAtRef.current.set(order.id, Date.now() + 500);
        }
      }
    },
    [createTriggeredConditionalPosition],
  );

  // ===== UNIFIED GAME LOOP =====
  useEffect(() => {
    if (!shouldRunEngine) {
      gameLoopInitRef.current = false;
      return;
    }

    let raf: number;

    // 数据里 time <= t 的最大下标（二分；找不到返回 -1）。
    const findBarIndexAtOrBefore = (data: KlineData[], t: number): number => {
      let lo = 0;
      let hi = data.length - 1;
      let ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (data[mid].time <= t) {
          ans = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return ans;
    };

    // ===== 正放的每帧图表推进 =====
    // 与 runReverseChartTick 对称。此前这段逻辑在 isolated / synced 两个分支里
    // 各抄了一份且逐字节相同——正是「倒放补了流式加载、正放漏了」这个缺口能
    // 长期存在的原因。现在只此一份，两个分支共用。
    const runForwardChartTick = (
      api: { updateData: (candle: unknown) => void },
      data: KlineData[],
      sym: string,
      simTime: number,
      now: number,
    ) => {
      let newCandles = 0;
      while (cursorRef.current < data.length) {
        const candleEnd = data[cursorRef.current].time + iMs;
        if (candleEnd <= simTime) {
          newCandles++;
          cursorRef.current++;
        } else break;
      }
      if (newCandles > 0) {
        const settledStart = Math.max(0, cursorRef.current - newCandles);
        for (let i = settledStart; i < cursorRef.current; i++) {
          runConditionalMatchingForSymbol(sym, data[i], Math.min(simTime, data[i].time + iMs));
        }

        const batchStart = Math.max(0, cursorRef.current - Math.min(newCandles, 3));
        for (let i = batchStart; i < cursorRef.current; i++) {
          const c = data[i];
          api.updateData({
            timestamp: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          });
        }
        // 一帧越过多根（高倍速）时让 React 立即补齐其余，与倒放策略一致
        if (newCandles > 3) lastReactFlushRef.current = 0;
        const settledClose = Number(data[cursorRef.current - 1]?.close);
        if (Number.isFinite(settledClose) && settledClose > 0) {
          latestChartPriceRef.current = settledClose;
          flushDisplayPrice(settledClose, now);
        }
      }
      if (cursorRef.current < data.length) {
        const candle = data[cursorRef.current];
        if (candle.time <= simTime) {
          const isLiveCandle = candle.time + iMs > Date.now() - 60000;
          const progress = Math.max(0, Math.min(1, (simTime - candle.time) / iMs));
          const interpClose = isLiveCandle ? candle.close : candle.open + (candle.close - candle.open) * progress;
          const hlReveal = Math.min(1, progress * 1.5);
          const rawHigh = isLiveCandle ? candle.high : candle.open + (candle.high - candle.open) * hlReveal;
          const rawLow = isLiveCandle ? candle.low : candle.open + (candle.low - candle.open) * hlReveal;
          // 撮合仍用「周期插值」的 high/low（行为完全不变）
          const matchHigh = isLiveCandle ? candle.high : Math.max(candle.open, interpClose, rawHigh);
          const matchLow = isLiveCandle ? candle.low : Math.min(candle.open, interpClose, rawLow);
          // 显示价统一用「该时刻 1m 价」（priceMap，useBackgroundPrices 每秒更新），使各周期一致；
          // 偏差过大（疑似切标的残留）或冷启动拉不到时，退回周期插值，不会更糟。
          const livePx = priceMapRef.current[sym];
          const canonicalSample = canonicalPriceSampleRef.current;
          const canonicalFresh =
            canonicalSample?.symbol === sym &&
            Math.abs(simTime - canonicalSample.simTime) <= CANONICAL_PRICE_MAX_SIM_AGE_MS;
          const r = canonicalFresh && livePx > 0 && interpClose > 0 ? livePx / interpClose : 0;
          const close = r >= 0.2 && r <= 5 ? livePx : interpClose;
          const displayClose = flushDisplayPrice(close, now);
          api.updateData({
            timestamp: candle.time,
            open: candle.open,
            high: Math.max(matchHigh, displayClose),
            low: Math.min(matchLow, displayClose),
            close: displayClose,
            volume: candle.volume * progress,
          });
          runConditionalMatchingForSymbol(sym, { high: matchHigh, low: matchLow }, simTime);
          latestChartPriceRef.current = close;
        }
      }

      // ③ 触顶：按余量预取更晚的 K 线；喂完已加载最后一根时自动暂停。
      //    这一段此前完全缺失——初始只有 300 根前瞻缓冲，3m 周期 180x 下
      //    恰好 1 根/秒，5 分钟就把缓冲吃光，此后时钟照跑、蜡烛不动。
      if (data.length > 0) {
        const lastLoaded = data[data.length - 1].time;
        if (needsForwardPreload(simTime, lastLoaded, iMs, FORWARD_PRELOAD_BARS) && now - forwardLoadNewerAtRef.current > 2000) {
          forwardLoadNewerAtRef.current = now;
          void loadNewerRef.current();
        }
        if (isForwardExhausted(simTime, lastLoaded, iMs)) {
          // 只在跨过边界的那一刻暂停并提示一次
          if (!forwardExhaustedRef.current) {
            forwardExhaustedRef.current = true;
            handlePauseRef.current();
            toast.warning("已播放到当前可取的最新 K 线，已自动暂停");
          }
        } else {
          // 补到了新数据 / 用户回退了时间 → 恢复常态，下次触顶仍会提示
          forwardExhaustedRef.current = false;
        }
      }
    };

    // ===== 倒叙播放（镜像视图）的每帧图表推进 =====
    // 时钟向真实过去走；每越过一根蜡烛的开盘，它便以「开收互换」的镜像整根
    // 落定；正在穿越的那根按主观进度从真实收盘价向开盘价回走。追踪按时间而非
    // 下标（loadOlder 前插会移动下标）；一帧越过多根时补画最近 3 根并让 React
    // flush 立即补齐其余（与正放的批量策略镜像对称）。
    const runReverseChartTick = (
      api: { updateData: (candle: unknown) => void },
      data: KlineData[],
      sym: string,
      simTime: number,
      now: number,
    ) => {
      const cap = activeReverseCapRef.current;
      if (cap == null) return;
      const prevSim = lastReverseSimTimeRef.current;
      lastReverseSimTimeRef.current = simTime;

      // ① 本帧被完整揭示的蜡烛（时钟越过其开盘）：撮合全区间，补画主观最近的 3 根
      if (prevSim != null && prevSim > simTime) {
        const hiIdx = findBarIndexAtOrBefore(data, prevSim - 1);
        const loIdx = findBarIndexAtOrBefore(data, simTime) + 1;
        let crossed = 0;
        for (let i = hiIdx; i >= loIdx && i >= 0; i--) {
          const c = data[i];
          if (c.time < simTime) break;
          crossed++;
          runConditionalMatchingForSymbol(sym, c, Math.max(simTime, c.time));
          if (i <= loIdx + 2) {
            const m = mirrorSettledBar(c, cap);
            api.updateData({ timestamp: m.time, open: m.open, high: m.high, low: m.low, close: m.close, volume: m.volume });
          }
        }
        if (crossed > 3) lastReactFlushRef.current = 0;
      }

      // ② 正在成形的镜像蜡烛：从真实收盘价向开盘价回走；显示价沿用正放的 canonical 合并
      const k = findBarIndexAtOrBefore(data, simTime);
      if (k >= 0) {
        const bar = data[k];
        if (simTime < bar.time + iMs) {
          const partial = reverseFormingBar(bar, simTime, iMs, cap);
          const interpClose = partial.close;
          const livePx = priceMapRef.current[sym];
          const canonicalSample = canonicalPriceSampleRef.current;
          const canonicalFresh =
            canonicalSample?.symbol === sym &&
            Math.abs(simTime - canonicalSample.simTime) <= CANONICAL_PRICE_MAX_SIM_AGE_MS;
          const r = canonicalFresh && livePx > 0 && interpClose > 0 ? livePx / interpClose : 0;
          const close = r >= 0.2 && r <= 5 ? livePx : interpClose;
          const displayClose = flushDisplayPrice(close, now);
          api.updateData({
            timestamp: partial.time,
            open: partial.open,
            high: Math.max(partial.high, displayClose),
            low: Math.min(partial.low, displayClose),
            close: displayClose,
            volume: partial.volume,
          });
          runConditionalMatchingForSymbol(sym, { high: partial.high, low: partial.low }, simTime);
          latestChartPriceRef.current = close;
        }
      }

      // ③ 触底：按余量预取更早的 K 线；到达已加载最早一根时自动暂停
      if (data.length > 0) {
        if (needsReversePreload(simTime, data[0].time, iMs, REVERSE_PRELOAD_BARS) && now - reverseLoadOlderAtRef.current > 2000) {
          reverseLoadOlderAtRef.current = now;
          void loadOlderRef.current();
        }
        if (simTime <= data[0].time) {
          handlePauseRef.current();
          toast.warning("倒放已到达当前已加载的最早 K 线，已自动暂停");
        }
      }
    };

    const tick = () => {
      const now = Date.now();

      if (timeModeRef.current === "isolated") {
        // === ISOLATED MODE: advance ALL playing coins ===
        const activeSym = activeSymbolRef.current;
        const cts = coinTimelinesRef.current;
        const updates: Record<string, CoinTimelineState> = {};
        let activeSimTime = cts[activeSym]?.time ?? 0;
        let activeIsPlaying = false;

        for (const [sym, ct] of Object.entries(cts)) {
          if (ct.status !== "playing" || !ct.realStartTime || ct.historicalAnchorTime == null) continue;
          const simTime = ct.historicalAnchorTime + (now - ct.realStartTime) * ct.speed * timeDirectionRef.current;
          updates[sym] = { ...ct, time: simTime };
          if (sym === activeSym) {
            activeSimTime = simTime;
            activeIsPlaying = true;
          }
        }

        // Update DOM clock for active coin
        if (activeIsPlaying) {
          const timeStr = formatUTC8(activeSimTime);
          if (clockRef.current) clockRef.current.textContent = timeStr;
        }

        // Chart cursor for active coin only
        if (activeIsPlaying) {
          const api = chartApiRef.current;
          const data = allDataRef.current;
          if (api && data.length > 0) {
            if (!gameLoopInitRef.current) {
              let idx = 0;
              for (let i = 0; i < data.length; i++) {
                if (data[i].time <= activeSimTime) idx = i + 1;
                else break;
              }
              cursorRef.current = idx;
              gameLoopInitRef.current = true;
            }
            if (timeDirectionRef.current === -1) {
              runReverseChartTick(api, data, activeSym, activeSimTime, now);
            } else {
              runForwardChartTick(api, data, activeSym, activeSimTime, now);
            }
          }
        }

        // Throttled React flush
        if (now - lastReactFlushRef.current >= REACT_FLUSH_MS && Object.keys(updates).length > 0) {
          lastReactFlushRef.current = now;
          setCoinTimelines((prev) => {
            const next = { ...prev };
            for (const [sym, ct] of Object.entries(updates)) {
              const latest = prev[sym];
              if (
                latest &&
                (latest.status !== ct.status ||
                  latest.speed !== ct.speed ||
                  latest.realStartTime !== ct.realStartTime ||
                  latest.historicalAnchorTime !== ct.historicalAnchorTime)
              ) {
                next[sym] = latest;
                continue;
              }
              next[sym] = ct;
            }
            coinTimelinesRef.current = next;
            return next;
          });
          // Sync sim React state for matching/liquidation engines (using active coin's time)
          if (activeIsPlaying) {
            sim.syncReactState(activeSimTime);
          }
        }
      } else {
        // === SYNCED MODE (original logic) ===
        const api = chartApiRef.current;
        const data = allDataRef.current;
        const simTime = sim.getSimTime();
        sim.currentTimeRef.current = simTime;

        const timeStr = formatUTC8(simTime);
        if (clockRef.current) clockRef.current.textContent = timeStr;

        if (api && data.length > 0) {
          if (!gameLoopInitRef.current) {
            let idx = 0;
            for (let i = 0; i < data.length; i++) {
              if (data[i].time <= simTime) idx = i + 1;
              else break;
            }
            cursorRef.current = idx;
            gameLoopInitRef.current = true;
          }
          if (timeDirectionRef.current === -1) {
            runReverseChartTick(api, data, activeSymbolRef.current, simTime, now);
          } else {
            runForwardChartTick(api, data, activeSymbolRef.current, simTime, now);
          }
        }

        if (now - lastReactFlushRef.current >= REACT_FLUSH_MS) {
          lastReactFlushRef.current = now;
          sim.syncReactState(simTime);
        }

        if (now - lastPersistRef.current >= PERSIST_MS) {
          lastPersistRef.current = now;
          sim.persistTime(simTime);
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [shouldRunEngine, iMs, runConditionalMatchingForSymbol, flushDisplayPrice]);

  // Build asset state for AssetOverview
  const assetState = useMemo<AssetState>(() => {
    const initialCapital = profile?.initial_capital ?? 1_000_000;
    let unrealizedPnl = 0;
    for (const [sym, positions] of Object.entries(positionsMap)) {
      const price = displayPriceMap[sym] || 0;
      for (const pos of positions) {
        unrealizedPnl += calcUnrealizedPnl(pos, price || pos.entryPrice);
      }
    }
    // 合约钱包权益 = 可用现金 + 未实现盈亏；账户总资产还要加上现货与资金钱包。
    // 划转只在钱包之间搬钱，因此 totalBalance 在划转前后严格不变。
    const futuresEquity = balance + unrealizedPnl;
    const totalBalance = futuresEquity + spotBalance + fundingBalance;
    const dailyPnl = buildOperationDailyPnl(tradeHistory);
    const todayRealizedPnl = pnlForOperationDate(dailyPnl);
    const todayPnl = todayRealizedPnl + unrealizedPnl;
    const todayPnlPct = initialCapital > 0 ? (todayPnl / initialCapital) * 100 : 0;

    const history = buildOperationAssetHistory(tradeHistory, initialCapital);
    const latestOperationTime = history[history.length - 1]?.timestamp ?? null;
    const lastHistoryBalance = history[history.length - 1]?.totalBalance ?? null;
    if (history.length === 0 || lastHistoryBalance == null || Math.abs(totalBalance - lastHistoryBalance) > 1e-8) {
      history.push({ timestamp: latestOperationTime ?? Date.now(), totalBalance });
    }

    const dailyPnlDetails = buildOperationDailyPnlDetails(tradeHistory);

    return {
      totalBalance,
      todayPnl,
      todayPnlPct,
      accounts: [
        {
          label: "合约",
          labelEn: "Futures",
          balance: futuresEquity,
          available: balance,
          // 冻结 = 被持仓占用的保证金 + 未实现盈亏，这部分划不走
          frozen: futuresEquity - balance,
        },
        { label: "资金", labelEn: "Funding", balance: fundingBalance, available: fundingBalance, frozen: 0 },
        { label: "现货", labelEn: "Spot", balance: spotBalance, available: spotBalance, frozen: 0 },
      ],
      history,
      dailyPnl,
      dailyPnlDetails,
    };
  }, [balance, spotBalance, fundingBalance, positionsMap, displayPriceMap, tradeHistory, profile]);

  useEffect(() => {
    const canonicalPrice = Number(currentPrice || 0);
    if (Number.isFinite(canonicalPrice) && canonicalPrice > 0) {
      latestChartPriceRef.current = canonicalPrice;
      if (activeCoinState.status !== "playing") {
        activeDisplayPriceRef.current = canonicalPrice;
        renderedDisplayPriceRef.current = canonicalPrice;
        lastDisplayPriceFrameRef.current = 0;
        setActiveDisplayPrice(canonicalPrice);
      }
      return;
    }

    const visPrice = Number(latestVisiblePrice || 0);
    if (Number.isFinite(visPrice) && visPrice > 0) {
      // Local fallback only. Do not write interval-derived prices into priceMap,
      // otherwise each timeframe overwrites the shared "latest price".
      latestChartPriceRef.current = visPrice;
      if (activeCoinState.status !== "playing") {
        activeDisplayPriceRef.current = visPrice;
        renderedDisplayPriceRef.current = visPrice;
        lastDisplayPriceFrameRef.current = 0;
        setActiveDisplayPrice(visPrice);
      }
    }
  }, [activeCoinState.status, latestVisiblePrice, currentPrice]);

  useEffect(() => {
    const resetPrice = currentPriceRef.current || latestVisiblePriceRef.current || 0;
    if (resetPrice > 0) {
      activeDisplayPriceRef.current = resetPrice;
      renderedDisplayPriceRef.current = resetPrice;
      lastDisplayPriceFrameRef.current = 0;
      setActiveDisplayPrice(resetPrice);
    }
  }, [activeSymbol, interval]);

  const prevVisibleLenRef = useRef(0);

  // ===== MATCHING ENGINE for active symbol =====
  useEffect(() => {
    if (visibleData.length <= prevVisibleLenRef.current) {
      prevVisibleLenRef.current = visibleData.length;
      return;
    }

    const newKlines = visibleData.slice(prevVisibleLenRef.current);
    prevVisibleLenRef.current = visibleData.length;

    const symbolOrders = ordersMap[activeSymbol];
    if (!symbolOrders || symbolOrders.length === 0) return;

    const filledIds: string[] = [];

    for (const kline of newKlines) {
      setOrdersMap((prev) => {
        const orders = prev[activeSymbol] || [];
        if (orders.length === 0) return prev;
        const remaining: PendingOrder[] = [];

        for (const order of orders) {
          if (filledIds.includes(order.id)) continue;
          if (order.type === "CONDITIONAL") {
            remaining.push(order);
            continue;
          }

          let triggered = false;
          let fillPrice = 0;
          let isMaker = true;
          let convertToLimit = false;
          let updatedOrder = { ...order } as PendingOrder;

          switch (order.type) {
            case "LIMIT":
            case "POST_ONLY": {
              if (order.side === "LONG" && kline.low <= order.price) {
                triggered = true;
                fillPrice = order.price;
              } else if (order.side === "SHORT" && kline.high >= order.price) {
                triggered = true;
                fillPrice = order.price;
              }
              break;
            }
            case "MARKET_TP_SL": {
              // Use triggerDirection instead of order.side for trigger check
              const dir = order.triggerDirection || (order.side === "LONG" ? "UP" : "DOWN");
              if (dir === "UP" && kline.high >= order.stopPrice) {
                triggered = true;
                fillPrice = order.stopPrice;
                isMaker = false;
              } else if (dir === "DOWN" && kline.low <= order.stopPrice) {
                triggered = true;
                fillPrice = order.stopPrice;
                isMaker = false;
              }
              break;
            }
            case "LIMIT_TP_SL": {
              const dir = order.triggerDirection || (order.side === "LONG" ? "UP" : "DOWN");
              const triggerHit =
                (dir === "UP" && kline.high >= order.stopPrice) || (dir === "DOWN" && kline.low <= order.stopPrice);
              if (triggerHit) {
                if (order.side === "LONG" && kline.low <= order.price) {
                  triggered = true;
                  fillPrice = order.price;
                } else if (order.side === "SHORT" && kline.high >= order.price) {
                  triggered = true;
                  fillPrice = order.price;
                } else {
                  convertToLimit = true;
                  updatedOrder = { ...order, type: "LIMIT", status: "ACTIVE" } as PendingOrder;
                }
              }
              break;
            }
            case "TRAILING_STOP": {
              const rate = order.callbackRate || 0.01;
              if (!order.trailingActivated) {
                if (order.stopPrice > 0) {
                  const activateHit =
                    (order.side === "LONG" && kline.high >= order.stopPrice) ||
                    (order.side === "SHORT" && kline.low <= order.stopPrice);
                  if (activateHit) {
                    updatedOrder = {
                      ...order,
                      trailingActivated: true,
                      peakPrice: order.side === "LONG" ? kline.high : undefined,
                      troughPrice: order.side === "SHORT" ? kline.low : undefined,
                    };
                    convertToLimit = true;
                  } else {
                    remaining.push(order);
                    continue;
                  }
                } else {
                  updatedOrder = {
                    ...order,
                    trailingActivated: true,
                    peakPrice: order.side === "LONG" ? kline.high : undefined,
                    troughPrice: order.side === "SHORT" ? kline.low : undefined,
                  };
                }
              }
              if (updatedOrder.trailingActivated || order.trailingActivated) {
                const src = updatedOrder.trailingActivated ? updatedOrder : order;
                if (src.side === "LONG") {
                  const peak = Math.max(src.peakPrice || 0, kline.high);
                  const triggerLevel = peak * (1 - rate);
                  // Fix: fill at triggerLevel, not kline.close
                  if (kline.low <= triggerLevel) {
                    triggered = true;
                    fillPrice =
                      src.trailingExecType === "LIMIT" ? src.trailingLimitPrice || triggerLevel : triggerLevel;
                    isMaker = src.trailingExecType === "LIMIT";
                  } else {
                    convertToLimit = true;
                    updatedOrder = { ...src, peakPrice: peak, trailingActivated: true };
                  }
                } else {
                  const trough = Math.min(src.troughPrice || Infinity, kline.low);
                  const triggerLevel = trough * (1 + rate);
                  // Fix: fill at triggerLevel, not kline.close
                  if (kline.high >= triggerLevel) {
                    triggered = true;
                    fillPrice =
                      src.trailingExecType === "LIMIT" ? src.trailingLimitPrice || triggerLevel : triggerLevel;
                    isMaker = src.trailingExecType === "LIMIT";
                  } else {
                    convertToLimit = true;
                    updatedOrder = { ...src, troughPrice: trough, trailingActivated: true };
                  }
                }
              }
              break;
            }
            default:
              break;
          }

          if (triggered) {
            const matchedOrder = order;

            // === PRICE PROTECTION: anti-scam-wick check for conditional orders ===
            const isConditionalType = ["MARKET_TP_SL", "LIMIT_TP_SL", "CONDITIONAL", "TRAILING_STOP"].includes(
              matchedOrder.type,
            );
            if (isConditionalType && priceProtectionRef.current) {
              const markPrice = (kline.open + kline.high + kline.low + kline.close) / 4;
              const deviation = Math.abs(kline.close - markPrice) / markPrice;
              if (deviation > PRICE_PROTECTION_THRESHOLD) {
                toast.warning(`⚠️ 价格保护已触发`, {
                  description: `条件单 ${matchedOrder.id.slice(0, 8)} 由于最新价与标记价格偏差 ${(deviation * 100).toFixed(2)}% > 2%，未被执行`,
                  duration: 6000,
                });
                remaining.push(order);
                continue;
              }
            }

            filledIds.push(matchedOrder.id);
            const simulatedTime = getEffectiveTime(activeSymbol);
            const { fee, margin, position } = executeSettlementFill(
              activeSymbol,
              fillPrice,
              matchedOrder,
              isMaker,
              simulatedTime,
              { high: kline.high, low: kline.low, close: kline.close },
            );
            const actualFillPrice = position.entryPrice;
            setFilledOrders(prev => upsertOrderSnapshot(prev, {
                id: matchedOrder.id,
                symbol: activeSymbol,
                side: matchedOrder.side,
                type: matchedOrder.type,
                reduceOnly: matchedOrder.reduceOnly ?? false,
                reduceKind: matchedOrder.reduceKind ?? null,
                linkedPositionId: matchedOrder.linkedPositionId ?? null,
                price: actualFillPrice,
                triggerPrice: fillPrice,
                quantity: matchedOrder.quantity,
                contracts: matchedOrder.contracts,
                leverage: matchedOrder.leverage,
                settlementMode: matchedOrder.settlementMode,
                settlementAsset: matchedOrder.settlementAsset,
                contractSizeUsd: matchedOrder.contractSizeUsd,
                createdAt: matchedOrder.createdAt,
                filledAt: simulatedTime,
                positionId: position.id,
              }));
            setBalance((prev) => prev - margin - fee);
            setPositionsMap((prev) => {
              const existing = (prev[activeSymbol] || []).filter(isPositionOpen);
              return {
                ...prev,
                [activeSymbol]: [...existing, position],
              };
            });
            // 执行力资产只奖励做多开仓；做空都是辅助对冲单，不计分。
            if (matchedOrder.side === 'LONG') {
              const trade: ExecutionTradeSnapshot = {
                symbol: activeSymbol,
                side: matchedOrder.side,
                orderType: matchedOrder.type,
                entryPrice: actualFillPrice,
                quantity: getPositionUnits(position),
                leverage: matchedOrder.leverage,
                marginMode: matchedOrder.marginMode,
                settlementMode: position.settlementMode,
                settlementAsset: position.settlementAsset,
                contractSizeUsd: position.contractSizeUsd,
                contracts: position.contracts,
                marginCoin: position.marginCoin,
                margin,
                notional: getPositionNotionalUsd(activeSymbol, position, actualFillPrice),
                notionalUsd: getPositionNotionalUsd(activeSymbol, position, actualFillPrice),
                simulatedTime,
                positionId: position.id,
              };
              recordExecutionTrade(matchedOrder.tradingMode ?? tradingMode, trade);
            }
            toast.success(
              `委托成交: ${matchedOrder.side === "LONG" ? "开多" : "开空"} ${formatSettlementQuantity(position, activeSymbol)} @ ${actualFillPrice.toFixed(2)}`,
            );
          } else if (convertToLimit) {
            remaining.push(updatedOrder);
          } else {
            remaining.push(order);
          }
        }

        return { ...prev, [activeSymbol]: remaining };
      });
    }
  }, [visibleData.length, activeSymbol, recordExecutionTrade, tradingMode, getEffectiveTime, setFilledOrders]);

  // ===== TWAP ENGINE =====
  useEffect(() => {
    if (activeCoinState.status !== "playing" || currentPrice <= 0) return;

    for (const [symbol, orders] of Object.entries(ordersMap)) {
      const price = priceMap[symbol] || 0;
      if (price <= 0) continue;
      const twapOrders = orders.filter((o) => o.type === "TWAP");
      if (twapOrders.length === 0) continue;

      setOrdersMap((prev) => {
        let changed = false;
        const symOrders = prev[symbol] || [];
        const updated = symOrders
          .map((order) => {
            if (order.type !== "TWAP") return order;
            const now = effectiveSimTime;
            if (
              order.twapFilledQty !== undefined &&
              order.twapTotalQty !== undefined &&
              order.twapFilledQty >= order.twapTotalQty
            ) {
              changed = true;
              return null;
            }
            if (order.twapNextExecTime && now >= order.twapNextExecTime) {
              const totalQty = order.twapTotalQty || order.quantity;
              const intervalMs = order.twapInterval || 300000;
              const endTime = order.twapEndTime || order.createdAt + 3600000;
              const totalSlices = Math.max(1, Math.floor((endTime - order.createdAt) / intervalMs));
              const rawSliceQty = totalQty / totalSlices;
              const sliceQty = isCoinSettled(order) ? Math.max(1, Math.round(rawSliceQty)) : rawSliceQty;
              const filledSoFar = order.twapFilledQty || 0;

              if (filledSoFar + sliceQty <= totalQty + (isCoinSettled(order) ? 0 : 0.0001) && now < endTime) {
                const sliceOrder: PendingOrder = {
                  ...order,
                  quantity: sliceQty,
                  contracts: isCoinSettled(order) ? sliceQty : order.contracts,
                };
                const { fee, margin, position } = executeSettlementFill(
                  symbol,
                  price,
                  sliceOrder,
                  false,
                  getEffectiveTime(symbol),
                );
                setBalance((b) => b - margin - fee);
                setPositionsMap((p) => {
                  const existing = (p[symbol] || []).filter(isPositionOpen);
                  return {
                    ...p,
                    [symbol]: [...existing, position],
                  };
                });
                changed = true;
                return {
                  ...order,
                  twapFilledQty: filledSoFar + sliceQty,
                  twapNextExecTime: order.twapNextExecTime! + intervalMs,
                };
              } else {
                changed = true;
                return null;
              }
            }
            return order;
          })
          .filter(Boolean) as PendingOrder[];

        return changed ? { ...prev, [symbol]: updated } : prev;
      });
    }
  }, [effectiveSimTime, activeCoinState.status, ordersMap, priceMap, getEffectiveTime]);

  // ===== ISOLATED-MODE HANDLERS =====
  const handlePause = useCallback(() => {
    if (timeMode === "isolated") {
      const now = Date.now();
      setCoinTimelines((prev) => {
        const ct = prev[activeSymbol];
        if (!ct || ct.status !== "playing") return prev;
        const frozenTime =
          ct.historicalAnchorTime != null && ct.realStartTime
            ? ct.historicalAnchorTime + (now - ct.realStartTime) * ct.speed * timeDirection
            : ct.time;
        return {
          ...prev,
          [activeSymbol]: { ...ct, status: "paused", time: frozenTime, realStartTime: null },
        };
      });
    } else {
      sim.pauseSimulation();
    }
  }, [timeMode, activeSymbol, sim, timeDirection]);

  const handleResume = useCallback(() => {
    if (timeMode === "isolated") {
      const now = Date.now();
      setCoinTimelines((prev) => {
        const ct = prev[activeSymbol];
        if (!ct || ct.status !== "paused") return prev;
        return {
          ...prev,
          [activeSymbol]: { ...ct, status: "playing", historicalAnchorTime: ct.time, realStartTime: now },
        };
      });
    } else {
      sim.resumeSimulation();
    }
  }, [timeMode, activeSymbol, sim]);

  const handleSetSpeed = useCallback(
    (speed: number) => {
      if (timeMode === "isolated") {
        const now = Date.now();
        setCoinTimelines((prev) => {
          const ct = prev[activeSymbol];
          if (!ct || ct.status !== "playing") {
            const next = {
              ...prev,
              [activeSymbol]: {
                ...(ct || {
                  status: "paused",
                  time: 0,
                  historicalAnchorTime: null,
                  realStartTime: null,
                  originTime: null,
                }),
                speed,
              },
            };
            coinTimelinesRef.current = next;
            return next;
          }
          const currentTime =
            ct.historicalAnchorTime != null && ct.realStartTime
              ? ct.historicalAnchorTime + (now - ct.realStartTime) * ct.speed * timeDirection
              : ct.time;
          const next = {
            ...prev,
            [activeSymbol]: { ...ct, speed, time: currentTime, historicalAnchorTime: currentTime, realStartTime: now },
          };
          coinTimelinesRef.current = next;
          return next;
        });
      } else {
        sim.setSpeed(speed);
      }
    },
    [timeMode, activeSymbol, sim, timeDirection],
  );

  // 倒放触底自动暂停要在 RAF 里调用；handlePause 依赖会变，走 ref 保持最新。
  useEffect(() => {
    handlePauseRef.current = handlePause;
  }, [handlePause]);

  // ===== Symbol switch: reload chart data =====
  const handleSymbolChange = useCallback(
    async (newSymbol: string) => {
      if (newSymbol === activeSymbol) return;

      setActiveSymbol(newSymbol);
      // Clear stale price to prevent cross-symbol pollution on chart
      latestChartPriceRef.current = 0;
      activeDisplayPriceRef.current = 0;
      renderedDisplayPriceRef.current = 0;
      setActiveDisplayPrice(0);
      setPriceMap((prev) => {
        if (!prev[newSymbol]) return prev;
        const next = { ...prev };
        delete next[newSymbol];
        return next;
      });
      reset();
      prevVisibleLenRef.current = 0;
      cursorRef.current = 0;
      gameLoopInitRef.current = false;

      if (timeMode === "isolated") {
        const targetState = coinTimelines[newSymbol];
        if (targetState && targetState.status !== "stopped" && targetState.time > 0) {
          const data = await initLoad(newSymbol, interval, targetState.time, { reverse: timeDirection === -1 });
          if (data.length > 0) {
            toast.info(`已切换到 ${newSymbol}`, { description: `加载 ${data.length} 根K线` });
          }
          // Sync sim React state to the new coin's time for engines
          sim.syncReactState(targetState.time);
        }
        // If coin not started yet, show empty state - user needs to click Start
      } else {
        // Synced mode
        if (sim.status !== "stopped") {
          const targetTime = sim.currentSimulatedTime;
          const data = await initLoad(newSymbol, interval, targetTime, { reverse: timeDirection === -1 });
          if (data.length > 0) {
            toast.info(`已切换到 ${newSymbol}`, { description: `加载 ${data.length} 根K线` });
          }
        }
      }
    },
    [activeSymbol, sim.status, sim.currentSimulatedTime, interval, initLoad, reset, timeMode, coinTimelines],
  );

  const handleIntervalChange = useCallback(
    async (newInterval: string) => {
      if (newInterval === interval) return;
      setIntervalVal(newInterval);
      reset();
      prevVisibleLenRef.current = 0;
      cursorRef.current = 0;
      gameLoopInitRef.current = false;
      latestChartPriceRef.current = 0;

      if (activeCoinState.status !== "stopped") {
        await initLoad(activeSymbol, newInterval, effectiveSimTime, { reverse: timeDirection === -1 });
      }
    },
    [activeSymbol, interval, activeCoinState.status, effectiveSimTime, initLoad, reset],
  );

  const handleStart = useCallback(
    async (timestamp: number) => {
      const data = await initLoad(activeSymbol, interval, timestamp, { reverse: timeDirection === -1 });
      if (data.length > 0) {
        prevVisibleLenRef.current = 0;
        gameLoopInitRef.current = false;
        lastReverseSimTimeRef.current = null;

        // 倒叙播放下启动：起点吸附到 K 线开盘并记为本次倒放的镜面 cap。
        const startTs = timeDirection === -1 ? snapToBarStart(timestamp, iMs) : timestamp;
        if (timeDirection === -1) setReverseCapTime(startTs);

        if (timeMode === "isolated") {
          const now = Date.now();
          setCoinTimelines((prev) => ({
            ...prev,
            [activeSymbol]: {
              status: "playing",
              time: startTs,
              speed: 1,
              historicalAnchorTime: startTs,
              realStartTime: now,
              originTime: startTs,
              reverseCapTime: timeDirection === -1 ? startTs : null,
            },
          }));
          if (sim.status === "stopped") {
            sim.startSimulation(startTs);
          }
        } else {
          setSyncedOriginTime(startTs);
          sim.startSimulation(startTs);
        }
        toast.success("时间机器已启动", {
          description: timeDirection === -1
            ? `已加载 ${data.length} 根K线 · 倒叙播放：更早的 K 线将逐帧出现`
            : `已加载 ${data.length} 根K线 · 向左拖动可加载更多历史数据`,
        });
      } else {
        toast.error("数据获取失败", { description: "请检查时间范围和交易对" });
      }
    },
    [activeSymbol, interval, iMs, initLoad, sim, timeMode, timeDirection, setReverseCapTime, profile],
  );

  // ===== Signal-library jump: switch symbol + start time machine atomically =====
  // 从「信号库」下拉点开某标的时调用，越过手动输入标的/时间，直接定位盘面。
  const handleJumpToSignal = useCallback(
    async (symbol: string, timeMs: number): Promise<SignalJumpResult> => {
      const normalized = symbol.toUpperCase().replace(/[\s/]+/g, "");

      // 关键：先取数，确认拿到数据后，才改任何共享状态。
      // 「信号库」（按信号自动启动）与「手动启动」必须相互独立——一次失败的跳转
      // 绝不能污染手动模式。因此在 initLoad 成功前，不切换 activeSymbol、不清空行情、
      // 不重置数据层；失败时直接返回，手动模式所见状态原封不动。
      let data = await initLoad(normalized, interval, timeMs, { reverse: timeDirection === -1 });
      let coversSignalTime = hasKlineCoveringSignalTime(data, timeMs, iMs);

      if (!coversSignalTime) {
        const diagnostic = await diagnoseSignalJump(normalized, timeMs, interval, iMs);

        // 首次取数可能刚好碰上短暂请求抖动；诊断确认行情存在时只重试一次，
        // 不把可恢复问题错误写成信号库的永久标记。
        if (diagnostic.status === "available") {
          data = await initLoad(normalized, interval, timeMs, { reverse: timeDirection === -1 });
          coversSignalTime = hasKlineCoveringSignalTime(data, timeMs, iMs);
        }

        if (!coversSignalTime) {
          if (diagnostic.status === "fatal") {
            toast.error("该信号无法跳转", { description: diagnostic.issue.reason });
            return { ok: false, fatalIssue: diagnostic.issue, reason: diagnostic.issue.reason };
          }
          const reason = diagnostic.status === "retryable"
            ? diagnostic.reason
            : `无法加载 ${normalized} 在该信号时刻的 K 线`;
          toast.error("行情暂时不可用", {
            description: `${reason}。本次不会把信号标记为永久失效。`,
          });
          return { ok: false, reason };
        }
      }

      // 取数成功——此时才原子地切换标的并清理该标的的旧缓存。
      if (normalized !== activeSymbol) {
        setActiveSymbol(normalized);
        latestChartPriceRef.current = 0;
        activeDisplayPriceRef.current = 0;
        renderedDisplayPriceRef.current = 0;
        setActiveDisplayPrice(0);
        setPriceMap((prev) => {
          if (!prev[normalized]) return prev;
          const next = { ...prev };
          delete next[normalized];
          return next;
        });
      }
      prevVisibleLenRef.current = 0;
      cursorRef.current = 0;
      gameLoopInitRef.current = false;
      lastReverseSimTimeRef.current = null;

      // 倒叙播放下跳转：同 handleStart，起点吸附并记镜面 cap。
      const startTs = timeDirection === -1 ? snapToBarStart(timeMs, iMs) : timeMs;
      if (timeDirection === -1) setReverseCapTime(startTs);

      if (timeMode === "isolated") {
        const now = Date.now();
        setCoinTimelines((prev) => ({
          ...prev,
          [normalized]: {
            status: "playing",
            time: startTs,
            speed: 1,
            historicalAnchorTime: startTs,
            realStartTime: now,
            originTime: startTs,
            reverseCapTime: timeDirection === -1 ? startTs : null,
          },
        }));
        if (sim.status === "stopped") sim.startSimulation(startTs);
      } else {
        setSyncedOriginTime(startTs);
        sim.startSimulation(startTs);
      }
      toast.success(`已跳转到 ${normalized}`, {
        description: `时间机器已定位到信号时间 · 加载 ${data.length} 根K线`,
      });
      return { ok: true };
    },
    [
      activeSymbol, interval, iMs, initLoad, sim, timeMode, timeDirection, setReverseCapTime,
      setActiveSymbol, setPriceMap, setCoinTimelines, setSyncedOriginTime,
    ],
  );

  // ===== STATE GUARD: time mode switch =====
  const handleSetTimeMode = useCallback(
    (newMode: "synced" | "isolated") => {
      if (newMode === timeMode) return;

      if (totalPositionCount > 0) {
        toast.error(`无法切换模式`, {
          description: `有 ${totalPositionCount} 笔持仓，需全部平仓后才能切换模式。`,
          duration: 5000,
        });
        return;
      }

      // Defensive guard only; primary interception happens in explicit click handlers.
      if (newMode === "synced" && timeMode === "isolated") {
        const hasRunningCoins = Object.values(coinTimelines).some(
          (ct) => ct.status === "playing" || ct.status === "paused",
        );
        if (hasRunningCoins) return;
      }

      setTimeMode(newMode);
      if (newMode === "synced") {
        setCoinTimelines({});
      }
    },
    [timeMode, coinTimelines, totalPositionCount, setTimeMode, setCoinTimelines],
  );

  // State for mode switch confirmation dialog
  const [modeSwitchDialogOpen, setModeSwitchDialogOpen] = useState(false);

  const handleStopAllAndSwitchToSynced = useCallback(() => {
    if (timeMode !== "isolated") {
      handleSetTimeMode("synced");
      return;
    }
    // Show confirmation dialog
    setModeSwitchDialogOpen(true);
  }, [timeMode, handleSetTimeMode]);

  const confirmStopAllAndSwitch = useCallback(() => {
    setModeSwitchDialogOpen(false);

    // Close all positions across all symbols
    for (const [sym, positions] of Object.entries(positionsMap)) {
      const price = priceMap[sym] || 0;
      if (price <= 0) continue;
      for (let i = positions.length - 1; i >= 0; i--) {
        handleClosePosition(sym, i);
      }
    }

    // Cancel all orders
    for (const [sym, orders] of Object.entries(ordersMap)) {
      for (const order of orders) {
        handleCancelOrder(sym, order.id);
      }
    }

    // Full state cleanup — garbage collection
    reset();
    prevVisibleLenRef.current = 0;
    cursorRef.current = 0;
    gameLoopInitRef.current = false;
    clearSimState();
    setSyncedOriginTime(null);
    sim.stopSimulation();
    setCoinTimelines({});
    // isolatedBalances removed — single global pool
    setTimeMode("synced");

    toast.success("已合并所有币种时间轴并切换到同步模式");
  }, [
    positionsMap,
    priceMap,
    handleClosePosition,
    ordersMap,
    handleCancelOrder,
    reset,
    sim,
    setCoinTimelines,
    setTimeMode,
  ]);

  const handleStop = useCallback(() => {
    if (timeMode === "isolated") {
      // Stop only the active coin
      const positions = positionsMap[activeSymbol] || [];
      const price = priceMap[activeSymbol] || 0;
      if (price > 0) {
        for (let i = positions.length - 1; i >= 0; i--) {
          handleClosePosition(activeSymbol, i);
        }
      }
      const orders = ordersMap[activeSymbol] || [];
      for (const order of orders) {
        handleCancelOrder(activeSymbol, order.id);
      }
      setCoinTimelines((prev) => ({
        ...prev,
        [activeSymbol]: {
          ...(prev[activeSymbol] || { speed: 1, historicalAnchorTime: null, realStartTime: null, originTime: null }),
          status: "stopped",
          time: 0,
        },
      }));
      reset();
      prevVisibleLenRef.current = 0;
      // If no other coins are playing, also stop global sim
      const anyOtherPlaying = Object.entries(coinTimelines).some(
        ([sym, ct]) => sym !== activeSymbol && ct.status === "playing",
      );
      if (!anyOtherPlaying) {
        clearSimState();
        sim.stopSimulation();
      }
      toast.info(`⏹ ${activeSymbol} 模拟已停止`);
    } else {
      // Synced: stop everything
      for (const [sym, positions] of Object.entries(positionsMap)) {
        const price = priceMap[sym] || 0;
        if (price <= 0) continue;
        for (let i = positions.length - 1; i >= 0; i--) {
          handleClosePosition(sym, i);
        }
      }
      for (const [sym, orders] of Object.entries(ordersMap)) {
        for (const order of orders) {
          handleCancelOrder(sym, order.id);
        }
      }
      reset();
      prevVisibleLenRef.current = 0;
      clearSimState();
      setSyncedOriginTime(null);
      sim.stopSimulation();
      toast.info("⏹ 模拟已停止，所有仓位已结算");
    }
  }, [
    positionsMap,
    ordersMap,
    priceMap,
    handleClosePosition,
    handleCancelOrder,
    reset,
    sim,
    timeMode,
    activeSymbol,
    coinTimelines,
  ]);

  // Wrapper for OrderPanel
  const handlePlaceOrderForActiveSymbol = useCallback(
    (order: PlaceOrderParams) => {
      const freshPrice = latestChartPriceRef.current || priceMap[activeSymbol] || currentPrice;
      console.log("[下单按钮]", {
        latestChartPriceRef: latestChartPriceRef.current,
        priceMap: priceMap[activeSymbol],
        currentPrice,
        最终传递: freshPrice,
      });
      return handlePlaceOrder(activeSymbol, {
        ...order,
        latestPrice: freshPrice,
      });
    },
    [activeSymbol, currentPrice, priceMap, handlePlaceOrder],
  );

  // Pause the active timeline when the pre-trade snapshot dialog opens
  const handleAutoPauseTimeMachine = useCallback(() => {
    const playing = timeMode === "synced"
      ? sim.status === "playing"
      : coinTimelines[activeSymbol]?.status === "playing";
    if (playing) handlePause();
  }, [timeMode, sim.status, coinTimelines, activeSymbol, handlePause]);

  const handleClosePositionForSymbol = useCallback(
    (symbol: string, index: number, percentage?: number) => {
      handleClosePosition(symbol, index, percentage);
    },
    [handleClosePosition],
  );

  const handleCancelOrderForSymbol = useCallback(
    (symbol: string, orderId: string) => {
      handleCancelOrder(symbol, orderId);
    },
    [handleCancelOrder],
  );

  const handleCloseAllPositions = useCallback(
    (items: { symbol: string; index: number }[]) => {
      // Close in reverse index order to avoid index shifting
      const sorted = [...items].sort((a, b) => b.index - a.index);
      for (const { symbol, index } of sorted) {
        handleClosePosition(symbol, index);
      }
    },
    [handleClosePosition],
  );

  const handleCrosshairPriceChange = useCallback((price: number | null) => {
    setCrosshairPrice(price);
  }, []);

  const handlePricePicked = useCallback((price: number) => {
    setPickedPrice(price);
  }, []);

  const isMobile = useIsMobile();

  // Mobile layout
  if (isMobile) {
    return (
      <MobileLayout
        symbol={activeSymbol}
        interval={interval}
        onSymbolChange={handleSymbolChange}
        onIntervalChange={handleIntervalChange}
        status={activeCoinState.status}
        currentSimulatedTime={activeCoinState.time}
        speed={activeCoinState.speed}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        onSetSpeed={handleSetSpeed}
        visibleData={displayData}
        onLoadOlder={loadOlder}
        loadingOlder={loadingOlder}
        currentPrice={displayCurrentPrice}
        disabled={activeCoinState.status === "stopped" || displayCurrentPrice === 0}
        onPlaceOrder={handlePlaceOrderForActiveSymbol}
        balance={balance}
        positionsMap={positionsMap}
        ordersMap={ordersMap}
        priceMap={displayPriceMap}
        tradeHistory={tradeHistory}
        activeSymbol={activeSymbol}
        onClosePosition={handleClosePositionForSymbol}
        onCancelOrder={handleCancelOrderForSymbol}
        onAutoPauseTimeMachine={handleAutoPauseTimeMachine}
      />
    );
  }

  // Desktop layout
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-50 dark:bg-[#0b0e11]">
      <header className="border-b border-gray-200 dark:border-[#2b3139] px-4 py-1.5 flex items-center justify-between shrink-0 bg-white dark:bg-[#1e2329] gap-2 min-h-[36px]">
        <div className="flex items-center gap-4 min-w-0 shrink-0">
          <ThemeToggle />
          <h1 className="text-xs font-bold text-primary tracking-widest uppercase whitespace-nowrap shrink-0">
            ⚡ 无知之幕
          </h1>
          <Link
            to="/guide"
            className="ml-3 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <BookOpen className="h-3 w-3" />
            <span>使用说明</span>
          </Link>
          <SymbolSelector
            symbol={activeSymbol}
            interval={interval}
            onSymbolChange={handleSymbolChange}
            onIntervalChange={handleIntervalChange}
            onPrecisionChange={(pp, qp) => {
              setPricePrecision(pp);
              setQuantityPrecision(qp);
            }}
          />
        </div>
        <SessionModeControls
          timeMode={timeMode}
          onSetTimeMode={handleSetTimeMode}
          onStopAllAndSwitchToSynced={handleStopAllAndSwitchToSynced}
          totalPositionCount={totalPositionCount}
          coinTimelines={coinTimelines}
          onSymbolChange={handleSymbolChange}
        />
        <div className="flex items-center gap-3 shrink-0">
          {loading && <span className="text-[10px] text-primary animate-pulse font-mono">加载历史数据...</span>}
          <JournalNavMenu
            onOpenAssets={() => setAssetsOpen(true)}
          />
          <span className="text-[10px] text-gray-500 dark:text-[#848e9c] font-mono truncate max-w-[120px]">
            {user?.email}
          </span>
          <button
            onClick={signOut}
            className="text-[10px] text-gray-600 dark:text-[#B7BDC6] hover:text-destructive font-medium transition-colors"
          >
            登出
          </button>
        </div>
      </header>

      <div className="shrink-0 bg-white dark:bg-[#1e2329] border-b border-gray-200 dark:border-[#2b3139]">
        <TimeControl
          status={activeCoinState.status}
          currentSimulatedTime={activeCoinState.time}
          speed={activeCoinState.speed}
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onSetSpeed={handleSetSpeed}
          clockRef={clockRef}
          timeMode={timeMode}
          onSymbolChange={handleSymbolChange}
          onJumpToSignal={handleJumpToSignal}
          signalJumpInterval={interval}
          signalJumpIntervalMs={iMs}
          originTime={activeCoinState.originTime}
          activeSymbol={activeSymbol}
        />
      </div>

      <div className="shrink-0">
        <AccountInfo
          balance={balance}
          positionsMap={positionsMap}
          priceMap={displayPriceMap}
          timeMode={timeMode}
          activeSymbol={activeSymbol}
        />
      </div>

      {/* ===== Resizable Pro Grid (Binance/TradingView-style) =====
          Viewport lock: enforce min width so layout never wraps/squishes;
          allow horizontal scroll on small viewports. */}
      <div className="h-[calc(100vh-64px)] min-h-0 w-full min-w-[1200px] overflow-x-auto overflow-y-hidden bg-gray-50 dark:bg-[#0b0e11]">
        <ResizablePanelGroup direction="horizontal" className="h-full min-h-0 w-full">
          {/* Left main area (chart + orderbook + positions) */}
          <ResizablePanel defaultSize={75} minSize={60}>
            <ResizablePanelGroup direction="vertical" className="h-full w-full">
              {/* Top: Ticker + Chart + OrderBook */}
              <ResizablePanel defaultSize={70} minSize={50}>
                <div className="h-full w-full flex flex-col min-h-0">
                  {/* Ticker bar (fixed strip, not resizable) */}
                  <TickerBar
                    symbol={activeSymbol}
                    currentPrice={displayCurrentPrice}
                    visibleData={displayData}
                    pricePrecision={chartPricePrecision}
                    effectiveSimTime={effectiveSimTime}
                  />

                  {/* Chart vs OrderBook (horizontal resizable) */}
                  <div className="flex-1 min-h-0 min-w-0">
                    <ResizablePanelGroup
                      key={isOrderBookOpen ? "ob-open" : "ob-closed"}
                      direction="horizontal"
                      className="h-full w-full"
                    >
                      <ResizablePanel defaultSize={isOrderBookOpen ? 75 : 100} minSize={50}>
                        <div className="h-full w-full relative overflow-hidden bg-gray-50 dark:bg-[#0b0e11]">
                          {!isOrderBookOpen && (
                            <button
                              type="button"
                              onClick={() => setIsOrderBookOpen(true)}
                              title="显示订单簿"
                              className="absolute top-2 right-2 z-20 flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-white/90 dark:bg-[#1e2329]/90 border border-gray-200 dark:border-[#2b3139] text-gray-600 dark:text-[#848e9c] hover:text-gray-900 dark:hover:text-white shadow-sm cursor-pointer transition-colors"
                            >
                              <svg
                                className="w-3 h-3"
                                viewBox="0 0 12 12"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                              >
                                <path d="M2 3h8M2 6h8M2 9h8" strokeLinecap="round" />
                              </svg>
                              订单簿
                            </button>
                          )}
                          {activeCoinState.status === "stopped" && visibleData.length === 0 ? (
                            <div className="h-full flex items-center justify-center bg-gray-50 dark:bg-[#0b0e11]">
                              <div className="text-center space-y-3">
                                <div className="text-5xl">⏰</div>
                                <p className="text-sm text-gray-600 dark:text-[#B7BDC6]">
                                  输入历史时间并点击「启动」开始复盘模拟
                                </p>
                                <p className="text-xs text-gray-500 dark:text-[#848e9c]">
                                  K线按真实时间 1:1 流速推进 · 绝不暴露未来数据
                                </p>
                              </div>
                            </div>
                          ) : (
                            <MultiChartLayout
                              mainData={displayData}
                              mainSymbol={activeSymbol.replace("USDT", "/USDT")}
                              rawSymbol={activeSymbol}
                              onLoadOlder={timeDirection === -1 ? loadNewerVoid : loadOlder}
                              loadingOlder={loadingOlder}
                              tradeHistory={timeDirection === -1 ? EMPTY_TRADE_HISTORY : tradeHistory}
                              displayTimestampTransform={reverseAxisTransform}
                              isRunning={activeCoinState.status !== "stopped"}
                              currentSimulatedTime={activeCoinState.time}
                              mainInterval={interval}
                              onMainIntervalChange={handleIntervalChange}
                              speed={activeCoinState.speed}
                              onSetSpeed={handleSetSpeed}
                              pricePrecision={chartPricePrecision}
                              quantityPrecision={quantityPrecision}
                              pendingOrders={activeSymbolOrders}
                              onCancelOrder={(orderId) => handleCancelOrder(activeSymbol, orderId)}
                              chartApiRef={chartApiRef}
                              onCrosshairPriceChange={handleCrosshairPriceChange}
                              pickMode={pickMode}
                              onPricePicked={handlePricePicked}
                            />
                          )}
                        </div>
                      </ResizablePanel>

                      {isOrderBookOpen && (
                        <>
                          <ResizableHandle withHandle />
                          <ResizablePanel defaultSize={25} minSize={15} maxSize={35}>
                            <div className="h-full w-full min-w-0 flex flex-col bg-white dark:bg-[#1e2329] min-h-0 overflow-hidden">
                              {/* P_gap 在上、盘口在下。两者都展开时才需要可拖拽分隔；
                                  其余情形下折叠的一方缩成表头，空间全给展开的一方。 */}
                              {!isPGapCollapsed && !isMarketDataCollapsed ? (
                                <ResizablePanelGroup direction="vertical" className="h-full w-full">
                                  <ResizablePanel defaultSize={50} minSize={25}>
                                    <PGapPanel
                                      currentPrice={displayCurrentPrice}
                                      pricePrecision={chartPricePrecision}
                                      collapsed={false}
                                      onToggleCollapsed={() => setIsPGapCollapsed(true)}
                                      defaultWinRatePct={campaignWinRate.winRate == null ? null : campaignWinRate.winRate * 100}
                                      winRateSampleCount={campaignWinRate.resolvedCount}
                                      longEntryPrice={activeLongEntry.price}
                                      longPositionCount={activeLongEntry.count}
                                      longRiskAnchorPrice={activeLongRiskAnchor}
                                      symbol={activeSymbol}
                                    />
                                  </ResizablePanel>
                                  <ResizableHandle
                                    withHandle
                                    className="!h-[2px] bg-gray-200 dark:bg-[#2b3139] hover:bg-gray-300 dark:hover:bg-[#474d57] transition-colors cursor-row-resize"
                                  />
                                  <ResizablePanel defaultSize={50} minSize={22}>
                                    <MarketDataPanel
                                      symbol={activeSymbol}
                                      currentPrice={displayCurrentPrice}
                                      pricePrecision={chartPricePrecision}
                                      tab={marketDataTab}
                                      onTabChange={setMarketDataTab}
                                      collapsed={false}
                                      onToggleCollapsed={() => setIsMarketDataCollapsed(true)}
                                      onClose={() => setIsOrderBookOpen(false)}
                                    />
                                  </ResizablePanel>
                                </ResizablePanelGroup>
                              ) : (
                                <>
                                  <div className={isPGapCollapsed ? "flex-none" : "flex-1 min-h-0"}>
                                    <PGapPanel
                                      currentPrice={displayCurrentPrice}
                                      pricePrecision={chartPricePrecision}
                                      collapsed={isPGapCollapsed}
                                      onToggleCollapsed={() => setIsPGapCollapsed((v) => !v)}
                                      defaultWinRatePct={campaignWinRate.winRate == null ? null : campaignWinRate.winRate * 100}
                                      winRateSampleCount={campaignWinRate.resolvedCount}
                                      longEntryPrice={activeLongEntry.price}
                                      longPositionCount={activeLongEntry.count}
                                      longRiskAnchorPrice={activeLongRiskAnchor}
                                      symbol={activeSymbol}
                                    />
                                  </div>
                                  <div
                                    className={`border-t border-gray-200 dark:border-[#2b3139] ${
                                      isMarketDataCollapsed ? "flex-none" : "flex-1 min-h-0"
                                    }`}
                                  >
                                    <MarketDataPanel
                                      symbol={activeSymbol}
                                      currentPrice={displayCurrentPrice}
                                      pricePrecision={chartPricePrecision}
                                      tab={marketDataTab}
                                      onTabChange={setMarketDataTab}
                                      collapsed={isMarketDataCollapsed}
                                      onToggleCollapsed={() => setIsMarketDataCollapsed((v) => !v)}
                                      onClose={() => setIsOrderBookOpen(false)}
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          </ResizablePanel>
                        </>
                      )}
                    </ResizablePanelGroup>
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              {/* Bottom: Positions panel */}
              <ResizablePanel defaultSize={30} minSize={15}>
                <div className="h-full w-full bg-gray-50 dark:bg-[#0b0e11] flex flex-col overflow-hidden min-h-0">
                  <PositionPanel
                    positionsMap={positionsMap}
                    ordersMap={ordersMap}
                    tradeHistory={tradeHistory}
                    priceMap={displayPriceMap}
                    activeSymbol={activeSymbol}
                    onClosePosition={handleClosePositionForSymbol}
                    onCancelOrder={handleCancelOrderForSymbol}
                    onAddIsolatedMargin={handleAddIsolatedMargin}
                    onAdjustMargin={handleAdjustMargin}
                    availableBalance={getEffectiveAvailable(activeSymbol)}
                    balance={balance}
                    initialCapital={profile?.initial_capital ?? 1_000_000}
                    onClearSymbolData={handleClearSymbolData}
                    onPlaceTpSl={handlePlaceTpSl}
                    pricePrecision={chartPricePrecision}
                    activeTab={bottomTab}
                    onTabChange={setBottomTab}
                    onCloseAllPositions={handleCloseAllPositions}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right order panel */}
          <ResizablePanel defaultSize={25} minSize={20} maxSize={30} className="flex flex-col h-full min-h-0">
            <div className="flex flex-col flex-1 h-full min-h-0 w-full min-w-[300px] overflow-hidden bg-white dark:bg-[#1e2329] border-l border-gray-200 dark:border-[#2b3139]">
              <OrderPanel
                symbol={activeSymbol}
                currentPrice={displayCurrentPrice}
                disabled={activeCoinState.status === "stopped" || displayCurrentPrice === 0}
                onPlaceOrder={handlePlaceOrderForActiveSymbol}
                pricePrecision={chartPricePrecision}
                quantityPrecision={quantityPrecision}
                coolingOff={coolingOff.isActive}
                coolingOffLabel={coolingOff.isActive ? coolingOff.formatRemaining() : undefined}
                onOpenCoolingOff={() => setCoolingOffModalOpen(true)}
                panels={{ orderBook: isOrderBookOpen, pGap: !isPGapCollapsed }}
                onPanelChange={(key, visible) => {
                  if (key === 'orderBook') setIsOrderBookOpen(visible);
                  // P_gap 是「收起为标题栏」而非彻底隐藏，故取反
                  else setIsPGapCollapsed(!visible);
                }}
                priceProtection={priceProtection}
                onTogglePriceProtection={() => setPriceProtection((prev) => !prev)}
                crosshairPrice={crosshairPrice}
                pickMode={pickMode}
                onPickModeChange={setPickMode}
                pickedPrice={pickedPrice}
                onAutoPauseTimeMachine={handleAutoPauseTimeMachine}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <Dialog open={assetsOpen} onOpenChange={setAssetsOpen}>
        <DialogContent className="max-w-2xl p-0 bg-card">
          <AssetOverview assets={assetState} />
        </DialogContent>
      </Dialog>

      {perfSymbol && (
        <TradeInsightsPanel
          open={!!perfSymbol}
          onClose={() => setPerfSymbol(null)}
          initialSymbol={perfSymbol}
          tradeHistory={tradeHistory}
        />
      )}

      <LiquidationModal open={liquidationOpen} onClose={closeLiquidationModal} details={liquidationDetails} />

      <CoolingOffModal
        open={coolingOffModalOpen}
        onClose={() => setCoolingOffModalOpen(false)}
        onConfirm={(durationMs) => {
          coolingOff.activate(durationMs);
          setCoolingOffModalOpen(false);
        }}
      />

      {/* Mode Switch Confirmation Dialog */}
      <Dialog open={modeSwitchDialogOpen} onOpenChange={setModeSwitchDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>⚠️ 合并所有平行时间轴</DialogTitle>
            <DialogDescription>
              隔离模式下每个币种各有一条独立时钟，此刻停在各自不同的时刻。切回同步模式要把它们并成一条时间线，
              跨在不同时刻上的持仓与挂单无法一并搬过去，因此会先结清。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          {/* 这段文案曾经写「各币种的独立资金 / 独立沙盒账户将被销毁」——
              而 isolatedBalances 早已改成空对象 + 空操作 setter，资金一直是单一全局池。
              在一个不可撤销的确认框上夸大后果，会让人误以为切换要没收钱。逐条对着
              confirmStopAllAndSwitch 的实际行为重写，并补上「不受影响」那一半。 */}
          <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted-foreground space-y-1">
            <div>• 各币种的独立时钟清空，全部并到一条时间线</div>
            <div>• 所有未平仓位按当前价强制结算——是真平仓，会产生成交记录、盈亏计入余额</div>
            <div>• 所有挂单将被撤销</div>
            <div>• 时间机器停止，回放进度归零</div>
            <div className="pt-1 text-foreground/70">
              不受影响：账户余额、成交与仓位历史、交易战役、复盘记录、信号库
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={() => setModeSwitchDialogOpen(false)}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-all duration-100 ease-out hover:bg-accent active:scale-[0.97]"
            >
              取消
            </button>
            <button
              onClick={confirmStopAllAndSwitch}
              className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-all duration-100 ease-out hover:opacity-90 active:scale-[0.97]"
            >
              确认清除并切换
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
