import { buildCampaignLegsExportRows } from '@/lib/campaignLegsPngExport';
import { expect, it, vi } from 'vitest';
import { createUsdtCampaignReader, reconstructUsdtCampaigns, type UsdtActualTrade } from '../../../../scripts/usdt-campaign-reader';
import { withUsdtOrderActions, findUsdtCampaignFollow, usdtCampaignAmounts, usdtLiveCampaignId } from '../usdtLiveCampaign';
import { buildUsdtLiveCampaignData, mergeUsdtLiveCampaignRows } from '../usdtLiveCampaignProjection';
import { usdtLiveRiskMetrics } from '../usdtLiveCampaignMetrics';
import { paperCampaignPerformance } from '../qualityCampaignPerformance';
import { summarizeCampaignPerformance } from '@/lib/kellySizing';
import { buildCampaignPricePathTask } from '@/hooks/useCampaignPricePaths';
import { rowAddCount, rowPayoffRatio } from '@/lib/campaignListSort';
import type { InstantMonitorSettings } from '../instantMonitorSettings';
import { buildCampaignCardData } from '@/lib/campaignListCache';
import { sortCampaignRows } from '@/lib/campaignListSort';
import { makeSortRow } from '@/test/fixtures/campaignSortRows';

const at = Date.UTC(2026, 10, 15, 10);
const buy: UsdtActualTrade = { id: '11', orderId: '101', side: 'BUY', at, price: '0.08328', quantity: '100',
  realized: 0, commission: .004164, commissionAsset: 'USDT', asset: 'USDT', positionSide: 'LONG' };
const sell: UsdtActualTrade = { ...buy, id: '12', orderId: '102', side: 'SELL', at: at + 48_000, price: '0.08338',
  realized: .01, commission: .004169 };

it('lists a newer exchange campaign above older simulated campaigns on the default journal sort', () => {
  const [closed] = reconstructUsdtCampaigns('BEATUSDT', [], [buy, sell]);
  const live = { ...buildCampaignCardData(buildUsdtLiveCampaignData('fixture', closed)),
    arithmeticExpectancy: null, geometricExpectancy: null };
  const paper = makeSortRow({ id: 'paper', time: new Date(at - 1000).toISOString() });
  expect(sortCampaignRows([paper, live], []).map(row => row.campaign.id)).toEqual([live.campaign.id, 'paper']);
});

it('attributes order reasons using the opening trade and actual fill IDs, including split fills', () => {
  const [campaign] = reconstructUsdtCampaigns('BEATUSDT', [], [buy, sell]);
  const fill = { id: buy.id, at, price: 1, quantity: 1, realized: 0, commission: 0, commissionAsset: 'USDT' };
  const status = { id: 'fish-instant-test', symbol: campaign.symbol, state: 'closed' as const, executions: [
    { actionId: 'open', orderId: buy.orderId, side: 'BUY' as const, fills: [fill] },
    { actionId: 'close', orderId: sell.orderId, side: 'SELL' as const, fills: [{ ...fill, id: sell.id }] }] };
  expect(withUsdtOrderActions(campaign, [status])).toMatchObject({
    followId: status.id, actionByOrder: { [buy.orderId]: 'open', [sell.orderId]: 'close' }, fills: campaign.fills });
  expect(withUsdtOrderActions(campaign, [{ ...status, executions: [
    status.executions[0], { ...status.executions[1], fills: [{ ...fill, id: 'elsewhere' }] }] }]).actionByOrder)
    .toEqual({ [buy.orderId]: 'open' });
  expect(withUsdtOrderActions(campaign, [{ ...status, symbol: 'OTHERUSDT' }])).toBe(campaign);
});

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

it('uses the actual first order, net fills and directed exit price across detail, card and statistics', () => {
  const trades = [
    { ...buy, price: '100', quantity: '1', commission: 0.1 },
    { ...buy, id: '12', at: at + 1, price: '110', quantity: '1', commission: 0.1 },
    { ...sell, id: '13', at: at + 2, price: '115', quantity: '0.5', realized: 5, commission: 0.1 },
    { ...buy, id: '14', orderId: '103', at: at + 3, price: '115', quantity: '0.5', commission: 0.1 },
    { ...buy, id: '15', orderId: '103', at: at + 4, price: '115', quantity: '1', commission: 0.1 },
    { ...sell, id: '16', orderId: '104', at: at + 5, price: '120', quantity: '1', realized: 10, commission: 0.1 },
    { ...sell, id: '17', orderId: '104', at: at + 6, price: '123', quantity: '2', realized: 26, commission: 0.1 },
  ];
  const [live] = reconstructUsdtCampaigns('BEATUSDT', [], trades);
  const data = buildUsdtLiveCampaignData('owner', live);
  const row = buildCampaignCardData(data);
  const b = (41 - 0.7) / 6.3;
  expect(data.legs.map(leg => leg.leg_role)).toEqual(['main_open','main_add_1']);
  expect(data.legs[0].pre_entry_price).toBe(105);
  expect(data.tradeRecords.reduce((sum, record) => sum + record.pnl, 0)).toBeCloseTo(40.3);
  const mirrored = buildUsdtLiveCampaignData('owner', {...live, actionByOrder:{[sell.orderId]:'mirror'}});
  const rows = buildCampaignLegsExportRows({ campaign:data.campaign, legs:data.legs, tradeRecords:data.tradeRecords, reverseHedgeOrders:[] });
  expect(JSON.stringify(rows)).toContain('0.7 USDT');
  expect(JSON.stringify(rows)).toContain('加仓1');
  expect(mirrored.legs.map(leg => leg.leg_role)).toEqual(['main_open','mirror_tp','main_add_1']);
  expect(mirrored.legs.reduce((sum, leg) => sum + leg.post_realized_pnl!, 0)).toBeCloseTo(40.3);

  expect(usdtLiveRiskMetrics(data.campaign)).toMatchObject({ openingNotional: 210, entryPrice: 105, exitPrice: 122, frozen: false });
  expect(row.initialExpectedMaxLoss).toBeCloseTo(6.3);
  expect(rowPayoffRatio(row)).toBeCloseTo(b, 12);
  expect(rowAddCount(row)).toBe(1);
  expect(row.positionGeometricMultiple).toBeCloseTo(1.5);
  expect(row.positionAmplification).toBeCloseTo(382.5 / 210);
  expect(row.mainPriceChangePct).toBeCloseTo(100 * 17 / 105);
  expect(buildCampaignPricePathTask(row)).toMatchObject({ entryPrice: 105, side: 'long' });
  const summary = summarizeCampaignPerformance([{ campaign: row.campaign, payoffRatio: rowPayoffRatio(row) }]);
  expect(summary.payoffRatio).toBeCloseTo(b, 12);
  expect(summary.winCount).toBe(1);
  expect(paperCampaignPerformance([data]).performance.payoffRatio).toBeCloseTo(b, 12);
});

it('resolves short, breakeven, open and mixed-fee campaigns without inventing a settled B', () => {
  const [short] = reconstructUsdtCampaigns('BEATUSDT', [], [
    { ...buy, side: 'SELL', positionSide: 'SHORT', price: '50', commission: 0 },
    { ...sell, side: 'BUY', positionSide: 'SHORT', price: '49', realized: 100, commission: 0 },
  ]);
  const card = (position: typeof short) => buildCampaignCardData(buildUsdtLiveCampaignData('owner', position));
  expect(card(short).mainPriceChangePct).toBeCloseTo(2);
  expect(rowPayoffRatio(card(short))).toBeCloseTo(100 / 150);
  expect(rowPayoffRatio(card({ ...short, closedAt: undefined, quantity: '100', fills: short.fills.slice(0, 1) }))).toBeNull();
  expect(rowPayoffRatio(card({ ...short, fills: short.fills.map(f => ({ ...f, realized: 0 })) }))).toBe(0);
  expect(rowPayoffRatio(card({ ...short, fills: short.fills.map(f => ({ ...f, commission: 1, commissionAsset: 'BNB' })) }))).toBeNull();
});

it('links only the original frozen follow risk and never uses a later management stop for entry', () => {
  const [closed] = reconstructUsdtCampaigns('BEATUSDT', [], [buy, sell]);
  const data = buildUsdtLiveCampaignData('owner', { ...closed, followId: 'fish-instant-a' });
  const monitor = (threshold: number) => ({ templateId: 'tpl', name: 'test', plan: {
    rule: { version: 'sell-static-drawdown-v1', metric: 'staticDrawdown', direction: '>=', threshold },
  } }) as InstantMonitorSettings;
  const from = monitor(5), to = monitor(9);
  const paper = { ...data, campaign: { ...data.campaign, id: 'fish-instant-a', comparison: {
    ...data.campaign.comparison!, liveUsdt: undefined, monitorPlan: to.plan, instant: {
      source: { id: 'x', symbol: closed.symbol, timeMs: at }, marginUsdt: 1, drawdown: null, staticDrawdown: null,
      switches: [{ at: at + 1000, effectiveAt: at + 1000, from, to }],
    },
  } } };
  const [linked] = mergeUsdtLiveCampaignRows([data, paper]);
  const facts = usdtLiveRiskMetrics(linked.campaign)!;
  expect(facts).toMatchObject({ percent: 5, frozen: true });
  expect(facts.loss).toBeCloseTo(100 * Number(buy.price) * 0.05);
  const linePlan = { ...from, plan: { ...from.plan, payoffRiskVersion: 'selected-l0-dbl5-execution-line-v1' as const } };
  const managed = { version: 'binance-manual-monitor-v1' as const, armedAt: at, monitor: linePlan };
  const selected = (pct: number | null) => buildUsdtLiveCampaignData('owner', { ...closed, management: { ...managed, selectedL0Pct: pct } });
  expect(usdtLiveRiskMetrics(selected(7).campaign)).toMatchObject({ percent: 7, frozen: true });
  expect(usdtLiveRiskMetrics(selected(null).campaign)).toMatchObject({ percent: null, payoffRatio: null });
  const late = buildUsdtLiveCampaignData('owner', { ...closed, management: {
    version: 'binance-manual-monitor-v1', armedAt: at + 1, monitor: to,
  } });
  expect(usdtLiveRiskMetrics(late.campaign)).toMatchObject({ percent: 3, frozen: false });
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
it('agrees with the position reader when the exchange timestamps differ by one millisecond', async () => {
  const read = vi.fn(async (_method: string, path: string) => path.endsWith('positionRisk')
    ? [{ symbol:'BEATUSDT', positionSide:'LONG', positionAmt:'100', entryPrice:buy.price, markPrice:buy.price,
         updateTime:at+1, unRealizedProfit:'0' }]
    : [{ ...buy, symbol:'BEATUSDT', time:at, qty:buy.quantity, realizedPnl:'0', commission:String(buy.commission) }]);
  const scan=createUsdtCampaignReader(read,()=>at+60_000);
  const {campaigns}=await scan(at-1000, [], 'BEATUSDT');
  expect(campaigns[0]).toMatchObject({openedAt:at,quantity:'100',direction:'long'});
});
