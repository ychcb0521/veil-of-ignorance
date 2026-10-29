import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useFeatureDefinitions } from '@/hooks/useFeatureDefinitions';
import { makeQualitySellPlan, newQualitySellPlanId } from '@/lib/fish/qualitySellPlans';
import { qualityFilterChoices } from '@/lib/fish/qualityFilters';
import type { QualityGroup } from '@/lib/fish/quality';

const field = 'h-7 min-w-0 rounded-md border border-border/60 bg-muted/40 px-2 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring';
interface Draft {
  id: string; original?: QualityGroup; label: string; choice: string; direction: '<' | '>'; threshold: string;
  combo: boolean; afterChoice: string; afterDirection: '<' | '>'; afterThreshold: string; switchPct: string;
}
const draftOf = (plan: QualityGroup): Draft => ({ id: plan.id, original: plan, label: plan.label,
  choice: plan.snapshot.featureId + ':' + plan.metric, direction: plan.rule?.direction ?? plan.snapshot.direction ?? '<',
  threshold: plan.rule ? String(plan.rule.threshold) : '', combo: !!plan.combo,
  afterChoice: plan.combo ? plan.combo.after.snapshot.featureId + ':' + plan.combo.after.metric : 'state:state',
  afterDirection: plan.combo?.after.rule.direction ?? '<', afterThreshold: plan.combo ? String(plan.combo.after.rule.threshold) : '', switchPct: String(plan.combo?.switchPct ?? 5.1) });

export function FishQualitySellPlansEditor({ plans, ready, onSave }: { plans: readonly QualityGroup[]; ready: boolean; onSave: (plans: QualityGroup[]) => void }) {
  const definitions = useFeatureDefinitions();
  const choices = useMemo(() => qualityFilterChoices(definitions), [definitions]);
  const [drafts, setDrafts] = useState(() => plans.map(draftOf)), [dirty, setDirty] = useState(false), [error, setError] = useState('');
  useEffect(() => { if (!dirty) setDrafts(plans.map(draftOf)); }, [plans, dirty]);
  const change = (next: Draft[]) => { setDrafts(next); setDirty(true); setError(''); };
  const patch = (id: string, next: Partial<Draft>) => change(drafts.map(d => d.id === id ? { ...d, ...next } : d));
  const number = (value: string, optional = false) => {
    if (!value.trim() && optional) return undefined;
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error('门槛和切换涨幅须填写有限数字');
    return Number(value);
  };
  const apply = () => {
    try {
      const next = drafts.map(d => {
        const plan = makeQualitySellPlan(d.choice, d.direction, number(d.threshold, true), definitions, d.original, d.id);
        plan.label = d.label.trim() || plan.label;
        if (d.combo) {
          const after = makeQualitySellPlan(d.afterChoice, d.afterDirection, number(d.afterThreshold), definitions);
          const switchPct = number(d.switchPct)!;
          if (!(switchPct > 0)) throw new Error('分段切换涨幅须大于 0');
          plan.combo = { switchPct, beforeLabel: choices.find(c => c.key === d.choice)?.label ?? plan.label,
            after: { label: after.label, metric: after.metric, snapshot: after.snapshot, rule: after.rule! } };
        } else delete plan.combo;
        return plan;
      });
      onSave(next); setDirty(false); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '卖出算法设置无效'); }
  };
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
  return <section className="mb-3 space-y-2 border-b border-border/60 pb-3" data-testid="quality-sell-plans-editor">
    <div className="flex items-center justify-between gap-2"><h4 className="text-xs font-medium">卖出算法</h4>
      <button type="button" disabled={!ready || !choices.length} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-40" onClick={() => change([...drafts, { id: newQualitySellPlanId(), label: '', choice: choices[0].key, direction: '<', threshold: '', combo: false, afterChoice: choices[0].key, afterDirection: '<', afterThreshold: '', switchPct: '5.1' }])}><Plus className="h-3 w-3" />新增卖出算法</button></div>
    <p className="text-[10.5px] leading-relaxed text-muted-foreground">每套方案独立监测，可选特征值、公式变量、方向和门槛。保存后更新下方方案和表格，并按新设置重算已勾选信号；历史轮次保留。</p>
    {!drafts.length && <p className="rounded border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">暂无卖出算法，点击上方新增。</p>}
    {drafts.map((d, i) => <div key={d.id} className="space-y-1.5 rounded-md border border-border/60 p-2" data-testid={'sell-plan-draft-' + i}>
      <div className="flex items-center gap-1.5"><input aria-label={'卖出算法 ' + (i + 1) + ' 名称'} className={field + ' flex-1'} placeholder="名称（可选）" value={d.label} onChange={e => patch(d.id, { label: e.target.value })} />
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
    </div>)}
    <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={!ready || !dirty} onClick={apply} className="h-7 rounded-md border border-primary/30 bg-primary/10 px-2.5 text-[11px] text-primary disabled:opacity-40">保存卖出算法</button>
      <span className="text-[10px] text-muted-foreground">未填普通门槛时，可单独使用该方案的镜像止盈或持仓否决。</span></div>
    {error && <p role="alert" className="text-[11px] text-destructive">{error}</p>}
  </section>;
}
