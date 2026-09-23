import { isLiquidationRecord } from '@/lib/liquidationRecord';
import type { CampaignEvent, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

/**
 * Legs 表（页面与导出 PNG）每条腿的状态：已平仓 / 爆仓 / 挂单中 / 进行中。两处共用这一条规则。
 *
 * - closed 是常态，不另外标；
 * - liquidated 即「爆仓」——这条腿是被交易所强制平掉的（记录的 action / exit_method 说了算）。
 *   它是已平仓的一种，照常计入占比与合计；只是仓位不是自己平的，这件事在 Legs 表上必须看得见
 *   （时间线与仓位面板早就有红色的「爆仓」标记，战役页此前一个字都没有）；
 * - pending 即「挂单中」——对冲 / 镜像腿**还没有成交**，不是仓位，
 *   「占比」列（按战役主方向取一侧）的分母与合计行的多、空两组 Σ 据此把它排除在外；
 * - open 即「进行中」——已成交、还没有平仓（主力、加仓、回场腿，以及已成交未平的对冲 / 镜像腿）。
 *
 * 【用户要求】「挂单中」按成交判定，不按「有没有平仓记录」判：系统只在平仓时写成交记录，
 * 已经成交、还拿着的对冲 / 镜像腿以前一律被标成挂单中，也不进占比——那是一笔真实的持仓。
 * 没有平仓记录的对冲 / 镜像腿按证据先后判（legFillEvidenceStatus）：
 *   ① 本地委托证明它从未成交（unfilledOrderIds：还挂着或撤了）→ 挂单中；
 *   ② 腿上存的就是某张反向委托的 id：已触发 → 进行中，仍挂着 / 已撤 → 挂单中；
 *   ③ 腿上没有任何 id：事件流里有它的触发事件 → 进行中，否则挂单中；
 *   ④ 有 id、又查不到它没成交的证据 → 进行中（与归类页「已成交 · 成交记录未载入」、权益路径同一口径）。
 *
 * 三种例外都不写成另一枚文字标签，而是画在角色标签上：挂单中是虚线空心的标签，进行中是标签里一枚实心小圆点，
 * 爆仓是标签里一枚红色的「爆仓」小字（悬停有说明，读屏也念得出来）。
 */
export type LegRowStatus = 'closed' | 'liquidated' | 'pending' | 'open';

/** 需要在角色标签上标出来的三种状态。 */
export type LegRowOpenStatus = Exclude<LegRowStatus, 'closed'>;

type StatusFields = Pick<TradeJournal, 'id' | 'leg_role' | 'trade_record_id' | 'post_simulated_close_time' | 'post_real_close_time' | 'post_outcome'>;

/**
 * 判「成交了没有」用到的凭据。页面与导出图传同一份：
 *   · unfilledOrderIds —— 本地委托快照证明从未成交的 id（getCampaignFullData）；换了浏览器时为空，不下结论；
 *   · orders —— 这场战役的**完整**反向委托列表（含盘面上隐藏的那几张，隐藏一条线不能改变状态）；
 *   · events —— 战役事件流（actual_evolution）。
 * 都不传时只剩 ③ / ④ 两条（有 id 就算成交）。
 */
export interface LegFillEvidence {
  unfilledOrderIds?: ReadonlySet<string> | null;
  orders?: readonly CampaignReverseHedgeOrder[] | null;
  events?: readonly CampaignEvent[] | null;
}

const FILLED_EVENT_TYPES = new Set<CampaignEvent['event_type']>(['hedge_triggered', 'mirror_tp_triggered']);

function isPendingOrderRole(role: TradeJournal['leg_role'] | null | undefined): boolean {
  return role === 'mirror_tp' || !!role?.startsWith('hedge_');
}

/** 没有平仓记录的对冲 / 镜像腿：成交了（进行中）还是没成交（挂单中）。规则见文件头。 */
function legFillEvidenceStatus(leg: StatusFields, evidence: LegFillEvidence | undefined): 'pending' | 'open' {
  const id = leg.trade_record_id;
  if (!id) {
    const triggered = (evidence?.events ?? []).some(event => event.journal_id === leg.id && FILLED_EVENT_TYPES.has(event.event_type));
    return triggered ? 'open' : 'pending';
  }
  if (evidence?.unfilledOrderIds?.has(id)) return 'pending';
  const order = (evidence?.orders ?? []).find(item => !item.foreignReplay && item.id === id);
  if (order) return order.status === 'triggered' ? 'open' : 'pending';
  return 'open';
}

export function legRowStatus(leg: StatusFields, record: TradeRecord | null, evidence?: LegFillEvidence): LegRowStatus {
  // 爆仓先判：它也是「有记录 = 已平仓」，但平仓的是交易所，不是这条腿的决策。
  if (isLiquidationRecord(record)) return 'liquidated';
  if (record) return 'closed';
  if (leg.post_simulated_close_time || leg.post_real_close_time || leg.post_outcome) return 'closed';
  if (isPendingOrderRole(leg.leg_role)) return legFillEvidenceStatus(leg, evidence);
  return 'open';
}

/** 读屏念出的状态名。 */
export const LEG_ROW_STATUS_LABELS: Record<LegRowOpenStatus, string> = { liquidated: '爆仓', pending: '挂单中', open: '进行中' };

/** 角色标签上的悬停说明。 */
export const LEG_ROW_STATUS_HINTS: Record<LegRowOpenStatus, string> = {
  liquidated: '爆仓：交易所强制平仓。逐仓按破产价结算——亏损恰为这笔仓位的保证金，与平仓价上的价差无关；全仓强平没有保证金封顶',
  pending: '挂单中：还没有成交（委托仍挂着、已撤单，或这条腿没有任何成交凭据），不计入多单 / 空单合计',
  open: '进行中：还没有平仓',
};

/** 来源为「由成交记录回填」的腿：不再单独挂「回填」标签，只在角色标签的悬停说明里交代。 */
export const LEG_RETROACTIVE_HINT = '历史回填：这条腿是事后按成交记录补建的';

/** 没有角色的腿：角色格里是一枚写着「—」的中性灰标签，悬停时说明它是什么。 */
export const LEG_UNCLASSIFIED_HINT = '没有角色：这条腿还没有归类';
