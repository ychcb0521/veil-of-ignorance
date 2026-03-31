import { useState } from 'react';
import { Play, Pause, Square, Clock } from 'lucide-react';
import type { TimeMachineStatus } from '@/hooks/useTimeSimulator';

interface Props {
  status: TimeMachineStatus;
  currentSimulatedTime: number;
  speed: number;
  onStart: (timestamp: number) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSetSpeed: (speed: number) => void;
}

const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60];

export function TimeControl({ status, currentSimulatedTime, speed, onStart, onPause, onResume, onStop, onSetSpeed }: Props) {
  const [dateInput, setDateInput] = useState('2024-01-15 08:00:00');

  const handleStart = () => {
    const ts = new Date(dateInput.replace(' ', 'T') + 'Z').getTime();
    if (isNaN(ts)) return;
    onStart(ts);
  };

  const formatSimTime = formatUTC8;

  return (
    <div className="panel px-4 py-3 bg-card">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Time Machine</span>
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

            <div className="ml-auto font-mono text-sm text-primary font-medium">
              {formatSimTime(currentSimulatedTime)}
            </div>
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

            <div className="ml-auto font-mono text-sm text-yellow-400 font-medium animate-pulse">
              ⏸ {formatSimTime(currentSimulatedTime)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
