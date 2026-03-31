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

const PERSIST_KEY = '__tm_live_time';

/**
 * Headless time engine — NO internal RAF loop.
 *
 * External game loop (Index.tsx) must call:
 *   1. getSimTime()        — compute current sim timestamp
 *   2. currentTimeRef.current = simTime  — store for other reads
 *   3. syncReactState(simTime)           — throttled, for matching/liquidation engines
 *
 * This keeps ALL visual updates (clock DOM, chart) in a single
 * requestAnimationFrame tick, eliminating cross-loop drift.
 */
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
      return { ...base, ...initialState, status, isRunning };
    }
    return base;
  });

  /**
   * Real-time simulated timestamp. Updated by the external game loop
   * at 60fps. Use for high-frequency reads without triggering re-renders.
   */
  const currentTimeRef = useRef<number>(state.currentSimulatedTime);

  /**
   * Core simulation parameters in a ref so getSimTime() never reads
   * stale closure values after speed/pause/resume changes.
   */
  const coreRef = useRef({
    status: state.status,
    historicalAnchorTime: state.historicalAnchorTime,
    realStartTime: state.realStartTime,
    speed: state.speed,
  });

  const syncCore = (s: Partial<typeof coreRef.current>) => {
    Object.assign(coreRef.current, s);
  };

  // ---- Pure computation: returns sim time from wall-clock delta ----
  const getSimTime = useCallback((): number => {
    const c = coreRef.current;
    if (c.status !== 'playing' || !c.realStartTime || !c.historicalAnchorTime) {
      return currentTimeRef.current;
    }
    return c.historicalAnchorTime + (Date.now() - c.realStartTime) * c.speed;
  }, []);

  // ---- Flush to React state (call at low freq from game loop) ----
  const syncReactState = useCallback((simTime: number) => {
    currentTimeRef.current = simTime;
    setState(prev => ({
      ...prev,
      currentSimulatedTime: simTime,
    }));
  }, []);

  // ---- Persist to localStorage (call from game loop) ----
  const persistTime = useCallback((simTime: number) => {
    try { localStorage.setItem(PERSIST_KEY, String(simTime)); } catch {}
  }, []);

  // ---- Actions ----
  const startSimulation = useCallback((historicalTime: number) => {
    const now = Date.now();
    currentTimeRef.current = historicalTime;
    syncCore({ status: 'playing', historicalAnchorTime: historicalTime, realStartTime: now, speed: 1 });
    setState({
      status: 'playing', isRunning: true,
      historicalAnchorTime: historicalTime, realStartTime: now,
      currentSimulatedTime: historicalTime, speed: 1,
    });
  }, []);

  const pauseSimulation = useCallback(() => {
    const c = coreRef.current;
    if (c.status !== 'playing') return;
    const now = Date.now();
    const frozenTime = c.historicalAnchorTime! + (now - c.realStartTime!) * c.speed;
    currentTimeRef.current = frozenTime;
    syncCore({ status: 'paused' });
    setState(prev => ({
      ...prev, status: 'paused', isRunning: false, currentSimulatedTime: frozenTime,
    }));
  }, []);

  const resumeSimulation = useCallback(() => {
    setState(prev => {
      if (prev.status !== 'paused') return prev;
      const now = Date.now();
      syncCore({ status: 'playing', historicalAnchorTime: prev.currentSimulatedTime, realStartTime: now });
      return { ...prev, status: 'playing', isRunning: true, historicalAnchorTime: prev.currentSimulatedTime, realStartTime: now };
    });
  }, []);

  const stopSimulation = useCallback(() => {
    currentTimeRef.current = 0;
    syncCore({ status: 'stopped', historicalAnchorTime: null, realStartTime: null, speed: 1 });
    setState({
      status: 'stopped', isRunning: false,
      historicalAnchorTime: null, realStartTime: null,
      currentSimulatedTime: 0, speed: 1,
    });
    try { localStorage.removeItem(PERSIST_KEY); } catch {}
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setState(prev => {
      if (prev.status !== 'playing' || !prev.realStartTime || !prev.historicalAnchorTime) return prev;
      const now = Date.now();
      const currentSim = prev.historicalAnchorTime + (now - prev.realStartTime) * prev.speed;
      currentTimeRef.current = currentSim;
      syncCore({ speed, historicalAnchorTime: currentSim, realStartTime: now });
      return { ...prev, speed, historicalAnchorTime: currentSim, realStartTime: now, currentSimulatedTime: currentSim };
    });
  }, []);

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

  return {
    ...state,
    currentTimeRef,
    getSimTime,
    syncReactState,
    persistTime,
    startSimulation,
    pauseSimulation,
    resumeSimulation,
    stopSimulation,
    setSpeed,
  };
}
