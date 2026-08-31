// Shared trading types for the matching engine

export type OrderSide = "LONG" | "SHORT";
export type OrderType =
  | "MARKET"
  | "LIMIT"
  | "POST_ONLY" // 只做Maker
  | "LIMIT_TP_SL" // 限价止盈止损
  | "MARKET_TP_SL" // 市价止盈止损
  | "CONDITIONAL" // 条件委托
  | "TRAILING_STOP" // 跟踪委托
  | "TWAP" // 分时委托
  | "SCALED"; // 分段订单

export type MarginMode = "cross" | "isolated";

/**
 * 新标的下单时的默认仓位模式。
 *
 * 取逐仓：本系统把「全仓」定为硬阻断（全仓会把单笔错误扩散到账户整体，
 * 违背损失有界的底层原则），默认却是全仓的话，每开一个新标的都要先手动切换
 * 才能提交，默认值与硬约束自相矛盾。
 *
 * 只作用于「尚未为该标的显式选过仓位模式」的实时下单路径；
 * 历史记录里缺失该字段的回填保持原样，不追溯改写过去交易的含义。
 */
export const DEFAULT_MARGIN_MODE: MarginMode = "isolated";
export type SettlementMode = "usdt" | "coin";

/**
 * 新标的下单时的默认结算方式。
 *
 * 只作用于「尚未为该标的显式选过结算方式」的实时下单路径。
 * 历史记录里缺失该字段的回填一律保持 "usdt"——那些单子是在旧默认下开的，
 * 事后按币本位重新解读会悄悄改写过去交易的含义，连带污染战役统计。
 */
export const DEFAULT_SETTLEMENT_MODE: SettlementMode = "coin";
export type OrderStatus = "NEW" | "PENDING" | "FILLED" | "CANCELED" | "TRIGGERED" | "ACTIVE";
export type TriggerOperator = ">=" | "<=";

export interface PendingOrder {
  id: string;
  side: OrderSide;
  type: OrderType;
  price: number;
  stopPrice: number;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  /** USDT linear contract by default; coin = Binance COIN-M inverse contract. */
  settlementMode?: SettlementMode;
  /** USDT for U本位; base coin (BTC/ETH/...) for 币本位. */
  settlementAsset?: string;
  /** COIN-M contract face value in USD, e.g. BTCUSD=100, most alts=10. */
  contractSizeUsd?: number;
  /** COIN-M order quantity in contracts/张. Mirrors quantity for coin-settled orders. */
  contracts?: number;
  status: OrderStatus;
  createdAt: number;
  /** Trading mode captured at placement, so later fills keep the original incentive weight. */
  tradingMode?: "decision" | "direct";

  callbackRate?: number;
  trailingExecType?: "MARKET" | "LIMIT";
  trailingLimitPrice?: number;
  peakPrice?: number;
  troughPrice?: number;
  trailingActivated?: boolean;

  twapTotalQty?: number;
  twapFilledQty?: number;
  twapInterval?: number;
  twapNextExecTime?: number;
  twapEndTime?: number;

  conditionalExecType?: "MARKET" | "LIMIT";
  conditionalLimitPrice?: number;

  /**
   * 随这张单一起下的止盈 / 止损——**成交时**才变成减仓单。
   *
   * 此前面板把止盈价塞进 stopPrice、把类型改写成 LIMIT_TP_SL / MARKET_TP_SL，
   * 于是引擎把**止盈价当成开仓触发价**：市价单不再立刻成交，而是挂在止盈价上开仓
   * （Index.tsx:1136-1144）；限价单则要等价格先摸到止盈价才肯激活
   * （Index.tsx:1149-1159）。两种都不是用户勾那个框时想要的东西。
   * 分开存,开仓价与保护价从此不再共用一个字段。
   */
  attachedTpPrice?: number;
  attachedSlPrice?: number;
  attachedTpSlPercentage?: number;

  /** Trigger direction locked at placement: UP = triggerPrice > currentPrice, DOWN = triggerPrice < currentPrice */
  triggerDirection?: "UP" | "DOWN";
  /** Locked comparison operator for conditional orders, derived from triggerPrice vs currentPrice at placement */
  operator?: TriggerOperator;

  parentScaledId?: string;

  /** Reduce-only flag — TP/SL orders that only close existing positions */
  reduceOnly?: boolean;
  /** Symbol of the position this TP/SL order targets */
  reduceSymbol?: string;
  /** Side of the position this TP/SL order targets (opposite of close direction) */
  reducePositionSide?: OrderSide;
  /** Hard binding to a specific position id — TP/SL only acts on this one */
  linkedPositionId?: string;
  /** TP or SL category (used for OCO + UI display) */
  reduceKind?: "TP" | "SL";
  /** Percentage (0-100] of the linked position to close on trigger */
  reducePercentage?: number;
}

/**
 * Snapshot of a pending order captured at the moment it is cancelled.
 * Cancelling normally just deletes the order from `ordersMap`; we persist this
 * so campaign reviews can list 反向对冲挂单 (委托价 / 委托时间 / 取消时间).
 */
export interface CancelledOrderSnapshot {
  id: string;
  symbol: string;
  side: OrderSide;
  /** Original order type, kept so campaign yellow layers can exclude TP/SL close orders. */
  type?: OrderType;
  /** True for reduce-only TP/SL close orders; yellow campaign layers only use opening orders. */
  reduceOnly?: boolean;
  reduceKind?: "TP" | "SL" | null;
  linkedPositionId?: string | null;
  price: number;
  quantity: number;
  leverage: number;
  settlementMode?: SettlementMode;
  settlementAsset?: string;
  contractSizeUsd?: number;
  contracts?: number;
  /** 委托时间 (sim/K-line clock, same as PendingOrder.createdAt) */
  createdAt: number;
  /** 取消时间 (sim/K-line clock) */
  cancelledAt: number;
}

/**
 * Snapshot of a pending order captured at the moment it is triggered/filled.
 * The original order disappears from `ordersMap` after fill; keeping this lets
 * campaign charts draw the pre-trigger pending segment from the real order time.
 */
export interface FilledOrderSnapshot {
  id: string;
  symbol: string;
  side: OrderSide;
  /** Original order type, kept so campaign yellow layers can exclude TP/SL close orders. */
  type?: OrderType;
  /** True for reduce-only TP/SL close orders; yellow campaign layers only use opening orders. */
  reduceOnly?: boolean;
  reduceKind?: "TP" | "SL" | null;
  linkedPositionId?: string | null;
  /** Actual fill price after slippage/maker handling. */
  price: number;
  /** Raw trigger price from the k-line condition before slippage. */
  triggerPrice: number;
  quantity: number;
  leverage: number;
  settlementMode?: SettlementMode;
  settlementAsset?: string;
  contractSizeUsd?: number;
  contracts?: number;
  /** 委托时间 (sim/K-line clock, same as PendingOrder.createdAt) */
  createdAt: number;
  /** 触发/成交时间 (sim/K-line clock) */
  filledAt: number;
  positionId?: string;
}

/**
 * One reverse-hedge order row shown in a campaign's 反向对冲挂单 section.
 * 三态：cancelled=已撤销、pending=仍挂单中、triggered=已触发成交。
 * 字段语义随状态：
 *  - cancelled/pending: price=委托价, createdAt=委托时间, cancelledAt=撤销时间(pending 为 null)。
 *  - triggered:        price=原委托触发价, fillPrice=成交价, createdAt=委托时间,
 *                      triggeredAt=触发时间, cancelledAt=平仓时间(未平为 null)。
 */
export interface CampaignReverseHedgeOrder {
  id: string;
  /** 成交后对应的 trade_history record id；用于在 Legs 列表里精确归属到对应 leg。 */
  tradeRecordId?: string | null;
  side: OrderSide;
  /** Original pending/trigger price. Profit-capture risk must use this value, never the slipped fill. */
  price: number;
  /** Actual fill after slippage when the order triggered. */
  fillPrice?: number | null;
  createdAt: number;
  triggeredAt?: number | null;
  cancelledAt: number | null;
  status: 'cancelled' | 'pending' | 'triggered';
}

interface TriggerRange {
  high: number;
  low: number;
}

export interface Position {
  id: string;
  side: OrderSide;
  entryPrice: number;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
  settlementMode?: SettlementMode;
  settlementAsset?: string;
  contractSizeUsd?: number;
  contracts?: number;
  margin: number;
  /** Coin-settled margin in the settlement asset; margin remains USD-equivalent for account equity. */
  marginCoin?: number;
  /** For isolated positions: the segregated margin assigned to this position */
  isolatedMargin?: number;
  /** Simulated clock time when this position was opened */
  openTime?: number;
  /**
   * 开仓那一刻的杠杆，**永不重述**。
   *
   * leverage 会被「调整杠杆」改写，而平仓记录写的是 pos.leverage——
   * 于是持仓中途提一次杠杆再平仓，战役的「初始杠杆」会被**追溯改写**成提高后的值，
   * 连带 R 倍数与预期最大亏损全部虚高。旧数据没有这个字段时退回 leverage。
   */
  openLeverage?: number;
  /**
   * 构成这个仓位的每一笔成交。**fills[0].id 恒等于 position.id**。
   *
   * 同标的同方向的成交会合并成一个仓位（币安单向持仓模式就是这样），
   * 但「这一笔加仓自己是什么时候、以什么价开的」不能因此丢掉——
   * 战役页的腿、开仓时刻、快照都要靠它。合并只改风控口径，不抹掉历史。
   *
   * 旧数据没有这个字段，读的时候一律按 [{ id, openTime, entryPrice, units }] 推导，
   * 不做持久化迁移（positions_map 是云同步的，没有版本号，坏迁移不可回滚）。
   */
  fills?: PositionFill[];
}

export interface PositionFill {
  id: string;
  openTime: number;
  entryPrice: number;
  /** 该笔成交的计量单位数：币本位为张数，U 本位为币数。 */
  units: number;
  /**
   * 该笔成交**开仓时**的杠杆。持仓期内提过杠杆之后，合并仓位的 openLeverage
   * 一路继承最早那笔的值，加仓那一片就会顶着主力的杠杆写进历史，R 倍数随之失真。
   * 旧数据没有这个字段时退回仓位级的 openLeverage ?? leverage。
   */
  openLeverage?: number;
}

export interface TradeRecord {
  id: string;
  /** Position that produced this close/funding/liquidation record when known. */
  /**
   * 这一片属于**哪一笔成交**。
   *
   * 同向成交会合并成一个仓位（币安单向持仓），但平仓时按每笔成交各写一条记录——
   * 否则加仓在战役里会整条消失,主力还会顶着一个混合开仓价。
   * positionId 仍然是**存活的那个合并仓位**;fillId 才是这一片自己的身份。
   * 旧记录没有这个字段,一律退回按 positionId 归属。
   */
  fillId?: string;
  positionId?: string | null;
  symbol: string;
  side: OrderSide;
  type: OrderType | "FUNDING";
  action: "OPEN" | "CLOSE" | "LIQUIDATION" | "FUNDING";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
  settlementMode?: SettlementMode;
  settlementAsset?: string;
  contractSizeUsd?: number;
  contracts?: number;
  notionalUsd?: number;
  pnlCoin?: number;
  feeCoin?: number;
  pnl: number;
  fee: number;
  slippage: number;
  openTime: number;
  closeTime: number;
  /**
   * 真实钱包时钟（Date.now()）下的「操作时刻」——交易员实际下这一刀的现实时间，
   * 与 openTime/closeTime 的模拟 K 线时间严格区分。仅本字段上线后发生的成交才有；
   * 老记录为 undefined（界面显示「—」，绝不退回模拟时间冒充真实操作时间）。
   */
  closedRealAt?: number;
  /** How the position was closed. Manual for user-initiated; sl/tp1-3 for triggered TP/SL; liquidation for forced close. */
  exit_method?: "manual" | "sl" | "tp1" | "tp2" | "tp3" | "liquidation";
  /** User-written reason recorded after the close, used for post-trade review and playback. */
  exit_reason_text?: string;
}

export const MAINTENANCE_MARGIN_RATE = 0.004; // 0.4% — strict MM rate (MMR) per tier default
export const LIQUIDATION_FEE_RATE = 0.005; // 0.5%
export const FUNDING_RATE = 0.0001; // 0.01% per 8h settlement

// Tiered leverage limits (based on notional value in USDT)
export const LEVERAGE_TIERS = [
  { maxNotional: 50_000, maxLeverage: 125 },
  { maxNotional: 250_000, maxLeverage: 50 },
  { maxNotional: 1_000_000, maxLeverage: 20 },
  { maxNotional: Infinity, maxLeverage: 10 },
];

/** Get max allowed leverage for a given notional value */
export function getMaxLeverageForNotional(notional: number): number {
  for (const tier of LEVERAGE_TIERS) {
    if (notional <= tier.maxNotional) return tier.maxLeverage;
  }
  return 10;
}

/** Get leverage tier info string */
export function getLeverageTierInfo(notional: number): { maxLeverage: number; tierLabel: string } {
  for (const tier of LEVERAGE_TIERS) {
    if (notional <= tier.maxNotional) {
      const label =
        tier.maxNotional === Infinity ? `> 1,000,000 USDT` : `0 - ${tier.maxNotional.toLocaleString()} USDT`;
      return { maxLeverage: tier.maxLeverage, tierLabel: label };
    }
  }
  return { maxLeverage: 10, tierLabel: "> 1,000,000 USDT" };
}

/** Lock the trigger operator at placement time using the then-current close price. */
export function getTriggerOperator(triggerPrice: number, currentPrice: number): TriggerOperator {
  return triggerPrice > currentPrice ? ">=" : "<=";
}

/** Intrabar trigger validation using kline extremes instead of latest close. */
export function isTriggerConditionMet(operator: TriggerOperator, triggerPrice: number, kline: TriggerRange): boolean {
  return operator === ">=" ? kline.high >= triggerPrice : kline.low <= triggerPrice;
}

// Funding settlement times in UTC hours
export const FUNDING_HOURS = [0, 8, 16];

/**
 * Volatility-adjusted slippage for market/taker orders.
 * Base slippage = 0.05% + notional-scaled component.
 * If kline volatility (High-Low)/Close > 2%, slippage doubles (adverse market).
 */
export function calcSlippage(
  price: number,
  notionalValue: number,
  side: OrderSide,
  klineVolatility?: { high: number; low: number; close: number },
): number {
  let slippageRate = 0.0001 + notionalValue / 5_000_000_000;
  // Volatility doubling: if kline range > 2% of close, market is adverse
  if (klineVolatility && klineVolatility.close > 0) {
    const range = (klineVolatility.high - klineVolatility.low) / klineVolatility.close;
    if (range > 0.02) slippageRate *= 2;
  }
  return side === "LONG" ? price * (1 + slippageRate) : price * (1 - slippageRate);
}

export const TAKER_FEE = 0.0004; // 0.04%
export const MAKER_FEE = 0.0002; // 0.02%

export function calcUnrealizedPnl(pos: Position, currentPrice: number): number {
  if (pos.settlementMode === "coin") {
    const contracts = Math.max(0, Math.round(pos.contracts ?? pos.quantity ?? 0));
    const contractSizeUsd = pos.contractSizeUsd ?? 10;
    if (!contracts || !(pos.entryPrice > 0) || !(currentPrice > 0)) return 0;
    const coinPnl = pos.side === "LONG"
      ? contracts * contractSizeUsd * (1 / pos.entryPrice - 1 / currentPrice)
      : contracts * contractSizeUsd * (1 / currentPrice - 1 / pos.entryPrice);
    return coinPnl * currentPrice;
  }
  if (pos.side === "LONG") {
    return (currentPrice - pos.entryPrice) * pos.quantity;
  }
  return (pos.entryPrice - currentPrice) * pos.quantity;
}

export function calcROE(pos: Position, currentPrice: number): number {
  const pnl = calcUnrealizedPnl(pos, currentPrice);
  // ROE 分母统一固定为初始保证金 = 名义价值@开仓 / 杠杆（不含追加保证金），U本位/币本位同一口径。
  const notionalAtEntry = pos.settlementMode === "coin"
    ? Math.max(0, Math.round(pos.contracts ?? pos.quantity ?? 0)) * (pos.contractSizeUsd ?? 10)
    : pos.quantity * pos.entryPrice;
  const initialMargin = pos.leverage > 0 ? notionalAtEntry / pos.leverage : 0;
  return initialMargin > 0 ? (pnl / initialMargin) * 100 : 0;
}

/**
 * Strict U-margined liquidation price (industry-standard formula).
 *
 *   PositionNotional = quantity * entryPrice
 *   MaintenanceMargin (MM) = PositionNotional * MMR
 *
 *   LONG : liqPrice = (PositionNotional - margin + MM) / quantity
 *   SHORT: liqPrice = (PositionNotional + margin - MM) / quantity
 *
 * No zero-clamp: returns the true mathematical value, including negatives, so
 * over-collateralized positions truthfully show their "buffer below zero".
 * Only NaN / non-finite results are guarded (returns NaN to signal invalid input).
 */
export function calcLiquidationPrice(pos: Position): number {
  if (!pos.quantity || pos.quantity <= 0 || !isFinite(pos.entryPrice)) return NaN;

  const mmr = MAINTENANCE_MARGIN_RATE;
  if (pos.settlementMode === "coin") {
    const contracts = Math.max(0, Math.round(pos.contracts ?? pos.quantity ?? 0));
    const contractSizeUsd = pos.contractSizeUsd ?? 10;
    if (!contracts || !(pos.entryPrice > 0)) return NaN;
    const notionalUsd = contracts * contractSizeUsd;
    const marginCoin = pos.marginCoin ?? (pos.margin / pos.entryPrice);
    if (!(marginCoin > 0)) return NaN;

    let liq: number;
    if (pos.side === "LONG") {
      liq = (notionalUsd * (1 + mmr)) / (marginCoin + notionalUsd / pos.entryPrice);
    } else {
      const denominator = notionalUsd / pos.entryPrice - marginCoin;
      liq = denominator > 0 ? (notionalUsd * (1 - mmr)) / denominator : Infinity;
    }
    return Number.isFinite(liq) ? liq : NaN;
  }
  const positionNotional = pos.quantity * pos.entryPrice;
  const mm = positionNotional * mmr;

  let liq: number;
  if (pos.marginMode === "isolated" && pos.isolatedMargin != null) {
    const margin = pos.isolatedMargin;
    if (pos.side === "LONG") {
      liq = (positionNotional - margin + mm) / pos.quantity;
    } else {
      liq = (positionNotional + margin - mm) / pos.quantity;
    }
  } else {
    // Cross mode: derive an effective margin from leverage, then apply the same formula.
    const margin = positionNotional / pos.leverage;
    if (pos.side === "LONG") {
      liq = (positionNotional - margin + mm) / pos.quantity;
    } else {
      liq = (positionNotional + margin - mm) / pos.quantity;
    }
  }
  if (!isFinite(liq)) return NaN;
  return liq;
}

export function calcFee(price: number, quantity: number, isMaker: boolean): number {
  return price * quantity * (isMaker ? MAKER_FEE : TAKER_FEE);
}

// Order type display info
export const ORDER_TYPE_INFO: { value: OrderType; label: string; desc: string }[] = [
  { value: "LIMIT", label: "限价单", desc: "Limit Order" },
  { value: "POST_ONLY", label: "只做Maker", desc: "Post Only" },
  { value: "MARKET", label: "市价单", desc: "Market Order" },
  { value: "LIMIT_TP_SL", label: "限价止盈止损", desc: "Limit TP/SL" },
  { value: "MARKET_TP_SL", label: "市价止盈止损", desc: "Market TP/SL" },
  { value: "CONDITIONAL", label: "条件委托", desc: "Conditional Order" },
  { value: "TRAILING_STOP", label: "跟踪委托", desc: "Trailing Stop Order" },
  { value: "TWAP", label: "分时委托", desc: "TWAP" },
  { value: "SCALED", label: "分段订单", desc: "Scaled Order" },
];

/** Get price tick size based on price magnitude */
export function getPriceStep(price: number): number {
  if (price > 10000) return 0.1;
  if (price > 1000) return 0.01;
  if (price > 100) return 0.001;
  if (price > 10) return 0.0001;
  return 0.00001;
}
