import { FishCheck } from './FishAlgorithmCard';
import { AUDITED_EXCHANGES, EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import type { FishDownwardWick } from '@/lib/fish/downwardWick';
import type { FishScanSelection } from '@/lib/fish/scanPlan';

const fieldClass = 'h-8 min-w-0 w-full rounded-md border border-border/70 bg-background px-2.5 font-mono tabular-nums text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

export function FishNumberField({ label, value, onChange, disabled }: {
  label: string; value: number; onChange: (value: number) => void; disabled?: boolean;
}) {
  return <label className="min-w-0 space-y-1">
    <span className="block text-muted-foreground">{label}</span>
    <input className={fieldClass} type="number" step="any" inputMode="decimal" disabled={disabled}
      value={Number.isFinite(value) ? value : ''} onChange={event => onChange(event.target.valueAsNumber)}/>
  </label>;
}

export function FishScanScopeFields({ value, onChange }: {
  value: FishScanSelection; onChange: (value: FishScanSelection) => void;
}) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {AUDITED_EXCHANGES.map(exchange => <label className="inline-flex items-center gap-1.5" key={exchange}>
            <FishCheck checked={value.exchanges.includes(exchange)}
              onChange={event => onChange({ ...value, exchanges: AUDITED_EXCHANGES.filter(item =>
                item === exchange ? event.target.checked : value.exchanges.includes(item)) })}/>{EXCHANGE_NAMES[exchange]}
          </label>)}
          <label className="inline-flex items-center gap-1.5"><FishCheck checked={!!value.includeUsStocks}
            onChange={event => onChange({ ...value, includeUsStocks: event.target.checked })}/>美股合约</label>
          <label className="inline-flex items-center gap-1.5"><FishCheck checked={value.includeDuplicates}
            onChange={event => onChange({ ...value, includeDuplicates: event.target.checked })}/>含跨所重复标的</label>
  </div>;
}

export function FishScanWickFields({ value, onChange }: {
  value: FishDownwardWick; onChange: (value: FishDownwardWick) => void;
}) {
  return <>
      <label className="flex items-center gap-2"><FishCheck checked={value.enabled}
        onChange={event => onChange({ ...value, enabled: event.target.checked })}/>过滤向下大插针</label>
      <div className="grid grid-cols-2 gap-2">
        <FishNumberField label="插针回看（小时）" value={value.hours} disabled={!value.enabled}
          onChange={hours => onChange({ ...value, hours })}/>
        <FishNumberField label="插针幅度（ATR 倍数）" value={value.atrMultiple} disabled={!value.enabled}
          onChange={atrMultiple => onChange({ ...value, atrMultiple })}/>
      </div>
  </>;
}
