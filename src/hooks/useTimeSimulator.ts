import { useState, useCallback, useRef, useEffect } from 'react';

export type TimeMachineStatus = 'playing' | 'paused' | 'stopped';

/** 播放方向：1 = 正序（默认），-1 = 倒叙播放（时钟随真实时间倒退）。 */
export type TimeDirection = 1 | -1;

export interface TimeSimulatorState {
  status: TimeMachineStatus;
  historicalAnchorTime: number | null;
  realStartTime: number | null;
  currentSimulatedTime: number;
  speed: number;
  direction: TimeDirection;
  // Legacy compat
  isRunning: boolean;
}

export interface PersistedTimeSim {
  status: TimeMachineStatus;
  historicalAnchorTime: number | null;
  realStartTime: number | null;
  currentSimulatedTime: number;
  speed: number;
  direction?: TimeDirection;
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
      direction: 1,
      isRunning: false,
    };
    if (initialState) {
      const status = initialState.status || 'stopped';
      const isRunning = status === 'playing';
      const direction: TimeDirection = initialState.direction === -1 ? -1 : 1;
      return { ...base, ...initialState, status, isRunning, direction };
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
    direction: state.direction,
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
    return c.historicalAnchorTime + (Date.now() - c.realStartTime) * c.speed * c.direction;
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
    setState(prev => ({
      status: 'playing', isRunning: true,
      historicalAnchorTime: historicalTime, realStartTime: now,
      currentSimulatedTime: historicalTime, speed: 1,
      direction: prev.direction,
    }));
  }, []);

  const pauseSimulation = useCallback(() => {
    const c = coreRef.current;
    if (c.status !== 'playing') return;
    const now = Date.now();
    const frozenTime = c.historicalAnchorTime! + (now - c.realStartTime!) * c.speed * c.direction;
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
    setState(prev => ({
      status: 'stopped', isRunning: false,
      historicalAnchorTime: null, realStartTime: null,
      currentSimulatedTime: 0, speed: 1,
      direction: prev.direction,
    }));
    try { localStorage.removeItem(PERSIST_KEY); } catch {}
  }, []);

  const setSpeed = useCallback((speed: number) => {
    setState(prev => {
      if (prev.status === 'paused') {
        syncCore({ speed });
        return { ...prev, speed };
      }
      if (prev.status !== 'playing' || !prev.realStartTime || prev.historicalAnchorTime == null) return prev;
      const now = Date.now();
      const currentSim = prev.historicalAnchorTime + (now - prev.realStartTime) * prev.speed * prev.direction;
      currentTimeRef.current = currentSim;
      syncCore({ speed, historicalAnchorTime: currentSim, realStartTime: now });
      return { ...prev, speed, historicalAnchorTime: currentSim, realStartTime: now, currentSimulatedTime: currentSim };
    });
  }, []);

  /**
   * 切换播放方向（倒叙播放）。播放中先把当前时刻冻结为新锚点再翻转，
   * 保证切换瞬间时钟连续；暂停状态下冻结时刻同样生效；停止状态只改方向。
   * snapToMs：翻转瞬间把冻结时刻向下对齐到该粒度（K 线开盘），
   * 使倒放从整根蜡烛的边界开始——正放中只揭示了一半的蜡烛不进入镜像历史。
   */
  const setDirection = useCallback((direction: TimeDirection, opts?: { snapToMs?: number }) => {
    const snap = (t: number) => (
      opts?.snapToMs && opts.snapToMs > 0 ? Math.floor(t / opts.snapToMs) * opts.snapToMs : t
    );
    setState(prev => {
      if (prev.direction === direction) return prev;
      if (prev.status !== 'playing' || !prev.realStartTime || prev.historicalAnchorTime == null) {
        const frozen = snap(prev.currentSimulatedTime);
        currentTimeRef.current = frozen;
        syncCore({ direction, historicalAnchorTime: prev.status === 'paused' ? frozen : prev.historicalAnchorTime });
        return prev.status === 'paused'
          ? { ...prev, direction, historicalAnchorTime: frozen, currentSimulatedTime: frozen }
          : { ...prev, direction };
      }
      const now = Date.now();
      const currentSim = snap(prev.historicalAnchorTime + (now - prev.realStartTime) * prev.speed * prev.direction);
      currentTimeRef.current = currentSim;
      syncCore({ direction, historicalAnchorTime: currentSim, realStartTime: now });
      return { ...prev, direction, historicalAnchorTime: currentSim, realStartTime: now, currentSimulatedTime: currentSim };
    });
  }, []);

  // ---- beforeunload: force-persist exact time on page close ----
  useEffect(() => {
    const handler = () => {
      const c = coreRef.current;
      if (c.status === 'playing' && c.realStartTime && c.historicalAnchorTime) {
        const simTime = c.historicalAnchorTime + (Date.now() - c.realStartTime) * c.speed * c.direction;
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
    setDirection,
  };
}
