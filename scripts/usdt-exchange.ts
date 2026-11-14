import { createHash, createHmac } from 'node:crypto';
import type { UsdtFill, UsdtOrder } from './usdt-follow-store.ts';

const spot = 'https://api.binance.com';
const futures = 'https://fapi.binance.com';
const tradingPaths = new Set(['/fapi/v1/order', '/fapi/v1/leverage', '/fapi/v1/marginType']);
export type UsdtPositionMode = 'hedge' | 'one-way';
export interface UsdtMarket {
  symbol: string;
  step: string;
  min: number;
  max: number;
  minNotional: number;
}

class UsdtApiError extends Error {
  readonly status: number;
  readonly code?: number;
  constructor(status: number, code?: number) {
    super('币安 U 本位请求失败（HTTP ' + status + (code == null ? '' : '，代码 ' + code) + '）');
    this.status = status;
    this.code = code;
  }
}
export const usdtOrderId = (owner: string, campaign: string, action: string) =>
  'veil-' + createHash('sha256').update(JSON.stringify([owner, campaign, action])).digest('hex').slice(0, 30);

const quantityText = /^\d+(?:\.\d+)?$/;
export function quantityUnits(raw: string, step: string) {
  if (!quantityText.test(raw) || !quantityText.test(step)) throw Error('币安委托数量格式无效');
  const decimals = Math.max(raw.split('.')[1]?.length ?? 0, step.split('.')[1]?.length ?? 0);
  const scaled = (value: string) => BigInt(value.replace('.', '') + '0'.repeat(decimals - (value.split('.')[1]?.length ?? 0)));
  const size = scaled(step);
  const units = scaled(raw);
  if (size <= 0n || units % size !== 0n || units / size > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('币安数量与交易步长不一致');
  return Number(units / size);
}
export function formatQuantity(units: number, step: string) {
  if (!Number.isSafeInteger(units) || units < 0 || !quantityText.test(step)) throw Error('币安委托数量无效');
  const decimals = step.split('.')[1]?.length ?? 0;
  const digits = String(BigInt(units) * BigInt(step.replace('.', ''))).padStart(decimals + 1, '0');
  return decimals ? digits.slice(0, -decimals) + '.' + digits.slice(-decimals) : digits;
}

type Json = any;
type UsdtRequest = (method: 'GET' | 'POST', path: string, params?: Record<string, string>) => Promise<Json>;
export function createUsdtRequest(credentials: { apiKey: string; secret: Buffer }, fetcher: typeof fetch = fetch): UsdtRequest {
  const clocks = new Map<string, { offset: number; sampled: number }>();
  const send = async (method: 'GET' | 'POST', path: string, params: Record<string, string>) => {
    const base = path.startsWith('/fapi/') ? futures : spot;
    if (!/^\/(?:fapi|sapi|api)\/v\d+\/(?:[a-zA-Z]+\/)*[a-zA-Z0-9]+$/.test(path)
      || (method === 'POST' && !tradingPaths.has(path))) throw Error('币安签名请求路径无效');
    const signal = AbortSignal.timeout(10_000);
    let clock = clocks.get(base);
    if (!clock || Date.now() - clock.sampled >= 30_000 || Date.now() < clock.sampled) {
      const response = await fetcher(base + (base === futures ? '/fapi/v1/time' : '/api/v3/time'), { redirect: 'error', signal });
      if (!response.ok) throw new UsdtApiError(response.status);
      const { serverTime } = await response.json();
      if (!Number.isSafeInteger(serverTime) || serverTime <= 0) throw Error('币安服务器时钟不可用');
      clock = { sampled: Date.now(), offset: serverTime - Date.now() };
      clocks.set(base, clock);
    }
    const query = new URLSearchParams({ ...params, recvWindow: method === 'GET' ? '12000' : '5000', timestamp: String(Date.now() + clock.offset) });
    query.set('signature', createHmac('sha256', credentials.secret).update(query.toString()).digest('hex'));
    const response = await fetcher(base + path + (method === 'GET' ? '?' + query : ''), {
      method, redirect: 'error', signal,
      headers: { 'X-MBX-APIKEY': credentials.apiKey, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      ...(method === 'POST' ? { body: query.toString() } : {}),
    });
    const body = await response.text().then(text => JSON.parse(text, (key, value, context?: { source?: string }) =>
      ['orderId', 'uid', 'id', 'algoId'].includes(key) && typeof value === 'number' && /^\d+$/.test(context?.source ?? '') ? context!.source : value,
    )).catch(() => undefined);
    if (body?.code === -1021) clocks.delete(base);
    if (!response.ok || body?.code < 0) throw new UsdtApiError(response.status, typeof body?.code === 'number' ? body.code : undefined);
    if (body == null) throw Error('币安响应不可识别');
    return body;
  };
  return async (method, path, params = {}) => {
    try { return await send(method, path, params); }
    catch (error) {
      if (method === 'GET' && (error instanceof TypeError || error instanceof DOMException
        || error instanceof UsdtApiError && (error.code === -1021 || error.status >= 500))) return send(method, path, params);
      throw error;
    }
  };
}

export async function readUsdtMarket(symbol: string, fetcher: typeof fetch = fetch): Promise<UsdtMarket | undefined> {
  if (!/^[A-Z0-9]{2,24}USDT$/.test(symbol)) return;
  const response = await fetcher(futures + '/fapi/v1/exchangeInfo', { signal: AbortSignal.timeout(9000), redirect: 'error' });
  if (!response.ok) throw new UsdtApiError(response.status);
  const body = await response.json();
  if (!Array.isArray(body.symbols)) throw Error('无法读取币安合约规格');
  const contract = body.symbols.find((row: Json) => row.symbol === symbol && row.quoteAsset === 'USDT' && row.marginAsset === 'USDT'
    && row.contractType === 'PERPETUAL' && row.status === 'TRADING');
  if (!contract) return;
  const lot = contract.filters?.find((row: Json) => row.filterType === 'LOT_SIZE');
  const marketLot = contract.filters?.find((row: Json) => row.filterType === 'MARKET_LOT_SIZE');
  const minimum = contract.filters?.find((row: Json) => row.filterType === 'MIN_NOTIONAL');
  const step = lot?.stepSize;
  const minNotional = Number(minimum?.notional);
  if (typeof step !== 'string' || Number(step) <= 0 || !Number.isFinite(minNotional) || minNotional < 0) throw Error('合约市价单规格不完整');
  const min = Math.max(1, Math.ceil(Math.max(Number(lot.minQty), Number(marketLot.minQty)) / Number(step) - 1e-9));
  const max = Math.floor(Math.min(Number(lot.maxQty), Number(marketLot.maxQty)) / Number(step) + 1e-9);
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) throw Error('合约市价单数量范围不可用');
  return { symbol, step, min, max, minNotional };
}

export function createUsdtExchange(request: UsdtRequest, fetcher: typeof fetch = fetch) {
  const positionSide = (mode: UsdtPositionMode) => mode === 'hedge' ? 'LONG' : 'BOTH';
  return {
    async account() {
      const [user, key, account, mode] = await Promise.all([
        request('GET', '/api/v3/account', { omitZeroBalances: 'true' }),
        request('GET', '/sapi/v1/account/apiRestrictions'),
        request('GET', '/fapi/v3/account'),
        request('GET', '/fapi/v1/positionSide/dual'),
      ]);
      if (!/^[1-9]\d*$/.test(String(user.uid)) || key.enableReading !== true || key.enableFutures !== true || key.ipRestrict !== true
          || typeof mode.dualSidePosition !== 'boolean' || !Array.isArray(account.assets) || !Array.isArray(account.positions)
          || account.canTrade === false) throw Error('币安 U 本位账户、合约权限或 IP 白名单未通过验证');
      return { id: String(user.uid), mode: (mode.dualSidePosition ? 'hedge' : 'one-way') as UsdtPositionMode };
    },
    async market(symbol: string) { return readUsdtMarket(symbol, fetcher); },
    async book(symbol: string, side: UsdtOrder['side']) {
      const p = new URLSearchParams({ symbol });
      const response = await fetcher(futures + '/fapi/v1/ticker/bookTicker?' + p,
        { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (!response.ok) throw new UsdtApiError(response.status);
      const quote = await response.json();
      const price = String(side === 'BUY' ? quote.askPrice : quote.bidPrice);
      if (quote.symbol !== symbol || !quantityText.test(price) || !Number.isFinite(Number(price)) || Number(price) <= 0) throw Error('币安盘口价格无效');
      return price;
    },
    async check(market: UsdtMarket, mode: UsdtPositionMode, held: number, entry: number, opening: boolean, leverage: number) {
      const { symbol } = market;
      const [positions, regular, algo, settings, modes] = await Promise.all([
        request('GET', '/fapi/v3/positionRisk', { symbol }),
        request('GET', '/fapi/v1/openOrders', { symbol }),
        request('GET', '/fapi/v1/openAlgoOrders', { symbol }),
        request('GET', '/fapi/v1/symbolConfig', { symbol }),
        request('GET', '/fapi/v1/positionSide/dual'),
      ]);
      if (modes.dualSidePosition !== (mode === 'hedge')) throw Error('币安持仓模式已变化');
      if (![positions, regular, algo, settings].every(Array.isArray)) throw Error('币安仓位或挂单读数不可用');
      if ((regular.length || algo.length) && leverage !== 0) throw Error('该合约有外部挂单，需核对仓位');
      const active = positions.filter((row: Json) => Number(row.positionAmt) !== 0);
      const row = active.find((item: Json) => item.symbol === symbol && item.positionSide === positionSide(mode));
      if (active.some((item: Json) => item !== row)
        || (row ? quantityUnits(String(row.positionAmt), market.step) : 0) !== held
        || (held > 0 && (!Number.isFinite(Number(row.entryPrice)) || Math.abs(Number(row.entryPrice) - entry) > Math.max(1e-8, entry * 1e-5)))) {
        throw Error('币安实际仓位与本机成交记录不一致');
      }
      if (leverage === 0) return; // Reducing exposure never needs to change symbol settings.
      const config = settings.find((item: Json) => item.symbol === symbol);
      if (!config) throw Error('币安合约配置不可用');
      if (opening) {
        if (config.marginType !== 'ISOLATED') {
          try { await request('POST', '/fapi/v1/marginType', { symbol, marginType: 'ISOLATED' }); }
          catch (error) { if (!(error instanceof UsdtApiError) || error.code !== -4046) throw error; }
        }
        if (Number(config.leverage) !== leverage) {
          const result = await request('POST', '/fapi/v1/leverage', { symbol, leverage: String(leverage) });
          if (result.symbol !== symbol || Number(result.leverage) !== leverage) throw Error('币安未确认方案杠杆');
        }
      } else if (config.marginType !== 'ISOLATED' || Number(config.leverage) !== leverage) {
        throw Error('币安逐仓或杠杆设置与冻结方案不一致');
      }
    },
    async order(market: UsdtMarket, mode: UsdtPositionMode, order: UsdtOrder, send: boolean) {
      const { symbol } = market;
      const position = positionSide(mode);
      let report: Json;
      if (send) {
        try {
          report = await request('POST', '/fapi/v1/order', { symbol, side: order.side, positionSide: position,
            ...(order.limitPrice ? { type: 'LIMIT', timeInForce: 'IOC', price: order.limitPrice } : { type: 'MARKET' }),
            quantity: order.quantity, newClientOrderId: order.id, newOrderRespType: 'RESULT',
            ...(mode === 'one-way' && order.side === 'SELL' ? { reduceOnly: 'true' } : {}) });
        } catch (error) {
          if (error instanceof UsdtApiError && [-1013, -1021, -1102, -1111, -2014, -2015, -2019, -2022, -4164].includes(error.code ?? 0)) {
            return { terminal: true, fills: [], issue: error.message };
          }
        }
      }
      if (!report) {
        try { report = await request('GET', '/fapi/v1/order', { symbol, origClientOrderId: order.id }); }
        catch (error) { if (error instanceof UsdtApiError && error.code === -2013) return; throw error; }
      }
      if (report.symbol !== symbol || report.clientOrderId !== order.id || report.side !== order.side || report.positionSide !== position
        || !/^\d+$/.test(String(report.orderId)) || quantityUnits(String(report.origQty), market.step) !== quantityUnits(order.quantity, market.step)) {
        throw Error('币安订单回报与委托不一致');
      }
      const terminal = ['FILLED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'CANCELED', 'REJECTED'].includes(report.status);
      const filled = quantityUnits(String(report.executedQty), market.step);
      if (!terminal && !['NEW', 'PARTIALLY_FILLED'].includes(report.status)) throw Error('币安订单状态不可识别');
      if (filled > quantityUnits(order.quantity, market.step)
        || report.status === 'FILLED' && filled !== quantityUnits(order.quantity, market.step)) throw Error('币安累计成交量超过委托');
      const trades = filled ? await request('GET', '/fapi/v1/userTrades', { symbol, orderId: String(report.orderId), limit: '1000' }) : [];
      if (!Array.isArray(trades)) throw Error('币安逐笔成交回报无效');
      const ids = new Set<string>();
      const fills: UsdtFill[] = trades.map((trade: Json) => {
        const id = String(trade.id), price = Number(trade.price), at = Number(trade.time);
        const quantity = quantityUnits(String(trade.qty), market.step), commission = Number(trade.commission), realized = Number(trade.realizedPnl);
        if (trade.symbol !== symbol || String(trade.orderId) !== String(report.orderId) || trade.side !== order.side || trade.positionSide !== position
          || !/^\d+$/.test(id) || ids.has(id) || quantity <= 0 || !Number.isFinite(price) || price <= 0
          || !Number.isSafeInteger(at) || at <= 0 || !Number.isFinite(commission) || !Number.isFinite(realized)
          || typeof trade.commissionAsset !== 'string' || !trade.commissionAsset) throw Error('币安成交身份或金额不符');
        ids.add(id);
        return { id, quantity, price, at, commission, commissionAsset: trade.commissionAsset, realized };
      });
      if (fills.reduce((units, fill) => units + fill.quantity, 0) !== filled) return;
      return { exchangeId: String(report.orderId), terminal, fills, issue: terminal && !filled ? '币安订单已终止，未成交' : undefined };
    },
  };
}
export type UsdtExchange = ReturnType<typeof createUsdtExchange>;
