import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Star, StarOff } from 'lucide-react';
import { ALL_TIMEFRAMES, TIMEFRAME_LABELS, UNSUPPORTED_TIMEFRAMES, type Timeframe, useTimeframePrefs } from '@/hooks/useTimeframePrefs';
import { toast } from 'sonner';

interface Props {
  interval: string;
  onIntervalChange: (i: string) => void;
}

export function TimeframeSelector({ interval, onIntervalChange }: Props) {
  const { pinned, available, togglePin } = useTimeframePrefs();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isPinnedActive = pinned.includes(interval as Timeframe);

  return (
    <div className="flex items-center gap-0.5 relative" ref={panelRef}>
      {/* Pinned quick buttons */}
      {pinned.map(tf => (
        <button
          key={tf}
          onClick={() => onIntervalChange(tf)}
          className={`px-2 py-1 rounded text-xs font-mono transition-all duration-100 ease-out active:scale-[0.95] ${
            interval === tf
              ? 'bg-primary text-primary-foreground'
              : 'bg-secondary text-secondary-foreground hover:bg-accent'
          }`}
        >
          {tf}
        </button>
      ))}

      {/* Dropdown trigger */}
      <button
        onClick={() => setOpen(!open)}
        className={`px-2 py-1 rounded text-xs font-mono transition-colors flex items-center gap-0.5 ${
          open ? 'bg-primary text-primary-foreground' : !isPinnedActive && interval ? 'bg-accent text-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'
        }`}
      >
        {!isPinnedActive ? interval : ''}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-lg border border-border shadow-xl overflow-hidden"
          style={{ background: 'hsl(var(--card))' }}>
          {/* Pinned section */}
          <div className="px-3 py-2 flex items-center justify-between border-b border-border">
            <span className="text-xs font-medium text-foreground">置顶</span>
            <button
              onClick={() => setEditing(!editing)}
              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {editing ? '完成' : '编辑'}
            </button>
          </div>
          <div className="px-3 py-2 flex flex-wrap gap-1.5 border-b border-border">
            {pinned.map(tf => (
              <button
                key={tf}
                onClick={() => editing ? togglePin(tf) : (() => { onIntervalChange(tf); setOpen(false); setEditing(false); })()}
                className={`relative px-3 py-1.5 rounded text-xs font-mono border transition-colors ${
                  interval === tf && !editing
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-secondary text-foreground hover:bg-accent'
                }`}
              >
                {TIMEFRAME_LABELS[tf] || tf}
                {editing && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-[8px] font-bold">−</span>
                )}
              </button>
            ))}
          </div>

          {/* Available section */}
          <div className="px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">可用</span>
          </div>
          <div className="px-3 pb-2 flex flex-wrap gap-1.5">
            {available.map(tf => (
              <button
                key={tf}
                onClick={() => editing ? togglePin(tf) : (() => { onIntervalChange(tf); setOpen(false); setEditing(false); })()}
                className={`relative px-3 py-1.5 rounded text-xs font-mono border transition-colors ${
                  interval === tf && !editing
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-secondary text-foreground hover:bg-accent'
                }`}
              >
                {TIMEFRAME_LABELS[tf] || tf}
                {editing && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[8px] font-bold">+</span>
                )}
              </button>
            ))}
          </div>

          {/* Unsupported placeholders */}
          <div className="px-3 py-2 border-t border-border">
            <span className="text-xs font-medium text-muted-foreground">自定义间隔</span>
          </div>
          <div className="px-3 pb-3 flex flex-wrap gap-1.5">
            {UNSUPPORTED_TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => toast.info('历史回测暂不支持此周期')}
                className="px-3 py-1.5 rounded text-xs font-mono border border-border bg-secondary/50 text-muted-foreground cursor-not-allowed opacity-50"
              >
                {tf}
              </button>
            ))}
            <button
              onClick={() => toast.info('自定义间隔即将推出')}
              className="px-3 py-1.5 rounded text-xs font-mono border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
