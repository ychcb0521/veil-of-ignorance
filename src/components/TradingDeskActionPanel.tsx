import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useScreenedInstantPositions } from '@/contexts/FishQualityContext';
import { usdtMirrorKey } from '@/lib/fish/usdtPositionMirror';
import type { PositionChartPreview } from './PositionMarketPreview';
import { UsdtLivePositionSidebar } from './UsdtLivePositionCard';

type DeskMode = 'live' | 'simulation';

export function TradingDeskActionPanel({ preview, replayActive, onManagePosition, onOpenChart, onClosePreview, children }: {
  preview: PositionChartPreview | null;
  replayActive: boolean;
  onManagePosition: (key: string | undefined) => void;
  onOpenChart: (symbol: string, livePositionKey: string) => void;
  onClosePreview: () => void;
  children: ReactNode;
}) {
  const instant = useScreenedInstantPositions();
  const follow = instant?.usdtFollow;
  const live = follow?.connected && follow.positionMirror === 1 ? instant?.usdtLive : undefined;
  const positions = live?.snapshot?.positions ?? [];
  const previewKey = preview?.livePositionKey;
  const hasLivePanel = !!live || !!previewKey;
  const scope = preview ?? replayActive;
  const [override, setOverride] = useState<{ scope: typeof scope; mode: DeskMode }>();
  const defaultMode = previewKey || (!preview && !replayActive && positions.length > 0) ? 'live' : 'simulation';
  const mode = hasLivePanel && (override?.scope === scope ? override.mode : defaultMode) === 'live' ? 'live' : 'simulation';
  const positionKey = previewKey ?? (positions.length === 1 ? usdtMirrorKey(positions[0]) : undefined);
  const selected = positions.find(position => usdtMirrorKey(position) === positionKey);

  // Only the panel which owns the selected position exposes its execution controls.
  const managedKey = mode === 'live' && selected ? positionKey : undefined;
  useLayoutEffect(() => {
    onManagePosition(managedKey);
    return () => onManagePosition(undefined);
  }, [managedKey, onManagePosition]);

  function selectSimulation() {
    setOverride({ scope: replayActive, mode: 'simulation' });
    if (preview) onClosePreview();
  }

  return <>
    {hasLivePanel && <div role="group" aria-label="右侧交易面板" className="grid shrink-0 grid-cols-2 gap-1 border-b border-border px-3 py-2 text-xs">
      <button type="button" aria-pressed={mode === 'live'} onClick={() => setOverride({ scope, mode: 'live' })}
        className={`rounded px-2 py-1.5 ${mode === 'live' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}>
        币安实盘
      </button>
      <button type="button" aria-pressed={mode === 'simulation'} onClick={selectSimulation}
        className={`rounded px-2 py-1.5 ${mode === 'simulation' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}>
        模拟交易
      </button>
    </div>}
    {mode === 'live' ? <div className="min-h-0 flex-1 overflow-y-auto scrollbar-pro">
      {positions.length > 1 && <div className="px-4 pt-3">
        <select aria-label="选择币安实盘仓位" value={selected ? positionKey : ''} onChange={event => {
          const key = event.target.value;
          const position = positions.find(row => usdtMirrorKey(row) === key);
          if (position) onOpenChart(position.symbol, key);
        }} className="h-8 w-full rounded border border-border bg-background px-2 text-xs">
          <option value="" disabled>选择币安实盘仓位</option>
          {positions.map(position => <option key={usdtMirrorKey(position)} value={usdtMirrorKey(position)}>
            {position.symbol} · {position.direction === 'long' ? '多仓' : '空仓'}
          </option>)}
        </select>
      </div>}
      {positionKey ? <UsdtLivePositionSidebar positionKey={positionKey}
        onOpenChart={!previewKey && selected ? () => onOpenChart(selected.symbol, positionKey) : undefined} />
        : <p role="status" className="p-4 text-xs text-muted-foreground">
          {positions.length > 1 ? '请选择要管理的仓位。' : live?.issue ?? '当前没有币安实盘持仓。'}
        </p>}
    </div> : children}
  </>;
}
