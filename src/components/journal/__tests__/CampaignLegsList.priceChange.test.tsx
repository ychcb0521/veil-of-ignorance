import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import type { LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/**
 * 【用户要求】在开仓价和平仓价的右边增加一列价格变化的百分比，即涨跌幅；
 * 按这条腿的方向计：多单 =（平仓价 − 开仓价）÷ 开仓价，空单 =（开仓价 − 平仓价）÷ 开仓价。
 * 对冲是空单——ORDIUSDT 的滚动对冲 6.3132 → 6.5194 亏了钱，涨跌幅不能印成绿色「+3.27%」。
 */
const legFor = (over: Partial<TradeJournal> & { id: string }): TradeJournal => ({
  user_id: 'u', trade_record_id: null, campaign_id: 'c', leg_role: 'main_open', leg_sequence: 1,
  source: 'retroactive_from_record', symbol: 'XUSDT', direction: 'long', leverage: 10, position_mode: 'isolated',
  order_kind: 'main', pre_simulated_time: '2026-08-07T01:00:00.000Z',
  created_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z',
  ...over,
} as TradeJournal);

const renderList = (
  legs: TradeJournal[],
  legExitPriceCorrections: LegExitPriceCorrections = {},
  tradeRecords: TradeRecord[] = [],
) => render(
  <MemoryRouter>
    <CampaignLegsList
      legs={legs}
      tradeRecords={tradeRecords}
      legExitPriceCorrections={legExitPriceCorrections}
      initialExpectedMaxLoss={20_000}
    />
  </MemoryRouter>,
);

const headerTitles = () => Array.from(screen.getByText('涨跌幅').parentElement!.children).map(el => el.textContent);

describe('Legs 列表的「涨跌幅」列', () => {
  it('表头紧跟在平仓价之后、币量 / 仓位之前，右对齐，tooltip 说明按方向计、与盈亏同号', () => {
    renderList([legFor({ id: 'long', pre_entry_price: 2.8717, post_exit_price_snapshot: 6.5194 })]);
    const titles = headerTitles();
    const at = titles.indexOf('涨跌幅');
    expect(titles.slice(at - 2, at + 2)).toEqual(['开仓价', '平仓价', '涨跌幅', '币量 / 仓位']);
    const header = screen.getByText('涨跌幅');
    expect(header.className).toContain('text-right');
    expect(header.getAttribute('title')).toContain('开仓价');
    expect(header.getAttribute('title')).toContain('平仓价');
    expect(header.getAttribute('title')).toContain('多单 =（平仓价 − 开仓价）');
    expect(header.getAttribute('title')).toContain('空单 =（开仓价 − 平仓价）');
    expect(header.getAttribute('title')).toContain('与「贡献 / 盈亏」同号');
  });

  it('多单 2.8717 → 6.5194：+127.02%，绿色，与开平价同字号（不是 Δb 的大号粗体）', () => {
    renderList([legFor({
      id: 'long', pre_entry_price: 2.8717, post_exit_price_snapshot: 6.5194,
      post_simulated_close_time: '2026-08-07T09:00:00.000Z',
    })]);
    const cell = screen.getByTestId('leg-price-change-long');
    expect(cell.textContent).toBe('+127.02%');
    expect(cell.className).toContain('text-[#0ECB81]');
    expect(cell.className).toContain('tabular-nums');
    expect(cell.className).toContain('text-right');
    expect(cell.className).not.toContain('text-[14px]');
    expect(cell.className).not.toContain('font-semibold');
    // 紧挨在平仓价那一格右边
    const exitCell = cell.previousElementSibling!;
    expect(exitCell.textContent).toBe('6.5194');
    expect(exitCell.previousElementSibling!.textContent).toBe('2.8717');
  });

  it('空单价格下跌：正数、绿色——按方向计，空单跌了才是占优', () => {
    renderList([legFor({
      id: 'short', direction: 'short', pre_entry_price: 10, post_exit_price_snapshot: 9.659,
      post_simulated_close_time: '2026-08-07T09:00:00.000Z',
    })]);
    const cell = screen.getByTestId('leg-price-change-short');
    expect(cell.textContent).toBe('+3.41%');
    expect(cell.className).toContain('text-[#0ECB81]');
    expect(cell.className).not.toContain('#F6465D');
  });

  it('空单价格上涨：负数、红色——与这条腿的盈亏同号', () => {
    renderList([legFor({
      id: 'short-up', direction: 'short', pre_entry_price: 10, post_exit_price_snapshot: 10.5,
      post_simulated_close_time: '2026-08-07T09:00:00.000Z',
    })]);
    const cell = screen.getByTestId('leg-price-change-short-up');
    expect(cell.textContent).toBe('-5.00%');
    expect(cell.className).toContain('text-[#F6465D]');
    expect(cell.className).not.toContain('#0ECB81');
  });

  it('ORDIUSDT 滚动对冲（空单）6.3132 → 6.5194、亏了钱：涨跌幅 -3.27% 红色，与旁边红色的盈亏同号', () => {
    renderList([
      legFor({
        id: 'main', pre_entry_price: 5.9, post_exit_price_snapshot: 7,
        post_simulated_close_time: '2026-08-07T09:00:00.000Z', post_realized_pnl: 10_000,
      }),
      legFor({
        id: 'hedge', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
        pre_simulated_time: '2026-08-07T03:00:00.000Z', pre_entry_price: 6.3132, post_exit_price_snapshot: 6.5194,
        post_simulated_close_time: '2026-08-07T05:00:00.000Z', post_realized_pnl: -2_100,
      }),
    ]);
    const cell = screen.getByTestId('leg-price-change-hedge');
    expect(cell.textContent).toBe('-3.27%');
    expect(cell.className).toContain('text-[#F6465D]');
    expect(cell.className).not.toContain('#0ECB81');
    // 与左边两格同一对价
    expect(cell.previousElementSibling!.textContent).toBe('6.5194');
    expect(cell.previousElementSibling!.previousElementSibling!.textContent).toBe('6.3132');
    // 「贡献 / 盈亏」是红的负数：两格同号，不再一红一绿
    const pnl = screen.getByTestId('leg-pnl-hedge');
    expect(pnl.textContent).toContain('-2100.00');
    expect(pnl.querySelector('.font-mono')!.className).toContain('text-[#F6465D]/90');
  });

  it('未平仓的腿显示「—」，中性淡色；取整为 0 显示「0.00%」，同样不上色', () => {
    renderList([
      legFor({ id: 'open', pre_entry_price: 2.8717 }),
      legFor({ id: 'flat', leg_sequence: 2, leg_role: 'main_add_1', pre_entry_price: 100, post_exit_price_snapshot: 99.996 }),
    ]);
    const open = screen.getByTestId('leg-price-change-open');
    expect(open.textContent).toBe('—');
    expect(open.className).toContain('text-muted-foreground');
    expect(open.className).not.toMatch(/#0ECB81|#F6465D/);
    const flat = screen.getByTestId('leg-price-change-flat');
    expect(flat.textContent).toBe('0.00%');
    expect(flat.className).not.toMatch(/#0ECB81|#F6465D/);
  });

  it('K 线校正了平仓价时，按页面显示的校正后平仓价算——三个数对得上', () => {
    renderList(
      [legFor({
        id: 'corrected', pre_entry_price: 0.1, post_exit_price_snapshot: 0.5,
        post_simulated_close_time: '2026-08-07T09:00:00.000Z',
      })],
      { corrected: { exitPrice: 0.2, originalExitPrice: 0.5, candleLow: 0.18, candleHigh: 0.22 } },
    );
    const cell = screen.getByTestId('leg-price-change-corrected');
    expect(cell.previousElementSibling!.textContent).toBe('0.200000');
    expect(cell.textContent).toBe('+100.00%');   // 不是按原记录 0.5 算出的 +400.00%
  });

  it('一个仓位分几刀平掉：平仓价只取最后一刀、盈亏是各刀合计，两格符号可能不同——tooltip 明说这一点，不许诺同号', () => {
    // 实时快照腿存的是仓位 id；三刀 CLOSE 的 positionId = fillId = 仓位 id，最后一刀最晚
    const slice = (id: string, exitPrice: number, pnl: number, closeTime: string): TradeRecord => ({
      id, symbol: 'XUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', positionId: 'pos-1', fillId: 'pos-1',
      entryPrice: 100, exitPrice, quantity: 10, leverage: 10, pnl, fee: 0, slippage: 0,
      openTime: Date.parse('2026-08-07T01:00:00.000Z'), closeTime: Date.parse(closeTime),
    });
    renderList(
      [legFor({ id: 'sliced', trade_record_id: 'pos-1', pre_entry_price: 100 })],
      {},
      [
        slice('c1', 110, 100, '2026-08-07T05:00:00.000Z'),
        slice('c2', 108, 80, '2026-08-07T06:00:00.000Z'),
        slice('c3', 98, -20, '2026-08-07T07:00:00.000Z'),
      ],
    );
    const cell = screen.getByTestId('leg-price-change-sliced');
    // 显示的平仓价是最后一刀 98，涨跌幅按它算是负数、红色
    expect(cell.previousElementSibling!.textContent).toBe('98.0000');
    expect(cell.textContent).toBe('-2.00%');
    expect(cell.className).toContain('text-[#F6465D]');
    // 盈亏是三刀合计 +160，绿色——一红一绿是事实，不是 bug；说明文字不能再许诺同号
    const pnl = screen.getByTestId('leg-pnl-sliced');
    expect(pnl.textContent).toContain('+160.00');
    expect(pnl.querySelector('.font-mono')!.className).toContain('text-[#0ECB81]/90');
    const title = screen.getByText('涨跌幅').getAttribute('title')!;
    expect(title).toContain('按所示的这一对开平价');
    expect(title).toContain('分几刀平掉');
    expect(title).toContain('符号可能不同');
  });

  describe('主力阶段子行与合计行', () => {
    const at = (hhmm: string) => `2026-08-07T${hhmm}:00.000Z`;
    const phaseLegs = [
      legFor({
        id: 'main', leg_sequence: 1, pre_simulated_time: at('01:00'), pre_entry_price: 0.0336792, pre_position_size: 94_300,
        post_exit_price_snapshot: 0.0677819, post_simulated_close_time: at('09:00'), post_realized_pnl: 95_439.77,
      }),
      // 主力持仓期间开出又平掉的滚动对冲：在 0.052 把主力切成两段
      legFor({
        id: 'hedge-roll', leg_sequence: 2, leg_role: 'hedge_rolling', order_kind: 'hedge', direction: 'short',
        pre_simulated_time: at('03:00'), pre_entry_price: 0.05, pre_position_size: 50_000,
        post_exit_price_snapshot: 0.052, post_simulated_close_time: at('05:00'), post_realized_pnl: -2_000,
      }),
    ];

    it('阶段子行按各自起止价各算各的，淡色行里仍按 /90 绿涨红跌', () => {
      renderList(phaseLegs);
      expect(screen.getByTestId('leg-price-change-main').textContent).toBe('+101.26%');
      const first = screen.getByTestId('leg-phase-price-change-main-1');
      const tail = screen.getByTestId('leg-phase-price-change-main-2');
      // 0.0336792 → 0.052
      expect(first.previousElementSibling!.textContent).toBe('0.0520000');
      expect(first.textContent).toBe('+54.40%');
      expect(first.className).toContain('text-[#0ECB81]/90');
      // 0.052 → 0.0677819
      expect(tail.previousElementSibling!.previousElementSibling!.textContent).toBe('0.0520000');
      expect(tail.textContent).toBe('+30.35%');
      expect(tail.className).toContain('text-[#0ECB81]/90');
      // 对冲腿自己是空单：价格从 0.05 涨到 0.052，按方向计是 -4.00%，红
      const hedge = screen.getByTestId('leg-price-change-hedge-roll');
      expect(hedge.textContent).toBe('-4.00%');
      expect(hedge.className).toContain('text-[#F6465D]');
    });

    it('主力是空单时，阶段子行按主力方向翻号：同一组起止价，正负与多单相反', () => {
      renderList([
        legFor({ ...phaseLegs[0], direction: 'short', post_realized_pnl: -95_439.77 }),
        legFor({ ...phaseLegs[1], direction: 'long', post_realized_pnl: 2_000 }),
      ]);
      const main = screen.getByTestId('leg-price-change-main');
      expect(main.textContent).toBe('-101.26%');
      expect(main.className).toContain('text-[#F6465D]');
      const first = screen.getByTestId('leg-phase-price-change-main-1');
      const tail = screen.getByTestId('leg-phase-price-change-main-2');
      // 0.0336792 → 0.052，空单
      expect(first.textContent).toBe('-54.40%');
      expect(first.className).toContain('text-[#F6465D]/90');
      // 0.052 → 0.0677819，空单
      expect(tail.textContent).toBe('-30.35%');
      expect(tail.className).toContain('text-[#F6465D]/90');
      // 对冲腿这回是多单：0.05 → 0.052 是 +4.00%
      expect(screen.getByTestId('leg-price-change-hedge-roll').textContent).toBe('+4.00%');
    });

    it('合计行这一格留空；表头、腿行、阶段子行、合计行格子数一致', () => {
      renderList(phaseLegs);
      const titles = headerTitles();
      expect(titles).toHaveLength(13);
      const column = titles.indexOf('涨跌幅');
      const total = screen.getByTestId('legs-total-row');
      expect(total.children).toHaveLength(13);
      expect(total.children[column].textContent).toBe('');
      expect(total.children[column].children).toHaveLength(0);
      for (const id of ['main', 'hedge-roll']) {
        const row = screen.getByTestId(`leg-price-change-${id}`).parentElement!;
        expect(row.children).toHaveLength(13);
        expect(row.children[column]).toBe(screen.getByTestId(`leg-price-change-${id}`));
      }
      const phaseRows = Array.from(screen.getByTestId('leg-phases-main').children);
      expect(phaseRows.length).toBeGreaterThanOrEqual(2);
      phaseRows.forEach((row, index) => {
        expect(row.children).toHaveLength(13);
        expect(row.children[column]).toBe(screen.getByTestId(`leg-phase-price-change-main-${index + 1}`));
      });
    });
  });
});
