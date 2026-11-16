// @vitest-environment node
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createUsdtFollower } from '../../../../scripts/usdt-follow-engine';
import { createUsdtExchange, formatQuantity, quantityUnits, usdtOrderId, type UsdtExchange } from '../../../../scripts/usdt-exchange';
import { openUsdtFollowStore, type UsdtOrder } from '../../../../scripts/usdt-follow-store';
import { serveUsdtFollower } from '../../../../scripts/usdt-follow-server';
import { usdtFollowCampaigns, type UsdtFollowCampaign } from '../usdtFollow';
import { binanceManualId } from '../binanceManualMonitor';
import { binanceManualSeed, binanceManualSample, binanceManualAdvance } from '../binanceManualStrategy';
import type { UsdtCampaignFill, UsdtLiveCampaign } from '../usdtLiveCampaign';
import { INSTANT_TEMPLATE_MONITOR } from '../instantMonitorSettings';
import { evaluateInstantMonitor } from '../instantMonitorExecution';
import { makeQualitySellPlan } from '../qualitySellPlans';
import { STATIC_DRAWDOWN_SELL_CHOICE } from '../qualityStaticDrawdownSell';
import { freezeQualityPlan } from '../qualityPlanVersions';
import { QUALITY_POSITION_MANAGEMENT_VERSION } from '../qualityPositionManagement';
import type { PreEntryRecord, PreEntryRound } from '../preEntryMonitor';

const symbol = 'NIGHTUSDT', market = { symbol, step: '0.001', min: 1, max: 100000, minNotional: 5 };
const owner = 'fixture-user';
const directory = mkdtempSync(join(tmpdir(), 'veil-usdt-follow-test-'));
let count = 0;
const stores: ReturnType<typeof openUsdtFollowStore>[] = [];
const file = () => join(directory, 'ledger-' + ++count + '.sqlite');
const makeStore = (name: string) => {
  const store = openUsdtFollowStore(name, '12345', owner);
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});
process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
const campaign = (at: number, source: UsdtFollowCampaign['source'] = { symbol, exchange: 'binance' }): UsdtFollowCampaign => ({
  id: 'fish-instant-fixture', source, admittedAt: at, notional: 100, leverage: 5,
  liveEntry: { version: 1, capturedAt: at, templateId: 'fixture', notional: 100, leverage: 5 },
  actions: [{ id: 'open', at, action: 'open' }],
});

it('rejects an old resume after a newer pause and validates the body before resuming', async () => {
  const store = makeStore(file()), venue = exchange(), allowedOrigin = 'https://fixture.test', token = 'a'.repeat(64);
  const server = serveUsdtFollower({ owner, token, exchange: venue, store, mode: 'hedge',
    startedAt: Date.now(), allowedOrigin, port: 0 });
  await once(server, 'listening');
  const send = (body: Record<string, unknown>) => fetch('http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/usdt-follow/safe', {
    method: 'POST', headers: { Origin: allowedOrigin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, campaigns: [], ...body }),
  });
  try {
    const first = await (await send({ command: 'status' })).json();
    expect(first.executionSafety).toBe(2);
    const resume = { command: 'resume', controlRevision: first.controlRevision };
    expect((await send(resume)).ok).toBe(true);
    const paused = await (await send({ command: 'pause' })).json();
    expect(paused.paused).toBe(true);
    expect((await send({ ...resume, controlRevision: paused.controlRevision, campaigns: null })).status).toBe(400);
    const stale = await send(resume);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ paused: true, staleControl: true, controlRevision: paused.controlRevision });
    expect(store.paused()).toBe(true);
    expect(store.controlRevision()).toBe(paused.controlRevision);
    expect(venue.order).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it('keeps simulated and pre-pause captures from opening real orders after resume', async () => {
  const at = Date.now(), store = makeStore(file()), venue = exchange();
  const runner = createUsdtFollower(store, venue, owner, 'hedge', at);
  runner.ingest([campaign(at)], at);
  runner.pauseNewOrders();
  runner.resumeNewOrders(at + 1000);
  const fresh = campaign(at + 1001);
  runner.ingest([
    { ...fresh, id: 'paper-old', liveEntry: undefined },
    { ...fresh, id: 'stale-capture', liveEntry: { ...fresh.liveEntry!, capturedAt: at } },
    { ...fresh, id: 'missing-size', notional: 200 },
  ], at + 1001);
  await runner.tick(at + 1001);
  expect(venue.order).not.toHaveBeenCalled();
  runner.ingest([{ ...fresh, id: 'valid-live' }], at + 1001);
  await runner.tick(at + 1001);
  expect(venue.order).toHaveBeenCalledTimes(1);
  expect(venue.order.mock.calls[0][2].side).toBe('BUY');
});

it('requires both realtime capture provenance and a sized, valid frozen template for live entry', () => {
  const at = Date.now(), source = { id: 'fixture', symbol, exchange: 'binance' as const, timeMs: at, timeLabel: '', fallbackZone: '' };
  const record: PreEntryRecord = { id: 'entry', roundId: 'round', status: 'matched', startTime: at, cursor: at,
    matchedAt: at, updatedAt: at, readings: [], sample: { id: source.id, source, basis: 'signal', groups: [],
      enteredAt: at, importedAt: at } };
  const round: PreEntryRound = { id: record.roundId, startedAt: at, updatedAt: at, state: 'complete',
    instantTrading: true, hours: 1, filters: [] };
  const rows = (round: PreEntryRound) => usdtFollowCampaigns({
    admitted: [{ record, round }], alerts: new Map(), enabled: false, active: 0,
    awaitingMail: 0, error: '', saving: false, setEnabled: async () => {},
  });
  expect(rows({ ...round, liveCapturedAt: at })[0]).toMatchObject({ notional: 200 });
  expect(rows({ ...round, liveCapturedAt: at })[0].liveEntry).toBeUndefined();
  const plan = freezeQualityPlan({ ...makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE, '>=', 3, []),
    positionManagement: { version: QUALITY_POSITION_MANAGEMENT_VERSION, leverage: 7, notional: 333 } });
  const instantMonitor = { version: INSTANT_TEMPLATE_MONITOR, templateId: 'frozen-plan', name: 'fixture', plan };
  expect(rows({ ...round, instantMonitor })[0].liveEntry).toBeUndefined();
  expect(rows({ ...round, liveCapturedAt: at, instantMonitor })[0].liveEntry)
    .toMatchObject({ capturedAt: at, notional: 333, leverage: 7, templateId: 'frozen-plan' });
  const altered = { ...instantMonitor, plan: { ...plan, positionManagement: { ...plan.positionManagement!, notional: 400 } } };
  expect(rows({ ...round, liveCapturedAt: at, instantMonitor: altered })[0].liveEntry).toBeUndefined();
});
function exchange() {
  let id = 0;
  const orders = new Map<string, { id: string; order: UsdtOrder; at: number }>();
  const readCampaign = vi.fn(async (anchor: { openingOrderId: string; positionSide: 'LONG' | 'BOTH' }): Promise<UsdtLiveCampaign> => {
    const ordersForCampaign = [...orders.values()].filter(row => Number(row.id) >= Number(anchor.openingOrderId));
    const opening = ordersForCampaign[0];
    if (!opening) throw Error('fixture opening order missing');
    let held = 0;
    let closedAt: number | undefined;
    const fills: UsdtCampaignFill[] = [];
    for (const row of ordersForCampaign) {
      const { side, quantity } = row.order;
      const units = quantityUnits(quantity, market.step);
      held += side === 'BUY' ? units : -units;
      fills.push({ id: row.id, orderId: row.id, at: row.at, side, quantity, positionQuantity: quantity,
        price: row.order.limitPrice ?? '4.003', action: row === opening ? 'open' : side === 'BUY' ? 'add' : 'reduce',
        commission: .02, commissionAsset: 'USDT', realized: side === 'SELL' ? .5 : 0 });
      if (!held) { closedAt = row.at; break; }
    }
    return { symbol, direction: 'long', asset: 'USDT', positionSide: anchor.positionSide, openedAt: opening.at,
      quantity: formatQuantity(held, market.step), fills, ...(closedAt ? { closedAt } : {}) };
  });
  return {
    readCampaign,
    account: vi.fn(async () => ({ id: '12345', mode: 'hedge' as const })),
    market: vi.fn(async () => market),
    book: vi.fn(async () => '4.003'),
    check: vi.fn(async () => undefined),
    order: vi.fn<UsdtExchange['order']>(async (_market, _mode, order, send) => {
      if (send) orders.set(order.id, { id: String(++id), order, at: Date.now() });
      const saved = orders.get(order.id);
      if (!saved) return;
      return { exchangeId: saved.id, terminal: true, fills: [{
        id: saved.id, quantity: quantityUnits(order.quantity, market.step), price: Number(order.limitPrice ?? 4.003),
        at: saved.at, commission: .02, commissionAsset: 'USDT', realized: order.side === 'SELL' ? .5 : 0,
      }] };
    }),
  } satisfies UsdtExchange & { readCampaign: typeof readCampaign };
}

it('接手币安手动首仓后用冻结卖出条件，按实际部分成交续算，重启后平掉实际余仓', async () => {
  const m = 60_000, at = Math.floor(Date.now() / m) * m;
  const anchor = { symbol, positionSide: 'LONG' as const, openedAt: at - 50_123, openingOrderId: '200', openingTradeId: '201' };
  let clock = at;
  const opener: UsdtCampaignFill = { id: '201', orderId: '200', side: 'BUY', at: anchor.openedAt,
    quantity: '10.000', positionQuantity: '10.000', price: '4.000', action: 'open', commission: .01, commissionAsset: 'USDT', realized: 0 };
  const actual: UsdtLiveCampaign = { symbol, positionSide: 'LONG', direction: 'long', asset: 'USDT',
    openedAt: anchor.openedAt, quantity: '10.000', fills: [opener] };
  const read = vi.fn(async () => structuredClone(actual));
  const venue = exchange(), name = file();
  const monitor = { version: INSTANT_TEMPLATE_MONITOR, templateId: 'frozen-plan', name: '原方案',
    plan: freezeQualityPlan(makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE, '>=', 5, [])) };
  const runner = createUsdtFollower(makeStore(name), venue, owner, 'hedge', at, read, () => clock);
  const managed = (await runner.adopt(anchor, monitor))!;
  const id = binanceManualId(anchor);
  expect(managed).toMatchObject({ anchor, entryPrice: 4, entryQuantity: 10, monitor });
  expect(await runner.adopt(anchor, { ...monitor, name: '第二个浏览器传了不同模板' })).toMatchObject({ monitor });
  expect(venue.check).toHaveBeenCalledWith(market, 'hedge', 10000, 4, false, 0, 'existing-position', undefined);
  expect(venue.order).not.toHaveBeenCalled();
  const sample = binanceManualSample(managed);
  const seed = binanceManualSeed(managed, sample);
  const add = { at: at + m, price: 4.25, quantity: 5, notional: 21.25, direction: '>' as const,
    reading: 2, threshold: 1, label: '加仓规则', metric: 'CDA', scanFrom: at, barOpenTime: at };
  clock = at + 2*m;
  const addition = binanceManualAdvance(managed, seed, { ...seed, endTime: clock, additionFill: add, additionFills: [add] })!;
  runner.updateManaged(id, managed.revision, addition.checkpoint, addition.decision);
  venue.order.mockImplementationOnce(async (_market, _mode, order, send) => {
    expect(send).toBe(true);
    expect(order.side).toBe('BUY');
    const fill = { id: '203', orderId: '202', side: 'BUY' as const, at: clock + 310,
      quantity: '2.000', positionQuantity: '2.000', price: '4.003', action: 'add' as const,
      commission: .02, commissionAsset: 'USDT', realized: 0 };
    actual.fills.push(fill);
    actual.quantity = '12';
    return { exchangeId: fill.orderId, terminal: true, fills: [{ ...fill, price: Number(fill.price), quantity: 2000 }] };
  });
  await runner.tick();
  const resumed = createUsdtFollower(makeStore(name), venue, owner, 'hedge', at, read, () => clock);
  const position = resumed.managed()[0].position;
  expect(position.checkpoint).toMatchObject({ remainingQuantity: 12, remainingCost: expect.closeTo(48.006),
    additionFills: [{ ...add, price: 4.003, quantity: 2, notional: 8.006 }] });
  expect(position.pending).toBeUndefined();
  clock = at + 4*m;
  const observed = await evaluateInstantMonitor(sample, monitor, clock, async (_row, from, to, plan) =>
    Array.from({ length: (to - from) / plan.step }, (_, i) => ({
      openTime: from + i*plan.step, open: 4.05, high: 4.08, low: 3.7, close: 3.75, volume: 1, takerBuyVolume: .5,
    })), new AbortController().signal, position.checkpoint, undefined, clock);
  expect(observed).toMatchObject({ status: 'closed', entryPrice: 4, endPrice: 3.8 });
  const closing = binanceManualAdvance(position, position.checkpoint!, observed)!;
  resumed.updateManaged(id, position.revision, closing.checkpoint, closing.decision);
  resumed.updateManaged(id, position.revision, closing.checkpoint, closing.decision);
  venue.order.mockImplementationOnce(async (_market, _mode, order, send) => {
    expect(send).toBe(true);
    const fill = { id: '205', orderId: '204', side: 'SELL' as const, at: clock + 101,
      quantity: '12.000', positionQuantity: '12.000', price: '3.790', action: 'reduce' as const,
      commission: .02, commissionAsset: 'USDT', realized: -2.526 };
    actual.fills.push(fill);
    actual.quantity = '0';
    actual.closedAt = fill.at;
    return { exchangeId: fill.orderId, terminal: true,
      fills: [{ ...fill, price: Number(fill.price), quantity: quantityUnits(order.quantity, market.step) }] };
  });
  await resumed.tick();
  expect(venue.order.mock.calls.map(([, , order]) => [order.side, order.quantity])).toEqual([['BUY', '5.308'], ['SELL', '12.000']]);
  expect(resumed.statuses()[0]).toMatchObject({ state: 'closed', quantity: 0 });
  expect(resumed.managedArchive(id)).toMatchObject({ monitor, exitReason: expect.stringContaining('回撤') });
  expect(resumed.managed()).toHaveLength(0);
});

it('continues the frozen monitor from the real quantity and realized PnL after an exchange reduction', async () => {
  const at = Date.now(), anchor = { symbol, positionSide: 'LONG' as const, openedAt: at - 50_123,
    openingOrderId: '200', openingTradeId: '201' };
  const opener: UsdtCampaignFill = { id:'201', orderId:'200', side:'BUY', at:anchor.openedAt,
    quantity:'10', positionQuantity:'10', price:'4', action:'open', commission:0, commissionAsset:'USDT', realized:0 };
  const actual: UsdtLiveCampaign = { symbol, positionSide:'LONG', direction:'long', asset:'USDT',
    openedAt:anchor.openedAt, quantity:'10', fills:[opener] };
  const venue = exchange();
  const monitor = { version:INSTANT_TEMPLATE_MONITOR, templateId:'frozen-plan', name:'原方案',
    plan:freezeQualityPlan(makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE, '>=', 5, [])) };
  const runner = createUsdtFollower(makeStore(file()), venue, owner, 'hedge', at,
    async()=>structuredClone(actual), ()=>at, ()=>[], async()=>({ observedAt:at, positions:[] }));
  await runner.adopt(anchor,monitor);
  actual.fills.push({ ...opener, id:'203', orderId:'202', at, side:'SELL', action:'reduce',
    quantity:'4', positionQuantity:'4', price:'4.25', realized:1 });
  actual.quantity = '6';
  await runner.tick(at);
  const [{ position, status }] = runner.managed();
  expect(status).toMatchObject({state:'tracking',quantity:6,realizedUsdt:1});
  expect(position.monitor).toEqual(monitor);
  expect(binanceManualSeed(position,binanceManualSample(position))).toMatchObject({
    initialNotional:40,remainingQuantity:6,remainingCost:24,realizedPnl:1,
  });
  expect(venue.order).not.toHaveBeenCalled();
});

it('按方案的 U 本位名义额下首仓，使用逐笔成交跟随镜像、加仓、手动减仓和清仓', async () => {
  const at = Date.now(), store = makeStore(file()), venue = exchange();
  const runner = createUsdtFollower(store, venue, owner, 'hedge', at, venue.readCampaign);
  const open = campaign(at);
  runner.ingest([open], at);
  await runner.tick(at);
  expect(venue.order.mock.calls[0][2]).toMatchObject({ quantity: '24.981', side: 'BUY', limitPrice: '4.003' });
  expect(Number(venue.order.mock.calls[0][2].quantity) * 4.003).toBeLessThanOrEqual(100);
  for (const action of [
    { id: 'mirror', at: at + 1, action: 'mirror', fraction: .4 },
    { id: 'add-1', at: at + 2, action: 'add', notional: 40 },
    { id: 'support-1', at: at + 3, action: 'support-reduction', fraction: .2 },
    { id: 'manual-1', at: at + 4, action: 'manual-reduction', fraction: .5 },
    { id: 'close', at: at + 5, action: 'close' },
  ] as const) {
    open.actions.push(action);
    runner.ingest([structuredClone(open)], at + 5);
    await runner.tick(at + 5);
  }
  expect(venue.order.mock.calls.map(([, , order]) => [order.side, order.quantity])).toEqual([
    ['BUY', '24.981'], ['SELL', '9.992'], ['BUY', '9.992'], ['SELL', '4.996'], ['SELL', '9.992'], ['SELL', '9.993'],
  ]);
  expect(runner.statuses()[0]).toMatchObject({ state: 'closed', quantity: 0, realizedUsdt: 2 });
  expect(runner.statuses()[0].executions).toHaveLength(6);
  expect(venue.readCampaign).toHaveBeenCalledTimes(5);
});

it('确认超时只按原订单号对账，重启后也只发一次', async () => {
  const at = Date.now(), name = file(), store = makeStore(name), venue = exchange();
  const original = venue.order.getMockImplementation()!;
  venue.order.mockImplementationOnce(async (...args) => { await original(...args); return undefined; });
  const runner = createUsdtFollower(store, venue, owner, 'hedge', at);
  runner.ingest([campaign(at)], at);
  await runner.tick(at);
  expect(runner.statuses()[0].state).toBe('blocked');
  const recovered = createUsdtFollower(makeStore(name), venue, owner, 'hedge', at + 10);
  await recovered.tick(at + 10);
  expect(venue.order.mock.calls.map(([, , order, send]) => [order.id, send])).toEqual([
    [venue.order.mock.calls[0][2].id, true], [venue.order.mock.calls[0][2].id, false],
  ]);
  expect(recovered.statuses()[0]).toMatchObject({ state: 'tracking', quantity: 24.981 });
});

it('核实原首仓后，买单回报不明仍可市价只减仓，重启继续按原单号对账', async () => {
  const at = Date.now(), name = file(), venue = exchange();
  const original = venue.order.getMockImplementation()!;
  const signal = campaign(at);
  const addId = usdtOrderId(owner, signal.id, 'add-1');
  const closeId = usdtOrderId(owner, signal.id, 'close');
  let canReadBuy = false, sentClose = false;
  venue.order.mockImplementation(async (...args) => {
    const [, , order, send] = args;
    if (order.id === addId) return canReadBuy ? { terminal: true, fills: [] } : undefined;
    const report = await original(...args);
    if (order.id === closeId && send) { sentClose = true; return undefined; }
    return report;
  });
  const runner = createUsdtFollower(makeStore(name), venue, owner, 'one-way', at, venue.readCampaign);
  runner.ingest([signal], at);
  await runner.tick(at);
  const actions: UsdtFollowCampaign['actions'] = [...signal.actions, { id: 'add-1', action: 'add', at: at + 1000, notional: 50 }];
  runner.ingest([{ ...signal, actions }], at + 1000);
  await runner.tick(at + 1000);
  runner.ingest([{ ...signal, actions: [...actions, { id: 'close', action: 'close', at: at + 5000 }] }], at + 5000);
  await runner.tick(at + 5000);
  expect(sentClose).toBe(true);
  expect(venue.check).toHaveBeenLastCalledWith(market, 'one-way', 24981, 4.003, false, 0, undefined, undefined, addId);
  expect(venue.order.mock.calls.find(([, , order]) => order.id === closeId)?.[2]).toMatchObject({ side: 'SELL', quantity: '24.981' });
  const recovered = createUsdtFollower(makeStore(name), venue, owner, 'one-way', at + 6000, venue.readCampaign);
  await recovered.tick(at + 6000);
  expect(venue.order.mock.calls.at(-1)?.slice(2)).toEqual([expect.objectContaining({ id: closeId }), false]);
  expect(recovered.statuses()[0]).toMatchObject({ state: 'blocked', quantity: 0, issue: expect.stringContaining('买单回报') });
  canReadBuy = true;
  await recovered.tick(at + 7000);
  expect(venue.order.mock.calls.at(-1)?.slice(2)).toEqual([expect.objectContaining({ id: addId }), false]);
  expect(recovered.statuses()[0]).toMatchObject({ state: 'closed', quantity: 0 });
  expect(venue.order.mock.calls.filter(([, , order, send]) => send && order.id === addId)).toHaveLength(1);
  expect(venue.order.mock.calls.filter(([, , order, send]) => send && order.side === 'SELL')).toHaveLength(1);
});

it.each(['add', 'close'] as const)('同价同量重开后，旧战役的 %s 操作停在首仓身份核对', async kind => {
  const at = Date.now(), venue = exchange();
  const reader = vi.fn(async (anchor: Parameters<typeof venue.readCampaign>[0]) => {
    const old = await venue.readCampaign(anchor);
    return { ...old, fills: [{ ...old.fills[0], orderId: '900', id: '901' }] };
  });
  const runner = createUsdtFollower(makeStore(file()), venue, owner, 'hedge', at, reader);
  const open = campaign(at);
  runner.ingest([open], at);
  await runner.tick(at);
  const action: UsdtFollowCampaign['actions'][number] = kind === 'add'
    ? { id: 'add-1', at: at + 1000, action: 'add', notional: 25 }
    : { id: 'close', at: at + 1000, action: 'close' };
  runner.ingest([{ ...open, actions: [...open.actions, action] }], at + 1000);
  await runner.tick(at + 1000);
  expect(reader).toHaveBeenCalledOnce();
  expect(venue.order).toHaveBeenCalledOnce();
  expect(runner.statuses()[0]).toMatchObject({ state: 'blocked', issue: expect.stringContaining('另一笔首仓') });
});

it('排除历史开仓、非币安来源和重复输入，暂停后仍处理已持仓的退出', async () => {
  const at = Date.now(), venue = exchange();
  const runner = createUsdtFollower(makeStore(file()), venue, owner, 'hedge', at, venue.readCampaign);
  runner.ingest([campaign(at - 1)], at);
  expect(runner.statuses()).toEqual([]);
  runner.ingest([{ ...campaign(at, { symbol, exchange: 'okx' }), id: 'fish-instant-other' }], at);
  await runner.tick(at);
  expect(venue.order).not.toHaveBeenCalled();
  const open = campaign(at);
  runner.ingest([open], at);
  await runner.tick(at);
  runner.ingest([open], at);
  await runner.tick(at);
  runner.pauseNewOrders();
  runner.ingest([{ ...open, actions: [...open.actions, { id: 'close', at: at + 1, action: 'close' }] }], at + 1);
  await runner.tick(at + 1);
  expect(venue.order.mock.calls.map(([, , order]) => order.side)).toEqual(['BUY', 'SELL']);
});

it('用实际成交回报校验数量和方向，单向卖出发 reduceOnly', async () => {
  const order: UsdtOrder = { id: 'veil-fixture', side: 'SELL', quantity: '3.010', terminal: false };
  const request = vi.fn(async (_method, path, _params) => path === '/fapi/v1/order'
    ? { orderId: '111', executedQty: '3.010', origQty: '3.010', symbol, clientOrderId: order.id, side: 'SELL', positionSide: 'BOTH', status: 'FILLED' }
    : [{ id: '222', orderId: '111', symbol, side: 'SELL', positionSide: 'BOTH', qty: '3.010', price: '25', time: Date.now(),
      commission: '.08', commissionAsset: 'BNB', realizedPnl: '2.5' }]);
  const reply = await createUsdtExchange(request).order(market, 'one-way', order, true);
  expect(request.mock.calls[0][2]).toMatchObject({ reduceOnly: 'true', quantity: order.quantity, type: 'MARKET' });
  expect(reply?.fills[0]).toMatchObject({ id: '222', quantity: 3010, commissionAsset: 'BNB', realized: 2.5 });
  expect(formatQuantity(3010, '0.001')).toBe('3.010');
  expect(() => quantityUnits('3.0101', '0.001')).toThrow();
});

it('本机端口拒绝非配对页面，并要求同账号和配对码', async () => {
  const at = Date.now(), venue = exchange(), allowedOrigin = 'http://127.0.0.1:49000';
  const server = serveUsdtFollower({ owner, token: '1'.repeat(64), exchange: venue, store: makeStore(file()), mode: 'hedge',
    startedAt: at, allowedOrigin, port: 0 });
  await once(server, 'listening');
  const endpoint = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/usdt-follow';
  const call = (origin: string, token: string, who = owner) => fetch(endpoint, { method: 'POST',
    headers: { Origin: origin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: who, campaign: [], command: 'sync', campaigns: [] }) });
  try {
    expect((await call('https://elsewhere.example', '1'.repeat(64))).status).toBe(403);
    expect((await call(allowedOrigin, '2'.repeat(64))).status).toBe(401);
    expect((await call(allowedOrigin, '1'.repeat(64), 'other')).status).toBe(403);
    expect(await (await call(allowedOrigin, '1'.repeat(64))).json()).toMatchObject({ connected: true, statuses: [] });
    expect(venue.order).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
