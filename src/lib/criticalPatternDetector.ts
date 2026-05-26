/**
 * 高频错误模式检测器：检测应该立即生成新规则的 pattern
 *
 * 触发条件：
 *  - frequency: 同一 pattern 30 天内 ≥3 次且平均亏损（防中频错误堆积）
 *  - catastrophic: 单笔实际亏损 ≥ 2 × 预设最大亏损（防尾部黑天鹅，1 次就触发）
 */
import { supabase } from '@/integrations/supabase/client';
import type { ErrorTagPattern, TradeJournal, JournalTagAssignment, TradingRule } from '@/types/journal';

export type CriticalTrigger = 'frequency' | 'catastrophic';

/** 实际亏损超过预设最大亏损多少倍即视为致命（突破自己定的止损）。 */
export const CATASTROPHIC_LOSS_R_MULTIPLE = 2;

export interface CriticalPatternInfo {
  trigger: CriticalTrigger;
  pattern: ErrorTagPattern | null;
  /** frequency: 30 天内出现次数；catastrophic: 1 */
  last_30d_count: number;
  /** frequency: 平均 P&L；catastrophic: 单笔 P&L */
  avg_pnl: number;
  /** catastrophic 触发时填入实际 / 预设亏损倍数（R 倍数的绝对值） */
  loss_r_multiple?: number;
  recent_journals: TradeJournal[];
}

export async function evaluateCriticalPatterns(
  userId: string,
): Promise<CriticalPatternInfo[]> {
  // Pull data in parallel
  const [pRes, aRes, jRes, rRes] = await Promise.all([
    supabase.from('error_tag_patterns' as never).select('*').eq('user_id', userId).eq('is_archived', false),
    supabase.from('journal_tag_assignments' as never).select('*').eq('user_id', userId),
    supabase.from('trade_journals' as never).select('*').eq('user_id', userId),
    supabase.from('trading_rules' as never).select('*').eq('user_id', userId),
  ]);
  const patterns = ((pRes.data ?? []) as unknown as ErrorTagPattern[]);
  const assignments = ((aRes.data ?? []) as unknown as JournalTagAssignment[]);
  const journals = ((jRes.data ?? []) as unknown as TradeJournal[]);
  const rules = ((rRes.data ?? []) as unknown as TradingRule[]);

  const now = Date.now();
  const since30 = now - 30 * 86400_000;
  const journalById = new Map(journals.map(j => [j.id, j]));

  // Group journals by pattern
  const patternToJournals = new Map<string, TradeJournal[]>();
  for (const a of assignments) {
    const j = journalById.get(a.journal_id);
    if (!j) continue;
    if (!patternToJournals.has(a.pattern_id)) patternToJournals.set(a.pattern_id, []);
    patternToJournals.get(a.pattern_id)!.push(j);
  }

  // Rules by pattern (active OR snoozed)
  const activeRulesByPattern = new Map<string, TradingRule>();
  const snoozedPatterns = new Set<string>();
  for (const r of rules) {
    if (r.source_pattern_id) {
      if (r.snooze_until && new Date(r.snooze_until).getTime() > now) {
        snoozedPatterns.add(r.source_pattern_id);
      }
      if (r.is_active && r.added_to_checklist) {
        activeRulesByPattern.set(r.source_pattern_id, r);
      }
    }
  }

  const result: CriticalPatternInfo[] = [];

  // ===== Trigger 1: frequency (legacy) =====
  for (const p of patterns) {
    if (snoozedPatterns.has(p.id)) continue;
    if (activeRulesByPattern.has(p.id)) continue;
    const js = (patternToJournals.get(p.id) ?? []).filter(
      j => new Date(j.pre_simulated_time).getTime() >= since30,
    );
    if (js.length < 3) continue;
    const pnls = js.map(j => j.post_realized_pnl ?? 0);
    const avg = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    if (avg >= 0) continue;
    const recent = [...js].sort(
      (a, b) => new Date(b.pre_simulated_time).getTime() - new Date(a.pre_simulated_time).getTime(),
    ).slice(0, 3);
    result.push({
      trigger: 'frequency',
      pattern: p,
      last_30d_count: js.length,
      avg_pnl: avg,
      recent_journals: recent,
    });
  }

  // ===== Trigger 2: catastrophic single event (fat-tail defense) =====
  // 任何一笔实际亏损 ≥ CATASTROPHIC_LOSS_R_MULTIPLE × 预设最大亏损，且当前没有针对它的活规则。
  // 这类事件 30 天 ≥3 次的阈值永远等不到——你已经爆仓了。
  const catastrophicSeenKey = new Set<string>(); // journalId 去重
  // Already-handled catastrophic journals: any journal that is the source for an active or snoozed rule.
  // We use post_reflection presence as a weak proxy for "user already wrote something" — but the real
  // gate is: has the user already created an active rule for any pattern attached to this journal?
  const journalToActivePattern = new Map<string, string>();
  for (const a of assignments) {
    if (activeRulesByPattern.has(a.pattern_id) || snoozedPatterns.has(a.pattern_id)) {
      journalToActivePattern.set(a.journal_id, a.pattern_id);
    }
  }

  for (const j of journals) {
    if (catastrophicSeenKey.has(j.id)) continue;
    if (journalToActivePattern.has(j.id)) continue; // already has rule
    if (!j.post_reviewed_at) continue; // wait for user to review first
    const pnl = j.post_realized_pnl;
    const maxLoss = j.pre_max_loss_usdt;
    if (pnl == null || maxLoss == null || maxLoss <= 0) continue;
    if (pnl >= 0) continue;
    const absR = Math.abs(pnl) / maxLoss;
    if (absR < CATASTROPHIC_LOSS_R_MULTIPLE) continue;
    if (new Date(j.pre_simulated_time).getTime() < since30) continue;
    catastrophicSeenKey.add(j.id);
    result.push({
      trigger: 'catastrophic',
      pattern: null,
      last_30d_count: 1,
      avg_pnl: pnl,
      loss_r_multiple: absR,
      recent_journals: [j],
    });
  }

  return result;
}
