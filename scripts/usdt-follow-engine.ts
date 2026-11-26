import { usdtOrderId, formatQuantity, quantityUnits, type UsdtExchange, type UsdtMarket, type UsdtPositionMode } from './usdt-exchange.ts';
import { openUsdtFollowStore, type UsdtCampaignLedger, type UsdtOrder } from './usdt-follow-store.ts';
import type { UsdtFollowAction, UsdtFollowCampaign } from '../src/lib/fish/usdtFollow.ts';
import { BINANCE_MANUAL_MONITOR_VERSION, MANAGED_MINUTE, binanceManualId, initialBinanceManualCheckpoint, type BinanceManualAnchor, type BinanceManualDecision, type BinanceManualPosition } from '../src/lib/fish/binanceManualMonitor.ts';
import type { InstantMonitorSettings } from '../src/lib/fish/instantMonitorSettings.ts';
import type { QualityResult } from '../src/lib/fish/quality.ts';
import { usdtLiveCampaignId, type UsdtLiveCampaign } from '../src/lib/fish/usdtLiveCampaign.ts';
import { createManagedUsdtLedger, matchesManualAnchor, mergeUsdtExitFills, settleManagedUsdtDecision, verifyManagedUsdtFills } from './usdt-managed-execution.ts';
import { calculateHoldingLedgerAddition, HOLDING_LEDGER_ADDITION_VERSION, replayQualityHoldingLedger } from '../src/lib/fish/qualityHoldingLedger.ts';
import type { UsdtMirrorSnapshot } from '../src/lib/fish/usdtPositionMirror.ts';
import { validUsdtLiveEntry, USDT_ENTRY_MAX_AGE_MS as entryAgeMs } from '../src/lib/fish/usdtLiveEntry.ts';
import { rebaseInstantMonitorCheckpoint } from '../src/lib/fish/instantMonitorSwitchCheckpoint.ts';
import { USDT_FOLLOW_MONITOR_BASIS } from '../src/lib/fish/usdtFollowMonitorBasis.ts';

const increaseAgeMs = 120_000;
const positionTimeout = 45_000;
const unsettledBuyIssue = '买单回报尚未核实，继续按原订单编号对账';
const externalReductionIssue = '币安出现策略外减仓，请按实际余仓重新确认切换';
const freshIncrease = (action:UsdtFollowAction, at:number) =>
  action.action==='add'&&action.impulseFreshUntil!==undefined
    ? action.at<=at&&at<action.impulseFreshUntil
    : action.at<=at&&at-action.at<=increaseAgeMs;
type Store = ReturnType<typeof openUsdtFollowStore>;

export function createUsdtFollower(store: Store, exchange: UsdtExchange, owner: string, mode: UsdtPositionMode, startedAt: number,
  readManaged?: (anchor: BinanceManualAnchor) => Promise<UsdtLiveCampaign>, managedClock = Date.now,
  protectionIds?: (symbol: string, campaignId: string) => string[], readPositions?: () => Promise<UsdtMirrorSnapshot>,
  protection?: { cleanup: (symbol: string) => Promise<void>; beforeOpening: (symbol: string) => Promise<void> }) {
  const rows = new Map(store.readAll().map(row => [row.campaign.id, row]));
  const markets = new Map<string, { value: UsdtMarket; at: number }>();
  const cooldown = new Map<string, number>();
  const managedChecked = new Map<string, number>();
  let active = false;
  let manual = false;
  let frozen = false;
  let finishTick: (() => void) | undefined;
  let lastContactAt = 0;
  let accepting = !store.paused();
  let entryAfter = startedAt;
  const write = (row: UsdtCampaignLedger) => { store.save(row); rows.set(row.campaign.id, row); };

  const ingest = (campaigns: UsdtFollowCampaign[], now = Date.now(), recovering = false) => {
    for (const incoming of campaigns) {
      const row = rows.get(incoming.id);
      if (row && store.local('imported-monitor:' + incoming.id) && !recovering) continue;
      if (row?.managed) continue; // Only the managed-position protocol may advance this ledger.
      if (!row) {
        const open = incoming.actions[0];
        if (!validUsdtLiveEntry(incoming) || incoming.liveEntry.capturedAt < entryAfter || !accepting || incoming.admittedAt < entryAfter || open.at < entryAfter || now - incoming.admittedAt > entryAgeMs ||
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
      if (row.campaign.frozenMonitor && incoming.frozenMonitor &&
        JSON.stringify(row.campaign.frozenMonitor.admission.round.instantMonitor) !== JSON.stringify(incoming.frozenMonitor.admission.round.instantMonitor))
        throw Error('同一实盘战役的冻结监测模板不一致');
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
      if (incoming.frozenMonitor && !store.local('imported-monitor:' + row.campaign.id)) {
        const previous = row.campaign.frozenMonitor?.checkpoint?.endTime ?? 0;
        if ((incoming.frozenMonitor.checkpoint?.endTime ?? 0) >= previous) {
          row.campaign.frozenMonitor = incoming.frozenMonitor;
          write(row);
        }
      }
    }
    lastContactAt = now;
  };

  const mayIncrease = (row: UsdtCampaignLedger, action: UsdtFollowAction, at: number, signalTime: number) =>
    accepting && at - lastContactAt <= positionTimeout && action.at >= entryAfter
    && (row.managed || validUsdtLiveEntry(row.campaign) && (action.action !== 'open' || row.campaign.liveEntry.capturedAt >= entryAfter))
    && freshIncrease(action, signalTime);

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

  async function adopt(anchor: BinanceManualAnchor, monitor: InstantMonitorSettings, revision = store.controlRevision()) {
    if (!readManaged || !accepting) throw Error('请先开启本机实盘跟随');
    if (anchor.positionSide !== (mode === 'hedge' ? 'LONG' : 'BOTH')) throw Error('币安持仓模式与手动仓位不符');
    const id = binanceManualId(anchor);
    if (rows.has(id)) return rows.get(id)!.managed;
    const [actual, market] = await Promise.all([readManaged(anchor), readMarket(anchor.symbol)]);
    if (!market) throw Error('币安 USDT 永续合约无法核对');
    const row = createManagedUsdtLedger(anchor, monitor, actual, market, managedClock());
    const initial = syncBalance(row, market);
    await exchange.check(market, mode, initial.held, initial.entry, false, 0, 'existing-position', protectionIds?.(market.symbol, usdtLiveCampaignId(actual)));
    if (rows.has(id)) return rows.get(id)!.managed;
    if (!accepting || revision !== store.controlRevision()) throw Error('实盘跟随状态已变化，请重新确认策略托管');
    if ([...rows.values()].some(row => row.campaign.source.symbol === anchor.symbol &&
      (balance(row).held > 0 || Object.values(row.orders).some(order => !order.terminal)))) {
      throw Error('该币安合约已有一笔由本机跟随的交易');
    }
    row.managed!.armedAt = Math.max(row.managed!.armedAt, managedClock());
    write(row);
    return row.managed;
  }

  async function switchManaged(id: string, epoch: number, monitor: InstantMonitorSettings) {
    const current = rows.get(id);
    if (!current?.managed || current.managed.followBasis || current.status.state !== 'tracking' || !readManaged) throw Error('只可切换对账完成的手动托管持仓');
    const row = structuredClone(current);
    const managed = row.managed!;
    if ((managed.planEpoch ?? 0) !== epoch) throw Error('持仓方案已在别处切换，请重新选择');
    if (managed.monitor.templateId === monitor.templateId) throw Error('当前持仓已使用此模板');
    if (managed.pending || Object.values(row.orders).some(order => !order.terminal)) throw Error('正在核对实盘委托，请等成交回报');
    const [actual, market] = await Promise.all([readManaged(managed.anchor), readMarket(managed.anchor.symbol)]);
    if (!market || verifyManagedUsdtFills(row, actual, market)) throw Error('实盘仓位已平仓或等待对账');
    const held = balance(row);
    if (!held.held || quantityUnits(actual.quantity, market.step) !== held.held) throw Error('实盘仓位数量已变化，请等待对账');
    await exchange.check(market, mode, held.held, held.entry, false, 0, 'existing-position', protectionIds?.(market.symbol, id));
    if (rows.get(id) !== current) throw Error('仓位正在同步，请重新确认切换');
    const checkpoint = initialBinanceManualCheckpoint(managed);
    const initialNotional = managed.entryPrice * managed.entryQuantity;
    const expected = replayQualityHoldingLedger({ notional: initialNotional, entryPrice: managed.entryPrice, entryAt: checkpoint.entryTime!,
      additions: checkpoint.additionFills ?? (checkpoint.additionFill ? [checkpoint.additionFill] : []),
      mirror: checkpoint.mirrorFill, reductions: checkpoint.additionReductions, details: false });
    if (Math.abs(expected.held - Number(formatQuantity(held.held, market.step))) > Math.max(1e-9, expected.held * 1e-12)
      || Math.abs(expected.cost / expected.held - held.entry) > Math.max(1e-8, held.entry * 1e-5)) {
      throw Error('策略成交与币安余仓的数量或均价不一致，请先核对');
    }
    managed.checkpoint = rebaseInstantMonitorCheckpoint(checkpoint, initialNotional, managed.monitor, monitor, managedClock());
    managed.monitor = monitor;
    managed.planEpoch = epoch + 1;
    managed.revision++;
    write(row);
    return managed;
  }

  async function switchFollowMonitor(id: string, anchor: BinanceManualAnchor, epoch: number, monitor: InstantMonitorSettings,
    original?: InstantMonitorSettings, followSample?: BinanceManualPosition['followSample']) {
    const current = rows.get(id);
    if (!current?.campaign.liveEntry || !readManaged || !readPositions ||
      (current.status.state !== 'tracking' && current.status.issue !== externalReductionIssue) ||
      (current.managed && !current.managed.followBasis)) throw Error('找不到可核对的系统跟单实盘仓位');
    const previous = current.managed;
    if ((previous?.planEpoch ?? 0) !== epoch) throw Error('持仓方案已在别处切换，请重新选择');
    const originalId = current.campaign.liveEntry.templateId;
    const from = previous?.monitor ?? (original?.templateId === originalId ? original : { templateId: originalId, name: '原跟单方案' });
    if (from.templateId === monitor.templateId && current.status.issue !== externalReductionIssue) throw Error('当前持仓已使用此模板');
    if (monitor.plan.engine || monitor.plan.initialization) throw Error('该模板须从开仓开始运行，无法接手已有持仓');
    const unsettled = () => current.managed?.pending || Object.values(current.orders).some(order => !order.terminal) ||
      current.campaign.actions.some(action => !current.orders[action.id] && !current.skipped.includes(action.id));
    if (unsettled()) throw Error('原方案有委托或信号等待处理，请等成交核对完成');
    const market = await readMarket(anchor.symbol);
    const opening = market && openAnchor(current, market);
    if (!market || !opening || binanceManualId(opening) !== binanceManualId(anchor) || opening.openedAt !== anchor.openedAt)
      throw Error('实盘首仓编号已变化，请重新同步');
    const actual = await readOriginalPosition(current, market);
    const row = structuredClone(current);
    mergeUsdtExitFills(row, actual, market, true);
    const held = syncBalance(row, market);
    if (actual.closedAt || held.held <= 0 || quantityUnits(actual.quantity, market.step) !== held.held) throw Error('实盘余仓已变化，请重新同步');
    const position = (await readPositions()).positions.find(p => p.symbol === anchor.symbol && p.positionSide === anchor.positionSide && p.direction === 'long');
    const entryPrice = Number(position?.entryPrice);
    if (!position || quantityUnits(position.quantity, market.step) !== held.held || !(entryPrice > 0) || !Number.isFinite(entryPrice) ||
      Math.abs(entryPrice - held.entry) > Math.max(1e-8, held.entry * 1e-5)) throw Error('币安余仓或成本均价暂未对齐');
    await exchange.check(market, mode, held.held, entryPrice, false, 0, 'existing-position', protectionIds?.(market.symbol, binanceManualId(anchor)));
    if (rows.get(id) !== current || unsettled()) throw Error('原方案出现新的待处理信号，请重新确认切换');
    const carriedAdditions = row.campaign.actions.filter(action => action.action === 'add' && row.orders[action.id]?.fills?.length).length;
    if (monitor.plan.router?.afterAdditions && carriedAdditions >= monitor.plan.router.afterAdditions)
      throw Error('已越过新模板一次性分流的轮次，请选择能接续当前轮次的方案');
    const at = managedClock();
    const latestFill = Math.max(at, ...Object.values(row.orders).flatMap(order => (order.fills ?? []).map(fill => fill.at)));
    const effectiveAt = Math.max(previous?.checkpoint?.endTime ?? 0, Math.ceil(latestFill / MANAGED_MINUTE) * MANAGED_MINUTE);
    const quantity = Number(formatQuantity(held.held, market.step));
    const followBasis = { version: USDT_FOLLOW_MONITOR_BASIS, effectiveAt, carriedAdditions, quantity, entryPrice, realizedBefore: held.realized };
    const managed: BinanceManualPosition = { version: BINANCE_MANUAL_MONITOR_VERSION, anchor, monitor, armedAt: at,
      entryPrice, entryQuantity: quantity, planEpoch: epoch + 1, revision: (previous?.revision ?? 0) + 1,
      followBasis, followSample: previous?.followSample ?? followSample };
    managed.checkpoint = { ...initialBinanceManualCheckpoint(managed), instantMonitorSwitches: [
      ...previous?.checkpoint?.instantMonitorSwitches ?? [], { at, effectiveAt, from, to: monitor, followBasis },
    ] };
    row.managed = managed;
    row.status.state = 'tracking';
    row.status.issue = undefined;
    write(row);
    return managed;
  }

  function updateManaged(id: string, revision: number, checkpoint: QualityResult, decision?: BinanceManualDecision, planEpoch?: number, followBasisVersion?: string) {
    const current = rows.get(id);
    if (!current?.managed || current.status.state === 'closed') throw Error('找不到仍在持有的手动托管仓位');
    if (current.managed.revision !== revision || current.managed.pending || current.managed.planEpoch !== planEpoch) return current.managed;
    if (current.managed.followBasis && followBasisVersion !== USDT_FOLLOW_MONITOR_BASIS) throw Error('请更新网页后继续实盘策略');
    if (current.status.state !== 'tracking') throw Error('币安实盘仓位等待对账');
    const row = structuredClone(current);
    const managed = row.managed!;
    const entry = managed.followBasis?.effectiveAt ?? Math.ceil(managed.anchor.openedAt / MANAGED_MINUTE) * MANAGED_MINUTE;
    const earliest = Math.max(entry, managed.checkpoint?.endTime ?? Math.ceil(managed.armedAt / MANAGED_MINUTE) * MANAGED_MINUTE);
    const now = managedClock();
    if (checkpoint.status !== 'open' || checkpoint.entryPrice !== managed.entryPrice ||
      checkpoint.entryTime !== entry || !Number.isSafeInteger(checkpoint.endTime) ||
      checkpoint.endTime! % MANAGED_MINUTE !== 0 || checkpoint.endTime! < earliest || checkpoint.endTime! > now + MANAGED_MINUTE) {
      throw Error('手动托管检查点未与同一笔成交对齐');
    }
    if (managed.followBasis) {
      const prior = managed.checkpoint!;
      const realizedReductions = (value: QualityResult) => (value.additionReductions ?? []).filter(fill => fill.fraction > 0);
      if (checkpoint.initialNotional !== prior.initialNotional ||
        JSON.stringify(checkpoint.additionFills ?? (checkpoint.additionFill ? [checkpoint.additionFill] : [])) !==
          JSON.stringify(prior.additionFills ?? (prior.additionFill ? [prior.additionFill] : [])) ||
        JSON.stringify(checkpoint.mirrorFill) !== JSON.stringify(prior.mirrorFill) ||
        JSON.stringify(realizedReductions(checkpoint)) !== JSON.stringify(realizedReductions(prior))) {
        throw Error('实盘策略进度与已确认的成交不一致');
      }
    }
    if (decision) {
      const action = decision.action;
      if (!action || action.id !== 'managed-' + revision || !['add', 'mirror', 'support-reduction', 'close'].includes(decision.kind)
        || decision.kind !== action.action || !Number.isSafeInteger(action.at)
        || action.at < earliest || action.at > now + 1000 || decision.through < action.at ||
        !Number.isSafeInteger(decision.through) || decision.through > now + MANAGED_MINUTE || decision.through % MANAGED_MINUTE !== 0) {
        throw Error('手动托管动作未通过核对');
      }
      if (action.action === 'add' && (decision.kind !== 'add' || !(action.notional > 0 && Number.isFinite(action.notional))
        || action.at !== decision.evidence?.at || action.notional !== decision.evidence.notional
        || (action.impulseFreshUntil !== undefined && (action.at % 300_000 !== 0 || action.impulseFreshUntil !== action.at + 300_000)))) {
        throw Error('手动托管加仓金额或时点未通过核对');
      }
      if ((action.action === 'mirror' || action.action === 'support-reduction') &&
        ((decision.kind !== 'mirror' && decision.kind !== 'support-reduction') || !(action.fraction > 0 && action.fraction < 1)
          || action.fraction !== decision.evidence?.fraction || action.at !== decision.evidence.at)) {
        throw Error('手动托管减仓比例或时点未通过核对');
      }
      if (checkpoint.endTime! > action.at) throw Error('手动托管动作早于已确认进度');
      managed.pending = decision;
      row.campaign.actions.push(action);
    }
    managed.checkpoint = managed.planEpoch == null ? checkpoint : {
      ...checkpoint, instantMonitorSwitches: managed.checkpoint!.instantMonitorSwitches, followBasis: managed.followBasis,
    };
    managed.revision++;
    lastContactAt = Date.now();
    write(row);
    return managed;
  }

  function skipManagedAction(row: UsdtCampaignLedger, market: UsdtMarket, action: UsdtFollowAction, current: ReturnType<typeof balance>) {
    if (row.managed?.pending?.action.id !== action.id) return;
    row.orders[action.id] = { id: usdtOrderId(owner, row.campaign.id, action.id), side: action.action === 'add' ? 'BUY' : 'SELL',
      quantity: '0', terminal: true, fills: [] };
    settleManagedUsdtDecision(row, action.id, market, current);
  }

  function reconcileExit(row: UsdtCampaignLedger, actual: UsdtLiveCampaign, market: UsdtMarket) {
    const next = structuredClone(row);
    const pendingBuy = Object.values(next.orders).some(order => order.side === 'BUY' && !order.terminal);
    if (pendingBuy) {
      const known = new Set(Object.values(next.orders).flatMap(order => (order.fills ?? []).map(fill => fill.id)));
      if (actual.fills.some(fill => fill.side === 'BUY' && !known.has(fill.id))) {
        throw Error('币安有尚未归属的买入成交，等待核对实盘余仓');
      }
    }
    const fills = mergeUsdtExitFills(next, actual, market, true);
    if (!fills.length && !actual.closedAt) return false;
    const held = syncBalance(next, market);
    if (held.held !== quantityUnits(actual.quantity, market.step)) throw Error('币安实际成交与当前余仓暂未对齐');
    const managed = next.managed;
    if (managed) {
      if (managed.pending) next.skipped.push(managed.pending.action.id);
      managed.pending = undefined;
      managed.revision++;
      if (fills.length) {
        const at = fills.at(-1)!.at;
        const quantity = Number(formatQuantity(held.held, market.step));
        const prior = managed.checkpoint;
        if (prior && !actual.closedAt) {
          managed.checkpoint = { ...prior, remainingQuantity: quantity, remainingCost: held.entry * quantity,
            averageEntryPrice: held.entry, realizedPnl: held.realized, pendingExit: undefined,
            endTime: Math.max(prior.endTime ?? 0, Math.ceil(at / MANAGED_MINUTE) * MANAGED_MINUTE) };
        } else if (!prior && !actual.closedAt) {
          managed.exchangeReduction = { at, quantity, entryPrice: held.entry, realized: held.realized };
        }
      }
    }
    const pausedAfterReduction = !!managed?.followBasis && !!fills.length && !actual.closedAt;
    next.status.state = pendingBuy || pausedAfterReduction ? 'blocked' : actual.closedAt ? 'closed' : 'tracking';
    next.status.issue = pendingBuy ? unsettledBuyIssue : pausedAfterReduction ? externalReductionIssue : undefined;
    write(next);
    return true;
  }

  function openAnchor(row: UsdtCampaignLedger, market: UsdtMarket) {
    const open = row.orders.open;
    const first = [...(open?.fills ?? [])].sort((a, b) =>
      a.at - b.at || a.id.length - b.id.length || a.id.localeCompare(b.id))[0];
    return row.managed?.anchor ?? (open?.exchangeId && first ? {
      symbol: market.symbol, positionSide: mode === 'hedge' ? 'LONG' as const : 'BOTH' as const,
      openedAt: first.at, openingTradeId: first.id, openingOrderId: open.exchangeId,
    } : undefined);
  }

  async function readOriginalPosition(row: UsdtCampaignLedger, market: UsdtMarket) {
    const anchor = openAnchor(row, market);
    if (!anchor || !readManaged) throw Error('缺少可核对的币安首仓成交，暂缓实盘操作');
    const actual = await readManaged(anchor);
    if (!matchesManualAnchor(anchor, actual)) throw Error('币安仓位已换成另一笔首仓，暂缓实盘操作');
    return actual;
  }

  async function step(row: UsdtCampaignLedger, now: number) {
    if (row.status.state === 'closed' || row.status.state === 'ignored') return;
    const { campaign } = row;
    const opened = row.orders.open;
    const outstanding = Object.entries(row.orders).filter(([,order]) => !order.terminal);
    const existing = outstanding.find(([,order]) => order.side === 'SELL') ?? outstanding[0];
    const closing = row.managed
      ? row.managed.pending?.action.action === 'close' ? row.managed.pending.action : undefined
      : campaign.actions.find(action => action.action === 'close');
    if (!opened && !existing && (closing || !accepting || campaign.actions[0].at < entryAfter
      || !validUsdtLiveEntry(campaign) || campaign.liveEntry.capturedAt < entryAfter || now > campaign.actions[0].at + entryAgeMs)) {
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
    let current = syncBalance(row, market);
    let unsettledBuyId: string | undefined;
    if (existing) {
      const [key, order] = existing;
      const canCheckExit = closing && order.side === 'BUY' && order.limitPrice && current.held > 0;
      const report = await exchange.order(market, mode, order, false).catch(error => {
        if (!canCheckExit) throw error;
        return undefined;
      });
      if (report) applyReport(row, key, market, report);
      if (report?.terminal) return;
      if (!canCheckExit) {
        if (!report) throw Error(order.side === 'BUY' ? unsettledBuyIssue : '币安订单回报未齐，正在按原编号核对');
        return;
      }
      unsettledBuyId = order.id;
      current = syncBalance(row, market);
    }
    if (row.managed) {
      if (!readManaged) throw Error('当前执行器无法核对手动托管仓位');
      const pending = row.managed.pending;
      if (!pending && (managedChecked.get(campaign.id) ?? 0) + 12_000 > now) return;
      const actual = await readManaged(row.managed.anchor);
      if (row !== rows.get(campaign.id)) return;
      managedChecked.set(campaign.id, now);
      if (readPositions && reconcileExit(row, actual, market)) return;
      if (verifyManagedUsdtFills(row, actual, market)) {
        syncBalance(row, market);
        row.status.state = 'closed';
        row.status.issue = undefined;
        row.managed.pending = undefined;
        return write(row);
      }
      current = syncBalance(row, market);
      if (!pending) {
        if (row.status.issue === externalReductionIssue) return;
        if (row.status.state !== 'tracking' && !closing) {
          row.status.state = 'tracking';
          row.status.issue = undefined;
          write(row);
        }
        return;
      }
    }
    if (!row.managed && readPositions && readManaged && opened?.exchangeId && opened.fills?.length && current.held) {
      const positionSide = mode === 'hedge' ? 'LONG' : 'BOTH';
      const snapshot = await readPositions();
      const position = snapshot.positions.find(item => item.symbol === market.symbol && item.positionSide === positionSide && item.direction === 'long');
      if (!position || quantityUnits(position.quantity, market.step) !== current.held ||
        Math.abs(Number(position.entryPrice) - current.entry) > Math.max(1e-8, current.entry * 1e-5)) {
        const actual = await readOriginalPosition(row, market);
        if (reconcileExit(row, actual, market)) return;
      }
    }
    if (opened && !current.held) {
      row.status.state = current.initial ? 'closed' : 'ignored';
      if (!current.initial) row.status.issue ||= '首仓未成交';
      return write(row);
    }
    let action: UsdtFollowAction | undefined = unsettledBuyId ? closing
      : row.managed?.followBasis ? row.managed.pending?.action
      : campaign.actions.find(event => !row.orders[event.id] && !row.skipped.includes(event.id));
    if (closing && current.held && action?.action !== 'close') {
      // If the position is already closing, replaying missed buys or partial exits could add risk.
      row.skipped.push(...campaign.actions.filter(event => event.action !== 'close' && !row.orders[event.id] && !row.skipped.includes(event.id)).map(event => event.id));
      action = closing;
    }
    if (closing && current.held && !action && !row.skipped.includes(closing.id)) action = closing;
    if (!action || row.skipped.includes(action.id)) return;
    const side = action.action === 'open' || action.action === 'add' ? 'BUY' : 'SELL';
    const signalNow = row.managed ? managedClock() : now;
    if (side === 'BUY' && !mayIncrease(row, action, now, signalNow)) {
      row.skipped.push(action.id);
      row.status.issue = '该笔买入已过时，未追单';
      skipManagedAction(row, market, action, current);
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
      : 'fraction' in action ? Math.floor((action.action === 'mirror'
        ? row.managed?.followBasis ? Math.round(row.managed.followBasis.quantity / stepSize) : current.initial : current.held) * action.fraction + 1e-9)
      : Math.floor(notional / price / stepSize + 1e-9);
    const decision = row.managed?.pending;
    let limit = side === 'BUY' ? market.max : current.held;
    if (decision?.kind === 'add' && decision.evidence.sizing) {
      const { support } = decision.evidence.sizing;
      if (price <= support) limit = 0;
      else if (decision.evidence.positionVersion === HOLDING_LEDGER_ADDITION_VERSION) {
        const held = current.held * stepSize;
        const budget = calculateHoldingLedgerAddition({ held, cost: held * current.entry,
          realized: current.realized - (row.managed?.followBasis?.realizedBefore ?? 0) }, price, support);
        limit = budget.error ? 0 : Math.min(limit, Math.floor(budget.addCoins / stepSize + 1e-9));
      } else {
        // The saved legacy formula selected coin quantity at the strategy price.
        // Keep the same risk budget at an adverse executable quote.
        const plannedRisk = decision.evidence.quantity * (decision.evidence.price - support);
        limit = Math.min(limit, Math.max(0, Math.floor(plannedRisk / (price - support) / stepSize + 1e-9)));
      }
    }
    const units = Math.min(desired, market.max, limit);
    const quantity = formatQuantity(units, market.step);
    if (units < market.min || (side === 'BUY' && Number(quantity) * price < market.minNotional)
      || (side === 'SELL' && action.action !== 'close' && Number(quantity) * price < market.minNotional)) {
      row.skipped.push(action.id);
      row.status.state = opened ? 'tracking' : 'ignored';
      if (action.action === 'close') row.status.state = 'blocked';
      row.status.issue = '按方案金额或减仓比例换算后低于币安最小委托';
      if (action.action !== 'close') skipManagedAction(row, market, action, current);
      return write(row);
    }
    const opening = opened?.fills?.[0];
    const liveId = opened?.exchangeId && opening ? usdtLiveCampaignId({
      symbol: market.symbol, positionSide: mode === 'hedge' ? 'LONG' : 'BOTH', direction: 'long',
      fills: [{ id:opening.id, orderId:opened.exchangeId }],
    }) : undefined;
    const liveLeverage = !campaign.frozenMonitor?.admission.round.instantPosition && readPositions && liveId ? store.positionLeverage(liveId)?.leverage : undefined;
    const maySendBuy = () => {
      const checkedAt = Math.max(now, Date.now());
      return mayIncrease(row, action, checkedAt, row.managed ? managedClock() : checkedAt) &&
        !(row.managed ? row.managed.pending?.action.action === 'close' : row.campaign.actions.some(event => event.action === 'close'));
    };
    const confirmOpening = () => {
      if (!maySendBuy()) throw Error('开仓条件已失效，暂缓修改实盘合约设置');
    };
    if (action.action === 'open') await protection?.beforeOpening(market.symbol);
    await exchange.check(market, mode, current.held, current.entry, action.action === 'open',
      side === 'BUY' ? liveLeverage ?? campaign.leverage : 0,
      row.managed ? campaign.frozenMonitor?.admission.round.instantPosition && row.managed.followBasis ? 'frozen-leverage' : 'existing-position' : undefined, liveId ? protectionIds?.(market.symbol, liveId) : undefined, unsettledBuyId,
      ...(action.action === 'open' ? [confirmOpening] as const : []));
    if (action.action !== 'open') {
      const actual = await readOriginalPosition(row, market);
      if (row !== rows.get(campaign.id) || reconcileExit(row, actual, market)) return;
      if (quantityUnits(actual.quantity, market.step) !== current.held) throw Error('币安首仓已核实，实际余仓仍待对账');
    }
    if (side === 'BUY' && !maySendBuy()) return;
    const attempts = Object.entries(row.orders).filter(([key]) => key === closing?.id || key.startsWith(closing?.id + ':'));
    const failedCloses = attempts.filter(([, order]) => !order.fills?.length).length;
    if (action.action === 'close' && (row.managed ? failedCloses >= 3 : attempts.length && !attempts.at(-1)?.[1].fills?.length)) {
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
    row.status.issue = unsettledBuyId ? unsettledBuyIssue : undefined;
    write(row); // Durable before POST. An ambiguous POST is only ever queried by this same ID.
    const report = await exchange.order(market, mode, order, true);
    if (!report) throw Error('币安订单回报未齐，正在按原编号核对');
    applyReport(row, key, market, report);
  }

  function applyReport(row: UsdtCampaignLedger, key: string, market: UsdtMarket, report: NonNullable<Awaited<ReturnType<UsdtExchange['order']>>>) {
    const previous = row.orders[key];
    const previousManaged = row.managed && structuredClone(row.managed);
    if (previous.exchangeId && report.exchangeId !== previous.exchangeId) throw Error('币安订单编号与本机记录不同');
    if (report.fills.reduce((sum, fill) => sum + fill.quantity, 0) < (previous.fills ?? []).reduce((sum, fill) => sum + fill.quantity, 0))
      throw Error('币安返回了较旧的累计成交记录');
    const next = { ...previous, terminal: report.terminal, exchangeId: report.exchangeId, fills: report.fills };
    row.orders[key] = next;
    try {
      const held = syncBalance(row, market);
      const pendingBuy = Object.values(row.orders).some(order => order.side === 'BUY' && !order.terminal);
      row.status.state = report.terminal ? pendingBuy ? 'blocked' : held.held ? 'tracking' : held.initial ? 'closed' : 'ignored' : 'waiting';
      row.status.orderId = report.exchangeId;
      row.status.issue = pendingBuy && report.terminal ? unsettledBuyIssue : report.issue ?? (report.terminal && report.fills.reduce((sum, fill) => sum + fill.quantity, 0)
        < quantityUnits(previous.quantity, market.step) ? '订单部分成交，余仓按币安回报跟踪' : undefined);
      settleManagedUsdtDecision(row, key, market, held);
      if (row.managed?.pending?.kind === 'close' && report.terminal && !report.fills.length) {
        cooldown.set(row.campaign.id, Date.now() + 5000);
      }
      write(row);
    } catch (error) {
      row.orders[key] = previous;
      row.managed = previousManaged;
      throw error;
    }
  }

  return {
    ingest, adopt, switchManaged, switchFollowMonitor, updateManaged,
    updateRecovered(incoming: UsdtFollowCampaign) {
      const row = rows.get(incoming.id);
      if (!row || row.managed || !store.local('imported-monitor:' + incoming.id) || !incoming.frozenMonitor ||
        JSON.stringify(row.campaign.frozenMonitor?.admission) !== JSON.stringify(incoming.frozenMonitor.admission) ||
        (incoming.frozenMonitor.checkpoint?.endTime ?? 0) < (row.campaign.frozenMonitor?.checkpoint?.endTime ?? 0))
        throw Error('交接监测状态身份或进度不符');
      ingest([incoming], Date.now(), true);
      row.campaign.frozenMonitor = incoming.frozenMonitor;
      write(row);
    },
    captureFrozenMonitors(campaigns: UsdtFollowCampaign[]) {
      for (const incoming of campaigns) {
        const row = rows.get(incoming.id), frozen = incoming.frozenMonitor;
        if (!row || row.managed || !frozen || store.local('imported-monitor:' + incoming.id) || ['closed','ignored'].includes(row.status.state)) continue;
        if (row.campaign.source.symbol !== incoming.source.symbol || row.campaign.notional !== incoming.notional ||
          row.campaign.leverage !== incoming.leverage || row.campaign.admittedAt !== incoming.admittedAt ||
          row.campaign.liveEntry?.templateId !== frozen.admission.round.instantMonitor?.templateId ||
          JSON.stringify(row.campaign.actions[0]) !== JSON.stringify(incoming.actions[0]))
          throw Error('原网页监测快照与实盘战役不符');
        if ((frozen.checkpoint?.endTime ?? 0) < (row.campaign.frozenMonitor?.checkpoint?.endTime ?? 0)) continue;
        if (row.campaign.frozenMonitor &&
          JSON.stringify(row.campaign.frozenMonitor.admission.round.instantMonitor) !== JSON.stringify(frozen.admission.round.instantMonitor))
          throw Error('原冻结模板已变化，禁止覆盖');
        row.campaign.frozenMonitor = frozen;
        write(row);
      }
    },
    async runPositionControl<T>(run: () => Promise<T>) {
      if (frozen) throw Error('执行器已冻结，禁止实盘操作');
      if (manual) throw Error('另一笔实盘操作正在进行，请稍后重试');
      manual = true;
      try {
        if (active) await new Promise<void>(resolve => { finishTick = resolve; });
        return await run();
      } finally { manual = false; }
    },
    async quiesce() {
      frozen = true;
      accepting = false;
      while (active || manual) await new Promise(resolve => setTimeout(resolve, 10));
    },
    thaw() { frozen = false; accepting = !store.paused(); entryAfter = Date.now(); lastContactAt = 0; },
    async reconcileForHandoff() {
      if (active || manual) throw Error('执行器仍在处理上一笔操作');
      for (const row of rows.values()) {
        if (['closed', 'ignored'].includes(row.status.state)) continue;
        const market = await readMarket(row.campaign.source.symbol);
        if (!market) throw Error('交接缺少原合约规格');
        for (const [key, order] of Object.entries(row.orders)) {
          if (order.terminal) continue;
          const report = await exchange.order(market, mode, order, false);
          if (!report) throw Error('未决订单尚未查明，交接保持冻结，禁止换编号补单');
          applyReport(row, key, market, report);
        }
        const held = syncBalance(row, market);
        if (held.held && readManaged && row.orders.open?.exchangeId && row.orders.open.fills?.length) {
          const actual = await readOriginalPosition(row, market);
          if (reconcileExit(row, actual, market)) continue;
        }
        write(row);
      }
    },
    managed: (includeFollow = false) => [...rows.values()].filter(row => row.managed && row.status.state !== 'closed' && (includeFollow || !row.managed.followBasis))
      .map(row => ({ position: row.managed!, status: row.status })),
    managedArchive: (id: string) => {
      const managed = rows.get(id)?.managed;
      return managed && { version: managed.version, monitor: managed.monitor, armedAt: managed.armedAt,
        ...(managed.checkpoint?.selectedL0Pct !== undefined ? { selectedL0Pct: managed.checkpoint.selectedL0Pct } : {}),
        ...(managed.checkpoint?.instantMonitorSwitches ? { switches: managed.checkpoint.instantMonitorSwitches } : {}),
        ...(managed.checkpoint?.status === 'closed' ? { exitReason: managed.checkpoint.reason } : {}) };
    },
    pauseNewOrders: () => { store.setPaused(true); accepting = false; },
    resumeNewOrders: (now = Date.now()) => { if (frozen) throw Error('交接冻结尚未解除'); store.setPaused(false); entryAfter = now; accepting = true; },
    get entryAfter() { return entryAfter; },
    get paused() { return !accepting; },
    statuses: () => [...rows.values()].map(row => row.campaign.liveEntry && (!row.managed || row.managed.followBasis)
      ? { ...row.status, followMonitorTemplateId: row.managed?.monitor.templateId ?? row.campaign.liveEntry.templateId,
        canSwitchFollowMonitor: !row.managed?.pending && (row.status.state === 'tracking' || row.status.issue === externalReductionIssue) }
      : row.status),
    async tick(now = Date.now()) {
      if (active || manual || frozen) return;
      active = true;
      try {
        const prioritized = [...rows.values()].sort((a, b) =>
          Number(b.campaign.actions.some(event => event.action === 'close')) - Number(a.campaign.actions.some(event => event.action === 'close')));
        for (const row of prioritized) {
          if (manual || frozen) break;
          if (row !== rows.get(row.campaign.id)) continue;
          if ((cooldown.get(row.campaign.id) ?? 0) > now) continue;
          if (row.status.state === 'closed') continue;
          try { await step(row, now); }
          catch (error) {
            if (row !== rows.get(row.campaign.id)) continue;
            row.status.state = 'blocked';
            row.status.issue = error instanceof Error ? error.message : '币安同步暂不可用';
            write(row);
            cooldown.set(row.campaign.id, Date.now() + 3000);
          }
          if (rows.get(row.campaign.id)?.status.state === 'closed') {
            await protection?.cleanup(row.campaign.source.symbol).catch(() => undefined);
          }
        }
      } finally {
        active = false;
        finishTick?.();
        finishTick = undefined;
      }
    },
  };
}
