import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { pickPrimaryMainLeg } from '@/lib/campaignPrimaryMainLeg';
import { computeLegPriceChangePct } from '@/lib/legPriceChange';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/**
 * 战役列表「涨幅」排序与卡片读数：**主力那条腿**在 Legs 表「涨跌幅」列里的那个数。
 *
 * 与 Legs 表逐字同源：主力按 pickPrimaryMainLeg 选（名义最大的 main_open，没有才退到 reentry_main），
 * 成交记录按 buildTradeRecordLookup 查，开平价取 resolveLegExecution（含 1 分钟 K 线平仓价校正、爆仓不改价），
 * 再按主力的方向算——空单价格跌了是正数。主力还没平仓（没有平仓价）时返回 null，与 Legs 表的「—」一致。
 */
export function campaignMainLegPriceChangePct(
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  corrections: LegExitPriceCorrections = {},
): number | null {
  const main = pickPrimaryMainLeg(legs);
  if (!main) return null;
  const record = main.trade_record_id ? buildTradeRecordLookup(tradeRecords).get(main.trade_record_id) ?? null : null;
  const execution = resolveLegExecution(main, record, corrections);
  return computeLegPriceChangePct(execution.entryPrice, execution.exitPrice, main.direction === 'short' ? 'short' : 'long');
}
