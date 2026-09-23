import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  COUNTERFACTUAL_CHANGES_TITLE,
  COUNTERFACTUAL_OVERVIEW_ROW_GRID_CLASS,
  CounterfactualOverviewRow,
} from '@/components/journal/CounterfactualOverviewRow';
import type { CampaignPnlOverviewItem } from '@/lib/campaignPnlOverview';

const items: CampaignPnlOverviewItem[] = [
  { key: 'realizedPnl', label: '已实现 P&L', value: '12.00 USDT', help: '说明 A', valueClassName: 'text-[#0ECB81]' },
  { key: 'geometricExpectancy', label: '几何期望', value: '1.20', help: '说明 B', rightColumn: true },
];

const LONG_LINE = `改 滚动对冲：开仓价 ${'1.75470000000000000000'.repeat(6)} → 1.7828`;

describe('CounterfactualOverviewRow', () => {
  it('两栏 + test id；左栏标题行放按钮，相对实际按正负染色，类型行 / 改动 / 运行信息依次排下', () => {
    render(
      <CounterfactualOverviewRow
        testIdPrefix="counterfactual-saved"
        title="反事实盈亏概览 · 我的方案"
        items={items}
        note="脚注"
        delta={8153}
        kindLine="What-if · 保存于 09-17 13:55"
        changeSummary={{ short: '滚动对冲 开仓价', lines: ['改 主力开仓：平仓价 100 → 110', LONG_LINE], legs: [] }}
        runContext={{ interval: '1h', from: '2026-03-23T03:00:00', to: '2026-06-12T01:00:00', kline_count: 1943, ran_at: '2026-09-17T13:55:00' }}
        actions={<button type="button">删除</button>}
      />,
    );

    const row = screen.getByTestId('counterfactual-saved-panel');
    expect(row.className).toBe(COUNTERFACTUAL_OVERVIEW_ROW_GRID_CLASS);
    const changes = screen.getByTestId('counterfactual-saved-changes');
    const overview = screen.getByTestId('counterfactual-saved-overview');
    expect(Array.from(row.children)).toEqual([changes, overview.parentElement]);

    // 左栏与「战役元数据」同一套卡片样式；长行在卡片里折行，不把栏撑宽
    expect(changes.className.split(/\s+/)).toEqual(expect.arrayContaining([
      'bg-card', 'border', 'border-border', 'rounded', 'p-4', 'text-[12px]', 'min-w-0', 'break-words',
    ]));
    const [titleRow, deltaLine, kindLine, changeLines, runLine] = Array.from(changes.children) as HTMLElement[];
    expect(titleRow.firstElementChild).toHaveTextContent(COUNTERFACTUAL_CHANGES_TITLE);
    expect(titleRow.firstElementChild?.className).toBe('font-medium');
    expect(within(titleRow).getByRole('button', { name: '删除' })).toBeInTheDocument();
    expect(titleRow.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-wrap']));
    expect(titleRow.lastElementChild?.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex-wrap', 'max-w-full']));
    expect(deltaLine).toHaveTextContent('相对实际+8153.00 USDT');
    expect(within(deltaLine).getByText('+8153.00 USDT')).toHaveClass('font-mono', 'text-[#0ECB81]');
    expect(kindLine).toHaveTextContent('What-if · 保存于 09-17 13:55');
    expect(Array.from(changeLines.children).map(line => line.textContent)).toEqual(['改 主力开仓：平仓价 100 → 110', LONG_LINE]);
    expect(runLine).toHaveTextContent('运行于 09-17 13:55 · 1h K 线 1943 根 · 03-23 03:00 ~ 06-12 01:00');

    // 右栏：与原面板同一张卡，没有任何额外行
    expect(overview.className).toBe('bg-card border border-border rounded p-4 text-[12px]');
    expect(overview.children).toHaveLength(3);
    expect(overview.firstElementChild).toHaveTextContent('反事实盈亏概览 · 我的方案');
    expect(within(overview).getAllByRole('button').map(button => button.getAttribute('aria-label')))
      .toEqual(['已实现 P&L说明', '几何期望说明']);
    expect(overview.querySelector('.sm\\:col-start-2')).toHaveTextContent('几何期望');
  });

  it('草稿没有类型行；delta 为 null 印「—」，负数染红；没改动 / 老行各有一句，没有运行信息就不印', () => {
    const { rerender } = render(
      <CounterfactualOverviewRow
        testIdPrefix="counterfactual-draft"
        title="反事实盈亏概览 · 未保存"
        items={items}
        note=""
        delta={null}
        changeSummary={{ short: '', lines: [], legs: [] }}
        actions={null}
      />,
    );
    let changes = screen.getByTestId('counterfactual-draft-changes');
    expect(changes.children).toHaveLength(3);
    expect(within(changes).getByText('—')).toHaveClass('text-muted-foreground');
    expect(within(changes).getByText('与原始 Legs 无差异')).toBeInTheDocument();
    expect(changes).not.toHaveTextContent('运行于');
    expect(changes).not.toHaveTextContent('保存于');

    rerender(
      <CounterfactualOverviewRow
        testIdPrefix="counterfactual-draft"
        title="反事实盈亏概览 · 未保存"
        items={items}
        note=""
        delta={-0.24}
        actions={null}
      />,
    );
    changes = screen.getByTestId('counterfactual-draft-changes');
    expect(within(changes).getByText('-0.24 USDT')).toHaveClass('text-[#F6465D]');
    expect(within(changes).getByText('早期分支未记录改动摘要')).toBeInTheDocument();
  });
});
