import { useState } from 'react';
import { Database, Loader2 } from 'lucide-react';
import { importTuringReplayArchive, saveTuringReplayArchiveToAccount } from '@/lib/turingCupReplayArchive';
import type { useTuringReplayArchive } from '@/hooks/useTuringReplayArchive';

type Props = {
  accountId: string;
  source: ReturnType<typeof useTuringReplayArchive>;
};

export function TuringCupReplayPanel({ accountId, source }: Props) {
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [synced, setSynced] = useState(false);

  async function save(file?: File) {
    setBusy(true);
    setSynced(false);
    setSyncError('');
    try {
      if (file) await importTuringReplayArchive(accountId, file);
      if (await saveTuringReplayArchiveToAccount(accountId)) setSynced(true);
      else setSyncError('行情已保存在本机，账号同步失败');
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : '图灵杯行情保存失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label title="导入图灵杯行情到账号" className="flex h-[22px] shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        {busy || source.loading ? <Loader2 aria-hidden className="h-3 w-3 animate-spin" /> : <Database aria-hidden className="h-3 w-3" />}
        {busy ? '正在保存行情' : source.loading ? '正在读取行情' : synced ? '行情已同步' : '行情文件'}
        <input type="file" accept=".json,application/json" aria-label="导入图灵杯行情" className="sr-only"
          disabled={busy || source.loading} onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void save(file);
          }} />
      </label>
      {source.error && !busy && <button type="button" className="text-[10px] text-destructive hover:underline" onClick={source.retry}>{source.error}</button>}
      {syncError && <span role="alert" className="text-[10px] text-destructive">{syncError}{source.archive && !busy &&
        <button type="button" className="ml-1 underline" onClick={() => void save()}>重试同步</button>}</span>}
    </>
  );
}
