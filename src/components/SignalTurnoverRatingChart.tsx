import { useState } from 'react';
import { formatUTC8 } from '@/lib/timeFormat';
import { formatUsdtCn, turnoverRatingSummary, type SignalTurnoverRow } from '@/lib/signalTurnover';

/** 评分是离散档位，不做回归或相关性的推断；对数金额轴保留零成交额。 */
export function SignalTurnoverRatingChart({ rows }: { rows: readonly SignalTurnoverRow[] }) {
  const [active, setActive] = useState<SignalTurnoverRow | null>(null);
  const valid = rows.filter(r => r.turnover !== null && Number.isFinite(r.turnover) && r.turnover >= 0);
  const points = valid.filter(r => r.quality !== undefined);
  const groups = turnoverRatingSummary(rows);
  const maxLog = Math.max(1, Math.ceil(Math.log10(1 + Math.max(0, ...points.map(r => r.turnover!)))));
  const minLog = Math.max(0, Math.floor(Math.log10(1 + (points.length ? Math.min(...points.map(r => r.turnover!)) : 0))) - 1);
  const span = maxLog - minLog || 1;
  const ticks = Array.from({ length: span + 1 }, (_, i) => minLog + i).filter((_, i) => span <= 5 || i % Math.ceil(span / 5) === 0 || i === span);
  const x = (rating: number) => 94 + (rating - 1) * 104;
  const y = (amount: number) => 194 - (Math.log10(1 + amount) - minLog) / span * 164;
  const detail = active && points.includes(active) ? active : null;
  return <section aria-label="评分与成交额" className="space-y-2 border-t border-border/60 pt-3">
    <div className="flex flex-wrap items-baseline justify-between gap-1">
      <h3 className="text-xs font-medium">评分与成交额</h3>
      <span className="text-[10px] text-muted-foreground">{points.length} 个已评分 · {valid.length - points.length} 个未评分</span>
    </div>
    <p className="text-[10px] text-muted-foreground">每点一条信号 · 纵轴为前 24h 成交额（USDT，对数刻度）</p>
    {points.length ? <>
      <svg viewBox="0 0 560 225" className="block w-full text-muted-foreground" role="img" aria-label={`评分与前24小时成交额散点图，${points.length} 条信号`}>
        {ticks.map(log => {
          const amount = log === 0 ? 0 : 10 ** log;
          const at = y(amount);
          return <g key={log}><line x1="62" x2="542" y1={at} y2={at} stroke="currentColor" opacity="0.12" /><text x="54" y={at + 3} textAnchor="end" fill="currentColor" className="text-[16px] sm:text-[10px]">{formatUsdtCn(amount)}</text></g>;
        })}
        {groups.map(g => <text key={g.quality} x={x(g.quality)} y="216" textAnchor="middle" fill="currentColor" className="text-[16px] sm:text-[11px]">{g.quality} 分</text>)}
        {points.map((r, i) => <circle key={`${r.exchange}:${r.market}:${r.symbol}:${r.timeMs}:${i}`} cx={x(r.quality!)} cy={y(r.turnover!)} r="3.5" className="fill-primary stroke-primary focus:outline-none focus:stroke-foreground" fillOpacity="0.42" strokeOpacity="0.6" strokeWidth="0.5" tabIndex={0}
          aria-label={`${r.symbol}，${r.quality} 分，${r.turnover} USDT`}
          onMouseEnter={() => setActive(r)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(r)} onBlur={() => setActive(null)} />)}
        {groups.filter(g => g.median !== null).map(g => <path key={g.quality} d={`M ${x(g.quality)} ${y(g.median!) - 5} l 5 5 l -5 5 l -5 -5 Z`} className="fill-background stroke-foreground" strokeWidth="1.5" pointerEvents="none" />)}
      </svg>
      <div className="min-h-8 text-[10px] leading-relaxed text-muted-foreground" aria-live="polite">
        {detail ? <span>{detail.symbol} · {detail.exchange ?? 'binance'} · {formatUTC8(detail.timeMs)} · {detail.quality} 分 · {detail.turnover!.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} USDT{detail.hours < 24 ? `（覆盖 ${Number(detail.hours.toFixed(2))} 小时）` : ''}</span> : <span>○ 单条信号　◇ 各评分档中位数 · 悬停或聚焦点查看明细</span>}
      </div>
    </> : <p className="rounded bg-muted/40 px-3 py-4 text-[11px] text-muted-foreground">暂无同时有评分和成交额的信号。给信号评分后，这里会自动显示。</p>}
    <table className="w-full table-fixed text-center text-[10.5px]" aria-label="各评分档成交额汇总">
      <thead><tr className="text-muted-foreground"><th scope="col" className="text-left font-normal">评分</th>{groups.map(g => <th scope="col" key={g.quality} className="font-normal">{g.quality} 分</th>)}</tr></thead>
      <tbody className="font-mono tabular-nums"><tr><th scope="row" className="py-1 text-left font-normal text-muted-foreground">信号数</th>{groups.map(g => <td key={g.quality}>{g.count}</td>)}</tr><tr><th scope="row" className="text-left font-normal text-muted-foreground">中位数</th>{groups.map(g => <td key={g.quality}>{g.median === null ? '—' : formatUsdtCn(g.median)}</td>)}</tr></tbody>
    </table>
    <p className="text-[10px] text-muted-foreground">评分使用信号库当前值；未评分或成交额缺失的不入图。上市不足 24h 的信号沿用已覆盖时段，明细见悬停与 CSV。</p>
  </section>;
}
