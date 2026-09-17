import type { ReactNode } from 'react';
import { CampaignPnlOverviewPanel } from '@/components/journal/CampaignPnlOverviewPanel';
import { pnlColor, type CampaignPnlOverviewItem } from '@/lib/campaignPnlOverview';
import { formatCounterfactualStamp } from '@/lib/counterfactualChangeSummary';
import type { CampaignCounterfactualChangeSummary, CampaignCounterfactualRunContext } from '@/types/journal';

/** 左栏卡片标题：与用户口径一致，页面、指南与测试共用这一个字符串。 */
export const COUNTERFACTUAL_CHANGES_TITLE = '相对原始的变化情况';

/**
 * 反事实这一行与上方「战役元数据 | 盈亏概览」在同一断点（md）分成两栏，右栏的「反事实盈亏概览」
 * 必须与上方「盈亏概览」一样宽：
 *   上方：main 内容宽 W，两栏 gap-4（16px）→ 右栏 = (W − 16) / 2。
 *   这里：外层「反事实战役」卡片 p-6 + 1px 边框，本行内容宽 = W − 2 × (24 + 1) = W − 50。
 *   右栏 = (W − 16) / 2 = ((W − 50) + 34) / 2 = 50% + 17px（百分比相对本行内容宽）。
 * 改了外层卡片的内边距 / 边框或上方的 gap，这里的 17px 要一起算；本行自己的 gap 只影响左栏，不用改它。
 */
export const COUNTERFACTUAL_OVERVIEW_ROW_GRID_CLASS =
  'grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_calc(50%_+_17px)]';

export interface CounterfactualOverviewRowProps {
  /** 整行与左右两张卡的 test id 前缀：`{prefix}-panel` / `{prefix}-changes` / `{prefix}-overview`。 */
  testIdPrefix: 'counterfactual-draft' | 'counterfactual-saved';
  /** 右栏面板标题：「反事实盈亏概览 · 未保存」或「反事实盈亏概览 · {分支名}」。 */
  title: string;
  items: CampaignPnlOverviewItem[];
  note: ReactNode;
  /** 分支已实现 − 上方「已实现 P&L」；null 印「—」。 */
  delta: number | null;
  changeSummary?: CampaignCounterfactualChangeSummary;
  runContext?: CampaignCounterfactualRunContext;
  /** 已保存分支才有：分支类型 · SOP 分数 · 保存时刻。 */
  kindLine?: string;
  /** 左栏标题行右侧的按钮：草稿是 分支名 / 保存 / 丢弃，已保存分支是 载入到 Legs 副本 / 删除。 */
  actions: ReactNode;
}

/**
 * 反事实结果的一整行：左栏「相对原始的变化情况」（相对实际、逐腿改动、运行信息与操作按钮），
 * 右栏是与上方「盈亏概览」同宽、同一套内部排布的面板（只有标题、12 项与脚注）。
 * 未保存草稿与已保存分支共用这一个组件，两处的排布不会各改各的。
 */
export function CounterfactualOverviewRow({
  testIdPrefix,
  title,
  items,
  note,
  delta,
  changeSummary,
  runContext,
  kindLine,
  actions,
}: CounterfactualOverviewRowProps) {
  return (
    <div className={COUNTERFACTUAL_OVERVIEW_ROW_GRID_CLASS} data-testid={`${testIdPrefix}-panel`}>
      <div
        data-testid={`${testIdPrefix}-changes`}
        className="min-w-0 break-words bg-card border border-border rounded p-4 space-y-2 text-[12px]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium">{COUNTERFACTUAL_CHANGES_TITLE}</div>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{actions}</div>
        </div>
        <div>
          相对实际
          <span className={`ml-1 font-mono ${pnlColor(delta)}`}>
            {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(2)} USDT`}
          </span>
        </div>
        {kindLine && <div className="text-muted-foreground">{kindLine}</div>}
        <div className="space-y-1">
          {changeSummary
            ? (changeSummary.lines.length > 0
              ? changeSummary.lines.map((line, index) => <div key={`${index}-${line}`}>{line}</div>)
              : <div className="text-muted-foreground">与原始 Legs 无差异</div>)
            : <div className="text-muted-foreground">早期分支未记录改动摘要</div>}
        </div>
        {runContext && (
          <div className="text-[11px] text-muted-foreground/70 pt-1">
            运行于 {formatCounterfactualStamp(runContext.ran_at)} · {runContext.interval} K 线 {runContext.kline_count} 根
            · {formatCounterfactualStamp(runContext.from)} ~ {formatCounterfactualStamp(runContext.to)}
          </div>
        )}
      </div>
      {/* 左栏更长时右栏不被拉高：高度始终与上方「盈亏概览」一样由内容决定。 */}
      <div className="min-w-0 md:self-start">
        <CampaignPnlOverviewPanel
          testId={`${testIdPrefix}-overview`}
          title={title}
          items={items}
          note={note}
        />
      </div>
    </div>
  );
}
