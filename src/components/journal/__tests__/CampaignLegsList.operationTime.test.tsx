import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

function fmtLocal(value: number): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

describe('CampaignLegsList operation time', () => {
  it('renders the objective close clock and keeps the shifted time in the close row', () => {
    const shiftedClose = Date.parse('2025-09-12T17:46:00.000Z');
    const objectiveClose = Date.parse('2026-07-11T03:52:00.000Z');
    const record: TradeRecord = {
      id: 'record-1',
      symbol: 'HIFIUSDT',
      side: 'LONG',
      type: 'MARKET',
      action: 'CLOSE',
      entryPrice: 0.1,
      exitPrice: 0.2,
      quantity: 1,
      leverage: 1,
      pnl: 1,
      fee: 0,
      slippage: 0,
      openTime: Date.parse('2025-09-12T10:13:00.000Z'),
      closeTime: shiftedClose,
      closedRealAt: objectiveClose,
    };
    const leg = {
      id: 'leg-1',
      user_id: 'user-1',
      trade_record_id: record.id,
      campaign_id: 'campaign-1',
      leg_role: 'main_open',
      leg_sequence: 1,
      source: 'retroactive_from_record',
      symbol: 'HIFIUSDT',
      direction: 'long',
      leverage: 1,
      position_mode: 'isolated',
      order_kind: 'main',
      pre_simulated_time: new Date(record.openTime).toISOString(),
      pre_real_time: '2026-07-11T03:50:00.000Z',
      pre_entry_price: record.entryPrice,
      pre_mental_state: 3,
      pre_position_size: 1,
      post_real_close_time: new Date(shiftedClose).toISOString(),
      post_simulated_close_time: new Date(shiftedClose).toISOString(),
      post_outcome: 'win',
      post_realized_pnl: 1,
      created_at: '2026-07-11T03:50:00.000Z',
      updated_at: '2026-07-11T03:50:00.000Z',
    } as TradeJournal;

    render(
      <MemoryRouter>
        <CampaignLegsList legs={[leg]} tradeRecords={[record]} />
      </MemoryRouter>,
    );

    const exactLine = (expected: string) => (_text: string, element: Element | null) => (
      element?.tagName === 'DIV' && element.textContent === expected
    );
    expect(screen.getByText(exactLine(`平 ${fmtLocal(shiftedClose)}`))).toBeInTheDocument();
    expect(screen.getByText(exactLine(`操作 ${fmtLocal(objectiveClose)}`))).toBeInTheDocument();
    expect(screen.queryByText(exactLine(`操作 ${fmtLocal(shiftedClose)}`))).not.toBeInTheDocument();
  });
});
