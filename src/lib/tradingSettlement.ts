import {
  calcFee,
  calcSlippage,
  calcUnrealizedPnl,
  MAINTENANCE_MARGIN_RATE,
  MAKER_FEE,
  TAKER_FEE,
  type MarginMode,
  type OrderSide,
  type Position,
  type PositionFill,
  type SettlementMode,
  type TradeRecord,
} from "@/types/trading";
import {
  coinAmountToUsd,
  coinFeeAmount,
  coinMarginAmount,
  coinNotionalUsd,
  coinPnlAmount,
  getCoinContractSizeUsd,
  getCoinContracts,
  getSettlementAsset,
  roundCoinContracts,
} from "@/lib/coinMargined";

export const POSITION_DUST_EPSILON = 1e-6;

type SettlementInstrument = {
  settlementMode?: SettlementMode | null;
  settlementAsset?: string | null;
  contractSizeUsd?: number | null;
  contracts?: number | null;
  quantity?: number | null;
};

export type SettlementOrderLike = SettlementInstrument & {
  side: OrderSide;
  quantity: number;
  leverage: number;
  marginMode: MarginMode;
};

export function isCoinSettled(item?: { settlementMode?: SettlementMode | null } | null): boolean {
  return item?.settlementMode === "coin";
}

export function normalizeSettlementOrder<T extends SettlementOrderLike>(symbol: string, order: T): T {
  if (!isCoinSettled(order)) {
    return {
      ...order,
      settlementMode: "usdt",
      settlementAsset: "USDT",
      contractSizeUsd: undefined,
      contracts: undefined,
    } as T;
  }

  const contractSizeUsd = getCoinContractSizeUsd(symbol, order);
  const contracts = roundCoinContracts(Number(order.contracts ?? order.quantity));
  return {
    ...order,
    settlementMode: "coin",
    settlementAsset: order.settlementAsset ?? getSettlementAsset(symbol),
    contractSizeUsd,
    contracts,
    quantity: contracts,
  } as T;
}

export function getPositionUnits(item?: SettlementInstrument | null): number {
  if (!item) return 0;
  return isCoinSettled(item) ? getCoinContracts(item) : Number(item.quantity ?? 0);
}

export function isPositionOpen(item?: SettlementInstrument | null): boolean {
  return getPositionUnits(item) > POSITION_DUST_EPSILON;
}

export function getPositionNotionalUsd(
  symbol: string,
  item: SettlementInstrument & { entryPrice?: number | null },
  price?: number,
): number {
  if (isCoinSettled(item)) {
    return coinNotionalUsd(getCoinContracts(item), getCoinContractSizeUsd(symbol, item));
  }
  const px = Number(price ?? item.entryPrice ?? 0);
  return Number(item.quantity ?? 0) * px;
}

/**
 * ROE% = 未实现盈亏(USD) / 初始保证金(USD)。
 * 初始保证金 = 名义价值@开仓 / 杠杆（固定不变、不含追加保证金），U本位与币本位统一同一口径。
 */
export function settlementRoePct(pnlUsd: number, initialMarginUsd: number): number {
  return initialMarginUsd > 0 ? (pnlUsd / initialMarginUsd) * 100 : 0;
}

/**
 * 结算口径下的保证金比率% = 维持保证金 / 保证金余额（与币安一致：亏损越大越逼近 100% = 爆仓）。
 * 维持保证金 = 标记价名义价值 × 维持保证金率（notionalUsdAtMark 对 U本位/币本位都是 USD 名义）。
 * 保证金余额 = 按标记价估值的保证金 + 未实现盈亏(USD)；币本位的保证金需先按现价折算（与 ROE 同口径）。
 * 余额 ≤ 0 视为已触及强平，返回 100。
 */
export function settlementMarginRatioPct(
  notionalUsdAtMark: number,
  marginUsdValuedAtMark: number,
  pnlUsd: number,
): number {
  const marginBalance = marginUsdValuedAtMark + pnlUsd;
  return marginBalance > 0 ? (notionalUsdAtMark * MAINTENANCE_MARGIN_RATE / marginBalance) * 100 : 100;
}

export function getSettlementMarginParts(symbol: string, order: SettlementOrderLike, price: number) {
  if (isCoinSettled(order)) {
    const contracts = getCoinContracts(order);
    const contractSizeUsd = getCoinContractSizeUsd(symbol, order);
    const marginCoin = coinMarginAmount(contracts, price, order.leverage, contractSizeUsd);
    return { marginUsd: coinAmountToUsd(marginCoin, price), marginCoin };
  }
  return { marginUsd: (order.quantity * price) / order.leverage, marginCoin: undefined };
}

export function getSettlementFeeParts(
  symbol: string,
  item: SettlementOrderLike | Position,
  price: number,
  isMaker: boolean,
) {
  if (isCoinSettled(item)) {
    const feeRate = isMaker ? MAKER_FEE : TAKER_FEE;
    const feeCoin = coinFeeAmount(
      getCoinContracts(item),
      price,
      feeRate,
      getCoinContractSizeUsd(symbol, item),
    );
    return { feeUsd: coinAmountToUsd(feeCoin, price), feeCoin };
  }
  return { feeUsd: calcFee(price, Number(item.quantity ?? 0), isMaker), feeCoin: undefined };
}

export function applySettlementSlippage(
  symbol: string,
  price: number,
  order: SettlementOrderLike,
  isMaker: boolean,
) {
  if (isMaker) return { fillPrice: price, slippageUsd: 0 };

  const notionalUsd = getPositionNotionalUsd(symbol, order, price);
  const fillPrice = calcSlippage(price, notionalUsd, order.side);
  if (isCoinSettled(order)) {
    const slipCoin = Math.abs(
      coinPnlAmount(
        order.side,
        getCoinContracts(order),
        price,
        fillPrice,
        getCoinContractSizeUsd(symbol, order),
      ),
    );
    return { fillPrice, slippageUsd: coinAmountToUsd(slipCoin, fillPrice) };
  }
  return { fillPrice, slippageUsd: Math.abs(fillPrice - price) * order.quantity };
}

export function executeSettlementFill(
  symbol: string,
  rawPrice: number,
  order: SettlementOrderLike,
  isMaker: boolean,
  openTime = 0,
) {
  const normalized = normalizeSettlementOrder(symbol, order);
  const { fillPrice, slippageUsd } = applySettlementSlippage(symbol, rawPrice, normalized, isMaker);
  const { feeUsd, feeCoin } = getSettlementFeeParts(symbol, normalized, fillPrice, isMaker);
  const { marginUsd, marginCoin } = getSettlementMarginParts(symbol, normalized, fillPrice);

  const position: Position = {
    id: crypto.randomUUID(),
    side: normalized.side,
    entryPrice: fillPrice,
    quantity: normalized.quantity,
    leverage: normalized.leverage,
    // 开仓杠杆快照：leverage 会被「调整杠杆」改写，这个不会。
    openLeverage: normalized.leverage,
    marginMode: normalized.marginMode,
    settlementMode: normalized.settlementMode ?? "usdt",
    settlementAsset: normalized.settlementAsset ?? "USDT",
    contractSizeUsd: normalized.contractSizeUsd ?? undefined,
    contracts: normalized.contracts ?? undefined,
    margin: marginUsd,
    marginCoin,
    isolatedMargin: normalized.marginMode === "isolated" ? marginUsd : undefined,
    openTime,
  };

  return { fee: feeUsd, feeCoin, margin: marginUsd, marginCoin, slippage: slippageUsd, position };
}

export function closeSettlementPosition(
  symbol: string,
  pos: Position,
  rawPrice: number,
  closeUnits: number,
  isMaker: boolean,
) {
  const orderLike = normalizeSettlementOrder(symbol, {
    ...pos,
    quantity: closeUnits,
    contracts: isCoinSettled(pos) ? closeUnits : undefined,
  });
  const closeSide: OrderSide = pos.side === "LONG" ? "SHORT" : "LONG";
  const closeOrder = { ...orderLike, side: closeSide };
  const { fillPrice, slippageUsd } = applySettlementSlippage(symbol, rawPrice, closeOrder, isMaker);
  const { feeUsd, feeCoin } = getSettlementFeeParts(symbol, closeOrder, fillPrice, isMaker);

  if (isCoinSettled(pos)) {
    const pnlCoin = coinPnlAmount(
      pos.side,
      getCoinContracts(orderLike),
      pos.entryPrice,
      fillPrice,
      getCoinContractSizeUsd(symbol, pos),
    );
    return {
      fillPrice,
      slippageUsd,
      pnlUsd: coinAmountToUsd(pnlCoin, fillPrice),
      pnlCoin,
      feeUsd,
      feeCoin,
      notionalUsd: getPositionNotionalUsd(symbol, orderLike, fillPrice),
    };
  }

  return {
    fillPrice,
    slippageUsd,
    pnlUsd: calcUnrealizedPnl({ ...pos, quantity: closeUnits }, fillPrice),
    pnlCoin: undefined,
    feeUsd,
    feeCoin,
    notionalUsd: getPositionNotionalUsd(symbol, orderLike, fillPrice),
  };
}

export interface SettledPositionClose {
  closeQty: number;
  pct: number;
  remainingUnits: number;
  willFullyClose: boolean;
  returnedMargin: number;
  record: TradeRecord;
  fillPrice: number;
  netPnl: number;
}

export function settlePositionClose(
  symbol: string,
  pos: Position,
  rawPrice: number,
  closeUnits: number,
  closeTime: number,
  exitMethod: NonNullable<TradeRecord["exit_method"]> = "manual",
  closedRealAt = Date.now(),
): SettledPositionClose | null {
  const totalUnits = getPositionUnits(pos);
  if (totalUnits <= POSITION_DUST_EPSILON) return null;
  if (!Number.isFinite(rawPrice) || rawPrice <= 0 || !Number.isFinite(closeUnits)) return null;

  const boundedCloseUnits = Math.min(totalUnits, Math.max(0, closeUnits));
  const closeQty = isCoinSettled(pos)
    ? Math.min(totalUnits, Math.max(1, Math.round(boundedCloseUnits)))
    : boundedCloseUnits;
  if (closeQty <= POSITION_DUST_EPSILON) return null;

  const pct = totalUnits > 0 ? closeQty / totalUnits : 1;
  const remainingUnits = totalUnits - closeQty;
  const willFullyClose = pct >= 1 || remainingUnits <= POSITION_DUST_EPSILON;
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
  const returnedMargin = pos.marginMode === "isolated" && closedIsoMargin != null
    ? closedIsoMargin + pnlUsd - feeUsd
    : closedMargin + pnlUsd - feeUsd;
  const netPnl = pnlUsd - feeUsd;

  return {
    closeQty,
    pct,
    remainingUnits,
    willFullyClose,
    returnedMargin,
    fillPrice,
    netPnl,
    record: {
      id: crypto.randomUUID(),
      positionId: pos.id,
      symbol,
      side: pos.side,
      type: "MARKET",
      action: "CLOSE",
      entryPrice: pos.entryPrice,
      exitPrice: fillPrice,
      quantity: closeQty,
      contracts: isCoinSettled(pos) ? closeQty : undefined,
      leverage: pos.openLeverage ?? pos.leverage,
      pnl: netPnl,
      pnlCoin,
      feeCoin,
      fee: feeUsd,
      slippage: slippageUsd,
      notionalUsd,
      settlementMode: pos.settlementMode,
      settlementAsset: pos.settlementAsset,
      contractSizeUsd: pos.contractSizeUsd,
      openTime: pos.openTime || 0,
      closeTime,
      exit_method: exitMethod,
      closedRealAt,
    },
  };
}

export function scaleSettlementPosition(pos: Position, remainingUnits: number): Position {
  const totalUnits = getPositionUnits(pos);
  const pct = totalUnits > 0 ? remainingUnits / totalUnits : 0;
  if (isCoinSettled(pos)) {
    return {
      ...pos,
      quantity: remainingUnits,
      contracts: remainingUnits,
      margin: pos.margin * pct,
      marginCoin: pos.marginCoin == null ? undefined : pos.marginCoin * pct,
      isolatedMargin: pos.isolatedMargin == null ? undefined : pos.isolatedMargin * pct,
    };
  }
  return {
    ...pos,
    quantity: remainingUnits,
    margin: pos.margin * pct,
    isolatedMargin: pos.isolatedMargin == null ? undefined : pos.isolatedMargin * pct,
  };
}

export function formatSettlementQuantity(item: SettlementInstrument, symbol: string): string {
  if (isCoinSettled(item)) return `${getCoinContracts(item)} 张`;
  return `${Number(item.quantity ?? 0).toFixed(4)} ${getSettlementAsset(symbol)}`;
}


/**
 * 同标的同方向的成交并成**一个**仓位——币安单向持仓模式就是这样。
 *
 * 事故（COAIUSDT 2026-06-13，10x 逐仓）：
 *   主力  开 0.538058，自身强平价 0.486404
 *   加仓1 开 0.604447，自身强平价 0.546420
 *   价格到 0.542220 —— 低于加仓自己的强平价、却远高于主力的，**加仓被单独打掉，主力活着**。
 *   合并后加权开仓价 0.581748、强平价 0.525900，0.542220 根本不该触发任何强平。
 *
 * 缺陷讲清楚就是：逐仓那一支按 `min(各腿 equity − maint) ≤ 0` 判，
 * 而单向持仓应当按 `Σ(equity − maint) ≤ 0` 判。健康那一腿的盈余本来可以扛住加仓，
 * 分开算就等于不让它扛。
 *
 * **强平公式一个字都不用改**——它的每一个输入都是可加的。改的是喂给它的粒度。
 */
export interface PositionMergeResult {
  positions: Position[];
  survivor: Position;
  /** 被吞并的那笔成交的 id；为 null 表示没有合并（新开了一个仓位）。 */
  absorbedFillId: string | null;
  /** 没有合并的原因，用来向用户解释「N 笔合并」这个徽标。 */
  blockedBy: 'leverage' | 'marginMode' | 'settlement' | null;
}

function fillsOf(p: Position, symbol: string): PositionFill[] {
  if (p.fills && p.fills.length > 0) return p.fills;
  // 旧仓位没有这个字段：按纯推导补出来，不做持久化迁移。
  return [{
    id: p.id,
    openTime: Number(p.openTime) > 0 ? Number(p.openTime) : 0,
    entryPrice: p.entryPrice,
    units: getPositionUnits(p),
  }];
}

/** 合并键。side 之外还必须比这三样，否则会把两种物理含义不同的仓位缝在一起。 */
function mergeBlocker(a: Position, b: Position): PositionMergeResult['blockedBy'] {
  // 保证金模式：强平公式在这上面分两支，引擎也分两轮跑。
  if (a.marginMode !== b.marginMode) return 'marginMode';
  // 结算方式 / 面值：quantity 在两种模式下一个是币、一个是张。
  if ((a.settlementMode ?? 'usdt') !== (b.settlementMode ?? 'usdt')) return 'settlement';
  if (Number(a.contractSizeUsd ?? 0) !== Number(b.contractSizeUsd ?? 0)) return 'settlement';
  /**
   * 杠杆不同**不合并**，而不是取加权。
   *
   * 每一处读 leverage 的地方形式都是「名义 ÷ 杠杆」，要保住的不变量是 Σ Nᵢ/Lᵢ；
   * 拒绝合并天然保住它，而取调和平均会把 leverage 变成小数，
   * 连带 ROE 的固定分母、界面上的「10x」都要跟着改——那是另一件事，不该搭这趟车。
   * 注意「取最大」是**错的**：1000@10x + 1000@5x 的初始保证金地板是 300，
   * 按最大算只有 200，用户会以为有 100 可以撤出来，撤完等于事后把 5x 那腿加到了 10x。
   */
  if (Number(a.leverage) !== Number(b.leverage)) return 'leverage';
  return null;
}

export function mergeFilledPosition(
  symbol: string,
  existing: Position[],
  fill: Position,
): PositionMergeResult {
  const open = existing.filter(isPositionOpen);
  const target = open.find(p => p.side === fill.side && mergeBlocker(p, fill) == null) ?? null;

  if (!target) {
    const sameSide = open.find(p => p.side === fill.side) ?? null;
    return {
      positions: [...open, { ...fill, fills: fillsOf(fill, symbol) }],
      survivor: fill,
      absorbedFillId: null,
      blockedBy: sameSide ? mergeBlocker(sameSide, fill) : null,
    };
  }

  const coin = isCoinSettled(target);
  const fills = [...fillsOf(target, symbol), ...fillsOf(fill, symbol)];

  /**
   * 加权开仓价。**U 本位与币本位是同一个式子**：Σ名义 ÷ Σ币量。
   *   U 本位 → 数量加权算术平均
   *   币本位 → 名义加权**调和**平均（按张数取算术平均是错的，
   *            两腿 1000@0.5 + 1000@0.6 会给出 0.55 而正解是 0.545455，
   *            在每一个价位上都差一个固定的币计盈亏）
   * 判据是「合并后的盈亏必须在**任意**价格上等于两腿之和」，不是在某一个价上对上。
   */
  const legs = [
    { coins: coinsAtEntry(symbol, target), entryPrice: target.entryPrice },
    { coins: coinsAtEntry(symbol, fill), entryPrice: fill.entryPrice },
  ];
  const totalCoins = legs.reduce((s, l) => s + l.coins, 0);
  const entryPrice = totalCoins > 0
    ? legs.reduce((s, l) => s + l.coins * l.entryPrice, 0) / totalCoins
    : target.entryPrice;

  const openTimes = fills.map(f => f.openTime).filter(t => t > 0);
  const survivor: Position = {
    ...target,
    // id 保留**最早**那一笔：挂在它上面的减仓单、日志的 trade_record_id 都指着它。
    id: target.id,
    entryPrice,
    quantity: Number(target.quantity) + Number(fill.quantity),
    contracts: coin
      ? Number(target.contracts ?? target.quantity) + Number(fill.contracts ?? fill.quantity)
      : target.contracts,
    margin: Number(target.margin) + Number(fill.margin),
    marginCoin: coin
      ? Number(target.marginCoin ?? 0) + Number(fill.marginCoin ?? 0)
      : target.marginCoin,
    isolatedMargin: target.isolatedMargin != null || fill.isolatedMargin != null
      ? Number(target.isolatedMargin ?? target.margin) + Number(fill.isolatedMargin ?? fill.margin)
      : undefined,
    // 最早的开仓时刻。绝不能落到 0——TradeRecord.openTime 写的是 `pos.openTime || 0`，
    // 而 0 会把战役的委托归属窗口变成 [1970, 平仓]。
    openTime: openTimes.length > 0 ? Math.min(...openTimes) : target.openTime,
    fills,
  };

  return {
    positions: open.map(p => (p.id === target.id ? survivor : p)),
    survivor,
    absorbedFillId: fill.id,
    blockedBy: null,
  };
}

/** 一笔仓位按**开仓价**折出的币量。币本位 = 张 × 面值 ÷ 开仓价；U 本位数量本身就是币量。 */
function coinsAtEntry(symbol: string, p: Position): number {
  if (!(p.entryPrice > 0)) return 0;
  return isCoinSettled(p)
    ? getPositionNotionalUsd(symbol, p, p.entryPrice) / p.entryPrice
    : Number(p.quantity) || 0;
}
