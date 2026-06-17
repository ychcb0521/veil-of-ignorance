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
        suggestedRole = MAIN_ADD_ROLES[Math.min(mainAddCount, MAIN_ADD_ROLES.length - 1)] ?? 'reentry_main';
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
