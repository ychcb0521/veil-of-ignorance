import { fishSourceLabel } from './records';
import type { PreEntryRecord, PreEntryRound } from './preEntryMonitor';
import type { FishSnapshot } from './algorithm';
import type { QualityGroup } from './quality';
import type { EntryStageEvidence } from './preEntryThreeStageScan';

export interface InstantCampaignMetadata {
  fishing?: { algorithms: { label: string; reading?: number; unit?: string; interval?: string }[]; combination?: 'and' | 'or' };
  screening?: { plan?: QualityGroup; hours: number; engine?: PreEntryRound['engine']; matchedAt?: number;
    evidence?: Pick<EntryStageEvidence, 'admission' | 'readings'> };
}

export function instantCampaignMetadata(record: PreEntryRecord, round: PreEntryRound): InstantCampaignMetadata {
  const fish = record.sample.source.fish;
  let matched: FishSnapshot[] = [];
  if (fish?.algorithms?.length) {
    matched = fish.combination === 'or'
      ? [...new Set(fish.hitAlgorithms ?? [])].map(index => fish.algorithms![index - 1]).filter(Boolean)
      : fish.algorithms;
  } else if (fish) matched = [fish];
  const algorithms = matched.map(value => {
    const reading = value.average * (value.scale ?? 1);
    return { label: fishSourceLabel({ ...value, featureShort: value.featureShort ?? value.featureName ?? value.featureId ?? 'CBI-2' }),
      ...(Number.isFinite(reading) ? { reading } : {}), unit: value.unit, interval: value.interval };
  });
  const plan = round.plans?.find(value => value.id === record.planId) ?? (round.plans?.length === 1 ? round.plans[0] : undefined);
  return {
    ...(algorithms.length ? { fishing: { algorithms, combination: fish?.algorithms?.length ? fish.combination ?? 'and' : undefined } } : {}),
    screening: { plan, hours: round.hours, engine: round.engine, matchedAt: record.matchedAt,
      ...(record.threeStage ? { evidence: { admission: record.threeStage.admission, readings: record.threeStage.readings } } : {}) },
  };
}
