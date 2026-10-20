import type { SignalSortKey } from '@/lib/signalLibrary';

export const SIGNAL_LIBRARY_GRID = 'grid grid-cols-[minmax(0,148px)_minmax(0,128px)_minmax(0,160px)_36px_74px_minmax(0,1fr)_20px_20px_20px] items-center gap-2';

export const SIGNAL_LIBRARY_MATCH_GRID = 'grid grid-cols-[minmax(0,148px)_minmax(0,128px)_minmax(0,160px)_36px_74px_minmax(200px,1fr)_20px_20px_20px] items-center gap-2';

/** Shared column widths and sort controls for the main library and 鱼. */
export function SignalLibraryHeader({ sortKey, sortDir, onSort, showMatch = false, showProcess = false, algorithmSort }: {
  /** 「渔」的鱼：兜底区换成可排序的「算法类型」。 */
  algorithmSort?: { active: boolean; onClick: () => void };
  showMatch?: boolean;
  /** 「渔」的鱼：这一列标「捕捞过程」。 */
  showProcess?: boolean;
  sortKey: SignalSortKey; sortDir: 'asc' | 'desc'; onSort: (key: SignalSortKey) => void;
}) {
  return <div data-testid="signal-library-header" className={`${showMatch ? SIGNAL_LIBRARY_MATCH_GRID : SIGNAL_LIBRARY_GRID} border-b border-border/60 bg-muted/40 px-2 py-1 text-[9px] leading-3 font-medium text-muted-foreground`}>
    <span className="grid grid-cols-[12px_minmax(0,1fr)] items-center gap-1">
      <span aria-hidden />
      <SortHeader label="标的" active={sortKey === 'symbol'} dir={sortDir} onClick={() => onSort('symbol')} />
    </span>
    <SortHeader label="信号时间" active={sortKey === 'time'} dir={sortDir} onClick={() => onSort('time')} />
    {algorithmSort ? <SortHeader label="算法类型" active={algorithmSort.active} dir={sortDir} onClick={algorithmSort.onClick} /> : <span>兜底区</span>}
    <span>市场</span>
    <SortHeader label="评分" active={sortKey === 'quality'} dir={sortDir} onClick={() => onSort('quality')} />
    {showMatch ? <span>匹配</span> : showProcess ? <span>捕捞过程</span> : <span aria-hidden />}<span aria-hidden /><span aria-hidden /><span aria-hidden />
  </div>;
}

/**
 * 可点排序的表头。箭头只在当前排序列上出现——每列都挂一个箭头会让人以为
 * 三列各自独立排序，而这里同一时刻只有一个排序键。
 */
function SortHeader({
  label, active, dir, onClick,
}: { label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`signal-sort-${label}`}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={`按${label}排序${active ? '（再点一次反向）' : ''}`}
      className={`flex items-center gap-0.5 text-left transition-colors hover:text-foreground ${
        active ? 'text-foreground' : ''
      }`}
    >
      <span>{label}</span>
      <span className="w-2 shrink-0 leading-none" aria-hidden>{active ? (dir === 'asc' ? '↑' : '↓') : ''}</span>
    </button>
  );
}
