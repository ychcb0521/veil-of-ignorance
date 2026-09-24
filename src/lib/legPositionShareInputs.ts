import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import {
  computeLegPositionShares,
  legPositionSideFromDirection,
  resolveLegPositionShareSide,
  type LegPositionShareInput,
  type LegPositionSide,
} from '@/lib/legPositionShare';
import { legRowStatus, type LegFillEvidence } from '@/lib/legRowStatus';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/**
 * Legs 表「币量 / 仓位」与「占比」的逐腿输入：币量 = 名义 ÷ 开仓价，逐腿只算一次，格子里的数就是分母里加的那个数；
 * 多单、空单按持仓方向（与涨跌幅同源，不看角色）分开算；状态为「挂单中」的腿（还没有成交）不进任何合计，
 * 已成交未平的是真实持仓、照常计入——判定与角色标签的空心样式同一个 legRowStatus。
 * 页面 Legs 表、导出 PNG、盈亏概览「多方总名义仓位」都读这一个函数，三处的数不可能各算各的。
 */
export function buildLegPositionShareInputs(
  legs: readonly TradeJournal[],
  recordMap: ReadonlyMap<string, TradeRecord>,
  corrections: LegExitPriceCorrections | undefined,
  evidence: LegFillEvidence,
): LegPositionShareInput[] {
  return legs.map(leg => {
    const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
    const entryPrice = resolveLegExecution(leg, record, corrections).entryPrice;
    // 名义为 0 或价格缺失时不猜，币量显示空。
    const coinQty = leg.pre_position_size != null && entryPrice != null && entryPrice > 0
      ? leg.pre_position_size / entryPrice
      : null;
    return {
      legId: leg.id,
      side: legPositionSideFromDirection(leg.direction),
      role: leg.leg_role,
      coinQty,
      notional: leg.pre_position_size ?? null,
      counted: legRowStatus(leg, record, evidence) !== 'pending',
    };
  });
}

export interface MainSideNotional {
  /** 战役主方向那一侧：主多是多单，主空是空单（缺方向时从主力腿回推，与「占比」列同一个判定）。 */
  side: LegPositionSide;
  /** 这一侧所有已成交腿的名义仓位合计（USDT）；一条都没有时为 null。 */
  total: number | null;
}

/**
 * 【用户要求】盈亏概览「多方总名义仓位」：战役主方向那一侧**所有**腿的名义仓位合计——主力、镜像、加仓（主多战役里就是全部多单），
 * 挂单中（还没成交）的腿不算。就是 Legs 表合计行「币量 / 仓位」格里这一侧那组的 Σ名义仓位（也是「多单占比」列的分母）。
 */
export function campaignMainSideNotional(
  campaignDirection: string | null | undefined,
  inputs: readonly LegPositionShareInput[],
): MainSideNotional {
  const side = resolveLegPositionShareSide(campaignDirection, inputs);
  return { side, total: computeLegPositionShares(inputs).bySide[side].totalNotional };
}
