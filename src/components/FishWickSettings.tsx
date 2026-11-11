import { useId, useState, type FormEvent } from 'react';
import { FishCheck } from './FishAlgorithmCard';
import { FishCaptureTurnoverSettings } from './FishTurnoverSettings';
import type { FishTurnoverSettings } from '@/lib/fish/turnoverSettings';
import { fishWickWindowBars, MAX_FISH_WICK_HOURS, validateFishDownwardWick, type FishDownwardWick } from '@/lib/fish/downwardWick';

interface FishWickSettingsProps {
  value: FishDownwardWick;
  locked: boolean;
  onSave: (value: FishDownwardWick) => Promise<void>;
  turnover: FishTurnoverSettings;
  onSaveTurnover: (value: FishTurnoverSettings) => Promise<void>;
}

const inputClass = 'h-8 w-full rounded-md border border-border/70 bg-background px-2.5 font-mono tabular-nums text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60';

export function FishWickSettings({ value, locked, onSave, turnover, onSaveTurnover }: FishWickSettingsProps) {
  const durationId = useId();
  const minutes = Math.round(value.hours * 60);
  const useMinutes = !Number.isInteger(value.hours) && Math.abs(value.hours * 60 - minutes) < 1e-9;
  const [enabled, setEnabled] = useState(value.enabled);
  const [duration, setDuration] = useState(String(useMinutes ? minutes : value.hours));
  const [unit, setUnit] = useState<'hour' | 'minute'>(useMinutes ? 'minute' : 'hour');
  const [multiple, setMultiple] = useState(String(value.atrMultiple));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hours = Number(duration) / (unit === 'hour' ? 1 : 60);
  const barCount = fishWickWindowBars(hours);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || saving) return;
    setSaving(true);
    setError('');
    try {
      const next = validateFishDownwardWick({ enabled, hours, atrMultiple: Number(multiple) });
      await onSave(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '插针设置保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 text-[11px]">
      <form noValidate onSubmit={save} className="space-y-3">
        <fieldset disabled={locked || saving} className="space-y-2.5">
          <label className="flex items-center gap-2">
            <FishCheck checked={enabled} onChange={event => setEnabled(event.target.checked)} />
            过滤向下大插针
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <label className="text-muted-foreground" htmlFor={durationId}>回看时长</label>
              <div className="flex gap-1.5">
                <input id={durationId} className={`min-w-0 ${inputClass}`} type="number" step="any" inputMode="decimal" value={duration} onChange={event => setDuration(event.target.value)} />
                <select aria-label="回看时长单位" className="h-8 shrink-0 rounded-md border border-border/70 bg-background px-1 text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={unit} onChange={event => setUnit(event.target.value === 'minute' ? 'minute' : 'hour')}>
                  <option value="hour">小时</option>
                  <option value="minute">分钟</option>
                </select>
              </div>
            </div>
            <label className="space-y-1">
              <span className="text-muted-foreground">插针幅度（ATR 倍数）</span>
              <input className={inputClass} type="number" step="any" inputMode="decimal" value={multiple} onChange={event => setMultiple(event.target.value)} />
            </label>
          </div>
          <p className="leading-relaxed text-muted-foreground">
            回看 5 分钟至 {MAX_FISH_WICK_HOURS} 小时，按完整的已收盘 5 分钟 K 线取样。
            {barCount >= 1 && hours <= MAX_FISH_WICK_HOURS && <span className="ml-1 tabular-nums">当前填写 {barCount} 根。</span>}
          </p>
          <p className="leading-relaxed text-muted-foreground">开盘价减最低价（含实体和下影）大于前 14 根的平均真实波幅 × 所设倍数，整只标的跳过。</p>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground">{locked ? '本轮进行中，结束后可修改。' : '单独保存，下一轮生效。'}</p>
          <button type="submit" disabled={locked || saving} className="h-7 rounded-md bg-primary px-2.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {saving ? '保存中…' : '保存插针设置'}
          </button>
        </div>
        {error && <p role="alert" className="leading-relaxed text-destructive">{error}</p>}
      </form>
      <div className="space-y-1.5 border-t border-border/60 pt-3">
        <FishCaptureTurnoverSettings value={turnover} locked={locked} onSave={onSaveTurnover}/>
      </div>
    </div>
  );
}
