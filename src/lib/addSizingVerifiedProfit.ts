import { detectBankedMirrorProfit, type AddSide } from '@/lib/addSizing';
import { readHeldPosition } from '@/lib/addSizing';
import { calculateAddRiskBudget } from '@/lib/addPositionCoverage';
import { verifyAddSizingRealizedRecords } from '@/lib/campaignLegExecution';
import { calcSlippage, type AddSizingSnapshot, type Position, type TradeRecord } from '@/types/trading';

/**
 * 本场已实现的盈亏记录：主方向的每一刀，加上本场中途**反向对冲腿**（主多的空单、主空的多单）已平掉的每一刀。
 *
 * 【用户要求】中途对冲单已产生的盈亏也要并进加仓：以盈利结束与镜像止盈一致（加进 G），
 * 以亏损结束则相反（带「−」从 G 里扣掉）。所以按带号的净额累加，不只收盈利。
 */
export function addSizingProfitRecords(symbol: string, side: AddSide, history: TradeRecord[] = [],
  openTime: number | null, openedRealAt: number | null): TradeRecord[] {
  if (openTime == null) return [];
  return [...new Map(history.filter(record => record.symbol === symbol
    && (record.side === 'LONG' || record.side === 'SHORT')
    && (record.action === 'CLOSE' || record.action === 'LIQUIDATION') && record.closeTime >= openTime
    && (openedRealAt == null || (record.closedRealAt != null && record.closedRealAt >= openedRealAt)))
    .map(record => [record.id, record])).values()];
}

/** usd = mainUsd + hedgeUsd：主方向落袋净额与反向对冲腿已实现盈亏（带号）。 */
export interface VerifiedAddSizingProfit { complete: boolean; usd: number; mainUsd: number; hedgeUsd: number }
const verifiedProfitCache = new Map<string, VerifiedAddSizingProfit>();
const profitCacheKey = (symbol: string, side: AddSide, records: TradeRecord[]) => `${symbol}:${side}:`
  + records.map(record => `${record.id}:${record.fillId}:${record.settlementMode}:${record.pnl}:${record.entryPrice}:${record.exitPrice}:${record.closeTime}:${record.quantity}:${record.contracts}:${record.contractSizeUsd}`).sort().join('|');

export function cachedVerifiedAddSizingProfit(symbol: string, side: AddSide, records: TradeRecord[]) {
  return verifiedProfitCache.get(profitCacheKey(symbol, side, records)) ?? null;
}

export async function verifiedAddSizingProfit(symbol: string, side: AddSide, records: TradeRecord[]): Promise<VerifiedAddSizingProfit> {
  const key = profitCacheKey(symbol, side, records);
  const cached = verifiedProfitCache.get(key);
  if (cached) return cached;
  const checked = await verifyAddSizingRealizedRecords(symbol, records);
  // 反向对冲腿已平掉的盈亏带号并入：赚了加、亏了减（磨损）
  const hedgeUsd = checked.records.reduce((sum, record) => record.side !== side && Number.isFinite(record.pnl)
    ? sum + record.pnl : sum, 0);
  const mainUsd = detectBankedMirrorProfit(symbol, side, checked.records, 0).usd;
  const result = { complete: checked.complete, usd: mainUsd + hedgeUsd, mainUsd, hedgeUsd };
  if (result.complete) {
    verifiedProfitCache.set(key, result);
    if (verifiedProfitCache.size > 128) verifiedProfitCache.delete(verifiedProfitCache.keys().next().value!);
  }
  return result;
}

/** Recheck a calculator-backed order after quantity, price or order mode has changed. */
export async function checkVerifiedAddOrder(input: {
  symbol: string; snapshot: AddSizingSnapshot; positions: Position[]; history: TradeRecord[];
  kind: 'market' | 'limit' | 'conditional'; referencePrice: number | (() => number); units: number; face: number;
}) {
  const { snapshot, symbol, kind, units, face } = input;
  const held = readHeldPosition(symbol, input.positions, snapshot.side, face);
  if (!held) return { ok: true as const, snapshot };
  const records = addSizingProfitRecords(symbol, snapshot.side, input.history, held.earliestOpenTime, held.earliestOpenedRealAt);
  const profit = await verifiedAddSizingProfit(symbol, snapshot.side, records);
  if (!profit.complete) return { ok: false as const, message: '落袋收益尚未核验，请重新打开加仓计算器后重试。' };
  const referencePrice = typeof input.referencePrice === 'function' ? input.referencePrice() : input.referencePrice;
  const coin = snapshot.settlement === 'coin';
  const notional = coin ? units * face : units * referencePrice;
  const fillPrice = kind === 'limit' ? referencePrice : calcSlippage(referencePrice, notional, snapshot.side);
  const direction = snapshot.side === 'SHORT' ? -1 : 1;
  const risk = (fillPrice - snapshot.s1) * direction;
  const cushion = held.coins * (snapshot.s1 - held.avgEntry) * direction;
  const budget = calculateAddRiskBudget(cushion, profit.usd, risk);
  const coins = coin ? notional / fillPrice : units;
  if (!(referencePrice > 0) || !(units > 0) || !budget || !Number.isFinite(coins)) {
    return { ok: false as const, message: '当前价格与止损线无法形成有效的加仓额度，请重新计算。' };
  }
  const tolerance = Math.max(0.01, Math.abs(budget.available) * 1e-6);
  if (coins * risk > budget.available + tolerance) return { ok: false as const,
    message: `当前${kind === 'limit' ? '限价' : kind === 'conditional' ? '条件单' : '市价'}上限为 ${budget.maxAddCoins.toLocaleString('en-US', { maximumFractionDigits: 4 })} 币；价格、数量或下单方式已改变，请按当前条件重新计算。` };
  return { ok: true as const, snapshot: { ...snapshot, profitBasis: 'verified_net' as const, sBar: held.avgEntry, x1: held.coins,
    s2Ref: referencePrice, s2AtOrder: referencePrice, s2Fill: fillPrice, orderKind: kind,
    g: coin ? profit.usd / snapshot.s1 : profit.usd,
    addCoinsMax: budget.maxAddCoins,
    contracts: coin ? Math.floor(budget.maxAddCoins * fillPrice / face) : null,
    slippagePct: (fillPrice / referencePrice - 1) * 100 } };
}
