import type { OrderSide, OrderType, PendingOrder, Position, TriggerOperator } from '@/types/trading';
import { getPositionUnits, isCoinSettled } from '@/lib/tradingSettlement';

/**
 * 把一笔仓位的止盈 / 止损，造成两张**减仓条件单**。
 *
 * 这段逻辑此前只长在 handlePlaceTpSl 里（持仓卡上的「止盈/止损」按钮）。
 * 下单面板那个「止盈止损」勾选框走的是完全另一条路——它把类型改写成
 * LIMIT_TP_SL / MARKET_TP_SL，再把止盈价塞进 stopPrice，于是引擎把
 * **止盈价当成开仓触发价**（Index.tsx:1136-1144）。抽成纯函数是为了让两条路
 * 造出同一种东西：附在仓位上的减仓单，而不是另一张会开仓的单子。
 *
 * 纯函数，唯一的外部依赖是 id 生成器（测试里可注入）。
 */
export interface TpSlLevels {
  tp: number | null;
  sl: number | null;
  /** 平掉仓位的百分比 (0, 100]。 */
  percentage: number;
}

export interface TpSlValidationError {
  message: string;
  field: 'tp' | 'sl' | 'levels' | 'quantity';
}

/**
 * 逐腿校验。**必须逐腿**——早先一发现坏腿就整体返回,于是止盈框里一个笔误
 * 会把那张完全合法的止损单一起吞掉,而止损正是唯一负责封住亏损的那一支。
 */
export interface TpSlLegVerdict {
  tp: TpSlValidationError | null;
  sl: TpSlValidationError | null;
  /** 两边都没填。 */
  empty: boolean;
}

export function validateTpSlLegs(
  side: OrderSide,
  levels: TpSlLevels,
  referencePrice: number,
): TpSlLegVerdict {
  const { tp, sl } = levels;
  const hasTp = tp !== null && tp > 0;
  const hasSl = sl !== null && sl > 0;
  if (!hasTp && !hasSl) return { tp: null, sl: null, empty: true };

  // 参照价对市价单是成交价、对限价单是委托价——都不是「此刻的盘口」。
  // 拿盘口去校验一张挂在别处的限价单，会把完全合理的止盈判成方向错误。
  if (!(referencePrice > 0)) return { tp: null, sl: null, empty: false };

  let tpErr: TpSlValidationError | null = null;
  let slErr: TpSlValidationError | null = null;
  if (hasTp) {
    if (side === 'LONG' && tp! <= referencePrice) tpErr = { message: '多单止盈价必须高于开仓价', field: 'tp' };
    if (side === 'SHORT' && tp! >= referencePrice) tpErr = { message: '空单止盈价必须低于开仓价', field: 'tp' };
  }
  if (hasSl) {
    if (side === 'LONG' && sl! >= referencePrice) slErr = { message: '多单止损价必须低于开仓价', field: 'sl' };
    if (side === 'SHORT' && sl! <= referencePrice) slErr = { message: '空单止损价必须高于开仓价', field: 'sl' };
  }
  return { tp: tpErr, sl: slErr, empty: false };
}

/** 整体判定，供「下单前就该拦住」的调用方使用。 */
export function validateTpSlLevels(
  side: OrderSide,
  levels: TpSlLevels,
  referencePrice: number,
): TpSlValidationError | null {
  const v = validateTpSlLegs(side, levels, referencePrice);
  if (v.empty) return { message: '请至少输入一个有效的触发价格', field: 'levels' };
  return v.tp ?? v.sl;
}

/** 丢掉方向不合法的那一腿，另一腿照挂。 */
export function keepValidTpSlLegs(
  side: OrderSide,
  levels: TpSlLevels,
  referencePrice: number,
): { levels: TpSlLevels; dropped: TpSlValidationError[] } {
  const v = validateTpSlLegs(side, levels, referencePrice);
  const dropped = [v.tp, v.sl].filter(Boolean) as TpSlValidationError[];
  return {
    levels: { ...levels, tp: v.tp ? null : levels.tp, sl: v.sl ? null : levels.sl },
    dropped,
  };
}

/** 按成数算出要平掉的量；币本位只能是整数张，且不足一张时至少一张。 */
export function tpSlCloseUnits(position: Position, percentage: number): number {
  const safePct = Math.min(100, Math.max(1, percentage));
  const totalUnits = getPositionUnits(position);
  if (!(totalUnits > 0)) return 0;
  return isCoinSettled(position)
    ? Math.max(1, Math.round(totalUnits * (safePct / 100)))
    : totalUnits * (safePct / 100);
}

export function buildTpSlOrders(args: {
  symbol: string;
  position: Position;
  levels: TpSlLevels;
  now: number;
  newId: () => string;
}): PendingOrder[] {
  const { symbol, position, levels, now, newId } = args;
  const closeQty = tpSlCloseUnits(position, levels.percentage);
  if (!(closeQty > 0)) return [];

  const safePct = Math.min(100, Math.max(1, levels.percentage));
  const closeSide: OrderSide = position.side === 'LONG' ? 'SHORT' : 'LONG';
  const coin = isCoinSettled(position);

  const make = (kind: 'TP' | 'SL', trigger: number): PendingOrder => {
    // 止盈与止损的方向天然相反，且都由**仓位方向**决定，与平仓单自身的方向无关。
    const operator: TriggerOperator = kind === 'TP'
      ? (position.side === 'LONG' ? '>=' : '<=')
      : (position.side === 'LONG' ? '<=' : '>=');
    return {
      id: newId(), side: closeSide, type: 'CONDITIONAL' as OrderType,
      price: 0, stopPrice: trigger, quantity: closeQty,
      leverage: position.leverage, marginMode: position.marginMode,
      settlementMode: position.settlementMode, settlementAsset: position.settlementAsset,
      contractSizeUsd: position.contractSizeUsd,
      contracts: coin ? closeQty : undefined,
      status: 'PENDING', createdAt: now,
      conditionalExecType: 'MARKET',
      operator, triggerDirection: operator === '>=' ? 'UP' : 'DOWN',
      reduceOnly: true, reduceSymbol: symbol, reducePositionSide: position.side,
      linkedPositionId: position.id, reduceKind: kind, reducePercentage: safePct,
    };
  };

  const out: PendingOrder[] = [];
  if (levels.tp !== null && levels.tp > 0) out.push(make('TP', levels.tp));
  if (levels.sl !== null && levels.sl > 0) out.push(make('SL', levels.sl));
  return out;
}

/** 同一笔仓位上已有的减仓单要被替换，不是叠加——否则一次改价会留下两张止盈。 */
export function replaceTpSlOrders(existing: PendingOrder[], positionId: string, next: PendingOrder[]): PendingOrder[] {
  return [...existing.filter(o => !(o.reduceOnly && o.linkedPositionId === positionId)), ...next];
}
