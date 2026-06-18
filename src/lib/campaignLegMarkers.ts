import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import type { VerticalLine } from '@/components/journal/ReplayCandleChart';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

export const SELECTED_LEG_LONG_LINE_COLOR = 'rgba(0,47,167,0.84)';
export const SELECTED_LEG_SHORT_LINE_COLOR = 'rgba(54,24,91,0.84)';
export const SELECTED_LEG_VERTICAL_LINE_WIDTH = 0.85;

export function legRoleMarkerLabel(role: TradeJournal['leg_role']): string {
  const label = role ? LEG_ROLE_LABELS[role] : '未归类';
  return label.replace(/开仓$/, '');
}

export function buildSelectedLegVerticalLines(
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  selectedLegIds: string[],
): VerticalLine[] {
  if (selectedLegIds.length === 0) return [];
  const selected = new Set(selectedLegIds);
  const recordMap = new Map(tradeRecords.map(record => [record.id, record]));
  const verticalLines: VerticalLine[] = [];

  for (const leg of legs) {
    if (!selected.has(leg.id)) continue;
    const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
    const openTime = record?.openTime ?? new Date(leg.pre_simulated_time).getTime();
    if (!Number.isFinite(openTime)) continue;
    const closeTime = record?.closeTime ?? (leg.post_real_close_time ? new Date(leg.post_real_close_time).getTime() : null);
    const color = leg.direction === 'short' ? SELECTED_LEG_SHORT_LINE_COLOR : SELECTED_LEG_LONG_LINE_COLOR;
    const labelBase = legRoleMarkerLabel(leg.leg_role);

    verticalLines.push({
      time: openTime,
      color,
      width: SELECTED_LEG_VERTICAL_LINE_WIDTH,
      z: 6,
      dashed: false,
      label: `${labelBase}·开仓`,
      labelColor: color,
      alwaysVisible: true,
    });

    if (closeTime != null && Number.isFinite(closeTime)) {
      verticalLines.push({
        time: closeTime,
        color,
        width: SELECTED_LEG_VERTICAL_LINE_WIDTH,
        z: 6,
        dashed: true,
        label: `${labelBase}·平仓`,
        labelColor: color,
        alwaysVisible: true,
      });
    }
  }

  return verticalLines;
}
