/**
 * 进场时的谢林偏离：战役封面一行小字、战役详情一块面板。
 * 【用户要求】2026-10-15 能看到每一场战役在进场时的具体数值；名字和数字挨着、左对齐紧凑。2026-10-16 信号库不显示。
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBeijingTime } from '@/lib/timeFormat';
import {
  ENTRY_SNAPSHOT_HALF_LIFE_H, ENTRY_SNAPSHOT_MIN_COVERAGE, formatEntryDeviation, formatEntryPrice, type EntrySnapshot,
} from '@/lib/deepRsa/entrySnapshot';
import { useEntrySnapshot, type EntrySnapshotState } from '@/hooks/useEntrySnapshot';

export const ENTRY_SCHELLING_CAVEAT = '只描述进场时的盘面：第 6 步检验里它主要预示之后的波动幅度，没有验证出方向，不是交易信号。';

/** 元素进入视野（含上下 300px 预读）才为 true；没有 IntersectionObserver（测试环境）时恒为 false。 */
function useInView<T extends Element>(ref: RefObject<T>): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(entries => setInView(entries.some(e => e.isIntersecting)), { rootMargin: '300px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

export function entrySnapshotTitle(snapshot: EntrySnapshot, opts: { anchorLabel: string }): string {
  const parts = [
    `${opts.anchorLabel} ${formatBeijingTime(snapshot.anchorMs).slice(0, 16)}，进场前最后收盘价 ${formatEntryPrice(snapshot.close)}`,
    `偏离 12h VWAP ${formatEntryDeviation(snapshot.vwapDev)}（VWAP ${formatEntryPrice(snapshot.vwap)}）`,
    `偏离成交密集区 POC ${formatEntryDeviation(snapshot.pocDev)}（POC ${formatEntryPrice(snapshot.poc)}，半衰期 ${ENTRY_SNAPSHOT_HALF_LIFE_H} 小时）`,
  ];
  if (snapshot.coverage < ENTRY_SNAPSHOT_MIN_COVERAGE) parts.push(`观察窗 K 线覆盖率 ${(snapshot.coverage * 100).toFixed(0)}%，低于 95%，读数仅供参考`);
  parts.push('正 = 现价在参考价上方。数据：进场前 48 小时的币安 5m K 线，算法同 Deep RSA');
  parts.push(ENTRY_SCHELLING_CAVEAT);
  return parts.join('\n');
}

const stateText = (state: EntrySnapshotState) => (state.status === 'loading' || state.status === 'idle' ? '…' : '—');

/** 战役封面：标题行「操作时间」之后的一段「进场 VWAP +5.7% · POC +1.6%」。进入视野才去取。 */
export function EntrySchellingInline({ symbol, anchorMs }: { symbol: string; anchorMs: number | null }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref);
  const state = useEntrySnapshot(symbol, anchorMs, inView);
  if (anchorMs == null) return null;
  const snap = state.status === 'ready' ? state.snapshot : null;
  const lowCoverage = snap != null && snap.coverage < ENTRY_SNAPSHOT_MIN_COVERAGE;
  const title = snap
    ? entrySnapshotTitle(snap, { anchorLabel: '进场（首次主力开仓）' })
    : state.status === 'unavailable' || state.status === 'error'
      ? `进场时的谢林偏离：${state.reason}`
      : '进场时的谢林偏离：读取中（进场前 48 小时的币安 5m K 线）';
  const value = (ln: number | null | undefined) => (
    <span className={cn('font-mono tabular-nums', snap ? 'text-foreground/80' : 'text-muted-foreground/60')}>{snap ? formatEntryDeviation(ln) : stateText(state)}</span>
  );
  return (
    <span
      ref={ref}
      data-testid="campaign-entry-schelling"
      data-status={state.status}
      title={title}
      className="-ml-px inline-flex h-[18px] items-center border-l border-border/70 pl-0.5 text-[10px] leading-none"
    >
      <span className={cn('inline-flex h-[18px] items-center gap-1 whitespace-nowrap px-1.5 text-muted-foreground/75', lowCoverage && 'opacity-60')}>
        进场 VWAP {value(snap?.vwapDev)}
        <span className="text-muted-foreground/40">·</span>
        POC {value(snap?.pocDev)}
      </span>
    </span>
  );
}

/** 战役详情：一块紧凑面板，参考价、偏离、时间与覆盖率都写出来，便于在 TradingView 上核对。 */
export function EntrySchellingPanel({ symbol, anchorMs }: { symbol: string; anchorMs: number | null }) {
  const state = useEntrySnapshot(symbol, anchorMs, true);
  const snap = state.status === 'ready' ? state.snapshot : null;
  return (
    <section data-testid="campaign-entry-schelling-panel" className="border border-border bg-card px-4 py-2.5 text-[11px]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-[12px] font-medium">进场时的谢林偏离</h2>
        {anchorMs == null ? (
          <span className="text-muted-foreground">这场战役还没有成交的主力开仓，没有进场时点</span>
        ) : snap ? (
          <span className="text-muted-foreground">
            t₀ <span className="font-mono tabular-nums">{formatBeijingTime(anchorMs).slice(0, 16)}</span>（首次主力开仓）
            {' · '}进场前收盘 <span className="font-mono tabular-nums text-foreground/85">{formatEntryPrice(snap.close)}</span>
            {' · '}K 线覆盖率 <span className={cn('font-mono tabular-nums', snap.coverage < ENTRY_SNAPSHOT_MIN_COVERAGE ? 'text-[#C99400]' : 'text-foreground/85')}>{(snap.coverage * 100).toFixed(0)}%</span>
          </span>
        ) : state.status === 'unavailable' || state.status === 'error' ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            {state.reason}
            {state.status === 'error' && (
              <button type="button" onClick={state.retry} className="inline-flex items-center gap-0.5 hover:text-foreground">
                <RotateCcw className="h-3 w-3" />重试
              </button>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">读取进场前 48 小时的币安 5m K 线…</span>
        )}
      </div>
      {snap && (
        <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1">
          <span data-testid="entry-schelling-vwap">
            偏离 12h VWAP <span className="font-mono tabular-nums font-medium text-foreground">{formatEntryDeviation(snap.vwapDev)}</span>
            <span className="ml-1.5 text-muted-foreground">VWAP <span className="font-mono tabular-nums">{formatEntryPrice(snap.vwap)}</span></span>
          </span>
          <span data-testid="entry-schelling-poc">
            偏离成交密集区 POC <span className="font-mono tabular-nums font-medium text-foreground">{formatEntryDeviation(snap.pocDev)}</span>
            <span className="ml-1.5 text-muted-foreground">POC <span className="font-mono tabular-nums">{formatEntryPrice(snap.poc)}</span> · 半衰期 {ENTRY_SNAPSHOT_HALF_LIFE_H} 小时</span>
          </span>
        </div>
      )}
      {anchorMs != null && <div className="mt-1 text-[10px] text-muted-foreground/80">正 = 现价在参考价上方。{ENTRY_SCHELLING_CAVEAT}</div>}
    </section>
  );
}
