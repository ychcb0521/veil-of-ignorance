import type { QualityGroup } from './quality';
import { fishMetricLabel } from './records';
import { qualityVariables } from './qualityVariables';

/** The four checked detector levels in the user's screenshot, in its display order. */
const PREFERRED_DETECTORS = [
  { featureId: 'cbi2', series: 'avg_CBI2', threshold: .04 },
  { featureId: 'cba', series: 'avg_CBA', threshold: 8 },
  { featureId: 'cbi2', series: 'avg_CBI2_2', threshold: .04 },
  { featureId: 'cba', series: 'avg_CBA_2', threshold: 8 },
] as const;

function detectorPriority(group: QualityGroup): number {
  const snapshot = group.snapshot, metric = fishMetricLabel(snapshot);
  const featureId = snapshot.featureId ?? snapshot.algorithmKey?.split('|')[0];
  const index = PREFERRED_DETECTORS.findIndex(rule => (!featureId || featureId === rule.featureId) && metric === rule.series);
  return index < 0 ? PREFERRED_DETECTORS.length : index;
}

/** Resolve defaults from saved evidence after async hydration; never fabricate absent levels. */
export function defaultQualityDetectorIds(groups: readonly QualityGroup[]): string[] {
  return groups.filter(group => {
    const rule = PREFERRED_DETECTORS[detectorPriority(group)];
    return rule && (group.snapshot.direction ?? '>') === '>' && group.snapshot.threshold === rule.threshold && !group.snapshot.constraints?.length;
  }).map(group => group.id);
}

/** Keep variables intact; checked variables and checked levels come first, stably. */
export function qualityDetectorVariables(groups: readonly QualityGroup[], selected: readonly string[]) {
  const checked = new Set(selected);
  return qualityVariables(groups).map((variable, index) => ({
    ...variable, index, priority: detectorPriority(variable.levels[0]),
    selected: variable.levels.some(group => checked.has(group.id)),
    levels: variable.levels.map((group, order) => ({ group, order })).sort((a, b) => Number(checked.has(b.group.id)) - Number(checked.has(a.group.id)) || a.order - b.order).map(item => item.group),
  })).sort((a, b) => Number(b.selected) - Number(a.selected) || a.priority - b.priority || a.index - b.index);
}
