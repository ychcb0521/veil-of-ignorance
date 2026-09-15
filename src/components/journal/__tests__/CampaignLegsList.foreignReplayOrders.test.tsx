import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import { buildCampaignLegsExportRows } from '@/lib/campaignLegsPngExport';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

const at = (hhmm: string, day = '08') => Date.parse(`2026-08-${day}T${hhmm}:00+08:00`);

const record = (id: string, open: number, close: number, entryPrice: number): TradeRecord => ({
  id, symbol: 'TUTUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE',
  entryPrice, exitPrice: entryPrice * 1.2, quantity: 1000, leverage: 5,
  pnl: 100, fee: 0, slippage: 0, openTime: open, closeTime: close,
});

const mainRec = record('rec-main', at('19:41', '07'), at('01:46', '09'), 0.03);
const legs = [{
  id: 'm', user_id: 'u', trade_record_id: mainRec.id, campaign_id: 'c', leg_role: 'main_open', leg_sequence: 1,
  source: 'retroactive_from_record', symbol: 'TUTUSDT', direction: 'long', leverage: 5, position_mode: 'isolated',
  order_kind: 'main', pre_simulated_time: new Date(mainRec.openTime).toISOString(), pre_entry_price: 0.03, pre_position_size: 1000,
  created_at: '2026-08-08T00:00:00.000Z', updated_at: '2026-08-08T00:00:00.000Z',
} as TradeJournal];

const ownOrder: CampaignReverseHedgeOrder = {
  id: 'o-main', tradeRecordId: null, side: 'SHORT', price: 0.03005,
  createdAt: at('19:42', '07'), triggeredAt: null, cancelledAt: at('01:07'), status: 'cancelled',
};
/** 另一次回放留下的、同一价位同一分钟的单子：最容易被误放进主力行。 */
const foreignOrder: CampaignReverseHedgeOrder = {
  id: 'other-live', tradeRecordId: null, side: 'SHORT', price: 0.03005,
  createdAt: at('19:42', '07') + 15_000, triggeredAt: null, cancelledAt: null, status: 'pending', foreignReplay: true,
};
const NOTE = '另有 1 张来自另一次回放的委托在本场期间挂在盘上：空 0.0300500 委 08-07 19:42 仍挂着（未计入本场）';

describe('【用户决定】他场委托不进 Legs 的任何腿的行，只在表下方写一行淡注（导出 PNG 同一句）', () => {
  it('页面：表下方一行淡注；主力行只列本场那张', () => {
    render(
      <MemoryRouter>
        <CampaignLegsList legs={legs} tradeRecords={[mainRec]} reverseHedgeOrders={[ownOrder]} foreignLiveOrders={[foreignOrder]} />
      </MemoryRouter>,
    );

    const note = screen.getByTestId('legs-foreign-replay-orders-note');
    expect(note).toHaveTextContent(NOTE);
    expect(note.className).toContain('text-muted-foreground');
    const rowOrderIds = Array.from(screen.getByTestId('leg-orders-m').querySelectorAll('[data-order-id]'))
      .map(node => node.getAttribute('data-order-id'));
    expect(rowOrderIds).toEqual(['o-main']);
    expect(document.querySelector('[data-order-id="other-live"]')).toBeNull();
  });

  it('没有他场委托就不写淡注', () => {
    render(
      <MemoryRouter>
        <CampaignLegsList legs={legs} tradeRecords={[mainRec]} reverseHedgeOrders={[ownOrder]} />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('legs-foreign-replay-orders-note')).toBeNull();
  });

  it('导出 PNG：腿的行与没有他场委托时一字不差，合计之后多一行同样的淡注', () => {
    const base = {
      campaign: { id: 'c', symbol: 'TUTUSDT', actual_evolution: [] } as unknown as TradeCampaign,
      legs,
      tradeRecords: [mainRec],
      reverseHedgeOrders: [ownOrder],
    };
    const without = buildCampaignLegsExportRows(base);
    const withForeign = buildCampaignLegsExportRows({ ...base, foreignLiveOrders: [foreignOrder] });

    expect(withForeign.slice(0, without.length)).toEqual(without);
    expect(withForeign).toHaveLength(without.length + 1);
    const note = withForeign.at(-1)!;
    expect(note.kind).toBe('note');
    expect(note.cells[0][0].text).toBe(NOTE);
  });
});
