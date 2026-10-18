import { useMemo, useState } from 'react';
import type { TradeSignal } from '@/lib/signalLibrary';
import { sortSignalsByTime } from '@/lib/signalLibrary';
import type { FishProgress } from '@/lib/fishScanner';
import { fishSignalTitle } from '@/lib/fishSignals';
import { formatUTC8 } from '@/lib/timeFormat';
import { SignalLibraryList } from '@/components/SignalLibraryList';

export interface FishPanelProps {
  signals: TradeSignal[]; progress: FishProgress | null;
  onStart: () => void; onCancel: () => void; onAdd: (id?: string) => void;
  onJump: (id: string) => void; onDelete: (id: string) => void; onRate: (id: string, value: number) => void;
  jumpingSignalId: string | null; tradedDayIndex: Set<string>; campaignDayIndex: Set<string>;
}
export function FishPanel(p: FishPanelProps) {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => sortSignalsByTime(p.signals.filter(s => s.symbol.toLowerCase().includes(query.toLowerCase()))), [p.signals, query]);
  const running = p.progress?.status === 'running';
  const btn = 'rounded border border-border/60 px-2 py-1 text-[11px] hover:bg-accent disabled:opacity-40';
  const x = p.progress;
  return <section className="mt-2 space-y-2 rounded border border-border/60 bg-background p-3" aria-label="渔" data-testid="fish-panel">
    <div className="flex flex-wrap items-center gap-2">
      <strong className="text-xs">渔</strong>
      <button type="button" className={btn} disabled={running} onClick={p.onStart}>开始捕捞</button>
      <button type="button" className={btn} disabled={!running} onClick={p.onCancel}>取消</button>
      <button type="button" className={btn} disabled={!p.signals.length} onClick={() => p.onAdd()}>全部加入信号库</button>
      <input className="ml-auto rounded border border-border/60 bg-transparent px-2 py-1 text-[11px]" aria-label="筛选渔信号" placeholder="筛选标的" value={query} onChange={e => setQuery(e.target.value)} />
    </div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">币安 USDT 永续 · 已收盘 5m 2000 根 · 内置 CBI-2 · avg(CBI2, 24h) &gt; 0.3。第1455根起读数可用；只记录本轮上穿起点，起点不明不入库。BTC 同区间必须完整。</p>
    <p className="font-mono text-[11px] text-muted-foreground">截止（UTC+8）：{x?.cutoffMs ? formatUTC8(x.cutoffMs) : '开始扫描时锁定币安服务器时间'}</p>
    {x && <div className="space-y-1 text-[11px]" role="status" aria-live="polite">
      <p>{x.status === 'running' ? '捕捞中' : x.status === 'complete' ? '捕捞完成' : x.status === 'cancelled' ? '已取消' : '已中止'} · {x.done} / {x.total}{x.current ? ` · ${x.current}` : ''}</p>
      <p className="flex flex-wrap gap-x-3 text-muted-foreground"><span>命中 {x.counts.hit}</span><span>未达标 {x.counts.below}</span><span>起点不明 {x.counts.unknown}</span><span>缺口 / 不足2000根 {x.counts.gap}</span><span>读数不全 {x.counts.readings}</span><span>请求失败 {x.counts.failed}</span></p>
      {x.error && <p className="text-destructive">{x.error}</p>}
    </div>}
    <div className="border-t border-border/50 pt-2">
      <div className="mb-1 text-[11px] text-muted-foreground">{p.signals.length} 条信号 · 标的 / 时间（UTC+8） / 评分</div>
      {rows.length ? <SignalLibraryList rows={rows} resetKey={`fish:${query}`} tradedDayIndex={p.tradedDayIndex} campaignDayIndex={p.campaignDayIndex} jumpingSignalId={p.jumpingSignalId} onJump={p.onJump} onDelete={p.onDelete} onRate={p.onRate} onAdd={p.onAdd} rowTitle={fishSignalTitle} /> : <p className="py-3 text-[11px] text-muted-foreground">暂无信号</p>}
    </div>
  </section>;
}
