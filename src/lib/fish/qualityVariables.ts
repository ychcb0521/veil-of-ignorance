import { shortFishHash, type FishSnapshot } from './algorithm';
import { type QualityBuyFilter, type QualityGroup } from './quality';

/** A threshold is a level, never a new variable. Formula/series/units remain distinct. */
export function qualityVariableKey(snapshot: FishSnapshot, metric = snapshot.statistic) {
  return shortFishHash(JSON.stringify([snapshot.featureId, snapshot.definitionKey, snapshot.statistic ?? metric ?? '结果',
    snapshot.interval ?? '5m', snapshot.H ?? null, snapshot.scale ?? 1, snapshot.unit ?? '']));
}
export interface QualityVariable<T> { id: string; label: string; levels: T[] }
export function qualityVariables<T extends QualityGroup | QualityBuyFilter>(items: readonly T[]): QualityVariable<T>[] {
  const variables = new Map<string, QualityVariable<T>>();
  for (const item of items) {
    const id = qualityVariableKey(item.snapshot, item.metric), found = variables.get(id);
    if (found) found.levels.push(item);
    else variables.set(id, { id, label: item.label, levels: [item] });
  }
  return [...variables.values()];
}
export function qualityLevelText(item: QualityGroup | QualityBuyFilter) {
  if ('enabled' in item) return `${item.direction} ${item.threshold}`;
  return item.rule ? `${item.rule.direction} ${item.rule.threshold}` : `${item.snapshot.direction ?? '>'} ${item.snapshot.threshold}`;
}
