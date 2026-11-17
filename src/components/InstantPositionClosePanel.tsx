import { useScreenedInstantPositions } from '@/contexts/FishQualityContext';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import type { PositionLimitMode } from '@/lib/positionLimitMode';
import { formatBeijingTime } from '@/lib/timeFormat';
import { InstantPositionRow } from './InstantPositionRow';

export function InstantPositionClosePanel({ positionId, onSelect, limitMode }: {
  positionId?: string;
  onSelect: (id: string) => void;
  limitMode: PositionLimitMode;
}) {
  const instant = useScreenedInstantPositions();
  const positions = instant?.positions ?? [];
  const selected = positionId === undefined && positions.length === 1
    ? positions[0] : positions.find(position => position.id === positionId);

  return <section aria-label="即时模拟仓位平仓" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
    {positions.length > 0 && <label className="block space-y-1 text-xs">
      <span className="font-medium">即时模拟仓位</span>
      <select aria-label="选择即时模拟仓位" className="h-9 w-full rounded border border-border bg-background px-2"
        value={selected?.id ?? ''} onChange={event => onSelect(event.target.value)}>
        <option value="" disabled>选择要平的仓位</option>
        {positions.map(position => <option key={position.id} value={position.id}>
          {position.source.symbol} · {EXCHANGE_NAMES[position.source.exchange ?? 'binance']} · {formatBeijingTime(position.buyAt)}
        </option>)}
      </select>
    </label>}
    {selected ? <InstantPositionRow key={selected.id} position={selected} sidebar limitMode={limitMode}
      monitor={instant?.monitorResults?.get(selected.recordId)} mirror={instant?.mirrorFills?.get(selected.recordId)}
      manual={instant?.manualPositions?.get(selected.recordId)} manage={instant?.manage}/>
      : <p role="status" className="text-xs text-muted-foreground">
        {positions.length === 0 ? '当前没有即时模拟持仓。普通回放仓位可在下方仓位表平仓。'
          : positionId === undefined ? '请选择要平的仓位。' : '所选仓位已退出，请重新选择。'}
      </p>}
  </section>;
}
