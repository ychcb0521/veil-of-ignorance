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

import { legacyPlanInEngineUnits, legacyResultInPositionUnits } from './instantLegacyPosition';
import { sizeInstantEntry, type InstantPositionSettings } from './instantPositionSettings';
import {MIRROR_DEADLINE_KIND,MIRROR_DEADLINE_VERSION} from './qualityMirrorDeadline';

export const INSTANT_POSITION = { marginUsdt: 40, leverage: 5 } as const;
export function instantMonitorSize(monitor?: InstantMonitorSettings, position?: InstantPositionSettings) {
  if (position) return sizeInstantEntry(position);
  if (monitor?.plan.positionManagement && !isLegacyQualityPlan(monitor.plan)) return qualityPositionSize(monitor.plan);
  return isLegacyQualityPlan(monitor?.plan)
    ? { ...INSTANT_POSITION, marginUsdt: QUALITY_NOTIONAL / INSTANT_POSITION.leverage }
    : INSTANT_POSITION;
}

export function instantMonitorSample(sample: QualitySample, buyAt: number): QualitySample {
  return { ...sample, enteredAt: sample.binanceEntry ? buyAt : Math.floor(buyAt / QUALITY_MINUTE) * QUALITY_MINUTE, monitorEntry: undefined };
}

export async function evaluateInstantMonitor(sample: QualitySample, monitor: InstantMonitorSettings, end: number,
  load: FishReconstructionLoader, signal: AbortSignal, previous?: QualityResult, marketStart?: number, liveAt?:number, position?: InstantPositionSettings) {
  const { plan } = monitor;
  if (!plan.frozenVersions?.length || planVersionChanges(plan).length) throw new Error('即时交易的持仓模板执行版本无法核验');
  const tradeLoad = preEntryWindowLoader(load, end);
  if (isLegacyQualityPlan(plan)) {
    if (sample.binanceEntry) throw Error('该历史引擎无法以真实首仓执行');
    const notional = position ? sizeInstantEntry(position).notional : QUALITY_NOTIONAL;
    const normalized = legacyPlanInEngineUnits(plan, notional / QUALITY_NOTIONAL);
    const result = await evaluateLegacyQualitySample(sample, normalized, 0, end, tradeLoad, signal, qualityResultKey(sample, plan, 0));
    return legacyResultInPositionUnits(result, notional);
  }
  const initialized = plan.initialization ? withTuringInitialization(tradeLoad, sample.source.symbol, marketStart ?? NaN) : tradeLoad;
  const size = instantMonitorSize(monitor, position);
  if (previous?.instantMonitorSwitches && end < previous.endTime!) return previous;
  const notional = previous?.instantMonitorSwitches ? previous.initialNotional! : sample.binanceEntry
    ? sample.binanceEntry.quantity * sample.binanceEntry.price : 'notional' in size ? size.notional : size.marginUsdt * size.leverage;
  const result = await evaluateQualitySampleWithMarketRepair(sample, plan, 0, end, initialized, signal, previous, notional,liveAt);
  return { ...result, ...(position ? { initialNotional: notional } : {}),
    ...(initialized.turingInitialization ? { initialization: initialized.turingInitialization } : {}) };
}

/** A clock deadline can issue a market exit before the next candle's fill price exists.
 * Keep the result open/pending until execution is known; never invent a market fill. */
export function instantMonitorExitDue(result:QualityResult):boolean {
  return result.status==='closed'||result.status==='open'&&result.pendingExit?.cause?.kind===MIRROR_DEADLINE_KIND
    &&result.pendingExit.cause.mirrorDeadlineVersion===MIRROR_DEADLINE_VERSION
    &&Number.isFinite(result.pendingExit.at)&&result.pendingExit.at<=result.evaluatedAt
    &&Number.isFinite(result.endPrice)&&result.endPrice!>0;
}
export function instantMonitorSale(result: QualityResult): ScreenedCdaTrigger {
  return { at: result.pendingExit?.cause?.kind===MIRROR_DEADLINE_KIND&&instantMonitorExitDue(result)?result.pendingExit.at:result.endTime!, closePrice: result.endPrice!,
    evidence: { version: INSTANT_TEMPLATE_MONITOR, reason: 'template', detail: result.reason || '持仓监测模板触发卖出' } };
}

export function manualInstantMonitorClose(result: QualityResult, monitor: InstantMonitorSettings, at: number, price: number): QualityResult {
  const { marginUsdt, leverage } = instantMonitorSize(monitor);
  const position = additionPosition(result.initialNotional ?? monitor.plan.positionManagement?.notional ?? marginUsdt * leverage, result.entryPrice!, price, true, qualityAdditionFills(result),
    result.mirrorFill, result.additionReductions ?? [], result.entryTime);
  const peakPct = Math.max(result.peakPct ?? 0, (price / result.entryPrice! - 1) * 100);
  return { ...result, status: 'closed', complete: true, evaluatedAt: Date.now(), endTime: at, endPrice: price,
    pnl: position.totalPnl, returnPct: position.returnPct, realizedPnl: position.realizedPnl, remainingFraction: 0,
    remainingPnl: position.remainingPnl, remainingQuantity: 0, remainingCost: 0,
    heldHours: (at - result.entryTime!) / 3_600_000, uncapturedPct: peakPct - position.returnPct, peakPct,
    pendingExit: undefined, exitSnapshot: undefined, exitReading: undefined, reason: '手动卖出' };
}
