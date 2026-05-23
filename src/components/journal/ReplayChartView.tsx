import { useMemo, useState } from 'react';
import { useReplay } from '@/contexts/ReplayContext';
import { useReplayKlines } from '@/hooks/useReplayKlines';
import { intervalToMs } from '@/hooks/useBinanceData';
import { ReplayCandleChart, type ChartMarker, type PriceLine, type VerticalLine } from './ReplayCandleChart';
import { ReplayTimelineScrubber } from './ReplayTimelineScrubber';
import { Button } from '@/components/ui/button';

const INTERVALS = ['1m', '5m', '15m', '1h'] as const;
type Interval = (typeof INTERVALS)[number];

export function ReplayChartView() {
  const { journal, tradeRecord, tEntry, tExit, tStart, tEnd, replayTime, jumpTo, selectedBranchId } = useReplay();
  const [interval, setInterval] = useState<Interval>('1m');

  const fetchFrom = useMemo(() => tStart - 6 * 60 * 60_000, [tStart]);
  const fetchTo = useMemo(() => tEnd + 2 * 60 * 60_000, [tEnd]);
  const { klines, loading, error, reload } = useReplayKlines(journal.symbol, fetchFrom, fetchTo, interval);

  const selectedBranch = useMemo(
    () => (journal.counterfactual_branches ?? []).find(b => b.id === selectedBranchId) ?? null,
    [journal.counterfactual_branches, selectedBranchId],
  );

  const markers: ChartMarker[] = useMemo(() => {
    const out: ChartMarker[] = [];
    if (journal.pre_entry_price != null) {
      const dir = journal.direction;
      out.push({
        time: tEntry,
        price: journal.pre_entry_price,
        shape: dir === 'long' ? 'triangle-up' : dir === 'short' ? 'triangle-down' : 'circle',
        color: dir === 'long' ? '#0ECB81' : dir === 'short' ? '#F6465D' : '#F0B90B',
        label: `ENTRY ${journal.pre_entry_price}`,
      });
    }
    if (tradeRecord && tExit != null) {
      const winColor = (journal.post_outcome === 'win') ? '#0ECB81' : '#F6465D';
      out.push({
        time: tExit,
        price: tradeRecord.exitPrice,
        shape: 'square',
        color: winColor,
        label: `EXIT ${tradeRecord.exitPrice.toFixed(2)}  P&L ${(journal.post_realized_pnl ?? tradeRecord.pnl).toFixed(2)}`,
      });
    }
    if (selectedBranch) {
      const p = selectedBranch.params;
      const r = selectedBranch.result;
      if (p.entry_price != null) {
        out.push({
          time: new Date(p.entry_time).getTime(),
          price: p.entry_price,
          shape: p.direction === 'short' ? 'triangle-down' : 'triangle-up',
          color: '#B080FF',
          label: `CF ${selectedBranch.label}`,
        });
      }
      if (r.exit_price != null && r.exit_time) {
        out.push({
          time: new Date(r.exit_time).getTime(),
          price: r.exit_price,
          shape: 'square',
          color: '#B080FF',
          label: `CF EXIT ${r.exit_reason}`,
        });
      }
    }
    return out;
  }, [journal, tradeRecord, tEntry, tExit, selectedBranch]);

  const inWindow = tExit == null
    ? replayTime >= tEntry
    : replayTime >= tEntry && replayTime <= tExit;
  const priceLines: PriceLine[] = useMemo(() => {
    const out: PriceLine[] = [];
    if (journal.pre_planned_stop_loss != null) {
      out.push({ price: journal.pre_planned_stop_loss, color: '#F6465D', title: 'SL', dim: !inWindow });
    }
    if (journal.pre_planned_take_profit != null) {
      out.push({ price: journal.pre_planned_take_profit, color: '#0ECB81', title: 'TP', dim: !inWindow });
    }
    if (selectedBranch) {
      const p = selectedBranch.params;
      if (p.stop_loss != null) out.push({ price: p.stop_loss, color: '#B080FF', title: 'CF·SL' });
      p.take_profits.forEach((tp, i) => {
        out.push({ price: tp.price, color: '#B080FF', title: `CF·TP${i + 1}` });
      });
    }
    return out;
  }, [journal, inWindow, selectedBranch]);

  const verticalLines: VerticalLine[] = useMemo(() => {
    const out: VerticalLine[] = [
      { time: tEntry, color: 'rgba(14, 203, 129, 0.6)', width: 1, z: 1 },
    ];
    if (tExit != null) out.push({ time: tExit, color: 'rgba(246, 70, 93, 0.6)', width: 1, z: 1 });
    if (selectedBranch) {
      out.push({ time: new Date(selectedBranch.params.entry_time).getTime(), color: 'rgba(176,128,255,0.6)', width: 1, z: 2 });
      if (selectedBranch.result.exit_time) {
        out.push({ time: new Date(selectedBranch.result.exit_time).getTime(), color: 'rgba(176,128,255,0.6)', width: 1, z: 2 });
      }
    }
    return out;
  }, [tEntry, tExit, selectedBranch]);

  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <div className="h-9 px-2 bg-card border border-border rounded flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-full bg-muted text-[10px] font-mono flex items-center justify-center">①</span>
          <span className="text-[12px] font-medium">盘面</span>
        </div>

        <div className="flex items-center gap-1">
          {INTERVALS.map(i => (
            <button key={i} onClick={() => setInterval(i)}
              className={`h-6 px-2 rounded text-[10px] font-mono ${interval === i ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground hover:bg-[#363c45]'}`}>
              {i}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button disabled
            className="h-6 px-2 rounded text-[10px] font-mono bg-muted text-muted-foreground opacity-50 cursor-not-allowed"
            title="批次 5 暂不支持深度图">深度图</button>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <button onClick={() => jumpTo(tEntry)}
            className="h-7 px-2 rounded text-[10px] font-medium bg-[#0ECB81]/20 text-[#0ECB81] hover:bg-[#0ECB81]/30">
            → 决策时刻
          </button>
          <button onClick={() => tExit != null && jumpTo(tExit)} disabled={tExit == null}
            className="h-7 px-2 rounded text-[10px] font-medium bg-[#F6465D]/20 text-[#F6465D] hover:bg-[#F6465D]/30 disabled:opacity-40 disabled:cursor-not-allowed">
            → 出场时刻
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-background border border-border rounded overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs font-mono">
            加载 K 线…
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="text-[#F6465D] text-xs">{error}</div>
            <Button size="sm" variant="outline" onClick={reload}>重试</Button>
          </div>
        )}
        {!loading && !error && (
          <ReplayCandleChart
            klines={klines}
            currentTime={replayTime}
            intervalMs={intervalToMs(interval)}
            markers={markers}
            priceLines={priceLines}
            verticalLines={verticalLines}
          />
        )}
      </div>

      <ReplayTimelineScrubber />
    </div>
  );
}
