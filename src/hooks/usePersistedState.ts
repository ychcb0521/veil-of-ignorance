import { useState, useCallback, useEffect } from 'react';
import { queueSimStatePush } from '@/lib/simStateSync';
import { readPersistedStateRaw, subscribePersistedStateHydration, writePersistedStateRaw } from '@/lib/persistedStateStorage';
import type { TimeMachineStatus } from './useTimeSimulator';

import { getUserId, getUserPrefix } from '@/lib/userStoragePrefix';

/**
 * User-scoped persisted state.
 */
export { getUserPrefix };

export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const prefix = getUserPrefix();
  const fullKey = prefix + key;
  const userId = getUserId();

  const [state, setStateRaw] = useState<T>(() => {
    try {
      const stored = readPersistedStateRaw(fullKey);
      if (stored !== null) return JSON.parse(stored);
    } catch { /* Invalid persisted JSON falls back to the caller's default. */ }
    return defaultValue;
  });

  useEffect(() => {
    const refresh = () => {
      setStateRaw(previous => {
        // React may already have a functional local update queued. Read when this
        // updater executes, so an earlier local edit wins over a captured cloud value.
        const raw = readPersistedStateRaw(fullKey);
        if (raw === null) return previous;
        try {
          return JSON.stringify(previous) === raw ? previous : JSON.parse(raw) as T;
        } catch { return previous; /* Malformed data must not disturb live state. */ }
      });
    };
    const unsubscribe = subscribePersistedStateHydration(fullKey, refresh);
    // Catch a restore between the initial render and this subscription.
    refresh();
    return unsubscribe;
  }, [fullKey]);

  const setState = useCallback((value: T | ((prev: T) => T)) => {
    setStateRaw(prev => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
      // Mount-time normalization often returns the original object. It is not a
      // user edit and must not upload an empty default over a slow cloud restore.
      if (Object.is(next, prev)) return prev;
      try {
        writePersistedStateRaw(fullKey, JSON.stringify(next));
      } catch { /* A non-serializable value must not interrupt the live UI. */ }
      // 云端镜像：换浏览器后数据跟账号走。防抖、降级都在同步层内处理。
      if (userId) queueSimStatePush(userId, key, next);
      return next;
    });
  }, [fullKey, key, userId]);

  return [state, setState];
}

// Persist time simulator state (user-scoped)
export interface PersistedSimState {
  status: TimeMachineStatus;
  historicalAnchorTime: number | null;
  realStartTime: number | null;
  currentSimulatedTime: number;
  speed: number;
  /** 播放方向：-1 = 倒叙播放；缺省视为 1（正序），兼容旧数据。 */
  direction?: 1 | -1;
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
  } catch { /* Unavailable storage leaves the simulator at its default state. */ }
  return null;
}

export function saveSimState(state: PersistedSimState) {
  try {
    localStorage.setItem(getSimKey(), JSON.stringify(state));
  } catch { /* The simulator remains usable without persistence. */ }
}

export function clearSimState() {
  try {
    localStorage.removeItem(getSimKey());
  } catch { /* A blocked storage area must not prevent leaving the simulator. */ }
}
