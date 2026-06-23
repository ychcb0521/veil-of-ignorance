import type { OrderSide } from '@/types/trading';

export type CoinLikeInstrument = {
  settlementMode?: 'usdt' | 'coin' | null;
  settlementAsset?: string | null;
  contractSizeUsd?: number | null;
  contracts?: number | null;
  quantity?: number | null;
};

export function getSettlementAsset(symbol: string): string {
  const normalized = (symbol || 'BTCUSDT').toUpperCase().replace(/[-_/]/g, '');
  const stripped = normalized
    .replace(/PERP$/, '')
    .replace(/USDT$/, '')
    .replace(/USDC$/, '')
    .replace(/BUSD$/, '')
    .replace(/USD$/, '');
  return stripped || 'BTC';
}

export function getCoinMarginedSymbol(symbol: string): string {
  return `${getSettlementAsset(symbol)}USD_PERP`;
}

export function getCoinMarginedContractSizeUsd(symbol: string): number {
  return getSettlementAsset(symbol) === 'BTC' ? 100 : 10;
}

export function getCoinContractSizeUsd(symbol: string, item?: CoinLikeInstrument | null): number {
  const value = Number(item?.contractSizeUsd);
  return Number.isFinite(value) && value > 0 ? value : getCoinMarginedContractSizeUsd(symbol);
}

export function roundCoinContracts(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 0;
}

export function getCoinContracts(item?: CoinLikeInstrument | null): number {
  return roundCoinContracts(Number(item?.contracts ?? item?.quantity ?? 0));
}

export function coinContractsFromUsdNotional(
  notionalUsd: number,
  symbol: string,
  contractSizeUsd = getCoinMarginedContractSizeUsd(symbol),
): number {
  return roundCoinContracts(Number(notionalUsd) / contractSizeUsd);
}

export function coinNotionalUsd(contracts: number, contractSizeUsd: number): number {
  return getCoinContracts({ contracts }) * contractSizeUsd;
}

export function coinMarginAmount(
  contracts: number,
  price: number,
  leverage: number,
  contractSizeUsd: number,
): number {
  if (!(price > 0) || !(leverage > 0)) return 0;
  return coinNotionalUsd(contracts, contractSizeUsd) / (price * leverage);
}

export function coinFeeAmount(
  contracts: number,
  price: number,
  feeRate: number,
  contractSizeUsd: number,
): number {
  if (!(price > 0)) return 0;
  return coinNotionalUsd(contracts, contractSizeUsd) * feeRate / price;
}

export function coinPnlAmount(
  side: OrderSide,
  contracts: number,
  entryPrice: number,
  exitPrice: number,
  contractSizeUsd: number,
): number {
  if (!(entryPrice > 0) || !(exitPrice > 0)) return 0;
  const notional = coinNotionalUsd(contracts, contractSizeUsd);
  return side === 'LONG'
    ? notional * (1 / entryPrice - 1 / exitPrice)
    : notional * (1 / exitPrice - 1 / entryPrice);
}

export function coinAmountToUsd(amount: number, price: number): number {
  return Number.isFinite(amount) && Number.isFinite(price) ? amount * price : 0;
}

export function formatCoinAmount(amount: number, asset: string, decimals = 6): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe.toFixed(decimals)} ${asset}`;
}

export function isCoinMarginedInstrument(item?: CoinLikeInstrument | null): boolean {
  return item?.settlementMode === 'coin';
}
