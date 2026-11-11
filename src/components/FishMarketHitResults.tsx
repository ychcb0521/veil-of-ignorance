import { useMemo, useState } from 'react';
import { countFishMarketHits, type FishMarketHit, type FishMarketHitGroup, type FishHitRateWindow } from '@/lib/fish/hitRate';
import { fishCaughtBy } from '@/lib/fish/records';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';

const groups: Record<FishMarketHitGroup, string> = {
  outside: '样本外',
  'other-window': '其他窗口样本',
  sample: '本窗样本',
};
const cell = 'px-2.5 py-1.5 text-left';
const pageSize = 50;

export function FishMarketHitResults({ rows, anchorMs, windows, clearWindow }: {
  rows: readonly FishMarketHit[];
  anchorMs?: number;
  windows: readonly FishHitRateWindow[];
  clearWindow: () => void;
}) {
  const [filter, setFilter] = useState<FishMarketHitGroup | 'all'>(anchorMs === undefined ? 'outside' : 'all');
  const [page, setPage] = useState(0);
  const inScope = useMemo(() => anchorMs === undefined ? rows : rows.filter(row => row.anchorMs === anchorMs), [rows, anchorMs]);
  const outside = useMemo(() => countFishMarketHits(inScope.filter(row => row.group === 'outside')), [inScope]);
  const visible = useMemo(() => inScope.filter(row => filter === 'all' || row.group === filter)
    .sort((a, b) => b.anchorMs - a.anchorMs || a.signal.symbol.localeCompare(b.signal.symbol)), [inScope, filter]);
  const notices = windows.filter(window => window.notice && (anchorMs === undefined || window.anchorMs === anchorMs));
  const pages = Math.ceil(visible.length / pageSize);
  const currentPage = Math.min(page, Math.max(0, pages - 1));
  const first = currentPage * pageSize;
  return <div className="min-w-0 space-y-2 border-t border-border/60 pt-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-medium">全市场命中</h3>
        <span className="font-medium tabular-nums text-primary">样本外 {outside.markets} 个标的</span>
        <span className="tabular-nums text-muted-foreground">{outside.signals} 条样本外信号 · {inScope.length} 条窗口命中记录</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {anchorMs !== undefined && <button type="button" onClick={clearWindow} className="text-primary hover:underline">显示全部窗口</button>}
        <select aria-label="筛选全市场命中" className="rounded-md border border-border/60 bg-muted/40 px-2 py-1.5"
          value={filter} onChange={event => { setFilter(event.target.value as typeof filter); setPage(0); }}>
          <option value="outside">样本外</option>
          <option value="all">全部命中</option>
          <option value="sample">本窗样本</option>
          <option value="other-window">其他窗口样本</option>
        </select>
      </div>
    </div>
    <p className="text-muted-foreground">
      {anchorMs === undefined ? `已完成 ${windows.length} 个窗口` : `窗口截止 ${formatUTC8(anchorMs)}`}
      {' · '}样本外指未进入本轮样本清单的标的（按市场区分）。同一信号起点跨窗口只计一次。
    </p>
    {notices.length > 0 && <details className="text-muted-foreground">
      <summary className="cursor-pointer">取数提示 · {notices.length} 个窗口</summary>
      <ul className="mt-1 max-h-28 space-y-1 overflow-auto pl-3">{notices.map(window => <li key={window.anchorMs}>{formatUTC8(window.anchorMs)} · {window.notice}</li>)}</ul>
    </details>}
    <div className="overflow-x-auto rounded-md border border-border/60">
      <table className="w-full min-w-[39rem] text-[11px]" aria-label="全市场命中明细">
        <thead className="bg-muted"><tr>{['标的 / 市场', '样本归类', '信号起点', '扫描截止', '算法数量', '算法来源'].map(label =>
          <th key={label} scope="col" className={`${cell} whitespace-nowrap font-medium`}>{label}</th>)}</tr></thead>
        <tbody>{visible.slice(first, first + pageSize).map(({ signal, anchorMs, marketKey, group }) => {
          const sources = fishCaughtBy(signal);
          return <tr key={`${anchorMs}|${marketKey}`} className="border-t border-border/50 hover:bg-muted/25">
            <td className={cell}><div className="font-medium">{signal.symbol}</div><div className="text-muted-foreground">
              {EXCHANGE_NAMES[signal.exchange ?? 'binance']}{signal.market === 'us_stock' ? ' · 美股合约' : ''}
            </div></td>
            <td className={`${cell} whitespace-nowrap`}>
              <span className={group === 'outside' ? 'rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary' : 'text-muted-foreground'}>{groups[group]}</span>
            </td>
            <td className={`${cell} whitespace-nowrap font-mono`}>{formatUTC8(signal.timeMs)}</td>
            <td className={`${cell} whitespace-nowrap font-mono`}>{formatUTC8(anchorMs)}</td>
            <td className={`${cell} font-mono tabular-nums`}>{sources.length || '—'}</td>
            <td className={`${cell} min-w-28 break-words font-mono`}>{sources.join(' · ') || '—'}</td>
          </tr>;
        })}</tbody>
      </table>
      {!visible.length && <p className="p-3 text-muted-foreground">{filter === 'outside' ? '当前范围内没有样本外命中。' : '当前范围内没有符合筛选的命中。'}</p>}
    </div>
    {pages > 1 && <div className="flex flex-wrap items-center justify-end gap-2 text-muted-foreground">
      <span className="tabular-nums">{first + 1}–{Math.min(first + pageSize, visible.length)} / {visible.length}</span>
      <button type="button" disabled={currentPage === 0} className="rounded border border-border/60 px-2 py-1 hover:bg-muted disabled:opacity-40"
        onClick={() => setPage(currentPage - 1)}>上一页</button>
      <button type="button" disabled={currentPage + 1 >= pages} className="rounded border border-border/60 px-2 py-1 hover:bg-muted disabled:opacity-40"
        onClick={() => setPage(currentPage + 1)}>下一页</button>
    </div>}
  </div>;
}
