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
      leverage: pos.leverage,
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
