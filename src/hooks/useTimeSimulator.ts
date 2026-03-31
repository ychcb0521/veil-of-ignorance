import { useState, useCallback, useRef, useEffect } from 'react';

export type TimeMachineStatus = 'playing' | 'paused' | 'stopped';

export interface TimeSimulatorState {
  status: TimeMachineStatus;
  historicalAnchorTime: number | null;
  realStartTime: number | null;
  currentSimulatedTime: number;
  speed: number;
  // Legacy compat
  isRunning: boolean;
}

export interface PersistedTimeSim {
  status: TimeMachineStatus;
  historicalAnchorTime: number | null;
  realStartTime: number | null;
  currentSimulatedTime: number;
  speed: number;
}

/** Throttle interval for React state updates (ms). RAF still runs at 60fps for ref. */
const STATE_FLUSH_MS = 150;

/** How often to persist currentTimeRef to localStorage (ms) — independent of React. */
const PERSIST_FLUSH_MS = 500;
const PERSIST_KEY = '__tm_live_time';

export function useTimeSimulator(initialState?: Partial<PersistedTimeSim>) {
  const [state, setState] = useState<TimeSimulatorState>(() => {
    const base: TimeSimulatorState = {
      status: 'stopped',
      historicalAnchorTime: null,
      realStartTime: null,
      currentSimulatedTime: 0,
      speed: 1,
      isRunning: false,
    };
    if (initialState) {
      const status = initialState.status || 'stopped';
      const isRunning = status === 'playing';
      return {
        ...base,
        ...initialState,
        status,
        isRunning,
      };
    }
    return base;
  });

  const rafRef = useRef<number>();

  /**
   * Real-time simulated timestamp, updated every RAF frame (~60fps).
   * Use this for high-frequency reads (e.g. imperative chart updates)
   * without triggering React re-renders.
   */
  const currentTimeRef = useRef<number>(state.currentSimulatedTime);

  /**
   * Core simulation parameters mirrored to a ref so the RAF tick
   * never reads stale closure values after speed/pause/resume changes.
   */
  const coreRef = useRef({
    status: state.status,
    historicalAnchorTime: state.historicalAnchorTime,
    realStartTime: state.realStartTime,
    speed: state.speed,
  });

  const lastFlushRef = useRef<number>(0);
  const lastPersistRef = useRef<number>(0);

  // ---- Helpers to keep coreRef perfectly in sync ----
  const syncCore = (s: Partial<typeof coreRef.current>) => {
    Object.assign(coreRef.current, s);
  };

  // Start from a historical timestamp
  const startSimulation = useCallback((historicalTime: number) => {
    const now = Date.now();
    currentTimeRef.current = historicalTime;
    syncCore({ status: 'playing', historicalAnchorTime: historicalTime, realStartTime: now, speed: 1 });
    setState({
      status: 'playing',
      isRunning: true,
      historicalAnchorTime: historicalTime,
      realStartTime: now,
      currentSimulatedTime: historicalTime,
      speed: 1,
    });
  }, []);

  // Pause: freeze currentSimulatedTime
  const pauseSimulation = useCallback(() => {
    setState(prev => {
      if (prev.status !== 'playing') return prev;
      const now = Date.now();
      const frozenTime = prev.historicalAnchorTime! + (now - prev.realStartTime!) * prev.speed;
      currentTimeRef.current = frozenTime;
      syncCore({ status: 'paused' });
      return {
        ...prev,
        status: 'paused',
        isRunning: false,
        currentSimulatedTime: frozenTime,
      };
    });
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // Resume from paused state
  const resumeSimulation = useCallback(() => {
    setState(prev => {
      if (prev.status !== 'paused') return prev;
      const now = Date.now();
      syncCore({
        status: 'playing',
        historicalAnchorTime: prev.currentSimulatedTime,
        realStartTime: now,
      });
      return {
        ...prev,
        status: 'playing',
        isRunning: true,
        historicalAnchorTime: prev.currentSimulatedTime,
        realStartTime: now,
      };
    });
  }, []);

  // Stop: full reset
  const stopSimulation = useCallback(() => {
    currentTimeRef.current = 0;
    syncCore({ status: 'stopped', historicalAnchorTime: null, realStartTime: null, speed: 1 });
    setState({
      status: 'stopped',
      isRunning: false,
      historicalAnchorTime: null,
      realStartTime: null,
      currentSimulatedTime: 0,
      speed: 1,
    });
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    try { localStorage.removeItem(PERSIST_KEY); } catch {}
  }, []);

  // Change speed (anchor reset to prevent jump)
  const setSpeed = useCallback((speed: number) => {
    setState(prev => {
      if (prev.status !== 'playing' || !prev.realStartTime || !prev.historicalAnchorTime) return prev;
      const now = Date.now();
      const currentSim = prev.historicalAnchorTime + (now - prev.realStartTime) * prev.speed;
      currentTimeRef.current = currentSim;
      syncCore({ speed, historicalAnchorTime: currentSim, realStartTime: now });
      return {
        ...prev,
        speed,
        historicalAnchorTime: currentSim,
        realStartTime: now,
        currentSimulatedTime: currentSim,
      };
    });
  }, []);

  // ---- RAF tick: updates ref every frame, flushes React state at throttled rate ----
  useEffect(() => {
    if (state.status !== 'playing') return;

    const tick = () => {
      const c = coreRef.current;
      if (c.status !== 'playing' || !c.realStartTime || !c.historicalAnchorTime) return;

      const now = Date.now();
      const simTime = c.historicalAnchorTime + (now - c.realStartTime) * c.speed;

      // Always update ref at full 60fps
      currentTimeRef.current = simTime;

      // Throttle React setState to ~7fps
      if (now - lastFlushRef.current >= STATE_FLUSH_MS) {
        lastFlushRef.current = now;
        setState(prev => ({
          ...prev,
          currentSimulatedTime: simTime,
        }));
      }

      // Persist to localStorage at low frequency (crash/refresh protection)
      if (now - lastPersistRef.current >= PERSIST_FLUSH_MS) {
        lastPersistRef.current = now;
        try { localStorage.setItem(PERSIST_KEY, String(simTime)); } catch {}
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [state.status]);

  // ---- beforeunload: force-persist exact time on page close ----
  useEffect(() => {
    const handler = () => {
      const c = coreRef.current;
      if (c.status === 'playing' && c.realStartTime && c.historicalAnchorTime) {
        const simTime = c.historicalAnchorTime + (Date.now() - c.realStartTime) * c.speed;
        try { localStorage.setItem(PERSIST_KEY, String(simTime)); } catch {}
      } else if (c.status === 'paused') {
        try { localStorage.setItem(PERSIST_KEY, String(currentTimeRef.current)); } catch {}
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  /** Read the last persisted live time (for restore). */
  const getPersistedLiveTime = useCallback((): number | null => {
    try {
      const v = localStorage.getItem(PERSIST_KEY);
      return v ? Number(v) : null;
    } catch { return null; }
  }, []);

  /** Clear the persisted live time (call on stop). */
  const clearPersistedLiveTime = useCallback(() => {
    try { localStorage.removeItem(PERSIST_KEY); } catch {}
  }, []);

  return {
    ...state,
    currentTimeRef,
    startSimulation,
    pauseSimulation,
    resumeSimulation,
    stopSimulation,
    setSpeed,
  };
}
