import { useState, useCallback, useRef } from 'react';
import type { TimeMachineStatus } from './useTimeSimulator';

/**
 * User-scoped persisted state.
 */
function getUserPrefix(): string {
  try {
    const storageKey = Object.keys(localStorage).find(k =>
      k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    if (storageKey) {
      const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const userId = data?.user?.id;
      if (userId) return `sim_${userId}_`;
    }
  } catch {}
  return 'sim_anon_';
}

export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const prefix = getUserPrefix();
  const fullKey = prefix + key;

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

// Persist time simulator state (user-scoped)
export interface PersistedSimState {
  status: TimeMachineStatus;
  historicalAnchorTime: number | null;
  realStartTime: number | null;
  currentSimulatedTime: number;
  speed: number;
  symbol: string;
  interval: string;
}

function getSimKey(): string {
  return getUserPrefix() + 'sim_state';
}

export function loadPersistedSimState(): PersistedSimState | null {
  try {
    const raw = localStorage.getItem(getSimKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate old format: isRunning -> status
      if (parsed.isRunning !== undefined && parsed.status === undefined) {
        parsed.status = parsed.isRunning ? 'playing' : 'stopped';
        delete parsed.isRunning;
      }
      return parsed;
    }
  } catch {}
  return null;
}

export function saveSimState(state: PersistedSimState) {
  try {
    localStorage.setItem(getSimKey(), JSON.stringify(state));
  } catch {}
}

export function clearSimState() {
  try {
    localStorage.removeItem(getSimKey());
  } catch {}
}
