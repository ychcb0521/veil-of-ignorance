import type { FishCdaTracking } from '@/hooks/useFishCdaTracking';
import type { ResearchBar } from '@/lib/deepRsa/window';
import type { QualityResult } from './quality';
import { instantMonitorSale, instantMonitorExitDue } from './instantMonitorExecution';
import { instantPositionInput } from './instantCampaign';
import { applyInstantManualFill, instantManualTrigger } from './instantManualExecution';
import { usdtFollowCampaigns, type UsdtFollowCampaign } from './usdtFollow';
import { validateFishBars } from './shared';

/** Continue exactly the saved ordinary-follow monitor. No new campaign, simulated entry or plan rebase. */
export async function advanceFrozenUsdtFollow(campaign: UsdtFollowCampaign, at: number,
  evaluate: (state: NonNullable<UsdtFollowCampaign['frozenMonitor']>, end: number) => Promise<QualityResult>,
  candles: (from: number, through: number) => Promise<ResearchBar[]>): Promise<UsdtFollowCampaign | undefined> {
  const frozen = campaign.frozenMonitor;
  if (!frozen) throw Error('缺少原冻结监测状态');
  const next = structuredClone(frozen), { record, round } = next.admission;
  const end = Math.floor((at - 1000) / 60_000) * 60_000;
  if (!next.sale && next.manual?.orders && next.manual.through < end) {
    const manual = next.manual;
    const through = Math.min(manual.through + 120 * 60_000, end);
    const bars = await candles(manual.through, through);
    validateFishBars(bars, through, (through - manual.through) / 60_000, 60_000);
    for (const bar of bars) {
      if (!next.manual!.orders) break;
      const fill = instantManualTrigger(next.manual!.orders!, bar, next.manual!.ordersAt ?? next.manual!.startedAt);
      next.manual = { ...next.manual!, through: bar.openTime + 60_000 };
      if (fill) next.manual = applyInstantManualFill(next.manual, fill);
    }
  } else if (!next.sale && !next.manual && (next.checkpoint?.endTime ?? record.matchedAt ?? 0) < end) {
    const result = await evaluate(next, end);
    if (result.status === 'error') throw Error(result.reason || '交接持仓监测等待行情');
    if (!['open','closed'].includes(result.status)) return;
    next.checkpoint = result;
    if (instantMonitorExitDue(result)) next.sale = instantMonitorSale(result);
  }
  const tracking = { admitted: [{ record, round }], alerts: new Map(next.sale ? [[record.id, next.sale]] : []),
    monitorResults: new Map(next.checkpoint ? [[record.id, next.checkpoint]] : []),
    manualPositions: new Map(next.manual ? [[record.id, next.manual]] : []),
    mirrorFills: new Map(next.mirror ? [[record.id, next.mirror]] : []),
  } as unknown as FishCdaTracking;
  const updated = usdtFollowCampaigns(tracking)[0];
  if (!updated || instantPositionInput(record, round)?.id !== campaign.id) throw Error('交接持仓的原信号身份无法恢复');
  // Preserve every prior action (including unsent decisions) and original order IDs.
  const actions = new Map(campaign.actions.map(action => [action.id, action]));
  for (const action of updated.actions) {
    if (actions.has(action.id) && JSON.stringify(actions.get(action.id)) !== JSON.stringify(action)) throw Error('交接后原动作发生变化');
    actions.set(action.id, action);
  }
  // Publish any earlier decisions even if the opening quote is still pending.
  // Retain the prior cursor so the next poll can retry this boundary.
  if(next.checkpoint?.openingAdditionPreview?.at===end && next.checkpoint.openingAdditionPreview.price==null && !next.sale)
    next.checkpoint=frozen.checkpoint;
  const resumed = { ...campaign, actions: [...actions.values()].sort((a,b) => a.at - b.at), frozenMonitor: next };
  return JSON.stringify(resumed) === JSON.stringify(campaign) ? undefined : resumed;
}
