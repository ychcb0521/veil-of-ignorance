/**
 * Global Trading Context
 * 
 * Manages:
 * - Global simulated clock (single source of truth)
 * - Multi-symbol positions & pending orders
 * - Wallet balance & trade history (with isolated account sandboxes)
 * - Liquidation engine (cross + isolated), fees, slippage
 * - Funding rate engine (8h settlement)
 * 
 * ACCOUNTING IDENTITY (enforced at all times):
 *   Total Equity = Available Balance + Used Margin + Unrealized PnL
 */

import React, { createContext, useContext, useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { useTimeSimulator } from '@/hooks/useTimeSimulator';
import { usePersistedState, loadPersistedSimState, saveSimState, clearSimState } from '@/hooks/usePersistedState';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Position, PendingOrder, TradeRecord, OrderSide, OrderType, MarginMode } from '@/types/trading';
import {
  calcFee, calcUnrealizedPnl, calcSlippage,
  MAINTENANCE_MARGIN_RATE, LIQUIDATION_FEE_RATE, FUNDING_RATE, FUNDING_HOURS,
} from '@/types/trading';

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
/** Isolated sandbox balances — one per symbol, only used in 'isolated' time mode */
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
  /** Isolated sandbox balances per symbol (only meaningful in isolated mode) */
  isolatedBalances: IsolatedBalancesMap;
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
  /** Get the effective balance for a symbol (respects isolated/synced mode) */
  getEffectiveBalance: (symbol: string) => number;
  /** Get the effective available balance for a symbol */
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
}

const TradingContext = createContext<TradingState | null>(null);

export function useTradingContext() {
  const ctx = useContext(TradingContext);
  if (!ctx) throw new Error('useTradingContext must be used within TradingProvider');
  return ctx;
}

// ===== Helpers =====

/**
 * Calculate available balance for a specific symbol, respecting time mode.
 * In synced mode: global balance minus all cross margins.
 * In isolated mode: symbol's sandbox balance minus that symbol's cross margins only.
 */
function calcAvailableForSymbol(
  timeMode: TimeMode,
  symbol: string,
  globalBalance: number,
  isolatedBalances: IsolatedBalancesMap,
  positionsMap: PositionsMap,
): number {
  if (timeMode === 'synced') {
    // Synced: all symbols share the global balance
    let totalCrossMargin = 0;
    for (const positions of Object.values(positionsMap)) {
      for (const p of positions) {
        if (p.marginMode === 'cross') totalCrossMargin += p.margin;
      }
    }
    return globalBalance - totalCrossMargin;
  } else {
    // Isolated time mode: each symbol has its own sandbox balance
    const bal = isolatedBalances[symbol] ?? 0;
    let symbolCrossMargin = 0;
    for (const p of (positionsMap[symbol] || [])) {
      if (p.marginMode === 'cross') symbolCrossMargin += p.margin;
    }
    return bal - symbolCrossMargin;
  }
}

/** Legacy helper for backward compat — synced mode only */
function getAvailableBalance(balance: number, positionsMap: PositionsMap): number {
  let totalMargin = 0;
  for (const positions of Object.values(positionsMap)) {
    for (const p of positions) {
      if (p.marginMode === 'cross') totalMargin += p.margin;
    }
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

  // === Isolated Sandbox Balances ===
  // Each symbol in isolated mode gets its own independent balance (initialCapital each)
  const [isolatedBalances, setIsolatedBalances] = usePersistedState<IsolatedBalancesMap>('isolated_balances', {});

  // Refs for latest values in callbacks
  const timeModeRef = useRef(timeMode);
  const isolatedBalancesRef = useRef(isolatedBalances);
  useEffect(() => { timeModeRef.current = timeMode; }, [timeMode]);
  useEffect(() => { isolatedBalancesRef.current = isolatedBalances; }, [isolatedBalances]);

  // Total position count across all symbols (for the guard)
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

  // Get effective balance for a symbol (mode-aware)
  const getEffectiveBalance = useCallback((symbol: string): number => {
    if (timeModeRef.current === 'synced') return balance;
    return isolatedBalancesRef.current[symbol] ?? 0;
  }, [balance]);

  // Get effective available balance for a symbol
  const getEffectiveAvailable = useCallback((symbol: string): number => {
    return calcAvailableForSymbol(
      timeModeRef.current, symbol, balance, isolatedBalancesRef.current, positionsMap,
    );
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

  // ===== BALANCE MUTATION HELPERS (mode-aware) =====
  /**
   * Deduct amount from the correct balance (global or isolated sandbox).
   * Returns false if insufficient funds.
   */
  const deductBalance = useCallback((symbol: string, amount: number): boolean => {
    if (timeModeRef.current === 'synced') {
      setBalance(prev => prev - amount);
      return true;
    } else {
      const current = isolatedBalancesRef.current[symbol] ?? 0;
      if (current < amount) return false;
      setIsolatedBalances(prev => ({ ...prev, [symbol]: (prev[symbol] ?? 0) - amount }));
      return true;
    }
  }, []);

  /** Credit amount to the correct balance */
  const creditBalance = useCallback((symbol: string, amount: number) => {
    if (timeModeRef.current === 'synced') {
      setBalance(prev => prev + amount);
    } else {
      setIsolatedBalances(prev => ({ ...prev, [symbol]: (prev[symbol] ?? 0) + amount }));
    }
  }, []);

  /** Set balance to exact value for a symbol */
  const setSymbolBalance = useCallback((symbol: string, value: number) => {
    if (timeModeRef.current === 'synced') {
      setBalance(value);
    } else {
      setIsolatedBalances(prev => ({ ...prev, [symbol]: value }));
    }
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

      let symbolFunding = 0;
      for (const pos of positions) {
        const notional = pos.quantity * price;
        const fee = notional * FUNDING_RATE;
        const amount = pos.side === 'LONG' ? -fee : fee;
        symbolFunding += amount;
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

      // Credit/debit to the correct account
      if (symbolFunding !== 0) {
        creditBalance(sym, symbolFunding);
      }
    }

    if (posCount > 0) {
      // Note: creditBalance already applied per-symbol above.
      // For synced mode, creditBalance calls setBalance multiple times,
      // but React batches these. We need to avoid double-counting.
      // Actually since creditBalance in synced mode modifies global balance,
      // and we called it per-symbol, we need to NOT call it again.
      // The per-symbol calls already handle synced mode correctly.
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

        toast.error(`🚨 逐仓爆仓: ${sym} ${pos.side === 'LONG' ? '多' : '空'} ${pos.quantity}`, {
          description: `保证金 ${pos.isolatedMargin.toFixed(2)} USDT 已清零`,
          duration: 8000,
        });
      }
    }

    // --- CROSS liquidation ---
    // In isolated time mode, check cross liquidation per-symbol sandbox
    if (timeModeRef.current === 'isolated') {
      for (const [sym, positions] of Object.entries(positionsMap)) {
        const price = priceMap[sym] || 0;
        if (price <= 0) continue;
        
        let crossPnl = 0;
        let crossMargin = 0;
        let crossCount = 0;
        
        for (const pos of positions) {
          if (pos.marginMode !== 'cross') continue;
          crossPnl += calcUnrealizedPnl(pos, price);
          crossMargin += pos.margin;
          crossCount++;
        }
        
        if (crossCount === 0) continue;
        
        const symBalance = isolatedBalancesRef.current[sym] ?? 0;
        const crossEquity = symBalance + crossPnl;
        const crossMaintenance = crossMargin * MAINTENANCE_MARGIN_RATE;
        
        if (crossEquity > crossMaintenance && crossEquity > 0) continue;
        
        // Liquidate this symbol's cross positions
        const liqRecords: TradeRecord[] = [];
        let totalLoss = 0;
        
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
        
        // Remove cross positions for this symbol
        setPositionsMap(prev => ({
          ...prev,
          [sym]: (prev[sym] || []).filter(p => p.marginMode === 'isolated'),
        }));
        // Cancel this symbol's orders
        setOrdersMap(prev => ({ ...prev, [sym]: [] }));
        // Set sandbox balance to near-zero
        setIsolatedBalances(prev => ({ ...prev, [sym]: Math.max(0, crossEquity * 0.05) }));
        setTradeHistory(prev => [...prev, ...liqRecords]);
        
        setLiquidationDetails({ lostAmount: totalLoss, liquidatedPositions: crossCount });
        setLiquidationOpen(true);
        toast.error(`🚨 ${sym} 全仓爆仓！`, { duration: 10000 });
      }
    } else {
      // Synced mode: aggregate all cross positions globally (original logic)
      let crossUnrealizedPnl = 0;
      let crossMargin = 0;
      let crossPositionCount = 0;
      for (const [sym, positions] of Object.entries(positionsMap)) {
        const price = priceMap[sym] || 0;
        if (price <= 0) continue;
        for (const pos of positions) {
          if (pos.marginMode !== 'cross') continue;
          crossUnrealizedPnl += calcUnrealizedPnl(pos, price);
          crossMargin += pos.margin;
          crossPositionCount++;
        }
      }

      if (crossPositionCount > 0) {
        const crossEquity = balance + crossUnrealizedPnl;
        const crossMaintenance = crossMargin * MAINTENANCE_MARGIN_RATE;

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
    }
  }, [priceMap, positionsMap, balance, sim.isRunning, sim.currentSimulatedTime]);

  // ===== Place Order (with strict accounting enforcement) =====
  const handlePlaceOrder = useCallback((symbol: string, order: PlaceOrderParams) => {
    const available = calcAvailableForSymbol(
      timeModeRef.current, symbol,
      balance, isolatedBalancesRef.current, positionsMap,
    );
    const symbolPrice = priceMap[symbol] || 0;
    if (symbolPrice <= 0 && order.type === 'MARKET') {
      toast.error('无法获取当前价格'); return;
    }

    const effectiveCurrentPrice = symbolPrice;
    const now = getEffectiveTime(symbol);

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
      deductBalance(symbol, requiredMargin);
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
      deductBalance(symbol, requiredMargin);
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
  }, [balance, positionsMap, priceMap, getEffectiveTime, deductBalance]);

  // ===== Close Position (mode-aware balance return) =====
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

    // Credit the returned margin to the correct account
    creditBalance(symbol, Math.max(0, returnedMargin));
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
  }, [positionsMap, priceMap, getEffectiveTime, creditBalance]);

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
    const avail = calcAvailableForSymbol(
      timeModeRef.current, symbol,
      balance, isolatedBalancesRef.current, positionsMap,
    );
    const actual = Math.min(amount, avail);
    if (actual <= 0) { toast.error('可用余额不足'); return; }

    deductBalance(symbol, actual);
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
  }, [balance, positionsMap, deductBalance]);

  const value: TradingState = {
    sim,
    activeSymbol, setActiveSymbol,
    interval, setInterval,
    positionsMap, setPositionsMap,
    ordersMap, setOrdersMap,
    priceMap, setPriceMap,
    balance, setBalance,
    isolatedBalances, setIsolatedBalances,
    tradeHistory, setTradeHistory,
    activeSymbolPositions, activeSymbolOrders,
    allPositions, allOrders,
    currentPrice, pricePrecision, quantityPrecision, setPricePrecision, setQuantityPrecision,
    activeSymbols,
    handlePlaceOrder, handleClosePosition, handleCancelOrder,
    handleAddIsolatedMargin,
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
