import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { libraryDirectoryAction } from './FishLibraryTimeDirectory';
import { LIBRARY_FILE_LIMIT, makeLibraryPackage, parseLibraryFile, stringifyLibraryFile } from '@/lib/fish/libraryTransfer';
import { importMiningLibraries, loadMiningLibraryForTransfer } from '@/lib/fish/miningLibraryStore';
import type { FishMiningLibrary } from '@/lib/fish/miningLibrary';
import { formatUTC8 } from '@/lib/timeFormat';

export function FishMiningTransfer({ account }: { account?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const owner = useRef(account);
  owner.current = account;
  const [pending, setPending] = useState<FishMiningLibrary[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function download() {
    setBusy(true);
    setError('');
    try {
      const library = await loadMiningLibraryForTransfer(account);
      if (owner.current !== account) return;
      const pack = await makeLibraryPackage(account ?? 'anonymous', account ? '捕捞库' : '本地捕捞库', { mining: library }, 'mining');
      const file = new Blob([stringifyLibraryFile(pack)], { type: 'application/json;charset=utf-8' });
      if (file.size > LIBRARY_FILE_LIMIT) throw Error('捕捞库数据包超过 128 MB');
      if (owner.current !== account) return;
      const url = URL.createObjectURL(file), link = document.createElement('a');
      link.href = url;
      link.download = '捕捞库-完整数据-' + formatUTC8(Date.now()).replace(/\D/g, '') + '.json';
      try { link.click(); }
      finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function read(file: File) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (file.size > LIBRARY_FILE_LIMIT) throw Error('捕捞库数据包超过 128 MB');
      const data = (await parseLibraryFile(await file.text())).flatMap(pack => pack.libraries.mining?.records.length ? [pack.libraries.mining] : []);
      if (!data.length) throw Error('文件没有捕捞记录');
      if (owner.current === account) setPending(data);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      const synced = await importMiningLibraries(account, pending);
      if (owner.current === account) {
        setPending(undefined);
        setMessage(synced ? '捕捞记录已导入。' : '捕捞记录已在本机导入，云端尚未确认同步。');
      }
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className={libraryDirectoryAction} disabled={busy} onClick={() => void download()}>
      <Download aria-hidden className="h-3 w-3"/>完整下载捕捞库
    </button>
    <button type="button" className={libraryDirectoryAction} disabled={busy} onClick={() => input.current?.click()}>
      <Upload aria-hidden className="h-3 w-3"/>导入捕捞库
    </button>
    <input ref={input} type="file" hidden aria-label="上传捕捞库 JSON" accept=".json,application/json" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void read(file);
    }}/>
    {message && <span role="status" className="text-xs">{message}</span>}
    {error && !pending && <span role="alert" className="text-xs text-destructive">{error}</span>}
    <Dialog open={!!pending} onOpenChange={open => { if (!open && !busy) setPending(undefined); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入捕捞库</DialogTitle>
          <DialogDescription>文件包含 {pending?.reduce((count, library) => count + library.records.length, 0)} 条捕捞记录。确认后并入当前捕捞库，跳过已有记录。</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={libraryDirectoryAction} disabled={busy} onClick={() => setPending(undefined)}>取消</button>
          <button type="button" className={libraryDirectoryAction + ' text-primary'} disabled={busy} onClick={() => void confirm()}>{busy ? '正在导入…' : '确认导入捕捞库'}</button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
