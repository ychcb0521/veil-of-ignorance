import { useCallback, useEffect, useRef, useState } from 'react';
import { createInstantBalanceCalibration, type InstantBalanceCalibrationState } from '@/lib/fish/instantBalanceCalibration';
import type { UsdtLiveCampaign } from '@/lib/fish/usdtLiveCampaign';
import type { useUsdtFollow } from './useUsdtFollow';

type Follow = Pick<ReturnType<typeof useUsdtFollow>, 'connected' | 'orderDesk' | 'readDeskQuote' | 'startedAt' | 'statuses'>;
const idle: InstantBalanceCalibrationState = { ready: false, refreshing: false };

export function useInstantBalanceCalibration(owner: string | undefined, follow: Follow) {
  const session = useRef<ReturnType<typeof createInstantBalanceCalibration>>();
  const [view, setView] = useState<{ owner: string; binding: number; state: InstantBalanceCalibrationState }>();
  const { connected, orderDesk, readDeskQuote, startedAt } = follow;
  useEffect(() => {
    if (!owner || !connected || !orderDesk || !(startedAt > 0)) return;
    const current = createInstantBalanceCalibration(owner, String(startedAt),
      async signal => (await readDeskQuote('BTCUSDT', signal)).available,
      state => setView({ owner, binding: startedAt, state }));
    session.current = current;
    void current.refresh();
    return () => { current.dispose(); if (session.current === current) session.current = undefined; };
  }, [owner, connected, orderDesk, readDeskQuote, startedAt]);
  useEffect(() => { session.current?.statuses(follow.statuses); }, [owner, connected, startedAt, follow.statuses]);
  const campaigns = useCallback((rows: readonly UsdtLiveCampaign[]) => session.current?.campaigns(rows), []);
  const refresh = useCallback(() => session.current?.refresh(), []);
  const current = connected && orderDesk && view?.owner === owner && view.binding === startedAt ? view.state : idle;
  return { ...current, campaigns, refresh };
}
