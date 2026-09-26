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
 * 计算用 K 线的拉取预算：详情页 51 倍拉取窗口里放得下 6000 根的最细周期。
 * 峰值浮盈、决策准确度、反事实副本与一键运行都读按这条预算选出的那一份 K 线——
 * 它只看战役自身的基准窗口，与盘面倍数、手动周期、绝对时间预设全都无关。
 */
export const CAMPAIGN_FETCH_CANDLE_BUDGET = 6_000;
/**
 * 盘面「可读下限」：当前视窗里约 1200 根放得下的最细周期。
 * klinecharts 的 barSpace 下限是 1px，可见根数超过画布宽度（约 1700）会被静默裁掉中心以外的部分。
 */
export const CAMPAIGN_VISIBLE_CANDLE_LIMIT = 1_200;
/** 【用户要求】交易战役原始盘面默认 5 分钟线（放不下时自动放宽）。 */
export const CAMPAIGN_DEFAULT_DISPLAY_INTERVAL: CampaignChartInterval = '5m';

/**
 * 计算用 K 线的周期：按基准拉取窗口（不含绝对预设撑开的部分）在 6000 根预算内取最细。
 * 与改动前「默认打开、没手动改周期」时的自动周期逐位相同，所以峰值浮盈等读数一位不变。
 */
export function pickCampaignComputeInterval(fetch: CampaignChartContentTimeSpan): CampaignChartInterval {
  return pickCampaignOverviewInterval(fetch, CAMPAIGN_FETCH_CANDLE_BUDGET);
}

/**
 * 盘面显示周期（只管显示，不进任何计算）。
 * 没手动选过：取「5 分钟」「可读下限」「拉取预算」三者里最粗的——长战役 2.1 倍放不下 5 分钟线时
 * 自动放宽到 15 分钟 / 1 小时，不裁、不卡。
 * 手动选过：沿用原来的规则——倍率视图原样照手动；绝对预设下不比可读下限 / 拉取预算更细。
 */
export function pickCampaignDisplayInterval(options: {
  /** 手动选过的周期；没选过为 null。 */
  manual: CampaignChartInterval | null;
  /** 当前是否绝对时间预设（1天 / 1周 / 1月）。 */
  absolute: boolean;
  /** 显示用 K 线的拉取窗口。 */
  fetch: CampaignChartContentTimeSpan;
  /** 当前视窗。 */
  visible: CampaignChartContentTimeSpan;
}): CampaignChartInterval {
  const readable = pickCampaignOverviewInterval(options.visible, CAMPAIGN_VISIBLE_CANDLE_LIMIT);
  const fetchable = pickCampaignOverviewInterval(options.fetch, CAMPAIGN_FETCH_CANDLE_BUDGET);
  const floor = pickCoarserCampaignInterval(readable, fetchable);
  if (options.manual) {
    return options.absolute ? pickCoarserCampaignInterval(options.manual, floor) : options.manual;
  }
  return pickCoarserCampaignInterval(CAMPAIGN_DEFAULT_DISPLAY_INTERVAL, floor);
}

/**
 * 没手动选周期、盘面却比 5 分钟线粗时，是哪条下限放宽的——悬停提示要说对原因：
 * - 'visible'：当前视窗里 5 分钟线超过约 1200 根（例如 8 天的战役开 2.1 倍）；
 * - 'fetch'：视窗放得下，是整段拉取范围按 5 分钟线超过 6000 根（例如 12 小时的战役，51 倍拉取约 7300 根）。
 * 盘面就是 5 分钟线（或更细）时返回 null。
 */
export function explainCampaignDisplayIntervalWidening(
  shown: CampaignChartInterval,
  visible: CampaignChartContentTimeSpan,
): 'visible' | 'fetch' | null {
  if (pickCoarserCampaignInterval(shown, CAMPAIGN_DEFAULT_DISPLAY_INTERVAL) === CAMPAIGN_DEFAULT_DISPLAY_INTERVAL) return null;
  const readable = pickCampaignOverviewInterval(visible, CAMPAIGN_VISIBLE_CANDLE_LIMIT);
  return pickCoarserCampaignInterval(readable, CAMPAIGN_DEFAULT_DISPLAY_INTERVAL) === shown ? 'visible' : 'fetch';
}

/**
 * 批量导出盘面（屏幕外 1440px 宽）最多可见的 K 线根数：再多每根不到 1.4px，蜡烛挤成一条色带。
 * 按所选视窗倍数那一段数根数。
 */
export const BATCH_EXPORT_VISIBLE_CANDLE_LIMIT = 1_000;
/**
 * 批量导出盘面一场最多拉取的 K 线根数（约 12 页 × 1500 根）。拉取窗口与详情页一样是 51 倍；
 * 这份 K 线只管盘面显示，盈亏概览读的是与详情页同一份的计算用 K 线（见 pickCampaignComputeInterval）。
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
