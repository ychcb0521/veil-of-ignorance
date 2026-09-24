/**
 * 这一单一成交，开出来的仓位（或并进去之后的整个仓位）在那一刻的标记价上是不是就已经够得着强平。
 *
 * 两种来路，都只在「无限制」持仓限制模式下够得着（币安标准的分层上限把规模挡在前面）：
 *   · 滑点把成交价推过了它自己的强平价：滑点 = 0.01% + 名义 ÷ 50 亿（types/trading.calcSlippage），
 *     150x 按 0.4% 维持保证金时强平价离开仓价只有 1/150 − 0.4% ≈ 0.27%——名义过了约 1,280 万 USDT，
 *     这一单的成交价就已经在强平价外面，下一根 K 线就被强平；
 *   · 并进按币安分层计的现有仓位（positionRiskModel.mergeRiskBlocked 里「无限制」那一格）：
 *     整仓按分层计维持保证金，总名义跨进更高的档，合并后的整个仓位一开出来就在强平价外面。
 *
 * 只给下单面板在按钮前标红用，**不拦单**：无限制模式不设任何上限，规模是使用者自己选的。
 * 判据与引擎逐仓强平同一个（liquidationGuards.evaluateIsolatedLiquidation）：权益 = 保证金（按标记价）+ 浮盈，
 * 权益 ≤ 维持保证金即强平。全仓按共用的保证金池判，这里不预判；算不清（没有价、坏数）一律不报，不拿坏数唬人。
 */
import type { Position } from '@/types/trading';
import { calcLiquidationPrice, calcUnrealizedPnl } from '@/types/trading';
import { positionMarginUsdAtMark } from '@/lib/liquidationGuards';
import { positionMaintenanceMarginUsd } from '@/lib/positionRiskModel';
import { isPositionOpen, mergeFilledPosition } from '@/lib/tradingSettlement';

export interface OpeningLiquidation {
  /** 成交之后要判的那个仓位：并进现有仓位就是合并后的整个仓位，否则是这一笔自己。 */
  position: Position;
  /** 是不是并进了现有仓位。 */
  merged: boolean;
  /** 这一笔的成交价（含滑点）。 */
  fillPrice: number;
  /** 判定用的标记价（立即成交的单是现价，条件单是触发价）。 */
  markPrice: number;
  /** 那个仓位的强平价（算不出为 NaN）。 */
  liquidationPrice: number;
  equityUsd: number;
  maintenanceUsd: number;
}

/**
 * fill 按引擎的口径造（tradingSettlement.executeSettlementFill：含滑点后的开仓价、保证金、来源戳），
 * open 是这个标的此刻的持仓；返回 null = 开出来不会当场够得着强平（或算不清）。
 */
export function openingLiquidation(
  symbol: string,
  open: readonly Position[],
  fill: Position,
  markPrice: number,
): OpeningLiquidation | null {
  if (!(markPrice > 0) || !isPositionOpen(fill)) return null;
  const merged = mergeFilledPosition(symbol, open.filter(isPositionOpen), fill);
  const position = merged.absorbedFillId ? merged.survivor : fill;
  if (position.marginMode !== 'isolated' || position.isolatedMargin == null) return null;
  const equityUsd = positionMarginUsdAtMark(position, markPrice) + calcUnrealizedPnl(position, markPrice);
  const maintenanceUsd = positionMaintenanceMarginUsd(symbol, position, markPrice);
  if (!Number.isFinite(equityUsd) || !Number.isFinite(maintenanceUsd)) return null;
  if (!(equityUsd <= maintenanceUsd)) return null;
  return {
    position,
    merged: merged.absorbedFillId != null,
    fillPrice: fill.entryPrice,
    markPrice,
    liquidationPrice: calcLiquidationPrice(position, symbol),
    equityUsd,
    maintenanceUsd,
  };
}
