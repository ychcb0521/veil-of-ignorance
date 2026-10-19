/**
 * 时间机器倍速：主栏摆置顶的几档（只写数字，不带「x」），其余与编辑在下拉里——与 K 线周期选择（TimeframeSelector）同一个模式。
 * 【用户要求】2026-10-19「“x”符号删掉，倍速播放的那些，做成可编辑的，就像周期调整那里的模式一样。总之，这些要在同一行能够放下」。
 * 按下即生效（pointerdown），click 只补键盘操作，避免同一下点两次。
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useSpeedPrefs } from '@/hooks/useSpeedPrefs';

const chip = (active: boolean) => `h-6 min-w-[22px] rounded px-1 text-xs font-mono tabular-nums transition-all duration-100 ease-out active:scale-[0.95] ${
  active ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'}`;

export function SpeedSelector({ speed, onSelect }: { speed: number; onSelect: (speed: number) => void }) {
  const { pinned, available, togglePin } = useSpeedPrefs();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const downRef = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setEditing(false); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pinnedActive = pinned.includes(speed);
  const press = (s: number) => ({
    onPointerDown: (e: React.PointerEvent) => { if (e.button !== 0) return; downRef.current = s; onSelect(s); },
    onClick: () => { if (downRef.current === s) { downRef.current = null; return; } onSelect(s); },
  });
  const pick = (s: number) => { if (editing) togglePin(s); else { onSelect(s); setOpen(false); } };
  const cell = (s: number, sign: '−' | '+') => (
    <button
      key={s}
      type="button"
      onClick={() => pick(s)}
      title={editing ? (sign === '−' ? `从主栏移除 ${s} 倍速` : `把 ${s} 倍速放到主栏`) : `${s} 倍速`}
      data-testid={`speed-option-${s}`}
      className={`relative rounded border px-2.5 py-1 font-mono text-xs tabular-nums transition-colors ${
        speed === s && !editing ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-secondary text-foreground hover:bg-accent'}`}
    >
      {s}
      {editing && (
        <span className={`absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold ${
          sign === '−' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'}`}>{sign}</span>
      )}
    </button>
  );
  return (
    <div ref={boxRef} className="relative flex items-center gap-1" data-testid="speed-selector">
      <span className="mr-0.5 hidden text-[11px] text-muted-foreground xl:inline">倍速</span>
      {pinned.map(s => (
        <button key={s} type="button" {...press(s)} title={`${s} 倍速`} aria-pressed={speed === s} data-testid={`speed-${s}`} className={chip(speed === s)}>{s}</button>
      ))}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={pinnedActive ? '更多倍速' : `当前 ${speed} 倍速 · 更多倍速`}
        title="更多倍速 · 编辑主栏显示哪几档"
        data-testid="speed-more"
        className={`flex h-6 items-center gap-0.5 rounded px-1 font-mono text-xs tabular-nums transition-colors ${
          open ? 'bg-primary text-primary-foreground' : !pinnedActive ? 'bg-primary/80 text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-accent'}`}
      >
        {!pinnedActive && <span>{speed}</span>}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-xl" data-testid="speed-panel">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-foreground">置顶</span>
            <button type="button" onClick={() => setEditing(e => !e)} className="text-xs font-medium text-primary hover:text-primary/80" data-testid="speed-edit">{editing ? '完成' : '编辑'}</button>
          </div>
          <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">{pinned.map(s => cell(s, '−'))}</div>
          <div className="px-3 pt-2 text-xs font-medium text-muted-foreground">可用</div>
          <div className="flex flex-wrap gap-1.5 px-3 pb-2 pt-1.5">
            {available.length ? available.map(s => cell(s, '+')) : <span className="text-[11px] text-muted-foreground">全部已置顶</span>}
          </div>
        </div>
      )}
    </div>
  );
}
