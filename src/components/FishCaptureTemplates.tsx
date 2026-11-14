import { useEffect, useState } from 'react';
import { Bookmark, BookmarkPlus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { persistFishAccountPreference } from '@/hooks/useFishAccountSettings';
import { subscribePersistedStateHydration } from '@/lib/persistedStateStorage';
import { getUserId, getUserPrefix } from '@/lib/userStoragePrefix';
import { FISH_CAPTURE_TEMPLATES_KEY } from '@/lib/fish/accountSettings';
import { readFishCaptureTemplates, type FishCaptureTemplateSettings } from '@/lib/fish/captureTemplates';

const action = 'inline-flex min-h-7 items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 hover:bg-muted disabled:opacity-40';

interface Props {
  owner: string;
  locked: boolean;
  snapshot(): FishCaptureTemplateSettings;
  apply(settings: FishCaptureTemplateSettings): Promise<void>;
}

export function FishCaptureTemplates({ owner, locked, snapshot, apply }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ id: string; settings: FishCaptureTemplateSettings }>();
  const [name, setName] = useState('');
  const [catalog, setCatalog] = useState(() => readFishCaptureTemplates(owner));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = getUserPrefix(owner) + FISH_CAPTURE_TEMPLATES_KEY;
  useEffect(() => {
    const refresh = () => setCatalog(readFishCaptureTemplates(owner));
    const onStorage = (event: StorageEvent) => { if (event.key === key) refresh(); };
    window.addEventListener('storage', onStorage);
    const unsubscribe = subscribePersistedStateHydration(key, refresh);
    refresh();
    return () => { unsubscribe(); window.removeEventListener('storage', onStorage); };
  }, [key, owner]);

  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      if (getUserId() !== owner) throw Error('登录账号已切换，请重新打开捕捞设置');
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }

  const reset = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    setDraft(undefined);
    setName('');
    setError('');
  };
  const entries = catalog.flatMap(row => 'settings' in row && !row.deleted ? [row] : []).sort((a, b) => b.updatedAt - a.updatedAt);
  return <>
    <button type="button" className={action} onClick={() => reset(true)}><Bookmark aria-hidden className="h-3 w-3"/>捕捞模板</button>
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto p-4 text-xs sm:p-5">
        <DialogHeader className="pr-7 text-left">
          <DialogTitle>捕捞模板</DialogTitle>
          <DialogDescription>保存当前捕捞条件，载入后用于下一轮。</DialogDescription>
        </DialogHeader>
        {draft ? <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
          event.preventDefault();
          void perform(async () => {
            const title = name.trim();
            if (!title) throw Error('请填写模板名称');
            await persistFishAccountPreference(owner, FISH_CAPTURE_TEMPLATES_KEY, [
              ...readFishCaptureTemplates(owner).filter(row => row.id !== draft.id),
              { id: draft.id, version: 1, name: title, updatedAt: Date.now(), settings: draft.settings },
            ]);
            setDraft(undefined);
            setName('');
          });
        }}>
          <label className="min-w-0 flex-1 space-y-1">
            <span className="text-muted-foreground">模板名称</span>
            <input className="block h-8 w-full rounded-md border bg-background px-2" autoFocus maxLength={80} value={name}
              disabled={busy} onChange={event => setName(event.target.value)}/>
          </label>
          <button type="submit" className={action + ' text-primary'} disabled={busy || !name.trim()}>保存模板</button>
        </form> : <button type="button" className={action + ' justify-self-start'} disabled={busy} onClick={() => {
          setError('');
          try { setDraft({ id: crypto.randomUUID(), settings: snapshot() }); }
          catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存当前设置'); }
        }}><BookmarkPlus aria-hidden className="h-3.5 w-3.5"/>保存当前设置为模板</button>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {locked && <p className="text-muted-foreground">当前任务结束后可载入模板。</p>}
        {entries.length ? <ul className="divide-y rounded-md border">
          {entries.map(row => <li key={row.id} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
            <span className="min-w-0 flex-1 break-all">{row.name}</span>
            <button type="button" className={action} aria-label={`载入模板 ${row.name}`} disabled={locked || busy || !!draft}
              onClick={() => void perform(async () => { if (row.version !== 1) throw Error('当前版本无法核验此模板'); await apply(row.settings); setOpen(false); setDraft(undefined); setName(''); })}>载入</button>
            <button type="button" className={action + ' text-muted-foreground hover:text-destructive'} disabled={busy || !!draft} aria-label={`删除模板 ${row.name}`}
              onClick={() => {
                if (!window.confirm(`删除捕捞模板「${row.name}」？`)) return;
                void perform(() => persistFishAccountPreference(owner, FISH_CAPTURE_TEMPLATES_KEY, readFishCaptureTemplates(owner).map(entry =>
                  entry.id === row.id ? { id: row.id, deleted: true, updatedAt: Math.max(Date.now(), entry.updatedAt + 1) } : entry)));
              }}><Trash2 aria-hidden className="h-3.5 w-3.5"/></button>
          </li>)}
        </ul> : <p className="text-muted-foreground">还没有捕捞模板。</p>}
      </DialogContent>
    </Dialog>
  </>;
}
