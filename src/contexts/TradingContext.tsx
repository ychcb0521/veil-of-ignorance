/**
 * Global Trading Context
 * 
 * Manages:
 * - Global simulated clock (single source of truth)
 * - Multi-symbol positions & pending orders
 * - Wallet balance & trade history
 * - Liquidation engine, fees, slippage
 */

import React, { createContext, useContext, useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { useTimeSimulator } from '@/hooks/useTimeSimulator';
import { usePersistedState, loadPersistedSimState, saveSimState, clearSimState } from '@/hooks/usePersistedState';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Position, PendingOrder, TradeRecord, OrderSide, OrderType, MarginMode } from '@/types/trading';
import { calcFee, calcUnrealizedPnl, calcSlippage, MAINTENANCE_MARGIN_RATE, LIQUIDATION_FEE_RATE } from '@/types/trading';

// ===== Types =====
export type PositionsMap = Record<string, Position[]>;
export type OrdersMap = Record<string, PendingOrder[]>;
export type PriceMap = Record<string, number>;

interface LiquidationDetails { lostAmount: number; liquidatedPositions: number; }

interface TradingState {
  sim: ReturnType<typeof useTimeSimulator>;
  activeSymbol: string;
  setActiveSymbol: (s: string) => void;
  interval: string;
  setInterval: (i: string) => void;
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
  activeSymbolPositions: Position[];
  activeSymbolOrders: PendingOrder[];
  allPositions: { symbol: string; position: Position }[];
  allOrders: { symbol: string; order: PendingOrder }[];
  currentPrice: number;
  activeSymbols: string[];
  handlePlaceOrder: (symbol: string, order: PlaceOrderParams) => void;
  handleClosePosition: (symbol: string, index: number) => void;
  handleCancelOrder: (symbol: string, orderId: string) => void;
  // Liquidation modal
  liquidationOpen: boolean;
  liquidationDetails: LiquidationDetails | undefined;
  closeLiquidationModal: () => void;
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

function applySlippageIfTaker(price: number, quantity: number, side: OrderSide, isMaker: boolean): { fillPrice: number; slippage: number } {
  if (isMaker) return { fillPrice: price, slippage: 0 };
  const notional = price * quantity;
  const slippedPrice = calcSlippage(price, notional, side);
  return { fillPrice: slippedPrice, slippage: Math.abs(slippedPrice - price) * quantity };
}

function executeFill(
  rawPrice: number,
  order: { side: OrderSide; quantity: number; leverage: number; marginMode: MarginMode },
  isMaker: boolean,
): { fee: number; margin: number; slippage: number; position: Position } {
  const { fillPrice, slippage } = applySlippageIfTaker(rawPrice, order.quantity, order.side, isMaker);
  const fee = calcFee(fillPrice, order.quantity, isMaker);
  const margin = (order.quantity * fillPrice) / order.leverage;
  return {
    fee, margin, slippage,
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

  // Liquidation modal state
  const [liquidationOpen, setLiquidationOpen] = useState(false);
  const [liquidationDetails, setLiquidationDetails] = useState<LiquidationDetails | undefined>();
  const closeLiquidationModal = useCallback(() => setLiquidationOpen(false), []);

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

  // ===== LIQUIDATION ENGINE =====
  // Runs on every price update — checks maintenance margin across all positions
  const liquidationCheckRef = useRef(false);
  useEffect(() => {
    if (!sim.isRunning || liquidationCheckRef.current) return;

    // Calculate total equity
    let totalUnrealizedPnl = 0;
    let totalMargin = 0;
    let totalPositionCount = 0;
    for (const [sym, positions] of Object.entries(positionsMap)) {
      const price = priceMap[sym] || 0;
      if (price <= 0) continue;
      for (const pos of positions) {
        totalUnrealizedPnl += calcUnrealizedPnl(pos, price);
        totalMargin += pos.margin;
        totalPositionCount++;
      }
    }

    if (totalPositionCount === 0) return;

    const totalEquity = balance + totalUnrealizedPnl;
    const maintenanceMargin = totalMargin * MAINTENANCE_MARGIN_RATE;

    // Liquidation triggered when equity <= maintenance margin or equity <= 0
    if (totalEquity > maintenanceMargin && totalEquity > 0) return;

    liquidationCheckRef.current = true;

    // Execute liquidation
    let totalLiquidationLoss = 0;
    const liquidationRecords: TradeRecord[] = [];

    for (const [sym, positions] of Object.entries(positionsMap)) {
      const price = priceMap[sym] || 0;
      if (price <= 0 || positions.length === 0) continue;

      for (const pos of positions) {
        const pnl = calcUnrealizedPnl(pos, price);
        const closeFee = calcFee(price, pos.quantity, false);
        const liquidationFee = pos.quantity * price * LIQUIDATION_FEE_RATE;
        const netLoss = pnl - closeFee - liquidationFee;
        totalLiquidationLoss += Math.abs(netLoss < 0 ? netLoss : 0) + liquidationFee;

        liquidationRecords.push({
          id: crypto.randomUUID(),
          symbol: sym,
          side: pos.side,
          type: 'MARKET',
          action: 'LIQUIDATION',
          entryPrice: pos.entryPrice,
          exitPrice: price,
          quantity: pos.quantity,
          leverage: pos.leverage,
          pnl: pnl - closeFee - liquidationFee,
          fee: closeFee + liquidationFee,
          slippage: 0,
          openTime: 0,
          closeTime: sim.currentSimulatedTime,
        });
      }
    }

    // Clear all positions and orders
    setPositionsMap({});
    setOrdersMap({});
    // Set balance to whatever equity remains (could be 0 or negative clamped to 0)
    setBalance(Math.max(0, totalEquity - totalLiquidationLoss * 0.1)); // residual
    setTradeHistory(prev => [...prev, ...liquidationRecords]);

    // Show modal
    setLiquidationDetails({ lostAmount: totalLiquidationLoss, liquidatedPositions: totalPositionCount });
    setLiquidationOpen(true);

    toast.error('🚨 爆仓！所有仓位已被强制平仓', { duration: 10000 });

    // Reset flag after a short delay
    setTimeout(() => { liquidationCheckRef.current = false; }, 2000);
  }, [priceMap, positionsMap, balance, sim.isRunning, sim.currentSimulatedTime]);

  // ===== Place Order =====
  const handlePlaceOrder = useCallback((symbol: string, order: PlaceOrderParams) => {
    const availableBalance = getAvailableBalance(balance, positionsMap);
    const symbolPrice = priceMap[symbol] || 0;
    if (symbolPrice <= 0 && order.type === 'MARKET') {
      toast.error('无法获取当前价格'); return;
    }

    const effectiveCurrentPrice = symbolPrice;
    const now = sim.currentSimulatedTime;

    // Helper to record an open trade
    const recordOpen = (fillPrice: number, qty: number, side: OrderSide, fee: number, slippage: number) => {
      setTradeHistory(prev => [...prev, {
        id: crypto.randomUUID(), symbol, side, type: order.type,
        action: 'OPEN' as const, entryPrice: fillPrice, exitPrice: 0,
        quantity: qty, leverage: order.leverage,
        pnl: 0, fee, slippage, openTime: now, closeTime: 0,
      }]);
    };

    // BEST PRICE (taker)
    if (order.priceSelection === 'BEST') {
      const { fee, margin, slippage, position } = executeFill(effectiveCurrentPrice, order, false);
      if (margin + fee > availableBalance) { toast.error('可用余额不足'); return; }
      setBalance(prev => prev - margin - fee);
      setPositionsMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), position] }));
      recordOpen(position.entryPrice, order.quantity, order.side, fee, slippage);
      toast.success(`最优价成交: ${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity.toFixed(6)} @ ${position.entryPrice.toFixed(2)} (滑点: ${slippage.toFixed(2)})`);
      return;
    }

    // MARKET (taker with slippage)
    if (order.type === 'MARKET') {
      const { fee, margin, slippage, position } = executeFill(effectiveCurrentPrice, order, false);
      if (margin + fee > availableBalance) { toast.error('可用余额不足'); return; }
      setBalance(prev => prev - margin - fee);
      setPositionsMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), position] }));
      recordOpen(position.entryPrice, order.quantity, order.side, fee, slippage);
      toast.success(`${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity.toFixed(6)} @ ${position.entryPrice.toFixed(2)} (滑点: ${slippage.toFixed(2)})`);
      return;
    }

    // POST ONLY
    if (order.type === 'POST_ONLY') {
      if (order.side === 'LONG' && order.price >= effectiveCurrentPrice) { toast.error('Post Only 被拒绝'); return; }
      if (order.side === 'SHORT' && order.price <= effectiveCurrentPrice) { toast.error('Post Only 被拒绝'); return; }
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
        status: 'NEW' as const, createdAt: now, parentScaledId: parentId,
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
        status: 'ACTIVE', createdAt: now,
        twapTotalQty: order.quantity, twapFilledQty: 0,
        twapInterval: intervalMs, twapNextExecTime: now,
        twapEndTime: now + durationMs,
      };
      setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), twapOrder] }));
      toast.info(`TWAP 委托已启动`);
      return;
    }

    // All other pending types
    const estPrice = order.price > 0 ? order.price : effectiveCurrentPrice;
    const estMargin = (order.quantity * estPrice) / order.leverage + calcFee(estPrice, order.quantity, true);
    if (estMargin > availableBalance) { toast.error('可用余额不足'); return; }

    const newOrder: PendingOrder = {
      id: crypto.randomUUID(), side: order.side, type: order.type,
      price: order.price, stopPrice: order.stopPrice, quantity: order.quantity,
      leverage: order.leverage, marginMode: order.marginMode,
      status: 'NEW', createdAt: now,
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
    const rawPrice = priceMap[symbol] || 0;
    // Apply slippage on close (taker)
    const closeSide: OrderSide = pos.side === 'LONG' ? 'SHORT' : 'LONG';
    const { fillPrice, slippage } = applySlippageIfTaker(rawPrice, pos.quantity, closeSide, false);
    const pnl = pos.side === 'LONG'
      ? (fillPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - fillPrice) * pos.quantity;
    const fee = calcFee(fillPrice, pos.quantity, false);

    setBalance(prev => prev + pos.margin + pnl - fee);
    setPositionsMap(prev => ({
      ...prev,
      [symbol]: (prev[symbol] || []).filter((_, i) => i !== index),
    }));
    setTradeHistory(prev => [...prev, {
      id: crypto.randomUUID(), symbol, side: pos.side, type: 'MARKET' as OrderType,
      action: 'CLOSE' as const, entryPrice: pos.entryPrice, exitPrice: fillPrice,
      quantity: pos.quantity, leverage: pos.leverage,
      pnl: pnl - fee, fee, slippage, openTime: 0, closeTime: sim.currentSimulatedTime,
    }]);
    toast(pnl >= 0 ? '盈利平仓 ✅' : '亏损平仓 ❌', {
      description: `${symbol} ${pnl >= 0 ? '+' : ''}${(pnl - fee).toFixed(2)} USDT (滑点: ${slippage.toFixed(2)})`,
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
    liquidationOpen, liquidationDetails, closeLiquidationModal,
  };

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}
