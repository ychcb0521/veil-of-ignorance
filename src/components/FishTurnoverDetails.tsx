import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { fishTurnoverDetailKey, fishTurnoverSymbolKey, type FishTurnoverDetail } from '@/lib/fish/turnoverRejections';
import { formatUTC8 } from '@/lib/timeFormat';

const PAGE_SIZE = 50;
const amount = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });
const EMPTY_ROWS: readonly FishTurnoverDetail[] = [];

export function FishTurnoverEvidence({ rows }: { rows: readonly FishTurnoverDetail[] }) {
  return <div className="space-y-3">
    {rows.map(row => <section key={fishTurnoverDetailKey(row)} className="space-y-1.5">
      <p className="font-medium">{row.stage === 'cutoff' ? '扫描截止前检查' : '信号起点前检查'} <span className="font-mono font-normal text-muted-foreground">{formatUTC8(row.at)}（北京时间）</span></p>
      <div className="overflow-x-auto rounded-md border border-border/60">
        <table className="w-full whitespace-nowrap text-left" aria-label="当次成交额读数">
          <thead className="bg-muted"><tr>{['回看时长', '实际成交额（USDT）', '门槛（USDT）', '判定'].map(label =>
            <th key={label} scope="col" className="px-3 py-2">{label}</th>)}</tr></thead>
          <tbody>{row.checks.map(check => <tr key={check.hours} className="border-t border-border/50">
            <td className="px-3 py-2">{check.hours} 小时</td>
            <td className={`px-3 py-2 font-mono tabular-nums ${check.ok ? '' : 'font-medium text-destructive'}`}>{amount.format(check.value)}</td>
            <td className="px-3 py-2 font-mono tabular-nums">≥ {amount.format(check.min)}</td>
            <td className={`px-3 py-2 ${check.ok ? 'text-muted-foreground' : 'font-medium text-destructive'}`}>{check.ok ? '达标' : '未达标'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {row.algorithms.length > 0 && <p className="text-muted-foreground">涉及规则 {row.algorithms.join('、')}</p>}
    </section>)}
  </div>;
}

export function FishTurnoverDetails({ rows = EMPTY_ROWS, rejected }: { rows?: readonly FishTurnoverDetail[]; rejected: number }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const missing = Math.max(0, rejected - new Set(rows.map(fishTurnoverSymbolKey)).size);
  const windows = useMemo(() => [...new Set(rows.flatMap(row => row.checks.map(check => check.hours)))].sort((a, b) => a - b), [rows]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(row => `${row.symbol} ${EXCHANGE_NAMES[row.exchange]}`.toLowerCase().includes(needle))
      .sort((a, b) => b.at - a.at || a.symbol.localeCompare(b.symbol));
  }, [rows, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)), at = Math.min(page, pages - 1);
  const shown = filtered.slice(at * PAGE_SIZE, (at + 1) * PAGE_SIZE);
  return (
    <>
      {missing > 0 && <p role="note" className="rounded-md border border-border/60 bg-muted/30 px-3 py-2.5 text-muted-foreground">
        {missing} 个标的仅保存了过滤数量。重新捕捞后可查看实际成交额。
      </p>}
      {rows.length === 0 ? (rejected === 0 && <p className="py-8 text-center text-muted-foreground">本轮暂无成交额未达标记录。</p>) : <>
        <label className="flex h-8 items-center gap-2 rounded-md bg-muted/50 px-2.5 text-muted-foreground">
          <Search aria-hidden className="h-3.5 w-3.5" />
          <input aria-label="搜索成交额过滤标的或交易所" placeholder="搜索标的或交易所…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="min-w-0 flex-1 bg-transparent text-foreground outline-none" />
        </label>
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full whitespace-nowrap text-left text-[11px]" aria-label="成交额过滤">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">标的 / 交易所</th>
                <th className="px-3 py-2.5 font-medium">检查时点 · UTC+8</th>
                {windows.map(hours => (
                  <th key={hours} className="px-3 py-2.5 text-right font-medium">{hours}h 成交额（USDT）</th>
                ))}
                <th className="px-3 py-2.5 font-medium">未达标项</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(row => <tr key={fishTurnoverDetailKey(row)} className="border-t border-border/50 hover:bg-muted/25">
                <td className="px-3 py-2.5" title={row.algorithms?.join('、')}>
                  <span className="font-mono font-medium">{row.symbol}</span>
                  <span className="ml-2 text-muted-foreground">{EXCHANGE_NAMES[row.exchange]}{row.market === 'us_stock' ? ' · 美股' : ''}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="mr-2 text-muted-foreground">{row.stage === 'cutoff' ? '捕捞截止' : '信号起点'}</span>
                  <span className="font-mono tabular-nums">{formatUTC8(row.at)}</span>
                </td>
                {windows.map(hours => {
                  const check = row.checks.find(item => item.hours === hours);
                  return <td key={hours} title={check ? `实际 ${check.value} USDT · 门槛 ≥ ${check.min} USDT` : undefined} className={`px-3 py-2.5 text-right font-mono tabular-nums ${check && !check.ok ? 'font-medium text-destructive' : ''}`}>
                    {check ? amount.format(check.value) : '—'}
                  </td>;
                })}
                <td className="px-3 py-2.5 font-medium text-destructive">{row.checks.filter(check => !check.ok).map(check => `${check.hours}h`).join('、')}</td>
              </tr>)}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="py-8 text-center text-muted-foreground">没有匹配的记录</p>}
        </div>
        {pages > 1 && <div className="flex items-center justify-between text-muted-foreground">
          <span>共 {filtered.length} 条 · {at + 1} / {pages} 页</span>
          <div className="flex gap-4">
            <button type="button" disabled={at === 0} onClick={() => setPage(at - 1)} className="disabled:opacity-40">上一页</button>
            <button type="button" disabled={at === pages - 1} onClick={() => setPage(at + 1)} className="disabled:opacity-40">下一页</button>
          </div>
        </div>}
      </>}
    </>
  );
}
