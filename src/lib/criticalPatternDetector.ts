/**
 * 高频错误模式检测器：检测应该立即生成新规则的 pattern
 */
import { supabase } from '@/integrations/supabase/client';
import type { ErrorTagPattern, TradeJournal, JournalTagAssignment, TradingRule } from '@/types/journal';

export interface CriticalPatternInfo {
  pattern: ErrorTagPattern;
  last_30d_count: number;
  avg_pnl: number;
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
      pattern: p,
      last_30d_count: js.length,
      avg_pnl: avg,
      recent_journals: recent,
    });
  }
  return result;
}
