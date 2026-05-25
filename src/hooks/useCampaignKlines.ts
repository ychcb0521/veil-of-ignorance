import { useMemo } from 'react';
import { useReplayKlines } from '@/hooks/useReplayKlines';

export function useCampaignKlines(
  symbol: string,
  openedAt: string,
  closedAt: string | null,
  interval: string = '5m',
) {
  const openedAtMs = useMemo(() => new Date(openedAt).getTime(), [openedAt]);
  const closedAtMs = useMemo(() => new Date(closedAt ?? Date.now()).getTime(), [closedAt]);
  const fromTime = useMemo(() => openedAtMs - 6 * 60 * 60_000, [openedAtMs]);
  const toTime = useMemo(() => closedAtMs + 2 * 60 * 60_000, [closedAtMs]);

  return {
    ...useReplayKlines(symbol, fromTime, toTime, interval),
    openedAtMs,
    closedAtMs,
    fromTime,
    toTime,
  };
}
