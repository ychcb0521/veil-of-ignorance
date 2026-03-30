import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTradingContext, type PlaceOrderParams } from '@/contexts/TradingContext';
import { useAuth } from '@/contexts/AuthContext';
import { useBinanceData, type KlineData } from '@/hooks/useBinanceData';
import { useBackgroundPrices } from '@/hooks/useBackgroundPrices';
import { loadPersistedSimState } from '@/hooks/usePersistedState';
import { useIsMobile } from '@/hooks/use-mobile';
import { TimeControl } from '@/components/TimeControl';
import { CandlestickChart } from '@/components/CandlestickChart';
import { OrderPanel } from '@/components/OrderPanel';
import { PositionPanel } from '@/components/PositionPanel';
import { SymbolSelector } from '@/components/SymbolSelector';
import { AccountInfo } from '@/components/AccountInfo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { MobileLayout } from '@/components/mobile/MobileLayout';
import { LiquidationModal } from '@/components/LiquidationModal';
import { toast } from 'sonner';
import type { PendingOrder, OrderType } from '@/types/trading';
import { calcFee, calcSlippage } from '@/types/trading';

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
    handlePlaceOrder, handleClosePosition, handleCancelOrder,
    liquidationOpen, liquidationDetails, closeLiquidationModal,
  } = ctx;

  const { allData, loading, loadingOlder, error, initLoad, loadOlder, getVisibleData, reset } = useBinanceData();

  // Background price polling for non-active symbols
  useBackgroundPrices();

  const [bottomTab, setBottomTab] = useState('positions');

  // Auto-restore
  const hasRestoredRef = useRef(false);
  const persistedSim = useMemo(() => loadPersistedSimState(), []);
  const restoredRunning = persistedSim?.isRunning ?? false;

  useEffect(() => {
    if (!restoredRunning || hasRestoredRef.current || !persistedSim) return;
    hasRestoredRef.current = true;

    (async () => {
      const anchorTime = persistedSim.historicalAnchorTime!;
      const currentSim = anchorTime + (Date.now() - persistedSim.realStartTime!) * persistedSim.speed;
      const data = await initLoad(persistedSim.symbol, persistedSim.interval, currentSim);
      if (data.length > 0) {
        toast.info('已恢复模拟会话');
      }
    })();
  }, []);

  const visibleData = useMemo(
    () => getVisibleData(sim.currentSimulatedTime),
    [getVisibleData, sim.currentSimulatedTime]
  );

  // Update active symbol price from visible data
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
            filledIds.push(order.id);
            const fee = calcFee(fillPrice, order.quantity, isMaker);
            const margin = (order.quantity * fillPrice) / order.leverage;
            setBalance(prev => prev - margin - fee);
            setPositionsMap(prev => ({
              ...prev,
              [activeSymbol]: [...(prev[activeSymbol] || []), {
                side: order.side, entryPrice: fillPrice, quantity: order.quantity,
                leverage: order.leverage, marginMode: order.marginMode, margin,
              }],
            }));
            toast.success(`委托成交: ${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity} @ ${fillPrice.toFixed(2)}`);
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
              const fee = calcFee(price, sliceQty, false);
              const margin = (sliceQty * price) / order.leverage;
              setBalance(b => b - margin - fee);
              setPositionsMap(p => ({
                ...p,
                [symbol]: [...(p[symbol] || []), {
                  side: order.side, entryPrice: price, quantity: sliceQty,
                  leverage: order.leverage, marginMode: order.marginMode, margin,
                }],
              }));
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
    setActiveSymbol(newSymbol);
    reset();
    prevVisibleLenRef.current = 0;

    if (sim.isRunning) {
      const data = await initLoad(newSymbol, interval, sim.currentSimulatedTime);
      if (data.length > 0) {
        toast.info(`已切换到 ${newSymbol}`, { description: `加载 ${data.length} 根K线` });
      }
    }
  }, [activeSymbol, sim.isRunning, sim.currentSimulatedTime, interval, initLoad, reset]);

  const handleIntervalChange = useCallback(async (newInterval: string) => {
    if (newInterval === interval) return;
    setIntervalVal(newInterval);
    reset();
    prevVisibleLenRef.current = 0;

    if (sim.isRunning) {
      await initLoad(activeSymbol, newInterval, sim.currentSimulatedTime);
    }
  }, [activeSymbol, interval, sim.isRunning, sim.currentSimulatedTime, initLoad, reset]);

  const handleStart = useCallback(async (timestamp: number) => {
    const data = await initLoad(activeSymbol, interval, timestamp);
    if (data.length > 0) {
      prevVisibleLenRef.current = 0;
      sim.startSimulation(timestamp);
      toast.success('时间机器已启动', {
        description: `已加载 ${data.length} 根K线 · 向左拖动可加载更多历史数据`,
      });
    } else {
      toast.error('数据获取失败', { description: error || '请检查时间范围和交易对' });
    }
  }, [activeSymbol, interval, initLoad, sim, error]);

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
        isRunning={sim.isRunning}
        currentSimulatedTime={sim.currentSimulatedTime}
        speed={sim.speed}
        onStart={handleStart}
        onStop={sim.stopSimulation}
        onSetSpeed={sim.setSpeed}
        visibleData={visibleData}
        onLoadOlder={loadOlder}
        loadingOlder={loadingOlder}
        currentPrice={currentPrice}
        disabled={!sim.isRunning || currentPrice === 0}
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
      <header className="border-b border-border px-4 py-1.5 flex items-center justify-between shrink-0 bg-card">
        <div className="flex items-center gap-4">
          <ThemeToggle />
          <h1 className="text-xs font-bold text-primary tracking-widest uppercase">⚡ 无知之幕</h1>
          <SymbolSelector symbol={activeSymbol} interval={interval} onSymbolChange={handleSymbolChange} onIntervalChange={handleIntervalChange} />
        </div>
        <div className="flex items-center gap-3">
          {loading && <span className="text-[10px] text-primary animate-pulse font-mono">加载历史数据...</span>}
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
        <TimeControl isRunning={sim.isRunning} currentSimulatedTime={sim.currentSimulatedTime}
          speed={sim.speed} onStart={handleStart} onStop={sim.stopSimulation} onSetSpeed={sim.setSpeed} />
      </div>

      <div className="shrink-0">
        <AccountInfo balance={balance} positionsMap={positionsMap} priceMap={priceMap} />
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex-1 min-h-0">
            {!sim.isRunning && visibleData.length === 0 ? (
              <div className="h-full flex items-center justify-center bg-background">
                <div className="text-center space-y-3">
                  <div className="text-5xl">⏰</div>
                  <p className="text-sm text-muted-foreground">输入历史时间并点击「启动」开始复盘模拟</p>
                  <p className="text-xs text-muted-foreground">K线按真实时间 1:1 流速推进 · 绝不暴露未来数据</p>
                </div>
              </div>
            ) : (
              <CandlestickChart data={visibleData} symbol={activeSymbol.replace('USDT', '/USDT')} onLoadOlder={loadOlder} loadingOlder={loadingOlder} />
            )}
          </div>

          <div className="shrink-0 border-t border-border max-h-[200px] overflow-auto">
            <PositionPanel
              positionsMap={positionsMap}
              ordersMap={ordersMap}
              tradeHistory={tradeHistory}
              priceMap={priceMap}
              activeSymbol={activeSymbol}
              onClosePosition={handleClosePositionForSymbol}
              onCancelOrder={handleCancelOrderForSymbol}
              activeTab={bottomTab}
              onTabChange={setBottomTab}
            />
          </div>
        </div>

        <div className="w-[280px] border-l border-border shrink-0 overflow-y-auto">
          <OrderPanel currentPrice={currentPrice} onPlaceOrder={handlePlaceOrderForActiveSymbol}
            disabled={!sim.isRunning || currentPrice === 0} symbol={activeSymbol} />
        </div>
      </div>
    </div>
  );
};

export default Index;
