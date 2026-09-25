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

/**
 * 取两个候选周期里较粗的那个（按 OVERVIEW_INTERVALS 的顺序）。
 * 用途：绝对预设要同时满足两条约束——可见根数不能撞上 klinecharts barSpace 1px 的硬墙
 * （超过画布宽度约 1700 根就会被静默裁掉中心以外的部分），拉取根数又不能超过今天。
 */
export function pickCoarserCampaignInterval(
  a: CampaignChartInterval,
  b: CampaignChartInterval,
): CampaignChartInterval {
  const indexA = OVERVIEW_INTERVALS.findIndex(item => item.interval === a);
  const indexB = OVERVIEW_INTERVALS.findIndex(item => item.interval === b);
  return indexA >= indexB ? a : b;
}

/**
 * 批量导出盘面（屏幕外 1440px 宽）最多可见的 K 线根数：再多每根不到 1.4px，蜡烛挤成一条色带。
 * 盘面只画默认 3 倍视窗，所以按这一段数根数。
 */
export const BATCH_EXPORT_VISIBLE_CANDLE_LIMIT = 1_000;
/**
 * 批量导出一场最多拉取的 K 线根数（约 12 页 × 1500 根）。拉取窗口与详情页一样是 51 倍（同一份 K 线算同一套指标），
 * 可见根数达到上限时拉取约 17000 根；这条上限只兜住缺少内容边界的旧记录那种异常宽的窗口。
 */
export const BATCH_EXPORT_FETCH_CANDLE_LIMIT = 18_000;

/**
 * 批量导出里用户统一指定的周期：它是下限，而不是被「自动」档的拉取预算（51 倍窗口 6000 根）顶掉。
 * 旧写法与自动档取粗，3 小时的战役选 1 分钟也只能拿到 5 分钟线，选了等于没选。
 * 现在只在两种情况放宽：所选倍数的视窗里按指定周期放不下（BATCH_EXPORT_VISIBLE_CANDLE_LIMIT），
 * 或整段拉取超出 BATCH_EXPORT_FETCH_CANDLE_LIMIT。放宽后的实际周期写在图里，队列里也会标出。
 */
export function pickBatchExportInterval(
  chosen: CampaignChartInterval,
  spans: { fetch: CampaignChartContentTimeSpan; visible: CampaignChartContentTimeSpan },
): CampaignChartInterval {
  const readable = pickCampaignOverviewInterval(spans.visible, BATCH_EXPORT_VISIBLE_CANDLE_LIMIT);
  const fetchable = pickCampaignOverviewInterval(spans.fetch, BATCH_EXPORT_FETCH_CANDLE_LIMIT);
  return pickCoarserCampaignInterval(chosen, pickCoarserCampaignInterval(readable, fetchable));
}
