import { journalSimulatedCloseTime } from '@/lib/objectiveOperationTime';
import type { CampaignEvent, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

export interface MirrorTpOrderTiming {
  placedAt: number | null;
  triggeredAt: number | null;
}

function safeTimeMs(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const time = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(time) && time > 0 ? time : null;
}

function eventDistance(event: CampaignEvent, targetTime: number | null): number {
  if (targetTime == null) return safeTimeMs(event.timestamp) ?? Number.MAX_SAFE_INTEGER;
  const time = safeTimeMs(event.timestamp);
  return time == null ? Number.MAX_SAFE_INTEGER : Math.abs(time - targetTime);
}

function pickMirrorEvent(
  events: CampaignEvent[],
  eventType: 'mirror_tp_placed' | 'mirror_tp_triggered',
  leg: TradeJournal,
  targetTime: number | null,
): CampaignEvent | null {
  const candidates = events.filter(event => event.event_type === eventType);
  if (candidates.length === 0) return null;

  const identified = candidates.filter(event => (
    (event.journal_id != null && event.journal_id === leg.id)
    || (
      leg.trade_record_id != null
      && event.trade_record_id != null
      && event.trade_record_id === leg.trade_record_id
    )
  ));
  const sequenceMatched = candidates.filter(event => (
    leg.leg_sequence != null
    && event.leg_sequence != null
    && event.leg_sequence === leg.leg_sequence
  ));
  const anonymous = candidates.filter(event => (
    event.journal_id == null
    && event.trade_record_id == null
    && event.leg_sequence == null
    && (event.leg_role == null || event.leg_role === 'mirror_tp')
  ));
  const pool = identified.length > 0
    ? identified
    : sequenceMatched.length > 0
      ? sequenceMatched
      : anonymous;

  return [...pool].sort((left, right) => (
    eventDistance(left, targetTime) - eventDistance(right, targetTime)
  ))[0] ?? null;
}

export function resolveMirrorTpOrderTiming(
  leg: TradeJournal,
  record: TradeRecord | null,
  events: CampaignEvent[] = [],
): MirrorTpOrderTiming | null {
  if (leg.leg_role !== 'mirror_tp') return null;

  const placedFallback = safeTimeMs(record?.openTime) ?? safeTimeMs(leg.pre_simulated_time);
  const hasTriggeredOutcome = record != null
    || leg.post_outcome != null
    || leg.post_realized_pnl != null
    || leg.post_exit_price_snapshot != null;
  const triggeredFallback = safeTimeMs(record?.closeTime)
    ?? (hasTriggeredOutcome ? journalSimulatedCloseTime(leg) : null);
  const placedEvent = pickMirrorEvent(events, 'mirror_tp_placed', leg, placedFallback);
  const triggeredEvent = pickMirrorEvent(events, 'mirror_tp_triggered', leg, triggeredFallback);

  return {
    placedAt: safeTimeMs(placedEvent?.timestamp) ?? placedFallback,
    triggeredAt: safeTimeMs(triggeredEvent?.timestamp) ?? triggeredFallback,
  };
}
