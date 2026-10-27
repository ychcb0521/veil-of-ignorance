import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, CircleHelp, type LucideIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// 子模块操作低于标题层级；监测主按钮与菜单合计宽度和另外两个操作一致。
const shape = 'inline-flex h-6 shrink-0 items-center justify-center gap-1 whitespace-nowrap px-2 text-[10px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const primary = 'border border-primary/25 bg-primary/10 font-medium text-primary hover:border-primary/45 hover:bg-primary/20';
const pause = 'border border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground';
export const qualityPrimaryAction = `${shape} w-[5.5rem] rounded-md ${primary}`;
export const qualityPauseAction = `${shape} w-[5.5rem] rounded-md ${pause}`;
export const qualitySplitPrimaryAction = `${shape} w-[4.5rem] rounded-l-md border-r-0 ${primary}`;
export const qualitySplitPauseAction = `${shape} w-[4.5rem] rounded-l-md border-r-0 ${pause}`;
export const qualitySplitMenuAction = 'inline-flex w-4 shrink-0 items-center justify-center rounded-r-md border outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';

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
  return <section aria-label={`${title}模块`} data-testid={testId} className="relative flex min-w-0 flex-wrap items-start gap-x-3 border-b border-border/40 py-2.5 first:pt-1 last:border-b-0 last:pb-1">
    <div className="flex h-7 w-28 shrink-0 items-center gap-0.5">
      <h4 className="min-w-0">
        <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)} className="-ml-1 inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-1 text-left text-[11px] font-medium text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"><Icon aria-hidden className="h-3 w-3 text-muted-foreground"/><span data-testid={titleTestId}>{title}</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`}/></button>
      </h4>
      <div className="flex min-w-0 items-center text-[10px] text-muted-foreground">{summary}</div>
    </div>
    <div id={contentId} hidden={!open} className="min-w-0 flex-1 basis-52">
      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-1.5 text-[11px]">{children}</div>
      {status && <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pb-1 pt-1 text-[10.5px] text-muted-foreground">{status}</div>}
      {progress}
    </div>
  </section>;
}
