// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { createUsdtPositionControls } from '../../../../scripts/usdt-position-controls';
import { createUsdtPositionReader, decodePositions } from '../../../../scripts/usdt-position-reader';
import { openUsdtFollowStore } from '../../../../scripts/usdt-follow-store';
import { createUsdtExchange, UsdtApiError } from '../../../../scripts/usdt-exchange';
import { serveUsdtFollower } from '../../../../scripts/usdt-follow-server';
import { usdtLiveCampaignId, type UsdtLiveCampaign } from '../usdtLiveCampaign';
import { usdtMirrorRevision } from '../usdtPositionMirror';
import type { UsdtPositionControlRequest } from '../usdtPositionControls';

const owner = 'fixture';
const now = Date.UTC(2026, 10, 16, 3, 30);
const symbol = 'BEATUSDT';
const openedAt = now - 50_000;
const market = { symbol, step: '1', marketStep: '1', priceTick: '0.00001', min: 1, max: 100_000, minNotional: 5 };

function venue({ short = false } = {}) {
  const positionSide = short ? 'SHORT' : 'BOTH';
  const actual: UsdtLiveCampaign = {
    symbol, positionSide, openedAt, direction: short ? 'short' : 'long', asset: 'USDT', quantity: '100',
    fills: [{ id: '101', orderId: '201', at: openedAt, price: '0.08', action: 'open', side: short ? 'SELL' : 'BUY',
      quantity: '100', positionQuantity: '100', realized: 0, commission: 0, commissionAsset: 'USDT' }],
  };
  const raw = { symbol, positionSide, positionAmt: short ? '-100' : '100', entryPrice: '0.08',
    markPrice: '0.08', unRealizedProfit: '0', updateTime: openedAt };
  const readCampaigns = vi.fn(async () => ({ observedAt: now, campaigns: [actual] }));
  const orders = new Map<string, Record<string, string>>();
  const conditional = new Map<string, Record<string, string | boolean>>();
  let dropResponse = false;
  const request = vi.fn(async (method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, string> = {}) => {
    if (method === 'GET') {
      if (path.endsWith('/positionRisk')) return [raw];
      if (path.endsWith('/openAlgoOrders')) return [...conditional.values()];
      if (path.endsWith('/order')) return orders.get(params.origClientOrderId);
      if (path.endsWith('/algoOrder')) return [...conditional.values()].find(row => row.clientAlgoId === params.clientAlgoId);
      if (path.endsWith('/symbolConfig')) return [{ symbol, leverage: 5, marginType: 'ISOLATED' }];
    }
    if (method === 'POST' && path.endsWith('/order')) {
      const result = { ...params, clientOrderId: params.newClientOrderId, status: 'FILLED', executedQty: params.quantity };
      orders.set(result.clientOrderId, result);
      if (dropResponse) throw new TypeError('response lost after POST');
      return result;
    }
    if (method === 'POST' && path.endsWith('/algoOrder')) {
      const id = String(301 + conditional.size);
      const result = { ...params, algoId: id, orderType: params.type, algoStatus: 'NEW',
        reduceOnly: params.reduceOnly === 'true', closePosition: params.closePosition === 'true' };
      conditional.set(id, result);
      return result;
    }
    if (method === 'DELETE' && path.endsWith('/algoOrder')) {
      const [key, order] = [...conditional.entries()].find(([id, row]) => id === params.algoId || row.clientAlgoId === params.clientAlgoId)!;
      conditional.delete(key);
      return { algoId: key, clientAlgoId: order.clientAlgoId, code: '200', msg: 'success' };
    }
    throw Error('Unexpected exchange path or method');
  });
  const store = openUsdtFollowStore(':memory:', 'fixture-account', owner);
  const readMarket = vi.fn(async () => market);
  const invalidate = vi.fn();
  const controls = createUsdtPositionControls(request, store, owner, readMarket, readCampaigns, invalidate, () => now);
  const [position] = decodePositions([raw]);
  const target: UsdtPositionControlRequest['target'] = { symbol, positionSide, openedAt, direction: actual.direction, campaignId: usdtLiveCampaignId(actual),
    revision: usdtMirrorRevision(position) };
  const command = (action: UsdtPositionControlRequest['action']): UsdtPositionControlRequest => ({ id: randomUUID(), target, action });
  return { request, actual, raw, controls, store, command, readCampaigns, position, dropResponse: () => { dropResponse = true; } };
}

it('closes the selected fraction reduce-only and queries the original order after a lost response', async () => {
  const v = venue();
  try {
    v.dropResponse();
    const cmd = v.command({ kind: 'close', fraction: 0.35 });
    await expect(v.controls.execute(cmd)).resolves.toMatchObject({filledQuantity:'35',pending:false});
    await expect(v.controls.execute(cmd)).resolves.toMatchObject({filledQuantity:'35',pending:false});
    await expect(v.controls.execute({ ...cmd, action: { kind: 'close', fraction: 1 } })).rejects.toThrow('请求编号');
    const mutations = v.request.mock.calls.filter(([method]) => method !== 'GET');
    expect(mutations).toEqual([['POST','/fapi/v1/order',expect.objectContaining({
      side:'SELL',positionSide:'BOTH',quantity:'35',reduceOnly:'true',type:'MARKET',
    })]]);
    expect(v.request).toHaveBeenCalledWith('GET','/fapi/v1/order',expect.objectContaining({
      origClientOrderId: mutations[0][2]?.newClientOrderId,
    }));
  } finally { v.store.close(); }
});

it('uses the correct hedge short leg and removes only orders attached to a closed campaign', async () => {
  const v = venue({ short: true });
  try {
    const cmd = v.command({kind:'protect',tp:.07,sl:.09,fraction:1});
    await expect(v.controls.execute(cmd)).resolves.toMatchObject({pending:false});
    const sent = v.request.mock.calls.filter(([method]) => method === 'POST');
    expect(sent.map(([,path,params])=>[path,params])).toEqual([
      ['/fapi/v1/algoOrder',expect.objectContaining({side:'BUY',positionSide:'SHORT',closePosition:'true',type:'STOP_MARKET',triggerPrice:'0.09'})],
      ['/fapi/v1/algoOrder',expect.objectContaining({side:'BUY',positionSide:'SHORT',closePosition:'true',type:'TAKE_PROFIT_MARKET',triggerPrice:'0.07'})],
    ]);
    expect(sent.every(([, ,params])=> !params?.quantity && !params?.reduceOnly)).toBe(true);
    const detail = await v.controls.readDetails({ observedAt: now, positions: [v.position] });
    expect(detail.positions[0].protectionOrders?.map(row => [row.kind,row.triggerPrice])).toEqual([['sl','0.09'],['tp','0.07']]);
    await v.controls.execute(v.command({kind:'cancel',orderId: detail.positions[0].protectionOrders![1].id}));
    v.actual.closedAt = now - 3;
    v.actual.quantity = '0';
    v.raw.positionAmt = '0';
    await v.controls.cleanup();
    const cancels = v.request.mock.calls.filter(([method]) => method === 'DELETE');
    expect(cancels).toHaveLength(2);
    expect(cancels.at(-1)?.[2]).toEqual({clientAlgoId:sent[0][2]?.clientAlgoId});
    expect(v.controls.hasPending()).toBe(false);
  } finally { v.store.close(); }
});

it('refuses a stale revision or an immediately triggered protection without posting anything', async () => {
  const v = venue();
  try {
    await expect(v.controls.execute(v.command({kind:'protect',tp:.07,sl:.075,fraction:.5}))).rejects.toThrow('方向不符');
    const close = v.command({kind:'close',fraction:1});
    v.raw.updateTime += 1;
    await expect(v.controls.execute(close)).rejects.toThrow('仓位已变化');
    expect(v.request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
  } finally { v.store.close(); }
});

it('routes a limit close to the selected leg as a reducing limit and a conditional close as a separate order',async()=>{
  const v=venue();
  try {
    await v.controls.execute(v.command({kind:'close',fraction:.5,order:{type:'limit',price:'0.081',timeInForce:'GTC'}}));
    await v.controls.execute(v.command({kind:'close',fraction:1,order:{type:'conditional',triggerPrice:'0.075'}}));
    const posts=v.request.mock.calls.filter(([method])=>method==='POST');
    expect(posts).toEqual([
      ['POST','/fapi/v1/order',expect.objectContaining({positionSide:'BOTH',side:'SELL',type:'LIMIT',reduceOnly:'true',quantity:'50',price:'0.081'})],
      ['POST','/fapi/v1/algoOrder',expect.objectContaining({positionSide:'BOTH',side:'SELL',type:'STOP_MARKET',reduceOnly:'true',quantity:'100',triggerPrice:'0.075'})],
    ]);
  }finally{v.store.close();}
});

it('cleans the original protection immediately after a confirmed full close and gates reopening on a failed cancellation', async () => {
  const v = venue();
  const request = v.request.getMockImplementation()!;
  let noCancel = true;
  try {
    await v.controls.execute(v.command({ kind: 'protect', tp: null, sl: .075, fraction: 1 }));
    const clientAlgoId = v.request.mock.calls.find(([method]) => method === 'POST')![2]!.clientAlgoId;
    await request('POST', '/fapi/v1/algoOrder', { symbol, clientAlgoId: 'foreign' });
    v.request.mockImplementation(async (method, path, params) => {
      if (method === 'DELETE' && noCancel) throw new TypeError('connection interrupted');
      const result = await request(method, path, params);
      if (method === 'POST' && path === '/fapi/v1/order') {
        v.actual.closedAt = now;
        v.actual.quantity = '0';
        v.raw.positionAmt = '0';
      }
      return result;
    });
    await expect(v.controls.execute(v.command({ kind: 'close', fraction: 1 }))).resolves.toMatchObject({
      filledQuantity: '100', pending: false, issue: expect.stringContaining('条件单'),
    });
    expect(v.request).toHaveBeenCalledWith('DELETE', '/fapi/v1/algoOrder', { clientAlgoId });
    await expect(v.controls.beforeOpening(symbol)).rejects.toThrow('connection interrupted');
    noCancel = false;
    await expect(v.controls.beforeOpening(symbol)).resolves.toBeUndefined();
    expect(await request('GET', '/fapi/v1/openAlgoOrders')).toEqual([expect.objectContaining({ clientAlgoId: 'foreign' })]);
    expect(v.controls.hasPending()).toBe(false);
  } finally { v.store.close(); }
});

it.each(['confirmed', 'rejected', 'lost response'] as const)('retains the original stop until the replacement is %s', async result => {
  const v = venue();
  const replace = (sl: number) => v.command({ kind: 'protect', tp: null, sl, fraction: 1 });
  const readStops = async () => (await v.controls.readDetails({ observedAt: now, positions: [v.position] }))
    .positions[0].protectionOrders?.map(row => row.triggerPrice);
  try {
    await v.controls.execute(replace(.075));
    const request = v.request.getMockImplementation()!;
    let delayed = result === 'lost response';
    v.request.mockImplementation(async (method, path, params) => {
      if (method === 'POST' && path === '/fapi/v1/algoOrder') {
        if (result === 'rejected') throw new UsdtApiError(400, -2021);
        if (delayed) { await request(method, path, params); throw new TypeError('response lost'); }
      }
      if (delayed && method === 'GET' && path === '/fapi/v1/algoOrder') return undefined;
      return request(method, path, params);
    });
    v.request.mockClear();
    const confirmation = await v.controls.execute(replace(.077));
    const actions = () => v.request.mock.calls.filter(([method]) => method !== 'GET').map(([method]) => method);
    if (result === 'rejected') {
      expect(confirmation.issue).toContain('-2021');
      expect(await readStops()).toEqual(['0.075']);
      expect(actions()).toEqual(['POST']);
    } else {
      if (delayed) {
        expect(confirmation.pending).toBe(true);
        expect(await readStops()).toEqual(['0.075', '0.077']);
        expect(actions()).toEqual(['POST']);
        delayed = false;
        await v.controls.cleanup();
      }
      expect(await readStops()).toEqual(['0.077']);
      expect(actions()).toEqual(['POST', 'DELETE']);
    }
  } finally { v.store.close(); }
});

it('requires the paired origin, token and account for a real position control command', async () => {
  const v = venue();
  const token = 'a'.repeat(64), allowedOrigin = 'https://fixture.test';
  const server = serveUsdtFollower({owner, token, exchange:createUsdtExchange(v.request), store:v.store, mode:'one-way',
    startedAt:now, positionRequest:v.request, positionReader:createUsdtPositionReader(v.request,()=>now),
    campaignReader:v.readCampaigns, managedClock:()=>now, allowedOrigin, port:0});
  await once(server,'listening');
  const address = server.address() as {port:number};
  const endpoint = 'http://127.0.0.1:' + address.port + '/api/usdt-follow';
  const send = (origin:string, key:string, account:string) => fetch(endpoint,{method:'POST',
    headers:{Origin:origin,Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({owner:account,command:'position-control',request:v.command({kind:'close',fraction:1})})});
  try {
    expect((await send('https://wrong.test',token,owner)).status).toBe(403);
    expect((await send(allowedOrigin,'wrong',owner)).status).toBe(401);
    expect((await send(allowedOrigin,token,'wrong')).status).toBe(403);
    expect(v.request).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    v.store.close();
  }
});
