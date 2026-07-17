import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArchiveRestore, ArrowDown, ArrowUp, FolderPlus, Layers, RotateCcw, Sigma, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BackButton } from '@/components/journal/BackButton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/AuthContext';
import {
  deleteCampaign,
  getCampaignFullData,
  listAllCampaigns,
  listDeletedCampaigns,
  listVisibleCampaigns,
  permanentlyDeleteCampaign,
  restoreCampaign,
  updateCampaignImportance,
} from '@/lib/journalApi';
import {
  computeInitialExpectedMaxLoss,
  computeProfitCaptureRatio,
  formatCampaignPayoffRatio,
} from '@/lib/campaignAnalysis';
import { summarizeCampaignPerformance } from '@/lib/kellySizing';
import { LEG_ROLE_LABELS, STRATEGY_TEMPLATES } from '@/lib/strategyTemplates';
import { campaignOperationTime } from '@/lib/objectiveOperationTime';
import { formatBeijingTime } from '@/lib/timeFormat';
import type { CampaignStatus, LegRole, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

type CampaignCardData = {
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  profitCaptureRatio: number | null;
};

type CampaignSortMode = 'importance' | 'time' | 'captureRate' | 'alpha';
type CampaignSortDirection = 'asc' | 'desc';

type CampaignSortState = {
  mode: CampaignSortMode;
  direction: CampaignSortDirection;
};

type CampaignFormulaPopover = 'captureRate' | 'winRate' | 'averagePayoffRatio' | 'expectedValue';

const SORT_OPTIONS: { value: CampaignSortMode; label: string }[] = [
  { value: 'importance', label: '重要性' },
  { value: 'time', label: '操作时间' },
  { value: 'captureRate', label: '盈亏比' },
  { value: 'alpha', label: '字母' },
];

const CAMPAIGN_TITLE_COLLATOR = new Intl.Collator(['zh-Hans-CN', 'en'], {
  numeric: true,
  sensitivity: 'base',
});

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
const fmtOperationTime = (time: number | null) => (
  time == null ? '—' : formatBeijingTime(time).slice(0, 16)
);
const fmtDeletedTime = (iso: string | null | undefined) => (
  iso ? formatBeijingTime(new Date(iso).getTime()).slice(0, 16) : '—'
);

function importanceValue(campaign: Pick<TradeCampaign, 'importance_weight'>): number {
  const value = Number(campaign.importance_weight);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function campaignSortTime(row: CampaignCardData): number {
  return campaignOperationTime(row.legs, row.tradeRecords) ?? 0;
}

function pnlSortValue(campaign: Pick<TradeCampaign, 'final_realized_pnl'>): number {
  const value = Number(campaign.final_realized_pnl);
  return Number.isFinite(value) ? value : Number.NaN;
}

function compareNumber(a: number, b: number, direction: CampaignSortDirection): number {
  return direction === 'asc' ? a - b : b - a;
}

function sortDirectionLabel(direction: CampaignSortDirection, mode?: CampaignSortMode): string {
  if (mode === 'alpha') return direction === 'asc' ? 'A 到 Z' : 'Z 到 A';
  return direction === 'desc' ? '从大到小' : '从小到大';
}

function compareAlpha(
  a: Pick<TradeCampaign, 'title' | 'symbol'>,
  b: Pick<TradeCampaign, 'title' | 'symbol'>,
  direction: CampaignSortDirection,
): number {
  const aValue = (a.title || a.symbol || '').trim();
  const bValue = (b.title || b.symbol || '').trim();
  const result = CAMPAIGN_TITLE_COLLATOR.compare(aValue, bValue);
  return direction === 'asc' ? result : -result;
}

function compareFiniteMetric(
  aValue: number,
  bValue: number,
  direction: CampaignSortDirection,
): number {
  const aFinite = Number.isFinite(aValue);
  const bFinite = Number.isFinite(bValue);
  if (!aFinite && !bFinite) return 0;
  if (!aFinite) return 1;
  if (!bFinite) return -1;
  return compareNumber(aValue, bValue, direction);
}

function comparePnl(
  a: Pick<TradeCampaign, 'final_realized_pnl'>,
  b: Pick<TradeCampaign, 'final_realized_pnl'>,
  direction: CampaignSortDirection,
): number {
  return compareFiniteMetric(pnlSortValue(a), pnlSortValue(b), direction);
}

function sortCampaignRows(rows: CampaignCardData[], sort: CampaignSortState): CampaignCardData[] {
  const visibleRows = sort.mode === 'captureRate'
    ? rows.filter(row => row.profitCaptureRatio != null && Number.isFinite(row.profitCaptureRatio))
    : rows;
  return [...visibleRows].sort((a, b) => {
    const importanceDesc = compareNumber(importanceValue(a.campaign), importanceValue(b.campaign), 'desc');
    const timeDesc = compareNumber(campaignSortTime(a), campaignSortTime(b), 'desc');
    const pnlDesc = comparePnl(a.campaign, b.campaign, 'desc');
    const alphaAsc = compareAlpha(a.campaign, b.campaign, 'asc');

    if (sort.mode === 'time') {
      return compareNumber(campaignSortTime(a), campaignSortTime(b), sort.direction)
        || importanceDesc
        || pnlDesc
        || alphaAsc;
    }
    if (sort.mode === 'captureRate') {
      return compareFiniteMetric(
        a.profitCaptureRatio ?? Number.NaN,
        b.profitCaptureRatio ?? Number.NaN,
        sort.direction,
      )
        || comparePnl(a.campaign, b.campaign, sort.direction)
        || importanceDesc
        || timeDesc
        || alphaAsc;
    }
    if (sort.mode === 'alpha') {
      return compareAlpha(a.campaign, b.campaign, sort.direction)
        || timeDesc
        || importanceDesc
        || pnlDesc;
    }
    return compareNumber(importanceValue(a.campaign), importanceValue(b.campaign), sort.direction)
      || timeDesc
      || pnlDesc
      || alphaAsc;
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
  const [formulaPopover, setFormulaPopover] = useState<CampaignFormulaPopover | null>(null);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedCampaigns, setDeletedCampaigns] = useState<TradeCampaign[]>([]);
  const [deletedBusyId, setDeletedBusyId] = useState<string | null>(null);

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
            const details = await getCampaignFullData(campaign.id);
            const initialExpectedMaxLoss = computeInitialExpectedMaxLoss(
              details.campaign,
              details.legs,
              details.tradeRecords,
              details.reverseHedgeOrders,
            );
            return {
              campaign: details.campaign,
              legs: details.legs,
              tradeRecords: details.tradeRecords,
              profitCaptureRatio: Number.isFinite(initialExpectedMaxLoss) && initialExpectedMaxLoss > 0
                ? computeProfitCaptureRatio(
                  details.campaign,
                  details.legs,
                  details.tradeRecords,
                  details.reverseHedgeOrders,
                )
                : null,
            };
          }),
        );
        if (!cancelled) setRows(full);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, scope]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    listDeletedCampaigns(user.id)
      .then(campaigns => {
        if (!cancelled) setDeletedCampaigns(campaigns);
      })
      .catch(() => {
        if (!cancelled) setDeletedCampaigns([]);
      });
    return () => { cancelled = true; };
  }, [user]);

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
  const performance = useMemo(
    () => summarizeCampaignPerformance(rows.map(row => ({
      campaign: row.campaign,
      payoffRatio: row.profitCaptureRatio == null ? null : row.profitCaptureRatio / 100,
    }))),
    [rows],
  );
  const winRateLabel = performance.winRate == null ? '—' : `${(performance.winRate * 100).toFixed(2)}%`;
  const payoffRatioLabel = performance.payoffRatio == null ? '—' : performance.payoffRatio.toFixed(2);
  const validCampaignCount = performance.payoffRatioSampleCount;
  const breakevenCampaignCount = Math.max(
    0,
    validCampaignCount - performance.winCount - performance.lossCount,
  );
  const payoffRatioSum = performance.payoffRatio == null
    ? null
    : performance.payoffRatio * performance.payoffRatioSampleCount;
  const expectedRLabel = performance.expectedR == null
    ? '—'
    : `${performance.expectedR >= 0 ? '+' : ''}${performance.expectedR.toFixed(2)}R`;

  const handleSortChange = (mode: CampaignSortMode) => {
    setSortState(current => (
      current.mode === mode
        ? { mode, direction: current.direction === 'desc' ? 'asc' : 'desc' }
        : { mode, direction: mode === 'alpha' ? 'asc' : 'desc' }
    ));
  };

  const openFormulaPopover = (
    event: MouseEvent<HTMLButtonElement>,
    formula: CampaignFormulaPopover,
  ) => {
    event.preventDefault();
    setFormulaPopover(formula);
  };

  const handleFormulaPopoverChange = (
    formula: CampaignFormulaPopover,
    open: boolean,
  ) => {
    setFormulaPopover(current => {
      if (open) return formula;
      return current === formula ? null : current;
    });
  };

  const handleDeleteCampaign = async (
    event: MouseEvent<HTMLButtonElement>,
    campaign: TradeCampaign,
  ) => {
    event.stopPropagation();
    if (!user || campaign.user_id !== user.id || busyCampaignId === campaign.id) return;
    const confirmed = window.confirm(`删除战役「${campaign.title}」？\n\n战役会移到“已删除”，之后仍可恢复；已生成的交易记录不会被删除。`);
    if (!confirmed) return;

    const previousRows = rows;
    setBusyCampaignId(campaign.id);
    setRows(prev => prev.filter(row => row.campaign.id !== campaign.id));
    try {
      await deleteCampaign(campaign.id);
      setDeletedCampaigns(current => [
        { ...campaign, deleted_at: new Date().toISOString() },
        ...current.filter(item => item.id !== campaign.id),
      ]);
      toast.success('战役已移到已删除，可随时恢复');
    } catch (error) {
      setRows(previousRows);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyCampaignId(null);
    }
  };

  const handleDeletedOpenChange = async (open: boolean) => {
    setDeletedOpen(open);
    if (!open || !user) return;
    setDeletedLoading(true);
    try {
      setDeletedCampaigns(await listDeletedCampaigns(user.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletedLoading(false);
    }
  };

  const handleRestoreCampaign = async (campaign: TradeCampaign) => {
    if (!user || deletedBusyId) return;
    setDeletedBusyId(campaign.id);
    try {
      await restoreCampaign(campaign.id);
      setDeletedCampaigns(current => current.filter(item => item.id !== campaign.id));
      if (scope === 'own') {
        const details = await getCampaignFullData(campaign.id);
        const initialExpectedMaxLoss = computeInitialExpectedMaxLoss(
          details.campaign,
          details.legs,
          details.tradeRecords,
          details.reverseHedgeOrders,
        );
        const restoredRow: CampaignCardData = {
          campaign: { ...details.campaign, deleted_at: null },
          legs: details.legs,
          tradeRecords: details.tradeRecords,
          profitCaptureRatio: Number.isFinite(initialExpectedMaxLoss) && initialExpectedMaxLoss > 0
            ? computeProfitCaptureRatio(
              details.campaign,
              details.legs,
              details.tradeRecords,
              details.reverseHedgeOrders,
            )
            : null,
        };
        setRows(current => [restoredRow, ...current.filter(item => item.campaign.id !== campaign.id)]);
      }
      toast.success('战役已恢复');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletedBusyId(null);
    }
  };

  const handlePermanentDeleteCampaign = async (campaign: TradeCampaign) => {
    if (deletedBusyId) return;
    const confirmed = window.confirm(
      `永久删除战役「${campaign.title}」？\n\n此操作无法恢复；原始交易记录不会被删除。`,
    );
    if (!confirmed) return;
    setDeletedBusyId(campaign.id);
    try {
      await permanentlyDeleteCampaign(campaign.id);
      setDeletedCampaigns(current => current.filter(item => item.id !== campaign.id));
      toast.success('战役已永久删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletedBusyId(null);
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
          <button
            type="button"
            onClick={() => void handleDeletedOpenChange(true)}
            title="已删除战役"
            aria-label={`已删除战役，共 ${deletedCampaigns.length} 场`}
            data-testid="deleted-campaigns-entry"
            className="inline-flex h-8 items-center gap-1 rounded border border-transparent px-1.5 text-[10px] text-muted-foreground/45 transition-colors hover:border-border/60 hover:bg-accent hover:text-muted-foreground"
          >
            <ArchiveRestore className="h-3.5 w-3.5" />
            {deletedCampaigns.length > 0 && <span>{deletedCampaigns.length}</span>}
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 self-start px-0.5 py-0.5 text-[10px] text-muted-foreground/45 md:self-auto md:justify-end">
            <span className="select-none">排序</span>
            {SORT_OPTIONS.map(option => {
              const active = sortState.mode === option.value;
              const direction = active ? sortState.direction : 'desc';
              const sortButton = (
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={`${option.label}，${sortDirectionLabel(direction, option.value)}排序`}
                  title={`按${option.label}${sortDirectionLabel(direction, option.value)}排序${active ? '；再次点击切换方向' : ''}${option.value === 'captureRate' ? '；未设置最大预期亏损的战役不显示' : ''}`}
                  data-sort-direction={active ? direction : undefined}
                  data-testid={`campaign-sort-${option.value}`}
                  onClick={(event) => {
                    handleSortChange(option.value);
                    if (option.value === 'captureRate') {
                      openFormulaPopover(event, 'captureRate');
                    }
                  }}
                  className={`inline-flex h-6 items-center gap-0.5 rounded-sm border-b px-0.5 transition-colors ${
                    active
                      ? 'border-muted-foreground/30 text-foreground/70'
                      : 'border-transparent text-muted-foreground/50 hover:text-foreground/65'
                  }`}
                >
                  <span>{option.label}</span>
                  {option.value === 'captureRate' && (
                    <Sigma aria-hidden="true" className="h-2.5 w-2.5 opacity-35" />
                  )}
                  {active && (
                    direction === 'desc'
                      ? <ArrowDown className="h-3 w-3 opacity-45" />
                      : <ArrowUp className="h-3 w-3 opacity-45" />
                  )}
                </button>
              );
              if (option.value !== 'captureRate') {
                return <span key={option.value}>{sortButton}</span>;
              }
              return (
                <Popover
                  key={option.value}
                  open={formulaPopover === 'captureRate'}
                  onOpenChange={open => handleFormulaPopoverChange('captureRate', open)}
                >
                  <PopoverTrigger asChild>{sortButton}</PopoverTrigger>
                  <PopoverContent align="end" className="w-80 border-border bg-card p-3 text-[11px]">
                    <div className="font-medium text-foreground">单场盈亏比计算公式</div>
                    <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                      bᵢ = 已实现盈亏ᵢ ÷ 初始最大预期亏损ᵢ
                    </div>
                    <div className="mt-2 space-y-1 text-muted-foreground">
                      <div>初始最大预期亏损：</div>
                      <div className="rounded border border-border/60 px-2 py-1.5 font-mono leading-relaxed text-foreground/85">
                        Lᵢ = 主力名义仓位 × max（|开仓价 − 对冲 A 价|，|开仓价 − 对冲 B 价|）÷ 开仓价
                      </div>
                      <div>排序使用带正负号的 bᵢ：盈利为正，亏损为负。</div>
                      <div>没有有效初始最大预期亏损的战役不参与排序。</div>
                    </div>
                  </PopoverContent>
                </Popover>
              );
            })}
            <Tooltip delayDuration={120}>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  data-testid="campaign-valid-count"
                  aria-label={`有效战役 ${validCampaignCount} 场，其中盈利 ${performance.winCount} 场，亏损 ${performance.lossCount} 场${breakevenCampaignCount > 0 ? `，盈亏平衡 ${breakevenCampaignCount} 场` : ''}`}
                  className="ml-0.5 inline-flex h-6 cursor-help select-none items-center border-l border-border/60 pl-2 text-foreground/60 outline-none transition-colors hover:text-foreground/80 focus-visible:text-foreground/80"
                >
                  有效战役（{validCampaignCount}）
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="space-y-1 text-[11px]">
                <div>盈利战役：{performance.winCount} 场</div>
                <div>亏损战役：{performance.lossCount} 场</div>
                {breakevenCampaignCount > 0 && <div>盈亏平衡：{breakevenCampaignCount} 场</div>}
                <div className="border-t border-border/60 pt-1 text-muted-foreground">
                  仅统计存在有效初始最大预期亏损的已结束战役
                </div>
              </TooltipContent>
            </Tooltip>
            <Popover
              open={formulaPopover === 'winRate'}
              onOpenChange={open => handleFormulaPopoverChange('winRate', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-win-rate"
                  aria-label={`盈利战役 ${performance.winCount} 场，亏损战役 ${performance.lossCount} 场，胜率 ${winRateLabel}`}
                  title="点击查看胜率计算公式"
                  onClick={event => openFormulaPopover(event, 'winRate')}
                  className="inline-flex h-6 select-none items-center gap-0.5 border-b border-dashed border-muted-foreground/30 text-foreground/60 transition-colors hover:text-foreground/80"
                >
                  胜率（{winRateLabel}）
                  <Sigma aria-hidden="true" className="h-2.5 w-2.5 opacity-35" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 border-border bg-card p-3 text-[11px]">
                <div className="font-medium text-foreground">胜率计算公式</div>
                <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                  P(赢) = 盈利战役数 ÷（盈利战役数 + 亏损战役数）
                </div>
                {performance.winRate != null ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    <div className="font-mono">
                      = {performance.winCount} ÷（{performance.winCount} + {performance.lossCount}）
                    </div>
                    <div className="font-mono text-foreground">= {winRateLabel}</div>
                    <div>仅统计存在有效初始最大预期亏损的已结束战役。</div>
                    <div>进行中、盈亏平衡、已删除及分母无效的战役不计入胜负。</div>
                  </div>
                ) : (
                  <div className="mt-2 text-muted-foreground">当前列表没有可计算胜率的已结束战役。</div>
                )}
              </PopoverContent>
            </Popover>
            <Popover
              open={formulaPopover === 'averagePayoffRatio'}
              onOpenChange={open => handleFormulaPopoverChange('averagePayoffRatio', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-average-payoff-ratio"
                  aria-label={`平均盈亏比 ${payoffRatioLabel}，共 ${performance.payoffRatioSampleCount} 场战役`}
                  title="点击查看平均盈亏比计算公式"
                  onClick={event => openFormulaPopover(event, 'averagePayoffRatio')}
                  className="inline-flex h-6 select-none items-center gap-0.5 border-b border-dashed border-muted-foreground/30 text-foreground/60 transition-colors hover:text-foreground/80"
                >
                  平均盈亏比（{payoffRatioLabel}）
                  <Sigma aria-hidden="true" className="h-2.5 w-2.5 opacity-35" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 border-border bg-card p-3 text-[11px]">
                <div className="font-medium text-foreground">平均盈亏比计算公式</div>
                <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                  b̄ = Σ 单场盈亏比 bᵢ ÷ 有效战役数 N
                </div>
                {performance.payoffRatio != null && payoffRatioSum != null ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    <div className="font-mono">
                      = {payoffRatioSum.toFixed(2)} ÷ {performance.payoffRatioSampleCount}
                    </div>
                    <div className="font-mono text-foreground">= {payoffRatioLabel}</div>
                    <div>亏损战役的负盈亏比原样参与求和。</div>
                    <div>没有有效初始最大预期亏损的战役不计入 N。</div>
                  </div>
                ) : (
                  <div className="mt-2 text-muted-foreground">当前列表没有带有效盈亏比的战役。</div>
                )}
              </PopoverContent>
            </Popover>
            <Popover
              open={formulaPopover === 'expectedValue'}
              onOpenChange={open => handleFormulaPopoverChange('expectedValue', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-expected-value"
                  className="h-6 rounded-sm border-b border-dashed border-muted-foreground/30 px-0.5 text-foreground/60 transition-colors hover:text-foreground/80"
                  aria-label={`期望值 ${expectedRLabel}，点击查看计算公式`}
                  onClick={event => openFormulaPopover(event, 'expectedValue')}
                >
                  期望值（{expectedRLabel}）
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 border-border bg-card p-3 text-[11px]">
                <div className="font-medium text-foreground">期望值计算公式</div>
                <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                  E = P(赢) × b − (1 − P(赢))
                </div>
                {performance.expectedWinRate != null && performance.payoffRatio != null && performance.expectedR != null ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    <div className="font-mono">
                      = {(performance.expectedWinRate * 100).toFixed(2)}% × {performance.payoffRatio.toFixed(2)} − {((1 - performance.expectedWinRate) * 100).toFixed(2)}%
                    </div>
                    <div className="font-mono text-foreground">= {expectedRLabel}</div>
                    <div>b = 所有战役盈亏比之和 ÷ 有效战役数</div>
                    <div>P(赢) 仅统计设置了最大预期亏损的有效战役</div>
                  </div>
                ) : (
                  <div className="mt-2 text-muted-foreground">
                    当前列表需要至少一场有有效盈亏比的战役，并且要有可计算的胜率，才能得到期望值。
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {loading ? (
          <div className="border border-border rounded p-10 text-center text-[12px] text-muted-foreground">加载中…</div>
        ) : sortedRows.length === 0 ? (
          <div className="border border-border rounded p-10 text-center space-y-2">
            <div className="mx-auto w-10 h-10 rounded-full bg-accent flex items-center justify-center">
              <Layers className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="text-[13px] font-medium">
              {sortState.mode === 'captureRate' && rows.length > 0
                ? '暂无可计算盈亏比的战役'
                : scope === 'own' ? '尚无战役' : '暂无互关可见战役'}
            </div>
            <div className="text-[12px] text-muted-foreground">
              {sortState.mode === 'captureRate' && rows.length > 0
                ? '未设置初始最大预期亏损的战役不会进入盈亏比排序'
                : scope === 'own' ? '你下次开主力单时会自动创建第一个战役' : '双方互关后，对方战役会出现在这里'}
            </div>
          </div>
        ) : (
          sortedRows.map(({ campaign, legs, tradeRecords, profitCaptureRatio }) => {
            const importance = importanceValue(campaign);
            const isOwnCampaign = campaign.user_id === user?.id;
            const operationTime = campaignOperationTime(legs, tradeRecords);
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
                    <span
                      className="rounded border border-border bg-background/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      title={`战役编号 ${campaign.campaign_code}`}
                    >
                      {campaign.campaign_code}
                    </span>
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

                <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] font-mono text-muted-foreground md:grid-cols-2 xl:grid-cols-[1.35fr_0.85fr_0.9fr_0.75fr_1fr]">
                  <div>{fmtTime(campaign.opened_at)} → {fmtTime(campaign.closed_at)}</div>
                  <div>含 {legs.length} legs · 持续 {durationLabel(campaign.opened_at, campaign.closed_at)}</div>
                  <div>
                    已实现 P&L：{campaign.final_realized_pnl == null ? '—' : campaign.final_realized_pnl.toFixed(2)}
                  </div>
                  <div data-testid="campaign-payoff-ratio">
                    盈亏比：{profitCaptureRatio == null ? '—' : formatCampaignPayoffRatio(profitCaptureRatio, 2)}
                  </div>
                  <div data-testid="campaign-operation-time">
                    操作时间：{fmtOperationTime(operationTime)}
                  </div>
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
      <Dialog open={deletedOpen} onOpenChange={open => void handleDeletedOpenChange(open)}>
        <DialogContent className="max-h-[78vh] max-w-2xl overflow-hidden border-border bg-background p-0 sm:rounded-md">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2 text-[14px] font-medium">
              <ArchiveRestore className="h-4 w-4 text-muted-foreground" />
              已删除战役
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              删除的战役不会进入列表与统计；恢复后会回到原来的战役记录。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto px-5 py-2">
            {deletedLoading ? (
              <div className="py-12 text-center text-[12px] text-muted-foreground">加载中…</div>
            ) : deletedCampaigns.length === 0 ? (
              <div className="py-12 text-center">
                <ArchiveRestore className="mx-auto h-5 w-5 text-muted-foreground/45" />
                <div className="mt-2 text-[12px] text-muted-foreground">暂无已删除战役</div>
              </div>
            ) : (
              deletedCampaigns.map(campaign => (
                <div
                  key={campaign.id}
                  data-testid="deleted-campaign-row"
                  className="flex flex-col gap-3 border-b border-border/70 py-3 last:border-b-0 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[12px] font-medium">{campaign.title}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                        {campaign.campaign_code}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>{campaign.symbol}</span>
                      <span>删除于 {fmtDeletedTime(campaign.deleted_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    <button
                      type="button"
                      disabled={deletedBusyId != null}
                      onClick={() => void handleRestoreCampaign(campaign)}
                      data-testid={`restore-campaign-${campaign.id}`}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-foreground/80 transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      恢复
                    </button>
                    <button
                      type="button"
                      disabled={deletedBusyId != null}
                      title="永久删除"
                      aria-label={`永久删除 ${campaign.title}`}
                      onClick={() => void handlePermanentDeleteCampaign(campaign)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-[#F6465D]/10 hover:text-[#F6465D] disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
