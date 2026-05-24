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
  TradeDirection,
  TradeJournal,
  TradeOutcome,
  TradingRule,
  CounterfactualBranch,
  CounterfactualBranchParams,
  CounterfactualBranchResult,
} from "@/types/journal";

const DEV_AUTH_SESSION_KEY = "veil_dev_auth_session_v1";
const DEV_JOURNAL_STORE_KEY = "veil_dev_journal_store_v1";

interface DevJournalStore {
  journals: TradeJournal[];
  assignments: JournalTagAssignment[];
  patterns: ErrorTagPattern[];
  rules: TradingRule[];
}

const DEV_CATEGORIES: ErrorTagCategory[] = [
  {
    id: "dev-cat-entry_reason",
    code: "entry_reason",
    name_zh: "入场理由",
    description: "入场逻辑、假设、触发条件相关问题",
    color: "#F0B90B",
    sort_order: 1,
    is_special: false,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "dev-cat-hedge_stop",
    code: "hedge_stop",
    name_zh: "对冲/止损",
    description: "对冲、止损、风控执行相关问题",
    color: "#F6465D",
    sort_order: 2,
    is_special: false,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "dev-cat-exit_reason",
    code: "exit_reason",
    name_zh: "出场理由",
    description: "止盈、平仓、提前离场相关问题",
    color: "#0ECB81",
    sort_order: 3,
    is_special: false,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "dev-cat-mental_state",
    code: "mental_state",
    name_zh: "心态状态",
    description: "情绪、冲动、犹豫、疲劳相关问题",
    color: "#8B5CF6",
    sort_order: 4,
    is_special: false,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "dev-cat-no_entry_missed",
    code: "no_entry_missed",
    name_zh: "该开没开",
    description: "机会识别后未执行的复盘",
    color: "#38BDF8",
    sort_order: 5,
    is_special: true,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "dev-cat-checklist_violation",
    code: "checklist_violation",
    name_zh: "清单违背",
    description: "交易前检查清单未满足或未执行",
    color: "#FB923C",
    sort_order: 6,
    is_special: true,
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

function isDevJournalMode() {
  return import.meta.env.DEV && typeof window !== "undefined" && !!localStorage.getItem(DEV_AUTH_SESSION_KEY);
}

function getDevUserId() {
  return typeof window === "undefined" ? null : localStorage.getItem(DEV_AUTH_SESSION_KEY);
}

function readDevStore(): DevJournalStore {
  try {
    const raw = localStorage.getItem(DEV_JOURNAL_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DevJournalStore>;
      return {
        journals: parsed.journals ?? [],
        assignments: parsed.assignments ?? [],
        patterns: parsed.patterns ?? [],
        rules: parsed.rules ?? [],
      };
    }
  } catch {}
  return { journals: [], assignments: [], patterns: [], rules: [] };
}

function writeDevStore(store: DevJournalStore) {
  localStorage.setItem(DEV_JOURNAL_STORE_KEY, JSON.stringify(store));
}

function touchJournal(journal: TradeJournal, patch: Partial<TradeJournal>): TradeJournal {
  return { ...journal, ...patch, updated_at: new Date().toISOString() };
}

function filterDevJournals(
  journals: TradeJournal[],
  userId: string,
  filters?: ListJournalFilters | BulkJournalFilters,
) {
  return journals.filter((journal) => {
    if (journal.user_id !== userId) return false;
    if (filters?.symbol && journal.symbol !== filters.symbol) return false;
    if ("outcome" in (filters ?? {}) && filters?.outcome && journal.post_outcome !== filters.outcome) return false;
    if ("dateRange" in (filters ?? {}) && filters?.dateRange) {
      if (journal.pre_simulated_time < filters.dateRange.from || journal.pre_simulated_time > filters.dateRange.to) {
        return false;
      }
    }
    if ("dateFrom" in (filters ?? {}) && filters?.dateFrom && journal.pre_simulated_time < filters.dateFrom) return false;
    if ("dateTo" in (filters ?? {}) && filters?.dateTo && journal.pre_simulated_time > filters.dateTo) return false;
    return true;
  });
}

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
  if (isDevJournalMode()) return DEV_CATEGORIES;

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
  if (isDevJournalMode()) {
    return readDevStore().patterns
      .filter((pattern) => pattern.user_id === userId && (opts?.includeArchived || !pattern.is_archived))
      .sort((a, b) => b.occurrence_count - a.occurrence_count);
  }

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
  if (isDevJournalMode()) {
    const now = new Date().toISOString();
    const pattern: ErrorTagPattern = {
      id: crypto.randomUUID(),
      parent_id: null,
      occurrence_count: 0,
      last_seen_at: null,
      is_archived: false,
      created_at: now,
      updated_at: now,
      ...input,
    };
    const store = readDevStore();
    writeDevStore({ ...store, patterns: [pattern, ...store.patterns] });
    return pattern;
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
  if (isDevJournalMode()) {
    const store = readDevStore();
    const index = store.patterns.findIndex((pattern) => pattern.id === id);
    if (index < 0) throw new Error("更新错误模式失败：记录不存在");
    const updated = { ...store.patterns[index], ...patch, updated_at: new Date().toISOString() };
    store.patterns[index] = updated;
    writeDevStore(store);
    return updated;
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
  if (isDevJournalMode()) {
    const store = readDevStore();
    const index = store.patterns.findIndex((pattern) => pattern.id === id);
    if (index >= 0) {
      store.patterns[index] = { ...store.patterns[index], is_archived: true, updated_at: new Date().toISOString() };
      writeDevStore(store);
    }
    return;
  }

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

export async function updateJournalTradeRef(journalId: string, tradeRecordId: string): Promise<void> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    const index = store.journals.findIndex((journal) => journal.id === journalId);
    if (index >= 0) {
      store.journals[index] = touchJournal(store.journals[index], { trade_record_id: tradeRecordId });
      writeDevStore(store);
    }
    return;
  }

  const { error } = await supabase
    .from("trade_journals" as never)
    .update({ trade_record_id: tradeRecordId } as never)
    .eq("id", journalId);
  if (error) {
    console.error("[journalApi] 回填 trade_record_id 失败:", error);
    throw new Error(`回填交易记录ID失败：${error.message}`);
  }
}

export async function createJournalPreSnapshot(input: CreateJournalPreInput): Promise<TradeJournal> {
  if (isDevJournalMode()) {
    const now = new Date().toISOString();
    const journal: TradeJournal = {
      ...input,
      id: crypto.randomUUID(),
      pre_real_time: now,
      post_outcome: null,
      post_realized_pnl: null,
      post_r_multiple: null,
      post_reflection: null,
      post_correct_action: null,
      post_reviewed_at: null,
      reason_was_rewritten: false,
      counterfactual_branches: [],
      created_at: now,
      updated_at: now,
    };
    const store = readDevStore();
    writeDevStore({ ...store, journals: [journal, ...store.journals] });
    return journal;
  }

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
  if (isDevJournalMode()) {
    const store = readDevStore();
    const index = store.journals.findIndex((journal) => journal.id === id);
    if (index < 0) throw new Error("提交交易复盘失败：记录不存在");
    const updated = touchJournal(store.journals[index], { ...input, post_reviewed_at: new Date().toISOString() });
    store.journals[index] = updated;
    writeDevStore(store);
    return updated;
  }

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
  if (isDevJournalMode()) {
    const store = readDevStore();
    let rows = filterDevJournals(store.journals, userId, filters);
    if (filters?.patternId) {
      const journalIds = new Set(
        store.assignments
          .filter((assignment) => assignment.user_id === userId && assignment.pattern_id === filters.patternId)
          .map((assignment) => assignment.journal_id),
      );
      rows = rows.filter((journal) => journalIds.has(journal.id));
    }
    return rows.sort((a, b) => b.pre_simulated_time.localeCompare(a.pre_simulated_time));
  }

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
  if (isDevJournalMode()) {
    return readDevStore().journals.find((journal) => journal.id === id) ?? null;
  }

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
  if (isDevJournalMode()) {
    const userId = getDevUserId();
    if (!userId) throw new Error("打标签失败：用户未登录");
    const store = readDevStore();
    const existing = store.assignments.find(
      (assignment) =>
        assignment.journal_id === journalId &&
        assignment.pattern_id === patternId &&
        assignment.tagged_phase === phase,
    );
    if (existing) {
      existing.note = note ?? null;
    } else {
      store.assignments.push({
        id: crypto.randomUUID(),
        user_id: userId,
        journal_id: journalId,
        pattern_id: patternId,
        tagged_phase: phase,
        note: note ?? null,
        created_at: new Date().toISOString(),
      });
    }
    writeDevStore(store);
    return;
  }

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
  if (isDevJournalMode()) {
    const store = readDevStore();
    writeDevStore({ ...store, assignments: store.assignments.filter((assignment) => assignment.id !== assignmentId) });
    return;
  }

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
  if (isDevJournalMode()) {
    return readDevStore().assignments
      .filter((assignment) => assignment.journal_id === journalId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  const { data, error } = await supabase
    .from("journal_tag_assignments" as never)
    .select("*")
    .eq("journal_id", journalId)
    .order("created_at", { ascending: true });
  return wrap("加载标签列表", error, data as unknown as JournalTagAssignment[]);
}

// ============ Rules ============

export async function listRules(userId: string): Promise<TradingRule[]> {
  if (isDevJournalMode()) {
    return readDevStore().rules
      .filter((rule) => rule.user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

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

// ============ Batch 3 additions ============

export interface FinalizeJournalInput {
  post_outcome: TradeOutcome;
  post_realized_pnl: number | null;
  post_r_multiple: number | null;
  post_reflection: string;
  post_correct_action: string;
}

export async function finalizeJournalReview(
  journalId: string,
  input: FinalizeJournalInput,
): Promise<TradeJournal> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    const index = store.journals.findIndex((journal) => journal.id === journalId);
    if (index < 0) throw new Error("提交平仓评价失败：记录不存在");
    const updated = touchJournal(store.journals[index], { ...input, post_reviewed_at: new Date().toISOString() });
    store.journals[index] = updated;
    writeDevStore(store);
    return updated;
  }

  const payload = { ...input, post_reviewed_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("trade_journals" as never)
    .update(payload as never)
    .eq("id", journalId)
    .select()
    .single();
  return wrap("提交平仓评价", error, data as unknown as TradeJournal);
}

export async function listJournalsByTradeRecordId(
  userId: string,
  tradeRecordId: string,
): Promise<TradeJournal[]> {
  if (isDevJournalMode()) {
    return readDevStore().journals.filter(
      (journal) => journal.user_id === userId && journal.trade_record_id === tradeRecordId,
    );
  }

  const { data, error } = await supabase
    .from("trade_journals" as never)
    .select("*")
    .eq("user_id", userId)
    .eq("trade_record_id", tradeRecordId);
  return wrap("按交易记录查询日记", error, data as unknown as TradeJournal[]);
}

export async function findUnreviewedJournals(userId: string): Promise<TradeJournal[]> {
  if (isDevJournalMode()) {
    return readDevStore().journals
      .filter((journal) => journal.user_id === userId && !!journal.trade_record_id && !journal.post_reviewed_at)
      .sort((a, b) => b.pre_simulated_time.localeCompare(a.pre_simulated_time));
  }

  const { data, error } = await supabase
    .from("trade_journals" as never)
    .select("*")
    .eq("user_id", userId)
    .not("trade_record_id", "is", null)
    .is("post_reviewed_at", null)
    .order("pre_simulated_time", { ascending: false });
  return wrap("查询未评价日记", error, data as unknown as TradeJournal[]);
}

/**
 * 通过 symbol + direction + 入场价 匹配最近一笔未评价 journal（CLOSE 触发时使用）
 */
export async function findUnreviewedJournalForClose(
  userId: string,
  symbol: string,
  direction: TradeDirection,
  entryPrice: number,
): Promise<TradeJournal | null> {
  if (isDevJournalMode()) {
    const rows = readDevStore().journals
      .filter(
        (journal) =>
          journal.user_id === userId &&
          journal.symbol === symbol &&
          journal.direction === direction &&
          !journal.post_reviewed_at,
      )
      .sort((a, b) => b.pre_simulated_time.localeCompare(a.pre_simulated_time))
      .slice(0, 20);
    if (rows.length === 0) return null;
    const tolerance = Math.max(entryPrice * 0.005, 0.5);
    const matched = rows
      .filter((journal) => journal.pre_entry_price != null && Math.abs(journal.pre_entry_price - entryPrice) <= tolerance)
      .sort(
        (a, b) =>
          Math.abs((a.pre_entry_price ?? 0) - entryPrice) -
          Math.abs((b.pre_entry_price ?? 0) - entryPrice),
      );
    return matched[0] ?? rows[0] ?? null;
  }

  const { data, error } = await supabase
    .from("trade_journals" as never)
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .eq("direction", direction)
    .is("post_reviewed_at", null)
    .order("pre_simulated_time", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[journalApi] 匹配未评价日记失败:", error);
    throw new Error(`匹配未评价日记失败：${error.message}`);
  }
  const rows = (data ?? []) as unknown as TradeJournal[];
  if (rows.length === 0) return null;
  // 按入场价接近度排序，取最接近的
  const tolerance = Math.max(entryPrice * 0.005, 0.5);
  const matched = rows
    .filter(r => r.pre_entry_price != null && Math.abs(r.pre_entry_price - entryPrice) <= tolerance)
    .sort(
      (a, b) =>
        Math.abs((a.pre_entry_price ?? 0) - entryPrice) -
        Math.abs((b.pre_entry_price ?? 0) - entryPrice),
    );
  return matched[0] ?? rows[0] ?? null;
}

export interface BulkTagInput {
  patternId: string;
  phase: TaggedPhase;
  note?: string | null;
}

export async function bulkAssignTags(
  journalId: string,
  assignments: BulkTagInput[],
): Promise<void> {
  if (assignments.length === 0) return;
  if (isDevJournalMode()) {
    const userId = getDevUserId();
    if (!userId) throw new Error("打标签失败：用户未登录");
    const store = readDevStore();
    for (const assignment of assignments) {
      const existing = store.assignments.find(
        (row) =>
          row.journal_id === journalId &&
          row.pattern_id === assignment.patternId &&
          row.tagged_phase === assignment.phase,
      );
      if (existing) {
        existing.note = assignment.note ?? null;
      } else {
        store.assignments.push({
          id: crypto.randomUUID(),
          user_id: userId,
          journal_id: journalId,
          pattern_id: assignment.patternId,
          tagged_phase: assignment.phase,
          note: assignment.note ?? null,
          created_at: new Date().toISOString(),
        });
      }
    }
    writeDevStore(store);
    return;
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("打标签失败：用户未登录");

  const rows = assignments.map(a => ({
    user_id: userId,
    journal_id: journalId,
    pattern_id: a.patternId,
    tagged_phase: a.phase,
    note: a.note ?? null,
  }));
  const { error } = await supabase
    .from("journal_tag_assignments" as never)
    .upsert(rows as never, { onConflict: "journal_id,pattern_id,tagged_phase" });
  if (error) {
    console.error("[journalApi] 批量打标签失败:", error);
    throw new Error(`批量打标签失败：${error.message}`);
  }
}

/**
 * 替换某 journal 在指定 phase 下的所有标签（保存评价时使用）。
 */
export async function replacePhaseAssignments(
  journalId: string,
  phase: TaggedPhase,
  assignments: BulkTagInput[],
): Promise<void> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    writeDevStore({
      ...store,
      assignments: store.assignments.filter(
        (assignment) => !(assignment.journal_id === journalId && assignment.tagged_phase === phase),
      ),
    });
    await bulkAssignTags(journalId, assignments);
    return;
  }

  const { error: delErr } = await supabase
    .from("journal_tag_assignments" as never)
    .delete()
    .eq("journal_id", journalId)
    .eq("tagged_phase", phase);
  if (delErr) {
    console.error("[journalApi] 清除旧标签失败:", delErr);
    throw new Error(`清除旧标签失败：${delErr.message}`);
  }
  await bulkAssignTags(journalId, assignments);
}

export async function countPatternOccurrencesLast30Days(
  userId: string,
  patternId: string,
): Promise<number> {
  if (isDevJournalMode()) {
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return readDevStore().assignments.filter(
      (assignment) =>
        assignment.user_id === userId &&
        assignment.pattern_id === patternId &&
        new Date(assignment.created_at).getTime() >= since,
    ).length;
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("journal_tag_assignments" as never)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("pattern_id", patternId)
    .gte("created_at", since);
  if (error) {
    console.error("[journalApi] 统计模式 30 天频次失败:", error);
    throw new Error(`统计模式频次失败：${error.message}`);
  }
  return count ?? 0;
}


export async function createRule(input: CreateRuleInput): Promise<TradingRule> {
  if (isDevJournalMode()) {
    const now = new Date().toISOString();
    const rule: TradingRule = {
      id: crypto.randomUUID(),
      source_pattern_id: input.source_pattern_id ?? null,
      is_active: input.is_active ?? true,
      added_to_checklist: false,
      trigger_threshold: input.trigger_threshold ?? null,
      required: false,
      ui_order: 0,
      snooze_until: null,
      created_at: now,
      updated_at: now,
      user_id: input.user_id,
      rule_text: input.rule_text,
    };
    const store = readDevStore();
    writeDevStore({ ...store, rules: [rule, ...store.rules] });
    return rule;
  }

  const { data, error } = await supabase
    .from("trading_rules" as never)
    .insert(input as never)
    .select()
    .single();
  return wrap("创建交易规则", error, data as unknown as TradingRule);
}

export async function markRuleAddedToChecklist(ruleId: string): Promise<void> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    const index = store.rules.findIndex((rule) => rule.id === ruleId);
    if (index >= 0) {
      store.rules[index] = { ...store.rules[index], added_to_checklist: true, updated_at: new Date().toISOString() };
      writeDevStore(store);
    }
    return;
  }

  const { error } = await supabase
    .from("trading_rules" as never)
    .update({ added_to_checklist: true } as never)
    .eq("id", ruleId);
  if (error) {
    console.error("[journalApi] 标记规则已加入 checklist 失败:", error);
    throw new Error(`标记规则失败：${error.message}`);
  }
}

// ============ Batch 4: bulk fetch ============

export interface BulkJournalFilters {
  dateFrom?: string;
  dateTo?: string;
  symbol?: string;
  outcome?: TradeOutcome;
  categoryId?: string;
}

export interface BulkJournalData {
  journals: TradeJournal[];
  assignments: JournalTagAssignment[];
  patterns: ErrorTagPattern[];
  categories: ErrorTagCategory[];
  rules: TradingRule[];
}

export async function listAllJournalDataForUser(
  userId: string,
  filters?: BulkJournalFilters,
): Promise<BulkJournalData> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    const journals = filterDevJournals(store.journals, userId, filters)
      .sort((a, b) => b.pre_simulated_time.localeCompare(a.pre_simulated_time));
    const journalIds = new Set(journals.map((journal) => journal.id));
    return {
      journals,
      assignments: store.assignments.filter(
        (assignment) => assignment.user_id === userId && journalIds.has(assignment.journal_id),
      ),
      patterns: store.patterns.filter((pattern) => pattern.user_id === userId),
      categories: DEV_CATEGORIES,
      rules: store.rules.filter((rule) => rule.user_id === userId),
    };
  }

  let jq = supabase.from("trade_journals" as never).select("*").eq("user_id", userId);
  if (filters?.dateFrom) jq = jq.gte("pre_simulated_time", filters.dateFrom);
  if (filters?.dateTo) jq = jq.lte("pre_simulated_time", filters.dateTo);
  if (filters?.symbol) jq = jq.eq("symbol", filters.symbol);
  if (filters?.outcome) jq = jq.eq("post_outcome", filters.outcome);

  const aq = supabase.from("journal_tag_assignments" as never).select("*").eq("user_id", userId);
  const pq = supabase.from("error_tag_patterns" as never).select("*").eq("user_id", userId);
  const cq = supabase.from("error_tag_categories" as never).select("*").order("sort_order", { ascending: true });
  const rq = supabase.from("trading_rules" as never).select("*").eq("user_id", userId);

  const [jr, ar, pr, cr, rr] = await Promise.all([jq, aq, pq, cq, rq]);
  if (jr.error) throw new Error(`加载日记失败：${jr.error.message}`);
  if (ar.error) throw new Error(`加载标签关联失败：${ar.error.message}`);
  if (pr.error) throw new Error(`加载错误模式失败：${pr.error.message}`);
  if (cr.error) throw new Error(`加载分类失败：${cr.error.message}`);
  if (rr.error) throw new Error(`加载规则失败：${rr.error.message}`);

  return {
    journals: (jr.data ?? []) as unknown as TradeJournal[],
    assignments: (ar.data ?? []) as unknown as JournalTagAssignment[],
    patterns: (pr.data ?? []) as unknown as ErrorTagPattern[],
    categories: (cr.data ?? []) as unknown as ErrorTagCategory[],
    rules: (rr.data ?? []) as unknown as TradingRule[],
  };
}

// ============ Batch 6: Counterfactual branches ============

const MAX_BRANCHES = 10;

export async function appendCounterfactualBranch(
  journalId: string,
  branch: { label: string; params: CounterfactualBranchParams; result: CounterfactualBranchResult },
): Promise<TradeJournal> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    const index = store.journals.findIndex((journal) => journal.id === journalId);
    if (index < 0) throw new Error("保存反事实分支失败：记录不存在");
    const existing = store.journals[index].counterfactual_branches ?? [];
    const newBranch: CounterfactualBranch = {
      id: crypto.randomUUID(),
      label: branch.label.slice(0, 20),
      created_at: new Date().toISOString(),
      params: branch.params,
      result: branch.result,
    };
    let next = [...existing, newBranch];
    if (next.length > MAX_BRANCHES) {
      next = next.sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(next.length - MAX_BRANCHES);
    }
    const updated = touchJournal(store.journals[index], { counterfactual_branches: next });
    store.journals[index] = updated;
    writeDevStore(store);
    return updated;
  }

  const { data: current, error: gErr } = await supabase
    .from("trade_journals" as never)
    .select("counterfactual_branches")
    .eq("id", journalId)
    .single();
  if (gErr) throw new Error(`读取分支失败：${gErr.message}`);
  const rawBranches = ((current as unknown as { counterfactual_branches?: CounterfactualBranch[] })?.counterfactual_branches) ?? [];
  const existing: CounterfactualBranch[] = Array.isArray(rawBranches) ? rawBranches : [];
  const newBranch: CounterfactualBranch = {
    id: crypto.randomUUID(),
    label: branch.label.slice(0, 20),
    created_at: new Date().toISOString(),
    params: branch.params,
    result: branch.result,
  };
  let next = [...existing, newBranch];
  if (next.length > MAX_BRANCHES) {
    next = next.sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(next.length - MAX_BRANCHES);
  }
  const { data, error } = await supabase
    .from("trade_journals" as never)
    .update({ counterfactual_branches: next } as never)
    .eq("id", journalId)
    .select()
    .single();
  return wrap("保存反事实分支", error, data as unknown as TradeJournal);
}

export async function deleteCounterfactualBranch(
  journalId: string,
  branchId: string,
): Promise<TradeJournal> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    const index = store.journals.findIndex((journal) => journal.id === journalId);
    if (index < 0) throw new Error("删除反事实分支失败：记录不存在");
    const existing = store.journals[index].counterfactual_branches ?? [];
    const updated = touchJournal(store.journals[index], {
      counterfactual_branches: existing.filter((branch) => branch.id !== branchId),
    });
    store.journals[index] = updated;
    writeDevStore(store);
    return updated;
  }

  const { data: current, error: gErr } = await supabase
    .from("trade_journals" as never)
    .select("counterfactual_branches")
    .eq("id", journalId)
    .single();
  if (gErr) throw new Error(`读取分支失败：${gErr.message}`);
  const existing = (((current as unknown as { counterfactual_branches?: CounterfactualBranch[] })?.counterfactual_branches) ?? []) as CounterfactualBranch[];
  const next = existing.filter(b => b.id !== branchId);
  const { data, error } = await supabase
    .from("trade_journals" as never)
    .update({ counterfactual_branches: next } as never)
    .eq("id", journalId)
    .select()
    .single();
  return wrap("删除反事实分支", error, data as unknown as TradeJournal);
}

// ============ Batch 6: Rule management ============

export async function updateRule(
  ruleId: string,
  patch: Partial<Pick<TradingRule, "rule_text" | "is_active" | "required" | "added_to_checklist" | "ui_order" | "snooze_until">>,
): Promise<TradingRule> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    const index = store.rules.findIndex((rule) => rule.id === ruleId);
    if (index < 0) throw new Error("更新规则失败：记录不存在");
    const updated = { ...store.rules[index], ...patch, updated_at: new Date().toISOString() };
    store.rules[index] = updated;
    writeDevStore(store);
    return updated;
  }

  const { data, error } = await supabase
    .from("trading_rules" as never)
    .update(patch as never)
    .eq("id", ruleId)
    .select()
    .single();
  return wrap("更新规则", error, data as unknown as TradingRule);
}

export async function deleteRule(ruleId: string): Promise<void> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    writeDevStore({ ...store, rules: store.rules.filter((rule) => rule.id !== ruleId) });
    return;
  }

  const { error } = await supabase
    .from("trading_rules" as never)
    .delete()
    .eq("id", ruleId);
  if (error) throw new Error(`删除规则失败：${error.message}`);
}

export async function snoozeRulePattern(
  userId: string,
  patternId: string,
  hours: number,
): Promise<void> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    const snoozeUntil = new Date(Date.now() + hours * 3600_000).toISOString();
    const existing = store.rules
      .filter((rule) => rule.user_id === userId && rule.source_pattern_id === patternId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (existing) {
      existing.snooze_until = snoozeUntil;
      existing.updated_at = new Date().toISOString();
    } else {
      const now = new Date().toISOString();
      store.rules.push({
        id: crypto.randomUUID(),
        user_id: userId,
        source_pattern_id: patternId,
        rule_text: "[延后]",
        is_active: false,
        added_to_checklist: false,
        trigger_threshold: null,
        required: false,
        ui_order: 0,
        snooze_until: snoozeUntil,
        created_at: now,
        updated_at: now,
      });
    }
    writeDevStore(store);
    return;
  }

  // Create a placeholder dismissed rule to capture snooze for this pattern
  const snoozeUntil = new Date(Date.now() + hours * 3600_000).toISOString();
  // Find existing rule for this pattern (any state) or create disabled placeholder
  const { data: existing } = await supabase
    .from("trading_rules" as never)
    .select("*")
    .eq("user_id", userId)
    .eq("source_pattern_id", patternId)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (existing as unknown as TradingRule[] | null)?.[0];
  if (row) {
    await updateRule(row.id, { snooze_until: snoozeUntil });
  } else {
    const { error } = await supabase
      .from("trading_rules" as never)
      .insert({
        user_id: userId,
        source_pattern_id: patternId,
        rule_text: "[延后]",
        is_active: false,
        added_to_checklist: false,
        snooze_until: snoozeUntil,
        required: false,
      } as never);
    if (error) throw new Error(`延后失败：${error.message}`);
  }
}

// ============ Batch 7: Deep analysis ============

export interface DeepAnalysisInput {
  post_error_scenario?: string | null;
  post_original_hypothesis?: string | null;
  post_reality_feedback?: string | null;
  post_error_type_summary?: string | null;
  post_real_problem?: string | null;
  post_new_rule_draft?: string | null;
}

export async function updateJournalDeepAnalysis(
  journalId: string,
  input: DeepAnalysisInput,
): Promise<TradeJournal> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    const index = store.journals.findIndex((journal) => journal.id === journalId);
    if (index < 0) throw new Error("保存深度分析失败：记录不存在");
    const updated = touchJournal(store.journals[index], input);
    store.journals[index] = updated;
    writeDevStore(store);
    return updated;
  }

  const { data, error } = await supabase
    .from("trade_journals" as never)
    .update(input as never)
    .eq("id", journalId)
    .select()
    .single();
  return wrap("保存深度分析", error, data as unknown as TradeJournal);
}

export async function promoteDraftToRule(
  journalId: string,
  options: { required: boolean; sourcePatternId?: string | null },
): Promise<TradingRule> {
  if (isDevJournalMode()) {
    const store = readDevStore();
    const journal = store.journals.find((row) => row.id === journalId);
    if (!journal) throw new Error("读取草稿失败：记录不存在");
    const text = (journal.post_new_rule_draft ?? "").trim();
    if (text.length < 15) throw new Error("规则草稿至少 15 字");
    const now = new Date().toISOString();
    const rule: TradingRule = {
      id: crypto.randomUUID(),
      user_id: journal.user_id,
      source_pattern_id: options.sourcePatternId ?? null,
      rule_text: text,
      is_active: true,
      added_to_checklist: true,
      trigger_threshold: null,
      required: options.required,
      ui_order: 0,
      snooze_until: null,
      created_at: now,
      updated_at: now,
    };
    store.rules.unshift(rule);
    writeDevStore(store);
    return rule;
  }

  const { data: cur, error: gErr } = await supabase
    .from("trade_journals" as never)
    .select("user_id,post_new_rule_draft")
    .eq("id", journalId)
    .single();
  if (gErr) throw new Error(`读取草稿失败：${gErr.message}`);
  const row = cur as unknown as { user_id: string; post_new_rule_draft: string | null };
  const text = (row?.post_new_rule_draft ?? "").trim();
  if (text.length < 15) throw new Error("规则草稿至少 15 字");
  const { data, error } = await supabase
    .from("trading_rules" as never)
    .insert({
      user_id: row.user_id,
      source_pattern_id: options.sourcePatternId ?? null,
      rule_text: text,
      is_active: true,
      added_to_checklist: true,
      required: options.required,
    } as never)
    .select()
    .single();
  return wrap("写入规则", error, data as unknown as TradingRule);
}
