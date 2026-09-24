import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CampaignPnlOverviewItem } from '@/lib/campaignPnlOverview';

/** 指标名 + ⓘ 弹层。aria-label 固定为「{label}说明」，页面测试靠它定位每一项。 */
export function PnlMetricLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/metric inline-flex min-w-0 items-center gap-0.5 text-muted-foreground">
      <span className="truncate" title={label}>{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${label}说明`}
            className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground opacity-20 transition-opacity hover:opacity-80 focus-visible:opacity-80 focus-visible:outline-none group-hover/metric:opacity-40"
          >
            <Info className="h-2.5 w-2.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          className="w-72 border-border bg-card p-3 text-[11px] leading-relaxed shadow-md"
        >
          <div className="font-medium text-foreground">{label}</div>
          <div className="mt-1.5 space-y-1.5 text-muted-foreground">{children}</div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

/**
 * 两栏还是一栏看**面板自己**的宽度（容器查询），不看屏幕：详情页里面板只占半屏，1024px 的屏幕上面板内容宽约 450px，
 * 两栏并排会把「主力开仓名义仓位」这类名字截成省略号。浏览器实测每栏最宽的一行（名字 + 12px + 读数）：
 * 左栏盈亏比「49628.8% (496.29)」约 189px，右栏「主力开仓名义仓位 1703650.00 USDT」约 235px；再给九位数的读数留余量，
 * 两栏各要 ≈ 250px，加 32px 栏距，面板内容宽 ≥ 540px 才并排，否则并成一栏（先左栏、再右栏）。
 * Tailwind 需要完整类名，所以逐个写出。
 */
const TWO_COLUMN_GRID = '[@container(min-width:540px)]:grid-cols-2';
const COL_START = {
  left: '[@container(min-width:540px)]:col-start-1',
  right: '[@container(min-width:540px)]:col-start-2',
} as const;
/** 并成一栏时，右栏第一项上面一道细线，把递进链与结果和仓位两组分开；两栏并排时去掉。 */
const SINGLE_COLUMN_GROUP_BREAK = 'mt-1 border-t border-border/50 pt-3 [@container(min-width:540px)]:mt-0 [@container(min-width:540px)]:border-t-0 [@container(min-width:540px)]:pt-0';
const ROW_START = [
  '[@container(min-width:540px)]:row-start-1', '[@container(min-width:540px)]:row-start-2',
  '[@container(min-width:540px)]:row-start-3', '[@container(min-width:540px)]:row-start-4',
  '[@container(min-width:540px)]:row-start-5', '[@container(min-width:540px)]:row-start-6',
  '[@container(min-width:540px)]:row-start-7', '[@container(min-width:540px)]:row-start-8',
  '[@container(min-width:540px)]:row-start-9', '[@container(min-width:540px)]:row-start-10',
];

export interface CampaignPnlOverviewPanelProps {
  title: string;
  items: CampaignPnlOverviewItem[];
  testId?: string;
}

/**
 * 「盈亏概览」卡片本体。真实战役与反事实分支共用：同一份 items 顺序、同一套 ⓘ 弹层。
 * 【用户要求】底部那行「期望口径」脚注删掉：胜率取 50% 写在算术期望的 ⓘ 里，资产分母用的是哪种写在几何期望的 ⓘ 里。反事实的「相对实际」、逐腿改动与操作按钮不进这张卡，
 * 放在它左边的「相对原始的变化情况」里（CounterfactualOverviewRow），两张面板的内部排布因此逐项相同。
 */
export function CampaignPnlOverviewPanel({ title, items, testId }: CampaignPnlOverviewPanelProps) {
  const leftRows = new Map(items.filter(item => !item.rightColumn).map((item, row) => [item.key, row]));
  const rightRows = new Map(items.filter(item => item.rightColumn).map((item, row) => [item.key, row]));
  return (
    <div className="bg-card border border-border rounded p-4 text-[12px] [container-type:inline-size]" data-testid={testId}>
      {/* 标题只占一行：反事实分支名最长 20 字，窄屏两栏并排时折行会让这张卡比上方「盈亏概览」高出一行；截断后悬停看全名。 */}
      <div className="truncate font-medium" title={title}>{title}</div>
      {/* 两栏各自从上往下排（次序见 PNL_OVERVIEW_LEFT_COLUMN / PNL_OVERVIEW_CHAIN_COLUMN）：每项按它在本栏的序号落到同一行，
          左右两栏共用行高，同一行的两项始终齐平；面板窄时并成一栏，按 DOM 顺序，先左栏、再右栏。 */}
      <div className={`mt-3 grid grid-cols-1 gap-x-8 gap-y-2 ${TWO_COLUMN_GRID}`}>
        {items.map(item => {
          const row = (item.rightColumn ? rightRows : leftRows).get(item.key) ?? 0;
          return (
            <div
              key={item.key}
              data-column={item.rightColumn ? 'right' : 'left'}
              className={`flex min-w-0 items-baseline justify-between gap-3 ${item.rightColumn ? COL_START.right : COL_START.left} ${ROW_START[row] ?? ''} ${item.rightColumn && row === 0 ? SINGLE_COLUMN_GROUP_BREAK : ''}`}
            >
              <PnlMetricLabel label={item.label}>{item.help}</PnlMetricLabel>
              {/* 【用户要求】「要对齐」：每项一行，数值不折行、右端对齐；名称过长时截断（悬停看全名），不把这一行撑高。 */}
              <span className={`shrink-0 whitespace-nowrap font-mono tabular-nums ${item.valueClassName ?? ''}`}>{item.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
