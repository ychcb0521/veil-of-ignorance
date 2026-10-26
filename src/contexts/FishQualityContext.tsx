import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useFishQuality, type FishQualityState, type QualityRunner } from '@/hooks/useFishQuality';
import { runPageFishQuality } from '@/hooks/useFish';
import type { TradeSignal } from '@/lib/signalLibrary';

const EMPTY: readonly TradeSignal[] = [];
const FishQualityContext = createContext<{ state: FishQualityState; sources: (fish: readonly TradeSignal[], library: readonly TradeSignal[]) => void } | null>(null);

/** Owned by the authenticated app shell, outside the route boundary and collapsible panels. */
export function FishQualityProvider({ owner, children, run = runPageFishQuality }: { owner?: string; children: ReactNode; run?: QualityRunner }) {
  const [input, setInput] = useState({ fish: EMPTY, library: EMPTY });
  const state = useFishQuality(owner, input.fish, run, input.library);
  const sources = useCallback((fish: readonly TradeSignal[], library: readonly TradeSignal[]) => {
    setInput(prior => prior.fish === fish && prior.library === library ? prior : { fish, library });
  }, []);
  const location = useLocation();
  return <FishQualityContext.Provider value={{ state, sources }}>
    {children}
    {state.running && location.pathname !== '/' && <div role="status" className="fixed bottom-4 right-4 z-50 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      收益后台更新中 · {state.progress?.done ?? 0}/{state.progress?.total ?? 0}
    </div>}
  </FishQualityContext.Provider>;
}

export function usePageFishQuality(fish: readonly TradeSignal[], library: readonly TradeSignal[]): FishQualityState {
  const context = useContext(FishQualityContext);
  if (!context) throw new Error('FishQualityProvider is required');
  const { sources } = context;
  useEffect(() => { sources(fish, library); }, [sources, fish, library]);
  return context.state;
}
