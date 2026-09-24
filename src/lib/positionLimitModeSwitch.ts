/**
 * 从「无限制」切到「币安标准」那一刻，哪些已挂的委托到触发 / 成交时会被币安的规则撤掉——切换提示里说出来。
 *
 * 每一次判定都按那一刻的模式（lib/positionLimitMode）：无限制模式下挂出的委托切到币安标准之后，触发 / 成交那一刻按币安判，
 * 过不去就撤单留痕。其中最要紧的是**按成数挂的止盈止损**：无限制下不判单笔市价上限，切过去之后触发那一刻超上限就被撤，
 * 仓位在最需要保护的时候没了止损。委托列表会标「触发时将超单笔上限」「触发时将超限」，但切换那一刻就该说——
 * 与委托列表的标记同一个判定（marketLotSize.pendingLotSizeRisk、positionLimit.doomedAtTrigger），按此刻的持仓、挂单与价格预判。
 */
import type { PendingOrder, Position } from '@/types/trading';
import { doomedAtTrigger } from '@/lib/positionLimit';
import { pendingLotSizeRisk } from '@/lib/marketLotSize';

export interface BinanceSwitchRisk {
  /** 按币安标准到时会被撤的委托张数。 */
  total: number;
  /** 其中的止盈止损（只减仓的保护单）张数。 */
  protective: number;
  /** 涉及的标的（按出现先后）。 */
  symbols: string[];
}

export function ordersRefusedUnderBinance(
  ordersMap: Readonly<Record<string, readonly PendingOrder[] | undefined>> | null | undefined,
  positionsMap: Readonly<Record<string, readonly Position[] | undefined>> | null | undefined,
  priceMap: Readonly<Record<string, number | undefined>> | null | undefined,
): BinanceSwitchRisk {
  const out: BinanceSwitchRisk = { total: 0, protective: 0, symbols: [] };
  for (const [symbol, list] of Object.entries(ordersMap ?? {})) {
    const orders = list ?? [];
    const positions = positionsMap?.[symbol] ?? [];
    const mark = Number(priceMap?.[symbol]) || 0;
    for (const order of orders) {
      const refused = pendingLotSizeRisk(symbol, order, mark, 'binance') != null
        || (!order.reduceOnly && doomedAtTrigger(symbol, order, positions, orders, mark, 'binance') != null);
      if (!refused) continue;
      out.total += 1;
      if (order.reduceOnly) out.protective += 1;
      if (!out.symbols.includes(symbol)) out.symbols.push(symbol);
    }
  }
  return out;
}

/** 切换提示里的那一句；没有会被撤的委托时为 null。 */
export function binanceSwitchRiskText(risk: BinanceSwitchRisk): string | null {
  if (risk.total === 0) return null;
  const protective = risk.protective > 0 ? `（其中 ${risk.protective} 张止盈止损——触发时撤掉，仓位就没了这道保护）` : '';
  return `注意：${risk.symbols.join('、')} 有 ${risk.total} 张挂着的委托按币安标准到触发 / 成交时会被撤销${protective}，`
    + '当前委托里已标出；要保住就撤单后按上限拆开重挂，或切回无限制。';
}
