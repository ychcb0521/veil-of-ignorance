import { useState, type FormEvent, type ReactNode } from 'react';
import { FISH_AUTO_INTERVALS, fishAutoIntervalLabel, type FishAutoSchedule } from '@/lib/fish/autoScan';
import { FishCheck } from './FishAlgorithmCard';

const fieldClass = 'h-8 w-full rounded-md border border-border/70 bg-background px-2.5 text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60';

function SettingsForm({ children, locked, onSave, label }: {
  children: ReactNode;
  locked?: boolean;
  onSave: () => void | Promise<void>;
  label: string;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || locked) return;
    setError('');
    setSaving(true);
    try { await onSave(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试'); }
    finally { setSaving(false); }
  }

  return <form noValidate onSubmit={submit} className="space-y-3">
    <fieldset disabled={locked || saving} className="space-y-2.5">{children}</fieldset>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {locked && <p className="text-muted-foreground">本轮进行中，结束后可修改。</p>}
    <div className="flex justify-end">
      <button type="submit" disabled={locked || saving} className="h-7 rounded-md bg-primary px-2.5 font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
        {saving ? '保存中…' : label}
      </button>
    </div>
  </form>;
}

export function FishCaptureTimeSettings({ value, duration, locked, onSave }: {
  value: string; duration: string; locked: boolean; onSave: (time: string, hours: string) => Promise<void>;
}) {
  const [time, setTime] = useState(value);
  const [hours, setHours] = useState(duration);
  return <SettingsForm label="应用时间设置" locked={locked} onSave={() => onSave(time.trim(), hours)}>
    <label className="block space-y-1">
      <span>手动捕捞截止时间（UTC+8）</span>
      <input autoComplete="off" spellCheck={false} className={`${fieldClass} font-mono`} placeholder="YYYY-MM-DD HH:mm:ss" value={time} onChange={event => setTime(event.target.value)} />
    </label>
    <label className="block space-y-1">
      <span>扫描过去（小时）</span>
      <input type="number" min="0.01" max="8784" step="any" className={`${fieldClass} font-mono`} value={hours} onChange={event => setHours(event.target.value)} />
    </label>
    <p className="text-muted-foreground">截止时间留空即用当前时间。自动捕捞始终从当前时间往回扫描。</p>
  </SettingsForm>;
}

export function FishCaptureOpenSettings({ value, onSave }: { value: boolean; onSave: (expanded: boolean) => void }) {
  const [expanded, setExpanded] = useState(value);
  return <SettingsForm label="保存打开设置" onSave={() => onSave(expanded)}>
    <label className="flex items-center gap-2">
      <FishCheck checked={expanded} onChange={event => setExpanded(event.target.checked)} />
      进入「渔」时默认展开捕捞
    </label>
    <p className="text-muted-foreground">保存在此浏览器，可随时点「捕捞」标题展开或折叠。</p>
  </SettingsForm>;
}

export function FishCaptureFrequencySettings({ value, onSave }: {
  value: FishAutoSchedule; onSave: (schedule: FishAutoSchedule) => void;
}) {
  const [mode, setMode] = useState(value.mode);
  const [hours, setHours] = useState(value.hours);
  return <SettingsForm label="保存扫描频率" onSave={() => onSave({ mode, hours })}>
    <label className="block space-y-1">
      <span>扫描模式</span>
      <select className={fieldClass} value={mode} onChange={event => setMode(event.target.value === 'auto' ? 'auto' : 'manual')}>
        <option value="manual">手动</option>
        <option value="auto">自动</option>
      </select>
    </label>
    <label className="block space-y-1">
      <span>自动扫描间隔</span>
      <select className={fieldClass} disabled={mode === 'manual'} value={hours} onChange={event => setHours(Number(event.target.value))}>
        {FISH_AUTO_INTERVALS.map(interval => <option key={interval} value={interval}>{fishAutoIntervalLabel(interval)}</option>)}
      </select>
    </label>
    <p className="text-muted-foreground">保存在此浏览器。切到自动时，空闲且联网就会开始捕捞。</p>
  </SettingsForm>;
}
