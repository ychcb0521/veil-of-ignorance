import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import { TAKER_FEE, type TradeRecord } from '@/types/trading';
import type { TradeJournal } from '@/types/journal';

/**
 * HPEUSDT 2026-09-12：平仓价 62.0646 高于开仓价 62.0584，盈亏列却是 −223.39——
 * 平仓 Taker 费 297.75 吃掉了 74.36 的毛盈亏，开仓那一笔 297.72 更是从未出现在任何地方。
 * 手续费列把两笔都摆出来。
 */
const hpeRecord = (over: Partial<TradeRecord> = {}): TradeRecord => ({
  id: 'hpe-record', symbol: 'HPEUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE',
  entryPrice: 62.0584, exitPrice: 62.0646, quantity: 11_993.71, leverage: 10,
  pnl: -223.39, fee: 297.75392, slippage: 0,
  openTime: Date.parse('2026-09-12T03:59:00+08:00'), closeTime: Date.parse('2026-09-12T12:18:00+08:00'),
  ...over,
});
const legFor = (record: TradeRecord, id = 'leg-1'): TradeJournal => ({
  id, user_id: 'u', trade_record_id: record.id, campaign_id: 'c', leg_role: 'main_open', leg_sequence: 1,
  source: 'retroactive_from_record', symbol: record.symbol, direction: 'long', leverage: 10, position_mode: 'isolated',
  order_kind: 'main', pre_simulated_time: new Date(record.openTime).toISOString(), pre_entry_price: record.entryPrice,
  pre_position_size: record.entryPrice * record.quantity, post_realized_pnl: record.pnl,
  post_simulated_close_time: new Date(record.closeTime).toISOString(),
  created_at: '2026-09-12T00:00:00.000Z', updated_at: '2026-09-12T00:00:00.000Z',
} as TradeJournal);

const renderList = (records: TradeRecord[], legs: TradeJournal[], expectedMaxLoss: number | null = 30_487) => render(
  <MemoryRouter>
    <CampaignLegsList legs={legs} tradeRecords={records} initialExpectedMaxLoss={expectedMaxLoss} />
  </MemoryRouter>,
);

describe('Legs 列表的手续费列', () => {
  it('【用户要求】旧记录：开仓费按当年费率估算并标明，平仓费取自记录，给出合计', () => {
    const record = hpeRecord();
    renderList([record], [legFor(record)]);
    const cell = screen.getByTestId('leg-fees-leg-1');
    // 只露两行：合计在上、开/平拆分在下；费率与估算依据都收进 tooltip
    expect(cell.textContent).toContain('595.48');
    expect(cell.textContent).toContain('开 297.72 · 平 297.75');
    expect(cell.textContent).toContain('估');
    expect(cell.textContent).not.toContain('Taker');
    // 【用户要求】不要那个黑框提示：单元格上不再挂 title
    expect(cell.getAttribute('title')).toBeNull();
    expect(screen.getByTestId('legs-total-fees').textContent).toContain('595.48');
    expect(screen.getByTestId('legs-total-fees').textContent).toContain('估');
  });

  it('新记录：三个数都来自记录，标 Taker 0.05%，不带估算字样', () => {
    const record = hpeRecord({
      openFeeUsd: 372.16, openIsMaker: false, openFeeRate: TAKER_FEE,
      fee: 372.19, closeIsMaker: false, closeFeeRate: TAKER_FEE,
    });
    renderList([record], [legFor(record)]);
    const cell = screen.getByTestId('leg-fees-leg-1');
    expect(cell.textContent).toContain('744.35');
    expect(cell.textContent).toContain('开 372.16 · 平 372.19');
    expect(cell.textContent).not.toContain('估');
    expect(cell.getAttribute('title')).toBeNull();
    expect(screen.getByTestId('legs-total-fees').textContent).not.toContain('估');
  });

  it('主次：Δb 最重、盈亏次之、手续费最轻，且手续费排在盈亏之前', () => {
    const record = hpeRecord();
    renderList([record], [legFor(record)]);
    const fees = screen.getByTestId('leg-fees-leg-1');
    const pnl = screen.getByTestId('leg-pnl-leg-1');
    const delta = screen.getByTestId('leg-delta-b-leg-1');
    // DOM 顺序 = 栅格列序：结论（贡献 / Δb）在前，成本注脚在后
    expect(pnl.compareDocumentPosition(delta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(delta.compareDocumentPosition(fees) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 状态不再单独占一列：已平仓是常态，不必每行都写一遍
    expect(screen.queryByText('已平仓')).toBeNull();
    // 主次由字号与字重定，不靠发灰
    expect(delta.className).toContain('text-[14px]');
    expect(delta.className).toContain('font-semibold');
    expect(pnl.className).toContain('text-[12px]');
    expect(fees.className).toContain('text-[11px]');
    // 合计行同一套
    expect(screen.getByTestId('legs-total-delta-b').className).toContain('text-[14px]');
    expect(screen.getByTestId('legs-total-fees').className).toContain('text-[11px]');
    /**
     * 底色必须写成 /[0.12]。任意色配非标准透明度档（写成 /12）Tailwind 不生成规则，
     * 底色会**静默**失效——改回那种写法时这条会响。
     */
    expect(delta.className).toContain('bg-[#F6465D]/[0.12]');
  });

  it('贡献率在上、金额在下——要读的是这条腿占整场的多少', () => {
    const record = hpeRecord();
    renderList([record], [legFor(record)]);
    const lines = [...screen.getByTestId('leg-pnl-leg-1').children].map(el => el.textContent);
    expect(lines[0]).toMatch(/%$/);                 // 主行是百分比
    expect(lines[1]).toContain('-223.39');          // 次行才是金额
  });

  it('小到取不出两位小数的 Δb 显示 0.00，不是「−0.00」，且用中性底色', () => {
    const record = hpeRecord({ pnl: -122.4 });
    renderList([record], [legFor(record)], 30_487);          // −122.4 ÷ 30487 = −0.004
    const delta = screen.getByTestId('leg-delta-b-leg-1');
    expect(delta.textContent).toBe('0.00');
    expect(delta.className).toContain('bg-muted');
    expect(delta.className).not.toContain('#F6465D');
  });

  it('【用户要求】币本位：主行是金额（钱包扣的数），拆分写币数——两笔金额必然相同，币数才有差别', () => {
    const record = hpeRecord({
      settlementMode: 'coin', settlementAsset: 'ASTER',
      contracts: 176_056, contractSizeUsd: 10, quantity: 176_056,
      entryPrice: 8.1380, exitPrice: 8.2060,
      fee: 1_760_560 * 0.0004, feeCoin: (1_760_560 / 8.2060) * 0.0004, pnl: 14_007.73,
    });
    renderList([record], [legFor(record)]);
    const cell = screen.getByTestId('leg-fees-leg-1');
    // 主行：金额，且是两笔之和
    expect(cell.textContent).toContain('1408.45');
    // 次行：币数，开平不同（价越高付的币越少），并标出币种
    expect(cell.textContent).toContain('开 86.54 · 平 85.82');
    expect(cell.textContent).toContain('ASTER');
    // 不把两个一模一样的金额并排写出来
    expect(cell.textContent).not.toContain('开 704.22 · 平 704.22');
    expect(cell.getAttribute('title')).toBeNull();
    expect(screen.getByTestId('legs-total-fees').textContent).toContain('1408.45');
  });

  it('强平记录：手续费列仍按开 + 平两笔报数，且不挂 title', () => {
    const record = hpeRecord({
      action: 'LIQUIDATION', exit_method: 'liquidation', liquidationSettlement: 'bankruptcy',
      pnl: -74_431, fee: 4_019.4, closeFeeRate: TAKER_FEE, closeIsMaker: false, liquidationFeeUsd: 3_721.6,
      openFeeUsd: 372.155, openIsMaker: false, openFeeRate: TAKER_FEE,
    });
    renderList([record], [legFor(record)]);
    const cell = screen.getByTestId('leg-fees-leg-1');
    // 强平清算费已经含在记录的 fee 里，所以仍进合计（4391.56）；
    // 它不再单独标注——原先只有那个 title 说得清，而 title 按要求撤了。
    expect(cell.textContent).toContain('4391.56');
    expect(cell.textContent).toContain('开 372.15 · 平 4019.40');
    expect(cell.getAttribute('title')).toBeNull();
  });

  it('没有成交记录的腿显示「—」；合计按记录去重', () => {
    const record = hpeRecord();
    const planned = { ...legFor(record, 'leg-planned'), trade_record_id: null, leg_role: 'hedge_initial_a' } as TradeJournal;
    renderList([record], [legFor(record), legFor(record, 'leg-mirror'), planned]);
    expect(screen.queryByTestId('leg-fees-leg-planned')).toBeNull();
    expect(screen.getByTestId('legs-total-fees').textContent).toContain('595.48');   // 不是 ×2
  });
});
