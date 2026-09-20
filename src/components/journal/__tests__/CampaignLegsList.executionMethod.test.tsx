import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '../CampaignLegsList';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
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
    expect([...cell.children].map(line => line.textContent)).toEqual(['手动（开）', '自动（平）']);
    expect(cell.className).toContain('text-muted-foreground');
    expect(screen.getByTestId('leg-execution-method-hedge')).toHaveTextContent('自动（开）手动（平）');
    for (const line of cell.children) {
      expect(line.className).toContain('grid-cols-[3em_3em]');
      expect(line.children.length).toBe(2);
    }
    expect(cell.children[0].children[0].className).not.toContain('amber');
    expect(cell.children[1].children[0].className).not.toContain('amber');
    expect(cell.children[0].children[1].className).toContain('text-muted-foreground/45');
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
  it('主力开仓按业务约定手动，真实平仓缺方式也按用户确认手动显示', () => {
    render(<CampaignLegsList legs={[main]} tradeRecords={records.slice(0, 1).map(record => ({ ...record, entry_method: undefined, exit_method: undefined }))} />);
    expect(screen.getByTestId('leg-execution-method-main')).toHaveTextContent('手动（开）手动（平）');
  });
  it('有真实成交的加仓缺方式按手动显示，但不强调', () => {
    render(<CampaignLegsList legs={[{ ...main, leg_role: 'main_add_1' }]} tradeRecords={records.slice(0, 1).map(record => ({ ...record, entry_method: undefined, exit_method: undefined }))} />);
    const cell = screen.getByTestId('leg-execution-method-main');
    expect(cell).toHaveTextContent('手动（开）手动（平）');
    expect(cell.children[0].children[0].className).toContain('text-muted-foreground/80');
  });

  it.each(['hedge_initial_a', 'hedge_initial_b', 'hedge_rolling', 'reentry_hedge', 'standalone', null] as const)(
    '只突出手动对冲 %s 的开仓，手动平仓保持中性', role => {
      render(<CampaignLegsList legs={[{ ...hedge, leg_role: role }]} tradeRecords={[
        { ...records[1], entry_method: 'manual', exit_method: 'manual' },
      ]} />);
      const cell = screen.getByTestId('leg-execution-method-hedge');
      expect(cell).toHaveTextContent('手动（开）手动（平）');
      expect(cell.children[0].children[0].className).toContain('text-amber-700/90');
      expect(cell.children[1].children[0].className).toContain('text-muted-foreground/80');
      expect(cell.children[1].children[0].className).not.toContain('amber');
    },
  );

  it.each(['main_open', 'reentry_main', 'main_add_1', 'standalone'] as const)(
    '非对冲 %s 即使开平都是手动也不强调', role => {
      render(<CampaignLegsList legs={[{ ...main, leg_role: role }]} tradeRecords={[
        { ...records[0], entry_method: 'manual', exit_method: 'manual' },
      ]} />);
      const cell = screen.getByTestId('leg-execution-method-main');
      expect(cell).toHaveTextContent('手动（开）手动（平）');
      expect(cell.innerHTML).not.toContain('amber');
    },
  );

  it('自动开仓的对冲不强调，手动平仓也不抢重点', () => {
    render(<CampaignLegsList legs={[hedge]} tradeRecords={[records[1]]} />);
    const cell = screen.getByTestId('leg-execution-method-hedge');
    expect(cell).toHaveTextContent('自动（开）手动（平）');
    expect(cell.innerHTML).not.toContain('amber');
  });
  it('历史已成交对冲缺开平方式按手动显示；原始记录不被改写', () => {
    const legacy = { ...records[1], entry_method: undefined, exit_method: undefined };
    render(<CampaignLegsList legs={[hedge]} tradeRecords={[legacy]} />);
    const cell = screen.getByTestId('leg-execution-method-hedge');
    expect(cell).toHaveTextContent('手动（开）手动（平）');
    expect(cell.children[0].children[0].className).toContain('amber');
    expect(cell.children[1].children[0].className).not.toContain('amber');
    expect(legacy.entry_method).toBeUndefined();
    expect(legacy.exit_method).toBeUndefined();
  });

  it('无成交的对冲委托仍未记录，不能冒充已手动开平', () => {
    render(<CampaignLegsList legs={[{ ...hedge, leg_role: 'hedge_rolling' }]} tradeRecords={[]} />);
    const cell = screen.getByTestId('leg-execution-method-hedge');
    expect(cell).toHaveTextContent('未记录（开）未记录（平）');
    expect(cell.innerHTML).not.toContain('amber');
  });

  it.each([60, 59.99, 50])('镜像实际平仓比例 %s%% 使用专门规则，开仓始终自动且不强调', pct => {
    const mirror: TradeJournal = { ...main, id: 'mirror', leg_role: 'mirror_tp', trade_record_id: 'r-mirror' };
    const mirrorRecords: TradeRecord[] = [
      { ...records[0], quantity: 100 - pct, fillId: 'shared', exit_method: 'manual' },
      { ...records[0], id: 'r-mirror', quantity: pct, fillId: 'shared', exit_method: 'manual' },
    ];
    render(<CampaignLegsList campaign={{ direction: 'main_long', symbol: 'XUSDT' } as TradeCampaign}
      legs={[main, mirror]} tradeRecords={mirrorRecords} />);
    const cell = screen.getByTestId('leg-execution-method-mirror');
    expect(cell).toHaveTextContent(`自动（开）${pct === 60 ? '自动' : '手动'}（平）`);
    expect(cell.innerHTML).not.toContain('amber');
  });
});
