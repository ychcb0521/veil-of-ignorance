import { useMemo, useState } from 'react';
import { FishLibraryTimeDirectory, type FishDirectoryItem } from './FishLibraryTimeDirectory';
import { entryDirectoryGroups, entryDirectoryStudy } from '@/lib/fish/qualityLibraryDirectory';
import { screeningHitRateSamples } from '@/lib/fish/hitRate';
import type { LibraryDirectoryEdits } from '@/lib/fish/libraryDirectoryEdits';
import type { PreEntryLibrary, PreEntryRecord } from '@/lib/fish/preEntryMonitor';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';

export interface FishScreeningSampleSource {
  library: PreEntryLibrary;
  ready: boolean;
  error?: string;
  retry?: () => void;
}

const pageSize = 60;
const cellClass = 'px-2.5 py-1.5 text-left';

function ScreeningDirectoryRows({ records, selected, setSelected }: {
  records: readonly PreEntryRecord[];
  selected: ReadonlySet<string>;
  setSelected: (ids: readonly string[], checked: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const visible = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return records.filter(record => record.sample.source.symbol.toUpperCase().includes(needle))
      .sort((a, b) => b.sample.source.timeMs - a.sample.source.timeMs);
  }, [query, records]);
  const pages = Math.ceil(visible.length / pageSize);
  const current = Math.min(page, Math.max(0, pages - 1));
  const first = current * pageSize;
  const selectedCount = visible.filter(record => selected.has(record.id)).length;
  const allSelected = visible.length > 0 && selectedCount === visible.length;
  return <div className="space-y-2 p-3 text-[11px]">
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="筛选标的" placeholder="筛选标的…" value={query}
        onChange={event => { setQuery(event.target.value); setPage(0); }}
        className="h-7 min-w-0 flex-1 rounded-md border border-border/60 bg-muted/40 px-2"/>
      <label className="inline-flex items-center gap-1.5">
        <input type="checkbox" checked={allSelected} disabled={!visible.length}
          ref={node => { if (node) node.indeterminate = selectedCount > 0 && !allSelected; }}
          onChange={event => setSelected(visible.map(record => record.id), event.target.checked)}/>
        全选筛选结果（{visible.length}）
      </label>
    </div>
    <div className="max-h-64 overflow-auto rounded-md border border-border/60">
      <table aria-label="筛选库样本" className="w-full min-w-[29rem]">
        <thead className="sticky top-0 bg-muted"><tr>
          {['选择', '标的 / 市场', '信号时间', '首次满足时间'].map(label =>
            <th key={label} scope="col" className={`${cellClass} whitespace-nowrap font-medium`}>{label}</th>)}
        </tr></thead>
        <tbody>{visible.slice(first, first + pageSize).map(record => {
          const source = record.sample.source;
          const signalTime = formatUTC8(source.timeMs);
          return <tr key={record.id} className="border-t border-border/50 hover:bg-muted/25">
            <td className={cellClass}><input type="checkbox" aria-label={`选择 ${source.symbol} ${signalTime}`}
              checked={selected.has(record.id)} onChange={event => setSelected([record.id], event.target.checked)}/></td>
            <td className={cellClass}><span className="font-medium">{source.symbol}</span>
              <span className="ml-2 text-muted-foreground">{EXCHANGE_NAMES[source.exchange ?? 'binance']}{source.market === 'us_stock' ? ' · 美股合约' : ''}</span></td>
            <td className={`${cellClass} whitespace-nowrap font-mono`}>{signalTime}</td>
            <td className={`${cellClass} whitespace-nowrap font-mono text-muted-foreground`}>{record.matchedAt ? formatUTC8(record.matchedAt) : '—'}</td>
          </tr>;
        })}</tbody>
      </table>
      {!visible.length && <p className="p-3 text-muted-foreground">没有符合筛选的标的。</p>}
    </div>
    {pages > 1 && <div className="flex items-center justify-end gap-2 text-muted-foreground">
      <span className="tabular-nums">{first + 1}–{Math.min(first + pageSize, visible.length)} / {visible.length}</span>
      <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border px-2 py-1 disabled:opacity-40">上一页</button>
      <button type="button" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)} className="rounded border px-2 py-1 disabled:opacity-40">下一页</button>
    </div>}
  </div>;
}

export function FishScreeningSamplePicker({ screening, edits, selectedIds, onSelect }: {
  screening: FishScreeningSampleSource;
  edits: LibraryDirectoryEdits;
  selectedIds: readonly string[];
  onSelect: (ids: readonly string[]) => void;
}) {
  const [draft, setDraft] = useState<ReadonlySet<string>>(new Set());
  const { library, ready, error, retry } = screening;
  const groups = useMemo(() => entryDirectoryGroups(library), [library]);
  const items: FishDirectoryItem[] = groups.map(({ round, label, summary }) => ({
    id: round.id, at: round.startedAt, label, summary, study: () => entryDirectoryStudy(library, round),
  }));
  const byRound = useMemo(() => new Map(groups.map(({ round, records }) => [round.id,
    records.filter(record => Number.isFinite(record.sample.source.timeMs) && record.sample.source.timeMs > 0),
  ])), [groups]);
  const ids = useMemo(() => [...draft], [draft]);
  const sampleCount = useMemo(() => screeningHitRateSamples(library.records, ids, edits).length, [library.records, ids, edits]);
  function select(ids: readonly string[], checked: boolean) {
    setDraft(previous => {
      const next = new Set(previous);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }
  return <FishLibraryTimeDirectory name="筛选库" prefix="screening-test" description="展开入选轮次，勾选要测试的标的。测试窗口以信号时间为准。"
    info={<p>可从多轮勾选。相同市场、标的和信号时间只计一条样本。</p>}
    loading={!ready && !error} loadError={!ready ? error : undefined} onRetry={retry}
    items={items} edits={edits} recordCount={library.records.length} empty="暂无可选入选记录。"
    onOpenChange={open => { if (open) setDraft(new Set(selectedIds)); }}
    picker={{
      triggerLabel: '从筛选库选择标的',
      renderItem: item => <ScreeningDirectoryRows key={item.id} records={byRound.get(item.id) ?? []} selected={draft} setSelected={select}/>,
      footer: close => <>
        <span className="pl-1 text-muted-foreground">已选 {sampleCount} 条测试样本</span>
        <div className="flex gap-2">
          <button type="button" onClick={close} className="rounded-md border border-border/60 px-3 py-1.5 hover:bg-muted">取消</button>
          <button type="button" disabled={!ready || (!sampleCount && !selectedIds.length)} onClick={() => { onSelect(ids); close(); }}
            className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-40">
            {sampleCount ? '使用所选样本' : '清空测试样本'}
          </button>
        </div>
      </>,
    }}/>;
}
