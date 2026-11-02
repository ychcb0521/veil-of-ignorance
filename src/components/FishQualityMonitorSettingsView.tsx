/**
 * 【用户要求】2026-11-02 交易战役「战役元数据」底部的「持仓监测」：点开后在卡片上完整呈现这场战役当时的条件设置，
 * 形式与内容跟「持仓监测 · 条件设置」一致——直接复用同一套编辑器，只是任何修改都不生效（只读），加仓轮次的标签页仍可切换查看。
 */
import { Activity } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FishQualitySellPlansEditor } from '@/components/FishQualitySellPlansEditor';
import { FishQualityMirrorEditor, mirrorDraft } from '@/components/FishQualityMirrorEditor';
import { FishQualityAdditionEditor, additionDraft } from '@/components/FishQualityAdditionEditor';
import { FishQualityHoldingVetoEditor } from '@/components/FishQualityHoldingVetoEditor';
import { holdingVetoDraft } from '@/lib/fish/qualityFilters';
import { defaultQualityAddition } from '@/lib/fish/qualityAddition';
import type { QualityGroup } from '@/lib/fish/quality';
import { PlanVersionList } from '@/components/FishQualityPlanVersions';

const ignore = () => {};
export function FishQualityMonitorSettingsView({ plan }: { plan: QualityGroup }) {
  const plans = useMemo(() => [plan], [plan]);
  const mirror = mirrorDraft(plan.mirrorTakeProfit ?? { enabled: false, gainPct: 5, sellPct: 50 });
  const addition = additionDraft(plan.addition ?? defaultQualityAddition(), plan.sellStages);
  const vetoStages = { enabled: !!plan.vetoStages?.length, mode: plan.vetoStageMode ?? 'overlay', peakBasis: plan.vetoPeakBasis ?? 'stage', stages: (plan.vetoStages ?? []).map(s => ({ afterAdditions: String(s.afterAdditions), conditions: holdingVetoDraft(s.conditions) })) };
  // 输入框、下拉、勾选一律不可操作；按钮（加仓轮次标签、ⓘ 说明）可点，改动回调为空操作
  return <div className="space-y-3 text-[11px] [&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none" data-testid="quality-monitor-settings-view">
    <p className="text-[10.5px] text-muted-foreground">这场战役运行时冻结的设置 · 只读</p>
    <FishQualitySellPlansEditor plans={plans} ready={false} readOnly onSave={ignore}/>
    <FishQualityMirrorEditor draft={mirror} setDraft={ignore} additionEnabled={addition.enabled}/>
    <FishQualityAdditionEditor draft={addition} setDraft={ignore} vetoStages={vetoStages} setVetoStages={ignore}/>
    <section className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/[0.02] p-3" data-testid="quality-hard-stop"><div className="flex items-center gap-1.5"><h4 className="text-xs font-medium">④ 硬性终止</h4><span className="text-[10px] text-muted-foreground">必要充分 · 任一达标即卖出全部持仓</span></div>
      <FishQualityHoldingVetoEditor draft={holdingVetoDraft(plan.holdingVetoes)} setDraft={ignore}/>
    </section>
    <section className="space-y-2 rounded-lg border border-border/60 p-3" data-testid="quality-plan-versions"><h4 className="text-xs font-medium">算法版本</h4><PlanVersionList plan={plan}/></section>
  </div>;
}
/** 战役元数据底部的入口按钮。 */
export function QualityMonitorSettingsButton({ plan }: { plan: QualityGroup }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="查看持仓监测设置" title="查看这场战役当时的持仓监测条件设置"><Activity aria-hidden className="h-3.5 w-3.5"/>持仓监测</button>
  </PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="w-[34rem] max-w-[calc(100vw-2rem)] max-h-[min(85dvh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain">
    <p className="mb-2 text-xs font-medium">持仓监测 · {plan.label}</p>
    <FishQualityMonitorSettingsView plan={plan}/>
  </PopoverContent></Popover>;
}
