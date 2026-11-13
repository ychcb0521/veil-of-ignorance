import { useState, type ReactNode } from 'react';
import { Pause, Play, Settings2, Zap } from 'lucide-react';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { instantMonitorTemplateIssue } from '@/lib/fish/instantMonitorSettings';
import { activeQualityPlanTemplates } from '@/lib/fish/qualityPlanTemplates';
import { isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';
import { FishPopoverContent } from './FishPopoverContent';
import { FishPreEntrySettings } from './FishPreEntrySettings';
import { FishQualityInfo, FishQualityModule, qualityPauseAction, qualityPrimaryAction, qualitySettingsAction } from './FishQualityModule';
import { Popover, PopoverTrigger } from './ui/popover';

function HoldingTemplateSettings({ state, done }: { state: FishQualityState; done: () => void }) {
  const monitor = state.instantMonitor;
  const selected = monitor?.settings;
  const [id, setId] = useState(selected?.templateId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const templates = activeQualityPlanTemplates(state.study)
    .filter(template => template.entryHours == null && !template.plan.preEntryThreeStage && !template.plan.preEntryConditions);
  const template = templates.find(value => value.id === id);
  const issue = template && instantMonitorTemplateIssue(template);
  const save = async () => {
    if (!monitor || (id && !template) || issue) return;
    setError('');
    setSaving(true);
    try {
      await monitor.save(template);
      done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '持仓监测设置保存失败');
    } finally {
      setSaving(false);
    }
  };
  return <div className="space-y-3 p-3 text-xs">
    <label className="block space-y-1.5">
      <span className="block font-medium">持仓监测模板</span>
      <select className="w-full rounded-md border bg-background px-2 py-1.5" value={id} onChange={event => setId(event.target.value)} disabled={saving}>
        <option value="">即时交易默认规则</option>
        {selected && !templates.some(value => value.id === selected.templateId) &&
          <option value={selected.templateId} disabled>{selected.name}（已选快照）</option>}
        {templates.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
      </select>
    </label>
    <p className="text-muted-foreground">{id
      ? '按模板执行加仓、减仓和卖出。筛选鱼入选开仓时保存当时所选的模板快照。'
      : '40 USDT 保证金、5 倍。CDA 原始值低于 −10 或 DBL-5 防守线断裂时，按 5 分钟收盘确认卖出。另有下跌 5% 止损，以及上涨 2% 时卖出原始数量的 71.5%。'}</p>
    {template && !isLegacyQualityPlan(template.plan) && <p className="text-muted-foreground">首仓为 40 USDT 保证金、5 倍，名义金额 200 USDT。</p>}
    {template && isLegacyQualityPlan(template.plan) && <p className="text-muted-foreground">此模板使用原执行引擎，首仓名义金额为 100 USDT。</p>}
    {(error || issue) && <p role="alert" className="text-destructive">{error || issue}</p>}
    <div className="flex justify-end"><button type="button" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-40"
      disabled={!monitor || !state.ready || saving || !!issue || (!!id && !template)} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</button></div>
  </div>;
}

export function FishInstantTrading({ state, children }: { state: FishQualityState; children: ReactNode }) {
  const [dynamicOpen, setDynamicOpen] = useState(false);
  const [holdingOpen, setHoldingOpen] = useState(false);
  const automatic = state.automaticScreening, cda = state.cdaTracking;
  const screening = !!state.preEntry?.automaticRunning && !automatic?.paused;
  const pending = automatic?.pending ?? 0;
  const screeningStatus = screening ? '筛选中' : automatic?.paused ? '已暂停' : pending ? `待筛选 ${pending} 条` : '空闲';
  return <FishQualityModule title="即时交易" icon={Zap} testId="quality-instant-controls" subsection={children}
    summary={<FishQualityInfo label="即时交易说明"><p>自动筛选捕捞信号，入选后建立模拟持仓，最终平仓后归入交易战役的「即时交易」。</p></FishQualityInfo>}
    status={automatic && <>
      <span role="status">{screeningStatus}</span>
      {screening && <progress aria-label="筛选鱼进度" className="h-1 w-16 accent-primary"/>}
      {!!cda?.active && <span>持仓监测中 {cda.active} 条</span>}
      {!!cda?.awaitingMail && <span>待发邮件 {cda.awaitingMail} 条</span>}
      {(cda?.error || cda?.campaignIssue) && <span role="alert" className="text-destructive">{cda.error || cda.campaignIssue}</span>}
      {automatic.storageIssue && <span role="alert" className="text-destructive">即时交易队列保存异常</span>}
    </>}>
    <button type="button" className={automatic?.paused ? qualityPrimaryAction : qualityPauseAction} disabled={!automatic}
      onClick={() => automatic?.setAutoPaused(!automatic.paused)}>
      {automatic?.paused ? <><Play className="h-3 w-3"/>继续筛选</> : <><Pause className="h-3 w-3"/>暂停筛选</>}
    </button>
    <Popover open={dynamicOpen} onOpenChange={setDynamicOpen}>
      <PopoverTrigger asChild><button type="button" className={qualitySettingsAction} disabled={!state.ready || !state.preEntry?.ready || !automatic?.saveSettings}
        title={automatic?.settings?.plans[0]?.label ?? '沿用动态筛选'}><Settings2 className="h-3 w-3"/>买前设置</button></PopoverTrigger>
      <FishPopoverContent align="start" collisionPadding={12} aria-label="买前设置" className="fish-condition-settings screening-settings-popover">
        {automatic?.saveSettings && <FishPreEntrySettings state={state} selectedCount={0} done={() => setDynamicOpen(false)}
          automatic={{ settings: automatic.settings, save: automatic.saveSettings }}/>}
      </FishPopoverContent>
    </Popover>
    <Popover open={holdingOpen} onOpenChange={setHoldingOpen}>
      <PopoverTrigger asChild><button type="button" className={qualitySettingsAction} disabled={!state.ready || !state.instantMonitor}
        title={state.instantMonitor?.settings?.name ?? '即时交易默认规则'}><Settings2 className="h-3 w-3"/>买后设置</button></PopoverTrigger>
      <FishPopoverContent align="start" collisionPadding={12} aria-label="买后设置" className="w-80 max-w-[calc(100vw-24px)] p-0">
        <HoldingTemplateSettings state={state} done={() => setHoldingOpen(false)}/>
      </FishPopoverContent>
    </Popover>
  </FishQualityModule>;
}
