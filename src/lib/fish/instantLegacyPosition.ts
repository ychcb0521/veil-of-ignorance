import type { QualityGroup, QualityResult } from './quality';
import type { QualityAdditionFill } from './qualityAddition';
import { QUALITY_NOTIONAL } from './qualityPositionManagement';

// The archived engine measures exposure in lots of 100 USDT. Convert absolute addition
// instructions into those units before simulation, then convert its ledger back to USDT.
export function legacyPlanInEngineUnits(plan: QualityGroup, factor: number): QualityGroup {
  const addition = plan.addition;
  if (!addition || factor === 1) return plan;
  return { ...plan, addition: { ...addition,
    ...(addition.amountUsdt != null ? { amountUsdt: addition.amountUsdt / factor } : {}),
    ...(addition.quantity != null ? { quantity: addition.quantity / factor } : {}),
  } };
}

export function legacyResultInPositionUnits(result: QualityResult, notional: number): QualityResult {
  const factor = notional / QUALITY_NOTIONAL;
  if (factor === 1) return result;
  const convertFill = (fill: QualityAdditionFill): QualityAdditionFill => {
    const sizing = fill.sizing;
    return { ...fill, quantity: fill.quantity * factor, notional: fill.notional * factor,
      ...(sizing ? { sizing: { ...sizing, coinsBefore: sizing.coinsBefore * factor, baseCoins: sizing.baseCoins * factor,
        mirrorCoins: sizing.mirrorCoins * factor, mirrorUsed: sizing.mirrorUsed * factor,
        ...(sizing.mirrorAvailableBefore != null ? { mirrorAvailableBefore: sizing.mirrorAvailableBefore * factor } : {}),
        ...(sizing.coverageGap != null ? { coverageGap: sizing.coverageGap * factor } : {}),
      } } : {}),
    };
  };
  const converted = { ...result, initialNotional: notional };
  for (const key of ['pnl', 'mirrorRealizedPnl', 'remainingPnl', 'realizedPnl', 'totalInvested', 'remainingQuantity', 'remainingCost'] as const) {
    if (result[key] != null) converted[key] = result[key] * factor;
  }
  if (result.additionFill) converted.additionFill = convertFill(result.additionFill);
  if (result.additionFills) converted.additionFills = result.additionFills.map(convertFill);
  return converted;
}
