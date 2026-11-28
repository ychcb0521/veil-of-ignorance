import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';

export function FishTemplateImport({ disabled, save }: {
  disabled?: boolean;
  save: (text: string) => Promise<string>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  async function importFile(file: File) {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '');
      if (!active.current) return;
      const name = await save(text);
      if (active.current) setMessage('已导入「' + name + '」');
    } catch (cause) {
      if (active.current) setError(cause instanceof SyntaxError ? '文件不是有效的模板 JSON。' : cause instanceof Error ? cause.message : '导入失败');
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return <div className="space-y-1 px-2 py-1">
    <input ref={input} type="file" accept=".json,application/json" aria-label="选择模板文件" hidden onChange={e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file && !disabled && !busy) void importFile(file);
    }}/>
    <button type="button" disabled={disabled || busy} className="inline-flex items-center gap-1 rounded px-2 py-1 text-primary hover:bg-muted disabled:opacity-40" onClick={() => input.current?.click()}>
      <Upload aria-hidden className="h-3.5 w-3.5"/>{busy ? '正在导入…' : '导入模板'}
    </button>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
