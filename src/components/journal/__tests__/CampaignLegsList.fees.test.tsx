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
    expect(cell.getAttribute('title')).toContain('手续费 = 名义 × 费率');
    expect(cell.getAttribute('title')).toContain('Taker，记录未存开仓费，按当时费率估算');
    expect(cell.getAttribute('title')).toContain('毛盈亏 +74.36 − 平仓费 297.75 = -223.39');
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
    expect(cell.getAttribute('title')).toContain('0.05%');
    expect(screen.getByTestId('legs-total-fees').textContent).not.toContain('估');
  });

  it('主次：Δb 最重、盈亏次之、手续费最轻，且手续费排在盈亏之前', () => {
    const record = hpeRecord();
    renderList([record], [legFor(record)]);
    const fees = screen.getByTestId('leg-fees-leg-1');
    const pnl = screen.getByTestId('leg-pnl-leg-1');
    const delta = screen.getByTestId('leg-delta-b-leg-1');
    // DOM 顺序 = 栅格列序：手续费在盈亏之前
    expect(fees.compareDocumentPosition(pnl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('小到取不出两位小数的 Δb 显示 0.00，不是「−0.00」，且用中性底色', () => {
    const record = hpeRecord({ pnl: -122.4 });
    renderList([record], [legFor(record)], 30_487);          // −122.4 ÷ 30487 = −0.004
    const delta = screen.getByTestId('leg-delta-b-leg-1');
    expect(delta.textContent).toBe('0.00');
    expect(delta.className).toContain('bg-muted');
    expect(delta.className).not.toContain('#F6465D');
  });

  it('强平记录：tooltip 里标明含强平清算费', () => {
    const record = hpeRecord({
      action: 'LIQUIDATION', exit_method: 'liquidation', liquidationSettlement: 'bankruptcy',
      pnl: -74_431, fee: 4_019.4, closeFeeRate: TAKER_FEE, closeIsMaker: false, liquidationFeeUsd: 3_721.6,
      openFeeUsd: 372.155, openIsMaker: false, openFeeRate: TAKER_FEE,
    });
    renderList([record], [legFor(record)]);
    expect(screen.getByTestId('leg-fees-leg-1').getAttribute('title')).toContain('强平清算费 3721.60');
  });

  it('没有成交记录的腿显示「—」；合计按记录去重', () => {
    const record = hpeRecord();
    const planned = { ...legFor(record, 'leg-planned'), trade_record_id: null, leg_role: 'hedge_initial_a' } as TradeJournal;
    renderList([record], [legFor(record), legFor(record, 'leg-mirror'), planned]);
    expect(screen.queryByTestId('leg-fees-leg-planned')).toBeNull();
    expect(screen.getByTestId('legs-total-fees').textContent).toContain('595.48');   // 不是 ×2
  });
});
