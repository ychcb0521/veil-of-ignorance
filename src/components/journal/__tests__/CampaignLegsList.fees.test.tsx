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

const renderList = (records: TradeRecord[], legs: TradeJournal[]) => render(
  <MemoryRouter><CampaignLegsList legs={legs} tradeRecords={records} /></MemoryRouter>,
);

describe('Legs 列表的手续费列', () => {
  it('【用户要求】旧记录：开仓费按当年费率估算并标明，平仓费取自记录，给出合计', () => {
    const record = hpeRecord();
    renderList([record], [legFor(record)]);
    const cell = screen.getByTestId('leg-fees-leg-1');
    expect(cell.textContent).toContain('开 297.72');
    expect(cell.textContent).toContain('平 297.75');
    expect(cell.textContent).toContain('合计 595.48');
    expect(cell.textContent).toContain('Taker ≈0.04%');
    expect(cell.textContent).toContain('开仓费为估算');
    // tooltip 把币安算式与「盈亏为什么是这个数」讲清楚
    expect(cell.getAttribute('title')).toContain('手续费 = 名义 × 费率');
    expect(cell.getAttribute('title')).toContain('毛盈亏 +74.36 − 平仓费 297.75 = -223.39');
    expect(screen.getByTestId('legs-total-fees').textContent).toContain('595.48');
    expect(screen.getByTestId('legs-total-fees').textContent).toContain('含估算');
  });

  it('新记录：三个数都来自记录，标 Taker 0.05%，不带估算字样', () => {
    const record = hpeRecord({
      openFeeUsd: 372.16, openIsMaker: false, openFeeRate: TAKER_FEE,
      fee: 372.19, closeIsMaker: false, closeFeeRate: TAKER_FEE,
    });
    renderList([record], [legFor(record)]);
    const cell = screen.getByTestId('leg-fees-leg-1');
    expect(cell.textContent).toContain('开 372.16');
    expect(cell.textContent).toContain('平 372.19');
    expect(cell.textContent).toContain('合计 744.35');
    expect(cell.textContent).toContain('Taker 0.05%');
    expect(cell.textContent).not.toContain('估');
    expect(screen.getByTestId('legs-total-fees').textContent).not.toContain('估');
  });

  it('强平记录：平仓费标明含强平费', () => {
    const record = hpeRecord({
      action: 'LIQUIDATION', exit_method: 'liquidation', liquidationSettlement: 'bankruptcy',
      pnl: -74_431, fee: 4_019.4, closeFeeRate: TAKER_FEE, closeIsMaker: false, liquidationFeeUsd: 3_721.6,
      openFeeUsd: 372.155, openIsMaker: false, openFeeRate: TAKER_FEE,
    });
    renderList([record], [legFor(record)]);
    expect(screen.getByTestId('leg-fees-leg-1').textContent).toContain('含强平费');
  });

  it('没有成交记录的腿显示「—」；合计按记录去重', () => {
    const record = hpeRecord();
    const planned = { ...legFor(record, 'leg-planned'), trade_record_id: null, leg_role: 'hedge_initial_a' } as TradeJournal;
    renderList([record], [legFor(record), legFor(record, 'leg-mirror'), planned]);
    expect(screen.queryByTestId('leg-fees-leg-planned')).toBeNull();
    expect(screen.getByTestId('legs-total-fees').textContent).toContain('595.48');   // 不是 ×2
  });
});
