import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { loadSignals, saveSignals, SIGNAL_LIBRARY_STORAGE_KEY, type TradeSignal } from '@/lib/signalLibrary';
import { readPersistedStateRaw, subscribePersistedStateHydration } from '@/lib/persistedStateStorage';

/** Cloud restores are reads. Only explicit signal edits may publish a replacement. */
export function useSignalLibrary(): [TradeSignal[], Dispatch<SetStateAction<TradeSignal[]>>] {
  const [signals, setState] = useState(loadSignals);
  useEffect(() => {
    const refresh = () => setState(previous => {
      const raw = readPersistedStateRaw(SIGNAL_LIBRARY_STORAGE_KEY);
      if (raw === null || JSON.stringify(previous) === raw) return previous;
      return loadSignals();
    });
    const unsubscribe = subscribePersistedStateHydration(SIGNAL_LIBRARY_STORAGE_KEY, refresh);
    refresh();
    return unsubscribe;
  }, []);
  const setSignals = useCallback<Dispatch<SetStateAction<TradeSignal[]>>>(value => {
    setState(previous => {
      const next = typeof value === 'function' ? value(previous) : value;
      if (next !== previous) saveSignals(next);
      return next;
    });
  }, []);
  return [signals, setSignals];
}
