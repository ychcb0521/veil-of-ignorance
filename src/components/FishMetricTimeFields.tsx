import { useId, useMemo } from 'react';
import { AVG_HOURS_PRESETS, HALF_LIFE_PRESETS, avgHoursOf, halfLifeOf, intervalOf, type DeepDigFeatureDef } from '@/lib/deepDig/features';
import { additionMetricBaseDefinition, additionMetricTime, additionMetricTimeFields, metricIntervalOptions, type AdditionMetricTime } from '@/lib/fish/qualityAdditionMetric';
import type { FishSnapshot } from '@/lib/fish/algorithm';

const field = 'h-7 min-w-0 rounded border border-border/60 bg-background px-2 text-foreground';

export function FishMetricTimeFields({ label, metric, definition, snapshot, time: draftTime, onChange, disabled, className = '' }: {
  label: string;
  metric?: string;
  definition?: DeepDigFeatureDef;
  snapshot?: FishSnapshot;
  time?: AdditionMetricTime;
  onChange: (time: AdditionMetricTime) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const options = useMemo(() => {
    try {
      const base = snapshot ? additionMetricBaseDefinition(snapshot) : definition;
      if (!base || !metric) return;
      return { base, periods: metricIntervalOptions(base), hours: additionMetricTimeFields(base.formula, metric) };
    } catch {
      return;
    }
  }, [definition, snapshot, metric]);
  if (!options) return null;
  const { base, periods, hours } = options;
  const time = draftTime ?? (snapshot && additionMetricTime(snapshot));
  const interval = time?.interval ?? intervalOf(base);
  return <div className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}>
    <label className="inline-flex items-center gap-1">
      K 线周期
      <select aria-label={`${label} K 线周期`} className={field} disabled={disabled || periods.length < 2} value={interval}
        onChange={event => {
          const next = periods.find(period => period === event.target.value);
          if (next) {
            const updated = { ...time, interval: next };
            if (next === intervalOf(base)) delete updated.interval;
            onChange(updated);
          }
        }}>
        {!periods.includes(interval) && <option value={interval}>{interval}</option>}
        {periods.map(period => <option key={period} value={period}>{period}</option>)}
      </select>
    </label>
    {hours.map(key => {
      const name = key === 'window' ? '均值窗口' : key === 'avgh' ? '公式回看' : '半衰期';
      const value = time?.[key] ?? '';
      const set = (value: string) => {
        const next = { ...time };
        if (value === '') delete next[key];
        else next[key] = value;
        onChange(next);
      };
      const presetId = id + '-' + key;
      return <div key={key} className="inline-flex flex-wrap items-center gap-1">
        <label className="inline-flex items-center gap-1">
          {name}
          <input aria-label={`${label} ${name}（小时）`} type="number" inputMode="decimal" min="0" step="any" list={presetId}
            placeholder={key === 'window' ? '原公式' : String(key === 'hl' ? halfLifeOf(base) : avgHoursOf(base))}
            title="留空使用原公式参数" disabled={disabled} value={value} onChange={event => set(event.target.value)}
            className={field + ' w-24 font-mono tabular-nums'}/>
          小时
        </label>
        <datalist id={presetId}>{(key === 'hl' ? HALF_LIFE_PRESETS : AVG_HOURS_PRESETS).map(hours => <option key={hours} value={hours}/>)}</datalist>
        {key === 'window' && ['1', '24'].map(preset => <button key={preset} type="button" disabled={disabled}
          aria-label={`${label} ${name} ${preset} 小时`} aria-pressed={value !== '' && Number(value) === Number(preset)}
          onClick={() => set(preset)} className="h-6 rounded border border-border/60 px-1.5 hover:text-foreground aria-pressed:border-primary/50 aria-pressed:text-primary disabled:opacity-40">{preset}h</button>)}
      </div>;
    })}
  </div>;
}
