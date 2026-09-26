/**
 * /journal/rules — 规则
 *
 * 【用户要求】「布局和内容太复杂了。规则一条一条呈现，每条能链接跳到对应的战役即可，不用冗余的没必要的功能；
 * 要能按时间排序（默认按操作时间排序）。」
 * 所以这一页只做三件事：一条一行列出规则、每条可跳到来源战役、按时间排序。
 * 类型 / 权重 / 演化 / 原则、激活 / Checklist / 必填、编辑 / 删除、原则层与演化地图都不在这里呈现——
 * 规则上的这些字段原样留在数据里，开仓 checklist、必填提醒照旧按它们工作，这一页不改它们。
 *
 * 「操作时间」= 来源战役的客观操作时间（与交易战役列表同一个函数、同一份缓存行），没有来源战役、
 * 或来源战役不在列表里（例如已删除）的规则排在最后，按规则创建时间从新到旧。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpRight } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { toast } from '@/lib/notificationCenter';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useCampaignList } from '@/hooks/useCampaignList';
import {
  bindLocalTradingRuleSourceCampaign,
  getLocalTradingRuleSourceCampaignIndex,
  listAllCampaigns,
  listRules,
} from '@/lib/journalApi';
import {
  buildCampaignDeviationRuleTextFromNote,
  campaignDeviationRuleSourceKeys,
  normalizeDeviationRuleLooseKey,
  normalizeDeviationRuleSourceKey,
} from '@/lib/campaignDeviationRules';
import { campaignOperationTime } from '@/lib/objectiveOperationTime';
import { formatBeijingTime } from '@/lib/timeFormat';
import { cn } from '@/lib/utils';
import type { TradeCampaign, TradingRule } from '@/types/journal';

type RuleSortMode = 'operation' | 'created';
type RuleSortDirection = 'asc' | 'desc';

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
  const { user } = useAuth();
  const { tradeHistory, ordersMap, filledOrders, positionsMap } = useTradingContext();
  // 与交易战役列表同一份缓存：操作时间在两页是同一个数，已经打开过战役列表时不再重读
  const { rows: campaignRows } = useCampaignList(user?.id, { tradeHistory, ordersMap, filledOrders, positionsMap });
  const [rules, setRules] = useState<TradingRule[]>([]);
  const [campaigns, setCampaigns] = useState<TradeCampaign[]>([]);
  const [localRuleSources, setLocalRuleSources] = useState<{ byText: Record<string, string>; byRuleId: Record<string, string> }>({
    byText: {},
    byRuleId: {},
  });
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<RuleSortMode>('operation');
  const [sortDirection, setSortDirection] = useState<RuleSortDirection>('desc');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [r, allCampaigns] = await Promise.all([
          listRules(user.id),
          listAllCampaigns(user.id, { status: 'all' }),
        ]);
        if (cancelled) return;
        setRules(r.filter(x => x.rule_text !== '[延后]'));
        setCampaigns(allCampaigns);
        setLocalRuleSources(getLocalTradingRuleSourceCampaignIndex(user.id));
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

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
    if (mode === sortMode) setSortDirection(current => (current === 'desc' ? 'asc' : 'desc'));
    else {
      setSortMode(mode);
      setSortDirection('desc');
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1080px] items-center gap-3 px-4 py-3 sm:px-6">
          <BackButton />
          <h1 className="text-[15px] font-semibold text-foreground">规则</h1>
          <span className="font-mono text-[11px] text-muted-foreground">{rules.length} 条</span>
          <div className="ml-auto flex items-center gap-1 text-[11px]" role="group" aria-label="排序">
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
                    'inline-flex h-7 items-center gap-0.5 rounded border px-2 transition-colors',
                    active
                      ? 'border-border bg-card font-medium text-foreground shadow-sm'
                      : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {option.label}
                  {active && (sortDirection === 'desc'
                    ? <ArrowDown aria-label="从新到旧" className="h-3 w-3 text-[#C98500] dark:text-[#F0B90B]" />
                    : <ArrowUp aria-label="从旧到新" className="h-3 w-3 text-[#C98500] dark:text-[#F0B90B]" />)}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-4 py-4 sm:px-6">
        {loading && rules.length === 0 ? (
          <div className="py-16 text-center text-[12px] text-muted-foreground">加载中…</div>
        ) : sortedRows.length === 0 ? (
          <div className="py-16 text-center text-[12px] text-muted-foreground">还没有规则</div>
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card" data-testid="rules-list">
            {sortedRows.map(({ rule, campaignId, campaign, operationMs, createdMs }) => {
              const shownMs = sortMode === 'operation' ? operationMs : createdMs;
              return (
                <li
                  key={rule.id}
                  data-testid="rule-row"
                  data-rule-id={rule.id}
                  className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[112px_minmax(0,1fr)_auto] sm:items-start"
                >
                  <div
                    className="font-mono text-[11px] tabular-nums leading-6 text-muted-foreground"
                    title={sortMode === 'operation' ? '来源战役的操作时间' : '规则创建时间'}
                  >
                    {shownMs != null ? formatBeijingTime(shownMs).slice(0, 16) : '—'}
                  </div>
                  <div className="whitespace-pre-wrap text-[13px] leading-6 text-foreground">{rule.rule_text}</div>
                  {campaignId ? (
                    <button
                      type="button"
                      aria-label="跳到对应交易战役"
                      title={campaign ? `${campaign.title}` : '跳到对应交易战役'}
                      onClick={() => nav(`/journal/campaigns/${campaignId}`)}
                      className="inline-flex h-6 items-center gap-1 justify-self-start whitespace-nowrap rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-[#F0B90B]/10 hover:text-[#9A6B00] dark:hover:text-[#F0B90B] sm:justify-self-end"
                    >
                      {campaign?.symbol ?? '战役'}
                      <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="justify-self-start text-[11px] leading-6 text-muted-foreground/50 sm:justify-self-end">无来源战役</span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}
