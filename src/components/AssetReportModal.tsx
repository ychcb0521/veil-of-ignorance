import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Calendar as CalendarIcon, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { AssetState, DailySymbolPnL } from '@/types/assets';
import { formatUTC8 } from '@/lib/timeFormat';
import {
  summarizeOperationPnlDetailsByRange,
  summarizeOperationPnlDetailsForDate,
  type AssetReportRange,
} from '@/lib/assetReport';
import { useAuth } from '@/contexts/AuthContext';
import { listAllCampaigns, listUnclassifiedJournals } from '@/lib/journalApi';
import type { TradeCampaign } from '@/types/journal';
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
  CartesianGrid,
} from 'recharts';

type TimeRange = AssetReportRange;

interface CampaignPnlSummary {
  key: string;
  campaign: TradeCampaign | null;
  title: string;
  pnl: number;
  trades: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  assets: AssetState;
}

function formatSignedMoney(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDayLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${month}/${day}`;
}

function buildCampaignSummaries(
  symbolDetail: DailySymbolPnL,
  recordCampaignMap: Map<string, TradeCampaign>,
): CampaignPnlSummary[] {
  const rows = new Map<string, CampaignPnlSummary>();
  for (const record of symbolDetail.records) {
    const campaign = recordCampaignMap.get(record.id) ?? null;
    const key = campaign?.id ?? 'unclassified';
    const current = rows.get(key) ?? {
      key,
      campaign,
      title: campaign?.title ?? '未归类交易',
      pnl: 0,
      trades: 0,
    };
    current.pnl += record.pnl;
    current.trades += 1;
    rows.set(key, current);
  }

  return [...rows.values()].sort((a, b) => {
    if (a.campaign && !b.campaign) return -1;
    if (!a.campaign && b.campaign) return 1;
    return Math.abs(b.pnl) - Math.abs(a.pnl) || a.title.localeCompare(b.title);
  });
}

export function AssetReportModal({ open, onClose, assets }: Props) {
  const nav = useNavigate();
  const { user } = useAuth();
  const [range, setRange] = useState<TimeRange>('30d');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<TradeCampaign[]>([]);
  const [journalRecordCampaignPairs, setJournalRecordCampaignPairs] = useState<Array<{ recordId: string; campaignId: string }>>([]);
  const [campaignLoadError, setCampaignLoadError] = useState<string | null>(null);
  const { history, dailyPnl } = assets;

  useEffect(() => {
    if (!open) return;
    if (!user?.id) {
      setCampaigns([]);
      setJournalRecordCampaignPairs([]);
      return;
    }

    let cancelled = false;
    setCampaignLoadError(null);
    Promise.all([
      listAllCampaigns(user.id, { status: 'all' }),
      listUnclassifiedJournals(user.id, { includeClassified: true }),
    ])
      .then(([campaignRows, journalRows]) => {
        if (cancelled) return;
        setCampaigns(campaignRows);
        setJournalRecordCampaignPairs(
          journalRows
            .filter(journal => journal.trade_record_id && journal.campaign_id)
            .map(journal => ({
              recordId: journal.trade_record_id!,
              campaignId: journal.campaign_id!,
            })),
        );
      })
      .catch(error => {
        if (cancelled) return;
        setCampaigns([]);
        setJournalRecordCampaignPairs([]);
        setCampaignLoadError(error instanceof Error ? error.message : String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [open, user?.id]);

  // Filter history by range
  const filteredHistory = useMemo(() => {
    if (history.length === 0) return [];
    const now = history[history.length - 1]?.timestamp ?? Date.now();
    const rangeMs: Record<TimeRange, number> = {
      '7d': 7 * 86400_000,
      '30d': 30 * 86400_000,
      '90d': 90 * 86400_000,
      'all': Infinity,
    };
    const cutoff = now - rangeMs[range];
    return history.filter(s => s.timestamp >= cutoff);
  }, [history, range]);

  // Chart data
  const chartData = useMemo(() => {
    return filteredHistory.map(s => ({
      time: formatUTC8(s.timestamp).slice(5, 16), // MM-DD HH:mm
      date: formatUTC8(s.timestamp).slice(0, 10),
      value: s.totalBalance,
    }));
  }, [filteredHistory]);

  // Summary for the selected range or selected calendar day, based on record-level real operation time.
  const rangeStats = useMemo(() => {
    if (selectedDate) {
      const selected = summarizeOperationPnlDetailsForDate(assets.dailyPnlDetails, selectedDate);
      return {
        totalPnl: selected.pnl,
        totalTrades: selected.trades,
        pnlLabel: `${formatDayLabel(selectedDate)} 盈亏`,
        tradesLabel: `${formatDayLabel(selectedDate)} 笔数`,
      };
    }
    const summary = summarizeOperationPnlDetailsByRange(assets.dailyPnlDetails, range);
    return {
      totalPnl: summary.pnl,
      totalTrades: summary.trades,
      pnlLabel: '交易盈亏总额',
      tradesLabel: '交易笔数',
    };
  }, [assets.dailyPnlDetails, range, selectedDate]);

  // Build a map for calendar day PnL
  const pnlMap = useMemo(() => {
    const map = new Map<string, number>();
    dailyPnl.forEach(d => map.set(d.date, d.pnl));
    return map;
  }, [dailyPnl]);

  const dailyDetailMap = useMemo(
    () => new Map(assets.dailyPnlDetails.map(item => [item.date, item])),
    [assets.dailyPnlDetails],
  );

  const selectedDayDetail = selectedDate ? dailyDetailMap.get(selectedDate) ?? null : null;

  const recordCampaignMap = useMemo(() => {
    const map = new Map<string, TradeCampaign>();
    const campaignById = new Map(campaigns.map(campaign => [campaign.id, campaign]));
    campaigns.forEach(campaign => {
      (campaign.actual_evolution ?? []).forEach(event => {
        if (event.trade_record_id) map.set(event.trade_record_id, campaign);
      });
    });
    journalRecordCampaignPairs.forEach(pair => {
      const campaign = campaignById.get(pair.campaignId);
      if (campaign) map.set(pair.recordId, campaign);
    });
    return map;
  }, [campaigns, journalRecordCampaignPairs]);

  // Outlier detection: top/bottom 5% by absolute PnL
  const outlierDates = useMemo(() => {
    if (dailyPnl.length < 5) return new Set<string>();
    const sorted = [...dailyPnl].sort((a, b) => a.pnl - b.pnl);
    const n = Math.max(1, Math.ceil(sorted.length * 0.05));
    const outliers = new Set<string>();
    for (let i = 0; i < n; i++) outliers.add(sorted[i].date);
    for (let i = sorted.length - n; i < sorted.length; i++) outliers.add(sorted[i].date);
    return outliers;
  }, [dailyPnl]);

  // Calendar state
  const [calMonth, setCalMonth] = useState(new Date());

  // Build calendar grid for current month
  const calendarGrid = useMemo(() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weeks: { day: number; date: string; pnl: number | null }[][] = [];
    let week: { day: number; date: string; pnl: number | null }[] = [];
    // Fill leading blanks
    for (let i = 0; i < firstDay; i++) week.push({ day: 0, date: '', pnl: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      week.push({ day: d, date: dateStr, pnl: pnlMap.get(dateStr) ?? null });
      if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push({ day: 0, date: '', pnl: null });
      weeks.push(week);
    }
    return weeks;
  }, [calMonth, pnlMap]);

  const startVal = chartData.length > 0 ? chartData[0].value : 0;
  const endVal = chartData.length > 0 ? chartData[chartData.length - 1].value : 0;
  const isUp = endVal >= startVal;

  const ranges: { key: TimeRange; label: string }[] = [
    { key: '7d', label: '7天' },
    { key: '30d', label: '30天' },
    { key: '90d', label: '90天' },
    { key: 'all', label: '全部' },
  ];

  const goToCampaign = (campaignId: string) => {
    onClose();
    nav(`/journal/campaigns/${campaignId}`);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            资产报告
          </DialogTitle>
        </DialogHeader>

        <div className="p-5 space-y-5">
          {/* Time Range Tabs */}
          <div className="flex gap-1.5 p-1 bg-secondary/50 rounded-lg w-fit">
            {ranges.map(r => (
              <button
                key={r.key}
                onClick={() => {
                  setRange(r.key);
                  setSelectedDate(null);
                }}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                  range === r.key
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Asset Line Chart */}
          <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground font-medium">资产变化曲线</span>
              <div className="flex items-center gap-3 text-[10px] font-mono">
                <span className="text-muted-foreground">
                  {chartData.length > 0 ? chartData[0].date : '--'}: <span className="text-foreground">${startVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="text-muted-foreground">
                  {chartData.length > 0 ? chartData[chartData.length - 1].date : '--'}: <span className={isUp ? 'trading-green' : 'trading-red'}>${endVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </span>
              </div>
            </div>
            <div className="h-[200px]">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <defs>
                      <linearGradient id="assetGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isUp ? 'hsl(160, 72%, 43%)' : 'hsl(354, 91%, 62%)'} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={isUp ? 'hsl(160, 72%, 43%)' : 'hsl(354, 91%, 62%)'} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 15%)" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10, fill: 'hsl(220, 10%, 50%)' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'hsl(220, 10%, 50%)' }}
                      tickLine={false}
                      axisLine={false}
                      domain={['dataMin - 1000', 'dataMax + 1000']}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(220, 18%, 9%)',
                        border: '1px solid hsl(220, 15%, 15%)',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      labelStyle={{ color: 'hsl(220, 10%, 50%)' }}
                      formatter={(value: number) => [`$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, '总资产']}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={isUp ? 'hsl(160, 72%, 43%)' : 'hsl(354, 91%, 62%)'}
                      strokeWidth={2}
                      fill="url(#assetGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-muted-foreground">暂无数据</div>
              )}
            </div>
          </div>

          {/* Trading Analysis */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
              <div className="text-[10px] text-muted-foreground font-medium mb-1.5 uppercase tracking-wider">{rangeStats.pnlLabel}</div>
              <div className={cn(
                'font-mono text-lg font-bold',
                rangeStats.totalPnl >= 0 ? 'trading-green' : 'trading-red'
              )}>
                {rangeStats.totalPnl >= 0 ? '+' : ''}${rangeStats.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
              <div className="text-[10px] text-muted-foreground font-medium mb-1.5 uppercase tracking-wider">{rangeStats.tradesLabel}</div>
              <div className="font-mono text-lg font-bold text-foreground">
                {rangeStats.totalTrades}
              </div>
            </div>
          </div>

          {/* Calendar Heatmap with PnL values */}
          <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
            <div className="flex items-center gap-2 mb-3">
              <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">日历盈亏视图</span>
              <div className="flex items-center gap-3 ml-auto text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(160, 72%, 43%)' }} />
                  盈利
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'hsl(354, 91%, 62%)' }} />
                  亏损
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full border-2 border-yellow-400" />
                  异常值
                </span>
              </div>
            </div>
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={() => {
                  setCalMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
                  setSelectedDate(null);
                }}
                className="p-1 rounded hover:bg-secondary text-muted-foreground"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium">
                {calMonth.getFullYear()}年{calMonth.getMonth() + 1}月
              </span>
              <button
                onClick={() => {
                  setCalMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
                  setSelectedDate(null);
                }}
                className="p-1 rounded hover:bg-secondary text-muted-foreground"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {['日','一','二','三','四','五','六'].map(d => (
                <div key={d} className="text-center text-[10px] text-muted-foreground font-medium py-1">{d}</div>
              ))}
            </div>
            {/* Day cells */}
            <div className="grid grid-cols-7 gap-1">
              {calendarGrid.flat().map((cell, i) => {
                if (cell.day === 0) return <div key={i} className="h-12" />;
                const hasPnl = cell.pnl !== null;
                const isProfit = hasPnl && cell.pnl! > 0;
                const isLoss = hasPnl && cell.pnl! < 0;
                const isOutlier = outlierDates.has(cell.date);
                return (
                  <button
                    type="button"
                    key={i}
                    onClick={() => setSelectedDate(cell.date)}
                    className={cn(
                      'h-12 rounded-md flex flex-col items-center justify-center text-center relative transition-colors',
                      'hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70',
                      isProfit && 'bg-[hsl(160,72%,43%)]/15',
                      isLoss && 'bg-[hsl(354,91%,62%)]/15',
                      !hasPnl && 'bg-secondary/20',
                      isOutlier && 'ring-2 ring-yellow-400/70 ring-inset',
                      selectedDate === cell.date && 'ring-2 ring-primary ring-inset',
                    )}
                  >
                    <span className="text-[10px] text-muted-foreground leading-none">{cell.day}</span>
                    {hasPnl ? (
                      <span className={cn(
                        'text-[9px] font-mono font-semibold leading-tight mt-0.5',
                        isProfit ? 'text-[hsl(160,72%,43%)]' : 'text-[hsl(354,91%,62%)]'
                      )}>
                        {isProfit ? '+' : ''}{Math.abs(cell.pnl!) >= 1000
                          ? `${(cell.pnl! / 1000).toFixed(1)}k`
                          : cell.pnl!.toFixed(0)}
                      </span>
                    ) : (
                      <span className="text-[9px] text-muted-foreground/30 leading-tight mt-0.5">-</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 rounded-md border border-border/50 bg-background/50 p-3">
              {selectedDate ? (
                selectedDayDetail ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-medium text-foreground">
                          {selectedDate} 当日交易
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {selectedDayDetail.symbols.length} 个币种 · {selectedDayDetail.trades} 笔
                          {campaignLoadError ? ' · 战役归属暂不可用' : ''}
                        </div>
                      </div>
                      <div className={cn(
                        'font-mono text-[13px] font-bold',
                        selectedDayDetail.pnl >= 0 ? 'trading-green' : 'trading-red',
                      )}>
                        {formatSignedMoney(selectedDayDetail.pnl)}
                      </div>
                    </div>

                    <div className="space-y-1.5 max-h-[210px] overflow-y-auto pr-1">
                      {selectedDayDetail.symbols.map(symbolDetail => {
                        const campaignSummaries = buildCampaignSummaries(symbolDetail, recordCampaignMap);
                        const linkedCampaigns = campaignSummaries.filter(row => row.campaign);
                        const uniqueCampaign = linkedCampaigns.length === 1 ? linkedCampaigns[0].campaign : null;
                        return (
                          <div key={symbolDetail.symbol} className="rounded-md border border-border/50 bg-card/50 p-2">
                            <button
                              type="button"
                              disabled={!uniqueCampaign}
                              onClick={() => uniqueCampaign && goToCampaign(uniqueCampaign.id)}
                              className={cn(
                                'w-full flex items-center justify-between gap-3 text-left',
                                uniqueCampaign ? 'hover:text-primary transition-colors' : 'cursor-default',
                              )}
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-[12px] font-semibold text-foreground truncate">
                                    {symbolDetail.symbol}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground">
                                    {symbolDetail.trades} 笔
                                  </span>
                                  {uniqueCampaign && <ExternalLink className="w-3 h-3 text-muted-foreground shrink-0" />}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate">
                                  {linkedCampaigns.length === 0
                                    ? '未归类到交易战役'
                                    : linkedCampaigns.length === 1
                                      ? linkedCampaigns[0].title
                                      : `${linkedCampaigns.length} 个交易战役`}
                                </div>
                              </div>
                              <div className={cn(
                                'font-mono text-[12px] font-bold shrink-0',
                                symbolDetail.pnl >= 0 ? 'trading-green' : 'trading-red',
                              )}>
                                {formatSignedMoney(symbolDetail.pnl)}
                              </div>
                            </button>

                            {(campaignSummaries.length > 1 || linkedCampaigns.length !== 1) && (
                              <div className="mt-1.5 space-y-1">
                                {campaignSummaries.map(row => (
                                  row.campaign ? (
                                    <button
                                      key={row.key}
                                      type="button"
                                      onClick={() => goToCampaign(row.campaign!.id)}
                                      className="w-full flex items-center justify-between gap-2 rounded border border-border/40 bg-background/60 px-2 py-1 text-left hover:border-primary/50 hover:text-primary transition-colors"
                                    >
                                      <span className="truncate text-[10px]">{row.title}</span>
                                      <span className={cn(
                                        'font-mono text-[10px] shrink-0',
                                        row.pnl >= 0 ? 'trading-green' : 'trading-red',
                                      )}>
                                        {formatSignedMoney(row.pnl)} · {row.trades} 笔
                                      </span>
                                    </button>
                                  ) : (
                                    <div
                                      key={row.key}
                                      className="flex items-center justify-between gap-2 rounded border border-border/30 bg-background/40 px-2 py-1 text-[10px] text-muted-foreground"
                                    >
                                      <span>{row.title}</span>
                                      <span className={cn('font-mono', row.pnl >= 0 ? 'trading-green' : 'trading-red')}>
                                        {formatSignedMoney(row.pnl)} · {row.trades} 笔
                                      </span>
                                    </div>
                                  )
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground">
                    {formatDayLabel(selectedDate)} 没有可按真实操作时间归集的交易记录。
                  </div>
                )
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  点击日历中的日期，查看当天交易过的币种、盈亏和对应交易战役。
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
