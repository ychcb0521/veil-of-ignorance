/**
 * 【用户要求】Legs 表横向滚动时，第一列冻结在左缘。
 * 【用户要求 · 续】「第一列只需要“角色”，不需要数字和“回填”」：冻结的只剩「角色」这一列。
 *
 * jsdom 不做布局，这里钉住的是让 sticky 生效的结构条件：
 * - 横竖只有一个滚动容器（行外再套一层 overflow-y-auto，冻结列就钉在那层从不横滚的容器上而失效）；
 * - 表头 sticky top，冻结格 sticky left-0，且带不透明底色；
 * - 冻结格出现在表头、数据行、主力阶段子行、合计行四处，每一处都是第一格，也只有这一格。
 * 实际滚动效果在浏览器里核验过。
 * 阶段子行默认折叠（点主力角色标签右边的阶段开关展开），展开后同样冻结；「多单占比」的列头按钮不冻结。
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

function renderList(highlightedLegIds?: string[], { hedgeFirst = false }: { hedgeFirst?: boolean } = {}) {
  const t0 = Date.parse('2026-08-01T00:00:00.000Z');
  const hour = 3_600_000;
  const main = record('rec-main', t0, t0 + 10 * hour, 0.1, 0.12, 'LONG');
  const hedge = record('rec-hedge', t0 + 2 * hour, t0 + 4 * hour, 0.105, 0.1, 'SHORT');
  const legs = [
    leg('leg-main', 1, 'main_open', 'long', main),
    leg('leg-hedge', 2, 'hedge_rolling', 'short', hedge),
  ];
  if (hedgeFirst) legs.reverse();
  return render(
    <MemoryRouter>
      <CampaignLegsList legs={legs} tradeRecords={[main, hedge]} highlightedLegIds={highlightedLegIds} />
    </MemoryRouter>,
  );
}

const isSticky = (element: Element | null | undefined) => element?.className.split(/\s+/).includes('sticky') ?? false;

describe('【用户要求】Legs 表冻结「角色」一列', () => {
  it('表格纵向展开、只保留横向滚动；左边的滚动留白 = 冻结宽度', () => {
    renderList();
    const scroller = screen.getByTestId('legs-scroll');
    expect(scroller.className).toContain('overflow-x-auto');
    expect(scroller.className).not.toMatch(/max-h-/);
    // 保留表头 / 冻结列的键盘焦点留白，取消合计行的底部留白；
    // 冻结宽度 = 行左内边距 12px + 角色列 132px
    expect(scroller.className.split(/\s+/)).toEqual(expect.arrayContaining(['scroll-pt-8', 'scroll-pl-[144px]']));
    expect(scroller.className).not.toContain('scroll-pb-');
    // 钉住的块里自己的按钮用负的滚动外边距抵掉这截留白：键盘聚焦它们时表格不跟着乱滚
    expect(screen.getByTestId('leg-phases-toggle-leg-main').className.split(/\s+/)).toContain('-scroll-ml-[144px]');
    // 按 test id 取（角色 / 名字的查询在 shareSort 与 positionShare 里测），省掉整棵可访问树的计算——高负载下它会超时
    expect(screen.getByTestId('legs-share-sort-long').className.split(/\s+/)).toContain('-scroll-mt-8');
    expect(screen.queryByTestId('legs-share-sort-short')).toBeNull();
    // 容器里任何一层都不能再是滚动容器（每行「委托」格自己的小滚动区除外：它不包住冻结格）
    const nestedScrollers = Array.from(scroller.querySelectorAll('[class*="overflow-y-auto"], [class*="overflow-auto"], [class*="overflow-x-auto"]'))
      .filter(element => element.querySelector('[class*="sticky"]'));
    expect(nestedScrollers).toHaveLength(0);
  });

  it('表头 sticky top；只有第一格「角色」sticky left-0、底色不透明，没有「#」', () => {
    renderList();
    const header = screen.getByTestId('legs-header-row');
    expect(header.className).toContain('sticky');
    expect(header.className).toContain('top-0');
    expect(header.className).toContain('bg-card');
    const cells = Array.from(header.children);
    expect(cells[0]).toHaveTextContent(/^角色$/);
    expect(isSticky(cells[0])).toBe(true);
    expect(cells[0].className.split(/\s+/)).toEqual(expect.arrayContaining(['left-0', '-ml-3', 'pl-3', 'bg-card']));
    // 表头层级高于数据行里的冻结格，竖向滚动时冻结格从表头底下经过
    expect(header.className).toContain('z-20');
    expect(cells[0].className).toContain('z-10');
    for (const cell of cells.slice(1)) expect(isSticky(cell)).toBe(false);
    expect(cells.map(cell => cell.textContent)).not.toContain('#');
  });

  it('每条数据行只有第一格（角色）冻结、拉满行高、不透明；里面只有角色标签，没有序号和「回填」', () => {
    renderList();
    for (const legId of ['leg-main', 'leg-hedge']) {
      const role = screen.getByTestId(`leg-frozen-role-${legId}`);
      const row = role.parentElement!;
      const cells = Array.from(row.children);
      expect(cells[0]).toBe(role);
      expect(isSticky(role)).toBe(true);
      expect(role.className.split(/\s+/)).toEqual(expect.arrayContaining(['left-0', 'self-stretch', 'bg-card', '-my-2.5', 'py-2.5']));
      for (const cell of cells.slice(1)) expect(isSticky(cell)).toBe(false);
    }
    // 两条腿都是回填来的、都有序号：冻结格里一个数字、一个「回填」都没有
    expect(within(screen.getByTestId('leg-frozen-role-leg-hedge')).queryByText('回填')).toBeNull();
    expect(screen.getByTestId('leg-frozen-role-leg-hedge').textContent).toBe('滚动对冲');
    expect(screen.getByTestId('leg-frozen-role-leg-main').textContent).toMatch(/^主力开仓\d+$/);
    expect(screen.queryByText('回填')).toBeNull();
    // 腿行的第一格就是冻结格：序号不在任何一格里
    const mainRow = screen.getByTestId('leg-frozen-role-leg-main').parentElement!;
    expect(Array.from(mainRow.children).some(cell => cell.textContent === '1')).toBe(false);
  });

  it('主力阶段子行（展开后）只有第一格冻结、拉满行高、不透明，按阶段子行的内边距伸出；阶段开关在冻结的角色格里', () => {
    renderList();
    const toggle = screen.getByTestId('leg-phases-toggle-leg-main');
    expect(screen.getByTestId('leg-frozen-role-leg-main').contains(toggle)).toBe(true);
    expect(screen.queryByTestId('leg-phases-leg-main')).toBeNull();
    fireEvent.click(toggle);
    const phaseRows = Array.from(screen.getByTestId('leg-phases-leg-main').children);
    expect(phaseRows.length).toBeGreaterThanOrEqual(2);
    const count = screen.getByTestId('legs-header-row').children.length;
    expect(count).toBe(13);
    for (const row of phaseRows) {
      const cells = Array.from(row.children);
      expect(cells).toHaveLength(count);
      expect(isSticky(cells[0])).toBe(true);
      expect(cells[0].className).toContain('self-stretch');
      expect(cells[0].className).toContain('bg-card');
      expect(cells[0].className).toContain('left-0');
      // 阶段子行是 py-1：冻结格伸出同样的量，与上下相邻的冻结格首尾相接
      expect(cells[0].className.split(/\s+/)).toEqual(expect.arrayContaining(['-my-1', 'py-1']));
      expect(cells[0].textContent).toMatch(/^阶段 \d/);
      for (const cell of cells.slice(1)) expect(isSticky(cell)).toBe(false);
    }
  });

  it('「多单占比」的列头是普通（不冻结）的格子，排序后第一格仍是每行的冻结格', () => {
    // 空单对冲排在前面：按多单占比排序会把主力挪到第一行
    renderList(undefined, { hedgeFirst: true });
    const header = screen.getByTestId('legs-header-row');
    const buttons = Array.from(header.querySelectorAll('button'));
    expect(buttons).toHaveLength(1);
    for (const button of buttons) {
      expect(isSticky(button)).toBe(false);
      expect(Array.from(header.children).indexOf(button)).toBeGreaterThan(0);
    }
    expect(screen.getAllByTestId(/^leg-frozen-role-/)[0]).toBe(screen.getByTestId('leg-frozen-role-leg-hedge'));
    fireEvent.click(screen.getByRole('button', { name: /^按多单占比排序/ }));
    const firstRole = screen.getAllByTestId(/^leg-frozen-role-/)[0];
    expect(firstRole).toBe(screen.getByTestId('leg-frozen-role-leg-main'));
    const cells = Array.from(firstRole.parentElement!.children);
    expect(cells[0]).toBe(firstRole);
    expect(cells.filter(isSticky)).toEqual([firstRole]);
  });

  it('高亮行的冻结格叠上同一层蓝色，并补画蓝框的左、上、下三道，与整行同色', () => {
    renderList(['leg-hedge']);
    const hedge = screen.getByTestId('leg-frozen-role-leg-hedge').className;
    expect(hedge).toContain('rgba(0,47,167,0.05)');
    expect(hedge).toContain('shadow-[inset_1px_0_0_rgba(59,130,246,0.5),inset_0_1px_0_rgba(59,130,246,0.5),inset_0_-1px_0_rgba(59,130,246,0.5)]');
    const main = screen.getByTestId('leg-frozen-role-leg-main').className;
    expect(main).not.toContain('rgba(0,47,167,0.05)');
    expect(main).not.toContain('shadow-[inset');
  });

  it('合计行只有第一格（「合计」）冻结', () => {
    renderList();
    const cells = Array.from(screen.getByTestId('legs-total-row').children);
    expect(isSticky(cells[0])).toBe(true);
    expect(cells[0]).toHaveTextContent(/^合计$/);
    expect(cells[0].className).toContain('left-0');
    for (const cell of cells.slice(1)) expect(isSticky(cell)).toBe(false);
  });

  it('滚出去之后才画出冻结列右缘的分隔线与阴影；行底分隔线叠在冻结格之上', () => {
    renderList();
    const scroller = screen.getByTestId('legs-scroll');
    expect(scroller.dataset.scrolled).toBeUndefined();
    scroller.scrollLeft = 120;
    fireEvent.scroll(scroller);
    expect(scroller.dataset.scrolled).toBe('true');
    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);
    expect(scroller.dataset.scrolled).toBe('false');
    const role = screen.getByTestId('leg-frozen-role-leg-main');
    // 分隔线（before）与阴影（after）都是伪元素，平时透明，滚出去之后才显出来；格子本身不带右边框
    expect(role.className).toContain('before:bg-border');
    expect(role.className).toContain('before:opacity-0');
    expect(role.className).toContain('group-data-[scrolled=true]/legs:before:opacity-100');
    expect(role.className).toContain('group-data-[scrolled=true]/legs:after:opacity-100');
    expect(role.className).not.toContain('border-r');
    // 腿行底下还有 1px 的行分隔线（透明边框）：不透明的分隔线上下各多伸 2px（与相邻格重叠处看不出来），
    // 半透明的阴影只往下伸 1px，交叉处都不断开
    expect(role.className.split(/\s+/)).toEqual(expect.arrayContaining(['before:-inset-y-0.5', 'after:top-0', 'after:-bottom-px']));
    const headerRole = screen.getByTestId('legs-header-row').children[0];
    const totalRole = screen.getByTestId('legs-total-row').children[0];
    for (const cell of [headerRole, totalRole]) {
      expect(cell.className.split(/\s+/)).toEqual(expect.arrayContaining(['before:-inset-y-0.5', 'after:bottom-0']));
      expect(cell.className).not.toContain('after:-bottom-px');
    }
    // 合计行是滚动区里最后一格：分隔线不许伸出它的下沿，否则多出的 2px 算进可滚动溢出，每张表都能被竖向滚 2px
    expect(totalRole.className.split(/\s+/)).toContain('before:bottom-0');
    expect(headerRole.className.split(/\s+/)).not.toContain('before:bottom-0');
    expect(role.className.split(/\s+/)).not.toContain('before:bottom-0');
    // 行底分隔线：边框透明、线画在伪元素上，层级（z-[11]）高于冻结格（z-10）、低于表头与合计行（z-20）
    const row = role.parentElement!;
    expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(['relative', 'border-b', 'border-transparent', 'after:z-[11]', 'after:bg-border/40']));
    fireEvent.click(screen.getByTestId('leg-phases-toggle-leg-main'));
    const phases = screen.getByTestId('leg-phases-leg-main');
    expect(phases.className).toContain('after:z-[11]');
    // 阶段块：只有最后一行底下是行分隔线，只有它的阴影往下伸；中间几行不伸——阴影半透明，重叠的那一像素会深一档
    const phaseRoles = Array.from(phases.children).map(phaseRow => phaseRow.children[0].className.split(/\s+/));
    expect(phaseRoles.length).toBeGreaterThanOrEqual(2);
    for (const classes of phaseRoles.slice(0, -1)) {
      expect(classes).toContain('after:bottom-0');
      expect(classes).not.toContain('after:-bottom-px');
    }
    expect(phaseRoles.at(-1)).toContain('after:-bottom-px');
  });
});
