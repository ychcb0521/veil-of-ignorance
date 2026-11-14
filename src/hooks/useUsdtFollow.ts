import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FishCdaTracking } from './useFishCdaTracking';
import { usdtFollowCampaigns, type UsdtFollowStatus } from '@/lib/fish/usdtFollow';

const endpoint = 'http://127.0.0.1:47321/api/usdt-follow';
const key = (owner: string) => 'veil.usdt-follow-pairing.v1:' + owner;
interface FollowState {
  connected: boolean;
  paused: boolean;
  startedAt: number;
  statuses: UsdtFollowStatus[];
}
const disconnected: FollowState = { connected: false, paused: false, startedAt: 0, statuses: [] };

export function useUsdtFollow(owner: string | undefined, tracking: FishCdaTracking) {
  const [pairing, setPairing] = useState<{ owner?: string; token?: string }>({});
  const [state, setState] = useState<{ owner?: string; data: FollowState }>({ data: disconnected });
  const [issue, setIssue] = useState('');
  const token = pairing.owner === owner ? pairing.token : undefined;
  const campaigns = useMemo(() => token ? usdtFollowCampaigns(tracking) : [],
    [token, tracking.admitted, tracking.localSales, tracking.alerts, tracking.monitorResults, tracking.mirrorFills, tracking.manualPositions]);
  const latest = useRef(campaigns);
  latest.current = campaigns;
  const wake = useRef<() => void>();
  const commandPending = useRef<'pause' | 'resume'>();
  useEffect(() => {
    if (!owner) return;
    const refresh = () => {
      try { setPairing({ owner, token: localStorage.getItem(key(owner)) ?? undefined }); }
      catch { setPairing({ owner }); }
    };
    const storage = (event: StorageEvent) => { if (event.key === key(owner)) refresh(); };
    refresh();
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, [owner]);

  useEffect(() => {
    setIssue('');
    setState({ owner, data: disconnected });
    if (!owner || !token) return;
    const lifetime = new AbortController();
    let running = false, pending = false, startedAt = 0;
    let known = new Set<string>();
    let lastResponse = '';
    commandPending.current = undefined;
    const tick = () => {
      if (lifetime.signal.aborted) return;
      if (running) { pending = true; return; }
      running = true;
      const command = commandPending.current ?? 'sync';
      const current = latest.current.filter(row => known.has(row.id) || row.admittedAt >= startedAt && Date.now() - row.admittedAt <= 120_000);
      void (async () => {
        try {
          const response = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            credentials: 'omit', redirect: 'error', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(6000)]),
            body: JSON.stringify({ owner, command, campaigns: current.slice(-250) }),
          });
          const payload = await response.json();
          if (!response.ok) throw Error(typeof payload.error === 'string' ? payload.error : '本机执行端拒绝连接');
          if (payload.connected !== true || !Array.isArray(payload.statuses)) throw Error('本机执行端回报无效');
          if (lifetime.signal.aborted) return;
          startedAt = payload.startedAt;
          known = new Set(payload.statuses.filter((row: UsdtFollowStatus) => !['ignored', 'closed'].includes(row.state)).map((row: UsdtFollowStatus) => row.id));
          if (commandPending.current === command) commandPending.current = undefined;
          const wire = JSON.stringify(payload);
          if (wire !== lastResponse) {
            lastResponse = wire;
            setState({ owner, data: payload as FollowState });
          }
          setIssue('');
        } catch (error) {
          if (lifetime.signal.aborted) return;
          lastResponse = '';
          setState(previous => !previous.data.connected ? previous : { owner, data: { ...previous.data, connected: false } });
          setIssue(error instanceof TypeError || error instanceof DOMException ? '本机 U 本位执行端未连通' : error instanceof Error ? error.message : '本机执行端未连通');
        } finally {
          running = false;
          if (pending) { pending = false; tick(); }
        }
      })();
    };
    wake.current = tick;
    const interval = setInterval(tick, 2000);
    tick();
    return () => { lifetime.abort(); clearInterval(interval); wake.current = undefined; };
  }, [owner, token]);
  useEffect(() => { wake.current?.(); }, [campaigns]);

  const connect = useCallback((value: string) => {
    const token = value.trim().toLowerCase();
    if (!owner || !/^[0-9a-f]{64}$/.test(token)) throw Error('请输入本机执行端的 64 位配对码');
    localStorage.setItem(key(owner), token);
    setPairing({ owner, token });
  }, [owner]);
  const pause = useCallback(() => { commandPending.current = 'pause'; wake.current?.(); }, []);
  const resume = useCallback(() => { commandPending.current = 'resume'; wake.current?.(); }, []);
  const data = state.owner === owner ? state.data : disconnected;
  return { ...data, owner, paired: !!token, issue, connect, pause, resume };
}
