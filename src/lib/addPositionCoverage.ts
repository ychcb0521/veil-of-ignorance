/** Linear, coin-denominated add sizing. U is only the unit of price distance × coins. */
export interface AddPositionState {
  strategyCost: number;
  realAverage: number;
  coins: number;
  mirrorProfitRealized: number;
  mirrorProfitAvailable: number;
  mirrorProfitAllocated: number;
}

export interface AddPositionInput {
  currentPrice: number;
  support: number;
  state: AddPositionState;
  side?: 'LONG' | 'SHORT';
}

export type AddPositionError = 'invalid_input' | 'price_not_above_support' | 'mirror_profit_insufficient';

export interface AddPositionResult {
  error: AddPositionError | null;
  oldLossShortfall: number;
  safeDistance: number;
  riskDistance: number;
  oldCushion: number;
  baseCoins: number;
  mirrorCoins: number;
  addCoins: number;
  newCoins: number;
  realAverage: number;
  strategyCost: number;
  mirrorUsed: number;
  expectedNewLoss: number;
  coverageGap: number;
  next: AddPositionState | null;
}

export function initialAddPositionState(strategyCost: number, coins: number, mirrorProfit = 0, realAverage = strategyCost): AddPositionState {
  return {
    strategyCost,
    realAverage,
    coins,
    mirrorProfitRealized: mirrorProfit,
    mirrorProfitAvailable: mirrorProfit,
    mirrorProfitAllocated: 0,
  };
}

/** Newly realized mirror profit is the only automatic way to replenish available profit. */
export function addRealizedMirrorProfit(state: AddPositionState, profit: number): AddPositionState {
  if (!Number.isFinite(profit) || profit < 0) throw new RangeError('新增镜像利润不能小于 0');
  return {
    ...state,
    mirrorProfitRealized: state.mirrorProfitRealized + profit,
    mirrorProfitAvailable: state.mirrorProfitAvailable + profit,
  };
}

/**
 * Shared by live sizing and campaign validation. All amounts use price × coins (U).
 * A stop below cost is allowed: banked profit first covers the old loss, then new risk.
 * Keep the signed budget so realized losses cannot silently become extra allowance.
 */
export function calculateAddRiskBudget(oldCushion: number, bankedProfit: number, riskPerCoin: number) {
  if (![oldCushion, bankedProfit, riskPerCoin].every(Number.isFinite) || riskPerCoin <= 0) return null;
  const available = oldCushion + bankedProfit;
  const oldLoss = Math.max(0, -oldCushion);
  // Preserve the live calculator's split and full-precision arithmetic order.
  const baseCoins = Math.max(0, oldCushion + Math.min(0, bankedProfit)) / riskPerCoin;
  const bankedCoins = Math.max(0, bankedProfit - oldLoss) / riskPerCoin;
  return {
    available,
    oldLoss,
    shortfall: Math.max(0, -available),
    baseCoins,
    bankedCoins,
    maxAddCoins: baseCoins + bankedCoins,
  };
}

export function calculateAddPosition({ currentPrice: T, support: K, state, side = 'LONG' }: AddPositionInput): AddPositionResult {
  const { strategyCost: S, realAverage, coins: Q, mirrorProfitAvailable: P,
    mirrorProfitRealized, mirrorProfitAllocated } = state;
  const blank = (error: AddPositionError, shortfall = 0): AddPositionResult => ({
    error, oldLossShortfall: shortfall, safeDistance: Number.NaN, riskDistance: Number.NaN,
    oldCushion: Number.NaN, baseCoins: 0, mirrorCoins: 0, addCoins: 0,
    newCoins: Q, realAverage, strategyCost: S, mirrorUsed: 0,
    expectedNewLoss: 0, coverageGap: Number.NaN, next: null,
  });
  if (![T, K, S, realAverage, Q, P, mirrorProfitRealized, mirrorProfitAllocated].every(Number.isFinite)
    || T <= 0 || K <= 0 || S <= 0 || realAverage <= 0 || Q <= 0
    || P < 0 || mirrorProfitRealized < 0 || mirrorProfitAllocated < 0
    || P + mirrorProfitAllocated > mirrorProfitRealized + 1e-9 * Math.max(1, mirrorProfitRealized)) {
    return blank('invalid_input');
  }
  const direction = side === 'SHORT' ? -1 : 1;
  if ((T - K) * direction <= 0) return blank('price_not_above_support');

  const safeDistance = (K - S) * direction;
  const riskDistance = (T - K) * direction;
  const oldCushion = safeDistance * Q;
  const budget = calculateAddRiskBudget(oldCushion, P, riskDistance);
  if (!budget) return blank('invalid_input');
  const oldLoss = budget.oldLoss;
  if (P < oldLoss && oldLoss - P > 64 * Number.EPSILON * Math.max(1, P, oldLoss)) {
    return blank('mirror_profit_insufficient', oldLoss - P);
  }

  const baseCoins = budget.baseCoins;
  const mirrorRiskBudget = Math.max(0, P - oldLoss);
  const mirrorCoins = budget.bankedCoins;
  const addCoins = budget.maxAddCoins;
  const newCoins = Q + addCoins;
  const newRealAverage = (Q * realAverage + addCoins * T) / newCoins;
  const expectedNewLoss = addCoins * riskDistance;
  const mirrorUsed = oldLoss + mirrorRiskBudget;
  const coverageGap = oldCushion + mirrorUsed - expectedNewLoss;
  const next: AddPositionState = {
    strategyCost: K,
    realAverage: newRealAverage,
    coins: newCoins,
    mirrorProfitRealized,
    mirrorProfitAvailable: Math.max(0, P - mirrorUsed),
    mirrorProfitAllocated: mirrorProfitAllocated + mirrorUsed,
  };
  return {
    error: null, oldLossShortfall: 0, safeDistance, riskDistance, oldCushion,
    baseCoins, mirrorCoins, addCoins, newCoins, realAverage: newRealAverage,
    strategyCost: K, mirrorUsed, expectedNewLoss, coverageGap, next,
  };
}
