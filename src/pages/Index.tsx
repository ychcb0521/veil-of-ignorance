import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { formatUTC8 } from '@/lib/timeFormat';
import { useTradingContext, type PlaceOrderParams } from '@/contexts/TradingContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBinanceData, intervalToMs, type KlineData } from '@/hooks/useBinanceData';
import { useBackgroundPrices } from '@/hooks/useBackgroundPrices';
import { loadPersistedSimState } from '@/hooks/usePersistedState';
import { usePersistedState, clearSimState } from '@/hooks/usePersistedState';
import { useIsMobile } from '@/hooks/use-mobile';
import { TimeControl } from '@/components/TimeControl';
import { CandlestickChart, type ChartImperativeApi } from '@/components/CandlestickChart';
import { MultiChartLayout } from '@/components/MultiChartLayout';
import { OrderBook } from '@/components/OrderBook';
import { OrderPanel } from '@/components/OrderPanel';
import { PositionPanel } from '@/components/PositionPanel';
import { SymbolSelector } from '@/components/SymbolSelector';
import { AccountInfo } from '@/components/AccountInfo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { MobileLayout } from '@/components/mobile/MobileLayout';
import { AssetOverview } from '@/components/AssetOverview';
import { LiquidationModal } from '@/components/LiquidationModal';
import { AnalyticsPanel } from '@/components/AnalyticsPanel';
import { CoolingOffModal, useCoolingOff } from '@/components/CoolingOffModal';
import { toast } from 'sonner';
import { BarChart3, Wallet, PanelRightClose, PanelRightOpen } from 'lucide-react';
import type { PendingOrder, OrderType } from '@/types/trading';
import { calcFee, calcSlippage } from '@/types/trading';
import type { AssetState } from '@/types/assets';
import { Dialog, DialogContent } from '@/components/ui/dialog';

// Price protection threshold: reject conditional triggers if |last - mark| / mark > 2%
const PRICE_PROTECTION_THRESHOLD = 0.02;

// ===== Offline matching for restore =====
function matchOrdersOffline(
  pendingOrders: PendingOrder[], klines: KlineData[], balance: number,
) {
  const newPositions: any[] = [];
  let remaining = [...pendingOrders];
  let bal = balance;

  for (const kline of klines) {
    const stillPending: PendingOrder[] = [];
    for (const order of remaining) {
      let triggered = false;
      let fillPrice = 0;

      if (order.type === 'LIMIT' || order.type === 'POST_ONLY') {
        if (order.side === 'LONG' && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
        else if (order.side === 'SHORT' && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
      } else if (order.type === 'MARKET_TP_SL') {
        if (order.side === 'LONG' && kline.high >= order.stopPrice) { triggered = true; fillPrice = order.stopPrice; }
        else if (order.side === 'SHORT' && kline.low <= order.stopPrice) { triggered = true; fillPrice = order.stopPrice; }
      }

      if (triggered) {
        const fee = calcFee(fillPrice, order.quantity, true);
        const margin = (order.quantity * fillPrice) / order.leverage;
        bal -= margin + fee;
        newPositions.push({
          side: order.side, entryPrice: fillPrice, quantity: order.quantity,
          leverage: order.leverage, marginMode: order.marginMode, margin,
        });
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
    sim, activeSymbol, setActiveSymbol, interval, setInterval: setIntervalVal,
    positionsMap, setPositionsMap, ordersMap, setOrdersMap,
    priceMap, setPriceMap, balance, setBalance,
    tradeHistory, setTradeHistory,
    activeSymbolPositions, activeSymbolOrders,
    allPositions, allOrders, currentPrice, activeSymbols,
    pricePrecision, quantityPrecision, setPricePrecision, setQuantityPrecision,
    handlePlaceOrder, handleClosePosition, handleCancelOrder,
    handleAddIsolatedMargin,
    liquidationOpen, liquidationDetails, closeLiquidationModal,
    isTimeIsolated, setIsTimeIsolated, coinTimelines, setCoinTimelines,
    totalPositionCount, getEffectiveTime,
  } = ctx;

  const { allData, allDataRef, loading, loadingOlder, error, initLoad, loadOlder, getVisibleData, reset } = useBinanceData();

  // Background price polling for non-active symbols
  useBackgroundPrices();

  const [bottomTab, setBottomTab] = useState('positions');
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [coolingOffModalOpen, setCoolingOffModalOpen] = useState(false);
  const [priceProtection, setPriceProtection] = usePersistedState('price_protection', true);
  const [isOrderBookOpen, setIsOrderBookOpen] = usePersistedState('orderbook_open', false);
  const coolingOff = useCoolingOff();
  const hasRestoredRef = useRef(false);
  const persistedSim = useMemo(() => loadPersistedSimState(), []);
  const restoredActive = persistedSim?.status === 'playing' || persistedSim?.status === 'paused';

  useEffect(() => {
    if (!restoredActive || hasRestoredRef.current || !persistedSim) return;
    hasRestoredRef.current = true;

    (async () => {
      const targetTime = persistedSim.currentSimulatedTime || persistedSim.historicalAnchorTime!;
      const data = await initLoad(persistedSim.symbol, persistedSim.interval, targetTime);
      if (data.length > 0) {
        toast.info('已恢复模拟会话');
      }
    })();
  }, []);

  const iMs = useMemo(() => intervalToMs(interval), [interval]);

  // Effective time for the active coin (isolation-aware)
  const effectiveSimTime = useMemo(() => getEffectiveTime(activeSymbol), [getEffectiveTime, activeSymbol]);

  const visibleData = useMemo(
    () => getVisibleData(effectiveSimTime, iMs),
    [getVisibleData, effectiveSimTime, iMs]
  );

  // ===== UNIFIED GAME LOOP =====
  // Single RAF tick handles: time computation → clock DOM → cursor → chart → throttled React flush.
  // Zero React re-renders for visual updates.

  const chartApiRef = useRef<{ updateData: (candle: any) => void } | null>(null);
  const cursorRef = useRef(0);           // pointer into allData (O(1) advance)
  const gameLoopInitRef = useRef(false); // set to false on status change to re-sync cursor
  const clockRef = useRef<HTMLSpanElement>(null);        // direct DOM clock
  const headerClockRef = useRef<HTMLSpanElement>(null);   // header bar clock
  const lastReactFlushRef = useRef(0);   // throttle React setState
  const lastPersistRef = useRef(0);      // throttle localStorage
  const isTimeIsolatedRef = useRef(isTimeIsolated);
  const activeSymbolRef = useRef(activeSymbol);

  // Keep refs in sync
  useEffect(() => { isTimeIsolatedRef.current = isTimeIsolated; }, [isTimeIsolated]);
  useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);

  /** Throttle interval for React state flush (ms). Only for matching/liquidation engines. */
  const REACT_FLUSH_MS = 800;
  /** Throttle interval for localStorage persistence (ms). */
  const PERSIST_MS = 500;

  useEffect(() => {
    if (sim.status !== 'playing') {
      gameLoopInitRef.current = false;
      return;
    }

    let raf: number;

    const tick = () => {
      const api = chartApiRef.current;
      const data = allDataRef.current;

      // ① Compute simulated time from wall-clock delta (pure math, no React)
      const simTime = sim.getSimTime();
      sim.currentTimeRef.current = simTime;

      // ② Update clock DOM directly — zero React overhead
      const timeStr = formatUTC8(simTime);
      if (clockRef.current) clockRef.current.textContent = timeStr;
      if (headerClockRef.current) headerClockRef.current.textContent = timeStr;

      // ③ Advance cursor through data & update chart
      if (api && data.length > 0) {
        // First tick after play/resume: binary-search to sync cursor
        if (!gameLoopInitRef.current) {
          let idx = 0;
          for (let i = 0; i < data.length; i++) {
            if (data[i].time <= simTime) idx = i + 1;
            else break;
          }
          cursorRef.current = idx;
          gameLoopInitRef.current = true;
        }

        // Advance cursor: O(1) amortised — just walk forward from last position
        let newCandles = 0;
        while (cursorRef.current < data.length) {
          const candleEnd = data[cursorRef.current].time + iMs;
          if (candleEnd <= simTime) { newCandles++; cursorRef.current++; }
          else break;
        }

        // ④ Batch chart update — never call update() more than once per frame
        if (newCandles > 0) {
          // For large jumps (>3 candles in one frame), push only the last 3
          // to avoid GPU stall from many sequential update() calls.
          const batchStart = Math.max(0, cursorRef.current - Math.min(newCandles, 3));
          for (let i = batchStart; i < cursorRef.current; i++) {
            const c = data[i];
            api.updateData({
              timestamp: c.time, open: c.open, high: c.high,
              low: c.low, close: c.close, volume: c.volume,
            });
          }
        }

        // Sub-candle interpolation for the forming candle
        if (cursorRef.current < data.length) {
          const candle = data[cursorRef.current];
          if (candle.time <= simTime) {
            const progress = Math.max(0, Math.min(1, (simTime - candle.time) / iMs));
            const close = candle.open + (candle.close - candle.open) * progress;
            const hlReveal = Math.min(1, progress * 1.5);
            const rawHigh = candle.open + (candle.high - candle.open) * hlReveal;
            const rawLow = candle.open + (candle.low - candle.open) * hlReveal;
            api.updateData({
              timestamp: candle.time, open: candle.open,
              high: Math.max(candle.open, close, rawHigh),
              low: Math.min(candle.open, close, rawLow),
              close, volume: candle.volume * progress,
            });
          }
        }
      }

      // ⑤ Throttled React state flush — only for matching/liquidation engines
      const now = Date.now();
      if (now - lastReactFlushRef.current >= REACT_FLUSH_MS) {
        lastReactFlushRef.current = now;
        sim.syncReactState(simTime);

        // In isolated mode: continuously update the active coin's timeline
        if (isTimeIsolatedRef.current) {
          setCoinTimelines(prev => {
            if (prev[activeSymbolRef.current] === simTime) return prev;
            return { ...prev, [activeSymbolRef.current]: simTime };
          });
        }
      }

      // ⑥ Throttled localStorage persistence
      if (now - lastPersistRef.current >= PERSIST_MS) {
        lastPersistRef.current = now;
        sim.persistTime(simTime);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sim.status, iMs]);

  // Build asset state for AssetOverview
  const assetState = useMemo<AssetState>(() => {
    const initialCapital = profile?.initial_capital ?? 1_000_000;
    // Calculate unrealized PnL across all positions
    let unrealizedPnl = 0;
    for (const [sym, positions] of Object.entries(positionsMap)) {
      const price = priceMap[sym] || 0;
      for (const pos of positions) {
        const pnl = pos.side === 'LONG'
          ? (price - pos.entryPrice) * pos.quantity
          : (pos.entryPrice - price) * pos.quantity;
        unrealizedPnl += pnl;
      }
    }
    const totalBalance = balance + unrealizedPnl;
    // Today's PnL from trade history (simplified: sum all closed trades)
    const todayPnl = tradeHistory.reduce((s, t) => s + (t.pnl || 0), 0) + unrealizedPnl;
    const todayPnlPct = initialCapital > 0 ? (todayPnl / initialCapital) * 100 : 0;

    // Build history from trade events (simplified mock for now)
    const history = tradeHistory
      .filter(t => t.closeTime > 0)
      .map((t, i, arr) => ({
        timestamp: t.closeTime,
        totalBalance: initialCapital + arr.slice(0, i + 1).reduce((s, x) => s + (x.pnl || 0), 0),
      }));
    // Add current snapshot
    if (history.length === 0 || totalBalance !== history[history.length - 1]?.totalBalance) {
      history.push({ timestamp: sim.currentSimulatedTime || Date.now(), totalBalance });
    }

    // Build daily PnL from trade history
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
        { label: '合约', labelEn: 'Futures', balance: futuresBalance, available: balance, frozen: futuresBalance - balance },
        { label: '资金', labelEn: 'Funding', balance: 0, available: 0, frozen: 0 },
        { label: '现货', labelEn: 'Spot', balance: 0, available: 0, frozen: 0 },
      ],
      history,
      dailyPnl,
    };
  }, [balance, positionsMap, priceMap, tradeHistory, sim.currentSimulatedTime, profile]);

  useEffect(() => {
    if (visibleData.length > 0) {
      const lastClose = visibleData[visibleData.length - 1].close;
      setPriceMap(prev => {
        if (prev[activeSymbol] === lastClose) return prev;
        return { ...prev, [activeSymbol]: lastClose };
      });
    }
  }, [visibleData, activeSymbol]);

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
      setOrdersMap(prev => {
        const orders = prev[activeSymbol] || [];
        if (orders.length === 0) return prev;
        const remaining: PendingOrder[] = [];

        for (const order of orders) {
          if (filledIds.includes(order.id)) continue;

          let triggered = false;
          let fillPrice = 0;
          let isMaker = true;
          let convertToLimit = false;
          let updatedOrder = { ...order };

          switch (order.type) {
            case 'LIMIT':
            case 'POST_ONLY': {
              if (order.side === 'LONG' && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
              else if (order.side === 'SHORT' && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
              break;
            }
            case 'MARKET_TP_SL': {
              if (order.side === 'LONG' && kline.high >= order.stopPrice) { triggered = true; fillPrice = kline.close; isMaker = false; }
              else if (order.side === 'SHORT' && kline.low <= order.stopPrice) { triggered = true; fillPrice = kline.close; isMaker = false; }
              break;
            }
            case 'LIMIT_TP_SL': {
              const triggerHit = (order.side === 'LONG' && kline.high >= order.stopPrice) || (order.side === 'SHORT' && kline.low <= order.stopPrice);
              if (triggerHit) {
                if (order.side === 'LONG' && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
                else if (order.side === 'SHORT' && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
                else { convertToLimit = true; updatedOrder = { ...order, type: 'LIMIT', status: 'ACTIVE' }; }
              }
              break;
            }
            case 'CONDITIONAL': {
              const trigHit = (order.side === 'LONG' && kline.high >= order.stopPrice) || (order.side === 'SHORT' && kline.low <= order.stopPrice);
              if (trigHit) {
                if (order.conditionalExecType === 'MARKET') { triggered = true; fillPrice = kline.close; isMaker = false; }
                else {
                  const lp = order.conditionalLimitPrice || order.price;
                  if (order.side === 'LONG' && kline.low <= lp) { triggered = true; fillPrice = lp; }
                  else if (order.side === 'SHORT' && kline.high >= lp) { triggered = true; fillPrice = lp; }
                  else { convertToLimit = true; updatedOrder = { ...order, type: 'LIMIT', price: lp, status: 'ACTIVE' }; }
                }
              }
              break;
            }
            case 'TRAILING_STOP': {
              const rate = order.callbackRate || 0.01;
              if (!order.trailingActivated) {
                if (order.stopPrice > 0) {
                  const activateHit = (order.side === 'LONG' && kline.high >= order.stopPrice) || (order.side === 'SHORT' && kline.low <= order.stopPrice);
                  if (activateHit) {
                    updatedOrder = { ...order, trailingActivated: true, peakPrice: order.side === 'LONG' ? kline.high : undefined, troughPrice: order.side === 'SHORT' ? kline.low : undefined };
                    convertToLimit = true;
                  } else { remaining.push(order); continue; }
                } else {
                  updatedOrder = { ...order, trailingActivated: true, peakPrice: order.side === 'LONG' ? kline.high : undefined, troughPrice: order.side === 'SHORT' ? kline.low : undefined };
                }
              }
              if (updatedOrder.trailingActivated || order.trailingActivated) {
                const src = updatedOrder.trailingActivated ? updatedOrder : order;
                if (src.side === 'LONG') {
                  const peak = Math.max(src.peakPrice || 0, kline.high);
                  const triggerLevel = peak * (1 - rate);
                  if (kline.low <= triggerLevel) { triggered = true; fillPrice = src.trailingExecType === 'LIMIT' ? (src.trailingLimitPrice || triggerLevel) : kline.close; isMaker = src.trailingExecType === 'LIMIT'; }
                  else { convertToLimit = true; updatedOrder = { ...src, peakPrice: peak, trailingActivated: true }; }
                } else {
                  const trough = Math.min(src.troughPrice || Infinity, kline.low);
                  const triggerLevel = trough * (1 + rate);
                  if (kline.high >= triggerLevel) { triggered = true; fillPrice = src.trailingExecType === 'LIMIT' ? (src.trailingLimitPrice || triggerLevel) : kline.close; isMaker = src.trailingExecType === 'LIMIT'; }
                  else { convertToLimit = true; updatedOrder = { ...src, troughPrice: trough, trailingActivated: true }; }
                }
              }
              break;
            }
            default: break;
          }

          if (triggered) {
            // === PRICE PROTECTION: anti-scam-wick check for conditional orders ===
            const isConditionalType = ['MARKET_TP_SL', 'LIMIT_TP_SL', 'CONDITIONAL', 'TRAILING_STOP'].includes(order.type);
            if (isConditionalType && priceProtection) {
              // Use kline OHLC average as "mark price" proxy
              const markPrice = (kline.open + kline.high + kline.low + kline.close) / 4;
              const deviation = Math.abs(kline.close - markPrice) / markPrice;
              if (deviation > PRICE_PROTECTION_THRESHOLD) {
                // Reject trigger — price deviation too large (scam wick)
                toast.warning(`⚠️ 价格保护已触发`, {
                  description: `条件单 ${order.id.slice(0, 8)} 由于最新价与标记价格偏差 ${(deviation * 100).toFixed(2)}% > 2%，未被执行`,
                  duration: 6000,
                });
                remaining.push(order);
                continue;
              }
            }

            filledIds.push(order.id);
            // Apply slippage for taker fills
            let actualFillPrice = fillPrice;
            let slippageAmount = 0;
            if (!isMaker) {
              const notional = fillPrice * order.quantity;
              actualFillPrice = calcSlippage(fillPrice, notional, order.side);
              slippageAmount = Math.abs(actualFillPrice - fillPrice) * order.quantity;
            }
            const fee = calcFee(actualFillPrice, order.quantity, isMaker);
            const margin = (order.quantity * actualFillPrice) / order.leverage;
            setBalance(prev => prev - margin - fee);
            setPositionsMap(prev => ({
              ...prev,
              [activeSymbol]: [...(prev[activeSymbol] || []), {
                side: order.side, entryPrice: actualFillPrice, quantity: order.quantity,
                leverage: order.leverage, marginMode: order.marginMode, margin,
              }],
            }));
            setTradeHistory(prev => [...prev, {
              id: crypto.randomUUID(), symbol: activeSymbol, side: order.side, type: order.type,
              action: 'OPEN' as const, entryPrice: actualFillPrice, exitPrice: 0,
              quantity: order.quantity, leverage: order.leverage,
              pnl: 0, fee, slippage: slippageAmount,
              openTime: sim.currentSimulatedTime, closeTime: 0,
            }]);
            toast.success(`委托成交: ${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity} @ ${actualFillPrice.toFixed(2)}`);
          } else if (convertToLimit) {
            remaining.push(updatedOrder);
          } else {
            remaining.push(order);
          }
        }

        return { ...prev, [activeSymbol]: remaining };
      });
    }
  }, [visibleData.length, activeSymbol]);

  // ===== TWAP ENGINE =====
  useEffect(() => {
    if (!sim.isRunning || currentPrice <= 0) return;

    for (const [symbol, orders] of Object.entries(ordersMap)) {
      const price = priceMap[symbol] || 0;
      if (price <= 0) continue;
      const twapOrders = orders.filter(o => o.type === 'TWAP');
      if (twapOrders.length === 0) continue;

      setOrdersMap(prev => {
        let changed = false;
        const symOrders = prev[symbol] || [];
        const updated = symOrders.map(order => {
          if (order.type !== 'TWAP') return order;
          const now = sim.currentSimulatedTime;
          if (order.twapFilledQty !== undefined && order.twapTotalQty !== undefined && order.twapFilledQty >= order.twapTotalQty) {
            changed = true; return null;
          }
          if (order.twapNextExecTime && now >= order.twapNextExecTime) {
            const totalQty = order.twapTotalQty || order.quantity;
            const intervalMs = order.twapInterval || 300000;
            const endTime = order.twapEndTime || (order.createdAt + 3600000);
            const totalSlices = Math.max(1, Math.floor((endTime - order.createdAt) / intervalMs));
            const sliceQty = totalQty / totalSlices;
            const filledSoFar = order.twapFilledQty || 0;

            if (filledSoFar + sliceQty <= totalQty + 0.0001 && now < endTime) {
              const notional = price * sliceQty;
              const slippedPrice = calcSlippage(price, notional, order.side);
              const slippageAmt = Math.abs(slippedPrice - price) * sliceQty;
              const fee = calcFee(slippedPrice, sliceQty, false);
              const margin = (sliceQty * slippedPrice) / order.leverage;
              setBalance(b => b - margin - fee);
              setPositionsMap(p => ({
                ...p,
                [symbol]: [...(p[symbol] || []), {
                  side: order.side, entryPrice: slippedPrice, quantity: sliceQty,
                  leverage: order.leverage, marginMode: order.marginMode, margin,
                }],
              }));
              setTradeHistory(prev => [...prev, {
                id: crypto.randomUUID(), symbol, side: order.side, type: 'TWAP' as OrderType,
                action: 'OPEN' as const, entryPrice: slippedPrice, exitPrice: 0,
                quantity: sliceQty, leverage: order.leverage,
                pnl: 0, fee, slippage: slippageAmt, openTime: now, closeTime: 0,
              }]);
              changed = true;
              return { ...order, twapFilledQty: filledSoFar + sliceQty, twapNextExecTime: order.twapNextExecTime! + intervalMs };
            } else {
              changed = true; return null;
            }
          }
          return order;
        }).filter(Boolean) as PendingOrder[];

        return changed ? { ...prev, [symbol]: updated } : prev;
      });
    }
  }, [sim.currentSimulatedTime, sim.isRunning, ordersMap, priceMap]);

  // ===== Symbol switch: reload chart data =====
  const handleSymbolChange = useCallback(async (newSymbol: string) => {
    if (newSymbol === activeSymbol) return;

    // In isolated mode: save current coin's time before switching
    if (isTimeIsolated && sim.status !== 'stopped') {
      const currentTime = sim.currentTimeRef.current || sim.currentSimulatedTime;
      setCoinTimelines(prev => ({ ...prev, [activeSymbol]: currentTime }));
    }

    setActiveSymbol(newSymbol);
    reset();
    prevVisibleLenRef.current = 0;
    cursorRef.current = 0;
    gameLoopInitRef.current = false;

    if (sim.status !== 'stopped') {
      // In isolated mode: restore the target coin's saved time; otherwise use global time
      const targetTime = isTimeIsolated
        ? (coinTimelines[newSymbol] ?? sim.currentSimulatedTime)
        : sim.currentSimulatedTime;

      const data = await initLoad(newSymbol, interval, targetTime);
      if (data.length > 0) {
        toast.info(`已切换到 ${newSymbol}`, { description: `加载 ${data.length} 根K线` });
      }
    }
  }, [activeSymbol, sim.status, sim.currentSimulatedTime, interval, initLoad, reset, isTimeIsolated, coinTimelines]);

  const handleIntervalChange = useCallback(async (newInterval: string) => {
    if (newInterval === interval) return;
    setIntervalVal(newInterval);
    reset();
    prevVisibleLenRef.current = 0;

    if (sim.status !== 'stopped') {
      await initLoad(activeSymbol, newInterval, sim.currentSimulatedTime);
    }
  }, [activeSymbol, interval, sim.status, sim.currentSimulatedTime, initLoad, reset]);

  const handleStart = useCallback(async (timestamp: number) => {
    const data = await initLoad(activeSymbol, interval, timestamp);
    if (data.length > 0) {
      prevVisibleLenRef.current = 0;
      sim.startSimulation(timestamp);
      toast.success('时间机器已启动', {
        description: `已加载 ${data.length} 根K线 · 向左拖动可加载更多历史数据`,
      });
    } else {
      toast.error('数据获取失败', { description: '请检查时间范围和交易对' });
    }
  }, [activeSymbol, interval, initLoad, sim]);

  // Stop: close all positions, cancel orders, reset
  const handleStop = useCallback(() => {
    // Close all positions at current prices
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
    // Reset chart and sim
    reset();
    prevVisibleLenRef.current = 0;
    clearSimState();
    sim.stopSimulation();
    toast.info('⏹ 模拟已停止，所有仓位已结算');
  }, [positionsMap, ordersMap, priceMap, handleClosePosition, handleCancelOrder, reset, sim]);

  // Wrapper for OrderPanel
  const handlePlaceOrderForActiveSymbol = useCallback((order: PlaceOrderParams) => {
    handlePlaceOrder(activeSymbol, order);
  }, [activeSymbol, handlePlaceOrder]);

  const handleClosePositionForSymbol = useCallback((symbol: string, index: number) => {
    handleClosePosition(symbol, index);
  }, [handleClosePosition]);

  const handleCancelOrderForSymbol = useCallback((symbol: string, orderId: string) => {
    handleCancelOrder(symbol, orderId);
  }, [handleCancelOrder]);

  const isMobile = useIsMobile();

  // Mobile layout
  if (isMobile) {
    return (
      <MobileLayout
        symbol={activeSymbol}
        interval={interval}
        onSymbolChange={handleSymbolChange}
        onIntervalChange={handleIntervalChange}
        status={sim.status}
        currentSimulatedTime={sim.currentSimulatedTime}
        speed={sim.speed}
        onStart={handleStart}
        onPause={sim.pauseSimulation}
        onResume={sim.resumeSimulation}
        onStop={handleStop}
        onSetSpeed={sim.setSpeed}
        visibleData={visibleData}
        onLoadOlder={loadOlder}
        loadingOlder={loadingOlder}
        currentPrice={currentPrice}
        disabled={sim.status === 'stopped' || currentPrice === 0}
        onPlaceOrder={handlePlaceOrderForActiveSymbol}
        balance={balance}
        positionsMap={positionsMap}
        ordersMap={ordersMap}
        priceMap={priceMap}
        tradeHistory={tradeHistory}
        activeSymbol={activeSymbol}
        onClosePosition={handleClosePositionForSymbol}
        onCancelOrder={handleCancelOrderForSymbol}
      />
    );
  }

  // Desktop layout
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <header className="border-b border-border px-4 py-1.5 flex items-center justify-between shrink-0 bg-card gap-2 min-h-[36px]">
        <div className="flex items-center gap-4 min-w-0 shrink-0">
          <ThemeToggle />
          <h1 className="text-xs font-bold text-primary tracking-widest uppercase whitespace-nowrap shrink-0">⚡ 无知之幕</h1>
          <SymbolSelector symbol={activeSymbol} interval={interval} onSymbolChange={handleSymbolChange} onIntervalChange={handleIntervalChange} onPrecisionChange={(pp, qp) => { setPricePrecision(pp); setQuantityPrecision(qp); }} />
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {loading && <span className="text-[10px] text-primary animate-pulse font-mono">加载历史数据...</span>}
          {visibleData.length > 0 && (
            <span className="font-mono text-xs text-primary font-medium">
              <span ref={headerClockRef}>
                {formatUTC8(visibleData[visibleData.length - 1].time)}
              </span>
            </span>
          )}
          <button onClick={() => setAssetsOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
            <Wallet className="w-3 h-3" /> 资产
          </button>
          <button onClick={() => setAnalyticsOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
            <BarChart3 className="w-3 h-3" /> 数据归因
          </button>
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[120px]">{user?.email}</span>
          <button
            onClick={signOut}
            className="text-[10px] text-muted-foreground hover:text-destructive font-medium transition-colors"
          >
            登出
          </button>
        </div>
      </header>

      <div className="shrink-0">
        <TimeControl status={sim.status} currentSimulatedTime={sim.currentSimulatedTime}
          speed={sim.speed} onStart={handleStart} onPause={sim.pauseSimulation} onResume={sim.resumeSimulation} onStop={handleStop} onSetSpeed={sim.setSpeed} clockRef={clockRef}
          isTimeIsolated={isTimeIsolated} onToggleTimeIsolation={setIsTimeIsolated} totalPositionCount={totalPositionCount} />
      </div>

      <div className="shrink-0">
        <AccountInfo balance={balance} positionsMap={positionsMap} priceMap={priceMap} />
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex-1 min-h-0 relative overflow-hidden">
            {sim.status === 'stopped' && visibleData.length === 0 ? (
              <div className="h-full flex items-center justify-center bg-background">
                <div className="text-center space-y-3">
                  <div className="text-5xl">⏰</div>
                  <p className="text-sm text-muted-foreground">输入历史时间并点击「启动」开始复盘模拟</p>
                  <p className="text-xs text-muted-foreground">K线按真实时间 1:1 流速推进 · 绝不暴露未来数据</p>
                </div>
              </div>
            ) : (
              <MultiChartLayout
                mainData={visibleData}
                mainSymbol={activeSymbol.replace('USDT', '/USDT')}
                rawSymbol={activeSymbol}
                onLoadOlder={loadOlder}
                loadingOlder={loadingOlder}
                tradeHistory={tradeHistory}
                isRunning={sim.status !== 'stopped'}
                currentSimulatedTime={sim.currentSimulatedTime}
                mainInterval={interval}
                pricePrecision={pricePrecision}
                quantityPrecision={quantityPrecision}
                pendingOrders={activeSymbolOrders}
                onCancelOrder={(orderId) => handleCancelOrder(activeSymbol, orderId)}
                chartApiRef={chartApiRef}
              />
            )}
          </div>

          <div className="shrink-0 border-t border-border max-h-[200px] overflow-auto bg-card relative z-10">
            <PositionPanel
              positionsMap={positionsMap}
              ordersMap={ordersMap}
              tradeHistory={tradeHistory}
              priceMap={priceMap}
              activeSymbol={activeSymbol}
              onClosePosition={handleClosePositionForSymbol}
              onCancelOrder={handleCancelOrderForSymbol}
              onAddIsolatedMargin={handleAddIsolatedMargin}
              activeTab={bottomTab}
              onTabChange={setBottomTab}
            />
          </div>
        </div>

        {/* Order Book with collapse toggle */}
        <div className={`border-l border-border shrink-0 overflow-hidden transition-all duration-300 ease-in-out flex flex-col ${isOrderBookOpen ? 'w-[180px]' : 'w-8'}`}>
          <button
            onClick={() => setIsOrderBookOpen(prev => !prev)}
            className="flex items-center justify-center py-2 border-b border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shrink-0"
            title={isOrderBookOpen ? '收起盘口' : '展开盘口'}
          >
            {isOrderBookOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
          </button>
          {isOrderBookOpen ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <OrderBook currentPrice={currentPrice} symbol={activeSymbol} pricePrecision={pricePrecision} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-[9px] text-muted-foreground font-medium writing-vertical" style={{ writingMode: 'vertical-rl' }}>盘口</span>
            </div>
          )}
        </div>

        <div className="w-[280px] border-l border-border shrink-0 overflow-y-auto">
          <OrderPanel currentPrice={currentPrice} onPlaceOrder={handlePlaceOrderForActiveSymbol}
            disabled={sim.status === 'stopped' || currentPrice === 0} symbol={activeSymbol}
            coolingOff={coolingOff.isActive}
            coolingOffLabel={coolingOff.formatRemaining()}
            onOpenCoolingOff={() => setCoolingOffModalOpen(true)}
            priceProtection={priceProtection}
            onTogglePriceProtection={() => setPriceProtection(prev => !prev)}
            pricePrecision={pricePrecision}
            quantityPrecision={quantityPrecision}
          />
        </div>
      </div>

      <LiquidationModal open={liquidationOpen} onClose={closeLiquidationModal} details={liquidationDetails} />
      <AnalyticsPanel
        open={analyticsOpen} onClose={() => setAnalyticsOpen(false)}
        tradeHistory={tradeHistory} balance={balance}
        positionsMap={positionsMap} priceMap={priceMap}
        initialCapital={profile?.initial_capital ?? 1_000_000}
      />
      <Dialog open={assetsOpen} onOpenChange={setAssetsOpen}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          <div className="p-4">
            <AssetOverview assets={assetState} />
          </div>
        </DialogContent>
      </Dialog>
      <CoolingOffModal
        open={coolingOffModalOpen}
        onClose={() => setCoolingOffModalOpen(false)}
        onConfirm={(ms) => { coolingOff.activate(ms); toast.info('🧊 交易冷静期已开启', { description: '冷静期内无法开新仓位', duration: 5000 }); }}
      />
    </div>
  );
};

export default Index;
