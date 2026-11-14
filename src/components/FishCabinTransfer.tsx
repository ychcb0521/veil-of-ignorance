import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { downloadCabinFile, parseCabinFile } from '@/lib/fish/cabinTransfer';
import { LIBRARY_FILE_LIMIT } from '@/lib/fish/libraryTransfer';
import type { TradeSignal } from '@/lib/signalLibrary';

const action = 'inline-flex h-7 items-center gap-1 rounded px-2 text-[10.5px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40';

export function FishCabinTransfer({ records, onImport }: {
  records: readonly TradeSignal[];
  onImport: (records: readonly TradeSignal[]) => Promise<{ added: number; skipped: number; durable: boolean }>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<TradeSignal[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const read = async (file: File) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (file.size > LIBRARY_FILE_LIMIT) throw Error('鱼舱数据包超过 128 MB');
      const rows = parseCabinFile(await file.text());
      if (!rows.length) throw Error('文件没有鱼舱记录');
      setPending(rows);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? '请选择有效的鱼舱 JSON 文件' : (cause as Error).message);
    } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await onImport(pending);
      setPending(undefined);
      setMessage(`已导入 ${result.added} 条，跳过重复记录 ${result.skipped} 条${result.durable ? '。' : '。本机存储尚未确认，请保留页面和原文件。'}`);
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };

  return <div className="flex flex-wrap items-center gap-1">
    <button type="button" className={action} disabled={!records.length || busy} onClick={() => {
      setError('');
      try { downloadCabinFile(records); }
      catch (cause) { setError((cause as Error).message); }
    }}><Download aria-hidden className="h-3 w-3"/>完整下载 JSON</button>
    <button type="button" className={action} disabled={busy} onClick={() => input.current?.click()}>
      <Upload aria-hidden className="h-3 w-3"/>导入鱼舱
    </button>
    <input ref={input} type="file" hidden aria-label="上传鱼舱 JSON" accept=".json,application/json" onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) void read(file);
    }}/>
    {message && <span role="status" className="text-xs">{message}</span>}
    {error && !pending && <span role="alert" className="text-xs text-destructive">{error}</span>}
    <Dialog open={!!pending} onOpenChange={open => { if (!open && !busy) setPending(undefined); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>导入鱼舱</DialogTitle>
          <DialogDescription>文件包含 {pending?.length} 条记录。确认后并入当前鱼舱，跳过已有记录。</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={action} disabled={busy} onClick={() => setPending(undefined)}>取消</button>
          <button type="button" className={action + ' text-primary'} disabled={busy} onClick={() => void confirm()}>{busy ? '正在导入…' : '确认导入鱼舱'}</button>
        </div>
      </DialogContent>
    </Dialog>
  </div>;
}
