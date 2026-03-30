import { useState, useEffect, useCallback } from 'react';
import { X, Snowflake, Clock, AlertTriangle } from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';

const DURATIONS = [
  { label: '10 分钟', value: 10 * 60 * 1000 },
  { label: '1 小时', value: 60 * 60 * 1000 },
  { label: '24 小时', value: 24 * 60 * 60 * 1000 },
  { label: '1 周', value: 7 * 24 * 60 * 60 * 1000 },
];

interface CoolingOffState {
  until: number; // real timestamp when cooling off ends (0 = not active)
}

export function useCoolingOff() {
  const [state, setState] = usePersistedState<CoolingOffState>('cooling_off', { until: 0 });
  const [now, setNow] = useState(Date.now());

  // Tick every second when active
  useEffect(() => {
    if (state.until <= 0) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [state.until]);

  const isActive = state.until > 0 && Date.now() < state.until;
  const remainingMs = isActive ? Math.max(0, state.until - now) : 0;

  const activate = useCallback((durationMs: number) => {
    setState({ until: Date.now() + durationMs });
  }, [setState]);

  const formatRemaining = useCallback(() => {
    if (remainingMs <= 0) return '';
    const h = Math.floor(remainingMs / 3600000);
    const m = Math.floor((remainingMs % 3600000) / 60000);
    const s = Math.floor((remainingMs % 60000) / 1000);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, [remainingMs]);

  return { isActive, remainingMs, formatRemaining, activate };
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (durationMs: number) => void;
}

export function CoolingOffModal({ open, onClose, onConfirm }: ModalProps) {
  const [selected, setSelected] = useState(DURATIONS[0].value);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative w-full max-w-md mx-4 rounded-lg border border-border overflow-hidden"
        style={{ background: 'hsl(var(--card))' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Snowflake className="w-5 h-5 text-blue-400" />
            <h2 className="text-sm font-bold text-foreground">🧊 交易冷静期</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
            <div className="text-xs text-destructive">
              <p className="font-bold mb-1">⚠️ 重要警告</p>
              <p>开启交易冷静期后，您将在设定的时间内<strong>无法在任何合约交易对上开立新仓位</strong>。
                此操作一旦确认，<strong>不可撤销</strong>。</p>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            <p>冷静期内您仍然可以：</p>
            <ul className="list-disc ml-4 mt-1 space-y-0.5">
              <li>平仓现有持仓</li>
              <li>撤销挂单</li>
              <li>查看图表和数据</li>
            </ul>
          </div>

          {/* Duration selector */}
          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1.5">选择冷静期时长（真实物理时间）</label>
            <div className="grid grid-cols-4 gap-1.5">
              {DURATIONS.map(d => (
                <button key={d.value} onClick={() => setSelected(d.value)}
                  className={`py-2 px-1 rounded text-[11px] font-medium transition-colors border ${
                    selected === d.value
                      ? 'border-blue-400 bg-blue-400/10 text-blue-400'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose}
            className="flex-1 py-2 rounded text-xs font-medium border border-border text-muted-foreground hover:text-foreground transition-colors">
            取消
          </button>
          <button onClick={() => { onConfirm(selected); onClose(); }}
            className="flex-1 py-2 rounded text-xs font-bold bg-blue-500 text-white hover:bg-blue-600 transition-colors">
            🧊 确认开启冷静期
          </button>
        </div>
      </div>
    </div>
  );
}

/** Badge shown on order buttons when cooling off is active */
export function CoolingOffBadge({ formatRemaining }: { formatRemaining: () => string }) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="flex items-center gap-1 text-blue-400 text-[10px] font-mono">
      <Clock className="w-3 h-3" />
      <span>冷静期中: {formatRemaining()}</span>
    </div>
  );
}
