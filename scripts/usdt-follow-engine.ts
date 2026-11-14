import { usdtOrderId, formatQuantity, quantityUnits, type UsdtExchange, type UsdtMarket, type UsdtPositionMode } from './usdt-exchange.ts';
import { openUsdtFollowStore, type UsdtCampaignLedger, type UsdtOrder } from './usdt-follow-store.ts';
import type { UsdtFollowAction, UsdtFollowCampaign } from '../src/lib/fish/usdtFollow.ts';

const entryAgeMs = 120_000;
const increaseAgeMs = 120_000;
const positionTimeout = 45_000;
type Store = ReturnType<typeof openUsdtFollowStore>;

export function createUsdtFollower(store: Store, exchange: UsdtExchange, owner: string, mode: UsdtPositionMode, startedAt: number) {
  const rows = new Map(store.readAll().map(row => [row.campaign.id, row]));
  const markets = new Map<string, { value: UsdtMarket; at: number }>();
  const cooldown = new Map<string, number>();
  let active = false;
  let lastContactAt = 0;
  let accepting = !store.paused();
  let entryAfter = startedAt;
  const write = (row: UsdtCampaignLedger) => { store.save(row); rows.set(row.campaign.id, row); };

  const ingest = (campaigns: UsdtFollowCampaign[], now = Date.now()) => {
    for (const incoming of campaigns) {
      const row = rows.get(incoming.id);
      if (!row) {
        const open = incoming.actions[0];
        if (!accepting || incoming.admittedAt < entryAfter || now - incoming.admittedAt > entryAgeMs ||
          now - open.at > entryAgeMs || incoming.actions.some(action => action.action === 'close')) continue;
        write({ campaign: incoming, orders: {}, skipped: [], status: { id: incoming.id, symbol: incoming.source.symbol, state: 'waiting' } });
        continue;
      }
      if (row.campaign.notional !== incoming.notional || row.campaign.leverage !== incoming.leverage ||
          row.campaign.source.symbol !== incoming.source.symbol || row.campaign.admittedAt !== incoming.admittedAt ||
          row.campaign.source.exchange !== incoming.source.exchange || row.campaign.source.market !== incoming.source.market) {
        throw Error('同一即时交易战役的冻结参数不一致');
      }
      if (row.status.state === 'closed' || row.status.state === 'ignored') continue;
      const prior = new Map(row.campaign.actions.map(action => [action.id, action]));
      let changed = false;
      for (const action of incoming.actions) {
        const saved = prior.get(action.id);
        if (saved && JSON.stringify(saved) !== JSON.stringify(action)) throw Error('同一即时交易动作的已记载条件不一致');
        if (!saved) { prior.set(action.id, action); changed = true; }
      }
      if (changed) {
        row.campaign.actions = [...incoming.actions, ...[...prior.values()].filter(old => !incoming.actions.some(action => action.id === old.id))];
        write(row);
      }
    }
    lastContactAt = now;
  };

  function balance(row: UsdtCampaignLedger) {
    let held = 0, entry = 0, initial = 0, realized = 0, fee = 0;
    const feesByAsset: Record<string, number> = Object.create(null);
    const fills = Object.entries(row.orders).flatMap(([key, order]) =>
      (order.fills ?? []).map(fill => ({ ...fill, opening: key === 'open', side: order.side })));
    fills.sort((a, b) => a.at - b.at || a.id.length - b.id.length || a.id.localeCompare(b.id));
    for (const fill of fills) {
      if (fill.side === 'BUY') {
        entry = (entry * held + fill.price * fill.quantity) / (held + fill.quantity);
        held += fill.quantity;
        if (fill.opening) initial += fill.quantity;
      } else {
        held -= fill.quantity;
        if (held < 0) throw Error('实盘减仓量超过战役余仓');
      }
      realized += fill.realized;
      feesByAsset[fill.commissionAsset] = (feesByAsset[fill.commissionAsset] ?? 0) + fill.commission;
      if (fill.commissionAsset === 'USDT') fee += fill.commission;
    }
    return { held, entry, initial, realized, fee, feesByAsset };
  }

  const syncBalance = (row: UsdtCampaignLedger, market: UsdtMarket) => {
    const current = balance(row);
    Object.assign(row.status, { market: market.symbol, asset: market.symbol.slice(0, -4),
      quantity: Number(formatQuantity(current.held, market.step)), entryPrice: current.held ? current.entry : undefined,
      realizedUsdt: current.realized, feeUsdt: current.fee, feesByAsset: current.feesByAsset, limitUsdt: row.campaign.notional,
      executions: Object.entries(row.orders).flatMap(([actionId, order]) => order.exchangeId && order.fills?.length ? [{
        actionId, orderId: order.exchangeId, side: order.side,
        fills: order.fills.map(fill => ({ ...fill, quantity: Number(formatQuantity(fill.quantity, market.step)) })),
      }] : []),
    });
    return current;
  };

  async function readMarket(symbol: string) {
    const cached = markets.get(symbol);
    if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
    const value = await exchange.market(symbol);
    if (value) markets.set(symbol, { value, at: Date.now() });
    return value;
  }

  async function step(row: UsdtCampaignLedger, now: number) {
    if (row.status.state === 'closed' || row.status.state === 'ignored') return;
    const { campaign } = row;
    const opened = row.orders.open;
    const existing = Object.entries(row.orders).find(([,order]) => !order.terminal);
    const closing = campaign.actions.find(action => action.action === 'close');
    if (!opened && !existing && (closing || !accepting || now > campaign.actions[0].at + entryAgeMs)) {
      row.status.state = 'ignored';
      row.status.issue = '开仓信号已过时或已平仓，未追单';
      return write(row);
    }
    const market = (!campaign.source.market && (!campaign.source.exchange || campaign.source.exchange === 'binance'))
      ? await readMarket(campaign.source.symbol) : undefined;
    if (!market) {
      if (opened) throw Error('实盘持仓的原合约规格暂不可用');
      row.status.state = 'ignored';
      row.status.issue = '当前标的缺少同一币安 USDT 永续合约';
      return write(row);
    }
    const current = syncBalance(row, market);
    if (existing) {
      const [key, order] = existing;
      const report = await exchange.order(market, mode, order, false);
      if (!report) throw Error('币安订单回报未齐，正在按原编号核对');
      applyReport(row, key, market, report);
      return;
    }
    if (opened && !current.held) {
      row.status.state = current.initial ? 'closed' : 'ignored';
      if (!current.initial) row.status.issue ||= '首仓未成交';
      return write(row);
    }
    let action: UsdtFollowAction | undefined = campaign.actions.find(event => !row.orders[event.id] && !row.skipped.includes(event.id));
    if (closing && current.held && action?.action !== 'close') {
      // If the position is already closing, replaying missed buys or partial exits could add risk.
      row.skipped.push(...campaign.actions.filter(event => event.action !== 'close' && !row.orders[event.id] && !row.skipped.includes(event.id)).map(event => event.id));
      action = closing;
    }
    if (closing && current.held && !action && !row.skipped.includes(closing.id)) action = closing;
    if (!action || row.skipped.includes(action.id)) return;
    const side = action.action === 'open' || action.action === 'add' ? 'BUY' : 'SELL';
    if (side === 'BUY' && (!accepting || now - lastContactAt > positionTimeout || now - action.at > increaseAgeMs)) {
      row.skipped.push(action.id);
      row.status.issue = '该笔买入已过时，未追单';
      return write(row);
    }
    const pendingOther = [...rows.values()].some(other => other !== row && other.campaign.source.symbol === market.symbol
      && (balance(other).held > 0 || Object.values(other.orders).some(order => !order.terminal)));
    if (pendingOther) throw Error('同一合约已有另一笔实盘战役');
    const book = action.action === 'close' ? undefined : await exchange.book(market.symbol, side);
    const price = Number(book);
    const notional = action.action === 'open' ? campaign.notional : action.action === 'add' ? action.notional : 0;
    const stepSize = Number(market.step);
    const desired = action.action === 'close' ? current.held
      : 'fraction' in action ? Math.floor((action.action === 'mirror' ? current.initial : current.held) * action.fraction + 1e-9)
      : Math.floor(notional / price / stepSize + 1e-9);
    const units = Math.min(desired, market.max, side === 'BUY' ? market.max : current.held);
    const quantity = formatQuantity(units, market.step);
    if (units < market.min || (side === 'BUY' && Number(quantity) * price < market.minNotional)
      || (side === 'SELL' && action.action !== 'close' && Number(quantity) * price < market.minNotional)) {
      row.skipped.push(action.id);
      row.status.state = opened ? 'tracking' : 'ignored';
      if (action.action === 'close') row.status.state = 'blocked';
      row.status.issue = '按方案金额或减仓比例换算后低于币安最小委托';
      return write(row);
    }
    await exchange.check(market, mode, current.held, current.entry, action.action === 'open', side === 'BUY' ? campaign.leverage : 0);
    if (side === 'BUY' && (!accepting || Date.now() - lastContactAt > positionTimeout || Date.now() - action.at > increaseAgeMs
      || row.campaign.actions.some(event => event.action === 'close'))) return;
    const attempts = Object.entries(row.orders).filter(([key]) => key === closing?.id || key.startsWith(closing?.id + ':'));
    if (action.action === 'close' && attempts.length && !attempts.at(-1)?.[1].fills?.length) {
      row.skipped.push(action.id);
      row.status.state = 'blocked';
      row.status.issue = '平仓未成交，币安仍有余仓，等待人工核对';
      return write(row);
    }
    const priorCloses = attempts.length;
    const key = action.action === 'close' && priorCloses ? action.id + ':' + priorCloses : action.id;
    const order: UsdtOrder = { id: usdtOrderId(owner, campaign.id, key), side, quantity, terminal: false,
      ...(side === 'BUY' ? { limitPrice: book } : {}) };
    row.orders[key] = order;
    row.status.state = 'waiting';
    row.status.issue = undefined;
    write(row); // Durable before POST. An ambiguous POST is only ever queried by this same ID.
    const report = await exchange.order(market, mode, order, true);
    if (!report) throw Error('币安订单回报未齐，正在按原编号核对');
    applyReport(row, key, market, report);
  }

  function applyReport(row: UsdtCampaignLedger, key: string, market: UsdtMarket, report: NonNullable<Awaited<ReturnType<UsdtExchange['order']>>>) {
    const previous = row.orders[key];
    if (previous.exchangeId && report.exchangeId !== previous.exchangeId) throw Error('币安订单编号与本机记录不同');
    if (report.fills.reduce((sum, fill) => sum + fill.quantity, 0) < (previous.fills ?? []).reduce((sum, fill) => sum + fill.quantity, 0))
      throw Error('币安返回了较旧的累计成交记录');
    const next = { ...previous, terminal: report.terminal, exchangeId: report.exchangeId, fills: report.fills };
    row.orders[key] = next;
    try {
      const held = syncBalance(row, market);
      row.status.state = report.terminal ? held.held ? 'tracking' : held.initial ? 'closed' : 'ignored' : 'waiting';
      row.status.orderId = report.exchangeId;
      row.status.issue = report.issue ?? (report.terminal && report.fills.reduce((sum, fill) => sum + fill.quantity, 0)
        < quantityUnits(previous.quantity, market.step) ? '订单部分成交，余仓按币安回报跟踪' : undefined);
      write(row);
    } catch (error) {
      row.orders[key] = previous;
      throw error;
    }
  }

  return {
    ingest,
    pauseNewOrders: () => { store.pause(); accepting = false; },
    resumeNewOrders: (now = Date.now()) => { store.resume(); entryAfter = now; accepting = true; },
    get entryAfter() { return entryAfter; },
    get paused() { return !accepting; },
    statuses: () => [...rows.values()].map(row => row.status),
    async tick(now = Date.now()) {
      if (active) return;
      active = true;
      try {
        const prioritized = [...rows.values()].sort((a, b) =>
          Number(b.campaign.actions.some(event => event.action === 'close')) - Number(a.campaign.actions.some(event => event.action === 'close')));
        for (const row of prioritized) {
          if ((cooldown.get(row.campaign.id) ?? 0) > now) continue;
          try { await step(row, now); }
          catch (error) {
            row.status.state = 'blocked';
            row.status.issue = error instanceof Error ? error.message : '币安同步暂不可用';
            write(row);
            cooldown.set(row.campaign.id, Date.now() + 3000);
          }
        }
      } finally { active = false; }
    },
  };
}
