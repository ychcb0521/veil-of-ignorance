/**
 * 错题集数据访问层
 * 所有读写均通过 Supabase JS client，错误以中文 Error 抛出。
 */

import { supabase } from "@/integrations/supabase/client";
import type { KlineData } from '@/hooks/useBinanceData';
import {
  buildActualSimulationParams,
  buildDeviationFixParams,
  buildPureSopParams,
  computeDeviationCosts,
  simulateCampaign,
} from '@/lib/campaignSimulationEngine';
import { INITIAL_COGNITIVE_ASSETS } from '@/lib/cognitiveAssetsInitialContent';
import { suggestLegRoles as suggestLegRolesHeuristic } from '@/lib/legRoleSuggestion';
import type { CognitiveAssetsDoc, CognitiveAssetCategory, CognitiveAssetSection } from '@/types/cognitiveAssets';
import type {
  CampaignCounterfactual,
  CampaignCounterfactualBranchKind,
  CampaignCounterfactualParams,
  CampaignCounterfactualResult,
  CampaignComment,
  ClassificationAssignmentInput,
  ClassificationValidationInput,
  ClassificationValidationResult,
  CampaignEvent,
  CampaignStatus,
  DeviationCost,
  ErrorTagCategory,
  ErrorTagPattern,
  JournalTagAssignment,
  LegRole,
  AccountFollow,
  PainLogEntry,
  PainTag,
  PrincipleEvolutionLevel,
  RuleCategory,
  StrategyTemplate,
  SuggestedLegRole,
  TaggedPhase,
  TradePrinciple,
  TradeCampaign,
  TradeDirection,
  TradeJournal,
  TradeOutcome,
  TradingRule,
  StopDoingItem,
  CounterfactualBranch,
  CounterfactualBranchParams,
  CounterfactualBranchResult,
} from "@/types/journal";
import { isHistoricalCampaign, ruleCooldownRemainingMs } from "@/types/journal";
import type { PendingOrder, TradeRecord } from "@/types/trading";


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

function toCampaign(row: unknown): TradeCampaign {
  return row as TradeCampaign;
}

function toCampaignCounterfactual(row: unknown): CampaignCounterfactual {
  return row as CampaignCounterfactual;
}

function toCampaignEvent(row: unknown): CampaignEvent {
  return row as CampaignEvent;
}

function inferCampaignEventType(legRole: LegRole): CampaignEvent['event_type'] {
  if (legRole === 'standalone') return 'note';
  if (legRole === 'main_open' || legRole === 'reentry_main') return 'main_opened';
  if (legRole === 'mirror_tp') return 'mirror_tp_placed';
  return 'hedge_placed';
}

function getUserStoragePrefix(userId: string): string {
  return `sim_${userId}_`;
}

function readUserScopedStorage<T>(userId: string, key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${getUserStoragePrefix(userId)}${key}`);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeUserScopedStorage<T>(userId: string, key: string, value: T): void {
  try {
    localStorage.setItem(`${getUserStoragePrefix(userId)}${key}`, JSON.stringify(value));
  } catch (error) {
    console.warn(`[journalApi] 写入本地缓存失败: ${key}`, error);
  }
}

function removeUserScopedStorage(userId: string, key: string): void {
  try {
    localStorage.removeItem(`${getUserStoragePrefix(userId)}${key}`);
  } catch (error) {
    console.warn(`[journalApi] 删除本地缓存失败: ${key}`, error);
  }
}

/**
 * 读取该用户的成交流水（本地存储，同步、零网络）。
 * 错题集的「路径主动权」切面用它把每笔复盘 journal 接回 entry/exit/openTime/closeTime/
 * exit_method —— 那些字段只在 TradeRecord 上，journal 里没有。
 */
export function listTradeHistoryForUser(userId: string): TradeRecord[] {
  return readUserScopedStorage<TradeRecord[]>(userId, 'trade_history', []);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCognitiveAssetSection(value: unknown): value is CognitiveAssetSection {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.content === 'string'
    && (value.headingLevel === undefined || typeof value.headingLevel === 'number')
    && (value.headingNumber === undefined || typeof value.headingNumber === 'string')
    && (value.sourceTitle === undefined || typeof value.sourceTitle === 'string');
}

function isCognitiveAssetCategory(value: unknown): value is CognitiveAssetCategory {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.subtitle === 'string'
    && typeof value.intro === 'string'
    && Array.isArray(value.sections)
    && value.sections.every(isCognitiveAssetSection);
}

function isCognitiveAssetsDoc(value: unknown): value is CognitiveAssetsDoc {
  return isRecord(value)
    && isRecord(value.meta)
    && typeof value.meta.title === 'string'
    && typeof value.meta.subtitle === 'string'
    && Array.isArray(value.categories)
    && value.categories.every(isCognitiveAssetCategory);
}

type CognitiveAssetsRow = {
  user_id: string;
  content: unknown;
  last_edited_at?: string | null;
  created_at?: string;
};

const COGNITIVE_ASSETS_STORAGE_KEY = 'cognitive_assets_doc';
const TRADE_CAMPAIGNS_STORAGE_KEY = 'trade_campaigns';

function getInitialCognitiveAssetsDoc(): CognitiveAssetsDoc {
  return deepClone(INITIAL_COGNITIVE_ASSETS);
}

function isMissingCognitiveAssetsTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || /schema cache/i.test(message)
    || /cognitive_assets/i.test(message) && /could not find|does not exist/i.test(message);
}

function readLocalCognitiveAssetsRow(userId: string): CognitiveAssetsRow | null {
  const localDoc = readUserScopedStorage<unknown>(userId, COGNITIVE_ASSETS_STORAGE_KEY, null);
  const normalized = normalizeCognitiveAssetsDoc(localDoc);
  if (!normalized) return null;
  return {
    user_id: userId,
    content: normalized,
    last_edited_at: null,
  };
}

async function readCognitiveAssetsRow(userId: string): Promise<CognitiveAssetsRow | null> {
  const { data, error } = await supabase
    .from('cognitive_assets' as never)
    .select('user_id, content, last_edited_at, created_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (isMissingCognitiveAssetsTableError(error)) {
      return readLocalCognitiveAssetsRow(userId);
    }
    throw new Error(`读取认知资产失败：${error.message}`);
  }
  return (data as CognitiveAssetsRow | null) ?? null;
}

async function writeCognitiveAssetsDoc(userId: string, doc: CognitiveAssetsDoc): Promise<void> {
  const payload = {
    user_id: userId,
    content: deepClone(doc),
    last_edited_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('cognitive_assets' as never)
    .upsert(payload as never, { onConflict: 'user_id' })
    .select('user_id')
    .single();
  if (error) {
    if (isMissingCognitiveAssetsTableError(error)) {
      writeUserScopedStorage(userId, COGNITIVE_ASSETS_STORAGE_KEY, doc);
      return;
    }
    throw new Error(`保存认知资产失败：${error.message}`);
  }
  removeUserScopedStorage(userId, COGNITIVE_ASSETS_STORAGE_KEY);
}

function normalizeCognitiveAssetsDoc(raw: unknown): CognitiveAssetsDoc | null {
  return isCognitiveAssetsDoc(raw) ? deepClone(raw) : null;
}

async function getCurrentUserAndCapital(): Promise<{ userId: string; initialCapital: number }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('用户未登录');
  const { data: profile, error } = await supabase
    .from('profiles' as never)
    .select('initial_capital')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`读取账户信息失败：${error.message}`);
  const initialCapital = ((profile as { initial_capital?: number } | null)?.initial_capital ?? 10_000);
  return { userId, initialCapital };
}

const RETRO_CLASSIFY_NOTE = 'classified retroactively';

const LEG_ROLE_ORDER_KIND_COMPATIBILITY: Record<LegRole, Array<TradeJournal['order_kind']>> = {
  main_open: ['main'],
  hedge_initial_a: ['hedge'],
  hedge_initial_b: ['hedge'],
  hedge_rolling: ['hedge'],
  mirror_tp: ['hedge', 'main'],
  reentry_main: ['main'],
  reentry_hedge: ['hedge'],
  standalone: ['main', 'hedge'],
} as const satisfies Record<string, Array<TradeJournal['order_kind']>>;

type MutableCampaignPatch = Partial<
  Pick<
    TradeCampaign,
    | 'opened_at'
    | 'closed_at'
    | 'direction'
    | 'status'
    | 'initial_main_size_usdt'
    | 'initial_leverage'
    | 'final_realized_pnl'
    | 'final_r_multiple'
    | 'peak_unrealized_pnl'
    | 'peak_drawdown'
    | 'actual_evolution'
  >
>;

function isMissingTradeCampaignsTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || (/trade_campaigns/i.test(message) && /schema cache|could not find|does not exist/i.test(message));
}

function isMissingTradeJournalsFeatureError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || (/trade_journals|campaign_id|leg_role|leg_sequence/i.test(message) && /schema cache|could not find|does not exist|column/i.test(message));
}

function isMissingCounterfactualsTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || (/campaign_counterfactuals/i.test(message) && /schema cache|could not find|does not exist/i.test(message));
}

function isMissingSocialFeatureError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || (/account_follows|trade_campaign_comments/i.test(message) && /schema cache|could not find|does not exist|column/i.test(message));
}

/**
 * 「可选/新增」列模式：远程库可能尚未应用对应迁移、还没建这些列。
 * 同一个常量有两个用途：
 *   1) 匹配错误信息里出现的列名（判定这是「缺新列」而非约束错误）；
 *   2) 按「列名」批量剥离——严重漂移时一次性删掉所有可选列（见 stripAllOptionalColumns）。
 * 核心列（user_id/symbol/direction/pre_entry_reason/pre_mental_state/post_outcome…）
 * 不在此模式内，永不会被误判或误删。仅用 i 标志（无 g），test() 无状态、可安全复用。
 */
const OPTIONAL_COLUMN_PATTERN = /trade_principles|pain_log_entries|order_kind|pre_thesis_why_right|pre_premortem_failure_reason|pre_falsification_signal|pre_confidence_basis|pre_odds_structure|pre_odds_structure_source|pre_odds_structure_premortem|pre_odds_structure_breakdown_signals|pre_account_equity_usdt|pre_opportunity_cost_worth|pre_cheap_opportunity|pre_edge_source|pre_market_regime|pre_entry_stage|pre_stop_quality|pre_chase_after_close|pre_mortem_text|pre_positive_expectancy|pre_invalidation_condition|pre_calibration_win_pct|pre_confidence_interval_|pre_calibration_reference_class|pre_calibration_competence_basis|pre_calibration_update_signal|pre_dataset_split|pre_lollapalooza_score|pre_bankruptcy_estimate|pre_info_|pre_opponent_statement|pre_pain_tags|pre_cognitive_bias_tags|pre_triggered_principle_ids|pre_triggered_rule_ids|pre_executor_self|pre_designer_self|journal_kind|no_trade_reason|no_trade_would_be_entry_price|no_trade_direction|exit_falsification_status|exit_falsification_note|post_result_summary|post_decision_quality|post_struggle_level|post_small_position_drag|post_missed_high_odds_state|post_path_|post_positive_expectancy_review|post_premortem_review|post_invalidation_review|post_five_step|post_opponent_was_right|post_proximate_cause|post_root_cause|post_design_intervention|post_intervention_type|post_execution_monitor|post_real_close_time|evolution_level|principle_id|hedge_type|hedge_boundary_price|hedge_boundary_basis|hedge_boundary_stance|hedge_lock_profit_pct|hedge_resolution_up|hedge_resolution_down|hedge_down_if_chop|hedge_down_if_trend|hedge_down_if_rebound|hedge_necessity_pct|hedge_safety_strength|hedge_safety_regularity|hedge_risk_magnitude|hedge_conviction_pct|hedge_friction_cost|hedge_order_method|hedge_worth_it/i;

function isMissingDalioMetaLayerError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === 'PGRST204'
    || error.code === '42P01'
    || (OPTIONAL_COLUMN_PATTERN.test(message)
      && /schema cache|could not find|does not exist|column/i.test(message));
}

export function missingSchemaColumn(error: { message?: string } | null): string | null {
  const message = error?.message ?? '';
  // PGRST204: Could not find the 'pre_confidence_basis' column of 'trade_journals' …
  const quotedColumn = /['"]([a-zA-Z0-9_]+)['"]\s+column/i.exec(message);
  if (quotedColumn?.[1]) return quotedColumn[1];
  const columnOf = /column\s+['"]([a-zA-Z0-9_]+)['"]/i.exec(message);
  if (columnOf?.[1]) return columnOf[1];
  // Postgres 原生 42703（未加引号，可能带 schema/表前缀），如：
  //   column trade_journals.pre_confidence_basis does not exist
  // PostgREST 偶尔会透传这种信息——也要能解析出列名以便剥离。
  const unquoted = /column\s+(?:[a-zA-Z0-9_]+\.)*([a-zA-Z0-9_]+)\s+does not exist/i.exec(message);
  return unquoted?.[1] ?? null;
}

/**
 * 通用「列不在 schema 缓存里 / 列不存在」识别——不再依赖硬编码列名清单。
 * 远程库落后于迁移时（例如还没建 pre_confidence_basis），PostgREST 会回
 * PGRST204 + "Could not find the 'xxx' column ... in the schema cache"。
 * 这类错误一律视为「可剥离该列后重试」，从而让提交在缺列时仍然成功。
 * 注意：约束类错误（NOT NULL / 外键 / check）不算缺列，必须照常抛出。
 */
export function isSchemaColumnMissingError(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  // PostgREST: 列不在 schema 缓存(PGRST204) / 表缺失(PGRST205)；
  // Postgres: 未定义列(42703) / 未定义表(42P01)。
  if (error.code === 'PGRST204' || error.code === 'PGRST205'
    || error.code === '42703' || error.code === '42P01') return true;
  const message = error.message ?? '';
  // 约束违反不是「缺列」——不要误剥离。
  if (/violates|constraint/i.test(message)) return false;
  return (/could not find the .*column|schema cache|does not exist/i.test(message))
    && missingSchemaColumn(error) != null;
}

/** 逐列剥离若干次仍缺列，即判定远程库「严重漂移」，转为一次性批量剥离，避免几十次往返。 */
const BULK_STRIP_AFTER = 5;

/**
 * 一次性剥掉 payload 里所有「可选/新增」列（列名命中 OPTIONAL_COLUMN_PATTERN）。
 * 仅在严重漂移时调用——此时远程库缺几十列，逐列往返太慢。核心列不在模式内，全部保留。
 * 不在此处理 NOT NULL 兜底（pre_entry_reason），由调用方按 insert/update 语义决定。
 */
function stripAllOptionalColumns(payload: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (OPTIONAL_COLUMN_PATTERN.test(key)) continue;
    rest[key] = value;
  }
  return rest;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 兼容旧数据库约束 chk_main_order_completeness：
 * 某些远程库已经有 order_kind，却仍要求主力单的旧字段
 * pre_risk_awareness / pre_risk_management / pre_checklist_* 非空。
 * 新版快照把风险拆到了三问、赔率结构与 checklist 里，所以插入前统一生成 legacy 镜像字段。
 */
export function normalizeMainOrderLegacyCompleteness(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...payload };
  if (next.order_kind === 'hedge') return next;

  if (next.pre_entry_reason == null) {
    next.pre_entry_reason = asNonEmptyString(next.pre_thesis_why_right)
      ?? asNonEmptyString(next.no_trade_reason)
      ?? '[新版快照] 见决策三问与盈亏比轴';
  }
  if (next.pre_risk_awareness == null) {
    next.pre_risk_awareness = asNonEmptyString(next.pre_premortem_failure_reason)
      ?? asNonEmptyString(next.pre_odds_structure_premortem)
      ?? '[新版快照] 亏损假设已记录在三问/盈亏比结构里';
  }
  if (next.pre_risk_management == null) {
    const stopSignal = asNonEmptyString(next.pre_falsification_signal)
      ?? asNonEmptyString(next.pre_odds_structure_breakdown_signals);
    next.pre_risk_management = stopSignal
      ? `封死下限：这是让你敢多下、且每个赢家更肥的前提。证伪/结构破坏信号：${stopSignal}`
      : '封死下限：这是让你敢多下、且每个赢家更肥的前提。';
  }
  if (next.pre_checklist_items == null) {
    next.pre_checklist_items = [];
  }
  if (next.pre_checklist_passed == null) {
    next.pre_checklist_passed = true;
  }
  return next;
}

async function updateTradeJournalWithSchemaFallback(
  journalId: string,
  payload: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  let nextPayload = { ...payload };
  let lastData: unknown = null;
  let lastError: { message: string; code?: string } | null = null;
  let stripped = 0;
  let bulkStripped = false;
  // 远程库可能缺几十列，逐列剥离次数必须足够覆盖；原来固定 30 会在严重漂移时提前耗尽。
  const maxAttempts = Object.keys(payload).length + 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (Object.keys(nextPayload).length === 0) return { data: lastData, error: null };
    const { data, error } = await supabase
      .from("trade_journals" as never)
      .update(nextPayload as never)
      .eq("id", journalId)
      .select()
      .single();
    lastData = data;
    lastError = error;
    if (!error) return { data, error: null };
    if (!isMissingDalioMetaLayerError(error) && !isSchemaColumnMissingError(error)) return { data, error };
    const missing = missingSchemaColumn(error);
    if (!missing || !(missing in nextPayload)) return { data, error };
    // 严重漂移：逐列剥到阈值仍缺列，一次性剥掉所有可选列（update 不需回填 pre_entry_reason，
    // 因为目标行已存在、旧列早已有值，强行回填反而会覆盖既有理由）。
    if (stripped >= BULK_STRIP_AFTER && !bulkStripped) {
      nextPayload = stripAllOptionalColumns(nextPayload);
      bulkStripped = true;
      continue;
    }
    const rest = { ...nextPayload };
    delete rest[missing];
    nextPayload = rest;
    stripped += 1;
  }

  return { data: lastData, error: lastError };
}

/**
 * 插入 trade_journals，遇到"schema 里还没有的列"就逐列剥掉再重试（最多 30 次），
 * 而不是一次性按硬编码清单全删——后者会在"批次 23/24 列已存在、批次 25 列还没建"的
 * 混合 schema 下，把主力单快照里本应写入的元数据列一起误删，造成主力单退化。
 *
 * 唯一的特殊处理：旧库若连 pre_thesis_why_right 都没有，则把它的内容回填到 legacy
 * 的 pre_entry_reason（NOT NULL 兜底），与重构前的行为保持一致。
 */
export async function insertTradeJournalWithSchemaFallback(
  payload: Record<string, unknown>,
): Promise<{ data: unknown; error: { message: string; code?: string } | null }> {
  let nextPayload = normalizeMainOrderLegacyCompleteness(payload);
  let lastData: unknown = null;
  let lastError: { message: string; code?: string } | null = null;
  let stripped = 0;
  let bulkStripped = false;
  // 远程库可能缺几十列，逐列剥离次数必须足够覆盖；原来固定 30 会在严重漂移时提前耗尽，
  // 导致快照提交直接报错（line: "Could not find the 'pre_confidence_basis' column …"）。
  const maxAttempts = Object.keys(nextPayload).length + 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data, error } = await supabase
      .from("trade_journals" as never)
      .insert(nextPayload as never)
      .select()
      .single();
    lastData = data;
    lastError = error;
    if (!error) return { data, error: null };
    if (!isMissingDalioMetaLayerError(error) && !isSchemaColumnMissingError(error)) return { data, error };
    const missing = missingSchemaColumn(error);
    if (!missing || !(missing in nextPayload)) return { data, error };
    // 严重漂移：逐列剥到阈值仍缺列，一次性剥掉所有可选列；若把 pre_thesis_why_right
    // 也剥了，则把理由回填到 NOT NULL 旧列 pre_entry_reason（与逐列兜底保持一致）。
    if (stripped >= BULK_STRIP_AFTER && !bulkStripped) {
      const before = nextPayload;
      const bulk = stripAllOptionalColumns(before);
      if ('pre_thesis_why_right' in before && bulk.pre_entry_reason == null) {
        bulk.pre_entry_reason = (payload.pre_thesis_why_right as string | null | undefined) ?? '';
      }
      nextPayload = bulk;
      bulkStripped = true;
      continue;
    }
    const rest = { ...nextPayload };
    delete rest[missing];
    // legacy 兜底：只要发生 schema-drift 重试，就把新版三问 A 回填到旧列 pre_entry_reason。
    // 旧库可能还没执行 DROP NOT NULL；若这里继续带 null，会在剥掉缺列后又被 NOT NULL 卡住。
    if (rest.pre_entry_reason == null) {
      rest.pre_entry_reason = (payload.pre_thesis_why_right as string | null | undefined) ?? '';
    }
    nextPayload = rest;
    stripped += 1;
  }

  return { data: lastData, error: lastError };
}

const BASE_POST_REVIEW_KEYS = new Set([
  'post_outcome',
  'post_realized_pnl',
  'post_r_multiple',
  'post_reflection',
  'post_correct_action',
  'post_reviewed_at',
]);

function splitPostReviewPayload(payload: Record<string, unknown>) {
  const base: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  Object.entries(payload).forEach(([key, value]) => {
    if (BASE_POST_REVIEW_KEYS.has(key)) base[key] = value;
    else extra[key] = value;
  });
  return { base, extra };
}

function isCampaignNotFoundError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST116' || /no rows|0 rows/i.test(message);
}

function normalizeLocalCampaigns(raw: unknown): TradeCampaign[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is TradeCampaign => (
    isRecord(item)
    && typeof item.id === 'string'
    && typeof item.user_id === 'string'
    && typeof item.symbol === 'string'
    && typeof item.title === 'string'
  ));
}

function readLocalCampaigns(userId: string): TradeCampaign[] {
  return normalizeLocalCampaigns(readUserScopedStorage<unknown>(userId, TRADE_CAMPAIGNS_STORAGE_KEY, []));
}

function writeLocalCampaigns(userId: string, campaigns: TradeCampaign[]): void {
  writeUserScopedStorage(userId, TRADE_CAMPAIGNS_STORAGE_KEY, campaigns);
}

function upsertLocalCampaign(campaign: TradeCampaign): void {
  const rows = readLocalCampaigns(campaign.user_id);
  const index = rows.findIndex(item => item.id === campaign.id);
  const next = index >= 0
    ? rows.map(item => item.id === campaign.id ? campaign : item)
    : [campaign, ...rows];
  writeLocalCampaigns(campaign.user_id, next);
}

function removeLocalCampaign(userId: string, campaignId: string): void {
  writeLocalCampaigns(userId, readLocalCampaigns(userId).filter(item => item.id !== campaignId));
}

function findLocalCampaign(userId: string, campaignId: string): TradeCampaign | null {
  return readLocalCampaigns(userId).find(item => item.id === campaignId) ?? null;
}

function applyCampaignFilters(rows: TradeCampaign[], filters?: ListCampaignFilters): TradeCampaign[] {
  return rows
    .filter(campaign => {
      if (filters?.status && filters.status !== 'all' && campaign.status !== filters.status) return false;
      if (filters?.symbol && campaign.symbol !== filters.symbol) return false;
      const openedAt = new Date(campaign.opened_at).getTime();
      if (filters?.dateFrom && openedAt < new Date(filters.dateFrom).getTime()) return false;
      if (filters?.dateTo && openedAt > new Date(filters.dateTo).getTime()) return false;
      return true;
    })
    .sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());
}

function mergeCampaigns(remote: TradeCampaign[], local: TradeCampaign[]): TradeCampaign[] {
  const merged = new Map<string, TradeCampaign>();
  local.forEach(campaign => merged.set(campaign.id, campaign));
  remote.forEach(campaign => merged.set(campaign.id, campaign));
  return [...merged.values()].sort((a, b) => new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime());
}

async function getAuthenticatedUserId(label: string): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error(`${label}失败：用户未登录`);
  return userId;
}

function buildLocalCampaignFromCreateInput(
  userId: string,
  input: CreateCampaignInput,
  event: CampaignEvent,
): TradeCampaign {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    symbol: input.symbol,
    direction: input.direction,
    status: 'active',
    strategy_template: input.strategy_template ?? 'main_dual_hedge_mirror_tp',
    title: input.title,
    opened_at: input.opened_at,
    closed_at: null,
    initial_main_size_usdt: null,
    initial_leverage: null,
    final_realized_pnl: null,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    notes: input.notes ?? null,
    actual_evolution: [event],
    created_at: now,
    updated_at: now,
  };
}

function journalTimeMs(journal: Pick<TradeJournal, 'pre_simulated_time'>): number {
  return new Date(journal.pre_simulated_time).getTime();
}

function tradeRecordTimeMs(record: Pick<TradeRecord, 'openTime' | 'closeTime'>): number {
  return record.openTime || record.closeTime || 0;
}

function tradeRecordDirection(record: Pick<TradeRecord, 'side'>): TradeJournal['direction'] {
  return record.side === 'SHORT' ? 'short' : 'long';
}

function tradeRecordPositionSize(record: Pick<TradeRecord, 'entryPrice' | 'quantity'>): number {
  return Math.abs(record.entryPrice * record.quantity);
}

function toCampaignDirection(direction: TradeJournal['direction']): TradeCampaign['direction'] {
  return direction === 'short' ? 'main_short' : 'main_long';
}

function toIso(ms: number | null): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

function tradeRecordOutcome(record: Pick<TradeRecord, 'pnl'>): TradeOutcome {
  if (record.pnl > 0) return 'win';
  if (record.pnl < 0) return 'loss';
  return 'breakeven';
}

function synthesizeJournalFromRecord(
  campaign: TradeCampaign,
  record: TradeRecord,
  event: CampaignEvent,
  sequence: number,
): TradeJournal {
  const timestamp = toIso(tradeRecordTimeMs(record)) ?? event.timestamp;
  const now = event.recorded_at || new Date().toISOString();
  return {
    id: event.journal_id ?? `record-${record.id}`,
    user_id: campaign.user_id,
    trade_record_id: record.id,
    campaign_id: campaign.id,
    leg_role: event.leg_role ?? 'standalone',
    leg_sequence: sequence,
    source: 'retroactive_from_record',
    symbol: record.symbol,
    direction: tradeRecordDirection(record),
    leverage: record.leverage,
    position_mode: 'isolated',
    order_kind: event.leg_role?.startsWith('hedge_') ? 'hedge' : 'main',
    pre_simulated_time: timestamp,
    pre_real_time: now,
    pre_entry_price: record.entryPrice,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: '[历史记录归类] 由仓位历史记录直接组成交易战役',
    pre_mental_state: 3,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: null,
    pre_position_size: tradeRecordPositionSize(record),
    pre_max_loss_usdt: null,
    post_outcome: tradeRecordOutcome(record),
    post_realized_pnl: record.pnl,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    reason_was_rewritten: false,
    created_at: now,
    updated_at: now,
  };
}

function synthesizeCampaignLegsFromEvents(campaign: TradeCampaign): TradeJournal[] {
  const tradeRecordMap = getTradeRecordMapForUser(campaign.user_id);
  const seen = new Set<string>();
  return (campaign.actual_evolution ?? [])
    .filter(event => Boolean(event.trade_record_id))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .flatMap((event) => {
      if (!event.trade_record_id || seen.has(event.trade_record_id)) return [];
      const record = tradeRecordMap.get(event.trade_record_id);
      if (!record) return [];
      seen.add(event.trade_record_id);
      return [synthesizeJournalFromRecord(campaign, record, event, seen.size)];
    });
}

function campaignSnapshotPatch(campaign: TradeCampaign): MutableCampaignPatch {
  return {
    opened_at: campaign.opened_at,
    closed_at: campaign.closed_at,
    direction: campaign.direction,
    status: campaign.status,
    initial_main_size_usdt: campaign.initial_main_size_usdt,
    initial_leverage: campaign.initial_leverage,
    final_realized_pnl: campaign.final_realized_pnl,
    final_r_multiple: campaign.final_r_multiple,
    peak_unrealized_pnl: campaign.peak_unrealized_pnl,
    peak_drawdown: campaign.peak_drawdown,
    actual_evolution: campaign.actual_evolution,
  };
}

async function getJournalsByIds(journalIds: string[]): Promise<TradeJournal[]> {
  if (journalIds.length === 0) return [];
  const { data, error } = await supabase
    .from('trade_journals' as never)
    .select('*')
    .in('id', journalIds);
  return wrap('读取交易日记', error, (data ?? []) as unknown as TradeJournal[]);
}

function getTradeRecordMapForUser(userId: string) {
  const tradeHistory = readUserScopedStorage<TradeRecord[]>(userId, 'trade_history', []);
  return new Map(tradeHistory.map(record => [record.id, record]));
}

function deriveCampaignPatchFromLegs(
  currentCampaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecordMap: Map<string, TradeRecord>,
): MutableCampaignPatch {
  if (legs.length === 0) {
    return {
      opened_at: currentCampaign.opened_at,
      closed_at: null,
      status: 'planned',
      initial_main_size_usdt: null,
      initial_leverage: null,
      final_realized_pnl: null,
      final_r_multiple: null,
    };
  }

  const ordered = [...legs].sort((a, b) => journalTimeMs(a) - journalTimeMs(b));
  const mainOpen = ordered.find(leg => leg.leg_role === 'main_open') ?? ordered.find(leg => leg.order_kind === 'main') ?? null;
  const openedAt = ordered[0]?.pre_simulated_time ?? currentCampaign.opened_at;
  const allHaveTradeRecord = ordered.every(leg => leg.trade_record_id != null);
  const totalPnl = ordered.reduce((sum, leg) => {
    const record = leg.trade_record_id ? tradeRecordMap.get(leg.trade_record_id) ?? null : null;
    return sum + (leg.post_realized_pnl ?? record?.pnl ?? 0);
  }, 0);
  const totalPlannedMaxLoss = ordered.reduce((sum, leg) => sum + (leg.pre_max_loss_usdt ?? 0), 0);
  const closeTimes = ordered
    .map(leg => leg.trade_record_id ? tradeRecordMap.get(leg.trade_record_id)?.closeTime ?? null : null)
    .filter((time): time is number => typeof time === 'number');
  const closedAt = allHaveTradeRecord && closeTimes.length === ordered.length
    ? toIso(Math.max(...closeTimes))
    : null;

  let status: CampaignStatus = 'active';
  if (ordered.some(leg => leg.trade_record_id == null)) {
    status = 'active';
  } else if (closedAt) {
    status = totalPnl > 0 ? 'closed_profit' : totalPnl < 0 ? 'closed_loss' : 'closed_breakeven';
  }

  return {
    opened_at: openedAt,
    closed_at: closedAt,
    direction: mainOpen ? toCampaignDirection(mainOpen.direction) : currentCampaign.direction,
    status,
    initial_main_size_usdt: mainOpen?.pre_position_size ?? currentCampaign.initial_main_size_usdt,
    initial_leverage: mainOpen?.leverage ?? currentCampaign.initial_leverage,
    final_realized_pnl: allHaveTradeRecord ? totalPnl : null,
    final_r_multiple: allHaveTradeRecord && totalPlannedMaxLoss > 0 ? totalPnl / totalPlannedMaxLoss : null,
  };
}

async function normalizeCampaignLegSequences(campaignId: string): Promise<void> {
  const { data, error } = await supabase
    .from('trade_journals' as never)
    .select('id, pre_simulated_time')
    .eq('campaign_id', campaignId)
    .order('pre_simulated_time', { ascending: true });
  if (error) throw new Error(`重排 leg 顺序失败：${error.message}`);
  const legs = (data ?? []) as Array<Pick<TradeJournal, 'id' | 'pre_simulated_time'>>;
  for (let index = 0; index < legs.length; index += 1) {
    const { error: updateErr } = await supabase
      .from('trade_journals' as never)
      .update({ leg_sequence: index + 1 } as never)
      .eq('id', legs[index].id);
    if (updateErr) throw new Error(`更新 leg_sequence 失败：${updateErr.message}`);
  }
}

async function recomputeCampaignDerivedFields(campaignId: string): Promise<TradeCampaign> {
  const { campaign, legs } = await getCampaignWithLegs(campaignId);
  const tradeRecordMap = getTradeRecordMapForUser(campaign.user_id);
  const patch = deriveCampaignPatchFromLegs(campaign, legs, tradeRecordMap);
  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .update(patch as never)
    .eq('id', campaignId)
    .select()
    .single();
  if (error && (isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error))) {
    const local = {
      ...campaign,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    upsertLocalCampaign(local);
    return local;
  }
  return wrap('重算战役元数据', error, toCampaign(data));
}

export interface CreateCampaignInput {
  symbol: string;
  direction: 'main_long' | 'main_short';
  title: string;
  opened_at: string;
  strategy_template?: StrategyTemplate;
  notes?: string | null;
}

export interface ListCampaignFilters {
  status?: CampaignStatus | 'all';
  symbol?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function createCampaign(input: CreateCampaignInput): Promise<TradeCampaign> {
  const userId = await getAuthenticatedUserId('创建战役');
  const event: CampaignEvent = {
    id: crypto.randomUUID(),
    timestamp: input.opened_at,
    event_type: 'campaign_opened',
    leg_role: null,
    journal_id: null,
    trade_record_id: null,
    pending_order_id: null,
    price: null,
    size_usdt: null,
    notes: input.notes ?? null,
    recorded_at: new Date().toISOString(),
  };
  const payload = {
    user_id: userId,
    symbol: input.symbol,
    direction: input.direction,
    strategy_template: input.strategy_template ?? 'main_dual_hedge_mirror_tp',
    title: input.title,
    opened_at: input.opened_at,
    notes: input.notes ?? null,
    actual_evolution: [event],
  };
  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .insert(payload as never)
    .select()
    .single();
  if (error && isMissingTradeCampaignsTableError(error)) {
    const local = buildLocalCampaignFromCreateInput(userId, input, event);
    upsertLocalCampaign(local);
    return local;
  }
  return wrap('创建战役', error, toCampaign(data));
}

export async function updateCampaign(
  id: string,
  patch: Partial<Pick<TradeCampaign, 'title' | 'status' | 'notes' | 'closed_at' | 'final_realized_pnl' | 'final_r_multiple' | 'peak_unrealized_pnl' | 'peak_drawdown'>>,
): Promise<TradeCampaign> {
  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .update(patch as never)
    .eq('id', id)
    .select()
    .single();
  if (error && (isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error))) {
    const userId = await getAuthenticatedUserId('更新战役');
    const local = findLocalCampaign(userId, id);
    if (!local) return wrap('更新战役', error, toCampaign(data));
    const updated = { ...local, ...patch, updated_at: new Date().toISOString() };
    upsertLocalCampaign(updated);
    return updated;
  }
  return wrap('更新战役', error, toCampaign(data));
}

export async function closeCampaign(
  id: string,
  finalState: {
    status: Extract<CampaignStatus, 'closed_profit' | 'closed_loss' | 'closed_breakeven' | 'abandoned'>;
    final_realized_pnl: number | null;
    final_r_multiple: number | null;
    closed_at: string;
    peak_unrealized_pnl?: number | null;
    peak_drawdown?: number | null;
    notes?: string | null;
  },
): Promise<TradeCampaign> {
  return updateCampaign(id, finalState);
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase
    .from('trade_campaigns' as never)
    .delete()
    .eq('id', id);
  if (error) {
    if (isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error)) {
      const userId = await getAuthenticatedUserId('删除战役');
      removeLocalCampaign(userId, id);
      return;
    }
    throw new Error(`删除战役失败：${error.message}`);
  }
  const userId = await getAuthenticatedUserId('删除战役');
  removeLocalCampaign(userId, id);
}

export async function listActiveCampaigns(userId: string, symbol?: string): Promise<TradeCampaign[]> {
  let q = supabase
    .from('trade_campaigns' as never)
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active');
  if (symbol) q = q.eq('symbol', symbol);
  const { data, error } = await q.order('opened_at', { ascending: false });
  const local = applyCampaignFilters(readLocalCampaigns(userId), { status: 'active', symbol });
  if (error) {
    if (isMissingTradeCampaignsTableError(error)) return local;
    return wrap('加载进行中的战役', error, (data ?? []).map(toCampaign));
  }
  return mergeCampaigns((data ?? []).map(toCampaign), local);
}

export async function listAllCampaigns(
  userId: string,
  filters?: ListCampaignFilters,
): Promise<TradeCampaign[]> {
  let q = supabase.from('trade_campaigns' as never).select('*').eq('user_id', userId);
  if (filters?.status && filters.status !== 'all') q = q.eq('status', filters.status);
  if (filters?.symbol) q = q.eq('symbol', filters.symbol);
  if (filters?.dateFrom) q = q.gte('opened_at', filters.dateFrom);
  if (filters?.dateTo) q = q.lte('opened_at', filters.dateTo);
  const { data, error } = await q.order('opened_at', { ascending: false });
  const local = applyCampaignFilters(readLocalCampaigns(userId), filters);
  if (error) {
    if (isMissingTradeCampaignsTableError(error)) return local;
    return wrap('加载战役列表', error, (data ?? []).map(toCampaign));
  }
  return mergeCampaigns((data ?? []).map(toCampaign), local);
}

export async function listVisibleCampaigns(
  userId: string,
  filters?: ListCampaignFilters,
): Promise<TradeCampaign[]> {
  let q = supabase.from('trade_campaigns' as never).select('*');
  if (filters?.status && filters.status !== 'all') q = q.eq('status', filters.status);
  if (filters?.symbol) q = q.eq('symbol', filters.symbol);
  if (filters?.dateFrom) q = q.gte('opened_at', filters.dateFrom);
  if (filters?.dateTo) q = q.lte('opened_at', filters.dateTo);
  const { data, error } = await q.order('opened_at', { ascending: false });
  const local = applyCampaignFilters(readLocalCampaigns(userId), filters);
  if (error) {
    if (isMissingTradeCampaignsTableError(error)) return local;
    return wrap('加载可见战役列表', error, (data ?? []).map(toCampaign));
  }
  return mergeCampaigns((data ?? []).map(toCampaign), local);
}

export async function getCampaignWithLegs(
  campaignId: string,
): Promise<{ campaign: TradeCampaign; legs: TradeJournal[] }> {
  const { data: campaign, error: cErr } = await supabase
    .from('trade_campaigns' as never)
    .select('*')
    .eq('id', campaignId)
    .single();
  let resolvedCampaign: TradeCampaign | null = null;
  if (cErr) {
    if (isMissingTradeCampaignsTableError(cErr) || isCampaignNotFoundError(cErr)) {
      const userId = await getAuthenticatedUserId('加载战役');
      resolvedCampaign = findLocalCampaign(userId, campaignId);
    }
    if (!resolvedCampaign) throw new Error(`加载战役失败：${cErr.message}`);
  } else {
    resolvedCampaign = toCampaign(campaign);
  }
  if (!resolvedCampaign) throw new Error('加载战役失败：返回数据为空');

  const { data: legs, error: lErr } = await supabase
    .from('trade_journals' as never)
    .select('*')
    .eq('campaign_id', campaignId)
    .order('leg_sequence', { ascending: true });
  if (lErr) {
    const syntheticLegs = resolvedCampaign ? synthesizeCampaignLegsFromEvents(resolvedCampaign) : [];
    if (syntheticLegs.length > 0 || isMissingTradeJournalsFeatureError(lErr)) {
      return { campaign: resolvedCampaign, legs: syntheticLegs };
    }
    throw new Error(`加载战役 legs 失败：${lErr.message}`);
  }
  const dbLegs = (legs ?? []) as unknown as TradeJournal[];
  const syntheticLegs = dbLegs.length > 0 || !resolvedCampaign
    ? []
    : synthesizeCampaignLegsFromEvents(resolvedCampaign);
  return {
    campaign: resolvedCampaign,
    legs: dbLegs.length > 0 ? dbLegs : syntheticLegs,
  };
}

export async function getCampaignFullData(
  campaignId: string,
): Promise<{
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  pendingOrders: PendingOrder[];
}> {
  const { campaign, legs } = await getCampaignWithLegs(campaignId);
  const userId = campaign.user_id;
  const tradeHistory = readUserScopedStorage<TradeRecord[]>(userId, 'trade_history', []);
  const ordersMap = readUserScopedStorage<Record<string, PendingOrder[]>>(userId, 'orders_map', {});
  const legRecordIds = new Set(legs.map(leg => leg.trade_record_id).filter(Boolean));
  const openedAtMs = new Date(campaign.opened_at).getTime();
  const closedAtMs = campaign.closed_at ? new Date(campaign.closed_at).getTime() : Number.POSITIVE_INFINITY;

  const tradeRecords = tradeHistory.filter(record =>
    legRecordIds.has(record.id) ||
    (
      record.symbol === campaign.symbol &&
      (
        (record.openTime >= openedAtMs && record.openTime <= closedAtMs) ||
        (record.closeTime >= openedAtMs && record.closeTime <= closedAtMs)
      )
    ),
  );
  const pendingOrders = Object.entries(ordersMap)
    .flatMap(([symbol, orders]) => symbol === campaign.symbol ? orders : [])
    .filter(order => order.status === 'NEW' || order.status === 'PENDING' || order.status === 'ACTIVE');

  return {
    campaign,
    legs: [...legs].sort((a, b) => (a.leg_sequence ?? 9999) - (b.leg_sequence ?? 9999)),
    tradeRecords,
    pendingOrders,
  };
}

export async function appendCampaignEvent(
  campaignId: string,
  event: Omit<CampaignEvent, 'id' | 'recorded_at'>,
): Promise<void> {
  const { data: current, error: currentErr } = await supabase
    .from('trade_campaigns' as never)
    .select('actual_evolution')
    .eq('id', campaignId)
    .single();
  if (currentErr) {
    if (isMissingTradeCampaignsTableError(currentErr) || isCampaignNotFoundError(currentErr)) {
      const userId = await getAuthenticatedUserId('追加战役事件');
      const local = findLocalCampaign(userId, campaignId);
      if (!local) throw new Error(`读取战役事件流失败：${currentErr.message}`);
      upsertLocalCampaign({
        ...local,
        actual_evolution: [
          ...(local.actual_evolution ?? []),
          {
            ...event,
            id: crypto.randomUUID(),
            recorded_at: new Date().toISOString(),
          },
        ],
        updated_at: new Date().toISOString(),
      });
      return;
    }
    throw new Error(`读取战役事件流失败：${currentErr.message}`);
  }
  const existingRaw = (current as { actual_evolution?: unknown[] } | null)?.actual_evolution ?? [];
  const existing = Array.isArray(existingRaw) ? existingRaw.map(toCampaignEvent) : [];
  const next: CampaignEvent[] = [
    ...existing,
    {
      ...event,
      id: crypto.randomUUID(),
      recorded_at: new Date().toISOString(),
    },
  ];
  const { error } = await supabase
    .from('trade_campaigns' as never)
    .update({ actual_evolution: next } as never)
    .eq('id', campaignId);
  if (error) {
    if (isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error)) {
      const userId = await getAuthenticatedUserId('追加战役事件');
      const local = findLocalCampaign(userId, campaignId);
      if (local) {
        upsertLocalCampaign({ ...local, actual_evolution: next, updated_at: new Date().toISOString() });
        return;
      }
    }
    throw new Error(`追加战役事件失败：${error.message}`);
  }
}

export async function attachJournalToCampaign(
  journalId: string,
  campaignId: string,
  legRole: LegRole,
  legSequence?: number | null,
): Promise<void> {
  const { campaign } = await getCampaignWithLegs(campaignId);
  if (isHistoricalCampaign(campaign)) {
    throw new Error('实时订单不能加入历史归类战役，请新建实时战役或选择实时战役。');
  }

  const { data: journal, error: jErr } = await supabase
    .from('trade_journals' as never)
    .select('*')
    .eq('id', journalId)
    .single();
  if (jErr) throw new Error(`读取日记失败：${jErr.message}`);

  let nextSequence = legSequence ?? null;
  if (nextSequence == null) {
    const { data: existingLegs, error: seqErr } = await supabase
      .from('trade_journals' as never)
      .select('leg_sequence')
      .eq('campaign_id', campaignId)
      .order('leg_sequence', { ascending: false })
      .limit(1);
    if (seqErr) throw new Error(`读取战役顺序失败：${seqErr.message}`);
    nextSequence = (((existingLegs ?? [])[0] as { leg_sequence?: number } | undefined)?.leg_sequence ?? 0) + 1;
  }

  const patch = {
    campaign_id: campaignId,
    leg_role: legRole,
    leg_sequence: nextSequence,
  };
  const { error: updateErr } = await supabase
    .from('trade_journals' as never)
    .update(patch as never)
    .eq('id', journalId);
  if (updateErr) throw new Error(`关联战役失败：${updateErr.message}`);

  await appendCampaignEvent(campaignId, {
    timestamp: (journal as TradeJournal).pre_simulated_time,
    event_type: inferCampaignEventType(legRole),
    leg_role: legRole,
    journal_id: journalId,
    trade_record_id: (journal as TradeJournal).trade_record_id,
    pending_order_id: null,
    price: (journal as TradeJournal).pre_entry_price,
    size_usdt: (journal as TradeJournal).pre_position_size,
    notes: null,
  });

  if (legRole === 'main_open') {
    const j = journal as TradeJournal;
    const { error: campaignErr } = await supabase
      .from('trade_campaigns' as never)
      .update({
        initial_main_size_usdt: j.pre_position_size,
        initial_leverage: j.leverage,
      } as never)
      .eq('id', campaignId);
    if (campaignErr) throw new Error(`更新战役主仓信息失败：${campaignErr.message}`);
  }
}

export async function listUnclassifiedJournals(
  userId: string,
  filters: {
    symbol?: string;
    dateFrom?: string;
    dateTo?: string;
    includeClassified?: boolean;
  } = {},
): Promise<TradeJournal[]> {
  let query = supabase
    .from('trade_journals' as never)
    .select('*')
    .eq('user_id', userId);

  if (filters.symbol) query = query.eq('symbol', filters.symbol);
  if (filters.dateFrom) query = query.gte('pre_simulated_time', filters.dateFrom);
  if (filters.dateTo) query = query.lte('pre_simulated_time', filters.dateTo);
  if (!filters.includeClassified) query = query.is('campaign_id', null);

  const { data, error } = await query.order('pre_simulated_time', { ascending: false });
  if (error && isMissingTradeJournalsFeatureError(error)) return [];
  return wrap('加载待归类 journals', error, (data ?? []) as unknown as TradeJournal[]);
}

export interface ListUnclassifiedItemsFilters {
  symbol?: string;
  dateFrom?: string;
  dateTo?: string;
  includeClassified?: boolean;
}

export interface BackfillJournalOptions {
  campaignId?: string | null;
  legRole?: LegRole | null;
  legSequence?: number | null;
  attachNote?: string | null;
}

export interface BackfillAssignmentInput {
  recordId: string;
  legRole: LegRole;
  legSequence?: number | null;
  attachNote?: string | null;
}

function isTradeRecordClassifiable(record: TradeRecord): boolean {
  return record.action === 'CLOSE' || record.action === 'LIQUIDATION';
}

function matchesTradeRecordFilters(record: TradeRecord, filters: Omit<ListUnclassifiedItemsFilters, 'includeClassified'>): boolean {
  if (filters.symbol && record.symbol !== filters.symbol) return false;
  const timeMs = tradeRecordTimeMs(record);
  if (filters.dateFrom && timeMs < new Date(`${filters.dateFrom}T00:00:00`).getTime()) return false;
  if (filters.dateTo && timeMs > new Date(`${filters.dateTo}T23:59:59`).getTime()) return false;
  return true;
}

export async function listOrphanTradeRecords(
  userId: string,
  filters: Omit<ListUnclassifiedItemsFilters, 'includeClassified'> = {},
): Promise<TradeRecord[]> {
  const tradeHistory = readUserScopedStorage<TradeRecord[]>(userId, 'trade_history', [])
    .filter(isTradeRecordClassifiable);
  const { data, error } = await supabase
    .from('trade_journals' as never)
    .select('trade_record_id')
    .eq('user_id', userId)
    .not('trade_record_id', 'is', null);
  if (error && isMissingTradeJournalsFeatureError(error)) {
    return tradeHistory
      .filter(record => matchesTradeRecordFilters(record, filters))
      .sort((a, b) => tradeRecordTimeMs(b) - tradeRecordTimeMs(a));
  }
  const linked = wrap(
    '加载已关联 trade_record',
    error,
    (data ?? []) as Array<{ trade_record_id: string | null }>,
  );
  const linkedIds = new Set(linked.map(row => row.trade_record_id).filter((value): value is string => Boolean(value)));
  return tradeHistory
    .filter(record => !linkedIds.has(record.id))
    .filter(record => matchesTradeRecordFilters(record, filters))
    .sort((a, b) => tradeRecordTimeMs(b) - tradeRecordTimeMs(a));
}

export async function backfillJournalFromRecord(
  record: TradeRecord,
  options: BackfillJournalOptions = {},
): Promise<TradeJournal> {
  if (!isTradeRecordClassifiable(record)) {
    throw new Error('仅已成交/已平仓的 TradeRecord 可以回填为 journal');
  }

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('回填 journal 失败：用户未登录');

  const existing = await listJournalsByTradeRecordId(userId, record.id);
  if (existing.length > 0) {
    throw new Error('该 TradeRecord 已存在对应 journal，无需重复回填');
  }

  const payload = {
    user_id: userId,
    trade_record_id: record.id,
    campaign_id: options.campaignId ?? null,
    leg_role: options.legRole ?? null,
    leg_sequence: options.legSequence ?? null,
    symbol: record.symbol,
    direction: tradeRecordDirection(record),
    leverage: record.leverage,
    position_mode: 'isolated' as const,
    order_kind: 'main' as const,
    source: 'retroactive_from_record' as const,
    pre_simulated_time: new Date(tradeRecordTimeMs(record)).toISOString(),
    pre_real_time: new Date().toISOString(),
    pre_entry_price: record.entryPrice,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: '[历史回填] 该交易在快照系统启用前发生，原始决策信息已缺失',
    pre_mental_state: 3 as const,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: null,
    pre_position_size: tradeRecordPositionSize(record),
    pre_max_loss_usdt: null,
    post_outcome: record.pnl > 0 ? 'win' : record.pnl < 0 ? 'loss' : 'breakeven',
    post_realized_pnl: record.pnl,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    reason_was_rewritten: false,
  };

  const { data, error } = await supabase
    .from('trade_journals' as never)
    .insert(payload as never)
    .select()
    .single();
  return wrap('回填最小化 journal', error, data as unknown as TradeJournal);
}

export async function batchBackfillAndAttach(
  records: TradeRecord[],
  assignments: BackfillAssignmentInput[],
  campaignId: string,
): Promise<TradeJournal[]> {
  if (records.length === 0) return [];

  const assignmentMap = new Map(assignments.map(item => [item.recordId, item]));
  const created: TradeJournal[] = [];

  try {
    for (const record of records) {
      const assignment = assignmentMap.get(record.id);
      if (!assignment) {
        throw new Error(`缺少 TradeRecord ${record.id} 的归类角色`);
      }
      const journal = await backfillJournalFromRecord(record, {
        attachNote: assignment.attachNote ?? null,
      });
      created.push(journal);
    }

    await batchAttachToCampaign(
      campaignId,
      created.map((journal) => {
        const assignment = assignmentMap.get(journal.trade_record_id ?? '');
        if (!assignment) {
          throw new Error(`缺少 journal ${journal.id} 的归类角色`);
        }
        return {
          journalId: journal.id,
          legRole: assignment.legRole,
          legSequence: assignment.legSequence ?? null,
          attachNote: assignment.attachNote ?? RETRO_CLASSIFY_NOTE,
        };
      }),
    );

    return getJournalsByIds(created.map(journal => journal.id));
  } catch (error) {
    if (created.length > 0) {
      await supabase
        .from('trade_journals' as never)
        .delete()
        .in('id', created.map(journal => journal.id));
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function listUnclassifiedItems(
  userId: string,
  filters: ListUnclassifiedItemsFilters = {},
): Promise<{ journals: TradeJournal[]; orphanRecords: TradeRecord[] }> {
  const [journals, orphanRecords] = await Promise.all([
    listUnclassifiedJournals(userId, filters),
    listOrphanTradeRecords(userId, filters),
  ]);
  return { journals, orphanRecords };
}

export async function validateClassification(
  input: ClassificationValidationInput,
): Promise<ClassificationValidationResult> {
  const journalIds = [...new Set(input.legs.map(item => item.journalId))];
  const journals = await getJournalsByIds(journalIds);
  const journalMap = new Map(journals.map(journal => [journal.id, journal]));
  const errors: string[] = [];
  const warnings: string[] = [];

  const selected = input.legs
    .map(item => ({ ...item, journal: journalMap.get(item.journalId) ?? null }))
    .filter((item): item is { journalId: string; legRole: LegRole; journal: TradeJournal } => item.journal != null);

  const symbols = new Set(selected.map(item => item.journal.symbol));
  if (symbols.size > 1) errors.push('选中 journals 跨多个 symbol');

  const occupied = selected.filter(item => item.journal.campaign_id != null);
  if (occupied.length > 0) errors.push('存在已归属到战役的 journal，请先解除归属');

  if (input.strategyTemplate === 'main_dual_hedge_mirror_tp' && !selected.some(item => item.legRole === 'main_open')) {
    errors.push('main_dual_hedge_mirror_tp 模板必须包含 main_open 角色');
  }

  for (const item of selected) {
    const allowedKinds = LEG_ROLE_ORDER_KIND_COMPATIBILITY[item.legRole];
    if (item.journal.source !== 'retroactive_from_record' && !allowedKinds.includes(item.journal.order_kind)) {
      errors.push(`角色 ${item.legRole} 与 journal ${item.journal.id} 的 order_kind 不兼容`);
    }
  }

  let targetCampaign: TradeCampaign | null = null;
  let targetLegs: TradeJournal[] = [];
  if (input.targetCampaignId) {
    const details = await getCampaignWithLegs(input.targetCampaignId);
    targetCampaign = details.campaign;
    targetLegs = details.legs;
    if (!isHistoricalCampaign(targetCampaign)) {
      errors.push('历史归类只能加入历史战役；实时战役必须在开仓时归属，不能与回填数据混合');
    }

    const selectedMain = selected.find(item => item.legRole === 'main_open') ?? null;
    const existingMain = targetLegs.find(leg => leg.leg_role === 'main_open') ?? null;
    if (existingMain && selectedMain) {
      errors.push('目标战役已有 main_open，本次不能再次添加 main_open');
    }

    for (const item of selected) {
      if (new Date(item.journal.pre_simulated_time).getTime() < new Date(targetCampaign.opened_at).getTime()) {
        errors.push('leg 时间不能早于战役开始时间');
        break;
      }
    }

    if (selectedMain && targetCampaign.direction !== toCampaignDirection(selectedMain.journal.direction)) {
      errors.push('方向冲突');
    }
  }

  const combined = [
    ...targetLegs,
    ...selected.map(item => ({
      ...item.journal,
      leg_role: item.legRole,
    })),
  ].sort((a, b) => journalTimeMs(a) - journalTimeMs(b));

  const mainOpen = combined.find(leg => leg.leg_role === 'main_open') ?? null;
  if (mainOpen && combined[0]?.id !== mainOpen.id) {
    warnings.push('main_open 不是最早的 leg（时序异常）');
  }

  if (
    input.strategyTemplate === 'main_dual_hedge_mirror_tp' &&
    (!combined.some(leg => leg.leg_role === 'hedge_initial_a') || !combined.some(leg => leg.leg_role === 'hedge_initial_b'))
  ) {
    warnings.push('main_dual_hedge_mirror_tp 模板缺少 hedge_initial_a 或 hedge_initial_b');
  }

  if (combined.length > 1) {
    const spanMs = journalTimeMs(combined[combined.length - 1]) - journalTimeMs(combined[0]);
    if (spanMs > 7 * 24 * 60 * 60 * 1000) {
      warnings.push('选中 legs 时间跨度 > 7 天（异常长战役）');
    }
  }

  const firstMirrorTp = combined.find(leg => leg.leg_role === 'mirror_tp') ?? null;
  if (firstMirrorTp) {
    const mirrorTime = journalTimeMs(firstMirrorTp);
    if (combined.some(leg => leg.leg_role === 'hedge_rolling' && journalTimeMs(leg) < mirrorTime)) {
      warnings.push('存在 hedge_rolling 早于第一个 mirror_tp_triggered 的语义异常');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export async function batchAttachToCampaign(
  campaignId: string,
  assignments: ClassificationAssignmentInput[],
): Promise<void> {
  if (assignments.length === 0) return;

  const validation = await validateClassification({
    legs: assignments.map(item => ({ journalId: item.journalId, legRole: item.legRole })),
    strategyTemplate: (await getCampaignWithLegs(campaignId)).campaign.strategy_template,
    targetCampaignId: campaignId,
  });
  if (!validation.ok) {
    throw new Error(validation.errors.join('；'));
  }

  const { campaign, legs: existingLegs } = await getCampaignWithLegs(campaignId);
  const originalCampaignPatch = campaignSnapshotPatch(campaign);
  const journals = await getJournalsByIds(assignments.map(item => item.journalId));
  const journalMap = new Map(journals.map(journal => [journal.id, journal]));
  const originalJournals = journals.map(journal => ({
    id: journal.id,
    campaign_id: journal.campaign_id,
    leg_role: journal.leg_role,
    leg_sequence: journal.leg_sequence,
  }));

  const combinedSequence = [...existingLegs, ...journals]
    .sort((a, b) => journalTimeMs(a) - journalTimeMs(b))
    .map(leg => leg.id);
  const sequenceMap = new Map(combinedSequence.map((journalId, index) => [journalId, index + 1]));

  const nextEvents: CampaignEvent[] = [...campaign.actual_evolution];
  const newLegs: TradeJournal[] = [];

  try {
    for (const assignment of assignments) {
      const journal = journalMap.get(assignment.journalId);
      if (!journal) continue;
      const nextSequence = assignment.legSequence ?? sequenceMap.get(journal.id) ?? null;
      const patch = {
        campaign_id: campaignId,
        leg_role: assignment.legRole,
        leg_sequence: nextSequence,
      };
      const { error: updateErr } = await supabase
        .from('trade_journals' as never)
        .update(patch as never)
        .eq('id', journal.id);
      if (updateErr) throw new Error(`关联战役失败：${updateErr.message}`);

      newLegs.push({ ...journal, ...patch });
      nextEvents.push({
        id: crypto.randomUUID(),
        timestamp: journal.pre_simulated_time,
        event_type: 'historical_leg_attached',
        leg_role: assignment.legRole,
        journal_id: journal.id,
        trade_record_id: journal.trade_record_id,
        pending_order_id: null,
        price: journal.pre_entry_price,
        size_usdt: journal.pre_position_size,
        notes: assignment.attachNote ? `${assignment.attachNote} · ${RETRO_CLASSIFY_NOTE}` : RETRO_CLASSIFY_NOTE,
        recorded_at: new Date().toISOString(),
      });
    }

    const tradeRecordMap = getTradeRecordMapForUser(campaign.user_id);
    const patch = {
      ...deriveCampaignPatchFromLegs(campaign, [...existingLegs, ...newLegs], tradeRecordMap),
      actual_evolution: nextEvents,
    };
    const { error: campaignErr } = await supabase
      .from('trade_campaigns' as never)
      .update(patch as never)
      .eq('id', campaignId);
    if (campaignErr) throw new Error(`更新战役事件流失败：${campaignErr.message}`);

    await normalizeCampaignLegSequences(campaignId);
    await recomputeCampaignDerivedFields(campaignId);
  } catch (error) {
    for (const snapshot of originalJournals) {
      await supabase
        .from('trade_journals' as never)
        .update({
          campaign_id: snapshot.campaign_id,
          leg_role: snapshot.leg_role,
          leg_sequence: snapshot.leg_sequence,
        } as never)
        .eq('id', snapshot.id);
    }
    await supabase
      .from('trade_campaigns' as never)
      .update(originalCampaignPatch as never)
      .eq('id', campaignId);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function createCampaignFromJournals(input: {
  title: string;
  strategyTemplate: StrategyTemplate;
  legs: Array<{ journalId: string; legRole: LegRole; legSequence: number }>;
  notes?: string;
}): Promise<TradeCampaign> {
  const validation = await validateClassification({
    legs: input.legs.map(leg => ({ journalId: leg.journalId, legRole: leg.legRole })),
    strategyTemplate: input.strategyTemplate,
  });
  if (!validation.ok) {
    throw new Error(validation.errors.join('；'));
  }

  const journals = await getJournalsByIds(input.legs.map(leg => leg.journalId));
  const journalMap = new Map(journals.map(journal => [journal.id, journal]));
  const orderedLegs = input.legs
    .map(leg => ({
      ...leg,
      journal: journalMap.get(leg.journalId) ?? null,
    }))
    .filter((item): item is typeof item & { journal: TradeJournal } => item.journal != null)
    .sort((a, b) => a.legSequence - b.legSequence);

  const symbolSet = new Set(orderedLegs.map(item => item.journal.symbol));
  if (symbolSet.size !== 1) throw new Error('创建战役失败：所选 journals 必须属于同一标的');

  const mainOpen = orderedLegs.find(item => item.legRole === 'main_open')?.journal ?? null;
  if (!mainOpen) {
    throw new Error('创建战役失败：必须指定一个 main_open');
  }

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error('创建战役失败：用户未登录');

  const tradeRecordMap = getTradeRecordMapForUser(userId);
  const draftLegs = orderedLegs.map(item => ({
    ...item.journal,
    leg_role: item.legRole,
    leg_sequence: item.legSequence,
  }));
  const draftCampaign = {
    id: crypto.randomUUID(),
    user_id: userId,
    symbol: mainOpen.symbol,
    direction: toCampaignDirection(mainOpen.direction),
    status: 'planned' as CampaignStatus,
    strategy_template: input.strategyTemplate,
    title: input.title,
    opened_at: orderedLegs[0]?.journal.pre_simulated_time ?? mainOpen.pre_simulated_time,
    closed_at: null,
    initial_main_size_usdt: mainOpen.pre_position_size,
    initial_leverage: mainOpen.leverage,
    final_realized_pnl: null,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    notes: input.notes?.trim() || null,
    actual_evolution: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } satisfies TradeCampaign;
  const derivedPatch = deriveCampaignPatchFromLegs(draftCampaign, draftLegs, tradeRecordMap);
  const payload = {
    user_id: userId,
    symbol: mainOpen.symbol,
    direction: derivedPatch.direction ?? toCampaignDirection(mainOpen.direction),
    strategy_template: input.strategyTemplate,
    title: input.title,
    opened_at: derivedPatch.opened_at ?? mainOpen.pre_simulated_time,
    closed_at: derivedPatch.closed_at ?? null,
    status: derivedPatch.status ?? 'active',
    initial_main_size_usdt: derivedPatch.initial_main_size_usdt ?? mainOpen.pre_position_size,
    initial_leverage: derivedPatch.initial_leverage ?? mainOpen.leverage,
    final_realized_pnl: derivedPatch.final_realized_pnl ?? null,
    final_r_multiple: derivedPatch.final_r_multiple ?? null,
    notes: input.notes?.trim() || null,
    actual_evolution: [{
      id: crypto.randomUUID(),
      timestamp: derivedPatch.opened_at ?? mainOpen.pre_simulated_time,
      event_type: 'historical_classification_created',
      leg_role: null,
      journal_id: null,
      trade_record_id: null,
      pending_order_id: null,
      price: null,
      size_usdt: null,
      notes: input.notes?.trim() || null,
      recorded_at: new Date().toISOString(),
    }],
  };

  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .insert(payload as never)
    .select()
    .single();
  const campaign = wrap('创建战役', error, toCampaign(data));

  try {
    await batchAttachToCampaign(
      campaign.id,
      input.legs.map(leg => ({
        journalId: leg.journalId,
        legRole: leg.legRole,
        legSequence: leg.legSequence,
        attachNote: RETRO_CLASSIFY_NOTE,
      })),
    );
    const { campaign: refreshed } = await getCampaignWithLegs(campaign.id);
    return refreshed;
  } catch (attachError) {
    await supabase
      .from('trade_campaigns' as never)
      .delete()
      .eq('id', campaign.id);
    throw attachError instanceof Error ? attachError : new Error(String(attachError));
  }
}

export async function createCampaignFromTradeRecords(input: {
  title: string;
  strategyTemplate: StrategyTemplate;
  records: Array<{ record: TradeRecord; legRole: LegRole; legSequence: number }>;
  notes?: string;
}): Promise<TradeCampaign> {
  if (input.records.length === 0) throw new Error('创建战役失败：请选择至少一条仓位历史记录');
  const ordered = [...input.records].sort((a, b) => a.legSequence - b.legSequence);
  const symbols = new Set(ordered.map(item => item.record.symbol));
  if (symbols.size !== 1) throw new Error('创建战役失败：所选仓位历史记录必须属于同一标的');
  const notClassifiable = ordered.find(item => !isTradeRecordClassifiable(item.record));
  if (notClassifiable) throw new Error('创建战役失败：只能选择已平仓或爆仓的仓位历史记录');

  const userId = await getAuthenticatedUserId('创建战役');
  const now = new Date().toISOString();
  const mainItem = ordered.find(item => item.legRole === 'main_open') ?? ordered[0];
  const openedMs = Math.min(...ordered.map(item => tradeRecordTimeMs(item.record)));
  const closeTimes = ordered.map(item => item.record.closeTime || tradeRecordTimeMs(item.record)).filter(time => time > 0);
  const closedMs = closeTimes.length === ordered.length ? Math.max(...closeTimes) : null;
  const totalPnl = ordered.reduce((sum, item) => sum + (item.record.pnl || 0), 0);
  const closedStatus: CampaignStatus = totalPnl > 0 ? 'closed_profit' : totalPnl < 0 ? 'closed_loss' : 'closed_breakeven';
  const openedAt = toIso(openedMs) ?? now;
  const closedAt = toIso(closedMs);
  const notes = input.notes?.trim() || null;
  const events: CampaignEvent[] = [
    {
      id: crypto.randomUUID(),
      timestamp: openedAt,
      event_type: 'historical_classification_created',
      leg_role: null,
      journal_id: null,
      trade_record_id: null,
      pending_order_id: null,
      price: null,
      size_usdt: null,
      notes,
      recorded_at: now,
    },
    ...ordered.map(({ record, legRole }) => ({
      id: crypto.randomUUID(),
      timestamp: toIso(tradeRecordTimeMs(record)) ?? openedAt,
      event_type: 'historical_leg_attached' as const,
      leg_role: legRole,
      journal_id: null,
      trade_record_id: record.id,
      pending_order_id: null,
      price: record.entryPrice,
      size_usdt: tradeRecordPositionSize(record),
      notes: 'classified retroactively · 仓位历史记录',
      recorded_at: now,
    })),
  ];
  const campaign: TradeCampaign = {
    id: crypto.randomUUID(),
    user_id: userId,
    symbol: mainItem.record.symbol,
    direction: mainItem.record.side === 'SHORT' ? 'main_short' : 'main_long',
    status: closedAt ? closedStatus : 'active',
    strategy_template: input.strategyTemplate,
    title: input.title.trim(),
    opened_at: openedAt,
    closed_at: closedAt,
    initial_main_size_usdt: tradeRecordPositionSize(mainItem.record),
    initial_leverage: mainItem.record.leverage,
    final_realized_pnl: totalPnl,
    final_r_multiple: null,
    peak_unrealized_pnl: null,
    peak_drawdown: null,
    notes,
    actual_evolution: events,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .insert(campaign as never)
    .select()
    .single();
  if (error) {
    if (isMissingTradeCampaignsTableError(error)) {
      upsertLocalCampaign(campaign);
      return campaign;
    }
    throw new Error(`创建战役失败：${error.message}`);
  }
  return toCampaign(data);
}

export async function detachJournalFromCampaign(journalId: string): Promise<void> {
  const journal = await getJournalById(journalId);
  if (!journal?.campaign_id) return;

  const { campaign } = await getCampaignWithLegs(journal.campaign_id);
  const originalCampaignPatch = campaignSnapshotPatch(campaign);
  const originalJournalPatch = {
    campaign_id: journal.campaign_id,
    leg_role: journal.leg_role,
    leg_sequence: journal.leg_sequence,
  };

  try {
    const { error: journalErr } = await supabase
      .from('trade_journals' as never)
      .update({
        campaign_id: null,
        leg_role: null,
        leg_sequence: null,
      } as never)
      .eq('id', journal.id);
    if (journalErr) throw new Error(`解除归属失败：${journalErr.message}`);

    const nextEvents: CampaignEvent[] = [
      ...campaign.actual_evolution,
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        event_type: 'note',
        leg_role: journal.leg_role,
        journal_id: journal.id,
        trade_record_id: journal.trade_record_id,
        pending_order_id: null,
        price: journal.pre_entry_price,
        size_usdt: journal.pre_position_size,
        notes: `leg ${journal.leg_role ?? 'unknown'} 已被解除归属（journal ${journal.id}）`,
        recorded_at: new Date().toISOString(),
      },
    ];
    const { error: campaignErr } = await supabase
      .from('trade_campaigns' as never)
      .update({ actual_evolution: nextEvents } as never)
      .eq('id', campaign.id);
    if (campaignErr) throw new Error(`写入解除归属记录失败：${campaignErr.message}`);

    await normalizeCampaignLegSequences(campaign.id);
    await recomputeCampaignDerivedFields(campaign.id);
  } catch (error) {
    await supabase
      .from('trade_journals' as never)
      .update(originalJournalPatch as never)
      .eq('id', journal.id);
    await supabase
      .from('trade_campaigns' as never)
      .update(originalCampaignPatch as never)
      .eq('id', campaign.id);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export function suggestLegRoles(journals: TradeJournal[]): SuggestedLegRole[] {
  return suggestLegRolesHeuristic(journals);
}

// ============ Batch 18: Campaign Counterfactuals ============

export interface CreateCampaignCounterfactualInput {
  campaign_id: string;
  label: string;
  branch_kind: CampaignCounterfactualBranchKind;
  source_deduction_id?: string | null;
  params: CampaignCounterfactualParams;
  result: CampaignCounterfactualResult;
}

export async function createCounterfactual(
  input: CreateCampaignCounterfactualInput,
): Promise<CampaignCounterfactual> {
  const { userId } = await getCurrentUserAndCapital();
  const payload = {
    user_id: userId,
    campaign_id: input.campaign_id,
    label: input.label.slice(0, 20),
    branch_kind: input.branch_kind,
    source_deduction_id: input.source_deduction_id ?? null,
    params: input.params,
    result: input.result,
  };
  const { data, error } = await supabase
    .from('campaign_counterfactuals' as never)
    .insert(payload as never)
    .select()
    .single();
  return wrap('创建反事实战役分支', error, toCampaignCounterfactual(data));
}

export async function listCounterfactuals(campaignId: string): Promise<CampaignCounterfactual[]> {
  const { data, error } = await supabase
    .from('campaign_counterfactuals' as never)
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error && isMissingCounterfactualsTableError(error)) return [];
  return wrap('加载反事实战役分支', error, (data ?? []).map(toCampaignCounterfactual));
}

export async function followAccount(followeeId: string): Promise<AccountFollow> {
  const followerId = await getAuthenticatedUserId('关注账户');
  if (followerId === followeeId) throw new Error('不能关注自己');
  const payload = { follower_id: followerId, followee_id: followeeId };
  const { data, error } = await supabase
    .from('account_follows' as never)
    .upsert(payload as never, { onConflict: 'follower_id,followee_id' })
    .select()
    .single();
  return wrap('关注账户', error, data as unknown as AccountFollow);
}

export async function unfollowAccount(followeeId: string): Promise<void> {
  const followerId = await getAuthenticatedUserId('取消关注');
  const { error } = await supabase
    .from('account_follows' as never)
    .delete()
    .eq('follower_id', followerId)
    .eq('followee_id', followeeId);
  if (error && !isMissingSocialFeatureError(error)) throw new Error(`取消关注失败：${error.message}`);
}

export async function listMyFollows(): Promise<AccountFollow[]> {
  const userId = await getAuthenticatedUserId('加载关注列表');
  const { data, error } = await supabase
    .from('account_follows' as never)
    .select('*')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false });
  if (error && isMissingSocialFeatureError(error)) return [];
  return wrap('加载关注列表', error, data as unknown as AccountFollow[]);
}

export async function hasMutualFollow(userId: string, otherUserId: string): Promise<boolean> {
  if (userId === otherUserId) return true;
  const [outbound, inbound] = await Promise.all([
    supabase
      .from('account_follows' as never)
      .select('id')
      .eq('follower_id', userId)
      .eq('followee_id', otherUserId)
      .maybeSingle(),
    supabase
      .from('account_follows' as never)
      .select('id')
      .eq('follower_id', otherUserId)
      .eq('followee_id', userId)
      .maybeSingle(),
  ]);
  if (
    (outbound.error && isMissingSocialFeatureError(outbound.error)) ||
    (inbound.error && isMissingSocialFeatureError(inbound.error))
  ) {
    return false;
  }
  if (outbound.error && outbound.error.code !== 'PGRST116') throw new Error(`检查互关失败：${outbound.error.message}`);
  if (inbound.error && inbound.error.code !== 'PGRST116') throw new Error(`检查互关失败：${inbound.error.message}`);
  return !!outbound.data && !!inbound.data;
}

export async function listCampaignComments(campaignId: string): Promise<CampaignComment[]> {
  const { data, error } = await supabase
    .from('trade_campaign_comments' as never)
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error && isMissingSocialFeatureError(error)) return [];
  return wrap('加载战役留言', error, data as unknown as CampaignComment[]);
}

export async function createCampaignComment(input: {
  campaignId: string;
  body: string;
  believabilityScore?: number | null;
}): Promise<CampaignComment> {
  const userId = await getAuthenticatedUserId('发表战役留言');
  const payload = {
    campaign_id: input.campaignId,
    user_id: userId,
    body: input.body.trim(),
    believability_score: input.believabilityScore ?? null,
  };
  if (!payload.body) throw new Error('留言不能为空');
  const { data, error } = await supabase
    .from('trade_campaign_comments' as never)
    .insert(payload as never)
    .select()
    .single();
  return wrap('发表战役留言', error, data as unknown as CampaignComment);
}

export async function deleteCounterfactual(id: string): Promise<void> {
  const { error } = await supabase
    .from('campaign_counterfactuals' as never)
    .delete()
    .eq('id', id);
  if (error) throw new Error(`删除反事实分支失败：${error.message}`);
}

export async function runAndPersistPureSop(
  campaignId: string,
  klines: KlineData[],
): Promise<CampaignCounterfactual> {
  const { campaign, legs } = await getCampaignFullData(campaignId);
  if (campaign.strategy_template === 'custom') {
    throw new Error('自定义模板暂不支持反事实模拟');
  }
  const params = buildPureSopParams(campaign, legs);
  if (!params) throw new Error('无法构建 Pure SOP 参数：缺少主仓战役数据');
  const result = simulateCampaign(
    params,
    klines,
    campaign.strategy_template as 'main_dual_hedge_mirror_tp' | 'main_only',
  );
  return createCounterfactual({
    campaign_id: campaignId,
    label: 'Pure SOP',
    branch_kind: 'pure_sop',
    params,
    result,
  });
}

export async function runAndPersistCustomCounterfactual(
  campaignId: string,
  label: string,
  params: CampaignCounterfactualParams,
  klines: KlineData[],
): Promise<CampaignCounterfactual> {
  const { campaign } = await getCampaignFullData(campaignId);
  if (campaign.strategy_template === 'custom') {
    throw new Error('自定义模板暂不支持反事实模拟');
  }
  const result = simulateCampaign(
    params,
    klines,
    campaign.strategy_template as 'main_dual_hedge_mirror_tp' | 'main_only',
  );
  return createCounterfactual({
    campaign_id: campaignId,
    label,
    branch_kind: 'custom_what_if',
    params,
    result,
  });
}

export async function runAndPersistDeviationCosts(
  campaignId: string,
  klines: KlineData[],
): Promise<DeviationCost[]> {
  const { campaign, legs, tradeRecords } = await getCampaignFullData(campaignId);
  if (campaign.strategy_template === 'custom') return [];
  const { initialCapital } = await getCurrentUserAndCapital();
  const actualParams = buildActualSimulationParams(campaign, legs);
  if (!actualParams) return [];
  const actualResult = simulateCampaign(
    actualParams,
    klines,
    campaign.strategy_template as 'main_dual_hedge_mirror_tp' | 'main_only',
  );
  const costs = computeDeviationCosts(
    {
      campaign,
      legs,
      tradeRecords,
      account_size_usdt: initialCapital,
    },
    {
      final_realized_pnl: actualResult.final_realized_pnl,
      account_size_usdt: initialCapital,
    },
    klines,
  );

  for (const cost of costs) {
    if (!cost.source_deduction_id) continue;
    const existing = await supabase
      .from('campaign_counterfactuals' as never)
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('branch_kind', 'fix_one_deviation')
      .eq('source_deduction_id', cost.source_deduction_id)
      .limit(1);
    if ((existing.data ?? []).length > 0) continue;
    const fixBranch = buildDeviationFixParams(campaign, legs, tradeRecords, cost.source_deduction_id);
    if (!fixBranch) continue;
    const fixResult = simulateCampaign(
      fixBranch.params,
      klines,
      campaign.strategy_template as 'main_dual_hedge_mirror_tp' | 'main_only',
    );
    await createCounterfactual({
      campaign_id: campaignId,
      label: fixBranch.fix_description.slice(0, 20),
      branch_kind: 'fix_one_deviation',
      source_deduction_id: cost.source_deduction_id,
      params: fixBranch.params,
      result: fixResult,
    });
  }

  return costs;
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
  const { data, error } = await supabase
    .from("error_tag_patterns" as never)
    .insert(input as never)
    .select()
    .single();
  return wrap("创建错误模式", error, data as unknown as ErrorTagPattern);
}

/**
 * Returns true if the pattern has any tag assignment. Used to decide whether
 * structural fields (name, category, parent) are locked.
 */
export async function patternHasAnyAssignment(patternId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("journal_tag_assignments" as never)
    .select("id", { count: "exact", head: true })
    .eq("pattern_id", patternId);
  if (error) {
    console.error("[journalApi] 检查模式使用情况失败:", error);
    throw new Error(`检查模式使用情况失败：${error.message}`);
  }
  return (count ?? 0) > 0;
}

export async function updatePattern(
  id: string,
  patch: Partial<Pick<ErrorTagPattern, "pattern_name" | "operational_definition" | "parent_id" | "is_archived">>,
): Promise<ErrorTagPattern> {
  // Lock identity once the pattern has been tagged to any journal.
  // Rationale: renaming an in-use pattern silently rewrites historical statistics
  // (frequency / pattern clusters / rule attribution). The operational definition
  // can still be clarified, but the name and structural placement are frozen.
  const wantsIdentityChange =
    patch.pattern_name !== undefined || patch.parent_id !== undefined;
  if (wantsIdentityChange) {
    const used = await patternHasAnyAssignment(id);
    if (used) {
      // Compare against current row to allow no-op patches.
      const { data: cur, error: gErr } = await supabase
        .from("error_tag_patterns" as never)
        .select("pattern_name,parent_id")
        .eq("id", id)
        .single();
      if (gErr) throw new Error(`读取模式失败：${gErr.message}`);
      const row = cur as unknown as Pick<ErrorTagPattern, 'pattern_name' | 'parent_id'>;
      const nameChanging = patch.pattern_name !== undefined && patch.pattern_name !== row.pattern_name;
      const parentChanging = patch.parent_id !== undefined && (patch.parent_id ?? null) !== (row.parent_id ?? null);
      if (nameChanging || parentChanging) {
        throw new Error(
          "该模式已被打到一条或多条交易上，名称与父模式已冻结。若你认为定义需要修正，请编辑'可操作定义'，或归档后新建一个模式。",
        );
      }
    }
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
  | "source"
  | "reason_was_rewritten"
  | "created_at"
  | "updated_at"
>;

export async function updateJournalTradeRef(journalId: string, tradeRecordId: string): Promise<void> {
  const { error } = await supabase
    .from("trade_journals" as never)
    .update({ trade_record_id: tradeRecordId } as never)
    .eq("id", journalId);
  if (error) {
    console.error("[journalApi] 回填 trade_record_id 失败:", error);
    throw new Error(`回填交易记录ID失败：${error.message}`);
  }
}

/**
 * Stamp the real wall-clock close time. Idempotent: only writes if currently NULL,
 * so re-opening the review sheet later doesn't overwrite the original close moment.
 * Returns the new ISO string if a write happened, or null if already stamped.
 */
export async function stampJournalCloseRealTime(journalId: string): Promise<string | null> {
  const { data: cur, error: gErr } = await supabase
    .from("trade_journals" as never)
    .select("post_real_close_time")
    .eq("id", journalId)
    .single();
  if (gErr) {
    console.warn("[journalApi] 读取 post_real_close_time 失败:", gErr);
    return null;
  }
  const row = cur as unknown as { post_real_close_time: string | null } | null;
  if (row?.post_real_close_time) return null;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("trade_journals" as never)
    .update({ post_real_close_time: now } as never)
    .eq("id", journalId)
    .is("post_real_close_time", null);
  if (error) {
    console.warn("[journalApi] 写入 post_real_close_time 失败:", error);
    return null;
  }
  return now;
}

export async function createJournalPreSnapshot(input: CreateJournalPreInput): Promise<TradeJournal> {
  const payload = { ...input, pre_real_time: new Date().toISOString(), source: 'live' as const };
  const { data, error } = await insertTradeJournalWithSchemaFallback(payload as Record<string, unknown>);
  const journal = wrap("创建交易日记事前快照", error, data as unknown as TradeJournal);
  const painTags = input.pre_pain_tags ?? [];
  if (painTags.length > 0) {
    createPainLogEntries({
      userId: input.user_id,
      journalId: journal.id,
      symbol: input.symbol,
      marketTime: input.pre_simulated_time,
      tags: painTags,
      intensity: input.pre_mental_state,
    }).catch(err => console.warn('[journalApi] 痛苦日志写入失败:', err));
  }
  return journal;
}

export interface CreateNoTradeJournalInput {
  user_id: string;
  symbol: string;
  direction: Extract<TradeDirection, 'long' | 'short'>;
  pre_simulated_time: string;
  no_trade_would_be_entry_price: number | null;
  no_trade_reason?: string | null;
  order_kind?: TradeJournal['order_kind'];
  pre_planned_stop_loss?: TradeJournal['pre_planned_stop_loss'];
  pre_odds_structure?: TradeJournal['pre_odds_structure'];
  pre_odds_structure_source?: TradeJournal['pre_odds_structure_source'];
  pre_odds_structure_premortem?: TradeJournal['pre_odds_structure_premortem'];
  pre_odds_structure_breakdown_signals?: TradeJournal['pre_odds_structure_breakdown_signals'];
  pre_opportunity_cost_worth?: TradeJournal['pre_opportunity_cost_worth'];
  pre_cheap_opportunity?: TradeJournal['pre_cheap_opportunity'];
  pre_edge_source?: TradeJournal['pre_edge_source'];
  pre_market_regime?: TradeJournal['pre_market_regime'];
  pre_entry_stage?: TradeJournal['pre_entry_stage'];
  pre_stop_quality?: TradeJournal['pre_stop_quality'];
}

export async function createNoTradeJournal(
  input: CreateNoTradeJournalInput,
): Promise<TradeJournal> {
  const payload = {
    user_id: input.user_id,
    trade_record_id: null,
    campaign_id: null,
    leg_role: null,
    leg_sequence: null,
    source: 'live' as const,
    symbol: input.symbol,
    direction: input.direction,
    leverage: null,
    position_mode: null,
    order_kind: input.order_kind ?? 'main',
    pre_simulated_time: input.pre_simulated_time,
    pre_real_time: new Date().toISOString(),
    pre_entry_price: null,
    pre_planned_stop_loss: input.pre_planned_stop_loss ?? null,
    pre_planned_take_profit: null,
    pre_entry_reason: null,
    pre_mental_state: 3 as const,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: null,
    pre_position_size: null,
    pre_max_loss_usdt: null,
    pre_thesis_why_right: null,
    pre_premortem_failure_reason: null,
    pre_falsification_signal: null,
    pre_confidence_basis: null,
    pre_odds_structure: input.pre_odds_structure ?? null,
    pre_odds_structure_source: input.pre_odds_structure_source?.trim() || null,
    pre_odds_structure_premortem: input.pre_odds_structure_premortem?.trim() || null,
    pre_odds_structure_breakdown_signals: input.pre_odds_structure_breakdown_signals?.trim() || null,
    pre_opportunity_cost_worth: input.pre_opportunity_cost_worth ?? null,
    pre_cheap_opportunity: input.pre_cheap_opportunity ?? null,
    pre_edge_source: input.pre_edge_source ?? null,
    pre_market_regime: input.pre_market_regime ?? null,
    pre_entry_stage: input.pre_entry_stage ?? null,
    pre_stop_quality: input.pre_stop_quality ?? null,
    pre_chase_after_close: null,
    pre_account_equity_usdt: null,
    pre_mortem_text: null,
    pre_positive_expectancy: null,
    pre_invalidation_condition: null,
    pre_calibration_win_pct: null,
    pre_confidence_interval_low_pct: null,
    pre_confidence_interval_high_pct: null,
    pre_calibration_reference_class: null,
    pre_calibration_competence_basis: null,
    pre_calibration_update_signal: null,
    pre_dataset_split: null,
    pre_lollapalooza_score: null,
    pre_bankruptcy_estimate: null,
    pre_info_kline_facts: null,
    pre_info_macro_facts: null,
    pre_info_rule_advice: null,
    pre_info_intuition: null,
    pre_info_designer_view: null,
    pre_opponent_statement: null,
    pre_triggered_principle_ids: null,
    pre_triggered_rule_ids: null,
    pre_pain_tags: null,
    pre_cognitive_bias_tags: [],
    pre_executor_self: null,
    pre_designer_self: null,
    journal_kind: 'no_trade' as const,
    no_trade_reason: input.no_trade_reason?.trim() || null,
    no_trade_would_be_entry_price: input.no_trade_would_be_entry_price,
    no_trade_direction: input.direction,
    exit_falsification_status: null,
    exit_falsification_note: null,
    post_outcome: null,
    post_realized_pnl: null,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
  };

  const { data, error } = await insertTradeJournalWithSchemaFallback(payload as Record<string, unknown>);
  return wrap('记录空仓观望决策', error, data as unknown as TradeJournal);
}

export interface UpdateJournalPostInput {
  post_outcome: TradeOutcome;
  post_realized_pnl?: number | null;
  post_r_multiple?: number | null;
  post_reflection?: string | null;
  post_correct_action?: string | null;
  post_result_summary?: string | null;
  post_decision_quality?: TradeJournal['post_decision_quality'];
  post_positive_expectancy_review?: string | null;
  post_premortem_review?: string | null;
  post_invalidation_review?: string | null;
  post_path_first_move?: TradeJournal['post_path_first_move'];
  post_path_drawdown?: TradeJournal['post_path_drawdown'];
  post_path_win_quality?: TradeJournal['post_path_win_quality'];
  post_path_agency_note?: string | null;
  post_opponent_was_right?: boolean | null;
  post_five_step_goal?: string | null;
  post_five_step_problem?: string | null;
  post_proximate_cause?: string | null;
  post_root_cause?: string | null;
  post_design_intervention?: string | null;
  post_intervention_type?: TradeJournal['post_intervention_type'];
  post_execution_monitor?: string | null;
  post_five_step_weak_point?: TradeJournal['post_five_step_weak_point'];
}

export async function updateJournalPostReview(
  id: string,
  input: UpdateJournalPostInput,
): Promise<TradeJournal> {
  const payload = { ...input, post_reviewed_at: new Date().toISOString() };
  const { base, extra } = splitPostReviewPayload(payload);
  const baseResult = await updateTradeJournalWithSchemaFallback(id, base);
  const baseJournal = wrap("提交交易复盘", baseResult.error, baseResult.data as TradeJournal | null);
  if (Object.keys(extra).length === 0) return baseJournal;

  const extraResult = await updateTradeJournalWithSchemaFallback(id, extra);
  if (extraResult.error) {
    if (!isMissingDalioMetaLayerError(extraResult.error)) {
      console.warn('[journalApi] 保存扩展复盘字段失败:', extraResult.error);
    }
    return baseJournal;
  }
  return (extraResult.data as TradeJournal | null) ?? baseJournal;
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

// ============ Dalio L1 / L5 meta layer ============

export async function listPrinciples(userId: string): Promise<TradePrinciple[]> {
  const { data, error } = await supabase
    .from('trade_principles' as never)
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingDalioMetaLayerError(error)) return [];
    return wrap('加载交易原则', error, data as unknown as TradePrinciple[]);
  }
  return (data ?? []) as unknown as TradePrinciple[];
}

export interface CreatePrincipleInput {
  user_id: string;
  title: string;
  body?: string;
  evolution_level?: PrincipleEvolutionLevel;
  is_active?: boolean;
}

export async function createPrinciple(input: CreatePrincipleInput): Promise<TradePrinciple> {
  const payload = {
    user_id: input.user_id,
    title: input.title.trim(),
    body: input.body?.trim() ?? '',
    evolution_level: input.evolution_level ?? 1,
    is_active: input.is_active ?? true,
  };
  const { data, error } = await supabase
    .from('trade_principles' as never)
    .insert(payload as never)
    .select()
    .single();
  return wrap('创建交易原则', error, data as unknown as TradePrinciple);
}

export interface CreatePainLogEntriesInput {
  userId: string;
  journalId?: string | null;
  symbol?: string | null;
  marketTime?: string | null;
  tags: PainTag[];
  intensity?: 1 | 2 | 3 | 4 | 5;
}

export async function createPainLogEntries(input: CreatePainLogEntriesInput): Promise<void> {
  if (input.tags.length === 0) return;
  const rows = [...new Set(input.tags)].map(tag => ({
    user_id: input.userId,
    journal_id: input.journalId ?? null,
    symbol: input.symbol ?? null,
    pain_tag: tag,
    intensity: input.intensity ?? 3,
    market_time: input.marketTime ?? null,
  }));
  const { error } = await supabase
    .from('pain_log_entries' as never)
    .insert(rows as never);
  if (error) {
    if (isMissingDalioMetaLayerError(error)) return;
    throw new Error(`写入痛苦日志失败：${error.message}`);
  }
}

export async function listPainLogEntries(userId: string): Promise<PainLogEntry[]> {
  const { data, error } = await supabase
    .from('pain_log_entries' as never)
    .select('*')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: false });
  if (error) {
    if (isMissingDalioMetaLayerError(error)) return [];
    return wrap('加载痛苦日志', error, data as unknown as PainLogEntry[]);
  }
  return (data ?? []) as unknown as PainLogEntry[];
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
  principle_id?: string | null;
  rule_text: string;
  is_active?: boolean;
  added_to_checklist?: boolean;
  required?: boolean;
  rule_category?: RuleCategory;
  weight?: number;
  evolution_level?: PrincipleEvolutionLevel;
  trigger_threshold?: number;
}

// ============ Batch 3 additions ============

export interface FinalizeJournalInput {
  post_outcome: TradeOutcome;
  post_realized_pnl: number | null;
  post_r_multiple: number | null;
  post_reflection: string;
  post_correct_action: string;
  post_result_summary?: string | null;
  post_decision_quality?: TradeJournal['post_decision_quality'];
  post_struggle_level?: TradeJournal['post_struggle_level'];
  post_small_position_drag?: TradeJournal['post_small_position_drag'];
  post_missed_high_odds_state?: TradeJournal['post_missed_high_odds_state'];
  post_path_first_move?: TradeJournal['post_path_first_move'];
  post_path_drawdown?: TradeJournal['post_path_drawdown'];
  post_path_win_quality?: TradeJournal['post_path_win_quality'];
  post_path_agency_note?: string | null;
  /** 复盘时回填快照漏标的 edge 源头（旧快照），用于「盈亏同源」统计。 */
  pre_edge_source?: TradeJournal['pre_edge_source'];
  post_positive_expectancy_review?: string | null;
  post_premortem_review?: string | null;
  post_invalidation_review?: string | null;
  post_opponent_was_right?: boolean | null;
  post_five_step_goal?: string | null;
  post_five_step_problem?: string | null;
  post_proximate_cause?: string | null;
  post_root_cause?: string | null;
  post_design_intervention?: string | null;
  post_intervention_type?: TradeJournal['post_intervention_type'];
  post_execution_monitor?: string | null;
  post_five_step_weak_point?: TradeJournal['post_five_step_weak_point'];
  exit_falsification_status?: TradeJournal['exit_falsification_status'];
  exit_falsification_note?: string | null;
  /** 批次 25：对冲单平仓回填的"值回成本"判定（仅对冲单使用）。 */
  hedge_worth_it?: TradeJournal['hedge_worth_it'];
  // ===== 平仓情绪侧复盘 · 七问 =====
  post_emo_disturbance?: string | null;
  post_emo_first_reaction?: string | null;
  post_emo_wanted?: string | null;
  post_emo_feared?: string | null;
  post_emo_excuse?: string | null;
  post_emo_main_stone?: string | null;
  post_emo_main_stone_tags?: string[] | null;
  post_emo_next_time_plan?: string | null;
}

export async function finalizeJournalReview(
  journalId: string,
  input: FinalizeJournalInput,
): Promise<TradeJournal> {
  const payload = { ...input, post_reviewed_at: new Date().toISOString() };
  const { base, extra } = splitPostReviewPayload(payload);
  const baseResult = await updateTradeJournalWithSchemaFallback(journalId, base);
  const baseJournal = wrap("提交平仓评价", baseResult.error, baseResult.data as TradeJournal | null);
  if (Object.keys(extra).length === 0) return baseJournal;

  const extraResult = await updateTradeJournalWithSchemaFallback(journalId, extra);
  if (extraResult.error) {
    if (!isMissingDalioMetaLayerError(extraResult.error)) {
      console.warn('[journalApi] 保存扩展平仓评价字段失败:', extraResult.error);
    }
    return baseJournal;
  }
  return (extraResult.data as TradeJournal | null) ?? baseJournal;
}

export async function listJournalsByTradeRecordId(
  userId: string,
  tradeRecordId: string,
): Promise<TradeJournal[]> {
  const { data, error } = await supabase
    .from("trade_journals" as never)
    .select("*")
    .eq("user_id", userId)
    .eq("trade_record_id", tradeRecordId);
  return wrap("按交易记录查询日记", error, data as unknown as TradeJournal[]);
}

export async function findUnreviewedJournals(userId: string): Promise<TradeJournal[]> {
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
  // no_trade（太难）记录也带 long/short 方向且 post_reviewed_at 为空，但它没有真实仓位，
  // 必须排除，否则平仓评价可能错配到一条"太难"记录。用 JS 过滤而非 SQL，避免未跑 migration 时查询报错。
  const rows = ((data ?? []) as unknown as TradeJournal[])
    .filter(r => (r.journal_kind ?? 'trade') === 'trade');
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
  const payload: CreateRuleInput & { activated_at?: string } = { ...input };
  if (input.is_active && input.added_to_checklist) payload.activated_at = new Date().toISOString();
  const { data, error } = await supabase
    .from("trading_rules" as never)
    .insert(payload as never)
    .select()
    .single();
  return wrap("创建交易规则", error, data as unknown as TradingRule);
}

export async function markRuleAddedToChecklist(ruleId: string): Promise<void> {
  const { data: cur, error: gErr } = await supabase
    .from("trading_rules" as never)
    .select("activated_at,is_active")
    .eq("id", ruleId)
    .single();
  if (gErr) throw new Error(`读取规则状态失败：${gErr.message}`);
  const row = cur as unknown as Pick<TradingRule, 'activated_at' | 'is_active'>;
  const patch = {
    added_to_checklist: true,
    activated_at: row.is_active && !row.activated_at ? new Date().toISOString() : row.activated_at,
  };
  const { error } = await supabase
    .from("trading_rules" as never)
    .update(patch as never)
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
  principles: TradePrinciple[];
  painEntries: PainLogEntry[];
}

export async function listAllJournalDataForUser(
  userId: string,
  filters?: BulkJournalFilters,
): Promise<BulkJournalData> {
  let jq = supabase.from("trade_journals" as never).select("*").eq("user_id", userId);
  if (filters?.dateFrom) jq = jq.gte("pre_simulated_time", filters.dateFrom);
  if (filters?.dateTo) jq = jq.lte("pre_simulated_time", filters.dateTo);
  if (filters?.symbol) jq = jq.eq("symbol", filters.symbol);
  if (filters?.outcome) jq = jq.eq("post_outcome", filters.outcome);

  const aq = supabase.from("journal_tag_assignments" as never).select("*").eq("user_id", userId);
  const pq = supabase.from("error_tag_patterns" as never).select("*").eq("user_id", userId);
  const cq = supabase.from("error_tag_categories" as never).select("*").order("sort_order", { ascending: true });
  const rq = supabase.from("trading_rules" as never).select("*").eq("user_id", userId);
  const ppq = supabase.from('trade_principles' as never).select('*').eq('user_id', userId);
  const plq = supabase.from('pain_log_entries' as never).select('*').eq('user_id', userId);

  const [jr, ar, pr, cr, rr, ppr, plr] = await Promise.all([jq, aq, pq, cq, rq, ppq, plq]);
  if (jr.error) throw new Error(`加载日记失败：${jr.error.message}`);
  if (ar.error) throw new Error(`加载标签关联失败：${ar.error.message}`);
  if (pr.error) throw new Error(`加载错误模式失败：${pr.error.message}`);
  if (cr.error) throw new Error(`加载分类失败：${cr.error.message}`);
  if (rr.error) throw new Error(`加载规则失败：${rr.error.message}`);
  if (ppr.error && !isMissingDalioMetaLayerError(ppr.error)) throw new Error(`加载原则失败：${ppr.error.message}`);
  if (plr.error && !isMissingDalioMetaLayerError(plr.error)) throw new Error(`加载痛苦日志失败：${plr.error.message}`);

  return {
    journals: (jr.data ?? []) as unknown as TradeJournal[],
    assignments: (ar.data ?? []) as unknown as JournalTagAssignment[],
    patterns: (pr.data ?? []) as unknown as ErrorTagPattern[],
    categories: (cr.data ?? []) as unknown as ErrorTagCategory[],
    rules: (rr.data ?? []) as unknown as TradingRule[],
    principles: ppr.error ? [] : (ppr.data ?? []) as unknown as TradePrinciple[],
    painEntries: plr.error ? [] : (plr.data ?? []) as unknown as PainLogEntry[],
  };
}

// ============ Batch 6: Counterfactual branches ============

const MAX_BRANCHES = 10;

export async function appendCounterfactualBranch(
  journalId: string,
  branch: { label: string; params: CounterfactualBranchParams; result: CounterfactualBranchResult },
): Promise<TradeJournal> {
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

export async function getCognitiveAssets(userId: string): Promise<CognitiveAssetsDoc | null> {
  const row = await readCognitiveAssetsRow(userId);
  if (!row) return null;
  return normalizeCognitiveAssetsDoc(row.content);
}

export async function ensureCognitiveAssetsExists(userId: string): Promise<CognitiveAssetsDoc> {
  const current = await getCognitiveAssets(userId);
  if (current) return current;
  const initial = getInitialCognitiveAssetsDoc();
  await writeCognitiveAssetsDoc(userId, initial);
  return initial;
}

export async function replaceCognitiveAssetsDoc(userId: string, doc: CognitiveAssetsDoc): Promise<void> {
  if (!isCognitiveAssetsDoc(doc)) {
    throw new Error('认知资产文档格式无效');
  }
  await writeCognitiveAssetsDoc(userId, doc);
}

export async function deleteCognitiveAssetsDoc(userId: string): Promise<void> {
  const { error } = await supabase
    .from('cognitive_assets' as never)
    .delete()
    .eq('user_id', userId);
  if (error && !isMissingCognitiveAssetsTableError(error)) {
    throw new Error(`删除认知资产失败：${error.message}`);
  }
  removeUserScopedStorage(userId, COGNITIVE_ASSETS_STORAGE_KEY);
}

function updateSectionContent(
  doc: CognitiveAssetsDoc,
  categoryId: string,
  sectionId: string,
  updater: (section: CognitiveAssetSection) => string,
): CognitiveAssetsDoc {
  let categoryFound = false;
  let sectionFound = false;
  const next = deepClone(doc);
  next.categories = next.categories.map(category => {
    if (category.id !== categoryId) return category;
    categoryFound = true;
    return {
      ...category,
      sections: category.sections.map(section => {
        if (section.id !== sectionId) return section;
        sectionFound = true;
        return {
          ...section,
          content: updater(section),
        };
      }),
    };
  });
  if (!categoryFound) {
    throw new Error(`未找到认知资产分类：${categoryId}`);
  }
  if (!sectionFound) {
    throw new Error(`未找到认知资产章节：${sectionId}`);
  }
  return next;
}

function getInitialSectionContent(categoryId: string, sectionId: string): string {
  const category = INITIAL_COGNITIVE_ASSETS.categories.find(item => item.id === categoryId);
  if (!category) {
    throw new Error(`默认认知资产中不存在分类：${categoryId}`);
  }
  const section = category.sections.find(item => item.id === sectionId);
  if (!section) {
    throw new Error(`默认认知资产中不存在章节：${sectionId}`);
  }
  return section.content;
}

export async function updateCognitiveAssetSection(
  userId: string,
  categoryId: string,
  sectionId: string,
  newContent: string,
): Promise<void> {
  const nextContent = newContent.trim();
  if (!nextContent) {
    throw new Error('章节内容不能为空');
  }
  const current = await ensureCognitiveAssetsExists(userId);
  const next = updateSectionContent(current, categoryId, sectionId, () => nextContent);
  await writeCognitiveAssetsDoc(userId, next);
}

export async function resetCognitiveAssetSection(
  userId: string,
  categoryId: string,
  sectionId: string,
): Promise<void> {
  const current = await ensureCognitiveAssetsExists(userId);
  const next = updateSectionContent(
    current,
    categoryId,
    sectionId,
    () => getInitialSectionContent(categoryId, sectionId),
  );
  await writeCognitiveAssetsDoc(userId, next);
}

export async function resetAllCognitiveAssets(userId: string): Promise<void> {
  await writeCognitiveAssetsDoc(userId, getInitialCognitiveAssetsDoc());
}

export async function deleteCounterfactualBranch(
  journalId: string,
  branchId: string,
): Promise<TradeJournal> {
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
  patch: Partial<Pick<TradingRule, "rule_text" | "is_active" | "required" | "added_to_checklist" | "rule_category" | "weight" | "principle_id" | "evolution_level" | "ui_order" | "snooze_until">>,
): Promise<TradingRule> {
  // Cooldown guard: weakening a rule during its activation cooldown is blocked.
  // "Weakening" = turning off is_active, removing from checklist, or downgrading required → false.
  const weakening =
    patch.is_active === false ||
    patch.added_to_checklist === false ||
    patch.required === false ||
    (typeof patch.snooze_until === 'string' && patch.snooze_until.length > 0);
  const canActivate = patch.is_active === true || patch.added_to_checklist === true;
  let current: Pick<TradingRule, 'activated_at' | 'is_active' | 'added_to_checklist'> | null = null;
  if (weakening || canActivate) {
    const { data: cur, error: gErr } = await supabase
      .from("trading_rules" as never)
      .select("activated_at,is_active,added_to_checklist")
      .eq("id", ruleId)
      .single();
    if (gErr) throw new Error(`读取规则状态失败：${gErr.message}`);
    current = cur as unknown as Pick<TradingRule, 'activated_at' | 'is_active' | 'added_to_checklist'>;
  }
  if (weakening && current) {
    const remaining = ruleCooldownRemainingMs(current);
    if (remaining > 0) {
      const days = Math.ceil(remaining / 86400_000);
      throw new Error(`规则处于激活冷却期，还需 ${days} 天后才能修改。冷却期的设计是：你刚为自己定下的规则，不能在情绪冲动下立即关掉。`);
    }
  }
  const nextPatch: typeof patch & { activated_at?: string } = { ...patch };
  if (canActivate && current) {
    const nextActive = patch.is_active ?? current.is_active;
    const nextChecklist = patch.added_to_checklist ?? current.added_to_checklist;
    if (nextActive && nextChecklist && !current.activated_at) {
      nextPatch.activated_at = new Date().toISOString();
    }
  }
  const { data, error } = await supabase
    .from("trading_rules" as never)
    .update(nextPatch as never)
    .eq("id", ruleId)
    .select()
    .single();
  return wrap("更新规则", error, data as unknown as TradingRule);
}

export async function deleteRule(ruleId: string): Promise<void> {
  const { data: cur, error: gErr } = await supabase
    .from("trading_rules" as never)
    .select("activated_at")
    .eq("id", ruleId)
    .single();
  if (gErr) throw new Error(`读取规则状态失败：${gErr.message}`);
  const row = cur as unknown as Pick<TradingRule, 'activated_at'>;
  const remaining = ruleCooldownRemainingMs(row);
  if (remaining > 0) {
    const days = Math.ceil(remaining / 86400_000);
    throw new Error(`规则处于激活冷却期，还需 ${days} 天后才能删除。`);
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
  const { data: cur, error: gErr } = await supabase
    .from("trade_journals" as never)
    .select("user_id,post_new_rule_draft")
    .eq("id", journalId)
    .single();
  if (gErr) throw new Error(`读取草稿失败：${gErr.message}`);
  const row = cur as unknown as { user_id: string; post_new_rule_draft: string | null };
  const text = (row?.post_new_rule_draft ?? "").trim();
  if (!text) throw new Error("规则草稿不能为空");
  const { data, error } = await supabase
    .from("trading_rules" as never)
    .insert({
      user_id: row.user_id,
      source_pattern_id: options.sourcePatternId ?? null,
      rule_text: text,
      is_active: true,
      rule_category: 'core',
      weight: options.required ? 80 : 60,
      added_to_checklist: true,
      required: options.required,
    } as never)
    .select()
    .single();
  return wrap("写入规则", error, data as unknown as TradingRule);
}

// ============ Stop Doing List ============

/** 拉用户所有 active 的 Stop doing 条目。 */
export async function listStopDoingItems(userId: string): Promise<StopDoingItem[]> {
  const { data, error } = await supabase
    .from("stop_doing_items" as never)
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("ui_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    // 表还没建（迁移未跑）时静默返回空，不阻塞开仓表单。
    if (/relation .* does not exist|stop_doing_items/i.test(error.message)) return [];
    throw new Error(`加载 Stop doing list 失败：${error.message}`);
  }
  return (data ?? []) as unknown as StopDoingItem[];
}

export async function createStopDoingItem(
  userId: string,
  text: string,
): Promise<StopDoingItem> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Stop doing 条目内容不能为空');
  const { data, error } = await supabase
    .from("stop_doing_items" as never)
    .insert({ user_id: userId, text: trimmed, is_active: true, ui_order: 0 } as never)
    .select()
    .single();
  return wrap("新增 Stop doing 条目", error, data as unknown as StopDoingItem);
}

export async function updateStopDoingItem(
  id: string,
  patch: Partial<Pick<StopDoingItem, 'text' | 'is_active' | 'ui_order'>>,
): Promise<StopDoingItem> {
  const { data, error } = await supabase
    .from("stop_doing_items" as never)
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq("id", id)
    .select()
    .single();
  return wrap("更新 Stop doing 条目", error, data as unknown as StopDoingItem);
}

export async function deleteStopDoingItem(id: string): Promise<void> {
  const { error } = await supabase
    .from("stop_doing_items" as never)
    .delete()
    .eq("id", id);
  if (error) throw new Error(`删除 Stop doing 条目失败：${error.message}`);
}
