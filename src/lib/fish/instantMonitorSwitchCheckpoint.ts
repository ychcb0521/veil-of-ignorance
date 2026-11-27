import type { QualityResult } from './quality';
import type { InstantMonitorSettings } from './instantMonitorSettings';

export interface InstantMonitorSwitch {
  at: number;
  effectiveAt: number;
  openingSelectedL0Pct?: number | null;
  from: Pick<InstantMonitorSettings, 'templateId' | 'name'> & Partial<InstantMonitorSettings>;
  to: InstantMonitorSettings;
  followBasis?: import('./usdtFollowMonitorBasis').UsdtFollowMonitorBasis;
}

export function rebaseInstantMonitorCheckpoint(current: QualityResult, initialNotional: number,
  from: InstantMonitorSettings, to: InstantMonitorSettings, at: number, key = current.key): QualityResult {
  if (to.plan.engine || to.plan.initialization) throw Error('该模板须从开仓开始运行，无法接手已有持仓');
  if (current.status !== 'open' || !current.entryPrice || !current.endTime || current.mirrorFill?.fraction === 1
    || !Number.isFinite(initialNotional) || initialNotional <= 0) {
    throw Error('该持仓已结束或首仓尚未核对');
  }
  if (current.pendingExit) throw Error('原方案已有待成交的卖出，请等成交核对完成');
  const route = to.plan.router;
  if (route?.afterAdditions && (current.additionFills?.length || (current.additionFill ? 1 : 0)) >= route.afterAdditions) {
    throw Error('这笔仓位已越过新模板的分流轮次，请选择可接续当前轮次的方案');
  }
  const effectiveAt = Math.max(current.endTime, Math.ceil(at / 60_000) * 60_000);
  return {
    ...current,
    key, groupId: to.plan.id, evaluatedAt: at, endTime: effectiveAt, initialNotional,
    instantMonitorSwitches: [...current.instantMonitorSwitches ?? [], { at, effectiveAt, from, to,
      ...(!current.instantMonitorSwitches?.length && current.selectedL0Pct !== undefined ? { openingSelectedL0Pct: current.selectedL0Pct } : {}) }],
    routeDecision: undefined, activeSellStage: undefined, sellStageSwitches: undefined, activeVetoStage: undefined,
    vetoStageSwitches: undefined, vetoPath: undefined, advantageState: undefined, boxStopStates: undefined,
    ...(current.impulse1115Classification?{impulse1115Classification:undefined}:{}),
    ...(current.selectedL0Pct!==undefined ? {selectedL0Pct:undefined} : {}),
    ...(current.openingImpulseDecision ? { openingImpulseDecision: undefined } : {}),
    ...(current.openingAdditionPreview ? { openingAdditionPreview: undefined } : {}),
    additionGuardPlus: undefined, additionNote: undefined, boxMarketRepair: undefined, exitSnapshot: undefined, exitReading: undefined,
  };
}
