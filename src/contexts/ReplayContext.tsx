/**
 * ReplayContext — 隔离于 TradingContext 的单笔交易回放状态。
 * 本上下文只读不写交易状态，专为 /journal/:id 单笔复现页服务。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { TradeJournal, JournalTagAssignment, ErrorTagPattern } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import type { KlineData } from '@/hooks/useBinanceData';

export type ReplayStatus = 'idle' | 'running' | 'paused';
export const REPLAY_SPEEDS = [1, 2, 5, 10, 50] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

interface ReplayContextValue {
  journal: TradeJournal;
  tradeRecord: TradeRecord | null;
  assignments: JournalTagAssignment[];
  patterns: Map<string, ErrorTagPattern>;

  klines: KlineData[];
  setKlines: (k: KlineData[]) => void;

  replayTime: number; // ms
  replayStatus: ReplayStatus;
  replaySpeed: ReplaySpeed;

  tEntry: number;
  tExit: number | null;
  tStart: number;
  tEnd: number;

  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (s: ReplaySpeed) => void;
  jumpTo: (ts: number) => void;
}

const ReplayCtx = createContext<ReplayContextValue | null>(null);

interface ProviderProps {
  journal: TradeJournal;
  tradeRecord: TradeRecord | null;
  assignments: JournalTagAssignment[];
  patterns: ErrorTagPattern[];
  children: React.ReactNode;
}

const FRAME_MS = 50;

export function ReplayProvider({ journal, tradeRecord, assignments, patterns, children }: ProviderProps) {
  const tEntry = useMemo(() => new Date(journal.pre_simulated_time).getTime(), [journal.pre_simulated_time]);
  const tExit = useMemo(() => (tradeRecord ? tradeRecord.closeTime : null), [tradeRecord]);
  const tStart = useMemo(() => tEntry - 30 * 60_000, [tEntry]);
  const tEnd = useMemo(() => (tExit ? tExit + 30 * 60_000 : tEntry + 120 * 60_000), [tEntry, tExit]);

  const [klines, setKlines] = useState<KlineData[]>([]);
  const [replayTime, setReplayTime] = useState<number>(tStart);
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>('paused');
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(1);

  const timerRef = useRef<number | null>(null);
  const stateRef = useRef({ replayTime, replayStatus, replaySpeed, tEnd });
  stateRef.current = { replayTime, replayStatus, replaySpeed, tEnd };

  // Independent ticker loop (隔离于主 useTimeSimulator)
  useEffect(() => {
    const tick = () => {
      const { replayStatus: st, replaySpeed: sp, replayTime: t, tEnd: end } = stateRef.current;
      if (st === 'running') {
        const next = t + FRAME_MS * sp;
        if (next >= end) {
          setReplayTime(end);
          setReplayStatus('paused');
        } else {
          setReplayTime(next);
        }
      }
    };
    timerRef.current = window.setInterval(tick, FRAME_MS);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, []);

  const patternMap = useMemo(() => new Map(patterns.map(p => [p.id, p])), [patterns]);

  const play = useCallback(() => {
    if (stateRef.current.replayTime >= stateRef.current.tEnd - 10) {
      setReplayTime(tStart);
    }
    setReplayStatus('running');
  }, [tStart]);
  const pause = useCallback(() => setReplayStatus('paused'), []);
  const toggle = useCallback(() => setReplayStatus(s => (s === 'running' ? 'paused' : 'running')), []);
  const setSpeed = useCallback((s: ReplaySpeed) => setReplaySpeed(s), []);
  const jumpTo = useCallback((ts: number) => {
    setReplayStatus('paused');
    setReplayTime(Math.max(tStart, Math.min(tEnd, ts)));
  }, [tStart, tEnd]);

  const value: ReplayContextValue = {
    journal, tradeRecord, assignments, patterns: patternMap,
    klines, setKlines,
    replayTime, replayStatus, replaySpeed,
    tEntry, tExit, tStart, tEnd,
    play, pause, toggle, setSpeed, jumpTo,
  };

  return <ReplayCtx.Provider value={value}>{children}</ReplayCtx.Provider>;
}

export function useReplay(): ReplayContextValue {
  const v = useContext(ReplayCtx);
  if (!v) throw new Error('useReplay must be used within ReplayProvider');
  return v;
}
