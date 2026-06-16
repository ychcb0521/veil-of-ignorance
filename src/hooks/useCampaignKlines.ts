import { useMemo } from 'react';
import { useReplayKlines } from '@/hooks/useReplayKlines';

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
  const fromTime = useMemo(
    () => Math.min(openedAtMs, spanStartMs ?? openedAtMs) - 6 * 60 * 60_000,
    [openedAtMs, spanStartMs],
  );
  const toTime = useMemo(
    () => Math.max(closedAtMs, spanEndMs ?? closedAtMs) + 2 * 60 * 60_000,
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
