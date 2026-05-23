import { useMemo } from 'react';
import type { PatternCluster } from '@/lib/journalAggregations';
import {
  computeOutcomeRate, computeTimeDistribution, computeSymbolDistribution,
} from '@/lib/journalAggregations';
import type { TradeJournal, JournalTagAssignment } from '@/types/journal';

interface Props {
  journals: TradeJournal[];
  assignments: JournalTagAssignment[];
  clusters: PatternCluster[];
  rangeDays: number;
}

function fmtPnl(v: number) { return `${v > 0 ? '+' : ''}${v.toFixed(2)}`; }
function pnlColor(v: number) {
  return v > 0 ? 'text-[#0ECB81]' : v < 0 ? 'text-[#F6465D]' : 'text-foreground';
}

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
  const maxR = Math.max(1, ...scatter.map(s => Math.abs(s.y)));

  return (
    <aside className="bg-card border border-border rounded">
      <Section title={`周期内（${rangeDays} 天）`}>
        <div className="grid grid-cols-2 gap-3">
          <Metric label="总交易" value={String(journals.length)} />
          <Metric label="总标签数" value={String(assignments.length)} />
          <Metric label="胜率" value={`${(outcome.win_rate * 100).toFixed(0)}%`} />
          <Metric label="期望 R̄" value={outcome.expectancy.toFixed(2)} color={pnlColor(outcome.expectancy)} />
          {mostFatal && (
            <div className="col-span-2">
              <div className="text-[10px] text-muted-foreground">最致命模式</div>
              <div className="text-[12px] font-medium truncate">{mostFatal.pattern.pattern_name}</div>
              <div className={`text-[11px] font-mono ${pnlColor(mostFatal.stats.total_pnl)}`}>
                {fmtPnl(mostFatal.stats.total_pnl)} USDT
              </div>
            </div>
          )}
          {mostFrequent && (
            <div className="col-span-2">
              <div className="text-[10px] text-muted-foreground">最高频模式</div>
              <div className="text-[12px] font-medium truncate">{mostFrequent.pattern.pattern_name}</div>
              <div className="text-[11px] font-mono text-muted-foreground">×{mostFrequent.stats.occurrence_count}</div>
            </div>
          )}
        </div>
      </Section>

      <Section title="心态-收益">
        <svg viewBox="0 0 240 100" className="w-full h-32">
          <line x1="0" y1="50" x2="240" y2="50" stroke="#2B3139" />
          {[1, 2, 3, 4, 5].map(s => (
            <text key={s} x={(s - 1) * 56 + 16} y={98} fontSize="7" textAnchor="middle" className="fill-[#848E9C]">{s}</text>
          ))}
          {scatter.map((p, i) => {
            const cx = (p.x - 1) * 56 + 16;
            const cy = 50 - (p.y / maxR) * 40;
            const color = p.o === 'win' ? '#0ECB81' : p.o === 'loss' ? '#F6465D' : '#848E9C';
            return <circle key={i} cx={cx} cy={cy} r={2.5} fill={color} opacity={0.7} />;
          })}
        </svg>
        <div className="text-[10px] text-muted-foreground">找到自己的 alpha 心态窗口</div>
      </Section>

      <Section title="时段-平均R">
        <svg viewBox="0 0 240 100" className="w-full h-32">
          <line x1="0" y1="50" x2="240" y2="50" stroke="#2B3139" />
          {timeDist.map((t, i) => {
            const h = (Math.abs(t.avg_pnl) / maxTime) * 40;
            const y = t.avg_pnl >= 0 ? 50 - h : 50;
            const color = t.avg_pnl >= 0 ? '#0ECB81' : '#F6465D';
            return <rect key={i} x={i * 10} y={y} width={8} height={h} fill={color} />;
          })}
          {[0, 6, 12, 18, 23].map(h => (
            <text key={h} x={h * 10 + 4} y={98} fontSize="7" textAnchor="middle" className="fill-[#848E9C]">{h}</text>
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
                  <div className="h-full bg-[#5b8def] rounded" style={{ width: `${(s.count / maxSymCount) * 100}%` }} />
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
    <div className={`px-4 py-3 ${lastBlock ? '' : 'border-b border-border'}`}>
      <div className="text-[11px] text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
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
