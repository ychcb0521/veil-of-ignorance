import { useCallback, useEffect, useRef, useState } from 'react';
import { FishScanner, initialFishProgress, type FishProgress } from '@/lib/fishScanner';
import { loadFishSignals, saveFishSignals, FISH_STORAGE_KEY } from '@/lib/fishSignals';
import { mergeSignals, type TradeSignal } from '@/lib/signalLibrary';
import { subscribePersistedStateHydration } from '@/lib/persistedStateStorage';

// Shared across TimeControl instances and panel remounts in this browser page.
let pageScanner: FishScanner | null = null;

export function useFish(userId: string | undefined) {
  const [signals, setSignals] = useState(loadFishSignals);
  const signalsRef = useRef(signals); signalsRef.current = signals;
  const ownerRef = useRef(userId); ownerRef.current = userId;
  const scanner = useRef<FishScanner | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<FishProgress | null>(null);
  const commit = useCallback((next: TradeSignal[]) => {
    signalsRef.current = next; setSignals(next); saveFishSignals(next, ownerRef.current ?? null);
  }, []);
  useEffect(() => {
    const refresh = () => { const next = loadFishSignals(); signalsRef.current = next; setSignals(next); };
    refresh(); setProgress(null);
    const unsubscribe = subscribePersistedStateHydration(FISH_STORAGE_KEY, refresh);
    const storage = (e: StorageEvent) => { if (e.key === FISH_STORAGE_KEY || e.key === null) refresh(); };
    window.addEventListener('storage', storage);
    return () => { controller.current?.abort(); controller.current = null; scanner.current = null; unsubscribe(); window.removeEventListener('storage', storage); };
  }, [userId]);
  const start = useCallback(async () => {
    if (controller.current) return;
    scanner.current ??= pageScanner ??= new FishScanner();
    const mine = new AbortController(); controller.current = mine;
    const owner = ownerRef.current;
    const valid = () => controller.current === mine && ownerRef.current === owner;
    try {
      await scanner.current.scan({ signal: mine.signal,
        onProgress: value => { if (valid()) setProgress(value); },
        onSignal: signal => {
          if (valid() && !mine.signal.aborted) {
            const merged = mergeSignals(signalsRef.current, [signal]);
            if (merged.length !== signalsRef.current.length) commit(merged);
          }
        },
      });
    } catch (error) {
      if (valid()) setProgress({ ...initialFishProgress(), status: 'aborted', error: error instanceof Error ? error.message : String(error) });
    } finally { if (controller.current === mine) controller.current = null; }
  }, [commit]);
  const cancel = useCallback(() => controller.current?.abort(), []);
  return { signals, signalsRef, commit, progress, start, cancel };
}
