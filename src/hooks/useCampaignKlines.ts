import { useMemo } from 'react';
import { useReplayKlines } from '@/hooks/useReplayKlines';

/**
 * 退化区间（只有一个事件时间点）时保留的最小上下文，避免 K 线窗口为 0。
 * 正常战役会用“战役跨度本身”作为默认前后上下文，使初始画面形成：
 * 开始前 1/3、战役过程 1/3、结束后 1/3；同时额外预载左右各 10 倍，
 * 供用户继续缩小或拖动查看。
 */
export const CAMPAIGN_EDGE_PAD_MS = 15 * 60_000;
export const CAMPAIGN_AVAILABLE_CONTEXT_MULTIPLIER = 10;

export type CampaignKlineTimeWindow = {
  /** 实际请求并允许浏览的完整 21 倍时间范围。 */
  fromTime: number;
  toTime: number;
  /** 首次打开时显示的 3 倍时间范围。 */
  defaultFromTime: number;
  defaultToTime: number;
  contentStartMs: number | null;
  contentEndMs: number | null;
  /** 默认画面单侧上下文，等于一段战役内容跨度。 */
  contextMs: number | null;
  /** 完整可浏览范围的单侧上下文，等于十段战役内容跨度。 */
  availableContextMs: number | null;
};

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
  // 数据层预载左右各十段上下文，用户缩小或拖动后可查看完整 21 倍范围。
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
