import type { UsdtCampaignBatch, UsdtCampaignFill, UsdtLiveCampaign } from '../src/lib/fish/usdtLiveCampaign.ts';
import type { UsdtMirrorPosition, UsdtMirrorSide } from '../src/lib/fish/usdtPositionMirror.ts';
import { decodePositions } from './usdt-position-reader.ts';

type Read = (method: 'GET', path: string, params?: Record<string, string>) => Promise<unknown>;
const DAY = 86_400_000;
const WINDOW = 7 * DAY;
const LIMIT = 1000;
const symbolPattern = /^[A-Z0-9_]{3,32}$/;
const decimal = /^-?\d{1,30}(?:\.\d{1,18})?$/;
const idPattern = /^\d{1,25}$/;

function units(raw: string) {
  if (!decimal.test(raw)) throw Error('币安成交数量无效');
  const [whole, fraction = ''] = raw.replace(/^-/, '').split('.');
  return BigInt(whole + fraction.padEnd(18, '0')) * (raw.startsWith('-') ? -1n : 1n);
}
function quantity(value: bigint) {
  const n = (value < 0n ? -value : value).toString().padStart(19, '0');
  const fraction = n.slice(-18).replace(/0+$/, '');
  return n.slice(0, -18) + (fraction ? '.' + fraction : '');
}
function money(raw: unknown) {
  if (typeof raw !== 'string' || !decimal.test(raw)) throw Error('币安成交金额无效');
  return Number(raw);
}
export type UsdtActualTrade = Omit<UsdtCampaignFill, 'action' | 'positionQuantity'> & { positionSide: UsdtMirrorSide; asset: string };

function readTrade(raw: unknown, symbol: string, start: number, end: number): UsdtActualTrade {
  const row = raw as Record<string, unknown>;
  if (!row || row.symbol !== symbol || (row.positionSide !== 'BOTH' && row.positionSide !== 'LONG' && row.positionSide !== 'SHORT')
    || (row.side !== 'BUY' && row.side !== 'SELL') || typeof row.time !== 'number' || !Number.isSafeInteger(row.time)
    || row.time < start || row.time > end || !idPattern.test(String(row.id)) || !idPattern.test(String(row.orderId))
    || typeof row.qty !== 'string' || units(row.qty) <= 0n || typeof row.price !== 'string' || money(row.price) <= 0
    || typeof row.commissionAsset !== 'string' || !symbolPattern.test(row.commissionAsset)) throw Error('币安逐笔成交格式有误');
  const asset = typeof row.marginAsset === 'string' && symbolPattern.test(row.marginAsset) ? row.marginAsset
    : symbol.split('_')[0].endsWith('USDC') ? 'USDC' : 'USDT';
  return { id: String(row.id), orderId: String(row.orderId), at: row.time, quantity: row.qty, price: row.price, side: row.side,
    positionSide: row.positionSide, asset, realized: money(row.realizedPnl), commission: money(row.commission), commissionAsset: row.commissionAsset };
}
const compareId = (a: string, b: string) => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
const delta = (row: UsdtActualTrade) => units(row.quantity) * (row.side === 'BUY' ? 1n : -1n);

function startingBalances(positions: readonly UsdtMirrorPosition[], trades: readonly UsdtActualTrade[]) {
  const balances = new Map<UsdtMirrorSide, bigint>();
  for (const pos of positions) balances.set(pos.positionSide, units(pos.quantity) * (pos.direction === 'short' ? -1n : 1n));
  for (const trade of trades) balances.set(trade.positionSide, (balances.get(trade.positionSide) ?? 0n) - delta(trade));
  return balances;
}

// Position snapshots anchor the balances. Trade IDs break ties when fills share a millisecond.
export function reconstructUsdtCampaigns(symbol: string, positions: readonly UsdtMirrorPosition[], trades: readonly UsdtActualTrade[]) {
  const rows = [...new Map(trades.map(trade => [trade.id, trade])).values()].sort((a, b) => a.at - b.at || compareId(a.id, b.id));
  const balances = startingBalances(positions, rows);
  const open = new Map<UsdtMirrorSide, UsdtLiveCampaign>();
  const campaigns: UsdtLiveCampaign[] = [];
  for (const trade of rows) {
    const { positionSide, asset, ...raw } = trade;
    const before = balances.get(positionSide) ?? 0n;
    const after = before + delta(trade);
    if ((positionSide === 'LONG' && (before < 0n || after < 0n)) || (positionSide === 'SHORT' && (before > 0n || after > 0n)))
      throw Error('币安成交与持仓方向暂未对齐');
    balances.set(positionSide, after);
    const flipped = before !== 0n && after !== 0n && (before < 0n) !== (after < 0n);
    const campaign = open.get(positionSide);
    const closed = before !== 0n && (flipped || after === 0n);
    const closeFee = flipped ? raw.commission * (Number(quantity(before)) / Number(raw.quantity)) : raw.commission;
    if (campaign) {
      const increases = (before < 0n) === (delta(trade) < 0n);
      const action = increases ? (raw.orderId === campaign.fills[0].orderId ? 'open' : 'add') : 'reduce';
      campaign.fills.push({ ...raw, action,
        positionQuantity: flipped ? quantity(before) : raw.quantity,
        commission: closeFee });
      campaign.quantity = closed ? '0' : quantity(after);
      if (closed) {
        campaign.closedAt = raw.at;
        open.delete(positionSide);
      }
    }
    if (before === 0n || flipped) {
      const initial: UsdtLiveCampaign = { symbol, asset, positionSide, direction: after > 0n ? 'long' : 'short',
        quantity: quantity(after), openedAt: raw.at, fills: [{ ...raw, action: 'open', positionQuantity: quantity(after),
          ...(flipped ? { realized: 0, commission: raw.commission - closeFee } : {}) }] };
      campaigns.push(initial);
      open.set(positionSide, initial);
    }
  }
  return campaigns;
}

export function createUsdtCampaignReader(read: Read, clock = Date.now) {
  let running: Promise<UsdtCampaignBatch> | undefined;
  let cached: { key: string; data: UsdtCampaignBatch } | undefined;
  async function scan(since: number, known: ReadonlyMap<string, ReadonlySet<number>>, target?: string): Promise<UsdtCampaignBatch> {
    const params = target ? { symbol: target } : undefined;
    const positions = decodePositions(await read('GET', '/fapi/v3/positionRisk', params));
    const observedAt = clock();
    const earliest = Math.max(1, observedAt - 89 * DAY);
    const start = Math.max(earliest, Math.min(since, observedAt));
    const groups = new Map<string, UsdtMirrorPosition[]>();
    for (const position of positions) groups.set(position.symbol, [...(groups.get(position.symbol) ?? []), position]);
    let budget = 140;
    let incomplete = since < earliest;
    const windows = async (path: string, from: number, through: number, params?: Record<string, string>): Promise<unknown[]> => {
      if (from > through) return [];
      if (through - from >= WINDOW) {
        const cutoff = from + WINDOW - 1;
        return [...await windows(path, from, cutoff, params), ...await windows(path, cutoff + 1, through, params)];
      }
      if (--budget < 0) throw Error('本轮成交过多，战役同步稍后重试');
      const rows = await read('GET', path, { ...params, startTime: String(from), endTime: String(through), limit: String(LIMIT) });
      if (!Array.isArray(rows)) throw Error('币安返回的订单或成交不可识别');
      if (rows.length < LIMIT) return rows;
      if (from === through) throw Error('同一毫秒内的币安成交过多');
      const middle = Math.floor((from + through) / 2);
      return [...await windows(path, from, middle, params), ...await windows(path, middle + 1, through, params)];
    };
    const orders = target ? [] : await windows('/fapi/v1/allOrders', start, observedAt);
    const symbols = new Set([...groups.keys(), ...known.keys()]);
    for (const order of orders) {
      const item = order as { symbol?: string; executedQty?: string };
      if (item.symbol && symbolPattern.test(item.symbol) && item.executedQty && units(item.executedQty) > 0n) symbols.add(item.symbol);
    }
    const campaigns: UsdtLiveCampaign[] = [];
    const scanSymbol = async (symbol: string) => {
      const current = groups.get(symbol) ?? [];
      const openingTimes = known.get(symbol);
      let from = Math.max(earliest, Math.min(start, ...(openingTimes ?? [])));
      const recent = (a: number, b: number) => windows('/fapi/v1/userTrades', a, b, { symbol })
        .then(rows => rows.map(row => readTrade(row, symbol, a, b)));
      let trades = await recent(from, observedAt);
      const unique = () => [...new Map(trades.map(trade => [trade.id, trade])).values()];
      const before = () => [...startingBalances(current, unique()).values()].some(value => value !== 0n);
      while (from > earliest && before()) {
        const prior = Math.max(earliest, from - WINDOW);
        trades = [...await recent(prior, from - 1), ...trades];
        from = prior;
      }
      if (before()) incomplete = true;
      if (current.some(pos => pos.updatedAt >= from && !trades.some(trade => trade.positionSide === pos.positionSide && trade.at >= pos.updatedAt)))
        throw Error('币安最新成交还未返回，正在重新核对');
      campaigns.push(...reconstructUsdtCampaigns(symbol, current, unique())
        .filter(row => !row.closedAt || row.closedAt >= start || openingTimes?.has(row.openedAt)));
    };
    const queue = [...symbols];
    for (let i = 0; i < queue.length; i += 3) await Promise.all(queue.slice(i, i + 3).map(scanSymbol));
    const current = decodePositions(await read('GET', '/fapi/v3/positionRisk', params));
    const anchor = (rows: UsdtMirrorPosition[]) => JSON.stringify(rows.map(p => [p.symbol, p.positionSide, p.direction, p.quantity, p.updatedAt]));
    if (anchor(positions) !== anchor(current)) throw Error('币安仓位刚发生变化，正在重新核对成交');
    return { observedAt, campaigns, ...(incomplete ? { incomplete } : {}) };
  }
  const readBatch = (since: unknown, open: unknown, target?: string): Promise<UsdtCampaignBatch> => {
    if (typeof since !== 'number' || !Number.isSafeInteger(since) || since < 1 || since > clock() + 60_000 ||
      !Array.isArray(open) || open.length > 200) throw Error('币安战役同步请求无效');
    const known = new Map<string, Set<number>>();
    for (const anchor of open) {
      if (typeof anchor?.symbol !== 'string' || !symbolPattern.test(anchor.symbol) || !Number.isSafeInteger(anchor.openedAt)
        || anchor.openedAt < 1 || anchor.openedAt > clock() + 60_000) throw Error('币安战役开仓时间无效');
      const openingTimes = known.get(anchor.symbol) ?? new Set<number>();
      openingTimes.add(anchor.openedAt);
      known.set(anchor.symbol, openingTimes);
    }
    // Execution identity checks need a fresh snapshot and must not queue behind an account archive read.
    if (target) return scan(since, known, target);
    const key = JSON.stringify([since, target, [...known].map(([symbol, openingTimes]) => [symbol, [...openingTimes]])]);
    if (cached?.key === key && clock() - cached.data.observedAt < 4000) return Promise.resolve(cached.data);
    if (running) return running.then(() => readBatch(since, open, target), () => readBatch(since, open, target));
    running = scan(since, known, target).then(data => { cached = { key, data }; return data; }).finally(() => { running = undefined; });
    return running;
  };
  return readBatch;
}
