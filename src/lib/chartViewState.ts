/** Tab-local view state only; metric values and trading data are never stored here. */
export type ChartViewState = {
  scrollLeft?: number;
  expandedOverflowId?: string | null;
  guideOpen?: boolean;
};

const PREFIX = 'campaign-chart-view-v1:';

export function readChartViewState(key?: string): ChartViewState {
  if (!key) return {};
  try {
    const value = JSON.parse(sessionStorage.getItem(`${PREFIX}${key}`) ?? '{}');
    if (!value || typeof value !== 'object') return {};
    return {
      scrollLeft: typeof value.scrollLeft === 'number' && Number.isFinite(value.scrollLeft) && value.scrollLeft >= 0 ? value.scrollLeft : undefined,
      expandedOverflowId: typeof value.expandedOverflowId === 'string' ? value.expandedOverflowId : null,
      guideOpen: value.guideOpen === true,
    };
  } catch { return {}; }
}

export function saveChartViewState(key: string | undefined, patch: ChartViewState) {
  if (!key) return;
  try {
    sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ ...readChartViewState(key), ...patch }));
  } catch { /* Disabled/full storage must not block chart interaction or navigation. */ }
}
