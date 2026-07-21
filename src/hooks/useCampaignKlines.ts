import { useMemo } from 'react';
import { useReplayKlines } from '@/hooks/useReplayKlines';

/**
 * 退化区间（只有一个事件时间点）时保留的最小上下文，避免 K 线窗口为 0。
 * 正常战役会用“战役跨度本身”作为默认前后上下文，使初始画面形成：
 * 开始前 1/3、战役过程 1/3、结束后 1/3；同时额外预载左右各 25 倍，
 * 供用户继续缩小或拖动查看。
 */
export const CAMPAIGN_EDGE_PAD_MS = 15 * 60_000;
export const CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER = 25;
export const CAMPAIGN_VIEW_MULTIPLIERS = [2, 3, 5, 11, 21, 31, 41, 51] as const;
export type CampaignViewMultiplier = 1 | (typeof CAMPAIGN_VIEW_MULTIPLIERS)[number];

export type CampaignKlineTimeWindow = {
  /** 实际请求并允许浏览的完整 51 倍时间范围。 */
  fromTime: number;
  toTime: number;
  /** 首次打开时显示的 3 倍时间范围。 */
  defaultFromTime: number;
  defaultToTime: number;
  contentStartMs: number | null;
  contentEndMs: number | null;
  /** 默认画面单侧上下文，等于一段战役内容跨度。 */
  contextMs: number | null;
  /** 完整可浏览范围的单侧上下文，等于二十五段战役内容跨度。 */
  availableContextMs: number | null;
};

export type CampaignKlineVisibleRange = {
  fromTime: number;
  toTime: number;
};

/**
 * 把指定倍数的窗口放在战役内容正中。
 * 1 倍 = 战役内容本身，不附加前后上下文；
 * 例如 3 倍 = 左 1 倍 + 战役 1 倍 + 右 1 倍；
 * 2 倍 = 左 0.5 倍 + 战役 1 倍 + 右 0.5 倍。
 */
export function buildCampaignKlineVisibleRange(
  window: CampaignKlineTimeWindow,
  multiplier: CampaignViewMultiplier,
): CampaignKlineVisibleRange {
  const hasContentRange = window.contentStartMs != null
    && Number.isFinite(window.contentStartMs)
    && window.contentEndMs != null
    && Number.isFinite(window.contentEndMs)
    && window.contextMs != null
    && Number.isFinite(window.contextMs)
    && window.contextMs > 0;

  if (hasContentRange) {
    const edgeContextMs = window.contextMs * (multiplier - 1) / 2;
    return {
      fromTime: Math.max(window.fromTime, window.contentStartMs - edgeContextMs),
      toTime: Math.min(window.toTime, window.contentEndMs + edgeContextMs),
    };
  }

  // 极少数缺少内容边界的旧记录：以原默认窗口为 3 倍基准，并限制在已拉取范围内。
  const centerTime = (window.defaultFromTime + window.defaultToTime) / 2;
  const defaultSpanMs = Math.max(0, window.defaultToTime - window.defaultFromTime);
  const requestedHalfSpanMs = defaultSpanMs * multiplier / 6;
  return {
    fromTime: Math.max(window.fromTime, centerTime - requestedHalfSpanMs),
    toTime: Math.min(window.toTime, centerTime + requestedHalfSpanMs),
  };
}

export function buildCampaignKlineTimeWindow(
  openedAtMs: number,
  closedAtMs: number,
  spanStartMs: number | null = null,
  spanEndMs: number | null = null,
): CampaignKlineTimeWindow {
  const hasStart = spanStartMs != null && Number.isFinite(spanStartMs);
  const hasEnd = spanEndMs != null && Number.isFinite(spanEndMs);
  if (hasStart && hasEnd) {
    if (spanEndMs > spanStartMs) {
      const contextMs = spanEndMs - spanStartMs;
      const availableContextMs = contextMs * CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER;
      return {
        fromTime: spanStartMs - availableContextMs,
        toTime: spanEndMs + availableContextMs,
        defaultFromTime: spanStartMs - contextMs,
        defaultToTime: spanEndMs + contextMs,
        contentStartMs: spanStartMs,
        contentEndMs: spanEndMs,
        contextMs,
        availableContextMs,
      };
    }
    const availableContextMs = CAMPAIGN_EDGE_PAD_MS * CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER;
    return {
      fromTime: spanStartMs - availableContextMs,
      toTime: spanEndMs + availableContextMs,
      defaultFromTime: spanStartMs - CAMPAIGN_EDGE_PAD_MS,
      defaultToTime: spanEndMs + CAMPAIGN_EDGE_PAD_MS,
      contentStartMs: spanStartMs,
      contentEndMs: spanEndMs,
      contextMs: CAMPAIGN_EDGE_PAD_MS,
      availableContextMs,
    };
  }

  // 空战役或历史数据异常时，保留原来的宽松兜底，避免旧数据突然没有上下文。
  const fromTime = openedAtMs - 6 * 60 * 60_000;
  const toTime = closedAtMs + 2 * 60 * 60_000;
  return {
    fromTime,
    toTime,
    defaultFromTime: fromTime,
    defaultToTime: toTime,
    contentStartMs: null,
    contentEndMs: null,
    contextMs: null,
    availableContextMs: null,
  };
}

export function useCampaignKlines(
  symbol: string,
  openedAt: string,
  closedAt: string | null,
  interval: string = '5m',
  // Legs 列表的最早/最晚时间：确保 K 线前后区间把所有腿的开/平时间囊括进去。
  spanStartMs: number | null = null,
  spanEndMs: number | null = null,
) {
  const openedAtMs = useMemo(() => new Date(openedAt).getTime(), [openedAt]);
  const closedAtMs = useMemo(() => new Date(closedAt ?? Date.now()).getTime(), [closedAt]);
  // 有 Legs/委托/反事实内容区间时，初始可见窗口仍是三段各占 1/3；
  // 数据层预载左右各二十五段上下文，用户可一键切换并查看完整 51 倍范围。
  const window = useMemo(
    () => buildCampaignKlineTimeWindow(openedAtMs, closedAtMs, spanStartMs, spanEndMs),
    [closedAtMs, openedAtMs, spanEndMs, spanStartMs],
  );

  return {
    ...useReplayKlines(symbol, window.fromTime, window.toTime, interval),
    openedAtMs,
    closedAtMs,
    ...window,
  };
}
