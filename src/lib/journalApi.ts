/**
 * 错题集数据访问层
 * 所有读写均通过 Supabase JS client，错误以中文 Error 抛出。
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  ErrorTagCategory,
  ErrorTagPattern,
  JournalTagAssignment,
  TaggedPhase,
  TradeJournal,
  TradeOutcome,
  TradingRule,
} from "@/types/journal";

function wrap<T>(label: string, error: { message: string } | null, data: T | null): T {
  if (error) {
    console.error(`[journalApi] ${label} 失败:`, error);
    throw new Error(`${label}失败：${error.message}`);
  }
  if (data === null || data === undefined) {
    throw new Error(`${label}失败：返回数据为空`);
  }
  return data;
}

// ============ Categories ============

export async function listCategories(): Promise<ErrorTagCategory[]> {
  const { data, error } = await supabase
    .from("error_tag_categories" as never)
    .select("*")
    .order("sort_order", { ascending: true });
  return wrap("加载错题分类", error, data as unknown as ErrorTagCategory[]);
}

// ============ Patterns ============

export async function listPatterns(
  userId: string,
  opts?: { includeArchived?: boolean },
): Promise<ErrorTagPattern[]> {
  let q = supabase
    .from("error_tag_patterns" as never)
    .select("*")
    .eq("user_id", userId);
  if (!opts?.includeArchived) q = q.eq("is_archived", false);
  const { data, error } = await q.order("occurrence_count", { ascending: false });
  return wrap("加载错误模式列表", error, data as unknown as ErrorTagPattern[]);
}

export interface CreatePatternInput {
  user_id: string;
  category_id: string;
  pattern_name: string;
  operational_definition: string;
  parent_id?: string | null;
}

export async function createPattern(input: CreatePatternInput): Promise<ErrorTagPattern> {
  if (input.operational_definition.trim().length < 10) {
    throw new Error("可操作定义至少需要 10 个字符");
  }
  const { data, error } = await supabase
    .from("error_tag_patterns" as never)
    .insert(input as never)
    .select()
    .single();
  return wrap("创建错误模式", error, data as unknown as ErrorTagPattern);
}

export async function updatePattern(
  id: string,
  patch: Partial<Pick<ErrorTagPattern, "pattern_name" | "operational_definition" | "parent_id" | "is_archived">>,
): Promise<ErrorTagPattern> {
  if (patch.operational_definition !== undefined && patch.operational_definition.trim().length < 10) {
    throw new Error("可操作定义至少需要 10 个字符");
  }
  const { data, error } = await supabase
    .from("error_tag_patterns" as never)
    .update(patch as never)
    .eq("id", id)
    .select()
    .single();
  return wrap("更新错误模式", error, data as unknown as ErrorTagPattern);
}

export async function archivePattern(id: string): Promise<void> {
  const { error } = await supabase
    .from("error_tag_patterns" as never)
    .update({ is_archived: true } as never)
    .eq("id", id);
  if (error) {
    console.error("[journalApi] 归档错误模式失败:", error);
    throw new Error(`归档错误模式失败：${error.message}`);
  }
}

// ============ Journals ============

export type CreateJournalPreInput = Omit<
  TradeJournal,
  | "id"
  | "pre_real_time"
  | "post_outcome"
  | "post_realized_pnl"
  | "post_r_multiple"
  | "post_reflection"
  | "post_correct_action"
  | "post_reviewed_at"
  | "reason_was_rewritten"
  | "created_at"
  | "updated_at"
>;

export async function createJournalPreSnapshot(input: CreateJournalPreInput): Promise<TradeJournal> {
  const payload = { ...input, pre_real_time: new Date().toISOString() };
  const { data, error } = await supabase
    .from("trade_journals" as never)
    .insert(payload as never)
    .select()
    .single();
  return wrap("创建交易日记事前快照", error, data as unknown as TradeJournal);
}

export interface UpdateJournalPostInput {
  post_outcome: TradeOutcome;
  post_realized_pnl?: number | null;
  post_r_multiple?: number | null;
  post_reflection?: string | null;
  post_correct_action?: string | null;
}

export async function updateJournalPostReview(
  id: string,
  input: UpdateJournalPostInput,
): Promise<TradeJournal> {
  const payload = { ...input, post_reviewed_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("trade_journals" as never)
    .update(payload as never)
    .eq("id", id)
    .select()
    .single();
  return wrap("提交交易复盘", error, data as unknown as TradeJournal);
}

export interface ListJournalFilters {
  symbol?: string;
  outcome?: TradeOutcome;
  patternId?: string;
  dateRange?: { from: string; to: string };
}

export async function listJournals(
  userId: string,
  filters?: ListJournalFilters,
): Promise<TradeJournal[]> {
  try {
    if (filters?.patternId) {
      // 通过多对多表反查
      const { data: assigns, error: aErr } = await supabase
        .from("journal_tag_assignments" as never)
        .select("journal_id")
        .eq("user_id", userId)
        .eq("pattern_id", filters.patternId);
      if (aErr) throw aErr;
      const ids = ((assigns ?? []) as unknown as { journal_id: string }[]).map(r => r.journal_id);
      if (ids.length === 0) return [];
      let q = supabase
        .from("trade_journals" as never)
        .select("*")
        .eq("user_id", userId)
        .in("id", ids);
      if (filters.symbol) q = q.eq("symbol", filters.symbol);
      if (filters.outcome) q = q.eq("post_outcome", filters.outcome);
      if (filters.dateRange) {
        q = q.gte("pre_simulated_time", filters.dateRange.from).lte("pre_simulated_time", filters.dateRange.to);
      }
      const { data, error } = await q.order("pre_simulated_time", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TradeJournal[];
    }

    let q = supabase.from("trade_journals" as never).select("*").eq("user_id", userId);
    if (filters?.symbol) q = q.eq("symbol", filters.symbol);
    if (filters?.outcome) q = q.eq("post_outcome", filters.outcome);
    if (filters?.dateRange) {
      q = q.gte("pre_simulated_time", filters.dateRange.from).lte("pre_simulated_time", filters.dateRange.to);
    }
    const { data, error } = await q.order("pre_simulated_time", { ascending: false });
    if (error) throw error;
    return (data ?? []) as unknown as TradeJournal[];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[journalApi] 加载交易日记失败:", e);
    throw new Error(`加载交易日记失败：${msg}`);
  }
}

export async function getJournalById(id: string): Promise<TradeJournal | null> {
  const { data, error } = await supabase
    .from("trade_journals" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[journalApi] 获取交易日记失败:", error);
    throw new Error(`获取交易日记失败：${error.message}`);
  }
  return (data as unknown as TradeJournal) ?? null;
}

// ============ Tag Assignments ============

export async function assignTag(
  journalId: string,
  patternId: string,
  phase: TaggedPhase,
  note?: string,
): Promise<void> {
  // 取用户 id
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("打标签失败：用户未登录");

  const { error } = await supabase
    .from("journal_tag_assignments" as never)
    .upsert(
      {
        user_id: userId,
        journal_id: journalId,
        pattern_id: patternId,
        tagged_phase: phase,
        note: note ?? null,
      } as never,
      { onConflict: "journal_id,pattern_id,tagged_phase" },
    );
  if (error) {
    console.error("[journalApi] 打标签失败:", error);
    throw new Error(`打标签失败：${error.message}`);
  }
}

export async function removeTag(assignmentId: string): Promise<void> {
  const { error } = await supabase
    .from("journal_tag_assignments" as never)
    .delete()
    .eq("id", assignmentId);
  if (error) {
    console.error("[journalApi] 移除标签失败:", error);
    throw new Error(`移除标签失败：${error.message}`);
  }
}

export async function listAssignmentsForJournal(journalId: string): Promise<JournalTagAssignment[]> {
  const { data, error } = await supabase
    .from("journal_tag_assignments" as never)
    .select("*")
    .eq("journal_id", journalId)
    .order("created_at", { ascending: true });
  return wrap("加载标签列表", error, data as unknown as JournalTagAssignment[]);
}

// ============ Rules ============

export async function listRules(userId: string): Promise<TradingRule[]> {
  const { data, error } = await supabase
    .from("trading_rules" as never)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return wrap("加载交易规则", error, data as unknown as TradingRule[]);
}

export interface CreateRuleInput {
  user_id: string;
  source_pattern_id?: string | null;
  rule_text: string;
  is_active?: boolean;
  trigger_threshold?: number;
}

export async function createRule(input: CreateRuleInput): Promise<TradingRule> {
  const { data, error } = await supabase
    .from("trading_rules" as never)
    .insert(input as never)
    .select()
    .single();
  return wrap("创建交易规则", error, data as unknown as TradingRule);
}

export async function markRuleAddedToChecklist(ruleId: string): Promise<void> {
  const { error } = await supabase
    .from("trading_rules" as never)
    .update({ added_to_checklist: true } as never)
    .eq("id", ruleId);
  if (error) {
    console.error("[journalApi] 标记规则已加入 checklist 失败:", error);
    throw new Error(`标记规则失败：${error.message}`);
  }
}
