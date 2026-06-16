import { useMemo } from 'react';
import { useReplayKlines } from '@/hooks/useReplayKlines';

/**
 * 战役 K 线在 Legs 区间两端各留的缓冲，避免首/尾竖线贴边、并给指标一点回看。
 * 同一常量也用于主图游标（chartCurrentTime），保证游标不超出已拉取的数据范围。
 */
export const CAMPAIGN_EDGE_PAD_MS = 15 * 60_000;

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
  // 有 Legs 区间时，K 线窗口 = 区间两端各留 CAMPAIGN_EDGE_PAD_MS，完全对齐 Legs 的开/平时间；
  // 不再用 campaign.opened_at/closed_at 撑开窗口——回填战役的这两个时间未必落在 Legs 的真实 K 线段上。
  // 只有在拿不到 Legs 区间（空战役）时，才退回旧的「开仓前 6h、平仓后 2h」兜底。
  const fromTime = useMemo(
    () => (spanStartMs != null ? spanStartMs - CAMPAIGN_EDGE_PAD_MS : openedAtMs - 6 * 60 * 60_000),
    [openedAtMs, spanStartMs],
  );
  const toTime = useMemo(
    () => (spanEndMs != null ? spanEndMs + CAMPAIGN_EDGE_PAD_MS : closedAtMs + 2 * 60 * 60_000),
    [closedAtMs, spanEndMs],
  );

  return {
    ...useReplayKlines(symbol, fromTime, toTime, interval),
    openedAtMs,
    closedAtMs,
    fromTime,
    toTime,
  };
}
