import { createTuringQualityPlan } from '@/lib/fish/qualityTuringPlan';
import { splitQualityBranches } from '@/lib/fish/qualitySplitBranches';
import {FishQualitySavedPlanRecovery} from './FishQualitySavedPlanRecovery';
import type {RecoverableQualityPlan} from '@/lib/fish/qualitySavedPlans';
import {FishQualityTemplateArchive} from './FishQualityTemplateArchive';
import { FishQualityAdvantageSettings } from './FishQualityAdvantageSettings';
import { withQualityAdvantageOptions, type QualityAdvantageOptions } from '@/lib/fish/qualityAdvantage';
import {validateQualityVetoStages} from '@/lib/fish/qualityVetoStages';
import {validateQualitySellStages} from '@/lib/fish/qualitySellStages';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookmarkPlus, Copy, LayoutTemplate, Plus, Trash2, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { qualityPlanFromTemplate, qualityPlanTemplateSummary, type QualityPlanTemplate } from '@/lib/fish/qualityPlanTemplates';
import { BUILTIN_QUALITY_TEMPLATES, type QualityBuiltinTemplate } from '@/lib/fish/qualityBuiltinTemplates';
import { freezeSavedPlans,planVersionChanges } from '@/lib/fish/qualityPlanVersions';
import { PlanVersionList } from '@/components/FishQualityPlanVersions';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { makeQualitySellPlan, newQualitySellPlanId } from '@/lib/fish/qualitySellPlans';
import { DEFAULT_STATIC_DRAWDOWN_SELL_PCT, STATIC_DRAWDOWN_SELL_CHOICE, STATIC_DRAWDOWN_SELL_LABEL, STATIC_DRAWDOWN_SELL_VERSION } from '@/lib/fish/qualityStaticDrawdownSell';
import { qualityFilterDefinitions, qualityFilterMenuChoices } from '@/lib/fish/qualityFilters';
import { additionMetricTime, withMetricSnapshotTime, type AdditionMetricTime } from '@/lib/fish/qualityAdditionMetric';
import { FishMetricTimeFields } from './FishMetricTimeFields';
import type { QualityGroup } from '@/lib/fish/quality';
import { isLegacyQualityPlan, LEGACY_ENGINE_LABEL, legacyToEditablePlan } from '@/lib/fish/qualityLegacyEngine';

const field = 'h-7 min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
interface Draft {
  advantageOptions?: QualityAdvantageOptions;
  id: string; original?: QualityGroup; label: string; choice: string; direction: '<' | '>' | '>='; threshold: string;
  combo: boolean; afterChoice: string; afterDirection: '<' | '>' | '>='; afterThreshold: string; switchPct: string;
  time?: AdditionMetricTime; afterTime?: AdditionMetricTime;
}
const draftOf = (plan: QualityGroup): Draft => ({ id: plan.id, original: plan, label: plan.label, advantageOptions: plan.advantage ? { screenWeak:plan.advantage.screenWeak,beforeFirst:plan.advantage.beforeFirst,afterAddition:plan.advantage.afterAddition,confirmations:plan.advantage.confirmations } : undefined,
  choice: plan.snapshot.featureId + ':' + plan.metric, direction: plan.rule?.direction ?? plan.snapshot.direction ?? '<',
  time: additionMetricTime(plan.snapshot),
  threshold: plan.rule ? String(plan.rule.threshold) : '', combo: !!plan.combo,
  afterChoice: plan.combo ? plan.combo.after.snapshot.featureId + ':' + plan.combo.after.metric : 'state:state',
  afterTime: plan.combo && additionMetricTime(plan.combo.after.snapshot),
  afterDirection: plan.combo?.after.rule.direction ?? '<', afterThreshold: plan.combo ? String(plan.combo.after.rule.threshold) : '', switchPct: String(plan.combo?.switchPct ?? 5.1) });

export interface SellPlansDraftView { plans: QualityGroup[]; dirty: boolean; algorithmsDirty: boolean; error: string; build: (after?: (plans: QualityGroup[]) => QualityGroup[]) => QualityGroup[]; save: (after?: (plans: QualityGroup[]) => QualityGroup[]) => boolean }
/** 【用户要求】2026-11-02 模板：方案卡片「存为模板」、顶部「从模板新建」；模板保存的是已保存的整套设置。 */
export interface PlanTemplateActions { owner?:string;restore?:(t:QualityPlanTemplate)=>void | Promise<void>; templates: readonly (QualityPlanTemplate & { plan: QualityGroup })[]; save: (planId: string, name: string) => void; remove: (id: string) => void }
export function SaveTemplateButton({ index, defaultName, disabledReason, onSave,ariaLabel }: { index: number; defaultName: string; disabledReason?: string; onSave: (name: string) => void;ariaLabel?:string }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(defaultName), [error, setError] = useState('');
  const submit = () => { try { onSave(name); setOpen(false); } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); } };
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) { setName(defaultName); setError(''); } }}><PopoverTrigger asChild>
    <button type="button" disabled={!!disabledReason} aria-label={ariaLabel??'把卖出算法 ' + (index + 1) + ' 存为模板'} title={disabledReason ?? '存为模板：保存整套方案（组合算法、镜像平衡减仓、加仓细节、硬性终止等全部参数），以后可一键新建'} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><BookmarkPlus className="h-3.5 w-3.5"/></button>
  </PopoverTrigger><PopoverContent align="end" className="w-72 space-y-2 p-3 text-[11px]">
    <p className="font-medium">存为模板</p>
    <input aria-label="模板名称" autoFocus className={field + ' w-full'} value={name} onChange={e => { setName(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter') submit(); }}/>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="flex justify-end gap-2"><button type="button" className="rounded px-2 py-1 text-muted-foreground hover:bg-muted" onClick={() => setOpen(false)}>取消</button>
      <button type="button" className="rounded bg-primary px-2 py-1 text-primary-foreground" onClick={submit}>保存模板</button></div>
  </PopoverContent></Popover>;
}
// Saved plan objects are immutable. Renders of an open library reuse their version checks.
const templateDetails = new WeakMap<QualityGroup, { summary: string; versionChanged: boolean }>();
function getTemplateDetails(plan: QualityGroup) {
  const cached = templateDetails.get(plan);
  if (cached) return cached;
  const details = { summary: qualityPlanTemplateSummary(plan), versionChanged: planVersionChanges(plan).length > 0 };
  templateDetails.set(plan, details);
  return details;
}

export function TemplatePicker({ actions, plans, disabled, onUse, onUseBuiltin,purpose='sell' }: {purpose?:'sell'|'entry'; actions: PlanTemplateActions; plans: readonly QualityGroup[]; disabled: boolean; onUse: (template: PlanTemplateActions['templates'][number]) => void; onUseBuiltin?: (template: QualityBuiltinTemplate, base?:QualityGroup) => void }) {
  const templates=actions.templates.filter(t=>purpose==='entry'?!!t.plan.preEntryThreeStage:!t.plan.preEntryThreeStage);
  const [open, setOpen] = useState(false), [confirm, setConfirm] = useState(''), [versionsOf, setVersionsOf] = useState('');
  const bases = [...plans.map(p=>({key:'plan:'+p.id,label:'方案 · '+p.label,plan:p})), ...templates.map(t=>({key:'template:'+t.id,label:'模板 · '+t.name,plan:t.plan}))].filter(x=>x.plan.addition?.enabled||x.plan.router);
  const [baseKey,setBaseKey] = useState('');
  const [creationError, setCreationError] = useState<{ id: string; message: string }>();
  const selectedBaseKey = baseKey || (bases.length === 1 ? bases[0].key : bases.length === 0 ? 'builtin' : '');
  const base = bases.find(b=>b.key===selectedBaseKey);
  const createFromBuiltin = (template: QualityBuiltinTemplate) => {
    if (template.defaultBaseName && selectedBaseKey !== 'builtin' && !base) {
      setCreationError({ id: template.id, message: '请先选择要沿用的原方案，或选择「内置原方案」直接新建。' });
      return;
    }
    try {
      onUseBuiltin?.(template, template.defaultBaseName ? base?.plan : undefined);
      setCreationError(undefined); setOpen(false);
    } catch (cause) {
      setCreationError({ id: template.id, message: cause instanceof Error ? cause.message : '内置模板生成失败' });
    }
  };
  const date = (t: number) => new Date(t + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  return <Popover open={open} onOpenChange={next => { setOpen(next); setConfirm(''); setVersionsOf(''); setCreationError(undefined); }}><PopoverTrigger asChild>
    <button type="button" disabled={disabled} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40" title={purpose==='entry'?'三阶筛选模板库：保存整套条件，选用后仍可调整':templates.length ? `已有 ${templates.length} 个账号模板，也可使用内置模板` : '可直接使用内置模板；也可在方案卡片右上角点「存为模板」'}><LayoutTemplate className="h-3 w-3"/>{purpose==='entry'?'模板库':'从模板新建'}{templates.length > 0 && <span className="rounded bg-primary/15 px-1 text-[9px] tabular-nums text-primary">{templates.length}</span>}</button>
  </PopoverTrigger><PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-1 text-[11px]" data-testid="plan-template-list">
    {/* 【用户要求】2026-11-04 内置模板：代码里的配方，新建时按账号当前公式生成，保存时冻结版本；不占账号模板目录 */}
    {purpose==='sell'&&BUILTIN_QUALITY_TEMPLATES.length > 0 && <div className="mb-1 border-b border-border/60 pb-1" data-testid="plan-template-builtins">
      <p className="px-2 pb-0.5 pt-1 text-[10px] text-muted-foreground">内置模板 · 新建时按账号当前公式生成，保存时冻结版本</p>
      <ul>{BUILTIN_QUALITY_TEMPLATES.map(t => <li key={t.id} className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/60" data-testid="plan-template-builtin">
        <div className="min-w-0 flex-1"><p className="font-medium">{t.name}</p><p className="text-[10px] leading-snug text-muted-foreground">{t.summary}</p>
          {t.defaultBaseName&&<>
            <label className="mt-2 block">沿用原方案<select aria-label="优势模板沿用原方案" value={selectedBaseKey} onChange={e=>{setBaseKey(e.target.value);setCreationError(undefined);}} className="mt-1 w-full rounded border bg-background p-1"><option value="">选择原方案或账号模板</option><option value="builtin">内置原方案 · {t.defaultBaseName}</option>{bases.map(b=><option key={b.key} value={b.key}>{b.label}</option>)}</select></label>
            <p className="mt-1 text-[10px] text-muted-foreground">{selectedBaseKey === 'builtin' ? '按上述内置原方案新建，保留它的全部加仓参数，再附加优势筛选与退出确认。沿用你自己的参数时，请改选对应方案。' : '完整沿用所选方案已保存的参数。也可选择内置原方案直接新建，无需提前保存账号模板。'}</p>
          </>}
          {creationError?.id === t.id && <p role="alert" className="mt-1 text-destructive">{creationError.message}</p>}
        </div>
        <button type="button" disabled={disabled} className="shrink-0 rounded border border-primary/25 bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/20 disabled:opacity-40" aria-label={`用内置模板 ${t.name} 新建方案`} onClick={() => createFromBuiltin(t)}>新建</button>
      </li>)}</ul>
    </div>}
    {!templates.length ? <p className="px-3 py-3 text-muted-foreground">还没有模板。在方案卡片右上角点「存为模板」即可保存整套设置。</p>
      : <ul className="max-h-80 overflow-y-auto">{templates.map(t => {
        const { summary, versionChanged } = getTemplateDetails(t.plan);
        return <li key={t.id} className="group flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/60" data-testid="plan-template-item">
        <div className="min-w-0 flex-1"><p className="truncate font-medium">{t.name}</p><p className="truncate text-[10px] text-muted-foreground" title={summary}>{summary}</p><p className="text-[9.5px] text-muted-foreground/70 tabular-nums">保存于 {date(t.savedAt)} · <button type="button" className={`underline-offset-2 hover:underline ${versionChanged ? 'text-destructive' : 'text-primary/80'}`} aria-expanded={versionsOf === t.id} aria-label={`模板 ${t.name} 的算法版本`} onClick={() => setVersionsOf(versionsOf === t.id ? '' : t.id)}>{versionChanged ? '版本已变' : '版本'} {versionsOf === t.id ? '▴' : '▾'}</button></p>
          {versionsOf === t.id && <div className="mt-1.5 rounded border border-border/60 bg-background p-1.5"><PlanVersionList plan={t.plan}/></div>}</div>
        <button type="button" disabled={versionChanged} title={versionChanged ? '模板冻结的算法版本与当前代码不同，不能新建（展开「版本已变」看哪一项）' : undefined} className="shrink-0 rounded border border-primary/25 bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/20 disabled:opacity-40" aria-label={`用模板 ${t.name} 新建方案`} onClick={() => { onUse(t); setOpen(false); }}>新建</button>
        {confirm === t.id
          ? <button type="button" className="shrink-0 rounded bg-destructive/10 px-2 py-0.5 text-destructive" aria-label={`确认删除模板 ${t.name}`} onClick={() => { actions.remove(t.id); setConfirm(''); }}>确认删除</button>
          : <button type="button" className="shrink-0 rounded p-1 text-muted-foreground/50 hover:text-destructive" aria-label={`删除模板 ${t.name}`} onClick={() => setConfirm(t.id)}><Trash2 className="h-3 w-3"/></button>}
      </li>;
      })}</ul>}
    <FishQualityTemplateArchive owner={actions.owner} purpose={purpose} restore={actions.restore}/>
  </PopoverContent></Popover>;
}
export function FishQualitySellPlansEditor({ plans, ready, onSave, prepare, extraDirty = false, renderHolding, onSelectPlan, onCopyPlan, templates, recoverablePlans,readOnly = false, embedded = false, onDirtyChange, purpose = 'sell', singlePlan = false }: {
  purpose?: 'sell' | 'entry';
  singlePlan?: boolean;
  plans: readonly QualityGroup[]; ready: boolean; onSave: (plans: QualityGroup[]) => void;
  onCopyPlan?: (source: QualityGroup, copy: QualityGroup) => void;
  templates?: PlanTemplateActions;
  recoverablePlans?:readonly RecoverableQualityPlan[];
  /** 只读展示（交易战役里查看当时冻结的设置）：不显示新增 / 复制 / 删除 / 保存，输入全部禁用。 */
  readOnly?: boolean;
  /** A branch is one editable plan; its parent owns save, copy and run actions. */
  embedded?: boolean; onDirtyChange?: (dirty: boolean) => void;
  onSelectPlan?: (id: string) => void; prepare?: (plans: QualityGroup[]) => QualityGroup[]; extraDirty?: boolean; renderHolding?: (view: SellPlansDraftView) => ReactNode;
}) {
  const action = purpose === 'entry' ? '筛选' : '卖出';
  const definitions = useFeatureDefinitions();
  const choices = useMemo(() => qualityFilterMenuChoices(definitions), [definitions]);
  const metricDefinitions = useMemo(() => qualityFilterDefinitions(definitions), [definitions]);
  const [drafts, setDrafts] = useState(() => plans.map(draftOf)), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  const draftPlanIds=useRef(new Set(plans.map(p=>p.id)));
  useEffect(() => { if (!dirty) {draftPlanIds.current=new Set(plans.map(p=>p.id));setDrafts(plans.map(draftOf));} }, [plans, dirty]);
  useEffect(() => { onDirtyChange?.(dirty || extraDirty); }, [dirty, extraDirty, onDirtyChange]);
  const change = (next: Draft[]) => { setDrafts(next); setDirty(true); setError(''); };
  const patch = (id: string, next: Partial<Draft>) => { onSelectPlan?.(id); change(drafts.map(d => d.id === id ? { ...d, ...next } : d)); };
  const number = (value: string, optional = false) => {
    if (!value.trim() && optional) return undefined;
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error('门槛和切换涨幅须填写有限数字');
    return Number(value);
  };
  const baseOf = (d: Draft) => plans.find(p => p.id === d.id) ?? d.original;
  const algorithmFields = (d: Draft) => JSON.stringify([d.choice,d.direction,d.threshold,d.time??{},d.combo,...(d.combo?[d.afterChoice,d.afterDirection,d.afterThreshold,d.switchPct,d.afterTime??{}]:[])]);
  const labelOf = (d: Draft, base?: QualityGroup) => d.original && d.label === d.original.label ? base?.label ?? d.label : d.label.trim() || (d.choice === STATIC_DRAWDOWN_SELL_CHOICE ? STATIC_DRAWDOWN_SELL_LABEL : choices.find(c=>c.key===d.choice)?.label) || base?.label || `新${action}算法`;
  const duplicate = (source: Draft, index: number) => {
    const base = structuredClone(baseOf(source)!);
    const rootLabel = labelOf(source, base).replace(/（副本(?: \d+)?）$/, '').trim() || `${action}算法`;
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
  const splitBranches=(source:Draft,index:number)=>{
    try{
      const saved=freezeSavedPlans(plans,build()),base=saved.find(p=>p.id===source.id)!;
      const copies=splitQualityBranches(base,{structure:newQualitySellPlanId(),attack:newQualitySellPlanId()},
        {structure:uniqueLabel(labelOf(source,base)+' · 结构型'),attack:uniqueLabel(labelOf(source,base)+' · 进攻型')});
      const next=[...saved.slice(0,index+1),...copies,...saved.slice(index+1)];
      onSave(next);setDrafts(next.map(draftOf));setDirty(false);setError('');
      onSelectPlan?.(copies[0].id);
    }catch(cause){setError(cause instanceof Error?cause.message:'拆分失败，原组合未改动');}
  };
  const restoreSavedPlan=(plan:QualityGroup)=>{
    if(drafts.some(d=>d.id===plan.id))throw Error('这套方案已在当前列表中');
    if(planVersionChanges(plan).length)throw Error('该快照的冻结版本与当前代码不一致，原快照保留，不能自动升级恢复');
    const next=[...build(),structuredClone(plan)];
    onSave(next);setDrafts(next.map(draftOf));setDirty(false);setError('');onSelectPlan?.(plan.id);
  };
  /** 旧引擎方案复制成当前引擎可编辑的 S/T/K 方案（原方案保留）。不沿用原方案的监测草稿：草稿按新方案自己生成。 */
  const editableCopy = (source: Draft, index: number) => {
    const base = legacyToEditablePlan(baseOf(source)!), copyBase = { ...base, id: newQualitySellPlanId(), label: uniqueLabel(`${labelOf(source, baseOf(source))}（可编辑）`) };
    change([...drafts.slice(0, index + 1), draftOf(copyBase), ...drafts.slice(index + 1)]);
    onSelectPlan?.(copyBase.id);
  };
  const uniqueLabel = (root: string) => { const labels = new Set(drafts.map(d => labelOf(d, baseOf(d)))); let label = root, n = 2; while (labels.has(label)) label = `${root}（${n++}）`; return label; };
  const turingCopy = (source: Draft) => {
    try {
      const copy = createTuringQualityPlan(baseOf(source)!, definitions);
      copy.label = uniqueLabel(copy.label);
      // Seed editor drafts from the converted copy, never from the BTC-dependent source.
      onCopyPlan?.({ ...copy, id: `turing:${copy.id}` }, copy);
      change([...drafts, draftOf(copy)]);
      onSelectPlan?.(copy.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建图灵杯副本失败'); }
  };
  const fromTemplate = (template: PlanTemplateActions['templates'][number]) => {
    const copyBase = qualityPlanFromTemplate(template, newQualitySellPlanId(), uniqueLabel(template.name));
    onCopyPlan?.({ ...template.plan, id: `template:${template.id}` }, copyBase);
    change([...drafts, draftOf(copyBase)]);
    onSelectPlan?.(copyBase.id);
  };
  /** 内置模板：按账号当前公式生成方案，之后与「从模板新建」同一条路（复制监测草稿、加入列表、保存时冻结版本）。 */
  const fromBuiltin = (template: QualityBuiltinTemplate, base?:QualityGroup) => {
    const copyBase = template.build(definitions, newQualitySellPlanId(), uniqueLabel(template.name),base);
    onCopyPlan?.({ ...copyBase, id: `builtin:${template.id}` }, copyBase);
    change([...drafts, draftOf(copyBase)]);
    onSelectPlan?.(copyBase.id);
  };
  const build = (after?: (plans: QualityGroup[]) => QualityGroup[]) => {
      const currentIds=new Set(plans.map(p=>p.id));
      if(drafts.some(d=>draftPlanIds.current.has(d.id)&&!currentIds.has(d.id)))throw Error('有方案已被另一页面或设备删除；当前修改保留，请移除该方案或复制为新方案后再保存');
      const next = drafts.map(d => {
        const base = baseOf(d);
        if(base?.router)return {...base,id:d.id,label:labelOf(d,base)};
        // 旧引擎方案只改名称，其余原样保存
        if (base && isLegacyQualityPlan(base)) return { ...structuredClone(base), label: labelOf(d,base) };
        if (base && d.original && algorithmFields(d) === algorithmFields(draftOf(d.original))) return { ...structuredClone(base), label: labelOf(d,base) };
        const threshold = number(d.threshold, true);
        const original = base && draftOf(base);
        const plan = base && d.choice === original?.choice && d.choice !== STATIC_DRAWDOWN_SELL_CHOICE && d.direction !== '>='
          ? { ...structuredClone(base), snapshot:{ ...structuredClone(base.snapshot), direction:d.direction, threshold:threshold ?? 0 },
              rule:threshold == null ? undefined : {metric:base.metric,direction:d.direction,threshold} }
          : makeQualitySellPlan(d.choice, d.direction, threshold, definitions, base, d.id);
        const timed = d.choice === STATIC_DRAWDOWN_SELL_CHOICE ? plan : withMetricSnapshotTime(plan, d.time);
        plan.snapshot = timed.snapshot;
        plan.label = d.label.trim() || timed.label;
        if (d.combo) {
          const afterThreshold = number(d.afterThreshold)!;
          const saved = d.afterChoice === original?.afterChoice && d.afterChoice !== STATIC_DRAWDOWN_SELL_CHOICE ? base?.combo?.after : undefined;
          const afterDirection = d.afterDirection;
          const after = saved && afterDirection !== '>='
            ? { ...saved, snapshot:{ ...saved.snapshot,direction:afterDirection,threshold:afterThreshold },
                rule:{metric:saved.metric,direction:afterDirection,threshold:afterThreshold} }
            : makeQualitySellPlan(d.afterChoice, d.afterDirection, afterThreshold, definitions);
          const timedAfter = d.afterChoice === STATIC_DRAWDOWN_SELL_CHOICE ? after : withMetricSnapshotTime(after,d.afterTime);
          const switchPct = number(d.switchPct)!;
          if (!(switchPct > 0)) throw new Error('分段切换涨幅须大于 0');
          plan.combo = { switchPct, beforeLabel: d.choice === STATIC_DRAWDOWN_SELL_CHOICE ? STATIC_DRAWDOWN_SELL_LABEL : choices.find(c => c.key === d.choice)?.label ?? plan.label,
            after: { label: timedAfter.label, metric: after.metric, snapshot: timedAfter.snapshot, rule: after.rule! } };
        } else delete plan.combo;
        // 按加仓次数改用的卖出算法在「加仓细节 · 卖出」里逐次设置（monitor 草稿写入 sellStages），这里保持原值。

        return plan;
      });
      // A newly hydrated plan was never a deletion decision in this open form.
      next.push(...plans.filter(p=>!draftPlanIds.current.has(p.id)&&!next.some(n=>n.id===p.id)).map(p=>structuredClone(p)));
      const withAdvantage = next.map(p=>withQualityAdvantageOptions(p,drafts.find(d=>d.id===p.id)?.advantageOptions));
      const prepared = (prepare ? prepare(withAdvantage) : withAdvantage).map(p=>withQualityAdvantageOptions(p,drafts.find(d=>d.id===p.id)?.advantageOptions));
      const saved=after?after(prepared):prepared;
      saved.forEach(p=>{validateQualitySellStages(p);validateQualityVetoStages(p);});
      return saved;
  };
  const apply = (after?: (plans: QualityGroup[]) => QualityGroup[]) => {
    try {
      onSave(build(after)); setDirty(false); setError(''); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : `${action}算法设置无效`); return false; }
  };
  // Keep router editor keys stable while global overlay controls are edited; apply to both branches at save.
  const preview = drafts.map(d => ({ ...baseOf(d)!, id: d.id, label: labelOf(d,baseOf(d)), ...(baseOf(d)?.advantage&&d.advantageOptions?{advantage:{...baseOf(d)!.advantage!,...d.advantageOptions}}:{}) }));
  const select = (value: string, label: string, onChange: (value: string) => void) => {
    const staticChoice = value === STATIC_DRAWDOWN_SELL_CHOICE;
    const featureId = choices.find(c => c.key === value)?.featureId ?? value.split(':')[0];
    const features = [...new Map(choices.map(c => [c.featureId, c.group])).entries()];
    if (purpose === 'sell') features.unshift([STATIC_DRAWDOWN_SELL_VERSION, STATIC_DRAWDOWN_SELL_LABEL]);
    return <div className="grid min-w-0 gap-1.5 sm:grid-cols-2">
      <select aria-label={label + ' 特征值'} className={field + ' w-full'} value={featureId} onChange={e => onChange(e.target.value === STATIC_DRAWDOWN_SELL_VERSION ? STATIC_DRAWDOWN_SELL_CHOICE : choices.find(c => c.featureId === e.target.value)!.key)}>
        {!features.some(([id]) => id === featureId) && <option value={featureId}>原指标已变更</option>}
        {features.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <select aria-label={label} className={field + ' w-full'} value={value} onChange={e => onChange(e.target.value)}>
        {staticChoice && <option value={STATIC_DRAWDOWN_SELL_CHOICE}>距首仓买入价的最大跌幅</option>}
        {!staticChoice && !choices.some(c => c.key === value) && <option hidden disabled value={value}>已保存指标：{value}</option>}
        {choices.filter(c => c.featureId === featureId).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
      </select>
    </div>;
  };
  const sellerFields = (label: string, choice: string, direction: Draft['direction'], threshold: string, time: AdditionMetricTime | undefined,
    snapshot: QualityGroup['snapshot'] | undefined, set: (choice: string, direction: Draft['direction'], threshold: string, time?: AdditionMetricTime) => void, after = false) => {
    const priceStop = choice === STATIC_DRAWDOWN_SELL_CHOICE;
    const heading = label + (after ? ' 后段' : '');
    const fieldLabel = (name: string) => heading + (after ? '' : ' ') + name;
    return <>
      <div className={`fish-plan-condition grid gap-1.5 ${priceStop ? 'grid-cols-[minmax(0,1fr)_3rem_minmax(9rem,max-content)]' : 'grid-cols-[minmax(0,1fr)_3rem_5rem]'}`}>
        {select(choice, fieldLabel('指标'), next => set(next, next === STATIC_DRAWDOWN_SELL_CHOICE ? '>=' : priceStop ? '<' : direction,
          next === STATIC_DRAWDOWN_SELL_CHOICE && !priceStop ? String(DEFAULT_STATIC_DRAWDOWN_SELL_PCT) : priceStop && next !== STATIC_DRAWDOWN_SELL_CHOICE ? '' : threshold))}
        <select aria-label={fieldLabel('方向')} className={field} disabled={priceStop} value={direction}
          onChange={event => set(choice, event.target.value as Draft['direction'], threshold, time)}>
          {priceStop ? <option value=">=">≥</option> : <><option value="<">&lt;</option><option value=">">&gt;</option></>}
        </select>
        <div className="flex min-w-0 items-center gap-1">
          <input aria-label={fieldLabel('门槛')} className={field + ' w-full'} type="number" step="any" min={priceStop ? 0 : undefined}
            max={priceStop ? 100 : undefined} placeholder={priceStop ? '填百分比' : '未设置'} value={threshold}
            onChange={event => set(choice, direction, event.target.value, time)}/>
          {priceStop && <span className="text-[10px]">%</span>}
        </div>
      </div>
      {priceStop ? <p className="text-[10.5px] text-muted-foreground">1 分钟行情模拟触价成交。止损线以首仓买入价计算，开盘跳空越线时按开盘价成交。</p>
        : <FishMetricTimeFields label={heading} metric={choice.slice(choice.indexOf(':')+1)}
            definition={metricDefinitions.get(choice.split(':')[0])} snapshot={snapshot} time={time}
            onChange={value => set(choice, direction, threshold, value)}/>}
    </>;
  };
  return <><fieldset disabled={readOnly} className="contents"><section className="mb-3 space-y-2 border-b border-border/60 pb-3" data-testid={embedded ? "quality-branch-sell-plans-editor" : "quality-sell-plans-editor"}>
    <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-medium">{renderHolding ? (purpose === 'entry' ? '① 筛选算法' : '① 组合算法') : `${action}算法`} <span className="text-muted-foreground" data-testid={embedded ? "branch-sell-plan-draft-count" : "sell-plan-draft-count"}>{drafts.length} 套</span></h4>
      {!readOnly && !embedded && !singlePlan && <><button type="button" disabled={!ready || !choices.length} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40" onClick={() => { const original = makeQualitySellPlan(choices[0].key, purpose === 'entry' ? '>' : '<', undefined, definitions, undefined, newQualitySellPlanId()); change([...drafts, { ...draftOf(original), label: '', afterChoice: choices[0].key }]); onSelectPlan?.(original.id); }}><Plus className="h-3 w-3" />新增{action}算法</button>{templates && <TemplatePicker actions={templates} plans={plans} disabled={!ready} onUse={fromTemplate} onUseBuiltin={fromBuiltin}/>}</>}</div>
    {!readOnly && !embedded && <p className="text-[10.5px] leading-relaxed text-muted-foreground">{purpose === 'entry' ? '筛选算法与启用的确认条件在同一分钟满足，且无否决时，纳入观察并保存到入选库。' : '每套方案独立监测，可选特征值、公式变量、方向和门槛。下方监测方案随增删、改名即时对应；保存后更新表格；全部调整完成后点击「开始监测」运行已勾选信号，历史轮次保留。'}</p>}
    {!drafts.length && <p className="rounded border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">暂无{action}算法，点击上方新增。</p>}
    {drafts.map((d, i) => {
      const base = baseOf(d);
      const after = base?.combo?.after;
      const mainSnapshot = base && `${base.snapshot.featureId}:${base.metric}` === d.choice ? base.snapshot : undefined;
      const afterSnapshot = after && `${after.snapshot.featureId}:${after.metric}` === d.afterChoice ? after.snapshot : undefined;
      return <div key={d.id} data-plan-id={d.id} onFocusCapture={e => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) onSelectPlan?.(d.id); }} className="space-y-1.5 rounded-md border border-border/60 p-2" data-testid={'sell-plan-draft-' + i}>
      <div className="fish-plan-header flex items-center gap-1.5"><span className="text-[10px] tabular-nums text-muted-foreground">{i + 1}.</span><input aria-label={`${action}算法 ` + (i + 1) + ' 名称'} className={field + ' flex-1'} placeholder="名称（可选）" value={d.label} onChange={e => patch(d.id, { label: e.target.value })} />
        {/* 【用户要求】2026-11-03 旧引擎方案只读（除名称）：改了参数就不是原来那套了 */}
        {isLegacyQualityPlan(baseOf(d)) && <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300" title="按 10-31 的引擎原样复算；除名称外不能修改" data-testid={'sell-plan-legacy-' + i}>{LEGACY_ENGINE_LABEL} · 只读</span>}
        {!readOnly && !embedded && isLegacyQualityPlan(baseOf(d)) && <button type="button" disabled={!ready} className="shrink-0 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/20 disabled:opacity-40" title="复制成当前引擎的「指标 · S / T / K」方案，可以改参数；入场距离沿用原值、涨幅门槛按持仓均价。原方案保留。" aria-label={'转为可编辑 ' + (i + 1)} onClick={() => editableCopy(d, i)}>转为可编辑</button>}
        {purpose !== 'entry' && <select aria-label={`${action}算法 ` + (i + 1) + ' 类型'} disabled={isLegacyQualityPlan(baseOf(d)) || !!baseOf(d)?.router} className={field} value={d.combo ? 'combo' : 'single'} onChange={e => patch(d.id, { combo: e.target.value === 'combo' })}><option value="single">单一算法</option><option value="combo">分段组合</option></select>}
        {!readOnly&&!embedded&&!singlePlan&&baseOf(d)?.router&&<button type="button" aria-label={`拆分卖出组合 ${i+1}`} title="一并保存当前修改、原组合和两套独立方案；参数完整保留，不启动监测。" disabled={!ready} onClick={()=>splitBranches(d,i)} className="shrink-0 rounded border border-primary/25 px-1.5 py-0.5 text-[10px] text-primary disabled:opacity-40">{dirty||extraDirty?'保存并拆成结构型 / 进攻型':'拆成结构型 / 进攻型'}</button>}
        {!readOnly && !embedded && templates && <SaveTemplateButton index={i} defaultName={labelOf(d, baseOf(d))} disabledReason={!ready ? '尚未加载完成' : !plans.some(p => p.id === d.id) ? '新方案先点「保存全部方案」，再存为模板' : dirty || extraDirty ? '有未保存的修改：先点「保存全部方案」，模板保存的是已保存的设置' : undefined} onSave={name => templates.save(d.id, name)}/>}
        {!readOnly && !embedded && !singlePlan && !baseOf(d)?.initialization && <button type="button" className="shrink-0 rounded border border-primary/25 px-1.5 py-0.5 text-[10px] text-primary disabled:opacity-40" disabled={!ready || dirty || extraDirty || !plans.some(p=>p.id===d.id)} title="原方案保留；新副本从图灵杯首根行情初始化，BTC 依赖改用已有独立无 BTC 版本。请先保存当前修改。" aria-label={'新建图灵杯专用副本 ' + (i + 1)} onClick={()=>turingCopy(d)}>图灵杯副本</button>}
      {baseOf(d)?.initialization && <span className="text-[10px] text-amber-600" title="从实际首根行情初始化；初期读数与完整历史预热不同。原方案另行保留。">首根初始化 v1</span>}
      {!readOnly && !embedded && !singlePlan && <><button type="button" disabled={!ready} aria-label={`复制${action}算法 ` + (i + 1)} title={purpose==='entry'?'复制整套筛选算法和确认条件':'复制整套方案：含当前填写的组合算法、加仓、镜像平衡减仓和一票条件'} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" onClick={() => duplicate(d, i)}><Copy className="h-3.5 w-3.5" /></button>
        <button type="button" aria-label={`删除${action}算法 ` + (i + 1)} className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => change(drafts.filter(x => x.id !== d.id))}><X className="h-3.5 w-3.5" /></button></>}</div>
      {baseOf(d)?.router ? <p className="text-[10.5px] text-muted-foreground">条件分支方案：在下方修改两个分支的卖出、镜像、加仓与止损设置。</p> : <fieldset disabled={isLegacyQualityPlan(baseOf(d))} className="contents">
      {sellerFields(`${action}算法 ${i+1}`, d.choice, d.direction, d.threshold, d.time, mainSnapshot,
        (choice, direction, threshold, time) => patch(d.id, { choice, direction, threshold, time }))}
      {d.combo && <div className="space-y-1.5 border-t border-border/40 pt-1.5"><label className="flex items-center gap-1 text-[11px] text-muted-foreground">相对买入价上涨<input aria-label={`${action}算法 ` + (i + 1) + ' 切换涨幅'} type="number" step="any" className={field + ' w-20'} value={d.switchPct} onChange={e => patch(d.id, { switchPct: e.target.value })} />% 后切换为</label>
        {sellerFields(`${action}算法 ${i+1}`, d.afterChoice, d.afterDirection, d.afterThreshold, d.afterTime, afterSnapshot,
          (afterChoice, afterDirection, afterThreshold, afterTime) => patch(d.id, { afterChoice, afterDirection, afterThreshold, afterTime }), true)}
      </div>}</fieldset>}
    {!embedded && baseOf(d)?.advantage && <FishQualityAdvantageSettings rule={{...baseOf(d)!.advantage!,...d.advantageOptions}} onChange={readOnly?undefined:options=>patch(d.id,{advantageOptions:options})}/>}
    </div>;})}
    {!readOnly&&!embedded&&recoverablePlans&&<FishQualitySavedPlanRecovery plans={recoverablePlans.filter(p=>!drafts.some(d=>d.id===p.plan.id))} disabled={!ready} onRestore={restoreSavedPlan}/>}
    {!readOnly&&!embedded&&drafts.some(d=>baseOf(d)?.router)&&<p className="text-[10.5px] text-muted-foreground">拆分时一并保存当前修改、原组合和两套独立方案，不启动监测。</p>}
    {!readOnly && !embedded && <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={!ready || !(dirty || extraDirty)} onClick={() => apply()} className="h-7 rounded-md border border-primary/30 bg-primary/10 px-2.5 text-[11px] text-primary disabled:opacity-40">{renderHolding ? '保存全部方案' : `保存${action}算法`}</button>
      <span className="text-[10px] text-muted-foreground">{purpose === 'entry' ? '每套筛选方案须填写门槛；确认条件可选，启用后须与筛选算法同时满足。' : '未填普通门槛时，可单独使用该方案的加仓、镜像平衡减仓或持仓否决。'}</span></div>}
    {error && !renderHolding && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </section></fieldset>{renderHolding?.({ plans: preview, dirty: dirty || extraDirty, algorithmsDirty: dirty, error, build, save: apply })}</>;
}
