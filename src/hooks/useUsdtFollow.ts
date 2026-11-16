import { usdtMirrorRevision, type UsdtMirrorHistory, type UsdtMirrorPosition, type UsdtMirrorSnapshot } from '@/lib/fish/usdtPositionMirror';
import type { UsdtCampaignBatch, UsdtLiveCampaign } from '@/lib/fish/usdtLiveCampaign';
import type { BinanceManualAnchor, BinanceManualDecision, BinanceManualState } from '@/lib/fish/binanceManualMonitor';
import type { InstantMonitorSettings } from '@/lib/fish/instantMonitorSettings';
import type { QualityResult } from '@/lib/fish/quality';
import type { UsdtPositionControlRequest, UsdtPositionControlResult } from '@/lib/fish/usdtPositionControls';
import type { UsdtDeskOpenRequest, UsdtDeskQuote } from '@/lib/fish/usdtOrderDesk';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FishCdaTracking } from './useFishCdaTracking';
import { readFishPreferences, writeFishPreference } from '@/lib/fish/fishPreferencesDb';
import { currentUsdtFollowCampaign, usdtFollowCampaigns, type UsdtFollowStatus } from '@/lib/fish/usdtFollow';
import { USDT_EXECUTION_PATH, USDT_EXECUTION_SAFETY } from '@/lib/fish/usdtLiveEntry';

const endpoint = 'http://127.0.0.1:47321/api/usdt-follow';
const executionEndpoint = 'http://127.0.0.1:47321' + USDT_EXECUTION_PATH;
const key = (owner: string) => 'veil.usdt-follow-pairing.v1:' + owner;
const pairingCode = /^[0-9a-f]{64}$/;

async function readPairing(owner: string) {
  const storageKey = key(owner);
  const [saved] = await readFishPreferences<string>([storageKey]).catch(() => []);
  if (typeof saved === 'string' && pairingCode.test(saved)) return saved;
  try {
    const legacy = localStorage.getItem(storageKey);
    return legacy && pairingCode.test(legacy) ? legacy : undefined;
  } catch { return undefined; }
}
interface FollowState {
  connected: boolean;
  paused: boolean;
  startedAt: number;
  statuses: UsdtFollowStatus[];
  positionMirror?: 1;
  campaignMirror?: 1;
  guardPlusAdditions?: 1;
  manualMonitor?: 1;
  positionControls?: 1;
  orderDesk?: 1;
  executionSafety?: number;
  controlRevision?: number;
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
  const commandPending = useRef<{ kind: 'pause' | 'resume'; revision?: number }>();
  const control = useRef<{ executionSafety?: number; controlRevision?: number }>({});
  const pairingChannel = useRef<BroadcastChannel>();
  const pairingWrite = useRef(0);
  useEffect(() => {
    if (!owner) return;
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const request = ++revision;
      const write = pairingWrite.current;
      const token = await readPairing(owner);
      if (active && request === revision && write === pairingWrite.current) setPairing({ owner, token });
    };
    const storage = (event: StorageEvent) => { if (event.key === key(owner)) void refresh(); };
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(key(owner));
      channel.onmessage = () => void refresh();
      pairingChannel.current = channel;
    } catch { /* A page reload will read the saved pairing. */ }
    void refresh();
    window.addEventListener('storage', storage);
    return () => {
      active = false;
      window.removeEventListener('storage', storage);
      channel?.close();
      pairingChannel.current = undefined;
    };
  }, [owner]);

  useEffect(() => {
    setIssue('');
    setState({ owner, data: disconnected });
    if (!owner || !token) return;
    const lifetime = new AbortController();
    let running = false, pending = false, startedAt = 0;
    let supportsGuardPlus = false;
    let known = new Set<string>();
    let lastResponse = '';
    let connectedOnce = false;
    let legacyPaused = false;
    let legacyMirror: FollowState | undefined;
    let lastLegacyProbe = 0;
    control.current = {};
    commandPending.current = undefined;
    const tick = () => {
      if (lifetime.signal.aborted) return;
      if (running) { pending = true; return; }
      running = true;
      const pendingCommand = commandPending.current;
      const command = pendingCommand?.kind ?? (connectedOnce ? 'sync' : 'status');
      const now=Date.now();
      const current = latest.current
        .filter(row => known.has(row.id) || control.current.executionSafety === USDT_EXECUTION_SAFETY
          && row.liveEntry && row.admittedAt >= startedAt && now - row.admittedAt <= 120_000)
        .flatMap(row => {
          const campaign = currentUsdtFollowCampaign(row, supportsGuardPlus, now);
          if (!campaign) return [];
          return [control.current.executionSafety === USDT_EXECUTION_SAFETY ? campaign
            : { ...campaign, actions: campaign.actions.filter(action => action.action !== 'add') }];
        });
      void (async () => {
        try {
          const target = command === 'sync' || pendingCommand?.revision !== undefined ? executionEndpoint : endpoint;
          const send = (kind: typeof command, entries: typeof current) => fetch(target, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            credentials: 'omit', redirect: 'error', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(6000)]),
            body: JSON.stringify({ owner, command: kind, campaigns: entries,
              ...(pendingCommand?.revision === undefined ? {} : { controlRevision: pendingCommand.revision }) }),
          });
          let response = await send(command, command === 'sync' ? current.slice(-250) : []);
          let payload = await response.json();
          if (command === 'status' && response.status === 400 && payload.error === '未知的实盘指令') {
            if (!legacyMirror || now - lastLegacyProbe >= 15_000) {
              response = await fetch(endpoint, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
                credentials: 'omit', redirect: 'error', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(25_000)]),
                body: JSON.stringify({ owner, command: 'positions', withDetails: true }),
              });
              payload = await response.json();
              if (!response.ok || !Array.isArray(payload.positions)) throw Error(payload.error || '本机币安持仓暂不可读');
              lastLegacyProbe = now;
              legacyMirror = { ...disconnected, connected: true, positionMirror: 1, campaignMirror: 1,
                ...(payload.positions.some((row: UsdtMirrorPosition) => row.protectionOrders !== undefined || row.protectionIssue)
                  ? { positionControls: 1 } : {}) };
            }
            payload = { ...legacyMirror, paused: legacyPaused };
            response = new Response(null, { status: 200 });
          }
          const stale = response.status === 409 && payload.staleControl === true;
          if (!response.ok && !stale) throw Error(typeof payload.error === 'string' ? payload.error : '本机执行端拒绝连接');
          if (payload.connected !== true || !Array.isArray(payload.statuses)) throw Error('本机执行端回报无效');
          if (lifetime.signal.aborted) return;
          connectedOnce = payload.executionSafety === USDT_EXECUTION_SAFETY;
          if (pendingCommand?.kind === 'pause' && !connectedOnce) legacyPaused = true;
          control.current = { executionSafety: payload.executionSafety, controlRevision: payload.controlRevision };
          startedAt = payload.startedAt;
          const capabilityChanged=supportsGuardPlus!==(payload.guardPlusAdditions===1);
          supportsGuardPlus=payload.guardPlusAdditions===1;
          if(capabilityChanged)pending=true;
          known = new Set(payload.statuses.filter((row: UsdtFollowStatus) => !['ignored', 'closed'].includes(row.state)).map((row: UsdtFollowStatus) => row.id));
          if (commandPending.current === pendingCommand) commandPending.current = undefined;
          const wire = JSON.stringify(payload);
          if (wire !== lastResponse) {
            lastResponse = wire;
            setState({ owner, data: payload as FollowState });
          }
          setIssue(stale ? payload.error : '');
        } catch (error) {
          if (lifetime.signal.aborted) return;
          connectedOnce = false;
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

  const connect = useCallback(async (value: string) => {
    const token = value.trim().toLowerCase();
    if (!owner || !pairingCode.test(token)) throw Error('请输入本机执行端的 64 位配对码');
    const write = ++pairingWrite.current;
    const channel = pairingChannel.current;
    try {
      await writeFishPreference(key(owner), token);
    } catch {
      throw Error('浏览器暂时无法保存配对码，请稍后重试。');
    }
    if (write !== pairingWrite.current) return;
    // Ignore a read that started before this transaction committed.
    pairingWrite.current++;
    setPairing({ owner, token });
    if (pairingChannel.current === channel) channel?.postMessage('saved');
  }, [owner]);
  const pause = useCallback(() => {
    commandPending.current = { kind: 'pause', revision: control.current.controlRevision };
    wake.current?.();
  }, []);
  const resume = useCallback(() => {
    if (control.current.executionSafety !== USDT_EXECUTION_SAFETY || !Number.isSafeInteger(control.current.controlRevision)) return;
    commandPending.current = { kind: 'resume', revision: control.current.controlRevision };
    wake.current?.();
  }, []);
  const readMirror = useCallback(async <T,>(content:Record<string,unknown>, signal:AbortSignal, timeout:number, safe = false):Promise<T> => {
    if (!owner || !token) throw Error('请先连接本机 U 本位执行端');
    const response = await fetch(safe ? executionEndpoint : endpoint, {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+token },
      credentials:'omit', redirect:'error', signal:AbortSignal.any([signal,AbortSignal.timeout(timeout)]),
      body:JSON.stringify({...content,owner}),
    });
    const payload = await response.json();
    if (!response.ok) throw Error(typeof payload?.error === 'string' ? payload.error : '本机执行端拒绝读取币安仓位');
    return payload as T;
  },[owner,token]);
  const readPositions=useCallback(async (signal:AbortSignal) => {
    const result=await readMirror<UsdtMirrorSnapshot>({command:'positions',withDetails:true},signal,25000);
    if(!Array.isArray(result.positions)||!Number.isSafeInteger(result.observedAt)) throw Error('币安持仓回报无效');
    return result;
  },[readMirror]);
  const readPositionHistory=useCallback(async (position:UsdtMirrorPosition,signal:AbortSignal) => {
    const result=await readMirror<UsdtMirrorHistory>({command:'position-history',symbol:position.symbol,positionSide:position.positionSide,
      revision:usdtMirrorRevision(position)},signal,60000);
    if(!Array.isArray(result.fills)) throw Error('币安逐笔成交回报无效');
    return result;
  },[readMirror]);
  const readCampaigns = useCallback(async (since: number, open: Pick<UsdtLiveCampaign, 'symbol' | 'openedAt'>[], signal: AbortSignal) => {
    const batch = await readMirror<UsdtCampaignBatch>({command:'position-campaigns', since, open}, signal, 70_000);
    if (!Number.isSafeInteger(batch.observedAt) || !Array.isArray(batch.campaigns)) throw Error('币安实盘战役回报无效');
    return batch;
  }, [readMirror]);
  const readManualMonitor = useCallback((signal: AbortSignal) =>
    readMirror<BinanceManualState>({ command: 'manual-monitor-status' }, signal, 10_000), [readMirror]);
  const adoptManualMonitor = useCallback((anchor: BinanceManualAnchor, monitor: InstantMonitorSettings, controlRevision: number, signal: AbortSignal) =>
    readMirror({ command: 'manual-monitor-adopt', anchor, monitor, confirmed: true,
      controlRevision }, signal, 60_000, true), [readMirror]);
  const advanceManualMonitor = useCallback((id: string, revision: number, checkpoint: QualityResult, decision: BinanceManualDecision | undefined, signal: AbortSignal) =>
    readMirror({ command: 'manual-monitor-update', id, revision, checkpoint, decision }, signal, 15_000, true), [readMirror]);
  const controlPosition = useCallback((request: UsdtPositionControlRequest, signal: AbortSignal) =>
    readMirror<UsdtPositionControlResult>({ command: 'position-control', request }, signal, 70_000), [readMirror]);
  const readDeskQuote = useCallback((symbol: string, signal: AbortSignal) =>
    readMirror<UsdtDeskQuote>({command:'desk-info',symbol},signal,25_000,true),[readMirror]);
  const deskOpen = useCallback((request: UsdtDeskOpenRequest, signal: AbortSignal) =>
    readMirror<UsdtPositionControlResult>({command:'desk-open',request},signal,60_000,true),[readMirror]);
  const deskClose = useCallback((request: UsdtPositionControlRequest, signal: AbortSignal) =>
    readMirror<UsdtPositionControlResult>({command:'desk-close',request},signal,70_000,true),[readMirror]);
  const data = state.owner === owner ? state.data : disconnected;
  return { ...data, owner, paired: !!token, issue, connect, pause, resume, readPositions, readPositionHistory, readCampaigns,
    readManualMonitor, adoptManualMonitor, advanceManualMonitor, controlPosition, readDeskQuote, deskOpen, deskClose };
}
