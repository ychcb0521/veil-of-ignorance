import { useState, useCallback, useRef } from 'react';
import { queueSimStatePush } from '@/lib/simStateSync';
import type { TimeMachineStatus } from './useTimeSimulator';

/**
 * User-scoped persisted state.
 */
function getUserId(): string | null {
  try {
    const storageKey = Object.keys(localStorage).find(k =>
      k.startsWith('sb-') && k.endsWith('-auth-token')
    );
    if (storageKey) {
      const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const userId = data?.user?.id;
      if (userId) return userId;
    }
  } catch {}
  return null;
}

function getUserPrefix(): string {
  const userId = getUserId();
  return userId ? `sim_${userId}_` : 'sim_anon_';
}

export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const prefix = getUserPrefix();
  const fullKey = prefix + key;
  const userId = getUserId();

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
