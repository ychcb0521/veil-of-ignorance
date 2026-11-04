import { FishQualityRouterView } from './FishQualityRouterView';
/**
 * 【用户要求】2026-11-02 交易战役「战役元数据」底部的「持仓监测」：点开后在卡片上完整呈现这场战役当时的条件设置，
 * 形式与内容跟「持仓监测 · 条件设置」一致——直接复用同一套编辑器，只是任何修改都不生效（只读），加仓轮次的标签页仍可切换查看。
 */
import { Activity, BookmarkPlus, Download } from 'lucide-react';
import type { TradeCampaign } from '@/types/journal';
import { useMemo, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FishQualitySellPlansEditor } from '@/components/FishQualitySellPlansEditor';
import { FishQualityMirrorEditor, mirrorDraft } from '@/components/FishQualityMirrorEditor';
import { FishQualityAdditionEditor, additionDraft } from '@/components/FishQualityAdditionEditor';
import { FishQualityHoldingVetoEditor } from '@/components/FishQualityHoldingVetoEditor';
import { holdingVetoDraft, planHoldingVetoDraft } from '@/lib/fish/qualityFilters';
import { defaultQualityAddition } from '@/lib/fish/qualityAddition';
import type { QualityGroup } from '@/lib/fish/quality';
import { PlanVersionList } from '@/components/FishQualityPlanVersions';
import { LegacyAdditionView, LegacyEngineNote } from '@/components/FishQualityLegacyAddition';
import { hasPreBoxAdditionShape, isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';

import { useCampaignQualityTemplates } from '@/contexts/FishQualityContext';

const ignore = () => {};
/** holdingOnly：只显示镜像、加仓、硬性终止与版本（持仓监测条件设置里选中旧引擎方案时用，方案卡片已在上方）。 */
export function FishQualityMonitorSettingsView({ plan, holdingOnly = false }: { plan: QualityGroup; holdingOnly?: boolean }) {
  // 11-01 之前形态的方案（10-31 及更早的战役）也只可能是旧引擎算的，同样按原始参数显示
  const legacy = isLegacyQualityPlan(plan) || hasPreBoxAdditionShape(plan);
  const plans = useMemo(() => [plan], [plan]);
  if(plan.router)return <FishQualityRouterView plan={plan}/>;
  const mirror = mirrorDraft(plan.mirrorTakeProfit ?? { enabled: false, gainPct: 5, sellPct: 50 });
  const addition = additionDraft(plan.addition ?? defaultQualityAddition(), plan.sellStages);
  const vetoStages = { enabled: !!plan.vetoStages?.length, mode: plan.vetoStageMode ?? 'overlay', peakBasis: plan.vetoPeakBasis ?? 'stage', stages: (plan.vetoStages ?? []).map(s => ({ afterAdditions: String(s.afterAdditions), conditions: holdingVetoDraft(s.conditions) })) };
  // 输入框、下拉、勾选一律不可操作；按钮（加仓轮次标签、ⓘ 说明）可点，改动回调为空操作
  return <div className="space-y-3 text-[11px] [&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none" data-testid="quality-monitor-settings-view">
    {!holdingOnly && <p className="text-[10.5px] text-muted-foreground">这场战役运行时冻结的设置 · 只读</p>}
    {legacy && <LegacyEngineNote/>}
    {!holdingOnly && <FishQualitySellPlansEditor plans={plans} ready={false} readOnly onSave={ignore}/>}
    <FishQualityMirrorEditor draft={mirror} setDraft={ignore} additionEnabled={addition.enabled}/>
    {/* 旧引擎方案的加仓按 10-31 原始参数显示：新版编辑器会把它换算成箱体，显示的就不是当时的规则了 */}
    {legacy ? <LegacyAdditionView plan={plan}/> : <FishQualityAdditionEditor draft={addition} setDraft={ignore} vetoStages={vetoStages} setVetoStages={ignore}/>}
    <section className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/[0.02] p-3" data-testid="quality-hard-stop"><div className="flex items-center gap-1.5"><h4 className="text-xs font-medium">④ 硬性终止</h4><span className="text-[10px] text-muted-foreground">必要充分 · 任一达标即卖出全部持仓</span></div>
      <FishQualityHoldingVetoEditor draft={planHoldingVetoDraft(plan.holdingVetoes)} setDraft={ignore}/>
    </section>
    <section className="space-y-2 rounded-lg border border-border/60 p-3" data-testid="quality-plan-versions"><h4 className="text-xs font-medium">算法版本</h4><PlanVersionList plan={plan}/></section>
  </div>;
}
/** 战役元数据底部的入口按钮。 */
export function QualityMonitorSettingsButton({ plan, campaign }: { plan: QualityGroup; campaign?: TradeCampaign }) {
  // 【用户要求】2026-11-04 持仓监测战役可导出详细信息，用于跨币种的适配性分析和泛化应用
  const [exported, setExported] = useState(''), [exportError, setExportError] = useState('');
  const exportDetail = async () => {
    if (!campaign) return;
    setExportError(''); setExported('');
    try { const { downloadQualityCampaignDetail } = await import('@/lib/fish/qualityCampaignExport'); setExported(downloadQualityCampaignDetail(campaign)); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : '导出失败，请重试'); }
  };
  const [open, setOpen] = useState(false), [savingForm, setSavingForm] = useState(false);
  const [name, setName] = useState(plan.label), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const templates = useCampaignQualityTemplates();
  const save = async () => {
    if (busy || !templates?.ready || !templates.save) return;
    setBusy(true); setError('');
    try { await templates.save(plan, name); setSavingForm(false); setMessage('已保存，可在持仓监测设置的「从模板新建」中查看'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '模板保存失败，请重试'); }
    finally { setBusy(false); }
  };
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
    <button type="button" className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="查看持仓监测设置" title="查看这场战役当时的持仓监测条件设置"><Activity aria-hidden className="h-3.5 w-3.5"/>持仓监测</button>
  </PopoverTrigger><PopoverContent align="start" collisionPadding={12} className="w-[46rem] max-w-[calc(100vw-2rem)] max-h-[min(85dvh,var(--radix-popover-content-available-height))] overflow-y-auto overscroll-contain">
    <p className="mb-2 text-xs font-medium">持仓监测 · {plan.label}</p>
    {campaign && <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
      <button type="button" className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 hover:bg-muted" title="导出这场战役的整套方案、买入、每次加仓（含 S / K / ATR 及跨币种可比的 ATR 倍数与百分比）、未加仓理由、卖出与各项结果" onClick={() => void exportDetail()}><Download className="h-3.5 w-3.5"/>导出详细信息</button>
      {exported && <span role="status" className="text-primary">已导出 {exported}</span>}
      {exportError && <span role="alert" className="text-destructive">{exportError}</span>}
    </div>}
    {templates?.save && <div className="mb-3 space-y-2 rounded border border-border/60 p-2 text-[11px]">
      {!savingForm ? <button type="button" className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-muted" onClick={() => { templates.activate(); setName(plan.label); setError(''); setMessage(''); setSavingForm(true); }}><BookmarkPlus className="h-3.5 w-3.5"/>保存为模板</button> : <form className="space-y-2" onSubmit={event => { event.preventDefault(); void save(); }}>
        <p>保存这场战役当时的整套组合策略，之后可从模板新建方案。</p>
        <label className="block">模板名称<input autoFocus disabled={busy} value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded border bg-background px-2 py-1"/></label>
        {!templates.ready && <p role="status">正在恢复账号模板库，请稍候…</p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setSavingForm(false)}>取消</button><button type="submit" disabled={busy || !templates.ready || !name.trim()} className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40">{busy ? '保存中…' : '确认保存模板'}</button></div>
      </form>}
      {message && <p role="status" className="text-primary">{message}</p>}
    </div>}
    <FishQualityMonitorSettingsView plan={plan}/>
  </PopoverContent></Popover>;
}
