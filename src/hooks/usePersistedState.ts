import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_PREFIX = 'futures_sim_';

export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const fullKey = STORAGE_PREFIX + key;

  const [state, setStateRaw] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(fullKey);
      if (stored !== null) return JSON.parse(stored);
    } catch {}
    return defaultValue;
  });

  const stateRef = useRef(state);

  const setState = useCallback((value: T | ((prev: T) => T)) => {
    setStateRaw(prev => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
      stateRef.current = next;
      try {
        localStorage.setItem(fullKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [fullKey]);

  return [state, setState];
}

// Persist time simulator state
export interface PersistedSimState {
  isRunning: boolean;
  historicalAnchorTime: number | null;
  realStartTime: number | null;
  speed: number;
  symbol: string;
  interval: string;
}

const SIM_KEY = STORAGE_PREFIX + 'sim_state';

export function loadPersistedSimState(): PersistedSimState | null {
  try {
    const raw = localStorage.getItem(SIM_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function saveSimState(state: PersistedSimState) {
  try {
    localStorage.setItem(SIM_KEY, JSON.stringify(state));
  } catch {}
}

export function clearSimState() {
  try {
    localStorage.removeItem(SIM_KEY);
  } catch {}
}
