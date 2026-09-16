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
  counterfactualTemplateFor,
  isManualLegScenario,
  simulateCampaign,
  simulateManualLegScenario,
  type ManualLegDeviationCost,
} from '@/lib/campaignSimulationEngine';
import { buildCounterfactualRunContext, inferKlineInterval } from '@/lib/counterfactualOverview';
import {
  buildCampaignDeviationRuleDrafts,
  normalizeDeviationRuleText,
} from '@/lib/campaignDeviationRules';
import { INITIAL_COGNITIVE_ASSETS } from '@/lib/cognitiveAssetsInitialContent';
import { applyLocalMirror, mirrorDroppedColumns, reconcileLocalMirror } from '@/lib/journalLocalMirror';
import { hydrateJournalReviews } from '@/lib/journalReviewIdentity';
import {
  buildTradeRecordLookup,
  journalOperationTime,
  tradeRecordOperationTime,
} from '@/lib/objectiveOperationTime';
import { getPositionNotionalUsd } from '@/lib/tradingSettlement';
import {
  suggestLegRoles as suggestLegRolesHeuristic,
  type SuggestLegRolesOptions,
} from '@/lib/legRoleSuggestion';
import type { CognitiveAssetsDoc, CognitiveAssetCategory, CognitiveAssetSection } from '@/types/cognitiveAssets';
import { MAIN_ADD_ROLES, usesDualHedgeSop } from '@/lib/strategyTemplates';
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
  CampaignDeviationNote,
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
import {
  campaignStatusFromRealizedPnl,
  computeCampaignRealizedPnl,
  materiallyDifferentPnl,
} from "@/lib/campaignRealizedPnl";
import {
  fetchLegExitPriceCorrectionsResult,
  type LegExitPriceCorrections,
  type LegExitPriceCorrectionsResult,
} from '@/lib/campaignLegExecution';
import { queueSimStatePush } from '@/lib/simStateSync';
import { normalizeReplayTimelineRegistry, REPLAY_TIMELINES_STORAGE_KEY, type ReplayTimelineRegistry } from '@/lib/replayTimeline';
import {
  buildCampaignTimelineScope,
  collectCampaignTimelineActivity,
  collectCampaignTimelineAnchors,
  indexCampaignTimelineActivity,
  type CampaignTimelineActivityIndex,
  type CampaignTimelineDiagnostics,
  type CampaignTimelineOrderDiagnostic,
  type CampaignTimelineOrderLike,
  type CampaignTimelineOrderOptions,
  type OpenPositionTimelineLike,
} from '@/lib/campaignTimelineScope';
import {
  CAMPAIGN_LEGACY_ORDER_RECORD_MATCH_MS,
  CAMPAIGN_ORDER_WINDOW_LOOKBACK_MS,
  isCampaignOpeningShortOrder,
  resolveNeverFilledOrderIds,
} from '@/lib/campaignOrderAttribution';
import {
  bestOrderRealStamp,
  buildReplaySessionFilter,
  campaignRealTimeWindow,
  legCloseReplayEvent,
  legOpenReplayEvent,
  orderClockStamp,
  orderWithinRealWindow,
  REPLAY_CLOCK_LAG_BUDGET_MS,
  REPLAY_SIM_DROP_TOLERANCE_MS,
  REPLAY_SITTING_GAP_MS,
  type ReplayEvent,
  type ReplayEventKind,
} from '@/lib/campaignOrderRealTime';
import { MAX_SIMULATION_SPEED } from '@/lib/simulationSpeeds';
import type {
  PendingOrder,
  TradeRecord,
  CancelledOrderSnapshot,
  FilledOrderSnapshot,
  CampaignReverseHedgeOrder,
} from "@/types/trading";


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

function fallbackCampaignCode(id: unknown): string {
  const normalizedId = typeof id === 'string' ? id.trim().replace(/-/g, '').toUpperCase() : '';
  return normalizedId ? `C-${normalizedId}` : 'C-UNKNOWN';
}

function normalizeCampaignCode(value: unknown, id: unknown): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallbackCampaignCode(id);
}

function toCampaign(row: unknown): TradeCampaign {
  const campaign = row as TradeCampaign;
  return withLocalDeviationNotes({
    ...campaign,
    campaign_code: normalizeCampaignCode(campaign?.campaign_code, campaign?.id),
    importance_weight: normalizeCampaignImportance(campaign?.importance_weight),
    deviation_notes: campaign?.deviation_notes ?? {},
    deleted_at: campaign?.deleted_at ?? null,
  });
}

function toCampaignCounterfactual(row: unknown): CampaignCounterfactual {
  return row as CampaignCounterfactual;
}

function toCampaignEvent(row: unknown): CampaignEvent {
  return row as CampaignEvent;
}

function inferCampaignEventType(legRole: LegRole): CampaignEvent['event_type'] {
  if (legRole === 'standalone') return 'note';
  if (legRole === 'main_open' || legRole === 'reentry_main' || MAIN_ADD_ROLES.includes(legRole)) return 'main_opened';
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
  // 这条路径与 usePersistedState 写同一套 sim_<uid>_ 键，但不经过那个 hook，
  // 因此必须自己推送——否则本次会话内的改动要等下次启动回填才上云。
  queueSimStatePush(userId, key, value);
}

export type { CampaignDeviationNote } from "@/types/journal";

/**
 * 保存「SOP 偏离代价明细」手填备注。云端列可用时写 trade_campaigns.deviation_notes；
 * Lovable schema cache 尚未同步表/列时，落到本地用户作用域镜像，并由 toCampaign 自动合并回读。
 */
export async function saveCampaignDeviationNotes(
  campaignId: string,
  notes: Record<string, CampaignDeviationNote>,
): Promise<void> {
  const { error } = await supabase
    .from('trade_campaigns' as never)
    .update({ deviation_notes: notes } as never)
    .eq('id', campaignId);
  if (!error) {
    try {
      const userId = await getAuthenticatedUserId('保存偏离备注');
      writeLocalCampaignDeviationNotes(userId, campaignId, notes);
    } catch (mirrorError) {
      console.warn('[journalApi] 远端偏离备注已保存，本地镜像写入跳过', mirrorError);
    }
    return;
  }
  if (isMissingTradeCampaignsTableError(error) || isSchemaColumnMissingError(error)) {
    const userId = await getAuthenticatedUserId('保存偏离备注');
    writeLocalCampaignDeviationNotes(userId, campaignId, notes);
    const localCampaign = findLocalCampaign(userId, campaignId);
    if (localCampaign) {
      upsertLocalCampaign({
        ...localCampaign,
        deviation_notes: mergeDeviationNotes(localCampaign.deviation_notes, notes),
        updated_at: new Date().toISOString(),
      });
    }
    return;
  }
  throw new Error(error.message ?? '保存偏离备注失败');
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
const TRADE_CAMPAIGN_PREFS_STORAGE_KEY = 'trade_campaign_preferences';
const CAMPAIGN_COUNTERFACTUALS_STORAGE_KEY = 'campaign_counterfactuals';
const CAMPAIGN_DEVIATION_NOTES_STORAGE_KEY = 'campaign_deviation_notes';
const TRADING_RULE_SOURCE_CAMPAIGNS_STORAGE_KEY = 'trading_rule_source_campaigns';
const TRADING_RULE_SOURCE_RULE_ID_PREFIX = 'rule_id:';
const ACCOUNT_FOLLOWS_STORAGE_KEY = 'account_follows';
const MAX_LOCAL_CAMPAIGN_COUNTERFACTUALS = 50;

function getInitialCognitiveAssetsDoc(): CognitiveAssetsDoc {
  return deepClone(INITIAL_COGNITIVE_ASSETS);
}

function withDefaultCognitiveAssetCategories(doc: CognitiveAssetsDoc): { doc: CognitiveAssetsDoc; changed: boolean } {
  const initial = getInitialCognitiveAssetsDoc();
  const existingIds = new Set(doc.categories.map(category => category.id));
  const missingDefaults = initial.categories.filter(category => !existingIds.has(category.id));
  if (missingDefaults.length === 0) {
    return { doc, changed: false };
  }
  return {
    doc: {
      meta: {
        title: initial.meta.title,
        subtitle: `${initial.meta.subtitle} · 个人追加`,
      },
      categories: [...missingDefaults, ...doc.categories],
    },
    changed: true,
  };
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
  main_add_1: ['main'],
  main_add_2: ['main'],
  main_add_3: ['main'],
  main_add_4: ['main'],
  main_add_5: ['main'],
  main_add_6: ['main'],
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

function isMissingCampaignImportanceColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return /importance_weight/i.test(message) && /schema cache|could not find|does not exist|column/i.test(message);
}

function isMissingCampaignDeletedAtColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return /deleted_at/i.test(message) && /schema cache|could not find|does not exist|column/i.test(message);
}

function isMissingTradeJournalsFeatureError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || (/trade_journals_leg_role_check|violates check constraint/i.test(message))
    || (/trade_journals|campaign_id|leg_role|leg_sequence/i.test(message) && /schema cache|could not find|does not exist|column/i.test(message));
}

function isMissingCounterfactualsTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || (/campaign_counterfactuals|source_deduction_id|branch_kind|params|result/i.test(message)
      && /schema cache|could not find|does not exist|column/i.test(message));
}

function isMissingSocialFeatureError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === 'PGRST205'
    || error.code === '42P01'
    || (/account_follows|trade_campaign_comments/i.test(message) && /schema cache|could not find|does not exist|column/i.test(message));
}

function normalizeLocalFollows(raw: unknown): AccountFollow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Partial<AccountFollow> => (
      isRecord(item)
      && typeof item.follower_id === 'string'
      && typeof item.followee_id === 'string'
    ))
    .map(item => ({
      id: typeof item.id === 'string' && item.id ? item.id : `local-follow-${item.follower_id}-${item.followee_id}`,
      follower_id: item.follower_id as string,
      followee_id: item.followee_id as string,
      created_at: typeof item.created_at === 'string' && item.created_at ? item.created_at : new Date().toISOString(),
    }));
}

function readLocalFollows(followerId: string): AccountFollow[] {
  return normalizeLocalFollows(readUserScopedStorage<unknown>(followerId, ACCOUNT_FOLLOWS_STORAGE_KEY, []));
}

function writeLocalFollows(followerId: string, follows: AccountFollow[]): void {
  writeUserScopedStorage(followerId, ACCOUNT_FOLLOWS_STORAGE_KEY, follows);
}

function makeLocalFollow(followerId: string, followeeId: string): AccountFollow {
  return {
    id: `local-follow-${followerId}-${followeeId}`,
    follower_id: followerId,
    followee_id: followeeId,
    created_at: new Date().toISOString(),
  };
}

function upsertLocalFollow(follow: AccountFollow): AccountFollow {
  const rows = readLocalFollows(follow.follower_id);
  const existing = rows.find(item => item.followee_id === follow.followee_id);
  const nextFollow = existing ? { ...existing, ...follow, created_at: existing.created_at } : follow;
  const next = existing
    ? rows.map(item => item.followee_id === follow.followee_id ? nextFollow : item)
    : [nextFollow, ...rows];
  writeLocalFollows(follow.follower_id, next);
  return nextFollow;
}

function removeLocalFollow(followerId: string, followeeId: string): void {
  writeLocalFollows(followerId, readLocalFollows(followerId).filter(item => item.followee_id !== followeeId));
}

function hasLocalFollow(followerId: string, followeeId: string): boolean {
  return readLocalFollows(followerId).some(item => item.followee_id === followeeId);
}

function mergeFollows(primary: AccountFollow[], fallback: AccountFollow[]): AccountFollow[] {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter(item => {
    const key = `${item.follower_id}:${item.followee_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 「可选/新增」列模式：远程库可能尚未应用对应迁移、还没建这些列。
 * 同一个常量有两个用途：
 *   1) 匹配错误信息里出现的列名（判定这是「缺新列」而非约束错误）；
 *   2) 按「列名」批量剥离——严重漂移时一次性删掉所有可选列（见 stripAllOptionalColumns）。
 * 核心列（user_id/symbol/direction/pre_entry_reason/pre_mental_state/post_outcome…）
 * 不在此模式内，永不会被误判或误删。仅用 i 标志（无 g），test() 无状态、可安全复用。
 */
const OPTIONAL_COLUMN_PATTERN = /trade_principles|pain_log_entries|campaign_id|leg_role|leg_sequence|order_kind|pre_timeline_id|pre_settlement_mode|pre_settlement_asset|pre_contract_size_usd|pre_contracts|pre_thesis_why_right|pre_premortem_failure_reason|pre_falsification_signal|pre_confidence_basis|pre_odds_structure|pre_odds_structure_source|pre_odds_structure_premortem|pre_odds_structure_breakdown_signals|pre_account_equity_usdt|pre_opportunity_cost_worth|pre_cheap_opportunity|pre_edge_source|pre_market_regime|pre_entry_stage|pre_stop_quality|pre_chase_after_close|pre_mortem_text|pre_positive_expectancy|pre_invalidation_condition|pre_calibration_win_pct|pre_confidence_interval_|pre_calibration_reference_class|pre_calibration_competence_basis|pre_calibration_update_signal|pre_dataset_split|pre_lollapalooza_score|pre_bankruptcy_estimate|pre_info_|pre_opponent_statement|pre_pain_tags|pre_cognitive_bias_tags|pre_triggered_principle_ids|pre_triggered_rule_ids|pre_executor_self|pre_designer_self|pre_stop_doing_acknowledged_ids|pre_stop_doing_ad_hoc|journal_kind|no_trade_reason|no_trade_would_be_entry_price|no_trade_direction|exit_falsification_status|exit_falsification_note|post_result_summary|post_(?:entry|holding|exit)_decision_quality|post_exit_nature|post_decision_quality|post_struggle_level|post_small_position_drag|post_missed_high_odds_state|post_path_|post_trade_agency_score|post_positive_expectancy_review|post_premortem_review|post_invalidation_review|post_entry_|post_five_step|post_opponent_was_right|post_proximate_cause|post_root_cause|post_design_intervention|post_intervention_type|post_execution_monitor|post_real_close_time|post_simulated_close_time|post_emo_|evolution_level|principle_id|hedge_type|hedge_boundary_price|hedge_boundary_basis|hedge_boundary_stance|hedge_lock_profit_pct|hedge_resolution_up|hedge_resolution_down|hedge_down_if_chop|hedge_down_if_trend|hedge_down_if_rebound|hedge_necessity_pct|hedge_safety_strength|hedge_safety_regularity|hedge_risk_magnitude|hedge_conviction_pct|hedge_friction_cost|hedge_order_method|hedge_worth_it/i;

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

/**
 * 旧版远程库只允许四档「小机会拖累」值；新版前端保存六档「情境 × 处理」值时，
 * Postgres 会以 23514 拒绝整次 update。这里只识别这一条具名约束，不能把其他
 * CHECK 错误误当成 schema drift。
 */
function isLegacySituationHandlingConstraintError(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return /trade_journals_post_small_position_drag_check/i.test(message)
    && (error.code === '23514' || /violates check constraint/i.test(message));
}

/**
 * 逐列剥离若干次仍缺列，即判定远程库「严重漂移」，转为一次性批量剥离，避免几十次往返。
 *
 * 阈值放宽到 40：远程库可能缺 8 个 post_emo_* + 2 个 pre_stop_doing_* + 4 个 post_path_* + …
 * 简单加加就 20+ 列，原 5 次太激进——会在用户刚漏跑 1 个迁移的常见场景下就触发 bulk strip，
 * 把所有 OPTIONAL_COLUMN_PATTERN 命中的可选列一起剥光，结果连早就存在的核心字段
 * （post_decision_quality 等）也被牵连，extra payload 几乎全空——这正是错题集汇总
 * 全 0/N 的根因。放宽到 40 让单列剥离能覆盖绝大多数 drift 场景，仅在极端漂移时才退回批量。
 */
const BULK_STRIP_AFTER = 40;

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
): Promise<{ data: unknown; error: { message: string; code?: string } | null; droppedColumns: string[] }> {
  let nextPayload = { ...payload };
  let lastData: unknown = null;
  let lastError: { message: string; code?: string } | null = null;
  let stripped = 0;
  let bulkStripped = false;
  const droppedColumns: string[] = [];
  // 远程库可能缺几十列，逐列剥离次数必须足够覆盖；原来固定 30 会在严重漂移时提前耗尽。
  const maxAttempts = Object.keys(payload).length + 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (Object.keys(nextPayload).length === 0) return { data: lastData, error: null, droppedColumns };
    const { data, error } = await supabase
      .from("trade_journals" as never)
      .update(nextPayload as never)
      .eq("id", journalId)
      .select()
      .single();
    lastData = data;
    lastError = error;
    if (!error) return { data, error: null, droppedColumns };
    if (
      isLegacySituationHandlingConstraintError(error)
      && 'post_small_position_drag' in nextPayload
    ) {
      const rest = { ...nextPayload };
      delete rest.post_small_position_drag;
      nextPayload = rest;
      if (!droppedColumns.includes('post_small_position_drag')) {
        droppedColumns.push('post_small_position_drag');
      }
      continue;
    }
    if (!isMissingDalioMetaLayerError(error) && !isSchemaColumnMissingError(error)) {
      return { data, error, droppedColumns };
    }
    const missing = missingSchemaColumn(error);
    if (!missing || !(missing in nextPayload)) return { data, error, droppedColumns };
    // 严重漂移：逐列剥到阈值仍缺列，一次性剥掉所有可选列（update 不需回填 pre_entry_reason，
    // 因为目标行已存在、旧列早已有值，强行回填反而会覆盖既有理由）。
    if (stripped >= BULK_STRIP_AFTER && !bulkStripped) {
      // 记录哪些字段被一次性剥掉，方便 finalize 给用户清晰提示。
      for (const key of Object.keys(nextPayload)) {
        if (OPTIONAL_COLUMN_PATTERN.test(key) && !droppedColumns.includes(key)) {
          droppedColumns.push(key);
        }
      }
      nextPayload = stripAllOptionalColumns(nextPayload);
      bulkStripped = true;
      continue;
    }
    const rest = { ...nextPayload };
    delete rest[missing];
    nextPayload = rest;
    if (!droppedColumns.includes(missing)) droppedColumns.push(missing);
    stripped += 1;
  }

  return { data: lastData, error: lastError, droppedColumns };
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
): Promise<{ data: unknown; error: { message: string; code?: string } | null; droppedColumns: string[] }> {
  let nextPayload = normalizeMainOrderLegacyCompleteness(payload);
  let lastData: unknown = null;
  let lastError: { message: string; code?: string } | null = null;
  let stripped = 0;
  let bulkStripped = false;
  const droppedColumns: string[] = [];
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
    if (!error) return { data, error: null, droppedColumns };
    if (!isMissingDalioMetaLayerError(error) && !isSchemaColumnMissingError(error)) {
      return { data, error, droppedColumns };
    }
    const missing = missingSchemaColumn(error);
    if (!missing || !(missing in nextPayload)) return { data, error, droppedColumns };
    // 严重漂移：逐列剥到阈值仍缺列，一次性剥掉所有可选列；若把 pre_thesis_why_right
    // 也剥了，则把理由回填到 NOT NULL 旧列 pre_entry_reason（与逐列兜底保持一致）。
    if (stripped >= BULK_STRIP_AFTER && !bulkStripped) {
      const before = nextPayload;
      for (const key of Object.keys(before)) {
        if (OPTIONAL_COLUMN_PATTERN.test(key) && !droppedColumns.includes(key)) {
          droppedColumns.push(key);
        }
      }
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
    if (!droppedColumns.includes(missing)) droppedColumns.push(missing);
    // legacy 兜底：只要发生 schema-drift 重试，就把新版三问 A 回填到旧列 pre_entry_reason。
    // 旧库可能还没执行 DROP NOT NULL；若这里继续带 null，会在剥掉缺列后又被 NOT NULL 卡住。
    if (rest.pre_entry_reason == null) {
      rest.pre_entry_reason = (payload.pre_thesis_why_right as string | null | undefined) ?? '';
    }
    nextPayload = rest;
    stripped += 1;
  }

  return { data: lastData, error: lastError, droppedColumns };
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

type LocalCampaignPreference = {
  importance_weight?: number;
};

type LocalCampaignPreferenceMap = Record<string, LocalCampaignPreference>;

function normalizeCampaignImportance(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(5, Math.round(num)));
}

function normalizeCampaignDeviationNote(value: unknown): CampaignDeviationNote | null {
  if (!isRecord(value)) return null;
  return {
    category: typeof value.category === 'string' ? value.category : undefined,
    reason: typeof value.reason === 'string' ? value.reason : undefined,
    fix: typeof value.fix === 'string' ? value.fix : undefined,
  };
}

function normalizeCampaignDeviationNotes(raw: unknown): Record<string, CampaignDeviationNote> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => [key, normalizeCampaignDeviationNote(value)] as const)
      .filter((entry): entry is readonly [string, CampaignDeviationNote] => (
        typeof entry[0] === 'string' && entry[1] !== null
      )),
  );
}

type LocalCampaignDeviationNotesMap = Record<string, Record<string, CampaignDeviationNote>>;

function normalizeLocalCampaignDeviationNotesMap(raw: unknown): LocalCampaignDeviationNotesMap {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([campaignId]) => typeof campaignId === 'string')
      .map(([campaignId, notes]) => [campaignId, normalizeCampaignDeviationNotes(notes)]),
  );
}

function readLocalCampaignDeviationNotesMap(userId: string): LocalCampaignDeviationNotesMap {
  return normalizeLocalCampaignDeviationNotesMap(
    readUserScopedStorage<unknown>(userId, CAMPAIGN_DEVIATION_NOTES_STORAGE_KEY, {}),
  );
}

function readLocalCampaignDeviationNotes(userId: string, campaignId: string): Record<string, CampaignDeviationNote> {
  return readLocalCampaignDeviationNotesMap(userId)[campaignId] ?? {};
}

function writeLocalCampaignDeviationNotes(
  userId: string,
  campaignId: string,
  notes: Record<string, CampaignDeviationNote>,
): void {
  const current = readLocalCampaignDeviationNotesMap(userId);
  current[campaignId] = normalizeCampaignDeviationNotes(notes);
  writeUserScopedStorage(userId, CAMPAIGN_DEVIATION_NOTES_STORAGE_KEY, current);
}

function readRawLocalTradingRuleSourceCampaigns(userId: string): Record<string, string> {
  const raw = readUserScopedStorage<unknown>(userId, TRADING_RULE_SOURCE_CAMPAIGNS_STORAGE_KEY, {});
  if (!isRecord(raw)) return {};
  return Object.entries(raw).reduce<Record<string, string>>((acc, [ruleText, campaignId]) => {
    if (typeof campaignId !== 'string' || !campaignId) return acc;
    if (ruleText.startsWith(TRADING_RULE_SOURCE_RULE_ID_PREFIX)) {
      const ruleId = ruleText.slice(TRADING_RULE_SOURCE_RULE_ID_PREFIX.length).trim();
      if (ruleId) acc[`${TRADING_RULE_SOURCE_RULE_ID_PREFIX}${ruleId}`] = campaignId;
      return acc;
    }
    const normalized = normalizeDeviationRuleText(ruleText);
    if (normalized) acc[normalized] = campaignId;
    return acc;
  }, {});
}

function readLocalTradingRuleSourceCampaigns(userId: string): Record<string, string> {
  return Object.entries(readRawLocalTradingRuleSourceCampaigns(userId))
    .filter(([key]) => !key.startsWith(TRADING_RULE_SOURCE_RULE_ID_PREFIX))
    .reduce<Record<string, string>>((acc, [ruleText, campaignId]) => {
      acc[ruleText] = campaignId;
      return acc;
    }, {});
}

function readLocalTradingRuleSourceRuleIds(userId: string): Record<string, string> {
  return Object.entries(readRawLocalTradingRuleSourceCampaigns(userId))
    .filter(([key]) => key.startsWith(TRADING_RULE_SOURCE_RULE_ID_PREFIX))
    .reduce<Record<string, string>>((acc, [key, campaignId]) => {
      const ruleId = key.slice(TRADING_RULE_SOURCE_RULE_ID_PREFIX.length);
      if (ruleId) acc[ruleId] = campaignId;
      return acc;
    }, {});
}

function writeLocalTradingRuleSourceCampaign(userId: string, ruleText: string, campaignId: string): void {
  const normalized = normalizeDeviationRuleText(ruleText);
  if (!normalized || !campaignId) return;
  writeUserScopedStorage(userId, TRADING_RULE_SOURCE_CAMPAIGNS_STORAGE_KEY, {
    ...readRawLocalTradingRuleSourceCampaigns(userId),
    [normalized]: campaignId,
  });
}

export function bindLocalTradingRuleSourceCampaign(userId: string, ruleId: string, campaignId: string): void {
  const normalizedRuleId = ruleId.trim();
  if (!normalizedRuleId || !campaignId) return;
  writeUserScopedStorage(userId, TRADING_RULE_SOURCE_CAMPAIGNS_STORAGE_KEY, {
    ...readRawLocalTradingRuleSourceCampaigns(userId),
    [`${TRADING_RULE_SOURCE_RULE_ID_PREFIX}${normalizedRuleId}`]: campaignId,
  });
}

export function getLocalTradingRuleSourceCampaigns(userId: string): Record<string, string> {
  return readLocalTradingRuleSourceCampaigns(userId);
}

export function getLocalTradingRuleSourceCampaignIndex(userId: string): {
  byText: Record<string, string>;
  byRuleId: Record<string, string>;
} {
  return {
    byText: readLocalTradingRuleSourceCampaigns(userId),
    byRuleId: readLocalTradingRuleSourceRuleIds(userId),
  };
}

function mergeDeviationNotes(
  remote: Record<string, CampaignDeviationNote> | null | undefined,
  local: Record<string, CampaignDeviationNote> | null | undefined,
): Record<string, CampaignDeviationNote> {
  return {
    ...normalizeCampaignDeviationNotes(remote),
    ...normalizeCampaignDeviationNotes(local),
  };
}

function withLocalDeviationNotes(campaign: TradeCampaign): TradeCampaign {
  const remoteNotes = normalizeCampaignDeviationNotes(campaign.deviation_notes);
  const localNotes = campaign?.user_id && campaign?.id
    ? readLocalCampaignDeviationNotes(campaign.user_id, campaign.id)
    : {};
  return {
    ...campaign,
    deviation_notes: Object.keys(remoteNotes).length > 0
      ? { ...localNotes, ...remoteNotes }
      : localNotes,
  };
}

function normalizeLocalCampaigns(raw: unknown): TradeCampaign[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is TradeCampaign => (
      isRecord(item)
      && typeof item.id === 'string'
      && typeof item.user_id === 'string'
      && typeof item.symbol === 'string'
      && typeof item.title === 'string'
    ))
    .map(campaign => ({
      ...campaign,
      campaign_code: normalizeCampaignCode(campaign.campaign_code, campaign.id),
      importance_weight: normalizeCampaignImportance(campaign.importance_weight),
      deviation_notes: normalizeCampaignDeviationNotes(campaign.deviation_notes),
      deleted_at: campaign.deleted_at ?? null,
    }))
    .map(withLocalDeviationNotes);
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

function normalizeLocalCampaignPreferences(raw: unknown): LocalCampaignPreferenceMap {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([campaignId]) => typeof campaignId === 'string')
      .map(([campaignId, value]) => [
        campaignId,
        { importance_weight: isRecord(value) ? normalizeCampaignImportance(value.importance_weight) : 0 },
      ]),
  );
}

function readLocalCampaignPreferences(userId: string): LocalCampaignPreferenceMap {
  return normalizeLocalCampaignPreferences(readUserScopedStorage<unknown>(userId, TRADE_CAMPAIGN_PREFS_STORAGE_KEY, {}));
}

function writeLocalCampaignPreferences(userId: string, preferences: LocalCampaignPreferenceMap): void {
  writeUserScopedStorage(userId, TRADE_CAMPAIGN_PREFS_STORAGE_KEY, preferences);
}

function upsertLocalCampaignPreference(userId: string, campaignId: string, patch: LocalCampaignPreference): void {
  const current = readLocalCampaignPreferences(userId);
  current[campaignId] = {
    ...current[campaignId],
    ...patch,
    importance_weight: normalizeCampaignImportance(patch.importance_weight ?? current[campaignId]?.importance_weight),
  };
  writeLocalCampaignPreferences(userId, current);
}

function removeLocalCampaignPreference(userId: string, campaignId: string): void {
  const current = readLocalCampaignPreferences(userId);
  delete current[campaignId];
  writeLocalCampaignPreferences(userId, current);
}

function withCampaignPreferences(userId: string, campaigns: TradeCampaign[]): TradeCampaign[] {
  const preferences = readLocalCampaignPreferences(userId);
  return sortCampaignsByImportance(campaigns.map(campaign => {
    const localImportance = preferences[campaign.id]?.importance_weight;
    return {
      ...campaign,
      importance_weight: normalizeCampaignImportance(localImportance ?? campaign.importance_weight),
    };
  }));
}

function campaignSortTime(campaign: Pick<TradeCampaign, 'opened_at' | 'created_at'>): number {
  return new Date(campaign.opened_at || campaign.created_at).getTime() || 0;
}

function sortCampaignsByImportance(rows: TradeCampaign[]): TradeCampaign[] {
  return [...rows].sort((a, b) => (
    normalizeCampaignImportance(b.importance_weight) - normalizeCampaignImportance(a.importance_weight)
    || campaignSortTime(b) - campaignSortTime(a)
  ));
}

function applyCampaignFilters(rows: TradeCampaign[], filters?: ListCampaignFilters): TradeCampaign[] {
  return sortCampaignsByImportance(rows
    .filter(campaign => {
      if (filters?.status && filters.status !== 'all' && campaign.status !== filters.status) return false;
      if (filters?.symbol && campaign.symbol !== filters.symbol) return false;
      const openedAt = new Date(campaign.opened_at).getTime();
      if (filters?.dateFrom && openedAt < new Date(filters.dateFrom).getTime()) return false;
      if (filters?.dateTo && openedAt > new Date(filters.dateTo).getTime()) return false;
      return true;
    }));
}

function mergeCampaigns(remote: TradeCampaign[], local: TradeCampaign[]): TradeCampaign[] {
  const merged = new Map<string, TradeCampaign>();
  remote.forEach(campaign => merged.set(campaign.id, campaign));
  local.forEach(campaign => {
    // A local tombstone must win while the deployed schema is still catching up.
    if (!merged.has(campaign.id) || campaign.deleted_at != null) {
      merged.set(campaign.id, campaign);
    }
  });
  return sortCampaignsByImportance([...merged.values()]);
}

function activeCampaignRows(rows: TradeCampaign[]): TradeCampaign[] {
  return rows.filter(campaign => campaign.deleted_at == null);
}

function deletedCampaignRows(rows: TradeCampaign[]): TradeCampaign[] {
  return rows
    .filter(campaign => campaign.deleted_at != null)
    .sort((a, b) => (
      new Date(b.deleted_at ?? 0).getTime() - new Date(a.deleted_at ?? 0).getTime()
      || campaignSortTime(b) - campaignSortTime(a)
    ));
}

function counterfactualSortTime(branch: Pick<CampaignCounterfactual, 'created_at'>): number {
  return new Date(branch.created_at).getTime() || 0;
}

function sortCounterfactuals(rows: CampaignCounterfactual[]): CampaignCounterfactual[] {
  return [...rows].sort((a, b) => counterfactualSortTime(b) - counterfactualSortTime(a));
}

function normalizeLocalCampaignCounterfactuals(raw: unknown): CampaignCounterfactual[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is CampaignCounterfactual => (
      isRecord(item)
      && typeof item.id === 'string'
      && typeof item.user_id === 'string'
      && typeof item.campaign_id === 'string'
      && typeof item.label === 'string'
      && typeof item.branch_kind === 'string'
      && isRecord(item.params)
      && isRecord(item.result)
    ))
    .map(item => ({
      ...item,
      source_deduction_id: typeof item.source_deduction_id === 'string' ? item.source_deduction_id : null,
      created_at: typeof item.created_at === 'string' && item.created_at ? item.created_at : new Date().toISOString(),
    }));
}

function readAllLocalCounterfactuals(userId: string): CampaignCounterfactual[] {
  return normalizeLocalCampaignCounterfactuals(
    readUserScopedStorage<unknown>(userId, CAMPAIGN_COUNTERFACTUALS_STORAGE_KEY, []),
  );
}

function writeAllLocalCounterfactuals(userId: string, branches: CampaignCounterfactual[]): void {
  writeUserScopedStorage(
    userId,
    CAMPAIGN_COUNTERFACTUALS_STORAGE_KEY,
    sortCounterfactuals(branches).slice(0, MAX_LOCAL_CAMPAIGN_COUNTERFACTUALS),
  );
}

function readLocalCounterfactuals(userId: string, campaignId: string): CampaignCounterfactual[] {
  return sortCounterfactuals(readAllLocalCounterfactuals(userId).filter(branch => branch.campaign_id === campaignId));
}

function upsertLocalCounterfactual(branch: CampaignCounterfactual): CampaignCounterfactual {
  const rows = readAllLocalCounterfactuals(branch.user_id);
  const next = [branch, ...rows.filter(item => item.id !== branch.id)];
  writeAllLocalCounterfactuals(branch.user_id, next);
  return branch;
}

function removeLocalCounterfactual(userId: string, id: string): void {
  writeAllLocalCounterfactuals(userId, readAllLocalCounterfactuals(userId).filter(branch => branch.id !== id));
}

function mergeCounterfactuals(remote: CampaignCounterfactual[], local: CampaignCounterfactual[]): CampaignCounterfactual[] {
  const merged = new Map<string, CampaignCounterfactual>();
  local.forEach(branch => merged.set(branch.id, branch));
  remote.forEach(branch => merged.set(branch.id, branch));
  return sortCounterfactuals([...merged.values()]);
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
  const id = crypto.randomUUID();
  return {
    id,
    user_id: userId,
    campaign_code: fallbackCampaignCode(id),
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
    importance_weight: 0,
    notes: input.notes ?? null,
    actual_evolution: [event],
    deviation_notes: {},
    deleted_at: null,
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

function campaignMainDirection(campaign: Pick<TradeCampaign, 'direction'>): TradeJournal['direction'] {
  return campaign.direction === 'main_short' ? 'short' : 'long';
}

function oppositeDirection(direction: TradeJournal['direction']): TradeJournal['direction'] {
  return direction === 'short' ? 'long' : 'short';
}

function inferDirectionFromLegRole(
  campaign: Pick<TradeCampaign, 'direction'>,
  role: LegRole | null,
  eventDirection?: TradeDirection | null,
): TradeJournal['direction'] {
  if (eventDirection === 'long' || eventDirection === 'short') return eventDirection;
  const mainDirection = campaignMainDirection(campaign);
  if (role?.startsWith('hedge_') || role === 'reentry_hedge') return oppositeDirection(mainDirection);
  return mainDirection;
}

function inferOrderKindFromLegRole(role: LegRole | null): TradeJournal['order_kind'] {
  if (role?.startsWith('hedge_') || role === 'reentry_hedge') return 'hedge';
  return 'main';
}

function tradeRecordPositionSize(record: TradeRecord): number {
  return Math.abs(getPositionNotionalUsd(record.symbol, record, record.entryPrice));
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

/**
 * 事件对应那次操作所在的回放时间线，从成交记录上抄。开仓的章优先——
 * 回填事件的时间戳取的是开仓时刻（tradeRecordTimeMs）；没有再取平仓的。都没有就不写这个字段。
 */
function recordEventTimelineId(
  record: Pick<TradeRecord, 'openedTimelineId' | 'closedTimelineId'> | null | undefined,
): Pick<CampaignEvent, 'timeline_id'> {
  const timelineId = record?.openedTimelineId ?? record?.closedTimelineId ?? null;
  return timelineId ? { timeline_id: timelineId } : {};
}

function campaignEventFromTradeRecord(
  record: TradeRecord,
  legRole: LegRole,
  timestamp: string,
  now: string,
  overrides: Partial<CampaignEvent> = {},
): CampaignEvent {
  return {
    id: crypto.randomUUID(),
    timestamp,
    event_type: 'historical_leg_attached',
    leg_role: legRole,
    journal_id: null,
    trade_record_id: record.id,
    pending_order_id: null,
    price: record.entryPrice,
    size_usdt: tradeRecordPositionSize(record),
    notes: 'classified retroactively · 仓位历史记录',
    recorded_at: now,
    direction: tradeRecordDirection(record),
    leverage: record.leverage,
    order_kind: inferOrderKindFromLegRole(legRole),
    open_time: toIso(record.openTime),
    close_time: toIso(record.closeTime),
    operation_time: toIso(tradeRecordOperationTime(record)),
    entry_price: record.entryPrice,
    exit_price: record.exitPrice,
    realized_pnl: record.pnl,
    r_multiple: null,
    ...recordEventTimelineId(record),
    ...overrides,
  };
}

function campaignEventFromJournal(
  journal: TradeJournal,
  legRole: LegRole,
  now: string,
  notes: string | null,
  record: TradeRecord | null = null,
): CampaignEvent {
  const recordOpenTime = record ? toIso(record.openTime) : null;
  const recordCloseTime = record ? toIso(record.closeTime) : null;
  return {
    id: crypto.randomUUID(),
    timestamp: journal.pre_simulated_time,
    event_type: 'historical_leg_attached',
    leg_role: legRole,
    journal_id: journal.id,
    trade_record_id: journal.trade_record_id,
    pending_order_id: null,
    price: record?.entryPrice ?? journal.pre_entry_price,
    size_usdt: record ? tradeRecordPositionSize(record) : journal.pre_position_size,
    notes,
    recorded_at: now,
    direction: record ? tradeRecordDirection(record) : journal.direction,
    leverage: record?.leverage ?? journal.leverage,
    leg_sequence: journal.leg_sequence,
    order_kind: journal.order_kind,
    hedge_type: journal.hedge_type ?? null,
    hedge_necessity_pct: journal.hedge_necessity_pct ?? null,
    open_time: recordOpenTime ?? journal.pre_simulated_time,
    close_time: recordCloseTime ?? journal.post_simulated_close_time
      ?? (journal.source === 'retroactive_from_record' ? journal.post_real_close_time : null),
    operation_time: toIso(journalOperationTime(journal, record)),
    entry_price: record?.entryPrice ?? journal.pre_entry_price,
    exit_price: record?.exitPrice ?? journal.post_exit_price_snapshot ?? null,
    realized_pnl: record?.pnl ?? journal.post_realized_pnl,
    r_multiple: journal.post_r_multiple,
    // 实时腿的快照带着锁定时刻的时间线（本地镜像）；没有就从关联成交记录上抄。
    ...(journal.pre_timeline_id ? { timeline_id: journal.pre_timeline_id } : recordEventTimelineId(record)),
  };
}

function synthesizeJournalFromRecord(
  campaign: TradeCampaign,
  record: TradeRecord,
  event: CampaignEvent,
  sequence: number,
): TradeJournal {
  const timestamp = toIso(tradeRecordTimeMs(record)) ?? event.timestamp;
  const now = event.recorded_at || campaign.created_at || '';
  return {
    id: event.journal_id ?? `record-${record.id}`,
    user_id: campaign.user_id,
    trade_record_id: record.id,
    campaign_id: campaign.id,
    leg_role: event.leg_role ?? 'standalone',
    leg_sequence: event.leg_sequence ?? sequence,
    source: 'retroactive_from_record',
    symbol: record.symbol,
    direction: tradeRecordDirection(record),
    leverage: record.leverage,
    position_mode: 'isolated',
    order_kind: event.order_kind ?? (event.leg_role?.startsWith('hedge_') ? 'hedge' : 'main'),
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
    pre_settlement_mode: record.settlementMode ?? 'usdt',
    pre_settlement_asset: record.settlementAsset ?? (record.settlementMode === 'coin' ? null : 'USDT'),
    pre_contract_size_usd: record.contractSizeUsd ?? null,
    pre_contracts: record.contracts ?? null,
    pre_max_loss_usdt: null,
    hedge_type: event.hedge_type ?? null,
    hedge_necessity_pct: event.hedge_necessity_pct ?? null,
    post_outcome: tradeRecordOutcome(record),
    post_realized_pnl: record.pnl,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    post_real_close_time: toIso(tradeRecordOperationTime(record)),
    post_simulated_close_time: toIso(record.closeTime),
    post_exit_price_snapshot: record.exitPrice,
    reason_was_rewritten: false,
    created_at: now,
    updated_at: now,
  };
}

function eventIdentity(event: CampaignEvent): string {
  return event.journal_id ?? event.trade_record_id ?? event.id;
}

function isLegSourceEvent(event: CampaignEvent): boolean {
  return Boolean(event.leg_role)
    && (
      event.event_type === 'historical_leg_attached' ||
      event.event_type === 'main_opened' ||
      event.event_type === 'hedge_placed' ||
      event.event_type === 'hedge_triggered' ||
      event.event_type === 'mirror_tp_placed' ||
      event.event_type === 'mirror_tp_triggered'
    );
}

function isLegCloseEvent(event: CampaignEvent, source: CampaignEvent): boolean {
  const sameLeg = eventIdentity(event) === eventIdentity(source);
  if (!sameLeg) return false;
  if (source.leg_role === 'mirror_tp') return event.event_type === 'mirror_tp_triggered';
  if (source.leg_role?.startsWith('hedge_') || source.leg_role === 'reentry_hedge') {
    return event.event_type === 'campaign_closed';
  }
  return event.event_type === 'main_fully_closed' || event.event_type === 'main_partial_closed';
}

function synthesizeJournalFromEvent(
  campaign: TradeCampaign,
  event: CampaignEvent,
  sequence: number,
  closeEvent: CampaignEvent | null,
): TradeJournal {
  const now = event.recorded_at || campaign.created_at || '';
  const role = event.leg_role ?? 'standalone';
  const direction = inferDirectionFromLegRole(campaign, role, event.direction);
  const closeTime = event.close_time ?? closeEvent?.timestamp ?? campaign.closed_at ?? null;
  const entryPrice = event.entry_price ?? event.price ?? null;
  const exitPrice = event.exit_price ?? closeEvent?.price ?? null;
  const id = event.journal_id
    ?? (event.trade_record_id ? `record-${event.trade_record_id}` : `event-${event.id}`);

  return {
    id,
    user_id: campaign.user_id,
    trade_record_id: event.trade_record_id,
    campaign_id: campaign.id,
    leg_role: role,
    leg_sequence: event.leg_sequence ?? sequence,
    source: 'retroactive_from_record',
    symbol: campaign.symbol,
    direction,
    leverage: event.leverage ?? campaign.initial_leverage,
    position_mode: 'isolated',
    order_kind: event.order_kind ?? inferOrderKindFromLegRole(role),
    pre_simulated_time: event.open_time ?? event.timestamp,
    pre_real_time: now,
    pre_entry_price: entryPrice,
    pre_planned_stop_loss: null,
    pre_planned_take_profit: null,
    pre_entry_reason: '[战役事件还原] 由被关注者原始战役事件流恢复',
    pre_mental_state: 3,
    pre_mental_trigger: null,
    pre_risk_awareness: null,
    pre_risk_management: null,
    pre_checklist_items: null,
    pre_checklist_passed: null,
    pre_position_size: event.size_usdt,
    pre_settlement_mode: null,
    pre_settlement_asset: null,
    pre_contract_size_usd: null,
    pre_contracts: null,
    pre_max_loss_usdt: null,
    hedge_type: event.hedge_type ?? null,
    hedge_necessity_pct: event.hedge_necessity_pct ?? null,
    post_outcome: event.realized_pnl != null
      ? tradeRecordOutcome({ pnl: event.realized_pnl })
      : null,
    post_realized_pnl: event.realized_pnl ?? null,
    post_r_multiple: event.r_multiple ?? null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    post_real_close_time: event.operation_time ?? null,
    post_simulated_close_time: closeTime,
    reason_was_rewritten: false,
    created_at: now,
    updated_at: now,
    ...(exitPrice != null ? { post_exit_price_snapshot: exitPrice } : {}),
  } as TradeJournal;
}

function synthesizeCampaignLegsFromEvents(
  campaign: TradeCampaign,
  tradeRecordMap = getTradeRecordMapForUser(campaign.user_id),
): TradeJournal[] {
  const seen = new Set<string>();
  const events = [...(campaign.actual_evolution ?? [])]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return events
    .filter(isLegSourceEvent)
    .flatMap((event) => {
      const key = eventIdentity(event);
      if (seen.has(key)) return [];
      seen.add(key);
      const record = event.trade_record_id ? tradeRecordMap.get(event.trade_record_id) ?? null : null;
      if (record) return [synthesizeJournalFromRecord(campaign, record, event, seen.size)];
      const closeEvent = events.find(item => item !== event && isLegCloseEvent(item, event)) ?? null;
      return [synthesizeJournalFromEvent(campaign, event, seen.size, closeEvent)];
    });
}

/**
 * 挂出但未触发的镜像止盈，也要出现在 legs 里。
 *
 * 未触发意味着没有成交记录，因而永远不会有 trade_journals 行——它只以
 * `mirror_tp_placed` 事件存在。而非历史战役只要有 DB legs 就整体丢弃合成 leg，
 * 于是这笔挂单在明细与导出里彻底消失，Legs 构成显示「TP 0」，看不出这场战役
 * 究竟挂没挂过镜像止盈。
 *
 * 这里只补「一个 mirror_tp leg 都没有」的情形，不动已有的任何 leg：
 * 已触发的镜像止盈本就有 DB leg，不会被重复补一行。
 */
export function appendUntriggeredMirrorTpLeg(
  campaign: TradeCampaign,
  legs: TradeJournal[],
): TradeJournal[] {
  if (legs.some(leg => leg.leg_role === 'mirror_tp')) return legs;
  const events = [...(campaign.actual_evolution ?? [])]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  // 有触发事件说明它成交过，缺 DB leg 属于另一类问题，不在此处臆造
  if (events.some(event => event.event_type === 'mirror_tp_triggered')) return legs;
  const placed = events.find(event => (
    event.event_type === 'mirror_tp_placed' && event.leg_role === 'mirror_tp'
  ));
  if (!placed) return legs;
  return [...legs, synthesizeJournalFromEvent(campaign, placed, legs.length + 1, null)];
}

function mergeCampaignLegSnapshots(primary: TradeJournal, fallback: TradeJournal): TradeJournal {
  const merged = { ...fallback, ...primary } as TradeJournal;
  for (const key of Object.keys(fallback) as Array<keyof TradeJournal>) {
    if (primary[key] == null && fallback[key] != null) {
      (merged as Record<keyof TradeJournal, unknown>)[key] = fallback[key];
    }
  }
  return merged;
}

/**
 * Historical campaigns may contain a partially persisted trade_journals set while
 * actual_evolution still has every classified leg. Merge both sources so an older
 * campaign never loses the event-only rows in its detail view or PNG export.
 */
function mergeHistoricalCampaignLegs(
  databaseLegs: TradeJournal[],
  eventLegs: TradeJournal[],
): TradeJournal[] {
  const merged = [...databaseLegs];
  const indexById = new Map(merged.map((leg, index) => [leg.id, index]));
  const indexByRecordId = new Map(
    merged.flatMap((leg, index) => leg.trade_record_id ? [[leg.trade_record_id, index] as const] : []),
  );

  for (const eventLeg of eventLegs) {
    const existingIndex = indexById.get(eventLeg.id)
      ?? (eventLeg.trade_record_id ? indexByRecordId.get(eventLeg.trade_record_id) : undefined);
    if (existingIndex == null) {
      const nextIndex = merged.length;
      merged.push(eventLeg);
      indexById.set(eventLeg.id, nextIndex);
      if (eventLeg.trade_record_id) indexByRecordId.set(eventLeg.trade_record_id, nextIndex);
      continue;
    }
    merged[existingIndex] = mergeCampaignLegSnapshots(merged[existingIndex], eventLeg);
  }

  return merged
    .sort((a, b) => {
      const sequenceA = a.leg_sequence ?? Number.POSITIVE_INFINITY;
      const sequenceB = b.leg_sequence ?? Number.POSITIVE_INFINITY;
      if (sequenceA !== sequenceB) return sequenceA - sequenceB;
      return journalTimeMs(a) - journalTimeMs(b);
    })
    .map((leg, index) => ({ ...leg, leg_sequence: index + 1 }));
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

function getTradeRecordsForUser(userId: string): TradeRecord[] {
  return readUserScopedStorage<TradeRecord[]>(userId, 'trade_history', []);
}

function getTradeRecordMapForUser(userId: string) {
  return buildTradeRecordLookup(getTradeRecordsForUser(userId));
}

export function deriveCampaignPatchFromLegs(
  currentCampaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  /**
   * 平仓价校正（按平仓时刻的客观 1 分钟 K 线校验）。详情页的已实现 P&L、Legs 表合计、
   * 导出 PNG 全部叠着它算；这里不叠，落库的状态与金额就会与界面反号——
   * TUTUSDT 2026-08-09：库里 closed_profit / +469.96，界面 −1756.65。
   */
  exitPriceCorrections: LegExitPriceCorrections = {},
): MutableCampaignPatch {
  // 收数组而不是收折叠后的 map：一个仓位分几刀平掉时，map 只留最后一刀，
  // 落库的 final_realized_pnl 会因此少计前面几刀，与界面对不上。
  const tradeRecordMap = buildTradeRecordLookup(tradeRecords);
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
  // 与盈亏概览、Legs 表同源。此前这里是 post_realized_pnl 优先、record 兜底，
  // 而 Legs 表恰好相反，两处对同一条腿可能取到不同的数。
  const settlement = computeCampaignRealizedPnl(currentCampaign, ordered, tradeRecords, exitPriceCorrections);
  const totalPnl = settlement.total ?? 0;
  const totalPlannedMaxLoss = ordered.reduce((sum, leg) => sum + (leg.pre_max_loss_usdt ?? 0), 0);
  const closeTimes = ordered
    .map(leg => leg.trade_record_id ? tradeRecordMap.get(leg.trade_record_id)?.closeTime ?? null : null)
    .filter((time): time is number => typeof time === 'number');

  /**
   * 能不能**正面**算出这场的收盘时刻：每条腿都挂了成交 id，且每一条都能在
   * 本地成交历史里查到 closeTime。
   *
   * 关键在于这个函数的结果会被 healCampaignSummarySnapshots 直接 UPDATE 回库，
   * 而 tradeRecords 来自 localStorage 的 trade_history —— 那是**缓存，不是真相**。
   * 用户在「历史成交」里删过数据、换了浏览器、云端水化还没跑完、或者腿上存的是
   * 仓位 id 而对应记录已被清理，这里都会查不到。
   *
   * 以前查不到就直接写 closed_at = null / status = 'active'，于是每打开一次战役列表，
   * getCampaignFullData → heal → UPDATE 就把一场早已打完的战役**永久改回「进行中」**。
   * 这既是「已结束战役时不时冒出来」的成因，也是「一键结束点了没作用」的成因：
   * 结束确实写进去了，下一次读列表又被 heal 改了回来。
   *
   * 查不到只意味着「算不出」，绝不等于「没结束」。算不出时一律保留库里已有的值。
   * 代价：若用户事后拆走一条腿让战役真的不再完整，旧的 closed_at 会残留，
   * 需要显式重新结束——比起静默抹掉用户已确认的结束状态，这个方向是对的。
   */
  const canResolveCloseTimes = allHaveTradeRecord && closeTimes.length === ordered.length;
  const computedClosedAt = canResolveCloseTimes ? toIso(Math.max(...closeTimes)) : null;
  const closedAt = computedClosedAt ?? currentCampaign.closed_at ?? null;

  // 状态与金额同源：「亏损结束」配一个绿色正数在构造上不再可能。
  let status: CampaignStatus;
  if (canResolveCloseTimes) {
    status = campaignStatusFromRealizedPnl({ total: settlement.total, settled: true }, computedClosedAt);
  } else if (currentCampaign.closed_at) {
    status = currentCampaign.status;   // 已结束的一律保留，不因本地查不到记录而降级
  } else {
    status = 'active';                 // 本来就没结束
  }

  return {
    opened_at: openedAt,
    closed_at: closedAt,
    direction: mainOpen ? toCampaignDirection(mainOpen.direction) : currentCampaign.direction,
    status,
    initial_main_size_usdt: mainOpen?.pre_position_size ?? currentCampaign.initial_main_size_usdt,
    initial_leverage: mainOpen?.leverage ?? currentCampaign.initial_leverage,
    // 同上：算不出时保留落库值，不要用 null 把已经对过账的金额抹掉。
    final_realized_pnl: allHaveTradeRecord ? totalPnl : (currentCampaign.final_realized_pnl ?? null),
    final_r_multiple: allHaveTradeRecord && totalPlannedMaxLoss > 0
      ? totalPnl / totalPlannedMaxLoss
      : (currentCampaign.final_r_multiple ?? null),
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

/**
 * 拉平仓价校正的等待上限。
 *
 * K 线接口自身没有超时：连接卡死（不是拒绝、不是 429，是一直不回）时 fetch 会挂到浏览器
 * 自己的超时（分钟级）。详情页首屏在等 getCampaignFullData——以前它先画落库值、校正异步到达，
 * 现在自愈要先拿校正，不能因此把首屏挂死。到点就当作「没拉齐」：不回写、返回空校正；
 * 底层请求仍在缓存里继续跑，页面自己的那次拉取命中同一个 promise，校正到了照常刷新界面，
 * 下一次打开详情再收敛落库值。
 */
export const CAMPAIGN_CORRECTIONS_FETCH_TIMEOUT_MS = 5_000;

// 每次新建：这个对象会原样进详情页的 React state，不能几次调用共用一份。
const incompleteCorrections = (): LegExitPriceCorrectionsResult => ({ corrections: {}, complete: false });

/** 有界等待：超时、抛错一律按「不完整」处理，绝不让调用方悬着。 */
function fetchCorrectionsWithin(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  timeoutMs = CAMPAIGN_CORRECTIONS_FETCH_TIMEOUT_MS,
): Promise<LegExitPriceCorrectionsResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<LegExitPriceCorrectionsResult>(resolve => {
    timer = setTimeout(() => resolve(incompleteCorrections()), timeoutMs);
  });
  const request = fetchLegExitPriceCorrectionsResult(campaign.symbol, legs, tradeRecords)
    .catch(incompleteCorrections);
  return Promise.race([request, deadline]).finally(() => clearTimeout(timer));
}

/**
 * 变更路径（挂接 / 解除腿、修正成交记录）用的校正拉取。
 * 这些路径**必须**写一笔——腿变了，落库值不能停在旧腿上——所以拿到什么用什么，
 * 拉不完整也照写；下一次打开详情（只在校正完整时回写）会把它收敛到校正后的值。
 */
async function fetchCorrectionsForMutation(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
): Promise<LegExitPriceCorrections> {
  return (await fetchCorrectionsWithin(campaign, legs, tradeRecords)).corrections;
}

async function recomputeCampaignDerivedFields(campaignId: string): Promise<TradeCampaign> {
  const { campaign, legs } = await getCampaignWithLegs(campaignId);
  const tradeRecords = getTradeRecordsForUser(campaign.user_id);
  const corrections = await fetchCorrectionsForMutation(campaign, legs, tradeRecords);
  const patch = deriveCampaignPatchFromLegs(campaign, legs, tradeRecords, corrections);
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

function campaignEventMatchesTradeRecord(event: CampaignEvent, record: TradeRecord, journalIds: Set<string>): boolean {
  return event.trade_record_id === record.id || (event.journal_id != null && journalIds.has(event.journal_id));
}

function normalizeCampaignEventForTradeRecord(event: CampaignEvent, record: TradeRecord): CampaignEvent {
  const openIso = toIso(record.openTime);
  const closeIso = toIso(record.closeTime);
  const next: CampaignEvent = {
    ...event,
    trade_record_id: record.id,
    direction: tradeRecordDirection(record),
    leverage: record.leverage,
    operation_time: toIso(tradeRecordOperationTime(record)),
    open_time: openIso,
    close_time: closeIso,
    entry_price: record.entryPrice,
    exit_price: record.exitPrice,
    realized_pnl: record.pnl,
    size_usdt: tradeRecordPositionSize(record),
  };
  if (
    event.event_type === 'main_partial_closed' ||
    event.event_type === 'main_fully_closed' ||
    event.event_type === 'mirror_tp_triggered'
  ) {
    next.timestamp = closeIso ?? event.timestamp;
    next.price = record.exitPrice;
  } else if (event.event_type === 'hedge_triggered') {
    next.timestamp = openIso ?? event.timestamp;
    next.price = record.entryPrice;
  }
  return next;
}

async function syncTradeRecordCorrectionToCampaigns(record: TradeRecord, journals: TradeJournal[]): Promise<void> {
  const campaignIds = Array.from(new Set(journals.map(journal => journal.campaign_id).filter((id): id is string => Boolean(id))));
  if (campaignIds.length === 0) return;
  const journalIds = new Set(journals.map(journal => journal.id));

  for (const campaignId of campaignIds) {
    const { campaign, legs } = await getCampaignWithLegs(campaignId);
    // 被修正的那条记录以修正后的版本参与重算（其余保持磁盘上的版本）
    const userRecords = getTradeRecordsForUser(campaign.user_id)
      .map(item => (item.id === record.id ? record : item));
    if (!userRecords.some(item => item.id === record.id)) userRecords.push(record);
    const corrections = await fetchCorrectionsForMutation(campaign, legs, userRecords);
    const derived = deriveCampaignPatchFromLegs(campaign, legs, userRecords, corrections);
    const actual_evolution = (campaign.actual_evolution ?? []).map(event => (
      campaignEventMatchesTradeRecord(event, record, journalIds)
        ? normalizeCampaignEventForTradeRecord(event, record)
        : event
    ));
    const patch: MutableCampaignPatch = { ...derived, actual_evolution };
    const { data, error } = await supabase
      .from('trade_campaigns' as never)
      .update(patch as never)
      .eq('id', campaignId)
      .select()
      .single();
    if (error) {
      if (isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error)) {
        upsertLocalCampaign({
          ...campaign,
          ...patch,
          updated_at: new Date().toISOString(),
        });
        continue;
      }
      throw new Error(`同步战役平仓时间失败：${error.message}`);
    }
    upsertLocalCampaign(toCampaign(data));
  }
}

function campaignPatchChanged(campaign: TradeCampaign, patch: MutableCampaignPatch): boolean {
  const textFields: Array<'opened_at' | 'closed_at' | 'direction' | 'status'> = [
    'opened_at',
    'closed_at',
    'direction',
    'status',
  ];
  // 金额字段按容差比：严格 !== 会把一次 DB 浮点往返也判成「变了」，每次读取都重写一遍。
  const numberFields: Array<'initial_main_size_usdt' | 'initial_leverage' | 'final_realized_pnl' | 'final_r_multiple'> = [
    'initial_main_size_usdt',
    'initial_leverage',
    'final_realized_pnl',
    'final_r_multiple',
  ];
  return textFields.some(field => patch[field] !== undefined && campaign[field] !== patch[field])
    || numberFields.some(field => patch[field] !== undefined
      && materiallyDifferentPnl(campaign[field] ?? null, patch[field] ?? null));
}

async function healCampaignSummarySnapshots(
  campaign: TradeCampaign,
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  corrections: LegExitPriceCorrectionsResult,
): Promise<TradeCampaign> {
  /**
   * 只在校正**完整**时回写。这是「不来回翻转」的全部依据：
   * 这里是唯一一条读路径上的写，它写的东西是腿、成交记录与不可变历史 K 线的纯函数，
   * 任何一次拿齐校正的读都会推出同一份补丁，于是 campaignPatchChanged 为 false、不再写。
   * 拉不齐就什么都不写——限流 / 断网 / 超时，以及本地查不到某条腿的成交记录都算拉不齐：
   * 否则一次网络抖动、或换一台没有成交记录的浏览器，会把未校正的 +469.96 / 盈利
   * 写回库，下一次拿齐时又改成 −1756.65 / 亏损，状态在两个值之间来回跳。
   */
  if (!corrections.complete) return campaign;
  // 门槛改用「每条腿都结算完毕」而不是「每条腿都能在 lookup 里查到成交记录」：
  // 后者把「只有复盘快照、本地没有成交记录」的历史战役永久挡在自愈之外，
  // 于是存量数据永远收敛不到新口径。落库值是缓存，能重算出来就该让它收敛。
  const settlement = computeCampaignRealizedPnl(campaign, legs, tradeRecords, corrections.corrections);
  if (!settlement.settled) return campaign;
  const patch = deriveCampaignPatchFromLegs(campaign, legs, tradeRecords, corrections.corrections);

  /**
   * 纵深防御。这是一次**写在读路径上**的自愈：每打开一次战役列表，每一场都会走到这里。
   * 自愈的职责是把缺的补上、把陈的刷新，**不包括把用户已确认的结束状态抹掉**。
   * derive 已经不再降级，这里再钉一道——将来谁改 derive 也不会静默地把库改坏。
   */
  if (campaign.closed_at && (patch.closed_at == null || patch.status === 'active')) {
    return campaign;
  }
  if (!campaignPatchChanged(campaign, patch)) return campaign;

  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .update(patch as never)
    .eq('id', campaign.id)
    .select()
    .single();
  if (error) {
    if (isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error)) {
      /**
       * 云端没有这一行（本地战役 / 这张表不存在）：补丁只打在**此刻**的镜像行上，不把开头读到的整行写回去。
       * 这是一次写在读路径上的自愈，列表页的后台自愈还会与页面的写并行（页面闸到点就放行）：
       * 写回整行会把这期间落下的删除墓碑、改名一并盖掉——那是一次静默的「复活已删战役」。
       * 镜像行已经没了（永久删除）或已带 deleted_at 就什么都不写：已删的战役不必收敛，
       * 恢复之后下一次读取照常把它收敛过来。补丁的推导与这里改不改一个字都没关系。
       */
      const mirror = findLocalCampaign(campaign.user_id, campaign.id);
      if (mirror && !mirror.deleted_at) {
        upsertLocalCampaign({ ...mirror, ...patch, updated_at: new Date().toISOString() });
      }
      return { ...campaign, ...patch };
    }
    console.warn('[journalApi] 回填战役汇总平仓时间失败', error);
    return { ...campaign, ...patch };
  }
  const updated = toCampaign(data);
  /**
   * 只更新本地已有的镜像行（同 updateCampaign 的 writeLocalMirror），不插整行：
   * getCampaignWithLegs 不过滤已删除的行，插进去的副本可能带着 deleted_at；
   * 这场之后在别处软删再恢复时，mergeCampaigns 让本地带 deleted_at 的副本胜出，恢复的战役就被藏起来了。
   * 已带墓碑的镜像行同样一个字都不写，立场与上面「找不到」的兜底一致：部署的库还没有 deleted_at 列时，
   * 软删只存在于这条墓碑里（见 deleteCampaign 与 mergeCampaigns），而服务端返回的行不带 deleted_at——
   * 原样写回去就是把自愈进行中落地的那次删除悄悄撤销（列表页的后台自愈与页面的写并行，页面闸到点就放行）。
   * 已删的战役不必收敛，恢复之后下一次读取照常把它收敛过来。
   */
  const mirror = findLocalCampaign(updated.user_id, updated.id);
  if (mirror && !mirror.deleted_at) upsertLocalCampaign(updated);
  return updated;
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

/**
 * 更新战役。
 *
 * 这里此前把两件完全不同的事压成了同一个分支：
 *   ① 这行在云端**不存在**（本地建的战役，只在 localStorage 里）
 *   ② 这行存在，但这次 UPDATE **一行都没匹配上**（不是本人的战役、
 *      RLS 的 UPDATE 策略缺失、或者登录会话已过期导致 auth.uid() 为 NULL）
 *
 * 因为用的是 `.single()`，②在 PostgREST 那边返回的是 406 + PGRST116
 * 「JSON object requested, multiple (or no) rows returned」——与①的报错**一模一样**。
 * 于是 ② 被 isCampaignNotFoundError 认成 ①，退去写 localStorage：
 * 本地恰好有镜像就**假装成功**（云端其实没写进去），本地没有镜像就抛出那句
 * 谁也看不懂的 PostgREST 原文。「一键结束点了没反应」正是后一种。
 *
 * 现在把两件事拆开：
 *   · 显式带上 user_id 条件——0 行不再由 RLS 静默过滤，而是由我们自己的条件决定；
 *   · 用 maybeSingle()——0 行返回 data === null 且 error 为空，不再伪装成「找不到」；
 *   · 0 行且本地也没有镜像时，报出**能照着排查的那句话**，而不是 PostgREST 原文。
 */
export async function updateCampaign(
  id: string,
  patch: Partial<Pick<TradeCampaign, 'title' | 'status' | 'notes' | 'closed_at' | 'final_realized_pnl' | 'final_r_multiple' | 'peak_unrealized_pnl' | 'peak_drawdown'>>,
): Promise<TradeCampaign> {
  const userId = await getAuthenticatedUserId('更新战役');

  const writeLocalMirror = (): TradeCampaign | null => {
    const local = findLocalCampaign(userId, id);
    if (!local) return null;
    const updated = { ...local, ...patch, updated_at: new Date().toISOString() };
    upsertLocalCampaign(updated);
    return updated;
  };

  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .update(patch as never)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle();

  if (error) {
    if (isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error)) {
      const local = writeLocalMirror();
      if (local) return local;
    }
    return wrap('更新战役', error, null);
  }

  if (!data) {
    // 没有 error 却 0 行：条件没匹配上。本地有镜像就是一场纯本地战役，正常落本地；
    // 本地也没有，就说明这行只存在于云端而我们写不动它——必须说出来，不能假装成功。
    const local = writeLocalMirror();
    if (local) return local;
    throw new Error(
      `更新战役失败：云端 0 行被更新（id=${id}）。`
      + `可能是登录会话已过期（请重新登录再试），`
      + `或这场战役不属于当前账号，`
      + `或 trade_campaigns 的 UPDATE 策略缺失。`,
    );
  }

  return toCampaign(data);
}

export async function updateCampaignImportance(id: string, importanceWeight: number): Promise<number> {
  const userId = await getAuthenticatedUserId('更新战役重要性');
  const normalized = normalizeCampaignImportance(importanceWeight);
  upsertLocalCampaignPreference(userId, id, { importance_weight: normalized });

  const { error } = await supabase
    .from('trade_campaigns' as never)
    .update({ importance_weight: normalized } as never)
    .eq('id', id);

  if (error) {
    if (isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error) || isMissingCampaignImportanceColumnError(error)) {
      return normalized;
    }
    throw new Error(`更新战役重要性失败：${error.message}`);
  }

  const local = findLocalCampaign(userId, id);
  if (local) {
    upsertLocalCampaign({ ...local, importance_weight: normalized, updated_at: new Date().toISOString() });
  }
  return normalized;
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

async function campaignForDeletionFallback(userId: string, id: string): Promise<TradeCampaign | null> {
  const local = findLocalCampaign(userId, id);
  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error)) return local;
    throw new Error(`读取待删除战役失败：${error.message}`);
  }
  return data ? toCampaign(data) : local;
}

export async function deleteCampaign(id: string): Promise<void> {
  const userId = await getAuthenticatedUserId('删除战役');
  const fallbackCampaign = await campaignForDeletionFallback(userId, id);
  const deletedAt = new Date().toISOString();
  const { error } = await supabase
    .from('trade_campaigns' as never)
    .update({ deleted_at: deletedAt } as never)
    .eq('id', id)
    .eq('user_id', userId);
  if (error) {
    if (
      isMissingTradeCampaignsTableError(error)
      || isCampaignNotFoundError(error)
      || isMissingCampaignDeletedAtColumnError(error)
    ) {
      if (fallbackCampaign) {
        upsertLocalCampaign({ ...fallbackCampaign, deleted_at: deletedAt, updated_at: deletedAt });
      }
      return;
    }
    throw new Error(`删除战役失败：${error.message}`);
  }

  if (fallbackCampaign) {
    upsertLocalCampaign({ ...fallbackCampaign, deleted_at: deletedAt, updated_at: deletedAt });
  }
}

export async function restoreCampaign(id: string): Promise<void> {
  const userId = await getAuthenticatedUserId('恢复战役');
  const local = findLocalCampaign(userId, id);
  const restoredAt = new Date().toISOString();
  const { error } = await supabase
    .from('trade_campaigns' as never)
    .update({ deleted_at: null } as never)
    .eq('id', id)
    .eq('user_id', userId);
  if (error && !(
    isMissingTradeCampaignsTableError(error)
    || isCampaignNotFoundError(error)
    || isMissingCampaignDeletedAtColumnError(error)
  )) {
    throw new Error(`恢复战役失败：${error.message}`);
  }
  if (local) {
    upsertLocalCampaign({ ...local, deleted_at: null, updated_at: restoredAt });
  }
}

export async function permanentlyDeleteCampaign(id: string): Promise<void> {
  const userId = await getAuthenticatedUserId('永久删除战役');
  const { error } = await supabase
    .from('trade_campaigns' as never)
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error && !(isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error))) {
    throw new Error(`永久删除战役失败：${error.message}`);
  }
  removeLocalCampaign(userId, id);
  removeLocalCampaignPreference(userId, id);
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
    if (isMissingTradeCampaignsTableError(error)) return withCampaignPreferences(userId, activeCampaignRows(local));
    return wrap('加载进行中的战役', error, (data ?? []).map(toCampaign));
  }
  return withCampaignPreferences(userId, activeCampaignRows(mergeCampaigns((data ?? []).map(toCampaign), local)));
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
    if (isMissingTradeCampaignsTableError(error)) return withCampaignPreferences(userId, activeCampaignRows(local));
    return wrap('加载战役列表', error, (data ?? []).map(toCampaign));
  }
  return withCampaignPreferences(userId, activeCampaignRows(mergeCampaigns((data ?? []).map(toCampaign), local)));
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
    if (isMissingTradeCampaignsTableError(error)) return withCampaignPreferences(userId, activeCampaignRows(local));
    return wrap('加载可见战役列表', error, (data ?? []).map(toCampaign));
  }
  return withCampaignPreferences(userId, activeCampaignRows(mergeCampaigns((data ?? []).map(toCampaign), local)));
}

export async function listDeletedCampaigns(userId: string): Promise<TradeCampaign[]> {
  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  const local = readLocalCampaigns(userId);
  if (error) {
    if (isMissingTradeCampaignsTableError(error)) {
      return deletedCampaignRows(withCampaignPreferences(userId, local));
    }
    return wrap('加载已删除战役', error, [] as TradeCampaign[]);
  }
  return deletedCampaignRows(withCampaignPreferences(
    userId,
    mergeCampaigns((data ?? []).map(toCampaign), local),
  ));
}

/**
 * 战役腿的后处理：合成腿与已落库的腿使用同一归类口径。
 *
 * 单场（getCampaignWithLegs）与批量（getCampaignsWithLegs）共用这一份。
 * 抽出来是因为列表页要批量取数：147 场各发 3 个查询 = 441 次往返，
 * 而这段逻辑一旦复制成两份，两个页面迟早给出不同的腿。
 */
function assembleCampaignLegs(
  campaign: TradeCampaign,
  dbLegs: TradeJournal[],
  syntheticLegs = synthesizeCampaignLegsFromEvents(campaign),
): TradeJournal[] {
  return appendUntriggeredMirrorTpLeg(
    campaign,
    isHistoricalCampaign(campaign)
      ? mergeHistoricalCampaignLegs(dbLegs, syntheticLegs)
      : (dbLegs.length > 0 ? dbLegs : syntheticLegs),
  );
}

function hydrateCampaignLegs(
  userId: string,
  legs: TradeJournal[],
  siblings: TradeJournal[],
): TradeJournal[] {
  // 一次读取镜像；批量路径也只解析一次 JSON，且保留每条腿自己的归类元数据。
  return hydrateJournalReviews(applyLocalMirror(userId, [...legs, ...siblings])).slice(0, legs.length);
}

export interface CampaignWithLegs {
  campaign: TradeCampaign;
  legs: TradeJournal[];
}

const CAMPAIGN_SOURCE_PAGE_SIZE = 500;

/** 增量读取一次最多按 id 点名这么多行：PostgREST 的 in 过滤走 URL，太长会被拒。 */
const CAMPAIGN_SOURCE_ID_CHUNK = 100;

async function readCampaignSourcePages(
  table: 'trade_campaigns' | 'trade_journals',
  userId: string,
  options: { columns?: string; ids?: string[] } = {},
) {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += CAMPAIGN_SOURCE_PAGE_SIZE) {
    let query = supabase
      .from(table as never)
      .select(options.columns ?? '*')
      .eq('user_id', userId);
    if (options.ids) query = query.in('id', options.ids);
    const { data, error } = await query
      // 唯一键稳定排序，避免同时间记录在跨页时重复或漏读。
      .order('id', { ascending: true })
      .range(offset, offset + CAMPAIGN_SOURCE_PAGE_SIZE - 1);
    if (error) return { data: [], error };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < CAMPAIGN_SOURCE_PAGE_SIZE) return { data: rows, error: null };
  }
}

type CampaignSourceVersion = { id: string; updated_at?: string | null };
const sourceRowId = (row: unknown) => (row as { id?: string }).id;
const sourceRowVersion = (row: unknown) => (row as { updated_at?: string | null }).updated_at;

/**
 * 只取变了的行：先按 id + updated_at 列一遍目录（两张表各不到 1000 行时只是几十 KB），
 * 与上次的行比对，只把新增 / 改过的 id 点名读回来，删掉的按目录直接丢。
 * 两张表的 updated_at 都由 BEFORE UPDATE 触发器维护（migrations），改一行必然换版本；
 * 老行没有 updated_at 的每次都重读，多读几行不会漏。
 * 一行都没变时返回上次的同一个数组：装配与逐场比较都按引用短路。
 */
async function readCampaignSourceDelta(
  table: 'trade_campaigns' | 'trade_journals',
  userId: string,
  previous: unknown[],
) {
  const versions = await readCampaignSourcePages(table, userId, { columns: 'id, updated_at' });
  if (versions.error) return versions;
  const previousById = new Map(previous.map(row => [sourceRowId(row), row]));
  const changedIds: string[] = [];
  for (const version of versions.data as CampaignSourceVersion[]) {
    const before = previousById.get(version.id);
    if (!before || !version.updated_at || sourceRowVersion(before) !== version.updated_at) changedIds.push(version.id);
  }
  if (changedIds.length === 0 && versions.data.length === previous.length) return { data: previous, error: null };
  const changedById = new Map<string | undefined, unknown>();
  for (let offset = 0; offset < changedIds.length; offset += CAMPAIGN_SOURCE_ID_CHUNK) {
    const page = await readCampaignSourcePages(table, userId, { ids: changedIds.slice(offset, offset + CAMPAIGN_SOURCE_ID_CHUNK) });
    if (page.error) return page;
    for (const row of page.data) changedById.set(sourceRowId(row), row);
  }
  // 两次请求之间刚被删掉的行既不在点名结果里、也没有旧行：这次先不算，下次目录里自然没有它
  const data = (versions.data as CampaignSourceVersion[]).flatMap(version => {
    const row = changedById.get(version.id) ?? previousById.get(version.id);
    return row ? [row] : [];
  });
  return { data, error: null };
}

/** 两张表的原始行；装配（合成腿、镜像、评价水合）放在 assembleCampaignsWithLegs，本地成交变化时可以不重读远端。 */
export interface CampaignSourceRows {
  campaigns: unknown[];
  journals: unknown[];
}

/**
 * 列表共享一份完整数据源，替代逐场 campaign / legs / 评价兄弟记录查询。
 * 必须读取用户的全部 journals（包括未归类行），否则后补的成交评价会丢失。
 * 两张表都分页，避免 Supabase 默认的 1000 行上限静默截断图表。
 */
export interface FetchCampaignSourceRowsOptions {
  /** 上次读到的行：给了就只读变了的（见 readCampaignSourceDelta），没变的行沿用同一引用。 */
  previous?: CampaignSourceRows;
}

export async function fetchCampaignSourceRows(
  userId: string,
  options: FetchCampaignSourceRowsOptions = {},
): Promise<CampaignSourceRows> {
  const { previous } = options;
  const [campaignResult, journalResult] = await Promise.all([
    previous ? readCampaignSourceDelta('trade_campaigns', userId, previous.campaigns) : readCampaignSourcePages('trade_campaigns', userId),
    previous ? readCampaignSourceDelta('trade_journals', userId, previous.journals) : readCampaignSourcePages('trade_journals', userId),
  ]);
  if (campaignResult.error && !isMissingTradeCampaignsTableError(campaignResult.error)) {
    throw new Error(`加载战役列表失败：${campaignResult.error.message}`);
  }
  if (journalResult.error && !isMissingTradeJournalsFeatureError(journalResult.error)) {
    throw new Error(`加载战役 legs 失败：${journalResult.error.message}`);
  }
  return { campaigns: campaignResult.data, journals: journalResult.data };
}

export interface AssembleCampaignsOptions {
  /** 已在内存里的成交记录；不传则读本地存储（与单场路径同源）。 */
  tradeHistory?: TradeRecord[];
}

/**
 * 把远端原始行装配成列表用的战役与腿：合成腿、本地镜像、评价水合都只做一遍。
 * 纯本地、同步：合成腿依赖本地成交记录，成交变了只需在同一份远端行上重新装配。
 */
export function assembleCampaignsWithLegs(
  userId: string,
  rows: CampaignSourceRows,
  options: AssembleCampaignsOptions = {},
): CampaignWithLegs[] {
  const campaigns = withCampaignPreferences(userId, activeCampaignRows(mergeCampaigns(
    rows.campaigns.map(toCampaign),
    readLocalCampaigns(userId),
  )));
  const journals = rows.journals as TradeJournal[];
  const legsByCampaign = new Map<string, TradeJournal[]>();
  for (const leg of journals) {
    if (!leg.campaign_id) continue;
    const group = legsByCampaign.get(leg.campaign_id) ?? [];
    group.push(leg);
    legsByCampaign.set(leg.campaign_id, group);
  }
  const tradeRecordMap = options.tradeHistory
    ? buildTradeRecordLookup(options.tradeHistory)
    : getTradeRecordMapForUser(userId);
  const sources = campaigns.map(campaign => {
    const syntheticLegs = synthesizeCampaignLegsFromEvents(campaign, tradeRecordMap);
    const dbLegs = (legsByCampaign.get(campaign.id) ?? []).sort((a, b) => (
      (a.leg_sequence ?? Number.POSITIVE_INFINITY) - (b.leg_sequence ?? Number.POSITIVE_INFINITY)
    ));
    return { campaign, legs: assembleCampaignLegs(campaign, dbLegs, syntheticLegs) };
  });
  const hydrated = hydrateCampaignLegs(userId, sources.flatMap(source => source.legs), journals);
  let offset = 0;
  return sources.map(source => {
    const legs = hydrated.slice(offset, offset + source.legs.length);
    offset += source.legs.length;
    return { campaign: source.campaign, legs };
  });
}

export async function getCampaignsWithLegs(userId: string): Promise<CampaignWithLegs[]> {
  return assembleCampaignsWithLegs(userId, await fetchCampaignSourceRows(userId));
}

/** 本地存储的一次性快照。147 场各读一遍会把同一份 JSON 解析 588 次（实测 2~6 秒纯阻塞）。 */
export interface UserLocalSnapshot {
  tradeHistory: TradeRecord[];
  ordersMap: Record<string, PendingOrder[]>;
  cancelledOrders: CancelledOrderSnapshot[];
  filledOrders: FilledOrderSnapshot[];
  /**
   * 至今还开着的仓位（positions_map）。只用到仓位与每笔成交的 id（及它们的回放时间线章）；
   * 缺省视为没有开着的仓位。fills[0].id 恒等于 position.id；并进同一仓位的后几笔只在 fills 里留下自己的 id。
   */
  positionsMap?: Record<string, OpenPositionTimelineLike[]>;
  /**
   * 回放时间线登记表（replay_timelines_v1，见 lib/replayTimeline）。只供影子比对读，缺省视为空登记表——
   * 老数据没有章，登记表空不空都不影响启发式的结论。
   */
  replayTimelines?: ReplayTimelineRegistry | null;
}

export function readUserLocalSnapshot(userId: string): UserLocalSnapshot {
  return {
    tradeHistory: readUserScopedStorage<TradeRecord[]>(userId, 'trade_history', []),
    ordersMap: readUserScopedStorage<Record<string, PendingOrder[]>>(userId, 'orders_map', {}),
    cancelledOrders: readUserScopedStorage<CancelledOrderSnapshot[]>(userId, 'cancelled_orders', []),
    filledOrders: readUserScopedStorage<FilledOrderSnapshot[]>(userId, 'filled_orders', []),
    positionsMap: readUserScopedStorage<Record<string, OpenPositionTimelineLike[]>>(userId, 'positions_map', {}),
    replayTimelines: normalizeReplayTimelineRegistry(readUserScopedStorage<unknown>(userId, REPLAY_TIMELINES_STORAGE_KEY, null)),
  };
}

export interface UserLocalSnapshotReader {
  /**
   * 五个键的原文都没变时返回上一次的同一个对象；变了的键才重新解析，其余键沿用上次的数组引用。
   * 传了 overrides 的键直接用内存里的值（列表页从交易上下文拿到的同一批引用），不读、不解析本地存储。
   */
  read(overrides?: Partial<UserLocalSnapshot>): UserLocalSnapshot;
}

/**
 * 列表页每次本地核对都要读这份快照。原文（localStorage 里的字符串）与上次逐字相同的键不再 JSON.parse，
 * 且沿用同一引用：签名比较可以按引用短路，跨标的共用的预处理也能跟着复用。
 * 与 readUserLocalSnapshot 同一把钥匙、同一套兜底，只多一层「原文没变就不解析」。
 */
export function createUserLocalSnapshotReader(userId: string): UserLocalSnapshotReader {
  const entries = new Map<string, { raw: string | null; value: unknown }>();
  let last: UserLocalSnapshot | null = null;
  const read = <T>(key: string, fallback: T): T => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(`${getUserStoragePrefix(userId)}${key}`);
    } catch {
      raw = null;
    }
    const previous = entries.get(key);
    if (previous && previous.raw === raw) return previous.value as T;
    let value: T = fallback;
    if (raw) {
      try {
        value = JSON.parse(raw) as T;
      } catch {
        value = fallback;
      }
    }
    entries.set(key, { raw, value });
    return value;
  };
  // 登记表与 readUserLocalSnapshot 同一口径（缺失 / 坏 JSON → 空登记表）；原文没变就沿用上次规整出的同一个对象。
  let registrySource: unknown;
  let registry: ReplayTimelineRegistry | null = null;
  const readReplayTimelines = (): ReplayTimelineRegistry => {
    const source = read<unknown>(REPLAY_TIMELINES_STORAGE_KEY, null);
    if (registry && Object.is(source, registrySource)) return registry;
    registrySource = source;
    registry = normalizeReplayTimelineRegistry(source);
    return registry;
  };
  return {
    read(overrides = {}) {
      const next: UserLocalSnapshot = {
        tradeHistory: overrides.tradeHistory ?? read<TradeRecord[]>('trade_history', []),
        ordersMap: overrides.ordersMap ?? read<Record<string, PendingOrder[]>>('orders_map', {}),
        cancelledOrders: overrides.cancelledOrders ?? read<CancelledOrderSnapshot[]>('cancelled_orders', []),
        filledOrders: overrides.filledOrders ?? read<FilledOrderSnapshot[]>('filled_orders', []),
        positionsMap: overrides.positionsMap ?? read<Record<string, OpenPositionTimelineLike[]>>('positions_map', {}),
        replayTimelines: overrides.replayTimelines ?? readReplayTimelines(),
      };
      if (last && last.tradeHistory === next.tradeHistory && last.ordersMap === next.ordersMap
        && last.cancelledOrders === next.cancelledOrders && last.filledOrders === next.filledOrders
        && last.positionsMap === next.positionsMap && last.replayTimelines === next.replayTimelines) {
        return last;
      }
      last = next;
      return next;
    },
  };
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
  const resolvedUserId = resolvedCampaign.user_id;
  resolvedCampaign = withCampaignPreferences(resolvedUserId, [resolvedCampaign])[0] ?? resolvedCampaign;
  if (!resolvedCampaign) throw new Error('加载战役失败：返回数据为空');

  const { data: legs, error: lErr } = await supabase
    .from('trade_journals' as never)
    .select('*')
    .eq('campaign_id', campaignId)
    .order('leg_sequence', { ascending: true });
  let dbLegs: TradeJournal[] = [];
  if (lErr) {
    const syntheticLegs = resolvedCampaign ? synthesizeCampaignLegsFromEvents(resolvedCampaign) : [];
    if (syntheticLegs.length === 0 && !isMissingTradeJournalsFeatureError(lErr)) {
      throw new Error(`加载战役 legs 失败：${lErr.message}`);
    }
  } else {
    dbLegs = (legs ?? []) as unknown as TradeJournal[];
  }
  const syntheticLegs = synthesizeCampaignLegsFromEvents(resolvedCampaign);
  const resolvedLegs = assembleCampaignLegs(resolvedCampaign, dbLegs, syntheticLegs);
  const mirroredLegs = applyLocalMirror(resolvedUserId, resolvedLegs);
  const tradeRecordIds = Array.from(new Set(
    mirroredLegs
      .map(leg => leg.trade_record_id)
      .filter((id): id is string => Boolean(id)),
  ));
  let reviewSiblings: TradeJournal[] = [];
  if (tradeRecordIds.length > 0) {
    try {
      const { data: siblingRows, error: siblingError } = await supabase
        .from('trade_journals' as never)
        .select('*')
        .eq('user_id', resolvedUserId)
        .in('trade_record_id', tradeRecordIds);
      if (!siblingError) {
        reviewSiblings = (siblingRows ?? []) as unknown as TradeJournal[];
      } else {
        console.warn('[journalApi] 读取战役评价兄弟记录失败:', siblingError);
      }
    } catch (error) {
      // 旧测试适配器或极旧客户端可能没有 .in；不阻断战役主体读取。
      console.warn('[journalApi] 读取战役评价兄弟记录失败:', error);
    }
  }
  return {
    campaign: resolvedCampaign,
    // 平仓评价的扩展答案在远程 schema 尚未补齐时会落入本地镜像。
    // 战役详情、TXT/PNG 导出必须与日记列表使用同一份“远端 + 镜像”有效数据，
    // 否则只能读到 post_reviewed_at，却会把用户已经填写的答案导成“未填写”。
    legs: hydrateCampaignLegs(resolvedUserId, mirroredLegs, reviewSiblings),
  };
}

/**
 * 把每条腿的平仓快照（平仓时间/平仓价/盈亏/结果）从本人的成交记录回写到「腿」自身。
 * 这些数据原本只存在本人浏览器的本地成交记录里，互关者读不到——回写到 trade_journals 后，
 * 互关者读腿就能看到与本人一致的平仓信息（详情页 Legs 列表与盘面标记都已优先读腿字段）。
 * 幂等：以真实成交记录为准修正缺失或旧错字段；只有本人（有成交记录）视角会触发，
 * 互关者 tradeRecords 为空直接跳过。
 */
async function healCampaignLegSnapshots(legs: TradeJournal[], tradeRecords: TradeRecord[]): Promise<void> {
  if (tradeRecords.length === 0) return;
  const recordMap = buildTradeRecordLookup(tradeRecords);
  const differsNumber = (current: number | null | undefined, expected: number) => {
    if (!Number.isFinite(expected)) return false;
    if (current == null || !Number.isFinite(current)) return true;
    return Math.abs(current - expected) > Math.max(1e-12, Math.abs(expected) * 1e-10);
  };
  const differsTime = (current: string | null | undefined, expectedMs: number) => {
    if (!Number.isFinite(expectedMs) || expectedMs <= 0) return false;
    if (!current) return true;
    const currentMs = new Date(current).getTime();
    return !Number.isFinite(currentMs) || currentMs !== expectedMs;
  };
  for (const leg of legs) {
    if (!leg.trade_record_id) continue;
    const record = recordMap.get(leg.trade_record_id);
    if (!record) continue;
    const full: Record<string, unknown> = {};
    const safe: Record<string, unknown> = {};
    if (differsTime(leg.post_simulated_close_time, record.closeTime)) {
      const iso = new Date(record.closeTime).toISOString();
      full.post_simulated_close_time = iso;
      leg.post_simulated_close_time = iso;
    }
    const realCloseTime = tradeRecordOperationTime(record);
    if (realCloseTime != null && differsTime(leg.post_real_close_time, realCloseTime)) {
      const iso = new Date(realCloseTime).toISOString();
      full.post_real_close_time = iso;
      safe.post_real_close_time = iso;
      leg.post_real_close_time = iso;
    } else if (
      realCloseTime == null
      && leg.source === 'retroactive_from_record'
      && new Date(leg.post_real_close_time ?? 0).getTime() === record.closeTime
    ) {
      full.post_real_close_time = null;
      safe.post_real_close_time = null;
      leg.post_real_close_time = null;
    }
    if (Number.isFinite(record.pnl)) {
      const outcome = tradeRecordOutcome(record);
      if (leg.post_outcome !== outcome) {
        full.post_outcome = outcome;
        safe.post_outcome = outcome;
        leg.post_outcome = outcome;
      }
    }
    if (differsNumber(leg.post_realized_pnl, record.pnl)) {
      full.post_realized_pnl = record.pnl;
      safe.post_realized_pnl = record.pnl;
      leg.post_realized_pnl = record.pnl;
    }
    if (Number.isFinite(record.exitPrice) && record.exitPrice > 0 && differsNumber(leg.post_exit_price_snapshot, record.exitPrice)) {
      full.post_exit_price_snapshot = record.exitPrice;
      leg.post_exit_price_snapshot = record.exitPrice;
    }
    if (Object.keys(full).length === 0) continue;
    let { error } = await supabase.from('trade_journals' as never).update(full as never).eq('id', leg.id);
    // post_exit_price_snapshot 在较旧的库里可能尚未建列——退回只写一定存在的列，保证平仓时间/状态先补上。
    if (error && /post_exit_price_snapshot|post_simulated_close_time/i.test(error.message ?? '') && Object.keys(safe).length > 0) {
      ({ error } = await supabase.from('trade_journals' as never).update(safe as never).eq('id', leg.id));
    }
    if (error && !isMissingTradeJournalsFeatureError(error)) {
      console.warn('[journalApi] 回填战役腿平仓快照失败', error);
    }
  }
}

const isLivePendingOrder = (order: PendingOrder) =>
  order.status === 'NEW' || order.status === 'PENDING' || order.status === 'ACTIVE';

type OrderSnapshotLike = Parameters<typeof orderClockStamp>[0];

/** 与 buildReplaySessionFilter 的取舍与排序口径逐字相同：两只钟都得是有限正数，先真实时刻、后模拟时刻。 */
const finiteReplayClock = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;
const replayEventOrder = (a: ReplayEvent, b: ReplayEvent) => a.realAt - b.realAt || a.simAt - b.simAt;
const replayEvent = (
  realAt: number | null | undefined,
  simAt: number | null | undefined,
  kind: ReplayEventKind,
  anchor = false,
  unstampedOpen = false,
): ReplayEvent | null => (
  typeof realAt === 'number' && typeof simAt === 'number'
    ? { realAt, simAt, anchor, kind, ...(unstampedOpen ? { unstampedOpen } : {}) }
    : null
);
const sortedReplayEvents = (events: Array<ReplayEvent | null>) => (
  events
    .filter((event): event is ReplayEvent => event != null && finiteReplayClock(event.realAt) && finiteReplayClock(event.simAt))
    .sort(replayEventOrder)
);

/** isReplayBreak 的逐字副本（campaignOrderRealTime 没有导出它）；与真函数的一致性由 journalApi.replayWindow 测试守着。 */
const replayBreak = (simDropMs: number, realGapMs: number) => (
  simDropMs > REPLAY_SIM_DROP_TOLERANCE_MS
  && simDropMs > MAX_SIMULATION_SPEED * Math.max(0, REPLAY_CLOCK_LAG_BUDGET_MS - realGapMs)
);
/** buildReplaySessionFilter 的 CLOSE_SIDE_KINDS（未导出）。 */
const closeSideReplayKind = (kind: ReplayEventKind | undefined) => kind === 'record-close' || kind === 'leg-close';

/** 本标的的成交 + 委托回放事件，已按 成交 → 委托 的并列顺序稳定归并、未标锚点；recordIds 与之一一对应，委托为 null。 */
export interface SymbolReplayLane {
  events: ReplayEvent[];
  recordIds: Array<string | null>;
}

/** 成交与委托两路各自已稳定排序的事件按标的归并一次（同一时刻成交在前），几十场同标的共用。 */
function mergeSymbolReplayLane(
  records: Array<{ event: ReplayEvent; recordId: string }>,
  orders: ReplayEvent[],
): SymbolReplayLane {
  const events: ReplayEvent[] = [];
  const recordIds: Array<string | null> = [];
  let recordAt = 0;
  let orderAt = 0;
  while (recordAt < records.length || orderAt < orders.length) {
    if (orderAt < orders.length && (recordAt >= records.length || replayEventOrder(orders[orderAt], records[recordAt].event) < 0)) {
      events.push(orders[orderAt]);
      recordIds.push(null);
      orderAt += 1;
    } else {
      events.push(records[recordAt].event);
      recordIds.push(records[recordAt].recordId);
      recordAt += 1;
    }
  }
  return { events, recordIds };
}

/**
 * 把本场的几条腿事件并入按标的预归并好的成交 + 委托事件流。同一时刻按 成交 → 腿 → 委托 的顺序取，
 * 结果与把三路按这个顺序拼起来再整体稳定排序完全一致——buildReplaySessionFilter 再排一次只是顺序检查。
 * 本场选中的成交在取出时才复制成锚点，不另建一份两万条的数组。
 *
 * 同时裁掉对本场分段没有影响的前后事件，只把中间这一窗交给 buildReplaySessionFilter——
 * 重仓标的两万条事件里，一场战役真正牵涉的只是它锚点所在的那几次坐下来：
 *   · 前面：从最后一个「硬切点」起。硬切点 = 隔了一次坐下来（REPLAY_SITTING_GAP_MS）且模拟时刻回落（isReplayBreak）：
 *     buildReplaySessionFilter 走到这里的状态与从头开始完全一样——新一次坐下来、新段、还没有本场的时间线可接
 *     （第一个锚点之前它的切段只看两只钟，这里按同一条规则复算）。没回落的坐下来接着上一段走，不能从它切。
 *   · 后面：已结束且末锚点是平仓侧的战役，本场时间线到末锚点所在段为止（规则 0），末锚点那次坐下来之后的事件
 *     不会成为本场的段；进行中的、末锚点不是平仓侧的，之后的坐下来仍可能接上本场，全留。
 *   · 一个锚点都没有：buildReplaySessionFilter 无论如何都拿不到证据（返回 null），直接给空。
 * 裁与不裁，分段、取代、盖章时代的每个判断逐字相同（段 / 时间线只是编号不同，它们只比相等）。
 */
export function mergeCampaignReplayEvents(
  lane: SymbolReplayLane,
  anchorRecordIds: ReadonlySet<string>,
  legs: ReplayEvent[],
  options: { campaignOpen: boolean },
): ReplayEvent[] {
  const { events, recordIds } = lane;
  const total = events.length + legs.length;
  // 腿排在同一时刻的成交之后、委托之前（recordIds 为 null 的是委托）
  const legFirst = (leg: ReplayEvent, at: number) => {
    const event = events[at];
    return leg.realAt < event.realAt
      || (leg.realAt === event.realAt && (leg.simAt < event.simAt || (leg.simAt === event.simAt && recordIds[at] === null)));
  };

  // 第一遍：不分配，沿归并顺序走一遍定出窗口 [start, end)
  let eventAt = 0;
  let legAt = 0;
  let start = 0;
  let startEventAt = 0;
  let startLegAt = 0;
  let end: number | null = null;
  let anchorSeen = false;
  let lastAnchorClosing = false;
  let previousRealAt = 0;
  let segmentMaxSim = 0;
  for (let position = 0; position < total; position += 1) {
    const fromLeg = legAt < legs.length && (eventAt >= events.length || legFirst(legs[legAt], eventAt));
    const event = fromLeg ? legs[legAt] : events[eventAt];
    const recordId = fromLeg ? null : recordIds[eventAt];
    const anchor = fromLeg ? Boolean(event.anchor) : recordId !== null && anchorRecordIds.has(recordId);
    const realGap = position === 0 ? 0 : event.realAt - previousRealAt;
    const sittingGap = position > 0 && realGap > REPLAY_SITTING_GAP_MS;
    if (!anchorSeen) {
      // 第一个锚点之前：与 buildReplaySessionFilter 同一条切段规则（与这一段走到的最远模拟时刻比）
      if (position === 0) {
        segmentMaxSim = event.simAt;
      } else if (replayBreak(segmentMaxSim - event.simAt, realGap)) {
        segmentMaxSim = event.simAt;
        if (sittingGap) {
          start = position;
          startEventAt = eventAt;
          startLegAt = legAt;
        }
      } else {
        segmentMaxSim = Math.max(segmentMaxSim, event.simAt);
      }
    }
    if (anchor) {
      anchorSeen = true;
      lastAnchorClosing = closeSideReplayKind(event.kind);
      end = null;
    } else if (anchorSeen && sittingGap && end === null) {
      end = position;
    }
    previousRealAt = event.realAt;
    if (fromLeg) legAt += 1;
    else eventAt += 1;
  }
  if (!anchorSeen) return [];
  if (end === null || options.campaignOpen || !lastAnchorClosing) end = total;

  // 第二遍：只取窗口里的事件
  eventAt = startEventAt;
  legAt = startLegAt;
  const merged: ReplayEvent[] = [];
  for (let position = start; position < end; position += 1) {
    if (legAt < legs.length && (eventAt >= events.length || legFirst(legs[legAt], eventAt))) {
      merged.push(legs[legAt]);
      legAt += 1;
      continue;
    }
    const recordId = recordIds[eventAt];
    const event = events[eventAt];
    merged.push(recordId !== null && anchorRecordIds.has(recordId) ? { ...event, anchor: true } : event);
    eventAt += 1;
  }
  return merged;
}

/**
 * 同一份本地快照下按标的共用的预处理。
 * 列表页 237 场共用一份 `local`，同一标的的几十场原来各自把全标的的成交 / 委托快照过滤一遍、
 * 再把同一批回放事件（重仓标的两万条）排一遍序——实测这占首载七成。
 * 这里按标的只做一次：事件预先排好序，每场只把自己选中的成交标成锚点、并入几条腿事件（三路归并，线性）。
 * 以 `local` 对象为键懒建、随它一起回收；单场详情自己读的快照只用一次，成本与原来相同。
 */
interface SymbolLocalIndex {
  /**
   * 本标的成交记录（资金费除外）的开 / 平回放事件与委托（挂着的 → 撤掉的 → 成交的）的回放事件，
   * 已按 成交 → 委托 的并列顺序稳定归并、未标锚点；每场只需并入自己的几条腿事件、标自己的锚点。
   */
  replay: SymbolReplayLane;
  /** 本标的的全部成交记录，保持存储顺序（回放时间线影子比对的活动证据）。 */
  trades: TradeRecord[];
  /** 本标的的平仓类成交记录，保持存储顺序。 */
  closeRecords: TradeRecord[];
  orders: PendingOrder[];
  cancelled: CancelledOrderSnapshot[];
  filled: FilledOrderSnapshot[];
  /** 至今还开着的仓位里每一笔成交的 id（见 getCampaignFullData 里的说明）。 */
  openPositionFillIds: Set<string>;
  /** 同 id 的委托快照以后写的为准：撤单 / 成交覆盖挂单。 */
  orderSnapshotsById: Map<string, { order: OrderSnapshotLike; live: boolean }>;
  /**
   * 回放时间线影子比对与本场无关的那一半（见 symbolTimelineActivityIndex）：懒建，
   * 同标的里第一场有盖了章的锚点的战役才建；登记表换了一份就重建。
   */
  timelineActivity: CampaignTimelineActivityIndex | null;
}

interface LocalSnapshotIndex {
  bySymbol: Map<string, SymbolLocalIndex>;
  tradesBySymbol: Map<string, TradeRecord[]>;
  cancelledBySymbol: Map<string, CancelledOrderSnapshot[]>;
  filledBySymbol: Map<string, FilledOrderSnapshot[]>;
  /** 成交记录在 tradeHistory 里的下标，按 id 与按仓位 id；按下标取回就是原来 filter 的顺序。 */
  recordIndexesById: Map<string, number[]>;
  recordIndexesByPositionId: Map<string, number[]>;
  /** 成交快照按 id，同 id 以后写的为准（与 new Map(filledOrders.map(...)) 同一口径，不分标的）。 */
  lastFilledById: Map<string, FilledOrderSnapshot>;
}

const localSnapshotIndexes = new WeakMap<UserLocalSnapshot, LocalSnapshotIndex>();

function groupBySymbol<T extends { symbol: string }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.symbol);
    if (group) group.push(item);
    else groups.set(item.symbol, [item]);
  }
  return groups;
}

function localSnapshotIndex(local: UserLocalSnapshot): LocalSnapshotIndex {
  let index = localSnapshotIndexes.get(local);
  if (index) return index;
  const recordIndexesById = new Map<string, number[]>();
  const recordIndexesByPositionId = new Map<string, number[]>();
  local.tradeHistory.forEach((record, position) => {
    const byId = recordIndexesById.get(record.id);
    if (byId) byId.push(position);
    else recordIndexesById.set(record.id, [position]);
    if (!record.positionId) return;
    const byPosition = recordIndexesByPositionId.get(record.positionId);
    if (byPosition) byPosition.push(position);
    else recordIndexesByPositionId.set(record.positionId, [position]);
  });
  index = {
    bySymbol: new Map(),
    tradesBySymbol: groupBySymbol(local.tradeHistory),
    cancelledBySymbol: groupBySymbol(local.cancelledOrders),
    filledBySymbol: groupBySymbol(local.filledOrders),
    recordIndexesById,
    recordIndexesByPositionId,
    lastFilledById: new Map(local.filledOrders.map(order => [order.id, order] as const)),
  };
  localSnapshotIndexes.set(local, index);
  return index;
}

function symbolLocalIndex(local: UserLocalSnapshot, symbol: string): SymbolLocalIndex {
  const index = localSnapshotIndex(local);
  let entry = index.bySymbol.get(symbol);
  if (entry) return entry;
  const trades = index.tradesBySymbol.get(symbol) ?? [];
  const cancelled = index.cancelledBySymbol.get(symbol) ?? [];
  const filled = index.filledBySymbol.get(symbol) ?? [];
  const orders = local.ordersMap[symbol] ?? [];
  const recordPairs: Array<{ event: ReplayEvent; recordId: string }> = [];
  for (const record of trades) {
    // 资金费结算不是开 / 平仓操作（口径见 getCampaignFullData）
    if (record.action === 'FUNDING') continue;
    const open = replayEvent(record.openedRealAt, record.openTime, 'record-open');
    if (open) recordPairs.push({ event: open, recordId: record.id });
    const unstampedOpen = !(typeof record.openedRealAt === 'number' && record.openedRealAt > 0);
    const close = replayEvent(record.closedRealAt, record.closeTime, 'record-close', false, unstampedOpen);
    if (close) recordPairs.push({ event: close, recordId: record.id });
  }
  const sortedPairs = recordPairs
    .filter(pair => finiteReplayClock(pair.event.realAt) && finiteReplayClock(pair.event.simAt))
    .sort((a, b) => replayEventOrder(a.event, b.event));
  const orderEvents: Array<ReplayEvent | null> = [];
  for (const order of orders) orderEvents.push(replayEvent(order.createdRealAt, order.createdAt, 'order-create'));
  for (const order of cancelled) {
    orderEvents.push(replayEvent(order.createdRealAt, order.createdAt, 'order-create'));
    orderEvents.push(replayEvent(order.cancelledRealAt, order.cancelledAt, 'order-end'));
  }
  for (const order of filled) {
    orderEvents.push(replayEvent(order.createdRealAt, order.createdAt, 'order-create'));
    orderEvents.push(replayEvent(order.filledRealAt, order.filledAt, 'order-end'));
  }
  const openPositionFillIds = new Set(
    (local.positionsMap?.[symbol] ?? [])
      .flatMap(position => [position.id, ...(position.fills ?? []).map(fill => fill.id)])
      .filter((id): id is string => Boolean(id)),
  );
  const filledIntoOpenPosition = (order: FilledOrderSnapshot) =>
    order.positionId != null && openPositionFillIds.has(order.positionId);
  const orderSnapshotsById = new Map<string, { order: OrderSnapshotLike; live: boolean }>();
  for (const order of orders) {
    if (order.id) orderSnapshotsById.set(order.id, { order, live: isLivePendingOrder(order) });
  }
  for (const order of cancelled) {
    if (order.id) orderSnapshotsById.set(order.id, { order, live: false });
  }
  for (const order of filled) {
    if (order.id) orderSnapshotsById.set(order.id, { order, live: filledIntoOpenPosition(order) });
  }
  entry = {
    replay: mergeSymbolReplayLane(sortedPairs, sortedReplayEvents(orderEvents)),
    trades,
    closeRecords: trades.filter(record => record.action === 'CLOSE' || record.action === 'LIQUIDATION'),
    orders,
    cancelled,
    filled,
    openPositionFillIds,
    orderSnapshotsById,
    timelineActivity: null,
  };
  index.bySymbol.set(symbol, entry);
  return entry;
}

/**
 * 回放时间线影子比对里只取决于「登记表 + 这个标的全部活动」的预处理（活动分桶、现实时刻排序、登记表的树），
 * 同一份快照下同标的的战役共用一份——列表页原来每场都把全标的的活动重新收集、分桶、排序一遍。
 * 活动取自本标的的成交记录与挂着的 / 撤掉的 / 成交的委托快照，与按标的过滤全快照的取舍相同
 * （collectCampaignTimelineActivity 本来就只收本标的的撤单 / 成交快照与成交记录）。
 */
function symbolTimelineActivityIndex(
  entry: SymbolLocalIndex,
  symbol: string,
  registry: ReplayTimelineRegistry | null | undefined,
): CampaignTimelineActivityIndex {
  if (entry.timelineActivity && entry.timelineActivity.registry === registry) return entry.timelineActivity;
  entry.timelineActivity = indexCampaignTimelineActivity(registry, collectCampaignTimelineActivity({
    symbol,
    tradeHistory: entry.trades,
    pendingOrders: entry.orders,
    cancelledOrders: entry.cancelled,
    filledOrders: entry.filled,
  }));
  return entry.timelineActivity;
}

/**
 * 单场战役的完整数据。
 *
 * `options` 是给**列表页**用的：它一次要开 147 场，而默认路径每场都会
 *   · 把 trade_history / orders_map / cancelled_orders / filled_orders 各解析一遍
 *     （实测 147 场 × trade_history 一项就是 0.5~1.6 秒**纯主线程阻塞**，四项合计 2~6 秒，
 *      期间滚动、点击、动画全部停摆）；
 *   · 回写腿快照与战役汇总（**写数据库**）——刚改过口径之后几乎每条腿都判定为需要回写，
 *     于是渲染一个列表变成一场写风暴。
 * 两件事对单场详情是对的，对列表是纯浪费。
 */
export interface CampaignFullDataOptions {
  /** 已批量读取并水合的战役和腿；避免列表页再逐场请求同一份远端数据。 */
  source?: CampaignWithLegs;
  /** 共用的本地存储快照；不传则自行读取（单场路径的原行为）。 */
  local?: UserLocalSnapshot;
  /**
   * 是否回写腿快照 / 战役汇总。默认 true（详情页需要）。
   * 列表页传 false：那是渲染，不该产生写副作用。
   */
  heal?: boolean;
}

export async function getCampaignFullData(
  campaignId: string,
  options: CampaignFullDataOptions = {},
): Promise<{
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  pendingOrders: PendingOrder[];
  reverseHedgeOrders: CampaignReverseHedgeOrder[];
  /** 别的回放留下、在本场期间仍挂着的委托空单（foreignReplay: true），只供标注显示。 */
  foreignLiveOrders: CampaignReverseHedgeOrder[];
  /**
   * 腿 / 归类事件上挂着、本地委托快照证明从未成交（撤掉了或仍挂着）的委托 id（见 resolveNeverFilledOrderIds）。
   * 详情页把它交给权益路径与「Legs 副本」，两边都把这种 id 当作没有成交 id。老的替身可以不给（缺省为空）。
   */
  unfilledOrderIds?: string[];
  /**
   * 自愈路径拉到的平仓价校正（只有 heal !== false 时才有）。
   * 详情页首屏直接用它，页眉状态与已实现 P&L 从第一帧起就是同一份校正后的数；
   * 列表页（heal: false）保持自己的后台拉取，这里为 undefined。
   */
  legExitPriceCorrections?: LegExitPriceCorrections;
  /** 回放时间线的影子比对（见 lib/campaignTimelineScope）。本期只记录，pendingOrders / reverseHedgeOrders 仍按启发式。 */
  timelineDiagnostics: CampaignTimelineDiagnostics;
  /**
   * 委托归属是否建起了回放分段（有本场自己带真实时刻的操作）；没有时只按真实窗口 / 模拟窗口判。
   * 可选：只有列表页的本地增量核对读它，测试里的替身不必给（缺省按最保守的「无界」处理）。
   */
  replayAnchored?: boolean;
  /** 本地增量核对的真实时刻界，见函数体内的说明；null = 无界。 */
  replayEndRealAt?: number | null;
}> {
  if (options.source && options.source.campaign.id !== campaignId) {
    throw new Error('加载战役失败：预加载数据的战役 ID 不匹配');
  }
  const { campaign, legs } = options.source ?? await getCampaignWithLegs(campaignId);
  const userId = campaign.user_id;
  const local = options.local ?? readUserLocalSnapshot(userId);
  const { tradeHistory } = local;
  // 同一份快照下按标的共用的预处理（见 symbolLocalIndex）：列表页几十场同标的只做一次。
  const symbolIndex = symbolLocalIndex(local, campaign.symbol);
  const recordIndex = localSnapshotIndex(local);
  const legRecordIds = new Set(
    legs
      .map(leg => leg.trade_record_id)
      .filter((id): id is string => Boolean(id)),
  );
  const openedAtMs = new Date(campaign.opened_at).getTime();
  const closedAtMs = campaign.closed_at ? new Date(campaign.closed_at).getTime() : Number.POSITIVE_INFINITY;
  // 委托 / 挂单按「挂单时间(委托时间)」归属到战役：委托时间须落在 [开主力-5min, 平仓] 内。
  // 前置 5 分钟缓冲覆盖开主力前提前挂好的对冲空单；用挂单时间(而非生命周期重叠)可避免上一场战役的委托泄漏进来。
  const orderWindowStartMs = openedAtMs - CAMPAIGN_ORDER_WINDOW_LOOKBACK_MS;
  const orderWindowEndMs = closedAtMs;
  // 归属只看挂单时间：委托时间落在窗口内即属本战役。Number.isFinite 守卫兼顾 NaN 与开放战役(end=Infinity)。
  const inWindow = (t: number) => Number.isFinite(t) && t >= orderWindowStartMs && t <= orderWindowEndMs;

  // 战役详情只展示用户归类进来的 legs；同标的同时间窗口内未选中的交易不能混入盘面。
  // 按 id / 仓位 id 查下标再按下标排回去，与逐条 filter 的取舍和顺序完全相同，只是不再全表扫描。
  const selectedRecordIndexes = new Set<number>();
  for (const id of legRecordIds) {
    for (const position of recordIndex.recordIndexesById.get(id) ?? []) selectedRecordIndexes.add(position);
    for (const position of recordIndex.recordIndexesByPositionId.get(id) ?? []) selectedRecordIndexes.add(position);
  }
  const tradeRecords = Array.from(selectedRecordIndexes)
    .sort((a, b) => a - b)
    .map(position => tradeHistory[position]);
  /**
   * 第二道归属：**真实时间**一致性。
   * 这是时间机器——同一段历史行情能回放两次，两次的委托在模拟时间轴上完全重合，
   * 上面的 inWindow 会把两场的单子全部收进来（WLDUSDT 2026-05-26 的事故）。
   * 人一次只能做一件事，两次回放的现实时刻必然分开：委托的真实创建时刻
   * 必须落在本场已选中成交的真实区间内。
   * 现在只作兜底：下面的回放分段建得起来时以分段为准（见 belongsToCampaignTimeline）。
   */
  const realWindow = campaignRealTimeWindow({
    tradeRecords,
    legs,
    campaignClosed: Boolean(campaign.closed_at),
  });
  /**
   * 第三道归属：与本场的**操作时间**对齐到同一次回放（见 buildReplaySessionFilter）。
   * realWindow 依赖 openedRealAt，回填腿 + 老成交只有 closedRealAt 时它是 null、整道过滤失效——
   * 另一次回放同一段行情的委托因此成对混进盘面。这里只用每个事件自带的「真实时刻 + 模拟时刻」，
   * 在模拟时间跳回去的地方切开回放，保留含本场操作的那几段，再按取代 / 盖章时代规则逐张判。
   */
  const selectedRecordIds = new Set(tradeRecords.map(record => record.id));
  /**
   * 本标的全部成交的开 / 平事件与委托事件按标的预先归并排好序（symbolLocalIndex）；这里只把本场选中的成交标成锚点。
   * 资金费结算不是开 / 平仓操作：它只有 closedRealAt、没有 openedRealAt，按口径会被当成「上线之前开的仓」，
   * 让持仓跨过任一资金费时段的战役都被误判为跨上线、盖章时代规则整个失效（与 campaignAnalysis 同一口径排除）；
   * 没有 openedRealAt 的成交是盖章上线之前开的仓：它的平仓所在那一段跨过了上线（盖章时代规则的放行条件）。
   */
  const legReplayEvents: ReplayEvent[] = [];
  /**
   * 本场腿自己的平仓操作也是锚点：本地成交记录被清掉（清除标的数据只删 trade_history、不删委托快照）
   * 或被云端水合覆盖时，没有它分段就建不起来、窗口里的委托全数放行，而 Legs 表照样显示这些「操作」时间。
   * 本地成交已带 closedRealAt 的腿不重复加——界面上它的操作时间就是那条成交的，锚点已经在上面了。
   * 实时腿的「记录决策」时刻同样是本场操作：进行中的战役还没有任何平仓锚点，靠它才建得起分段（见 legOpenReplayEvent）。
   */
  /**
   * 事件流补出来的平仓两只钟不成对，不作锚点。事件自己没有平仓模拟时刻（close_time 为空）时，它的 operation_time
   * 对没有平仓的实时腿是「记录决策」时刻（journalOperationTime 退回开仓侧）；合并 / 还原腿时它被填进 post_real_close_time，
   * post_simulated_close_time 却由平仓事件或战役结束时刻补上（synthesizeJournalFromEvent）——拼成「现实里记录决策、
   * 模拟里战役结束」的假锚点，在它之后切出一段，同一分钟里先挂又撤的本场对冲就被当成重走过的时间线取代掉。
   */
  const legCloseFilledFromEvent = (leg: TradeJournal) => {
    const closeMs = leg.post_real_close_time ? new Date(leg.post_real_close_time).getTime() : Number.NaN;
    if (!Number.isFinite(closeMs)) return false;
    return (campaign.actual_evolution ?? []).some(event =>
      !event.close_time
      && Boolean(event.operation_time)
      && new Date(event.operation_time as string).getTime() === closeMs
      && (
        event.journal_id === leg.id
        || (Boolean(event.trade_record_id) && event.trade_record_id === leg.trade_record_id)
        || leg.id === `event-${event.id}`
      ));
  };
  for (const leg of legs) {
    const openEvent = legOpenReplayEvent(leg);
    if (openEvent) legReplayEvents.push(openEvent);
    const record = leg.trade_record_id
      ? tradeRecords.find(item => item.id === leg.trade_record_id || item.positionId === leg.trade_record_id)
      : undefined;
    if (tradeRecordOperationTime(record) != null) continue;
    if (legCloseFilledFromEvent(leg)) continue;
    const event = legCloseReplayEvent(leg);
    if (event) legReplayEvents.push(event);
  }
  // 成交 → 腿 → 委托（挂着的 / 撤掉的 / 成交的）三路归并成一条已排好序的事件流；同一时刻仍按这个先后，
  // 并只留本场牵涉的那几次坐下来（见 mergeCampaignReplayEvents）
  const legEvents = sortedReplayEvents(legReplayEvents);
  const replayEvents = mergeCampaignReplayEvents(
    symbolIndex.replay, selectedRecordIds, legEvents, { campaignOpen: !campaign.closed_at },
  );
  // 进行中的战役：仓位还开着，倒回之后同一次坐下来挂的单子是本场的延续（见 buildReplaySessionFilter 规则 0）
  const replaySession = buildReplaySessionFilter(replayEvents, { campaignOpen: !campaign.closed_at });
  /**
   * 给列表页的本地增量核对（campaignListCache）划一条真实时刻的界：同标的晚于它超过一次坐下来的新事件碰不到本场的归属。
   *   · 有分段、且窗口在最后一个平仓侧锚点之后被一次坐下来截断（已结束的战役）：窗口最后一个事件的真实时刻——
   *     之后隔着一次坐下来的事件不进本场的段（mergeCampaignReplayEvents 的裁窗与 buildReplaySessionFilter 规则 0 同一口径）；
   *   · 没有锚点、只有真实窗口：窗口上界（没有平仓证据或进行中为 +∞ → 无界）；
   *   · 其余（进行中、窗口没截断——坐下来之后接着往后打的段会并进来）：无界，任何同标的事件都可能接上本场。
   */
  const windowLastRealAt = replayEvents.length > 0 ? replayEvents[replayEvents.length - 1].realAt : null;
  const laneEvents = symbolIndex.replay.events;
  const laneLastRealAt = Math.max(
    laneEvents.length > 0 ? laneEvents[laneEvents.length - 1].realAt : Number.NEGATIVE_INFINITY,
    legEvents.length > 0 ? legEvents[legEvents.length - 1].realAt : Number.NEGATIVE_INFINITY,
  );
  const replayEndRealAt = replaySession
    ? (windowLastRealAt !== null && laneLastRealAt > windowLastRealAt ? windowLastRealAt : null)
    : (realWindow && Number.isFinite(realWindow.end) ? realWindow.end : null);
  /**
   * 能分段就只用分段（含取代与盖章时代规则），不再叠加 realWindow：后者的 5 分钟是**现实**回看，
   * 挂好前置对冲后停下来想了 5 分钟以上才开主力，同一段回放里的合法对冲会被它踢掉。
   * 分段建不起来（本场没有任何带真实时刻的操作）时才退回 realWindow。
   * live：委托至今仍挂着——它活过了之后每一次倒回，不会被重走取代（见 orderClockStamp）。
   */
  const heuristicBelongsToCampaignTimeline = (
    order: CampaignTimelineOrderLike,
    options: CampaignTimelineOrderOptions = {},
  ) => (
    replaySession
      ? replaySession.allowsOrder(orderClockStamp(order, options))
      : orderWithinRealWindow(bestOrderRealStamp(order), realWindow)
  );
  /**
   * 精确判定（影子）：按回放时间线登记表里的章判，与启发式并排算，**结论只进 timelineDiagnostics**。
   * 每一张委托仍按启发式的结论取舍——精确判定要等影子比对过一轮真实数据才会生效（Phase 2）。
   * 老数据没有章：本场一个盖了章的锚点都没有时 scope 为 null，什么都不算。
   * 证据分两半：本场的锚点与仓位 id 逐场收集；全标的的活动与登记表的预处理按标的共用（symbolTimelineActivityIndex），
   * 本场没有盖了章的锚点时不建。锚点按腿引用的 id 查成交快照时不分标的、同 id 以后写的为准（lastFilledById）。
   */
  const timelineScope = buildCampaignTimelineScope({
    registry: local.replayTimelines,
    symbol: campaign.symbol,
    campaignOpen: !campaign.closed_at,
    ...collectCampaignTimelineAnchors({
      symbol: campaign.symbol,
      campaignEvents: campaign.actual_evolution ?? [],
      legs,
      selectedRecords: tradeRecords,
      openPositions: local.positionsMap?.[campaign.symbol] ?? [],
      filledOrdersById: recordIndex.lastFilledById,
    }),
    activityIndex: () => symbolTimelineActivityIndex(symbolIndex, campaign.symbol, local.replayTimelines),
  });
  const timelineVerdicts: Record<string, CampaignTimelineOrderDiagnostic> = {};
  const timelineDisagreements: CampaignTimelineDiagnostics['disagreements'] = [];
  // 同一张单会被判两次（持仓面板与委托层 / 事件恢复时再核一次），两次的入参相同，记第一次即可
  const recordTimelineVerdict = (
    order: CampaignTimelineOrderLike,
    options: CampaignTimelineOrderOptions,
    heuristic: boolean,
    exempt = false,
  ) => {
    if (!timelineScope || !order.id || timelineVerdicts[order.id]) return;
    const exact = exempt ? 'in' : timelineScope.verdict(order, options);
    timelineVerdicts[order.id] = exempt ? { heuristic, exact, exempt } : { heuristic, exact };
    if (exact !== 'defer' && (exact === 'in') !== heuristic) {
      timelineDisagreements.push({ orderId: order.id, heuristic, exact });
    }
  };
  const belongsToCampaignTimeline = (
    order: CampaignTimelineOrderLike,
    options: CampaignTimelineOrderOptions = {},
  ) => {
    const allowed = heuristicBelongsToCampaignTimeline(order, options);
    recordTimelineVerdict(order, options, allowed);
    return allowed;
  };
  // 持仓面板 / 结束建议用的挂单也按挂单时间归属，避免同标的另一场战役的实时挂单混进本战役。
  const pendingOrders = symbolIndex.orders
    .filter(order => isLivePendingOrder(order)
      && inWindow(order.createdAt)
      && belongsToCampaignTimeline(order, { live: true }));

  // 黄色委托层只记录「开仓性质的委托空单」；止盈/止损等平仓委托不进入这里（见 isCampaignOpeningShortOrder）。
  const isOpeningShortOrder = isCampaignOpeningShortOrder;
  const pendingOrderPrice = (order: PendingOrder) => (
    order.price > 0
      ? order.price
      : (order.conditionalLimitPrice && order.conditionalLimitPrice > 0)
        ? order.conditionalLimitPrice
        : order.stopPrice
  );
  const closeEnough = (a: number, b: number, relativeBase = Math.max(Math.abs(a), Math.abs(b), 1)) =>
    Math.abs(a - b) <= Math.max(1e-8, relativeBase * 1e-6);
  const ORDER_RECORD_MATCH_MS = 60_000;
  const LEGACY_ORDER_RECORD_MATCH_MS = CAMPAIGN_LEGACY_ORDER_RECORD_MATCH_MS;
  const campaignSymbolTradeRecords = symbolIndex.closeRecords;
  const closeUnits = (record: TradeRecord) => (
    Number.isFinite(record.contracts) && record.contracts != null ? record.contracts : record.quantity
  );
  const orderUnits = (order: FilledOrderSnapshot) => (
    Number.isFinite(order.contracts) && order.contracts != null ? order.contracts : order.quantity
  );
  const closeEnoughLegacyPrice = (a: number, b: number) =>
    Math.abs(a - b) <= Math.max(1e-8, Math.max(Math.abs(a), Math.abs(b), 1) * 0.005);
  const closeEnoughUnits = (a: number, b: number) =>
    closeEnough(a, b, Math.max(Math.abs(a), Math.abs(b), 1));
  const resolveFilledOrderCloseRecord = (order: FilledOrderSnapshot, records: TradeRecord[]) => {
    const sorted = records
      .filter(record => record.closeTime > order.filledAt)
      .sort((a, b) => a.closeTime - b.closeTime);
    if (sorted.length === 0) return null;

    const expectedUnits = orderUnits(order);
    if (!Number.isFinite(expectedUnits) || expectedUnits <= 0) {
      return sorted.find(record => record.exit_method === 'manual') ?? sorted[sorted.length - 1];
    }

    let closedUnits = 0;
    let finalCloseRecord: TradeRecord | null = null;
    for (const record of sorted) {
      closedUnits += closeUnits(record);
      if (!finalCloseRecord && closeEnough(closedUnits, expectedUnits, Math.max(Math.abs(expectedUnits), 1))) {
        finalCloseRecord = record;
      }
      if (
        record.exit_method === 'manual' &&
        closedUnits >= expectedUnits - Math.max(1e-8, Math.abs(expectedUnits) * 1e-6)
      ) {
        return record;
      }
    }

    return finalCloseRecord ?? sorted[sorted.length - 1];
  };
  const findRecordForFilledOrder = (order: FilledOrderSnapshot) => {
    /**
     * 两边都盖了回放时间线章时先按精确联结：平仓记录的 fillId 就是这张委托成交开出的仓位 id（并进老仓位也一样），
     * 开仓章与成交章出自同一次 stampClock。命中就不再走下面的时间 / 价格兜底——那两级的 60 秒窗口会被落后的界面时钟
     * 错过。只对盖了章的数据生效：老数据两边都没有章，结果与从前完全一致。
     */
    if (order.positionId && order.filledTimelineId) {
      const byTimeline = resolveFilledOrderCloseRecord(
        order,
        campaignSymbolTradeRecords.filter(record =>
          record.fillId === order.positionId &&
          record.openedTimelineId === order.filledTimelineId &&
          record.side === order.side
        ),
      );
      if (byTimeline) return byTimeline;
    }
    if (order.positionId) {
      const byPositionId = resolveFilledOrderCloseRecord(
        order,
        campaignSymbolTradeRecords.filter(record =>
          record.positionId === order.positionId &&
          record.side === order.side
        ),
      );
      if (byPositionId) return byPositionId;
    }
    /**
     * 下面两级按时间 / 价格兜底，只为接回没有仓位 id、或并进老合并仓位（记录只带存活仓位 id）的老数据。
     * 带 fillId 的记录（2026-08-31 起每条平仓都写）自报了是哪一笔成交：fillId 与这张委托开出的仓位 id 不同，
     * 就是别的成交的平仓——同一分钟另一张对冲的，或另一次回放同一段行情的。接上去会让这张至今未平的对冲
     * 顶着别人的平仓时刻收尾，还会与那张共用 record 去重键被吞掉。
     */
    const mayCloseThisFill = (record: TradeRecord) =>
      !order.positionId || !record.fillId || record.fillId === order.positionId;
    const candidates = campaignSymbolTradeRecords
      .filter(record =>
        mayCloseThisFill(record) &&
        record.side === order.side &&
        Math.abs(record.openTime - order.filledAt) <= ORDER_RECORD_MATCH_MS &&
        closeEnough(record.entryPrice, order.price)
      )
      .sort((a, b) => {
        const timeDelta = Math.abs(a.openTime - order.filledAt) - Math.abs(b.openTime - order.filledAt);
        if (timeDelta !== 0) return timeDelta;
        return Math.abs(a.entryPrice - order.price) - Math.abs(b.entryPrice - order.price);
      });
    const strictQuantityMatches = candidates.filter(record => closeEnoughUnits(closeUnits(record), orderUnits(order)));
    if (candidates.length > 0 || strictQuantityMatches.length > 0) {
      // 老数据里 filled_orders 与 trade_history 的数量口径可能不同；时间+价格已经足够把触发快照接回真实平仓记录。
      return resolveFilledOrderCloseRecord(order, strictQuantityMatches.length > 0 ? strictQuantityMatches : candidates);
    }

    const legacyCandidates = campaignSymbolTradeRecords
      .filter(record => {
        if (!mayCloseThisFill(record) || record.side !== order.side || record.closeTime <= order.filledAt) return false;
        const openDelta = Math.abs(record.openTime - order.filledAt);
        if (openDelta > LEGACY_ORDER_RECORD_MATCH_MS) return false;
        return closeEnoughLegacyPrice(record.entryPrice, order.price) ||
          closeEnoughUnits(closeUnits(record), orderUnits(order));
      })
      .sort((a, b) => {
        const timeDelta = Math.abs(a.openTime - order.filledAt) - Math.abs(b.openTime - order.filledAt);
        if (timeDelta !== 0) return timeDelta;
        return Math.abs(a.entryPrice - order.price) - Math.abs(b.entryPrice - order.price);
      });
    // 老数据里 filled_orders 与 trade_history 的数量口径可能不同；时间+价格已经足够把触发快照接回真实平仓记录。
    return resolveFilledOrderCloseRecord(order, legacyCandidates);
  };
  /**
   * 成交开出的仓位就是本场选中的成交：这张委托就是本场的，不再过回放时间线。
   * 仓位 id 每次开仓新生成，另一次回放的委托不可能撞上；而跨过倒回被带进下一遍的对冲仓位，
   * 它的开仓委托成交在上一遍、模拟时刻又被下一遍重走过，按取代规则会被误判成被放弃的时间线。
   * 成交快照记的是这笔成交自己开出的仓位 id；并进已有同向仓位时合并保留最早那笔的 id，
   * 这笔的 id 只留在平仓记录的 fillId 上——两个都要认，否则两笔以上凑成的对冲仓位会丢掉后面几笔。
   */
  const selectedPositionIds = new Set(
    tradeRecords.flatMap(record => [record.positionId, record.fillId]).filter((id): id is string => Boolean(id)),
  );
  /**
   * 至今还开着的仓位里每一笔成交的 id。进行中的战役带着还没平的对冲仓位倒回时，它还没有平仓记录、上面的豁免够不着；
   * 倒回不平仓，这笔成交开出的仓位活进了之后每一遍，与仍挂着的委托同理按 live 判，不被重走取代。
   * 只放宽取代、不放宽成员资格：另一次回放的成交仍要落在本场的时间线上。不用「没有平仓记录」代替——
   * 清除标的数据后每笔成交都没有平仓记录，被放弃时间线里早已平掉的对冲会借此成对回来。
   */
  const { openPositionFillIds } = symbolIndex;
  const filledIntoOpenPosition = (order: FilledOrderSnapshot) =>
    order.positionId != null && openPositionFillIds.has(order.positionId);
  const triggeredReverseOrders = symbolIndex.filled
    .filter(order => {
      if (!isOpeningShortOrder(order) || !inWindow(order.createdAt)) return false;
      const live = filledIntoOpenPosition(order);
      if (order.positionId != null && selectedPositionIds.has(order.positionId)) {
        // 豁免的委托两边都不用判：影子比对里同样记成本场的
        recordTimelineVerdict(order, { live }, true, true);
        return true;
      }
      return belongsToCampaignTimeline(order, { live });
    })
    .map(order => {
      const record = findRecordForFilledOrder(order);
      const originalTriggerPrice = Number.isFinite(order.triggerPrice) && order.triggerPrice > 0
        ? order.triggerPrice
        : order.price;
      return {
        id: order.id,
        tradeRecordId: record?.id ?? null,
        side: order.side,
        price: originalTriggerPrice,
        fillPrice: order.price,
        createdAt: order.createdAt,
        triggeredAt: order.filledAt,
        cancelledAt: record?.closeTime && record.closeTime > order.filledAt ? record.closeTime : null,
        status: 'triggered' as const,
      };
    })
    .filter((order): order is CampaignReverseHedgeOrder => Boolean(order));
  const eventTimestamp = (event: CampaignEvent | undefined) => {
    if (!event) return null;
    const timestamp = new Date(event.timestamp).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  };
  const eventOrderIds = new Set(
    campaign.actual_evolution
      .map(event => event.pending_order_id)
      .filter((id): id is string => Boolean(id)),
  );
  // 撤单 / 成交快照后写、覆盖同 id 的挂单：委托已经结束了（成交开出的仓位至今还开着的除外，与上面同一口径）
  const { orderSnapshotsById } = symbolIndex;
  const eventRecoveredReverseOrders = Array.from(eventOrderIds)
    .map((orderId): CampaignReverseHedgeOrder | null => {
      const events = campaign.actual_evolution
        .filter(event => event.pending_order_id === orderId)
        .sort((a, b) => (eventTimestamp(a) ?? 0) - (eventTimestamp(b) ?? 0));
      const placed = events.find(event => event.event_type === 'hedge_placed');
      const triggered = events.find(event => event.event_type === 'hedge_triggered');
      const cancelled = [...events].reverse().find(event => event.event_type === 'hedge_cancelled');
      const ownerEvent = triggered ?? placed ?? cancelled;
      const ownerLeg = legs.find(leg =>
        (ownerEvent?.journal_id && leg.id === ownerEvent.journal_id) ||
        (ownerEvent?.trade_record_id && leg.trade_record_id === ownerEvent.trade_record_id)
      );
      if (ownerEvent?.direction !== 'short' && ownerLeg?.direction !== 'short') return null;

      const createdAt = eventTimestamp(placed) ?? eventTimestamp(triggered) ?? eventTimestamp(cancelled);
      const triggeredAt = eventTimestamp(triggered);
      const cancelledAt = eventTimestamp(cancelled);
      const price = placed?.price ?? triggered?.price ?? cancelled?.price ?? ownerLeg?.hedge_boundary_price
        ?? ownerLeg?.pre_entry_price;
      if (createdAt == null || !inWindow(createdAt) || price == null || !Number.isFinite(price) || price <= 0) {
        return null;
      }
      // 本地还留着同 id 的委托快照：与快照来源的委托同一道归属，同一张单不能两条路径两种结论。
      // 没有快照：这张单只记在本场自己的事件流里，本身就是本场的证据（与上面仓位 id 的豁免同理），
      // 事件时刻只有模拟钟、判不了回放时间线，不能拿「无真实时刻」把它当成上线前的别场委托踢掉。
      const snapshot = orderSnapshotsById.get(orderId);
      if (snapshot && !belongsToCampaignTimeline(snapshot.order, { live: snapshot.live })) return null;

      const record = ownerLeg?.trade_record_id
        ? tradeRecords.find(item =>
          item.id === ownerLeg.trade_record_id || item.positionId === ownerLeg.trade_record_id
        ) ?? null
        : null;
      if (triggeredAt != null) {
        return {
          id: orderId,
          tradeRecordId: record?.id ?? ownerEvent?.trade_record_id ?? null,
          side: 'SHORT',
          price,
          fillPrice: ownerLeg?.pre_entry_price ?? triggered?.price ?? null,
          createdAt,
          triggeredAt,
          cancelledAt: cancelledAt ?? (
            record?.closeTime && record.closeTime > triggeredAt ? record.closeTime : null
          ),
          status: 'triggered',
        };
      }
      if (cancelledAt != null) {
        return {
          id: orderId,
          tradeRecordId: null,
          side: 'SHORT',
          price,
          createdAt,
          triggeredAt: null,
          cancelledAt,
          status: 'cancelled',
        };
      }
      return null;
    })
    .filter((order): order is CampaignReverseHedgeOrder => order != null);
  const recoveredLimitPresetOrders = legs
    .filter(leg =>
      leg.order_kind === 'hedge' &&
      leg.direction === 'short' &&
      leg.hedge_order_method === 'limit_preset' &&
      Boolean(leg.trade_record_id)
    )
    .map((leg): CampaignReverseHedgeOrder | null => {
      const record = tradeRecords.find(item =>
        item.id === leg.trade_record_id || item.positionId === leg.trade_record_id
      );
      if (!record) return null;

      const placed = campaign.actual_evolution
        .filter(event =>
          event.event_type === 'hedge_placed' &&
          (event.journal_id === leg.id || event.trade_record_id === leg.trade_record_id)
        )
        .sort((a, b) => (eventTimestamp(a) ?? 0) - (eventTimestamp(b) ?? 0))[0];
      const triggeredAt = record.openTime || new Date(leg.pre_simulated_time).getTime();
      const createdAt = eventTimestamp(placed) ?? triggeredAt;
      const price = placed?.price ?? leg.hedge_boundary_price ?? leg.pre_entry_price;
      if (
        !Number.isFinite(createdAt) ||
        !inWindow(createdAt) ||
        !Number.isFinite(triggeredAt) ||
        price == null ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        return null;
      }

      return {
        id: placed?.pending_order_id ?? `legacy-limit-preset:${leg.id}`,
        tradeRecordId: record.id,
        side: 'SHORT',
        price,
        fillPrice: leg.pre_entry_price,
        createdAt,
        triggeredAt,
        cancelledAt: record.closeTime > triggeredAt ? record.closeTime : null,
        status: 'triggered',
      };
    })
    .filter((order): order is CampaignReverseHedgeOrder => order != null);
  const rawReverseHedgeOrders: CampaignReverseHedgeOrder[] = [
    ...symbolIndex.cancelled
      .filter(order =>
        isOpeningShortOrder(order) &&
        inWindow(order.createdAt) &&
        belongsToCampaignTimeline(order)
      )
      .map(order => ({
        id: order.id,
        tradeRecordId: null,
        side: order.side,
        price: order.price,
        createdAt: order.createdAt,
        triggeredAt: null,
        cancelledAt: order.cancelledAt,
        status: 'cancelled' as const,
      })),
    ...pendingOrders
      .filter(order => {
        const price = pendingOrderPrice(order);
        return isOpeningShortOrder(order) &&
          inWindow(order.createdAt) &&
          Number.isFinite(price);
      })
      .map(order => ({
        id: order.id,
        tradeRecordId: null,
        side: order.side,
        price: pendingOrderPrice(order),
        createdAt: order.createdAt,
        triggeredAt: null,
        cancelledAt: null,
        status: 'pending' as const,
    })),
    // 已触发(成交)的反向委托：只来自真实委托触发快照（委托时间 → 触发时间 → 平仓时间）。
    // 不再用普通 SHORT 成交记录兜底，避免把手动/市价空单误显示成「委托空单」。
    ...triggeredReverseOrders,
    // 历史浏览器快照曾被最近 500 条上限淘汰。只用明确委托事件或
    // limit_preset 对冲腿恢复，绝不把普通手动/市价 SHORT 成交当作委托单。
    ...eventRecoveredReverseOrders,
    ...recoveredLimitPresetOrders,
  ];
  const reverseOrderScore = (order: CampaignReverseHedgeOrder) => {
    const statusScore = order.status === 'triggered' ? 30 : order.status === 'cancelled' ? 20 : 10;
    return statusScore
      + (order.tradeRecordId ? 4 : 0)
      + (order.triggeredAt ? 2 : 0)
      + (order.cancelledAt ? 1 : 0);
  };
  const reverseOrderDedupeKey = (order: CampaignReverseHedgeOrder) => {
    if (order.tradeRecordId) return `record:${order.tradeRecordId}`;
    if (order.id) return `id:${order.id}`;
    const time = order.status === 'triggered' ? order.triggeredAt ?? order.createdAt : order.createdAt;
    return `${order.side}:${order.status}:${Math.round(order.price * 1e8)}:${Math.round(time / 1000)}`;
  };
  const reverseHedgeOrders = Array.from(rawReverseHedgeOrders.reduce((map, order) => {
    const key = reverseOrderDedupeKey(order);
    const current = map.get(key);
    if (!current || reverseOrderScore(order) > reverseOrderScore(current)) {
      map.set(key, order);
    }
    return map;
  }, new Map<string, CampaignReverseHedgeOrder>()).values()).sort((a, b) => a.createdAt - b.createdAt);

  /**
   * 别的回放留下、在本场期间仍挂着的委托空单（用户决定：显示但标注，不再整张丢掉）。
   * 回放时间线把它们判给了别的回放，但本场打的那段现实时间里它们确实挂在盘上、随时可能被触发。
   * 只用真实时刻判：挂单（bestOrderRealStamp）→ 撤单 / 成交（仍挂着为 +∞）这段现实区间，与本场保留段的现实区间有交集。
   *   - 模拟时刻先过 inWindow，与黄色层同一道：同标的另一段日期的回放留下的单子价位差着量级，标上去会把本场价轴拉飞；
   *   - 一个真实时刻都没有的老委托放不进时间里，不标；只盖了结束时刻的照标——被本场撤掉 / 触发本身就证明它本场期间挂在盘上；
   *   - 本场事件流记过的（actual_evolution 的 pending_order_id）是本场自己的单，时间线判不进也只能静静排除，不能反标成他场；
   *   - 挂单时刻就落在本场保留段里、却被判出去的，是本场倒回前被取代的那一遍（L4），不是别的回放留下的，不标。
   * 单独返回、带 foreignReplay，绝不并进 reverseHedgeOrders / pendingOrders：风险指标、Legs 合计、Δb 与结束建议都不受影响。
   */
  const campaignRealSpans = replaySession?.keptRealSpans ?? (realWindow ? [realWindow] : []);
  const inCampaignRealSpan = (realAt: number) => campaignRealSpans.some(span => realAt >= span.start && realAt <= span.end);
  const realStamp = (value: number | null | undefined) => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
  );
  const foreignCandidates = new Map<string, {
    order: Parameters<typeof belongsToCampaignTimeline>[0];
    live: boolean;
    endRealAt: number | null;
    display: CampaignReverseHedgeOrder;
  }>();
  // 与 orderSnapshotsById 同一口径：撤单 / 成交快照后写、覆盖同 id 的挂单
  for (const order of symbolIndex.orders) {
    if (!order.id || !isLivePendingOrder(order) || !isOpeningShortOrder(order)) continue;
    foreignCandidates.set(order.id, {
      order,
      live: true,
      endRealAt: Number.POSITIVE_INFINITY,
      display: {
        id: order.id,
        tradeRecordId: null,
        side: order.side,
        price: pendingOrderPrice(order),
        createdAt: order.createdAt,
        triggeredAt: null,
        cancelledAt: null,
        status: 'pending',
        foreignReplay: true,
      },
    });
  }
  for (const order of symbolIndex.cancelled) {
    if (!order.id) continue;
    if (!isOpeningShortOrder(order)) {
      foreignCandidates.delete(order.id);
      continue;
    }
    foreignCandidates.set(order.id, {
      order,
      live: false,
      endRealAt: realStamp(order.cancelledRealAt),
      display: {
        id: order.id,
        tradeRecordId: null,
        side: order.side,
        price: order.price,
        createdAt: order.createdAt,
        triggeredAt: null,
        cancelledAt: order.cancelledAt,
        status: 'cancelled',
        foreignReplay: true,
      },
    });
  }
  for (const order of symbolIndex.filled) {
    if (!order.id) continue;
    // 开出的仓位是本场选中的成交：它就是本场的单（与 triggeredReverseOrders 的豁免同一口径）
    if (!isOpeningShortOrder(order) || (order.positionId != null && selectedPositionIds.has(order.positionId))) {
      foreignCandidates.delete(order.id);
      continue;
    }
    foreignCandidates.set(order.id, {
      order,
      live: filledIntoOpenPosition(order),
      endRealAt: realStamp(order.filledRealAt),
      display: {
        id: order.id,
        tradeRecordId: null,
        side: order.side,
        price: Number.isFinite(order.triggerPrice) && order.triggerPrice > 0 ? order.triggerPrice : order.price,
        fillPrice: order.price,
        createdAt: order.createdAt,
        triggeredAt: order.filledAt,
        cancelledAt: null,
        status: 'triggered',
        foreignReplay: true,
      },
    });
  }
  /**
   * 通过「记录决策」挂出的保护单，腿上存的是委托 id：本地委托快照证明它从未成交时，详情页的权益路径与副本都不持有它。
   * 只看 id 本身（腿与事件直接引用了这张委托），不过回放时间线。
   */
  const unfilledOrderIds = resolveNeverFilledOrderIds({
    referencedIds: [
      ...legs.map(leg => leg.trade_record_id),
      ...(campaign.actual_evolution ?? []).map(event => event.trade_record_id),
    ],
    filledOrders: symbolIndex.filled,
    cancelledOrders: symbolIndex.cancelled,
    pendingOrders: symbolIndex.orders,
    filledRecordIds: tradeRecords.flatMap(record => [record.id, record.positionId, record.fillId]),
  });
  const ownReverseOrderIds = new Set(reverseHedgeOrders.map(order => order.id));
  const foreignLiveOrders = Array.from(foreignCandidates.values())
    .filter(({ order, live, endRealAt, display }) => {
      if (ownReverseOrderIds.has(display.id) || eventOrderIds.has(display.id)) return false;
      if (!Number.isFinite(display.price) || display.price <= 0 || !inWindow(display.createdAt)) return false;
      if (belongsToCampaignTimeline(order, { live })) return false;
      const startRealAt = bestOrderRealStamp(order);
      if (startRealAt == null) return false;
      const createdRealAt = realStamp(order.createdRealAt);
      if (createdRealAt != null && inCampaignRealSpan(createdRealAt)) return false;
      const liveUntil = endRealAt ?? startRealAt;
      return campaignRealSpans.some(span => startRealAt <= span.end && liveUntil >= span.start);
    })
    .map(({ display }) => display)
    .sort((a, b) => a.createdAt - b.createdAt);

  // 本人视角（有成交记录）时，把平仓快照回写到腿上，使互关者也能读到一致的平仓信息。
  // 列表页显式关掉：渲染一个列表不该写库，147 场同时回写会把首屏拖到打不开。
  let healedCampaign = campaign;
  let legExitPriceCorrections: LegExitPriceCorrections | undefined;
  if (options.heal !== false) {
    // 先拿平仓价校正再回写汇总：落库的状态 / 金额必须与界面显示的校正后口径同源。
    // 拉取按 symbol + 平仓时刻缓存，详情页自己的那次拉取随后命中缓存，不多打一次接口。
    // 有界等待：接口挂起时到点放行，首屏照常画落库值，本次不回写。
    const corrections = await fetchCorrectionsWithin(campaign, legs, tradeRecords);
    legExitPriceCorrections = corrections.corrections;
    await healCampaignLegSnapshots(legs, tradeRecords);
    healedCampaign = await healCampaignSummarySnapshots(campaign, legs, tradeRecords, corrections);
  }

  return {
    campaign: healedCampaign,
    legs: [...legs].sort((a, b) => (a.leg_sequence ?? 9999) - (b.leg_sequence ?? 9999)),
    tradeRecords,
    pendingOrders,
    reverseHedgeOrders,
    foreignLiveOrders,
    unfilledOrderIds,
    legExitPriceCorrections,
    timelineDiagnostics: timelineScope
      ? {
        mode: timelineScope.mode,
        timelineIds: timelineScope.timelineIds,
        anchorTimelineIds: timelineScope.anchorTimelineIds,
        unstampedAnchors: timelineScope.unstampedAnchors,
        missingAnchorNodes: timelineScope.missingAnchorNodes,
        verdicts: timelineVerdicts,
        disagreements: timelineDisagreements,
      }
      : {
        mode: 'heuristic',
        timelineIds: [],
        anchorTimelineIds: [],
        unstampedAnchors: 0,
        missingAnchorNodes: [],
        verdicts: {},
        disagreements: [],
      },
    replayAnchored: replaySession !== null,
    replayEndRealAt,
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

/** 快照锁定时刻的时间线 id 没有数据库列，只在本地镜像里（见 createJournalPreSnapshot）。 */
function mirroredJournalTimelineId(journal: TradeJournal): Pick<CampaignEvent, 'timeline_id'> {
  const timelineId = applyLocalMirror(journal.user_id, [journal])[0]?.pre_timeline_id ?? null;
  return timelineId ? { timeline_id: timelineId } : {};
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
    // 直接从库里读的行不含本地镜像字段：时间线 id 只存在镜像里，这里合回来再抄。
    ...mirroredJournalTimelineId(journal as TradeJournal),
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
    /**
     * 只按 record.id 过滤。**不要**在这里顺带按 fillId 过滤——那是我改坏过一次的地方。
     *
     * handlePlaceOrder 成交后返回的是这一笔新成交自己的 id，也就是 fills[n].id，
     * 所以每为一条腿「记录决策」，那条日志的 trade_record_id 就等于该成交的 fillId。
     * 一旦这里按 fillId 排除，凡是记过决策的腿，它的平仓分片全被隐藏——
     * 实盘表现是归类页只剩一多一空，镜像止盈、加仓、各对冲空单整批消失。
     *
     * 根子在层次：这一层只知道「有没有日志引用过这个 fill」，不知道**那条日志
     * 是否会出现在用户眼前**（归类页还有日期/标的/已归类三道过滤）。日志被筛掉、
     * 分片也被隐藏，这笔成交就一个入口都没有了。
     * 去重要放在两份名单同时可见的那一层，即 JournalCampaignClassifyPage。
     */
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
    pre_settlement_mode: record.settlementMode ?? 'usdt',
    pre_settlement_asset: record.settlementAsset ?? (record.settlementMode === 'coin' ? null : 'USDT'),
    pre_contract_size_usd: record.contractSizeUsd ?? null,
    pre_contracts: record.contracts ?? null,
    pre_max_loss_usdt: null,
    post_outcome: record.pnl > 0 ? 'win' : record.pnl < 0 ? 'loss' : 'breakeven',
    post_realized_pnl: record.pnl,
    post_r_multiple: null,
    post_reflection: null,
    post_correct_action: null,
    post_reviewed_at: null,
    post_real_close_time: toIso(tradeRecordOperationTime(record)),
    post_simulated_close_time: toIso(record.closeTime),
    post_exit_price_snapshot: record.exitPrice,
    reason_was_rewritten: false,
  };

  const { data, error } = await insertTradeJournalWithSchemaFallback(payload);
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

  if (
    usesDualHedgeSop(input.strategyTemplate) &&
    !input.targetCampaignId &&
    !selected.some(item => item.legRole === 'main_open')
  ) {
    errors.push('双对冲/滚仓模板必须包含 main_open 角色');
  }

  for (const item of selected) {
    const allowedKinds = LEG_ROLE_ORDER_KIND_COMPATIBILITY[item.legRole];
    if (item.journal.source !== 'retroactive_from_record' && !allowedKinds.includes(item.journal.order_kind)) {
      if (item.journal.trade_record_id) {
        warnings.push(`角色 ${item.legRole} 与 journal ${item.journal.id} 的原始订单类型不同，请确认这是按战役语义归类`);
      } else {
        errors.push(`角色 ${item.legRole} 与 journal ${item.journal.id} 的 order_kind 不兼容`);
      }
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
    usesDualHedgeSop(input.strategyTemplate) &&
    (!combined.some(leg => leg.leg_role === 'hedge_initial_a') || !combined.some(leg => leg.leg_role === 'hedge_initial_b'))
  ) {
    warnings.push('双对冲/滚仓模板缺少 hedge_initial_a 或 hedge_initial_b');
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
  const restoreOriginalJournalAssignments = async () => {
    for (const snapshot of originalJournals) {
      const { error: restoreErr } = await supabase
        .from('trade_journals' as never)
        .update({
          campaign_id: snapshot.campaign_id,
          leg_role: snapshot.leg_role,
          leg_sequence: snapshot.leg_sequence,
        } as never)
        .eq('id', snapshot.id);
      if (restoreErr && !isMissingTradeJournalsFeatureError(restoreErr)) {
        console.warn('[journalApi] restore campaign assignment failed', restoreErr);
      }
    }
  };

  const combinedSequence = [...existingLegs, ...journals]
    .sort((a, b) => journalTimeMs(a) - journalTimeMs(b))
    .map(leg => leg.id);
  const sequenceMap = new Map(combinedSequence.map((journalId, index) => [journalId, index + 1]));

  const nextEvents: CampaignEvent[] = [...campaign.actual_evolution];
  const newLegs: TradeJournal[] = [];
  let journalCampaignColumnsUnavailable = false;
  const tradeRecordsForUser = getTradeRecordsForUser(campaign.user_id);
  const tradeRecordMap = buildTradeRecordLookup(tradeRecordsForUser);

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
      if (!journalCampaignColumnsUnavailable) {
        const { error: updateErr } = await supabase
          .from('trade_journals' as never)
          .update(patch as never)
          .eq('id', journal.id);
        if (updateErr) {
          if (isMissingTradeJournalsFeatureError(updateErr)) {
            journalCampaignColumnsUnavailable = true;
            await restoreOriginalJournalAssignments();
          } else {
            throw new Error(`关联战役失败：${updateErr.message}`);
          }
        }
      }

      newLegs.push({ ...journal, ...patch });
      nextEvents.push(campaignEventFromJournal(
        { ...journal, ...patch },
        assignment.legRole,
        new Date().toISOString(),
        assignment.attachNote ? `${assignment.attachNote} · ${RETRO_CLASSIFY_NOTE}` : RETRO_CLASSIFY_NOTE,
        journal.trade_record_id ? tradeRecordMap.get(journal.trade_record_id) ?? null : null,
      ));
    }

    const patch = {
      ...deriveCampaignPatchFromLegs(campaign, [...existingLegs, ...newLegs], tradeRecordsForUser),
      actual_evolution: nextEvents,
    };
    const { error: campaignErr } = await supabase
      .from('trade_campaigns' as never)
      .update(patch as never)
      .eq('id', campaignId);
    if (campaignErr) {
      if (isMissingTradeCampaignsTableError(campaignErr) || isCampaignNotFoundError(campaignErr)) {
        upsertLocalCampaign({
          ...campaign,
          ...patch,
          actual_evolution: nextEvents,
          updated_at: new Date().toISOString(),
        });
        return;
      }
      throw new Error(`更新战役事件流失败：${campaignErr.message}`);
    }

    if (!journalCampaignColumnsUnavailable) {
      await normalizeCampaignLegSequences(campaignId);
    }
    await recomputeCampaignDerivedFields(campaignId);
  } catch (error) {
    if (!journalCampaignColumnsUnavailable) {
      await restoreOriginalJournalAssignments();
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

  const now = new Date().toISOString();
  const tradeRecordsForUser = getTradeRecordsForUser(userId);
  const tradeRecordMap = buildTradeRecordLookup(tradeRecordsForUser);
  const draftLegs = orderedLegs.map(item => ({
    ...item.journal,
    leg_role: item.legRole,
    leg_sequence: item.legSequence,
  }));
  const draftCampaignId = crypto.randomUUID();
  const draftCampaign = {
    id: draftCampaignId,
    user_id: userId,
    campaign_code: fallbackCampaignCode(draftCampaignId),
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
    importance_weight: 0,
    notes: input.notes?.trim() || null,
    actual_evolution: [],
    deviation_notes: {},
    deleted_at: null,
    created_at: now,
    updated_at: now,
  } satisfies TradeCampaign;
  const derivedPatch = deriveCampaignPatchFromLegs(draftCampaign, draftLegs, tradeRecordsForUser);
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
      recorded_at: now,
    }],
  };

  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .insert(payload as never)
    .select()
    .single();
  let campaign: TradeCampaign;
  if (error && isMissingTradeCampaignsTableError(error)) {
    campaign = {
      ...draftCampaign,
      ...derivedPatch,
      status: derivedPatch.status ?? 'active',
      actual_evolution: payload.actual_evolution,
      created_at: now,
      updated_at: now,
    };
    upsertLocalCampaign(campaign);
  } else {
    campaign = wrap('创建战役', error, toCampaign(data));
  }

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
    removeLocalCampaign(userId, campaign.id);
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
  // 与重算战役走同一段代码：数值上等价（回填腿是精确 id 匹配），
  // 但保证「建战役」和「事后重算」永远不会得出两个不同的数。
  const totalPnl = ordered.reduce((sum, item) => sum + (item.record.pnl || 0), 0);
  const closedStatus = campaignStatusFromRealizedPnl(
    { total: totalPnl, settled: closedMs != null },
    toIso(closedMs),
  );
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
    ...ordered.map(({ record, legRole, legSequence }) => campaignEventFromTradeRecord(
      record,
      legRole,
      toIso(tradeRecordTimeMs(record)) ?? openedAt,
      now,
      { leg_sequence: legSequence },
    )),
  ];
  const campaignId = crypto.randomUUID();
  const campaign: TradeCampaign = {
    id: campaignId,
    user_id: userId,
    campaign_code: fallbackCampaignCode(campaignId),
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
    importance_weight: 0,
    notes,
    actual_evolution: events,
    deviation_notes: {},
    deleted_at: null,
    created_at: now,
    updated_at: now,
  };
  const payload = {
    id: campaign.id,
    user_id: campaign.user_id,
    symbol: campaign.symbol,
    direction: campaign.direction,
    status: campaign.status,
    strategy_template: campaign.strategy_template,
    title: campaign.title,
    opened_at: campaign.opened_at,
    closed_at: campaign.closed_at,
    initial_main_size_usdt: campaign.initial_main_size_usdt,
    initial_leverage: campaign.initial_leverage,
    final_realized_pnl: campaign.final_realized_pnl,
    final_r_multiple: campaign.final_r_multiple,
    peak_unrealized_pnl: campaign.peak_unrealized_pnl,
    peak_drawdown: campaign.peak_drawdown,
    importance_weight: campaign.importance_weight,
    notes: campaign.notes,
    actual_evolution: campaign.actual_evolution,
    created_at: campaign.created_at,
    updated_at: campaign.updated_at,
  };

  const { data, error } = await supabase
    .from('trade_campaigns' as never)
    .insert(payload as never)
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

    const detachRecordedAt = new Date().toISOString();
    const nextEvents: CampaignEvent[] = [
      ...campaign.actual_evolution.filter(event => event.journal_id !== journal.id),
      {
        id: crypto.randomUUID(),
        timestamp: detachRecordedAt,
        event_type: 'note',
        leg_role: journal.leg_role,
        journal_id: null,
        trade_record_id: null,
        pending_order_id: null,
        price: journal.pre_entry_price,
        size_usdt: journal.pre_position_size,
        notes: `leg ${journal.leg_role ?? 'unknown'} 已被解除归属（journal ${journal.id}）`,
        recorded_at: detachRecordedAt,
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

export async function detachCampaignLegFromCampaign(
  campaignId: string,
  leg: Pick<TradeJournal, 'id' | 'trade_record_id' | 'leg_role' | 'pre_entry_price' | 'pre_position_size' | 'source'>,
): Promise<void> {
  const isRecordBackedLeg = leg.id.startsWith('record-') || leg.source === 'retroactive_from_record';
  if (!isRecordBackedLeg) {
    await detachJournalFromCampaign(leg.id);
    return;
  }

  const recordId = leg.trade_record_id ?? (leg.id.startsWith('record-') ? leg.id.slice('record-'.length) : null);
  if (!recordId) {
    throw new Error('解除归属失败：该历史成交 leg 缺少 trade_record_id，无法定位原始成交记录');
  }

  const { campaign } = await getCampaignWithLegs(campaignId);
  const originalCampaignPatch = campaignSnapshotPatch(campaign);
  const retainedEvents = campaign.actual_evolution.filter(event => event.trade_record_id !== recordId);
  if (retainedEvents.length === campaign.actual_evolution.length) return;

  const now = new Date().toISOString();
  const nextEvents: CampaignEvent[] = [
    ...retainedEvents,
    {
      id: crypto.randomUUID(),
      timestamp: now,
      event_type: 'note',
      leg_role: leg.leg_role ?? null,
      journal_id: null,
      trade_record_id: null,
      pending_order_id: null,
      price: leg.pre_entry_price,
      size_usdt: leg.pre_position_size,
      notes: `leg ${leg.leg_role ?? 'unknown'} 已被解除归属（record ${recordId}）`,
      recorded_at: now,
    },
  ];

  try {
    const { error } = await supabase
      .from('trade_campaigns' as never)
      .update({ actual_evolution: nextEvents } as never)
      .eq('id', campaignId);
    if (error) {
      if (isMissingTradeCampaignsTableError(error) || isCampaignNotFoundError(error)) {
        upsertLocalCampaign({ ...campaign, actual_evolution: nextEvents, updated_at: now });
      } else {
        throw new Error(`解除归属失败：${error.message}`);
      }
    }

    await recomputeCampaignDerivedFields(campaignId);
  } catch (error) {
    await supabase
      .from('trade_campaigns' as never)
      .update(originalCampaignPatch as never)
      .eq('id', campaignId);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export { suggestOrphanRecordRoles } from '@/lib/legRoleSuggestion';

export function suggestLegRoles(
  journals: TradeJournal[],
  options?: SuggestLegRolesOptions,
): SuggestedLegRole[] {
  return suggestLegRolesHeuristic(journals, options);
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
  if (error && isMissingCounterfactualsTableError(error)) {
    return upsertLocalCounterfactual(toCampaignCounterfactual({
      id: crypto.randomUUID(),
      ...payload,
      created_at: new Date().toISOString(),
    }));
  }
  return wrap('创建反事实战役分支', error, toCampaignCounterfactual(data));
}

export async function listCounterfactuals(campaignId: string): Promise<CampaignCounterfactual[]> {
  const userId = await getAuthenticatedUserId('加载反事实战役分支');
  const local = readLocalCounterfactuals(userId, campaignId);
  const { data, error } = await supabase
    .from('campaign_counterfactuals' as never)
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error && isMissingCounterfactualsTableError(error)) return local;
  return mergeCounterfactuals(wrap('加载反事实战役分支', error, (data ?? []).map(toCampaignCounterfactual)), local);
}

export async function followAccount(followeeId: string): Promise<AccountFollow> {
  const followerId = await getAuthenticatedUserId('关注账户');
  if (followerId === followeeId) throw new Error('不能关注自己');
  const payload = { follower_id: followerId, followee_id: followeeId };
  // 关注边是不可变的：account_follows 只授予 SELECT/INSERT/DELETE，没有 UPDATE 策略。
  // 因此用普通 INSERT，而不是 upsert——upsert 会生成 ON CONFLICT DO UPDATE，对「已关注」的
  // 边触发 UPDATE，撞上缺失的 RLS USING 策略，报 "violates row-level security policy
  // (USING expression) for table account_follows"。
  const { data, error } = await supabase
    .from('account_follows' as never)
    .insert(payload as never)
    .select()
    .single();
  if (error && isMissingSocialFeatureError(error)) {
    return upsertLocalFollow(makeLocalFollow(followerId, followeeId));
  }
  // 已关注（唯一约束冲突）视为幂等成功：回查现有关注边返回，不报错。
  if (error && error.code === '23505') {
    const existing = await supabase
      .from('account_follows' as never)
      .select('*')
      .eq('follower_id', followerId)
      .eq('followee_id', followeeId)
      .maybeSingle();
    const existingRow = wrap('关注账户', existing.error, existing.data as unknown as AccountFollow);
    upsertLocalFollow(existingRow);
    return existingRow;
  }
  const row = wrap('关注账户', error, data as unknown as AccountFollow);
  upsertLocalFollow(row);
  return row;
}

export async function unfollowAccount(followeeId: string): Promise<void> {
  const followerId = await getAuthenticatedUserId('取消关注');
  const { error } = await supabase
    .from('account_follows' as never)
    .delete()
    .eq('follower_id', followerId)
    .eq('followee_id', followeeId);
  if (error && !isMissingSocialFeatureError(error)) throw new Error(`取消关注失败：${error.message}`);
  removeLocalFollow(followerId, followeeId);
}

export async function listMyFollows(): Promise<AccountFollow[]> {
  const userId = await getAuthenticatedUserId('加载关注列表');
  const { data, error } = await supabase
    .from('account_follows' as never)
    .select('*')
    .eq('follower_id', userId)
    .order('created_at', { ascending: false });
  if (error && isMissingSocialFeatureError(error)) return readLocalFollows(userId);
  return mergeFollows(wrap('加载关注列表', error, data as unknown as AccountFollow[]), readLocalFollows(userId));
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
    return hasLocalFollow(userId, otherUserId) && hasLocalFollow(otherUserId, userId);
  }
  if (outbound.error && outbound.error.code !== 'PGRST116') throw new Error(`检查互关失败：${outbound.error.message}`);
  if (inbound.error && inbound.error.code !== 'PGRST116') throw new Error(`检查互关失败：${inbound.error.message}`);
  return (!!outbound.data || hasLocalFollow(userId, otherUserId))
    && (!!inbound.data || hasLocalFollow(otherUserId, userId));
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
  const userId = await getAuthenticatedUserId('删除反事实分支');
  const { error } = await supabase
    .from('campaign_counterfactuals' as never)
    .delete()
    .eq('id', id);
  if (error && !isMissingCounterfactualsTableError(error)) throw new Error(`删除反事实分支失败：${error.message}`);
  removeLocalCounterfactual(userId, id);
}

export async function runAndPersistPureSop(
  campaignId: string,
  klines: KlineData[],
): Promise<CampaignCounterfactual> {
  const { campaign, legs, tradeRecords } = await getCampaignFullData(campaignId);
  const params = buildPureSopParams(campaign, legs, tradeRecords);
  if (!params) throw new Error('无法构建 Pure SOP 参数：缺少主仓战役数据');
  const result = simulateCampaign(
    params,
    klines,
    counterfactualTemplateFor(campaign),
  );
  return createCounterfactual({
    campaign_id: campaignId,
    label: 'Pure SOP',
    branch_kind: 'pure_sop',
    params,
    result,
  });
}

export interface CustomCounterfactualRun {
  /** 入参加上 run_context（周期 / 起止 / 根数 / 运行时刻）后的最终 params，保存时原样落库。 */
  params: CampaignCounterfactualParams;
  result: CampaignCounterfactualResult;
}

/**
 * 只运行、不落库：页面拿到结果先摆成「反事实盈亏概览 · 未保存」，用户点保存才 createCounterfactual。
 * 以前是运行即插入，「保存并刷新」什么都不存——用户以为的草稿其实早就在库里了。
 *
 * interval 是主图当时的周期；拿不到就从 K 线步长反推，写进 params.run_context，
 * 让「同一组腿两次结果不同」事后解释得了（引擎走完整个数组、按末根收盘结算）。
 * 手动 Legs 分支不需要战役模板，跳过 getCampaignFullData 那一趟。
 */
export async function runCustomCounterfactual(
  campaignId: string,
  params: CampaignCounterfactualParams,
  klines: KlineData[],
  interval?: string,
): Promise<CustomCounterfactualRun> {
  const runContext = buildCounterfactualRunContext(klines, interval ?? inferKlineInterval(klines) ?? 'unknown');
  const runParams: CampaignCounterfactualParams = runContext ? { ...params, run_context: runContext } : { ...params };
  let result: CampaignCounterfactualResult;
  if (isManualLegScenario(runParams)) {
    result = simulateManualLegScenario(runParams, klines);
  } else {
    const { campaign } = await getCampaignFullData(campaignId);
    result = simulateCampaign(runParams, klines, counterfactualTemplateFor(campaign));
  }
  return { params: runParams, result };
}

/** 运行后立刻落库的旧入口：只是 runCustomCounterfactual + createCounterfactual，页面已不再用它。 */
export async function runAndPersistCustomCounterfactual(
  campaignId: string,
  label: string,
  params: CampaignCounterfactualParams,
  klines: KlineData[],
  interval?: string,
): Promise<CampaignCounterfactual> {
  const run = await runCustomCounterfactual(campaignId, params, klines, interval);
  return createCounterfactual({
    campaign_id: campaignId,
    label,
    branch_kind: 'custom_what_if',
    params: run.params,
    result: run.result,
  });
}

export async function runAndPersistDeviationCosts(
  campaignId: string,
  klines: KlineData[],
): Promise<DeviationCost[]> {
  const { campaign, legs, tradeRecords } = await getCampaignFullData(campaignId);
  if (campaign.strategy_template === 'custom') return [];
  const { userId, initialCapital } = await getCurrentUserAndCapital();
  const actualParams = buildActualSimulationParams(campaign, legs, tradeRecords);
  if (!actualParams) return [];
  const actualResult = simulateCampaign(
    actualParams,
    klines,
    counterfactualTemplateFor(campaign),
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
    const localDuplicate = readLocalCounterfactuals(userId, campaignId).some(branch =>
      branch.branch_kind === 'fix_one_deviation'
      && branch.source_deduction_id === cost.source_deduction_id,
    );
    if (localDuplicate) continue;
    const existing = await supabase
      .from('campaign_counterfactuals' as never)
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('branch_kind', 'fix_one_deviation')
      .eq('source_deduction_id', cost.source_deduction_id)
      .limit(1);
    if (existing.error && !isMissingCounterfactualsTableError(existing.error)) {
      throw new Error(`检查修正分支失败：${existing.error.message}`);
    }
    if ((existing.data ?? []).length > 0) continue;
    const fixBranch = buildDeviationFixParams(campaign, legs, tradeRecords, cost.source_deduction_id);
    if (!fixBranch) continue;
    const fixResult = simulateCampaign(
      fixBranch.params,
      klines,
      counterfactualTemplateFor(campaign),
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
 * Persist the objective close time captured by TradeRecord.closedRealAt. The record is
 * authoritative, so this also repairs legacy rows polluted with shifted K-line time.
 * Returns the objective ISO string if a write happened, or null if already correct.
 */
export async function stampJournalCloseRealTime(
  journalId: string,
  closedRealAt: number | null | undefined,
): Promise<string | null> {
  if (!Number.isFinite(closedRealAt) || closedRealAt == null || closedRealAt <= 0) return null;
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
  const objectiveCloseTime = new Date(closedRealAt).toISOString();
  if (row?.post_real_close_time && new Date(row.post_real_close_time).getTime() === closedRealAt) return null;
  const { error } = await supabase
    .from("trade_journals" as never)
    .update({ post_real_close_time: objectiveCloseTime } as never)
    .eq("id", journalId);
  if (error) {
    console.warn("[journalApi] 写入 post_real_close_time 失败:", error);
    return null;
  }
  return objectiveCloseTime;
}

export async function createJournalPreSnapshot(input: CreateJournalPreInput): Promise<TradeJournal> {
  /**
   * 回放时间线 id **不进 insert**：库里没有这一列，带着它插入会先失败一次、剥列重试，
   * 顺带触发 schemaDrift 提示与 pre_entry_reason 的旧库兜底改写——每一次快照都来一遍。
   * 只写本地镜像（随账号上云），读 journal 时经 applyLocalMirror 合回来。
   */
  const { pre_timeline_id: timelineId, ...snapshotInput } = input;
  const payload = { ...snapshotInput, pre_real_time: new Date().toISOString(), source: 'live' as const };
  const insertResult = await insertTradeJournalWithSchemaFallback(payload as Record<string, unknown>);
  const journal = wrap("创建交易日记事前快照", insertResult.error, insertResult.data as unknown as TradeJournal);
  if (insertResult.droppedColumns.length > 0) {
    console.warn('[journalApi] 远程数据库缺以下列，本次快照的对应字段未保存：', insertResult.droppedColumns);
    mirrorDroppedColumns(input.user_id, journal.id, payload as Record<string, unknown>, insertResult.droppedColumns);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('journal:schemaDrift', {
        detail: { droppedColumns: insertResult.droppedColumns, scope: 'snapshot' },
      }));
    }
  }
  if (timelineId) {
    mirrorDroppedColumns(input.user_id, journal.id, { pre_timeline_id: timelineId }, ['pre_timeline_id']);
  }
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
  /** 与 pre_simulated_time 同一刻取的回放时间线；只进本地镜像（见 createJournalPreSnapshot）。 */
  pre_timeline_id?: string | null;
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
    pre_settlement_mode: null,
    pre_settlement_asset: null,
    pre_contract_size_usd: null,
    pre_contracts: null,
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
  const journal = wrap('记录空仓观望决策', error, data as unknown as TradeJournal);
  if (input.pre_timeline_id) {
    mirrorDroppedColumns(input.user_id, journal.id, { pre_timeline_id: input.pre_timeline_id }, ['pre_timeline_id']);
  }
  return journal;
}

export interface UpdateJournalPostInput {
  post_outcome: TradeOutcome;
  post_realized_pnl?: number | null;
  post_r_multiple?: number | null;
  post_reflection?: string | null;
  post_correct_action?: string | null;
  post_result_summary?: string | null;
  post_decision_quality?: TradeJournal['post_decision_quality'];
  post_entry_decision_quality?: TradeJournal['post_entry_decision_quality'];
  post_holding_decision_quality?: TradeJournal['post_holding_decision_quality'];
  post_exit_decision_quality?: TradeJournal['post_exit_decision_quality'];
  post_exit_nature?: TradeJournal['post_exit_nature'];
  post_positive_expectancy_review?: string | null;
  post_premortem_review?: string | null;
  post_invalidation_review?: string | null;
  post_path_first_move?: TradeJournal['post_path_first_move'];
  post_path_drawdown?: TradeJournal['post_path_drawdown'];
  post_path_win_quality?: TradeJournal['post_path_win_quality'];
  post_path_agency_note?: string | null;
  post_path_mode?: TradeJournal['post_path_mode'];
  post_trade_agency_score?: TradeJournal['post_trade_agency_score'];
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
  const allDropped = [...baseResult.droppedColumns, ...extraResult.droppedColumns];
  if (allDropped.length > 0) {
    console.warn('[journalApi] 远程数据库缺以下列，本次复盘的对应字段未保存：', allDropped);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id ?? null;
      mirrorDroppedColumns(userId, id, payload as Record<string, unknown>, allDropped);
    } catch (e) {
      console.warn('[journalApi] 本地镜像写入失败:', e);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('journal:schemaDrift', {
        detail: { droppedColumns: allDropped, scope: 'review' },
      }));
    }
  }
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

const JOURNAL_PAGE_SIZE = 1000;

async function listJournalRowsPaged(
  userId: string,
  filters?: { symbol?: string; outcome?: TradeOutcome; dateFrom?: string; dateTo?: string },
): Promise<TradeJournal[]> {
  const rows: TradeJournal[] = [];
  for (let from = 0; ; from += JOURNAL_PAGE_SIZE) {
    let query = supabase.from('trade_journals' as never).select('*').eq('user_id', userId);
    if (filters?.symbol) query = query.eq('symbol', filters.symbol);
    if (filters?.outcome) query = query.eq('post_outcome', filters.outcome);
    if (filters?.dateFrom) query = query.gte('pre_simulated_time', filters.dateFrom);
    if (filters?.dateTo) query = query.lte('pre_simulated_time', filters.dateTo);
    const { data, error } = await query
      .order('id', { ascending: true })
      .range(from, from + JOURNAL_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as TradeJournal[];
    rows.push(...page);
    if (page.length < JOURNAL_PAGE_SIZE) break;
  }
  return rows;
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
      return applyLocalMirror(userId, (data ?? []) as unknown as TradeJournal[]);
    }

    const rows = await listJournalRowsPaged(userId, {
      symbol: filters?.symbol,
      outcome: filters?.outcome,
      dateFrom: filters?.dateRange?.from,
      dateTo: filters?.dateRange?.to,
    });
    return applyLocalMirror(userId, rows).sort((a, b) => (
      new Date(b.pre_simulated_time).getTime() - new Date(a.pre_simulated_time).getTime()
      || a.id.localeCompare(b.id)
    ));
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
  const journal = (data as unknown as TradeJournal) ?? null;
  if (!journal) return null;
  const mirroredJournal = applyLocalMirror(journal.user_id, [journal])[0] ?? journal;
  if (!mirroredJournal.trade_record_id) return mirroredJournal;
  try {
    const { data: siblings, error: siblingError } = await supabase
      .from("trade_journals" as never)
      .select("*")
      .eq("user_id", mirroredJournal.user_id)
      .eq("trade_record_id", mirroredJournal.trade_record_id);
    if (siblingError) {
      console.warn('[journalApi] 读取历史评价兄弟记录失败:', siblingError);
      return mirroredJournal;
    }
    const mirroredSiblings = applyLocalMirror(
      mirroredJournal.user_id,
      (siblings ?? []) as unknown as TradeJournal[],
    );
    return hydrateJournalReviews([mirroredJournal, ...mirroredSiblings])[0] ?? mirroredJournal;
  } catch (error) {
    console.warn('[journalApi] 读取历史评价兄弟记录失败:', error);
    return mirroredJournal;
  }
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

export interface SyncCampaignDeviationRulesResult {
  drafts: number;
  created: number;
  skipped: number;
}

// ============ Batch 3 additions ============

export interface FinalizeJournalInput {
  post_every_ball_pct?: TradeJournal['post_every_ball_pct'];
  post_outcome: TradeOutcome;
  post_realized_pnl: number | null;
  post_r_multiple: number | null;
  post_reflection: string;
  post_correct_action: string;
  post_result_summary?: string | null;
  post_decision_quality?: TradeJournal['post_decision_quality'];
  post_entry_decision_quality?: TradeJournal['post_entry_decision_quality'];
  post_holding_decision_quality?: TradeJournal['post_holding_decision_quality'];
  post_exit_decision_quality?: TradeJournal['post_exit_decision_quality'];
  post_exit_nature?: TradeJournal['post_exit_nature'];
  post_struggle_level?: TradeJournal['post_struggle_level'];
  post_small_position_drag?: TradeJournal['post_small_position_drag'];
  post_missed_high_odds_state?: TradeJournal['post_missed_high_odds_state'];
  post_path_first_move?: TradeJournal['post_path_first_move'];
  post_path_drawdown?: TradeJournal['post_path_drawdown'];
  post_path_win_quality?: TradeJournal['post_path_win_quality'];
  post_path_agency_note?: string | null;
  post_path_mode?: TradeJournal['post_path_mode'];
  post_trade_agency_score?: TradeJournal['post_trade_agency_score'];
  /** 复盘时回填快照漏标的 edge 源头（旧快照），用于「盈亏同源」统计。 */
  pre_edge_source?: TradeJournal['pre_edge_source'];
  post_positive_expectancy_review?: string | null;
  post_premortem_review?: string | null;
  post_invalidation_review?: string | null;
  post_entry_payoff_estimate_grade?: TradeJournal['post_entry_payoff_estimate_grade'];
  post_opportunity_quality_payoff_ratio?: TradeJournal['post_opportunity_quality_payoff_ratio'];
  post_opportunity_quality_drawdown_pct?: TradeJournal['post_opportunity_quality_drawdown_pct'];
  post_entry_win_rate_estimate_grade?: TradeJournal['post_entry_win_rate_estimate_grade'];
  post_entry_payoff_basis_review?: string | null;
  post_entry_win_rate_basis_review?: string | null;
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
  const extraResult = Object.keys(extra).length > 0
    ? await updateTradeJournalWithSchemaFallback(journalId, extra)
    : { data: null, error: null, droppedColumns: [] as string[] };
  if (extraResult.error && !isMissingDalioMetaLayerError(extraResult.error)) {
    throw new Error(`提交平仓评价失败：${extraResult.error.message}`);
  }
  // 极旧 schema 返回了无法精确解析的“评价扩展层不存在”错误时，把整组扩展字段
  // 视为远程 dropped，并完整镜像，不能只保存基础六列却对用户报成功。
  const implicitDropped = extraResult.error ? Object.keys(extra) : [];
  const allDropped = Array.from(new Set([
    ...baseResult.droppedColumns,
    ...extraResult.droppedColumns,
    ...implicitDropped,
  ]));
  let mirrorUserId = (baseJournal as { user_id?: string | null } | null)?.user_id ?? null;
  try {
    if (!mirrorUserId) {
      const { data: sessionData } = await supabase.auth.getSession();
      mirrorUserId = sessionData?.session?.user?.id ?? null;
    }
    reconcileLocalMirror(mirrorUserId, journalId, payload as Record<string, unknown>, allDropped);
  } catch (error) {
    console.warn('[journalApi] 本地评价镜像对账失败:', error);
  }
  if (allDropped.length > 0) {
    console.warn('[journalApi] 远程数据库缺以下列，本次评价的对应字段未保存：', allDropped);
    // 本地镜像兜底：把被剥掉的字段在 localStorage 写一份，错题集 reload 时合并回去——
    // 用户单设备上始终能在错题集汇总看到自己填的内容，无视远程 schema 漂移。
    try {
      // 镜像 userId 必须可靠：优先取「刚 update 成功那行」自带的 user_id——它是核心列，
      // .select() 一定带回，且与错题集 applyLocalMirror 用的 useAuth().user.id 同源。
      // 仅当那行意外缺 user_id 时，才回退到本地 session（getSession 读 localStorage，不走网络）。
      // 旧实现用 supabase.auth.getUser() 是一次网络请求，抖动/刷新时返回 null 会让
      // mirrorDroppedColumns 静默跳过（它 if(!userId) return）→ 错题集汇总出现 0/N，
      // 正是用户反复报告的「评价没记录进去」。
      mirrorDroppedColumns(mirrorUserId, journalId, payload as Record<string, unknown>, allDropped);
    } catch (e) {
      console.warn('[journalApi] 本地镜像写入失败:', e);
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('journal:schemaDrift', {
        detail: { droppedColumns: allDropped, scope: 'finalize' },
      }));
    }
  }
  const effectiveJournal = {
    ...baseJournal,
    ...((extraResult.data as Partial<TradeJournal> | null) ?? {}),
    ...payload,
  } as TradeJournal;
  return applyLocalMirror(mirrorUserId, [effectiveJournal])[0] ?? effectiveJournal;
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
  const rows = wrap("按交易记录查询日记", error, data as unknown as TradeJournal[]);
  return hydrateJournalReviews(applyLocalMirror(userId, rows));
}

export async function syncTradeRecordCorrectionToJournals(record: TradeRecord): Promise<TradeJournal[]> {
  const userId = await getAuthenticatedUserId("同步成交记录修正");
  const journals = await listJournalsByTradeRecordId(userId, record.id);
  if (journals.length === 0) return [];

  const entryIso = toIso(record.openTime);
  const closeIso = toIso(record.closeTime);
  const patch: Record<string, unknown> = {
    pre_entry_price: record.entryPrice,
    pre_position_size: tradeRecordPositionSize(record),
    post_outcome: tradeRecordOutcome(record),
    post_realized_pnl: record.pnl,
    post_exit_price_snapshot: record.exitPrice,
  };
  if (entryIso) patch.pre_simulated_time = entryIso;
  if (closeIso) patch.post_simulated_close_time = closeIso;
  const objectiveCloseIso = toIso(tradeRecordOperationTime(record));
  if (objectiveCloseIso) patch.post_real_close_time = objectiveCloseIso;

  const updated: TradeJournal[] = [];
  for (const journal of journals) {
    const result = await updateTradeJournalWithSchemaFallback(journal.id, patch);
    if (result.error) {
      throw new Error(`同步成交记录修正失败：${result.error.message}`);
    }
    updated.push({ ...journal, ...((result.data as Partial<TradeJournal> | null) ?? patch) } as TradeJournal);
  }
  await syncTradeRecordCorrectionToCampaigns(record, updated);
  return updated;
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

export async function syncCampaignDeviationRulesToChecklist(
  userId: string,
  notes: Record<string, CampaignDeviationNote>,
  costs: ManualLegDeviationCost[],
  sourceCampaignId?: string,
): Promise<SyncCampaignDeviationRulesResult> {
  const drafts = buildCampaignDeviationRuleDrafts(notes, costs);
  if (drafts.length === 0) return { drafts: 0, created: 0, skipped: 0 };

  const existingRules = await listRules(userId);
  const existingRuleByText = new Map(
    existingRules.map(rule => [normalizeDeviationRuleText(rule.rule_text), rule]),
  );

  let created = 0;
  let skipped = 0;
  for (const draft of drafts) {
    const normalized = normalizeDeviationRuleText(draft.ruleText);
    if (sourceCampaignId) {
      writeLocalTradingRuleSourceCampaign(userId, normalized, sourceCampaignId);
    }
    const existingRule = existingRuleByText.get(normalized);
    if (existingRule) {
      if (sourceCampaignId) bindLocalTradingRuleSourceCampaign(userId, existingRule.id, sourceCampaignId);
      skipped += 1;
      continue;
    }

    const rule = await createRule({
      user_id: userId,
      source_pattern_id: null,
      rule_text: normalized,
      is_active: true,
      added_to_checklist: true,
      required: false,
      rule_category: 'core',
      weight: 70,
      evolution_level: 3,
    });
    if (sourceCampaignId) bindLocalTradingRuleSourceCampaign(userId, rule.id, sourceCampaignId);
    existingRuleByText.set(normalized, rule);
    created += 1;
  }

  return { drafts: drafts.length, created, skipped };
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

async function listJournalAssignmentsPaged(userId: string): Promise<JournalTagAssignment[]> {
  const rows: JournalTagAssignment[] = [];
  for (let from = 0; ; from += JOURNAL_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('journal_tag_assignments' as never)
      .select('*')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, from + JOURNAL_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as JournalTagAssignment[];
    rows.push(...page);
    if (page.length < JOURNAL_PAGE_SIZE) break;
  }
  return rows;
}

export async function listAllJournalDataForUser(
  userId: string,
  filters?: BulkJournalFilters,
): Promise<BulkJournalData> {
  const journalsPromise = listJournalRowsPaged(userId, filters);
  const assignmentsPromise = listJournalAssignmentsPaged(userId);
  const pq = supabase.from("error_tag_patterns" as never).select("*").eq("user_id", userId);
  const cq = supabase.from("error_tag_categories" as never).select("*").order("sort_order", { ascending: true });
  const rq = supabase.from("trading_rules" as never).select("*").eq("user_id", userId);
  const ppq = supabase.from('trade_principles' as never).select('*').eq('user_id', userId);
  const plq = supabase.from('pain_log_entries' as never).select('*').eq('user_id', userId);

  let journals: TradeJournal[];
  let assignments: JournalTagAssignment[];
  try {
    [journals, assignments] = await Promise.all([journalsPromise, assignmentsPromise]);
  } catch (error) {
    throw new Error(`加载完整错题集失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const [pr, cr, rr, ppr, plr] = await Promise.all([pq, cq, rq, ppq, plq]);
  if (pr.error) throw new Error(`加载错误模式失败：${pr.error.message}`);
  if (cr.error) throw new Error(`加载分类失败：${cr.error.message}`);
  if (rr.error) throw new Error(`加载规则失败：${rr.error.message}`);
  if (ppr.error && !isMissingDalioMetaLayerError(ppr.error)) throw new Error(`加载原则失败：${ppr.error.message}`);
  if (plr.error && !isMissingDalioMetaLayerError(plr.error)) throw new Error(`加载痛苦日志失败：${plr.error.message}`);

  return {
    journals,
    assignments,
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
  if (current) {
    const normalized = withDefaultCognitiveAssetCategories(current);
    if (normalized.changed) {
      await writeCognitiveAssetsDoc(userId, normalized.doc);
    }
    return normalized.doc;
  }
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
