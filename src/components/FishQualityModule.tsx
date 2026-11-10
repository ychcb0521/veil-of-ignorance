import {useSettingsImageCapture} from './SettingsImageExport';
import { FishPopoverContent as PopoverContent } from '@/components/FishPopoverContent';
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, CircleHelp, Filter, type LucideIcon } from 'lucide-react';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { fishInfoTrigger, fishSubHeading } from './FishSection';

const submoduleHeading = '-ml-1 inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-1 text-left text-[10px] font-normal text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring';

// 子模块操作低于标题层级；监测主按钮与菜单合计宽度和另外两个操作一致。
const shape = 'inline-flex h-6 shrink-0 items-center justify-center gap-1 whitespace-nowrap px-2 text-[10px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
const primary = 'border border-primary/25 bg-primary/10 font-medium text-primary hover:border-primary/45 hover:bg-primary/20';
const pause = 'border border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground';
export const qualityPrimaryAction = `${shape} w-[5.5rem] rounded-md ${primary}`;
export const qualityPauseAction = `${shape} w-[5.5rem] rounded-md ${pause}`;
export const qualitySplitPrimaryAction = `${shape} w-[4.5rem] rounded-l-md border-r-0 ${primary}`;
export const qualitySplitPauseAction = `${shape} w-[4.5rem] rounded-l-md border-r-0 ${pause}`;
export const qualitySplitMenuAction = 'inline-flex w-4 shrink-0 items-center justify-center rounded-r-md border outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40';
export const qualitySettingsAction = 'inline-flex h-7 w-[5.5rem] shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2 text-[10.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40';

export function FishQualityInfo({ label, children }: { label: string; children: ReactNode }) {
  const imageCapture=useSettingsImageCapture();
  return <><span hidden data-settings-image-include="">{imageCapture&&<><h5>{label}</h5>{children}</>}</span><Popover><PopoverTrigger asChild><button type="button" aria-label={label} title={label} className={fishInfoTrigger}><CircleHelp aria-hidden strokeWidth={1.4} className="h-3 w-3"/></button></PopoverTrigger><PopoverContent align="start" collisionPadding={12} aria-label={label} className="w-80 max-w-[calc(100vw-1.5rem)] max-h-[min(80dvh,var(--radix-popover-content-available-height))] space-y-2 overflow-y-auto overscroll-contain p-3 text-[11px] leading-relaxed">{children}</PopoverContent></Popover></>;
}

/** 鱼质量的三个工作模块共用尺寸、留白和标题层级。 */
/** trailing：放在行尾最右侧的次要操作（如组合表结果的隐藏 / 清除），不打乱三行按钮的逐列对齐。 */
export function FishQualityModule({ title, icon: Icon, summary, children, status, progress, trailing, testId, titleTestId, level='module' }: {
  title: string;
  icon: LucideIcon;
  summary?: ReactNode;
  children: ReactNode;
  status?: ReactNode;
  progress?: ReactNode;
  trailing?: ReactNode;
  testId?: string;
  titleTestId?: string;
  level?: 'module' | 'submodule';
}) {
  const [open, setOpen] = useState(true), contentId = useId();
  const Heading = level==='module'?'h4':'h5';
  return <section aria-label={`${title}模块`} data-testid={testId} data-module-level={level} className="relative flex min-w-0 flex-wrap items-start gap-x-3 border-b border-border/40 py-1.5 last:border-b-0">
    {/* 顶层标题列补齐子模块的左缩进（ml-1.5 + border-l + pl-3 / sm:pl-4），让四行操作按钮对齐。 */}
    <div className={`flex h-7 ${level==='submodule'?'w-28':'w-[calc(8.125rem+1px)] sm:w-[calc(8.375rem+1px)]'} shrink-0 items-center gap-0.5`}>
      <Heading className="min-w-0">
        <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)} className={level==='module'?fishSubHeading:submoduleHeading}><Icon aria-hidden className={`${level==='module'?'h-3.5 w-3.5':'h-3 w-3'} text-muted-foreground`}/><span data-testid={titleTestId}>{title}</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`}/></button>
      </Heading>
      <div className="flex min-w-0 items-center text-[10px] text-muted-foreground">{summary}</div>
    </div>
    <div id={contentId} hidden={!open} className="min-w-0 flex-1 basis-52">
      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-1.5 text-[11px]">{children}{status&&<div className="ml-1 inline-flex min-w-0 flex-wrap items-center gap-2 text-[10px] text-muted-foreground">{status}</div>}{trailing&&<div className="ml-auto inline-flex shrink-0 items-center">{trailing}</div>}</div>
      {progress}
    </div>
  </section>;
}

/** The buy workspace keeps static filtering and dynamic screening visibly separate. */
export function FishQualityModuleGroup({children}:{children:ReactNode}) {
  const [open,setOpen]=useState(true), id=useId();
  return <section aria-label="买前过滤模块" data-testid="quality-filter-controls" data-module-level="module" className="border-b border-border/40 py-1.5">
    <h4 className="flex h-7 items-center"><button type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)} className={fishSubHeading}>
      <Filter aria-hidden className="h-3.5 w-3.5 text-muted-foreground"/><span>买前过滤</span><ChevronDown aria-hidden className={`h-3 w-3 text-muted-foreground/70 transition-transform ${open?'rotate-180':''}`}/>
    </button></h4>
    <div id={id} hidden={!open} className="ml-1.5 min-w-0 border-l border-border/50 pl-3 sm:pl-4">{children}</div>
  </section>;
}
