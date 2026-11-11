import { useId, useState, type FormEvent } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { FishPopoverContent } from './FishPopoverContent';
import { FishCheck } from './FishAlgorithmCard';
import { FishTurnoverThresholds } from './FishTurnoverThresholds';
import { fishWickDuration, fishWickWindowBars, MAX_FISH_WICK_HOURS, validateFishDownwardWick, type FishDownwardWick } from '@/lib/fish/downwardWick';

interface FishWickSettingsProps {
  value: FishDownwardWick;
  locked: boolean;
  onSave: (value: FishDownwardWick) => Promise<void>;
}

const inputClass = 'h-8 w-full rounded-md border border-border/70 bg-background px-2.5 font-mono tabular-nums text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60';

export function FishWickSettings({ value, locked, onSave }: FishWickSettingsProps) {
  const durationId = useId();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(value.enabled);
  const [duration, setDuration] = useState(String(value.hours));
  const [unit, setUnit] = useState<'hour' | 'minute'>('hour');
  const [multiple, setMultiple] = useState(String(value.atrMultiple));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hours = Number(duration) / (unit === 'hour' ? 1 : 60);
  const barCount = fishWickWindowBars(hours);

  function changeOpen(next: boolean) {
    if (!next && saving) return;
    if (next) {
      setEnabled(value.enabled);
      const minutes = Math.round(value.hours * 60);
      const useMinutes = !Number.isInteger(value.hours) && Math.abs(value.hours * 60 - minutes) < 1e-9;
      setDuration(String(useMinutes ? minutes : value.hours));
      setUnit(useMinutes ? 'minute' : 'hour');
      setMultiple(String(value.atrMultiple));
      setError('');
    }
    setOpen(next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || saving) return;
    setSaving(true);
    setError('');
    try {
      const next = validateFishDownwardWick({ enabled, hours, atrMultiple: Number(multiple) });
      await onSave(next);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '插针设置保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={value.enabled ? `已开启 · 回看 ${fishWickDuration(value.hours)} · 大于 ${value.atrMultiple} 倍 ATR` : '插针过滤已关闭'}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <SlidersHorizontal aria-hidden className="h-3 w-3" />
          插针回看设置
        </button>
      </PopoverTrigger>
      <FishPopoverContent align="start" sideOffset={5} aria-label="插针回看设置" className="w-96 space-y-3 p-4 text-[11px]">
        <form noValidate onSubmit={save} className="space-y-3">
          <fieldset disabled={locked || saving} className="space-y-2.5">
            <legend className="mb-2 text-xs font-medium text-foreground">插针回看设置</legend>
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
          <h3 className="font-medium text-foreground">成交额门槛</h3>
          <FishTurnoverThresholds />
        </div>
      </FishPopoverContent>
    </Popover>
  );
}
