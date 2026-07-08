import { useMemo } from 'react';
import { useReplayKlines } from '@/hooks/useReplayKlines';

/**
 * 退化区间（只有一个事件时间点）时保留的最小上下文，避免 K 线窗口为 0。
 * 正常战役会用“战役跨度本身”作为前后上下文，使图上形成：
 * 开始前 1/3、战役过程 1/3、结束后 1/3。
 */
export const CAMPAIGN_EDGE_PAD_MS = 15 * 60_000;

export type CampaignKlineTimeWindow = {
  fromTime: number;
  toTime: number;
  contentStartMs: number | null;
  contentEndMs: number | null;
  contextMs: number | null;
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
      return {
        fromTime: spanStartMs - contextMs,
        toTime: spanEndMs + contextMs,
        contentStartMs: spanStartMs,
        contentEndMs: spanEndMs,
        contextMs,
      };
    }
    return {
      fromTime: spanStartMs - CAMPAIGN_EDGE_PAD_MS,
      toTime: spanEndMs + CAMPAIGN_EDGE_PAD_MS,
      contentStartMs: spanStartMs,
      contentEndMs: spanEndMs,
      contextMs: CAMPAIGN_EDGE_PAD_MS,
    };
  }

  // 空战役或历史数据异常时，保留原来的宽松兜底，避免旧数据突然没有上下文。
  return {
    fromTime: openedAtMs - 6 * 60 * 60_000,
    toTime: closedAtMs + 2 * 60 * 60_000,
    contentStartMs: null,
    contentEndMs: null,
    contextMs: null,
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
  // 有 Legs/委托/反事实内容区间时，K 线窗口 = 内容跨度前后各补一整段同等时长：
  // [开始前上下文] [完整战役内容] [结束后上下文]，三段各占 1/3。
  // 不再用固定 15 分钟撑开窗口——长战役需要成比例的前后行情。
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
