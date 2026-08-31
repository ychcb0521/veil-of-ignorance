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
import {
  applyTransfer,
  validateTransfer,
  type TransferRecord,
  type WalletBalances,
  type WalletId,
} from '@/lib/walletTransfer';
import { usePersistedState, loadPersistedSimState, saveSimState, clearSimState } from '@/hooks/usePersistedState';
import { intervalToMs } from '@/hooks/useBinanceData';
import { useAuth } from '@/contexts/AuthContext';
import { evaluateIsolatedLiquidation, staleToleranceMs } from '@/lib/liquidationGuards';
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
  DEFAULT_MARGIN_MODE,
  DEFAULT_SETTLEMENT_MODE,
  MAINTENANCE_MARGIN_RATE, LIQUIDATION_FEE_RATE, FUNDING_RATE, FUNDING_HOURS, getTriggerOperator,
} from '@/types/trading';
import { resolveConditionalTriggerPrice, shouldRejectImmediateConditionalPlacement } from '@/lib/conditionalOrders';
import {
  POSITION_DUST_EPSILON,
  buildCloseRecords,
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
  mergeFilledPosition,
} from '@/lib/tradingSettlement';
import {
  planReduceOnlyTrigger,
  type ReduceOnlyTriggerExecution,
} from '@/lib/reduceOnlyOrderExecution';
import { upsertOrderSnapshot } from '@/lib/orderSnapshotHistory';
import { formatPrice, getPriceDecimals } from '@/lib/formatters';
import { buildTpSlOrders, keepValidTpSlLegs, replaceTpSlOrders, validateTpSlLevels } from '@/lib/tpSlOrders';
import { removableMarginUsd } from '@/lib/positionGroupRisk';
import { evaluateFillAffordability, fillCostUsd } from '@/lib/fillAffordability';
import { planLeverageChange, type LeverageChangePlan } from '@/lib/leverageRestatement';
import type { PositionMergeResult } from '@/lib/tradingSettlement';
import { orderReferencePrice } from '@/lib/orderReferencePrice';
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
  reconcileReviewMissingPenalties as applyReconcileReviewMissing,
  type CampaignCreationRef,
  type CampaignRewardRef,
  type ClosedMainTradeReviewState,
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
  /** 倒叙播放的镜面时刻（该币种本次倒放的起点，对齐 K 线开盘）；正序时无意义。 */
  reverseCapTime?: number | null;
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
  /**
   * 登记「这个标的的价属于哪一刻」。只有真正发起过行情请求的地方才该调用它，
   * 且必须传**请求时用的那个模拟时刻**，而不是 setState 落地的时刻。
   * 没登记过的标的一律不参与强平——见 lib/liquidationGuards。
   */
  markPriceAsOf: (symbol: string, asOfSimTime: number) => void;
  /** 发布当刻撮合区间，供条件单下单闸门与撮合共用同一基准。 */
  publishMatchRange: (symbol: string, range: { high: number; low: number }) => void;
  balance: number;
  setBalance: (v: number | ((prev: number) => number)) => void;
  /** 现货钱包余额（USDT）。合约钱包的余额就是 balance。 */
  spotBalance: number;
  /** 资金钱包余额（USDT）。 */
  fundingBalance: number;
  /** 账内划转记录，最新在前。 */
  transferHistory: TransferRecord[];
  /** 在三个钱包之间划转；返回是否成功，失败原因已以 toast 呈现。 */
  transferFunds: (from: WalletId, to: WalletId, amount: number) => boolean;
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
  /** 调整标的杠杆：持仓、挂单、余额一起重述；被拒绝时返回原因，不做任何写入。 */
  applySymbolLeverage: (symbol: string, nextLeverage: number) => LeverageChangePlan;
  /**
   * 成交时扣款；付不起就撤单留痕并返回 false。
   * 必须严格排在减仓分支**之后**——止盈止损是**退还**保证金的，绝不能被这道闸门拦住。
   */
  settleFillDebit: (symbol: string, order: PendingOrder, marginUsd: number, feeUsd: number, cancelledAt: number) => boolean;
  /** 挂单成交时兑现它随身带着的止盈止损（勾选框下达的那一对）。 */
  applyAttachedTpSl: (symbol: string, position: Position, order: PendingOrder) => void;
  executeReduceOnlyTrigger: (
    symbol: string,
    order: PendingOrder,
    triggerPrice: number,
    closeTime?: number,
  ) => ReduceOnlyTriggerExecution;
  /** 按仓位 id 调整逐仓保证金；一次可写多笔（合并卡下的各腿）。 */
  handleAdjustMargin: (symbol: string, allocations: { positionId: string; deltaUsd: number }[]) => void;
  handleClearSymbolData: (symbol: string) => void;
  fundingRate: number;
  liquidationOpen: boolean;
  liquidationDetails: LiquidationDetails | undefined;
  closeLiquidationModal: () => void;
  // Multi-Timeline
  timeMode: TimeMode;
  setTimeMode: (v: TimeMode) => void;
  /** 播放方向：1 正序（默认）/ -1 倒叙播放。全局生效，含隔离模式的所有币种时钟。 */
  timeDirection: 1 | -1;
  setTimeDirection: (v: 1 | -1) => void;
  /** 同步模式下本次倒放的镜面时刻（对齐 K 线开盘）；隔离模式看各币种的 reverseCapTime。 */
  reverseCapTime: number | null;
  setReverseCapTime: (v: number | null) => void;
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
  recordCampaignCreated: (campaign?: string | CampaignRewardRef | null) => void;
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
  /** 用已平仓主力单的复盘状态对账「未做平仓评价 −1000」（可翻转，补做即翻回）。 */
  reconcileReviewMissingPenalties: (closedMainTrades: ClosedMainTradeReviewState[]) => void;
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
  /** 勾选「止盈止损」时随单带下来的保护价——绝不再与 stopPrice 合流。 */
  tpTriggerPrice?: number;
  slTriggerPrice?: number;
  tpSlPercentage?: number;
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
      direction: persistedSim.direction === -1 ? -1 : 1,
    } : undefined
  );

  const [activeSymbol, setActiveSymbol] = usePersistedState('symbol', persistedSim?.symbol ?? 'BTCUSDT');
  const [interval, setInterval] = usePersistedState('interval', persistedSim?.interval ?? '1m');
  const [positionsMap, setPositionsMapState] = usePersistedState<PositionsMap>('positions_map', {});
  const positionsMapRef = useRef(positionsMap);
  positionsMapRef.current = positionsMap;
  const setPositionsMap = useCallback((value: PositionsMap | ((prev: PositionsMap) => PositionsMap)) => {
    const next = typeof value === 'function' ? value(positionsMapRef.current) : value;
    positionsMapRef.current = next;
    setPositionsMapState(next);
  }, [setPositionsMapState]);

  const [ordersMap, setOrdersMapState] = usePersistedState<OrdersMap>('orders_map', {});
  const ordersMapRef = useRef(ordersMap);
  ordersMapRef.current = ordersMap;
  const reduceOnlyDeferredReasonRef = useRef(new Map<string, string>());
  const setOrdersMap = useCallback((value: OrdersMap | ((prev: OrdersMap) => OrdersMap)) => {
    const next = typeof value === 'function' ? value(ordersMapRef.current) : value;
    ordersMapRef.current = next;
    setOrdersMapState(next);
  }, [setOrdersMapState]);
  // 撤单快照：撤单本身会把订单从 ordersMap 删掉，这里另存一份（含委托价/委托时间/取消时间），
  // 供战役页展示「反向对冲挂单」。这是审计记录，不能按数量截断，否则历史战役的委托层会消失。
  const [, setCancelledOrders] = usePersistedState<CancelledOrderSnapshot[]>('cancelled_orders', []);
  // 成交快照：委托触发后订单会从 ordersMap 删除，这里保留“委托时间 → 触发时间”的桥。
  const [filledOrders, setFilledOrders] = usePersistedState<FilledOrderSnapshot[]>('filled_orders', []);
  const [priceMap, setPriceMap] = usePersistedState<PriceMap>('price_map', {});
  /**
   * 每个标的的价格「属于哪一刻」（模拟时间）。
   *
   * priceMap 本身只是 Record<string, number>，没有时间戳，却被持久化进 localStorage、
   * 又是 simStateSync 里唯一不上云的键 —— 持仓/余额/时间机器状态都上云，价格不上云。
   * 于是「持仓」和「价格」从设计上就允许来自不同时刻：上一段回放、上一个日期的价
   * 会活过刷新、活过时间跳转，而强平此前唯一的护栏只有 `price > 0`。
   *
   * 这张表只在**真正发起过一次行情请求**的地方按请求所用的模拟时刻登记（markPriceAsOf），
   * 所以「没登记过」= 说不清这个价属于哪一刻。用 ref 而不是 state：
   * 它不参与渲染，而且**不该被持久化** —— 刷新后一律视为未知，宁可晚一秒强平。
   */
  /**
   * 当刻撮合用的价格区间（当前这根未收 K 线的 high/low）。
   * 条件单的下单闸门必须和撮合看**同一个区间**：撮合基准不是标量现价，
   * 而是这根 K 线已经打印出来的全部行程。Index 在喂撮合的同一处发布到这里。
   */
  const matchRangeRef = useRef<Record<string, { high: number; low: number }>>({});
  const publishMatchRange = useCallback((symbol: string, range: { high: number; low: number }) => {
    if (!symbol) return;
    const { high, low } = range;
    if (!Number.isFinite(high) || !Number.isFinite(low)) return;
    matchRangeRef.current[symbol] = { high, low };
  }, []);

  const priceAsOfRef = useRef<Record<string, number>>({});
  const markPriceAsOf = useCallback((symbol: string, asOfSimTime: number) => {
    if (!symbol || !Number.isFinite(asOfSimTime) || asOfSimTime <= 0) return;
    priceAsOfRef.current[symbol] = asOfSimTime;
  }, []);
  const [balance, setBalanceState] = usePersistedState('balance', initialCapital);
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  /**
   * 余额一律**写时同步推进 ref**——与 positionsMap / ordersMap 同一个套路。
   *
   * 此前 balanceRef 靠一个 useEffect 追平（`useEffect(() => { ref = balance })`），
   * 于是同一批 setState 里的每一次读都拿到**同一个提交前的旧值**：
   * 一根 K 线里同时触发的 N 条腿会各自看到全额余额、各自放行，
   * 任何「够不够钱」的判断在那一刻都等于没写。
   */
  const setBalance = useCallback((value: number | ((prev: number) => number)) => {
    const next = typeof value === 'function' ? (value as (p: number) => number)(balanceRef.current) : value;
    balanceRef.current = next;
    setBalanceState(next);
  }, [setBalanceState]);
  // 现货 / 资金钱包。合约钱包用既有的 balance——它已是「可用现金」口径
  // （开仓扣、平仓退），正是币安「合约可划转」的那个数。
  const [spotBalance, setSpotBalance] = usePersistedState('spot_balance', 0);
  const [fundingBalance, setFundingBalance] = usePersistedState('funding_balance', 0);
  const [transferHistory, setTransferHistory] = usePersistedState<TransferRecord[]>('transfer_history', []);

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
  const leverageMapRef = useRef(leverageMap);
  leverageMapRef.current = leverageMap;
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

  useEffect(() => {
    // 先按当前权重把历史事件重算一次(幂等)，再结算未练习欠账。
    setExecutionAsset(prev => settleNoTradePenalties(applyScoringMigration(prev)));
  }, [setExecutionAsset]);

  const recordExecutionTrade = useCallback((modeOverride?: TradingMode, trade?: ExecutionTradeSnapshot | null) => {
    const mode = modeOverride ?? tradingModeRef.current;
    setExecutionAsset(prev => applyExecutionTradeReward(prev, mode, new Date(), trade));
  }, [setExecutionAsset]);

  // 建战役按「自然日 × 标的」+300；同日同标的只计一次，并与未建战役 −300 互斥。
  const recordCampaignCreated = useCallback((campaign?: string | CampaignRewardRef | null) => {
    setExecutionAsset(prev => applyCampaignReward(prev, campaign ?? null, new Date()));
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

  // 用权威战役列表结算「交易过却当天没建战役」的 −300；与同日同标的建战役奖励互斥。
  const settleCampaignMissingPenalties = useCallback((campaigns: CampaignCreationRef[]) => {
    setExecutionAsset(prev => applySettleCampaignMissing(prev, campaigns, new Date()));
  }, [setExecutionAsset]);

  // 未做平仓评价 −1000（可翻转）：按已平仓主力单的复盘状态增删罚，补做复盘即翻回。
  const reconcileReviewMissingPenalties = useCallback((closedMainTrades: ClosedMainTradeReviewState[]) => {
    setExecutionAsset(prev => applyReconcileReviewMissing(prev, closedMainTrades, new Date()));
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

  // 同步模式下本次倒放的镜面时刻（持久化，刷新后镜像视图不越界泄露未来）。
  const [reverseCapTime, setReverseCapTime] = usePersistedState<number | null>('reverse_cap_time_v1', null);

  // 倒叙播放：翻转全局播放方向。隔离模式下所有非停止币种的时钟先按旧方向
  // 冻结到当前时刻并重新锚定，保证切换瞬间任何时钟都不跳变；进入倒放时把
  // 冻结时刻向下对齐到 K 线开盘并记为镜面 cap——正放里只揭示了一半的蜡烛
  // 不进入镜像历史，杜绝亚 K 线级的未来泄露。同步时钟的对齐由
  // sim.setDirection(snapToMs) 内部完成。
  const setTimeDirection = useCallback((direction: 1 | -1) => {
    const prevDirection = sim.direction;
    if (direction === prevDirection) return;
    const now = Date.now();
    const iMs = intervalToMs(interval);
    const snap = (t: number) => (iMs > 0 ? Math.floor(t / iMs) * iMs : t);

    setCoinTimelines(prev => {
      let changed = false;
      const next: CoinTimelinesMap = { ...prev };
      for (const [sym, ct] of Object.entries(prev)) {
        if (ct.status === 'stopped') continue;
        const live = ct.status === 'playing' && ct.realStartTime && ct.historicalAnchorTime != null
          ? ct.historicalAnchorTime + (now - ct.realStartTime) * ct.speed * prevDirection
          : ct.time;
        const frozen = direction === -1 ? snap(live) : live;
        next[sym] = {
          ...ct,
          time: frozen,
          historicalAnchorTime: ct.status === 'playing' ? frozen : ct.historicalAnchorTime,
          realStartTime: ct.status === 'playing' ? now : ct.realStartTime,
          reverseCapTime: direction === -1 ? frozen : ct.reverseCapTime ?? null,
        };
        changed = true;
      }
      return changed ? next : prev;
    });

    if (direction === -1) {
      const live = sim.status === 'playing' ? sim.getSimTime() : sim.currentTimeRef.current;
      setReverseCapTime(snap(live));
      sim.setDirection(direction, { snapToMs: iMs });
    } else {
      sim.setDirection(direction);
    }
  }, [sim, interval, setCoinTimelines, setReverseCapTime]);

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
        direction: sim.direction,
        symbol: activeSymbol,
        interval,
      });
    } else {
      clearSimState();
    }
  }, [sim.status, sim.historicalAnchorTime, sim.realStartTime, sim.currentSimulatedTime, sim.speed, sim.direction, activeSymbol, interval]);

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
        direction: s.direction,
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
    return marginModeMap[symbol] ?? DEFAULT_MARGIN_MODE;
  }, [marginModeMap]);

  const setSymbolMarginMode = useCallback((symbol: string, mode: MarginMode) => {
    setMarginModeMap(prev => ({ ...prev, [symbol]: mode }));
  }, [setMarginModeMap]);

  const getSymbolSettlementMode = useCallback((symbol: string): SettlementMode => {
    return settlementModeMap[symbol] ?? DEFAULT_SETTLEMENT_MODE;
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
          leverage: pos.openLeverage ?? pos.leverage,
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

        // 判据整个搬进 liquidationGuards.evaluateIsolatedLiquidation：
        // 陈价、零张幽灵仓位、NaN 三种情况全部落到「不强平」。
        // 旧代码写的是 `if (posEquity > maintMargin) continue`——NaN 让 `>` 为假，
        // 于是任何畸形数据的默认归宿是「爆仓」，方向是反的。
        const decision = evaluateIsolatedLiquidation({
          symbol: sym, position: pos, price,
          priceAsOf: priceAsOfRef.current[sym],
          nowSim: getEffectiveTime(sym),
          toleranceMs: staleToleranceMs(sim.speed),
        });
        if (!decision.liquidate) continue;

        const pnl = decision.pnlUsd;
        const notional = decision.notionalUsd;
        const { feeUsd: closeFee, feeCoin } = getSettlementFeeParts(sym, pos, price, false);
        const liqFee = notional * LIQUIDATION_FEE_RATE;

        /**
         * 强平也按每笔成交各写一条。合并本来就是为了「加仓不该被自己的强平价单独打掉」——
         * 若强平这一支只写一条,就等于在**它当初要保护的那件事真的发生时**,
         * 把加仓从事后复盘里抹掉。
         */
        setTradeHistory(prev => [...prev, ...buildCloseRecords({
          symbol: sym, pos,
          closeQty: getPositionUnits(pos),
          fillPrice: price,
          closeTime: getEffectiveTime(sym),
          exitMethod: 'liquidation',
          closedRealAt: Date.now(),
          totals: {
            netPnl: pnl - closeFee - liqFee,
            feeUsd: closeFee + liqFee,
            feeCoin,
            slippageUsd: 0,
            notionalUsd: notional,
          },
        }).map(r => ({ ...r, action: 'LIQUIDATION' as const }))]);

        // 按 id 删，不按下标。下标取自 effect 闭包里那份已提交的 positionsMap，
        // 而 filter 作用在 setPositionsMap 同步推进的 positionsMapRef 上——两个数组
        // 不同源：同一帧里只要 rAF 的止盈止损或后台轮询改过这个数组，下标就会错位，
        // 结果不是**删空**（同一 positionId 下一帧再写一条重复爆仓单），
        // 就是**误删一笔健康仓位**（无声消失、没有任何平仓记录）。
        // 同文件的 handleClosePosition 早就写着 defensive: not just by index，只有这里漏了。
        const liquidatedId = pos.id;
        setPositionsMap(prev => ({
          ...prev,
          [sym]: (prev[sym] || []).filter(p => p.id !== liquidatedId),
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

            // 全仓强平同样按每笔成交拆条,理由与逐仓那一支相同。
            liqRecords.push(...buildCloseRecords({
              symbol: sym, pos,
              closeQty: getPositionUnits(pos),
              fillPrice: price,
              closeTime: getEffectiveTime(sym),
              exitMethod: 'liquidation',
              closedRealAt: Date.now(),
              totals: {
                netPnl: pnl - closeFee - liqFee,
                feeUsd: closeFee + liqFee,
                feeCoin,
                slippageUsd: 0,
                notionalUsd: notional,
              },
            }).map(r => ({ ...r, action: 'LIQUIDATION' as const })));
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
  }, [priceMap, positionsMap, balance, sim.isRunning, sim.currentSimulatedTime, sim.speed, getEffectiveTime]);

  /**
   * 成交时的扣款闸门。返回 true = 已扣款；false = 这一单付不起，必须当作撤单丢掉。
   *
   * 挂单在这个模拟器里**不预留保证金**（calcAvailable 只遍历 positionsMap，
   * ordersMap 从来没有任何记账函数读过），所以下单时的检查是一次**检查**、
   * 不是一次**冻结**：两条各自过得了检查的腿可以一起触发、一起扣款。
   * 余额 100,000 配两条各需 60,120 的条件单 → 触发后余额 −20,480。
   *
   * 负余额之后没有任何东西把它捞回来。**有全仓仓位**时它会把 crossEquity
   * 自己拖到 0 以下，下一跳强平所有标的的全仓仓位、并清空所有挂单；
   * **只有逐仓仓位**时那一支根本不跑，负余额永久留在账上、同步进云端，
   * 此后每一笔下单都被「可用余额不足」永久拒掉——一个退不出去的死局。
   *
   * 三条刻意的取舍：
   *
   * · **不夹 Math.max(0, …)**。钳到 0 会静默销毁钱：仓位照建，保证金却没真付，
   *   于是保证金率、强平距离、战役的 R 全都对着一个虚数算。
   * · **失败即撤单，并且留痕**。触发是一次**穿越**不是一个状态——被拒的
   *   100 元买单不会在价格回到 105 时重新武装，留着它等于给用户一张
   *   永远不会成交、却一直显示「在挂」的单子。撤单快照要写进 cancelled_orders，
   *   否则战役页的反向对冲挂单层会整条腿凭空消失。
   * · **绝不缩量成交**。币本位的量是整数张，填进去的数是**授权上限**；
   *   缩量还会把绑在这笔仓位上的减仓单和战役的初始风险锚一起弄脏。
   */
  const settleFillDebit = useCallback((
    symbol: string,
    order: PendingOrder,
    marginUsd: number,
    feeUsd: number,
    cancelledAt: number,
  ): boolean => {
    /**
     * 用**钱包里的自由现金**判定,不是 calcAvailable。
     *
     * calcAvailable = 余额 − Σ全仓保证金,而余额**已经**把两种模式的保证金都扣掉了
     * （开仓 setBalance(prev - requiredMargin) 不分模式,平仓也不分模式退还）。
     * 再减一次就是重复计算:开出 50 万全仓仓位后,余额 499,800、
     * calcAvailable 却是 −200 —— 一个毫无亏损的健康账户被判成负可用。
     *
     * 这个重复计算是旧的,但后果是新的:此前它只让**下单**偏严(弹个提示,可以重试),
     * 现在它跑在**成交**那一刻,而这里失败是不可逆的撤单。
     * 一个仓位铺得比较开的全仓用户,会看着自己付得起的挂单在触发时被撤掉。
     * (下单侧那道偏严的检查照旧——它可重试,而且宁严勿松。)
     */
    const verdict = evaluateFillAffordability({
      availableUsd: balanceRef.current,
      marginUsd,
      feeUsd,
    });
    if (verdict.ok) {
      setBalance(prev => prev - marginUsd - feeUsd);
      return true;
    }

    setCancelledOrders(prev => upsertOrderSnapshot(prev, {
      id: order.id,
      symbol,
      side: order.side,
      type: order.type,
      reduceOnly: order.reduceOnly ?? false,
      reduceKind: order.reduceKind ?? null,
      linkedPositionId: order.linkedPositionId ?? null,
      price: orderReferencePrice(order, priceMapRef.current[symbol] || 0).price,
      quantity: order.quantity,
      contracts: order.contracts,
      leverage: order.leverage,
      settlementMode: order.settlementMode,
      settlementAsset: order.settlementAsset,
      contractSizeUsd: order.contractSizeUsd,
      createdAt: order.createdAt,
      cancelledAt,
    }));
    toast.error('保证金不足，委托已撤销', {
      description: `${symbol} 需要 ${verdict.requiredUsd.toFixed(2)} USDT，可用 ${verdict.availableUsd.toFixed(2)} USDT`,
    });
    return false;
  }, [setBalance, setCancelledOrders]);

  /**
   * 随单下达的止盈止损：**成交那一刻**才变成减仓单。
   *
   * 参照价是这笔仓位的**开仓价**，不是此刻的盘口——一张挂在 0.0100 的限价买单
   * 配 0.0105 的止盈完全合理，拿 0.0112 的盘口去校验会把它判成方向错误，
   * 而它当时根本还没成交。
   */
  const applyAttachedTpSl = useCallback((symbol: string, position: Position, order: PendingOrder) => {
    const tp = Number(order.attachedTpPrice) > 0 ? Number(order.attachedTpPrice) : null;
    const sl = Number(order.attachedSlPrice) > 0 ? Number(order.attachedSlPrice) : null;
    if (tp === null && sl === null) return;

    const requested = { tp, sl, percentage: Number(order.attachedTpSlPercentage) || 100 };
    /**
     * **逐腿**取舍,而且失败要出声。
     *
     * 早先这里是「一发现坏腿就整体 return，且一声不吭」:
     * 止盈框里一个笔误会把那张完全合法的止损单一起吞掉——而止损是唯一负责
     * 封住亏损的那一支;用户拿到的是一个已经开着的杠杆仓位、零保护、零提示,
     * 唯一的信号是委托列表里少了两行。现在坏哪腿丢哪腿,并且说出来。
     */
    const { levels, dropped } = keepValidTpSlLegs(position.side, requested, position.entryPrice);
    const now = getEffectiveTime(symbol);
    const newOrders = buildTpSlOrders({ symbol, position, levels, now, newId: () => crypto.randomUUID() });
    if (dropped.length > 0) {
      toast.error('随单止盈/止损未能挂出', {
        description: `${dropped.map(d => d.message).join('；')}（成交价 ${formatPrice(position.entryPrice, symbol)}）`,
      });
    }
    if (newOrders.length === 0) return;
    setOrdersMap(prev => ({
      ...prev,
      [symbol]: replaceTpSlOrders(prev[symbol] || [], position.id, newOrders),
    }));
  }, [getEffectiveTime, setOrdersMap]);

  /**
   * 合并成交之后的收尾。**不做这一步，就是拿一个安静的 bug 换掉一个吵闹的 bug。**
   *
   * 1. 挂在被吞并那笔仓位上的减仓单（止盈/止损）会变成孤儿：
   *    planReduceOnlyTrigger 按 `candidate.id === linkedPositionId` 找仓位，找不到就
   *    返回 linked_position_missing 并**原样保留**这张单——不撤、不改指、不报错。
   *    用户在委托列表里看得见一张永远不会触发的止损。改指到存活仓位，绝不撤销。
   * 2. 随单带下来的止盈止损**不挂**：applyAttachedTpSl 会按 linkedPositionId 先删后建，
   *    传存活仓位进去等于让这笔加仓**悄悄抹掉主力现有的止损**；而且它按成数算量，
   *    「100%」会变成平掉合并后的全部。说出来，让用户自己在仓位上重设。
   */
  const applyMergeSideEffects = useCallback((symbol: string, merged: PositionMergeResult) => {
    if (merged.blockedBy) {
      toast.warning('未与现有仓位合并', {
        description: merged.blockedBy === 'leverage'
          ? '杠杆与现有同向仓位不同，两笔各自独立计算强平价。'
          : merged.blockedBy === 'marginMode'
            ? '保证金模式与现有同向仓位不同，两笔各自独立计算强平价。'
            : '结算方式与现有同向仓位不同，两笔各自独立计算强平价。',
      });
      return;
    }
    if (!merged.absorbedFillId) return;

    const absorbed = merged.absorbedFillId;
    const survivorId = merged.survivor.id;
    setOrdersMap(prev => {
      const list = prev[symbol] || [];
      let touched = 0;
      const next = list.map(o => {
        if (!(o.reduceOnly && o.linkedPositionId === absorbed)) return o;
        touched += 1;
        return { ...o, linkedPositionId: survivorId };
      });
      if (touched === 0) return prev;
      return { ...prev, [symbol]: next };
    });
  }, [setOrdersMap]);

  /**
   * 调整一个标的的杠杆——**持仓、挂单、余额在同一次写入里一起动**。
   *
   * 三件事必须原子完成，任何一种交错都是缺陷：
   *   · 只写 leverage 不动保证金 → 地板下降而钱没退，凭空多出「可减保证金」，
   *     用户能从调整保证金弹窗里把它提走，而且每提一档再来一次；
   *   · 只动保证金不写 leverage → 地板没变而钱退了，用户自己追加的保证金变得取不出来；
   *   · 不改挂单 → 下一笔成交按旧杠杆建仓，而合并键把杠杆算在内，
   *     于是拖一下滑块就多出一张卡。
   *
   * 方向是单向的：leverageMap → 持仓 + 挂单。持仓永不反向写回 leverageMap。
   */
  const applySymbolLeverage = useCallback((symbol: string, nextLeverage: number): LeverageChangePlan => {
    const positions = (positionsMapRef.current[symbol] || []).filter(isPositionOpen);
    const orders = ordersMapRef.current[symbol] || [];
    const plan = planLeverageChange({
      symbol,
      positions,
      orders,
      markPrice: priceMapRef.current[symbol] || 0,
      currentLeverage: leverageMapRef.current[symbol] ?? 35,
      nextLeverage,
    });
    if (!plan.ok) return plan;

    setSymbolLeverage(symbol, plan.to);

    if (plan.legs.length > 0) {
      const byId = new Map(plan.legs.map(l => [l.positionId, l.next] as const));
      setPositionsMap(prev => ({
        ...prev,
        [symbol]: (prev[symbol] || []).map(p => byId.get(p.id) ?? p),
      }));
      // 释放出来的保证金回到余额。提杠杆之所以能换来加仓弹药，就是这一步。
      if (Math.abs(plan.totalReleaseUsd) > 1e-9) {
        setBalance(prev => prev + plan.totalReleaseUsd);
      }
    }

    if (plan.restatedOrderIds.length > 0) {
      const ids = new Set(plan.restatedOrderIds);
      setOrdersMap(prev => ({
        ...prev,
        [symbol]: (prev[symbol] || []).map(o => (ids.has(o.id) ? { ...o, leverage: plan.to } : o)),
      }));
    }
    return plan;
  }, [setSymbolLeverage, setPositionsMap, setBalance, setOrdersMap]);

  // ===== Place Order (with strict accounting enforcement — single global pool) =====
  const handlePlaceOrder = useCallback((symbol: string, order: PlaceOrderParams): { id: string } | null => {
    // Use refs to bypass stale closures in high-frequency time machine ticks
    const available = calcAvailable(balanceRef.current, positionsMapRef.current);
    /**
     * 勾选「止盈止损」带下来的保护价。**与 stopPrice 彻底分开**:
     * 此前它们合流在一个字段里,于是引擎把止盈价当成开仓触发价——
     * 市价单不再立刻成交、挂到止盈价上开仓;限价单要等价格摸到止盈价才肯激活。
     * 立即成交的路径当场挂保护单;挂单则把它随身带着,成交那一刻才兑现。
     */
    const attachedTpSl = {
      attachedTpPrice: Number(order.tpTriggerPrice) > 0 ? Number(order.tpTriggerPrice) : undefined,
      attachedSlPrice: Number(order.slTriggerPrice) > 0 ? Number(order.slTriggerPrice) : undefined,
      attachedTpSlPercentage: Number(order.tpSlPercentage) > 0 ? Number(order.tpSlPercentage) : undefined,
    };
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

    /**
     * 保护价的方向在**下单这一刻**就能判：将来的成交价对每种类型都是已知的
     * （市价/最优价 = 现价，限价 = 委托价，条件单 = 触发价）。
     * 在这里拦下来，用户还站在面板前、还能改;拖到成交时再说,那已经是几小时后、
     * 而且他多半正看着别的标的。成交时那一道留作兜底。
     */
    if (attachedTpSl.attachedTpPrice != null || attachedTpSl.attachedSlPrice != null) {
      const entryGuess = orderReferencePrice(
        { ...normalizedOrder, type: normalizedOrder.type } as unknown as PendingOrder,
        effectiveCurrentPrice,
      ).price;
      const invalid = validateTpSlLevels(
        normalizedOrder.side,
        {
          tp: attachedTpSl.attachedTpPrice ?? null,
          sl: attachedTpSl.attachedSlPrice ?? null,
          percentage: attachedTpSl.attachedTpSlPercentage ?? 100,
        },
        entryGuess,
      );
      if (invalid) {
        toast.error(invalid.message, { description: `参照开仓价 ${formatPrice(entryGuess, symbol)}` });
        return null;
      }
    }

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

      if (shouldRejectImmediateConditionalPlacement(currentP, triggerP, matchRangeRef.current[symbol])) {
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
      /**
       * 同标的同方向并成一个仓位（币安单向持仓）：分开算会让加仓被自己的强平价
       * 单独打掉，而健康的主力明明还有盈余可以扛住它。
       * 先算好再写——setPositionsMap 是即时包装、positionsMapRef 与它同步推进，
       * 在调用前读 ref 与在 updater 里读 prev 等价，而且能把合并结果带出来。
       */
      const merged = mergeFilledPosition(
        symbol, (positionsMapRef.current[symbol] || []).filter(isPositionOpen), position,
      );
      setPositionsMap(prev => ({ ...prev, [symbol]: merged.positions }));
      applyMergeSideEffects(symbol, merged);
      // 执行力资产只奖励做多开仓：做空一律视为辅助对冲单，不计分。
      if (normalizedOrder.side === 'LONG') {
        recordExecutionTrade(tradingModeRef.current, buildExecutionTradeSnapshot(position, 'BEST'));
      }
      toast.success(`最优价成交: ${normalizedOrder.side === 'LONG' ? '开多' : '开空'} ${formatSettlementQuantity(position, symbol)} @ ${formatPrice(position.entryPrice, symbol)}`);
      /**
       * 并入现有仓位时**不挂**随单止盈止损。
       * applyAttachedTpSl 按 linkedPositionId 先删后建，传存活仓位进去等于让这笔加仓
       * 悄悄抹掉主力现有的止损；而且它按成数算量，「100%」会变成平掉合并后的全部。
       * 说出来，让用户在仓位上自己重设——不替他决定要不要换掉那道保护。
       */
      if (merged.absorbedFillId && (attachedTpSl.attachedTpPrice != null || attachedTpSl.attachedSlPrice != null)) {
        toast.warning('随单止盈/止损未挂出', {
          description: '本单已并入现有同向仓位；为避免覆盖仓位上已有的止损，请在仓位卡上重新设置。',
        });
      } else {
        applyAttachedTpSl(symbol, merged.survivor, { ...normalizedOrder, ...attachedTpSl } as unknown as PendingOrder);
      }
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
      /**
       * 同标的同方向并成一个仓位（币安单向持仓）：分开算会让加仓被自己的强平价
       * 单独打掉，而健康的主力明明还有盈余可以扛住它。
       * 先算好再写——setPositionsMap 是即时包装、positionsMapRef 与它同步推进，
       * 在调用前读 ref 与在 updater 里读 prev 等价，而且能把合并结果带出来。
       */
      const merged = mergeFilledPosition(
        symbol, (positionsMapRef.current[symbol] || []).filter(isPositionOpen), position,
      );
      setPositionsMap(prev => ({ ...prev, [symbol]: merged.positions }));
      applyMergeSideEffects(symbol, merged);
      // 执行力资产只奖励做多开仓：做空一律视为辅助对冲单，不计分。
      if (normalizedOrder.side === 'LONG') {
        recordExecutionTrade(tradingModeRef.current, buildExecutionTradeSnapshot(position, normalizedOrder.type));
      }
      toast.success(`${normalizedOrder.side === 'LONG' ? '开多' : '开空'} ${formatSettlementQuantity(position, symbol)} @ ${formatPrice(position.entryPrice, symbol)}`);
      /**
       * 并入现有仓位时**不挂**随单止盈止损。
       * applyAttachedTpSl 按 linkedPositionId 先删后建，传存活仓位进去等于让这笔加仓
       * 悄悄抹掉主力现有的止损；而且它按成数算量，「100%」会变成平掉合并后的全部。
       * 说出来，让用户在仓位上自己重设——不替他决定要不要换掉那道保护。
       */
      if (merged.absorbedFillId && (attachedTpSl.attachedTpPrice != null || attachedTpSl.attachedSlPrice != null)) {
        toast.warning('随单止盈/止损未挂出', {
          description: '本单已并入现有同向仓位；为避免覆盖仓位上已有的止损，请在仓位卡上重新设置。',
        });
      } else {
        applyAttachedTpSl(symbol, merged.survivor, { ...normalizedOrder, ...attachedTpSl } as unknown as PendingOrder);
      }
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
      /**
       * 分段订单此前在这里直接 return,**完全跳过**下方的预检——
       * 一次点击就能铺出 N 条谁也没查过的腿。按每条子单自己的委托价逐条估,
       * 求和后一次性检查:这 N 条是一起挂出去的,就该一起验。
       */
      {
        let scaledTotal = 0;
        for (let i = 0; i < count; i++) {
          const childPrice = startP + step * i;
          const child = { ...normalizedOrder, quantity: qtyPerStep, contracts: isCoinSettled(normalizedOrder) ? qtyPerStep : undefined };
          scaledTotal += fillCostUsd(symbol, child as unknown as PendingOrder, childPrice).totalUsd;
        }
        if (scaledTotal > available) {
          toast.error('可用余额不足', {
            description: `${count} 笔子单合计需要 ${scaledTotal.toFixed(2)} USDT，当前可用 ${available.toFixed(2)} USDT`,
          });
          return null;
        }
      }
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
    if (normalizedOrder.type === 'TRAILING_STOP') {
      const cb = Number(normalizedOrder.callbackRate);
      if (!(cb > 0) || cb >= 1) {
        toast.error('回调率无效', { description: '请输入 0–100% 之间的回调率' });
        return null;
      }
      // 与条件委托同样做挂单时的保证金预检——触发时才发现钱不够体验最差
      {
        // 跟踪委托的成交价是「极值 ×(1∓回调率)」,挂单时不可知;
        // 激活价至少是价格必须先够到的一档,拿它当估价比拿盘口保守。
        const estPrice = Number(normalizedOrder.stopPrice) > 0 ? Number(normalizedOrder.stopPrice) : effectiveCurrentPrice;
        const { totalUsd } = fillCostUsd(symbol, normalizedOrder as unknown as PendingOrder, estPrice);
        if (totalUsd > available) {
          toast.error('可用余额不足', {
            description: `需要 ${totalUsd.toFixed(2)} USDT，当前可用 ${available.toFixed(2)} USDT`,
          });
          return null;
        }
      }
      const activation = Number(normalizedOrder.stopPrice) > 0 ? Number(normalizedOrder.stopPrice) : 0;
      const trailingOrder: PendingOrder = {
        id: crypto.randomUUID(), side: normalizedOrder.side, type: 'TRAILING_STOP',
        price: 0, stopPrice: activation, quantity: normalizedOrder.quantity,
        leverage: normalizedOrder.leverage, marginMode: normalizedOrder.marginMode,
        settlementMode: normalizedOrder.settlementMode,
        settlementAsset: normalizedOrder.settlementAsset,
        contractSizeUsd: normalizedOrder.contractSizeUsd,
        contracts: normalizedOrder.contracts,
        callbackRate: cb,
        trailingExecType: 'MARKET',
        // 无激活价 = 挂出即激活；极值从首根 K 线开始积累
        trailingActivated: activation <= 0,
        peakPrice: undefined, troughPrice: undefined,
        status: 'PENDING', createdAt: now,
        tradingMode: tradingModeRef.current,
      };
      setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), trailingOrder] }));
      toast.info(activation > 0
        ? `跟踪委托已挂出 · 激活价 ${activation} · 回调 ${(cb * 100).toFixed(1)}%`
        : `跟踪委托已挂出 · 回调 ${(cb * 100).toFixed(1)}%`);
      return null;
    }

    if (normalizedOrder.type === 'TWAP') {
      const durationMs = (normalizedOrder.twapDuration || 60) * 60 * 1000;
      const intervalMs = (normalizedOrder.twapInterval || 5) * 60 * 1000;
      /**
       * TWAP 此前在这里直接 return,于是它**一生中从未被检查过**:
       * 挂出时跳过预检,每一片成交又各自开一个新仓位、各自扣钱。
       * 按全量估——切片是累加的,不是轮换的。
       */
      {
        const { totalUsd } = fillCostUsd(symbol, normalizedOrder as unknown as PendingOrder, effectiveCurrentPrice);
        if (totalUsd > available) {
          toast.error('可用余额不足', {
            description: `TWAP 全量需要 ${totalUsd.toFixed(2)} USDT，当前可用 ${available.toFixed(2)} USDT`,
          });
          return null;
        }
      }
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
    /**
     * 预检要用**这一单会成交的价**,不是「按下按钮那一刻的盘口」。
     *
     * 条件单的价在 stopPrice 上,而 price 恒为 0（面板给非限价档发 price: 0）,
     * 于是旧写法一路兜到市价:一张触发价在市价 1.5 倍上的**线性**买入止损,
     * 按 1/1.5 的钱放行、按全额扣款。币本位不受影响——那一支的
     * marginUsd = 名义 ÷ 杠杆、feeUsd = 名义 × 费率,price 在
     * coinMarginAmount 与 coinAmountToUsd 之间**精确约掉**,喂什么价都一样。
     *
     * isMaker 从 true 改成 false:这些单子成交时全都走 taker
     * （所有成交点都传 false）。按 maker 估、按 taker 收,差的那一半是白放行的,
     * 而这一项与价无关,币本位同样中招。
     */
    const estPrice = orderReferencePrice(normalizedOrder as unknown as PendingOrder, effectiveCurrentPrice).price;
    const { marginUsd, feeUsd, totalUsd: estMargin } = fillCostUsd(
      symbol, normalizedOrder as unknown as PendingOrder, estPrice,
    );
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
      ...attachedTpSl,
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

    // 手动平仓也按每笔成交拆条。这里是与 settlePositionClose 并行的**第二份**实现,
    // 只把记录这一段接过去,不做整体归并——那是另一件事(见下方 TODO 立项)。
    setTradeHistory(prev => [...prev, ...buildCloseRecords({
      symbol, pos, closeQty, fillPrice,
      closeTime: getEffectiveTime(symbol),
      exitMethod: method,
      closedRealAt: Date.now(),
      totals: {
        netPnl: pnlUsd - feeUsd,
        pnlCoin, feeUsd, feeCoin,
        slippageUsd, notionalUsd,
      },
    })]);

    const pctLabel = pct < 1 ? ` (${Math.round(pct * 100)}%)` : '';
    const netPnl = pnlUsd - feeUsd;
    toast.success(`市价平仓成功，已结算盈亏：${netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)} USDT`, {
      description: `${symbol} ${formatSettlementQuantity({ ...pos, quantity: closeQty, contracts: isCoinSettled(pos) ? closeQty : undefined }, symbol)}${pctLabel} @ ${formatPrice(fillPrice, symbol)}`,
    });
  }, [getEffectiveTime]);

  // ===== Place TP/SL conditional orders (reduce-only, linked to a specific position) =====
  const handlePlaceTpSl = useCallback((symbol: string, pos: Position, tp: number | null, sl: number | null, pct: number) => {
    const levels = { tp, sl, percentage: pct };
    // 持仓卡上改止盈止损，参照价是**此刻的标记价**：仓位已经在市场里了。
    // （随单下达那条路参照的是开仓价——见 applyAttachedTpSl。）
    const invalid = validateTpSlLevels(pos.side, levels, priceMapRef.current[symbol] || 0);
    if (invalid) { toast.error(invalid.message); return; }

    const now = getEffectiveTime(symbol);
    const newOrders = buildTpSlOrders({ symbol, position: pos, levels, now, newId: () => crypto.randomUUID() });
    if (newOrders.length === 0) { toast.error('平仓数量无效'); return; }

    setOrdersMap(prev => ({
      ...prev,
      [symbol]: replaceTpSlOrders(prev[symbol] || [], pos.id, newOrders),
    }));

    toast.success('止盈/止损委托已下达', {
      description: `TP: ${tp || '-'} / SL: ${sl || '-'} · ${Math.min(100, Math.max(1, pct))}% 仓位`,
    });
  }, [getEffectiveTime]);


  const executeReduceOnlyTrigger = useCallback((
    symbol: string,
    order: PendingOrder,
    triggerPrice: number,
    closeTime = getEffectiveTime(order.reduceSymbol || symbol),
  ): ReduceOnlyTriggerExecution => {
    const execution = planReduceOnlyTrigger({
      symbol,
      order,
      triggerPrice,
      closeTime,
      positions: positionsMapRef.current,
      orders: ordersMapRef.current,
    });

    if (!execution.ok) {
      const previousReason = reduceOnlyDeferredReasonRef.current.get(order.id);
      if (execution.reason === 'order_missing') {
        reduceOnlyDeferredReasonRef.current.delete(order.id);
      } else if (previousReason !== execution.reason) {
        reduceOnlyDeferredReasonRef.current.set(order.id, execution.reason);
        console.warn('[TP/SL Execute Deferred]', {
          orderId: order.id,
          linkedPositionId: order.linkedPositionId,
          reason: execution.reason,
        });
      }
      return execution;
    }

    reduceOnlyDeferredReasonRef.current.delete(order.id);
    setPositionsMap((prev) => ({ ...prev, [execution.targetSymbol]: execution.positions }));
    setOrdersMap((prev) => ({ ...prev, [execution.targetSymbol]: execution.orders }));
    setBalance((prev) => prev + Math.max(0, execution.returnedMargin));
    setTradeHistory((prev) => [...prev, ...execution.records]);
    setFilledOrders(prev => upsertOrderSnapshot(prev, execution.filledOrder));

    const kindLabel = order.reduceKind === 'TP' ? '止盈' : order.reduceKind === 'SL' ? '止损' : '条件';
    toast.success(`${kindLabel}已触发：${execution.targetSymbol} @ ${formatPrice(execution.fillPrice, execution.targetSymbol)}`, {
      description: `${execution.netPnl >= 0 ? '+' : ''}${execution.netPnl.toFixed(2)} USDT`,
    });
    return execution;
  }, [getEffectiveTime, setBalance, setFilledOrders, setOrdersMap, setPositionsMap, setTradeHistory]);

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
      setCancelledOrders(prev => upsertOrderSnapshot(prev, {
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
        }));
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
  /**
   * 调整逐仓保证金。**按仓位 id 定位，不按数组下标**。
   *
   * 下标是活靶子：仓位被移除时一律用 id 过滤（强平 :875、平仓 :1468、清标的数据），
   * 而这些都由行情时钟和后台轮询触发,不只是用户点击。模态框打开到点确认之间
   * 只要有一笔更靠前的仓位平掉,下标就整体前移——旧写法会把钱**追进另一笔仓位**;
   * 若目标恰好是最后一笔并被平掉,`arr[index]` 变 undefined,静默什么都不做,
   * 而模态框那边还照样弹"调整成功"。
   *
   * 一次写完整组:多笔各自 setPositionsMap 会产生 N 次持久化与云同步。
   */
  const handleAdjustMargin = useCallback((
    symbol: string,
    allocations: { positionId: string; deltaUsd: number }[],
  ) => {
    const items = allocations.filter(a => Number.isFinite(a.deltaUsd) && a.deltaUsd !== 0);
    if (items.length === 0) return;

    const positions = positionsMapRef.current[symbol] || [];
    const byId = new Map(positions.map(p => [p.id, p]));
    for (const { positionId } of items) {
      const p = byId.get(positionId);
      if (!p) { toast.error('仓位已不存在，保证金未调整'); return; }
      if (p.marginMode !== 'isolated') { toast.error('全仓模式不支持单仓位调整保证金'); return; }
    }

    const adding = items.reduce((sum, a) => sum + a.deltaUsd, 0) > 0;
    // 逐笔夹到各自的上限，再按夹完的总额动账——绝不让某一笔被减到初始保证金以下。
    const applied = new Map<string, number>();
    let net = 0;
    for (const { positionId, deltaUsd } of items) {
      const p = byId.get(positionId)!;
      let actual = deltaUsd;
      if (deltaUsd < 0) {
        const room = removableMarginUsd(symbol, p);
        actual = -Math.min(-deltaUsd, room);
      }
      if (Math.abs(actual) <= 1e-8) continue;
      applied.set(positionId, (applied.get(positionId) ?? 0) + actual);
      net += actual;
    }

    if (Math.abs(net) <= 1e-8) {
      toast.error(adding ? '可用余额不足' : '已达初始保证金下限，无法继续减少');
      return;
    }

    if (net > 0) {
      // 判定基准是钱包自由现金：余额已经把两种模式的保证金都扣掉了，
      // 再减一次全仓保证金就是同一笔钱扣两遍（见 fillAffordability 的说明）。
      const free = balanceRef.current;
      if (net > free + 1e-8) {
        toast.error('可用余额不足', {
          description: `需要 ${net.toFixed(2)} USDT，可用 ${free.toFixed(2)} USDT`,
        });
        return;
      }
    }

    setBalance(prev => prev - net);
    setPositionsMap(prev => {
      const arr = [...(prev[symbol] || [])];
      const price = priceMapRef.current[symbol] || 0;
      for (let i = 0; i < arr.length; i++) {
        const delta = applied.get(arr[i].id);
        if (delta == null) continue;
        const p = arr[i];
        const px = price > 0 ? price : p.entryPrice;
        const coinDelta = isCoinSettled(p) && px > 0 ? delta / px : 0;
        arr[i] = {
          ...p,
          isolatedMargin: Math.max(0, (p.isolatedMargin ?? p.margin) + delta),
          margin: Math.max(0, p.margin + delta),
          marginCoin: p.marginCoin == null ? undefined : Math.max(0, p.marginCoin + coinDelta),
        };
      }
      return { ...prev, [symbol]: arr };
    });
    toast.success('保证金调整成功', {
      description: `${net > 0 ? '追加' : '减少'} ${Math.abs(net).toFixed(2)} USDT`,
      position: 'top-center',
    });
  }, [setBalance, setPositionsMap]);

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

  /**
   * 账内划转。校验与结算都走 walletTransfer 里的纯逻辑，UI 只负责收集输入——
   * 这样「最大可划转」「是否超额」在按钮与提交两处永远是同一套规则。
   */
  const transferFunds = useCallback((from: WalletId, to: WalletId, amount: number): boolean => {
    const balances: WalletBalances = { futures: balance, spot: spotBalance, funding: fundingBalance };
    const check = validateTransfer(balances, { from, to, amount });
    if (!check.ok) {
      toast.error(check.message);
      return false;
    }
    const next = applyTransfer(balances, { from, to, amount: check.amount });
    setBalance(next.futures);
    setSpotBalance(next.spot);
    setFundingBalance(next.funding);
    setTransferHistory(prev => [
      {
        id: `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        from, to, amount: check.amount,
        // 与成交记录同一条时间轴，复盘时对得上
        timestamp: getEffectiveTime(),
        asset: 'USDT' as const,
      },
      ...prev,
    ].slice(0, 500));
    return true;
  }, [balance, spotBalance, fundingBalance, getEffectiveTime,
      setBalance, setSpotBalance, setFundingBalance, setTransferHistory]);

  const value: TradingState = {
    sim,
    activeSymbol, setActiveSymbol,
    interval, setInterval,
    positionsMap, setPositionsMap,
    ordersMap, setOrdersMap,
    filledOrders, setFilledOrders,
    priceMap, setPriceMap, markPriceAsOf, publishMatchRange,
    balance, setBalance,
    spotBalance, fundingBalance, transferHistory, transferFunds,
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
    handlePlaceOrder, handleClosePosition, handleCancelOrder, handlePlaceTpSl, applyAttachedTpSl, settleFillDebit, applySymbolLeverage, executeReduceOnlyTrigger,
    handleAdjustMargin, handleClearSymbolData,
    fundingRate: FUNDING_RATE,
    liquidationOpen, liquidationDetails, closeLiquidationModal,
    timeMode, setTimeMode,
    timeDirection: sim.direction, setTimeDirection,
    reverseCapTime, setReverseCapTime,
    tradingMode, setTradingMode,
    executionAsset, setExecutionAsset, recordExecutionTrade, recordCampaignCreated, reconcileCampaignRewards,
    recordPostTradeReviewCompleted, reconcilePostTradeReviewRewards,
    recordObservationLogged, settleCampaignMissingPenalties, reconcileReviewMissingPenalties,
    coinTimelines, setCoinTimelines,
    totalPositionCount,
    getEffectiveTime,
    getCoinState,
    getEffectiveBalance,
    getEffectiveAvailable,
  };

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}
