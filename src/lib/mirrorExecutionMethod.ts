import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

export interface MirrorCloseRatio {
  reductionPct: number;
  isStrict60Pct: boolean;
  closedUnits: number;
  openingUnits: number;
  basis: 'record_units';
}

/** Only absorb numerical arithmetic noise, never round 59.99% into 60%. */
export const MIRROR_RATIO_EPSILON_PCT = 1e-9;

const positive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

function units(record: TradeRecord): number | null {
  const value = record.settlementMode === 'coin' ? record.contracts : record.quantity;
  return positive(value) ? value : null;
}

interface OpeningGroup {
  legs: TradeJournal[];
  records: Map<string, TradeRecord>;
}

/** Same fill always wins over the aggregate position, which may include later adds. */
function openingSlices(ref: string | null | undefined, records: TradeRecord[]): TradeRecord[] {
  if (!ref) return [];
  const exact = records.find(record => record.id === ref);
  if (exact?.fillId) return records.filter(record => record.fillId === exact.fillId);
  if (exact) {
    return exact.positionId && positive(exact.openTime)
      ? records.filter(record => record.id === exact.id || (
        record.positionId === exact.positionId && !record.fillId && record.openTime === exact.openTime
        && (record.openedTimelineId ?? null) === (exact.openedTimelineId ?? null)
        && (record.openedRealAt ?? null) === (exact.openedRealAt ?? null)
      ))
      : [exact];
  }
  const byFill = records.filter(record => record.fillId === ref);
  if (byFill.length) return byFill;
  const byPosition = records.filter(record => record.positionId === ref);
  // A position-only link is usable only when it identifies one opening, not an add basket.
  const identities = new Set(byPosition.map(record => record.fillId ?? `${record.openTime}:${record.openedTimelineId ?? ''}:${record.openedRealAt ?? ''}`));
  return identities.size === 1 ? byPosition : [];
}

/**
 * Strict display classification for actual mirror closes, not an inferred execution source.
 * Unlike the overview's historical notional fallback, missing records/ambiguous cohorts
 * stay unknown. Quantities (contracts for inverse contracts) avoid entry-price slippage
 * changing a true 60/40 split. Funding/open rows never enter the denominator.
 */
export function resolveMirrorCloseRatio(
  campaign: Pick<TradeCampaign, 'direction' | 'symbol'>,
  mirrorLeg: TradeJournal,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): MirrorCloseRatio | null {
  if (mirrorLeg.leg_role !== 'mirror_tp') return null;
  const direction = campaign.direction === 'main_short' ? 'short' : 'long';
  if (mirrorLeg.direction && mirrorLeg.direction !== direction) return null;
  const side = direction === 'long' ? 'LONG' : 'SHORT';
  const symbol = campaign.symbol || mirrorLeg.symbol;
  const records = tradeRecords.filter(record => record.action !== 'FUNDING' && record.action !== 'OPEN'
    && record.side === side && (!symbol || record.symbol === symbol));
  const initialLegs = legs.filter(leg => (leg.leg_role === 'main_open' || leg.leg_role === 'mirror_tp')
    && (!leg.direction || leg.direction === direction) && (!symbol || !leg.symbol || leg.symbol === symbol));
  const groups: OpeningGroup[] = [];
  for (const leg of initialLegs) {
    const slices = openingSlices(leg.trade_record_id, records);
    const matches = groups.filter(group => slices.some(record => group.records.has(record.id)));
    const group = matches[0] ?? { legs: [], records: new Map<string, TradeRecord>() };
    if (!matches.length) groups.push(group);
    for (const extra of matches.slice(1)) {
      group.legs.push(...extra.legs);
      for (const [id, record] of extra.records) group.records.set(id, record);
      groups.splice(groups.indexOf(extra), 1);
    }
    group.legs.push(leg);
    for (const record of slices) group.records.set(record.id, record);
  }
  const mirrorGroup = groups.find(group => group.legs.some(leg => leg.id === mirrorLeg.id));
  if (!mirrorGroup?.records.size) return null;

  let cohort = [mirrorGroup];
  if (!mirrorGroup.legs.some(leg => leg.leg_role === 'main_open')) {
    const first = mirrorGroup.records.values().next().value as TradeRecord;
    if (!positive(first.openTime)) return null;
    // Old independent main/mirror positions need an exact opening cohort, not
    // nearest-open or the whole campaign. Multiple simultaneous mains are ambiguous.
    cohort = groups.filter(group => group.records.size > 0 && [...group.records.values()].every(record =>
      record.openTime === first.openTime
      && (record.openedTimelineId ?? null) === (first.openedTimelineId ?? null)
      && (!(record.openedRealAt && first.openedRealAt) || record.openedRealAt === first.openedRealAt),
    ));
    if (cohort.filter(group => group.legs.some(leg => leg.leg_role === 'main_open')).length !== 1) return null;
    // A missing same-opening leg must not silently shrink the denominator.
    if (groups.some(group => group.records.size === 0 && group.legs.some(leg =>
      Date.parse(leg.pre_simulated_time) === first.openTime))) return null;
  }
  const allRecords = [...new Map(cohort.flatMap(group => [...group.records])).values()];
  if (!allRecords.length || allRecords.some(record => units(record) == null)) return null;
  const settlementModes = new Set(allRecords.map(record => record.settlementMode === 'coin' ? 'coin' : 'usdt'));
  if (settlementModes.size !== 1) return null;
  if (settlementModes.has('coin') && new Set(allRecords.map(record => record.contractSizeUsd)).size !== 1) return null;
  const openingUnits = allRecords.reduce((sum, record) => sum + (units(record) as number), 0);

  // Shared opening: only this leg's own close slice, not the entire opening.
  // Independent mirror position: all of its partial-close slices together.
  const ownRecord = records.find(record => record.id === mirrorLeg.trade_record_id);
  const closeRecords = mirrorGroup.legs.length > 1
    ? ownRecord ? [ownRecord] : []
    : [...mirrorGroup.records.values()];
  if (!closeRecords.length || closeRecords.some(record => units(record) == null)) return null;
  const closedUnits = closeRecords.reduce((sum, record) => sum + (units(record) as number), 0);
  const reductionPct = closedUnits / openingUnits * 100;
  if (!Number.isFinite(reductionPct) || reductionPct <= 0 || reductionPct > 100 + MIRROR_RATIO_EPSILON_PCT) return null;
  return {
    reductionPct,
    isStrict60Pct: Math.abs(reductionPct - 60) <= MIRROR_RATIO_EPSILON_PCT,
    closedUnits,
    openingUnits,
    basis: 'record_units',
  };
}
