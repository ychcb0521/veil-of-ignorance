import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ClassifyAsNewCampaignDialog } from '../ClassifyAsNewCampaignDialog';
import type { ClassifiableItem } from '@/types/journalClassification';
import type { TradeRecord } from '@/types/trading';

function makeRecord(index: number): TradeRecord {
  const base = Date.UTC(2026, 8, 22, 18, 34, 0);
  return {
    id: `record-${index}`,
    symbol: 'PUMPBTCUSDT',
    side: index % 3 === 0 ? 'LONG' : 'SHORT',
    type: 'MARKET',
    action: 'CLOSE',
    entryPrice: 0.2149 + index * 0.001,
    exitPrice: 0.22 + index * 0.001,
    quantity: 150_000 + index,
    leverage: 5,
    pnl: index % 2 === 0 ? 120 : -80,
    fee: 1,
    slippage: 0,
    openTime: base + index * 60_000,
    closeTime: base + index * 120_000,
  };
}

describe('ClassifyAsNewCampaignDialog', () => {
  it('keeps long classification forms scrollable with a visible submit action', async () => {
    const items: ClassifiableItem[] = Array.from({ length: 14 }, (_, index) => ({
      id: `r_record-${index}`,
      kind: 'orphanRecord',
      record: makeRecord(index),
    }));

    render(
      <ClassifyAsNewCampaignDialog
        open
        onOpenChange={() => undefined}
        items={items}
        onCreated={() => undefined}
      />,
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toContain('!max-h-[calc(100vh-32px)]');
    expect(dialog.className).toContain('!overflow-hidden');
    expect(dialog.querySelector('[class*="overflow-y-auto"]')).toBeTruthy();
    expect(dialog.querySelector('[class*="overflow-auto"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建战役' })).toBeInTheDocument();
    expect(screen.getByText('开仓时间')).toBeInTheDocument();
    expect(screen.getByText('平仓时间')).toBeInTheDocument();
    expect(screen.getByText('操作时间')).toBeInTheDocument();
    expect(screen.getByText('开仓价')).toBeInTheDocument();
    expect(screen.getByText('平仓价')).toBeInTheDocument();
    expect(screen.getAllByText(/2026\//).length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getAllByRole('combobox').length).toBeGreaterThan(1);
    });

    const roleSelect = screen
      .getAllByRole('combobox')
      .find((select): select is HTMLSelectElement =>
        select instanceof HTMLSelectElement &&
        Array.from(select.options).some(option => option.value === 'main_add_1'),
      );

    expect(roleSelect).toBeTruthy();
    if (!roleSelect) return;
    expect(Array.from(roleSelect.options).some(option => option.textContent === '加仓1')).toBe(true);

    fireEvent.change(roleSelect, { target: { value: 'main_add_1' } });
    expect(roleSelect.value).toBe('main_add_1');
  });
});
