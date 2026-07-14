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
import type {
  Position,
  PendingOrder,
  TradeRecord,
  OrderSide,
  OrderType,
  MarginMode,
  SettlementMode,
  TriggerOperator,
  CancelledOrderSnapshot,
  FilledOrderSnapshot,
} from '@/types/trading';
import {
  calcUnrealizedPnl,
  MAINTENANCE_MARGIN_RATE, LIQUIDATION_FEE_RATE, FUNDING_RATE, FUNDING_HOURS, getTriggerOperator,
} from '@/types/trading';
import { resolveConditionalTriggerPrice, shouldRejectImmediateConditionalPlacement } from '@/lib/conditionalOrders';
import {
  POSITION_DUST_EPSILON,
  closeSettlementPosition,
  executeSettlementFill,
  formatSettlementQuantity,
  getPositionNotionalUsd,
  getPositionUnits,
  getSettlementFeeParts,
  getSettlementMarginParts,
  isCoinSettled,
  isPositionOpen,
  normalizeSettlementOrder,
  scaleSettlementPosition,
} from '@/lib/tradingSettlement';
import { getPriceDecimals } from '@/lib/formatters';
import {
  createDefaultExecutionAssetState,
  recordExecutionTrade as applyExecutionTradeReward,
  recordCampaignCreated as applyCampaignReward,
  recordPostTradeReviewCompleted as applyPostTradeReviewReward,
  reconcileCampaignRewards as applyCampaignReconcile,
  reconcilePostTradeReviewRewards as applyReviewReconcile,
  recordPracticeLogged as applyPracticeLogged,
  migrateExecutionAssetScoringV2 as applyScoringMigration,
  settleNoTradePenalties,
  settleCampaignMissingPenalties as applySettleCampaignMissing,
  type CampaignCreationRef,
  type CampaignRewardRef,
  type CompletedExecutionReview,
  type ExecutionAssetState,
  type ExecutionTradeSnapshot,
} from '@/lib/executionAssets';

// ===== Types =====
export type TimeMode = 'synced' | 'isolated';
export type TradingMode = 'decision' | 'direct';

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
  filledOrders: FilledOrderSnapshot[];
  setFilledOrders: (v: FilledOrderSnapshot[] | ((prev: FilledOrderSnapshot[]) => FilledOrderSnapshot[])) => void;
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
  leverageMap: Record<string, number>;
  marginModeMap: Record<string, MarginMode>;
  settlementModeMap: Record<string, SettlementMode>;
  getSymbolLeverage: (symbol: string) => number;
  setSymbolLeverage: (symbol: string, value: number | ((prev: number) => number)) => void;
  getSymbolMarginMode: (symbol: string) => MarginMode;
  setSymbolMarginMode: (symbol: string, mode: MarginMode) => void;
  getSymbolSettlementMode: (symbol: string) => SettlementMode;
  setSymbolSettlementMode: (symbol: string, mode: SettlementMode) => void;
  activeSymbols: string[];
  handlePlaceOrder: (symbol: string, order: PlaceOrderParams) => { id: string } | null;
  handleClosePosition: (symbol: string, index: number, percentage?: number, method?: 'manual' | 'sl' | 'tp1' | 'tp2' | 'tp3' | 'liquidation') => void;
  handleCancelOrder: (symbol: string, orderId: string) => void;
  handlePlaceTpSl: (symbol: string, pos: Position, tp: number | null, sl: number | null, pct: number) => void;
  handleAddIsolatedMargin: (symbol: string, posIndex: number, amount: number) => void;
  handleAdjustMargin: (symbol: string, posIndex: number, signedDelta: number) => void;
  handleClearSymbolData: (symbol: string) => void;
  fundingRate: number;
  liquidationOpen: boolean;
  liquidationDetails: LiquidationDetails | undefined;
  closeLiquidationModal: () => void;
  // Multi-Timeline
  timeMode: TimeMode;
  setTimeMode: (v: TimeMode) => void;
  /**
   * Trading mode:
   *   'direct'   — DEFAULT. skip snapshot + skip review; trade still hits trade_history
   *                and can be retroactively classified into a campaign via 裸 record 回填,
   *                but is excluded from 错题集 and 元监控 (because no journal is created)
   *   'decision' — full snapshot + post-trade review flow (opt-in for training sessions)
   */
  tradingMode: TradingMode;
  setTradingMode: (v: TradingMode) => void;
  executionAsset: ExecutionAssetState;
  setExecutionAsset: (v: ExecutionAssetState | ((prev: ExecutionAssetState) => ExecutionAssetState)) => void;
  recordExecutionTrade: (modeOverride?: TradingMode, trade?: ExecutionTradeSnapshot | null) => void;
  /** 每创建一次交易战役调用一次，执行力资产 +300 分；传 campaignId 按战役幂等。 */
  recordCampaignCreated: (campaignId?: string | null) => void;
  /** 用真实战役 ID 与创建时间对账，补齐漏记奖励并绑定旧流水（幂等，自愈）。 */
  reconcileCampaignRewards: (campaigns: CampaignRewardRef[]) => void;
  /** 每完成一次平仓评价 +1000；同一个 journal 后续编辑不重复计分。完成评价即算当天已练习。 */
  recordPostTradeReviewCompleted: (journalId: string, reviewedAt?: Date | number | string | null) => void;
  /** 用历史已完成评价对账，补齐漏记的 +1000（按 journal ID 幂等）。 */
  reconcilePostTradeReviewRewards: (reviews: CompletedExecutionReview[]) => void;
  /** 弃单 / 空仓观察记录后调用，标记当天已练习，清「未交易 −1000」（Option A）。 */
  recordObservationLogged: () => void;
  /** 用权威战役列表结算「当天交易过某标的却没为它建战役」的 −300（按标的、永久）。 */
  settleCampaignMissingPenalties: (campaigns: CampaignCreationRef[]) => void;
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
  settlementMode?: SettlementMode;
  settlementAsset?: string;
  contractSizeUsd?: number;
  contracts?: number;
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

// Persist context across Vite HMR to avoid "must be used within Provider" errors
const HMR_KEY = '__TradingContext__';
const TradingContext: React.Context<TradingState | null> =
  (globalThis as any)[HMR_KEY] ??= createContext<TradingState | null>(null);

export function useTradingContext() {
  const ctx = useContext(TradingContext);
  if (!ctx) {
    // During Vite HMR, components may briefly re-mount outside the provider tree.
    // Throw so React error boundary / suspense catches it and re-renders correctly.
    throw new Error('useTradingContext must be used within TradingProvider');
  }
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
  // 撤单快照：撤单本身会把订单从 ordersMap 删掉，这里另存一份（含委托价/委托时间/取消时间），
  // 供战役页展示「反向对冲挂单」。只追加、截断到最近 500 条。
  const [, setCancelledOrders] = usePersistedState<CancelledOrderSnapshot[]>('cancelled_orders', []);
  // 成交快照：委托触发后订单会从 ordersMap 删除，这里保留“委托时间 → 触发时间”的桥。
  const [filledOrders, setFilledOrders] = usePersistedState<FilledOrderSnapshot[]>('filled_orders', []);
  const [priceMap, setPriceMap] = usePersistedState<PriceMap>('price_map', {});
  const [balance, setBalance] = usePersistedState('balance', initialCapital);

  useEffect(() => {
    setPositionsMap(prev => {
      let changed = false;
      const next: PositionsMap = {};

      for (const [symbol, positions] of Object.entries(prev)) {
        const normalized = positions
          .filter(position => {
            const keep = isPositionOpen(position);
            if (!keep) changed = true;
            return keep;
          })
          .map(position => {
            if (position.id) return position;
            changed = true;
            return { ...position, id: crypto.randomUUID() };
          });

        if (normalized.length > 0) next[symbol] = normalized;
      }

      return changed ? next : prev;
    });
  }, [setPositionsMap]);
  const [tradeHistory, setTradeHistory] = usePersistedState<TradeRecord[]>('trade_history', []);
  // 价格精度按当前价位自动推导（低价币更细）。修复两件事：①价格显示更精确；
  // ②图表 Y 轴能贴合行情——klinecharts 的刻度最小步长受精度限制，精度太粗（固定 2 位）
  // 会让 0.12 这种币只能按 0.01 画刻度，把 Y 轴撑成 0.08~0.17 一大片留白、蜡烛挤成一条。
  const activeSymbolPrice = priceMap[activeSymbol] ?? 0;
  const pricePrecision = useMemo(
    () => (activeSymbolPrice > 0 ? getPriceDecimals(activeSymbolPrice) : 2),
    [activeSymbolPrice],
  );
  const setPricePrecision = useCallback((_v: number) => {
    /* 精度已由价位自动推导，保留空实现以兼容旧接口 */
  }, []);
  const [quantityPrecision, setQuantityPrecision] = useState(3);
  const [leverageMap, setLeverageMap] = usePersistedState<Record<string, number>>('symbol_leverage', {});
  const [marginModeMap, setMarginModeMap] = usePersistedState<Record<string, MarginMode>>('symbol_margin_mode', {});
  const [settlementModeMap, setSettlementModeMap] = usePersistedState<Record<string, SettlementMode>>('symbol_settlement_mode', {});

  // === Multi-Timeline Mode ===
  const [timeMode, setTimeMode] = usePersistedState<TimeMode>('time_mode', 'synced');
  const [tradingMode, setTradingMode] = usePersistedState<TradingMode>('trading_mode', 'direct');
  const [executionAsset, setExecutionAsset] = usePersistedState<ExecutionAssetState>(
    'execution_asset_v1',
    createDefaultExecutionAssetState(),
  );
  const [coinTimelines, setCoinTimelines] = usePersistedState<CoinTimelinesMap>('coin_timelines_v2', {});

  // Stub for backward compat — isolated balances no longer used
  const emptyIsolatedBalances: IsolatedBalancesMap = {};
  const setIsolatedBalancesNoop = useCallback((_v: IsolatedBalancesMap | ((prev: IsolatedBalancesMap) => IsolatedBalancesMap)) => {}, []);

  // Refs for latest values in callbacks
  const timeModeRef = useRef(timeMode);
  useEffect(() => { timeModeRef.current = timeMode; }, [timeMode]);

  const tradingModeRef = useRef(tradingMode);
  useEffect(() => { tradingModeRef.current = tradingMode; }, [tradingMode]);

  const priceMapRef = useRef(priceMap);
  useEffect(() => { priceMapRef.current = priceMap; }, [priceMap]);

  const balanceRef = useRef(balance);
  useEffect(() => { balanceRef.current = balance; }, [balance]);

  const positionsMapRef = useRef(positionsMap);
  useEffect(() => { positionsMapRef.current = positionsMap; }, [positionsMap]);

  useEffect(() => {
    // 先按当前权重把历史事件重算一次(幂等)，再结算未练习欠账。
    setExecutionAsset(prev => settleNoTradePenalties(applyScoringMigration(prev)));
  }, [setExecutionAsset]);

  const recordExecutionTrade = useCallback((modeOverride?: TradingMode, trade?: ExecutionTradeSnapshot | null) => {
    const mode = modeOverride ?? tradingModeRef.current;
    setExecutionAsset(prev => applyExecutionTradeReward(prev, mode, new Date(), trade));
  }, [setExecutionAsset]);

  // 每建一次交易战役 +1500 分（执行力资产新增类目）；按 campaignId 幂等。
  const recordCampaignCreated = useCallback((campaignId?: string | null) => {
    setExecutionAsset(prev => applyCampaignReward(prev, campaignId ?? null, new Date()));
  }, [setExecutionAsset]);

  // 用真实战役 ID + 创建时间对账：补齐漏记奖励，并让旧流水永久绑定到对应战役。
  const reconcileCampaignRewards = useCallback((campaigns: CampaignRewardRef[]) => {
    setExecutionAsset(prev => applyCampaignReconcile(prev, campaigns, new Date()));
  }, [setExecutionAsset]);

  const recordPostTradeReviewCompleted = useCallback((
    journalId: string,
    reviewedAt?: Date | number | string | null,
  ) => {
    setExecutionAsset(prev => applyPostTradeReviewReward(prev, journalId, reviewedAt ?? new Date()));
  }, [setExecutionAsset]);

  const reconcilePostTradeReviewRewards = useCallback((reviews: CompletedExecutionReview[]) => {
    setExecutionAsset(prev => applyReviewReconcile(prev, reviews, new Date()));
  }, [setExecutionAsset]);

  // 弃单 / 空仓观察 = 当天有练习：标记当天已练习，清「未交易 −1000」（Option A）。
  const recordObservationLogged = useCallback(() => {
    setExecutionAsset(prev => applyPracticeLogged(prev, new Date()));
  }, [setExecutionAsset]);

  // 用权威战役列表结算「交易过却当天没建战役」的 −300（按标的、永久、幂等）。
  const settleCampaignMissingPenalties = useCallback((campaigns: CampaignCreationRef[]) => {
    setExecutionAsset(prev => applySettleCampaignMissing(prev, campaigns, new Date()));
  }, [setExecutionAsset]);

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

  const getSymbolLeverage = useCallback((symbol: string) => {
    return leverageMap[symbol] ?? 35;
  }, [leverageMap]);

  const setSymbolLeverage = useCallback((symbol: string, value: number | ((prev: number) => number)) => {
    setLeverageMap(prev => {
      const current = prev[symbol] ?? 35;
      const nextValue = typeof value === 'function' ? value(current) : value;
      return {
        ...prev,
        [symbol]: Math.floor(Math.max(1, Math.min(125, nextValue))),
      };
    });
  }, [setLeverageMap]);

  const getSymbolMarginMode = useCallback((symbol: string): MarginMode => {
    return marginModeMap[symbol] ?? 'cross';
  }, [marginModeMap]);

  const setSymbolMarginMode = useCallback((symbol: string, mode: MarginMode) => {
    setMarginModeMap(prev => ({ ...prev, [symbol]: mode }));
  }, [setMarginModeMap]);

  const getSymbolSettlementMode = useCallback((symbol: string): SettlementMode => {
    return settlementModeMap[symbol] ?? 'usdt';
  }, [settlementModeMap]);

  const setSymbolSettlementMode = useCallback((symbol: string, mode: SettlementMode) => {
    setSettlementModeMap(prev => ({ ...prev, [symbol]: mode }));
  }, [setSettlementModeMap]);

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
        const notional = getPositionNotionalUsd(sym, pos, price);
        const fee = notional * FUNDING_RATE;
        const amount = pos.side === 'LONG' ? -fee : fee;
        const feeCoin = isCoinSettled(pos) && price > 0 ? Math.abs(fee) / price : undefined;
        totalFunding += amount;
        posCount++;

        fundingRecords.push({
          id: crypto.randomUUID(), symbol: sym, side: pos.side,
          type: 'FUNDING' as any, action: 'FUNDING',
          entryPrice: price, exitPrice: 0,
          quantity: getPositionUnits(pos), contracts: isCoinSettled(pos) ? getPositionUnits(pos) : undefined,
          leverage: pos.leverage,
          pnl: amount, fee: Math.abs(fee), slippage: 0,
          feeCoin, notionalUsd: notional,
          settlementMode: pos.settlementMode, settlementAsset: pos.settlementAsset,
          contractSizeUsd: pos.contractSizeUsd,
          openTime: now, closeTime: now,
          closedRealAt: Date.now(),
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
        const notional = getPositionNotionalUsd(sym, pos, price);
        const maintMargin = notional * MAINTENANCE_MARGIN_RATE;

        if (posEquity > maintMargin) continue;

        const { feeUsd: closeFee, feeCoin } = getSettlementFeeParts(sym, pos, price, false);
        const liqFee = notional * LIQUIDATION_FEE_RATE;

        setTradeHistory(prev => [...prev, {
          id: crypto.randomUUID(), symbol: sym, side: pos.side,
          positionId: pos.id,
          type: 'MARKET' as OrderType, action: 'LIQUIDATION' as const,
          entryPrice: pos.entryPrice, exitPrice: price,
          quantity: getPositionUnits(pos), contracts: isCoinSettled(pos) ? getPositionUnits(pos) : undefined,
          leverage: pos.leverage,
          pnl: pnl - closeFee - liqFee, fee: closeFee + liqFee, slippage: 0,
          feeCoin, notionalUsd: notional,
          settlementMode: pos.settlementMode, settlementAsset: pos.settlementAsset,
          contractSizeUsd: pos.contractSizeUsd,
          openTime: pos.openTime || 0, closeTime: getEffectiveTime(sym),
          exit_method: 'liquidation',
          closedRealAt: Date.now(),
        }]);

        setPositionsMap(prev => ({
          ...prev,
          [sym]: (prev[sym] || []).filter((_, idx) => idx !== i),
        }));

        // Isolated margin is lost — no change to global balance (it was already deducted at open)
        toast.error(`🚨 逐仓爆仓: ${sym} ${pos.side === 'LONG' ? '多' : '空'} ${formatSettlementQuantity(pos, sym)}`, {
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
        crossMaintenanceMargin += getPositionNotionalUsd(sym, pos, price) * MAINTENANCE_MARGIN_RATE;
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
            const notional = getPositionNotionalUsd(sym, pos, price);
            const { feeUsd: closeFee, feeCoin } = getSettlementFeeParts(sym, pos, price, false);
            const liqFee = notional * LIQUIDATION_FEE_RATE;
            totalLoss += Math.abs(Math.min(0, pnl - closeFee - liqFee)) + liqFee;

            liqRecords.push({
              id: crypto.randomUUID(), symbol: sym, side: pos.side,
              positionId: pos.id,
              type: 'MARKET' as OrderType, action: 'LIQUIDATION' as const,
              entryPrice: pos.entryPrice, exitPrice: price,
              quantity: getPositionUnits(pos), contracts: isCoinSettled(pos) ? getPositionUnits(pos) : undefined,
              leverage: pos.leverage,
              pnl: pnl - closeFee - liqFee, fee: closeFee + liqFee, slippage: 0,
              feeCoin, notionalUsd: notional,
              settlementMode: pos.settlementMode, settlementAsset: pos.settlementAsset,
              contractSizeUsd: pos.contractSizeUsd,
              openTime: pos.openTime || 0, closeTime: getEffectiveTime(sym),
              exit_method: 'liquidation',
              closedRealAt: Date.now(),
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
  const handlePlaceOrder = useCallback((symbol: string, order: PlaceOrderParams): { id: string } | null => {
    // Use refs to bypass stale closures in high-frequency time machine ticks
    const available = calcAvailable(balanceRef.current, positionsMapRef.current);
    // Use ref to avoid stale closure — always get the freshest price
    const symbolPrice = priceMapRef.current[symbol] || 0;
    const effectiveCurrentPrice = Number(order.latestPrice || symbolPrice);

    console.log('[下单执行]', {
      按钮按下时获取的盘面价: order.latestPrice,
      priceMap最新价: priceMapRef.current[symbol],
      最终使用价: effectiveCurrentPrice,
    });

    if (!Number.isFinite(effectiveCurrentPrice) || effectiveCurrentPrice <= 0) {
      toast.error('无法获取当前价格'); return null;
    }

    const normalizedOrder = normalizeSettlementOrder(symbol, {
      ...order,
      settlementMode: order.settlementMode ?? getSymbolSettlementMode(symbol),
    });

    const now = getEffectiveTime(symbol);
    const buildExecutionTradeSnapshot = (
      position: Position,
      orderType: string,
    ): ExecutionTradeSnapshot => {
      const notional = getPositionNotionalUsd(symbol, position, position.entryPrice);
      return {
        symbol,
        side: position.side,
        orderType,
        entryPrice: position.entryPrice,
        quantity: getPositionUnits(position),
        leverage: position.leverage,
        marginMode: position.marginMode,
        settlementMode: position.settlementMode,
        settlementAsset: position.settlementAsset,
        contractSizeUsd: position.contractSizeUsd,
        contracts: position.contracts,
        marginCoin: position.marginCoin,
        margin: position.margin,
        notional,
        notionalUsd: notional,
        simulatedTime: now,
        positionId: position.id,
      };
    };

    if (normalizedOrder.type === 'CONDITIONAL') {
      const currentP = Number(effectiveCurrentPrice);
      const triggerP = Number(normalizedOrder.stopPrice);

      if (!Number.isFinite(triggerP) || triggerP <= 0) {
        toast.error('触发价无效');
        return null;
      }

      if (shouldRejectImmediateConditionalPlacement(normalizedOrder.side, currentP, triggerP)) {
        toast.error('触发价设置不合理，订单将立即成交，请修改或使用市价单');
        return null;
      }
    }

    // Note: We no longer record OPEN trades to tradeHistory.
    // Only CLOSE/LIQUIDATION/FUNDING produce realized PnL entries.

    // BEST PRICE (taker)
    if (normalizedOrder.priceSelection === 'BEST') {
      const { fee, margin, slippage, position } = executeSettlementFill(symbol, effectiveCurrentPrice, normalizedOrder, false, now);
      const requiredMargin = margin + fee;
      if (requiredMargin > available) {
        toast.error('可用余额不足', {
          description: `需要 ${requiredMargin.toFixed(2)} USDT，当前可用 ${available.toFixed(2)} USDT`,
        });
        return null;
      }
      setBalance(prev => prev - requiredMargin);
      setPositionsMap(prev => {
        // Filter out any ghost (near-zero) positions for this symbol before adding
        const existing = (prev[symbol] || []).filter(isPositionOpen);
        return { ...prev, [symbol]: [...existing, position] };
      });
      // 执行力资产只奖励做多开仓：做空一律视为辅助对冲单，不计分。
      if (normalizedOrder.side === 'LONG') {
        recordExecutionTrade(tradingModeRef.current, buildExecutionTradeSnapshot(position, 'BEST'));
      }
      toast.success(`最优价成交: ${normalizedOrder.side === 'LONG' ? '开多' : '开空'} ${formatSettlementQuantity(position, symbol)} @ ${position.entryPrice.toFixed(2)}`);
      return { id: position.id };
    }

    // MARKET (taker with slippage)
    if (normalizedOrder.type === 'MARKET') {
      const { fee, margin, slippage, position } = executeSettlementFill(symbol, effectiveCurrentPrice, normalizedOrder, false, now);
      const requiredMargin = margin + fee;
      if (requiredMargin > available) {
        toast.error('可用余额不足', {
          description: `需要 ${requiredMargin.toFixed(2)} USDT，当前可用 ${available.toFixed(2)} USDT`,
        });
        return null;
      }
      setBalance(prev => prev - requiredMargin);
      setPositionsMap(prev => {
        const existing = (prev[symbol] || []).filter(isPositionOpen);
        return { ...prev, [symbol]: [...existing, position] };
      });
      // 执行力资产只奖励做多开仓：做空一律视为辅助对冲单，不计分。
      if (normalizedOrder.side === 'LONG') {
        recordExecutionTrade(tradingModeRef.current, buildExecutionTradeSnapshot(position, normalizedOrder.type));
      }
      toast.success(`${normalizedOrder.side === 'LONG' ? '开多' : '开空'} ${formatSettlementQuantity(position, symbol)} @ ${position.entryPrice.toFixed(2)}`);
      return { id: position.id };
    }

    // POST ONLY
    if (normalizedOrder.type === 'POST_ONLY') {
      if (normalizedOrder.side === 'LONG' && normalizedOrder.price >= effectiveCurrentPrice) { toast.error('Post Only 被拒绝'); return null; }
      if (normalizedOrder.side === 'SHORT' && normalizedOrder.price <= effectiveCurrentPrice) { toast.error('Post Only 被拒绝'); return null; }
    }

    // SCALED
    if (normalizedOrder.type === 'SCALED') {
      const count = normalizedOrder.scaledCount || 5;
      const startP = normalizedOrder.scaledStartPrice || 0;
      const endP = normalizedOrder.scaledEndPrice || 0;
      if (count < 2 || startP <= 0 || endP <= 0) { toast.error('分段订单参数无效'); return null; }
      const step = (endP - startP) / (count - 1);
      const qtyPerStep = isCoinSettled(normalizedOrder)
        ? Math.max(1, Math.round(normalizedOrder.quantity / count))
        : normalizedOrder.quantity / count;
      const parentId = crypto.randomUUID();
      const newOrders: PendingOrder[] = Array.from({ length: count }, (_, i) => ({
        id: crypto.randomUUID(), side: normalizedOrder.side, type: 'LIMIT' as OrderType,
        price: startP + step * i, stopPrice: 0, quantity: qtyPerStep,
        leverage: normalizedOrder.leverage, marginMode: normalizedOrder.marginMode,
        settlementMode: normalizedOrder.settlementMode,
        settlementAsset: normalizedOrder.settlementAsset,
        contractSizeUsd: normalizedOrder.contractSizeUsd,
        contracts: isCoinSettled(normalizedOrder) ? qtyPerStep : undefined,
        status: 'NEW' as const, createdAt: now, parentScaledId: parentId,
        tradingMode: tradingModeRef.current,
      }));
      setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), ...newOrders] }));
      toast.info(`分段订单已挂出: ${count} 笔限价单`);
      return null;
    }

    // TWAP
    if (normalizedOrder.type === 'TWAP') {
      const durationMs = (normalizedOrder.twapDuration || 60) * 60 * 1000;
      const intervalMs = (normalizedOrder.twapInterval || 5) * 60 * 1000;
      const twapOrder: PendingOrder = {
        id: crypto.randomUUID(), side: normalizedOrder.side, type: 'TWAP',
        price: 0, stopPrice: 0, quantity: normalizedOrder.quantity,
        leverage: normalizedOrder.leverage, marginMode: normalizedOrder.marginMode,
        settlementMode: normalizedOrder.settlementMode,
        settlementAsset: normalizedOrder.settlementAsset,
        contractSizeUsd: normalizedOrder.contractSizeUsd,
        contracts: normalizedOrder.contracts,
        status: 'ACTIVE', createdAt: now,
        tradingMode: tradingModeRef.current,
        twapTotalQty: normalizedOrder.quantity, twapFilledQty: 0,
        twapInterval: intervalMs, twapNextExecTime: now,
        twapEndTime: now + durationMs,
      };
      setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), twapOrder] }));
      toast.info(`TWAP 委托已启动`);
      return null;
    }

    // All other pending types — strict margin pre-check
    const estPrice = normalizedOrder.price > 0 ? normalizedOrder.price : effectiveCurrentPrice;
    const { marginUsd } = getSettlementMarginParts(symbol, normalizedOrder, estPrice);
    const { feeUsd } = getSettlementFeeParts(symbol, normalizedOrder, estPrice, true);
    const estMargin = marginUsd + feeUsd;
    if (estMargin > available) {
      toast.error('可用余额不足', {
        description: `需要 ${estMargin.toFixed(2)} USDT，当前可用 ${available.toFixed(2)} USDT`,
      });
        return null;
    }

    // Determine trigger direction / operator at placement from the then-current price snapshot
    let triggerDirection: 'UP' | 'DOWN' | undefined;
    let operator: PendingOrder['operator'];
    if (normalizedOrder.type === 'CONDITIONAL' && normalizedOrder.stopPrice > 0) {
      operator = getTriggerOperator(normalizedOrder.stopPrice, effectiveCurrentPrice);
      triggerDirection = operator === '>=' ? 'UP' : 'DOWN';
    } else if (['MARKET_TP_SL', 'LIMIT_TP_SL'].includes(normalizedOrder.type) && normalizedOrder.stopPrice > 0) {
      if (normalizedOrder.stopPrice > effectiveCurrentPrice) {
        triggerDirection = 'UP';
      } else if (normalizedOrder.stopPrice < effectiveCurrentPrice) {
        triggerDirection = 'DOWN';
      } else {
        // triggerPrice === currentPrice: default to safe side based on order side
        triggerDirection = normalizedOrder.side === 'LONG' ? 'UP' : 'DOWN';
      }
    }

    const newOrder: PendingOrder = {
      id: crypto.randomUUID(), side: normalizedOrder.side, type: normalizedOrder.type,
      price: normalizedOrder.price, stopPrice: normalizedOrder.stopPrice, quantity: normalizedOrder.quantity,
      leverage: normalizedOrder.leverage, marginMode: normalizedOrder.marginMode,
      settlementMode: normalizedOrder.settlementMode,
      settlementAsset: normalizedOrder.settlementAsset,
      contractSizeUsd: normalizedOrder.contractSizeUsd,
      contracts: normalizedOrder.contracts,
      status: normalizedOrder.type === 'CONDITIONAL' ? 'PENDING' : 'NEW', createdAt: now,
      tradingMode: tradingModeRef.current,
      callbackRate: normalizedOrder.callbackRate, trailingExecType: normalizedOrder.trailingExecType,
      trailingLimitPrice: normalizedOrder.trailingLimitPrice, trailingActivated: false,
      conditionalExecType: normalizedOrder.conditionalExecType, conditionalLimitPrice: normalizedOrder.conditionalLimitPrice,
      triggerDirection, operator,
    };
    setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), newOrder] }));
    toast.info('委托已挂出');
    return { id: newOrder.id };
  }, [getEffectiveTime, getSymbolSettlementMode, recordExecutionTrade]);

  // ===== Close Position — supports partial close via percentage (0-1] =====
  const handleClosePosition = useCallback((symbol: string, index: number, percentage: number = 1, method: 'manual' | 'sl' | 'tp1' | 'tp2' | 'tp3' | 'liquidation' = 'manual') => {
    const symbolPositions = positionsMapRef.current[symbol] || [];
    const pos = symbolPositions[index];
    const totalUnits = getPositionUnits(pos);
    if (!pos || totalUnits <= 0) return;

    const pct = Math.min(1, Math.max(0.01, percentage));
    let closeQty = totalUnits * pct;
    if (isCoinSettled(pos)) closeQty = Math.max(1, Math.round(closeQty));
    const rawPrice = priceMapRef.current[symbol] || 0;
    if (rawPrice <= 0) { toast.error('无法获取当前价格'); return; }

    const {
      fillPrice,
      slippageUsd,
      pnlUsd,
      pnlCoin,
      feeUsd,
      feeCoin,
      notionalUsd,
    } = closeSettlementPosition(symbol, pos, rawPrice, closeQty, false);

    const closedMargin = pos.margin * pct;
    const closedIsoMargin = pos.isolatedMargin != null ? pos.isolatedMargin * pct : undefined;

    const returnedMargin = pos.marginMode === 'isolated' && closedIsoMargin != null
      ? closedIsoMargin + pnlUsd - feeUsd
      : closedMargin + pnlUsd - feeUsd;

    // Credit to single global balance
    setBalance(prev => prev + Math.max(0, returnedMargin));

    // Determine if this position will be fully closed (for OCO cleanup)
    // Use Epsilon Threshold (1e-6) to defend against JS float precision dust
    const remainingUnitsAfter = totalUnits - closeQty;
    const willFullyClose = pct >= 1 || remainingUnitsAfter <= POSITION_DUST_EPSILON;
    const closedPositionId = pos.id;

    // Update or remove position — physical destruction on full close
    setPositionsMap(prev => {
      const positions = [...(prev[symbol] || [])];
      if (willFullyClose) {
        // Physically remove by id (defensive: not just by index)
        const filtered = positions.filter(p => p.id !== closedPositionId && isPositionOpen(p));
        return { ...prev, [symbol]: filtered };
      }
      const remaining = positions[index];
      if (remainingUnitsAfter <= POSITION_DUST_EPSILON) {
        const filtered = positions.filter(p => p.id !== closedPositionId && isPositionOpen(p));
        return { ...prev, [symbol]: filtered };
      }
      positions[index] = scaleSettlementPosition(remaining, remainingUnitsAfter);
      // Final sanitization sweep — drop any dust positions
      return { ...prev, [symbol]: positions.filter(isPositionOpen) };
    });

    // OCO / linked TP-SL maintenance — drop ALL linked reduce-only orders on full close (orphan prevention)
    setOrdersMap(prev => {
      const orders = prev[symbol] || [];
      if (orders.length === 0) return prev;
      let changed = false;
      const next: PendingOrder[] = [];
      for (const o of orders) {
        if (o.reduceOnly && o.linkedPositionId === closedPositionId) {
          if (willFullyClose) {
            changed = true;
            continue; // drop the linked TP/SL — prevent orphan conditional orders
          }
          // partial close: rescale the reduce-only quantity proportionally
          const remainPct = 1 - pct;
          const newQty = isCoinSettled(pos) ? Math.max(1, Math.round(o.quantity * remainPct)) : o.quantity * remainPct;
          if (newQty <= POSITION_DUST_EPSILON) { changed = true; continue; }
          changed = true;
          next.push({
            ...o,
            quantity: newQty,
            contracts: isCoinSettled(pos) ? newQty : o.contracts,
          });
          continue;
        }
        next.push(o);
      }
      return changed ? { ...prev, [symbol]: next } : prev;
    });

    setTradeHistory(prev => [...prev, {
      id: crypto.randomUUID(), symbol, side: pos.side, type: 'MARKET' as OrderType,
      positionId: pos.id,
      action: 'CLOSE' as const, entryPrice: pos.entryPrice, exitPrice: fillPrice,
      quantity: closeQty, contracts: isCoinSettled(pos) ? closeQty : undefined,
      leverage: pos.leverage,
      pnl: pnlUsd - feeUsd, pnlCoin, feeCoin,
      fee: feeUsd, slippage: slippageUsd, notionalUsd,
      settlementMode: pos.settlementMode, settlementAsset: pos.settlementAsset,
      contractSizeUsd: pos.contractSizeUsd,
      openTime: pos.openTime || 0, closeTime: getEffectiveTime(symbol),
      exit_method: method,
      closedRealAt: Date.now(),
    }]);

    const pctLabel = pct < 1 ? ` (${Math.round(pct * 100)}%)` : '';
    const netPnl = pnlUsd - feeUsd;
    toast.success(`市价平仓成功，已结算盈亏：${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} USDT`, {
      description: `${symbol} ${formatSettlementQuantity({ ...pos, quantity: closeQty, contracts: isCoinSettled(pos) ? closeQty : undefined }, symbol)}${pctLabel} @ ${fillPrice.toFixed(2)}`,
    });
  }, [getEffectiveTime]);

  // ===== Place TP/SL conditional orders (reduce-only, linked to a specific position) =====
  const handlePlaceTpSl = useCallback((symbol: string, pos: Position, tp: number | null, sl: number | null, pct: number) => {
    if ((tp === null || !(tp > 0)) && (sl === null || !(sl > 0))) {
      toast.error('请至少输入一个有效的触发价格');
      return;
    }

    const safePct = Math.min(100, Math.max(1, pct));
    const totalUnits = getPositionUnits(pos);
    const closeQty = isCoinSettled(pos)
      ? Math.max(1, Math.round(totalUnits * (safePct / 100)))
      : totalUnits * (safePct / 100);
    if (closeQty <= 0) {
      toast.error('平仓数量无效');
      return;
    }

    const markPrice = priceMapRef.current[symbol] || 0;

    // Sanity check TP/SL direction relative to current mark price
    if (markPrice > 0) {
      if (tp !== null && tp > 0) {
        if (pos.side === 'LONG' && tp <= markPrice) { toast.error('多单止盈价必须高于当前价'); return; }
        if (pos.side === 'SHORT' && tp >= markPrice) { toast.error('空单止盈价必须低于当前价'); return; }
      }
      if (sl !== null && sl > 0) {
        if (pos.side === 'LONG' && sl >= markPrice) { toast.error('多单止损价必须低于当前价'); return; }
        if (pos.side === 'SHORT' && sl <= markPrice) { toast.error('空单止损价必须高于当前价'); return; }
      }
    }

    const now = getEffectiveTime(symbol);
    const closeSide: OrderSide = pos.side === 'LONG' ? 'SHORT' : 'LONG';

    setOrdersMap(prev => {
      const orders = prev[symbol] || [];
      // Replace any existing TP/SL on this exact position
      const filtered = orders.filter(o => !(o.reduceOnly && o.linkedPositionId === pos.id));
      const newOrders: PendingOrder[] = [];

      if (tp !== null && tp > 0) {
        const tpOperator: TriggerOperator = pos.side === 'LONG' ? '>=' : '<=';
        newOrders.push({
          id: crypto.randomUUID(), side: closeSide, type: 'CONDITIONAL' as OrderType,
          price: 0, stopPrice: tp, quantity: closeQty,
          leverage: pos.leverage, marginMode: pos.marginMode,
          settlementMode: pos.settlementMode, settlementAsset: pos.settlementAsset,
          contractSizeUsd: pos.contractSizeUsd,
          contracts: isCoinSettled(pos) ? closeQty : undefined,
          status: 'PENDING', createdAt: now,
          conditionalExecType: 'MARKET',
          operator: tpOperator, triggerDirection: tpOperator === '>=' ? 'UP' : 'DOWN',
          reduceOnly: true, reduceSymbol: symbol, reducePositionSide: pos.side,
          linkedPositionId: pos.id, reduceKind: 'TP', reducePercentage: safePct,
        });
      }

      if (sl !== null && sl > 0) {
        const slOperator: TriggerOperator = pos.side === 'LONG' ? '<=' : '>=';
        newOrders.push({
          id: crypto.randomUUID(), side: closeSide, type: 'CONDITIONAL' as OrderType,
          price: 0, stopPrice: sl, quantity: closeQty,
          leverage: pos.leverage, marginMode: pos.marginMode,
          settlementMode: pos.settlementMode, settlementAsset: pos.settlementAsset,
          contractSizeUsd: pos.contractSizeUsd,
          contracts: isCoinSettled(pos) ? closeQty : undefined,
          status: 'PENDING', createdAt: now,
          conditionalExecType: 'MARKET',
          operator: slOperator, triggerDirection: slOperator === '>=' ? 'UP' : 'DOWN',
          reduceOnly: true, reduceSymbol: symbol, reducePositionSide: pos.side,
          linkedPositionId: pos.id, reduceKind: 'SL', reducePercentage: safePct,
        });
      }

      return { ...prev, [symbol]: [...filtered, ...newOrders] };
    });

    toast.success('止盈/止损委托已下达', {
      description: `TP: ${tp || '-'} / SL: ${sl || '-'} · ${safePct}% 仓位`,
    });
  }, [getEffectiveTime]);

  // ===== Cancel Order =====
  const handleCancelOrder = useCallback((symbol: string, orderId: string) => {
    // 撤单即删——删之前先存一份快照（委托价/委托时间/取消时间），供战役页「反向对冲挂单」展示。
    const order = (ordersMap[symbol] || []).find(o => o.id === orderId);
    if (order) {
      const cancelledAt = getEffectiveTime(symbol) || Date.now();
      const orderPrice = order.price > 0
        ? order.price
        : (order.conditionalLimitPrice && order.conditionalLimitPrice > 0)
          ? order.conditionalLimitPrice
          : order.stopPrice;
      setCancelledOrders(prev => [
        ...prev,
        {
          id: order.id,
          symbol,
          side: order.side,
          type: order.type,
          reduceOnly: order.reduceOnly ?? false,
          reduceKind: order.reduceKind ?? null,
          linkedPositionId: order.linkedPositionId ?? null,
          price: orderPrice,
          quantity: order.quantity,
          contracts: order.contracts,
          leverage: order.leverage,
          settlementMode: order.settlementMode,
          settlementAsset: order.settlementAsset,
          contractSizeUsd: order.contractSizeUsd,
          createdAt: order.createdAt,
          cancelledAt,
        },
      ].slice(-500));
    }
    setOrdersMap(prev => ({
      ...prev,
      [symbol]: (prev[symbol] || []).filter(o => o.id !== orderId),
    }));
    toast.info('委托已撤销');
  }, [ordersMap, getEffectiveTime, setCancelledOrders]);

  // ===== Adjust Isolated Margin (add OR remove) =====
  // signedDelta > 0 = add (debit available, credit position margin)
  // signedDelta < 0 = remove (credit available, debit position margin, guarded by initial margin floor)
  const handleAdjustMargin = useCallback((symbol: string, posIndex: number, signedDelta: number) => {
    if (!signedDelta || isNaN(signedDelta)) return;
    const positions = positionsMapRef.current[symbol] || [];
    const pos = positions[posIndex];
    if (!pos) return;
    if (pos.marginMode !== 'isolated') {
      toast.error('全仓模式不支持单仓位调整保证金');
      return;
    }

    const currentMargin = pos.isolatedMargin ?? pos.margin;
    const initialMargin = isCoinSettled(pos)
      ? pos.margin
      : (pos.quantity * pos.entryPrice) / pos.leverage;

    if (signedDelta > 0) {
      // ADD
      const avail = calcAvailable(balanceRef.current, positionsMapRef.current);
      const actual = Math.min(signedDelta, avail);
      if (actual <= 1e-8) { toast.error('可用余额不足'); return; }
      setBalance(prev => prev - actual);
      setPositionsMap(prev => {
        const arr = [...(prev[symbol] || [])];
        const p = arr[posIndex];
        if (!p) return prev;
        const price = priceMapRef.current[symbol] || p.entryPrice;
        const coinDelta = isCoinSettled(p) && price > 0 ? actual / price : 0;
        arr[posIndex] = {
          ...p,
          isolatedMargin: (p.isolatedMargin ?? p.margin) + actual,
          margin: p.margin + actual,
          marginCoin: p.marginCoin == null ? undefined : p.marginCoin + coinDelta,
        };
        return { ...prev, [symbol]: arr };
      });
    } else {
      // REMOVE — guard by initial margin floor
      const requested = -signedDelta;
      const maxRemovable = Math.max(0, currentMargin - initialMargin);
      const actual = Math.min(requested, maxRemovable);
      if (actual <= 1e-8) {
        toast.error('已达初始保证金下限，无法继续减少');
        return;
      }
      setBalance(prev => prev + actual);
      setPositionsMap(prev => {
        const arr = [...(prev[symbol] || [])];
        const p = arr[posIndex];
        if (!p) return prev;
        const price = priceMapRef.current[symbol] || p.entryPrice;
        const coinDelta = isCoinSettled(p) && price > 0 ? actual / price : 0;
        arr[posIndex] = {
          ...p,
          isolatedMargin: (p.isolatedMargin ?? p.margin) - actual,
          margin: Math.max(0, p.margin - actual),
          marginCoin: p.marginCoin == null ? undefined : Math.max(0, p.marginCoin - coinDelta),
        };
        return { ...prev, [symbol]: arr };
      });
    }
  }, []);

  // Backwards-compat alias: legacy "+只追加" callsites
  const handleAddIsolatedMargin = useCallback((symbol: string, posIndex: number, amount: number) => {
    handleAdjustMargin(symbol, posIndex, Math.abs(amount));
  }, [handleAdjustMargin]);

  // ===== Clear Symbol Data & Financial Reversal =====
  const handleClearSymbolData = useCallback((symbol: string) => {
    // Use refs to avoid stale closures
    const currentPositions = positionsMapRef.current[symbol] || [];
    let returnedMargin = 0;
    for (const pos of currentPositions) {
      const m = pos.marginMode === 'isolated' && pos.isolatedMargin != null
        ? pos.isolatedMargin : pos.margin;
      returnedMargin += m;
    }

    const currentHistory = tradeHistory;
    const symbolHistory = currentHistory.filter(t => t.symbol === symbol);
    let totalRealizedPnl = 0;
    let totalFees = 0;
    for (const t of symbolHistory) {
      totalRealizedPnl = Math.round((totalRealizedPnl + t.pnl) * 1e8) / 1e8;
      totalFees = Math.round((totalFees + t.fee) * 1e8) / 1e8;
    }

    const adjustment = Math.round((returnedMargin - totalRealizedPnl + totalFees) * 1e8) / 1e8;

    // Physically remove all positions for this symbol
    setPositionsMap(prev => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });

    setOrdersMap(prev => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });

    setTradeHistory(prev => prev.filter(t => t.symbol !== symbol));
    setBalance(prev => Math.round((prev + adjustment) * 1e8) / 1e8);

    toast.success(`已彻底清除 ${symbol.replace('USDT', '/USDT')} 的所有数据，资产已复原。`);
  }, [tradeHistory]);

  const value: TradingState = {
    sim,
    activeSymbol, setActiveSymbol,
    interval, setInterval,
    positionsMap, setPositionsMap,
    ordersMap, setOrdersMap,
    filledOrders, setFilledOrders,
    priceMap, setPriceMap,
    balance, setBalance,
    isolatedBalances: emptyIsolatedBalances,
    setIsolatedBalances: setIsolatedBalancesNoop,
    tradeHistory, setTradeHistory,
    activeSymbolPositions, activeSymbolOrders,
    allPositions, allOrders,
    currentPrice, pricePrecision, quantityPrecision, setPricePrecision, setQuantityPrecision,
    leverageMap, marginModeMap, settlementModeMap,
    getSymbolLeverage, setSymbolLeverage,
    getSymbolMarginMode, setSymbolMarginMode,
    getSymbolSettlementMode, setSymbolSettlementMode,
    activeSymbols,
    handlePlaceOrder, handleClosePosition, handleCancelOrder, handlePlaceTpSl,
    handleAddIsolatedMargin, handleAdjustMargin, handleClearSymbolData,
    fundingRate: FUNDING_RATE,
    liquidationOpen, liquidationDetails, closeLiquidationModal,
    timeMode, setTimeMode,
    tradingMode, setTradingMode,
    executionAsset, setExecutionAsset, recordExecutionTrade, recordCampaignCreated, reconcileCampaignRewards,
    recordPostTradeReviewCompleted, reconcilePostTradeReviewRewards,
    recordObservationLogged, settleCampaignMissingPenalties,
    coinTimelines, setCoinTimelines,
    totalPositionCount,
    getEffectiveTime,
    getCoinState,
    getEffectiveBalance,
    getEffectiveAvailable,
  };

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}
