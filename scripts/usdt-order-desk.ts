import type { UsdtDeskOpenRequest, UsdtDeskOrderSpec, UsdtDeskQuote } from '../src/lib/fish/usdtOrderDesk.ts';
import type { UsdtPositionControlResult } from '../src/lib/fish/usdtPositionControls.ts';
import { formatQuantity, quantityUnits, readUsdtMark, UsdtApiError, usdtOrderId, type UsdtExchange, type UsdtMarket, type UsdtPositionMode, type UsdtRequest } from './usdt-exchange.ts';
import type { openUsdtFollowStore } from './usdt-follow-store.ts';

export const regularOrderPath = '/fapi/v1/order', conditionalOrderPath = '/fapi/v1/algoOrder';
const symbolPattern = /^[A-Z0-9]{2,24}USDT$/;
const decimal = /^\d{1,20}(?:\.\d{1,18})?$/;
const positive = (value: unknown): value is string => typeof value === 'string' && decimal.test(value) && Number(value) > 0;
const validId = (value: unknown) => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/.test(value);

export function validDeskOrder(order: UsdtDeskOrderSpec | undefined): order is UsdtDeskOrderSpec {
  if (order?.type === 'limit') return positive(order.price) && ['GTC','IOC','FOK','GTX'].includes(order.timeInForce);
  if (order?.type === 'conditional') return positive(order.triggerPrice);
  return order?.type === 'market' && (order.slippage === undefined ||
    Number.isFinite(order.slippage) && order.slippage >= .01 && order.slippage <= 10);
}

type Wire = { path: string; params: Record<string,string> };

export async function deskOrderParameters(order: UsdtDeskOrderSpec, market: UsdtMarket, side: 'BUY' | 'SELL',
  clientId: string, mark: number, book: () => Promise<string>): Promise<Wire> {
  const tick = market.priceTick;
  const checkedPrice = (price: string) => {
    if (!tick || !quantityUnits(price, tick)) throw Error('价格不符合币安最小价格单位');
    return price;
  };
  const regular = { newClientOrderId: clientId, newOrderRespType: 'RESULT' };
  if (order.type === 'limit') return { path: regularOrderPath,
    params: { ...regular, type:'LIMIT', price:checkedPrice(order.price), timeInForce:order.timeInForce } };
  if (order.type === 'conditional') {
    const triggerPrice = checkedPrice(order.triggerPrice), trigger = Number(triggerPrice);
    if (!(mark > 0) || mark === trigger) throw Error('触发价须与币安当前标记价不同');
    const stop = (side === 'BUY') === (trigger > mark);
    return { path: conditionalOrderPath, params: { algoType:'CONDITIONAL', type:stop ? 'STOP_MARKET' : 'TAKE_PROFIT_MARKET',
      workingType:'MARK_PRICE', triggerPrice, clientAlgoId:clientId } };
  }
  if (order.slippage !== undefined) {
    if (!tick) throw Error('无法核对币安最小价格单位');
    const multiplier = 1 + (side === 'BUY' ? 1 : -1) * order.slippage / 100;
    const boundary = Number(await book()) * multiplier / Number(tick);
    const ticks = side === 'BUY' ? Math.floor(boundary) : Math.ceil(boundary);
    return { path: regularOrderPath, params: { ...regular, type:'LIMIT',
      price:checkedPrice(formatQuantity(ticks, tick)), timeInForce:'IOC' } };
  }
  return { path: regularOrderPath, params: { ...regular, type:'MARKET' } };
}

type Stored = { fingerprint: string; symbol: string; side: 'BUY' | 'SELL'; positionSide: string; quantity: string;
  wire: Wire; sentAt: number; result?: UsdtPositionControlResult };

export function createUsdtOrderDesk(request: UsdtRequest, exchange: UsdtExchange, store: ReturnType<typeof openUsdtFollowStore>,
  owner: string, mode: UsdtPositionMode, checkOpening: (symbol: string) => Promise<void>, clock = Date.now, markPrice = readUsdtMark) {
  const contracts = new Map<string, { market: UsdtMarket; expires: number }>();
  const marketFor = async (symbol: unknown) => {
    if (typeof symbol !== 'string' || !symbolPattern.test(symbol)) throw Error('请选择币安 USDT 永续合约');
    const cached = contracts.get(symbol);
    if (cached && cached.expires > clock()) return cached.market;
    const market = await exchange.market(symbol);
    if (!market?.priceTick) throw Error('该合约的交易规格暂不可用');
    contracts.set(symbol, { market, expires: clock() + 60_000 });
    return market;
  };
  const details = async (symbol: string, market: UsdtMarket): Promise<UsdtDeskQuote> => {
    const [account, config, mark, ask, bid] = await Promise.all([
      request('GET','/fapi/v3/account'), request('GET','/fapi/v1/symbolConfig',{ symbol }),
      markPrice(symbol), exchange.book(symbol,'BUY'), exchange.book(symbol,'SELL'),
    ]);
    const available = account.assets?.find(row => row.asset === 'USDT')?.availableBalance;
    const terms = config?.find(row => row.symbol === symbol);
    const leverage = Number(terms?.leverage), maxNotional = terms?.maxNotionalValue;
    if (!decimal.test(String(available)) || !positive(String(maxNotional)) || !Number.isInteger(leverage) || leverage < 1 ||
      !positive(mark)) throw Error('币安仓位配置或可用余额暂不可用');
    return { symbol, ask, bid, mark, available:String(available), leverage, priceTick:market.priceTick!,
      orderStep:market.step, marketStep:market.marketStep && Number(market.marketStep) > 0 ? market.marketStep : market.step,
      maxQuantity:formatQuantity(market.max, market.step), maxNotional:String(maxNotional) };
  };
  const info = async (symbol: unknown) => {
    const market = await marketFor(symbol);
    return details(market.symbol, market);
  };
  async function execute(value: UsdtDeskOpenRequest): Promise<UsdtPositionControlResult> {
    if (!value || !validId(value.id) || !symbolPattern.test(value.symbol) || !['long','short'].includes(value.direction) ||
      !positive(value.quantity) || !validDeskOrder(value.order)) throw Error('开仓委托参数无效');
    const { id, symbol, direction, quantity, order } = value;
    const fingerprint = JSON.stringify([symbol,direction,quantity,order]);
    let row = store.getDeskOrder<Stored>(id);
    if (row && row.fingerprint !== fingerprint) throw Error('同一实盘委托编号的参数不一致');
    if (row?.result) return row.result;
    let response;
    if (!row) {
      if (store.pendingDeskOrders<Stored>().some(item => item.symbol === symbol))
        throw Error('同一合约上一笔开仓仍在核对，请先查原编号');
      await checkOpening(symbol);
      const market = await marketFor(symbol);
      const [quote, currentMode, rawPositions] = await Promise.all([details(symbol,market),
        request('GET','/fapi/v1/positionSide/dual'), request('GET','/fapi/v3/positionRisk',{ symbol })]);
      if (currentMode.dualSidePosition !== (mode === 'hedge') || !Array.isArray(rawPositions)) throw Error('币安仓位模式或仓位数据已变化');
      const side = direction === 'long' ? 'BUY' : 'SELL', positionSide = mode === 'one-way' ? 'BOTH' : direction === 'long' ? 'LONG' : 'SHORT';
      if (mode === 'one-way' && rawPositions.some(item => Number(item.positionAmt) && (Number(item.positionAmt) > 0) !== (side === 'BUY')))
        throw Error('单向模式中有反向仓位，请先在平仓栏处理');
      const units = quantityUnits(quantity, market.step);
      if (units < market.min || units > market.max) throw Error('数量超出币安单笔委托规格');
      if (order.type !== 'limit') quantityUnits(quantity, quote.marketStep);
      const book = side === 'BUY' ? quote.ask : quote.bid;
      const basis = Number(order.type === 'limit' ? order.price : order.type === 'conditional' ? order.triggerPrice : book);
      const notional = Number(quantity) * basis;
      if (notional < market.minNotional) throw Error('低于币安最低委托金额');
      if (notional > Math.min(Number(quote.available) * quote.leverage, Number(quote.maxNotional)))
        throw Error('币安可用保证金或合约额度不足');
      const wire = await deskOrderParameters(order,market,side,usdtOrderId(owner,'desk-open',id),Number(quote.mark),async()=>book);
      row = { fingerprint, symbol, side, positionSide, quantity, wire, sentAt:clock() };
      store.saveDeskOrder(id,row,true);
      const params = Object.fromEntries(Object.entries(wire.params).filter(([, item]) => typeof item === 'string')) as Record<string,string>;
      try { response = await request('POST',wire.path,{ ...params, symbol, side, positionSide, quantity }); }
      catch (error) {
        if (error instanceof UsdtApiError && [-1013,-1021,-1100,-1102,-1111,-2019,-2021,-4164].includes(error.code ?? 0)) {
          row.result = { issue:error.message };
          store.saveDeskOrder(id,row,false);
          return row.result;
        }
      }
    }
    const { wire } = row;
    const conditional = wire.path === conditionalOrderPath;
    if (!response) {
      const query = conditional ? { clientAlgoId:wire.params.clientAlgoId! } :
        { symbol, origClientOrderId:wire.params.newClientOrderId! };
      try { response = await request('GET',wire.path,query); }
      catch (error) {
        if (error instanceof UsdtApiError && [-2011,-2013].includes(error.code ?? 0) && clock() - row.sentAt > 60_000) {
          row.result = { issue:'币安未查到原委托，请在币安核对后再操作' };
          store.saveDeskOrder(id,row,false);
          return row.result;
        }
        return { pending:true };
      }
    }
    const reportedId = conditional ? response?.clientAlgoId : response?.clientOrderId;
    if (reportedId !== (wire.params.clientAlgoId ?? wire.params.newClientOrderId) || response?.symbol !== symbol ||
      response?.side !== row.side || response?.positionSide !== row.positionSide) return { pending:true };
    const status = conditional ? response.algoStatus : response.status;
    const filled = Number(response.executedQty) > 0 && Number(response.executedQty) <= Number(quantity)
      ? String(response.executedQty) : undefined;
    if (!['NEW','PARTIALLY_FILLED','FILLED','TRIGGERING','TRIGGERED','FINISHED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','CANCELED'].includes(status))
      return { pending:true };
    row.result = { filledQuantity:filled, issue:['REJECTED','EXPIRED','EXPIRED_IN_MATCH','CANCELED'].includes(status)
      ? (filled ? '部分成交，余量已结束' : '委托未成交，已结束') : undefined };
    store.saveDeskOrder(id,row,false);
    return row.result;
  }
  return { info, execute };
}
