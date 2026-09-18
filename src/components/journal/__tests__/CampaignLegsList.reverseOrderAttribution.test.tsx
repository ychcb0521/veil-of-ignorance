import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignLegsList } from '@/components/journal/CampaignLegsList';
import { buildCampaignLegsExportRows } from '@/lib/campaignLegsPngExport';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

/** 「委托」列在导出 COLUMNS 里的下标（与 campaignLegsPngExport.test.ts 一致；去掉「空单占比」后是 11）。 */
const ORDER_COL = 11;

const at = (hhmm: string, day = '08') => Date.parse(`2026-08-${day}T${hhmm}:00+08:00`);

const record = (id: string, open: number, close: number, entryPrice: number): TradeRecord => ({
  id, symbol: 'TUTUSDT', side: 'LONG', type: 'MARKET', action: 'CLOSE',
  entryPrice, exitPrice: entryPrice * 1.2, quantity: 1000, leverage: 5,
  pnl: 100, fee: 0, slippage: 0, openTime: open, closeTime: close,
});

const leg = (
  id: string,
  role: TradeJournal['leg_role'],
  sequence: number,
  rec: TradeRecord | null,
  openedAt: number,
): TradeJournal => ({
  id, user_id: 'u', trade_record_id: rec?.id ?? null, campaign_id: 'c', leg_role: role, leg_sequence: sequence,
  source: 'retroactive_from_record', symbol: 'TUTUSDT', direction: role?.startsWith('hedge_') ? 'short' : 'long',
  leverage: 5, position_mode: 'isolated',
  order_kind: role === 'mirror_tp' ? 'tp' : role?.startsWith('hedge_') ? 'hedge' : 'main',
  pre_simulated_time: new Date(openedAt).toISOString(), pre_entry_price: rec?.entryPrice ?? null, pre_position_size: 1000,
  created_at: '2026-08-08T00:00:00.000Z', updated_at: '2026-08-08T00:00:00.000Z',
} as TradeJournal);

const cancelled = (id: string, price: number, createdAt: number, cancelledAt: number): CampaignReverseHedgeOrder => ({
  id, tradeRecordId: null, side: 'SHORT', price, createdAt, triggeredAt: null, cancelledAt, status: 'cancelled',
});

/**
 * 页面与导出图各自拿到委托归属——必须是同一个结果。
 * 开平时刻走成交记录（不是腿上的快照），保证两边都经过 resolveLegExecution 这同一条路。
 */
describe('【用户要求】Legs 表与导出 PNG 的委托归属同源（含加仓）', () => {
  const mainRec = record('rec-main', at('19:41', '07'), at('01:46', '09'), 0.03);
  const add1Rec = record('rec-add1', at('12:02'), at('01:46', '09'), 0.034);
  const add2Rec = record('rec-add2', at('18:34'), at('01:46', '09'), 0.05);
  const hedgeRec = { ...record('rec-hedge', at('01:42', '09'), at('01:46', '09'), 0.068543), side: 'SHORT' } as TradeRecord;
  const tradeRecords = [mainRec, add1Rec, add2Rec, hedgeRec];
  const legs = [
    leg('m', 'main_open', 1, mainRec, mainRec.openTime),
    // 腿上的快照时刻故意写错：两边都必须以成交记录为准
    leg('a1', 'main_add_1', 2, add1Rec, at('09:00')),
    leg('a2', 'main_add_2', 3, add2Rec, add2Rec.openTime),
    leg('h', 'hedge_rolling', 4, hedgeRec, hedgeRec.openTime),
  ];
  const orders: CampaignReverseHedgeOrder[] = [
    cancelled('o-main', 0.03005, at('19:42', '07'), at('01:07')),
    cancelled('o-add1-pre', 0.034726, at('12:01'), at('15:18')),
    cancelled('o-add1', 0.040314, at('15:18'), at('18:35')),
    cancelled('o-add2', 0.050352, at('18:35'), at('20:44')),
    cancelled('o-add2-later', 0.063727, at('23:39'), at('00:22', '09')),
    {
      id: 'o-hedge', tradeRecordId: 'rec-hedge', side: 'SHORT', price: 0.068543, fillPrice: 0.068543,
      createdAt: at('00:22', '09'), triggeredAt: at('01:42', '09'), cancelledAt: null, status: 'triggered',
    },
  ];

  const pageOrderIds = (legId: string) => Array.from(
    screen.getByTestId(`leg-orders-${legId}`).querySelectorAll('[data-order-id]'),
  ).map(node => node.getAttribute('data-order-id'));

  it('每一行列出的委托 id 两边完全一致，且加仓行确实接到了加仓之后的委托', () => {
    render(
      <MemoryRouter>
        <CampaignLegsList legs={legs} tradeRecords={tradeRecords} reverseHedgeOrders={orders} />
      </MemoryRouter>,
    );

    const rows = buildCampaignLegsExportRows({
      campaign: { id: 'c', symbol: 'TUTUSDT', actual_evolution: [] } as unknown as TradeCampaign,
      legs,
      tradeRecords,
      reverseHedgeOrders: orders,
    });
    const exportOrderIds = (legId: string) => {
      const row = rows.find(r => r.kind === 'leg' && r.legId === legId);
      return (row?.cells[ORDER_COL] ?? [])
        .filter(line => /^[空多] /.test(line.text))
        .map(line => {
          const price = Number(line.text.slice(2).split(' ')[0]);
          return orders.find(o => Math.abs(o.price - price) <= o.price * 1e-5)?.id ?? `unknown:${line.text}`;
        });
    };

    const expected: Record<string, string[]> = {
      m: ['o-main'],
      a1: ['o-add1-pre', 'o-add1'],
      a2: ['o-add2', 'o-add2-later'],
      h: ['o-hedge'],
    };
    for (const l of legs) {
      expect(pageOrderIds(l.id)).toEqual(expected[l.id]);
      expect(exportOrderIds(l.id)).toEqual(pageOrderIds(l.id));
    }
  });
});
