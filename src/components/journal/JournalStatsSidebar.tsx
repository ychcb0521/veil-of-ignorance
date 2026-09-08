import { useMemo } from 'react';
import type { PatternCluster } from '@/lib/journalAggregations';
import {
  computeOutcomeRate, computeTimeDistribution, computeSymbolDistribution,
} from '@/lib/journalAggregations';
import type { TradeJournal, JournalTagAssignment } from '@/types/journal';
import { ScatterPlot, robustRDomain, type ScatterSeries } from '@/components/charts/ScatterPlot';

interface Props {
  journals: TradeJournal[];
  assignments: JournalTagAssignment[];
  clusters: PatternCluster[];
  rangeDays: number;
}

function fmtPnl(v: number) { return `${v > 0 ? '+' : ''}${v.toFixed(2)}`; }
function pnlColor(v: number) {
  return v > 0
    ? 'text-[color:var(--chart-profit)]'
    : v < 0 ? 'text-[color:var(--chart-loss)]' : 'text-foreground';
}

const MENTAL_SCATTER_SERIES: ScatterSeries[] = [
  { id: 'win', label: '盈利', token: 'profit', shape: 'circle' },
  { id: 'loss', label: '亏损', token: 'loss', shape: 'diamond' },
  { id: 'other', label: '打平／未结束', token: 'neutral', shape: 'ring' },
];


export function JournalStatsSidebar({ journals, assignments, clusters, rangeDays }: Props) {
  const outcome = useMemo(() => computeOutcomeRate(journals), [journals]);
  const timeDist = useMemo(() => computeTimeDistribution(journals), [journals]);
  const topSymbols = useMemo(() => computeSymbolDistribution(journals).slice(0, 5), [journals]);

  const mostFatal = useMemo(
    () => [...clusters].sort((a, b) => a.stats.total_pnl - b.stats.total_pnl)[0],
    [clusters],
  );
  const mostFrequent = useMemo(
    () => [...clusters].sort((a, b) => b.stats.occurrence_count - a.stats.occurrence_count)[0],
    [clusters],
  );

  // 近 7 天新增/复发模式
  const recentPatterns = useMemo(() => {
    const since = Date.now() - 7 * 86400000;
    const m = new Map<string, { cluster: PatternCluster; recent: number; prior: number }>();
    for (const c of clusters) {
      let r = 0, p = 0;
      for (const j of c.journals) {
        const t = +new Date(j.pre_simulated_time);
        if (t >= since) r++; else p++;
      }
      if (r > 0) m.set(c.pattern.id, { cluster: c, recent: r, prior: p });
    }
    return Array.from(m.values()).sort((a, b) => b.recent - a.recent).slice(0, 5);
  }, [clusters]);

  const maxTime = Math.max(1, ...timeDist.map(t => Math.abs(t.avg_pnl)));
  const maxSymCount = Math.max(1, ...topSymbols.map(s => s.count));

  // 心态-收益散点
  const scatter = useMemo(() => {
    return journals.filter(j => j.post_r_multiple != null).map(j => ({
      x: j.pre_mental_state,
      y: j.post_r_multiple as number,
      o: j.post_outcome,
    }));
  }, [journals]);
  const mentalDomain = useMemo(() => robustRDomain(scatter.map(s => s.y)), [scatter]);

  return (
    <aside className="overflow-hidden rounded border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium">关键指标</div>
            <div className="text-[10px] text-muted-foreground">近 {rangeDays} 天</div>
          </div>
          <div className={`font-mono text-[16px] ${pnlColor(outcome.expectancy)}`}>{outcome.expectancy.toFixed(2)}R</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Metric label="总交易" value={String(journals.length)} />
          <Metric label="总标签数" value={String(assignments.length)} />
          <Metric label="胜率" value={`${(outcome.win_rate * 100).toFixed(0)}%`} />
          <Metric label="期望 R̄" value={outcome.expectancy.toFixed(2)} color={pnlColor(outcome.expectancy)} />
        </div>
        {(mostFatal || mostFrequent) && (
          <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
            {mostFatal && (
              <CompactInsight
                label="最致命"
                title={mostFatal.pattern.pattern_name}
                value={`${fmtPnl(mostFatal.stats.total_pnl)} USDT`}
                color={pnlColor(mostFatal.stats.total_pnl)}
              />
            )}
            {mostFrequent && (
              <CompactInsight
                label="最高频"
                title={mostFrequent.pattern.pattern_name}
                value={`×${mostFrequent.stats.occurrence_count}`}
              />
            )}
          </div>
        )}
      </div>

      <Section title="心态-收益">
        <ScatterPlot
          points={scatter.map((p, i) => ({
            id: `mental-${i}`,
            x: p.x,
            y: p.y,
            seriesId: p.o === 'win' ? 'win' : p.o === 'loss' ? 'loss' : 'other',
            valueText: `${p.y > 0 ? '+' : ''}${p.y.toFixed(2)}R`,
            label: `心态 ${p.x} 分`,
            ariaLabel: `心态 ${p.x} 分，${p.y.toFixed(2)}R`,
          }))}
          series={MENTAL_SCATTER_SERIES}
          yAxis={{
            min: mentalDomain.min,
            max: mentalDomain.max,
            ticks: mentalDomain.ticks.map(value => ({
              value,
              label: `${value > 0 ? '+' : ''}${value}R`,
            })),
          }}
          xAxis={{ mode: 'category', categories: [1, 2, 3, 4, 5].map(v => ({ value: v, label: String(v) })) }}
          referenceLines={[{ value: 0, kind: 'zero' }]}
          emptyMessage="暂无带 R 值的样本"
          testId="mental-scatter-plot"
          scrollAreaTestId="mental-scatter-scroll-area"
          legendExtra={<div className="font-mono tabular-nums">n={scatter.length}</div>}
          directionHint="横轴 心态评分 1–5，纵轴 R"
        />
        <div className="text-[10px] text-muted-foreground">找到自己的 alpha 心态窗口</div>
      </Section>

      <Section title="时段-平均R">
        <svg viewBox="0 0 240 100" className="w-full h-32">
          <line x1="0" y1="50" x2="240" y2="50" style={{ stroke: 'var(--chart-axis)' }} shapeRendering="crispEdges" />
          {timeDist.map((t, i) => {
            const h = (Math.abs(t.avg_pnl) / maxTime) * 40;
            const y = t.avg_pnl >= 0 ? 50 - h : 50;
            const color = t.avg_pnl >= 0 ? 'var(--chart-profit)' : 'var(--chart-loss)';
            return <rect key={i} x={i * 10} y={y} width={8} height={h} rx={1} style={{ fill: color }} />;
          })}
          {[0, 6, 12, 18, 23].map(h => (
            <text key={h} x={h * 10 + 4} y={98} fontSize="7" textAnchor="middle" style={{ fill: 'var(--chart-ink-muted)' }}>{h}</text>
          ))}
        </svg>
        <div className="text-[10px] text-muted-foreground">你的 alpha 时间窗口</div>
      </Section>

      <Section title="最常错的标的">
        {topSymbols.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">暂无数据</div>
        ) : (
          <div className="space-y-1.5">
            {topSymbols.map(s => (
              <div key={s.symbol} className="flex items-center gap-2 font-mono text-[11px]">
                <span className="w-16 truncate">{s.symbol}</span>
                <div className="flex-1 h-1.5 bg-muted rounded">
                  <div className="h-full rounded bg-[color:var(--chart-info)]" style={{ width: `${(s.count / maxSymCount) * 100}%` }} />
                </div>
                <span className="text-muted-foreground w-6 text-right">×{s.count}</span>
                <span className={`w-16 text-right ${pnlColor(s.total_pnl)}`}>{fmtPnl(s.total_pnl)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="最近 7 天" lastBlock>
        {recentPatterns.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">无新增模式</div>
        ) : (
          <div className="space-y-1.5">
            {recentPatterns.map(r => (
              <div key={r.cluster.pattern.id} className="text-[11px]">
                <div className="font-medium truncate">{r.cluster.pattern.pattern_name}</div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  {r.prior === 0 ? '首次出现' : `复发 ×${r.recent}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </aside>
  );
}

function Section({ title, children, lastBlock }: { title: string; children: React.ReactNode; lastBlock?: boolean }) {
  return (
    <details className={`group ${lastBlock ? '' : 'border-b border-border'}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[11px] text-muted-foreground hover:text-foreground">
        <span>{title}</span>
        <span className="text-[13px] transition-transform group-open:rotate-45">+</span>
      </summary>
      <div className="px-4 pb-3">{children}</div>
    </details>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-mono text-[14px] ${color ?? 'text-foreground'}`}>{value}</div>
    </div>
  );
}

function CompactInsight({ label, title, value, color }: { label: string; title: string; value: string; color?: string }) {
  return (
    <div className="grid grid-cols-[52px_1fr_auto] items-center gap-2 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{title}</span>
      <span className={`font-mono ${color ?? 'text-muted-foreground'}`}>{value}</span>
    </div>
  );
}
