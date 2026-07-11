import type { CampaignCounterfactual, TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';
import { buildTradeRecordLookup, journalSimulatedCloseTime } from '@/lib/objectiveOperationTime';

export type CampaignChartContentTimeSpan = {
  startMs: number | null;
  endMs: number | null;
};

export type CampaignChartInterval = '1m' | '5m' | '15m' | '1h';

const OVERVIEW_INTERVALS: Array<{ interval: CampaignChartInterval; ms: number }> = [
  { interval: '1m', ms: 60_000 },
  { interval: '5m', ms: 5 * 60_000 },
  { interval: '15m', ms: 15 * 60_000 },
  { interval: '1h', ms: 60 * 60_000 },
];

const DEFAULT_MAX_OVERVIEW_CANDLES = 900;

function safeTimeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function appendTime(times: number[], value: number | null | undefined) {
  if (value != null && Number.isFinite(value)) times.push(value);
}

export function buildCampaignChartContentTimeSpan(
  campaign: TradeCampaign | null,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[],
  selectedCounterfactual: CampaignCounterfactual | null,
): CampaignChartContentTimeSpan {
  const times: number[] = [];

  if (campaign) {
    appendTime(times, safeTimeMs(campaign.opened_at));
    appendTime(times, safeTimeMs(campaign.closed_at));
  }

  const recordMap = buildTradeRecordLookup(tradeRecords);
  for (const leg of legs) {
    const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
    appendTime(times, record?.openTime ?? safeTimeMs(leg.pre_simulated_time));
    appendTime(times, record?.closeTime ?? journalSimulatedCloseTime(leg));
  }

  for (const order of reverseHedgeOrders) {
    appendTime(times, order.createdAt);
    appendTime(times, order.triggeredAt);
    appendTime(times, order.cancelledAt);
  }

  if (selectedCounterfactual) {
    appendTime(times, safeTimeMs(selectedCounterfactual.params.entry.time));
    for (const event of selectedCounterfactual.result.events) {
      appendTime(times, safeTimeMs(event.timestamp));
    }
    for (const leg of selectedCounterfactual.result.legs_summary) {
      appendTime(times, safeTimeMs(leg.placed_at));
      appendTime(times, safeTimeMs(leg.triggered_at));
    }
    for (const segment of selectedCounterfactual.result.state_segments) {
      appendTime(times, safeTimeMs(segment.start_time));
      appendTime(times, safeTimeMs(segment.end_time));
    }
  }

  if (times.length === 0) return { startMs: null, endMs: null };
  return {
    startMs: Math.min(...times),
    endMs: Math.max(...times),
  };
}

export function pickCampaignOverviewInterval(
  span: CampaignChartContentTimeSpan,
  maxCandles = DEFAULT_MAX_OVERVIEW_CANDLES,
): CampaignChartInterval {
  if (span.startMs == null || span.endMs == null || span.endMs <= span.startMs) return '1m';
  const duration = span.endMs - span.startMs;
  for (const item of OVERVIEW_INTERVALS) {
    if (duration / item.ms <= maxCandles) return item.interval;
  }
  return '1h';
}
