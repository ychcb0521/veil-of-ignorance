import {FishQualityTemplateArchive} from './FishQualityTemplateArchive';
import { FishQualityAdvantageSettings } from './FishQualityAdvantageSettings';
import { withQualityAdvantageOptions, type QualityAdvantageOptions } from '@/lib/fish/qualityAdvantage';
import {validateQualityVetoStages} from '@/lib/fish/qualityVetoStages';
import {validateQualitySellStages} from '@/lib/fish/qualitySellStages';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookmarkPlus, Copy, LayoutTemplate, Plus, Trash2, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { qualityPlanFromTemplate, qualityPlanTemplateSummary, type QualityPlanTemplate } from '@/lib/fish/qualityPlanTemplates';
import { BUILTIN_QUALITY_TEMPLATES, type QualityBuiltinTemplate } from '@/lib/fish/qualityBuiltinTemplates';
import { planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { PlanVersionList } from '@/components/FishQualityPlanVersions';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { makeQualitySellPlan, newQualitySellPlanId } from '@/lib/fish/qualitySellPlans';
import { qualityFilterChoices } from '@/lib/fish/qualityFilters';
import type { QualityGroup } from '@/lib/fish/quality';
import { isLegacyQualityPlan, LEGACY_ENGINE_LABEL, legacyToEditablePlan } from '@/lib/fish/qualityLegacyEngine';

const field = 'h-7 min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
interface Draft {
  advantageOptions?: QualityAdvantageOptions;
  id: string; original?: QualityGroup; label: string; choice: string; direction: '<' | '>'; threshold: string;
  combo: boolean; afterChoice: string; afterDirection: '<' | '>'; afterThreshold: string; switchPct: string;
}
const draftOf = (plan: QualityGroup): Draft => ({ id: plan.id, original: plan, label: plan.label, advantageOptions: plan.advantage ? { screenWeak:plan.advantage.screenWeak,beforeFirst:plan.advantage.beforeFirst,afterAddition:plan.advantage.afterAddition,confirmations:plan.advantage.confirmations } : undefined,
  choice: plan.snapshot.featureId + ':' + plan.metric, direction: plan.rule?.direction ?? plan.snapshot.direction ?? '<',
  threshold: plan.rule ? String(plan.rule.threshold) : '', combo: !!plan.combo,
  afterChoice: plan.combo ? plan.combo.after.snapshot.featureId + ':' + plan.combo.after.metric : 'state:state',
  afterDirection: plan.combo?.after.rule.direction ?? '<', afterThreshold: plan.combo ? String(plan.combo.after.rule.threshold) : '', switchPct: String(plan.combo?.switchPct ?? 5.1) });

export interface SellPlansDraftView { plans: QualityGroup[]; dirty: boolean; algorithmsDirty: boolean; error: string; build: (after?: (plans: QualityGroup[]) => QualityGroup[]) => QualityGroup[]; save: (after?: (plans: QualityGroup[]) => QualityGroup[]) => boolean }
/** 【用户要求】2026-11-02 模板：方案卡片「存为模板」、顶部「从模板新建」；模板保存的是已保存的整套设置。 */
export interface PlanTemplateActions { owner?:string;restore?:(t:QualityPlanTemplate)=>void; templates: readonly (QualityPlanTemplate & { plan: QualityGroup })[]; save: (planId: string, name: string) => void; remove: (id: string) => void }
function SaveTemplateButton({ index, defaultName, disabledReason, onSave }: { index: number; defaultName: string; disabledReason?: string; onSave: (name: string) => void }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(defaultName), [error, setError] = useState('');
  const submit = () => { try { onSave(name); setOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); } };
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) { setName(defaultName); setError(''); } }}><PopoverTrigger asChild>
    <button type="button" disabled={!!disabledReason} aria-label={'把卖出算法 ' + (index + 1) + ' 存为模板'} title={disabledReason ?? '存为模板：保存整套方案（组合算法、半仓镜像、加仓细节、硬性终止等全部参数），以后可一键新建'} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><BookmarkPlus className="h-3.5 w-3.5"/></button>
  </PopoverTrigger><PopoverContent align="end" className="w-72 space-y-2 p-3 text-[11px]">
    <p className="font-medium">存为模板</p>
    <input aria-label="模板名称" autoFocus className={field + ' w-full'} value={name} onChange={e => { setName(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') submit(); }}/>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" className="rounded px-2 py-1 text-muted-foreground hover:bg-muted" onClick={() => setOpen(false)}>取消</button>
      <button type="button" className="rounded bg-primary px-2 py-1 text-primary-foreground" onClick={submit}>保存模板</button></div>
  </PopoverContent></Popover>;
}
function TemplatePicker({ actions, plans, disabled, onUse, onUseBuiltin }: { actions: PlanTemplateActions; plans: readonly QualityGroup[]; disabled: boolean; onUse: (template: PlanTemplateActions['templates'][number]) => void; onUseBuiltin: (template: QualityBuiltinTemplate, base?:QualityGroup) => void }) {
  const [open, setOpen] = useState(false), [confirm, setConfirm] = useState(''), [versionsOf, setVersionsOf] = useState('');
  const bases = [...plans.map(p=>({key:'plan:'+p.id,label:'方案 · '+p.label,plan:p})), ...actions.templates.map(t=>({key:'template:'+t.id,label:'模板 · '+t.name,plan:t.plan}))].filter(x=>x.plan.addition?.enabled||x.plan.router);
  const [baseKey,setBaseKey] = useState('');
  const base = bases.find(b=>b.key===baseKey) ?? (bases.length===1?bases[0]:undefined);
  const date = (t: number) => new Date(t + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  return <Popover open={open} onOpenChange={next => { setOpen(next); setConfirm(''); setVersionsOf(''); }}><PopoverTrigger asChild>
    <button type="button" disabled={disabled} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40" title={actions.templates.length ? `已有 ${actions.templates.length} 个模板` : '还没有模板：在方案卡片右上角点「存为模板」'}><LayoutTemplate className="h-3 w-3"/>从模板新建{actions.templates.length > 0 && <span className="rounded bg-primary/15 px-1 text-[9px] tabular-nums text-primary">{actions.templates.length}</span>}</button>
  </PopoverTrigger><PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-1 text-[11px]" data-testid="plan-template-list">
    {/* 【用户要求】2026-11-04 内置模板：代码里的配方，新建时按账号当前公式生成，保存时冻结版本；不占账号模板目录 */}
    {BUILTIN_QUALITY_TEMPLATES.length > 0 && <div className="mb-1 border-b border-border/60 pb-1" data-testid="plan-template-builtins">
      <p className="px-2 pb-0.5 pt-1 text-[10px] text-muted-foreground">内置模板 · 新建时按账号当前公式生成，保存时冻结版本</p>
      <ul>{BUILTIN_QUALITY_TEMPLATES.map(t => <li key={t.id} className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/60" data-testid="plan-template-builtin">
        <div className="min-w-0 flex-1"><p className="font-medium">{t.name}</p><p className="text-[10px] leading-snug text-muted-foreground">{t.summary}</p>
          {t.requiresBase&&<label className="mt-2 block">沿用原方案<select aria-label="优势模板沿用原方案" value={base?.key??''} onChange={e=>setBaseKey(e.target.value)} className="mt-1 w-full rounded border bg-background p-1"><option value="">选择原方案或账号模板</option>{bases.map(b=><option key={b.key} value={b.key}>{b.label}</option>)}</select></label>}
        </div>
        <button type="button" disabled={disabled||t.requiresBase&&!base} className="shrink-0 rounded border border-primary/25 bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/20 disabled:opacity-40" aria-label={`用内置模板 ${t.name} 新建方案`} onClick={() => { onUseBuiltin(t,t.requiresBase?base?.plan:undefined); setOpen(false); }}>新建</button>
      </li>)}</ul>
    </div>}
    {!actions.templates.length ? <p className="px-3 py-3 text-muted-foreground">还没有模板。在方案卡片右上角点「存为模板」即可保存整套设置。</p>
      : <ul className="max-h-80 overflow-y-auto">{actions.templates.map(t => <li key={t.id} className="group flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/60" data-testid="plan-template-item">
        <div className="min-w-0 flex-1"><p className="truncate font-medium">{t.name}</p><p className="truncate text-[10px] text-muted-foreground" title={qualityPlanTemplateSummary(t.plan)}>{qualityPlanTemplateSummary(t.plan)}</p><p className="text-[9.5px] text-muted-foreground/70 tabular-nums">保存于 {date(t.savedAt)} · <button type="button" className={`underline-offset-2 hover:underline ${planVersionChanges(t.plan).length ? 'text-destructive' : 'text-primary/80'}`} aria-expanded={versionsOf === t.id} aria-label={`模板 ${t.name} 的算法版本`} onClick={() => setVersionsOf(versionsOf === t.id ? '' : t.id)}>{planVersionChanges(t.plan).length ? '版本已变' : '版本'} {versionsOf === t.id ? '▴' : '▾'}</button></p>
          {versionsOf === t.id && <div className="mt-1.5 rounded border border-border/60 bg-background p-1.5"><PlanVersionList plan={t.plan}/></div>}</div>
        <button type="button" disabled={planVersionChanges(t.plan).length > 0} title={planVersionChanges(t.plan).length ? '模板冻结的算法版本与当前代码不同，不能新建（展开「版本已变」看哪一项）' : undefined} className="shrink-0 rounded border border-primary/25 bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/20 disabled:opacity-40" aria-label={`用模板 ${t.name} 新建方案`} onClick={() => { onUse(t); setOpen(false); }}>新建</button>
        {confirm === t.id
          ? <button type="button" className="shrink-0 rounded bg-destructive/10 px-2 py-0.5 text-destructive" aria-label={`确认删除模板 ${t.name}`} onClick={() => { actions.remove(t.id); setConfirm(''); }}>确认删除</button>
          : <button type="button" className="shrink-0 rounded p-1 text-muted-foreground/50 hover:text-destructive" aria-label={`删除模板 ${t.name}`} onClick={() => setConfirm(t.id)}><Trash2 className="h-3 w-3"/></button>}
      </li>)}</ul>}
    <FishQualityTemplateArchive owner={actions.owner} restore={actions.restore}/>
  </PopoverContent></Popover>;
}
export function FishQualitySellPlansEditor({ plans, ready, onSave, prepare, extraDirty = false, renderHolding, onSelectPlan, onCopyPlan, templates, readOnly = false, embedded = false, onDirtyChange }: {
  plans: readonly QualityGroup[]; ready: boolean; onSave: (plans: QualityGroup[]) => void;
  onCopyPlan?: (source: QualityGroup, copy: QualityGroup) => void;
  templates?: PlanTemplateActions;
  /** 只读展示（交易战役里查看当时冻结的设置）：不显示新增 / 复制 / 删除 / 保存，输入全部禁用。 */
  readOnly?: boolean;
  /** A branch is one editable plan; its parent owns save, copy and run actions. */
  embedded?: boolean; onDirtyChange?: (dirty: boolean) => void;
  onSelectPlan?: (id: string) => void; prepare?: (plans: QualityGroup[]) => QualityGroup[]; extraDirty?: boolean; renderHolding?: (view: SellPlansDraftView) => ReactNode;
}) {
  const definitions = useFeatureDefinitions();
  const choices = useMemo(() => qualityFilterChoices(definitions), [definitions]);
  const [drafts, setDrafts] = useState(() => plans.map(draftOf)), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!dirty) setDrafts(plans.map(draftOf)); }, [plans, dirty]);
  useEffect(() => { onDirtyChange?.(dirty || extraDirty); }, [dirty, extraDirty, onDirtyChange]);
  const change = (next: Draft[]) => { setDrafts(next); setDirty(true); setError(''); };
  const patch = (id: string, next: Partial<Draft>) => { onSelectPlan?.(id); change(drafts.map(d => d.id === id ? { ...d, ...next } : d)); };
  const number = (value: string, optional = false) => {
    if (!value.trim() && optional) return undefined;
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error('门槛和切换涨幅须填写有限数字');
    return Number(value);
  };
  const baseOf = (d: Draft) => plans.find(p => p.id === d.id) ?? d.original;
  const algorithmFields = (d: Draft) => JSON.stringify([d.choice,d.direction,d.threshold,d.combo,...(d.combo?[d.afterChoice,d.afterDirection,d.afterThreshold,d.switchPct]:[])]);
  const labelOf = (d: Draft, base?: QualityGroup) => d.original && d.label === d.original.label ? base?.label ?? d.label : d.label.trim() || choices.find(c=>c.key===d.choice)?.label || base?.label || '新卖出算法';
  const duplicate = (source: Draft, index: number) => {
    const base = structuredClone(baseOf(source)!);
    const rootLabel = labelOf(source, base).replace(/（副本(?: \d+)?）$/, '').trim() || '卖出算法';
    const labels = new Set(drafts.map(d => labelOf(d, baseOf(d))));
    let label = `${rootLabel}（副本）`, suffix = 2;
    while (labels.has(label)) label = `${rootLabel}（副本 ${suffix++}）`;
    const copyBase = {...base, id: newQualitySellPlanId(), label};
    // Keep raw, possibly incomplete inputs editable; validation still belongs to Save.
    const copy: Draft = {...structuredClone(source), id: copyBase.id, label, original: copyBase};
    try { onCopyPlan?.({...base, id: source.id}, copyBase); } catch (cause) { setError(cause instanceof Error ? cause.message : '请先修正方案参数'); return; }
    change([...drafts.slice(0, index + 1), copy, ...drafts.slice(index + 1)]);
    onSelectPlan?.(copy.id);
  };
  /** 旧引擎方案复制成当前引擎可编辑的 S/T/K 方案（原方案保留）。不沿用原方案的监测草稿：草稿按新方案自己生成。 */
  const editableCopy = (source: Draft, index: number) => {
    const base = legacyToEditablePlan(baseOf(source)!), copyBase = { ...base, id: newQualitySellPlanId(), label: uniqueLabel(`${labelOf(source, baseOf(source))}（可编辑）`) };
    change([...drafts.slice(0, index + 1), draftOf(copyBase), ...drafts.slice(index + 1)]);
    onSelectPlan?.(copyBase.id);
  };
  const uniqueLabel = (root: string) => { const labels = new Set(drafts.map(d => labelOf(d, baseOf(d)))); let label = root, n = 2; while (labels.has(label)) label = `${root}（${n++}）`; return label; };
  const fromTemplate = (template: PlanTemplateActions['templates'][number]) => {
    const copyBase = qualityPlanFromTemplate(template, newQualitySellPlanId(), uniqueLabel(template.name));
    onCopyPlan?.({ ...template.plan, id: `template:${template.id}` }, copyBase);
    change([...drafts, draftOf(copyBase)]);
    onSelectPlan?.(copyBase.id);
  };
  /** 内置模板：按账号当前公式生成方案，之后与「从模板新建」同一条路（复制监测草稿、加入列表、保存时冻结版本）。 */
  const fromBuiltin = (template: QualityBuiltinTemplate, base?:QualityGroup) => {
    let copyBase: QualityGroup;
    try { copyBase = template.build(definitions, newQualitySellPlanId(), uniqueLabel(template.name),base); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '内置模板生成失败'); return; }
    onCopyPlan?.({ ...copyBase, id: `builtin:${template.id}` }, copyBase);
    change([...drafts, draftOf(copyBase)]);
    onSelectPlan?.(copyBase.id);
  };
  const build = (after?: (plans: QualityGroup[]) => QualityGroup[]) => {
      const next = drafts.map(d => {
        const base = baseOf(d);
        if(base?.router)return {...base,id:d.id,label:labelOf(d,base)};
        // 旧引擎方案只改名称，其余原样保存
        if (base && isLegacyQualityPlan(base)) return { ...structuredClone(base), label: labelOf(d,base) };
        if (base && d.original && algorithmFields(d) === algorithmFields(draftOf(d.original))) return { ...structuredClone(base), label: labelOf(d,base) };
        const ordinaryUnchanged=!!(base&&d.original&&algorithmFields(d)===algorithmFields(draftOf(d.original)));
        const plan = ordinaryUnchanged?structuredClone(base!):makeQualitySellPlan(d.choice, d.direction, number(d.threshold, true), definitions, baseOf(d), d.id);
        plan.label = d.label.trim() || plan.label;
        if (embedded && base && d.choice === draftOf(base).choice) { plan.snapshot = structuredClone(base.snapshot); plan.definitionSource = base.definitionSource; }
        if (!ordinaryUnchanged&&d.combo) {
          const after = makeQualitySellPlan(d.afterChoice, d.afterDirection, number(d.afterThreshold), definitions);
          if (embedded && base?.combo && d.afterChoice === draftOf(base).afterChoice) after.snapshot = structuredClone(base.combo.after.snapshot);
          const switchPct = number(d.switchPct)!;
          if (!(switchPct > 0)) throw new Error('分段切换涨幅须大于 0');
          plan.combo = { switchPct, beforeLabel: choices.find(c => c.key === d.choice)?.label ?? plan.label,
            after: { label: after.label, metric: after.metric, snapshot: after.snapshot, rule: after.rule! } };
        } else if(!ordinaryUnchanged)delete plan.combo;
        // 按加仓次数改用的卖出算法在「加仓细节 · 卖出」里逐次设置（monitor 草稿写入 sellStages），这里保持原值。

        return plan;
      });
      const withAdvantage = next.map(p=>withQualityAdvantageOptions(p,drafts.find(d=>d.id===p.id)?.advantageOptions));
      const prepared = (prepare ? prepare(withAdvantage) : withAdvantage).map(p=>withQualityAdvantageOptions(p,drafts.find(d=>d.id===p.id)?.advantageOptions));
      const saved=after?after(prepared):prepared;
      saved.forEach(p=>{validateQualitySellStages(p);validateQualityVetoStages(p);});
      return saved;
  };
  const apply = (after?: (plans: QualityGroup[]) => QualityGroup[]) => {
    try {
      onSave(build(after)); setDirty(false); setError(''); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '卖出算法设置无效'); return false; }
  };
  // Keep router editor keys stable while global overlay controls are edited; apply to both branches at save.
  const preview = drafts.map(d => ({ ...baseOf(d)!, id: d.id, label: labelOf(d,baseOf(d)), ...(baseOf(d)?.advantage&&d.advantageOptions?{advantage:{...baseOf(d)!.advantage!,...d.advantageOptions}}:{}) }));
  const select = (value: string, label: string, onChange: (value: string) => void) => {
    const featureId = choices.find(c => c.key === value)?.featureId ?? value.split(':')[0];
    const features = [...new Map(choices.map(c => [c.featureId, c.group])).entries()];
    return <div className="grid min-w-0 gap-1.5 sm:grid-cols-2">
      <select aria-label={label + ' 特征值'} className={field + ' w-full'} value={featureId} onChange={e => onChange(choices.find(c => c.featureId === e.target.value)!.key)}>
        {!features.some(([id]) => id === featureId) && <option value={featureId}>原指标已变更</option>}
        {features.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <select aria-label={label} className={field + ' w-full'} value={value} onChange={e => onChange(e.target.value)}>
        {!choices.some(c => c.key === value) && <option value={value}>请选择变量</option>}
        {choices.filter(c => c.featureId === featureId).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
    </div>;
  };
  return <><fieldset disabled={readOnly} className="contents"><section className="mb-3 space-y-2 border-b border-border/60 pb-3" data-testid={embedded ? "quality-branch-sell-plans-editor" : "quality-sell-plans-editor"}>
    <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-medium">{renderHolding ? '① 组合算法' : '卖出算法'} <span className="text-muted-foreground" data-testid={embedded ? "branch-sell-plan-draft-count" : "sell-plan-draft-count"}>{drafts.length} 套</span></h4>
      {!readOnly && !embedded && <><button type="button" disabled={!ready || !choices.length} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40" onClick={() => { const original = makeQualitySellPlan(choices[0].key, '<', undefined, definitions, undefined, newQualitySellPlanId()); change([...drafts, { ...draftOf(original), label: '', afterChoice: choices[0].key }]); onSelectPlan?.(original.id); }}><Plus className="h-3 w-3" />新增卖出算法</button>{templates && <TemplatePicker actions={templates} plans={plans} disabled={!ready} onUse={fromTemplate} onUseBuiltin={fromBuiltin}/>}</>}</div>
    {!readOnly && !embedded && <p className="text-[10.5px] leading-relaxed text-muted-foreground">每套方案独立监测，可选特征值、公式变量、方向和门槛。下方监测方案随增删、改名即时对应；保存后更新表格；全部调整完成后点击「开始监测」运行已勾选信号，历史轮次保留。</p>}
    {!drafts.length && <p className="rounded border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">暂无卖出算法，点击上方新增。</p>}
    {drafts.map((d, i) => <div key={d.id} data-plan-id={d.id} onFocusCapture={e => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) onSelectPlan?.(d.id); }} className="space-y-1.5 rounded-md border border-border/60 p-2" data-testid={'sell-plan-draft-' + i}>
      <div className="flex items-center gap-1.5"><span className="text-[10px] tabular-nums text-muted-foreground">{i + 1}.</span><input aria-label={'卖出算法 ' + (i + 1) + ' 名称'} className={field + ' flex-1'} placeholder="名称（可选）" value={d.label} onChange={e => patch(d.id, { label: e.target.value })} />
        {/* 【用户要求】2026-11-03 旧引擎方案只读（除名称）：改了参数就不是原来那套了 */}
        {isLegacyQualityPlan(baseOf(d)) && <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300" title="按 10-31 的引擎原样复算；除名称外不能修改" data-testid={'sell-plan-legacy-' + i}>{LEGACY_ENGINE_LABEL} · 只读</span>}
        {!readOnly && !embedded && isLegacyQualityPlan(baseOf(d)) && <button type="button" disabled={!ready} className="shrink-0 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/20 disabled:opacity-40" title="复制成当前引擎的「指标 · S / T / K」方案，可以改参数；入场距离沿用原值、涨幅门槛按持仓均价。原方案保留。" aria-label={'转为可编辑 ' + (i + 1)} onClick={() => editableCopy(d, i)}>转为可编辑</button>}
        <select aria-label={'卖出算法 ' + (i + 1) + ' 类型'} disabled={isLegacyQualityPlan(baseOf(d)) || !!baseOf(d)?.router} className={field} value={d.combo ? 'combo' : 'single'} onChange={e => patch(d.id, { combo: e.target.value === 'combo' })}><option value="single">单一算法</option><option value="combo">分段组合</option></select>
        {!readOnly && !embedded && templates && <SaveTemplateButton index={i} defaultName={labelOf(d, baseOf(d))} disabledReason={!ready ? '尚未加载完成' : !plans.some(p => p.id === d.id) ? '新方案先点「保存全部方案」，再存为模板' : dirty || extraDirty ? '有未保存的修改：先点「保存全部方案」，模板保存的是已保存的设置' : undefined} onSave={name => templates.save(d.id, name)}/>}
        {!readOnly && !embedded && <><button type="button" disabled={!ready} aria-label={'复制卖出算法 ' + (i + 1)} title="复制整套方案：含当前填写的组合算法、加仓、镜像止盈和一票条件" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={() => duplicate(d, i)}><Copy className="h-3.5 w-3.5" /></button>
        <button type="button" aria-label={'删除卖出算法 ' + (i + 1)} className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => change(drafts.filter(x => x.id !== d.id))}><X className="h-3.5 w-3.5" /></button></>}</div>
      {baseOf(d)?.router ? <p className="text-[10.5px] text-muted-foreground">条件分支方案：在下方修改两个分支的卖出、镜像、加仓与止损设置。</p> : <fieldset disabled={isLegacyQualityPlan(baseOf(d))} className="contents"><div className="grid grid-cols-[minmax(0,1fr)_3rem_5rem] gap-1.5">
        {select(d.choice, '卖出算法 ' + (i + 1) + ' 指标', choice => patch(d.id, { choice }))}
        <select aria-label={'卖出算法 ' + (i + 1) + ' 方向'} className={field} value={d.direction} onChange={e => patch(d.id, { direction: e.target.value as '<' | '>' })}><option value="<">&lt;</option><option value=">">&gt;</option></select>
        <input aria-label={'卖出算法 ' + (i + 1) + ' 门槛'} className={field + ' w-full'} type="number" step="any" placeholder="未设置" value={d.threshold} onChange={e => patch(d.id, { threshold: e.target.value })} />
      </div>
      {d.combo && <div className="space-y-1.5 border-t border-border/40 pt-1.5"><label className="flex items-center gap-1 text-[11px] text-muted-foreground">相对买入价上涨<input aria-label={'卖出算法 ' + (i + 1) + ' 切换涨幅'} type="number" step="any" className={field + ' w-20'} value={d.switchPct} onChange={e => patch(d.id, { switchPct: e.target.value })} />% 后切换为</label>
        <div className="grid grid-cols-[minmax(0,1fr)_3rem_5rem] gap-1.5">{select(d.afterChoice, '卖出算法 ' + (i + 1) + ' 后段指标', afterChoice => patch(d.id, { afterChoice }))}
          <select aria-label={'卖出算法 ' + (i + 1) + ' 后段方向'} className={field} value={d.afterDirection} onChange={e => patch(d.id, { afterDirection: e.target.value as '<' | '>' })}><option value="<">&lt;</option><option value=">">&gt;</option></select>
          <input aria-label={'卖出算法 ' + (i + 1) + ' 后段门槛'} type="number" step="any" className={field + ' w-full'} value={d.afterThreshold} onChange={e => patch(d.id, { afterThreshold: e.target.value })} />
        </div></div>}</fieldset>}
      {!embedded && baseOf(d)?.advantage && <FishQualityAdvantageSettings rule={{...baseOf(d)!.advantage!,...d.advantageOptions}} onChange={readOnly?undefined:options=>patch(d.id,{advantageOptions:options})}/>}
    </div>)}
    {!readOnly && !embedded && <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={!ready || !(dirty || extraDirty)} onClick={() => apply()} className="h-7 rounded-md border border-primary/30 bg-primary/10 px-2.5 text-[11px] text-primary disabled:opacity-40">{renderHolding ? '保存全部方案' : '保存卖出算法'}</button>
      <span className="text-[10px] text-muted-foreground">未填普通门槛时，可单独使用该方案的加仓、镜像止盈或持仓否决。</span></div>}
    {error && !renderHolding && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </section></fieldset>{renderHolding?.({ plans: preview, dirty: dirty || extraDirty, algorithmsDirty: dirty, error, build, save: apply })}</>;
}
