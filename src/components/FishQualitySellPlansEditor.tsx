import {validateQualityVetoStages} from '@/lib/fish/qualityVetoStages';
import {FishQualitySellStagesEditor,type SellStageDraft} from './FishQualitySellStagesEditor';
import {validateQualitySellStages} from '@/lib/fish/qualitySellStages';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { makeQualitySellPlan, newQualitySellPlanId } from '@/lib/fish/qualitySellPlans';
import { qualityFilterChoices } from '@/lib/fish/qualityFilters';
import type { QualityGroup } from '@/lib/fish/quality';

const field = 'h-7 min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
interface Draft {
  id: string; original?: QualityGroup; label: string; choice: string; direction: '<' | '>'; threshold: string;
  stagesEnabled:boolean;stages:SellStageDraft[];
  combo: boolean; afterChoice: string; afterDirection: '<' | '>'; afterThreshold: string; switchPct: string;
}
const draftOf = (plan: QualityGroup): Draft => ({ id: plan.id, original: plan, label: plan.label,
  choice: plan.snapshot.featureId + ':' + plan.metric, direction: plan.rule?.direction ?? plan.snapshot.direction ?? '<',
  threshold: plan.rule ? String(plan.rule.threshold) : '', combo: !!plan.combo,
  afterChoice: plan.combo ? plan.combo.after.snapshot.featureId + ':' + plan.combo.after.metric : 'state:state',
  stagesEnabled:!!plan.sellStages?.length,stages:(plan.sellStages??[]).map(s=>({afterAdditions:String(s.afterAdditions),choice:s.snapshot.featureId+':'+s.metric,direction:s.rule.direction,threshold:String(s.rule.threshold)})),
  afterDirection: plan.combo?.after.rule.direction ?? '<', afterThreshold: plan.combo ? String(plan.combo.after.rule.threshold) : '', switchPct: String(plan.combo?.switchPct ?? 5.1) });

export interface SellPlansDraftView { plans: QualityGroup[]; dirty: boolean; algorithmsDirty: boolean; error: string; save: (after?: (plans: QualityGroup[]) => QualityGroup[]) => boolean }
export function FishQualitySellPlansEditor({ plans, ready, onSave, prepare, extraDirty = false, renderHolding, onSelectPlan }: {
  plans: readonly QualityGroup[]; ready: boolean; onSave: (plans: QualityGroup[]) => void;
  onSelectPlan?: (id: string) => void; prepare?: (plans: QualityGroup[]) => QualityGroup[]; extraDirty?: boolean; renderHolding?: (view: SellPlansDraftView) => ReactNode;
}) {
  const definitions = useFeatureDefinitions();
  const choices = useMemo(() => qualityFilterChoices(definitions), [definitions]);
  const [drafts, setDrafts] = useState(() => plans.map(draftOf)), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!dirty) setDrafts(plans.map(draftOf)); }, [plans, dirty]);
  const change = (next: Draft[]) => { setDrafts(next); setDirty(true); setError(''); };
  const patch = (id: string, next: Partial<Draft>) => { onSelectPlan?.(id); change(drafts.map(d => d.id === id ? { ...d, ...next } : d)); };
  const number = (value: string, optional = false) => {
    if (!value.trim() && optional) return undefined;
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error('门槛和切换涨幅须填写有限数字');
    return Number(value);
  };
  const baseOf = (d: Draft) => plans.find(p => p.id === d.id) ?? d.original;
  const stageFields=(d:Draft)=>JSON.stringify([d.stagesEnabled,...(d.stagesEnabled?d.stages:[])]);
  const algorithmFields = (d: Draft) => JSON.stringify([d.choice,d.direction,d.threshold,d.combo,...(d.combo?[d.afterChoice,d.afterDirection,d.afterThreshold,d.switchPct]:[])]);
  const labelOf = (d: Draft, base?: QualityGroup) => d.original && d.label === d.original.label ? base?.label ?? d.label : d.label.trim() || choices.find(c=>c.key===d.choice)?.label || base?.label || '新卖出算法';
  const apply = (after?: (plans: QualityGroup[]) => QualityGroup[]) => {
    try {
      const next = drafts.map(d => {
        const base = baseOf(d);
        if (base && d.original && algorithmFields(d) === algorithmFields(draftOf(d.original))&&stageFields(d)===stageFields(draftOf(d.original))) return { ...structuredClone(base), label: labelOf(d,base) };
        const ordinaryUnchanged=!!(base&&d.original&&algorithmFields(d)===algorithmFields(draftOf(d.original)));
        const plan = ordinaryUnchanged?structuredClone(base!):makeQualitySellPlan(d.choice, d.direction, number(d.threshold, true), definitions, baseOf(d), d.id);
        plan.label = d.label.trim() || plan.label;
        if (!ordinaryUnchanged&&d.combo) {
          const after = makeQualitySellPlan(d.afterChoice, d.afterDirection, number(d.afterThreshold), definitions);
          const switchPct = number(d.switchPct)!;
          if (!(switchPct > 0)) throw new Error('分段切换涨幅须大于 0');
          plan.combo = { switchPct, beforeLabel: choices.find(c => c.key === d.choice)?.label ?? plan.label,
            after: { label: after.label, metric: after.metric, snapshot: after.snapshot, rule: after.rule! } };
        } else if(!ordinaryUnchanged)delete plan.combo;
        if(d.stagesEnabled){
          if(!d.stages.length)throw Error('请添加至少一个卖出切换阶段');
          if(!d.original||stageFields(d)!==stageFields(draftOf(d.original)))plan.sellStages=d.stages.map(s=>{const selected=makeQualitySellPlan(s.choice,s.direction,number(s.threshold),definitions);return {afterAdditions:s.afterAdditions.trim()?Number(s.afterAdditions):NaN,label:selected.label,metric:selected.metric,snapshot:selected.snapshot,rule:selected.rule!};}).sort((a,b)=>a.afterAdditions-b.afterAdditions);
        }else delete plan.sellStages;

        return plan;
      });
      const prepared = prepare ? prepare(next) : next;
      const saved=after?after(prepared):prepared;
      saved.forEach(p=>{validateQualitySellStages(p);validateQualityVetoStages(p);});
      onSave(saved); setDirty(false); setError(''); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '卖出算法设置无效'); return false; }
  };
  const preview = drafts.map(d => ({ ...baseOf(d)!, id: d.id, label: labelOf(d,baseOf(d)) }));
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
  return <><section className="mb-3 space-y-2 border-b border-border/60 pb-3" data-testid="quality-sell-plans-editor">
    <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-medium">卖出算法 <span className="text-muted-foreground" data-testid="sell-plan-draft-count">{drafts.length} 套</span></h4>
      <button type="button" disabled={!ready || !choices.length} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40" onClick={() => { const original = makeQualitySellPlan(choices[0].key, '<', undefined, definitions, undefined, newQualitySellPlanId()); change([...drafts, { ...draftOf(original), label: '', afterChoice: choices[0].key }]); onSelectPlan?.(original.id); }}><Plus className="h-3 w-3" />新增卖出算法</button></div>
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">每套方案独立监测，可选特征值、公式变量、方向和门槛。下方监测方案随增删、改名即时对应；保存后更新表格；全部调整完成后点击「开始监测」运行已勾选信号，历史轮次保留。</p>
    {!drafts.length && <p className="rounded border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">暂无卖出算法，点击上方新增。</p>}
    {drafts.map((d, i) => <div key={d.id} data-plan-id={d.id} onFocusCapture={e => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) onSelectPlan?.(d.id); }} className="space-y-1.5 rounded-md border border-border/60 p-2" data-testid={'sell-plan-draft-' + i}>
      <div className="flex items-center gap-1.5"><span className="text-[10px] tabular-nums text-muted-foreground">{i + 1}.</span><input aria-label={'卖出算法 ' + (i + 1) + ' 名称'} className={field + ' flex-1'} placeholder="名称（可选）" value={d.label} onChange={e => patch(d.id, { label: e.target.value })} />
        <select aria-label={'卖出算法 ' + (i + 1) + ' 类型'} className={field} value={d.combo ? 'combo' : 'single'} onChange={e => patch(d.id, { combo: e.target.value === 'combo' })}><option value="single">单一算法</option><option value="combo">分段组合</option></select>
        <button type="button" aria-label={'删除卖出算法 ' + (i + 1)} className="rounded p-1 text-muted-foreground hover:text-destructive" onClick={() => change(drafts.filter(x => x.id !== d.id))}><X className="h-3.5 w-3.5" /></button></div>
      <div className="grid grid-cols-[minmax(0,1fr)_3rem_5rem] gap-1.5">
        {select(d.choice, '卖出算法 ' + (i + 1) + ' 指标', choice => patch(d.id, { choice }))}
        <select aria-label={'卖出算法 ' + (i + 1) + ' 方向'} className={field} value={d.direction} onChange={e => patch(d.id, { direction: e.target.value as '<' | '>' })}><option value="<">&lt;</option><option value=">">&gt;</option></select>
        <input aria-label={'卖出算法 ' + (i + 1) + ' 门槛'} className={field + ' w-full'} type="number" step="any" placeholder="未设置" value={d.threshold} onChange={e => patch(d.id, { threshold: e.target.value })} />
      </div>
      {d.combo && <div className="space-y-1.5 border-t border-border/40 pt-1.5"><label className="flex items-center gap-1 text-[11px] text-muted-foreground">相对买入价上涨<input aria-label={'卖出算法 ' + (i + 1) + ' 切换涨幅'} type="number" step="any" className={field + ' w-20'} value={d.switchPct} onChange={e => patch(d.id, { switchPct: e.target.value })} />% 后切换为</label>
        <div className="grid grid-cols-[minmax(0,1fr)_3rem_5rem] gap-1.5">{select(d.afterChoice, '卖出算法 ' + (i + 1) + ' 后段指标', afterChoice => patch(d.id, { afterChoice }))}
          <select aria-label={'卖出算法 ' + (i + 1) + ' 后段方向'} className={field} value={d.afterDirection} onChange={e => patch(d.id, { afterDirection: e.target.value as '<' | '>' })}><option value="<">&lt;</option><option value=">">&gt;</option></select>
          <input aria-label={'卖出算法 ' + (i + 1) + ' 后段门槛'} type="number" step="any" className={field + ' w-full'} value={d.afterThreshold} onChange={e => patch(d.id, { afterThreshold: e.target.value })} />
        </div></div>}
      <FishQualitySellStagesEditor prefix={'卖出算法 '+(i+1)} enabled={d.stagesEnabled} stages={d.stages} choices={choices} onChange={(stagesEnabled,stages)=>patch(d.id,{stagesEnabled,stages})} select={select}/>
    </div>)}
    <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={!ready || !(dirty || extraDirty)} onClick={() => apply()} className="h-7 rounded-md border border-primary/30 bg-primary/10 px-2.5 text-[11px] text-primary disabled:opacity-40">{renderHolding ? '保存全部方案' : '保存卖出算法'}</button>
      <span className="text-[10px] text-muted-foreground">未填普通门槛时，可单独使用该方案的加仓、镜像止盈或持仓否决。</span></div>
    {error && !renderHolding && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </section>{renderHolding?.({ plans: preview, dirty: dirty || extraDirty, algorithmsDirty: dirty, error, save: apply })}</>;
}
