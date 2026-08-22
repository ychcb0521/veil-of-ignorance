import { MAIN_ADD_ROLES } from '@/lib/strategyTemplates';
import type { LegRole, SuggestedLegRole, TradeJournal } from '@/types/journal';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

function timeMs(journal: TradeJournal): number {
  return new Date(journal.pre_simulated_time).getTime();
}

function isTriggeredHedge(journal: TradeJournal): boolean {
  return journal.order_kind === 'hedge' && journal.trade_record_id != null;
}

export function suggestLegRoles(journals: TradeJournal[]): SuggestedLegRole[] {
  const sorted = [...journals].sort((a, b) => timeMs(a) - timeMs(b));
  const suggestions: SuggestedLegRole[] = [];

  const firstMain = sorted.find(journal => journal.order_kind === 'main') ?? null;
  const firstMainTime = firstMain ? timeMs(firstMain) : null;
  const firstMirrorTpTime = sorted.find(journal => journal.leg_role === 'mirror_tp') ? timeMs(sorted.find(journal => journal.leg_role === 'mirror_tp') as TradeJournal) : null;

  let initialHedgeCount = 0;
  let mainAssigned = false;
  let mainAddCount = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const journal = sorted[index];
    const previous = sorted[index - 1] ?? null;

    let suggestedRole: LegRole = 'standalone';
    let confidence: SuggestedLegRole['confidence'] = 'low';
    let reason = '无法自动推断，请手动选择';

    if (journal.order_kind === 'main') {
      if (!mainAssigned) {
        suggestedRole = 'main_open';
        confidence = 'high';
        reason = '时间最早的主力订单';
        mainAssigned = true;
      } else {
        // 不夹逼索引：越过最后一个加仓槽时让下标越界，?? 的溢出兜底才有机会触发。
        // 夹逼会把第 7、8、9…笔全部标成同一个「加仓6」——一个对八行都相同的「建议」
        // 不含任何信息，还把「我不知道」伪装成了一个具体且笃定的答案。
        suggestedRole = MAIN_ADD_ROLES[mainAddCount] ?? 'reentry_main';
        mainAddCount += 1;
        if (previous && isTriggeredHedge(previous)) {
          confidence = 'medium';
          reason = '前一笔为已触发的对冲订单，推测为对冲后重入主仓';
        } else {
          confidence = 'medium';
          reason = `main_open 之后出现的同向主力订单，建议作为 ${suggestedRole}`;
        }
      }
    } else if (journal.order_kind === 'hedge') {
      const currentTime = timeMs(journal);
      const inInitialWindow = firstMainTime != null && currentTime - firstMainTime >= 0 && currentTime - firstMainTime <= THIRTY_MINUTES_MS;

      if (inInitialWindow && initialHedgeCount < 2) {
        suggestedRole = initialHedgeCount === 0 ? 'hedge_initial_a' : 'hedge_initial_b';
        confidence = 'medium';
        reason = '主仓开仓后 30 分钟内的对冲挂单';
        initialHedgeCount += 1;
      } else {
        suggestedRole = 'hedge_rolling';
        if (firstMirrorTpTime != null && currentTime >= firstMirrorTpTime) {
          confidence = 'medium';
          reason = '镜像止盈之后出现的新对冲订单';
        } else if (firstMainTime != null && currentTime - firstMainTime > THIRTY_MINUTES_MS) {
          confidence = 'low';
          reason = '主仓开仓 30 分钟之后的对冲订单';
        } else {
          confidence = 'low';
          reason = '无法区分是滚动对冲还是独立对冲，请手动确认';
        }
      }
    }

    suggestions.push({
      journalId: journal.id,
      suggestedRole,
      confidence,
      reason,
    });
  }

  return suggestions;
}

// ===== 裸仓位历史记录的角色建议（归类历史交易用） =====

export interface OrphanRecordRoleInput {
  id: string;
  direction: 'long' | 'short';
  openTimeMs: number;
  /** 平仓时间（毫秒）；0 / null 视为仍持有。 */
  closeTimeMs: number | null;
  exitMethod?: string | null;
}

export interface OrphanRecordRoleSuggestion {
  id: string;
  suggestedRole: LegRole;
  confidence: SuggestedLegRole['confidence'];
  reason: string;
}

/**
 * 裸 record 归类的角色语义（与实盘策略对齐）：
 *   ① 交易记录里「止盈1」平仓的那笔就是镜像止盈——镜像多单挂止盈先落袋；
 *   ② 同向仓位里【留到最后平掉】的那笔才是主力 main_open——主力按定义
 *      比镜像活得久，仍持有的记录视为最晚平掉；
 *   ③ 其余同向记录按开仓先后排为主力加仓；反向记录仍建议滚动对冲。
 * 若最后平掉的那笔恰好也是止盈1（例如全部记录都走了止盈1），主力判定优先——
 * 战役必须有 main_open，镜像身份让位。
 */
export function suggestOrphanRecordRoles(
  records: OrphanRecordRoleInput[],
  mainDirection: 'long' | 'short',
): OrphanRecordRoleSuggestion[] {
  const effectiveClose = (record: OrphanRecordRoleInput): number =>
    record.closeTimeMs != null && record.closeTimeMs > 0 ? record.closeTimeMs : Number.POSITIVE_INFINITY;

  const sameDirection = records.filter(record => record.direction === mainDirection);
  let mainId: string | null = null;
  for (const record of sameDirection) {
    if (mainId == null) {
      mainId = record.id;
      continue;
    }
    const current = sameDirection.find(candidate => candidate.id === mainId)!;
    if (
      effectiveClose(record) > effectiveClose(current)
      || (effectiveClose(record) === effectiveClose(current) && record.openTimeMs < current.openTimeMs)
    ) {
      mainId = record.id;
    }
  }

  const byOpenTime = [...records].sort((a, b) => a.openTimeMs - b.openTimeMs);
  let addCount = 0;
  const out: OrphanRecordRoleSuggestion[] = [];
  for (const record of byOpenTime) {
    if (record.direction !== mainDirection) {
      out.push({
        id: record.id,
        suggestedRole: 'hedge_rolling',
        confidence: 'low',
        reason: '反向历史成交更像滚动对冲或独立单，请按实际意图确认',
      });
      continue;
    }
    if (record.id === mainId) {
      out.push({
        id: record.id,
        suggestedRole: 'main_open',
        confidence: 'high',
        reason: '同向仓位中留到最后平掉的一笔，即主力',
      });
      continue;
    }
    if (record.exitMethod === 'tp1') {
      out.push({
        id: record.id,
        suggestedRole: 'mirror_tp',
        confidence: 'high',
        reason: '以「止盈1」平仓 = 镜像止盈落袋',
      });
      continue;
    }
    // 同上：加仓槽用尽后退到 reentry_main，而不是把所有溢出的都叫「加仓6」。
    const addRole = MAIN_ADD_ROLES[addCount] ?? 'reentry_main';
    addCount += 1;
    out.push({
      id: record.id,
      suggestedRole: addRole,
      confidence: 'medium',
      reason: '同向后续仓位，建议作为主力加仓 leg',
    });
  }
  return out;
}
