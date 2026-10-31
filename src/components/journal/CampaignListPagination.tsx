import { ChevronLeft, ChevronRight } from 'lucide-react';

export function CampaignListPagination({ page, pages, start, end, total, ready, placement, onChange }: {
  page: number; pages: number; start: number; end: number; total: number; ready: boolean;
  placement: '上方' | '下方'; onChange: (page: number) => void;
}) {
  if (pages <= 1) return null;
  const control = 'inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-25';
  return <nav aria-label={`战役列表分页（${placement}）`} className={`flex shrink-0 items-center justify-end gap-0.5 text-[10px] text-muted-foreground/60 ${placement === '上方' ? 'py-0' : 'py-2'}`}>
    <span className="mr-1 font-mono tabular-nums" title="此处只切换卡片；统计、全选与导出仍覆盖当前完整范围" role="status" aria-live="polite">{start + 1}–{end} / {total}</span>
    <button type="button" aria-label="上一页" disabled={!ready || page <= 1} onClick={() => onChange(page - 1)} className={control}><ChevronLeft aria-hidden className="h-3.5 w-3.5"/></button>
    <span className="min-w-9 text-center font-mono tabular-nums" aria-label={`第 ${page} 页，共 ${pages} 页`}>{page} / {pages}</span>
    <button type="button" aria-label="下一页" disabled={!ready || page >= pages} onClick={() => onChange(page + 1)} className={control}><ChevronRight aria-hidden className="h-3.5 w-3.5"/></button>
  </nav>;
}
