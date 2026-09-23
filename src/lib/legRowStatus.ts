import { isLiquidationRecord } from '@/lib/liquidationRecord';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/**
 * Legs 表（页面与导出 PNG）每条腿的状态：已平仓 / 爆仓 / 挂单中 / 进行中。两处共用这一条规则。
 *
 * - closed 是常态，不另外标；
 * - liquidated 即「爆仓」——这条腿是被交易所强制平掉的（记录的 action / exit_method 说了算）。
 *   它是已平仓的一种，照常计入占比与合计；只是仓位不是自己平的，这件事在 Legs 表上必须看得见
 *   （时间线与仓位面板早就有红色的「爆仓」标记，战役页此前一个字都没有）；
 * - pending 即「挂单中」——对冲 / 镜像腿还没有成交或平仓记录，不是仓位，
 *   「占比」列（按战役主方向取一侧）的分母与合计行的多、空两组 Σ 据此把它排除在外；
 * - open 即「进行中」——主力、加仓、回场腿等还没有平仓。
 *
 * 三种例外都不写成另一枚文字标签，而是画在角色标签上：挂单中是虚线空心的标签，进行中是标签里一枚实心小圆点，
 * 爆仓是标签里一枚红色的「爆仓」小字（悬停有说明，读屏也念得出来）。
 */
export type LegRowStatus = 'closed' | 'liquidated' | 'pending' | 'open';

/** 需要在角色标签上标出来的三种状态。 */
export type LegRowOpenStatus = Exclude<LegRowStatus, 'closed'>;

type StatusFields = Pick<TradeJournal, 'leg_role' | 'post_simulated_close_time' | 'post_real_close_time' | 'post_outcome'>;

export function legRowStatus(leg: StatusFields, record: TradeRecord | null): LegRowStatus {
  // 爆仓先判：它也是「有记录 = 已平仓」，但平仓的是交易所，不是这条腿的决策。
  if (isLiquidationRecord(record)) return 'liquidated';
  if (record) return 'closed';
  if (leg.post_simulated_close_time || leg.post_real_close_time || leg.post_outcome) return 'closed';
  if (leg.leg_role === 'mirror_tp' || leg.leg_role?.startsWith('hedge_')) return 'pending';
  return 'open';
}

/** 读屏念出的状态名。 */
export const LEG_ROW_STATUS_LABELS: Record<LegRowOpenStatus, string> = { liquidated: '爆仓', pending: '挂单中', open: '进行中' };

/** 角色标签上的悬停说明。 */
export const LEG_ROW_STATUS_HINTS: Record<LegRowOpenStatus, string> = {
  liquidated: '爆仓：交易所强制平仓。逐仓按破产价结算——亏损恰为这笔仓位的保证金，与平仓价上的价差无关；全仓强平没有保证金封顶',
  pending: '挂单中：还没有成交或平仓记录，不计入多单 / 空单合计',
  open: '进行中：还没有平仓',
};

/** 来源为「由成交记录回填」的腿：不再单独挂「回填」标签，只在角色标签的悬停说明里交代。 */
export const LEG_RETROACTIVE_HINT = '历史回填：这条腿是事后按成交记录补建的';

/** 没有角色的腿：角色格里是一枚写着「—」的中性灰标签，悬停时说明它是什么。 */
export const LEG_UNCLASSIFIED_HINT = '没有角色：这条腿还没有归类';
