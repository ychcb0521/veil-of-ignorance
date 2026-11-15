import type { UsdtMirrorFill, UsdtMirrorHistory, UsdtMirrorPosition, UsdtMirrorSide, UsdtMirrorSnapshot } from '../src/lib/fish/usdtPositionMirror.ts';
import { usdtMirrorKey, usdtMirrorRevision } from '../src/lib/fish/usdtPositionMirror.ts';

type Read = (method: 'GET', path: string, params?: Record<string, string>) => Promise<unknown>;
const validSymbol = (symbol: unknown): symbol is string => typeof symbol === 'string' && /^[A-Z0-9_]{3,32}$/.test(symbol);
const validSide = (side: unknown): side is UsdtMirrorSide => side === 'BOTH' || side === 'LONG' || side === 'SHORT';
const validId = (id: unknown) => (typeof id === 'string' || typeof id === 'number' && Number.isSafeInteger(id)) && /^\d{1,25}$/.test(String(id));
const decimal = /^-?\d{1,30}(?:\.\d{1,18})?$/;
const decimalText = (value: unknown) => {
  if (typeof value !== 'string' || !decimal.test(value)) throw Error('币安返回的仓位或成交金额无效');
  return value;
};
const asUnits = (value: string) => {
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return (value.startsWith('-') ? -1n : 1n) * BigInt(whole + fraction.padEnd(18, '0'));
};
const quantityText = (value: bigint) => {
  const digits = String(value < 0n ? -value : value).padStart(19, '0');
  const fraction = digits.slice(-18).replace(/0+$/, '');
  return digits.slice(0, -18) + (fraction ? '.' + fraction : '');
};
const day = 24 * 60 * 60 * 1000;
const pageSize = 1000;

function decodePositions(value: unknown): UsdtMirrorPosition[] {
  if (!Array.isArray(value)) throw Error('币安 U 本位持仓回报无效');
  const positions = new Map<string, UsdtMirrorPosition>();
  for (const row of value) {
    const amount = decimalText(row?.positionAmt);
    const net = asUnits(amount);
    if (net === 0n) continue;
    if (!validSymbol(row.symbol) || !validSide(row.positionSide)
      || !Number.isSafeInteger(row.updateTime) || row.updateTime < 0
      || row.positionSide === 'LONG' && net < 0n || row.positionSide === 'SHORT' && net > 0n) {
      throw Error('币安 U 本位持仓方向或更新时间无效');
    }
    const position: UsdtMirrorPosition = {
      symbol: row.symbol, positionSide: row.positionSide, direction: net > 0n ? 'long' : 'short',
      quantity: amount.replace(/^-/, ''), entryPrice: decimalText(row.entryPrice),
      markPrice: decimalText(row.markPrice), unrealizedPnl: decimalText(row.unRealizedProfit), updatedAt: row.updateTime,
    };
    const key = usdtMirrorKey(position);
    if (positions.has(key)) throw Error('币安持仓回报重复');
    positions.set(key, position);
  }
  return [...positions.values()].sort((a, b) => a.symbol.localeCompare(b.symbol) || a.positionSide.localeCompare(b.positionSide));
}

type RawTrade = Omit<UsdtMirrorFill, 'positionQuantity' | 'action'>;
function decodeTrade(row: any, position: UsdtMirrorPosition, start: number, end: number): RawTrade | undefined {
  if (row?.symbol !== position.symbol || !validSide(row.positionSide)) throw Error('币安逐笔成交与仓位不符');
  if (row.positionSide !== position.positionSide) return;
  if (!Number.isSafeInteger(row.time) || row.time < start || row.time > end
    || !validId(row.id) || !validId(row.orderId) || row.side !== 'BUY' && row.side !== 'SELL') throw Error('币安成交时间或身份无效');
  const quantity = decimalText(row.qty), price = decimalText(row.price);
  if (asUnits(quantity) <= 0n || asUnits(price) <= 0n) throw Error('币安成交数量或价格无效');
  return {id:String(row.id),orderId:String(row.orderId),at:row.time,side:row.side,price,quantity};
}
const descending = (a: RawTrade, b: RawTrade) => b.at - a.at || (BigInt(a.id) > BigInt(b.id) ? -1 : a.id === b.id ? 0 : 1);

export function createUsdtPositionReader(read: Read, clock = Date.now) {
  let snapshot: UsdtMirrorSnapshot | undefined;
  let loading: Promise<UsdtMirrorSnapshot> | undefined;
  const histories = new Map<string, { revision: string; history: UsdtMirrorHistory }>();
  const working = new Map<string, Promise<UsdtMirrorHistory>>();
  const positions = () => {
    if (loading) return loading;
    if (snapshot && clock() - snapshot.observedAt < 4000 && clock() >= snapshot.observedAt) return Promise.resolve(snapshot);
    loading = (async () => {
      const positions = decodePositions(await read('GET', '/fapi/v3/positionRisk'));
      const keys = new Set(positions.map(usdtMirrorKey));
      for (const key of histories.keys()) if (!keys.has(key)) histories.delete(key);
      return (snapshot = {positions,observedAt:clock()});
    })().finally(() => { loading = undefined; });
    return loading;
  };

  const rebuild = async (position: UsdtMirrorPosition): Promise<UsdtMirrorHistory> => {
    const now = clock();
    let requests = 0;
    let end = Math.max(now, position.updatedAt);
    const oldest = now - 89 * day;
    // Use the current signed amount and walk the exchange's executions backwards.
    // A direction change can close an old one-way position and open this one in the same fill.
    let remaining = asUnits(position.quantity) * (position.direction === 'long' ? 1n : -1n);
    const fills: UsdtMirrorFill[] = [];
    const seen = new Set<string>();
    const page = async (start: number, stop: number): Promise<UsdtMirrorHistory | undefined> => {
      if (++requests > 40) throw Error('成交过多，未能完整核对开仓时间');
      const rows = await read('GET','/fapi/v1/userTrades',{symbol:position.symbol,startTime:String(start),endTime:String(stop),limit:String(pageSize)});
      if (!Array.isArray(rows)) throw Error('币安逐笔成交回报无效');
      if (rows.length >= pageSize) {
        if (start === stop) throw Error('同一毫秒的成交过多，未能完整核对开仓时间');
        const mid = start + Math.floor((stop - start) / 2);
        return await page(mid + 1, stop) ?? await page(start, mid);
      }
      const ordered = rows.map(row=>decodeTrade(row,position,start,stop)).filter((trade):trade is RawTrade=>!!trade).sort(descending);
      for (const fill of ordered) {
        if (seen.has(fill.id)) throw Error('币安逐笔成交回报重复');
        seen.add(fill.id);
        const delta = asUnits(fill.quantity) * (fill.side === 'BUY' ? 1n : -1n);
        const before = remaining - delta;
        if (before === 0n || (before > 0n) !== (remaining > 0n)) {
          fills.push({...fill,positionQuantity:quantityText(remaining),action:'open'});
          return {openedAt:fill.at,fills:fills.reverse()};
        }
        if (fills.length >= 5000) throw Error('成交过多，未能完整核对开仓时间');
        fills.push({...fill,positionQuantity:fill.quantity,action:(remaining > 0n) === (delta > 0n) ? 'add':'reduce'});
        remaining = before;
      }
    };
    let history: UsdtMirrorHistory | undefined;
    try {
      while (end >= oldest && !history) {
        const start = Math.max(oldest, end - 7 * day + 1);
        history = await page(start, end);
        end = start - 1;
      }
      if (!history) history = {fills:[],issue:'历史成交不足，无法核对实际开仓时间'};
    } catch (error) {
      return {fills:[],issue:error instanceof Error ? error.message : '无法读取实际成交'};
    }
    if (history.openedAt && position.updatedAt && history.fills[history.fills.length-1].at < position.updatedAt) {
      return {fills:[],issue:'成交记录尚无法与当前仓位核对，请稍后重试'};
    }
    const current = decodePositions(await read('GET','/fapi/v3/positionRisk',{symbol:position.symbol})).find(row=>row.positionSide===position.positionSide);
    if (!current || usdtMirrorRevision(current) !== usdtMirrorRevision(position)) return {fills:[],issue:'币安仓位已变化，等待下次同步'};
    return history;
  };

  const history = async (symbol: unknown, side: unknown, revision: unknown): Promise<UsdtMirrorHistory> => {
    if (!validSymbol(symbol) || !validSide(side) || typeof revision !== 'string' || revision.length > 300) throw Error('请先刷新币安仓位');
    const key = usdtMirrorKey({symbol, positionSide:side});
    const position = (await positions()).positions.find(row=>usdtMirrorKey(row)===key);
    if (!position || usdtMirrorRevision(position)!==revision) return {fills:[],issue:'币安仓位已变化，等待下次同步'};
    const cached = histories.get(key);
    if (cached?.revision === revision) return cached.history;
    if (working.has(revision)) return working.get(revision)!;
    if (working.size >= 2) return {fills:[],issue:'正在同步其他仓位，请稍后重试'};
    const task = rebuild(position).then(result=>{
      if (result.openedAt) {
        histories.delete(key);
        histories.set(key,{revision,history:result});
        if(histories.size>64)histories.delete(histories.keys().next().value!);
      }
      return result;
    }).finally(()=>{working.delete(revision);});
    working.set(revision,task);
    return task;
  };
  return {positions,history};
}
