import { useCallback, useEffect, useRef, useState } from 'react';
import { FishScanner, initialFishProgress, type FishProgress, type FishScanSettings } from '@/lib/fishScanner';
import { loadFishSignals, saveFishSignals, FISH_STORAGE_KEY } from '@/lib/fishSignals';
import { mergeSignals, signalDedupKey, type TradeSignal } from '@/lib/signalLibrary';
import { subscribePersistedStateHydration } from '@/lib/persistedStateStorage';

/** 去掉「新鱼」标记（归入「鱼」、或加入信号库时用）。 */
export function withoutFresh(signal: TradeSignal): TradeSignal {
  if (!signal.freshCatch) return signal;
  const { freshCatch: _drop, ...rest } = signal;
  return rest;
}

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
  const start = useCallback(async (settings: FishScanSettings = {}) => {
    if (controller.current) return;
    // 上一轮的新鱼归入「鱼」，这一轮捕到的（含以前捕到过、这轮又命中的）放进「新鱼」
    if (signalsRef.current.some(s => s.freshCatch)) commit(signalsRef.current.map(withoutFresh));
    scanner.current ??= pageScanner ??= new FishScanner();
    const mine = new AbortController(); controller.current = mine;
    const owner = ownerRef.current;
    const valid = () => controller.current === mine && ownerRef.current === owner;
    try {
      await scanner.current.scan({ ...settings, signal: mine.signal,
        onProgress: value => { if (valid()) setProgress(value); },
        onSignal: signal => {
          if (valid() && !mine.signal.aborted) {
            const fresh = { ...signal, freshCatch: true };
            const merged = mergeSignals(signalsRef.current, [fresh]);
            if (merged.length !== signalsRef.current.length) { commit(merged); return; }
            // 已经在列表里（同一标的@时间）：标成新鱼、读数换成这一轮的，评分保留
            const key = signalDedupKey(signal);
            const previous = signalsRef.current.find(s => signalDedupKey(s) === key);
            if (previous && (!previous.freshCatch || JSON.stringify(previous.fish) !== JSON.stringify(signal.fish) || previous.binanceSymbol !== signal.binanceSymbol)) {
              commit(signalsRef.current.map(s => s === previous ? { ...s, fish: signal.fish, binanceSymbol: signal.binanceSymbol, freshCatch: true } : s));
            }
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
