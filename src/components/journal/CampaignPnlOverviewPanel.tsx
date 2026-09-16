import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CampaignPnlOverviewItem } from '@/lib/campaignPnlOverview';

/** 指标名 + ⓘ 弹层。aria-label 固定为「{label}说明」，页面测试靠它定位每一项。 */
export function PnlMetricLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/metric inline-flex items-center gap-0.5 text-muted-foreground">
      <span>{label}</span>
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

export interface CampaignPnlOverviewPanelProps {
  title: string;
  items: CampaignPnlOverviewItem[];
  note: ReactNode;
  /** 标题下方一行小字：反事实面板用来放「相对实际 ±… USDT」与改动摘要。 */
  subtitle?: ReactNode;
  /** 标题右侧的操作按钮：反事实面板的 保存 / 丢弃 / 删除 / 载入到 Legs 副本。 */
  actions?: ReactNode;
  testId?: string;
}

/**
 * 「盈亏概览」卡片本体。真实战役与反事实分支共用：同一份 items 顺序、同一套 ⓘ 弹层、同一条脚注。
 * 没有 subtitle / actions 时的 DOM 与原先详情页内联的那份完全一致。
 */
export function CampaignPnlOverviewPanel({ title, items, note, subtitle, actions, testId }: CampaignPnlOverviewPanelProps) {
  return (
    <div className="bg-card border border-border rounded p-4 text-[12px]" data-testid={testId}>
      {actions ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium">{title}</div>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      ) : (
        <div className="font-medium">{title}</div>
      )}
      {subtitle != null && subtitle !== false && (
        <div className="mt-1 text-[11px] text-muted-foreground">{subtitle}</div>
      )}
      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
        {items.map(item => (
          <div
            key={item.key}
            className={`flex items-baseline justify-between gap-3 ${item.rightColumn ? 'sm:col-start-2' : ''}`}
          >
            <PnlMetricLabel label={item.label}>{item.help}</PnlMetricLabel>
            <span className={`font-mono ${item.valueClassName ?? ''}`}>{item.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-border/70 pt-2 text-[10px] text-muted-foreground">
        {note}
      </div>
    </div>
  );
}
