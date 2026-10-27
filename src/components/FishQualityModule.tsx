import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

/** 鱼质量的三个工作模块共用尺寸、留白和标题层级。 */
export function FishQualityModule({ title, icon: Icon, summary, children, status, progress, testId, titleTestId }: {
  title: string;
  icon: LucideIcon;
  summary?: ReactNode;
  children: ReactNode;
  status?: ReactNode;
  progress?: ReactNode;
  testId?: string;
  titleTestId?: string;
}) {
  const [open, setOpen] = useState(true), contentId = useId();
  return <section aria-label={`${title}模块`} data-testid={testId} className={`min-w-0 py-2 ${progress ? '' : 'border-b border-border/50 last:border-b-0'}`}>
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)} className="-ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] font-medium text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted"><Icon aria-hidden className="h-3 w-3 text-muted-foreground"/><span data-testid={titleTestId}>{title}</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`}/></button>
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">{summary}</div>
    </div>
    <div id={contentId} hidden={!open}>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 pb-1 pt-1 text-[11px]">{children}</div>
      {status && <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pb-1 pt-1 text-[10.5px] text-muted-foreground">{status}</div>}
      {progress}
    </div>
  </section>;
}
