import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { PatternCluster } from '@/lib/journalAggregations';
import {
  computeTimeDistribution, computeMentalStateDistribution, computeSymbolDistribution,
} from '@/lib/journalAggregations';

const SEV_BAR: Record<PatternCluster['severity'], string> = {
  critical: 'bg-[#F6465D]',
  high: 'bg-[#F0B90B]',
  medium: 'bg-[#848E9C]',
  low: 'bg-muted',
};

function pnlColor(v: number) {
  return v > 0 ? 'text-[#0ECB81]' : v < 0 ? 'text-[#F6465D]' : 'text-muted-foreground';
}
function mentalColor(s: number) {
  if (s <= 2) return 'text-[#F6465D]';
  if (s === 3) return 'text-muted-foreground';
  return 'text-[#0ECB81]';
}
function fmtPnl(v: number) { return `${v > 0 ? '+' : ''}${v.toFixed(2)}`; }
function fmtTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface Props {
  cluster: PatternCluster;
  expandedSignal?: boolean | null;
}

export function PatternClusterCard({ cluster, expandedSignal }: Props) {
  const [openLocal, setOpenLocal] = useState(false);
  const open = expandedSignal == null ? openLocal : expandedSignal;
  const nav = useNavigate();
  const { pattern, category, stats, severity, journals } = cluster;

  const timeDist = useMemo(() => computeTimeDistribution(journals), [journals]);
  const mentalDist = useMemo(() => computeMentalStateDistribution(journals), [journals]);
  const symbolDist = useMemo(() => computeSymbolDistribution(journals).slice(0, 5), [journals]);

  const maxTime = Math.max(1, ...timeDist.map(t => t.count));
  const maxMental = Math.max(1, ...mentalDist.map(m => m.count));
  const maxSymbol = Math.max(1, ...symbolDist.map(s => s.count));

  return (
    <div className="bg-card border border-border rounded mb-2 overflow-hidden flex">
      <div className={`w-1 shrink-0 ${SEV_BAR[severity]}`} />
      <div className="flex-1 min-w-0">
        <div
          className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-accent"
          onClick={() => setOpenLocal(v => (expandedSignal == null ? !v : !open))}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: category.color }} />
          <span className="text-[10px] text-muted-foreground">{category.name_zh}</span>
          <span className="text-[12px] font-medium text-foreground truncate">{pattern.pattern_name}</span>
          <div className="flex-1" />
          <div className="flex items-center gap-4 font-mono">
            <span className="text-[12px]">×{stats.occurrence_count}</span>
            <span className={`text-[11px] ${stats.last_30d_count >= 3 ? 'text-[#F6465D] font-bold' : 'text-muted-foreground'}`}>
              30d ×{stats.last_30d_count}
            </span>
            <span className={`text-[12px] ${pnlColor(stats.total_pnl)}`}>{fmtPnl(stats.total_pnl)} USDT</span>
            <span className="text-[11px] text-muted-foreground">R̄ {stats.avg_r_multiple.toFixed(2)}</span>
          </div>
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>

        {open && (
          <div className="border-t border-border px-4 py-3 space-y-3">
            <div className="text-[11px] text-muted-foreground italic">
              定义：{pattern.operational_definition}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <MiniChart title="时段分布">
                <svg viewBox="0 0 240 64" className="w-full h-16">
                  {timeDist.map((t, i) => {
                    const h = (t.count / maxTime) * 50;
                    return <rect key={i} x={i * 10} y={60 - h} width={8} height={h} className="fill-[#5b8def]" />;
                  })}
                  {[0, 6, 12, 18, 23].map(h => (
                    <text key={h} x={h * 10 + 4} y={64} fontSize="6" textAnchor="middle" className="fill-[#848E9C]">{h}</text>
                  ))}
                </svg>
              </MiniChart>
              <MiniChart title="心态分布">
                <svg viewBox="0 0 100 64" className="w-full h-16">
                  {mentalDist.map((m, i) => {
                    const h = (m.count / maxMental) * 50;
                    const color = m.state <= 2 ? '#F6465D' : m.state === 3 ? '#848E9C' : '#0ECB81';
                    return (
                      <g key={i}>
                        <rect x={i * 20 + 4} y={60 - h} width={14} height={h} fill={color} />
                        <text x={i * 20 + 11} y={64} fontSize="6" textAnchor="middle" className="fill-[#848E9C]">{m.state}</text>
                      </g>
                    );
                  })}
                </svg>
              </MiniChart>
              <MiniChart title="标的Top5">
                <div className="space-y-1">
                  {symbolDist.map(s => (
                    <div key={s.symbol} className="flex items-center gap-1 text-[9px] font-mono">
                      <span className="w-12 truncate text-foreground">{s.symbol}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded">
                        <div className="h-full bg-[#5b8def] rounded" style={{ width: `${(s.count / maxSymbol) * 100}%` }} />
                      </div>
                      <span className="text-muted-foreground w-6 text-right">{s.count}</span>
                    </div>
                  ))}
                </div>
              </MiniChart>
            </div>

            <div className="border border-border rounded overflow-hidden">
              <div className="grid grid-cols-[110px_80px_60px_50px_60px_80px_40px] text-[10px] text-muted-foreground bg-background px-2 py-1">
                <span>时间</span><span>标的</span><span>方向</span><span>心态</span>
                <span>R</span><span>P&L</span><span>标注</span>
              </div>
              {journals.slice().sort((a, b) => +new Date(b.pre_simulated_time) - +new Date(a.pre_simulated_time)).map(j => (
                <div key={j.id}
                  onClick={() => nav(`/journal/${j.id}`)}
                  className="grid grid-cols-[110px_80px_60px_50px_60px_80px_40px] px-2 py-1.5 text-[11px] font-mono hover:bg-accent cursor-pointer border-t border-border/40">
                  <span>{fmtTime(j.pre_simulated_time)}</span>
                  <span className="truncate">{j.symbol}</span>
                  <span className={
                    j.direction === 'long' ? 'text-[#0ECB81]' :
                    j.direction === 'short' ? 'text-[#F6465D]' : 'text-muted-foreground'
                  }>
                    {j.direction === 'long' ? 'LONG' : j.direction === 'short' ? 'SHORT' : 'PASS'}
                  </span>
                  <span className={mentalColor(j.pre_mental_state)}>{j.pre_mental_state}</span>
                  <span className={pnlColor(j.post_r_multiple ?? 0)}>{j.post_r_multiple != null ? j.post_r_multiple.toFixed(2) : '—'}</span>
                  <span className={pnlColor(j.post_realized_pnl ?? 0)}>{j.post_realized_pnl != null ? fmtPnl(j.post_realized_pnl) : '—'}</span>
                  <span>{j.reason_was_rewritten && <AlertTriangle className="w-3 h-3 text-[#F0B90B]" />}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {severity === 'critical' && (
          <div className="bg-[#F6465D]/10 border-t border-[#F6465D]/30 px-4 py-2 text-[11px] text-[#F6465D]">
            ⚠ 该模式 30 天内 ≥3 次且平均亏损，批次 6 完成后将强制要求生成新规则。
          </div>
        )}
      </div>
    </div>
  );
}

function MiniChart({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-background rounded p-2 border border-border">
      <div className="text-[9px] text-muted-foreground mb-1">{title}</div>
      {children}
    </div>
  );
}
