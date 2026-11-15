import { expect, it, vi } from 'vitest';
import { createUsdtCampaignReader, reconstructUsdtCampaigns, type UsdtActualTrade } from '../../../../scripts/usdt-campaign-reader';
import { findUsdtCampaignFollow, usdtCampaignAmounts, usdtLiveCampaignId } from '../usdtLiveCampaign';

const at = Date.UTC(2026, 10, 15, 10);
const buy: UsdtActualTrade = { id: '11', orderId: '101', side: 'BUY', at, price: '0.08328', quantity: '100',
  realized: 0, commission: .004164, commissionAsset: 'USDT', asset: 'USDT', positionSide: 'LONG' };
const sell: UsdtActualTrade = { ...buy, id: '12', orderId: '102', side: 'SELL', at: at + 48_000, price: '0.08338',
  realized: .01, commission: .004169 };

it('keeps fills of the same opening order under open and records a later order as an addition', () => {
  const first = { ...buy, quantity: '11' };
  const rest = { ...buy, id: '12', quantity: '89' };
  const add = { ...buy, id: '13', orderId: '103', at: at + 5, quantity: '10' };
  const close = { ...sell, id: '14', quantity: '110' };
  const [campaign] = reconstructUsdtCampaigns('BEATUSDT', [], [rest, close, add, first]);
  expect(campaign.fills.map(fill => [fill.id, fill.action])).toEqual([
    ['11', 'open'], ['12', 'open'], ['13', 'add'], ['14', 'reduce'],
  ]);
});

it('finds a manual round trip even when both fills happen before the next position read', async () => {
  const read = vi.fn(async (_method: string, path: string) => {
    if (path.endsWith('positionRisk')) return [];
    if (path.endsWith('allOrders')) return [{ symbol: 'BEATUSDT', executedQty: '100' }];
    return [buy, sell].map(row => ({ ...row, symbol: 'BEATUSDT', time: row.at, qty: row.quantity, marginAsset: row.asset,
      realizedPnl: String(row.realized), commission: String(row.commission) }));
  });
  const scan = createUsdtCampaignReader(read, () => at + 60_000);
  const { campaigns } = await scan(at - 1000, []);
  expect(campaigns).toHaveLength(1);
  expect(campaigns[0]).toMatchObject({ openedAt: at, closedAt: sell.at, quantity: '0', direction: 'long' });
  expect(usdtCampaignAmounts(campaigns[0]).net).toBeCloseTo(.001667);
  expect(read.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  expect(findUsdtCampaignFollow(campaigns[0], [{state:'tracking',id:'fish-instant-follow',symbol:'BEATUSDT',
    executions:[{actionId:'open',orderId:'101',side:'BUY',fills:[{...buy,quantity:100,price:.08328}]}]}])?.id).toBe('fish-instant-follow');
});

it('keeps the original campaign identity through partial exits and splits a one-way reversal by actual size', () => {
  const opening = {...buy, positionSide: 'BOTH' as const };
  const reduce = {...sell, positionSide: 'BOTH' as const, quantity: '40' };
  const reverse = {...reduce, id: '13', orderId: '103', at: sell.at + 50, quantity: '80', realized: .006 };
  const open = reconstructUsdtCampaigns('BEATUSDT', [{
    symbol:'BEATUSDT',positionSide:'BOTH',direction:'long',quantity:'60',entryPrice:buy.price,
    markPrice:sell.price,unrealizedPnl:'.006',updatedAt:sell.at,
  }], [opening, reduce]);
  const closed = reconstructUsdtCampaigns('BEATUSDT', [{
    symbol:'BEATUSDT',positionSide:'BOTH',direction:'short',quantity:'20',entryPrice:sell.price,
    markPrice:sell.price,unrealizedPnl:'0',updatedAt:reverse.at,
  }], [opening, reduce, reverse]);
  expect(usdtLiveCampaignId(open[0])).toBe(usdtLiveCampaignId(closed[0]));
  expect(closed[0].fills.at(-1)).toMatchObject({ id: '13', positionQuantity: '60', realized: .006 });
  expect(closed[1]).toMatchObject({ direction: 'short', quantity:'20', fills: [{ id: '13', positionQuantity: '20', realized: 0 }] });
});
