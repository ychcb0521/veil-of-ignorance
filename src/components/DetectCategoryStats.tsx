/**
 * 探测比较板块的「探测信号类别」统计：每个类别（命中的探测算法组合）各几场、已卖出几场、盈亏分布。
 * 收益 = 100 USDT 模拟多单的已实现盈亏，数值即百分比。点一行只看该类别；表头可排序，空值始终排最后。
 */
import { useMemo, useState } from 'react';
import type { TradeCampaign } from '@/types/journal';

type Row = { campaign: TradeCampaign };
const pct = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const tone = (v: number | null) => v == null ? '' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-destructive' : '';
const COLUMNS = [['category', '探测信号类别'], ['detectors', '命中算法数'], ['total', '场数'], ['closed', '已卖出'], ['winRate', '盈利占比'], ['mean', '平均收益'], ['median', '中位数'], ['worst', '最差收益']] as const;
type Key = typeof COLUMNS[number][0];
export function detectCategoryStats(rows: readonly Row[]) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) { const c = row.campaign.comparison?.category ?? '未分类'; groups.set(c, [...(groups.get(c) ?? []), row]); }
  return [...groups].map(([category, list]) => {
    const values = list.filter(r => r.campaign.closed_at && Number.isFinite(r.campaign.final_realized_pnl)).map(r => r.campaign.final_realized_pnl!).sort((a, b) => a - b);
    const n = values.length, mid = n ? (n % 2 ? values[(n - 1) / 2] : (values[n / 2 - 1] + values[n / 2]) / 2) : null;
    return { category, detectors: list[0]?.campaign.comparison?.detectors.length ?? 0, total: list.length, closed: n,
      winRate: n ? values.filter(v => v > 0).length / n * 100 : null, mean: n ? values.reduce((a, b) => a + b, 0) / n : null, median: mid, worst: n ? values[0] : null };
  });
}
export function DetectCategoryStats({ rows, active, onSelect }: { rows: readonly Row[]; active: string; onSelect: (category: string) => void }) {
  const [sort, setSort] = useState<{ key: Key; asc: boolean }>({ key: 'total', asc: false });
  const stats = useMemo(() => {
    const list = detectCategoryStats(rows), dir = sort.asc ? 1 : -1;
    return list.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
      return (typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number)) * dir || b.total - a.total;
    });
  }, [rows, sort]);
  if (!stats.length) return null;
  return <div className="mb-3 overflow-x-auto rounded border border-border/60 bg-card" data-testid="detect-category-stats">
    <table className="w-full whitespace-nowrap text-left text-[11px]">
      <thead className="text-[10px] text-muted-foreground"><tr>{COLUMNS.map(([key, label]) => <th key={key} className="px-3 py-1.5 font-medium" aria-sort={sort.key === key ? sort.asc ? 'ascending' : 'descending' : 'none'}>
        <button type="button" className="hover:text-foreground" aria-label={`按${label}排序`} onClick={() => setSort(sort.key === key ? { key, asc: !sort.asc } : { key, asc: key === 'category' })}>{label}{sort.key === key ? sort.asc ? ' ↑' : ' ↓' : ''}</button>
      </th>)}</tr></thead>
      <tbody>{stats.map(s => <tr key={s.category} className={`border-t border-border/40 ${active === s.category ? 'bg-primary/5' : 'hover:bg-accent/40'}`}>
        <td className="px-3 py-1.5"><button type="button" className="text-left hover:text-primary" aria-pressed={active === s.category} title={active === s.category ? '再点一次显示全部类别' : '只看这个类别'} onClick={() => onSelect(active === s.category ? '' : s.category)}>{s.category}</button></td>
        <td className="px-3 py-1.5 font-mono tabular-nums">{s.detectors}</td><td className="px-3 py-1.5 font-mono tabular-nums">{s.total}</td><td className="px-3 py-1.5 font-mono tabular-nums">{s.closed}</td>
        <td className="px-3 py-1.5 font-mono tabular-nums">{s.winRate == null ? '—' : `${s.winRate.toFixed(1)}%`}</td>
        {(['mean', 'median', 'worst'] as const).map(k => <td key={k} className={`px-3 py-1.5 font-mono tabular-nums ${tone(s[k])}`}>{pct(s[k])}</td>)}
      </tr>)}</tbody>
    </table>
    <p className="border-t border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground">类别 = 这条信号命中的探测算法组合；收益为固定卖出方案下的已实现收益（未卖出的不计入分布）。</p>
  </div>;
}
