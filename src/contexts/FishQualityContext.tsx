import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useFishQuality, type FishQualityState, type QualityRunner } from '@/hooks/useFishQuality';
import { runPageFishQuality } from '@/hooks/useFish';
import type { TradeSignal } from '@/lib/signalLibrary';
import { miningRecordSignal } from '@/lib/fish/miningLibrary';
import {loadMiningLibrary,MINING_LIBRARY_EVENT} from '@/lib/fish/miningLibraryStore';
import { useFishNotify } from '@/hooks/useFishNotify';
import { useFishCdaTracking } from '@/hooks/useFishCdaTracking';
import { useInstantCampaigns } from '@/hooks/useInstantCampaigns';
import { useFishScreeningAutomation } from '@/hooks/useFishScreeningAutomation';

import { useInstantMonitorSettings } from '@/hooks/useInstantMonitorSettings';

const EMPTY: readonly TradeSignal[] = [];
const InstantPositionsContext = createContext<{ positions: ReturnType<typeof useInstantCampaigns>['positions']; monitorResults?: ReturnType<typeof useFishCdaTracking>['monitorResults']; mirrorFills?: ReturnType<typeof useFishCdaTracking>['mirrorFills']; close?: NonNullable<ReturnType<typeof useFishCdaTracking>['closePosition']> } | null>(null);
export const useScreenedInstantPositions = () => useContext(InstantPositionsContext);
const FishQualityContext = createContext<{ state: FishQualityState; sources: (fish: readonly TradeSignal[], library: readonly TradeSignal[], turing: readonly TradeSignal[]) => void; activate: () => void; enqueue: (signal: TradeSignal) => void; notify: ReturnType<typeof useFishNotify> } | null>(null);

/** Owned by the authenticated app shell, outside the route boundary and collapsible panels. */
export function FishQualityProvider({ owner, children, run = runPageFishQuality }: { owner?: string; children: ReactNode; run?: QualityRunner }) {
  const [input, setInput] = useState({ fish: EMPTY, library: EMPTY, turing: EMPTY });
  const [requested, setRequested] = useState(false);
  const [mined,setMined]=useState<readonly TradeSignal[]>(EMPTY);
  useEffect(()=>{if (!requested) return;let active=true,revision=0;setMined(EMPTY);const reload=()=>{const token=++revision;void loadMiningLibrary(owner).then(l=>{if(active&&token===revision)setMined(l.records.map(miningRecordSignal));});};const saved=(e:Event)=>{if(((e as CustomEvent).detail?.owner??null)===(owner??null))reload();};reload();window.addEventListener(MINING_LIBRARY_EVENT,saved);return()=>{active=false;window.removeEventListener(MINING_LIBRARY_EVENT,saved);};},[owner,requested]);
  const state = useFishQuality(owner, input.fish, run, input.library,mined, requested, input.turing, true);
  const notify = useFishNotify(owner, undefined, undefined, true);
  const instantMonitor = useInstantMonitorSettings(owner);
  const automaticScreening = useFishScreeningAutomation(owner, !!state.preEntry?.ready, state.preEntry, notify);
  const cdaTracking = useFishCdaTracking(owner, state.preEntry?.library, !!state.preEntry?.ready, notify, true);
  const { issue: campaignIssue, positions } = useInstantCampaigns(owner, cdaTracking, true);
  const hasAutomaticWork = automaticScreening.pending > 0 || automaticScreening.awaitingMail > 0 || cdaTracking.hasSavedSales || positions.length > 0;
  useEffect(() => { if (hasAutomaticWork) setRequested(true); }, [hasAutomaticWork]);
  const sources = useCallback((fish: readonly TradeSignal[], library: readonly TradeSignal[], turing: readonly TradeSignal[]) => {
    setRequested(true);
    setInput(prior => prior.fish === fish && prior.library === library && prior.turing === turing ? prior : { fish, library, turing });
  }, []);
  const activate = useCallback(() => setRequested(true), []);
  const location = useLocation();
  return <FishQualityContext.Provider value={{ state: { ...state, automaticScreening, instantMonitor, cdaTracking: { ...cdaTracking, campaignIssue } }, sources, activate, enqueue: automaticScreening.enqueue, notify }}>
    <InstantPositionsContext.Provider value={{ positions, monitorResults: cdaTracking.monitorResults, mirrorFills: cdaTracking.mirrorFills, close: cdaTracking.closePosition }}>{children}</InstantPositionsContext.Provider>
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

export function usePageFishQuality(fish: readonly TradeSignal[], library: readonly TradeSignal[], turing: readonly TradeSignal[] = EMPTY): FishQualityState {
  const context = useContext(FishQualityContext);
  if (!context) throw new Error('FishQualityProvider is required');
  const { sources } = context;
  useEffect(() => { sources(fish, library, turing); }, [sources, fish, library, turing]);
  return context.state;
}

/** 战役只在用户选择存模板时激活研究存储，平时保持轻量只读。 */
export function useCampaignQualityTemplates() {
  const context = useContext(FishQualityContext);
  return context ? { ready: context.state.ready, activate: context.activate, save: context.state.savePlanSnapshot } : null;
}
