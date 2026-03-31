import { ALL_TIMEFRAMES, TIMEFRAME_LABELS, UNSUPPORTED_TIMEFRAMES, type Timeframe } from '@/hooks/useTimeframePrefs';
import { X } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onClose: () => void;
  interval: string;
  onIntervalChange: (i: string) => void;
}

export function MobileTimeframeSheet({ open, onClose, interval, onIntervalChange }: Props) {
  if (!open) return null;

  const handleSelect = (tf: string) => {
    onIntervalChange(tf);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Sheet */}
      <div
        className="relative w-full rounded-t-2xl border-t border-border pb-8 animate-in slide-in-from-bottom duration-200"
        style={{ background: 'hsl(var(--card))' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-sm font-bold text-foreground">时间周期</span>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Grid of all timeframes */}
        <div className="px-4 py-2 grid grid-cols-4 gap-2">
          {/* Unsupported placeholders first */}
          {UNSUPPORTED_TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => toast.info('历史回测暂不支持此周期')}
              className="py-2.5 rounded-lg text-xs font-mono border border-border bg-secondary/50 text-muted-foreground opacity-50"
            >
              {tf}
            </button>
          ))}

          {ALL_TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => handleSelect(tf)}
              className={`py-2.5 rounded-lg text-xs font-mono border transition-colors ${
                interval === tf
                  ? 'border-primary bg-primary/10 text-primary font-bold'
                  : 'border-border bg-secondary text-foreground hover:bg-accent'
              }`}
            >
              {TIMEFRAME_LABELS[tf] || tf}
            </button>
          ))}
        </div>

        {/* Custom placeholder */}
        <div className="px-4 pt-1 pb-2">
          <div className="flex items-center justify-between py-2 border-t border-border">
            <span className="text-xs text-muted-foreground">自定义间隔</span>
            <button
              onClick={() => toast.info('自定义间隔即将推出')}
              className="w-8 h-8 rounded-lg border border-dashed border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors text-sm"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
