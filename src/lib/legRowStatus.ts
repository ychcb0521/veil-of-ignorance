import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

/**
 * Legs 表（页面与导出 PNG）每条腿的状态：已平仓 / 挂单中 / 进行中。两处共用这一条规则。
 *
 * - closed 是常态，不另外标；
 * - pending 即「挂单中」——对冲 / 镜像腿还没有成交或平仓记录，不是仓位，
 *   「多单占比」「空单占比」两列据此把它排除在分母之外；
 * - open 即「进行中」——主力、加仓、回场腿等还没有平仓。
 *
 * 两种例外不再写成文字标签，而是画在角色标签上：挂单中是虚线空心的标签，进行中是标签里一枚实心小圆点
 * （悬停有说明，读屏仍会念出「挂单中 / 进行中」）。
 */
export type LegRowStatus = 'closed' | 'pending' | 'open';

/** 需要在角色标签上标出来的两种状态。 */
export type LegRowOpenStatus = Exclude<LegRowStatus, 'closed'>;

type StatusFields = Pick<TradeJournal, 'leg_role' | 'post_simulated_close_time' | 'post_real_close_time' | 'post_outcome'>;

export function legRowStatus(leg: StatusFields, record: TradeRecord | null): LegRowStatus {
  if (record) return 'closed';
  if (leg.post_simulated_close_time || leg.post_real_close_time || leg.post_outcome) return 'closed';
  if (leg.leg_role === 'mirror_tp' || leg.leg_role?.startsWith('hedge_')) return 'pending';
  return 'open';
}

/** 读屏念出的状态名。 */
export const LEG_ROW_STATUS_LABELS: Record<LegRowOpenStatus, string> = { pending: '挂单中', open: '进行中' };

/** 角色标签上的悬停说明。 */
export const LEG_ROW_STATUS_HINTS: Record<LegRowOpenStatus, string> = {
  pending: '挂单中：还没有成交或平仓记录，不计入占比合计',
  open: '进行中：还没有平仓',
};

/** 来源为「由成交记录回填」的腿：不再单独挂「回填」标签，只在角色标签的悬停说明里交代。 */
export const LEG_RETROACTIVE_HINT = '历史回填：这条腿是事后按成交记录补建的';

/** 没有角色的腿：角色格里是一枚写着「—」的中性灰标签，悬停时说明它是什么。 */
export const LEG_UNCLASSIFIED_HINT = '没有角色：这条腿还没有归类';
