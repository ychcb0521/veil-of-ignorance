import { decodePositions } from './usdt-position-reader.ts';
import { formatQuantity, quantityUnits, UsdtApiError, usdtOrderId, type UsdtMarket, type UsdtRequest } from './usdt-exchange.ts';
import type { openUsdtFollowStore } from './usdt-follow-store.ts';
import type { createUsdtCampaignReader } from './usdt-campaign-reader.ts';
import { deskOrderParameters, validDeskOrder } from './usdt-order-desk.ts';
import { isUsdtLiveCampaignId, usdtLiveCampaignId } from '../src/lib/fish/usdtLiveCampaign.ts';
import { usdtMirrorRevision, usdtPositionDecimal, type UsdtMirrorPosition, type UsdtMirrorSnapshot } from '../src/lib/fish/usdtPositionMirror.ts';
import type {
  UsdtPositionControlRequest, UsdtPositionControlResult, UsdtPositionTarget, UsdtProtectionOrder,
} from '../src/lib/fish/usdtPositionControls.ts';

const riskPath = '/fapi/v3/positionRisk';
const openAlgoPath = '/fapi/v1/openAlgoOrders';
const algoPath = '/fapi/v1/algoOrder';
const orderPath = '/fapi/v1/order';
const configPath = '/fapi/v1/symbolConfig';
const leveragePath = '/fapi/v1/leverage';
const marginPath = '/fapi/v1/positionMargin';
const numberId = /^\d{1,25}$/;
const marketSymbol = /^[A-Z0-9]{2,24}USDT$/;
const positiveDecimal = /^\d{1,20}(?:\.\d{1,18})?$/;
const closingSide = (position: Pick<UsdtPositionTarget, 'direction'>) => position.direction === 'long' ? 'SELL' : 'BUY';
const matchingLeg = (row: UsdtMirrorPosition, target: UsdtPositionTarget) =>
  row.symbol === target.symbol && row.positionSide === target.positionSide && row.direction === target.direction;
const percent = (value: number) => Number.isFinite(value) && value > 0 && value <= 1;

type Algo = UsdtProtectionOrder & { clientId?: string };
type Step = { method: 'POST' | 'DELETE'; path: string; params: Record<string, string>;
  replacementId?: string; state?: 'sent' | 'done' | 'failed'; sentAt?: number;
  issue?: string; filledQuantity?: string; retired?: boolean };
type Stored = { id: string; target: UsdtPositionTarget; fingerprint: string; steps: Step[]; checkedRevision?: string };
type Store = ReturnType<typeof openUsdtFollowStore>;
const isDone = (step: Step) => step.state === 'done';
const isTrackedProtection = (step: Step) => step.method === 'POST' && step.path === algoPath && !step.retired
  && (step.state === 'sent' || step.state === 'done');

function parseCommand(value: UsdtPositionControlRequest, now: number) {
  const { id, target, action } = value ?? {};
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || !target || !marketSymbol.test(target.symbol) ||
    !['BOTH', 'LONG', 'SHORT'].includes(target.positionSide) || !['long', 'short'].includes(target.direction) ||
    !Number.isSafeInteger(target.openedAt) || target.openedAt <= 0 || target.openedAt > now ||
    typeof target.revision !== 'string' || target.revision.length > 300 || !isUsdtLiveCampaignId(target.campaignId) ||
    !action) throw Error('币安实盘操作参数无效');
  switch (action.kind) {
    case 'close': if (percent(action.fraction) && (action.order === undefined || validDeskOrder(action.order))) return value; break;
    case 'protect':
      if (percent(action.fraction) && (action.tp !== null || action.sl !== null) &&
        [action.tp, action.sl].every(price => price === null || Number.isFinite(price) && price > 0)) return value;
      break;
    case 'cancel': if (typeof action.orderId === 'string' && numberId.test(action.orderId)) return value; break;
    case 'leverage': if (Number.isInteger(action.leverage) && action.leverage >= 1 && action.leverage <= 125) return value; break;
    case 'margin': if (Number.isFinite(action.delta) && action.delta !== 0 && positiveDecimal.test(String(Math.abs(action.delta)))) return value; break;
  }
  throw Error('币安实盘操作参数无效');
}

function quantityFor(raw: string, fraction: number, market: UsdtMarket) {
  const step = market.marketStep && Number(market.marketStep) > 0 ? market.marketStep : market.step;
  const lots = quantityUnits(raw, market.step);
  const factor = Number(step) / Number(market.step);
  const marketLots = Math.min(lots, Math.floor(lots * fraction + 1e-9));
  const quantity = formatQuantity(Math.floor(marketLots / factor + 1e-9), step);
  const checked = quantityUnits(quantity, market.step);
  if (checked < market.min || checked > market.max || checked > lots) throw Error('数量不符合币安市价委托上下限，请调整比例');
  if (fraction === 1 && checked !== lots) throw Error('全部平仓的数量与币安市价步长不符，请核对余仓');
  return quantity;
}

function protectionRows(raw: unknown, position: UsdtMirrorPosition): Algo[] {
  if (!Array.isArray(raw)) throw Error('币安止盈止损委托暂不可读');
  return raw.flatMap(row => {
    const tp = row.orderType === 'TAKE_PROFIT_MARKET' || row.orderType === 'TAKE_PROFIT';
    const sl = row.orderType === 'STOP_MARKET' || row.orderType === 'STOP';
    if ((!tp && !sl) || row.symbol !== position.symbol || row.side !== closingSide(position) || row.positionSide !== position.positionSide ||
      !(row.closePosition === true || row.reduceOnly === true || row.positionSide !== 'BOTH') ||
      !numberId.test(String(row.algoId)) || !positiveDecimal.test(String(row.triggerPrice)) || Number(row.triggerPrice) <= 0) return [];
    return [{
      id: String(row.algoId), clientId: typeof row.clientAlgoId === 'string' ? row.clientAlgoId : undefined,
      kind: tp ? 'tp' : 'sl', triggerPrice: String(row.triggerPrice),
      quantity: row.closePosition === true ? undefined : String(row.quantity),
      workingType: row.workingType === 'MARK_PRICE' ? 'MARK_PRICE' : 'CONTRACT_PRICE',
    }];
  });
}

const definitelyRejected = (error: unknown) => error instanceof UsdtApiError && error.status < 500 &&
  (error.status >= 400 || error.code !== undefined) && error.status !== 408 && error.status !== 429 &&
  ![-1000, -1001, -1006, -1007, -4116].includes(error.code ?? 0);

export function createUsdtPositionControls(request: UsdtRequest, store: Store, owner: string,
  readMarket: (symbol: string) => Promise<UsdtMarket | undefined>, readCampaigns: ReturnType<typeof createUsdtCampaignReader>,
  invalidate: () => void, clock = Date.now, readBook?: (symbol: string, side: 'BUY' | 'SELL') => Promise<string>) {
  const rawOrders = (symbol: string) => request('GET', openAlgoPath, { symbol });
  const risk = async (symbol: string) => decodePositions(await request('GET', riskPath, { symbol }));
  const activeCampaign = async (target: UsdtPositionTarget) => (await readCampaigns(Math.max(1, target.openedAt - 1000),
    [{ symbol: target.symbol, openedAt: target.openedAt }], target.symbol)).campaigns
    .find(row => usdtLiveCampaignId(row) === target.campaignId);

  async function freshTarget(target: UsdtPositionTarget) {
    const evidence = await activeCampaign(target);
    const current = (await risk(target.symbol)).find(row => matchingLeg(row, target));
    if (!evidence || evidence.closedAt || evidence.openedAt !== target.openedAt || !current ||
      usdtPositionDecimal(evidence.quantity) !== usdtPositionDecimal(current.quantity) || usdtMirrorRevision(current) !== target.revision)
      throw Error('这笔实盘仓位已变化，请同步后重新确认');
    return current;
  }

  const readDetails = async (snapshot: UsdtMirrorSnapshot) => {
    const symbols = [...new Set(snapshot.positions.map(row => row.symbol))];
    const details = new Map(await Promise.all(symbols.map(async symbol => {
      const [orders, settings] = await Promise.allSettled([rawOrders(symbol), request('GET', configPath, { symbol })]);
      return [symbol, { orders, settings }] as const;
    })));
    return { ...snapshot, positions: snapshot.positions.map(position => {
      const { orders, settings } = details.get(position.symbol)!;
      const config = settings.status === 'fulfilled' && Array.isArray(settings.value) ?
        settings.value.find(row => row.symbol === position.symbol) : undefined;
      const leverage = Number(config?.leverage);
      let protectionOrders: UsdtProtectionOrder[] | undefined;
      let protectionIssue: string | undefined;
      try {
        protectionOrders = protectionRows(orders.status === 'fulfilled' ? orders.value : undefined, position)
          .map(({ clientId, ...order }) => order);
      } catch { protectionIssue = '币安止盈止损暂未同步'; }
      return { ...position, leverage: leverage > 0 ? leverage : position.leverage,
        marginMode: config?.marginType === 'ISOLATED' ? 'isolated' as const : config?.marginType === 'CROSSED' || config?.marginType === 'CROSS' ?
          'cross' as const : position.marginMode, protectionOrders, protectionIssue };
    }) };
  };

  const save = (row: Stored) => {
    store.savePositionControl(row.id, row, row.steps.some(step =>
      isTrackedProtection(step) || trackedLimit(step) || step.state === 'sent'));
    const leverage = row.steps.find(step => step.path === leveragePath && isDone(step));
    if (leverage?.sentAt !== undefined)
      store.savePositionLeverage(row.target.campaignId, { leverage: Number(leverage.params.leverage), at: leverage.sentAt });
  };
  const matchedOrder = (row: any, step: Step) => row?.symbol === step.params.symbol && row?.side === step.params.side &&
    row?.positionSide === step.params.positionSide;
  const protectionMatches = (row: any, step: Step) => matchedOrder(row, step) && row.clientAlgoId === step.params.clientAlgoId &&
    (row.orderType ?? row.type) === step.params.type && Number(row.triggerPrice) === Number(step.params.triggerPrice) &&
    row.workingType === step.params.workingType && (step.params.closePosition === 'true'
      ? row.closePosition === true
      : row.closePosition !== true && Number(row.quantity) === Number(step.params.quantity) &&
        (step.params.reduceOnly !== 'true' || row.reduceOnly === true));

  async function accept(step: Step, response: any) {
    if (step.path === orderPath) {
      if (!matchedOrder(response, step) || response.clientOrderId !== step.params.newClientOrderId ||
        !positiveDecimal.test(String(response.executedQty)) || Number(response.executedQty) > Number(step.params.quantity)) return;
      step.filledQuantity = String(response.executedQty);
      if (step.params.type === 'LIMIT' && ['NEW','PARTIALLY_FILLED'].includes(response.status) &&
        ['GTC','GTX'].includes(step.params.timeInForce)) step.state = 'done';
      if (['FILLED', 'CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED'].includes(response.status)) {
        step.state = 'done';
        if (Number(step.filledQuantity) !== Number(step.params.quantity))
          step.issue = '币安平仓未全部成交，余仓以实际同步为准';
      }
    } else if (step.method === 'DELETE' && numberId.test(String(response?.algoId)) && String(response.algoId) === step.params.algoId) {
      step.state = 'done';
    } else if (step.path === algoPath && protectionMatches(response, step)) {
      if (response.algoStatus === 'NEW') step.state = 'done';
      else if (['CANCELED', 'EXPIRED', 'REJECTED', 'TRIGGERING', 'TRIGGERED', 'FINISHED'].includes(response.algoStatus)) {
        step.state = 'failed';
        step.issue = '币安未确认新保护单仍在挂单中';
      }
    } else if (step.path === leveragePath && response?.symbol === step.params.symbol && Number(response.leverage) === Number(step.params.leverage)) {
      step.state = 'done';
    } else if (step.path === marginPath && Number(response?.code) === 200 && Number(response.amount) === Number(step.params.amount) &&
      Number(response.type) === Number(step.params.type)) {
      step.state = 'done';
    }
  }

  async function recover(step: Step) {
    try {
      if (step.path === orderPath) {
        await accept(step, await request('GET', orderPath, { symbol: step.params.symbol, origClientOrderId: step.params.newClientOrderId }));
      } else if (step.method === 'DELETE') {
        const orders = await rawOrders(step.params.symbol);
        if (Array.isArray(orders) && !orders.some(row => String(row.algoId) === step.params.algoId)) step.state = 'done';
      } else if (step.path === algoPath) {
        await accept(step, await request('GET', algoPath, { clientAlgoId: step.params.clientAlgoId }));
      } else if (step.path === marginPath && step.sentAt !== undefined) {
        const rows = await request('GET', marginPath + '/history', { symbol: step.params.symbol, type: step.params.type,
          startTime: String(step.sentAt), endTime: String(clock()), limit: '100' });
        if (Array.isArray(rows) && rows.some(row => row.symbol === step.params.symbol && row.positionSide === step.params.positionSide &&
          Number(row.type) === Number(step.params.type) && Math.abs(Number(row.amount)) === Number(step.params.amount) &&
          Number(row.time) >= step.sentAt! && Number(row.time) <= step.sentAt! + 30_000)) step.state = 'done';
      } else {
        const rows = await request('GET', configPath, { symbol: step.params.symbol });
        if (Array.isArray(rows)) await accept(step, rows.find(row => row.symbol === step.params.symbol));
      }
    } catch (error) {
      if (error instanceof UsdtApiError && (error.code === -2011 || error.code === -2013) &&
        step.sentAt !== undefined && clock() - step.sentAt > 60_000) {
        step.state = 'failed';
        step.issue = '币安查询不到原委托，已结束核对，请确认当前仓位后重新操作';
      }
    }
  }

  const trackedLimit = (step: Step) => step.path === orderPath && step.params.type === 'LIMIT' &&
    ['GTC','GTX'].includes(step.params.timeInForce) && isDone(step) && !step.retired;

  async function execute(value: UsdtPositionControlRequest): Promise<UsdtPositionControlResult> {
    const { id, target, action } = parseCommand(value, clock());
    const fingerprint = JSON.stringify([target, action]);
    let row = store.getPositionControl<Stored>(id);
    if (row && row.fingerprint !== fingerprint) throw Error('同一实盘请求编号的参数不一致');
    if (!row) {
      const previous = store.pendingPositionControls<Stored>().filter(item => item.target.symbol === target.symbol && item.target.positionSide === target.positionSide);
      for (const item of previous) {
        for (const step of item.steps.filter(step => step.state === 'sent')) await recover(step);
        save(item);
      }
      if (previous.some(item => item.steps.some(step => step.state === 'sent'))) throw Error('上一笔实盘操作等待币安回报');
      const position = await freshTarget(target);
      const base = { symbol: position.symbol, positionSide: position.positionSide, side: closingSide(position) };
      const reduce = position.positionSide === 'BOTH' ? { reduceOnly: 'true' } : {};
      const steps: Step[] = [];
      if (action.kind === 'cancel') {
        if (!protectionRows(await rawOrders(position.symbol), position).some(order => order.id === action.orderId))
          throw Error('这张止盈止损单已成交或已撤销');
        steps.push({ method: 'DELETE', path: algoPath, params: { symbol: position.symbol, algoId: action.orderId } });
      } else if (action.kind === 'leverage') {
        steps.push({ method: 'POST', path: leveragePath, params: { symbol: position.symbol, leverage: String(action.leverage) } });
      } else if (action.kind === 'margin') {
        const config = await request('GET', configPath, { symbol: position.symbol });
        if (!Array.isArray(config) || !config.some(row => row.symbol === position.symbol && row.marginType === 'ISOLATED'))
          throw Error('只有币安逐仓仓位可以调整单独保证金');
        steps.push({ method: 'POST', path: marginPath, params: { symbol: position.symbol, positionSide: position.positionSide,
          amount: String(Math.abs(action.delta)), type: action.delta > 0 ? '1' : '2' } });
      } else {
        const market = await readMarket(position.symbol);
        if (!market) throw Error('无法核对币安 USDT 永续交易规格');
        if (action.kind === 'close') {
          const side = closingSide(position);
          const wire = await deskOrderParameters(action.order ?? {type:'market'}, market, side,
            usdtOrderId(owner, target.campaignId, id), Number(position.markPrice), () => {
              if (!readBook) throw Error('盘口价格读取不可用');
              return readBook(position.symbol, side);
            });
          const spec = wire.params.type === 'LIMIT' ? { ...market, marketStep:market.step } : market;
          const params = Object.fromEntries(Object.entries(wire.params).filter(([, value]) => typeof value === 'string')) as Record<string,string>;
          steps.push({ method:'POST', path:wire.path, params:{ ...base, ...reduce, ...params,
            quantity:quantityFor(position.quantity, action.fraction, spec) } });
        } else {
          const size = action.fraction === 1 ? { closePosition: 'true' } :
            { quantity: quantityFor(position.quantity, action.fraction, market), ...reduce };
          const mark = Number(position.markPrice);
          const existing = protectionRows(await rawOrders(position.symbol), position);
          for (const [kind, value] of [['sl', action.sl], ['tp', action.tp]] as const) {
            if (value === null) continue;
            if (!(mark > 0) || ((position.direction === 'long') === (kind === 'tp') ? value <= mark : value >= mark))
              throw Error('触发价与当前币安标记价格方向不符');
            if (!market.priceTick || !quantityUnits(String(value), market.priceTick)) throw Error('触发价与币安价格步长不符');
            const replacementId = usdtOrderId(owner, target.campaignId, id + kind);
            steps.push({ method: 'POST', path: algoPath, params: { ...base, ...size, algoType: 'CONDITIONAL',
              type: kind === 'tp' ? 'TAKE_PROFIT_MARKET' : 'STOP_MARKET', workingType: 'MARK_PRICE',
              triggerPrice: String(value), clientAlgoId: replacementId } });
            for (const order of existing.filter(order => order.kind === kind)) {
              steps.push({ method: 'DELETE', path: algoPath, replacementId, params: { symbol: position.symbol, algoId: order.id } });
            }
          }
        }
      }
      row = { id, target, fingerprint, steps };
      save(row);
    }
    await advance(row, action.kind === 'protect');
    const pending = row.steps.some(step => step.state === 'sent');
    const filledQuantity = row.steps.find(step => step.path === orderPath)?.filledQuantity;
    let issue = row.steps.find(step => step.issue)?.issue;
    if (action.kind === 'close' && !pending && Number(filledQuantity) > 0) {
      try { await cleanup(target.symbol); }
      catch { issue ||= '平仓成交已收到，原仓位的条件单等待核对'; }
    }
    return { pending, issue, filledQuantity: Number(filledQuantity) > 0 ? filledQuantity : undefined };
  }

  async function advance(row: Stored, protecting: boolean, onlyReplacement = false) {
    for (const step of row.steps) {
      if (step.state === 'failed') break;
      if (step.state === 'done') continue;
      if (step.state === 'sent') {
        if (onlyReplacement) break;
        await recover(step);
      } else {
        if (onlyReplacement && !step.replacementId) break;
        // A resumed multi-step request must still target the original, verified current position.
        try {
          if (protecting && step.method === 'DELETE' && !step.replacementId) throw Error('旧版替换请求已停止，请重新确认止盈止损');
          await freshTarget(row.target);
          if (step.replacementId) {
            const replacement = row.steps.find(candidate => candidate.params.clientAlgoId === step.replacementId);
            const orders = await rawOrders(row.target.symbol);
            if (!Array.isArray(orders) || !replacement || !isDone(replacement) || !orders.some(order =>
              order.algoStatus === 'NEW' && protectionMatches(order, replacement))) {
              throw Error('币安未确认新保护单，未发送旧单撤销请求');
            }
            if (!orders.some(order => String(order.algoId) === step.params.algoId)) {
              step.state = 'done';
              save(row);
              continue;
            }
          }
        } catch (error) {
          step.state = 'failed';
          step.issue = error instanceof Error ? error.message : '无法核对当前实盘仓位';
          save(row);
          break;
        }
        step.state = 'sent';
        step.sentAt = clock();
        save(row);
        try {
          const params = step.method === 'DELETE' ? { algoId: step.params.algoId } : step.params;
          await accept(step, await request(step.method, step.path, params));
        }
        catch (error) {
          if (definitelyRejected(error)) {
            step.state = 'failed';
            step.issue = error instanceof Error ? error.message : '币安拒绝实盘委托';
          } else await recover(step);
        }
        invalidate();
      }
      save(row);
      if (!isDone(step)) break;
    }
  }

  async function cleanup(symbol?: string) {
    const rows = store.pendingPositionControls<Stored>();
    for (const row of rows) {
      if (symbol && row.target.symbol !== symbol) continue;
      const awaiting = row.steps.filter(step => step.state === 'sent');
      for (const step of awaiting) await recover(step);
      if (row.steps.some(step => step.replacementId && !step.state)) await advance(row, true, true);
      const linked = row.steps.filter(step => isTrackedProtection(step) && step.state === 'done');
      const limits = row.steps.filter(trackedLimit);
      if (limits.length) {
        const orders = await request('GET','/fapi/v1/openOrders',{symbol:row.target.symbol});
        if (!Array.isArray(orders)) throw Error('币安限价挂单暂不可读');
        const active = limits.filter(step => orders.some(order => order.clientOrderId === step.params.newClientOrderId));
        for (const step of limits.filter(step => !active.includes(step))) step.retired = true;
        if (active.length && (await activeCampaign(row.target))?.closedAt) {
          for (const step of active) {
            const order = orders.find(order => order.clientOrderId === step.params.newClientOrderId);
            if (!matchedOrder(order,step)) continue;
            const canceled = await request('DELETE',orderPath,{symbol:row.target.symbol,origClientOrderId:step.params.newClientOrderId});
            if (canceled?.status === 'CANCELED' && canceled.clientOrderId === step.params.newClientOrderId) step.retired = true;
          }
        }
      }
      if (linked.length) {
        const active = await rawOrders(row.target.symbol);
        if (!Array.isArray(active)) continue;
        const present = linked.filter(step => active.some(order => order.clientAlgoId === step.params.clientAlgoId));
        for (const step of linked.filter(step => !present.includes(step))) step.retired = true;
        if (present.length) {
          const position = (await risk(row.target.symbol)).find(item => matchingLeg(item, row.target));
          const revision = position && usdtMirrorRevision(position);
          if (symbol || !revision || revision !== (row.checkedRevision ?? row.target.revision)) {
            const campaign = await activeCampaign(row.target);
            if (campaign?.closedAt) {
              for (const step of present) {
                if (!active.some(order => protectionMatches(order, step))) continue;
                const result = await request('DELETE', algoPath, { clientAlgoId: step.params.clientAlgoId });
                if (result?.clientAlgoId === step.params.clientAlgoId && String(result.code) === '200') {
                  step.retired = true;
                  save(row);
                }
              }
              invalidate();
            } else if (campaign && revision) row.checkedRevision = revision;
          }
        }
      }
      save(row);
    }
  }

  async function beforeOpening(symbol: string) {
    await cleanup(symbol);
    if (store.pendingPositionControls<Stored>().some(row => row.target.symbol === symbol &&
      row.steps.some(step => isTrackedProtection(step) || trackedLimit(step) || step.path === orderPath && step.state === 'sent')))
      throw Error('原实盘仓位的平仓或保护委托待核对，暂缓新开仓');
  }

  const protectionIds = (symbol: string, campaignId: string) => store.pendingPositionControls<Stored>().flatMap(row =>
    row.target.symbol === symbol && row.target.campaignId === campaignId ?
    row.steps.filter(step => isTrackedProtection(step) && step.state === 'done')
      .map(step => step.params.clientAlgoId) : []);
  return { execute, cleanup, beforeOpening, readDetails, protectionIds, hasPending: () => store.pendingPositionControls<Stored>().length > 0 };
}
