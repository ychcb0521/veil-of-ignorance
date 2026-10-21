/**
 * 复核成交额：把库里每条鱼按信号时刻重新取数，列出信号前成交额没达到门槛的，确认后一键删除。
 * 【用户要求】2026-10-21「捕捉到的一些标的存在 24 小时交易额小于 1000w USDT 的…请你想办法解决」
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, Loader2, Trash2 } from 'lucide-react';
import type { TradeSignal } from '@/lib/signalLibrary';
import type { SignalTurnoverOptions, SignalTurnoverProgress, SignalTurnoverResult } from '@/lib/signalTurnover';
import { auditFishTurnover, type FishTurnoverVerdict } from '@/lib/fish/turnoverAudit';
import { formatUTC8 } from '@/lib/timeFormat';

interface Props {
  fish: readonly TradeSignal[];
  onTurnover: (options: SignalTurnoverOptions) => Promise<SignalTurnoverResult>;
  onDelete: (id: string) => void;
  onJump: (id: string) => void;
  disabled?: boolean;
}
const btn = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors disabled:opacity-40';

export function FishTurnoverAudit(p: Props) {
  const [progress, setProgress] = useState<SignalTurnoverProgress | null>(null);
  const [verdicts, setVerdicts] = useState<Map<string, FishTurnoverVerdict> | null>(null);
  const [checked, setChecked] = useState(0);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const run = useRef<AbortController | null>(null);
  useEffect(() => () => run.current?.abort(), []);
  const running = progress?.status === 'running';
  // 只看还在库里的鱼（删掉的随即从列表消失）
  const present = useMemo(() => new Map(p.fish.map(s => [s.id, s])), [p.fish]);
  const failed = useMemo(() => verdicts ? [...verdicts].flatMap(([id, v]) => v.ok === false && present.has(id) ? [{ s: present.get(id)!, v }] : []).sort((a, b) => a.s.symbol.localeCompare(b.s.symbol) || a.s.timeMs - b.s.timeMs) : [], [verdicts, present]);
  const unknown = useMemo(() => verdicts ? [...verdicts].filter(([id, v]) => v.ok === null && present.has(id)).length : 0, [verdicts, present]);
  useEffect(() => { if (!failed.length) setConfirming(false); }, [failed.length]);

  const start = async () => {
    if (running) { run.current?.abort(); return; }
    const list = [...p.fish], controller = new AbortController();
    run.current = controller; setError(''); setConfirming(false); setVerdicts(null);
    try {
      const result = await p.onTurnover({ signals: list, signal: controller.signal, onProgress: setProgress, save: false });
      setVerdicts(auditFishTurnover(list, result.rows)); setChecked(result.rows.length);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)); setProgress(null); }
  };

  return <div className="space-y-1" data-testid="fish-turnover-audit">
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-muted-foreground">
      <button type="button" onClick={() => void start()} disabled={!running && (p.disabled || !p.fish.length)} title="按每条鱼的信号时刻重新取数，查信号前 1h / 12h / 24h 成交额是否达到门槛（100 万 / 800 万 / 1000 万 USDT）"
        className={`${btn} text-muted-foreground hover:bg-muted hover:text-foreground`}>
        {running ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : <Gauge aria-hidden className="h-3 w-3" />}{running ? '停止复核' : '复核成交额'}
      </button>
      {running && progress && <span className="tabular-nums">{progress.done} / {progress.total}{progress.current ? ` · ${progress.current}` : ''}</span>}
      {!running && verdicts && <span className="tabular-nums" data-testid="fish-turnover-audit-summary">
        {progress?.status === 'cancelled' ? `已停止：查了 ${checked} 条，` : `查了 ${checked} 条，`}
        {failed.length ? <span className="text-destructive">{failed.length} 条信号前成交额不达标</span> : '全部达标'}{unknown ? `，${unknown} 条取不到数` : ''}
      </span>}
      {error && <span className="text-destructive">{error}</span>}
    </div>
    {!running && failed.length > 0 && <div className="overflow-hidden rounded-lg border border-destructive/25 bg-destructive/[0.03]">
      <ul className="max-h-48 divide-y divide-border/40 overflow-y-auto text-[11px]" data-testid="fish-turnover-failed">
        {failed.map(({ s, v }) => <li key={s.id} className="flex min-w-0 items-baseline gap-2 px-2 py-1">
          <button type="button" onClick={() => p.onJump(s.id)} title="打开这条鱼" className="shrink-0 font-mono font-medium text-foreground hover:text-primary hover:underline">{s.symbol}</button>
          <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{formatUTC8(s.timeMs).slice(5, 16)}</span>
          <span className="min-w-0 break-words tabular-nums text-destructive/90">{v.text}</span>
        </li>)}
      </ul>
      <div className="flex items-center gap-2 border-t border-border/40 px-2 py-1">
        {confirming
          ? <><button type="button" onClick={() => { failed.forEach(({ s }) => p.onDelete(s.id)); setConfirming(false); }} className={`${btn} bg-destructive font-medium text-destructive-foreground hover:bg-destructive/90`}><Trash2 aria-hidden className="h-3 w-3" />确认删除 {failed.length} 条</button>
            <button type="button" onClick={() => setConfirming(false)} className={`${btn} text-muted-foreground hover:bg-muted hover:text-foreground`}>取消</button></>
          : <button type="button" onClick={() => setConfirming(true)} className={`${btn} text-destructive hover:bg-destructive/10`}><Trash2 aria-hidden className="h-3 w-3" />删除这 {failed.length} 条</button>}
        <span className="text-[10px] text-muted-foreground/70">删除后其他设备同步删除</span>
      </div>
    </div>}
  </div>;
}
