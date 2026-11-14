import { evaluateQualitySampleWithMarketRepair, qualityResultKey, QUALITY_MINUTE, QUALITY_NOTIONAL, type QualityResult, type QualitySample } from './quality';
import { evaluateLegacyQualitySample, isLegacyQualityPlan } from './qualityLegacyEngine';
import { qualityPositionSize } from './qualityPositionManagement';
import { planVersionChanges } from './qualityPlanVersions';
import { additionPosition, qualityAdditionFills } from './qualityAddition';
import { preEntryWindowLoader } from './preEntryWindowLoader';
import { withTuringInitialization } from './qualityInitialization';
import type { FishReconstructionLoader } from './reconstruction';
import type { InstantMonitorSettings } from './instantMonitorSettings';
import type { ScreenedCdaTrigger } from './screenedCda';
import { INSTANT_TEMPLATE_MONITOR } from './instantMonitorSettings';

export const INSTANT_POSITION = { marginUsdt: 40, leverage: 5 } as const;
export function instantMonitorSize(monitor?: InstantMonitorSettings) {
  if (monitor?.plan.positionManagement && !isLegacyQualityPlan(monitor.plan)) return qualityPositionSize(monitor.plan);
  return isLegacyQualityPlan(monitor?.plan)
    ? { ...INSTANT_POSITION, marginUsdt: QUALITY_NOTIONAL / INSTANT_POSITION.leverage }
    : INSTANT_POSITION;
}

export function instantMonitorSample(sample: QualitySample, buyAt: number): QualitySample {
  return { ...sample, enteredAt: Math.floor(buyAt / QUALITY_MINUTE) * QUALITY_MINUTE, monitorEntry: undefined };
}

export async function evaluateInstantMonitor(sample: QualitySample, monitor: InstantMonitorSettings, end: number,
  load: FishReconstructionLoader, signal: AbortSignal, previous?: QualityResult, marketStart?: number) {
  const { plan } = monitor;
  if (!plan.frozenVersions?.length || planVersionChanges(plan).length) throw new Error('即时交易的持仓模板执行版本无法核验');
  const tradeLoad = preEntryWindowLoader(load, end);
  if (isLegacyQualityPlan(plan)) {
    return evaluateLegacyQualitySample(sample, plan, 0, end, tradeLoad, signal, qualityResultKey(sample, plan, 0));
  }
  const initialized = plan.initialization ? withTuringInitialization(tradeLoad, sample.source.symbol, marketStart ?? NaN) : tradeLoad;
  const { marginUsdt, leverage } = instantMonitorSize(monitor);
  const notional = plan.positionManagement?.notional ?? marginUsdt * leverage;
  const result = await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end, initialized, signal, previous, notional);
  return initialized.turingInitialization ? { ...result, initialization: initialized.turingInitialization } : result;
}

export function instantMonitorSale(result: QualityResult): ScreenedCdaTrigger {
  return { at: result.endTime!, closePrice: result.endPrice!,
    evidence: { version: INSTANT_TEMPLATE_MONITOR, reason: 'template', detail: result.reason || '持仓监测模板触发卖出' } };
}

export function manualInstantMonitorClose(result: QualityResult, monitor: InstantMonitorSettings, at: number, price: number): QualityResult {
  const { marginUsdt, leverage } = instantMonitorSize(monitor);
  const position = additionPosition(monitor.plan.positionManagement?.notional ?? marginUsdt * leverage, result.entryPrice!, price, true, qualityAdditionFills(result),
    result.mirrorFill, result.additionReductions ?? [], result.entryTime);
  const peakPct = Math.max(result.peakPct ?? 0, (price / result.entryPrice! - 1) * 100);
  return { ...result, status: 'closed', complete: true, evaluatedAt: Date.now(), endTime: at, endPrice: price,
    pnl: position.totalPnl, returnPct: position.returnPct, realizedPnl: position.realizedPnl, remainingFraction: 0,
    remainingPnl: position.remainingPnl, remainingQuantity: 0, remainingCost: 0,
    heldHours: (at - result.entryTime!) / 3_600_000, uncapturedPct: peakPct - position.returnPct, peakPct,
    pendingExit: undefined, exitSnapshot: undefined, exitReading: undefined, reason: '手动卖出' };
}
