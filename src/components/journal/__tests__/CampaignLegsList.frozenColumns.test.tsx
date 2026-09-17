/**
 * 【用户要求】Legs 表横向滚动时，「#」与「角色」两列（连同表头）冻结在左缘。
 *
 * jsdom 不做布局，这里钉住的是让 sticky 生效的结构条件：
 * - 横竖只有一个滚动容器（行外再套一层 overflow-y-auto，冻结列就钉在那层从不横滚的容器上而失效）；
 * - 表头 sticky top，冻结格 sticky left，且带不透明底色；
 * - 冻结格出现在表头、数据行、主力阶段子行、合计行四处，每一处都是前两格。
 * 实际滚动效果在浏览器里核验过。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

function record(id: string, openTime: number, closeTime: number, entryPrice: number, exitPrice: number, side: 'LONG' | 'SHORT'): TradeRecord {
  return {
    id,
    symbol: 'TUTUSDT',
    side,
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice,
    exitPrice,
    quantity: 1000,
    leverage: 1,
    pnl: (side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice) * 1000,
    fee: 0,
    slippage: 0,
    openTime,
    closeTime,
  };
}

function leg(id: string, sequence: number, role: string, direction: 'long' | 'short', rec: TradeRecord): TradeJournal {
  return {
    id,
    user_id: 'user-1',
    trade_record_id: rec.id,
    campaign_id: 'campaign-1',
    leg_role: role,
    leg_sequence: sequence,
    source: 'retroactive_from_record',
    symbol: 'TUTUSDT',
    direction,
    leverage: 1,
    position_mode: 'isolated',
    order_kind: role.startsWith('hedge') ? 'hedge' : 'main',
    pre_simulated_time: new Date(rec.openTime).toISOString(),
    pre_real_time: '2026-08-01T00:00:00.000Z',
    pre_entry_price: rec.entryPrice,
    pre_mental_state: 3,
    pre_position_size: rec.entryPrice * rec.quantity,
    post_real_close_time: new Date(rec.closeTime).toISOString(),
    post_simulated_close_time: new Date(rec.closeTime).toISOString(),
    post_outcome: rec.pnl > 0 ? 'win' : 'loss',
    post_realized_pnl: rec.pnl,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
  } as TradeJournal;
}

function renderList(highlightedLegIds?: string[]) {
  const t0 = Date.parse('2026-08-01T00:00:00.000Z');
  const hour = 3_600_000;
  const main = record('rec-main', t0, t0 + 10 * hour, 0.1, 0.12, 'LONG');
  const hedge = record('rec-hedge', t0 + 2 * hour, t0 + 4 * hour, 0.105, 0.1, 'SHORT');
  const legs = [
    leg('leg-main', 1, 'main_open', 'long', main),
    leg('leg-hedge', 2, 'hedge_rolling', 'short', hedge),
  ];
  return render(
    <MemoryRouter>
      <CampaignLegsList legs={legs} tradeRecords={[main, hedge]} highlightedLegIds={highlightedLegIds} />
    </MemoryRouter>,
  );
}

const isSticky = (element: Element | null | undefined) => element?.className.split(/\s+/).includes('sticky') ?? false;

describe('【用户要求】Legs 表冻结「#」与「角色」两列', () => {
  it('横竖只有一个滚动容器，行区里不再套一层竖向滚动', () => {
    renderList();
    const scroller = screen.getByTestId('legs-scroll');
    expect(scroller.className).toContain('overflow-auto');
    expect(scroller.className).toMatch(/max-h-\[\d+px\]/);
    // 四周钉住的表头 / 合计行 / 冻结列各留滚动留白，键盘聚焦的按钮不会停在它们下面
    expect(scroller.className.split(/\s+/)).toEqual(expect.arrayContaining(['scroll-pb-20', 'scroll-pt-8', 'scroll-pl-[186px]']));
    // 容器里任何一层都不能再是滚动容器（每行「委托」格自己的小滚动区除外：它不包住冻结格）
    const nestedScrollers = Array.from(scroller.querySelectorAll('[class*="overflow-y-auto"], [class*="overflow-auto"], [class*="overflow-x-auto"]'))
      .filter(element => element.querySelector('[class*="sticky"]'));
    expect(nestedScrollers).toHaveLength(0);
  });

  it('表头 sticky top，表头的前两格 sticky left、底色不透明', () => {
    renderList();
    const header = screen.getByTestId('legs-header-row');
    expect(header.className).toContain('sticky');
    expect(header.className).toContain('top-0');
    expect(header.className).toContain('bg-card');
    const cells = Array.from(header.children);
    expect(cells[0]).toHaveTextContent('#');
    expect(cells[1]).toHaveTextContent('角色');
    expect(isSticky(cells[0])).toBe(true);
    expect(isSticky(cells[1])).toBe(true);
    expect(cells[0].className).toContain('left-0');
    // 压住「#」右缘 2px：两格之间没有接缝，非整数缩放下也不透字
    expect(cells[1].className).toContain('left-[46px]');
    // 表头层级高于数据行里的冻结格，竖向滚动时冻结格从表头底下经过
    expect(header.className).toContain('z-20');
    expect(cells[1].className).toContain('z-10');
    for (const cell of cells.slice(2)) expect(isSticky(cell)).toBe(false);
  });

  it('每条数据行的前两格冻结、拉满行高、不透明；其余格照常滚动', () => {
    renderList();
    for (const legId of ['leg-main', 'leg-hedge']) {
      const role = screen.getByTestId(`leg-frozen-role-${legId}`);
      const row = role.parentElement!;
      const cells = Array.from(row.children);
      expect(cells[1]).toBe(role);
      for (const cell of cells.slice(0, 2)) {
        expect(isSticky(cell)).toBe(true);
        expect(cell.className).toContain('self-stretch');
        expect(cell.className).toContain('bg-card');
      }
      for (const cell of cells.slice(2)) expect(isSticky(cell)).toBe(false);
    }
    // 序号与角色仍在冻结格里
    expect(within(screen.getByTestId('leg-frozen-role-leg-main').parentElement!.children[0] as HTMLElement).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByTestId('leg-frozen-role-leg-hedge')).getByText('回填')).toBeInTheDocument();
  });

  it('高亮行的冻结格叠上同一层蓝色，与整行同色', () => {
    renderList(['leg-hedge']);
    expect(screen.getByTestId('leg-frozen-role-leg-hedge').className).toContain('rgba(0,47,167,0.05)');
    expect(screen.getByTestId('leg-frozen-role-leg-main').className).not.toContain('rgba(0,47,167,0.05)');
  });

  it('合计行的前两格同样冻结', () => {
    renderList();
    const cells = Array.from(screen.getByTestId('legs-total-row').children);
    expect(isSticky(cells[0])).toBe(true);
    expect(isSticky(cells[1])).toBe(true);
    expect(cells[1]).toHaveTextContent('合计');
    for (const cell of cells.slice(2)) expect(isSticky(cell)).toBe(false);
  });

  it('滚出去之后才画出冻结列右缘的分隔线', () => {
    renderList();
    const scroller = screen.getByTestId('legs-scroll');
    expect(scroller.dataset.scrolled).toBeUndefined();
    scroller.scrollLeft = 120;
    fireEvent.scroll(scroller);
    expect(scroller.dataset.scrolled).toBe('true');
    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);
    expect(scroller.dataset.scrolled).toBe('false');
    expect(screen.getByTestId('leg-frozen-role-leg-main').className).toContain('group-data-[scrolled=true]/legs:border-border');
  });
});
