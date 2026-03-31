import { useState } from 'react';
import { Play, Pause, Square, Clock, Globe, Split, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { formatUTC8 } from '@/lib/timeFormat';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TimeMachineStatus } from '@/hooks/useTimeSimulator';
import type { TimeMode, CoinTimelinesMap } from '@/contexts/TradingContext';

interface Props {
  status: TimeMachineStatus;
  currentSimulatedTime: number;
  speed: number;
  onStart: (timestamp: number) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSetSpeed: (speed: number) => void;
  onStopAllAndSwitchToSynced?: () => void | Promise<void>;
  clockRef?: React.RefObject<HTMLSpanElement>;
  timeMode?: TimeMode;
  onSetTimeMode?: (v: TimeMode) => void;
  totalPositionCount?: number;
  originTime?: number | null;
  coinTimelines?: CoinTimelinesMap;
  onSymbolChange?: (symbol: string) => void;
}

const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60];

type GuardedCoin = {
  sym: string;
  status: 'playing' | 'paused';
};

export function TimeControl({
  status, currentSimulatedTime, speed,
  onStart, onPause, onResume, onStop, onSetSpeed, onStopAllAndSwitchToSynced, clockRef,
  timeMode = 'synced', onSetTimeMode, totalPositionCount = 0,
  originTime, coinTimelines = {}, onSymbolChange,
}: Props) {
  const [dateInput, setDateInput] = useState('2024-01-15 16:00:00');
  const [guardDialogOpen, setGuardDialogOpen] = useState(false);
  const [guardedCoins, setGuardedCoins] = useState<GuardedCoin[]>([]);
  const [isStoppingAll, setIsStoppingAll] = useState(false);

  const runningCoinEntries = Object.entries(coinTimelines)
    .filter(([, ct]) => ct.status === 'playing' || ct.status === 'paused')
    .map(([sym, ct]) => ({ sym, status: ct.status } as GuardedCoin));

  const hasBlockingPositions = totalPositionCount > 0;
  const hasRunningCoins = timeMode === 'isolated' && runningCoinEntries.length > 0;
  const showGuardLock = hasBlockingPositions || hasRunningCoins;

  const handleStart = () => {
    const ts = new Date(dateInput.replace(' ', 'T') + 'Z').getTime() - 8 * 3600_000;
    if (isNaN(ts)) return;
    onStart(ts);
  };

  // Pure event-driven guard — no useEffect, no side effects
  const handleModeSwitchClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    nextMode: TimeMode,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    if (!onSetTimeMode || nextMode === timeMode) return;

    if (hasBlockingPositions) {
      toast.error('无法切换模式', {
        description: `有 ${totalPositionCount} 笔持仓，需全部平仓后才能切换模式。`,
        duration: 5000,
      });
      return; // Do NOT touch timeMode state
    }

    if (nextMode === 'synced' && timeMode === 'isolated' && runningCoinEntries.length > 0) {
      // Snapshot coins at click time, open modal, do NOT change timeMode
      setGuardedCoins([...runningCoinEntries]);
      setGuardDialogOpen(true);
      return;
    }

    // Only if all checks pass, actually change mode
    onSetTimeMode(nextMode);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (isStoppingAll) return;
    setGuardDialogOpen(open);
  };

  const handleJumpToCoin = (e: React.MouseEvent<HTMLButtonElement>, symbol: string) => {
    e.preventDefault();
    e.stopPropagation();
    onSymbolChange?.(symbol);
    setGuardDialogOpen(false);
  };

  const handleStopAllAndSwitch = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onStopAllAndSwitchToSynced) return;

    try {
      setIsStoppingAll(true);
      await onStopAllAndSwitchToSynced();
      setGuardDialogOpen(false);
    } finally {
      setIsStoppingAll(false);
    }
  };

  // Derived values for mode selector (no inner component to avoid remount flicker)
  const blockedReason = hasBlockingPositions
    ? `有 ${totalPositionCount} 笔持仓`
    : hasRunningCoins
      ? `有 ${runningCoinEntries.length} 个币种正在运行`
      : null;

  const modeSelectorButtons = onSetTimeMode ? (
    <div className="flex items-center gap-1 border-l border-border pl-3 ml-1">
      {showGuardLock && <Lock className="w-3 h-3 text-muted-foreground shrink-0" />}
      <button
        onClick={(e) => handleModeSwitchClick(e, 'synced')}
        title={blockedReason ? `当前不可切换：${blockedReason}` : '切换到同步模式'}
        aria-disabled={hasBlockingPositions || hasRunningCoins}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
          timeMode === 'synced'
            ? 'bg-primary/20 text-primary'
            : showGuardLock
              ? 'bg-secondary text-muted-foreground opacity-50 cursor-not-allowed hover:bg-secondary'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
      >
        <Globe className="w-3 h-3" /> 同步
      </button>
      <button
        onClick={(e) => handleModeSwitchClick(e, 'isolated')}
        title={hasBlockingPositions ? `当前不可切换：${blockedReason}` : '切换到隔离模式'}
        aria-disabled={hasBlockingPositions}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all duration-100 ease-out active:scale-[0.97] ${
          timeMode === 'isolated'
            ? 'bg-primary/20 text-primary'
            : hasBlockingPositions
              ? 'bg-secondary text-muted-foreground opacity-50 cursor-not-allowed hover:bg-secondary'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
      >
        <Split className="w-3 h-3" /> 隔离
      </button>
    </div>
  ) : null;

  const SpeedButtons = () => (
    <div className="flex items-center gap-1">
      {SPEED_OPTIONS.map(s => (
        <button
          key={s}
          onClick={() => onSetSpeed(s)}
          className={`px-2 py-1 rounded text-xs font-mono transition-all duration-100 ease-out active:scale-[0.95] ${
            speed === s
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
        >
          {s}x
        </button>
      ))}
    </div>
  );

  const TimeDisplay = ({ paused }: { paused?: boolean }) => (
    <div className="ml-auto flex items-center gap-4">
      {originTime != null && (
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted font-medium tracking-wide">启始</span>
          {formatUTC8(originTime)}
        </span>
      )}
      <span className={`font-mono text-sm font-medium ${paused ? 'text-yellow-400 animate-pulse' : 'text-primary'}`}>
        {paused && '⏸ '}
        <span ref={clockRef}>{formatUTC8(currentSimulatedTime)}</span>
      </span>
    </div>
  );

  return (
    <div className="panel px-4 py-3 bg-card">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Time Machine</span>
          {timeMode === 'isolated' && status !== 'stopped' && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent text-accent-foreground font-medium">独立时间轴</span>
          )}
        </div>

        {status === 'stopped' && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={dateInput}
              onChange={e => setDateInput(e.target.value)}
              placeholder="YYYY-MM-DD HH:mm:ss"
              className="input-dark w-52 text-xs"
            />
            <button onClick={handleStart} className="btn-long flex items-center gap-1.5 text-xs active:scale-[0.97]">
              <Play className="w-3.5 h-3.5" /> 启动
            </button>
            {modeSelectorButtons}
          </div>
        )}

        {status === 'playing' && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={onPause} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 transition-colors font-medium">
                <Pause className="w-3.5 h-3.5" /> 暂停
              </button>
              <button onClick={onStop} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors font-medium">
                <Square className="w-3.5 h-3.5" /> 停止
              </button>
            </div>
            <SpeedButtons />
            {modeSelectorButtons}
            <TimeDisplay />
          </>
        )}

        {status === 'paused' && (
          <>
            <div className="flex items-center gap-2">
              <button onClick={onResume} className="btn-long flex items-center gap-1.5 text-xs">
                <Play className="w-3.5 h-3.5" /> 继续
              </button>
              <button onClick={onStop} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-destructive/20 text-destructive hover:bg-destructive/30 transition-colors font-medium">
                <Square className="w-3.5 h-3.5" /> 停止
              </button>
            </div>
            <SpeedButtons />
            {modeSelectorButtons}
            <TimeDisplay paused />
          </>
        )}
      </div>

      {/* Guard Dialog — mounted only when needed, completely outside the flex layout */}
      {guardDialogOpen && (
        <Dialog open={guardDialogOpen} onOpenChange={handleDialogOpenChange}>
          <DialogContent
            className="sm:max-w-md transition-all duration-200 ease-out"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle>无法切换模式</DialogTitle>
              <DialogDescription>
                当前仍有币种处于独立运行状态。请先查看或停止这些币种，再切换到同步模式。
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <div className="rounded-lg border border-border bg-card/60 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">运行中的币种</div>
                <div className="flex flex-col gap-2">
                  {guardedCoins.map(({ sym, status: coinStatus }) => (
                    <button
                      key={sym}
                      onClick={(e) => handleJumpToCoin(e, sym)}
                      className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-left transition-all duration-200 ease-out hover:bg-accent"
                    >
                      <span className="text-sm font-medium text-foreground">{sym}</span>
                      <span className={`text-xs ${coinStatus === 'playing' ? 'text-primary' : 'text-muted-foreground'}`}>
                        {coinStatus === 'playing' ? '运行中' : '已暂停'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={() => setGuardDialogOpen(false)}
                className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-all duration-200 ease-out hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={(e) => void handleStopAllAndSwitch(e)}
                disabled={isStoppingAll}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all duration-200 ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isStoppingAll ? '处理中…' : '一键停止所有并切换'}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
