import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import { buildCampaignLegsExportRows } from '@/lib/campaignLegsPngExport';
import type { CampaignExecutionWear } from '@/lib/campaignExecutionWear';
import type { TradeRecord } from '@/types/trading';
import type { TradeJournal, TradeCampaign } from '@/types/journal';

const record: TradeRecord = {
  id: 'r1', symbol: 'XUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE',
  entryPrice: 100, exitPrice: 110, quantity: 10, leverage: 5, pnl: 100, fee: 0, slippage: 2,
  openTime: Date.parse('2026-09-12T03:59:00+08:00'), closeTime: Date.parse('2026-09-12T12:18:00+08:00'),
};
const leg = {
  id: 'leg-1', user_id: 'u', trade_record_id: 'r1', campaign_id: 'c', leg_role: 'main_open', leg_sequence: 1,
  source: 'retroactive_from_record', symbol: 'XUSDT', direction: 'long', leverage: 5, position_mode: 'isolated',
  order_kind: 'main', pre_simulated_time: new Date(record.openTime).toISOString(), pre_entry_price: 100,
  pre_position_size: 1000, post_realized_pnl: 100, post_simulated_close_time: new Date(record.closeTime).toISOString(),
  created_at: '2026-09-12T00:00:00.000Z', updated_at: '2026-09-12T00:00:00.000Z',
} as TradeJournal;
const wear: CampaignExecutionWear = {
  usd: -12.5, r: -0.125,
  components: { hedge: null, exit: -10.5, slippage: -2, sizing: null },
  byLeg: { 'leg-1': { hedge: null, exit: -10.5, slippage: -2, sizing: null, total: -12.5 } },
};

describe('【用户要求】Legs 表的「磨损」列：L_磨损逐腿列出', () => {
  it('紧跟加仓校验；每行写这条腿的 L_磨损（悬停看分项），合计行等于 L_磨损、括号里 ÷ L₀；没有数据时写「—」', () => {
    const { unmount } = render(<MemoryRouter><CampaignLegsList legs={[leg]} tradeRecords={[record]} initialExpectedMaxLoss={100} executionWear={wear} /></MemoryRouter>);
    const cell = screen.getByTestId('leg-execution-wear-leg-1');
    expect(cell).toHaveTextContent('−12.50');
    expect(cell).toHaveClass('text-[#F6465D]');
    expect(cell.getAttribute('title')).toBe('多空平仓价差 −10.50 U\n委托/成交滑点 −2.00 U');
    const total = screen.getByTestId('legs-total-execution-wear');
    expect(total).toHaveTextContent('−12.50(−0.13)');
    expect(screen.getByTestId('legs-header-row').children).toHaveLength(screen.getByTestId('legs-total-row').children.length);
    unmount();
    render(<MemoryRouter><CampaignLegsList legs={[leg]} tradeRecords={[record]} initialExpectedMaxLoss={100} /></MemoryRouter>);
    expect(screen.getByTestId('leg-execution-wear-leg-1')).toHaveTextContent('—');
  });

  it('导出图同一列：上行合计、下行最大的那一项；合计行写 L_磨损与 ÷ L₀', () => {
    const rows = buildCampaignLegsExportRows({
      campaign: { id: 'c', symbol: 'XUSDT', direction: 'main_long', actual_evolution: [] } as unknown as TradeCampaign,
      legs: [leg], tradeRecords: [record], reverseHedgeOrders: [], executionWear: wear, initialExpectedMaxLoss: 100,
    });
    const legRow = rows.find(row => row.legId === 'leg-1')!;
    expect(legRow.cells[13].map(line => line.text)).toEqual(['−12.50', '多空平仓价差']);
    const totalRow = rows.find(row => row.kind === 'total')!;
    expect(totalRow.cells[13].map(line => line.text)).toEqual(['−12.50', '(−0.13)']);
  });
});
