/**
 * /journal/rules — 交易规则管理页
 * 列出用户所有规则（含规则源 pattern、是否生效、是否进入 checklist、是否必填、snooze 状态）。
 * 支持编辑、激活/停用、加入/移出 checklist、删除。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Check,
  GitBranch,
  Layers3,
  ListChecks,
  LockKeyhole,
  Pencil,
  Plus,
  Scale,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  bindLocalTradingRuleSourceCampaign,
  createPrinciple,
  deleteRule,
  getLocalTradingRuleSourceCampaignIndex,
  listActiveCampaigns,
  listAllCampaigns,
  listPatterns,
  listPrinciples,
  listRules,
  updateRule,
} from '@/lib/journalApi';
import {
  buildCampaignDeviationRuleTextFromNote,
  campaignDeviationRuleSourceKeys,
  normalizeDeviationRuleLooseKey,
  normalizeDeviationRuleSourceKey,
} from '@/lib/campaignDeviationRules';
import { cn } from '@/lib/utils';
import type {
  ErrorTagPattern,
  PrincipleEvolutionLevel,
  RuleCategory,
  TradeCampaign,
  TradePrinciple,
  TradingRule,
} from '@/types/journal';
import { PRINCIPLE_EVOLUTION_LEVEL_LABELS, ruleCooldownRemainingMs } from '@/types/journal';

const RULE_CATEGORY_ORDER: RuleCategory[] = ['hard', 'core', 'watch', 'retired'];

const CATEGORY_META: Record<RuleCategory, {
  label: string;
  brief: string;
  dotClass: string;
  badgeClass: string;
  railClass: string;
}> = {
  hard: {
    label: '硬规则',
    brief: '不可轻易削弱',
    dotClass: 'bg-[#F6465D]',
    badgeClass: 'border-[#F6465D]/30 bg-[#F6465D]/10 text-[#F6465D]',
    railClass: 'bg-[#F6465D]',
  },
  core: {
    label: '核心规则',
    brief: '默认进入清单',
    dotClass: 'bg-[#F0B90B]',
    badgeClass: 'border-[#F0B90B]/40 bg-[#F0B90B]/10 text-[#9A6B00]',
    railClass: 'bg-[#F0B90B]',
  },
  watch: {
    label: '观察规则',
    brief: '先记录，不强制',
    dotClass: 'bg-[#4EA1FF]',
    badgeClass: 'border-[#4EA1FF]/35 bg-[#4EA1FF]/10 text-[#2475D1]',
    railClass: 'bg-[#4EA1FF]',
  },
  retired: {
    label: '失效规则',
    brief: '保留痕迹',
    dotClass: 'bg-muted-foreground',
    badgeClass: 'border-border bg-muted text-muted-foreground',
    railClass: 'bg-muted-foreground',
  },
};

const selectClassName = 'h-8 w-full rounded-md border border-border bg-background px-2 text-[11px] text-foreground shadow-sm outline-none transition focus:border-[#F0B90B]/70 focus:ring-2 focus:ring-[#F0B90B]/15 disabled:cursor-not-allowed disabled:opacity-50';
const inputClassName = 'h-8 rounded-md border-border bg-background text-[11px] shadow-sm focus-visible:ring-[#F0B90B]/25';
const fieldLabelClassName = 'mb-1 text-[10px] font-medium text-muted-foreground';

function formatCompactDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
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

export default function JournalRulesPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [rules, setRules] = useState<TradingRule[]>([]);
  const [patterns, setPatterns] = useState<ErrorTagPattern[]>([]);
  const [principles, setPrinciples] = useState<TradePrinciple[]>([]);
  const [activeCampaigns, setActiveCampaigns] = useState<TradeCampaign[]>([]);
  const [campaigns, setCampaigns] = useState<TradeCampaign[]>([]);
  const [localRuleSources, setLocalRuleSources] = useState<{ byText: Record<string, string>; byRuleId: Record<string, string> }>({
    byText: {},
    byRuleId: {},
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [newPrincipleTitle, setNewPrincipleTitle] = useState('');
  const [newPrincipleBody, setNewPrincipleBody] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [r, p, c, pr, allCampaigns] = await Promise.all([
        listRules(user.id),
        listPatterns(user.id, { includeArchived: true }),
        listActiveCampaigns(user.id),
        listPrinciples(user.id),
        listAllCampaigns(user.id, { status: 'all' }),
      ]);
      const rank: Record<string, number> = { hard: 0, core: 1, watch: 2, retired: 3 };
      setRules(r
        .filter(x => x.rule_text !== '[延后]')
        .sort((a, b) => {
          const ar = rank[a.rule_category ?? 'core'] ?? 1;
          const br = rank[b.rule_category ?? 'core'] ?? 1;
          if (ar !== br) return ar - br;
          return (b.weight ?? 50) - (a.weight ?? 50);
        }));
      setPatterns(p);
      setActiveCampaigns(c);
      setPrinciples(pr);
      setCampaigns(allCampaigns);
      setLocalRuleSources(getLocalTradingRuleSourceCampaignIndex(user.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  const patternMap = useMemo(() => new Map(patterns.map(p => [p.id, p])), [patterns]);
  const campaignMap = useMemo(() => new Map(campaigns.map(campaign => [campaign.id, campaign])), [campaigns]);
  const ruleCampaignSources = useMemo(
    () => buildCampaignSourceIndex(campaigns, localRuleSources),
    [campaigns, localRuleSources],
  );

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
      setLocalRuleSources(prev => ({
        ...prev,
        byRuleId: {
          ...prev.byRuleId,
          ...migratedRuleSources,
        },
      }));
    }
  }, [ruleCampaignSources, rules, user?.id]);

  const designBlocked = activeCampaigns.length > 0;
  const evolutionCounts = useMemo(() => {
    const counts = new Map<number, number>();
    rules.forEach(rule => counts.set(rule.evolution_level ?? 3, (counts.get(rule.evolution_level ?? 3) ?? 0) + 1));
    return counts;
  }, [rules]);
  const stats = useMemo(() => ({
    active: rules.filter(rule => rule.is_active).length,
    checklist: rules.filter(rule => rule.added_to_checklist).length,
    required: rules.filter(rule => rule.required).length,
    linkedCampaigns: rules.filter(rule => getRuleCampaignId(rule, ruleCampaignSources)).length,
  }), [rules, ruleCampaignSources]);
  const groupedRules = useMemo(() => RULE_CATEGORY_ORDER
    .map(category => ({
      category,
      rules: rules.filter(rule => (rule.rule_category ?? 'core') === category),
    }))
    .filter(group => group.rules.length > 0), [rules]);

  const handlePatch = async (id: string, patch: Partial<TradingRule>) => {
    if (designBlocked) {
      toast.error('有进行中的交易战役时不能修改规则。先结束战役，再切回设计者视角。');
      return;
    }
    try {
      await updateRule(id, patch);
      await reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  const handleDelete = async (id: string) => {
    if (designBlocked) {
      toast.error('有进行中的交易战役时不能删除规则。');
      return;
    }
    if (!confirm('删除该规则？已添加到 checklist 的下次开仓将不再出现。')) return;
    try {
      await deleteRule(id);
      await reload();
      toast.message('已删除规则');
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  const handleCategoryChange = (rule: TradingRule, category: RuleCategory) => {
    const patch: Partial<TradingRule> = { rule_category: category };
    if (category === 'hard') {
      patch.is_active = true;
      patch.added_to_checklist = true;
      patch.required = true;
    } else if (category === 'core') {
      patch.is_active = true;
      patch.added_to_checklist = true;
    } else if (category === 'watch') {
      patch.added_to_checklist = false;
      patch.required = false;
    } else if (category === 'retired') {
      patch.is_active = false;
      patch.added_to_checklist = false;
      patch.required = false;
    }
    handlePatch(rule.id, patch);
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim()) {
      toast.error('规则文字不能为空');
      return;
    }
    await handlePatch(id, { rule_text: editText.trim() });
    setEditingId(null);
  };

  const handleCreatePrinciple = async () => {
    if (!user) return;
    if (designBlocked) {
      toast.error('有进行中的交易战役时不能新增原则。');
      return;
    }
    if (!newPrincipleTitle.trim()) {
      toast.error('原则标题不能为空');
      return;
    }
    try {
      await createPrinciple({
        user_id: user.id,
        title: newPrincipleTitle.trim(),
        body: newPrincipleBody.trim(),
        evolution_level: 1,
      });
      setNewPrincipleTitle('');
      setNewPrincipleBody('');
      await reload();
      toast.success('已新增原则');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <TooltipProvider delayDuration={250}>
      <div className="min-h-screen bg-[#FAFBFC] text-foreground">
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-6 py-3">
            <BackButton />
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold tracking-normal text-foreground">规则</h1>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {designBlocked ? `执行者时段 · ${activeCampaigns.length} 个战役进行中` : '设计者时段 · 可维护规则'}
              </div>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-[#F0B90B]" />
              {rules.length} 条规则
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-[1280px] px-6 py-5">
          <section className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
            <div className={cn(
              'rounded-md border px-4 py-3 shadow-sm',
              designBlocked
                ? 'border-[#F6465D]/25 bg-[#F6465D]/[0.04]'
                : 'border-[#0ECB81]/25 bg-[#0ECB81]/[0.05]',
            )}>
              <div className="flex items-start gap-3">
                <div className={cn(
                  'mt-0.5 flex h-8 w-8 items-center justify-center rounded-md border',
                  designBlocked
                    ? 'border-[#F6465D]/25 bg-[#F6465D]/10 text-[#F6465D]'
                    : 'border-[#0ECB81]/25 bg-[#0ECB81]/10 text-[#0ECB81]',
                )}>
                  {designBlocked ? <LockKeyhole className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <div className={cn(
                    'text-[13px] font-semibold',
                    designBlocked ? 'text-[#F6465D]' : 'text-[#0ECB81]',
                  )}>
                    {designBlocked ? '规则锁定中' : '规则可编辑'}
                  </div>
                  <div className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    {designBlocked
                      ? '有进行中的交易战役时，规则、原则与 checklist 保持冻结。'
                      : '当前没有进行中战役，可以维护原则、规则与 checklist。'}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: '激活', value: stats.active, icon: Activity },
                { label: '清单', value: stats.checklist, icon: ListChecks },
                { label: '必填', value: stats.required, icon: LockKeyhole },
                { label: '战役', value: stats.linkedCampaigns, icon: GitBranch },
              ].map(item => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className="rounded-md border border-border bg-card px-3 py-2 shadow-sm">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{item.label}</span>
                      <Icon className="h-3.5 w-3.5 text-[#F0B90B]" />
                    </div>
                    <div className="mt-1 font-mono text-[18px] font-semibold text-foreground">{item.value}</div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
            <details className="group rounded-md border border-border bg-card shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[12px] font-semibold text-foreground">
                <span className="inline-flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-[#F0B90B]" />
                  L1 原则层 · {principles.length} 条
                </span>
                <Plus className="h-3.5 w-3.5 text-muted-foreground transition group-open:rotate-45" />
              </summary>
              <div className="grid gap-3 border-t border-border p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                <Input
                  value={newPrincipleTitle}
                  disabled={designBlocked}
                  onChange={e => setNewPrincipleTitle(e.target.value)}
                  placeholder="原则标题"
                  className={cn(inputClassName, 'h-9 text-[12px]')}
                />
                <Textarea
                  value={newPrincipleBody}
                  disabled={designBlocked}
                  onChange={e => setNewPrincipleBody(e.target.value)}
                  placeholder="原则说明"
                  rows={1}
                  className="min-h-9 border-border bg-background text-[12px] shadow-sm focus-visible:ring-[#F0B90B]/25"
                />
                <Button
                  type="button"
                  disabled={designBlocked || !newPrincipleTitle.trim()}
                  onClick={handleCreatePrinciple}
                  className="h-9 bg-[#F0B90B] text-[12px] text-black hover:bg-[#F0B90B]/90"
                >
                  新增原则
                </Button>
                {principles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 md:col-span-3">
                    {principles.map(principle => (
                      <span key={principle.id} className="rounded-full border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">
                        L{principle.evolution_level} {PRINCIPLE_EVOLUTION_LEVEL_LABELS[principle.evolution_level]} · {principle.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </details>

            <div className="rounded-md border border-border bg-card px-4 py-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-foreground">
                <Layers3 className="h-4 w-4 text-[#F0B90B]" />
                演化地图
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {[0, 1, 2, 3, 4, 5].map(level => (
                  <div key={level} className="rounded-md border border-border bg-background px-2 py-1.5 text-center">
                    <div className="text-[10px] text-muted-foreground">L{level}</div>
                    <div className="font-mono text-[13px] font-semibold text-foreground">{evolutionCounts.get(level) ?? 0}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {loading ? (
            <div className="rounded-md border border-border bg-card px-4 py-8 text-center font-mono text-[12px] text-muted-foreground shadow-sm">
              加载中...
            </div>
          ) : rules.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-card px-6 py-14 text-center shadow-sm">
              <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <div className="text-[13px] font-semibold text-foreground">暂无规则</div>
              <div className="mt-1 text-[12px] text-muted-foreground">规则会在复盘后沉淀到这里。</div>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedRules.map(group => {
                const groupMeta = CATEGORY_META[group.category];
                return (
                  <section key={group.category} className="overflow-hidden rounded-md border border-border bg-card shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/25 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn('h-2 w-2 rounded-full', groupMeta.dotClass)} />
                        <div>
                          <div className="text-[13px] font-semibold text-foreground">{groupMeta.label}</div>
                          <div className="text-[10px] text-muted-foreground">{groupMeta.brief}</div>
                        </div>
                      </div>
                      <span className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                        {group.rules.length} 条
                      </span>
                    </div>

                    <div className="divide-y divide-border">
                      {group.rules.map(rule => {
                        const category = (rule.rule_category ?? 'core') as RuleCategory;
                        const meta = CATEGORY_META[category];
                        const pattern = rule.source_pattern_id ? patternMap.get(rule.source_pattern_id) : null;
                        const campaignId = getRuleCampaignId(rule, ruleCampaignSources);
                        const sourceCampaign = campaignId ? campaignMap.get(campaignId) : null;
                        const snoozed = rule.snooze_until && new Date(rule.snooze_until).getTime() > Date.now();
                        const cooldownMs = ruleCooldownRemainingMs(rule);
                        const locked = cooldownMs > 0;
                        const lockedDays = locked ? Math.ceil(cooldownMs / 86400_000) : 0;

                        return (
                          <article key={rule.id} className="relative grid gap-4 bg-background px-4 py-4 transition hover:bg-muted/20 xl:grid-cols-[minmax(280px,1.15fr)_minmax(520px,1fr)_auto]">
                            <div className={cn('absolute left-0 top-0 h-full w-1', meta.railClass)} />
                            <div className="min-w-0 pl-2">
                              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', meta.badgeClass)}>
                                  {meta.label}
                                </span>
                                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                                  {pattern ? pattern.pattern_name : '手动'}
                                </span>
                                {sourceCampaign && (
                                  <span className="rounded-full border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-2 py-0.5 text-[10px] text-[#9A6B00]">
                                    {sourceCampaign.symbol} · {formatCompactDate(sourceCampaign.opened_at)}
                                  </span>
                                )}
                                {snoozed && (
                                  <span className="rounded-full border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-2 py-0.5 text-[10px] text-[#9A6B00]">
                                    延后至 {formatCompactDate(rule.snooze_until)}
                                  </span>
                                )}
                                {locked && (
                                  <span className="rounded-full border border-[#F6465D]/25 bg-[#F6465D]/10 px-2 py-0.5 text-[10px] text-[#F6465D]">
                                    冷却 {lockedDays} 天
                                  </span>
                                )}
                              </div>

                              {editingId === rule.id ? (
                                <div className="space-y-2">
                                  <Textarea
                                    value={editText}
                                    onChange={e => setEditText(e.target.value)}
                                    rows={4}
                                    className="border-border bg-background text-[12px] leading-5 shadow-sm focus-visible:ring-[#F0B90B]/25"
                                  />
                                  <div className="flex gap-1.5">
                                    <Button size="sm" className="h-8 bg-[#F0B90B] px-2 text-[11px] text-black hover:bg-[#F0B90B]/90" disabled={designBlocked} onClick={() => saveEdit(rule.id)}>
                                      <Check className="h-3.5 w-3.5" />
                                      保存
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-8 px-2 text-[11px]" onClick={() => setEditingId(null)}>
                                      <X className="h-3.5 w-3.5" />
                                      取消
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="whitespace-pre-wrap text-[13px] font-medium leading-6 text-foreground">
                                  {rule.rule_text}
                                </div>
                              )}
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.1fr_0.75fr_1.2fr_1.2fr]">
                              <div>
                                <div className={fieldLabelClassName}>类型</div>
                                <select
                                  value={category}
                                  onChange={(e) => handleCategoryChange(rule, e.target.value as RuleCategory)}
                                  disabled={locked || designBlocked}
                                  className={selectClassName}
                                >
                                  <option value="hard">硬规则</option>
                                  <option value="core">核心规则</option>
                                  <option value="watch">观察规则</option>
                                  <option value="retired">失效规则</option>
                                </select>
                              </div>

                              <div>
                                <div className={fieldLabelClassName}>权重</div>
                                <div className="relative">
                                  <Scale className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                                  <Input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={rule.weight ?? 50}
                                    disabled={designBlocked}
                                    onChange={e => {
                                      const next = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                                      handlePatch(rule.id, { weight: next });
                                    }}
                                    className={cn(inputClassName, 'pl-7 text-center font-mono')}
                                  />
                                </div>
                              </div>

                              <div>
                                <div className={fieldLabelClassName}>演化</div>
                                <select
                                  value={rule.evolution_level ?? 3}
                                  disabled={designBlocked}
                                  onChange={e => handlePatch(rule.id, { evolution_level: Number(e.target.value) as PrincipleEvolutionLevel })}
                                  className={selectClassName}
                                >
                                  {[0, 1, 2, 3, 4, 5].map(level => (
                                    <option key={level} value={level}>
                                      L{level} {PRINCIPLE_EVOLUTION_LEVEL_LABELS[level as PrincipleEvolutionLevel]}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <div className={fieldLabelClassName}>原则</div>
                                <select
                                  value={rule.principle_id ?? ''}
                                  disabled={designBlocked}
                                  onChange={e => handlePatch(rule.id, { principle_id: e.target.value || null })}
                                  className={selectClassName}
                                >
                                  <option value="">未绑定</option>
                                  {principles.map(principle => (
                                    <option key={principle.id} value={principle.id}>
                                      {principle.title}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="grid grid-cols-3 gap-2 md:col-span-2 xl:col-span-4">
                                <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
                                  <span className="text-[11px] text-muted-foreground">激活</span>
                                  <Switch
                                    checked={rule.is_active}
                                    disabled={designBlocked || (locked && rule.is_active) || rule.rule_category === 'hard'}
                                    onCheckedChange={(v) => handlePatch(rule.id, { is_active: v })}
                                  />
                                </div>
                                <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
                                  <span className="text-[11px] text-muted-foreground">Checklist</span>
                                  <Switch
                                    checked={rule.added_to_checklist}
                                    disabled={designBlocked || (locked && rule.added_to_checklist) || rule.rule_category === 'hard' || rule.rule_category === 'core' || rule.rule_category === 'watch' || rule.rule_category === 'retired'}
                                    onCheckedChange={(v) => handlePatch(rule.id, { added_to_checklist: v })}
                                  />
                                </div>
                                <div className="flex items-center justify-between rounded-md border border-border bg-muted/20 px-3 py-2">
                                  <span className="text-[11px] text-muted-foreground">必填</span>
                                  <Switch
                                    checked={rule.required}
                                    disabled={designBlocked || (locked && rule.required) || rule.rule_category === 'hard' || rule.rule_category === 'watch' || rule.rule_category === 'retired'}
                                    onCheckedChange={(v) => handlePatch(rule.id, { required: v })}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="flex items-start justify-end gap-1.5 xl:flex-col xl:items-end">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={!campaignId}
                                    aria-label="跳到对应交易战役"
                                    className="h-8 px-2 text-[11px] text-muted-foreground hover:text-[#F0B90B] disabled:opacity-30"
                                    onClick={() => {
                                      if (campaignId) nav(`/journal/campaigns/${campaignId}`);
                                    }}
                                  >
                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                    战役
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="text-[11px]">
                                  {campaignId ? '跳到对应交易战役' : '暂无来源战役'}
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={designBlocked}
                                    aria-label="编辑规则"
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                    onClick={() => { setEditingId(rule.id); setEditText(rule.rule_text); }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="text-[11px]">编辑规则</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={locked || designBlocked}
                                    aria-label="删除规则"
                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-[#F6465D] disabled:opacity-30"
                                    onClick={() => handleDelete(rule.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="text-[11px]">删除规则</TooltipContent>
                              </Tooltip>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
