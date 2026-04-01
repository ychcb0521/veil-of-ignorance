/**
 * Global Trading Context
 * 
 * Manages:
 * - Global simulated clock (single source of truth)
 * - Multi-symbol positions & pending orders
 * - **Single global wallet balance** (1,000,000 USDT) — ALL symbols share one pool
 * - Liquidation engine (cross + isolated margin modes), fees, slippage
 * - Funding rate engine (8h settlement)
 * 
 * ACCOUNTING IDENTITY (enforced at all times):
 *   Total Equity = Available Balance + Used Margin + Unrealized PnL
 * 
 * In isolated TIME mode, each symbol runs on its own timeline, but funds
 * are deducted/credited from the single global balance in the order the
 * user physically clicks (Real-world Sequential Ledger).
 */

import React, { createContext, useContext, useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { useTimeSimulator } from '@/hooks/useTimeSimulator';
import { usePersistedState, loadPersistedSimState, saveSimState, clearSimState } from '@/hooks/usePersistedState';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Position, PendingOrder, TradeRecord, OrderSide, OrderType, MarginMode } from '@/types/trading';
import {
  calcFee, calcUnrealizedPnl, calcSlippage,
  MAINTENANCE_MARGIN_RATE, LIQUIDATION_FEE_RATE, FUNDING_RATE, FUNDING_HOURS, getTriggerOperator,
} from '@/types/trading';
import { resolveConditionalTriggerPrice, shouldRejectImmediateConditionalPlacement } from '@/lib/conditionalOrders';

// ===== Types =====
export type TimeMode = 'synced' | 'isolated';

export interface CoinTimelineState {
  status: 'playing' | 'paused' | 'stopped';
  time: number;
  speed: number;
  historicalAnchorTime: number | null;
  realStartTime: number | null;
  /** The original start time the user entered — never changes after start */
  originTime: number | null;
}

export type PositionsMap = Record<string, Position[]>;
export type OrdersMap = Record<string, PendingOrder[]>;
export type PriceMap = Record<string, number>;
export type CoinTimelinesMap = Record<string, CoinTimelineState>;

/** @deprecated kept for backward compat — always empty now */
export type IsolatedBalancesMap = Record<string, number>;

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
  /** @deprecated always empty — single global balance is used */
  isolatedBalances: IsolatedBalancesMap;
  /** @deprecated no-op */
  setIsolatedBalances: (v: IsolatedBalancesMap | ((prev: IsolatedBalancesMap) => IsolatedBalancesMap)) => void;
  tradeHistory: TradeRecord[];
  setTradeHistory: (v: TradeRecord[] | ((prev: TradeRecord[]) => TradeRecord[])) => void;
  activeSymbolPositions: Position[];
  activeSymbolOrders: PendingOrder[];
  allPositions: { symbol: string; position: Position }[];
  allOrders: { symbol: string; order: PendingOrder }[];
  currentPrice: number;
  pricePrecision: number;
  quantityPrecision: number;
  setPricePrecision: (v: number) => void;
  setQuantityPrecision: (v: number) => void;
  activeSymbols: string[];
  handlePlaceOrder: (symbol: string, order: PlaceOrderParams) => void;
  handleClosePosition: (symbol: string, index: number) => void;
  handleCancelOrder: (symbol: string, orderId: string) => void;
  handleAddIsolatedMargin: (symbol: string, posIndex: number, amount: number) => void;
  handleClearSymbolData: (symbol: string) => void;
  fundingRate: number;
  liquidationOpen: boolean;
  liquidationDetails: LiquidationDetails | undefined;
  closeLiquidationModal: () => void;
  // Multi-Timeline
  timeMode: TimeMode;
  setTimeMode: (v: TimeMode) => void;
  coinTimelines: CoinTimelinesMap;
  setCoinTimelines: (v: CoinTimelinesMap | ((prev: CoinTimelinesMap) => CoinTimelinesMap)) => void;
  totalPositionCount: number;
  getEffectiveTime: (symbol?: string) => number;
  getCoinState: (symbol: string) => CoinTimelineState | null;
  /** Get the global balance (always the single pool) */
  getEffectiveBalance: (symbol: string) => number;
  /** Get available balance (global balance minus all cross margins) */
  getEffectiveAvailable: (symbol: string) => number;
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
  latestPrice?: number;
}

const TradingContext = createContext<TradingState | null>(null);

export function useTradingContext() {
  const ctx = useContext(TradingContext);
  if (!ctx) throw new Error('useTradingContext must be used within TradingProvider');
  return ctx;
}

// ===== Helpers =====

/**
 * Calculate available balance — always from the single global pool.
 * Available = balance - sum of all cross-margin positions across ALL symbols.
 */
function calcAvailable(balance: number, positionsMap: PositionsMap): number {
  let totalCrossMargin = 0;
  for (const positions of Object.values(positionsMap)) {
    for (const p of positions) {
      if (p.marginMode === 'cross') totalCrossMargin += p.margin;
    }
  }
  return balance - totalCrossMargin;
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
      isolatedMargin: order.marginMode === 'isolated' ? margin : undefined,
    },
  };
}

// ===== Provider =====
export function TradingProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const initialCapital = profile?.initial_capital ?? 1_000_000;

  const persistedSim = useMemo(() => loadPersistedSimState(), []);
  const restoredStatus = persistedSim?.status ?? 'stopped';

  const liveTimeFromStorage = useMemo(() => {
    try {
      const v = localStorage.getItem('__tm_live_time');
      return v ? Number(v) : null;
    } catch { return null; }
  }, []);
  const bestRestoredTime = liveTimeFromStorage ?? persistedSim?.currentSimulatedTime ?? 0;

  const sim = useTimeSimulator(
    (restoredStatus === 'playing' || restoredStatus === 'paused') && persistedSim ? {
      status: restoredStatus,
      historicalAnchorTime: bestRestoredTime,
      realStartTime: restoredStatus === 'playing' ? Date.now() : persistedSim.realStartTime,
      currentSimulatedTime: bestRestoredTime,
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
  const [pricePrecision, setPricePrecision] = useState(2);
  const [quantityPrecision, setQuantityPrecision] = useState(3);

  // === Multi-Timeline Mode ===
  const [timeMode, setTimeMode] = usePersistedState<TimeMode>('time_mode', 'synced');
  const [coinTimelines, setCoinTimelines] = usePersistedState<CoinTimelinesMap>('coin_timelines_v2', {});

  // Stub for backward compat — isolated balances no longer used
  const emptyIsolatedBalances: IsolatedBalancesMap = {};
  const setIsolatedBalancesNoop = useCallback((_v: IsolatedBalancesMap | ((prev: IsolatedBalancesMap) => IsolatedBalancesMap)) => {}, []);

  // Refs for latest values in callbacks
  const timeModeRef = useRef(timeMode);
  useEffect(() => { timeModeRef.current = timeMode; }, [timeMode]);

  // Total position count across all symbols
  const totalPositionCount = useMemo(() => {
    let count = 0;
    for (const positions of Object.values(positionsMap)) count += positions.length;
    return count;
  }, [positionsMap]);

  // Get a coin's isolated timeline state
  const getCoinState = useCallback((symbol: string): CoinTimelineState | null => {
    return coinTimelines[symbol] ?? null;
  }, [coinTimelines]);

  // Get effective simulation time for a given symbol
  const getEffectiveTime = useCallback((symbol?: string): number => {
    const sym = symbol || activeSymbol;
    if (timeMode === 'synced') return sim.currentSimulatedTime;
    const ct = coinTimelines[sym];
    return ct?.time ?? sim.currentSimulatedTime;
  }, [timeMode, coinTimelines, activeSymbol, sim.currentSimulatedTime]);

  // Always return the single global balance
  const getEffectiveBalance = useCallback((_symbol: string): number => {
    return balance;
  }, [balance]);

  // Always return available from the single global pool
  const getEffectiveAvailable = useCallback((_symbol: string): number => {
    return calcAvailable(balance, positionsMap);
  }, [balance, positionsMap]);

  // Liquidation modal state
  const [liquidationOpen, setLiquidationOpen] = useState(false);
  const [liquidationDetails, setLiquidationDetails] = useState<LiquidationDetails | undefined>();
  const closeLiquidationModal = useCallback(() => setLiquidationOpen(false), []);

  // Persist sim state
  useEffect(() => {
    if (sim.status !== 'stopped') {
      saveSimState({
        status: sim.status,
        historicalAnchorTime: sim.historicalAnchorTime,
        realStartTime: sim.realStartTime,
        currentSimulatedTime: sim.currentSimulatedTime,
        speed: sim.speed,
        symbol: activeSymbol,
        interval,
      });
    } else {
      clearSimState();
    }
  }, [sim.status, sim.historicalAnchorTime, sim.realStartTime, sim.currentSimulatedTime, sim.speed, activeSymbol, interval]);

  // Force-save on page unload
  const simRef = useRef(sim);
  simRef.current = sim;
  const activeSymbolRef = useRef(activeSymbol);
  activeSymbolRef.current = activeSymbol;
  const intervalRef = useRef(interval);
  intervalRef.current = interval;

  useEffect(() => {
    const handler = () => {
      const s = simRef.current;
      if (s.status === 'stopped') return;
      const liveTime = s.currentTimeRef.current;
      saveSimState({
        status: s.status,
        historicalAnchorTime: liveTime,
        realStartTime: Date.now(),
        currentSimulatedTime: liveTime,
        speed: s.speed,
        symbol: activeSymbolRef.current,
        interval: intervalRef.current,
      });
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

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

  useEffect(() => {
    setOrdersMap(prev => {
      let changed = false;
      const next: OrdersMap = {};

      for (const [symbol, orders] of Object.entries(prev)) {
        const normalized = orders.map(order => {
          if (order.type !== 'CONDITIONAL') {
            return order;
          }

          const nextTriggerPrice = resolveConditionalTriggerPrice(order);
          const shouldNormalizeStatus = order.status !== 'PENDING';
          const shouldNormalizeStopPrice = Number.isFinite(nextTriggerPrice)
            && nextTriggerPrice > 0
            && order.stopPrice !== nextTriggerPrice;

          if (!shouldNormalizeStatus && !shouldNormalizeStopPrice) {
            return order;
          }

          changed = true;

          return {
            ...order,
            status: 'PENDING' as const,
            stopPrice: shouldNormalizeStopPrice ? nextTriggerPrice : order.stopPrice,
          };
        });

        if (normalized.length > 0) next[symbol] = normalized;
      }

      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== FUNDING RATE ENGINE =====
  const lastFundingSlotRef = useRef<number>(-1);

  useEffect(() => {
    if (!sim.isRunning) return;
    const now = sim.currentSimulatedTime;
    const d = new Date(now);
    const utcHour = d.getUTCHours();

    let currentSlot = -1;
    for (let i = FUNDING_HOURS.length - 1; i >= 0; i--) {
      if (utcHour >= FUNDING_HOURS[i]) { currentSlot = i; break; }
    }
    if (currentSlot < 0) currentSlot = FUNDING_HOURS.length - 1;

    const dayOfYear = Math.floor(now / 86400000);
    const slotId = dayOfYear * 3 + currentSlot;

    const fundingMinute = d.getUTCMinutes();
    const isInWindow = FUNDING_HOURS.includes(utcHour) && fundingMinute < 2;

    if (!isInWindow || slotId === lastFundingSlotRef.current) return;
    lastFundingSlotRef.current = slotId;

    let totalFunding = 0;
    let posCount = 0;
    const fundingRecords: TradeRecord[] = [];

    for (const [sym, positions] of Object.entries(positionsMap)) {
      const price = priceMap[sym] || 0;
      if (price <= 0 || positions.length === 0) continue;

      for (const pos of positions) {
        const notional = pos.quantity * price;
        const fee = notional * FUNDING_RATE;
        const amount = pos.side === 'LONG' ? -fee : fee;
        totalFunding += amount;
        posCount++;

        fundingRecords.push({
          id: crypto.randomUUID(), symbol: sym, side: pos.side,
          type: 'FUNDING' as any, action: 'FUNDING',
          entryPrice: price, exitPrice: 0,
          quantity: pos.quantity, leverage: pos.leverage,
          pnl: amount, fee: Math.abs(fee), slippage: 0,
          openTime: now, closeTime: now,
        });
      }
    }

    if (posCount > 0 && totalFunding !== 0) {
      // Single global balance debit/credit
      setBalance(prev => prev + totalFunding);
      setTradeHistory(prev => [...prev, ...fundingRecords]);
      const sign = totalFunding >= 0 ? '+' : '';
      toast.info(`💰 资金费率结算: ${sign}${totalFunding.toFixed(4)} USDT`, {
        description: `费率 ${(FUNDING_RATE * 100).toFixed(4)}% · ${posCount} 笔仓位`,
      });
    }
  }, [sim.currentSimulatedTime, sim.isRunning, positionsMap, priceMap]);

  // ===== LIQUIDATION ENGINE (Cross + Isolated) =====
  const liquidationCheckRef = useRef(false);
  useEffect(() => {
    if (!sim.isRunning || liquidationCheckRef.current) return;

    // --- ISOLATED margin-mode liquidation: check each isolated position independently ---
    for (const [sym, positions] of Object.entries(positionsMap)) {
      const price = priceMap[sym] || 0;
      if (price <= 0) continue;

      for (let i = positions.length - 1; i >= 0; i--) {
        const pos = positions[i];
        if (pos.marginMode !== 'isolated' || pos.isolatedMargin == null) continue;

        const pnl = calcUnrealizedPnl(pos, price);
        const posEquity = pos.isolatedMargin + pnl;
        const maintMargin = pos.quantity * price * MAINTENANCE_MARGIN_RATE;

        if (posEquity > maintMargin) continue;

        const closeFee = calcFee(price, pos.quantity, false);
        const liqFee = pos.quantity * price * LIQUIDATION_FEE_RATE;

        setTradeHistory(prev => [...prev, {
          id: crypto.randomUUID(), symbol: sym, side: pos.side,
          type: 'MARKET' as OrderType, action: 'LIQUIDATION' as const,
          entryPrice: pos.entryPrice, exitPrice: price,
          quantity: pos.quantity, leverage: pos.leverage,
          pnl: pnl - closeFee - liqFee, fee: closeFee + liqFee, slippage: 0,
          openTime: 0, closeTime: getEffectiveTime(sym),
        }]);

        setPositionsMap(prev => ({
          ...prev,
          [sym]: (prev[sym] || []).filter((_, idx) => idx !== i),
        }));

        // Isolated margin is lost — no change to global balance (it was already deducted at open)
        toast.error(`🚨 逐仓爆仓: ${sym} ${pos.side === 'LONG' ? '多' : '空'} ${pos.quantity}`, {
          description: `保证金 ${pos.isolatedMargin.toFixed(2)} USDT 已清零`,
          duration: 8000,
        });
      }
    }

    // --- CROSS liquidation: aggregate all cross positions globally ---
    // MMR = ∑(notional * MAINTENANCE_MARGIN_RATE) where notional = qty * currentPrice
    let crossUnrealizedPnl = 0;
    let crossMaintenanceMargin = 0;
    let crossPositionCount = 0;
    for (const [sym, positions] of Object.entries(positionsMap)) {
      const price = priceMap[sym] || 0;
      if (price <= 0) continue;
      for (const pos of positions) {
        if (pos.marginMode !== 'cross') continue;
        crossUnrealizedPnl += calcUnrealizedPnl(pos, price);
        crossMaintenanceMargin += pos.quantity * price * MAINTENANCE_MARGIN_RATE;
        crossPositionCount++;
      }
    }

    if (crossPositionCount > 0) {
      const crossEquity = balance + crossUnrealizedPnl;
      const crossMaintenance = crossMaintenanceMargin;

      if (crossEquity <= crossMaintenance || crossEquity <= 0) {
        liquidationCheckRef.current = true;

        let totalLoss = 0;
        const liqRecords: TradeRecord[] = [];

        for (const [sym, positions] of Object.entries(positionsMap)) {
          const price = priceMap[sym] || 0;
          if (price <= 0) continue;

          for (const pos of positions) {
            if (pos.marginMode !== 'cross') continue;
            const pnl = calcUnrealizedPnl(pos, price);
            const closeFee = calcFee(price, pos.quantity, false);
            const liqFee = pos.quantity * price * LIQUIDATION_FEE_RATE;
            totalLoss += Math.abs(Math.min(0, pnl - closeFee - liqFee)) + liqFee;

            liqRecords.push({
              id: crypto.randomUUID(), symbol: sym, side: pos.side,
              type: 'MARKET' as OrderType, action: 'LIQUIDATION' as const,
              entryPrice: pos.entryPrice, exitPrice: price,
              quantity: pos.quantity, leverage: pos.leverage,
              pnl: pnl - closeFee - liqFee, fee: closeFee + liqFee, slippage: 0,
              openTime: 0, closeTime: getEffectiveTime(sym),
            });
          }
        }

        setPositionsMap(prev => {
          const next: PositionsMap = {};
          for (const [sym, positions] of Object.entries(prev)) {
            const isolated = positions.filter(p => p.marginMode === 'isolated');
            if (isolated.length > 0) next[sym] = isolated;
          }
          return next;
        });
        setOrdersMap({});
        setBalance(Math.max(0, crossEquity * 0.05));
        setTradeHistory(prev => [...prev, ...liqRecords]);

        setLiquidationDetails({ lostAmount: totalLoss, liquidatedPositions: crossPositionCount });
        setLiquidationOpen(true);
        toast.error('🚨 全仓爆仓！所有全仓仓位已被强制平仓', { duration: 10000 });

        setTimeout(() => { liquidationCheckRef.current = false; }, 2000);
      }
    }
  }, [priceMap, positionsMap, balance, sim.isRunning, sim.currentSimulatedTime]);

  // ===== Place Order (with strict accounting enforcement — single global pool) =====
  const handlePlaceOrder = useCallback((symbol: string, order: PlaceOrderParams) => {
    const available = calcAvailable(balance, positionsMap);
    const symbolPrice = priceMap[symbol] || 0;
    const effectiveCurrentPrice = Number(order.latestPrice ?? symbolPrice);

    if (!Number.isFinite(effectiveCurrentPrice) || effectiveCurrentPrice <= 0) {
      toast.error('无法获取当前价格'); return;
    }

    const now = getEffectiveTime(symbol);

    if (order.type === 'CONDITIONAL') {
      const currentP = Number(effectiveCurrentPrice);
      const triggerP = Number(order.stopPrice);

      if (!Number.isFinite(triggerP) || triggerP <= 0) {
        toast.error('触发价无效');
        return;
      }

      if (shouldRejectImmediateConditionalPlacement(order.side, currentP, triggerP)) {
        toast.error('触发价设置不合理，订单将立即成交，请修改或使用市价单');
        return;
      }
    }

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
      const requiredMargin = margin + fee;
      if (requiredMargin > available) {
        toast.error('可用余额不足', {
          description: `需要 ${requiredMargin.toFixed(2)} USDT，当前可用 ${available.toFixed(2)} USDT`,
        });
        return;
      }
      setBalance(prev => prev - requiredMargin);
      setPositionsMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), position] }));
      recordOpen(position.entryPrice, order.quantity, order.side, fee, slippage);
      toast.success(`最优价成交: ${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity.toFixed(6)} @ ${position.entryPrice.toFixed(2)}`);
      return;
    }

    // MARKET (taker with slippage)
    if (order.type === 'MARKET') {
      const { fee, margin, slippage, position } = executeFill(effectiveCurrentPrice, order, false);
      const requiredMargin = margin + fee;
      if (requiredMargin > available) {
        toast.error('可用余额不足', {
          description: `需要 ${requiredMargin.toFixed(2)} USDT，当前可用 ${available.toFixed(2)} USDT`,
        });
        return;
      }
      setBalance(prev => prev - requiredMargin);
      setPositionsMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), position] }));
      recordOpen(position.entryPrice, order.quantity, order.side, fee, slippage);
      toast.success(`${order.side === 'LONG' ? '开多' : '开空'} ${order.quantity.toFixed(6)} @ ${position.entryPrice.toFixed(2)}`);
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

    // All other pending types — strict margin pre-check
    const estPrice = order.price > 0 ? order.price : effectiveCurrentPrice;
    const estMargin = (order.quantity * estPrice) / order.leverage + calcFee(estPrice, order.quantity, true);
    if (estMargin > available) {
      toast.error('可用余额不足', {
        description: `需要 ${estMargin.toFixed(2)} USDT，当前可用 ${available.toFixed(2)} USDT`,
      });
      return;
    }

    // Determine trigger direction / operator at placement from the then-current price snapshot
    let triggerDirection: 'UP' | 'DOWN' | undefined;
    let operator: PendingOrder['operator'];
    if (order.type === 'CONDITIONAL' && order.stopPrice > 0) {
      operator = getTriggerOperator(order.stopPrice, effectiveCurrentPrice);
      triggerDirection = operator === '>=' ? 'UP' : 'DOWN';
    } else if (['MARKET_TP_SL', 'LIMIT_TP_SL'].includes(order.type) && order.stopPrice > 0) {
      if (order.stopPrice > effectiveCurrentPrice) {
        triggerDirection = 'UP';
      } else if (order.stopPrice < effectiveCurrentPrice) {
        triggerDirection = 'DOWN';
      } else {
        // triggerPrice === currentPrice: default to safe side based on order side
        triggerDirection = order.side === 'LONG' ? 'UP' : 'DOWN';
      }
    }

    const newOrder: PendingOrder = {
      id: crypto.randomUUID(), side: order.side, type: order.type,
      price: order.price, stopPrice: order.stopPrice, quantity: order.quantity,
      leverage: order.leverage, marginMode: order.marginMode,
      status: order.type === 'CONDITIONAL' ? 'PENDING' : 'NEW', createdAt: now,
      callbackRate: order.callbackRate, trailingExecType: order.trailingExecType,
      trailingLimitPrice: order.trailingLimitPrice, trailingActivated: false,
      conditionalExecType: order.conditionalExecType, conditionalLimitPrice: order.conditionalLimitPrice,
      triggerDirection, operator,
    };
    setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), newOrder] }));
    toast.info('委托已挂出');
  }, [balance, positionsMap, priceMap, getEffectiveTime]);

  // ===== Close Position — single global balance =====
  const handleClosePosition = useCallback((symbol: string, index: number) => {
    const symbolPositions = positionsMap[symbol] || [];
    const pos = symbolPositions[index];
    if (!pos) return;
    const rawPrice = priceMap[symbol] || 0;
    const closeSide: OrderSide = pos.side === 'LONG' ? 'SHORT' : 'LONG';
    const { fillPrice, slippage } = applySlippageIfTaker(rawPrice, pos.quantity, closeSide, false);
    const pnl = pos.side === 'LONG'
      ? (fillPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - fillPrice) * pos.quantity;
    const fee = calcFee(fillPrice, pos.quantity, false);

    const returnedMargin = pos.marginMode === 'isolated' && pos.isolatedMargin != null
      ? pos.isolatedMargin + pnl - fee
      : pos.margin + pnl - fee;

    // Credit to single global balance
    setBalance(prev => prev + Math.max(0, returnedMargin));
    setPositionsMap(prev => ({
      ...prev,
      [symbol]: (prev[symbol] || []).filter((_, i) => i !== index),
    }));
    setTradeHistory(prev => [...prev, {
      id: crypto.randomUUID(), symbol, side: pos.side, type: 'MARKET' as OrderType,
      action: 'CLOSE' as const, entryPrice: pos.entryPrice, exitPrice: fillPrice,
      quantity: pos.quantity, leverage: pos.leverage,
      pnl: pnl - fee, fee, slippage, openTime: 0, closeTime: getEffectiveTime(symbol),
    }]);
    toast(pnl >= 0 ? '盈利平仓 ✅' : '亏损平仓 ❌', {
      description: `${symbol} ${pnl >= 0 ? '+' : ''}${(pnl - fee).toFixed(2)} USDT`,
    });
  }, [positionsMap, priceMap, getEffectiveTime]);

  // ===== Cancel Order =====
  const handleCancelOrder = useCallback((symbol: string, orderId: string) => {
    setOrdersMap(prev => ({
      ...prev,
      [symbol]: (prev[symbol] || []).filter(o => o.id !== orderId),
    }));
    toast.info('委托已撤销');
  }, []);

  // ===== Add Isolated Margin (top-up) =====
  const handleAddIsolatedMargin = useCallback((symbol: string, posIndex: number, amount: number) => {
    if (amount <= 0) return;
    const avail = calcAvailable(balance, positionsMap);
    const actual = Math.min(amount, avail);
    if (actual <= 0) { toast.error('可用余额不足'); return; }

    setBalance(prev => prev - actual);
    setPositionsMap(prev => {
      const positions = [...(prev[symbol] || [])];
      const pos = positions[posIndex];
      if (!pos || pos.marginMode !== 'isolated') return prev;
      positions[posIndex] = {
        ...pos,
        isolatedMargin: (pos.isolatedMargin || pos.margin) + actual,
      };
      return { ...prev, [symbol]: positions };
    });
    toast.success(`已追加 ${actual.toFixed(2)} USDT 保证金`);
  }, [balance, positionsMap]);

  // ===== Clear Symbol Data & Financial Reversal =====
  const handleClearSymbolData = useCallback((symbol: string) => {
    // Step A: Force-close positions (return margin without PnL accounting)
    const symbolPositions = positionsMap[symbol] || [];
    let returnedMargin = 0;
    for (const pos of symbolPositions) {
      const m = pos.marginMode === 'isolated' && pos.isolatedMargin != null
        ? pos.isolatedMargin : pos.margin;
      returnedMargin += m;
    }

    // Step B: Calculate total realized PnL and fees from history for this symbol
    const symbolHistory = tradeHistory.filter(t => t.symbol === symbol);
    let totalRealizedPnl = 0;
    let totalFees = 0;
    for (const t of symbolHistory) {
      // Use precise arithmetic: multiply by 1e8, round, divide
      totalRealizedPnl = Math.round((totalRealizedPnl + t.pnl) * 1e8) / 1e8;
      totalFees = Math.round((totalFees + t.fee) * 1e8) / 1e8;
    }

    // Reversal formula: newBalance = currentBalance + returnedMargin - totalPnL + totalFees
    // returnedMargin: give back the margin locked in current positions
    // -totalPnL: reverse all profits/losses (earned 100 → subtract 100; lost 50 → add 50)
    // +totalFees: refund all fees ever paid
    const adjustment = Math.round((returnedMargin - totalRealizedPnl + totalFees) * 1e8) / 1e8;

    // Step A: Remove positions
    setPositionsMap(prev => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });

    // Step A: Remove orders
    setOrdersMap(prev => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });

    // Step C: Remove all history records for this symbol
    setTradeHistory(prev => prev.filter(t => t.symbol !== symbol));

    // Step B: Adjust balance
    setBalance(prev => Math.round((prev + adjustment) * 1e8) / 1e8);

    toast.success(`已彻底清除 ${symbol.replace('USDT', '/USDT')} 的所有数据，资产已复原。`);
  }, [positionsMap, tradeHistory]);

  const value: TradingState = {
    sim,
    activeSymbol, setActiveSymbol,
    interval, setInterval,
    positionsMap, setPositionsMap,
    ordersMap, setOrdersMap,
    priceMap, setPriceMap,
    balance, setBalance,
    isolatedBalances: emptyIsolatedBalances,
    setIsolatedBalances: setIsolatedBalancesNoop,
    tradeHistory, setTradeHistory,
    activeSymbolPositions, activeSymbolOrders,
    allPositions, allOrders,
    currentPrice, pricePrecision, quantityPrecision, setPricePrecision, setQuantityPrecision,
    activeSymbols,
    handlePlaceOrder, handleClosePosition, handleCancelOrder,
    handleAddIsolatedMargin, handleClearSymbolData,
    fundingRate: FUNDING_RATE,
    liquidationOpen, liquidationDetails, closeLiquidationModal,
    timeMode, setTimeMode,
    coinTimelines, setCoinTimelines,
    totalPositionCount,
    getEffectiveTime,
    getCoinState,
    getEffectiveBalance,
    getEffectiveAvailable,
  };

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}
