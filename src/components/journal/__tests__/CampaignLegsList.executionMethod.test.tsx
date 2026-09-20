import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '../CampaignLegsList';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

const at = (hour: number) => Date.parse(`2026-09-20T0${hour}:00:00.000Z`);
const main = { id: 'main', leg_role: 'main_open', order_kind: 'main', direction: 'long', symbol: 'XUSDT',
  trade_record_id: 'r-main', pre_simulated_time: new Date(at(1)).toISOString(), pre_entry_price: 100, pre_position_size: 1000,
} as TradeJournal;
const hedge = { ...main, id: 'hedge', trade_record_id: 'r-hedge', leg_role: 'standalone', order_kind: 'hedge', direction: 'short',
  pre_simulated_time: new Date(at(2)).toISOString(),
} as TradeJournal;
const records: TradeRecord[] = [
  { id: 'r-main', symbol: 'XUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE', entryPrice: 100, exitPrice: 120,
    quantity: 10, leverage: 3, pnl: 200, fee: 0, slippage: 0, openTime: at(1), closeTime: at(4), entry_method: 'manual', exit_method: 'tp1' },
  { id: 'r-hedge', symbol: 'XUSDT', side: 'SHORT', type: 'MARKET', action: 'CLOSE', entryPrice: 105, exitPrice: 110,
    quantity: 5, leverage: 3, pnl: -25, fee: 0, slippage: 0, openTime: at(2), closeTime: at(3), entry_method: 'order', exit_method: 'manual' },
];

describe('Legs 开平操作方式', () => {
  it('adds one quiet two-line column after exit price without misaligning phases or totals', () => {
    render(<CampaignLegsList legs={[main, hedge]} tradeRecords={records} initialExpectedMaxLoss={100} />);
    const header = screen.getByTestId('legs-header-row');
    const titles = [...header.children].map(cell => cell.textContent);
    const column = titles.indexOf('操作方式');
    expect(titles.slice(column - 1, column + 2)).toEqual(['平仓价', '操作方式', '涨跌幅']);
    const cell = screen.getByTestId('leg-execution-method-main');
    expect([...cell.children].map(line => line.textContent)).toEqual(['开 手动', '平 非手动']);
    expect(cell.className).toContain('text-muted-foreground');
    expect(screen.getByTestId('leg-execution-method-hedge')).toHaveTextContent('开 非手动平 手动');
    expect(screen.getByTestId('leg-frozen-role-hedge')).toHaveTextContent('滚动对冲 1');
    fireEvent.click(screen.getByTestId('leg-phases-toggle-main'));
    const phases = screen.getByTestId('leg-phases-main');
    expect(phases).toHaveTextContent('对冲1阶段');
    for (const row of [...phases.children, screen.getByTestId('legs-total-row')]) {
      expect(row.children.length).toBe(titles.length);
      expect(row.children[column].textContent).toBe('');
    }
    expect(hedge.leg_role).toBe('standalone');
  });
  it('does not classify a synthetic or retroactive MARKET record as manual', () => {
    render(<CampaignLegsList legs={[main]} tradeRecords={records.slice(0, 1).map(record => ({ ...record, entry_method: undefined, exit_method: undefined }))} />);
    expect(screen.getByTestId('leg-execution-method-main')).toHaveTextContent('开 未记录平 未记录');
  });
});
