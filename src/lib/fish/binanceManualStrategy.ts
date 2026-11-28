import { openingImpulseFill } from './usdtFollow';
import { qualityAdditionFills } from './qualityAddition';
import {instantMonitorExitDue,instantMonitorSale} from './instantMonitorExecution';
import {isMirrorClockExit} from './qualityMirrorLossReview';
import { qualityResultKey, type QualityResult, type QualitySample } from './quality';
import { MANAGED_MINUTE, binanceManualId, initialBinanceManualCheckpoint, type BinanceManualDecision, type BinanceManualPosition } from './binanceManualMonitor';

export function binanceManualSample(position: BinanceManualPosition): QualitySample {
  const { anchor, entryPrice, entryQuantity, version, followBasis, followSample } = position;
  const id = binanceManualId(anchor);
  return { id, source: { id, symbol: anchor.symbol, exchange: 'binance', timeMs: anchor.openedAt, timeLabel: '', fallbackZone: '', fish: followSample?.fish },
    groups: followSample?.groups ?? [], readings: followSample?.readings, enteredAt: followBasis?.effectiveAt ?? anchor.openedAt, basis: 'signal', importedAt: position.armedAt,
    binanceEntry: { version, orderId: anchor.openingOrderId, price: entryPrice, quantity: entryQuantity } };
}

export function binanceManualSeed(position: BinanceManualPosition, sample: QualitySample): QualityResult {
  const key = qualityResultKey(sample, position.monitor.plan, 0);
  const checkpoint = initialBinanceManualCheckpoint(position, key);
  return position.planEpoch == null ? checkpoint : { ...checkpoint, key };
}

/** Collect only the first new strategy action. The following decision uses its actual fill. */
export function binanceManualAdvance(position: BinanceManualPosition, prior: QualityResult, observed: QualityResult) {
  if (observed.status === 'error') throw Error(observed.reason || '实盘持仓策略计算失败');
  if (observed.status === 'waiting') return;
  const id = 'managed-' + position.revision;
  const after = prior.endTime!;
  const actions: { decision: BinanceManualDecision; priority: number }[] = [];
  const through = (at: number) => Math.ceil(at / MANAGED_MINUTE) * MANAGED_MINUTE + MANAGED_MINUTE;
  // A due clock stop must not be delayed by replayed, still-unexecuted additions
  // or mirror proposals. The unchanged prior checkpoint contains actual fills.
  const deadlineCause=observed.pendingExit?.cause??observed.exitSnapshot?.cause;
  if(isMirrorClockExit(deadlineCause)&&instantMonitorExitDue(observed)){
    const at=instantMonitorSale(observed).at;
    return {checkpoint:prior,decision:{kind:'close' as const,reason:observed.reason||'镜像限时终止',through:through(at),action:{id,action:'close' as const,at}}};
  }

  const additions=qualityAdditionFills(observed).slice(qualityAdditionFills(prior).length);
  const opening=position.followBasis ? openingImpulseFill(observed) : undefined;
  if (opening) additions.push(opening);
  for (const evidence of additions) {
    const impulse = evidence.structureEvidence?.guardPlus?.early_impulse_event;
    const transitionCount = (position.followBasis?.carriedAdditions ?? 0) + (prior.marginRejectedAdditions?.length ?? 0) + qualityAdditionFills(prior).length + 1;
    const transition=opening && evidence===opening ? observed.openingImpulseDecision : undefined;
    const sellStages=observed.sellStageSwitches?.filter(s=>s.afterAdditions<=transitionCount);
    const vetoStages=observed.vetoStageSwitches?.filter(s=>s.afterAdditions<=transitionCount);
    actions.push({ priority: 3, decision: { kind: 'add', evidence, through: through(evidence.at),
      action: { id, action: 'add', at: evidence.at, notional: evidence.notional,
        ...(impulse ? { impulseFreshUntil: impulse.fresh_until } : {}) },
      routeDecision: observed.routeDecision?.at != null && observed.routeDecision.at <= evidence.at ? observed.routeDecision : undefined,
      sellStageSwitches: transition?.sellStage ? [...(sellStages??[]),transition.sellStage] : sellStages,
      vetoStageSwitches: transition?.vetoStage ? [...(vetoStages??[]),transition.vetoStage] : vetoStages,
    } });
  }
  const reductions = (observed.additionReductions ?? []).slice(prior.additionReductions?.length ?? 0);
  for (const evidence of reductions) {
    if (evidence.fraction <= 0) continue;
    actions.push({ priority: 2, decision: { kind: 'support-reduction', evidence, through: through(evidence.at),
      action: { id, action: 'support-reduction', at: evidence.at, fraction: evidence.fraction } } });
  }
  const mirror = observed.mirrorFill;
  if (mirror && !prior.mirrorFill && mirror.fraction < 1) actions.push({ priority: mirror.atOpen ? 1 : 4,
    decision: { kind: 'mirror', evidence: mirror, through: through(mirror.at),
      action: { id, action: 'mirror', at: mirror.at, fraction: mirror.fraction, atOpen: mirror.atOpen } } });
  if (instantMonitorExitDue(observed) && observed.endTime) {
    const exitAt=instantMonitorSale(observed).at;
    actions.push({ priority: observed.pendingExit?.atOpen || observed.exitSnapshot?.atOpen ? 0 : 5,
      decision: { kind: 'close', reason: observed.reason || '持仓策略触发平仓', through: through(exitAt),
        action: { id, action: 'close', at: exitAt } } });
  }

  const decision = actions.filter(value => value.decision.action.at >= after)
    .sort((a, b) => a.decision.action.at - b.decision.action.at || a.priority - b.priority)[0]?.decision;
  if (decision) {
    if (opening && decision.kind==='add' && decision.evidence===opening) {
      // The checkpoint contains closed candles only. Binance appends this addition
      // after reconciling the order, with its actual filled quantity and price.
      const {openingImpulseDecision,openingAdditionPreview,...checkpoint}=observed;
      return {decision,checkpoint};
    }
    const moves = reductions.filter(evidence => evidence.fraction === 0 && evidence.at < decision.action.at);
    return { decision, checkpoint: moves.length ? { ...prior, additionReductions: [...(prior.additionReductions ?? []), ...moves] } : prior };
  }
  if (observed.status === 'open' && ((observed.endTime ?? 0) > after || observed.mirrorLossReviews&&JSON.stringify(observed.mirrorLossReviews)!==JSON.stringify(prior.mirrorLossReviews)) && actions.length === 0) return { checkpoint: observed };
}
