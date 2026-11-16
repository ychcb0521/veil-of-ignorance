import {
  BINANCE_MANUAL_MONITOR_VERSION, MANAGED_MINUTE, binanceManualId,
  type BinanceManualAnchor, type BinanceManualPosition,
} from '../src/lib/fish/binanceManualMonitor.ts';
import type { InstantMonitorSettings } from '../src/lib/fish/instantMonitorSettings.ts';
import type { QualityResult } from '../src/lib/fish/quality.ts';
import type { UsdtCampaignFill, UsdtLiveCampaign } from '../src/lib/fish/usdtLiveCampaign.ts';
import { formatQuantity, quantityUnits, type UsdtMarket } from './usdt-exchange.ts';
import type { UsdtCampaignLedger, UsdtFill, UsdtOrder } from './usdt-follow-store.ts';

const minuteCeiling = (at: number) => Math.ceil(at / MANAGED_MINUTE) * MANAGED_MINUTE;

export function matchesManualAnchor(anchor: BinanceManualAnchor, actual?: UsdtLiveCampaign) {
  const entry = actual?.fills[0];
  return !!entry && !!actual && actual.symbol === anchor.symbol && actual.positionSide === anchor.positionSide &&
    actual.direction === 'long' && actual.asset === 'USDT' && actual.openedAt === anchor.openedAt &&
    entry.id === anchor.openingTradeId && entry.orderId === anchor.openingOrderId && entry.action === 'open' && entry.side === 'BUY';
}

function actualFill(fill: UsdtCampaignFill, market: UsdtMarket): UsdtFill {
  return { id: fill.id, at: fill.at, quantity: quantityUnits(fill.positionQuantity, market.step),
    price: Number(fill.price), realized: fill.realized, commission: fill.commission, commissionAsset: fill.commissionAsset };
}

export function createManagedUsdtLedger(anchor: BinanceManualAnchor, monitor: InstantMonitorSettings, actual: UsdtLiveCampaign,
  market: UsdtMarket, now: number): UsdtCampaignLedger {
  if (!matchesManualAnchor(anchor, actual) || actual.closedAt || market.symbol !== anchor.symbol ||
    actual.fills.some(fill => fill.action !== 'open' || fill.side !== 'BUY' || fill.orderId !== anchor.openingOrderId)) {
    throw Error('只能接手首仓逐笔成交已经核实且仍在持有的币安多仓');
  }
  const fills = actual.fills.map(fill => actualFill(fill, market));
  const units = fills.reduce((sum, fill) => sum + fill.quantity, 0);
  const entryQuantity = Number(formatQuantity(units, market.step));
  const entryPrice = fills.reduce((sum, fill) => sum + fill.price * fill.quantity, 0) / units;
  const notional = entryQuantity * entryPrice;
  if (!Number.isSafeInteger(units) || units <= 0 || units !== quantityUnits(actual.quantity, market.step) ||
    !Number.isFinite(notional) || notional <= 0) throw Error('币安首仓数量或成交金额无法核对');
  const id = binanceManualId(anchor);
  const managed: BinanceManualPosition = { version: BINANCE_MANUAL_MONITOR_VERSION, anchor, monitor,
    armedAt: Math.max(now, ...fills.map(fill => fill.at)), entryQuantity, entryPrice, revision: 0 };
  const open: UsdtOrder = { id: anchor.openingOrderId, exchangeId: anchor.openingOrderId,
    side: 'BUY', terminal: true, quantity: formatQuantity(units, market.step), fills };
  return {
    campaign: { id, source: { symbol: anchor.symbol, exchange: 'binance' }, admittedAt: now, notional, leverage: 1,
      actions: [{ id: 'open', action: 'open', at: anchor.openedAt }] },
    managed, orders: { open }, skipped: [], status: { id, symbol: anchor.symbol, state: 'tracking' },
  };
}

/** In-flight app orders are reconciled by their original order ID before this is called. */
export function mergeUsdtExitFills(row: UsdtCampaignLedger, actual: UsdtLiveCampaign, market: UsdtMarket, allowPartial: boolean) {
  const present = new Set(actual.fills.map(fill => fill.id));
  const recorded = Object.values(row.orders).flatMap(order => order.fills ?? []);
  if (recorded.some(fill => !present.has(fill.id))) throw Error('币安成交回报还未同步完成');
  const known = new Set(recorded.map(fill => fill.id));
  const external = actual.fills.filter(fill => !known.has(fill.id));
  if (external.length && !actual.closedAt && (!allowPartial || external.some(fill => fill.action !== 'reduce' || fill.side !== 'SELL')))
    throw Error('币安仓位有新的手动加减仓，等待核对后再继续策略');
  for (const fill of external) {
    row.orders['binance:' + fill.id] = { id: fill.id, exchangeId: fill.orderId, side: fill.side, terminal: true,
      quantity: fill.positionQuantity, fills: [actualFill(fill, market)] };
  }
  return external;
}

export function verifyManagedUsdtFills(row: UsdtCampaignLedger, actual: UsdtLiveCampaign, market: UsdtMarket) {
  if (!row.managed || !matchesManualAnchor(row.managed.anchor, actual)) throw Error('币安持仓已换成另一笔首仓');
  mergeUsdtExitFills(row, actual, market, false);
  return !!actual.closedAt;
}

/** A pending strategy transition advances only after the exchange returns actual executions. */
export function settleManagedUsdtDecision(row: UsdtCampaignLedger, key: string, market: UsdtMarket,
  remaining: { held: number; entry: number; realized: number }) {
  const managed = row.managed, pending = managed?.pending, order = row.orders[key];
  if (!managed || !pending || !order?.terminal ||
    (pending.action.id !== key && !key.startsWith(pending.action.id + ':'))) return;
  if (pending.kind === 'close' && remaining.held > 0) {
    if (!order.fills?.length) {
      row.status.state = 'blocked';
      row.status.issue = order.exchangeId ? '本次平仓未成交，等待重新核对余仓' : '币安拒绝了本次平仓，等待重新核对余仓';
    }
    return;
  }
  const prior = managed.checkpoint;
  if (!prior) throw Error('手动托管缺少持仓策略检查点');
  const fills = Object.values(row.orders).flatMap(o => o.fills ?? []);
  const actual = order.fills ?? [];
  const units = actual.reduce((sum, fill) => sum + fill.quantity, 0);
  const through = Math.max(prior.endTime ?? 0, pending.through, minuteCeiling(Math.max(...fills.map(f => f.at))));
  let checkpoint: QualityResult = { ...prior, endTime: through, pendingExit: undefined,
    remainingQuantity: Number(formatQuantity(remaining.held, market.step)), averageEntryPrice: remaining.entry,
    remainingCost: Number(formatQuantity(remaining.held, market.step)) * remaining.entry, realizedPnl: remaining.realized };
  if (units > 0) {
    const quantity = Number(formatQuantity(units, market.step));
    const price = actual.reduce((sum, fill) => sum + fill.price * fill.quantity, 0) / units;
    const at = Math.max(...actual.map(fill => fill.at));
    checkpoint = { ...checkpoint, endPrice: price };
    if (pending.kind === 'add') {
      const addition = { ...pending.evidence, price, quantity, notional: price * quantity };
      const additions = [...(prior.additionFills ?? (prior.additionFill ? [prior.additionFill] : [])), addition];
      const newVetoStage = pending.vetoStageSwitches?.at(-1);
      const peak = Math.max(price, prior.vetoPath?.peak ?? managed.entryPrice * (1 + (prior.peakPct ?? 0) / 100));
      checkpoint = { ...checkpoint, additionFill: additions[0], additionFills: additions,
        routeDecision: pending.routeDecision ?? prior.routeDecision,
        sellStageSwitches: pending.sellStageSwitches ?? prior.sellStageSwitches,
        vetoStageSwitches: pending.vetoStageSwitches ?? prior.vetoStageSwitches,
        ...(newVetoStage?.afterAdditions === additions.length ? { vetoPath: { entry: managed.entryPrice,
          peak: newVetoStage.peakBasis === 'holding' ? peak : price, minimum: price, dynamic: 0 } } : {}) };
    } else if (pending.kind === 'mirror') {
      checkpoint.mirrorFill = { ...pending.evidence, price, fraction: Math.min(1, quantity / managed.entryQuantity),
        gainPct: (price / managed.entryPrice - 1) * 100 };
    } else if (pending.kind === 'support-reduction') {
      const costRemoved = quantity * remaining.entry;
      const reduction = { ...pending.evidence, price, quantity, costRemoved,
        fraction: units / (remaining.held + units), realizedPnl: actual.reduce((sum, fill) => sum + fill.realized, 0) };
      checkpoint.additionReductions = [...(prior.additionReductions ?? []), reduction];
    } else if (!remaining.held) {
      checkpoint = { ...checkpoint, status: 'closed', complete: true, endTime: at, reason: pending.reason };
    }
  }
  managed.checkpoint = checkpoint;
  managed.pending = undefined;
  managed.revision++;
}
