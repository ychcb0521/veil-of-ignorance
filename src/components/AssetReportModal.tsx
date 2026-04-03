import { useState, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, BarChart3, Calendar as CalendarIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import type { AssetState, AssetSnapshot, DailyPnL } from '@/types/assets';
import { formatUTC8 } from '@/lib/timeFormat';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
  CartesianGrid,
} from 'recharts';

type TimeRange = '7d' | '30d' | '90d' | 'all';

interface Props {
  open: boolean;
  onClose: () => void;
  assets: AssetState;
}

export function AssetReportModal({ open, onClose, assets }: Props) {
  const [range, setRange] = useState<TimeRange>('30d');
  const { history, dailyPnl, todayPnl, todayPnlPct } = assets;

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

  // Summary for filtered range
  const rangeStats = useMemo(() => {
    const filtered = dailyPnl.filter(d => {
      if (range === 'all') return true;
      const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      return new Date(d.date) >= cutoff;
    });
    const totalPnl = filtered.reduce((s, d) => s + d.pnl, 0);
    const totalTrades = filtered.reduce((s, d) => s + d.trades, 0);
    return { totalPnl, totalTrades };
  }, [dailyPnl, range]);

  // Build a map for calendar day PnL
  const pnlMap = useMemo(() => {
    const map = new Map<string, number>();
    dailyPnl.forEach(d => map.set(d.date, d.pnl));
    return map;
  }, [dailyPnl]);

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
                onClick={() => setRange(r.key)}
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
              <div className="text-[10px] text-muted-foreground font-medium mb-1.5 uppercase tracking-wider">交易盈亏总额</div>
              <div className={cn(
                'font-mono text-lg font-bold',
                rangeStats.totalPnl >= 0 ? 'trading-green' : 'trading-red'
              )}>
                {rangeStats.totalPnl >= 0 ? '+' : ''}${rangeStats.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-secondary/30 rounded-lg p-4 border border-border/50">
              <div className="text-[10px] text-muted-foreground font-medium mb-1.5 uppercase tracking-wider">交易笔数</div>
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
                onClick={() => setCalMonth(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
                className="p-1 rounded hover:bg-secondary text-muted-foreground"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium">
                {calMonth.getFullYear()}年{calMonth.getMonth() + 1}月
              </span>
              <button
                onClick={() => setCalMonth(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
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
                  <div
                    key={i}
                    className={cn(
                      'h-12 rounded-md flex flex-col items-center justify-center text-center relative',
                      isProfit && 'bg-[hsl(160,72%,43%)]/15',
                      isLoss && 'bg-[hsl(354,91%,62%)]/15',
                      !hasPnl && 'bg-secondary/20',
                      isOutlier && 'ring-2 ring-yellow-400/70 ring-inset',
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
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
