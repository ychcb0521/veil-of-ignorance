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
export const FLOATING_LABEL_HEIGHT = 18;
const FLOATING_LABEL_LANE_GAP = 4;
const FLOATING_LABEL_X_GAP = 6;

const estimateAnalysisLabelWidth = (text: string) => {
  const visualUnits = Array.from(text).reduce((sum, char) => {
    const code = char.codePointAt(0) ?? 0;
    return sum + (code > 255 ? 1.75 : 1);
  }, 0);
  return Math.ceil(Math.min(240, Math.max(26, visualUnits * 7 + 18)));
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

  const sortable = indexed
    .map((candidate) => {
      const labelWidth = Math.min(estimateAnalysisLabelWidth(candidate.text), Math.max(26, chartWidth - 4));
      const clampedTime = clampNumber(candidate.time, params.minTime, params.maxTime);
      const x = Number.isFinite(candidate.x)
        ? clampNumber(candidate.x ?? 0, 0, chartWidth)
        : ((clampedTime - params.minTime) / span) * chartWidth;
      const left = clampNumber(x - labelWidth / 2, 2, Math.max(2, chartWidth - labelWidth - 2));
      return { ...candidate, left, width: labelWidth };
    })
    .sort((a, b) => a.left - b.left || a.index - b.index);

  const laneRightEdges: number[] = [];
  const placed: Array<AnalysisFloatingLabel & { index: number }> = [];

  for (const label of sortable) {
    let lane = 0;
    while (laneRightEdges[lane] != null && label.left < laneRightEdges[lane] + FLOATING_LABEL_X_GAP) {
      lane += 1;
    }
    laneRightEdges[lane] = label.left + label.width;
    placed.push({
      id: label.id,
      time: label.time,
      text: label.text,
      color: label.color,
      left: label.left,
      width: label.width,
      lane,
      top: FLOATING_LABEL_TOP + lane * (FLOATING_LABEL_HEIGHT + FLOATING_LABEL_LANE_GAP),
      index: label.index,
    });
  }

  return placed
    .sort((a, b) => a.index - b.index)
    .map(({ index: _index, ...label }) => label);
}
