/**
 * 【用户要求】「仓位占比分成两列呈现，多和空分成两列。并且还要做成能够点击之后排序的」
 * 【用户要求 · 续】「空单仓位的占比也不需要，没必要存在」：只剩「多单占比」一列可排。
 *
 * 「多单占比」列头是原生按钮：点一下降序、再点升序、第三下回到默认顺序（腿传进来时的先后）。
 * 这一列没有数的行（空单、挂单中的腿、两行都是「—」的腿）不论升降序都沉到最下面，彼此仍按原来的先后。
 * 主力的阶段子行跟着主力走，合计行始终在最后；高亮、加仓校验等按腿 id 取的东西不受排序影响。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
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

/**
 * 主多战役：主力被两次对冲结束切成三段；两笔加仓；一条挂单中的对冲；一条没有仓位数据的加仓。
 * 多单币量：主力 3,000、加仓1 1,250、加仓2 4,000（合计 8,250 → 36.4% / 15.2% / 48.5%）；
 * 空单（对冲 A 1,818.18、对冲 B 400）没有占比，只进合计行的空单 Σ。
 */
const campaignLegs = () => [
  legFor({
    id: 'main', pre_entry_price: 1, pre_position_size: 3_000,
    post_exit_price_snapshot: 1.2, post_simulated_close_time: at('09:00'), post_realized_pnl: 600,
  }),
  legFor({
    id: 'hedge-a', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
    pre_simulated_time: at('03:00'), pre_entry_price: 1.1, pre_position_size: 2_000,
    post_exit_price_snapshot: 1.05, post_simulated_close_time: at('04:00'), post_realized_pnl: 90,
  }),
  legFor({
    id: 'add1', leg_sequence: 3, leg_role: 'main_add_1', pre_simulated_time: at('04:30'),
    pre_entry_price: 1.2, pre_position_size: 1_500,
    post_exit_price_snapshot: 1.3, post_simulated_close_time: at('09:00'), post_realized_pnl: 125,
  }),
  legFor({
    id: 'hedge-b', leg_sequence: 4, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
    pre_simulated_time: at('05:00'), pre_entry_price: 1.25, pre_position_size: 500,
    post_exit_price_snapshot: 1.2, post_simulated_close_time: at('06:00'), post_realized_pnl: 20,
  }),
  legFor({
    id: 'pending', leg_sequence: 5, leg_role: 'hedge_initial_b', order_kind: 'hedge', direction: 'short',
    pre_simulated_time: at('06:30'), pre_entry_price: 1.3, pre_position_size: 800,
  }),
  legFor({
    id: 'add2', leg_sequence: 6, leg_role: 'main_add_2', pre_simulated_time: at('07:00'),
    pre_entry_price: 1.25, pre_position_size: 5_000,
    post_exit_price_snapshot: 1.3, post_simulated_close_time: at('09:00'), post_realized_pnl: 200,
  }),
  legFor({
    id: 'add3', leg_sequence: 7, leg_role: 'main_add_3', pre_simulated_time: at('08:00'),
    pre_entry_price: 1.3, pre_position_size: undefined,
    post_exit_price_snapshot: 1.3, post_simulated_close_time: at('09:00'),
  }),
];
const DEFAULT_ORDER = ['main', 'hedge-a', 'add1', 'hedge-b', 'pending', 'add2', 'add3'];

const renderList = (props: Partial<Parameters<typeof CampaignLegsList>[0]> = {}) => render(
  <MemoryRouter>
    <CampaignLegsList legs={campaignLegs()} tradeRecords={[]} initialExpectedMaxLoss={1_000} {...props} />
  </MemoryRouter>,
);

const sortButton = () => screen.getByRole('button', { name: /^按多单占比排序：/ });
/** 表里各腿的先后：按角色冻结格在 DOM 里的顺序读。 */
const renderedOrder = () => screen.getAllByTestId(/^leg-frozen-role-/)
  .map(el => el.getAttribute('data-testid')!.replace('leg-frozen-role-', ''));
const rowOf = (id: string) => screen.getByTestId(`leg-frozen-role-${id}`).parentElement!;
const iconOf = (button: HTMLElement) => button.querySelector('svg')!.getAttribute('class') ?? '';

describe('【用户要求】点击「多单占比」列头排序', () => {
  it('默认顺序就是传进来的先后；列头是原生按钮，图标是淡色的上下箭头；没有「空单占比」的排序按钮', () => {
    renderList();
    expect(renderedOrder()).toEqual(DEFAULT_ORDER);
    expect(screen.getAllByRole('button', { name: /^按.+排序：/ })).toEqual([sortButton()]);
    expect(screen.queryByTestId('legs-share-sort-short')).toBeNull();
    const button = sortButton();
    expect(button).toBe(screen.getByTestId('legs-share-sort-long'));
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('按多单占比排序：当前默认顺序，点击改为降序');
    // 【用户要求】列头不弹黑底悬停说明：没有 title
    expect(button.hasAttribute('title')).toBe(false);
    // 读屏的描述只给列说明，排序状态只在读屏名里念一遍
    const description = button.getAttribute('aria-description')!;
    expect(description).toContain('点击列头按本列排序');
    expect(description).not.toContain('当前');
    expect(iconOf(button)).toContain('lucide-arrow-up-down');
    expect(iconOf(button)).toContain('text-muted-foreground/50');
    expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    // 不是 columnheader，不用 aria-sort
    expect(button.hasAttribute('aria-sort')).toBe(false);
  });

  it('点「多单占比」：降序 → 升序 → 默认顺序；没有多单占比的行（空单、挂单中、没有仓位数据的腿）始终按原先后沉底', () => {
    renderList();
    const button = sortButton();

    fireEvent.click(button);
    expect(renderedOrder()).toEqual(['add2', 'main', 'add1', 'hedge-a', 'hedge-b', 'pending', 'add3']);
    expect(button.getAttribute('aria-label')).toBe('按多单占比排序：当前降序，点击改为升序');
    expect(iconOf(button)).toContain('lucide-arrow-down');
    expect(iconOf(button)).not.toContain('text-muted-foreground/50');

    fireEvent.click(button);
    expect(renderedOrder()).toEqual(['add1', 'main', 'add2', 'hedge-a', 'hedge-b', 'pending', 'add3']);
    expect(button.getAttribute('aria-label')).toBe('按多单占比排序：当前升序，点击恢复默认顺序');
    expect(iconOf(button)).toContain('lucide-arrow-up');
    expect(iconOf(button)).not.toContain('lucide-arrow-up-down');

    fireEvent.click(button);
    expect(renderedOrder()).toEqual(DEFAULT_ORDER);
    expect(button.getAttribute('aria-label')).toBe('按多单占比排序：当前默认顺序，点击改为降序');
    expect(iconOf(button)).toContain('lucide-arrow-up-down');
  });

  it('【用户要求】空单不能单独排序：两条已计入的空单与挂单中的空单在升降序里都按原先后沉底，读屏名里从不出现空单', () => {
    renderList();
    const button = sortButton();
    const labels: string[] = [button.getAttribute('aria-label')!];
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(button);
      labels.push(button.getAttribute('aria-label')!);
      const order = renderedOrder();
      if (i % 3 === 2) {
        expect(order).toEqual(DEFAULT_ORDER);
      } else {
        // 空单（含挂单中的）之间不按空单合计里的份额重排（对冲 A 82.0% / 对冲 B 18.0% 时，升序也不会把 B 提到 A 前面）
        expect(order.slice(3)).toEqual(['hedge-a', 'hedge-b', 'pending', 'add3']);
      }
    }
    for (const label of labels) expect(label).not.toContain('空单');
  });

  it('主力的阶段子行跟着主力走；合计行始终是滚动区里的最后一行', () => {
    renderList();
    fireEvent.click(screen.getByTestId('leg-phases-toggle-main'));
    const phases = screen.getByTestId('leg-phases-main');
    expect(phases.children).toHaveLength(5);
    fireEvent.click(sortButton());
    // 主力排到第二：阶段子行紧贴在主力行下面，下一条腿（加仓1）在阶段子行之后
    expect(renderedOrder().indexOf('main')).toBe(1);
    expect(screen.getByTestId('leg-phases-main').previousElementSibling).toBe(rowOf('main'));
    const mainWrapper = rowOf('main').parentElement!;
    expect(mainWrapper.nextElementSibling).toBe(rowOf('add1').parentElement);
    expect(mainWrapper.previousElementSibling).toBe(rowOf('add2').parentElement);
    // 展开状态按腿 id 记，排序后仍展开
    expect(screen.getByTestId('leg-phases-toggle-main').getAttribute('aria-expanded')).toBe('true');
    const scroller = screen.getByTestId('legs-scroll');
    const total = screen.getByTestId('legs-total-row');
    // 升序 → 默认顺序 → 降序：每一种顺序下合计行都是最后一行
    for (const clicks of [1, 1, 1]) {
      for (let i = 0; i < clicks; i += 1) fireEvent.click(sortButton());
      const all = Array.from(scroller.querySelectorAll('*'));
      expect(all.slice(all.indexOf(total) + 1).every(el => total.contains(el))).toBe(true);
      expect(total.previousElementSibling).toBe(rowOf(renderedOrder().at(-1)!).parentElement);
    }
  });

  it('高亮、加仓校验、操作按钮都跟着自己的腿走（按 id 取，不按行号取）', () => {
    const onToggleHighlight = vi.fn();
    renderList({ highlightedLegIds: ['add1'], onToggleHighlight });
    fireEvent.click(sortButton());
    fireEvent.click(sortButton());
    expect(renderedOrder()[0]).toBe('add1');
    const highlighted = (id: string) => screen.getByTestId(`leg-frozen-role-${id}`).className.includes('rgba(0,47,167,0.05)');
    expect(highlighted('add1')).toBe(true);
    expect(DEFAULT_ORDER.filter(highlighted)).toEqual(['add1']);
    // 加仓校验的记号仍在自己那一行里
    const verdicts = screen.queryAllByTestId(/^add-sizing-check-(ok|fail|unknown)-/);
    expect(verdicts.length).toBeGreaterThan(0);
    for (const mark of verdicts) {
      const id = mark.getAttribute('data-testid')!.replace(/^add-sizing-check-(ok|fail|unknown)-/, '');
      expect(rowOf(id).contains(mark)).toBe(true);
    }
    // 第一行的「标到盘面」点的是加仓1 这条腿
    fireEvent.click(rowOf('add1').querySelector('button[aria-pressed]')!);
    expect(onToggleHighlight).toHaveBeenCalledTimes(1);
    expect(onToggleHighlight.mock.calls[0][0].id).toBe('add1');
  });

  it('换了排序就回到表体顶端（横向位置不动），排在最前的行直接看得见', () => {
    renderList();
    const scroller = screen.getByTestId('legs-scroll');
    // 降序 → 升序 → 默认顺序 → 降序：回到默认顺序那一下也归零
    for (let i = 0; i < 4; i += 1) {
      scroller.scrollTop = 300;
      scroller.scrollLeft = 120;
      fireEvent.click(sortButton());
      expect(scroller.scrollTop).toBe(0);
      expect(scroller.scrollLeft).toBe(120);
    }
  });

  it('等额不同价的多单算并列：币量的浮点尾差不打乱原来的先后', () => {
    // 1,300 ÷ 1.3、1,100 ÷ 1.1、700 ÷ 0.7：原值是 1000、999.9999999999999、1000.0000000000001，页面都印 1,000 / 33.3%
    const add = (id: string, sequence: number, notional: number, price: number) => legFor({
      id, leg_sequence: sequence, leg_role: `main_add_${sequence - 1}` as TradeJournal['leg_role'],
      pre_simulated_time: at(`0${sequence}:00`), pre_entry_price: price, pre_position_size: notional,
      post_exit_price_snapshot: price * 1.02, post_simulated_close_time: at('09:00'),
    });
    renderList({
      legs: [
        legFor({
          id: 'hedge', leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short', pre_entry_price: 1,
          pre_position_size: 3_000, post_exit_price_snapshot: 0.98, post_simulated_close_time: at('01:30'),
        }),
        add('a1', 2, 1_300, 1.3),
        add('a2', 3, 1_100, 1.1),
        add('a3', 4, 700, 0.7),
      ],
    });
    for (const id of ['a1', 'a2', 'a3']) {
      expect(screen.getByTestId(`leg-position-share-${id}`).firstElementChild!.textContent).toBe('33.3%');
    }
    fireEvent.click(sortButton());
    expect(renderedOrder()).toEqual(['a1', 'a2', 'a3', 'hedge']);
    fireEvent.click(sortButton());
    expect(renderedOrder()).toEqual(['a1', 'a2', 'a3', 'hedge']);
  });

  it('腿换了（同一个组件收到新的 legs）时，排序照当前那一列重排', () => {
    const { rerender } = renderList();
    fireEvent.click(sortButton());
    const legs = campaignLegs().map(leg => (leg.id === 'add1' ? { ...leg, pre_position_size: 50_000 } : leg));
    rerender(
      <MemoryRouter>
        <CampaignLegsList legs={legs} tradeRecords={[]} initialExpectedMaxLoss={1_000} />
      </MemoryRouter>,
    );
    expect(renderedOrder().slice(0, 3)).toEqual(['add1', 'add2', 'main']);
  });
});
