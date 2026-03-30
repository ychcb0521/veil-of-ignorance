/**
 * Global Trading Context
 * 
 * Manages:
 * - Global simulated clock (single source of truth)
 * - Multi-symbol positions & pending orders (Record<symbol, T[]>)
 * - Wallet balance & trade history
 * - Symbol latest prices map
 * - Background matching engine for all active symbols
 */

import React, { createContext, useContext, useCallback, useEffect, useRef, useMemo } from 'react';
import { useTimeSimulator } from '@/hooks/useTimeSimulator';
import { usePersistedState, loadPersistedSimState, saveSimState, clearSimState } from '@/hooks/usePersistedState';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Position, PendingOrder, TradeRecord, OrderSide, OrderType, MarginMode } from '@/types/trading';
import { calcFee, calcUnrealizedPnl } from '@/types/trading';

// ===== Types =====
export type PositionsMap = Record<string, Position[]>;
export type OrdersMap = Record<string, PendingOrder[]>;
export type PriceMap = Record<string, number>;

interface TradingState {
  // Global clock
  sim: ReturnType<typeof useTimeSimulator>;
  // Active viewing symbol (chart)
  activeSymbol: string;
  setActiveSymbol: (s: string) => void;
  interval: string;
  setInterval: (i: string) => void;
  // Multi-symbol state
  positionsMap: PositionsMap;
  setPositionsMap: (v: PositionsMap | ((prev: PositionsMap) => PositionsMap)) => void;
  ordersMap: OrdersMap;
  setOrdersMap: (v: OrdersMap | ((prev: OrdersMap) => OrdersMap)) => void;
  priceMap: PriceMap;
  setPriceMap: (v: PriceMap | ((prev: PriceMap) => PriceMap)) => void;
  balance: number;
  setBalance: (v: number | ((prev: number) => number)) => void;
  tradeHistory: TradeRecord[];
  setTradeHistory: (v: TradeRecord[] | ((prev: TradeRecord[]) => TradeRecord[])) => void;
  // Computed helpers
  activeSymbolPositions: Position[];
  activeSymbolOrders: PendingOrder[];
  allPositions: { symbol: string; position: Position }[];
  allOrders: { symbol: string; order: PendingOrder }[];
  currentPrice: number;
  activeSymbols: string[]; // symbols with positions or orders
  // Actions
  handlePlaceOrder: (symbol: string, order: PlaceOrderParams) => void;
  handleClosePosition: (symbol: string, index: number) => void;
  handleCancelOrder: (symbol: string, orderId: string) => void;
}

export interface PlaceOrderParams {
  side: OrderSide;
  type: OrderType;
  price: number;
  stopPrice: number;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  priceSelection: 'MARKET' | 'LIMIT' | 'BEST';
  triggerType: 'MARK' | 'LAST';
  currencyUnit: 'BASE' | 'USDT';
  usdtInputMode: 'ORDER_VALUE' | 'INITIAL_MARGIN';
  inputAmount: number;
  callbackRate?: number;
  trailingExecType?: 'MARKET' | 'LIMIT';
  trailingLimitPrice?: number;
  twapDuration?: number;
  twapInterval?: number;
  conditionalExecType?: 'MARKET' | 'LIMIT';
  conditionalLimitPrice?: number;
  scaledCount?: number;
  scaledStartPrice?: number;
  scaledEndPrice?: number;
}

const TradingContext = createContext<TradingState | null>(null);

export function useTradingContext() {
  const ctx = useContext(TradingContext);
  if (!ctx) throw new Error('useTradingContext must be used within TradingProvider');
  return ctx;
}

// ===== Helpers =====
function getAvailableBalance(balance: number, positionsMap: PositionsMap): number {
  let totalMargin = 0;
  for (const positions of Object.values(positionsMap)) {
    for (const p of positions) totalMargin += p.margin;
  }
  return balance - totalMargin;
}

function executeFill(
  fillPrice: number,
  order: { side: OrderSide; quantity: number; leverage: number; marginMode: MarginMode },
  isMaker: boolean,
): { fee: number; margin: number; position: Position } {
  const fee = calcFee(fillPrice, order.quantity, isMaker);
  const margin = (order.quantity * fillPrice) / order.leverage;
  return {
    fee, margin,
    position: {
      side: order.side, entryPrice: fillPrice, quantity: order.quantity,
      leverage: order.leverage, marginMode: order.marginMode, margin,
    },
  };
}

// ===== Provider =====
export function TradingProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const initialCapital = profile?.initial_capital ?? 1_000_000;

  const persistedSim = useMemo(() => loadPersistedSimState(), []);
  const restoredRunning = persistedSim?.isRunning ?? false;

  const sim = useTimeSimulator(
    restoredRunning && persistedSim ? {
      isRunning: true,
      historicalAnchorTime: persistedSim.historicalAnchorTime,
      realStartTime: persistedSim.realStartTime,
      speed: persistedSim.speed,
    } : undefined
  );

  const [activeSymbol, setActiveSymbol] = usePersistedState('symbol', persistedSim?.symbol ?? 'BTCUSDT');
  const [interval, setInterval] = usePersistedState('interval', persistedSim?.interval ?? '1m');
  const [positionsMap, setPositionsMap] = usePersistedState<PositionsMap>('positions_map', {});
  const [ordersMap, setOrdersMap] = usePersistedState<OrdersMap>('orders_map', {});
  const [priceMap, setPriceMap] = usePersistedState<PriceMap>('price_map', {});
  const [balance, setBalance] = usePersistedState('balance', initialCapital);
  const [tradeHistory, setTradeHistory] = usePersistedState<TradeRecord[]>('trade_history', []);

  // Persist sim state
  useEffect(() => {
    if (sim.isRunning) {
      saveSimState({
        isRunning: true,
        historicalAnchorTime: sim.historicalAnchorTime,
        realStartTime: sim.realStartTime,
        speed: sim.speed,
        symbol: activeSymbol,
        interval,
      });
    }
  }, [sim.isRunning, sim.historicalAnchorTime, sim.realStartTime, sim.speed, activeSymbol, interval]);

  // Computed
  const activeSymbolPositions = useMemo(() => positionsMap[activeSymbol] || [], [positionsMap, activeSymbol]);
  const activeSymbolOrders = useMemo(() => ordersMap[activeSymbol] || [], [ordersMap, activeSymbol]);
  const currentPrice = priceMap[activeSymbol] || 0;

  const allPositions = useMemo(() => {
    const result: { symbol: string; position: Position }[] = [];
    for (const [sym, positions] of Object.entries(positionsMap)) {
      for (const p of positions) result.push({ symbol: sym, position: p });
    }
    return result;
  }, [positionsMap]);

  const allOrders = useMemo(() => {
    const result: { symbol: string; order: PendingOrder }[] = [];
    for (const [sym, orders] of Object.entries(ordersMap)) {
      for (const o of orders) result.push({ symbol: sym, order: o });
    }
    return result;
  }, [ordersMap]);

  const activeSymbols = useMemo(() => {
    const syms = new Set<string>();
    for (const [sym, positions] of Object.entries(positionsMap)) {
      if (positions.length > 0) syms.add(sym);
    }
    for (const [sym, orders] of Object.entries(ordersMap)) {
      if (orders.length > 0) syms.add(sym);
    }
    return Array.from(syms);
  }, [positionsMap, ordersMap]);

  // ===== Place Order =====
  const handlePlaceOrder = useCallback((symbol: string, order: PlaceOrderParams) => {
    const availableBalance = getAvailableBalance(balance, positionsMap);
    const symbolPrice = priceMap[symbol] || 0;
    if (symbolPrice <= 0 && order.type === 'MARKET') {
      toast.error('无法获取当前价格'); return;
    }

    const effectiveCurrentPrice = symbolPrice;

    // BEST PRICE
    if (order.priceSelection === 'BEST') {
      const bestPrice = order.side === 'LONG'
        ? effectiveCurrentPrice * 1.0001
        : effectiveCurrentPrice * 0.9999;
      const { fee, margin, position } = executeFill(bestPrice, order, false);
      if (margin + fee > availableBalance) {
        toast.error('可用余额不足'); return;
      }
      setBalance(prev => prev - margin - fee);
      setPositionsMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), position] }));
      toast.success(`最优价成交: ${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity.toFixed(6)} @ ${bestPrice.toFixed(2)}`);
      return;
    }

    // MARKET
    if (order.type === 'MARKET') {
      const { fee, margin, position } = executeFill(effectiveCurrentPrice, order, false);
      if (margin + fee > availableBalance) {
        toast.error('可用余额不足'); return;
      }
      setBalance(prev => prev - margin - fee);
      setPositionsMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), position] }));
      toast.success(`${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity.toFixed(6)} @ ${effectiveCurrentPrice.toFixed(2)}`);
      return;
    }

    // POST ONLY
    if (order.type === 'POST_ONLY') {
      if (order.side === 'LONG' && order.price >= effectiveCurrentPrice) {
        toast.error('Post Only 被拒绝'); return;
      }
      if (order.side === 'SHORT' && order.price <= effectiveCurrentPrice) {
        toast.error('Post Only 被拒绝'); return;
      }
    }

    // SCALED
    if (order.type === 'SCALED') {
      const count = order.scaledCount || 5;
      const startP = order.scaledStartPrice || 0;
      const endP = order.scaledEndPrice || 0;
      if (count < 2 || startP <= 0 || endP <= 0) { toast.error('分段订单参数无效'); return; }
      const step = (endP - startP) / (count - 1);
      const qtyPerStep = order.quantity / count;
      const parentId = crypto.randomUUID();
      const newOrders: PendingOrder[] = Array.from({ length: count }, (_, i) => ({
        id: crypto.randomUUID(), side: order.side, type: 'LIMIT' as OrderType,
        price: startP + step * i, stopPrice: 0, quantity: qtyPerStep,
        leverage: order.leverage, marginMode: order.marginMode,
        status: 'NEW' as const, createdAt: sim.currentSimulatedTime,
        parentScaledId: parentId,
      }));
      setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), ...newOrders] }));
      toast.info(`分段订单已挂出: ${count} 笔限价单`);
      return;
    }

    // TWAP
    if (order.type === 'TWAP') {
      const durationMs = (order.twapDuration || 60) * 60 * 1000;
      const intervalMs = (order.twapInterval || 5) * 60 * 1000;
      const twapOrder: PendingOrder = {
        id: crypto.randomUUID(), side: order.side, type: 'TWAP',
        price: 0, stopPrice: 0, quantity: order.quantity,
        leverage: order.leverage, marginMode: order.marginMode,
        status: 'ACTIVE', createdAt: sim.currentSimulatedTime,
        twapTotalQty: order.quantity, twapFilledQty: 0,
        twapInterval: intervalMs, twapNextExecTime: sim.currentSimulatedTime,
        twapEndTime: sim.currentSimulatedTime + durationMs,
      };
      setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), twapOrder] }));
      toast.info(`TWAP 委托已启动`);
      return;
    }

    // All other pending types
    const estPrice = order.price > 0 ? order.price : effectiveCurrentPrice;
    const estMargin = (order.quantity * estPrice) / order.leverage + calcFee(estPrice, order.quantity, true);
    if (estMargin > availableBalance) {
      toast.error('可用余额不足'); return;
    }

    const newOrder: PendingOrder = {
      id: crypto.randomUUID(), side: order.side, type: order.type,
      price: order.price, stopPrice: order.stopPrice, quantity: order.quantity,
      leverage: order.leverage, marginMode: order.marginMode,
      status: 'NEW', createdAt: sim.currentSimulatedTime,
      callbackRate: order.callbackRate, trailingExecType: order.trailingExecType,
      trailingLimitPrice: order.trailingLimitPrice, trailingActivated: false,
      conditionalExecType: order.conditionalExecType, conditionalLimitPrice: order.conditionalLimitPrice,
    };
    setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), newOrder] }));
    toast.info('委托已挂出');
  }, [balance, positionsMap, priceMap, sim.currentSimulatedTime]);

  // ===== Close Position =====
  const handleClosePosition = useCallback((symbol: string, index: number) => {
    const symbolPositions = positionsMap[symbol] || [];
    const pos = symbolPositions[index];
    if (!pos) return;
    const price = priceMap[symbol] || 0;
    const pnl = calcUnrealizedPnl(pos, price);
    const fee = calcFee(price, pos.quantity, false);

    setBalance(prev => prev + pos.margin + pnl - fee);
    setPositionsMap(prev => ({
      ...prev,
      [symbol]: (prev[symbol] || []).filter((_, i) => i !== index),
    }));
    setTradeHistory(prev => [...prev, {
      id: crypto.randomUUID(), side: pos.side, type: 'MARKET',
      entryPrice: pos.entryPrice, exitPrice: price,
      quantity: pos.quantity, leverage: pos.leverage,
      pnl: pnl - fee, fee, openTime: 0, closeTime: sim.currentSimulatedTime,
    }]);
    toast(pnl >= 0 ? '盈利平仓 ✅' : '亏损平仓 ❌', {
      description: `${symbol} ${pnl >= 0 ? '+' : ''}${(pnl - fee).toFixed(2)} USDT`,
    });
  }, [positionsMap, priceMap, sim.currentSimulatedTime]);

  // ===== Cancel Order =====
  const handleCancelOrder = useCallback((symbol: string, orderId: string) => {
    setOrdersMap(prev => ({
      ...prev,
      [symbol]: (prev[symbol] || []).filter(o => o.id !== orderId),
    }));
    toast.info('委托已撤销');
  }, []);

  const value: TradingState = {
    sim,
    activeSymbol, setActiveSymbol,
    interval, setInterval,
    positionsMap, setPositionsMap,
    ordersMap, setOrdersMap,
    priceMap, setPriceMap,
    balance, setBalance,
    tradeHistory, setTradeHistory,
    activeSymbolPositions, activeSymbolOrders,
    allPositions, allOrders,
    currentPrice, activeSymbols,
    handlePlaceOrder, handleClosePosition, handleCancelOrder,
  };

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}
