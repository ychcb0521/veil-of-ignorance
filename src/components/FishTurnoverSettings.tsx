import { useState, type FormEvent } from 'react';
import { FishCheck } from './FishAlgorithmCard';
import { validateFishTurnoverSettings, type FishTurnoverSettings } from '@/lib/fish/turnoverSettings';

const inputClass = 'h-8 min-w-0 w-full rounded-md border border-border/70 bg-background px-2.5 font-mono tabular-nums text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

export function FishTurnoverSettingsFields({ value, onChange }: {
  value: FishTurnoverSettings;
  onChange: (next: FishTurnoverSettings) => void;
}) {
  return <div className="space-y-2">
    <label className="flex items-center gap-2">
      <FishCheck checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked })}/>启用成交额过滤
    </label>
    <div className="grid gap-2 min-[450px]:grid-cols-3">
      {value.floors.map((floor, index) => <label key={floor.hours} className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] items-center gap-2 min-[450px]:grid-cols-1 min-[450px]:gap-1">
        <span className="whitespace-nowrap text-muted-foreground">{floor.hours} 小时</span>
        <input aria-label={`${floor.hours} 小时成交额（USDT）`} type="number" inputMode="decimal" step="any" disabled={!value.enabled} value={Number.isFinite(floor.min) ? floor.min : ''}
          className={inputClass} onChange={event => {
            const min = event.target.valueAsNumber;
            onChange({ ...value, floors: value.floors.map((item, at) => at === index ? { ...item, min } : item) });
          }}/>
      </label>)}
    </div>
    <p className="leading-relaxed text-muted-foreground">扫描截止前和信号起点前各检查一次，每次三项均须达标。</p>
  </div>;
}

export function FishCaptureTurnoverSettings({ value, locked, onSave }: {
  value: FishTurnoverSettings;
  locked: boolean;
  onSave: (value: FishTurnoverSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || saving) return;
    setSaving(true);
    setError('');
    try { await onSave(validateFishTurnoverSettings(draft)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '成交额设置保存失败'); }
    finally { setSaving(false); }
  }
  return <form noValidate onSubmit={save} className="space-y-2">
    <fieldset disabled={locked || saving} className="space-y-2">
      <legend className="mb-2 font-medium">成交额门槛 <span className="font-normal text-muted-foreground">（USDT）</span></legend>
      <FishTurnoverSettingsFields value={draft} onChange={setDraft}/>
    </fieldset>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex justify-end">
      <button type="submit" disabled={locked || saving} className="h-7 rounded-md bg-primary px-2.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
        {saving ? '保存中…' : '保存成交额设置'}
      </button>
    </div>
  </form>;
}
