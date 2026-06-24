import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, FolderPlus, Layers, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BackButton } from '@/components/journal/BackButton';
import { useAuth } from '@/contexts/AuthContext';
import {
  deleteCampaign,
  getCampaignWithLegs,
  listAllCampaigns,
  listVisibleCampaigns,
  updateCampaignImportance,
} from '@/lib/journalApi';
import { LEG_ROLE_LABELS, STRATEGY_TEMPLATES } from '@/lib/strategyTemplates';
import type { CampaignStatus, LegRole, TradeCampaign, TradeJournal } from '@/types/journal';

type CampaignCardData = {
  campaign: TradeCampaign;
  legs: TradeJournal[];
};

type CampaignSortMode = 'importance' | 'time' | 'pnl';
type CampaignSortDirection = 'asc' | 'desc';

type CampaignSortState = {
  mode: CampaignSortMode;
  direction: CampaignSortDirection;
};

const SORT_OPTIONS: { value: CampaignSortMode; label: string }[] = [
  { value: 'importance', label: '重要性' },
  { value: 'time', label: '操作时间' },
  { value: 'pnl', label: '盈亏' },
];

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-[#F0B90B]/15 text-[#F0B90B]',
  closed_profit: 'bg-[#0ECB81]/15 text-[#0ECB81]',
  closed_loss: 'bg-[#F6465D]/15 text-[#F6465D]',
  closed_breakeven: 'bg-muted text-muted-foreground',
  planned: 'bg-muted text-muted-foreground',
  abandoned: 'bg-[#848E9C]/15 text-[#848E9C]',
};

const DIRECTION_STYLES: Record<string, string> = {
  main_long: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_short: 'bg-[#F6465D]/10 text-[#F6465D]',
};

const LEG_ABBR: Record<LegRole, string> = {
  main_open: 'M',
  main_add_1: 'A1',
  main_add_2: 'A2',
  main_add_3: 'A3',
  main_add_4: 'A4',
  main_add_5: 'A5',
  main_add_6: 'A6',
  hedge_initial_a: 'Ha',
  hedge_initial_b: 'Hb',
  hedge_rolling: 'R',
  mirror_tp: 'TP',
  reentry_main: 'RM',
  reentry_hedge: 'RH',
  standalone: 'S',
};

const LEG_CHIP_CLASS: Record<LegRole, string> = {
  main_open: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_1: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_2: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_3: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_4: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_5: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  main_add_6: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  hedge_initial_a: 'bg-[#F6465D]/10 text-[#F6465D]',
  hedge_initial_b: 'bg-[#F6465D]/10 text-[#F6465D]',
  hedge_rolling: 'bg-[#B080FF]/10 text-[#B080FF]',
  mirror_tp: 'bg-[#F0B90B]/10 text-[#F0B90B]',
  reentry_main: 'bg-[#0ECB81]/10 text-[#0ECB81]',
  reentry_hedge: 'bg-[#B080FF]/10 text-[#B080FF]',
  standalone: 'bg-muted text-muted-foreground',
};

const fmtTime = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 16) : '进行中');

function importanceValue(campaign: Pick<TradeCampaign, 'importance_weight'>): number {
  const value = Number(campaign.importance_weight);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function campaignSortTime(campaign: Pick<TradeCampaign, 'opened_at' | 'created_at'>): number {
  return new Date(campaign.opened_at || campaign.created_at).getTime() || 0;
}

function pnlSortValue(campaign: Pick<TradeCampaign, 'final_realized_pnl'>): number {
  const value = Number(campaign.final_realized_pnl);
  return Number.isFinite(value) ? value : Number.NaN;
}

function compareNumber(a: number, b: number, direction: CampaignSortDirection): number {
  return direction === 'asc' ? a - b : b - a;
}

function comparePnl(
  a: Pick<TradeCampaign, 'final_realized_pnl'>,
  b: Pick<TradeCampaign, 'final_realized_pnl'>,
  direction: CampaignSortDirection,
): number {
  const aValue = pnlSortValue(a);
  const bValue = pnlSortValue(b);
  const aFinite = Number.isFinite(aValue);
  const bFinite = Number.isFinite(bValue);
  if (!aFinite && !bFinite) return 0;
  if (!aFinite) return 1;
  if (!bFinite) return -1;
  return compareNumber(aValue, bValue, direction);
}

function sortCampaignRows(rows: CampaignCardData[], sort: CampaignSortState): CampaignCardData[] {
  return [...rows].sort((a, b) => {
    const importanceDesc = compareNumber(importanceValue(a.campaign), importanceValue(b.campaign), 'desc');
    const timeDesc = compareNumber(campaignSortTime(a.campaign), campaignSortTime(b.campaign), 'desc');
    const pnlDesc = comparePnl(a.campaign, b.campaign, 'desc');

    if (sort.mode === 'time') {
      return compareNumber(campaignSortTime(a.campaign), campaignSortTime(b.campaign), sort.direction)
        || importanceDesc
        || pnlDesc;
    }
    if (sort.mode === 'pnl') {
      return comparePnl(a.campaign, b.campaign, sort.direction)
        || importanceDesc
        || timeDesc;
    }
    return compareNumber(importanceValue(a.campaign), importanceValue(b.campaign), sort.direction)
      || timeDesc
      || pnlDesc;
  });
}

function durationLabel(openedAt: string, closedAt: string | null) {
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const start = new Date(openedAt).getTime();
  const mins = Math.max(0, Math.floor((end - start) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  if (hours < 24) return `${hours}h ${restMins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export default function JournalCampaignsPage() {
  const nav = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [scope, setScope] = useState<'own' | 'mutual'>('own');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<CampaignCardData[]>([]);
  const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);
  const [sortState, setSortState] = useState<CampaignSortState>({ mode: 'time', direction: 'desc' });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const campaigns = scope === 'own'
          ? await listAllCampaigns(user.id)
          : (await listVisibleCampaigns(user.id)).filter(campaign => campaign.user_id !== user.id);
        const full = await Promise.all(
          campaigns.map(async campaign => {
            const details = await getCampaignWithLegs(campaign.id);
            return { campaign, legs: details.legs };
          }),
        );
        if (!cancelled) setRows(full);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, scope]);

  const activeCount = useMemo(
    () => rows.filter((row: CampaignCardData) => row.campaign.status === 'active').length,
    [rows],
  );

  const handleImportanceChange = async (
    event: MouseEvent<HTMLButtonElement>,
    campaign: TradeCampaign,
    weight: number,
  ) => {
    event.stopPropagation();
    if (!user || campaign.user_id !== user.id || busyCampaignId === campaign.id) return;

    const previousRows = rows;
    const nextWeight = importanceValue(campaign) === weight ? 0 : weight;
    setBusyCampaignId(campaign.id);
    setRows(prev => prev.map(row => (
      row.campaign.id === campaign.id
        ? { ...row, campaign: { ...row.campaign, importance_weight: nextWeight } }
        : row
    )));

    try {
      await updateCampaignImportance(campaign.id, nextWeight);
      toast.success(nextWeight > 0 ? `重要性已设为 ${nextWeight}` : '已清除重要性评分');
    } catch (error) {
      setRows(previousRows);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyCampaignId(null);
    }
  };

  const sortedRows = useMemo(() => sortCampaignRows(rows, sortState), [rows, sortState]);

  const handleSortChange = (mode: CampaignSortMode) => {
    setSortState(current => (
      current.mode === mode
        ? { mode, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { mode, direction: 'desc' }
    ));
  };

  const handleDeleteCampaign = async (
    event: MouseEvent<HTMLButtonElement>,
    campaign: TradeCampaign,
  ) => {
    event.stopPropagation();
    if (!user || campaign.user_id !== user.id || busyCampaignId === campaign.id) return;
    const confirmed = window.confirm(`删除战役「${campaign.title}」？\n\n这会移除这个战役归档；已生成的交易记录不会被删除。`);
    if (!confirmed) return;

    const previousRows = rows;
    setBusyCampaignId(campaign.id);
    setRows(prev => prev.filter(row => row.campaign.id !== campaign.id));
    try {
      await deleteCampaign(campaign.id);
      toast.success('战役已删除');
    } catch (error) {
      setRows(previousRows);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyCampaignId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1600px] mx-auto flex items-center gap-3">
          <BackButton to="/" />
          <div>
            <h1 className="text-[14px] font-medium">交易战役</h1>
            <p className="text-[11px] text-muted-foreground">复盘的高层单位</p>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => nav('/journal/campaigns/classify')}
            className="inline-flex h-8 items-center gap-1 rounded border border-border bg-card px-3 text-[12px] hover:bg-accent"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            归类历史交易
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-4">
        {activeCount > 0 && (
          <div className="mb-4 bg-[#F0B90B]/10 border border-[#F0B90B]/30 rounded px-3 py-2 text-[11px] text-[#F0B90B]">
            你有 {activeCount} 个进行中的战役。每个战役都应该有明确的退出条件——不要让它无限期 active。
          </div>
        )}

        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="h-9 rounded-md border border-border bg-card p-1 flex items-center gap-1">
            {[
              { value: 'own', label: '我的战役' },
              { value: 'mutual', label: '互关可见' },
            ].map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setScope(option.value as 'own' | 'mutual')}
                className={`h-7 flex-1 rounded text-[11px] transition-colors ${
                  scope === option.value ? 'bg-[#F0B90B] text-black' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 self-start px-0.5 py-0.5 text-[10px] text-muted-foreground/45 md:self-auto">
            <span className="select-none">排序</span>
            {SORT_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={sortState.mode === option.value}
                aria-label={`${option.label}${sortState.mode === option.value ? (sortState.direction === 'desc' ? '，降序' : '，升序') : ''}`}
                data-sort-direction={sortState.mode === option.value ? sortState.direction : undefined}
                data-testid={`campaign-sort-${option.value}`}
                onClick={() => handleSortChange(option.value)}
                className={`inline-flex h-6 items-center gap-0.5 rounded-sm border-b px-0.5 transition-colors ${
                  sortState.mode === option.value
                    ? 'border-muted-foreground/30 text-foreground/70'
                    : 'border-transparent text-muted-foreground/50 hover:text-foreground/65'
                }`}
              >
                <span>{option.label}</span>
                {sortState.mode === option.value && (
                  sortState.direction === 'desc'
                    ? <ArrowDown className="h-3 w-3 opacity-60" />
                    : <ArrowUp className="h-3 w-3 opacity-60" />
                )}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="border border-border rounded p-10 text-center text-[12px] text-muted-foreground">加载中…</div>
        ) : sortedRows.length === 0 ? (
          <div className="border border-border rounded p-10 text-center space-y-2">
            <div className="mx-auto w-10 h-10 rounded-full bg-accent flex items-center justify-center">
              <Layers className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-[13px] font-medium">{scope === 'own' ? '尚无战役' : '暂无互关可见战役'}</div>
            <div className="text-[12px] text-muted-foreground">
              {scope === 'own' ? '你下次开主力单时会自动创建第一个战役' : '双方互关后，对方战役会出现在这里'}
            </div>
          </div>
        ) : (
          sortedRows.map(({ campaign, legs }) => {
            const importance = importanceValue(campaign);
            const isOwnCampaign = campaign.user_id === user?.id;
            const statusLabel = campaign.status === 'active'
              ? '进行中'
              : campaign.status === 'closed_profit'
                ? '盈利结束'
                : campaign.status === 'closed_loss'
                  ? '亏损结束'
                  : campaign.status === 'abandoned'
                    ? '已放弃'
                    : campaign.status;
            return (
              <div
                key={campaign.id}
                data-testid="campaign-card"
                onClick={() => nav(`/journal/campaigns/${campaign.id}${location.search}`)}
                className="bg-card border border-border rounded p-4 mb-3 cursor-pointer hover:bg-accent transition-colors"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex h-2.5 w-2.5 rounded-full ${STATUS_STYLES[campaign.status] || 'bg-muted'}`} />
                    <div className="text-[13px] font-medium">{campaign.title}</div>
                    <span className={`px-2 py-0.5 rounded text-[10px] ${DIRECTION_STYLES[campaign.direction] || 'bg-muted text-muted-foreground'}`}>
                      {campaign.direction === 'main_short' ? '主空' : '主多'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">{campaign.symbol}</span>
                    {campaign.user_id !== user?.id && (
                      <span className="px-2 py-0.5 rounded text-[10px] bg-[#B080FF]/10 text-[#B080FF]">
                        互关账户
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground">{STRATEGY_TEMPLATES[campaign.strategy_template].name}</span>
                  </div>
                  <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    {isOwnCampaign && (
                      <div className="flex items-center gap-1 rounded border border-border bg-background/60 px-2 py-1">
                        <span className="mr-0.5 text-[10px] text-muted-foreground">重要性</span>
                        {[1, 2, 3, 4, 5].map(score => (
                          <button
                            key={score}
                            type="button"
                            disabled={busyCampaignId === campaign.id}
                            title={`设为 ${score} 分`}
                            onClick={(event) => handleImportanceChange(event, campaign, score)}
                            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[#F0B90B]/10 hover:text-[#F0B90B] disabled:opacity-50"
                          >
                            <Star
                              className={`h-3.5 w-3.5 ${score <= importance ? 'text-[#F0B90B]' : ''}`}
                              fill={score <= importance ? 'currentColor' : 'none'}
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    {!isOwnCampaign && importance > 0 && (
                      <span className="rounded border border-border bg-background/60 px-2 py-1 text-[10px] text-muted-foreground">
                        重要性 {importance}/5
                      </span>
                    )}
                    {isOwnCampaign && (
                      <button
                        type="button"
                        disabled={busyCampaignId === campaign.id}
                        title="删除战役"
                        onClick={(event) => handleDeleteCampaign(event, campaign)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-[#F6465D]/40 hover:bg-[#F6465D]/10 hover:text-[#F6465D] disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <div className={`px-2 py-0.5 rounded text-[11px] ${STATUS_STYLES[campaign.status] || 'bg-muted text-muted-foreground'}`}>
                      {statusLabel}
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2 text-[11px] font-mono text-muted-foreground">
                  <div>{fmtTime(campaign.opened_at)} → {fmtTime(campaign.closed_at)}</div>
                  <div>含 {legs.length} legs · 持续 {durationLabel(campaign.opened_at, campaign.closed_at)}</div>
                  <div>
                    已实现 P&L：{campaign.final_realized_pnl == null ? '—' : campaign.final_realized_pnl.toFixed(2)}
                  </div>
                  <div>峰值浮盈：{campaign.status === 'active' ? '批次 17 计算' : (campaign.peak_unrealized_pnl ?? '—')}</div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {legs.length === 0 ? (
                    <span className="text-[10px] text-muted-foreground">暂无 legs</span>
                  ) : (
                    legs.map((leg: TradeJournal) => (
                      <span
                        key={leg.id}
                        title={leg.leg_role ? LEG_ROLE_LABELS[leg.leg_role] : '未归类'}
                        className={`px-2 py-0.5 rounded text-[10px] ${leg.leg_role ? LEG_CHIP_CLASS[leg.leg_role] : 'bg-muted text-muted-foreground'}`}
                      >
                        {leg.leg_role ? LEG_ABBR[leg.leg_role] : '?'}
                      </span>
                    ))
                  )}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
