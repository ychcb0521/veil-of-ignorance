import { useMemo } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useReplay, REPLAY_SPEEDS, type ReplaySpeed } from '@/contexts/ReplayContext';

function fmtTime(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function ReplayTimelineScrubber() {
  const { replayTime, replayStatus, replaySpeed, tStart, tEnd, tEntry, tExit,
    play, pause, setSpeed, jumpTo } = useReplay();

  const tOffsetMin = useMemo(
    () => Math.round((replayTime - tEntry) / 60_000),
    [replayTime, tEntry],
  );

  const range = tEnd - tStart || 1;
  const entryPct = ((tEntry - tStart) / range) * 100;
  const exitPct = tExit != null ? ((tExit - tStart) / range) * 100 : null;

  return (
    <div className="h-12 bg-[#181A20] border border-[#2B3139] rounded px-3 flex items-center gap-3">
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0"
        onClick={() => (replayStatus === 'running' ? pause() : play())}>
        {replayStatus === 'running' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>

      <div className="font-mono text-[12px] text-foreground tabular-nums whitespace-nowrap shrink-0">
        {fmtTime(replayTime)} <span className="text-muted-foreground">(T{tOffsetMin >= 0 ? '+' : ''}{tOffsetMin})</span>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {REPLAY_SPEEDS.map(s => (
          <button key={s} onClick={() => setSpeed(s as ReplaySpeed)}
            className={`h-7 px-2 rounded text-[10px] font-mono ${replaySpeed === s ? 'bg-[#F0B90B] text-black' : 'bg-[#2B3139] text-foreground hover:bg-[#363c45]'}`}>
            {s}×
          </button>
        ))}
      </div>

      <div className="flex-1 relative min-w-0 px-2">
        <Slider
          value={[replayTime]}
          min={tStart}
          max={tEnd}
          step={Math.max(1000, Math.round(range / 1000))}
          onValueChange={v => jumpTo(v[0])}
        />
        {/* tick markers overlayed */}
        <div className="absolute inset-x-2 inset-y-0 pointer-events-none">
          <div className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-[#0ECB81]"
            style={{ left: `${entryPct}%` }} title="入场" />
          {exitPct != null && (
            <div className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-[#F6465D]"
              style={{ left: `${exitPct}%` }} title="出场" />
          )}
        </div>
      </div>

      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0"
        onClick={() => jumpTo(tStart)} title="回到入场前 30 分钟">
        <RotateCcw className="w-4 h-4" />
      </Button>
    </div>
  );
}
