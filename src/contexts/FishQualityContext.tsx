import { registerInstantHoldingCheck } from '@/lib/fish/instantAdmission';
import {QualityTemplateNamesContext} from './QualityTemplateNamesContext';
import {qualityTemplateNames} from '@/lib/fish/qualityTemplateNames';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useFishQuality, type FishQualityState, type QualityRunner } from '@/hooks/useFishQuality';
import { runPageFishQuality } from '@/hooks/useFish';
import type { TradeSignal } from '@/lib/signalLibrary';
import { useFishNotify } from '@/hooks/useFishNotify';
import { useFishCdaTracking } from '@/hooks/useFishCdaTracking';
import { useInstantCampaigns } from '@/hooks/useInstantCampaigns';
import { useUsdtFollow } from '@/hooks/useUsdtFollow';
import { useUsdtLiveTrading } from '@/hooks/useUsdtLiveTrading';
import { useBinanceManualMonitor } from '@/hooks/useBinanceManualMonitor';
import { useFishScreeningAutomation } from '@/hooks/useFishScreeningAutomation';

import { registerInstantBalanceReader } from '@/lib/fish/instantPositionSettings';
import {prioritizeInstantScreening} from '@/lib/fish/libraryLoadQueue';
import {loadFishAccountPreferences} from '@/hooks/useFishAccountSettings';
import { useInstantPositionSettings } from '@/hooks/useInstantPositionSettings';
import { useInstantMonitorSettings } from '@/hooks/useInstantMonitorSettings';

const EMPTY: readonly TradeSignal[] = [];
type InstantPositionsView = Pick<ReturnType<typeof useFishCdaTracking>, 'monitorResults' | 'mirrorFills' | 'manualPositions'> & {
  positions: ReturnType<typeof useInstantCampaigns>['positions'];
  usdtFollow?: ReturnType<typeof useUsdtFollow>;
  usdtLive?: ReturnType<typeof useUsdtLiveTrading> & { management?: ReturnType<typeof useBinanceManualMonitor> };
  manage?: ReturnType<typeof useFishCdaTracking>['managePosition'];
};
export const InstantPositionsContext = createContext<InstantPositionsView | null>(null);
export const useScreenedInstantPositions = () => useContext(InstantPositionsContext);
const FishQualityContext = createContext<{ state: FishQualityState; sources: (fish: readonly TradeSignal[], library: readonly TradeSignal[], turing: readonly TradeSignal[], researchOpen: boolean, screeningOpen: boolean) => void; activate: () => void; enqueue: ReturnType<typeof useFishScreeningAutomation>['enqueue']; notify: ReturnType<typeof useFishNotify> } | null>(null);

/** Owned by the authenticated app shell, outside the route boundary and collapsible panels. */
export function FishQualityProvider({ owner, children, run = runPageFishQuality }: { owner?: string; children: ReactNode; run?: QualityRunner }) {
  const [input, setInput] = useState({ fish: EMPTY, library: EMPTY, turing: EMPTY });
  const [requested, setRequested] = useState(false);
  const [screeningRequested, setScreeningRequested] = useState(false);
  // The mining directory owns its archive and reads it on open.
  const state = useFishQuality(owner, input.fish, run, input.library, EMPTY, requested, input.turing, true, screeningRequested);
  const [preferenceAttempt, setPreferenceAttempt] = useState(0);
  const [preferences, setPreferences] = useState<{owner: string; ready: boolean}>();
  useEffect(() => {
    if (!owner) return;
    let active = true;
    setPreferences(undefined);
    const finish = (ready: boolean) => { if (active) setPreferences({owner, ready}); };
    void loadFishAccountPreferences(owner).then(finish, () => finish(false));
    return () => { active = false; };
  }, [owner, preferenceAttempt]);
  const preferenceStatus = preferences && preferences.owner === owner ? (preferences.ready ? 'ready' : 'error') : 'loading';
  const notify = useFishNotify(owner, undefined, undefined, true);
  const instantMonitor = useInstantMonitorSettings(owner);
  const instantPosition = useInstantPositionSettings(owner);
  const preEntry = state.preEntry;
  const automaticReady=preEntry.automaticReady??preEntry.ready;
  const executionMonitor = { ...preEntry,...preEntry.automaticState,ready:automaticReady, library: preEntry.automaticLibrary };
  const cdaTracking = useFishCdaTracking(owner, executionMonitor.library, automaticReady || preEntry.instantReady && preferenceStatus === 'ready', notify, true);
  const usdtFollow = useUsdtFollow(owner, cdaTracking);
  const usdtLive = useUsdtLiveTrading(owner, usdtFollow);
  useEffect(() => {
    if (!owner || !usdtFollow.connected || !usdtFollow.orderDesk) return;
    return registerInstantBalanceReader(owner, async signal => (await usdtFollow.readDeskQuote('BTCUSDT', signal)).available);
  }, [owner, usdtFollow.connected, usdtFollow.orderDesk, usdtFollow.readDeskQuote]);
  const management = useBinanceManualMonitor(usdtFollow, usdtLive, instantMonitor.settings);
  const { issue: campaignIssue, positions } = useInstantCampaigns(owner, cdaTracking, true);
  const holdingsReady = usdtFollow.pairingReady && (!usdtFollow.paired || usdtFollow.connected && !!usdtLive.snapshot && !usdtLive.issue);
  const fastReady = preferenceStatus === 'ready' && instantMonitor.restoreStatus === 'ready' && preEntry.instantReady && holdingsReady;
  const automatic = useFishScreeningAutomation(owner, automaticReady || fastReady, executionMonitor, notify, preferenceStatus === 'ready' && !!instantPosition.settings);
  let waitingReason = automatic.waitingReason;
  if (!automaticReady && automatic.pending && !automatic.paused) {
    if (preferenceStatus !== 'ready') waitingReason = preferenceStatus === 'error' ? '账号设置读取失败' : '正在读取即时交易设置';
    else if (instantMonitor.restoreStatus !== 'ready') waitingReason = instantMonitor.restoreStatus === 'error' ? '买后设置读取失败，正在重试' : '正在核对买后设置';
    else if (!preEntry.instantReady) waitingReason = preEntry.instantLoadError || '正在核对即时持仓记录';
    else if (!holdingsReady) waitingReason = '正在核对实盘连接与持仓';
  }
  const automaticScreening = { ...automatic, waitingReason };
  useEffect(() => owner ? registerInstantHoldingCheck(owner, symbol => {
    const code = symbol.replace(/\//g, '').toUpperCase();
    if ((!automaticReady && !holdingsReady) || (usdtFollow.connected && (!usdtLive.snapshot || usdtLive.issue))) {
      throw Error('实盘持仓尚未核对，等待同步后再判断开仓');
    }
    return (usdtLive.snapshot?.positions ?? []).some(row => row.symbol.replace(/\//g, '').toUpperCase() === code && Number(row.quantity) > 0);
  }) : undefined, [owner, automaticReady, holdingsReady, usdtFollow.connected, usdtLive.snapshot, usdtLive.issue]);
  const needsArchive = automatic.needsHistory || notify.config.enabled && cdaTracking.hasPendingSaleMail;
  useEffect(() => {
    if (owner) prioritizeInstantScreening(owner, !!needsArchive);
    if (needsArchive) setScreeningRequested(true);
    return () => { if (owner) prioritizeInstantScreening(owner, false); };
  }, [owner, needsArchive]);
  const sources = useCallback((fish: readonly TradeSignal[], library: readonly TradeSignal[], turing: readonly TradeSignal[], researchOpen: boolean, screeningOpen: boolean) => {
    if (researchOpen) setRequested(true);
    if (screeningOpen) setScreeningRequested(true);
    setInput(prior => prior.fish === fish && prior.library === library && prior.turing === turing ? prior : { fish, library, turing });
  }, []);
  const activate = useCallback(() => setRequested(true), []);
  const location = useLocation();
  const templates=state.study.planTemplates??state.templateCatalog;
  const names=useMemo(()=>({owner,resolver:qualityTemplateNames({planTemplates:templates})}),[owner,templates]);
  return <FishQualityContext.Provider value={{ state: { ...state, requestStudyArchive: () => {activate();state.requestStudyArchive();}, requestScreeningArchive: screeningRequested?undefined:() => setScreeningRequested(true), instantPreferenceStatus:preferenceStatus, retryInstantPreferences:()=>setPreferenceAttempt(n=>n+1), automaticScreening, instantMonitor, instantPosition, cdaTracking: { ...cdaTracking, campaignIssue } }, sources, activate, enqueue: automaticScreening.enqueue, notify }}>
    <QualityTemplateNamesContext.Provider value={names}><InstantPositionsContext.Provider value={{ positions, monitorResults: cdaTracking.monitorResults, mirrorFills: cdaTracking.mirrorFills, manualPositions: cdaTracking.manualPositions, usdtFollow, usdtLive: { ...usdtLive, management }, manage: cdaTracking.managePosition }}>{children}</InstantPositionsContext.Provider></QualityTemplateNamesContext.Provider>
    {(state.running || state.filterRunning || state.postExit?.running || state.preEntry?.running) && location.pathname !== '/' && <div role="status" className="fixed bottom-4 right-4 z-50 space-y-1 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      {state.preEntry?.running && <div>买前筛选后台运行中 · {state.preEntry.progress?.done ?? 0}/{state.preEntry.progress?.total ?? 0}</div>}
      {state.filterRunning && <div>过滤后台运行中 · {state.filterProgress?.done ?? 0}/{state.filterProgress?.total ?? 0}</div>}
      {state.postExit?.running&&<div>卖后反事实补算中 · {state.postExit.progress?.done??0}/{state.postExit.progress?.total??0}</div>}
      {state.running && <div>收益后台更新中 · {state.progress?.done ?? 0}/{state.progress?.total ?? 0}</div>}
    </div>}
  </FishQualityContext.Provider>;
}

export function useFishCaptureAutomation() {
  const context = useContext(FishQualityContext);
  if (!context) throw new Error('FishQualityProvider is required');
  return { enqueue: context.enqueue, notify: context.notify };
}

export function usePageFishQuality(fish: readonly TradeSignal[], library: readonly TradeSignal[], turing: readonly TradeSignal[] = EMPTY, researchOpen = true, screeningOpen = researchOpen): FishQualityState {
  const context = useContext(FishQualityContext);
  if (!context) throw new Error('FishQualityProvider is required');
  const { sources } = context;
  useEffect(() => { sources(fish, library, turing, researchOpen, screeningOpen); }, [sources, fish, library, turing, researchOpen, screeningOpen]);
  return context.state;
}

/** 战役只在用户选择存模板时激活研究存储，平时保持轻量只读。 */
export function useCampaignQualityTemplates() {
  const context = useContext(FishQualityContext);
  return context ? { ready: context.state.ready, activate: context.activate, save: context.state.savePlanSnapshot } : null;
}
