/**
 * 「这条成交记录是一次强平」以及「这条腿的盈亏最低能到哪」——战役侧全部读这一处。
 *
 * 引擎的强平合约（lib/liquidationGuards、contexts/TradingContext）有两种，判据不同：
 *   · 逐仓：按破产价结算，整笔仓位的净盈亏恰为 −隔离保证金（不多也不少），
 *     记录带 liquidationSettlement: 'bankruptcy'；一个仓位由多笔成交并成时，
 *     buildCloseRecords 按各笔自己的开仓价把这 −保证金拆成几条记录，Σ 仍恰好是 −保证金。
 *   · 全仓：净盈亏 = 标记盈亏 − 平仓费 − 强平费，**没有保证金封顶**（拿整个钱包兜底），
 *     所以记录**不带**那个标记。
 * 老的强平记录（标记上线之前）两种都可能，只认得出 action / exit_method。
 *
 * 因此判「是不是强平」一律用 action === 'LIQUIDATION' 或 exit_method === 'liquidation'，
 * 不能用 liquidationSettlement——那是「有没有保证金封顶」的判据，不是「是不是强平」的判据。
 * 以前平仓价校正只挡了 'bankruptcy'，于是每一条全仓强平、每一条老的逐仓强平都会被 1 分钟 K 线
 * 重新定价：BTC 全仓多单实际亏 4253，页面按 K 线改成 −1653，这个数还会一路进合计、Δb、b、R、
 * 战役状态与自愈回写的 final_realized_pnl。
 */
import { getPositionNotionalUsd } from '@/lib/tradingSettlement';
import type { TradeRecord } from '@/types/trading';

type LiquidationFields = Pick<TradeRecord, 'action' | 'exit_method' | 'liquidationSettlement'>;

/** 这条记录是不是强平（含全仓强平与标记上线之前的老记录）。 */
export function isLiquidationRecord(record: LiquidationFields | null | undefined): boolean {
  if (!record) return false;
  return record.action === 'LIQUIDATION' || record.exit_method === 'liquidation';
}

/** 逐仓按破产价结算的强平：净盈亏恒为 −隔离保证金，与平仓价上的毛盈亏无关。 */
export function isBankruptcySettlement(record: LiquidationFields | null | undefined): boolean {
  return isLiquidationRecord(record) && record?.liquidationSettlement === 'bankruptcy';
}

/**
 * 这条记录的盈亏**最低能到哪**（USD，带符号；不封顶时返回 null）。
 *
 * 只有**逐仓破产价结算**才有封顶——交易所在破产价上把仓位收走，账户在这笔仓位上亏掉的
 * 恰好是隔离保证金，破产价之下的价格从来不属于它。封顶就取**这条记录自己结算掉的那笔钱**
 * （record.pnl，带符号）：
 *   · 单笔成交：它就是 −隔离保证金；
 *   · 多笔成交并成的仓位：buildCloseRecords 按各笔自己的开仓价拆账，各片之和恰好是 −保证金。
 *     所以逐片截断与「整仓截断」完全等价——各片的毛利都是价格的单调函数、拐点同在破产价上，
 *     破产价之下每一片都读回自己的结算值，相加正是整仓保证金。用「开仓名义 ÷ 开仓杠杆」
 *     逐片估保证金则会超报：主力 0.3@100,000 + 加仓 0.2@110,000 的整仓保证金是 2600，
 *     逐片估出来是 3740（最大回撤超报 43.8%）；持仓中途提过杠杆的仓位同样超报
 *     （record.leverage 按设计恒为开仓杠杆，提杠杆后隔离保证金已经变小）。
 *   · 加仓那一片在破产价上仍是正的（各笔开仓价不同时常有）：封顶也就是那个正数——
 *     它不是「这一片必须赚钱」，而是「整仓亏损封死在保证金上」的那一份拆账，各片相加才是读数。
 * record.pnl 不是有限数（老数据坏了）时退回「开仓名义 ÷ 开仓杠杆」估一个保证金，估不出就不封顶。
 *
 * **全仓强平不封顶**：全仓拿整个钱包兜底，被拖爆的那一刻这条腿甚至可能是盈利的
 * （主力 + 对冲体系里的常态），而它在更早的价位上确实可以亏得比最后结算的那一笔多——
 * 用 |record.pnl| 去封会把真实浮亏截掉（实测少算 2100：1.0000 × 20000 的多单先跌到 0.8000
 * 浮亏 4000，再在 1.1000 被别的标的拖爆、结算 +1900，最大回撤会读成 1900）。
 */
export function liquidationPnlFloorUsd(record: TradeRecord | null | undefined): number | null {
  if (!record || !isBankruptcySettlement(record)) return null;
  if (Number.isFinite(record.pnl)) return Number(record.pnl);
  const notional = getPositionNotionalUsd(record.symbol, record, record.entryPrice);
  const leverage = Number(record.leverage);
  const margin = Number.isFinite(notional) && notional > 0 && leverage > 0 ? notional / leverage : null;
  return margin != null && margin > 0 ? -margin : null;
}
