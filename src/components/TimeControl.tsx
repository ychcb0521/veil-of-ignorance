import { useState } from 'react';
import { Play, Pause, RotateCcw, Clock } from 'lucide-react';

interface Props {
  isRunning: boolean;
  currentSimulatedTime: number;
  speed: number;
  onStart: (timestamp: number) => void;
  onStop: () => void;
  onSetSpeed: (speed: number) => void;
}

const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60];

export function TimeControl({ isRunning, currentSimulatedTime, speed, onStart, onStop, onSetSpeed }: Props) {
  const [dateInput, setDateInput] = useState('2024-01-15 08:00:00');

  const handleStart = () => {
    const ts = new Date(dateInput.replace(' ', 'T') + 'Z').getTime();
    if (isNaN(ts)) return;
    onStart(ts);
  };

  const formatSimTime = (ts: number) => {
    if (!ts) return '--';
    const d = new Date(ts);
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  };

  return (
    <div className="panel px-4 py-3">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Time Machine</span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={dateInput}
            onChange={e => setDateInput(e.target.value)}
            placeholder="YYYY-MM-DD HH:mm:ss"
            className="input-dark w-52 text-xs"
            disabled={isRunning}
          />
          {!isRunning ? (
            <button onClick={handleStart} className="btn-long flex items-center gap-1.5 text-xs">
              <Play className="w-3.5 h-3.5" /> 启动
            </button>
          ) : (
            <button onClick={onStop} className="btn-short flex items-center gap-1.5 text-xs">
              <Pause className="w-3.5 h-3.5" /> 暂停
            </button>
          )}
        </div>

        {isRunning && (
          <>
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
      </div>
    </div>
  );
}
