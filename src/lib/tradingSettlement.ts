import {
  calcFee,
  calcSlippage,
  calcUnrealizedPnl,
  MAKER_FEE,
  TAKER_FEE,
  type MarginMode,
  type OrderSide,
  type Position,
  type SettlementMode,
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
