export interface AnalysisFloatingLabelCandidate {
  id: string;
  time: number;
  text: string;
  color: string;
  x?: number;
}

export interface AnalysisFloatingLabel extends AnalysisFloatingLabelCandidate {
  left: number;
  top: number;
  width: number;
  lane: number;
}

const FLOATING_LABEL_TOP = 42;
export const FLOATING_LABEL_HEIGHT = 14;
const FLOATING_LABEL_LANE_GAP = 1;
const FLOATING_LABEL_X_GAP = 4;

const estimateAnalysisLabelWidth = (text: string) => {
  const visualUnits = Array.from(text).reduce((sum, char) => {
    const code = char.codePointAt(0) ?? 0;
    return sum + (code > 255 ? 1.45 : 1);
  }, 0);
  return Math.ceil(Math.min(190, Math.max(18, visualUnits * 5.6 + 12)));
};

const clampNumber = (value: number, min: number, max: number) => {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
};

export function layoutAnalysisFloatingLabels(
  candidates: AnalysisFloatingLabelCandidate[],
  params: { minTime: number; maxTime: number; width: number },
): AnalysisFloatingLabel[] {
  const chartWidth = Math.max(0, Math.floor(params.width));
  if (!chartWidth || !Number.isFinite(params.minTime) || !Number.isFinite(params.maxTime)) return [];

  const span = Math.max(1, params.maxTime - params.minTime);
  const indexed = candidates
    .map((candidate, index) => ({ ...candidate, index }))
    .filter((candidate) => candidate.text.trim().length > 0 && Number.isFinite(candidate.time));

  const groups = new Map<string, Array<(typeof indexed)[number] & { x: number; width: number }>>();
  for (const candidate of indexed) {
    const labelWidth = Math.min(estimateAnalysisLabelWidth(candidate.text), Math.max(18, chartWidth - 4));
    const clampedTime = clampNumber(candidate.time, params.minTime, params.maxTime);
    const x = Number.isFinite(candidate.x)
      ? candidate.x ?? 0
      : ((clampedTime - params.minTime) / span) * chartWidth;
    if (x < -labelWidth || x > chartWidth + labelWidth) continue;
    const groupKey = Number.isFinite(candidate.time) ? String(candidate.time) : `${candidate.index}`;
    const group = groups.get(groupKey);
    const next = { ...candidate, x, width: labelWidth };
    if (group) group.push(next);
    else groups.set(groupKey, [next]);
  }

  const sortableGroups = Array.from(groups.values())
    .map((items) => {
      const groupWidth = Math.min(Math.max(...items.map((item) => item.width)), Math.max(18, chartWidth - 4));
      const groupX = items.reduce((sum, item) => sum + item.x, 0) / items.length;
      return {
        left: groupX - groupWidth / 2,
        width: groupWidth,
        items: items.sort((a, b) => a.index - b.index),
        index: Math.min(...items.map((item) => item.index)),
      };
    })
    .sort((a, b) => a.left - b.left || a.index - b.index);

  const laneRightEdges: number[] = [];
  const placed: Array<AnalysisFloatingLabel & { index: number }> = [];

  for (const group of sortableGroups) {
    let lane = 0;
    for (const label of group.items) {
      while (laneRightEdges[lane] != null && group.left < laneRightEdges[lane] + FLOATING_LABEL_X_GAP) {
        lane += 1;
      }
      laneRightEdges[lane] = group.left + group.width;
      placed.push({
        id: label.id,
        time: label.time,
        text: label.text,
        color: label.color,
        left: group.left,
        width: group.width,
        lane,
        top: FLOATING_LABEL_TOP + lane * (FLOATING_LABEL_HEIGHT + FLOATING_LABEL_LANE_GAP),
        index: label.index,
      });
      lane += 1;
    }
  }

  return placed
    .sort((a, b) => a.index - b.index)
    .map(({ index: _index, ...label }) => label);
}
