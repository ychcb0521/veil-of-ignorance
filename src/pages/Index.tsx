import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTimeSimulator } from '@/hooks/useTimeSimulator';
import { useBinanceData, type KlineData } from '@/hooks/useBinanceData';
import { usePersistedState, loadPersistedSimState, saveSimState, clearSimState } from '@/hooks/usePersistedState';
import { TimeControl } from '@/components/TimeControl';
import { CandlestickChart } from '@/components/CandlestickChart';
import { OrderPanel } from '@/components/OrderPanel';
import type { PlaceOrderParams } from '@/components/OrderPanel';
import { PositionPanel } from '@/components/PositionPanel';
import { SymbolSelector } from '@/components/SymbolSelector';
import { AccountInfo } from '@/components/AccountInfo';
import { toast } from 'sonner';
import type { Position, PendingOrder, TradeRecord, OrderSide, OrderType, MarginMode } from '@/types/trading';
import { calcFee, calcUnrealizedPnl } from '@/types/trading';

// ===== Helper: calculate available balance =====
function getAvailableBalance(balance: number, positions: Position[]): number {
  const totalMargin = positions.reduce((sum, p) => sum + p.margin, 0);
  return balance - totalMargin;
}

// ===== Helper: execute a fill (market or limit at given price) =====
function executeFill(
  fillPrice: number,
  order: { side: OrderSide; quantity: number; leverage: number; marginMode: MarginMode },
  isMaker: boolean,
): { fee: number; margin: number; position: Position } {
  const fee = calcFee(fillPrice, order.quantity, isMaker);
  const margin = (order.quantity * fillPrice) / order.leverage;
  return {
    fee,
    margin,
    position: {
      side: order.side,
      entryPrice: fillPrice,
      quantity: order.quantity,
      leverage: order.leverage,
      marginMode: order.marginMode,
      margin,
    },
  };
}

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

      if (order.type === 'LIMIT' || order.type === 'POST_ONLY') {
        // Standard limit matching
        if (order.side === 'LONG' && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
        else if (order.side === 'SHORT' && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
      } else if (order.type === 'MARKET_TP_SL') {
        // Trigger → immediate market fill
        if (order.side === 'LONG' && kline.high >= order.stopPrice) { triggered = true; fillPrice = order.stopPrice; }
        else if (order.side === 'SHORT' && kline.low <= order.stopPrice) { triggered = true; fillPrice = order.stopPrice; }
      } else if (order.type === 'LIMIT_TP_SL') {
        // Trigger → then limit match
        if (order.side === 'LONG' && kline.high >= order.stopPrice && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
        else if (order.side === 'SHORT' && kline.low <= order.stopPrice && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
      } else if (order.type === 'CONDITIONAL') {
        if (order.conditionalExecType === 'MARKET') {
          if (order.side === 'LONG' && kline.high >= order.stopPrice) { triggered = true; fillPrice = order.stopPrice; }
          else if (order.side === 'SHORT' && kline.low <= order.stopPrice) { triggered = true; fillPrice = order.stopPrice; }
        } else {
          const lp = order.conditionalLimitPrice || order.price;
          if (order.side === 'LONG' && kline.high >= order.stopPrice && kline.low <= lp) { triggered = true; fillPrice = lp; }
          else if (order.side === 'SHORT' && kline.low <= order.stopPrice && kline.high >= lp) { triggered = true; fillPrice = lp; }
        }
      }
      // Note: Trailing Stop and TWAP are complex stateful orders — offline matching skips them for simplicity

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
  const persistedSim = useMemo(() => loadPersistedSimState(), []);
  const restoredRunning = persistedSim?.isRunning ?? false;

  const [symbol, setSymbol] = usePersistedState('symbol', persistedSim?.symbol ?? 'BTCUSDT');
  const [interval, setIntervalVal] = usePersistedState('interval', persistedSim?.interval ?? '1m');
  const [positions, setPositions] = usePersistedState<Position[]>('positions', []);
  const [pendingOrders, setPendingOrders] = usePersistedState<PendingOrder[]>('pending_orders', []);
  const [tradeHistory, setTradeHistory] = usePersistedState<TradeRecord[]>('trade_history', []);
  const [balance, setBalance] = usePersistedState('balance', 1_000_000);
  const [bottomTab, setBottomTab] = useState('positions');

  const sim = useTimeSimulator(
    restoredRunning && persistedSim ? {
      isRunning: true,
      historicalAnchorTime: persistedSim.historicalAnchorTime,
      realStartTime: persistedSim.realStartTime,
      speed: persistedSim.speed,
    } : undefined
  );

  const { allData, loading, loadingOlder, error, initLoad, loadOlder, getVisibleData, reset } = useBinanceData();

  // Persist sim state
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
      clearSimState();
    }
  }, [sim.isRunning, sim.historicalAnchorTime, sim.realStartTime, sim.speed, symbol, interval]);

  // Auto-restore data on mount
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (!restoredRunning || hasRestoredRef.current || !persistedSim) return;
    hasRestoredRef.current = true;

    (async () => {
      const anchorTime = persistedSim.historicalAnchorTime!;
      // For restore, use current sim time as anchor so we have data up to now
      const currentSim = anchorTime + (Date.now() - persistedSim.realStartTime!) * persistedSim.speed;
      const data = await initLoad(persistedSim.symbol, persistedSim.interval, currentSim);

      if (data.length > 0 && pendingOrders.length > 0) {
        const offlineKlines = data.filter(k => k.time <= currentSim);
        const result = matchOrdersOffline(pendingOrders, offlineKlines, balance);

        if (result.positions.length > 0) {
          setPositions(prev => [...prev, ...result.positions]);
          setPendingOrders(result.remainingOrders);
          setBalance(result.newBalance);
          toast.success(`离线期间 ${result.positions.length} 笔委托已自动成交`);
        }
      }

      if (data.length > 0) {
        toast.info('已恢复模拟会话');
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

  // =====================================================================
  // MATCHING ENGINE: Process pending orders against new klines
  // Handles: LIMIT, POST_ONLY, LIMIT_TP_SL, MARKET_TP_SL, CONDITIONAL,
  //          TRAILING_STOP, TWAP (time-driven in separate effect)
  // =====================================================================
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
          let isMaker = true;
          let convertToLimit = false;
          let updatedOrder = { ...order };

          switch (order.type) {
            // ---- LIMIT: standard limit fill ----
            case 'LIMIT':
            case 'POST_ONLY': {
              if (order.side === 'LONG' && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
              else if (order.side === 'SHORT' && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
              break;
            }

            // ---- MARKET_TP_SL: trigger → immediate market fill ----
            case 'MARKET_TP_SL': {
              // When price reaches trigger, execute at market (close price)
              if (order.side === 'LONG' && kline.high >= order.stopPrice) { triggered = true; fillPrice = kline.close; isMaker = false; }
              else if (order.side === 'SHORT' && kline.low <= order.stopPrice) { triggered = true; fillPrice = kline.close; isMaker = false; }
              break;
            }

            // ---- LIMIT_TP_SL: trigger activates → then limit fill ----
            case 'LIMIT_TP_SL': {
              // Step 1: Check if trigger price is hit
              const triggerHit = (order.side === 'LONG' && kline.high >= order.stopPrice)
                || (order.side === 'SHORT' && kline.low <= order.stopPrice);
              if (triggerHit) {
                // Step 2: Check if limit price is also fillable in this kline
                if (order.side === 'LONG' && kline.low <= order.price) { triggered = true; fillPrice = order.price; }
                else if (order.side === 'SHORT' && kline.high >= order.price) { triggered = true; fillPrice = order.price; }
                else {
                  // Trigger hit but limit not yet fillable → convert to active limit
                  convertToLimit = true;
                  updatedOrder = { ...order, type: 'LIMIT', status: 'ACTIVE' };
                }
              }
              break;
            }

            // ---- CONDITIONAL: trigger → market or limit ----
            case 'CONDITIONAL': {
              const trigHit = (order.side === 'LONG' && kline.high >= order.stopPrice)
                || (order.side === 'SHORT' && kline.low <= order.stopPrice);
              if (trigHit) {
                if (order.conditionalExecType === 'MARKET') {
                  triggered = true; fillPrice = kline.close; isMaker = false;
                } else {
                  const lp = order.conditionalLimitPrice || order.price;
                  if (order.side === 'LONG' && kline.low <= lp) { triggered = true; fillPrice = lp; }
                  else if (order.side === 'SHORT' && kline.high >= lp) { triggered = true; fillPrice = lp; }
                  else {
                    convertToLimit = true;
                    updatedOrder = { ...order, type: 'LIMIT', price: lp, status: 'ACTIVE' };
                  }
                }
              }
              break;
            }

            // ---- TRAILING_STOP: dynamic peak/trough tracking ----
            case 'TRAILING_STOP': {
              const rate = order.callbackRate || 0.01;

              // Check activation (if trigger price set, wait for it)
              if (!order.trailingActivated) {
                if (order.stopPrice > 0) {
                  const activateHit = (order.side === 'LONG' && kline.high >= order.stopPrice)
                    || (order.side === 'SHORT' && kline.low <= order.stopPrice);
                  if (activateHit) {
                    updatedOrder = {
                      ...order,
                      trailingActivated: true,
                      peakPrice: order.side === 'LONG' ? kline.high : undefined,
                      troughPrice: order.side === 'SHORT' ? kline.low : undefined,
                    };
                    convertToLimit = true; // keep in pending with updated state
                  } else {
                    remaining.push(order);
                    continue;
                  }
                } else {
                  // No trigger price → activate immediately
                  updatedOrder = {
                    ...order,
                    trailingActivated: true,
                    peakPrice: order.side === 'LONG' ? kline.high : undefined,
                    troughPrice: order.side === 'SHORT' ? kline.low : undefined,
                  };
                  // Continue to check trigger in same kline
                }
              }

              if (updatedOrder.trailingActivated || order.trailingActivated) {
                const src = updatedOrder.trailingActivated ? updatedOrder : order;
                if (src.side === 'LONG') {
                  // Track peak, trigger when price drops below peak * (1 - rate)
                  const peak = Math.max(src.peakPrice || 0, kline.high);
                  const triggerLevel = peak * (1 - rate);
                  if (kline.low <= triggerLevel) {
                    triggered = true;
                    fillPrice = src.trailingExecType === 'LIMIT' ? (src.trailingLimitPrice || triggerLevel) : kline.close;
                    isMaker = src.trailingExecType === 'LIMIT';
                  } else {
                    convertToLimit = true;
                    updatedOrder = { ...src, peakPrice: peak, trailingActivated: true };
                  }
                } else {
                  // SHORT: track trough, trigger when price rises above trough * (1 + rate)
                  const trough = Math.min(src.troughPrice || Infinity, kline.low);
                  const triggerLevel = trough * (1 + rate);
                  if (kline.high >= triggerLevel) {
                    triggered = true;
                    fillPrice = src.trailingExecType === 'LIMIT' ? (src.trailingLimitPrice || triggerLevel) : kline.close;
                    isMaker = src.trailingExecType === 'LIMIT';
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
            filledIds.push(order.id);
            const { fee, margin, position } = executeFill(fillPrice, order, isMaker);

            setBalance(prev => prev - margin - fee);
            setPositions(prev => [...prev, position]);
            toast.success(`委托成交: ${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity} @ ${fillPrice.toFixed(2)}`);
          } else if (convertToLimit) {
            remaining.push(updatedOrder);
          } else {
            remaining.push(order);
          }
        }

        return remaining;
      });
    }
  }, [visibleData.length]);

  // =====================================================================
  // TWAP ENGINE: Time-driven sub-order execution
  // Checks every render if any TWAP order's next execution time has passed
  // =====================================================================
  useEffect(() => {
    if (!sim.isRunning || currentPrice <= 0) return;

    setPendingOrders(prev => {
      let changed = false;
      const updated = prev.map(order => {
        if (order.type !== 'TWAP') return order;

        const now = sim.currentSimulatedTime;

        // Check if TWAP is complete
        if (order.twapFilledQty !== undefined && order.twapTotalQty !== undefined
          && order.twapFilledQty >= order.twapTotalQty) {
          changed = true;
          return null; // remove completed TWAP
        }

        // Check if it's time for next sub-order
        if (order.twapNextExecTime && now >= order.twapNextExecTime) {
          const totalQty = order.twapTotalQty || order.quantity;
          const intervalMs = order.twapInterval || 300000;
          const endTime = order.twapEndTime || (order.createdAt + 3600000);
          const totalSlices = Math.max(1, Math.floor((endTime - order.createdAt) / intervalMs));
          const sliceQty = totalQty / totalSlices;
          const filledSoFar = order.twapFilledQty || 0;

          if (filledSoFar + sliceQty <= totalQty + 0.0001 && now < endTime) {
            // Execute a sub-order at market
            const { fee, margin, position } = executeFill(currentPrice, {
              side: order.side, quantity: sliceQty, leverage: order.leverage, marginMode: order.marginMode,
            }, false);

            setBalance(b => b - margin - fee);
            setPositions(p => [...p, position]);
            toast.info(`TWAP 子单成交: ${sliceQty.toFixed(4)} @ ${currentPrice.toFixed(2)}`);

            changed = true;
            return {
              ...order,
              twapFilledQty: filledSoFar + sliceQty,
              twapNextExecTime: order.twapNextExecTime! + intervalMs,
            };
          } else {
            // TWAP complete
            changed = true;
            toast.success(`TWAP 委托已全部完成`);
            return null;
          }
        }

        return order;
      }).filter(Boolean) as PendingOrder[];

      return changed ? updated : prev;
    });
  }, [sim.currentSimulatedTime, sim.isRunning, currentPrice]);

  const handleStart = useCallback(async (timestamp: number) => {
    const data = await initLoad(symbol, interval, timestamp);
    if (data.length > 0) {
      prevVisibleLenRef.current = 0;
      sim.startSimulation(timestamp);
      toast.success('时间机器已启动', {
        description: `已加载 ${data.length} 根K线 · 向左拖动可加载更多历史数据`,
      });
    } else {
      toast.error('数据获取失败', { description: error || '请检查时间范围和交易对' });
    }
  }, [symbol, interval, initLoad, sim, error]);

  // =====================================================================
  // PLACE ORDER: Handles all 9 order types
  // =====================================================================
  const handlePlaceOrder = useCallback((order: PlaceOrderParams) => {
    const availableBalance = getAvailableBalance(balance, positions);

    // =====================================================================
    // BEST PRICE: simulate aggressive limit near current price
    // Buy → slightly above current (eat ask), Sell → slightly below (eat bid)
    // =====================================================================
    if (order.priceSelection === 'BEST') {
      const offset = currentPrice * 0.0001;
      const bestPrice = order.side === 'LONG'
        ? currentPrice * (1 + 0.0001)
        : currentPrice * (1 - 0.0001);
      // Treat as immediate fill at best price
      const { fee, margin, position } = executeFill(bestPrice, order, false);
      if (margin + fee > availableBalance) {
        toast.error('可用余额不足', {
          description: `需要 ${(margin + fee).toFixed(2)} USDT，可用 ${availableBalance.toFixed(2)} USDT`,
        });
        return;
      }
      setBalance(prev => prev - margin - fee);
      setPositions(prev => [...prev, position]);
      toast.success(`最优价成交: ${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity.toFixed(6)} @ ${bestPrice.toFixed(2)}`);
      return;
    }

    // ---- MARKET ORDER: immediate fill ----
    if (order.type === 'MARKET') {
      const { fee, margin, position } = executeFill(currentPrice, order, false);
      if (margin + fee > availableBalance) {
        toast.error('可用余额不足', {
          description: `需要 ${(margin + fee).toFixed(2)} USDT，可用 ${availableBalance.toFixed(2)} USDT`,
        });
        return;
      }
      setBalance(prev => prev - margin - fee);
      setPositions(prev => [...prev, position]);
      toast.success(`${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity.toFixed(6)} @ ${currentPrice.toFixed(2)}`);
      return;
    }

    // ---- POST ONLY: reject if would immediately fill ----
    if (order.type === 'POST_ONLY') {
      // Post Only must NOT immediately match. If it would, reject.
      if (order.side === 'LONG' && order.price >= currentPrice) {
        toast.error('Post Only 被拒绝', { description: '买单限价 ≥ 当前价，会立即成交' });
        return;
      }
      if (order.side === 'SHORT' && order.price <= currentPrice) {
        toast.error('Post Only 被拒绝', { description: '卖单限价 ≤ 当前价，会立即成交' });
        return;
      }
      // Otherwise, place as limit order with maker fee
    }

    // ---- SCALED ORDER: split into multiple limit orders ----
    if (order.type === 'SCALED') {
      const count = order.scaledCount || 5;
      const startP = order.scaledStartPrice || 0;
      const endP = order.scaledEndPrice || 0;
      if (count < 2 || startP <= 0 || endP <= 0) {
        toast.error('分段订单参数无效'); return;
      }
      const step = (endP - startP) / (count - 1);
      const qtyPerStep = order.quantity / count;
      const totalMarginNeeded = Array.from({ length: count }, (_, i) => {
        const p = startP + step * i;
        return (qtyPerStep * p) / order.leverage + calcFee(p, qtyPerStep, true);
      }).reduce((a, b) => a + b, 0);

      if (totalMarginNeeded > availableBalance) {
        toast.error('可用余额不足', { description: `分段订单需要 ${totalMarginNeeded.toFixed(2)} USDT` });
        return;
      }

      const parentId = crypto.randomUUID();
      const newOrders: PendingOrder[] = Array.from({ length: count }, (_, i) => ({
        id: crypto.randomUUID(),
        side: order.side,
        type: 'LIMIT' as OrderType,
        price: startP + step * i,
        stopPrice: 0,
        quantity: qtyPerStep,
        leverage: order.leverage,
        marginMode: order.marginMode,
        status: 'NEW' as const,
        createdAt: sim.currentSimulatedTime,
        parentScaledId: parentId,
      }));

      setPendingOrders(prev => [...prev, ...newOrders]);
      toast.info(`分段订单已挂出: ${count} 笔限价单`);
      return;
    }

    // ---- TWAP: time-driven sub-order engine ----
    if (order.type === 'TWAP') {
      const durationMs = (order.twapDuration || 60) * 60 * 1000;
      const intervalMs = (order.twapInterval || 5) * 60 * 1000;
      const totalSlices = Math.max(1, Math.floor(durationMs / intervalMs));
      const sliceQty = order.quantity / totalSlices;

      // Check margin for first slice at least
      const firstMargin = (sliceQty * currentPrice) / order.leverage + calcFee(currentPrice, sliceQty, false);
      if (firstMargin > availableBalance) {
        toast.error('可用余额不足', { description: '无法执行第一笔 TWAP 子单' });
        return;
      }

      const twapOrder: PendingOrder = {
        id: crypto.randomUUID(),
        side: order.side,
        type: 'TWAP',
        price: 0,
        stopPrice: 0,
        quantity: order.quantity,
        leverage: order.leverage,
        marginMode: order.marginMode,
        status: 'ACTIVE',
        createdAt: sim.currentSimulatedTime,
        twapTotalQty: order.quantity,
        twapFilledQty: 0,
        twapInterval: intervalMs,
        twapNextExecTime: sim.currentSimulatedTime, // start immediately
        twapEndTime: sim.currentSimulatedTime + durationMs,
      };

      setPendingOrders(prev => [...prev, twapOrder]);
      toast.info(`TWAP 委托已启动: ${totalSlices} 笔子单，间隔 ${order.twapInterval} 分钟`);
      return;
    }

    // ---- All other pending order types (LIMIT, LIMIT_TP_SL, MARKET_TP_SL, CONDITIONAL, TRAILING_STOP) ----
    // Margin check: estimate based on current price for trigger-type orders
    const estPrice = order.price > 0 ? order.price : currentPrice;
    const estMargin = (order.quantity * estPrice) / order.leverage + calcFee(estPrice, order.quantity, true);
    if (estMargin > availableBalance) {
      toast.error('可用余额不足', {
        description: `需要 ${estMargin.toFixed(2)} USDT，可用 ${availableBalance.toFixed(2)} USDT`,
      });
      return;
    }

    const newOrder: PendingOrder = {
      id: crypto.randomUUID(),
      side: order.side,
      type: order.type,
      price: order.price,
      stopPrice: order.stopPrice,
      quantity: order.quantity,
      leverage: order.leverage,
      marginMode: order.marginMode,
      status: 'NEW',
      createdAt: sim.currentSimulatedTime,
      // Trailing stop fields
      callbackRate: order.callbackRate,
      trailingExecType: order.trailingExecType,
      trailingLimitPrice: order.trailingLimitPrice,
      trailingActivated: false,
      // Conditional fields
      conditionalExecType: order.conditionalExecType,
      conditionalLimitPrice: order.conditionalLimitPrice,
    };

    setPendingOrders(prev => [...prev, newOrder]);

    const typeLabels: Record<string, string> = {
      LIMIT: '限价', POST_ONLY: '只做Maker', LIMIT_TP_SL: '限价止盈止损',
      MARKET_TP_SL: '市价止盈止损', CONDITIONAL: '条件委托', TRAILING_STOP: '跟踪委托',
    };
    toast.info(`${typeLabels[order.type] || order.type} 委托已挂出`);
  }, [currentPrice, balance, positions, sim.currentSimulatedTime]);

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
      description: `${pnl >= 0 ? '+' : ''}${(pnl - fee).toFixed(2)} USDT`,
    });
  }, [positions, currentPrice, sim.currentSimulatedTime]);

  const handleCancelOrder = useCallback((id: string) => {
    setPendingOrders(prev => prev.filter(o => o.id !== id));
    toast.info('委托已撤销');
  }, []);

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#0B0E11' }}>
      <header className="border-b border-border px-4 py-1.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-xs font-bold text-primary tracking-widest uppercase">⚡ Futures Sim</h1>
          <SymbolSelector symbol={symbol} interval={interval} onSymbolChange={setSymbol} onIntervalChange={setIntervalVal} />
        </div>
        {loading && <span className="text-[10px] text-primary animate-pulse font-mono">加载历史数据...</span>}
      </header>

      <div className="shrink-0">
        <TimeControl isRunning={sim.isRunning} currentSimulatedTime={sim.currentSimulatedTime}
          speed={sim.speed} onStart={handleStart} onStop={sim.stopSimulation} onSetSpeed={sim.setSpeed} />
      </div>

      <div className="shrink-0">
        <AccountInfo balance={balance} positions={positions} currentPrice={currentPrice} />
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          <div className="flex-1 min-h-0">
            {!sim.isRunning && visibleData.length === 0 ? (
              <div className="h-full flex items-center justify-center" style={{ background: '#0B0E11' }}>
                <div className="text-center space-y-3">
                  <div className="text-5xl">⏰</div>
                  <p className="text-sm text-muted-foreground">输入历史时间并点击「启动」开始复盘模拟</p>
                  <p className="text-xs text-muted-foreground">K线按真实时间 1:1 流速推进 · 绝不暴露未来数据</p>
                </div>
              </div>
            ) : (
              <CandlestickChart data={visibleData} symbol={symbol.replace('USDT', '/USDT')} />
            )}
          </div>

          <div className="shrink-0 border-t border-border max-h-[200px] overflow-auto">
            <PositionPanel positions={positions} pendingOrders={pendingOrders} tradeHistory={tradeHistory}
              currentPrice={currentPrice} onClosePosition={handleClosePosition} onCancelOrder={handleCancelOrder}
              activeTab={bottomTab} onTabChange={setBottomTab} />
          </div>
        </div>

        <div className="w-[280px] border-l border-border shrink-0 overflow-y-auto">
          <OrderPanel currentPrice={currentPrice} onPlaceOrder={handlePlaceOrder}
            disabled={!sim.isRunning || currentPrice === 0} symbol={symbol} />
        </div>
      </div>
    </div>
  );
};

export default Index;
