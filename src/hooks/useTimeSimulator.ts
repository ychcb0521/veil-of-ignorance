import { useState, useCallback, useRef, useEffect } from 'react';

export interface TimeSimulatorState {
  isRunning: boolean;
  historicalAnchorTime: number | null;
  realStartTime: number | null;
  currentSimulatedTime: number;
  speed: number;
}

export function useTimeSimulator() {
  const [state, setState] = useState<TimeSimulatorState>({
    isRunning: false,
    historicalAnchorTime: null,
    realStartTime: null,
    currentSimulatedTime: Date.now(),
    speed: 1,
  });

  const rafRef = useRef<number>();

  const startSimulation = useCallback((historicalTime: number) => {
    const now = Date.now();
    setState({
      isRunning: true,
      historicalAnchorTime: historicalTime,
      realStartTime: now,
      currentSimulatedTime: historicalTime,
      speed: 1,
    });
  }, []);

  const stopSimulation = useCallback(() => {
    setState(prev => ({ ...prev, isRunning: false }));
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setState(prev => {
      if (!prev.isRunning || !prev.realStartTime || !prev.historicalAnchorTime) return prev;
      // Re-anchor to avoid time jumps when changing speed
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

  useEffect(() => {
    if (!state.isRunning) return;

    const tick = () => {
      setState(prev => {
        if (!prev.isRunning || !prev.realStartTime || !prev.historicalAnchorTime) return prev;
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
  }, [state.isRunning]);

  return { ...state, startSimulation, stopSimulation, setSpeed };
}
