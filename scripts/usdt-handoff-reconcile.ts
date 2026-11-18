import { createHash } from 'node:crypto';
import { planVersionChanges } from '../src/lib/fish/qualityPlanVersions.ts';
import { instantPositionInput } from '../src/lib/fish/instantCampaign.ts';
import { formatQuantity, quantityUnits, type UsdtExchange, type UsdtRequest, type UsdtPositionMode } from './usdt-exchange.ts';
import type { openUsdtFollowStore } from './usdt-follow-store.ts';
import { handoffHash } from './usdt-handoff.ts';

type Store = ReturnType<typeof openUsdtFollowStore>;
type Row = Record<string, any>;
export interface HandoffEvidence {
  account: string; owner: string; mode: UsdtPositionMode; at: number;
  positions: Row[]; regular: Row[]; algo: Row[]; config: Row[];
  cursors: Record<string, string>;
}
const numeric = /^-?\d{1,30}(?:\.\d{1,18})?$/;
const symbol = /^[A-Z0-9_]{2,32}$/;
const id = /^\d{1,25}$/;
const fail = (message: string): never => { throw Error('交接对账未通过：' + message); };
const array = (raw: unknown): Row[] => Array.isArray(raw) ? raw : fail('币安返回的数据不完整');
const stable = (rows: Row[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const decimal = (value: unknown) => typeof value === 'string' && numeric.test(value) ? value : fail('数量或金额格式无效');
export const readOnlyUsdtRequest = (request: UsdtRequest): UsdtRequest => (method, path, params) => {
  if (method !== 'GET') return Promise.reject(Error('交接对账只允许读取币安'));
  return request(method, path, params);
};
const compare = (a: unknown, b: unknown, message: string) => { if (handoffHash(a) !== handoffHash(b)) fail(message); };

/** Conservative handoff: any execution during the transfer blocks activation and requires a return/re-freeze. */
export async function reconcileUsdtHandoff(store: Store, exchange: UsdtExchange, request: UsdtRequest,
  owner: string, expected?: HandoffEvidence, clock = Date.now): Promise<HandoffEvidence> {
  const read = readOnlyUsdtRequest(request), identity = await exchange.account();
  const remoteClock = async () => {
    const value = await read('GET','/fapi/v1/time');
    if (!Number.isSafeInteger(value?.serverTime) || value.serverTime <= 0) fail('币安时间接口暂不可用');
    return value.serverTime as number;
  };
  const beganAt = await remoteClock();
  const snapshot = store.snapshot();
  if (snapshot.account !== identity.id || snapshot.owner !== owner) fail('币安账户或网站账号不符');
  if (expected && (expected.account !== createHash('sha256').update(identity.id).digest('hex') || expected.owner !== owner || expected.mode !== identity.mode))
    fail('原端与新端的账户或持仓模式不符');
  const take = async () => {
    const [rawPositions, rawRegular, rawAlgo, rawConfig] = await Promise.all([
      read('GET', '/fapi/v3/positionRisk'), read('GET', '/fapi/v1/openOrders'),
      read('GET', '/fapi/v1/openAlgoOrders'), read('GET', '/fapi/v1/symbolConfig'),
    ]);
    const positions = array(rawPositions).filter(row => Number(decimal(row.positionAmt)) !== 0).map(row => {
      if (!symbol.test(row.symbol) || !['LONG', 'SHORT', 'BOTH'].includes(row.positionSide)) fail('仓位身份无效');
      return { symbol: row.symbol, positionSide: row.positionSide, positionAmt: decimal(row.positionAmt), entryPrice: decimal(row.entryPrice) };
    });
    if (new Set(positions.map(row => row.symbol + ':' + row.positionSide)).size !== positions.length) fail('币安返回重复仓位');
    const regular = array(rawRegular).map(row => {
      if (!symbol.test(row.symbol) || !id.test(String(row.orderId)) || typeof row.clientOrderId !== 'string' ||
        !['BUY', 'SELL'].includes(row.side) || !['LONG', 'SHORT', 'BOTH'].includes(row.positionSide)) fail('普通挂单身份无效');
      return { symbol: row.symbol, orderId: String(row.orderId), clientOrderId: row.clientOrderId,
        side: row.side, positionSide: row.positionSide, status: row.status, type: row.type, timeInForce: row.timeInForce,
        origQty: decimal(row.origQty), executedQty: decimal(row.executedQty), price: decimal(row.price),
        reduceOnly: row.reduceOnly, closePosition: row.closePosition };
    });
    const algo = array(rawAlgo).map(row => {
      if (!symbol.test(row.symbol) || !id.test(String(row.algoId)) || typeof row.clientAlgoId !== 'string' ||
        !['BUY', 'SELL'].includes(row.side) || !['LONG', 'SHORT', 'BOTH'].includes(row.positionSide)) fail('条件挂单身份无效');
      return { symbol: row.symbol, algoId: String(row.algoId), clientAlgoId: row.clientAlgoId,
        side: row.side, positionSide: row.positionSide, algoStatus: row.algoStatus, orderType: row.orderType,
        quantity: decimal(row.quantity ?? '0'), triggerPrice: decimal(row.triggerPrice), price: row.price,
        reduceOnly: row.reduceOnly, closePosition: row.closePosition, workingType: row.workingType };
    });
    const activeSymbols = new Set([...positions, ...regular, ...algo].map(row => row.symbol));
    const config = array(rawConfig).filter(row => activeSymbols.has(row.symbol)).map(row =>
      ({ symbol: row.symbol, marginType: row.marginType, leverage: Number(row.leverage) }));
    if ([...activeSymbols].some(s => !config.some(row => row.symbol === s))) fail('合约杠杆或保证金配置缺失');
    return { positions: stable(positions), regular: stable(regular), algo: stable(algo), config: stable(config) };
  };
  const before = await take();
  const rows = store.readAll(), active = rows.filter(row => !['closed', 'ignored'].includes(row.status.state));
  const known = new Set<string>([...before.positions, ...before.regular, ...before.algo].map(row => row.symbol));
  for (const row of rows) known.add(row.campaign.source.symbol);
  for (const row of [...snapshot.tables.desk_orders, ...snapshot.tables.position_controls]) {
    const value = JSON.parse(String(row.payload));
    if (value.symbol) known.add(value.symbol);
    if (value.target?.symbol) known.add(value.target.symbol);
    // Non-order operations do not have an idempotent exchange order ID. Ambiguity must never be waved through.
    if (value.steps?.some((step: Row) => step.state === 'sent' && !['/fapi/v1/order', '/fapi/v1/algoOrder'].includes(step.path)))
      fail('存在未查明的杠杆、保证金或撤单操作；先在原端按原操作核对');
    if (value.steps?.some((step: Row) => !step.state && !step.retired)) fail('存在尚未完成的多步实盘操作');
  }
  for (const row of active) {
    const frozen = row.campaign.frozenMonitor;
    const monitor = row.managed?.monitor ?? frozen?.admission?.round.instantMonitor;
    if (!monitor?.plan?.frozenVersions?.length || planVersionChanges(monitor.plan).length) fail('持仓缺少原冻结模板或原执行版本');
    if (!row.managed && (!frozen || instantPositionInput(frozen.admission.record, frozen.admission.round)?.id !== row.campaign.id))
      fail('普通跟单缺少原信号与监测状态，请先让原网页同步后重新冻结');
    if (!row.managed && row.orders.open?.fills?.length && !frozen?.checkpoint &&
      clock() - row.campaign.actions[0].at > 120_000) fail('已持有战役缺少监测检查点');
  }
  const cursors: Record<string, string> = {};
  const held = new Map<string, number>();
  for (const s of [...known].sort()) {
    if (!symbol.test(s)) fail('账本存在未知合约代码');
    const relevant = active.filter(row => row.campaign.source.symbol === s);
    const market = relevant.length ? await exchange.market(s) : undefined;
    if (relevant.length && !market) fail('原合约交易规格暂不可用');
    let trades: Row[] = [];
    const recorded = relevant.flatMap(row => Object.values(row.orders).flatMap(order => order.fills ?? []));
    // Pagination by trade ID avoids a silent 1000-fill truncation and preserves original execution identities.
    let from = recorded.length ? recorded.reduce((a, b) => BigInt(a.id) < BigInt(b.id) ? a : b).id : undefined;
    for (let page = 0; ; page++) {
      if (page >= 100) fail('成交记录超过安全分页上限，请先专项核对');
      const part = array(await read('GET', '/fapi/v1/userTrades', { symbol: s, limit: '1000', ...(from ? { fromId: from } : {}) }));
      const seen = new Set(trades.map(t => String(t.id)));
      for (const trade of part) {
        if (trade.symbol !== s || !id.test(String(trade.id)) || !id.test(String(trade.orderId)) ||
          !['BUY', 'SELL'].includes(trade.side) || !['LONG', 'SHORT', 'BOTH'].includes(trade.positionSide) ||
          !Number.isSafeInteger(trade.time) || !numeric.test(String(trade.qty)) || Number(trade.qty) <= 0) fail('逐笔成交身份或数量无效');
        if (seen.has(String(trade.id))) fail('逐笔成交分页重复或未前进');
        seen.add(String(trade.id)); trades.push(trade);
      }
      if (part.length < 1000) break;
      const last = part.reduce((a, b) => BigInt(a.id) > BigInt(b.id) ? a : b);
      const next = String(BigInt(last.id) + 1n);
      if (from && BigInt(next) <= BigInt(from)) fail('逐笔成交分页未前进');
      from = next;
    }
    cursors[s] = trades.length ? trades.reduce((a, b) => BigInt(a) > BigInt(b.id) ? a : String(b.id), '0') : '0';
    if (!market) continue;
    for (const row of relevant) {
      let balance = 0, average = 0;
      const fills: { side: string; quantity: number; price: number; at: number; id: string }[] = [];
      const side = row.managed?.anchor.positionSide ?? (identity.mode === 'hedge' ? 'LONG' : 'BOTH');
      for (const order of Object.values(row.orders)) {
        if (!order.terminal) {
          const report = await exchange.order(market, identity.mode, order, false);
          if (!report || report.terminal || report.exchangeId !== order.exchangeId ||
            handoffHash(report.fills) !== handoffHash(order.fills ?? [])) fail('未决订单尚未稳定，原编号需继续核对');
        }
        for (const fill of order.fills ?? []) {
          const actual = trades.find(t => String(t.id) === fill.id);
          if (!actual || String(actual.orderId) !== order.exchangeId || actual.positionSide !== side || actual.side !== order.side ||
            quantityUnits(String(actual.qty), market.step) !== fill.quantity || Number(actual.price) !== fill.price ||
            actual.time !== fill.at || Number(actual.commission) !== fill.commission ||
            actual.commissionAsset !== fill.commissionAsset || Number(actual.realizedPnl) !== fill.realized) fail('账本逐笔成交与币安不一致');
          fills.push({ ...fill, side: order.side });
        }
      }
      if (new Set(fills.map(fill => fill.id)).size !== fills.length) fail('同一笔成交在账本中重复记载');
      for (const fill of fills.sort((a,b) => a.at-b.at || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))) {
        if (fill.side === 'BUY') average = (average * balance + fill.price * fill.quantity) / (balance + fill.quantity);
        balance += fill.side === 'BUY' ? fill.quantity : -fill.quantity;
        if (balance < 0) fail('账本减仓顺序超过原余仓');
      }
      if (balance < 0) fail('账本减仓超过原余仓');
      const key = s + ':' + side;
      if (held.has(key) && balance) fail('同一仓位存在多个活动战役');
      held.set(key, (held.get(key) ?? 0) + balance);
      const actual = before.positions.find(p => p.symbol === s && p.positionSide === side);
      if (quantityUnits(actual?.positionAmt ?? '0', market.step) !== balance) fail('原战役余仓与币安不一致，不能当作新战役');
      if (balance && (!actual || Math.abs(Number(actual.entryPrice) - average) > Math.max(1e-8,average*1e-5)))
        fail('原战役剩余成本与币安入场均价不一致');
      if (row.managed?.checkpoint?.remainingQuantity != null && !row.managed.pending &&
        Number(formatQuantity(balance, market.step)) !== row.managed.checkpoint.remainingQuantity) fail('冻结监测进度与实际余仓不一致');
    }
  }
  // A new, fully closed trade on another symbol would be invisible to positionRisk. Income closes that gap.
  if (expected) {
    if (!Number.isSafeInteger(expected.at) || expected.at > beganAt + 1000 || beganAt - expected.at > 7 * 24 * 3600_000)
      fail('交接冻结时间无效或已超过七天，需要原端重新冻结');
    for (let page = 1; ; page++) {
      if (page > 100) fail('交接期间账户流水分页超过上限');
      const income = array(await read('GET', '/fapi/v1/income', { startTime: String(Math.max(1, expected.at - 10_000)),
        endTime: String(beganAt), limit: '1000', page: String(page) }));
      if (income.some(t => t.symbol && t.tradeId && (t.incomeType === 'COMMISSION' || t.incomeType === 'REALIZED_PNL') &&
        (!expected.cursors[t.symbol] || BigInt(t.tradeId) > BigInt(expected.cursors[t.symbol])))) fail('交接期间出现了新增成交，请作废接管或反向交接后由原端核对');
      if (income.length < 1000) break;
    }
    compare(cursors, expected.cursors, '交接期间成交记录发生变化，保持只读并按恢复流程处理');
  }
  const after = await take();
  compare(before, after, '对账过程中余仓或挂单发生变化，请重新读取');
  if (expected) compare(before, { positions: expected.positions, regular: expected.regular, algo: expected.algo, config: expected.config },
    '交接期间余仓、挂单或合约配置发生变化，请先恢复原端核对');
  // Pending desk/control orders are known by their original client ID; query them without any resend.
  for (const row of snapshot.tables.desk_orders) {
    const value = JSON.parse(String(row.payload));
    if (!row.pending) continue;
    const conditional = value.wire?.path === '/fapi/v1/algoOrder';
    const params = conditional ? { clientAlgoId: value.wire.params.clientAlgoId } :
      { symbol: value.symbol, origClientOrderId: value.wire?.params.newClientOrderId };
    const report = await read('GET', value.wire?.path, params);
    if (report?.symbol !== value.symbol || report?.side !== value.side || report?.positionSide !== value.positionSide ||
      Number(conditional ? report?.quantity : report?.origQty) !== Number(value.quantity) ||
      !['NEW','PARTIALLY_FILLED','FILLED','TRIGGERING','TRIGGERED','FINISHED','REJECTED','EXPIRED','EXPIRED_IN_MATCH','CANCELED'].includes(conditional ? report?.algoStatus : report?.status) ||
      (conditional ? report?.clientAlgoId !== params.clientAlgoId : report?.clientOrderId !== params.origClientOrderId)) fail('手动开仓的原委托尚未查明');
  }
  for (const row of snapshot.tables.position_controls) {
    const value = JSON.parse(String(row.payload));
    for (const step of value.steps ?? []) {
      if (step.state !== 'sent') continue;
      const conditional = step.path === '/fapi/v1/algoOrder';
      const params = conditional ? { clientAlgoId: step.params.clientAlgoId } :
        { symbol: step.params.symbol, origClientOrderId: step.params.newClientOrderId };
      const report = await read('GET', step.path, params);
      if (report?.symbol !== value.target.symbol || report?.positionSide !== value.target.positionSide ||
        (step.params.side && report?.side !== step.params.side) ||
        (step.params.quantity && Number(conditional ? report?.quantity : report?.origQty) !== Number(step.params.quantity)) ||
        (conditional ? report?.clientAlgoId !== params.clientAlgoId : report?.clientOrderId !== params.origClientOrderId)) fail('仓位操作的原委托尚未查明');
    }
  }
  const at = await remoteClock();
  if (at < beganAt) fail('币安时间读数倒退');
  return { account: createHash('sha256').update(identity.id).digest('hex'), owner, mode: identity.mode, at, ...before, cursors };
}
