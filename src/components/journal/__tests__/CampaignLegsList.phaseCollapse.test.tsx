/**
 * 【用户要求】「我希望主力单下面的那个阶段可以做成折叠模式。」
 *
 * 主力行下方的「阶段 N」子行默认折叠：主力的角色格第一行、角色标签右边有一个小开关（箭头 + 阶段数），
 * 点开才渲染阶段子行，再点收起。展开状态按腿 id 各记各的，不持久化；折叠时阶段容器不渲染。
 * 【用户要求 · 续】第一列只要「角色」、简洁：开关与标签同在一行，不另占第二行。
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import type { TradeJournal } from '@/types/journal';

const at = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;

const legFor = (over: Partial<TradeJournal> & { id: string }): TradeJournal => ({
  user_id: 'u', trade_record_id: null, campaign_id: 'c', leg_role: 'main_open', leg_sequence: 1,
  source: 'retroactive_from_record', symbol: 'XUSDT', direction: 'long', leverage: 10, position_mode: 'isolated',
  order_kind: 'main', pre_simulated_time: at('01:00'),
  created_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z',
  ...over,
} as TradeJournal);

/** 两段主力（主力开仓、重新入场主力），各被一次滚动对冲切成两段；另有一笔加仓（不是主力，没有阶段）。 */
const legs = () => [
  legFor({
    id: 'main', pre_entry_price: 1, pre_position_size: 3_000,
    post_exit_price_snapshot: 1.2, post_simulated_close_time: at('05:00'), post_realized_pnl: 600,
  }),
  legFor({
    id: 'hedge-1', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
    pre_simulated_time: at('02:00'), pre_entry_price: 1.1, pre_position_size: 2_000,
    post_exit_price_snapshot: 1.05, post_simulated_close_time: at('03:00'), post_realized_pnl: 90,
  }),
  legFor({
    id: 'add1', leg_sequence: 3, leg_role: 'main_add_1', pre_simulated_time: at('03:30'),
    pre_entry_price: 1.1, pre_position_size: 1_100,
    post_exit_price_snapshot: 1.2, post_simulated_close_time: at('05:00'), post_realized_pnl: 100,
  }),
  legFor({
    id: 'reentry', leg_sequence: 4, leg_role: 'reentry_main', pre_simulated_time: at('06:00'),
    pre_entry_price: 1.2, pre_position_size: 2_400,
    post_exit_price_snapshot: 1.4, post_simulated_close_time: at('10:00'), post_realized_pnl: 400,
  }),
  legFor({
    id: 'hedge-2', leg_sequence: 5, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
    pre_simulated_time: at('07:00'), pre_entry_price: 1.3, pre_position_size: 1_300,
    post_exit_price_snapshot: 1.25, post_simulated_close_time: at('08:00'), post_realized_pnl: 50,
  }),
];

const renderList = () => render(
  <MemoryRouter>
    <CampaignLegsList legs={legs()} tradeRecords={[]} initialExpectedMaxLoss={1_000} />
  </MemoryRouter>,
);

const toggleOf = (id: string) => screen.getByTestId(`leg-phases-toggle-${id}`);

describe('【用户要求】主力阶段子行默认折叠', () => {
  it('默认折叠：阶段子行不渲染；主力的角色格里有阶段开关（看得见的只有箭头与阶段数），aria-expanded=false', () => {
    renderList();
    expect(screen.queryByTestId('leg-phases-main')).toBeNull();
    expect(screen.queryByTestId('leg-phases-reentry')).toBeNull();
    expect(screen.queryByText(/^阶段 \d/)).toBeNull();
    for (const id of ['main', 'reentry']) {
      const toggle = toggleOf(id);
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.getAttribute('type')).toBe('button');
      expect(toggle.textContent).toBe('2');
      // 读屏名与悬停说明写全：「展开 2 个阶段」
      expect(toggle.getAttribute('aria-label')).toBe('展开 2 个阶段');
      expect(toggle.getAttribute('title')).toBe('展开 2 个阶段');
      // title 与读屏名同一句：空的 aria-description 盖掉「title 兜底当描述」，读屏不重复念
      expect(toggle.getAttribute('aria-description')).toBe('');
      expect(screen.getAllByRole('button', { name: '展开 2 个阶段', expanded: false })).toContain(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBeTruthy();
      // 折叠时的图标朝右
      expect(toggle.querySelector('svg')!.getAttribute('class')).toContain('lucide-chevron-right');
      expect(toggle.querySelector('svg')!.getAttribute('class')).not.toContain('rotate-90');
      expect(toggle.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    }
    // 两个按钮控制的是两个不同的容器
    expect(toggleOf('main').getAttribute('aria-controls')).not.toBe(toggleOf('reentry').getAttribute('aria-controls'));
    // 不是主力、或没被切开的腿没有这个按钮
    for (const id of ['hedge-1', 'add1', 'hedge-2']) {
      expect(screen.queryByTestId(`leg-phases-toggle-${id}`)).toBeNull();
    }
  });

  it('开关在冻结的角色格第一行、角色标签右边：定宽、靠右并离右缘留一点，各行的开关在同一条竖线上；角色格只有这一行', () => {
    renderList();
    const role = screen.getByTestId('leg-frozen-role-main');
    expect(role.children).toHaveLength(1);
    const [line] = Array.from(role.children);
    expect(line.className).toBe('flex h-[13.75px] items-center gap-1');
    const [chip, toggle] = Array.from(line.children);
    expect(within(chip as HTMLElement).getByText('主力开仓')).toBeInTheDocument();
    expect(toggle).toBe(toggleOf('main'));
    // 定宽 + ml-auto：不论标签多长，开关的左缘都在同一处；mr-1：滚出去之后出现的右缘分隔线不压住悬停底色与焦点环
    expect(toggle.className.split(/\s+/)).toEqual(expect.arrayContaining(['ml-auto', 'mr-1', 'w-[28px]', 'shrink-0']));
    expect(toggleOf('reentry').className).toBe(toggle.className);
    // 小字、淡色、悬停变深；数字是给眼睛看的，读屏读 aria-label
    expect(toggle.className).toContain('text-[10px]');
    expect(toggle.className).toContain('text-muted-foreground');
    expect(toggle.className).toContain('hover:text-foreground');
    expect(toggle.lastElementChild!.getAttribute('aria-hidden')).toBe('true');
    // 没有阶段的腿，角色格里只有标签
    const add = screen.getByTestId('leg-frozen-role-add1');
    expect(add.children).toHaveLength(1);
    expect(add.firstElementChild!.children).toHaveLength(1);
    expect(add.querySelector('button')).toBeNull();
  });

  it('点开：阶段子行出现在主力行正下方，容器 id 与 aria-controls 对上；再点收起', () => {
    renderList();
    const toggle = toggleOf('main');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('收起 2 个阶段');
    expect(toggle.getAttribute('title')).toBe('收起 2 个阶段');
    expect(toggle.querySelector('svg')!.getAttribute('class')).toContain('rotate-90');
    const phases = screen.getByTestId('leg-phases-main');
    expect(phases.id).toBe(toggle.getAttribute('aria-controls'));
    expect(phases.previousElementSibling).toBe(screen.getByTestId('leg-frozen-role-main').parentElement);
    expect(Array.from(phases.children).map(row => row.children[0].textContent)).toEqual(['阶段 1', '阶段 2 · 收尾']);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('展开 2 个阶段');
    expect(screen.queryByTestId('leg-phases-main')).toBeNull();
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeNull();
  });

  it('展开状态按腿各记各的：展开主力开仓不会展开重新入场主力', () => {
    renderList();
    fireEvent.click(toggleOf('main'));
    expect(screen.getByTestId('leg-phases-main')).toBeInTheDocument();
    expect(screen.queryByTestId('leg-phases-reentry')).toBeNull();
    expect(toggleOf('reentry').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggleOf('reentry'));
    expect(screen.getByTestId('leg-phases-reentry')).toBeInTheDocument();
    fireEvent.click(toggleOf('main'));
    expect(screen.queryByTestId('leg-phases-main')).toBeNull();
    expect(screen.getByTestId('leg-phases-reentry')).toBeInTheDocument();
  });

  it('不持久化：重新挂载后回到折叠', () => {
    const first = renderList();
    fireEvent.click(toggleOf('main'));
    expect(screen.getByTestId('leg-phases-main')).toBeInTheDocument();
    first.unmount();
    renderList();
    expect(screen.queryByTestId('leg-phases-main')).toBeNull();
    expect(toggleOf('main').getAttribute('aria-expanded')).toBe('false');
  });

  it('折叠与否不改变合计：合计行的盈亏与 Δb 一样', () => {
    renderList();
    const before = screen.getByTestId('legs-total-row').textContent;
    fireEvent.click(toggleOf('main'));
    fireEvent.click(toggleOf('reentry'));
    expect(screen.getByTestId('legs-total-row').textContent).toBe(before);
  });
});
