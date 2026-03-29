import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTimeSimulator } from '@/hooks/useTimeSimulator';
import { useBinanceData, type KlineData } from '@/hooks/useBinanceData';
import { usePersistedState, loadPersistedSimState, saveSimState, clearSimState } from '@/hooks/usePersistedState';
import { TimeControl } from '@/components/TimeControl';
import { CandlestickChart } from '@/components/CandlestickChart';
import { OrderPanel } from '@/components/OrderPanel';
import { PositionPanel } from '@/components/PositionPanel';
import { SymbolSelector } from '@/components/SymbolSelector';
import { AccountInfo } from '@/components/AccountInfo';
import { toast } from 'sonner';
import type { Position, PendingOrder, TradeRecord, OrderSide, OrderType, MarginMode } from '@/types/trading';
import { calcFee, calcUnrealizedPnl } from '@/types/trading';

// ===== Offline matching: process klines against pending orders =====
function matchOrdersOffline(
  pendingOrders: PendingOrder[],
  klines: KlineData[],
  balance: number,
): { positions: Position[]; remainingOrders: PendingOrder[]; trades: TradeRecord[]; newBalance: number } {
  const newPositions: Position[] = [];
  const trades: TradeRecord[] = [];
  let remaining = [...pendingOrders];
  let bal = balance;

  for (const kline of klines) {
    const stillPending: PendingOrder[] = [];
    for (const order of remaining) {
      let triggered = false;
      let fillPrice = 0;

      if (order.type === 'LIMIT') {
        if (order.side === 'LONG' && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
        else if (order.side === 'SHORT' && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
      } else if (order.type === 'STOP_MARKET') {
        if (order.side === 'LONG' && kline.high >= order.stopPrice) { triggered = true; fillPrice = order.stopPrice; }
        else if (order.side === 'SHORT' && kline.low <= order.stopPrice) { triggered = true; fillPrice = order.stopPrice; }
      } else if (order.type === 'STOP_LIMIT') {
        if (order.side === 'LONG' && kline.high >= order.stopPrice && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
        else if (order.side === 'SHORT' && kline.low <= order.stopPrice && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
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

  return { positions: newPositions, remainingOrders: remaining, trades, newBalance: bal };
}

const Index = () => {
  // Restore persisted sim state
  const persistedSim = useMemo(() => loadPersistedSimState(), []);
  const restoredRunning = persistedSim?.isRunning ?? false;

  const [symbol, setSymbol] = usePersistedState('symbol', persistedSim?.symbol ?? 'BTCUSDT');
  const [interval, setIntervalVal] = usePersistedState('interval', persistedSim?.interval ?? '1m');
  const [positions, setPositions] = usePersistedState<Position[]>('positions', []);
  const [pendingOrders, setPendingOrders] = usePersistedState<PendingOrder[]>('pending_orders', []);
  const [tradeHistory, setTradeHistory] = usePersistedState<TradeRecord[]>('trade_history', []);
  const [balance, setBalance] = usePersistedState('balance', 10000);
  const [bottomTab, setBottomTab] = useState('positions');

  // Initialize time simulator with restored state if running
  const sim = useTimeSimulator(
    restoredRunning && persistedSim ? {
      isRunning: true,
      historicalAnchorTime: persistedSim.historicalAnchorTime,
      realStartTime: persistedSim.realStartTime,
      speed: persistedSim.speed,
    } : undefined
  );

  const { allData, loading, error, fetchKlines, getVisibleData } = useBinanceData();

  // Persist sim state whenever it changes
  useEffect(() => {
    if (sim.isRunning) {
      saveSimState({
        isRunning: true,
        historicalAnchorTime: sim.historicalAnchorTime,
        realStartTime: sim.realStartTime,
        speed: sim.speed,
        symbol,
        interval,
      });
    } else if (persistedSim?.isRunning) {
      // Was running, now stopped — clear
      clearSimState();
    }
  }, [sim.isRunning, sim.historicalAnchorTime, sim.realStartTime, sim.speed, symbol, interval]);

  // Auto-restore data on mount if sim was running
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (!restoredRunning || hasRestoredRef.current || !persistedSim) return;
    hasRestoredRef.current = true;

    (async () => {
      const anchorTime = persistedSim.historicalAnchorTime!;
      const data = await fetchKlines(persistedSim.symbol, persistedSim.interval, anchorTime, 1500);

      if (data.length > 0 && pendingOrders.length > 0) {
        // Calculate current sim time
        const currentSim = anchorTime + (Date.now() - persistedSim.realStartTime!) * persistedSim.speed;
        // Get klines that happened while offline
        const offlineKlines = data.filter(k => k.time <= currentSim);
        // Find klines we hadn't processed (rough: all visible klines since we don't track lastProcessed)
        const result = matchOrdersOffline(pendingOrders, offlineKlines, balance);

        if (result.positions.length > 0) {
          setPositions(prev => [...prev, ...result.positions]);
          setPendingOrders(result.remainingOrders);
          setBalance(result.newBalance);
          toast.success(`离线期间 ${result.positions.length} 笔委托已自动成交`, {
            description: '挂单在您离线期间触发并结算',
          });
        }
      }

      if (data.length > 0) {
        toast.info('已恢复模拟会话', {
          description: `从 localStorage 恢复，盘面继续推进中`,
        });
      }
    })();
  }, []);

  const visibleData = useMemo(
    () => getVisibleData(sim.currentSimulatedTime),
    [getVisibleData, sim.currentSimulatedTime]
  );

  const currentPrice = visibleData.length > 0
    ? visibleData[visibleData.length - 1].close
    : 0;

  const prevVisibleLenRef = useRef(0);

  // ===== MATCHING ENGINE: Check pending orders against new klines =====
  useEffect(() => {
    if (visibleData.length <= prevVisibleLenRef.current) {
      prevVisibleLenRef.current = visibleData.length;
      return;
    }

    const newKlines = visibleData.slice(prevVisibleLenRef.current);
    prevVisibleLenRef.current = visibleData.length;

    if (pendingOrders.length === 0) return;

    const filledIds: string[] = [];

    for (const kline of newKlines) {
      setPendingOrders(prev => {
        const remaining: PendingOrder[] = [];

        for (const order of prev) {
          if (filledIds.includes(order.id)) continue;

          let triggered = false;
          let fillPrice = 0;

          if (order.type === 'LIMIT') {
            if (order.side === 'LONG' && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
            else if (order.side === 'SHORT' && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
          } else if (order.type === 'STOP_MARKET') {
            if (order.side === 'LONG' && kline.high >= order.stopPrice) { triggered = true; fillPrice = order.stopPrice; }
            else if (order.side === 'SHORT' && kline.low <= order.stopPrice) { triggered = true; fillPrice = order.stopPrice; }
          } else if (order.type === 'STOP_LIMIT') {
            if (order.side === 'LONG' && kline.high >= order.stopPrice && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
            else if (order.side === 'SHORT' && kline.low <= order.stopPrice && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
          }

          if (triggered) {
            filledIds.push(order.id);
            const fee = calcFee(fillPrice, order.quantity, true);
            const margin = (order.quantity * fillPrice) / order.leverage;

            setBalance(prev => prev - margin - fee);
            setPositions(prev => [...prev, {
              side: order.side, entryPrice: fillPrice, quantity: order.quantity,
              leverage: order.leverage, marginMode: order.marginMode, margin,
            }]);

            toast.success(`委托成交: ${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity} @ ${fillPrice.toFixed(2)}`);
          } else {
            remaining.push(order);
          }
        }

        return remaining;
      });
    }
  }, [visibleData.length]);

  const handleStart = useCallback(async (timestamp: number) => {
    const data = await fetchKlines(symbol, interval, timestamp, 1500);
    if (data.length > 0) {
      prevVisibleLenRef.current = 0;
      sim.startSimulation(timestamp);
      toast.success('时间机器已启动', {
        description: `穿越到 ${new Date(timestamp).toISOString().slice(0, 19)} UTC`,
      });
    } else {
      toast.error('数据获取失败', { description: error || '请检查时间范围和交易对' });
    }
  }, [symbol, interval, fetchKlines, sim, error]);

  const handlePlaceOrder = useCallback((order: {
    side: OrderSide; type: OrderType; price: number; stopPrice: number;
    quantity: number; leverage: number; marginMode: MarginMode;
  }) => {
    if (order.type === 'MARKET') {
      const fee = calcFee(currentPrice, order.quantity, false);
      const margin = (order.quantity * currentPrice) / order.leverage;

      if (margin + fee > balance) {
        toast.error('保证金不足');
        return;
      }

      setBalance(prev => prev - margin - fee);
      setPositions(prev => [...prev, {
        side: order.side, entryPrice: currentPrice, quantity: order.quantity,
        leverage: order.leverage, marginMode: order.marginMode, margin,
      }]);

      toast.success(`${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity} @ ${currentPrice.toFixed(2)}`, {
        description: `手续费: ${fee.toFixed(4)} USDT`,
      });
    } else {
      const newOrder: PendingOrder = {
        id: crypto.randomUUID(),
        ...order,
        status: 'NEW',
        createdAt: sim.currentSimulatedTime,
      };
      setPendingOrders(prev => [...prev, newOrder]);
      toast.info(`${order.type} 委托已挂出`);
    }
  }, [currentPrice, balance, sim.currentSimulatedTime]);

  const handleClosePosition = useCallback((index: number) => {
    const pos = positions[index];
    const pnl = calcUnrealizedPnl(pos, currentPrice);
    const fee = calcFee(currentPrice, pos.quantity, false);

    setBalance(prev => prev + pos.margin + pnl - fee);
    setPositions(prev => prev.filter((_, i) => i !== index));
    setTradeHistory(prev => [...prev, {
      id: crypto.randomUUID(),
      side: pos.side, type: 'MARKET',
      entryPrice: pos.entryPrice, exitPrice: currentPrice,
      quantity: pos.quantity, leverage: pos.leverage,
      pnl: pnl - fee, fee,
      openTime: 0, closeTime: sim.currentSimulatedTime,
    }]);

    toast(pnl >= 0 ? '盈利平仓 ✅' : '亏损平仓 ❌', {
      description: `${pnl >= 0 ? '+' : ''}${(pnl - fee).toFixed(2)} USDT (含手续费 ${fee.toFixed(4)})`,
    });
  }, [positions, currentPrice, sim.currentSimulatedTime]);

  const handleCancelOrder = useCallback((id: string) => {
    setPendingOrders(prev => prev.filter(o => o.id !== id));
    toast.info('委托已撤销');
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#0B0E11' }}>
      {/* Top Bar */}
      <header className="border-b border-border px-4 py-1.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xs font-bold text-primary tracking-widest uppercase">
            ⚡ Futures Sim
          </h1>
          <SymbolSelector
            symbol={symbol}
            interval={interval}
            onSymbolChange={setSymbol}
            onIntervalChange={setIntervalVal}
          />
        </div>
        {loading && (
          <span className="text-[10px] text-primary animate-pulse font-mono">
            加载历史数据...
          </span>
        )}
      </header>

      {/* Time Control */}
      <div className="shrink-0">
        <TimeControl
          isRunning={sim.isRunning}
          currentSimulatedTime={sim.currentSimulatedTime}
          speed={sim.speed}
          onStart={handleStart}
          onStop={sim.stopSimulation}
          onSetSpeed={sim.setSpeed}
        />
      </div>

      {/* Account Info */}
      <div className="shrink-0">
        <AccountInfo balance={balance} positions={positions} currentPrice={currentPrice} />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Chart + Positions Area */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Chart */}
          <div className="flex-1 min-h-0">
            {!sim.isRunning && visibleData.length === 0 ? (
              <div className="h-full flex items-center justify-center" style={{ background: '#0B0E11' }}>
                <div className="text-center space-y-3">
                  <div className="text-5xl">⏰</div>
                  <p className="text-sm text-muted-foreground">
                    输入历史时间并点击「启动」开始复盘模拟
                  </p>
                  <p className="text-xs text-muted-foreground">
                    K线按真实时间 1:1 流速推进 · 绝不暴露未来数据
                  </p>
                </div>
              </div>
            ) : (
              <CandlestickChart data={visibleData} symbol={symbol.replace('USDT', '/USDT')} />
            )}
          </div>

          {/* Bottom Panel */}
          <div className="shrink-0 border-t border-border max-h-[200px] overflow-auto">
            <PositionPanel
              positions={positions}
              pendingOrders={pendingOrders}
              tradeHistory={tradeHistory}
              currentPrice={currentPrice}
              onClosePosition={handleClosePosition}
              onCancelOrder={handleCancelOrder}
              activeTab={bottomTab}
              onTabChange={setBottomTab}
            />
          </div>
        </div>

        {/* Right Sidebar - Order Panel */}
        <div className="w-[280px] border-l border-border shrink-0 overflow-y-auto">
          <OrderPanel
            currentPrice={currentPrice}
            onPlaceOrder={handlePlaceOrder}
            disabled={!sim.isRunning || currentPrice === 0}
          />
        </div>
      </div>
    </div>
  );
};

export default Index;
