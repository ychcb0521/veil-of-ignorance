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

  // Start from a historical timestamp
  const startSimulation = useCallback((historicalTime: number) => {
    const now = Date.now();
    setState({
      status: 'playing',
      isRunning: true,
      historicalAnchorTime: historicalTime,
      realStartTime: now,
      currentSimulatedTime: historicalTime,
      speed: 1,
    });
  }, []);

  // Pause: freeze currentSimulatedTime, reset anchors for future resume
  const pauseSimulation = useCallback(() => {
    setState(prev => {
      if (prev.status !== 'playing') return prev;
      // Compute final sim time at this instant
      const now = Date.now();
      const frozenTime = prev.historicalAnchorTime! + (now - prev.realStartTime!) * prev.speed;
      return {
        ...prev,
        status: 'paused',
        isRunning: false,
        currentSimulatedTime: frozenTime,
        // Keep anchor/realStart for reference, will be reset on resume
      };
    });
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // Resume from paused state
  const resumeSimulation = useCallback(() => {
    setState(prev => {
      if (prev.status !== 'paused') return prev;
      const now = Date.now();
      return {
        ...prev,
        status: 'playing',
        isRunning: true,
        // Anchor reset: start from frozen time
        historicalAnchorTime: prev.currentSimulatedTime,
        realStartTime: now,
      };
    });
  }, []);

  // Stop: full reset
  const stopSimulation = useCallback(() => {
    setState({
      status: 'stopped',
      isRunning: false,
      historicalAnchorTime: null,
      realStartTime: null,
      currentSimulatedTime: 0,
      speed: 1,
    });
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // Change speed (anchor reset to prevent jump)
  const setSpeed = useCallback((speed: number) => {
    setState(prev => {
      if (prev.status !== 'playing' || !prev.realStartTime || !prev.historicalAnchorTime) return prev;
      const now = Date.now();
      const currentSim = prev.historicalAnchorTime + (now - prev.realStartTime) * prev.speed;
      return {
        ...prev,
        speed,
        historicalAnchorTime: currentSim,
        realStartTime: now,
      };
    });
  }, []);

  // RAF tick — only when playing
  useEffect(() => {
    if (state.status !== 'playing') return;

    const tick = () => {
      setState(prev => {
        if (prev.status !== 'playing' || !prev.realStartTime || !prev.historicalAnchorTime) return prev;
        const elapsed = Date.now() - prev.realStartTime;
        return {
          ...prev,
          currentSimulatedTime: prev.historicalAnchorTime + elapsed * prev.speed,
        };
      });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [state.status]);

  return {
    ...state,
    startSimulation,
    pauseSimulation,
    resumeSimulation,
    stopSimulation,
    setSpeed,
  };
}
