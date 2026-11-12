import { useEffect, useRef, useState } from 'react';
import { listQualityTemplateArchive, readQualityTemplateArchive, type QualityTemplateArchiveRow, type QualityTemplatePurpose } from '@/lib/fish/qualityTemplateArchive';
import type { QualityPlanTemplate } from '@/lib/fish/qualityPlanTemplates';

export function FishQualityTemplateArchive({ owner, purpose, restore }: {
  owner?: string;
  purpose: QualityTemplatePurpose;
  restore?: (template: QualityPlanTemplate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<QualityTemplateArchiveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const current = useRef({ owner, purpose });
  current.current = { owner, purpose };

  useEffect(() => {
    setRows([]);
    setMessage('');
    setError('');
    setBusy('');
    setLoading(false);
    setOpen(false);
  }, [owner, purpose]);

  useEffect(() => {
    if (!open || !owner) return;
    let active = true;
    setLoading(true);
    setError('');
    void listQualityTemplateArchive(owner, purpose).then(data => {
      if (active) setRows(data);
    }, () => {
      if (active) setError('系统存档读取失败，请重试');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [open, owner, purpose, revision]);

  if (!owner || !restore) return null;
  const recover = async (row: QualityTemplateArchiveRow) => {
    if (busy) return;
    setBusy(row.id);
    setError('');
    setMessage('');
    const isCurrent = () => current.current.owner === owner && current.current.purpose === purpose;
    try {
      const template = await readQualityTemplateArchive(owner, row.id);
      if (!isCurrent()) return;
      if (Boolean(template.plan?.preEntryThreeStage) !== (purpose === 'entry')) {
        throw Error('这份存档属于另一类模板，请到对应的模板库恢复');
      }
      restore(template);
      setMessage('已恢复到模板库，原有模板保留。');
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : '恢复失败');
    } finally {
      if (isCurrent()) setBusy('');
    }
  };

  return <section className="border-t border-border px-2 py-2 text-[11px]" data-testid="template-system-archive">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="font-medium text-primary">系统存档{open ? ' ▴' : ' ▾'}</button>
    {open && <div className="mt-2 space-y-2">
      <p className="text-muted-foreground">模板新增、改名或恢复后由系统自动固化版本；日常删除模板、清理缓存或重置交易数据不会清除此处。旧算法版本也会原样保留。</p>
      {loading ? <p role="status">读取系统存档…</p> : !error && !rows.length ? <p>还没有系统存档；模板同步成功后会自动建立。</p> : null}
      {error && <p role="alert" className="text-destructive">{error} <button type="button" onClick={() => setRevision(value => value + 1)}>重试</button></p>}
      {message && <p role="status" className="text-primary">{message}</p>}
      <ul className="max-h-72 space-y-2 overflow-y-auto">{rows.map(row => <li key={row.id} className="flex items-center gap-2 rounded bg-muted/40 p-2">
        <div className="min-w-0 flex-1">
          <p className="truncate">{row.template_name}</p>
          <p className="text-[10px] text-muted-foreground">固化于 {new Date(row.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</p>
        </div>
        <button type="button" disabled={!!busy} className="shrink-0 rounded border border-primary/25 px-2 py-1 text-primary disabled:opacity-50" aria-label={`恢复系统存档 ${row.template_name}`} onClick={() => void recover(row)}>{busy === row.id ? '恢复中…' : '恢复到模板库'}</button>
      </li>)}</ul>
    </div>}
  </section>;
}
