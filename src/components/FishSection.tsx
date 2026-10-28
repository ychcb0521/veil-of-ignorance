/**
 * 【用户要求】2026-10-28「要注意三个模块各自领域内的隶属关系，要在前端界面显示上清晰显示」：
 * 渔只有两级标题——
 *   一级：捕捞 / 鱼舱 / 鱼质量，同一种字号、图标、计数与说明位置；
 *   二级：模块里的组成部分（捕捞的「算法」「新鱼」，鱼质量的「批量挖掘」「买前过滤」「持仓监测」），
 *         统一收在左侧一根竖线里、字号小一级。
 */
export const fishSectionHeading = '-ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring';
export const fishSubHeading = '-ml-1 inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-1 text-left text-[11px] font-medium text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring';
/** 二级内容的左侧竖线。 */
export const fishRail = 'ml-1.5 min-w-0 border-l border-border/60 pl-3 sm:pl-4';
/** 标题旁的 ⓘ：三处同一个样子。 */
export const fishInfoTrigger = 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/35 transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';
/** 标题右侧的计数。 */
export function FishCount({ n, label }: { n: number; label?: string }) {
  return <span aria-label={label} className={`min-w-[1.25rem] rounded px-1 text-center font-mono text-[10px] tabular-nums ${n ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{n}</span>;
}
