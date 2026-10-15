import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import { buildCampaignLegsExportRows } from '@/lib/campaignLegsPngExport';
import type { CampaignExecutionWear } from '@/lib/campaignExecutionWear';
import type { TradeRecord } from '@/types/trading';
import type { TradeJournal, TradeCampaign } from '@/types/journal';

const record: TradeRecord = {
  id: 'r1', symbol: 'XUSDT', side: 'SHORT', type: 'MARKET', action: 'CLOSE',
  entryPrice: 108, exitPrice: 112, quantity: 10, leverage: 5, pnl: -40, fee: 0, slippage: 0,
  openTime: Date.parse('2026-09-12T03:59:00+08:00'), closeTime: Date.parse('2026-09-12T12:18:00+08:00'),
};
const hedge = {
  id: 'lock', user_id: 'u', trade_record_id: 'r1', campaign_id: 'c', leg_role: 'hedge_rolling', leg_sequence: 1,
  source: 'retroactive_from_record', symbol: 'XUSDT', direction: 'short', leverage: 5, position_mode: 'isolated',
  order_kind: 'hedge', pre_simulated_time: new Date(record.openTime).toISOString(), pre_entry_price: 108,
  pre_position_size: 1080, post_realized_pnl: -40, post_simulated_close_time: new Date(record.closeTime).toISOString(),
  created_at: '2026-09-12T00:00:00.000Z', updated_at: '2026-09-12T00:00:00.000Z',
} as TradeJournal;
/** 只验证渲染：哪一行有磨损由计算决定（只有中途对冲单与最终对冲单），这里直接给最终对冲单一行。 */
const wear: CampaignExecutionWear = {
  usd: -12, r: -0.12, initialExpectedMaxLoss: 100,
  components: { hedge: null, exit: -10, slippage: -5, sizing: 3 },
  byLeg: { lock: { hedge: null, exit: -10, slippage: -5, sizing: 3, total: -12, detail: {
    kind: 'finalHedge', coins: 10, entry: 108, shortExit: 112, finalExitPrice: 108, longExit: 111, longCoins: 11,
    hedgeCoinsTotal: 10, sizingOwner: true, orderPrice: 108.5, fillPrice: 108,
  } } },
};

describe('【用户要求】Legs 表的「磨损」列：与盈亏比同一单位，点开看计算过程', () => {
  it('核心读数是 R（÷ L₀），金额在下面的括号里；合计行同样；没有数据时写「—」', () => {
    const { unmount } = render(<MemoryRouter><CampaignLegsList legs={[hedge]} tradeRecords={[record]} initialExpectedMaxLoss={100} executionWear={wear} /></MemoryRouter>);
    const cell = screen.getByTestId('leg-execution-wear-lock');
    expect(cell.tagName).toBe('BUTTON');
    expect(cell).toHaveTextContent('-0.12(−12.00 U)');
    expect(cell).toHaveClass('text-[#F6465D]');
    expect(cell.getAttribute('title')).toContain('多空平仓价差 -0.10（−10.00 U）');
    expect(screen.getByTestId('legs-total-execution-wear')).toHaveTextContent('-0.12(−12.00 U)');
    expect(screen.getByTestId('legs-header-row').children).toHaveLength(screen.getByTestId('legs-total-row').children.length);
    unmount();
    render(<MemoryRouter><CampaignLegsList legs={[hedge]} tradeRecords={[record]} initialExpectedMaxLoss={100} /></MemoryRouter>);
    expect(screen.getByTestId('leg-execution-wear-lock')).toHaveTextContent('—');
  });

  it('点开：与加仓校验同一种框，顶部读数，下面逐项写公式与代入的每一个数，再 ÷ L₀', () => {
    render(<MemoryRouter><CampaignLegsList legs={[hedge]} tradeRecords={[record]} initialExpectedMaxLoss={100} executionWear={wear} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('leg-execution-wear-lock'));
    const dialog = screen.getByTestId('leg-wear-detail-dialog');
    expect(within(dialog).getByText('滚动对冲 · L_磨损计算')).toBeInTheDocument();
    expect(within(dialog).getByTestId('leg-wear-detail-r')).toHaveTextContent('-0.12');
    expect(within(dialog).getByTestId('leg-wear-detail-usd')).toHaveTextContent('= −12.00 U ÷ L₀ 100.00 U');
    expect(within(dialog).getByTestId('leg-wear-step-exit')).toHaveTextContent('10 ×（111.0000 − 112.0000）= −10.00 U ÷ L₀ 100.00 U = -0.10');
    expect(within(dialog).getByTestId('leg-wear-step-slippage')).toHaveTextContent('对冲委托/成交差 = 对冲币数 ×（开仓价 − 委托价）');
    expect(within(dialog).getByTestId('leg-wear-step-slippage')).toHaveTextContent('10 ×（108.0000 − 108.5000）= −5.00 U ÷ L₀ 100.00 U = -0.05');
    expect(within(dialog).getByTestId('leg-wear-step-sizing')).toHaveTextContent('（11 − 10）×（111.0000 − 108.0000）= +3.00 U ÷ L₀ 100.00 U = 0.03');
  });

  it('导出图同一列：核心读数 R，下面括号里是金额', () => {
    const rows = buildCampaignLegsExportRows({
      campaign: { id: 'c', symbol: 'XUSDT', direction: 'main_long', actual_evolution: [] } as unknown as TradeCampaign,
      legs: [hedge], tradeRecords: [record], reverseHedgeOrders: [], executionWear: wear, initialExpectedMaxLoss: 100,
    });
    expect(rows.find(row => row.legId === 'lock')!.cells[13].map(line => line.text)).toEqual(['-0.12', '(−12.00 U)']);
    expect(rows.find(row => row.kind === 'total')!.cells[13].map(line => line.text)).toEqual(['-0.12', '(−12.00 U)']);
  });
});
