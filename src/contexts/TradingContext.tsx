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

import React, { createContext, useContext, useCallback, useEffect, useLayoutEffect, useRef, useMemo, useState } from 'react';
import { useTimeSimulator } from '@/hooks/useTimeSimulator';
import {
  applyTransfer,
  validateTransfer,
  type TransferRecord,
  type WalletBalances,
  type WalletId,
} from '@/lib/walletTransfer';
import { usePersistedState, loadPersistedSimState, saveSimState, clearSimState } from '@/hooks/usePersistedState';
import { getUserPrefix } from '@/lib/userStoragePrefix';
import { intervalToMs } from '@/hooks/useBinanceData';
import { useAuth } from '@/contexts/AuthContext';
import {
  evaluateCrossLiquidation,
  evaluateIsolatedLiquidation,
  evaluateIsolatedLiquidationOnCandle,
  isPriceFreshForLiquidation,
  isolatedLiquidationSettlement,
  positionMarginUsdAtMark,
  staleToleranceMs,
  type LiquidationCandle,
  type RiskFloorEntry,
  updateRiskFloors,
  nextExposure,
  priceObservedAfter,
  stopLossVersusLiquidation,
  type ExposureEntry,
} from '@/lib/liquidationGuards';
import { mergeLiquidationDetails, type LiquidationDetails } from '@/lib/liquidationNotice';
import { calcLiquidationPrice } from '@/types/trading';
import {
  LEGACY_HEDGE_RISK_MODEL,
  ORDER_LEGACY_HEDGE_STAMP,
  ORDER_RISK_STAMP,
  TIERED_RISK_MODEL,
  hasRiskProvenance,
  legacyHedgeRiskStamp,
  positionMaintenanceMarginUsd,
  positionRiskStamp,
  summarizeRiskModels,
} from '@/lib/positionRiskModel';
import { toast } from '@/lib/notificationCenter';
import type {
  AddSizingSnapshot,
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
  LIQUIDATION_FEE_RATE, FUNDING_RATE, FUNDING_HOURS, getTriggerOperator,
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
import { clearAddSizingPlan, consumeAddSizingPlan, peekAddSizingSnapshotForOrder, restoreAddSizingPlan } from '@/lib/addSizingPlan';
import { judgePlannedAddFill as judgePlannedAddFillPure } from '@/lib/addSizingFillGuard';
import { readHeldPosition } from '@/lib/addSizing';
import { getCoinMarginedContractSizeUsd } from '@/lib/coinMargined';
import {
  createReplayTimelineRegistry,
  currentReplayTimeline,
  endReplayTimeline as endReplayTimelineInRegistry,
  forkReplayTimeline as forkReplayTimelineInRegistry,
  isCoinTimelineClockActive,
  isImplicitReplayFork,
  isWithinDirectionFlips,
  normalizeReplayTimelineRegistry,
  pruneReplayTimelineRegistry,
  recordReplayTimelineStamp,
  replayTimelineScope,
  replayTimelineScopeSymbol,
  snapshotReplayCarried,
  REPLAY_STAMP_PERSIST_THROTTLE_MS,
  REPLAY_TIMELINES_STORAGE_KEY,
  type ReplayTimelineCause,
  type ReplayTimelineRegistry,
  type ReplayTimelineScope,
} from '@/lib/replayTimeline';
import { formatPrice, getPriceDecimals } from '@/lib/formatters';
import { buildTpSlOrders, keepValidTpSlLegs, replaceTpSlOrders, validateTpSlLevels } from '@/lib/tpSlOrders';
import { removableMarginUsd } from '@/lib/positionGroupRisk';
import { evaluateFillAffordability, fillCostUsd } from '@/lib/fillAffordability';
import { planLeverageChange, type LeverageChangePlan } from '@/lib/leverageRestatement';
import {
  DEFAULT_SYMBOL_LEVERAGE,
  checkOrderPositionLimit,
  checkPlacementPositionLimit,
  clampLeverageAcrossSettlements,
  clampSymbolLeverage,
  effectiveSymbolLeverage,
  limitSettlementOf,
  isTriggeredOpenOrder,
  newlyDoomedTriggerOrders,
  placementAftermath,
  placementCheckPrice,
  placementOrderValuation,
  placementUsesLegacyHedge,
  positionLimitDetail,
  triggerRiskMessage,
} from '@/lib/positionLimit';
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
  markPriceAsOf: (symbol: string, asOfSimTime: number, price?: number) => void;
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
  /**
   * 写入标的的杠杆（夹到合约上限）。settlementMode 指定按哪一种结算方式的分层夹值，
   * 缺省按下单面板当前的结算方式；'any' 夹到两种结算方式里较高的上限（偏好里的默认杠杆：
   * 杠杆按标的只存一份，读的时候再按各自的结算方式夹）。
   */
  setSymbolLeverage: (
    symbol: string,
    value: number | ((prev: number) => number),
    settlementMode?: SettlementMode | 'any',
  ) => void;
  getSymbolMarginMode: (symbol: string) => MarginMode;
  setSymbolMarginMode: (symbol: string, mode: MarginMode) => void;
  getSymbolSettlementMode: (symbol: string) => SettlementMode;
  setSymbolSettlementMode: (symbol: string, mode: SettlementMode) => void;
  activeSymbols: string[];
  handlePlaceOrder: (symbol: string, order: PlaceOrderParams) => { id: string } | null;
  handleClosePosition: (symbol: string, index: number, percentage?: number, method?: 'manual' | 'sl' | 'tp1' | 'tp2' | 'tp3' | 'liquidation') => void;
  handleCancelOrder: (symbol: string, orderId: string) => void;
  handlePlaceTpSl: (symbol: string, pos: Position, tp: number | null, sl: number | null, pct: number) => void;
  /**
   * 调整标的杠杆：持仓、挂单、余额一起重述；被拒绝时返回原因，不做任何写入。
   * settlementMode 是**打开对话框的那一方**用的结算方式（持仓卡传仓位的，下单面板传面板的），
   * 夹值、判定、写回都按它——对话框与引擎因此读同一张分层。缺省按下单面板当前的结算方式。
   */
  applySymbolLeverage: (symbol: string, nextLeverage: number, settlementMode?: SettlementMode) => LeverageChangePlan;
  /**
   * 成交时扣款；付不起就撤单留痕并返回 false。
   * 必须严格排在减仓分支**之后**——止盈止损是**退还**保证金的，绝不能被这道闸门拦住。
   * 传 trigger 表示这一笔要按这一刻的敞口再判一次币安分层上限（触发后才下单的开仓单：条件 / 跟踪委托、
   * TWAP 的一片；以及只靠对冲豁免挂出的限价单成交时），超限同样撤单留痕并返回 false。
   * 只判本次更新之后下的委托（带分层戳或对冲豁免标记）；更新前挂出的委托是按旧规则放行的，触发时不再判。
   * 判过的这一笔，开出的仓位按判定结果定来源（trigger.position）：正常放行 → 分层，只靠豁免 → 豁免标记。
   */
  settleFillDebit: (
    symbol: string,
    order: PendingOrder,
    marginUsd: number,
    feeUsd: number,
    cancelledAt: number,
    trigger?: SettleFillTrigger,
  ) => boolean;
  /** 挂单成交时兑现它随身带着的止盈止损（勾选框下达的那一对）。 */
  applyAttachedTpSl: (symbol: string, position: Position, order: PendingOrder) => void;
  /**
   * 合并成交之后的收尾，**每一个调用 mergeFilledPosition 的地方都必须紧接着调它**。
   * 曾经 6 个合并点只有 2 个调了：另外 4 条路径（条件单触发、限价撮合、TWAP、后台成交）
   * 合并后不改指减仓单，止损于是挂在一个已经不存在的仓位 id 上——永不触发，且无声。
   */
  applyMergeSideEffects: (symbol: string, merged: PositionMergeResult) => void;
  /**
   * 按计算器计划下的加仓**吃单成交**之后按实际成交价复判 Plan B，超限进消息中心（只说不拦）。
   * 市价 / 最优价在 handlePlaceOrder 里自己调；条件委托触发（Index）与后台撮合（useBackgroundPrices）
   * 在建仓之后、合并之前调它——参考价传触发价，heldBefore 传合并前的持仓。
   * 没有计划、方向不同、成交前没有同向仓位时立刻返回。
   */
  judgePlannedAddFill: (symbol: string, heldBefore: Position[], position: Position, referencePrice: number, snapshot?: AddSizingSnapshot | null) => void;
  /**
   * 逐根 K 线判定逐仓强平（正放）。由 Index 的撮合循环在每根收线或成形中的 K 线上、
   * 紧跟止盈止损撮合之后调用——与成交共用同一个时钟、同一根 K 线、同一个区间。
   */
  liquidateIsolatedOnCandle: (symbol: string, candle: LiquidationCandle, phase?: 'beforeMatching' | 'afterMatching') => void;
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
  coinTimelines: CoinTimelinesMap;
  setCoinTimelines: (v: CoinTimelinesMap | ((prev: CoinTimelinesMap) => CoinTimelinesMap)) => void;
  totalPositionCount: number;
  getEffectiveTime: (symbol?: string) => number;
  getCoinState: (symbol: string) => CoinTimelineState | null;
  /**
   * 此刻这个标的所在的回放时间线 id（lib/replayTimeline）。同步读 ref、函数身份稳定，
   * setState 回调与撮合循环里都能调；绝不读落后的 React state。钟没在跑 → null。
   * 钟在跑却还没有时间线（上线前就开着的会话）时，当场补一个 bootstrap 根。
   */
  getTimelineId: (symbol?: string) => string | null;
  /** 写入前取章：同 getTimelineId，外加「时钟逆着播放方向明显回落」的兜底分叉，并记下这次盖章的时钟。 */
  stampClock: (symbol?: string) => string | null;
  /**
   * 显式分叉：开始、信号跳转、翻转方向。**必须在改钟之前调**——要看「分叉之前这只钟在不在跑」
   * 决定新时间线挂在当前那条下面，还是另起一个根。同步模式分全局那只钟，隔离模式只分这个币的。
   */
  forkReplayTimeline: (
    symbol: string,
    cause: Exclude<ReplayTimelineCause, 'bootstrap' | 'implicit'>,
    forkSimTime: number,
    direction?: 1 | -1,
  ) => string;
  /** 结束时间线。**必须排在收尾的平仓 / 撤单之后**——那几笔还属于旧时间线，要盖旧的章。 */
  endReplayTimeline: (scope: ReplayTimelineScope | 'all') => void;
  /** Get the global balance (always the single pool) */
  getEffectiveBalance: (symbol: string) => number;
  /** Get available balance (global balance minus all cross margins) */
  getEffectiveAvailable: (symbol: string) => number;
}

/** 触发后才下单的开仓单在成交闸门上的附加信息（见 settleFillDebit）。 */
export interface SettleFillTrigger {
  /** 触发 / 成交价：分层判定按这一刻的价给持仓估值、把这一单折成档位单位。 */
  price: number;
  /**
   * 同一批里已经成交、但还没从挂单列表移走的单（含这一单自己）——它们的仓位已经记进持仓，
   * 再按挂单算一遍就重复了。
   */
  settledOrderIds?: readonly string[];
  /**
   * 这一次真正成交的那一部分（TWAP 的一片）；缺省是整张委托。分层判定按它估值，
   * 撤单留痕仍记整张委托。
   */
  fill?: PendingOrder;
  /**
   * 同一批里已经改过、挂单列表还没写回的委托（同一轮里先切过一片的别的 TWAP）：按这里的版本算，
   * 否则它刚成交的那一片会按持仓与挂单各算一遍（见 positionLimit.twapSliceTrigger）。
   */
  orderOverrides?: readonly PendingOrder[];
  /**
   * 这一笔成交开出的仓位（调用方刚用 executeSettlementFill 造出、还没并进持仓）。闸门按这一刻的判定就地改它的来源：
   * 只靠「对冲更新前的仓位」那条豁免放行 → 'legacy-hedge-v1'（旧模型：豁免单的名义可能远超分层允许的大小，
   * 套分层维持保证金会一成交就爆）；正常过了分层 → 分层戳（挂出时靠豁免、成交时已经放得下的单也一样）。
   */
  position?: Position;
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
  /**
   * 加仓计算器的计划。调用方一般不传：handlePlaceOrder 自己从 addSizingPlan 取当前计划
   * （同标的、同方向、可钉的类型、仍在保鲜期），钉到委托 / 成交上。传了就以传的为准。
   */
  addSizingSnapshot?: AddSizingSnapshot | null;
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
 * handlePlaceOrder 的「下出去了，但没有可回填到决策记录的 id」（分段订单 / 跟踪委托 / TWAP）。
 * 此前这三种成功时返回 null，与「被拒、什么都没下」分不开，决策记录弹窗于是对被拒的单也报
 * 「已提交订单」。null 现在只表示被拒；id 为空串，`result?.id` 判真的回填逻辑照旧跳过（行为不变）。
 */
const placedWithoutTradeRef = (): { id: string } => ({ id: '' });

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

/**
 * 撤掉一张带着加仓计划的挂单（手动撤单、成交时保证金不足被撤）：把计划放回 addSizingPlan，
 * 紧接着追价的同向单还带得上。但计划必须仍属于**当前这一场、当前这条仓位**才放回：
 *   · 这个标的仍持有同方向仓位——计划是给那条仓位加仓用的。停止回放 / 合并时间轴先平掉全部仓位、再撤全部挂单：
 *     此时放回去的计划会被下一场重新打开的计算器种回 S₁ / G，还会钉到下一场的首笔开仓上；
 *   · 这条仓位不晚于计划开出（与计算器重新打开时 planSeedOnOpen 同一条规则）：平掉又重开之后，
 *     上一个持仓周期的计划不是这条仓位的。每笔成交都带真实开仓时刻才判得了，缺一笔就不判；
 *   · 撤单与挂单在同一场回放里：撤单盖的时间线就是挂单那条，或只隔着「翻转方向」分出来的时间线
 *     （正放 ↔ 倒放不清计划，仓位与挂单原样带过去）。跳到信号时刻会把旧挂单带进新的一场、钟被拨回会补一条兜底时间线，
 *     那张单上钉的是上一场的计划。任一边没有章（钟没在跑）就不判，由 addSizingPlan 自己的分场水位兜底。
 * positions 读 positionsMapRef（写入包装同步推进，刚平掉的仓位这里已经不在）；timelineId 是这次撤单盖的章，
 * timelines 读 timelineRegistryRef（盖章时刚补出来的兜底时间线也在里面）。
 */
function restoreCancelledAddPlan(
  symbol: string,
  order: PendingOrder,
  positions: Position[] | undefined,
  timelineId: string | null,
  timelines: ReplayTimelineRegistry,
): void {
  const snapshot = order.addSizingSnapshot;
  if (!snapshot) return;
  const held = (positions ?? []).filter(p => p.side === order.side && isPositionOpen(p));
  if (held.length === 0) return;
  const openedRealAt = readHeldPosition(symbol, held, order.side, getCoinMarginedContractSizeUsd(symbol))?.earliestOpenedRealAt ?? null;
  if (openedRealAt != null && openedRealAt > snapshot.at) return;
  if (order.createdTimelineId && timelineId && !isWithinDirectionFlips(timelines, order.createdTimelineId, timelineId)) return;
  restoreAddSizingPlan(symbol, snapshot);
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
  const setPositionsMap = useCallback((value: PositionsMap | ((prev: PositionsMap) => PositionsMap)) => {
    const next = typeof value === 'function' ? value(positionsMapRef.current) : value;
    positionsMapRef.current = next;
    setPositionsMapState(next);
  }, [setPositionsMapState]);
  /**
   * ref 由上面的写入包装同步推进；这里只在 state **真的换了**时追平（云端/跨页水合等不走包装的写入）。
   * 不能在渲染期直接赋值：React 18 会先渲染优先级更高的更新（比如一次点击），那一次渲染看到的
   * positionsMap 还不含 RAF 循环里刚写入的强平删除——渲染期赋值会把 ref 退回旧值，
   * 刚强平掉的仓位复活，下一帧再被强平一次、多写一条强平记录。
   */
  useLayoutEffect(() => { positionsMapRef.current = positionsMap; }, [positionsMap]);

  const [ordersMap, setOrdersMapState] = usePersistedState<OrdersMap>('orders_map', {});
  const ordersMapRef = useRef(ordersMap);
  // 同 positionsMapRef：写入包装同步推进，state 真换了才追平，不在渲染期赋值（否则撤掉的单会复活）。
  useLayoutEffect(() => { ordersMapRef.current = ordersMap; }, [ordersMap]);
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
  /** 与时间戳同一次登记的那个价：戳与价必须属于同一次请求（见强平兜底判定）。 */
  const pricePairedWithAsOfRef = useRef<Record<string, number>>({});
  const markPriceAsOf = useCallback((symbol: string, asOfSimTime: number, price?: number) => {
    if (!symbol || !Number.isFinite(asOfSimTime) || asOfSimTime <= 0) return;
    priceAsOfRef.current[symbol] = asOfSimTime;
    if (price != null && Number.isFinite(price) && price > 0) pricePairedWithAsOfRef.current[symbol] = price;
    else delete pricePairedWithAsOfRef.current[symbol];
  }, []);
  const [balance, setBalanceState] = usePersistedState('balance', initialCapital);
  const balanceRef = useRef(balance);
  // 同 positionsMapRef：写入包装同步推进，state 真换了才追平，不在渲染期赋值（否则一次记账会被旧值覆盖）。
  useLayoutEffect(() => { balanceRef.current = balance; }, [balance]);
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
  // 成交路径要读本场落袋 G（加仓成交复判）；下单回调靠 ref 拿最新值，与 positionsMapRef 同一理由。
  const tradeHistoryRef = useRef(tradeHistory);
  useLayoutEffect(() => { tradeHistoryRef.current = tradeHistory; }, [tradeHistory]);
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
  /**
   * 结算方式**只活在本次会话里**，刻意不走 usePersistedState。
   * 用户的要求：面板默认币本位；开仓前可以切到 U 本位，但页面一刷新、重新打开，
   * 一律回到币本位——无论本地或云端之前存过什么。仓位 / 挂单 / 成交各自带着自己的
   * settlementMode（那是另一张合约，RUNEUSD 与 RUNEUSDT），不受面板回落影响。
   */
  const [settlementModeMap, setSettlementModeMap] = useState<Record<string, SettlementMode>>({});
  // 旧版本把这张表落过盘：进来先把残留的本地条目（含影子时间戳）清掉，
  // 免得存量回填把它再推上云；同步层已把该键列入排除表，云端旧行水化时也会被跳过。
  useEffect(() => {
    try {
      const staleKey = `${getUserPrefix()}symbol_settlement_mode`;
      localStorage.removeItem(staleKey);
      localStorage.removeItem(`${staleKey}__syncts`);
    } catch {
      /* 存储不可用时无事可清 */
    }
  }, []);

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

  // 建战役按「自然日 × 标的」+300；同日同标的只计一次。
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

  // Get effective simulation time for a given symbol
  const getEffectiveTime = useCallback((symbol?: string): number => {
    const sym = symbol || activeSymbol;
    if (timeMode === 'synced') return sim.currentSimulatedTime;
    const ct = coinTimelines[sym];
    return ct?.time ?? sim.currentSimulatedTime;
  }, [timeMode, coinTimelines, activeSymbol, sim.currentSimulatedTime]);

  /**
   * 此刻的模拟时间，按撮合时钟（与 Index 的 RAF 同一个公式）现算。
   * getEffectiveTime 读的是 React state，每 250 毫秒真实时间才刷新一次，3600 倍下落后可达 15 个模拟分钟。
   * 手动开仓若取它，记录里的开仓时刻会早于真实成交，强平护栏据此放行成交之前的价；
   * 手动平仓若取它，平仓时刻会早于撮合时钟记下的开仓时刻。成交时刻一律取这个。
   * 输入放在 ref 里，函数身份稳定，调用方不必把它加进依赖。
   */
  const liveClockInputsRef = useRef({
    timeMode, coinTimelines, activeSymbol, direction: sim.direction, getSimTime: sim.getSimTime, simStatus: sim.status,
  });
  liveClockInputsRef.current = {
    timeMode, coinTimelines, activeSymbol, direction: sim.direction, getSimTime: sim.getSimTime, simStatus: sim.status,
  };
  const getLiveSimTime = useCallback((symbol?: string): number => {
    const { timeMode: mode, coinTimelines: cts, activeSymbol: active, direction, getSimTime } = liveClockInputsRef.current;
    if (mode === 'synced') return getSimTime();
    const ct = cts[symbol || active];
    if (ct && ct.status === 'playing' && ct.realStartTime && ct.historicalAnchorTime != null) {
      return ct.historicalAnchorTime + (Date.now() - ct.realStartTime) * ct.speed * (direction === -1 ? -1 : 1);
    }
    return ct?.time ?? getSimTime();
  }, []);

  // ===== 回放时间线（lib/replayTimeline）=====
  /**
   * 登记表以 ref 为准：盖章发生在撮合循环与 setState 的回调里，读 React state 会拿到落后的版本，
   * 同一帧里刚分叉出来的时间线看不见。落盘推迟到微任务里合并成一次——
   * 在另一个 setState 的回调里同步调 setState 是 React 不允许的副作用。
   */
  const [persistedTimelines, setPersistedTimelines] = usePersistedState<ReplayTimelineRegistry>(
    REPLAY_TIMELINES_STORAGE_KEY,
    createReplayTimelineRegistry(),
  );
  // 读回来先修剪（见 pruneReplayTimelineRegistry）：老节点在这里就丢，不等下一次分叉。
  const [initialTimelines] = useState(() =>
    pruneReplayTimelineRegistry(normalizeReplayTimelineRegistry(persistedTimelines), { now: Date.now() }));
  const timelineRegistryRef = useRef<ReplayTimelineRegistry>(initialTimelines);
  const timelinePersistQueuedRef = useRef(false);
  const timelineStampPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 本次页面加载里盖过章、或刚分叉出来的时间线。第一次盖章的兜底判据要给恢复会话留余量。 */
  const timelinesSeenThisLoadRef = useRef(new Set<string>());
  const persistTimelineRegistry = useCallback(() => {
    if (timelineStampPersistTimerRef.current != null) {
      clearTimeout(timelineStampPersistTimerRef.current);
      timelineStampPersistTimerRef.current = null;
    }
    setPersistedTimelines(timelineRegistryRef.current);
  }, [setPersistedTimelines]);
  /**
   * 分叉 / 结束：微任务里立刻落盘。盖章（stamp: true）只改最近一次盖章的时钟，攒着，
   * 最多每 REPLAY_STAMP_PERSIST_THROTTLE_MS 落一次——否则每一笔成交、撤单、资金费都把整张登记表
   * 序列化一遍、再推一次云端。ref 始终是最新的，落盘的快慢不影响盖章本身。
   */
  const commitTimelineRegistry = useCallback((next: ReplayTimelineRegistry, options: { stamp?: boolean } = {}) => {
    if (next === timelineRegistryRef.current) return;
    timelineRegistryRef.current = next;
    if (timelinePersistQueuedRef.current) return;
    if (options.stamp) {
      if (timelineStampPersistTimerRef.current != null) return;
      timelineStampPersistTimerRef.current = setTimeout(() => {
        timelineStampPersistTimerRef.current = null;
        persistTimelineRegistry();
      }, REPLAY_STAMP_PERSIST_THROTTLE_MS);
      return;
    }
    timelinePersistQueuedRef.current = true;
    void Promise.resolve().then(() => {
      timelinePersistQueuedRef.current = false;
      persistTimelineRegistry();
    });
  }, [persistTimelineRegistry]);

  /** 这个标的此刻用的是哪只钟：同步模式全局一只，隔离模式一个币一只。 */
  const timelineScopeOf = useCallback((symbol?: string): ReplayTimelineScope => {
    const { timeMode: mode, activeSymbol: active } = liveClockInputsRef.current;
    return replayTimelineScope(mode, symbol || active);
  }, []);

  /** 这只钟在不在跑（播放或暂停）。不属于当前模式的钟一律算停着。 */
  const isTimelineScopeClockActive = useCallback((scope: ReplayTimelineScope): boolean => {
    const { timeMode: mode, coinTimelines: cts, simStatus } = liveClockInputsRef.current;
    const symbol = replayTimelineScopeSymbol(scope);
    if (symbol == null) return mode === 'synced' && simStatus !== 'stopped';
    return mode === 'isolated' && isCoinTimelineClockActive(cts[symbol]);
  }, []);

  const mintReplayTimeline = useCallback((
    scope: ReplayTimelineScope,
    cause: ReplayTimelineCause,
    forkSimTime: number,
    direction: 1 | -1,
    continuing: boolean,
  ): string => {
    const symbol = replayTimelineScopeSymbol(scope);
    const id = crypto.randomUUID();
    const realAt = Date.now();
    const forked = forkReplayTimelineInRegistry(timelineRegistryRef.current, {
      id, scope, cause, direction, forkSimTime, realAt, continuing,
      // 分叉那一刻已经开着的仓位与挂着的委托「活进」了新时间线——读 ref，同一帧里刚成交的也算。
      carried: snapshotReplayCarried(positionsMapRef.current, ordersMapRef.current, symbol == null ? null : [symbol]),
      // 显式分叉都在改钟之前调：此刻现算的撮合时钟就是父时间线走到的地方，给它盖上这一章。
      // 兜底分叉时钟已经拨过去了，算出来的是新时刻，不能记到父线头上。
      parentSimTime: continuing && cause !== 'implicit' ? getLiveSimTime(symbol ?? undefined) : null,
    });
    // 每次分叉顺手修剪：登记表只增不减，这里是唯一让它长的地方。
    commitTimelineRegistry(pruneReplayTimelineRegistry(forked, { now: realAt }));
    timelinesSeenThisLoadRef.current.add(id);
    return id;
  }, [commitTimelineRegistry, getLiveSimTime]);

  const getTimelineId = useCallback((symbol?: string): string | null => {
    const scope = timelineScopeOf(symbol);
    if (!isTimelineScopeClockActive(scope)) return null;
    const node = currentReplayTimeline(timelineRegistryRef.current, scope);
    if (node) return node.id;
    // 新代码第一次看见这只钟在跑、却没有时间线：补一个根，记下此刻已经开着的仓位与挂单。
    const direction = liveClockInputsRef.current.direction === -1 ? -1 : 1;
    return mintReplayTimeline(scope, 'bootstrap', getLiveSimTime(symbol), direction, false);
  }, [timelineScopeOf, isTimelineScopeClockActive, mintReplayTimeline, getLiveSimTime]);

  const stampClock = useCallback((symbol?: string): string | null => {
    const id = getTimelineId(symbol);
    if (!id) return null;
    const node = timelineRegistryRef.current.nodes[id];
    // 比较用撮合时钟现算，不用记录自己的模拟时刻：成交点里有读落后界面时钟的（最多落后 15 个模拟分钟），
    // 拿它比会把同一次回放里的正常写入误判成倒回。
    const simTime = getLiveSimTime(symbol);
    const realAt = Date.now();
    const seen = timelinesSeenThisLoadRef.current;
    if (node && isImplicitReplayFork({
      direction: node.direction,
      lastSimTime: node.lastSimTime,
      lastRealAt: node.lastRealAt,
      simTime,
      realAt,
      restored: !seen.has(id),
    })) {
      console.warn('[replayTimeline] 时钟逆着播放方向回落却没有显式分叉，补一条 implicit 时间线', {
        scope: node.scope, from: node.lastSimTime, to: simTime,
      });
      const direction = liveClockInputsRef.current.direction === -1 ? -1 : 1;
      return mintReplayTimeline(node.scope, 'implicit', simTime, direction, true);
    }
    seen.add(id);
    commitTimelineRegistry(recordReplayTimelineStamp(timelineRegistryRef.current, id, simTime, realAt), { stamp: true });
    return id;
  }, [getTimelineId, getLiveSimTime, mintReplayTimeline, commitTimelineRegistry]);

  const forkReplayTimeline = useCallback((
    symbol: string,
    cause: Exclude<ReplayTimelineCause, 'bootstrap' | 'implicit'>,
    forkSimTime: number,
    direction?: 1 | -1,
  ): string => {
    const scope = timelineScopeOf(symbol);
    const dir = (direction ?? liveClockInputsRef.current.direction) === -1 ? -1 : 1;
    return mintReplayTimeline(scope, cause, forkSimTime, dir, isTimelineScopeClockActive(scope));
  }, [timelineScopeOf, isTimelineScopeClockActive, mintReplayTimeline]);

  const endReplayTimeline = useCallback((target: ReplayTimelineScope | 'all') => {
    const realAt = Date.now();
    let next = timelineRegistryRef.current;
    const scopes = target === 'all' ? Object.keys(next.current) as ReplayTimelineScope[] : [target];
    for (const scope of scopes) {
      if (!currentReplayTimeline(next, scope)) continue;
      // 钟还在跑就记此刻的撮合时钟；已经停了（或不属于当前模式）退回最近一次盖章的时刻。
      const simTime = isTimelineScopeClockActive(scope)
        ? getLiveSimTime(replayTimelineScopeSymbol(scope) ?? undefined)
        : null;
      next = endReplayTimelineInRegistry(next, scope, { simTime, realAt });
    }
    commitTimelineRegistry(next);
  }, [isTimelineScopeClockActive, getLiveSimTime, commitTimelineRegistry]);

  /**
   * 新代码第一次看见在跑的钟就补 bootstrap 根——不等第一笔写入。
   * 「上线之前就挂着的委托」要靠这一刻的快照认出来，晚一步快照里就混进了之后的东西。
   * 显式分叉（开始 / 跳转）都在改钟之前同步完成，这里看到的必然已经有时间线，不会重复补。
   */
  const activeCoinClocksKey = useMemo(
    () => Object.entries(coinTimelines)
      .filter(([, ct]) => isCoinTimelineClockActive(ct))
      .map(([sym]) => sym)
      .sort()
      .join('|'),
    [coinTimelines],
  );
  useEffect(() => {
    if (timeMode === 'synced') {
      if (sim.status !== 'stopped') getTimelineId();
      return;
    }
    for (const sym of activeCoinClocksKey ? activeCoinClocksKey.split('|') : []) getTimelineId(sym);
  }, [timeMode, sim.status, activeCoinClocksKey, getTimelineId]);

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

    /**
     * 翻转方向 = 分出新时间线。倒放里照样撮合、照样下单（Index 的倒放推进逐根调撮合），
     * 同一段行情被反着再走一遍，与倒回去重打是同一类事。每只在跑的钟各分一次，停着的钟不分；
     * 分叉时刻与下面冻结 / 对齐后的时刻同一个算式。先分叉再改钟：分叉要看翻转之前钟在不在跑。
     */
    const { timeMode: modeNow, coinTimelines: clocksNow, activeSymbol: activeNow } = liveClockInputsRef.current;
    if (modeNow === 'isolated') {
      for (const [sym, ct] of Object.entries(clocksNow)) {
        if (!isCoinTimelineClockActive(ct)) continue;
        const live = ct.status === 'playing' && ct.realStartTime && ct.historicalAnchorTime != null
          ? ct.historicalAnchorTime + (now - ct.realStartTime) * ct.speed * prevDirection
          : ct.time;
        forkReplayTimeline(sym, 'direction', direction === -1 ? snap(live) : live, direction);
      }
    } else if (sim.status !== 'stopped') {
      const live = sim.status === 'playing' ? sim.getSimTime() : sim.currentTimeRef.current;
      forkReplayTimeline(activeNow, 'direction', direction === -1 ? snap(live) : live, direction);
    }

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
  }, [sim, interval, setCoinTimelines, setReverseCapTime, forkReplayTimeline]);

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
  /** 弹窗是否还开着——同步可读。开着时新的强平并入同一个弹窗，而不是把前一笔覆盖掉。 */
  const liquidationOpenRef = useRef(false);
  const closeLiquidationModal = useCallback(() => {
    liquidationOpenRef.current = false;
    setLiquidationOpen(false);
  }, []);
  const openLiquidationModal = useCallback((details: LiquidationDetails) => {
    const merge = liquidationOpenRef.current;
    liquidationOpenRef.current = true;
    setLiquidationDetails(prev => (merge && prev ? mergeLiquidationDetails(prev, details) : details));
    setLiquidationOpen(true);
  }, []);

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

  /**
   * 读出来的杠杆一律夹到这个合约（当前结算方式）的最高杠杆：旧版本的滑块到 125x，
   * 而币安按合约分层（KAITOUSDT 75x、不少合约只到 10x）。保存值不改写，
   * 下单面板会就此提示一次（leverageClampNotice）。默认 35x 同样要夹。
   */
  const getSymbolLeverage = useCallback((symbol: string) => {
    const settlement = settlementModeMap[symbol] ?? DEFAULT_SETTLEMENT_MODE;
    return effectiveSymbolLeverage(leverageMap[symbol], symbol, settlement);
  }, [leverageMap, settlementModeMap]);

  const setSymbolLeverage = useCallback((
    symbol: string,
    value: number | ((prev: number) => number),
    settlementMode?: SettlementMode | 'any',
  ) => {
    const anySettlement = settlementMode === 'any';
    const settlement = (anySettlement ? undefined : settlementMode) ?? settlementModeMap[symbol] ?? DEFAULT_SETTLEMENT_MODE;
    const clampWrite = (v: number) => (anySettlement
      ? clampLeverageAcrossSettlements(symbol, Math.floor(v))
      : clampSymbolLeverage(symbol, settlement, Math.floor(v)));
    setLeverageMap(prev => {
      const current = anySettlement
        ? clampLeverageAcrossSettlements(symbol, prev[symbol] ?? DEFAULT_SYMBOL_LEVERAGE)
        : effectiveSymbolLeverage(prev[symbol], symbol, settlement);
      const nextValue = typeof value === 'function' ? value(current) : value;
      return {
        ...prev,
        [symbol]: clampWrite(nextValue),
      };
    });
  }, [setLeverageMap, settlementModeMap]);

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
          // 资金费记录也带上时间线，但它不是归属锚点；各标的取自己那只钟。
          closedTimelineId: stampClock(sym),
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

  /**
   * 逐仓强平的唯一落账出口：逐根 K 线与界面刷新两条判定路径都走这里。
   *
   * · 记账按破产价口径：亏掉的恰好是隔离保证金（isolatedLiquidationSettlement）。
   *   钱包在逐仓强平时一分不动（保证金开仓时已扣），记录也必须落在同一个数上。
   * · 时间取判定所用价格的时刻，绝不取落后的界面时钟——那会让平仓时间早于开仓。
   * · 挂在这些仓位上的止盈止损一并撤掉：仓位已不存在，它们永远不会触发。
   * · 逐仓爆仓同样弹独立窗口：普通提示默认只进「历史消息」，爆仓不能只剩一个角标。
   */
  const settleIsolatedLiquidations = useCallback((
    items: { symbol: string; position: Position; exitPrice: number; closeTime: number }[],
  ) => {
    if (items.length === 0) return;
    const records: TradeRecord[] = [];
    const idsBySymbol = new Map<string, Set<string>>();
    let lost = 0;
    for (const { symbol: sym, position: pos, exitPrice, closeTime } of items) {
      const totals = isolatedLiquidationSettlement({ symbol: sym, position: pos, exitPrice });
      records.push(...buildCloseRecords({
        symbol: sym, pos,
        closeQty: getPositionUnits(pos),
        fillPrice: exitPrice,
        closeTime,
        exitMethod: 'liquidation',
        closedRealAt: Date.now(),
        // 强平可能落在后台标的上：取这条记录自己标的的钟。
        closedTimelineId: stampClock(sym),
        totals,
      }).map(r => ({ ...r, action: 'LIQUIDATION' as const, liquidationSettlement: 'bankruptcy' as const })));
      const marginLost = Math.max(0, Number(pos.isolatedMargin) || 0);
      lost += marginLost;
      const ids = idsBySymbol.get(sym) ?? new Set<string>();
      ids.add(pos.id);
      idsBySymbol.set(sym, ids);
      toast.error(`🚨 逐仓爆仓: ${sym} ${pos.side === 'LONG' ? '多' : '空'} ${formatSettlementQuantity(pos, sym)}`, {
        description: `保证金 ${marginLost.toFixed(2)} USDT 已清零`,
        duration: 8000,
      });
    }
    setTradeHistory(prev => [...prev, ...records]);
    // 按 id 删，不按下标（下标与 ref 不同源，错位会误删健康仓位或重复强平）。
    setPositionsMap(prev => {
      const next = { ...prev };
      for (const [sym, ids] of idsBySymbol) next[sym] = (prev[sym] || []).filter(p => !ids.has(p.id));
      return next;
    });
    setOrdersMap(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [sym, ids] of idsBySymbol) {
        const list = prev[sym] || [];
        const kept = list.filter(o => !(o.reduceOnly && o.linkedPositionId && ids.has(o.linkedPositionId)));
        if (kept.length !== list.length) { next[sym] = kept; changed = true; }
      }
      return changed ? next : prev;
    });
    openLiquidationModal({
      lostAmount: lost, liquidatedPositions: items.length, scope: 'isolated',
      maintenance: summarizeRiskModels(items.map(i => i.position)),
    });
  }, [setTradeHistory, setPositionsMap, setOrdersMap, openLiquidationModal, stampClock]);

  /** 逐根判定：每个标的上一次判定看到的最后时刻，与每副仓位构成的风险下限（见 updateRiskFloors）。 */
  const candleLiqLastEndRef = useRef(new Map<string, number>());
  const candleLiqFloorsRef = useRef(new Map<string, Map<string, RiskFloorEntry>>());
  const liquidateIsolatedOnCandle = useCallback((
    symbol: string,
    candle: LiquidationCandle,
    /**
     * 撮合之前只处理「挂着止损、但止损都在强平价之外」的仓位——价格到不了止损就先爆了；
     * 其余仓位在撮合之后判（止损在强平价之内，先被触及）。
     */
    phase: 'beforeMatching' | 'afterMatching' = 'afterMatching',
  ) => {
    const lastSeenEnd = candleLiqLastEndRef.current.get(symbol);
    candleLiqLastEndRef.current.set(symbol, candle.endTime);
    // 读 ref：同一帧里止盈止损刚平掉的仓位此刻已从 ref 移除，不会再被强平一次。
    const positions = (positionsMapRef.current[symbol] || [])
      .filter(p => p.marginMode === 'isolated' && isPositionOpen(p));
    // 没有仓位也要走一遍：「上一次看到哪」必须每次都记，下限才可信。
    const floors = updateRiskFloors(
      candleLiqFloorsRef.current.get(symbol) ?? new Map(), positions, lastSeenEnd, candle.endTime,
      staleToleranceMs(sim.speed),
    );
    candleLiqFloorsRef.current.set(symbol, floors);
    if (positions.length === 0) return;
    const items: { symbol: string; position: Position; exitPrice: number; closeTime: number }[] = [];
    for (const pos of positions) {
      if (phase === 'beforeMatching'
        && stopLossVersusLiquidation(pos, ordersMapRef.current[symbol] || []) !== 'liquidation_first') continue;
      const decision = evaluateIsolatedLiquidationOnCandle({
        symbol, position: pos, candle, riskSince: floors.get(pos.id)?.floor,
      });
      if (!decision.liquidate) continue;
      items.push({ symbol, position: pos, exitPrice: decision.exitPrice, closeTime: candle.endTime });
    }
    settleIsolatedLiquidations(items);
  }, [settleIsolatedLiquidations, sim.speed]);

  // ===== LIQUIDATION ENGINE (Cross + Isolated) =====
  const liquidationCheckRef = useRef(false);
  const exposureRef = useRef(new Map<string, ExposureEntry>());
  useEffect(() => {
    if (!sim.isRunning || liquidationCheckRef.current) return;

    // --- ISOLATED margin-mode liquidation（兜底路径）---
    // 正放时当前标的由 Index 的撮合循环逐根 K 线判定（liquidateIsolatedOnCandle）；
    // 这里兜住其余情形：后台标的、倒放。读 positionsMapRef 而不是闭包里的 positionsMap——
    // 逐根判定刚打掉的仓位此刻已从 ref 移除，闭包里那份还在，读它会再强平一次。
    const direction: 1 | -1 = sim.direction === -1 ? -1 : 1;
    const tolerance = staleToleranceMs(sim.speed);
    // 每副仓位的风险起点：通常是它形成的那一刻；跳了时间或换了方向就改从此刻算（见 nextExposure）。
    const exposures = new Map<string, ExposureEntry>();
    for (const [sym, positions] of Object.entries(positionsMapRef.current)) {
      const clock = getEffectiveTime(sym);
      for (const pos of positions) {
        exposures.set(pos.id, nextExposure(exposureRef.current.get(pos.id), pos, clock, direction, tolerance));
      }
    }
    exposureRef.current = exposures;
    const riskStartOf = (pos: Position) => exposures.get(pos.id)?.start ?? null;
    /**
     * 这个价属于哪一刻——只认与它同一次登记的时间戳。价格 state 要等下一次渲染才提交，
     * 时间戳却在 ref 里、登记当下就换了；两者之间跑到这里，会把上一次的价配上新一次的戳，陈价被当成新鲜的。
     */
    const pairedAsOf = (sym: string, price: number): number | undefined => {
      const paired = pricePairedWithAsOfRef.current[sym];
      if (paired != null && paired !== price) return undefined;
      return priceAsOfRef.current[sym];
    };
    const isolatedItems: { symbol: string; position: Position; exitPrice: number; closeTime: number }[] = [];
    for (const [sym, positions] of Object.entries(positionsMapRef.current)) {
      const price = priceMap[sym] || 0;
      if (price <= 0) continue;
      const priceAsOf = pairedAsOf(sym, price);
      for (const pos of positions) {
        // 判据在 liquidationGuards.evaluateIsolatedLiquidation：陈价、早于仓位形成的价、
        // 零张幽灵仓位、NaN 全部落到「不强平」。
        const decision = evaluateIsolatedLiquidation({
          symbol: sym, position: pos, price, priceAsOf,
          nowSim: getEffectiveTime(sym),
          toleranceMs: tolerance,
          direction,
          riskSince: riskStartOf(pos),
        });
        if (!decision.liquidate) continue;
        // 两次采样之间价格已越过强平价：按强平价记账（仓位本应在那里被接管），
        // 不按采样到的那个更远的价；亏损由结算函数封顶在保证金。
        const liq = calcLiquidationPrice(pos, sym);
        const exitPrice = Number.isFinite(liq) && liq > 0 ? liq : price;
        // 时间取这个价的时刻：判据已保证它按播放方向不早于仓位形成。
        isolatedItems.push({ symbol: sym, position: pos, exitPrice, closeTime: Number(priceAsOf) });
      }
    }
    settleIsolatedLiquidations(isolatedItems);

    // --- CROSS liquidation: aggregate all cross positions globally ---
    // 维持保证金 = Σ 各全仓仓位按自己的风险模型算的维持保证金（positionMaintenanceMarginUsd，现价口径）
    let crossUnrealizedPnl = 0;
    let crossMaintenanceMargin = 0;
    let crossPositionCount = 0;
    const crossRiskPositions: Position[] = [];
    // 已被扣出钱包的全仓保证金——它是权益的一部分，判据里漏掉它就等于把风险算大一倍。
    let crossMargin = 0;
    /**
     * 全仓权益是整个账户的事：任一全仓标的的价格过期、缺价、或早于该仓位形成，
     * 这一轮整轮不判——与逐仓同一取向，算不清就不强平。原来全仓这一支完全没有过期价格检查。
     */
    let crossPriceUsable = true;
    for (const [sym, positions] of Object.entries(positionsMapRef.current)) {
      if (!positions.some(p => p.marginMode === 'cross' && isPositionOpen(p))) continue;
      const price = priceMap[sym] || 0;
      const priceAsOf = pairedAsOf(sym, price);
      if (price <= 0 || !isPriceFreshForLiquidation(priceAsOf, getEffectiveTime(sym), tolerance)) {
        crossPriceUsable = false;
        continue;
      }
      for (const pos of positions) {
        if (pos.marginMode !== 'cross') continue;
        if (!priceObservedAfter(priceAsOf, riskStartOf(pos), direction)) crossPriceUsable = false;
        crossUnrealizedPnl += calcUnrealizedPnl(pos, price);
        crossMaintenanceMargin += positionMaintenanceMarginUsd(sym, pos, price);
        crossRiskPositions.push(pos);
        // 币本位持有的是币，保证金的美元价值随价格走；用开仓时冻结的 pos.margin
        // 会让同一笔仓位在逐仓与全仓下按两套模型判生死（逐仓那一支已按现价折算）。
        crossMargin += positionMarginUsdAtMark(pos, price);
        crossPositionCount++;
      }
    }

    if (crossPositionCount > 0 && crossPriceUsable) {
      const crossDecision = evaluateCrossLiquidation({
        balanceUsd: balance,
        crossMarginUsd: crossMargin,
        crossUnrealizedPnlUsd: crossUnrealizedPnl,
        crossMaintenanceUsd: crossMaintenanceMargin,
      });
      const crossEquity = crossDecision.equityUsd ?? (balance + crossMargin + crossUnrealizedPnl);

      if (crossDecision.liquidate) {
        liquidationCheckRef.current = true;

        let totalLoss = 0;
        /** 全仓仓位的净结算之和（盈亏 − 平仓费 − 强平费），用来把余额落到真实数上。 */
        let crossSettlement = 0;
        /**
         * 撤单要按「这个仓位还在不在」算，**不是**按「它这一刻有没有价」算。
         *
         * 下面的 setPositionsMap 删掉的是**全部**全仓仓位，包括 priceMap 里
         * 暂时没有价（刚恢复会话、取价失败）、因而没进结算那一轮的那些。
         * 只把「有价的那些」放进这个集合，挂在无价仓位上的止损就会活下来，
         * 指向一个已经不存在的 id：planReduceOnlyTrigger 返回 linked_position_missing
         * 并**原样保留**这张单——不撤、不改指、不报错，永远挂在委托列表里。
         * 旧代码 setOrdersMap({}) 连坐清空，反而没有这个洞。
         */
        const liquidatedPositionIds = new Set<string>();
        // 与下面结算那一轮同读 ref：闭包里那份可能缺一笔刚开的全仓仓位——它会被结算、却不被删除。
        for (const positions of Object.values(positionsMapRef.current)) {
          for (const pos of positions) {
            if (pos.marginMode === 'cross') liquidatedPositionIds.add(pos.id);
          }
        }
        const liqRecords: TradeRecord[] = [];

        for (const [sym, positions] of Object.entries(positionsMapRef.current)) {
          const price = priceMap[sym] || 0;
          if (price <= 0) continue;

          for (const pos of positions) {
            if (pos.marginMode !== 'cross') continue;
            const pnl = calcUnrealizedPnl(pos, price);
            const notional = getPositionNotionalUsd(sym, pos, price);
            const { feeUsd: closeFee, feeCoin, feeRate: closeFeeRate } = getSettlementFeeParts(sym, pos, price, false);
            const liqFee = notional * LIQUIDATION_FEE_RATE;
            // 净结算里已经扣过强平费；原来在亏损之外再加一次 liqFee，弹窗里的损失被多算一截。
            totalLoss += Math.max(0, -(pnl - closeFee - liqFee));
            crossSettlement += pnl - closeFee - liqFee;

            // 全仓强平同样按每笔成交拆条,理由与逐仓那一支相同。
            liqRecords.push(...buildCloseRecords({
              symbol: sym, pos,
              closeQty: getPositionUnits(pos),
              fillPrice: price,
              // 取这个价的时刻，不取落后的界面时钟（那会让平仓时间早于开仓）。
              closeTime: Number(pairedAsOf(sym, price)),
              exitMethod: 'liquidation',
              closedRealAt: Date.now(),
              // 全仓强平一次跨所有标的：每条记录取自己标的的钟。
              closedTimelineId: stampClock(sym),
              totals: {
                netPnl: pnl - closeFee - liqFee,
                // 币本位：钱包少掉的币 = 净结算 ÷ 强平价（全仓没有保证金封顶，净额就是全部）。
                // 不写这一项，加仓计算器按「盈亏 ÷ 平仓价」折币、Legs 加仓校验只认 pnlCoin，同一笔爆仓折出两个 G。
                ...(isCoinSettled(pos) && price > 0 ? { pnlCoin: (pnl - closeFee - liqFee) / price } : {}),
                feeUsd: closeFee + liqFee,
                feeCoin,
                slippageUsd: 0,
                notionalUsd: notional,
                closeFeeRate, closeIsMaker: false, liquidationFeeUsd: liqFee,
              },
            }).map(r => ({ ...r, action: 'LIQUIDATION' as const })));
          }
        }

        /**
         * 只删**这一轮真正结算过**的仓位，不按 marginMode 一刀切。
         *
         * 上面两个循环都有 `if (price <= 0) continue`：拿不到报价的全仓仓位既不进
         * crossMargin/crossSettlement，也不写强平记录。若这里仍按模式清空，它就会
         * 凭空消失——没有任何平仓记录、开仓时扣走的保证金再也回不到余额、
         * 它的止损因为不在 liquidatedPositionIds 里而留下来变成孤儿单。
         * 触发条件很平常：刚恢复会话或刚切标的，后台轮询还没回价。
         */
        setPositionsMap(prev => {
          const next: PositionsMap = {};
          for (const [sym, positions] of Object.entries(prev)) {
            const kept = positions.filter(p => !liquidatedPositionIds.has(p.id));
            if (kept.length > 0) next[sym] = kept;
          }
          return next;
        });
        /**
         * 只清**全仓**仓位的委托。原来是 setOrdersMap({})，把逐仓仓位的止盈止损
         * 一起抹了——逐仓仓位并没有被强平，却在这一刻失去了全部保护。
         */
        setOrdersMap(prev => {
          const next: OrdersMap = {};
          for (const [sym, orders] of Object.entries(prev)) {
            const kept = orders.filter(o => !liquidatedPositionIds.has(o.linkedPositionId ?? ''));
            if (kept.length > 0) next[sym] = kept;
          }
          return next;
        });
        /**
         * 余额按**真实结算**落地：钱包现金 + 退回的全仓保证金 + 各仓位的净结果。
         * 原来写的是 crossEquity × 0.05——一个没有出处的「留 5%」，
         * 与上面刚写进 tradeHistory 的那批强平记录对不上账，
         * 于是「Σ记录盈亏」与「余额变化」从此永久分叉。
         */
        /**
         * 用 prev 而不是 effect 闭包里的 balance：useEffect 是异步冲刷的，提交与冲刷之间
         * 后台轮询（现在真的每秒跑了）、资金费结算那个先声明因而先跑的 effect，
         * 都可能已经改过余额；用旧闭包绝对赋值会把它们**整笔丢掉**。
         *
         * **不加 Math.max(0, …) 的钳位**：那个钳位在这里恒等于 0，等于让这行算什么都一样。
         * 触发条件是权益 ≤ Σ维持保证金 = 0.004·N，而这一刀要付的费用是
         * 平仓费 0.0004·N + 强平费 0.005·N = 0.0054·N > 0.004·N，
         * 所以「权益 − 费用」恒为负（上界 −0.0014·N）。钳到 0 就意味着钱包少付了那一截，
         * 而刚写进 tradeHistory 的强平记录里记的是完整数额——b、R 全都建立在这些记录上，
         * 「Σ记录 == Δ余额」一旦破掉，风险统计就永远比真实少亏一截。
         *
         * 代价是余额可以为负，含义是「亏穿了」。这与同文件平仓那一支「全仓全额回写」
         * 同一口径。更贴近币安的做法是按**破产价**结算、让记录与钱包同时落在
         * 「恰好亏光保证金」上（保险基金吃掉超出部分）——那是另一件事，单独立项。
         */
        // crossMargin 已按现价折算（见上），与 crossSettlement 同源，余额与记录对得上账。
        setBalance(prev => prev + crossMargin + crossSettlement);
        setTradeHistory(prev => [...prev, ...liqRecords]);

        openLiquidationModal({
          lostAmount: totalLoss, liquidatedPositions: crossPositionCount, scope: 'cross',
          maintenance: summarizeRiskModels(crossRiskPositions),
        });
        toast.error('🚨 全仓爆仓！所有全仓仓位已被强制平仓', { duration: 10000 });

        setTimeout(() => { liquidationCheckRef.current = false; }, 2000);
      }
    }
  }, [priceMap, positionsMap, balance, sim.isRunning, sim.currentSimulatedTime, sim.speed, sim.direction, getEffectiveTime, settleIsolatedLiquidations, openLiquidationModal]);

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
    trigger?: SettleFillTrigger,
  ): boolean => {
    /**
     * 条件 / 跟踪委托：币安在触发这一刻才真正下单，分层上限（-2027）按这一刻的敞口判——
     * 挂单之后行情走了、别的仓位开了，下单时过得去的单子触发时可能已经过不去。
     * 过不去就与付不起同样处理：撤单留痕、不缩量。挂在盘口的分层限价单成交时不再判（与币安一致）。
     * 只靠对冲豁免挂出的单（条件单、跟踪委托、限价单都算）在这一刻再判豁免是否仍成立：
     * 旧仓位先平掉 / 减掉、或额度已被别的对冲占掉时，按普通的分层判——放得下就开分层仓位，放不下就撤。
     */
    let refusal: { title: string; description: string } | null = null;
    const triggerPx = Number(trigger?.price);
    /**
     * 只判带来源的委托（本次更新之后经引擎下的：分层戳或对冲豁免标记）。更新前挂出的条件单、
     * 跟踪委托、TWAP 是按旧规则放行的——与它们成交后开旧模型仓位是同一条规则
     * （positionRiskStampForFill）。否则升级会在触发那一刻悄悄撤掉用户早就挂好的对冲单
     * （旧默认 35x 在 599 个最高杠杆低于 35x 的合约上更是一触发就撤）。
     */
    if (!order.reduceOnly && triggerPx > 0 && hasRiskProvenance(order)) {
      const filling = trigger?.fill ?? order;
      const limit = checkOrderPositionLimit({
        symbol,
        settlement: limitSettlementOf(order),
        leverage: Number(order.leverage),
        positions: positionsMapRef.current[symbol] || [],
        orders: ordersMapRef.current[symbol] || [],
        excludeOrderIds: [order.id, ...(trigger?.settledOrderIds ?? [])],
        orderOverrides: trigger?.orderOverrides,
        markPrice: triggerPx,
        orderNotionalUsd: getPositionNotionalUsd(symbol, filling, triggerPx),
        orderPrice: triggerPx,
        side: order.side,
      });
      const exempt = order.riskModel === LEGACY_HEDGE_RISK_MODEL;
      if (!limit.ok) {
        // 触发类与 TWAP 是「触发时」；挂在盘口的豁免限价单是「成交时」
        const when = isTriggeredOpenOrder(order) || order.type === 'TWAP' ? '触发时' : '成交时';
        refusal = {
          title: `${when}超过杠杆分层上限，委托已撤销`,
          description: `${symbol}：${exempt ? '这张单是靠对冲更新前仓位的豁免挂出的，这一刻豁免已不成立（旧仓位已减少或平掉，或额度已被别的对冲占掉），按普通分层判：' : ''}`
            + `${limit.message} ${positionLimitDetail(limit)}`,
        };
      } else if (trigger?.position) {
        // 这一笔的来源按这一刻的判定定：只靠豁免 → 豁免标记（旧模型）；正常放行 → 分层
        Object.assign(
          trigger.position,
          limit.reason === 'legacy-hedge' ? legacyHedgeRiskStamp(symbol) : positionRiskStamp(symbol),
        );
      }
    }
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
    if (!refusal) {
      const verdict = evaluateFillAffordability({
        availableUsd: balanceRef.current,
        marginUsd,
        feeUsd,
      });
      if (verdict.ok) {
        setBalance(prev => prev - marginUsd - feeUsd);
        return true;
      }
      refusal = {
        title: '保证金不足，委托已撤销',
        description: `${symbol} 需要 ${verdict.requiredUsd.toFixed(2)} USDT，可用 ${verdict.availableUsd.toFixed(2)} USDT`,
      };
    }

    // 章在回调外面取：setCancelledOrders 是 React 的 updater，可能被重跑。
    const cancelledTimelineId = stampClock(symbol);
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
      createdRealAt: order.createdRealAt,
      cancelledAt,
      cancelledRealAt: Date.now(),
      createdTimelineId: order.createdTimelineId,
      cancelledTimelineId,
    }));
    // 成交时被撤（保证金不足或超出币安分层上限）的若是按计算器计划挂的加仓单：计划同样放回去（与手动撤单同一规则）
    restoreCancelledAddPlan(symbol, order, positionsMapRef.current[symbol], cancelledTimelineId, timelineRegistryRef.current);
    toast.error(refusal.title, { description: refusal.description });
    return false;
  }, [setBalance, setCancelledOrders, stampClock]);

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
    const newOrders = buildTpSlOrders({
      symbol, position, levels, now, newId: () => crypto.randomUUID(), timelineId: stampClock(symbol),
    });
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
  }, [getEffectiveTime, setOrdersMap, stampClock]);

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
      /**
       * 不合并 = 这一笔身上**没有任何减仓单**：挂在现有仓位上的止盈止损只认那一笔的 id
       * （planReduceOnlyTrigger 按 linkedPositionId 找仓位），盖不住新开的这一笔——而不合并的这几种情形里，
       * 先被强平的往往正是新的这一笔（它的强平价离现价更近）。持仓卡上按一次「止盈/止损」会给卡上每一笔各挂一张，
       * 但那要用户自己去点，所以在这里说一句。
       */
      const uncovered = ' 现有仓位上的止盈止损不覆盖这一笔：在持仓卡上按一次「止盈/止损」会给卡上每一笔各挂一张。';
      toast.warning('未与现有仓位合并', {
        description: (merged.blockedBy === 'leverage'
          ? '杠杆与现有同向仓位不同，两笔各自独立计算强平价。'
          : merged.blockedBy === 'marginMode'
            ? '保证金模式与现有同向仓位不同，两笔各自独立计算强平价。'
            : merged.blockedBy === 'riskModel'
              // 只挡一个方向（mergeRiskBlocked）：这一笔按旧的 0.4%，而现有同向仓位按币安分层——
              // 合并会让分层仓位把这一截也按档位定价、跨进更高的档，把它自己当场强平。
              // 反过来（分层加仓并进按 0.4% 的旧仓位）是合并的，走不到这里。
              ? '这一笔按旧的 0.4% 计维持保证金（更新前挂出的委托，或靠对冲更新前仓位的豁免开的），'
                + '现有同向仓位按币安分层计：并进去会把这一截也按档位定价、把现有仓位推进更高的档位，'
                + '所以两笔各自独立计算强平价；现有仓位的维持保证金与强平价不变。'
                + '这张卡上的「平仓」照常可以按成数部分平仓（成数摊到卡上每一笔）。'
              : '结算方式与现有同向仓位不同，两笔各自独立计算强平价。') + uncovered,
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
   * 带着计算器计划的加仓吃单成交之后的复判（addSizingFillGuard.judgePlannedAddFill）。
   * 挂单 / 成交历史读 ref：条件单触发与后台撮合的回调不该因为成交历史变了就换身份。
   * 从不抛错——这条路径上任何异常都不该影响已经成交的单子（judgeMarketAddFill 自己也兜着）。
   */
  const judgePlannedAddFill = useCallback((
    symbol: string,
    heldBefore: Position[],
    position: Position,
    referencePrice: number,
    snapshot?: AddSizingSnapshot | null,
  ) => {
    if (!snapshot) return;
    try {
      judgePlannedAddFillPure({
        symbol, position, referencePrice, heldBefore, snapshot,
        ordersMap: ordersMapRef.current, tradeHistory: tradeHistoryRef.current,
      });
    } catch (error) {
      console.error('[加仓成交复判] 判定失败', error);
    }
  }, []);

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
  const applySymbolLeverage = useCallback((
    symbol: string,
    nextLeverage: number,
    requestedSettlement?: SettlementMode,
  ): LeverageChangePlan => {
    const positions = (positionsMapRef.current[symbol] || []).filter(isPositionOpen);
    const orders = ordersMapRef.current[symbol] || [];
    /**
     * 持仓卡上的对话框按**仓位的**结算方式预览（U 本位仓位用 U 本位分层），而下单面板每次刷新
     * 都回到币本位；两边上限不同的币（BNB 75x / 20x、SOL 100x / 50x、BTC 150x / 125x）上，
     * 按面板的结算方式夹值会把对话框放行的杠杆悄悄压低或拒掉。所以用调用方传来的那一种。
     */
    const settlementMode = requestedSettlement ?? getSymbolSettlementMode(symbol);
    const plan = planLeverageChange({
      symbol,
      positions,
      orders,
      markPrice: priceMapRef.current[symbol] || 0,
      // 与 getSymbolLeverage 同一口径（夹到合约上限），但读 ref，不读可能落后一拍的 state。
      currentLeverage: effectiveSymbolLeverage(leverageMapRef.current[symbol], symbol, settlementMode === 'coin' ? 'coin' : 'usdt'),
      nextLeverage,
      settlementMode,
    });
    if (!plan.ok) return plan;

    /**
     * 已挂的触发类开仓单会被一并重述到新杠杆，触发时按新杠杆的上限判（币安一样：改杠杆不拦，触发时才拒）。
     * 这一步让哪张单到时注定被撤，就在消息中心说一声（对话框在确认前已经摆出来了）。
     */
    const triggerRisk = triggerRiskMessage(
      newlyDoomedTriggerOrders({ symbol, positions, orders, leverage: plan.to, markPrice: priceMapRef.current[symbol] || 0 }),
      `杠杆调到 ${plan.to}x 后`,
    );

    // 写回也按同一种结算方式夹：否则保存值被夹到另一张合约的上限，而仓位已经重述到这一张的值。
    setSymbolLeverage(symbol, plan.to, settlementMode);

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
    if (triggerRisk) toast.warning(`${symbol}：${triggerRisk.title}`, { description: triggerRisk.description });
    return plan;
  }, [getSymbolSettlementMode, setSymbolLeverage, setPositionsMap, setBalance, setOrdersMap]);

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

    /**
     * 加仓计算器的计划钉在这张单上：同标的、同方向、会开仓的类型、仍在保鲜期才取。
     * 下单面板在点「开多 / 开空」那一刻已经取好放进 order.addSizingSnapshot（决策模式的下单前快照可能填上半小时，
     * 到这里再取，计划早过了保鲜期）；没带才在这里自己取。
     * 先看不消费——下面的校验可能把单子拒掉（余额不足、保护价方向不对），拒了计划得留着；
     * 单子真的成交 / 挂出时才 commitAddSizingPlan，只消费**这一份**（带来的那份在仓库里还在，就清掉它；
     * 仓库里若已是别的新计划，不动）。之后它随 executeSettlementFill 落到仓位（这一笔）上，
     * 挂单则落到委托上、成交时再到仓位，平仓时 buildCloseRecords 把它写进记录——
     * Legs「加仓校验」靠它说清计算时与成交时各是多少。
     */
    const orderSettlement = order.settlementMode ?? getSymbolSettlementMode(symbol);
    const plannedSnapshot = order.addSizingSnapshot
      ?? peekAddSizingSnapshotForOrder({ symbol, side: order.side, type: order.type, settlement: orderSettlement });
    /**
     * 钉上去的是计划的一份拷贝，补上这张单**自己**的下单参考价 s2AtOrder：
     * 市价 / 最优价 = 引擎成交的基准价，其余按 orderReferencePrice（限价 = 委托价，条件单 = 触发价）。
     * 计算后价格可能已经变了、限价也可能不是计划的价——没有它，Legs 校验只能把这些都算成「成交滑点」。
     */
    const addSizingSnapshot: AddSizingSnapshot | null = plannedSnapshot
      ? {
        ...plannedSnapshot,
        s2AtOrder: plannedSnapshot.s2AtOrder ?? (
          order.type === 'MARKET' || order.priceSelection === 'BEST'
            ? effectiveCurrentPrice
            : (orderReferencePrice({ ...order, type: order.type } as unknown as PendingOrder, effectiveCurrentPrice).price || effectiveCurrentPrice)
        ),
      }
      : null;
    const commitAddSizingPlan = () => { if (plannedSnapshot) consumeAddSizingPlan(plannedSnapshot); };
    const normalizedOrder = normalizeSettlementOrder(symbol, {
      ...order,
      settlementMode: orderSettlement,
      ...(addSizingSnapshot ? { addSizingSnapshot } : {}),
      // 本次经引擎下的委托一律盖分层戳：成交后开分层仓位（立即成交的市价单就在下面用它）。
      ...ORDER_RISK_STAMP,
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

    // 成交时刻取撮合时钟（见 getLiveSimTime），不取落后的界面时钟。
    const now = getLiveSimTime(symbol);
    // 这一单（成交或挂出）所在的回放时间线，与 now 同一只钟。
    const timelineId = stampClock(symbol);
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

    /**
     * 按计算器计划下的市价 / 最优价加仓，成交之后按**实际成交价**复判 Plan B（addSizingFillGuard）。
     * 只说不拦：超限就进消息中心，单子照旧。只判带着同方向计划的单子——对冲侧的加码、
     * 没开计算器的第二刀都不是计算器授权的加仓；没有计划或没有同向持仓时在第一道门就返回，几乎不花时间。
     * 状态取合并**之前**的持仓与当下的挂单 / 成交历史——加仓当下 X₁ / S̄ / S₁ / G 各是多少。
     */
    const judgeAddFill = (heldBefore: Position[], position: Position, referencePrice: number, snapshot?: AddSizingSnapshot | null) => {
      judgePlannedAddFill(symbol, heldBefore, position, referencePrice, snapshot);
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

    /**
     * 立即成交的：市价单与最优价（下面两条分支），其余都先挂出去。
     * 估值价：立即成交的按引擎成交的基准价，其余按 orderReferencePrice（限价 = 委托价，条件单 = 触发价）；
     * 真币本位按它把这一单折成币——一张低于现价的买入限价单按委托价折，成交后的仓位才不会超出上限。
     */
    const executesNow = normalizedOrder.priceSelection === 'BEST' || normalizedOrder.type === 'MARKET';
    const limitMarkPrice = symbolPrice > 0 ? symbolPrice : effectiveCurrentPrice;
    // 已经穿价的限价单（买价 ≥ 现价、卖价 ≤ 现价）下一根就成交，按现价估值（placementOrderValuation 按方向判）；
    // 立即成交的本来就按引擎成交的基准价估值
    const valuation = placementOrderValuation(
      symbol,
      normalizedOrder,
      executesNow
        ? effectiveCurrentPrice
        : orderReferencePrice(normalizedOrder as unknown as PendingOrder, effectiveCurrentPrice).price,
      executesNow ? undefined : limitMarkPrice,
    );
    /** 第二道：触发类按触发价 / 激活价，不会立即成交的限价单（含分段子单）按成交那一刻的委托价。 */
    const secondGate = placementCheckPrice(normalizedOrder, limitMarkPrice, executesNow);
    const currentPositions = positionsMapRef.current[symbol] || [];
    const currentOrders = ordersMapRef.current[symbol] || [];
    /**
     * 币安分层上限（-2027 Exceeded the maximum allowable position at current leverage）：
     * 持仓（多空绝对值相加）+ 当前委托 + 这一单，不得超过当前杠杆的最高可持有头寸。
     * 面板已经把按钮置灰，这里是引擎自己的闸门——绕过面板（快照弹窗、脚本、旧界面）也过不去。
     * 与面板读的是同一个判定、同一句话。面板下的单都是开仓单（PlaceOrderParams 没有只减仓），
     * 平仓走 handleClosePosition / 止盈止损，本来就不经过这里。
     * 条件单 / 跟踪委托再按触发价（激活价）判一道：触发时注定被撤的单，下单时就不放行；
     * 不会立即成交的限价单再按委托价判一道：成交那一刻就超限、把账户卡死的单，下单时就不放行。
     * 反向对冲更新前的仓位不受上限约束（见 positionLimit 文件头），所以要带上方向。
     */
    {
      const limit = checkPlacementPositionLimit({
        symbol,
        settlement: limitSettlementOf(normalizedOrder),
        leverage: Number(normalizedOrder.leverage),
        positions: currentPositions,
        orders: currentOrders,
        markPrice: limitMarkPrice,
        orderNotionalUsd: valuation.usd,
        orderPrice: valuation.price,
        side: normalizedOrder.side,
        triggerPrice: secondGate.price,
        triggerKind: secondGate.kind,
      });
      if (!limit.ok) {
        toast.error(limit.message ?? '超过当前杠杆倍数最高可持有头寸', {
          description: positionLimitDetail(limit),
        });
        return null;
      }
      /**
       * 只靠「对冲更新前的仓位」那条豁免放行的单盖豁免标记 'legacy-hedge-v1'（立即成交的仓位、挂出的委托都一样）：
       * 按旧模型开；它不是更新前的仓位，不能再给别的单当豁免的底；挂着的时候触发 / 成交那一刻再判豁免是否仍成立
       * （见 positionLimit 文件头）。normalizedOrder 是 normalizeSettlementOrder 刚造的新对象，就地改不影响任何别的引用。
       */
      if (placementUsesLegacyHedge(limit)) Object.assign(normalizedOrder, ORDER_LEGACY_HEDGE_STAMP);
    }
    const stampedAs = (normalizedOrder as { riskModel?: string }).riskModel;
    const exemptOrder = stampedAs === LEGACY_HEDGE_RISK_MODEL;
    const orderRiskStamp = exemptOrder
      ? ORDER_LEGACY_HEDGE_STAMP
      : stampedAs === TIERED_RISK_MODEL ? ORDER_RISK_STAMP : {};
    /**
     * 已挂的触发类开仓单（带分层戳）在触发那一刻按当时的敞口再判——这一单会不会让其中哪张到时注定被撤。
     * 币安不拦这一单，这里也不拦；单子真的下出去了才在消息中心说一声（面板在点按钮之前已经摆出来了）。
     */
    const triggerRisk = triggerRiskMessage(
      newlyDoomedTriggerOrders({
        symbol,
        positions: currentPositions,
        orders: currentOrders,
        added: placementAftermath(
          { ...normalizedOrder, leverage: Number(normalizedOrder.leverage) },
          { markPrice: limitMarkPrice, immediate: executesNow, legacy: exemptOrder },
        ),
        markPrice: limitMarkPrice,
      }),
      '这张单下出去后',
    );
    const announceTriggerRisk = () => {
      if (triggerRisk) toast.warning(`${symbol}：${triggerRisk.title}`, { description: triggerRisk.description });
    };

    // Note: We no longer record OPEN trades to tradeHistory.
    // Only CLOSE/LIQUIDATION/FUNDING produce realized PnL entries.

    // BEST PRICE (taker)
    if (normalizedOrder.priceSelection === 'BEST') {
      const { fee, margin, slippage, position } = executeSettlementFill(symbol, effectiveCurrentPrice, normalizedOrder, false, now, Date.now(), timelineId, 'manual');
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
      const heldBefore = (positionsMapRef.current[symbol] || []).filter(isPositionOpen);
      judgeAddFill(heldBefore, position, effectiveCurrentPrice, normalizedOrder.addSizingSnapshot);
      const merged = mergeFilledPosition(symbol, heldBefore, position);
      setPositionsMap(prev => ({ ...prev, [symbol]: merged.positions }));
      applyMergeSideEffects(symbol, merged);
      // 执行力资产只奖励做多开仓：做空一律视为辅助对冲单，不计分。
      if (normalizedOrder.side === 'LONG') {
        recordExecutionTrade(tradingModeRef.current, buildExecutionTradeSnapshot(position, 'BEST'));
      }
      commitAddSizingPlan();
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
      announceTriggerRisk();
      return { id: position.id };
    }

    // MARKET (taker with slippage)
    if (normalizedOrder.type === 'MARKET') {
      const { fee, margin, slippage, position } = executeSettlementFill(symbol, effectiveCurrentPrice, normalizedOrder, false, now, Date.now(), timelineId, 'manual');
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
      const heldBefore = (positionsMapRef.current[symbol] || []).filter(isPositionOpen);
      judgeAddFill(heldBefore, position, effectiveCurrentPrice, normalizedOrder.addSizingSnapshot);
      const merged = mergeFilledPosition(symbol, heldBefore, position);
      setPositionsMap(prev => ({ ...prev, [symbol]: merged.positions }));
      applyMergeSideEffects(symbol, merged);
      // 执行力资产只奖励做多开仓：做空一律视为辅助对冲单，不计分。
      if (normalizedOrder.side === 'LONG') {
        recordExecutionTrade(tradingModeRef.current, buildExecutionTradeSnapshot(position, normalizedOrder.type));
      }
      commitAddSizingPlan();
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
      announceTriggerRisk();
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
        status: 'NEW' as const, createdAt: now, createdRealAt: Date.now(), createdTimelineId: timelineId,
        ...orderRiskStamp,
        parentScaledId: parentId,
        tradingMode: tradingModeRef.current,
      }));
      setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), ...newOrders] }));
      toast.info(`分段订单已挂出: ${count} 笔限价单`);
      announceTriggerRisk();
      return placedWithoutTradeRef();
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
        status: 'PENDING', createdAt: now, createdRealAt: Date.now(), createdTimelineId: timelineId,
        ...orderRiskStamp,
        tradingMode: tradingModeRef.current,
      };
      setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), trailingOrder] }));
      toast.info(activation > 0
        ? `跟踪委托已挂出 · 激活价 ${activation} · 回调 ${(cb * 100).toFixed(1)}%`
        : `跟踪委托已挂出 · 回调 ${(cb * 100).toFixed(1)}%`);
      announceTriggerRisk();
      return placedWithoutTradeRef();
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
        status: 'ACTIVE', createdAt: now, createdRealAt: Date.now(), createdTimelineId: timelineId,
        ...orderRiskStamp,
        tradingMode: tradingModeRef.current,
        twapTotalQty: normalizedOrder.quantity, twapFilledQty: 0,
        twapInterval: intervalMs, twapNextExecTime: now,
        twapEndTime: now + durationMs,
      };
      setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), twapOrder] }));
      toast.info(`TWAP 委托已启动`);
      announceTriggerRisk();
      return placedWithoutTradeRef();
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
      status: normalizedOrder.type === 'CONDITIONAL' ? 'PENDING' : 'NEW', createdAt: now, createdRealAt: Date.now(),
      createdTimelineId: timelineId,
      ...orderRiskStamp,
      tradingMode: tradingModeRef.current,
      callbackRate: normalizedOrder.callbackRate, trailingExecType: normalizedOrder.trailingExecType,
      trailingLimitPrice: normalizedOrder.trailingLimitPrice, trailingActivated: false,
      conditionalExecType: normalizedOrder.conditionalExecType, conditionalLimitPrice: normalizedOrder.conditionalLimitPrice,
      ...attachedTpSl,
      triggerDirection, operator,
      // 加仓计划随委托走，成交时 executeSettlementFill 再把它落到仓位上；没有计划的委托与改动前逐字节相同。
      ...(normalizedOrder.addSizingSnapshot ? { addSizingSnapshot: normalizedOrder.addSizingSnapshot } : {}),
    };
    setOrdersMap(prev => ({ ...prev, [symbol]: [...(prev[symbol] || []), newOrder] }));
    commitAddSizingPlan();
    toast.info('委托已挂出');
    announceTriggerRisk();
    return { id: newOrder.id };
  }, [getEffectiveTime, getSymbolSettlementMode, judgePlannedAddFill, recordExecutionTrade, stampClock]);

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
      feeRate,
      notionalUsd,
    } = closeSettlementPosition(symbol, pos, rawPrice, closeQty, false);

    const closedMargin = pos.margin * pct;
    const closedIsoMargin = pos.isolatedMargin != null ? pos.isolatedMargin * pct : undefined;

    const returnedMargin = pos.marginMode === 'isolated' && closedIsoMargin != null
      ? closedIsoMargin + pnlUsd - feeUsd
      : closedMargin + pnlUsd - feeUsd;

    /**
     * 全仓**全额**回写，逐仓才封底。
     *
     * 事故：这里原来一律 `Math.max(0, returnedMargin)`。开仓时余额已经扣掉了保证金，
     * 平仓时 returnedMargin = 保证金 + 盈亏 − 手续费；亏损一旦超过这笔保证金它就为负，
     * 被 max(0,…) 截成 0 —— 超出的那部分**永远没人付**，账户凭空多出钱，
     * 于是「Σ成交记录盈亏」与「余额变化」对不上账，而 b、R 全部建立在这些记录上。
     * 逐仓保留封底：币安逐仓的语义就是最多亏掉隔离保证金——**前提是强平按时发生**，
     * 这条前提由 evaluateIsolatedLiquidation 那一路负责。
     */
    setBalance(prev => prev + (pos.marginMode === 'cross' ? returnedMargin : Math.max(0, returnedMargin)));

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

    // 章在回调外面取：setTradeHistory 是 React 的 updater，可能被重跑。
    const closedTimelineId = stampClock(symbol);
    // 手动平仓也按每笔成交拆条。这里是与 settlePositionClose 并行的**第二份**实现,
    // 只把记录这一段接过去,不做整体归并——那是另一件事(见下方 TODO 立项)。
    setTradeHistory(prev => [...prev, ...buildCloseRecords({
      symbol, pos, closeQty, fillPrice,
      // 平仓时刻与开仓同取撮合时钟：界面时钟落后，会让平仓早于开仓。
      closeTime: getLiveSimTime(symbol),
      exitMethod: method,
      closedRealAt: Date.now(),
      closedTimelineId,
      totals: {
        netPnl: pnlUsd - feeUsd,
        pnlCoin, feeUsd, feeCoin,
        slippageUsd, notionalUsd,
        closeFeeRate: feeRate, closeIsMaker: false,
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
    const newOrders = buildTpSlOrders({
      symbol, position: pos, levels, now, newId: () => crypto.randomUUID(), timelineId: stampClock(symbol),
    });
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
    const targetSymbol = order.reduceSymbol || symbol;
    const plan = (closedTimelineId: string | null) => planReduceOnlyTrigger({
      symbol,
      order,
      triggerPrice,
      closeTime,
      positions: positionsMapRef.current,
      orders: ordersMapRef.current,
      closedTimelineId,
    });
    /**
     * 先用不落盘的 getTimelineId 试算，真的要平仓了才 stampClock：
     * 触发失败（仓位暂时找不到等）每帧都会重试，每帧盖章会让登记表每帧落一次盘、推一次云。
     * 盖章时若恰好补出了兜底分叉，按新时间线重算一遍——plan 是纯函数，此刻还什么都没写。
     */
    const provisionalTimelineId = getTimelineId(targetSymbol);
    let execution = plan(provisionalTimelineId);
    if (execution.ok) {
      const closedTimelineId = stampClock(targetSymbol);
      if (closedTimelineId !== provisionalTimelineId) execution = plan(closedTimelineId);
    }

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
    // 与手动平仓同一口径：全仓全额回写（可为负），逐仓封底。
    setBalance((prev) => prev + (
      execution.marginMode === 'cross'
        ? execution.returnedMargin
        : Math.max(0, execution.returnedMargin)
    ));
    setTradeHistory((prev) => [...prev, ...execution.records]);
    setFilledOrders(prev => upsertOrderSnapshot(prev, execution.filledOrder));

    const kindLabel = order.reduceKind === 'TP' ? '止盈' : order.reduceKind === 'SL' ? '止损' : '条件';
    toast.success(`${kindLabel}已触发：${execution.targetSymbol} @ ${formatPrice(execution.fillPrice, execution.targetSymbol)}`, {
      description: `${execution.netPnl >= 0 ? '+' : ''}${execution.netPnl.toFixed(2)} USDT`,
    });
    return execution;
  }, [getEffectiveTime, getTimelineId, stampClock, setBalance, setFilledOrders, setOrdersMap, setPositionsMap, setTradeHistory]);

  // ===== Cancel Order =====
  const handleCancelOrder = useCallback((symbol: string, orderId: string) => {
    // 撤单即删——删之前先存一份快照（委托价/委托时间/取消时间），供战役页「反向对冲挂单」展示。
    const order = (ordersMap[symbol] || []).find(o => o.id === orderId);
    const cancelledTimelineId = order ? stampClock(symbol) : null;
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
          createdRealAt: order.createdRealAt,
          cancelledAt,
          cancelledRealAt: Date.now(),
          createdTimelineId: order.createdTimelineId,
          cancelledTimelineId,
        }));
    }
    setOrdersMap(prev => ({
      ...prev,
      [symbol]: (prev[symbol] || []).filter(o => o.id !== orderId),
    }));
    // 撤掉的是按计算器计划挂的加仓单：计划放回去（仍在保鲜期、没有更新的计划、仍持有同向仓位时），紧接着追价的同向单还带得上
    if (order) restoreCancelledAddPlan(symbol, order, positionsMapRef.current[symbol], cancelledTimelineId, timelineRegistryRef.current);
    toast.info('委托已撤销');
  }, [ordersMap, getEffectiveTime, setCancelledOrders, stampClock]);

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
    // 这个标的的仓位、挂单、记录都没了：计算器的计划也不该留下来，否则下一场打开计算器会种回它的 S₁ / G
    clearAddSizingPlan(symbol);

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
    handlePlaceOrder, handleClosePosition, handleCancelOrder, handlePlaceTpSl, applyAttachedTpSl, applyMergeSideEffects, judgePlannedAddFill, liquidateIsolatedOnCandle, settleFillDebit, applySymbolLeverage, executeReduceOnlyTrigger,
    handleAdjustMargin, handleClearSymbolData,
    fundingRate: FUNDING_RATE,
    liquidationOpen, liquidationDetails, closeLiquidationModal,
    timeMode, setTimeMode,
    timeDirection: sim.direction, setTimeDirection,
    reverseCapTime, setReverseCapTime,
    tradingMode, setTradingMode,
    executionAsset, setExecutionAsset, recordExecutionTrade, recordCampaignCreated, reconcileCampaignRewards,
    recordPostTradeReviewCompleted, reconcilePostTradeReviewRewards,
    recordObservationLogged,
    coinTimelines, setCoinTimelines,
    totalPositionCount,
    getEffectiveTime,
    getCoinState,
    getTimelineId,
    stampClock,
    forkReplayTimeline,
    endReplayTimeline,
    getEffectiveBalance,
    getEffectiveAvailable,
  };

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}
