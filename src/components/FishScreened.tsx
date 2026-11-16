import { useMemo, useState } from 'react';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { FishLibrary } from './FishLibrary';
import { isAutomaticPreEntryRound, preEntrySignal, type PreEntryLibrary } from '@/lib/fish/preEntryMonitor';
import { qualitySignalTime } from '@/lib/fish/qualityAdmissionTime';
import type { QualitySourceRatings } from '@/lib/fish/qualitySourceRatings';
import { signalDedupKey, type TradeSignal } from '@/lib/signalLibrary';
import { formatUTC8 } from '@/lib/timeFormat';
import { activeQualityPlanTemplates } from '@/lib/fish/qualityPlanTemplates';
import { isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';
import { InstantMonitorSwitchDialog, type InstantMonitorSwitchTarget } from './InstantMonitorSwitchDialog';

const noDays = new Set<string>();

export function FishScreened({ state, library, ratings, onJump, canJump, onRate, jumpingSignalId, tradedDayIndex = noDays, campaignDayIndex = noDays }: {
  state?: FishQualityState;
  library: PreEntryLibrary;
  ratings?: QualitySourceRatings;
  onJump?: (source: TradeSignal) => void;
  canJump?: (source: TradeSignal) => boolean;
  onRate?: (source: TradeSignal, value: number) => void;
  jumpingSignalId?: string | null;
  tradedDayIndex?: Set<string>;
  campaignDayIndex?: Set<string>;
}) {
  const [target, setTarget] = useState<InstantMonitorSwitchTarget>();
  const tracking = state?.cdaTracking;
  const switchable = useMemo(() => {
    const targets = new Map<string, InstantMonitorSwitchTarget>();
    const update = tracking?.switchMonitor;
    if (!update) return targets;
    for (const { record, round } of tracking.admitted ?? []) {
      const result = tracking.monitorResults?.get(record.id);
      const signal = preEntrySignal(record);
      if (!signal || !round.instantMonitor || round.liveCapturedAt != null || isLegacyQualityPlan(round.instantMonitor.plan)
        || result?.status !== 'open' || tracking.alerts.has(record.id) || tracking.manualPositions?.has(record.id)) continue;
      const history = result.instantMonitorSwitches;
      targets.set(signal.id, { symbol: signal.symbol, current: history?.at(-1)?.to ?? round.instantMonitor,
        submit: monitor => update(record.id, monitor, history?.length ?? 0) });
    }
    return targets;
  }, [tracking?.admitted, tracking?.switchMonitor, tracking?.monitorResults, tracking?.alerts, tracking?.manualPositions]);
  const switchableIds = useMemo(() => new Set(switchable.keys()), [switchable]);
  const rows = useMemo(() => {
    const automatic = new Set(library.rounds.filter(isAutomaticPreEntryRound).map(round => round.id));
    return library.records.flatMap(record => {
      if (!automatic.has(record.roundId)) return [];
      const admitted = preEntrySignal(record);
      if (!admitted) return [];
      const source = record.sample.source, timeMs = qualitySignalTime(source);
      const rating = ratings?.[signalDedupKey({...source, timeMs})];
      return [{
        ...source, id: admitted.id, timeMs, timeLabel: formatUTC8(timeMs), jumpIssue: undefined,
        preEntryMonitor: admitted.preEntryMonitor, quality: rating ? rating.quality ?? undefined : source.quality,
      }];
    });
  }, [library.rounds, library.records, ratings]);
  const byId = useMemo(() => new Map(rows.map(row => [row.id, row])), [rows]);
  return <><FishLibrary title="筛选鱼" level="sub" testId="fish-screened" signals={rows} showScreeningTime collapseSoldRows cdaAlerts={state?.cdaTracking?.alerts} defaultOpen={false}
      switchableMonitorIds={switchableIds} onSwitchMonitor={id => setTarget(switchable.get(id))}
      info={<p>通过即时交易买前筛选的鱼。标题只统计仍有余仓的鱼，全部平仓后归入「已卖出」。</p>}
      emptyText="还没有自动筛选入选的鱼。" tradedDayIndex={tradedDayIndex} campaignDayIndex={campaignDayIndex} jumpingSignalId={jumpingSignalId ?? null}
      onJump={id => {
        const row = byId.get(id), at = row?.preEntryMonitor?.matchedAt;
        if (!row || !at) return;
        const source = {...row, timeMs: at, timeLabel: formatUTC8(at)};
        if (!canJump || canJump(source)) onJump?.(source);
      }}
      onRate={(id, value) => {
        const row = byId.get(id);
        if (row) onRate?.(row, value);
      }}/>
      {target && state && <InstantMonitorSwitchDialog target={target} close={() => setTarget(undefined)}
        templates={activeQualityPlanTemplates({ planTemplates: state.study.planTemplates ?? state.templateCatalog })}/>}
    </>;
}
