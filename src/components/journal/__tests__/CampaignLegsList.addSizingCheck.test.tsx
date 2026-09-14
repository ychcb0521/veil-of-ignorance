import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder } from '@/types/trading';

/**
 * 【用户要求】Legs 增加「加仓校验」列：合规用几乎隐形的对号，
 * 仓位过大用很明显的红色、放大的叉。
 */
const legFor = (over: Partial<TradeJournal> & { id: string }): TradeJournal => ({
  user_id: 'u', trade_record_id: null, campaign_id: 'c', leg_role: 'main_open', leg_sequence: 1,
  source: 'retroactive_from_record', symbol: 'TUTUSDT', direction: 'long', leverage: 10, position_mode: 'isolated',
  order_kind: 'main', pre_simulated_time: '2026-08-07T19:41:00+08:00',
  created_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z',
  ...over,
} as TradeJournal);

// TUTUSDT 2026-08-08：主力 94,300 @0.0336792；镜像 00:36 落袋 15,117.55；加仓1 2,205 万 @0.0419705
const legs = (addNotional: number) => [
  legFor({
    id: 'main', leg_sequence: 1, pre_entry_price: 0.0336792, pre_position_size: 94_300,
    post_simulated_close_time: '2026-08-09T01:46:00+08:00', post_exit_price_snapshot: 0.0677819,
  }),
  legFor({
    id: 'mirror', leg_sequence: 2, leg_role: 'mirror_tp', pre_entry_price: 0.0336792,
    pre_position_size: 141_460, post_simulated_close_time: '2026-08-08T00:36:00+08:00', post_realized_pnl: 15_117.55,
  }),
  legFor({
    id: 'add1', leg_sequence: 3, leg_role: 'main_add_1', pre_simulated_time: '2026-08-08T12:02:00+08:00',
    pre_entry_price: 0.0419705, pre_position_size: addNotional,
  }),
];
const orders: CampaignReverseHedgeOrder[] = [{
  id: 'stop', side: 'SHORT', price: 0.034726, status: 'cancelled',
  createdAt: Date.parse('2026-08-08T12:01:00+08:00'), triggeredAt: null,
  cancelledAt: Date.parse('2026-08-08T15:18:00+08:00'),
}];

const renderList = (addNotional: number, reverseHedgeOrders = orders) => render(
  <MemoryRouter>
    <CampaignLegsList legs={legs(addNotional)} tradeRecords={[]} reverseHedgeOrders={reverseHedgeOrders} initialExpectedMaxLoss={1_000} />
  </MemoryRouter>,
);

describe('Legs 列表的「加仓校验」列', () => {
  it('表头紧跟在「币量 / 仓位」之后', () => {
    renderList(22_057_330);
    const header = screen.getByText('加仓校验');
    const coins = screen.getByText('币量 / 仓位');
    const fees = screen.getByText('手续费');
    expect(coins.nextElementSibling).toBe(header);
    expect(header.nextElementSibling).toBe(fees);
    expect(header.getAttribute('title')).toContain('X₂(S₂ − S₁)');
  });

  it('【回归】TUTUSDT 加仓1 仓位过大：红色放大的叉 + 缺口金额，不挂悬浮框', () => {
    renderList(22_057_330);
    const mark = screen.getByTestId('add-sizing-check-fail-add1');
    expect(mark.className).toContain('text-[#F6465D]');
    const cross = mark.firstElementChild!;
    expect(cross.textContent).toBe('✗');
    expect(cross.className).toContain('text-[18px]');
    expect(cross.className).toContain('font-bold');
    expect(mark.textContent).toMatch(/缺 3,7\d\d,\d{3}/);
    expect(mark.getAttribute('title')).toBeNull();
    expect(mark.getAttribute('aria-label')).toContain('仓位过大');
    expect(screen.queryByTestId('add-sizing-check-ok-add1')).toBeNull();
  });

  it('仓位合规：几乎隐形的小对号，不带红色', () => {
    // 浮盈垫 ≈ 2,931 + 落袋 15,117.55 ≈ 18,049；每币退回 S₁ 亏 0.0072445 → 两百万币以内都兜得住
    renderList(2_000_000 * 0.0419705);
    const mark = screen.getByTestId('add-sizing-check-ok-add1');
    expect(mark.textContent).toBe('✓');
    expect(mark.className).toContain('text-muted-foreground/30');
    expect(mark.className).not.toContain('#F6465D');
    expect(mark.getAttribute('title')).toBeNull();
    expect(screen.queryByTestId('add-sizing-check-fail-add1')).toBeNull();
  });

  it('读不到止损线：淡灰「—」', () => {
    renderList(22_057_330, []);
    const mark = screen.getByTestId('add-sizing-check-unknown-add1');
    expect(mark.textContent).toBe('—');
    expect(mark.className).toContain('text-muted-foreground/30');
  });

  it('非加仓行不打任何标记', () => {
    renderList(22_057_330);
    for (const id of ['main', 'mirror']) {
      expect(screen.queryByTestId(`add-sizing-check-ok-${id}`)).toBeNull();
      expect(screen.queryByTestId(`add-sizing-check-fail-${id}`)).toBeNull();
      expect(screen.queryByTestId(`add-sizing-check-unknown-${id}`)).toBeNull();
    }
  });

  it('每一行的格子数与表头一致：加列没有让合计行错位', () => {
    renderList(22_057_330);
    const headerCells = screen.getByText('加仓校验').parentElement!.children.length;
    expect(headerCells).toBe(12);
    expect(screen.getByTestId('legs-total-row').children.length).toBe(headerCells);
    const addRow = screen.getByTestId('add-sizing-check-fail-add1').parentElement!;
    expect(addRow.children.length).toBe(headerCells);
  });

  it('读屏读得到明细：三种记号都是 role="img"，aria-label 才算数', () => {
    renderList(22_057_330);
    const fail = screen.getByRole('img', { name: /加仓校验：仓位过大/ });
    expect(fail).toBe(screen.getByTestId('add-sizing-check-fail-add1'));
    expect(fail.getAttribute('aria-label')).toContain('浮盈垫');
    expect(fail.getAttribute('aria-label')).toContain('已落袋');
  });

  it('合规与无法判断的记号同样带 role="img"', () => {
    const { unmount } = renderList(2_000_000 * 0.0419705);
    expect(screen.getByRole('img', { name: /加仓校验：仓位合规/ })).toBe(screen.getByTestId('add-sizing-check-ok-add1'));
    unmount();
    renderList(22_057_330, []);
    expect(screen.getByRole('img', { name: /加仓校验：无法判断/ })).toBe(screen.getByTestId('add-sizing-check-unknown-add1'));
  });

  it('主力阶段子行也补了这一格：每个阶段子行与表头格子数一致', () => {
    const at = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;
    const phaseLegs = [
      legFor({
        id: 'main', leg_sequence: 1, pre_simulated_time: at('01:00'), pre_entry_price: 0.0336792, pre_position_size: 94_300,
        post_exit_price_snapshot: 0.0677819, post_simulated_close_time: at('09:00'), post_realized_pnl: 95_439.77,
      }),
      // 主力持仓期间开出又平掉的滚动对冲：把主力切成两段
      legFor({
        id: 'hedge-roll', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
        pre_simulated_time: at('03:00'), pre_entry_price: 0.05, pre_position_size: 50_000,
        post_exit_price_snapshot: 0.052, post_simulated_close_time: at('05:00'), post_realized_pnl: -2_000,
      }),
    ];
    render(
      <MemoryRouter>
        <CampaignLegsList legs={phaseLegs} tradeRecords={[]} initialExpectedMaxLoss={20_000} />
      </MemoryRouter>,
    );
    const headerCells = screen.getByText('加仓校验').parentElement!.children.length;
    const phaseRows = Array.from(screen.getByTestId('leg-phases-main').children);
    expect(phaseRows.length).toBeGreaterThanOrEqual(2);
    for (const row of phaseRows) expect(row.children.length).toBe(headerCells);
  });
});
