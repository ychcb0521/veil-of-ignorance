/**
 * /journal/rules — 规则
 *
 * 【用户要求】「布局和内容太复杂了。规则一条一条呈现，每条能链接跳到对应的战役即可，不用冗余的没必要的功能；
 * 要能按时间排序（默认按操作时间排序）。」
 * 所以这一页只做三件事：一条一行列出规则、每条可跳到来源战役、按时间排序。
 * 【用户要求】每行再留一个不显眼的小按钮（铅笔，悬停这一行才显现）：原位改文字，里面带删除。
 * 有进行中的战役时不能改、刚激活 7 天冷却期内不能删——与以前同一套保护。
 * 类型 / 权重 / 演化 / 原则、激活 / Checklist / 必填、原则层与演化地图都不在这里呈现——
 * 规则上的这些字段原样留在数据里，开仓 checklist、必填提醒照旧按它们工作，这一页不改它们。
 *
 * 「操作时间」= 来源战役的客观操作时间（与交易战役列表同一个函数、同一份缓存行），没有来源战役、
 * 或来源战役不在列表里（例如已删除）的规则排在最后，按规则创建时间从新到旧。
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpRight, Pencil } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { toast } from '@/lib/notificationCenter';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useCampaignList } from '@/hooks/useCampaignList';
import {
  bindLocalTradingRuleSourceCampaign,
  deleteRule,
  getLocalTradingRuleSourceCampaignIndex,
  listActiveCampaigns,
  listAllCampaigns,
  listRules,
  updateRule,
} from '@/lib/journalApi';
import {
  buildCampaignDeviationRuleTextFromNote,
  campaignDeviationRuleSourceKeys,
  normalizeDeviationRuleLooseKey,
  normalizeDeviationRuleSourceKey,
} from '@/lib/campaignDeviationRules';
import { campaignOperationTime } from '@/lib/objectiveOperationTime';
import { formatBeijingTime } from '@/lib/timeFormat';
import { parseRuleTextParts } from '@/lib/ruleTextParts';
import { cn } from '@/lib/utils';
import type { TradeCampaign, TradingRule } from '@/types/journal';
import { ruleCooldownRemainingMs } from '@/types/journal';

type RuleSortMode = 'operation' | 'created';

/** 与交易战役卡片同一种小标签：18px 高、3px 圆角。 */
const RULE_CHIP = 'inline-flex h-[18px] shrink-0 items-center rounded-[3px] px-1.5 leading-none whitespace-nowrap';
type RuleSortDirection = 'asc' | 'desc';

/**
 * 【用户要求】「从规则跳到战役、返回时要回到规则；操作逻辑的流畅性是第一位的」。
 * 返回时这一页要原样回来：排序记在地址栏（?sort=created&dir=asc，缺省 = 操作时间从新到旧）；
 * 读过的规则留在内存里，返回时立即画出来、后台再核对一次，不闪「加载中」；滚动位置按这条 history 记录记住。
 */
export type RulesPageNavigationState = { fromRules: true };
const RULES_SCROLL_KEY_PREFIX = 'journal-rules-scroll:';
type RulesPageSnapshot = { rules: TradingRule[]; campaigns: TradeCampaign[]; activeCampaignCount: number };
const rulesPageCache = new Map<string, RulesPageSnapshot>();
/** 测试之间清掉内存里的规则页数据。 */
export function clearRulesPageCache() {
  rulesPageCache.clear();
}

function parseRulesSort(search: string): { mode: RuleSortMode; direction: RuleSortDirection } {
  const params = new URLSearchParams(search);
  return {
    mode: params.get('sort') === 'created' ? 'created' : 'operation',
    direction: params.get('dir') === 'asc' ? 'asc' : 'desc',
  };
}

const SORT_OPTIONS: { mode: RuleSortMode; label: string; hint: string }[] = [
  { mode: 'operation', label: '操作时间', hint: '按来源战役的操作时间排（与交易战役列表同一个时间）；没有来源战役的排在最后' },
  { mode: 'created', label: '创建时间', hint: '按规则写下的时间排' },
];

function timeMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function getRemoteRuleCampaignId(rule: TradingRule): string | null {
  const value = (rule as TradingRule & { source_campaign_id?: unknown }).source_campaign_id;
  return typeof value === 'string' && value ? value : null;
}

interface RuleCampaignSourceIndex {
  byRuleId: Map<string, string>;
  exact: Map<string, string>;
  loose: Map<string, string>;
}

function setSourceKey(map: Map<string, string>, key: string | null | undefined, campaignId: string): void {
  const normalized = normalizeDeviationRuleSourceKey(key);
  if (normalized && !map.has(normalized)) map.set(normalized, campaignId);
}

function setLooseSourceKey(map: Map<string, string>, key: string | null | undefined, campaignId: string): void {
  const normalized = normalizeDeviationRuleLooseKey(key);
  if (normalized && !map.has(normalized)) map.set(normalized, campaignId);
}

function getRuleCampaignId(rule: TradingRule, sources: RuleCampaignSourceIndex): string | null {
  const remoteCampaignId = getRemoteRuleCampaignId(rule);
  if (remoteCampaignId) return remoteCampaignId;

  const stableCampaignId = sources.byRuleId.get(rule.id);
  if (stableCampaignId) return stableCampaignId;

  const keys = campaignDeviationRuleSourceKeys(rule.rule_text);
  for (const key of keys) {
    const exactCampaignId = sources.exact.get(key);
    if (exactCampaignId) return exactCampaignId;
  }
  for (const key of keys) {
    const looseCampaignId = sources.loose.get(normalizeDeviationRuleLooseKey(key));
    if (looseCampaignId) return looseCampaignId;
  }
  return null;
}

function buildCampaignSourceIndex(
  campaigns: TradeCampaign[],
  localSources: { byText: Record<string, string>; byRuleId: Record<string, string> },
): RuleCampaignSourceIndex {
  const byRuleId = new Map<string, string>();
  const exact = new Map<string, string>();
  const loose = new Map<string, string>();
  for (const [ruleId, campaignId] of Object.entries(localSources.byRuleId)) {
    if (ruleId && campaignId && !byRuleId.has(ruleId)) byRuleId.set(ruleId, campaignId);
  }
  for (const campaign of campaigns) {
    for (const note of Object.values(campaign.deviation_notes ?? {})) {
      const ruleText = buildCampaignDeviationRuleTextFromNote(note);
      setSourceKey(exact, ruleText, campaign.id);
      setLooseSourceKey(loose, ruleText, campaign.id);
      setLooseSourceKey(loose, note.fix, campaign.id);
    }
  }
  for (const [ruleText, campaignId] of Object.entries(localSources.byText)) {
    setSourceKey(exact, ruleText, campaignId);
    setLooseSourceKey(loose, ruleText, campaignId);
  }
  return { byRuleId, exact, loose };
}

type RuleRow = {
  rule: TradingRule;
  campaignId: string | null;
  campaign: TradeCampaign | null;
  operationMs: number | null;
  createdMs: number | null;
};

/** 按所选时间排：没有这个时间的行一律排在最后（不论方向），再按创建时间从新到旧；最后按 id 保证稳定。 */
export function sortRuleRows(rows: readonly RuleRow[], mode: RuleSortMode, direction: RuleSortDirection): RuleRow[] {
  const keyOf = (row: RuleRow) => (mode === 'operation' ? row.operationMs : row.createdMs);
  return [...rows].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka == null || kb == null) {
      if (ka != null) return -1;
      if (kb != null) return 1;
    } else if (ka !== kb) {
      return direction === 'desc' ? kb - ka : ka - kb;
    }
    return (b.createdMs ?? 0) - (a.createdMs ?? 0) || a.rule.id.localeCompare(b.rule.id);
  });
}

export default function JournalRulesPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const userId = user?.id;
  const cached = userId ? rulesPageCache.get(userId) : undefined;
  const { tradeHistory, ordersMap, filledOrders, positionsMap } = useTradingContext();
  // 与交易战役列表同一份缓存：操作时间在两页是同一个数，已经打开过战役列表时不再重读
  const { rows: campaignRows } = useCampaignList(user?.id, { tradeHistory, ordersMap, filledOrders, positionsMap });
  const [rules, setRules] = useState<TradingRule[]>(() => cached?.rules ?? []);
  const [campaigns, setCampaigns] = useState<TradeCampaign[]>(() => cached?.campaigns ?? []);
  const [localRuleSources, setLocalRuleSources] = useState<{ byText: Record<string, string>; byRuleId: Record<string, string> }>({
    byText: {},
    byRuleId: {},
  });
  const [loading, setLoading] = useState(!cached);
  const { mode: sortMode, direction: sortDirection } = useMemo(() => parseRulesSort(location.search), [location.search]);
  /** 有进行中的战役时规则冻结（执行者时段不许改规则）。 */
  const [activeCampaignCount, setActiveCampaignCount] = useState(() => cached?.activeCampaignCount ?? 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    // 内存里已经有这一页的数据（从战役返回）：照常显示、后台核对，不回到「加载中」
    if (!rulesPageCache.has(userId)) setLoading(true);
    (async () => {
      try {
        const [r, allCampaigns, active] = await Promise.all([
          listRules(userId),
          listAllCampaigns(userId, { status: 'all' }),
          listActiveCampaigns(userId),
        ]);
        if (cancelled) return;
        setRules(r.filter(x => x.rule_text !== '[延后]'));
        setCampaigns(allCampaigns);
        setActiveCampaignCount(active.length);
        setLocalRuleSources(getLocalTradingRuleSourceCampaignIndex(userId));
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // 读到的、改过的都记进内存，返回这一页时直接用
  useEffect(() => {
    if (!userId || loading) return;
    rulesPageCache.set(userId, { rules, campaigns, activeCampaignCount });
  }, [userId, loading, rules, campaigns, activeCampaignCount]);

  // 本地来源索引只在本机，缓存命中时也要先读一次，否则第一帧的战役链接是空的
  useEffect(() => {
    if (userId && cached) setLocalRuleSources(getLocalTradingRuleSourceCampaignIndex(userId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // 从战役返回：滚回点进去之前的位置（按这条 history 记录记的，只用一次）
  useEffect(() => {
    if (loading || rules.length === 0) return;
    const storageKey = `${RULES_SCROLL_KEY_PREFIX}${location.key}`;
    let saved: number;
    try {
      saved = Number(sessionStorage.getItem(storageKey));
      sessionStorage.removeItem(storageKey);
    } catch {
      return;
    }
    if (!Number.isFinite(saved) || saved <= 0) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: saved }));
    return () => window.cancelAnimationFrame(frame);
  }, [loading, rules.length, location.key]);

  const openCampaign = (campaignId: string) => {
    try {
      sessionStorage.setItem(`${RULES_SCROLL_KEY_PREFIX}${location.key}`, String(window.scrollY));
    } catch {
      // 存不了也照样跳，只是回来时不回到原位置
    }
    const state: RulesPageNavigationState = { fromRules: true };
    nav(`/journal/campaigns/${campaignId}`, { state });
  };

  const designBlocked = activeCampaignCount > 0;

  const startEdit = (rule: TradingRule) => {
    setEditingId(rule.id);
    setEditText(rule.rule_text);
  };

  const saveEdit = async (rule: TradingRule) => {
    const text = editText.trim();
    if (!text) {
      toast.error('规则文字不能为空');
      return;
    }
    if (text === rule.rule_text) {
      setEditingId(null);
      return;
    }
    setSavingId(rule.id);
    try {
      await updateRule(rule.id, { rule_text: text });
      // 来源战役按规则 id 绑定（见上面的迁移），改了文字链接不丢
      setRules(prev => prev.map(item => (item.id === rule.id ? { ...item, rule_text: text } : item)));
      setEditingId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const removeRule = async (rule: TradingRule) => {
    if (!confirm('删除这条规则？已加入开仓 checklist 的，下次开仓将不再出现。')) return;
    setSavingId(rule.id);
    try {
      await deleteRule(rule.id);
      setRules(prev => prev.filter(item => item.id !== rule.id));
      setEditingId(null);
      toast.message('已删除规则');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const campaignMap = useMemo(() => new Map(campaigns.map(campaign => [campaign.id, campaign])), [campaigns]);
  const ruleCampaignSources = useMemo(
    () => buildCampaignSourceIndex(campaigns, localRuleSources),
    [campaigns, localRuleSources],
  );

  // 按文字匹配到来源战役的老规则：把匹配结果按规则 id 记下来，之后改了规则文字也不丢链接
  useEffect(() => {
    if (!user?.id || rules.length === 0) return;
    const migratedRuleSources: Record<string, string> = {};
    for (const rule of rules) {
      if (getRemoteRuleCampaignId(rule) || ruleCampaignSources.byRuleId.has(rule.id)) continue;
      const campaignId = getRuleCampaignId(rule, ruleCampaignSources);
      if (!campaignId) continue;
      bindLocalTradingRuleSourceCampaign(user.id, rule.id, campaignId);
      migratedRuleSources[rule.id] = campaignId;
    }
    if (Object.keys(migratedRuleSources).length > 0) {
      setLocalRuleSources(prev => ({ ...prev, byRuleId: { ...prev.byRuleId, ...migratedRuleSources } }));
    }
  }, [ruleCampaignSources, rules, user?.id]);

  const operationMsByCampaign = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of campaignRows) {
      const ms = campaignOperationTime(row.legs, row.tradeRecords);
      if (ms != null) map.set(row.campaign.id, ms);
    }
    return map;
  }, [campaignRows]);

  const sortedRows = useMemo(() => sortRuleRows(rules.map(rule => {
    const campaignId = getRuleCampaignId(rule, ruleCampaignSources);
    return {
      rule,
      campaignId,
      campaign: campaignId ? campaignMap.get(campaignId) ?? null : null,
      operationMs: campaignId ? operationMsByCampaign.get(campaignId) ?? null : null,
      createdMs: timeMs(rule.created_at),
    };
  }), sortMode, sortDirection), [rules, ruleCampaignSources, campaignMap, operationMsByCampaign, sortMode, sortDirection]);

  const handleSort = (mode: RuleSortMode) => {
    const nextDirection: RuleSortDirection = mode === sortMode ? (sortDirection === 'desc' ? 'asc' : 'desc') : 'desc';
    const params = new URLSearchParams(location.search);
    if (mode === 'operation') params.delete('sort'); else params.set('sort', mode);
    if (nextDirection === 'desc') params.delete('dir'); else params.set('dir', nextDirection);
    const search = params.toString();
    // 换排序不新增 history 记录：返回键仍是「回到上一页」
    nav({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 顶栏与交易战役页同一套：返回、标题 + 一行说明；排序收成右侧一枚很小的分段按钮 */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[980px] items-center gap-3 px-4 sm:px-6">
          <BackButton />
          <div className="min-w-0">
            <h1 className="text-[14px] font-medium">规则</h1>
            <p className="text-[11px] text-muted-foreground">
              {/* 手机上只留条数，说明折成两行会把顶栏撑高 */}
              <span className="max-sm:hidden">从交易战役的偏离里沉淀下来的修正 · </span>
              <span className="font-mono tabular-nums">{rules.length}</span> 条
            </p>
          </div>
          <div
            className="ml-auto inline-flex shrink-0 items-center rounded-md border border-border/70 bg-muted/40 p-0.5 text-[10.5px]"
            role="group"
            aria-label="排序"
          >
            {SORT_OPTIONS.map(option => {
              const active = option.mode === sortMode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  data-testid={`rules-sort-${option.mode}`}
                  aria-pressed={active}
                  title={`${option.hint}；再点一次切换方向`}
                  onClick={() => handleSort(option.mode)}
                  className={cn(
                    'inline-flex h-5 items-center gap-0.5 rounded-[4px] px-1.5 transition-colors',
                    active
                      ? 'bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-accent'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                  {active && (sortDirection === 'desc'
                    ? <ArrowDown aria-label="从新到旧" className="h-2.5 w-2.5 text-[#C98500] dark:text-[#F0B90B]" />
                    : <ArrowUp aria-label="从旧到新" className="h-2.5 w-2.5 text-[#C98500] dark:text-[#F0B90B]" />)}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[980px] px-4 py-5 sm:px-6">
        {loading && rules.length === 0 ? (
          <div className="py-16 text-center text-[12px] text-muted-foreground">加载中…</div>
        ) : sortedRows.length === 0 ? (
          <div className="py-16 text-center text-[12px] text-muted-foreground">还没有规则</div>
        ) : (
          <ol data-testid="rules-list" className="space-y-3">
            {sortedRows.map(({ rule, campaignId, campaign, operationMs, createdMs }) => {
              const shownMs = sortMode === 'operation' ? operationMs : createdMs;
              const parts = parseRuleTextParts(rule.rule_text);
              const editing = editingId === rule.id;
              return (
                <li
                  key={rule.id}
                  data-testid="rule-row"
                  data-rule-id={rule.id}
                  className="group relative overflow-hidden rounded-md border border-border bg-card shadow-[0_2px_7px_rgba(15,23,42,0.055)] transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-[0_7px_22px_rgba(15,23,42,0.08)]"
                >
                  <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-[#F0B90B] opacity-60" />
                  <div className="px-4 py-3 sm:px-5">
                    {/* 封面一行：日期（只到日）· 来源战役 · 阶段；右端是悬停才显现的铅笔 */}
                    <div className="flex min-h-[18px] flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span
                        className="font-mono text-[11px] tabular-nums text-muted-foreground"
                        title={sortMode === 'operation' ? '来源战役的操作时间' : '规则创建时间'}
                      >
                        {shownMs != null ? formatBeijingTime(shownMs).slice(0, 10) : '—'}
                      </span>
                      {campaignId ? (
                        <button
                          type="button"
                          aria-label="跳到对应交易战役"
                          title={campaign ? `打开交易战役：${campaign.title}` : '跳到对应交易战役'}
                          onClick={() => openCampaign(campaignId)}
                          className={cn(RULE_CHIP, 'gap-0.5 bg-muted text-[10px] font-medium text-muted-foreground transition-colors hover:bg-[#F0B90B]/15 hover:text-[#8F6B00] dark:hover:text-[#F0B90B]')}
                        >
                          {campaign?.symbol ?? '战役'}
                          <ArrowUpRight aria-hidden="true" className="h-2.5 w-2.5" />
                        </button>
                      ) : (
                        <span className={cn(RULE_CHIP, 'text-[10px] text-muted-foreground/60')}>无来源战役</span>
                      )}
                      {parts.phase && (
                        <span title={parts.phase} className={cn(RULE_CHIP, 'max-w-[18rem] overflow-hidden border border-border/70 text-[10px] text-muted-foreground')}>
                          <span className="truncate">{parts.phase}</span>
                        </span>
                      )}
                      {/* 【用户要求】不显眼的小按钮：平时透明，悬停这张卡或键盘聚焦时才显现 */}
                      <span
                        className="ml-auto inline-flex"
                        title={designBlocked ? '有进行中的交易战役时规则冻结，先结束战役再改' : '编辑或删除这条规则'}
                      >
                        <button
                          type="button"
                          data-testid="rule-edit"
                          aria-label="编辑或删除这条规则"
                          disabled={designBlocked || editing}
                          onClick={() => startEdit(rule)}
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-70 disabled:pointer-events-none max-sm:opacity-40"
                        >
                          <Pencil aria-hidden="true" className="h-3 w-3" />
                        </button>
                      </span>
                    </div>

                    {editing ? (
                      <div className="mt-2.5 space-y-1.5" data-testid="rule-editor">
                        <textarea
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          rows={Math.min(8, Math.max(3, Math.ceil(editText.length / 56)))}
                          autoFocus
                          aria-label="规则文字"
                          className="w-full resize-y rounded border border-border bg-background px-2.5 py-2 text-[12.5px] leading-[22px] outline-none focus:border-[#F0B90B]/70 focus:ring-2 focus:ring-[#F0B90B]/15"
                        />
                        <div className="flex items-center gap-1.5 text-[11px]">
                          <button
                            type="button"
                            disabled={savingId === rule.id}
                            onClick={() => void saveEdit(rule)}
                            className="h-6 rounded bg-[#F0B90B] px-2.5 font-medium text-black transition-colors hover:bg-[#F0B90B]/90 disabled:opacity-50"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="h-6 rounded px-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            取消
                          </button>
                          {/* 删除收在编辑里；冷却期内停用，提示挂在外层 span（停用按钮收不到悬停） */}
                          {(() => {
                            const cooldownMs = ruleCooldownRemainingMs(rule);
                            const cooling = cooldownMs > 0;
                            return (
                              <span
                                className="ml-auto inline-flex"
                                title={cooling ? `刚激活的规则 ${Math.ceil(cooldownMs / 86_400_000)} 天后才能删除（7 天冷却期）` : undefined}
                              >
                                <button
                                  type="button"
                                  data-testid="rule-delete"
                                  disabled={cooling || savingId === rule.id}
                                  onClick={() => void removeRule(rule)}
                                  className="h-6 rounded px-2 text-muted-foreground transition-colors hover:bg-[#F6465D]/10 hover:text-[#F6465D] disabled:pointer-events-none disabled:opacity-40"
                                >
                                  删除
                                </button>
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                    ) : (
                      /* 【用户要求】违规与修正分行、一眼分得开：红色「违规」+ 淡色原因；绿色「修正」+ 实色加粗的规则本身 */
                      <dl className="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-1.5">
                        {parts.violation && (
                          <>
                            <dt className={cn(RULE_CHIP, 'mt-[2px] bg-[#F6465D]/10 text-[10px] font-medium text-[#CF304A] dark:text-[#F6465D]')}>违规</dt>
                            <dd data-testid="rule-violation" className="text-[12.5px] leading-[22px] text-muted-foreground">{parts.violation}</dd>
                          </>
                        )}
                        <dt className={cn(RULE_CHIP, 'mt-[2px] bg-[#0ECB81]/12 text-[10px] font-medium text-[#07875A] dark:text-[#0ECB81]')}>
                          {parts.violation ? '修正' : '规则'}
                        </dt>
                        <dd data-testid="rule-fix" className="text-[13px] font-medium leading-[22px] text-foreground">{parts.fix}</dd>
                      </dl>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}
