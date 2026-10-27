import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** 鱼质量的三个工作模块共用尺寸、留白和标题层级。 */
export function FishQualityModule({ title, icon: Icon, summary, children, progress, testId, titleTestId }: {
  title: string;
  icon: LucideIcon;
  summary?: ReactNode;
  children: ReactNode;
  progress?: ReactNode;
  testId?: string;
  titleTestId?: string;
}) {
  return <section aria-label={`${title}模块`} data-testid={testId} className="relative flex min-w-0 flex-[1_1_20rem] flex-col justify-between gap-2 overflow-hidden rounded-lg border border-border/60 bg-background/70 px-3 py-2.5">
    <div className="flex min-h-5 min-w-0 items-center gap-2 text-[11px]">
      <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-foreground/85"><Icon aria-hidden className="h-3.5 w-3.5 text-muted-foreground/70"/><span data-testid={titleTestId}>{title}</span></span>
      <div className="ml-auto flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">{summary}</div>
    </div>
    <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-1.5">{children}</div>
    {progress}
  </section>;
}
