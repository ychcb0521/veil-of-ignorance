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
import { OrderBook } from "@/components/OrderBook";
import { RecentTrades } from "@/components/RecentTrades";
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
import { toast } from "sonner";
import { Wallet, Crosshair, BookOpen, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { JournalNavMenu } from "@/components/journal/JournalNavMenu";
import type { PendingOrder } from "@/types/trading";
import { calcUnrealizedPnl } from "@/types/trading";
import type { ExecutionTradeSnapshot } from "@/lib/executionAssets";
import type { AssetState } from "@/types/assets";
import {
  POSITION_DUST_EPSILON,
  executeSettlementFill,
  formatSettlementQuantity,
  getPositionNotionalUsd,
  getPositionUnits,
  isCoinSettled,
  isPositionOpen,
  scaleSettlementPosition,
  settlePositionClose,
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
    setFilledOrders,
    priceMap,
    setPriceMap,
    balance,
    setBalance,
    isolatedBalances,
    tradeHistory,
    setTradeHistory,
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
    handleAddIsolatedMargin,
    handleAdjustMargin,
    handleClearSymbolData,
    liquidationOpen,
    liquidationDetails,
    closeLiquidationModal,
    timeMode,
    setTimeMode,
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

  const { allData, allDataRef, loading, loadingOlder, error, initLoad, loadOlder, getVisibleData, reset } =
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
  const [isOrderBookOpen, setIsOrderBookOpen] = useState(true);
  const [isRecentTradesOpen, setIsRecentTradesOpen] = useState(true);

  const coolingOff = useCoolingOff();
  const hasRestoredRef = useRef(false);
  const persistedSim = useMemo(() => loadPersistedSimState(), []);
  const restoredActive = persistedSim?.status === "playing" || persistedSim?.status === "paused";

  useEffect(() => {
    if (!restoredActive || hasRestoredRef.current || !persistedSim) return;
    hasRestoredRef.current = true;

    (async () => {
      const targetTime = persistedSim.currentSimulatedTime || persistedSim.historicalAnchorTime!;
      const data = await initLoad(persistedSim.symbol, persistedSim.interval, targetTime);
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

  const visibleData = useMemo(() => getVisibleData(effectiveSimTime, iMs), [getVisibleData, effectiveSimTime, iMs]);

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

  const latestVisiblePrice = useMemo(() => {
    const latest = visibleData[visibleData.length - 1];
    return Number(latest?.close ?? 0);
  }, [visibleData]);

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
  const activeSymbolRef = useRef(activeSymbol);
  const coinTimelinesRef = useRef(coinTimelines);
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
  const positionsMapRef = useRef(positionsMap);
  const priceMapRef = useRef(priceMap);
  const currentPriceRef = useRef(currentPrice);
  const latestVisiblePriceRef = useRef(latestVisiblePrice);
  const canonicalPriceRequestRef = useRef(0);
  const conditionalTriggerLocksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    timeModeRef.current = timeMode;
  }, [timeMode]);
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
    positionsMapRef.current = positionsMap;
  }, [positionsMap]);
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
  }, [ordersMap]);

  const DISPLAY_PRICE_FLUSH_MS = 33;
  const DISPLAY_PRICE_SMOOTHING_MS = 42;
  const DISPLAY_PRICE_SNAP_RATIO = 0.08;
  const REACT_FLUSH_MS = 250;
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
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) return;

      // === REDUCE-ONLY (TP/SL) PATH: close the linked position atomically ===
      if (order.reduceOnly && order.linkedPositionId) {
        const targetSymbol = order.reduceSymbol || symbol;
        // CRITICAL: read live positions via ref to bypass stale closures during high-speed ticks
        const positions = positionsMapRef.current[targetSymbol] || [];
        const linkedId = order.linkedPositionId;
        const pos = positions.find((p) => p.id === linkedId);
        if (!pos) {
          // Linked position no longer exists (manual close happened) — silently drop
          console.log("[TP/SL Skip] linked position missing", { orderId: order.id, linkedId });
          return;
        }
        const posUnits = getPositionUnits(pos);
        const closeUnits = Math.min(posUnits, getPositionUnits(order));
        const exitMethod = order.reduceKind === "TP" ? "tp1" : order.reduceKind === "SL" ? "sl" : "manual";
        const settledClose = settlePositionClose(targetSymbol, pos, entryPrice, closeUnits, openTime, exitMethod);
        if (!settledClose) return;
        const { closeQty, pct, remainingUnits, willFullyClose, returnedMargin, record, fillPrice, netPnl } = settledClose;

        console.log("[TP/SL Triggered]", {
          orderId: order.id,
          kind: order.reduceKind,
          linkedId,
          posSide: pos.side,
          triggerPrice: entryPrice,
          posQty: posUnits,
          closeQty,
        });

        setBalance((prev) => prev + Math.max(0, returnedMargin));

        // Physical destruction by id (not by stale index)
        setPositionsMap((prev) => {
          const list = prev[targetSymbol] || [];
          if (willFullyClose) {
            return { ...prev, [targetSymbol]: list.filter((p) => p.id !== linkedId && isPositionOpen(p)) };
          }
          const next = list
            .map((p) => {
              if (p.id !== linkedId) return p;
              return scaleSettlementPosition(p, remainingUnits);
            })
            .filter(isPositionOpen);
          return { ...prev, [targetSymbol]: next };
        });

        // OCO: drop the sibling TP/SL bound to the same position
        setOrdersMap((prev) => {
          const list = prev[targetSymbol] || [];
          if (list.length === 0) return prev;
          let changed = false;
          const next: PendingOrder[] = [];
          for (const o of list) {
            if (o.id === order.id) continue; // current already moved out by caller
            if (o.reduceOnly && o.linkedPositionId === linkedId) {
              if (willFullyClose) {
                changed = true;
                continue;
              }
              // partial: rescale remaining linked orders
              const newQty = isCoinSettled(pos)
                ? Math.max(1, Math.round(getPositionUnits(o) * (1 - pct)))
                : getPositionUnits(o) * (1 - pct);
              if (newQty <= POSITION_DUST_EPSILON) {
                changed = true;
                continue;
              }
              changed = true;
              next.push({ ...o, quantity: newQty, contracts: isCoinSettled(pos) ? newQty : o.contracts });
              continue;
            }
            next.push(o);
          }
          return changed ? { ...prev, [targetSymbol]: next } : prev;
        });

        setTradeHistory((prev) => [...prev, record]);

        const kindLabel = order.reduceKind === "TP" ? "止盈" : order.reduceKind === "SL" ? "止损" : "条件";
        toast.success(`${kindLabel}已触发：${targetSymbol} @ ${fillPrice.toFixed(2)}`, {
          description: `${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(2)} USDT`,
        });
        return;
      }

      // === REGULAR CONDITIONAL OPEN PATH ===
      const { fee, margin, position } = executeSettlementFill(symbol, entryPrice, order, false, openTime);

      setFilledOrders((prev) => [
        ...prev.filter((item) => item.id !== order.id),
        {
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
        },
      ].slice(-500));
      setBalance((prev) => prev - margin - fee);
      setPositionsMap((prev) => {
        const existing = (prev[symbol] || []).filter(isPositionOpen);
        return {
          ...prev,
          [symbol]: [...existing, position],
        };
      });
      toast.success(`条件单已触发：${symbol} ${order.side} ${formatSettlementQuantity(position, symbol)} @ ${entryPrice.toFixed(2)}`);
    },
    [setBalance, setPositionsMap, setOrdersMap, setTradeHistory, setFilledOrders],
  );

  const runConditionalMatchingForSymbol = useCallback(
    (symbol: string, candle: Pick<KlineData, "high" | "low">, openTime: number) => {
      const symbolOrders = ordersMapRef.current[symbol] || [];
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

      const triggeredOrders: Array<{ order: PendingOrder; triggerPrice: number }> = [];

      setOrdersMap((prev) => {
        const orders = prev[symbol] || [];
        if (orders.length === 0) return prev;

        let changed = false;
        const remaining: PendingOrder[] = [];

        for (const order of orders) {
          try {
            if (order.type !== "CONDITIONAL") {
              remaining.push(order);
              continue;
            }

            if (order.status !== "PENDING" || conditionalTriggerLocksRef.current.has(order.id)) {
              remaining.push(order);
              continue;
            }

            const decision = getConditionalTriggerDecisionFromRange(order, candle);
            if (!decision?.triggered) {
              remaining.push(order);
              continue;
            }

            conditionalTriggerLocksRef.current.add(order.id);
            triggeredOrders.push({
              order: { ...order, status: "FILLED" as const },
              triggerPrice: decision.triggerPriceNum,
            });
            changed = true;
          } catch (err) {
            // Defensive: never let a single bad order break the matching loop
            console.error("[TP/SL Match Error]", { orderId: order?.id, err });
            remaining.push(order);
          }
        }

        return changed ? { ...prev, [symbol]: remaining } : prev;
      });

      triggeredOrders.forEach(({ order, triggerPrice }) => {
        try {
          createTriggeredConditionalPosition(symbol, order, triggerPrice, openTime);
        } catch (err) {
          console.error("[TP/SL Execute Error]", { orderId: order?.id, err });
        }
      });
    },
    [createTriggeredConditionalPosition, setOrdersMap],
  );

  // ===== UNIFIED GAME LOOP =====
  useEffect(() => {
    if (!shouldRunEngine) {
      gameLoopInitRef.current = false;
      return;
    }

    let raf: number;

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
          const simTime = ct.historicalAnchorTime + (now - ct.realStartTime) * ct.speed;
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
            let newCandles = 0;
            while (cursorRef.current < data.length) {
              const candleEnd = data[cursorRef.current].time + iMs;
              if (candleEnd <= activeSimTime) {
                newCandles++;
                cursorRef.current++;
              } else break;
            }
            if (newCandles > 0) {
              const settledStart = Math.max(0, cursorRef.current - newCandles);
              for (let i = settledStart; i < cursorRef.current; i++) {
                runConditionalMatchingForSymbol(activeSym, data[i], Math.min(activeSimTime, data[i].time + iMs));
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
              const settledClose = Number(data[cursorRef.current - 1]?.close);
              if (Number.isFinite(settledClose) && settledClose > 0) {
                latestChartPriceRef.current = settledClose;
                flushDisplayPrice(settledClose, now);
              }
            }
            if (cursorRef.current < data.length) {
              const candle = data[cursorRef.current];
              if (candle.time <= activeSimTime) {
                const isLiveCandle = candle.time + iMs > Date.now() - 60000;
                const progress = Math.max(0, Math.min(1, (activeSimTime - candle.time) / iMs));
                const interpClose = isLiveCandle ? candle.close : candle.open + (candle.close - candle.open) * progress;
                const hlReveal = Math.min(1, progress * 1.5);
                const rawHigh = isLiveCandle ? candle.high : candle.open + (candle.high - candle.open) * hlReveal;
                const rawLow = isLiveCandle ? candle.low : candle.open + (candle.low - candle.open) * hlReveal;
                // 撮合仍用「周期插值」的 high/low（行为完全不变）
                const matchHigh = isLiveCandle ? candle.high : Math.max(candle.open, interpClose, rawHigh);
                const matchLow = isLiveCandle ? candle.low : Math.min(candle.open, interpClose, rawLow);
                // 显示价统一用「该时刻 1m 价」（priceMap，useBackgroundPrices 每秒更新），使各周期一致；
                // 偏差过大（疑似切标的残留）或冷启动拉不到时，退回周期插值，不会更糟。
                const livePx = priceMapRef.current[activeSym];
                const canonicalSample = canonicalPriceSampleRef.current;
                const canonicalFresh =
                  canonicalSample?.symbol === activeSym &&
                  Math.abs(activeSimTime - canonicalSample.simTime) <= CANONICAL_PRICE_MAX_SIM_AGE_MS;
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
                runConditionalMatchingForSymbol(activeSym, { high: matchHigh, low: matchLow }, activeSimTime);
                latestChartPriceRef.current = close;
              }
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
              runConditionalMatchingForSymbol(activeSymbolRef.current, data[i], Math.min(simTime, data[i].time + iMs));
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
              const livePx = priceMapRef.current[activeSymbolRef.current];
              const canonicalSample = canonicalPriceSampleRef.current;
              const canonicalFresh =
                canonicalSample?.symbol === activeSymbolRef.current &&
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
              runConditionalMatchingForSymbol(activeSymbolRef.current, { high: matchHigh, low: matchLow }, simTime);
              latestChartPriceRef.current = close;
            }
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
    const totalBalance = balance + unrealizedPnl;
    const todayPnl = tradeHistory.reduce((s, t) => s + (t.pnl || 0), 0) + unrealizedPnl;
    const todayPnlPct = initialCapital > 0 ? (todayPnl / initialCapital) * 100 : 0;

    const history = tradeHistory
      .filter((t) => t.closeTime > 0)
      .map((t, i, arr) => ({
        timestamp: t.closeTime,
        totalBalance: initialCapital + arr.slice(0, i + 1).reduce((s, x) => s + (x.pnl || 0), 0),
      }));
    if (history.length === 0 || totalBalance !== history[history.length - 1]?.totalBalance) {
      history.push({ timestamp: activeCoinState.time || Date.now(), totalBalance });
    }

    const dailyMap = new Map<string, { pnl: number; trades: number }>();
    for (const t of tradeHistory) {
      if (t.closeTime <= 0) continue;
      const date = new Date(t.closeTime + 8 * 3600_000).toISOString().slice(0, 10);
      const prev = dailyMap.get(date) || { pnl: 0, trades: 0 };
      dailyMap.set(date, { pnl: prev.pnl + (t.pnl || 0), trades: prev.trades + 1 });
    }
    const dailyPnl = Array.from(dailyMap.entries()).map(([date, v]) => ({ date, ...v }));

    const futuresBalance = totalBalance;
    return {
      totalBalance,
      todayPnl,
      todayPnlPct,
      accounts: [
        {
          label: "合约",
          labelEn: "Futures",
          balance: futuresBalance,
          available: balance,
          frozen: futuresBalance - balance,
        },
        { label: "资金", labelEn: "Funding", balance: 0, available: 0, frozen: 0 },
        { label: "现货", labelEn: "Spot", balance: 0, available: 0, frozen: 0 },
      ],
      history,
      dailyPnl,
    };
  }, [balance, positionsMap, displayPriceMap, tradeHistory, activeCoinState.time, profile]);

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
            setFilledOrders((prev) => [
              ...prev.filter((item) => item.id !== matchedOrder.id),
              {
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
              },
            ].slice(-500));
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
            ? ct.historicalAnchorTime + (now - ct.realStartTime) * ct.speed
            : ct.time;
        return {
          ...prev,
          [activeSymbol]: { ...ct, status: "paused", time: frozenTime, realStartTime: null },
        };
      });
    } else {
      sim.pauseSimulation();
    }
  }, [timeMode, activeSymbol, sim]);

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
              ? ct.historicalAnchorTime + (now - ct.realStartTime) * ct.speed
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
    [timeMode, activeSymbol, sim],
  );

  // ===== Symbol switch: reload chart data =====
  const handleSymbolChange = useCallback(
    async (newSymbol: string) => {
      if (newSymbol === activeSymbol) return;

      setActiveSymbol(newSymbol);
      // Clear stale price to prevent cross-symbol pollution on chart
      latestChartPriceRef.current = 0;
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
          const data = await initLoad(newSymbol, interval, targetState.time);
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
          const data = await initLoad(newSymbol, interval, targetTime);
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
        await initLoad(activeSymbol, newInterval, effectiveSimTime);
      }
    },
    [activeSymbol, interval, activeCoinState.status, effectiveSimTime, initLoad, reset],
  );

  const handleStart = useCallback(
    async (timestamp: number) => {
      const data = await initLoad(activeSymbol, interval, timestamp);
      if (data.length > 0) {
        prevVisibleLenRef.current = 0;
        gameLoopInitRef.current = false;

        if (timeMode === "isolated") {
          const now = Date.now();
          setCoinTimelines((prev) => ({
            ...prev,
            [activeSymbol]: {
              status: "playing",
              time: timestamp,
              speed: 1,
              historicalAnchorTime: timestamp,
              realStartTime: now,
              originTime: timestamp,
            },
          }));
          if (sim.status === "stopped") {
            sim.startSimulation(timestamp);
          }
        } else {
          setSyncedOriginTime(timestamp);
          sim.startSimulation(timestamp);
        }
        toast.success("时间机器已启动", {
          description: `已加载 ${data.length} 根K线 · 向左拖动可加载更多历史数据`,
        });
      } else {
        toast.error("数据获取失败", { description: "请检查时间范围和交易对" });
      }
    },
    [activeSymbol, interval, initLoad, sim, timeMode, profile],
  );

  // ===== Signal-library jump: switch symbol + start time machine atomically =====
  // 从「信号库」下拉点开某标的时调用，越过手动输入标的/时间，直接定位盘面。
  const handleJumpToSignal = useCallback(
    async (symbol: string, timeMs: number) => {
      const normalized = symbol.toUpperCase();

      // 关键：先取数，确认拿到数据后，才改任何共享状态。
      // 「信号库」（按信号自动启动）与「手动启动」必须相互独立——一次失败的跳转
      // 绝不能污染手动模式。因此在 initLoad 成功前，不切换 activeSymbol、不清空行情、
      // 不重置数据层；失败时直接返回，手动模式所见状态原封不动。
      prevVisibleLenRef.current = 0;
      cursorRef.current = 0;
      gameLoopInitRef.current = false;

      const data = await initLoad(normalized, interval, timeMs);
      if (data.length === 0) {
        toast.error("数据获取失败", { description: `无法加载 ${normalized} @ 该时间，请检查信号` });
        return;
      }

      // 取数成功——此时才原子地切换标的并清理该标的的旧缓存。
      if (normalized !== activeSymbol) {
        setActiveSymbol(normalized);
        latestChartPriceRef.current = 0;
        setPriceMap((prev) => {
          if (!prev[normalized]) return prev;
          const next = { ...prev };
          delete next[normalized];
          return next;
        });
      }
      prevVisibleLenRef.current = 0;
      gameLoopInitRef.current = false;

      if (timeMode === "isolated") {
        const now = Date.now();
        setCoinTimelines((prev) => ({
          ...prev,
          [normalized]: {
            status: "playing",
            time: timeMs,
            speed: 1,
            historicalAnchorTime: timeMs,
            realStartTime: now,
            originTime: timeMs,
          },
        }));
        if (sim.status === "stopped") sim.startSimulation(timeMs);
      } else {
        setSyncedOriginTime(timeMs);
        sim.startSimulation(timeMs);
      }
      toast.success(`已跳转到 ${normalized}`, {
        description: `时间机器已定位到信号时间 · 加载 ${data.length} 根K线`,
      });
    },
    [
      activeSymbol, interval, initLoad, sim, timeMode,
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

    toast.success("已清除所有平行宇宙数据并切换到同步模式");
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
                    pricePrecision={pricePrecision}
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
                              onLoadOlder={loadOlder}
                              loadingOlder={loadingOlder}
                              tradeHistory={tradeHistory}
                              isRunning={activeCoinState.status !== "stopped"}
                              currentSimulatedTime={activeCoinState.time}
                              mainInterval={interval}
                              pricePrecision={pricePrecision}
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
                            <div className="h-full w-full min-w-[280px] flex flex-col bg-white dark:bg-[#1e2329] min-h-0 overflow-hidden">
                              <ResizablePanelGroup
                                key={`${isRecentTradesOpen ? "rt-open" : "rt-closed"}`}
                                direction="vertical"
                                className="h-full w-full"
                              >
                                <ResizablePanel defaultSize={isRecentTradesOpen ? 60 : 100} minSize={20}>
                                  <div className="h-full w-full flex flex-col min-h-0 overflow-hidden border-b border-gray-200 dark:border-[#2b3139]">
                                    <OrderBook
                                      symbol={activeSymbol}
                                      currentPrice={displayCurrentPrice}
                                      pricePrecision={pricePrecision}
                                      onMinimize={() => setIsRecentTradesOpen((v) => !v)}
                                      onClose={() => setIsOrderBookOpen(false)}
                                    />
                                  </div>
                                </ResizablePanel>

                                {isRecentTradesOpen && (
                                  <>
                                    <ResizableHandle
                                      withHandle
                                      className="!h-[2px] bg-gray-200 dark:bg-[#2b3139] hover:bg-gray-300 dark:hover:bg-[#474d57] transition-colors cursor-row-resize"
                                    />
                                    <ResizablePanel defaultSize={40} minSize={20}>
                                      <div className="h-full w-full flex flex-col min-h-0 overflow-hidden">
                                        <RecentTrades
                                          currentPrice={displayCurrentPrice}
                                          pricePrecision={pricePrecision}
                                          onMinimize={() => setIsRecentTradesOpen(false)}
                                          onClose={() => setIsRecentTradesOpen(false)}
                                        />
                                      </div>
                                    </ResizablePanel>
                                  </>
                                )}
                              </ResizablePanelGroup>

                              {!isRecentTradesOpen && (
                                <button
                                  type="button"
                                  onClick={() => setIsRecentTradesOpen(true)}
                                  title="显示最新成交"
                                  className="flex-none flex items-center justify-center gap-1 h-7 text-[11px] border-t border-gray-200 dark:border-[#2b3139] text-gray-500 dark:text-[#848e9c] hover:text-gray-900 dark:hover:text-white transition-colors"
                                >
                                  <svg
                                    className="w-3 h-3"
                                    viewBox="0 0 12 12"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                  >
                                    <path d="M2 4l4 4 4-4" />
                                  </svg>
                                  最新成交
                                </button>
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
                    pricePrecision={pricePrecision}
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
                pricePrecision={pricePrecision}
                quantityPrecision={quantityPrecision}
                coolingOff={coolingOff.isActive}
                coolingOffLabel={coolingOff.isActive ? coolingOff.formatRemaining() : undefined}
                onOpenCoolingOff={() => setCoolingOffModalOpen(true)}
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
            <DialogTitle>⚠️ 清除所有平行宇宙数据</DialogTitle>
            <DialogDescription>
              此操作将清除所有隔离模式下的独立账户数据（各币种的独立资金、持仓、挂单和历史记录），并合并为单一全局时间线。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted-foreground space-y-1">
            <div>• 所有独立沙盒账户将被销毁</div>
            <div>• 所有未平仓位将被强制结算</div>
            <div>• 所有挂单将被撤销</div>
            <div>• 切换后使用全局共享账户</div>
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
