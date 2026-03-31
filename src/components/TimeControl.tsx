import { useState } from 'react';
import { Play, Pause, Square, Clock, Globe, Split, Lock } from 'lucide-react';
import { formatUTC8 } from '@/lib/timeFormat';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
  clockRef?: React.RefObject<HTMLSpanElement>;
  // Multi-Timeline
  timeMode?: TimeMode;
  onSetTimeMode?: (v: TimeMode) => void;
  totalPositionCount?: number;
  originTime?: number | null;
  coinTimelines?: CoinTimelinesMap;
  onSymbolChange?: (symbol: string) => void;
}

const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60];

export function TimeControl({
  status, currentSimulatedTime, speed,
  onStart, onPause, onResume, onStop, onSetSpeed, clockRef,
  timeMode = 'synced', onSetTimeMode, totalPositionCount = 0,
  originTime, coinTimelines = {}, onSymbolChange,
}: Props) {
  const [dateInput, setDateInput] = useState('2024-01-15 16:00:00');

  // Guard: can't toggle if positions exist OR if any coin is running (isolated→synced)
  const runningCoins = Object.entries(coinTimelines)
    .filter(([, ct]) => ct.status === 'playing' || ct.status === 'paused')
    .map(([sym]) => sym);
  const canToggleMode = totalPositionCount === 0 && (timeMode === 'synced' || runningCoins.length === 0);

  const handleStart = () => {
    const ts = new Date(dateInput.replace(' ', 'T') + 'Z').getTime() - 8 * 3600_000;
    if (isNaN(ts)) return;
    onStart(ts);
  };

  const SpeedButtons = () => (
    <div className="flex items-center gap-1">
      {SPEED_OPTIONS.map(s => (
        <button
          key={s}
          onClick={() => onSetSpeed(s)}
          className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
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

  const [lockPopoverOpen, setLockPopoverOpen] = useState(false);

  const ModeSelector = () => {
    if (!onSetTimeMode) return null;

    const disabledReason = !canToggleMode
      ? totalPositionCount > 0
        ? `有 ${totalPositionCount} 笔持仓，需全部平仓后才能切换模式。`
        : null
      : null;

    const showRunningList = !canToggleMode && totalPositionCount === 0 && runningCoins.length > 0;

    return (
      <Popover open={lockPopoverOpen} onOpenChange={setLockPopoverOpen}>
        <PopoverTrigger asChild>
          <div className="flex items-center gap-1 border-l border-border pl-3 ml-1 cursor-pointer">
            {!canToggleMode && <Lock className="w-3 h-3 text-muted-foreground" />}
            <button
              onClick={(e) => { if (canToggleMode) { e.stopPropagation(); onSetTimeMode('synced'); } }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                timeMode === 'synced'
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:text-foreground disabled:opacity-40'
              }`}
            >
              <Globe className="w-3 h-3" /> 同步
            </button>
            <button
              onClick={(e) => { if (canToggleMode) { e.stopPropagation(); onSetTimeMode('isolated'); } }}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                timeMode === 'isolated'
                  ? 'bg-primary/20 text-primary'
                  : 'text-muted-foreground hover:text-foreground disabled:opacity-40'
              }`}
            >
              <Split className="w-3 h-3" /> 隔离
            </button>
          </div>
        </PopoverTrigger>
        {!canToggleMode && (
          <PopoverContent side="bottom" className="w-72 p-3" align="start" onInteractOutside={(e) => e.preventDefault()}>
            {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
            {showRunningList && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  无法切换至同步模式。以下币种正在独立运行：
                </p>
                <div className="flex flex-col gap-1">
                  {runningCoins.map(sym => {
                    const ct = coinTimelines[sym];
                    const statusLabel = ct?.status === 'playing' ? '▶ 运行中' : '⏸ 已暂停';
                    return (
                      <button
                        key={sym}
                        onClick={() => { onSymbolChange?.(sym); setLockPopoverOpen(false); }}
                        className="flex items-center justify-between px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors text-left group"
                      >
                        <span className="font-medium text-foreground group-hover:text-primary transition-colors">{sym}</span>
                        <span className={`text-[10px] ${ct?.status === 'playing' ? 'text-green-400' : 'text-yellow-400'}`}>
                          {statusLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground pt-1 border-t border-border">
                  点击币种可跳转查看。请先停止所有运行后再切换模式。
                </p>
              </div>
            )}
          </PopoverContent>
        )}
      </Popover>
    );
  };

  /** Right-side time info block: origin time (static) + current sim time (dynamic) */
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
            <button onClick={handleStart} className="btn-long flex items-center gap-1.5 text-xs">
              <Play className="w-3.5 h-3.5" /> 启动
            </button>
            <ModeSelector />
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
            <ModeSelector />
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
            <ModeSelector />
            <TimeDisplay paused />
          </>
        )}
      </div>
    </div>
  );
}
