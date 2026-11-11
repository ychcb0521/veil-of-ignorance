import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { FishAlgorithmCard } from './FishAlgorithmCard';
import { FishTurnoverSettingsFields } from './FishTurnoverSettings';
import type { DeepDigFeatureDef } from '@/lib/deepDig/features';
import { FishNumberField, FishScanScopeFields, FishScanWickFields } from './FishScanSettingsFields';
import { buildFishHitRateSettings, newHitRatePreference, readFishHitRateSettings, type FishHitRateSettings } from '@/lib/fish/hitRateSettings';
import { FISH_MAX_ALGORITHMS } from '@/lib/fish/shared';

export function FishHitRateSettingsForm({ initial, defs, copyCapture, capture = false, locked = false, onSave, onCancel }: {
  initial: FishHitRateSettings;
  defs: DeepDigFeatureDef[];
  copyCapture?: () => FishHitRateSettings;
  capture?: boolean;
  locked?: boolean;
  onSave: (value: FishHitRateSettings) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || saving) return;
    setError('');
    try {
      buildFishHitRateSettings(draft, defs);
      const valid = readFishHitRateSettings(draft);
      if (!valid) throw new Error('测试设置不完整，请检查输入');
      setSaving(true);
      await onSave(valid);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '设置保存失败'); }
    finally { setSaving(false); }
  }

  return <form noValidate onSubmit={save} className="space-y-4">
    <fieldset disabled={saving} className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 font-medium">算法组合
          <select className="h-7 rounded-md border border-border/60 bg-muted/40 px-2 text-foreground" value={draft.combination}
            onChange={event => setDraft({ ...draft, combination: event.target.value as 'and' | 'or' })}>
            <option value="and">交集</option><option value="or">并集</option>
          </select>
        </label>
        {copyCapture && <button type="button" className="rounded-md border border-border/70 px-2 py-1 hover:bg-muted"
          onClick={() => { setDraft({ ...copyCapture(), window: draft.window }); setError(''); }}>复制当前捕捞条件</button>}
      </div>
      <div className="min-w-0 divide-y divide-border/50 rounded-lg border border-border/60">
        {draft.cards.map((card, index) => <FishAlgorithmCard key={card.id} card={card} defs={defs} index={index + 1} locked={false}
          initialPreference={newHitRatePreference} canDelete={draft.cards.length > 1}
          onChange={next => setDraft(current => ({ ...current, cards: current.cards.map((item, at) => at === index ? next : item) }))}
          onDelete={() => setDraft(current => ({ ...current, cards: current.cards.filter(item => item.id !== card.id) }))}/>)}
        <button type="button" disabled={!defs.length || draft.cards.length >= FISH_MAX_ALGORITHMS}
          className="inline-flex items-center gap-1 px-2 py-1.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
          onClick={() => setDraft(current => ({ ...current, cards: [...current.cards, {
            id: crypto.randomUUID(), featureId: defs[0].id, enabled: true, pref: newHitRatePreference(defs[0].id),
          }] }))}><Plus aria-hidden className="h-3 w-3"/>{capture ? '新增捕捞算法' : '新增测试算法'}</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="min-w-0 rounded-md border border-border/60 px-3 pb-3">
          <legend className="px-1 font-medium">{capture ? '扫描覆盖时间' : '测试窗口'}</legend>
          {capture ? <FishNumberField label="扫描覆盖时间（小时）" value={draft.window.beforeHours + draft.window.afterHours}
            onChange={beforeHours => setDraft({ ...draft, window: { beforeHours, afterHours: 0 } })}/>
            : <div className="grid grid-cols-2 gap-2">
            <FishNumberField label="样本前（小时）" value={draft.window.beforeHours}
              onChange={beforeHours => setDraft({ ...draft, window: { ...draft.window, beforeHours } })}/>
            <FishNumberField label="样本后（小时）" value={draft.window.afterHours}
              onChange={afterHours => setDraft({ ...draft, window: { ...draft.window, afterHours } })}/>
          </div>}
        </fieldset>
        <fieldset className="min-w-0 rounded-md border border-border/60 px-3 pb-3">
          <legend className="px-1 font-medium">{capture ? '来源市场' : '全市场测试范围'}</legend>
          <FishScanScopeFields value={draft.selection} onChange={selection => setDraft({ ...draft, selection })}/>
        </fieldset>
      </div>
      <fieldset className="space-y-2 rounded-md border border-border/60 px-3 pb-3">
        <legend className="px-1 font-medium">插针过滤</legend>
        <FishScanWickFields value={draft.downwardWick} onChange={downwardWick => setDraft({ ...draft, downwardWick })}/>
      </fieldset>
      <fieldset className="rounded-md border border-border/60 px-3 pb-3">
        <legend className="px-1 font-medium">成交额门槛 <span className="font-normal text-muted-foreground">（USDT）</span></legend>
        <FishTurnoverSettingsFields value={draft.turnover} onChange={turnover => setDraft({ ...draft, turnover })}/>
      </fieldset>
    </fieldset>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {locked && !saving && <p role="status" className="text-muted-foreground">当前任务结束后可以保存设置。</p>}
    <div className="sticky bottom-0 flex justify-end gap-2 bg-background py-2">
      <button type="button" disabled={saving} className="rounded-md border border-border/60 px-3 py-1.5 hover:bg-muted disabled:opacity-40" onClick={onCancel}>取消</button>
      <button type="submit" disabled={locked || saving} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-40">
        {saving ? '保存中…' : capture ? '保存捕捞设置' : '保存测试设置'}
      </button>
    </div>
  </form>;
}
