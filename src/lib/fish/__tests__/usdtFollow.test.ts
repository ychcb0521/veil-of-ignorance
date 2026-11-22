// @vitest-environment node
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
import { USDT_FOLLOW_MONITOR_BASIS } from '../usdtFollowMonitorBasis';
import {makeQualityHoldingVeto} from '../qualityFilters';
import {MIRROR_DEADLINE_KIND} from '../qualityMirrorDeadline';
import {MIRROR_LOSS_REVIEW_KIND,MIRROR_LOSS_THRESHOLD_VERSION} from '../qualityMirrorLossReview';

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

it('does not backfill an expired open when screening confirms it now or sends it again', async () => {
  const start = Date.now() - 180_000, now = start + 180_000;
  const store = makeStore(file()), venue = exchange();
  const runner = createUsdtFollower(store, venue, owner, 'hedge', start);
  const late = { ...campaign(now - 120_001), admittedAt: now };
  runner.ingest([late], now);
  await runner.tick(now);
  runner.ingest([late], now + 1);
  await runner.tick(now + 1);
  expect(venue.order).not.toHaveBeenCalled();

  runner.ingest([{ ...campaign(now), id: 'fresh-control' }], now);
  await runner.tick(now);
  expect(venue.order).toHaveBeenCalledTimes(1);
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
  const instantPosition = { version: 1 as const, availableUsdt: 2000, marginPct: 5, leverage: 8 };
  const paper = { ...round, instantPosition, liveCapturedAt: at, instantMonitor };
  expect(rows(paper)[0]).toMatchObject({ notional: 800, leverage: 8 });
  expect(rows(paper)[0].liveEntry).toBeUndefined();
  const live = { ...paper, instantPosition: { ...instantPosition, availableUsdt: 1234, balanceObservedAt: at } };
  expect(rows(live)[0].liveEntry).toMatchObject({ notional: 1234 * 0.05 * 8, leverage: 8 });
  expect(rows({ ...live, liveCapturedAt: undefined })[0].liveEntry).toBeUndefined();
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

it.each([
 {label:'原限时版',kind:MIRROR_DEADLINE_KIND,loss:undefined},
 {label:'零亏损门槛版',kind:MIRROR_LOSS_REVIEW_KIND,loss:undefined},
 {label:'可编辑亏损门槛版',kind:MIRROR_LOSS_REVIEW_KIND,loss:{version:MIRROR_LOSS_THRESHOLD_VERSION,unit:'usdt' as const,value:.5}},
])('镜像一小时未成交时，不等模拟价格即由实际执行端发出无任何限价的全余仓卖出（$label）',async({kind,loss})=>{
  const m=60000,at=Math.floor(Date.now()/m)*m;
  let clock=at+59*m;
  const anchor={symbol,positionSide:'LONG' as const,openedAt:at,openingOrderId:'800',openingTradeId:'801'};
  const opener:UsdtCampaignFill={id:'801',orderId:'800',side:'BUY',at,quantity:'10.000',positionQuantity:'10.000',price:'4.000',action:'open',commission:0,commissionAsset:'USDT',realized:0};
  const actual:UsdtLiveCampaign={symbol,positionSide:'LONG',direction:'long',asset:'USDT',openedAt:at,quantity:'10.000',fills:[opener]};
  const read=vi.fn(async()=>structuredClone(actual)),venue=exchange();
  const monitor={version:INSTANT_TEMPLATE_MONITOR,templateId:'deadline-template',name:'镜像限时终止',plan:freezeQualityPlan({
    ...makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE,'>=',5,[]),rule:undefined,
    holdingVetoes:[makeQualityHoldingVeto(kind,'>=',1,true,[],100,loss)],mirrorTakeProfit:{enabled:true,gainPct:2.5,sellPct:50}})};
  const runner=createUsdtFollower(makeStore(file()),venue,owner,'hedge',clock,read,()=>clock);
  const managed=(await runner.adopt(anchor,monitor))!,sample=binanceManualSample(managed),seed=binanceManualSeed(managed,sample);
  clock=at+60*m;
  const observed=await evaluateInstantMonitor(sample,monitor,clock,async(_row,from,to,p)=>Array.from({length:(to-from)/p.step},(_,i)=>({
    openTime:from+i*p.step,open:kind===MIRROR_LOSS_REVIEW_KIND?3.9:4,high:4,low:3.9,close:kind===MIRROR_LOSS_REVIEW_KIND?3.9:4,volume:1,takerBuyVolume:.5})),new AbortController().signal,seed,undefined,clock);
  expect(observed.status,observed.reason).toBe('open');expect(observed.pendingExit?.cause?.kind).toBe(kind);
  const advanced=binanceManualAdvance(managed,seed,observed)!;
  expect(advanced.decision?.kind).toBe('close');
  runner.updateManaged(binanceManualId(anchor),managed.revision,advanced.checkpoint,advanced.decision);
  venue.order.mockImplementationOnce(async(_market,_mode,order,send)=>{
    expect(send).toBe(true);expect(order.side).toBe('SELL');expect(order.quantity).toBe('10.000');expect(order.limitPrice).toBeUndefined();
    const fill:UsdtCampaignFill={...opener,id:'803',orderId:'802',side:'SELL',at:clock+1,price:'3.999',action:'reduce'};
    actual.fills.push(fill);actual.quantity='0';actual.closedAt=fill.at;
    return {exchangeId:fill.orderId,terminal:true,fills:[{...fill,quantity:10000,price:3.999}]};
  });
  await runner.tick();expect(venue.order).toHaveBeenCalledTimes(1);
  await runner.tick();expect(venue.order).toHaveBeenCalledTimes(1);
});

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

it('switches a confirmed live campaign without sending orders and refuses updates from an older plan', async () => {
  const minute = 60_000, clock = Math.floor(Date.now() / minute) * minute + 15_000;
  const anchor = { symbol, positionSide: 'LONG' as const, openedAt: clock - 30_000, openingOrderId: '500', openingTradeId: '501' };
  const actual: UsdtLiveCampaign = { symbol, positionSide: 'LONG', direction: 'long', asset: 'USDT', openedAt: anchor.openedAt,
    quantity: '10.000', fills: [{ id: '501', orderId: '500', side: 'BUY', at: anchor.openedAt, quantity: '10.000',
      positionQuantity: '10.000', price: '4.000', action: 'open', commission: .01, commissionAsset: 'USDT', realized: 0 }] };
  const read = vi.fn(async () => structuredClone(actual));
  const venue = exchange(), name = file();
  const runner = createUsdtFollower(makeStore(name), venue, owner, 'hedge', clock, read, () => clock);
  const monitor = { version: INSTANT_TEMPLATE_MONITOR, templateId: 'before', name: '原方案',
    plan: freezeQualityPlan(makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE, '>=', 5, [])) };
  const target = { ...monitor, templateId: 'after', name: '新方案', plan: freezeQualityPlan(makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE, '>=', 3, [])) };
  await runner.adopt(anchor, monitor);
  const id = binanceManualId(anchor);
  const switched = await runner.runPositionControl(() => runner.switchManaged(id, 0, target));
  const through = Math.ceil(clock / minute) * minute;
  expect(switched).toMatchObject({ monitor: target, planEpoch: 1, checkpoint: { endTime: through, initialNotional: 40,
    instantMonitorSwitches: [{ from: monitor, to: target, effectiveAt: through }] } });
  const replayed = runner.updateManaged(id, switched.revision, switched.checkpoint!);
  expect(replayed.revision).toBe(switched.revision);
  await expect(runner.switchManaged(id, 0, monitor)).rejects.toThrow('已在别处切换');
  actual.quantity = '11';
  await expect(runner.switchManaged(id, 1, monitor)).rejects.toThrow('数量已变化');
  expect(runner.managed()[0].position.monitor).toEqual(target);
  expect(createUsdtFollower(makeStore(name), venue, owner, 'hedge', clock, read, () => clock).managedArchive(id))
    .toMatchObject({ monitor: target, switches: [{ from: monitor, to: target }] });
  expect(venue.order).not.toHaveBeenCalled();
});

it('takes over a followed trade in place using its Binance remainder, counts orders with fills, and ignores old signals', async () => {
  const m = 60_000, now = Math.floor(Date.now() / m)*m + 10_000, openedAt = now - 20*m;
  let clock = now;
  const makeFill = (id: string, orderId: string, at: number, action: UsdtCampaignFill['action'], q: number, price: number, realized = 0): UsdtCampaignFill => ({
    id, orderId, at, side: action === 'reduce' ? 'SELL' : 'BUY', price: String(price), quantity: String(q), positionQuantity: String(q),
    action, commission: .01, commissionAsset: 'USDT', realized,
  });
  const initial = makeFill('700', '800', openedAt, 'open', 10, 4);
  const add1 = makeFill('701', '801', openedAt + m, 'add', 2, 5);
  const add2 = makeFill('702', '801', openedAt + m + 1, 'add', 3, 5);
  const add3 = makeFill('703', '802', openedAt + 2*m, 'add', 5, 6);
  const cut = makeFill('704', '804', openedAt + 4*m, 'reduce', 5, 8, 16.25);
  const actual: UsdtLiveCampaign = { symbol, positionSide: 'LONG', direction: 'long', asset: 'USDT', openedAt, quantity: '15', fills: [initial, add1, add2, add3, cut] };
  const anchor = { symbol, positionSide: 'LONG' as const, openedAt, openingTradeId: initial.id, openingOrderId: initial.orderId };
  const order = (...fills: UsdtCampaignFill[]): UsdtOrder => ({ id: fills[0].orderId, exchangeId: fills[0].orderId, side: fills[0].side,
    terminal: true, quantity: String(fills.reduce((sum, f) => sum + Number(f.quantity), 0)),
    fills: fills.map(fill => ({ ...fill, quantity: quantityUnits(fill.quantity, market.step), price: Number(fill.price) })),
  });
  const storeFile = file(), store = makeStore(storeFile), venue = exchange();
  const followed = campaign(openedAt), id = followed.id;
  followed.actions.push({ id: 'add-1', action: 'add', at: add1.at, notional: 25 }, { id: 'add-2', action: 'add', at: add3.at, notional: 30 },
    { id: 'add-3', action: 'add', at: openedAt + 3*m, notional: 30 }, { id: 'mirror', action: 'mirror', at: cut.at, fraction: .5 });
  store.save({ campaign: followed, status: { id, symbol, state: 'tracking' }, skipped: ['add-3'],
    orders: { open: order(initial), 'add-1': order(add1, add2), 'add-2': order(add3), mirror: order(cut) } });
  const read = async () => structuredClone(actual);
  const readPositions = async () => ({ observedAt: clock, positions: [{ symbol, positionSide: 'LONG' as const,
    direction: 'long' as const, quantity: actual.quantity, entryPrice: '4.75', markPrice: '8', unrealizedPnl: '48.75', updatedAt: clock }] });
  const makeRunner = (from: ReturnType<typeof makeStore>) => createUsdtFollower(from, venue, owner, 'hedge', openedAt, read, () => clock, undefined, readPositions);
  const runner = makeRunner(store);
  const original = { version: INSTANT_TEMPLATE_MONITOR, templateId: 'fixture', name: '跟单原方案', plan: freezeQualityPlan(makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE, '>=', 5, [])) };
  const target = { ...original, templateId: 'next', name: '接续方案', plan: freezeQualityPlan(makeQualitySellPlan(STATIC_DRAWDOWN_SELL_CHOICE, '>=', 3, [])) };
  await expect(runner.switchFollowMonitor(id, { ...anchor, openingTradeId: '999' }, 0, target)).rejects.toThrow('首仓编号');
  const allowedOrigin = 'https://fixture.test', token = 'b'.repeat(64);
  const server = serveUsdtFollower({ owner, token, exchange: venue, store, mode: 'hedge', startedAt: openedAt, allowedOrigin, port: 0,
    positionReader: { positions: readPositions, invalidate: () => {}, history: async () => ({ fills: actual.fills, openedAt }) },
    campaignReader: async () => ({ observedAt: clock, campaigns: [await read()] }), managedClock: () => clock,
    positionRequest: async () => { throw Error('fixture requires no Binance requests'); } });
  await once(server, 'listening');
  const send = async (body: Record<string, unknown>) => fetch('http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/usdt-follow/safe', {
    method: 'POST', headers: { Origin: allowedOrigin, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner, ...body }),
  });
  const command = { command: 'follow-monitor-switch', id, anchor, planEpoch: 0, monitor: target, original, followBasisVersion: USDT_FOLLOW_MONITOR_BASIS };
  let switched: Awaited<ReturnType<typeof runner.switchFollowMonitor>>;
  try {
    expect(await (await send({ command: 'status' })).json()).toMatchObject({ followMonitorSwitch: USDT_FOLLOW_MONITOR_BASIS });
    expect((await send(command)).status).toBe(400);
    const response = await send({ ...command, confirmed: true });
    const converted = await response.json();
    expect(response.ok, JSON.stringify(converted)).toBe(true);
    switched = converted.position;
    expect(await (await send({ command: 'manual-monitor-status' })).json()).toMatchObject({ positions: [] });
    expect(await (await send({ command: 'manual-monitor-status', followBasisVersion: USDT_FOLLOW_MONITOR_BASIS })).json())
      .toMatchObject({ positions: [{ position: switched, status: { id } }] });
    expect(await (await send({ command:'position-campaigns', since: openedAt, open: [] })).json())
      .toMatchObject({ campaigns: [{ followId: id, management: { monitor: target } }] });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  const effectiveAt = Math.ceil(now / m)*m;
  const basis = { version: USDT_FOLLOW_MONITOR_BASIS, effectiveAt, carriedAdditions: 2, entryPrice: 4.75, quantity: 15, realizedBefore: 16.25 };
  expect(switched).toMatchObject({ anchor, entryPrice: 4.75, entryQuantity: 15, planEpoch: 1, followBasis: basis,
    checkpoint: { endTime: effectiveAt, initialNotional: 71.25, realizedPnl: 0, instantMonitorSwitches: [{ from: original, to: target, followBasis: basis }] } });
  expect(switched.checkpoint?.additionFills).toBeUndefined();
  const refreshed = makeRunner(makeStore(storeFile));
  expect(refreshed.managed()).toEqual([]);
  expect(refreshed.managed(true)[0].position).toEqual(switched);
  refreshed.ingest([{ ...followed, actions: [...followed.actions, { id: 'close', action: 'close', at: now }] }]);
  await refreshed.tick();
  expect(venue.order).not.toHaveBeenCalled();
  expect(refreshed.managedArchive(id)).toMatchObject({ monitor: target, switches: [{ from: original, to: target }] });
  const raw = new DatabaseSync(storeFile, {readOnly:true});
  try {
    const saved = JSON.parse(String(raw.prepare('SELECT payload FROM campaigns WHERE id=?').get(id)?.payload));
    expect(saved.status.state).toBe('ignored');
    expect(saved.managed).toBeUndefined();
  } finally { raw.close(); }
  const sample = binanceManualSample(switched), checkpoint = binanceManualSeed(switched, sample);
  expect(sample).toMatchObject({ enteredAt: effectiveAt, binanceEntry: { price: 4.75, quantity: 15, orderId: initial.orderId } });
  const simulatedExit = await evaluateInstantMonitor(sample, target, effectiveAt + m, async (_source, from, to, plan) =>
    Array.from({ length: (to - from) / plan.step }, (_, i) => ({ openTime: from + i * plan.step, open: 4.75,
      high: 4.8, low: 4.5, close: 4.6, volume: 1, takerBuyVolume: .5 })), new AbortController().signal, checkpoint);
  expect(simulatedExit).toMatchObject({ status: 'closed', entryPrice: 4.75, entryTime: effectiveAt, endPrice: expect.closeTo(4.6075), followBasis: basis });
  clock = effectiveAt + m;
  const mirror = { at: effectiveAt, price: 8, fraction: .5, gainPct: 68, atOpen: false };
  const next = binanceManualAdvance(switched, checkpoint, { ...checkpoint, endTime: clock, mirrorFill: mirror })!;
  expect(() => refreshed.updateManaged(id, switched.revision, next.checkpoint, next.decision, 1)).toThrow('更新网页');
  refreshed.updateManaged(id, switched.revision, next.checkpoint, next.decision, 1, USDT_FOLLOW_MONITOR_BASIS);
  venue.order.mockImplementationOnce(async (_market, _mode, sent, send) => {
    expect(send).toBe(true);
    expect(sent).toMatchObject({side:'SELL',quantity:'7.500'});
    const fill = makeFill('705', '805', clock + 500, 'reduce', 7.5, 8, 24.375);
    actual.fills.push(fill);
    actual.quantity = '7.5';
    return {exchangeId:fill.orderId,terminal:true,fills:[{...fill,quantity:7500,price:8}]};
  });
  await refreshed.tick();
  expect(venue.order).toHaveBeenCalledTimes(1);
  expect(refreshed.managed(true)[0].position.checkpoint).toMatchObject({mirrorFill:{fraction:.5},remainingQuantity:7.5,realizedPnl:24.375});
  await expect(refreshed.switchFollowMonitor(id, anchor, 0, original)).rejects.toThrow('已在别处切换');
  const again = await refreshed.switchFollowMonitor(id, anchor, 1, original);
  expect(again.followBasis).toMatchObject({carriedAdditions:2,quantity:7.5,realizedBefore:40.625});
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
