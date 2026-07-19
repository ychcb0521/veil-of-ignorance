import { calcUnrealizedPnl, type Position } from '@/types/trading';

type PositionsBySymbol = Record<string, Position[]>;
type PricesBySymbol = Record<string, number>;

/**
 * Current total account equity shown by the trading account surfaces.
 *
 * Wallet balance already reflects reserved margin. Adding every open
 * position's unrealized P&L therefore yields the live total-account value.
 */
export function computeCurrentAccountEquity(
  balance: number,
  positionsMap: PositionsBySymbol,
  priceMap: PricesBySymbol,
): number {
  let equity = Number.isFinite(balance) ? balance : 0;

  for (const [symbol, positions] of Object.entries(positionsMap)) {
    for (const position of positions) {
      const mappedPrice = Number(priceMap[symbol]);
      const markPrice = Number.isFinite(mappedPrice) && mappedPrice > 0
        ? mappedPrice
        : position.entryPrice;
      const pnl = calcUnrealizedPnl(position, markPrice);
      if (Number.isFinite(pnl)) equity += pnl;
    }
  }

  return Number.isFinite(equity) ? Math.max(0, equity) : 0;
}
