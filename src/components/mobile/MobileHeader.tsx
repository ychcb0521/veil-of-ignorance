import { SymbolSelector } from '@/components/SymbolSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Play, Pause, Clock } from 'lucide-react';

interface Props {
  symbol: string;
  interval: string;
  onSymbolChange: (s: string) => void;
  onIntervalChange: (i: string) => void;
  isRunning: boolean;
  currentSimulatedTime: number;
  speed: number;
  onStart: (ts: number) => void;
  onStop: () => void;
  onSetSpeed: (s: number) => void;
}

const SPEED_OPTIONS = [1, 2, 5, 10, 30, 60];

export function MobileHeader({
  symbol, interval, onSymbolChange, onIntervalChange,
  isRunning, currentSimulatedTime, speed, onStart, onStop, onSetSpeed,
}: Props) {
  const formatSimTime = (ts: number) => {
    if (!ts) return '--';
    const d = new Date(ts);
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  };

  return (
    <div className="border-b border-border bg-card">
      {/* Top row: symbol + theme */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <span className="text-[10px] font-bold text-primary tracking-widest">⚡ 无知之幕</span>
        </div>
        <SymbolSelector symbol={symbol} interval={interval} onSymbolChange={onSymbolChange} onIntervalChange={onIntervalChange} />
      </div>

      {/* Time machine row */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-border">
        <Clock className="w-3 h-3 text-primary shrink-0" />
        <span className="text-[10px] text-muted-foreground shrink-0">TIME MACHINE</span>
        {isRunning ? (
          <>
            <button onClick={onStop} className="btn-short flex items-center gap-1 text-[10px] px-2 py-0.5 shrink-0">
              <Pause className="w-3 h-3" /> 暂停
            </button>
            <div className="flex items-center gap-0.5 shrink-0">
              {SPEED_OPTIONS.map(s => (
                <button key={s} onClick={() => onSetSpeed(s)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    speed === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground">未启动</span>
        )}
      </div>

      {/* Sim time display */}
      {isRunning && (
        <div className="px-3 py-1 border-t border-border">
          <span className="font-mono text-xs text-primary font-medium">{formatSimTime(currentSimulatedTime)}</span>
        </div>
      )}
    </div>
  );
}
