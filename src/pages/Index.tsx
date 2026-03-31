import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { formatUTC8 } from '@/lib/timeFormat';
import { useTradingContext, type PlaceOrderParams, type CoinTimelineState } from '@/contexts/TradingContext';
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
    timeMode, setTimeMode, coinTimelines, setCoinTimelines,
    totalPositionCount, getEffectiveTime, getCoinState,
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

  // Track the original start time for synced mode
  const [syncedOriginTime, setSyncedOriginTime] = usePersistedState<number | null>('synced_origin_time', null);

  // ===== ACTIVE COIN STATE (isolation-aware) =====
  // This is the single source of truth for UI: status, time, speed
  const activeCoinState = useMemo(() => {
    if (timeMode === 'synced') {
      return { status: sim.status, time: sim.currentSimulatedTime, speed: sim.speed, originTime: syncedOriginTime };
    }
    const ct = coinTimelines[activeSymbol];
    if (!ct || ct.status === 'stopped') return { status: 'stopped' as const, time: 0, speed: 1, originTime: null as number | null };
    return { status: ct.status, time: ct.time, speed: ct.speed, originTime: ct.originTime };
  }, [timeMode, sim.status, sim.currentSimulatedTime, sim.speed, coinTimelines, activeSymbol, syncedOriginTime]);

  // Effective time for data filtering
  const effectiveSimTime = useMemo(() => {
    if (timeMode === 'synced') return sim.currentSimulatedTime;
    const ct = coinTimelines[activeSymbol];
    return ct?.time ?? 0;
  }, [timeMode, sim.currentSimulatedTime, coinTimelines, activeSymbol]);

  const visibleData = useMemo(
    () => getVisibleData(effectiveSimTime, iMs),
    [getVisibleData, effectiveSimTime, iMs]
  );

  // Should the RAF engine be running?
  const shouldRunEngine = useMemo(() => {
    if (timeMode === 'synced') return sim.status === 'playing';
    return Object.values(coinTimelines).some(ct => ct.status === 'playing');
  }, [timeMode, sim.status, coinTimelines]);

  // ===== REFS =====
  const chartApiRef = useRef<{ updateData: (candle: any) => void } | null>(null);
  const cursorRef = useRef(0);
  const gameLoopInitRef = useRef(false);
  const clockRef = useRef<HTMLSpanElement>(null);
  
  const lastReactFlushRef = useRef(0);
  const lastPersistRef = useRef(0);
  const timeModeRef = useRef(timeMode);
  const activeSymbolRef = useRef(activeSymbol);
  const coinTimelinesRef = useRef(coinTimelines);

  useEffect(() => { timeModeRef.current = timeMode; }, [timeMode]);
  useEffect(() => { activeSymbolRef.current = activeSymbol; }, [activeSymbol]);
  useEffect(() => { coinTimelinesRef.current = coinTimelines; }, [coinTimelines]);

  const REACT_FLUSH_MS = 800;
  const PERSIST_MS = 500;

  // ===== UNIFIED GAME LOOP =====
  useEffect(() => {
    if (!shouldRunEngine) {
      gameLoopInitRef.current = false;
      return;
    }

    let raf: number;

    const tick = () => {
      const now = Date.now();

      if (timeModeRef.current === 'isolated') {
        // === ISOLATED MODE: advance ALL playing coins ===
        const activeSym = activeSymbolRef.current;
        const cts = coinTimelinesRef.current;
        const updates: Record<string, CoinTimelineState> = {};
        let activeSimTime = cts[activeSym]?.time ?? 0;
        let activeIsPlaying = false;

        for (const [sym, ct] of Object.entries(cts)) {
          if (ct.status !== 'playing' || !ct.realStartTime || ct.historicalAnchorTime == null) continue;
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
                if (data[i].time <= activeSimTime) idx = i + 1; else break;
              }
              cursorRef.current = idx;
              gameLoopInitRef.current = true;
            }
            let newCandles = 0;
            while (cursorRef.current < data.length) {
              const candleEnd = data[cursorRef.current].time + iMs;
              if (candleEnd <= activeSimTime) { newCandles++; cursorRef.current++; } else break;
            }
            if (newCandles > 0) {
              const batchStart = Math.max(0, cursorRef.current - Math.min(newCandles, 3));
              for (let i = batchStart; i < cursorRef.current; i++) {
                const c = data[i];
                api.updateData({ timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
              }
            }
            if (cursorRef.current < data.length) {
              const candle = data[cursorRef.current];
              if (candle.time <= activeSimTime) {
                const progress = Math.max(0, Math.min(1, (activeSimTime - candle.time) / iMs));
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
        }

        // Throttled React flush
        if (now - lastReactFlushRef.current >= REACT_FLUSH_MS && Object.keys(updates).length > 0) {
          lastReactFlushRef.current = now;
          setCoinTimelines(prev => {
            const next = { ...prev };
            for (const [sym, ct] of Object.entries(updates)) {
              next[sym] = ct;
            }
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
              if (data[i].time <= simTime) idx = i + 1; else break;
            }
            cursorRef.current = idx;
            gameLoopInitRef.current = true;
          }
          let newCandles = 0;
          while (cursorRef.current < data.length) {
            const candleEnd = data[cursorRef.current].time + iMs;
            if (candleEnd <= simTime) { newCandles++; cursorRef.current++; } else break;
          }
          if (newCandles > 0) {
            const batchStart = Math.max(0, cursorRef.current - Math.min(newCandles, 3));
            for (let i = batchStart; i < cursorRef.current; i++) {
              const c = data[i];
              api.updateData({ timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
            }
          }
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
  }, [shouldRunEngine, iMs]);

  // Build asset state for AssetOverview
  const assetState = useMemo<AssetState>(() => {
    const initialCapital = profile?.initial_capital ?? 1_000_000;
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
    const todayPnl = tradeHistory.reduce((s, t) => s + (t.pnl || 0), 0) + unrealizedPnl;
    const todayPnlPct = initialCapital > 0 ? (todayPnl / initialCapital) * 100 : 0;

    const history = tradeHistory
      .filter(t => t.closeTime > 0)
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
        { label: '合约', labelEn: 'Futures', balance: futuresBalance, available: balance, frozen: futuresBalance - balance },
        { label: '资金', labelEn: 'Funding', balance: 0, available: 0, frozen: 0 },
        { label: '现货', labelEn: 'Spot', balance: 0, available: 0, frozen: 0 },
      ],
      history,
      dailyPnl,
    };
  }, [balance, positionsMap, priceMap, tradeHistory, activeCoinState.time, profile]);

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
              const markPrice = (kline.open + kline.high + kline.low + kline.close) / 4;
              const deviation = Math.abs(kline.close - markPrice) / markPrice;
              if (deviation > PRICE_PROTECTION_THRESHOLD) {
                toast.warning(`⚠️ 价格保护已触发`, {
                  description: `条件单 ${order.id.slice(0, 8)} 由于最新价与标记价格偏差 ${(deviation * 100).toFixed(2)}% > 2%，未被执行`,
                  duration: 6000,
                });
                remaining.push(order);
                continue;
              }
            }

            filledIds.push(order.id);
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
              openTime: effectiveSimTime, closeTime: 0,
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
    if (activeCoinState.status !== 'playing' || currentPrice <= 0) return;

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
          const now = effectiveSimTime;
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
  }, [effectiveSimTime, activeCoinState.status, ordersMap, priceMap]);

  // ===== ISOLATED-MODE HANDLERS =====
  const handlePause = useCallback(() => {
    if (timeMode === 'isolated') {
      const now = Date.now();
      setCoinTimelines(prev => {
        const ct = prev[activeSymbol];
        if (!ct || ct.status !== 'playing') return prev;
        const frozenTime = ct.historicalAnchorTime != null && ct.realStartTime
          ? ct.historicalAnchorTime + (now - ct.realStartTime) * ct.speed
          : ct.time;
        return {
          ...prev,
          [activeSymbol]: { ...ct, status: 'paused', time: frozenTime, realStartTime: null },
        };
      });
    } else {
      sim.pauseSimulation();
    }
  }, [timeMode, activeSymbol, sim]);

  const handleResume = useCallback(() => {
    if (timeMode === 'isolated') {
      const now = Date.now();
      setCoinTimelines(prev => {
        const ct = prev[activeSymbol];
        if (!ct || ct.status !== 'paused') return prev;
        return {
          ...prev,
          [activeSymbol]: { ...ct, status: 'playing', historicalAnchorTime: ct.time, realStartTime: now },
        };
      });
    } else {
      sim.resumeSimulation();
    }
  }, [timeMode, activeSymbol, sim]);

  const handleSetSpeed = useCallback((speed: number) => {
    if (timeMode === 'isolated') {
      const now = Date.now();
      setCoinTimelines(prev => {
        const ct = prev[activeSymbol];
        if (!ct || ct.status !== 'playing') return { ...prev, [activeSymbol]: { ...(ct || { status: 'paused', time: 0, historicalAnchorTime: null, realStartTime: null, originTime: null }), speed } };
        const currentTime = ct.historicalAnchorTime != null && ct.realStartTime
          ? ct.historicalAnchorTime + (now - ct.realStartTime) * ct.speed
          : ct.time;
        return {
          ...prev,
          [activeSymbol]: { ...ct, speed, time: currentTime, historicalAnchorTime: currentTime, realStartTime: now },
        };
      });
    } else {
      sim.setSpeed(speed);
    }
  }, [timeMode, activeSymbol, sim]);

  // ===== Symbol switch: reload chart data =====
  const handleSymbolChange = useCallback(async (newSymbol: string) => {
    if (newSymbol === activeSymbol) return;

    setActiveSymbol(newSymbol);
    reset();
    prevVisibleLenRef.current = 0;
    cursorRef.current = 0;
    gameLoopInitRef.current = false;

    if (timeMode === 'isolated') {
      const targetState = coinTimelines[newSymbol];
      if (targetState && targetState.status !== 'stopped' && targetState.time > 0) {
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
      if (sim.status !== 'stopped') {
        const targetTime = sim.currentSimulatedTime;
        const data = await initLoad(newSymbol, interval, targetTime);
        if (data.length > 0) {
          toast.info(`已切换到 ${newSymbol}`, { description: `加载 ${data.length} 根K线` });
        }
      }
    }
  }, [activeSymbol, sim.status, sim.currentSimulatedTime, interval, initLoad, reset, timeMode, coinTimelines]);

  const handleIntervalChange = useCallback(async (newInterval: string) => {
    if (newInterval === interval) return;
    setIntervalVal(newInterval);
    reset();
    prevVisibleLenRef.current = 0;

    if (activeCoinState.status !== 'stopped') {
      await initLoad(activeSymbol, newInterval, effectiveSimTime);
    }
  }, [activeSymbol, interval, activeCoinState.status, effectiveSimTime, initLoad, reset]);

  const handleStart = useCallback(async (timestamp: number) => {
    const data = await initLoad(activeSymbol, interval, timestamp);
    if (data.length > 0) {
      prevVisibleLenRef.current = 0;
      gameLoopInitRef.current = false;

      if (timeMode === 'isolated') {
        const now = Date.now();
        setCoinTimelines(prev => ({
          ...prev,
          [activeSymbol]: {
            status: 'playing',
            time: timestamp,
            speed: 1,
            historicalAnchorTime: timestamp,
            realStartTime: now,
            originTime: timestamp,
          },
        }));
        // Start global sim as heartbeat (keeps isRunning=true for funding/liquidation engines)
        if (sim.status === 'stopped') {
          sim.startSimulation(timestamp);
        }
      } else {
        setSyncedOriginTime(timestamp);
        sim.startSimulation(timestamp);
      }
      toast.success('时间机器已启动', {
        description: `已加载 ${data.length} 根K线 · 向左拖动可加载更多历史数据`,
      });
    } else {
      toast.error('数据获取失败', { description: '请检查时间范围和交易对' });
    }
  }, [activeSymbol, interval, initLoad, sim, timeMode]);

  // ===== STATE GUARD: time mode switch =====
  const handleSetTimeMode = useCallback((newMode: 'synced' | 'isolated') => {
    if (newMode === timeMode) return;

    if (totalPositionCount > 0) {
      toast.error(`无法切换模式`, {
        description: `有 ${totalPositionCount} 笔持仓，需全部平仓后才能切换模式。`,
        duration: 5000,
      });
      return;
    }

    // Defensive guard only; primary interception happens in explicit click handlers.
    if (newMode === 'synced' && timeMode === 'isolated') {
      const hasRunningCoins = Object.values(coinTimelines).some(
        ct => ct.status === 'playing' || ct.status === 'paused'
      );
      if (hasRunningCoins) return;
    }

    setTimeMode(newMode);
    if (newMode === 'synced') {
      setCoinTimelines({});
    }
  }, [timeMode, coinTimelines, totalPositionCount, setTimeMode, setCoinTimelines]);

  const handleStopAllAndSwitchToSynced = useCallback(() => {
    if (timeMode !== 'isolated') {
      handleSetTimeMode('synced');
      return;
    }

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
    cursorRef.current = 0;
    gameLoopInitRef.current = false;
    clearSimState();
    setSyncedOriginTime(null);
    sim.stopSimulation();
    setCoinTimelines({});
    setTimeMode('synced');

    toast.success('已停止所有独立时间轴并切换到同步模式');
  }, [
    timeMode,
    handleSetTimeMode,
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
    if (timeMode === 'isolated') {
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
      setCoinTimelines(prev => ({
        ...prev,
        [activeSymbol]: {
          ...(prev[activeSymbol] || { speed: 1, historicalAnchorTime: null, realStartTime: null, originTime: null }),
          status: 'stopped',
          time: 0,
        },
      }));
      reset();
      prevVisibleLenRef.current = 0;
      // If no other coins are playing, also stop global sim
      const anyOtherPlaying = Object.entries(coinTimelines).some(
        ([sym, ct]) => sym !== activeSymbol && ct.status === 'playing'
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
      toast.info('⏹ 模拟已停止，所有仓位已结算');
    }
  }, [positionsMap, ordersMap, priceMap, handleClosePosition, handleCancelOrder, reset, sim, timeMode, activeSymbol, coinTimelines]);

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
        status={activeCoinState.status}
        currentSimulatedTime={activeCoinState.time}
        speed={activeCoinState.speed}
        onStart={handleStart}
        onPause={handlePause}
        onResume={handleResume}
        onStop={handleStop}
        onSetSpeed={handleSetSpeed}
        visibleData={visibleData}
        onLoadOlder={loadOlder}
        loadingOlder={loadingOlder}
        currentPrice={currentPrice}
        disabled={activeCoinState.status === 'stopped' || currentPrice === 0}
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
        <TimeControl
          status={activeCoinState.status}
          currentSimulatedTime={activeCoinState.time}
          speed={activeCoinState.speed}
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onStop={handleStop}
          onSetSpeed={handleSetSpeed}
          onStopAllAndSwitchToSynced={handleStopAllAndSwitchToSynced}
          clockRef={clockRef}
          timeMode={timeMode}
          onSetTimeMode={handleSetTimeMode}
          totalPositionCount={totalPositionCount}
          coinTimelines={coinTimelines}
          onSymbolChange={handleSymbolChange}
          originTime={activeCoinState.originTime}
        />
      </div>

      <div className="shrink-0">
        <AccountInfo balance={balance} positionsMap={positionsMap} priceMap={priceMap} />
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={75} minSize={40}>
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={70} minSize={30}>
                <div className="h-full relative overflow-hidden">
                  {activeCoinState.status === 'stopped' && visibleData.length === 0 ? (
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
                      isRunning={activeCoinState.status !== 'stopped'}
                      currentSimulatedTime={activeCoinState.time}
                      mainInterval={interval}
                      pricePrecision={pricePrecision}
                      quantityPrecision={quantityPrecision}
                      pendingOrders={activeSymbolOrders}
                      onCancelOrder={(orderId) => handleCancelOrder(activeSymbol, orderId)}
                      chartApiRef={chartApiRef}
                    />
                  )}
                </div>
              </ResizablePanel>
              <ResizableHandle className="h-px bg-border hover:bg-primary/40 transition-colors duration-200 data-[resize-handle-active]:bg-primary/60" />
              <ResizablePanel defaultSize={30} minSize={10} maxSize={50}>
                <div className="h-full overflow-auto bg-card">
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
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          {/* Order Book with collapse toggle */}
          <ResizableHandle className="w-px bg-border hover:bg-primary/40 transition-colors duration-200 data-[resize-handle-active]:bg-primary/60" />
          <ResizablePanel defaultSize={isOrderBookOpen ? 8 : 2} minSize={2} maxSize={15} collapsible collapsedSize={2}
            onCollapse={() => setIsOrderBookOpen(false)} onExpand={() => setIsOrderBookOpen(true)}>
            <div className="h-full flex flex-col overflow-hidden">
              <button
                onClick={() => setIsOrderBookOpen(prev => !prev)}
                className="flex items-center justify-center py-2 border-b border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors duration-200 shrink-0"
                title={isOrderBookOpen ? '收起盘口' : '展开盘口'}
              >
                {isOrderBookOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
              </button>
              {isOrderBookOpen && (
                <div className="flex-1 min-h-0 overflow-hidden">
                  <OrderBook symbol={activeSymbol} currentPrice={currentPrice} pricePrecision={pricePrecision} />
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-border hover:bg-primary/40 transition-colors duration-200 data-[resize-handle-active]:bg-primary/60" />
          <ResizablePanel defaultSize={17} minSize={12} maxSize={25}>
            <div className="h-full overflow-auto bg-card">
              <OrderPanel
                symbol={activeSymbol}
                currentPrice={currentPrice}
                disabled={activeCoinState.status === 'stopped' || currentPrice === 0}
                onPlaceOrder={handlePlaceOrderForActiveSymbol}
                pricePrecision={pricePrecision}
                quantityPrecision={quantityPrecision}
                coolingOff={coolingOff.isActive}
                coolingOffLabel={coolingOff.isActive ? coolingOff.formatRemaining() : undefined}
                onOpenCoolingOff={() => setCoolingOffModalOpen(true)}
                priceProtection={priceProtection}
                onTogglePriceProtection={() => setPriceProtection(prev => !prev)}
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

      <AnalyticsPanel
        open={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        tradeHistory={tradeHistory}
        balance={balance}
        positionsMap={positionsMap}
        priceMap={priceMap}
        initialCapital={profile?.initial_capital ?? 1_000_000}
      />

      <LiquidationModal
        open={liquidationOpen}
        onClose={closeLiquidationModal}
        details={liquidationDetails}
      />

      <CoolingOffModal
        open={coolingOffModalOpen}
        onClose={() => setCoolingOffModalOpen(false)}
        onConfirm={(durationMs) => { coolingOff.activate(durationMs); setCoolingOffModalOpen(false); }}
      />
    </div>
  );
};

export default Index;
