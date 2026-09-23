/**
 * 【用户要求】「第一列只需要“角色”，不需要数字和“回填”。要简洁明了，要按照最高级别的美化标准。」
 *
 * - 第一列只剩一枚角色标签：不印腿的序号，不挂灰色「回填」（历史回填只写进标签的悬停说明）；
 * - 「挂单中 / 进行中」不再是两枚文字标签，而是角色标签本身的样子：挂单中 = 同色虚线空心，进行中 = 标签里一枚实心小圆点，
 *   两种都有悬停说明，读屏仍念得出状态；
 * - 状态与「多单占比」、合计行 Σ 排除挂单中的腿读的是同一条规则（legRowStatus）。
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import { LegRoleChip } from '@/components/journal/LegRoleChip';
import { LEG_ROLE_MIRROR_TEXT_ON_LIGHT, LEG_ROLE_NEUTRAL_COLOR, LEG_ROLE_TONE_COLORS, legRoleExportTextColor } from '@/lib/legRoleTone';
import type { LegRole, TradeJournal } from '@/types/journal';

const at = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;

const legFor = (over: Partial<TradeJournal> & { id: string }): TradeJournal => ({
  user_id: 'u', trade_record_id: null, campaign_id: 'c', leg_role: 'main_open', leg_sequence: 7,
  source: 'retroactive_from_record', symbol: 'XUSDT', direction: 'long', leverage: 10, position_mode: 'isolated',
  order_kind: 'main', pre_simulated_time: at('01:00'),
  created_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z',
  ...over,
} as TradeJournal);

const legs = () => [
  // 已平仓、回填
  legFor({ id: 'main', pre_entry_price: 1, pre_position_size: 1_000, post_exit_price_snapshot: 1.2, post_simulated_close_time: at('09:00') }),
  // 已平仓、实时记录
  legFor({
    id: 'mirror', leg_sequence: 8, leg_role: 'mirror_tp', source: 'live', pre_entry_price: 1, pre_position_size: 1_000,
    post_exit_price_snapshot: 1.1, post_simulated_close_time: at('04:00'),
  }),
  // 挂单中、实时记录
  legFor({
    id: 'pending', leg_sequence: 9, leg_role: 'hedge_initial_b', order_kind: 'hedge', direction: 'short', source: 'live',
    pre_simulated_time: at('02:00'), pre_entry_price: 0.9, pre_position_size: 500,
  }),
  // 进行中、回填
  legFor({ id: 'open', leg_sequence: 10, leg_role: 'reentry_main', pre_simulated_time: at('10:00'), pre_entry_price: 1.3, pre_position_size: 900 }),
  // 没有角色、已平仓
  legFor({ id: 'unclassified', leg_sequence: 11, leg_role: null, source: 'live', post_simulated_close_time: at('06:00') }),
  // 没有角色、进行中（没有仓位数据，不影响占比）
  legFor({ id: 'unclassified-open', leg_sequence: 12, leg_role: null, source: 'live', pre_simulated_time: at('11:00') }),
];

const renderList = () => render(
  <MemoryRouter>
    <CampaignLegsList legs={legs()} tradeRecords={[]} initialExpectedMaxLoss={1_000} />
  </MemoryRouter>,
);

const roleCell = (id: string) => screen.getByTestId(`leg-frozen-role-${id}`);
const chipOf = (id: string) => roleCell(id).querySelector<HTMLElement>('[data-role-chip]')!;
const classes = (el: Element) => el.className.split(/\s+/);

describe('【用户要求】Legs 表第一列只有「角色」', () => {
  it('表头第一格是「角色」，没有「#」；各行的第一格只有一枚角色标签——没有序号、没有「回填」', () => {
    renderList();
    const header = Array.from(screen.getByTestId('legs-header-row').children);
    expect(header[0].textContent).toBe('角色');
    expect(header.map(cell => cell.textContent)).not.toContain('#');
    expect(screen.queryByText('回填')).toBeNull();
    for (const id of ['main', 'mirror', 'pending', 'open', 'unclassified', 'unclassified-open']) {
      const cell = roleCell(id);
      expect(cell.parentElement!.children[0]).toBe(cell);
      expect(cell.querySelectorAll('[data-role-chip]')).toHaveLength(1);
      // 序号（7–12）不出现在这一行的任何一格里
      for (const other of Array.from(cell.parentElement!.children)) expect(other.textContent).not.toMatch(/^(7|8|9|10|11|12)$/);
    }
    expect(roleCell('main').textContent).toBe('主力开仓');
    expect(roleCell('mirror').textContent).toBe('镜像止盈');
    expect(roleCell('unclassified').textContent).toBe('—');
  });

  it('已平仓：常规的实心淡底标签，不带状态；回填的只在悬停说明里交代来源，实时记录的没有悬停说明', () => {
    renderList();
    const main = chipOf('main');
    expect(main.dataset.roleChip).toBe('main_open');
    expect(main.dataset.status).toBeUndefined();
    expect(classes(main)).toEqual(expect.arrayContaining(['bg-[#0ECB81]/10', 'text-[#0ECB81]', 'px-2', 'py-0.5']));
    expect(main.className).not.toContain('border-dashed');
    expect(main.querySelector('.sr-only')).toBeNull();
    expect(main.querySelector('[data-status-dot]')).toBeNull();
    expect(main.getAttribute('title')).toBe('历史回填：这条腿是事后按成交记录补建的');
    expect(chipOf('mirror').getAttribute('title')).toBeNull();
  });

  it('挂单中：同色虚线空心、字色淡一档，外框与实心标签一样大；悬停说明与读屏都写明「挂单中」', () => {
    renderList();
    const chip = chipOf('pending');
    expect(chip.dataset.status).toBe('pending');
    expect(classes(chip)).toEqual(expect.arrayContaining([
      'border', 'border-dashed', 'bg-transparent', 'border-[#2B80FF]/70', 'text-[#2B80FF]/80',
      // 浅色主题里字不淡：品牌色在白底上本来就只有 2～3:1
      '[.light_&]:text-[#2B80FF]',
      // 1px 虚线从内边距里扣回来：px-2 → px-[7px]，py-0.5 → py-px
      'px-[7px]', 'py-px',
    ]));
    expect(chip.className).not.toContain('bg-[#2B80FF]/10');
    expect(chip.getAttribute('title')).toBe('挂单中：还没有成交（委托仍挂着、已撤单，或这条腿没有任何成交凭据），不计入多单 / 空单合计');
    const sr = within(chip).getByText('挂单中');
    expect(sr.className).toBe('sr-only');
    expect(chip.querySelector('[data-status-dot]')).toBeNull();
    // 同一条规则：挂单中的腿不进合计——它是这场唯一的空单，合计行就不列空单那组 Σ；空单也没有占比格
    expect(screen.queryByTestId('legs-total-position-short')).toBeNull();
    expect(screen.getByTestId('legs-total-position-long')).toBeTruthy();
    expect(screen.queryByTestId('leg-position-share-pending')).toBeNull();
  });

  it('进行中：实心标签里、文字后面一枚同色小圆点；悬停说明与读屏都写明「进行中」，回填的再补一句来源', () => {
    renderList();
    const chip = chipOf('open');
    expect(chip.dataset.status).toBe('open');
    expect(classes(chip)).toEqual(expect.arrayContaining(['bg-[#B080FF]/10', 'text-[#B080FF]', 'px-2', 'py-0.5']));
    const dot = chip.querySelector('[data-status-dot]')!;
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(classes(dot)).toEqual(expect.arrayContaining(['h-1.5', 'w-1.5', 'rounded-full', 'bg-[#B080FF]']));
    expect(chip.getAttribute('title')).toBe('进行中：还没有平仓\n历史回填：这条腿是事后按成交记录补建的');
    expect(within(chip).getByText('进行中').className).toBe('sr-only');
    // 进行中的腿照常计入占比：多单币量 1,000 + 1,000 + 692.31 → 25.7%；名义 1,000 + 1,000 + 900 → 31.0%
    expect(Array.from(screen.getByTestId('leg-position-share-open').children).map(line => line.textContent)).toEqual(['25.7%', '31.0%']);
  });

  it('没有角色的腿：一枚中性灰标签写「—」，悬停说明它还没有归类；进行中照样带圆点、读屏念得出状态', () => {
    renderList();
    const closed = chipOf('unclassified');
    expect(closed.dataset.roleChip).toBe('none');
    expect(closed.textContent).toBe('—');
    expect(closed.dataset.status).toBeUndefined();
    expect(classes(closed)).toEqual(expect.arrayContaining(['bg-muted', 'text-muted-foreground', 'px-2', 'py-0.5']));
    expect(closed.querySelector('[data-status-dot]')).toBeNull();
    expect(closed.getAttribute('title')).toBe('没有角色：这条腿还没有归类');

    const open = chipOf('unclassified-open');
    expect(open.dataset.status).toBe('open');
    expect(classes(open)).toEqual(expect.arrayContaining(['bg-muted', 'text-muted-foreground']));
    expect(classes(open.querySelector('[data-status-dot]')!)).toEqual(expect.arrayContaining(['h-1.5', 'w-1.5', 'rounded-full', 'bg-muted-foreground']));
    expect(within(open).getByText('进行中').className).toBe('sr-only');
    expect(open.getAttribute('title')).toBe('没有角色：这条腿还没有归类\n进行中：还没有平仓');
    // 圆点是看得见的状态，读屏另有文字；格子里看得见的字仍只是「—」
    expect(roleCell('unclassified-open').textContent).toBe('—进行中');
  });

  it('标签统一尺寸、不折行，与时间列第一行同高的那一行里竖直居中', () => {
    renderList();
    for (const id of ['main', 'mirror', 'pending', 'open', 'unclassified', 'unclassified-open']) {
      const chip = chipOf(id);
      expect(classes(chip)).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap', 'font-sans', 'leading-[14px]', 'rounded', 'text-[10px]']));
      expect(chip.parentElement!.className).toBe('flex h-[13.75px] items-center gap-1');
    }
    // 时间列第一行：11px 字 × leading-tight = 13.75px，与角色那一行同高
    const time = roleCell('main').parentElement!.children[1];
    expect(time.className).toContain('leading-tight');
    expect(roleCell('main').parentElement!.className).toContain('text-[11px]');
  });
});

describe('LegRoleChip 与导出 PNG 同一组角色色', () => {
  const ROLES = Object.keys(LEG_ROLE_TONE_COLORS) as LegRole[];

  it('每个角色的实心、空心、圆点三种样子都用 LEG_ROLE_TONE_COLORS 里的那个颜色（独立单是中性灰）', () => {
    for (const role of ROLES) {
      const { unmount } = render(
        <>
          <LegRoleChip role={role} />
          <LegRoleChip role={role} status="pending" />
          <LegRoleChip role={role} status="open" />
        </>,
      );
      const [solid, hollow, open] = Array.from(document.querySelectorAll<HTMLElement>(`[data-role-chip="${role}"]`));
      const hex = LEG_ROLE_TONE_COLORS[role];
      if (role === 'standalone') {
        expect(hex).toBe(LEG_ROLE_NEUTRAL_COLOR);
        expect(hex).toBe('#848E9C');
        expect(classes(solid)).toEqual(expect.arrayContaining(['bg-muted', 'text-muted-foreground']));
        expect(classes(hollow)).toEqual(expect.arrayContaining(['border-muted-foreground/60', 'text-muted-foreground/80', '[.light_&]:text-muted-foreground']));
        expect(classes(open.querySelector('[data-status-dot]')!)).toContain('bg-muted-foreground');
      } else {
        expect(classes(solid)).toEqual(expect.arrayContaining([`bg-[${hex}]/10`, `text-[${hex}]`]));
        expect(classes(hollow)).toEqual(expect.arrayContaining([`border-[${hex}]/70`, `text-[${hex}]/80`]));
        expect(classes(open.querySelector('[data-status-dot]')!)).toContain(`bg-[${hex}]`);
        // 浅色主题（白底）的字色与导出 PNG 同一个：空心标签不淡；镜像止盈实心、空心都压深
        const onLight = `[.light_&]:text-[${legRoleExportTextColor(role)}]`;
        expect(classes(hollow)).toContain(onLight);
        if (role === 'mirror_tp') {
          expect(legRoleExportTextColor(role)).toBe(LEG_ROLE_MIRROR_TEXT_ON_LIGHT);
          expect(classes(solid)).toContain(onLight);
        } else {
          expect(legRoleExportTextColor(role)).toBe(hex);
          expect(solid.className).not.toContain('[.light_&]');
        }
      }
      unmount();
    }
    // 没有角色：与独立单同一组中性灰
    expect(legRoleExportTextColor(null)).toBe(LEG_ROLE_NEUTRAL_COLOR);
  });

  it('不传状态时与原来一样：没有读屏状态、没有圆点、没有虚线（别处的用法不受影响）', () => {
    render(<LegRoleChip role="hedge_rolling" short ordinal={2} />);
    const chip = document.querySelector<HTMLElement>('[data-role-chip]')!;
    expect(chip.textContent).toBe('R2');
    expect(chip.className).toBe('inline-flex items-center rounded text-[10px] px-2 py-0.5 bg-[#5BA3FF]/10 text-[#5BA3FF]');
    expect(chip.getAttribute('title')).toBeNull();
  });
});
