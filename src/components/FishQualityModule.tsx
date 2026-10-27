import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, CircleHelp, type LucideIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const action = 'inline-flex h-7 w-[5.75rem] shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[11px] transition-colors disabled:opacity-40';
export const qualityPrimaryAction = `${action} bg-primary font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:shadow-none`;
export const qualityPauseAction = `${action} border border-border/70 text-foreground hover:bg-muted`;

export function FishQualityInfo({ label, children }: { label: string; children: ReactNode }) {
  return <Popover><PopoverTrigger asChild><button type="button" aria-label={label} title={label} className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/35 transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"><CircleHelp aria-hidden strokeWidth={1.4} className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" collisionPadding={12} aria-label={label} className="w-80 max-w-[calc(100vw-1.5rem)] max-h-[min(80vh,var(--radix-popover-content-available-height))] space-y-2 overflow-y-auto overscroll-contain p-3 text-[11px] leading-relaxed">{children}</PopoverContent></Popover>;
}

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
  return <section aria-label={`${title}模块`} data-testid={testId} className="relative min-w-0 border-b border-border/50 py-2 last:border-b-0">
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
