import {formatUTC8} from '@/lib/timeFormat';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog';

export interface DirectorySettingsEntry {
  id: string;
  name: string;
  load: () => ReactNode | Promise<ReactNode>;
}

export function FishDirectorySettingsButton({ name, originalName, historicalAt, entries, disabled }: {
  name: string;
  originalName?: string;
  historicalAt?: number;
  entries: DirectorySettingsEntry[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ id: string; content?: ReactNode; error?: string }>();
  const entry = entries.find(item => item.id === selected) ?? entries[0];
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const id = entry?.id;
  useEffect(() => {
    const item = entryRef.current;
    if (!open || !item) return;
    let current = true;
    setLoaded(undefined);
    void Promise.resolve().then(item.load).then(
      content => { if (current) setLoaded({ id: item.id, content }); },
      error => { if (current) setLoaded({ id: item.id, error: error instanceof Error ? error.message : '模板设置读取失败' }); },
    );
    return () => { current = false; };
  }, [open, id, attempt]);
  if (!entry) return null;
  const current = loaded?.id === id ? loaded : undefined;
  return <Dialog open={open} onOpenChange={value => {
    setOpen(value);
    if (!value) setLoaded(undefined);
  }}>
    <DialogTrigger asChild>
      <button type="button" disabled={disabled} aria-label={'查看模板设置 '+name}
        className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
        <Settings2 aria-hidden className="h-3.5 w-3.5"/>模板设置
      </button>
    </DialogTrigger>
    <DialogContent data-testid="directory-template-settings"
      onOpenAutoFocus={event => { event.preventDefault(); scrollRef.current?.focus(); }}
      className="flex max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-[46rem] flex-col gap-0 overflow-hidden p-0">
      <header className="shrink-0 space-y-2 border-b px-4 pb-3 pt-4 pr-10 text-[11px]">
        <DialogTitle className="text-sm">模板设置 · {name}</DialogTitle>
        <DialogDescription className="text-[11px]">本轮保存的设置 · 只读</DialogDescription>
        {historicalAt&&<p className="text-muted-foreground">历史快照 · 最早归档 {formatUTC8(historicalAt)}</p>}
        {originalName&&<p className="text-muted-foreground">原名：{originalName}</p>}
        {entries.length > 1 && <label className="flex flex-wrap items-center gap-2">查看轮次或归档
          <select value={id} onChange={event=>setSelected(event.target.value)}
            className="min-w-0 max-w-full rounded border bg-background px-2 py-1">
            {entries.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}
      </header>
      <div key={id} ref={scrollRef} tabIndex={0} role="region" aria-label="设置内容"
        data-testid="directory-settings-scroll" className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4 text-[11px] focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-ring">
        {!current ? <p role="status">正在读取保存的设置…</p> : current.error ? <p role="alert" className="text-destructive">
          {current.error} <button type="button" className="underline" onClick={()=>setAttempt(v=>v+1)}>重试</button>
        </p> : current.content}
      </div>
    </DialogContent>
  </Dialog>;
}
