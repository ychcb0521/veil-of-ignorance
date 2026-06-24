import type { TimeBoundPriceLine } from '@/components/journal/ReplayCandleChart';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

export const MAIN_LONG_ORDER_LINE_COLOR = '#0ECB81';
export const MAIN_SHORT_ORDER_LINE_COLOR = '#F6465D';

export function isMainStartLeg(leg: Pick<TradeJournal, 'leg_role'>): boolean {
  return leg.leg_role === 'main_open' || leg.leg_role === 'reentry_main';
}

function safeTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function mainStartLabel(leg: Pick<TradeJournal, 'leg_role'>): string {
  return leg.leg_role === 'reentry_main' ? '再入主力' : '主力开仓';
}

export function buildCampaignMainOrderPriceLines(
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  fallbackEnd: number,
): TimeBoundPriceLine[] {
  const recordMap = new Map(tradeRecords.map(record => [record.id, record]));
  return legs
    .filter(isMainStartLeg)
    .flatMap((leg) => {
      const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
      const price = record?.entryPrice ?? leg.pre_entry_price ?? null;
      const openTime = record?.openTime ?? safeTimeMs(leg.pre_simulated_time);
      const closeTime = record?.closeTime ?? safeTimeMs(leg.post_real_close_time) ?? fallbackEnd;
      if (
        price == null ||
        openTime == null ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isFinite(openTime) ||
        !Number.isFinite(closeTime) ||
        closeTime <= openTime
      ) {
        return [];
      }

      return [{
        price,
        color: leg.direction === 'short' ? MAIN_SHORT_ORDER_LINE_COLOR : MAIN_LONG_ORDER_LINE_COLOR,
        startTime: openTime,
        endTime: closeTime,
        dashed: false,
        endMarker: null,
        title: mainStartLabel(leg),
      }];
    });
}
