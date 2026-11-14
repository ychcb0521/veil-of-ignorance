import { useMemo, useState, type ReactNode } from 'react';
import { Ellipsis, Pause, Play, Settings2, Zap } from 'lucide-react';
import { useScreenedInstantPositions } from '@/contexts/FishQualityContext';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { INSTANT_TEMPLATE_MONITOR, instantMonitorTemplateIssue, type InstantMonitorPlanChoice } from '@/lib/fish/instantMonitorSettings';
import { activeQualityPlanTemplates } from '@/lib/fish/qualityPlanTemplates';
import { isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';
import { FishPopoverContent } from './FishPopoverContent';
import type { QualityGroup } from '@/lib/fish/quality';
import { replaceQualitySellPlans } from '@/lib/fish/qualitySellPlans';
import { instantMonitorSize } from '@/lib/fish/instantMonitorExecution';
import { FishConditionSettings } from './FishConditionSettings';
import { HoldingMonitorSettings } from './FishHoldingMonitorSettings';
import { FishPreEntrySettings } from './FishPreEntrySettings';
import { FishQualityInfo, FishQualityModule, qualityPauseAction, qualityPrimaryAction } from './FishQualityModule';
import { Popover, PopoverTrigger } from './ui/popover';

function InstantHoldingPlanEditor({ state, plan, save }: { state: FishQualityState; plan: QualityGroup; save: (plan: QualityGroup) => Promise<void> }) {
  const study = useMemo(() => ({ version: 1 as const, startedAt: 0, entryMode: 'signal' as const, observeHours: 0, tracking: false,
    groups: [], samples: [], results: [], sellPlans: [plan] }), [plan]);
  return <FishConditionSettings imageExport title="即时交易 · 买后设置" description="编辑本次选用的工作副本，应用于保存后新入选的持仓。">
    <HoldingMonitorSettings instant state={{ ...state, study, setSellPlans: plans => {
      const next = replaceQualitySellPlans(study, plans).sellPlans?.[0];
      if (next) void save(next);
    } }} activeId={plan.id} onSelect={() => {}} done={() => {}} selectedCount={0}/>
  </FishConditionSettings>;
}

function HoldingTemplateSettings({ state, done, onEdit }: { state: FishQualityState; done: () => void; onEdit: (editing: boolean) => void }) {
  const monitor = state.instantMonitor;
  const selected = monitor?.settings;
  const [id, setId] = useState(selected?.templateId ?? '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [localOnly, setLocalOnly] = useState(false);
  const templates = activeQualityPlanTemplates(state.study)
    .filter(template => template.entryHours == null && !template.plan.preEntryThreeStage && !template.plan.preEntryConditions);
  const template = templates.find(value => value.id === id);
  const choice = useMemo<InstantMonitorPlanChoice | undefined>(() => id === selected?.templateId && selected
    ? { id, name: selected.name, plan: selected.plan }
    : template, [id, selected, template]);
  const issue = choice && instantMonitorTemplateIssue(choice);
  const save = async (plan?: QualityGroup) => {
    if (!monitor || id && !choice || issue) return;
    setError('');
    setLocalOnly(false);
    setSaving(true);
    try {
      const outcome = await monitor.save(plan && choice ? { ...choice, plan, name: plan.label } : choice);
      if (outcome === 'local') setLocalOnly(true);
      else done();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '持仓监测设置保存失败');
    } finally {
      setSaving(false);
    }
  };
  const saveNotice = saving ? '正在等待云端确认保存…' : localOnly
    ? monitor?.pendingCloud ? '设置已保存到本机，云端暂未确认。可再次保存重试。' : '云端已确认保存'
    : '';
  if (editing && choice) return <>
    <button className="px-4 pt-3 text-xs text-primary" type="button" disabled={saving}
      onClick={() => { setEditing(false); onEdit(false); }}>返回模板选择</button>
    <fieldset disabled={saving}>
      <InstantHoldingPlanEditor state={state} plan={choice.plan} save={save}/>
    </fieldset>
    {saveNotice && <p role="status" className="p-3 text-xs text-muted-foreground">{saveNotice}</p>}
    {error && <p role="alert" className="p-3 text-xs text-destructive">{error}</p>}
  </>;
  const size = instantMonitorSize(choice && { version: INSTANT_TEMPLATE_MONITOR, templateId: choice.id, name: choice.name, plan: choice.plan });
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
    {choice && <p className="text-muted-foreground">首仓名义仓位 {+(size.marginUsdt * size.leverage).toPrecision(12)} USDT · {size.leverage} 倍 · 保证金 {+size.marginUsdt.toPrecision(12)} USDT</p>}
    {saveNotice && <p role="status" className="text-muted-foreground">{saveNotice}</p>}
    {(error || issue) && <p role="alert" className="text-destructive">{error || issue}</p>}
    <div className="flex flex-wrap justify-end gap-2">
      {choice && !issue && !isLegacyQualityPlan(choice.plan) && <button type="button" className="rounded-md border px-3 py-1.5"
        disabled={saving} onClick={() => { setEditing(true); onEdit(true); }}>编辑持仓监测条件</button>}
      <button type="button" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-40"
      disabled={!monitor || !state.ready || saving || !!issue || (!!id && !choice)} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</button></div>
  </div>;
}

const settingsItem = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11px] outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-40';
const focusSettings = (panel: HTMLDivElement | null) => panel?.focus({ preventScroll: true });

export function FishInstantTrading({ state, children }: { state: FishQualityState; children: ReactNode }) {
  const [settingsView, setSettingsView] = useState<'menu' | 'before' | 'after' | 'live' | null>(null);
  const [editingAfter, setEditingAfter] = useState(false);
  const follow = useScreenedInstantPositions()?.usdtFollow;
  const [pairCode, setPairCode] = useState('');
  const [pairIssue, setPairIssue] = useState('');
  const automatic = state.automaticScreening, cda = state.cdaTracking;
  const settingsLabel = settingsView === 'before' ? '买前设置' : settingsView === 'after' ? '买后设置' : settingsView === 'live' ? '币安 U 本位实盘' : '即时交易设置';
  const closeSettings = () => { setSettingsView(null); setEditingAfter(false); };
  const screening = !!state.preEntry?.automaticRunning && !automatic?.paused;
  const pending = automatic?.pending ?? 0;
  const screeningStatus = screening ? '筛选中' : automatic?.paused ? '已暂停' : pending ? `待筛选 ${pending} 条` : '空闲';
  const needsSettings = pending > 0 && !(automatic?.settings ?? state.preEntry?.library.settings)?.plans.length;
  const screeningIssue = state.preEntry?.automaticError || automatic?.attemptIssue;
  return <FishQualityModule title="即时交易" icon={Zap} testId="quality-instant-controls" subsection={children}
    summary={<FishQualityInfo label="即时交易说明"><p>自动筛选捕捞信号，入选后建立模拟持仓，最终平仓后归入交易战役的「即时交易」。</p></FishQualityInfo>}
    status={automatic && <>
      <span role="status">{screeningStatus}</span>
      {follow?.paired && <span role="status">{follow.connected ? follow.paused ? 'U 本位 · 已暂停开仓和加仓' : 'U 本位 · 本机实盘跟随中' : follow.issue || 'U 本位 · 正在连接'}</span>}
      {needsSettings && <span>请先保存买前设置</span>}
      {screening && <progress aria-label="筛选鱼进度" className="h-1 w-16 accent-primary"/>}
      {!!cda?.active && <span>持仓监测中 {cda.active} 条</span>}
      {!!cda?.awaitingMail && <span>待发邮件 {cda.awaitingMail} 条</span>}
      {(cda?.error || cda?.campaignIssue) && <span role="alert" className="text-destructive">{cda.error || cda.campaignIssue}</span>}
      {screeningIssue && <span role="alert" className="text-destructive">{screeningIssue}</span>}
      {automatic.storageIssue && <span role="alert" className="text-destructive">本机队列暂未保存，正在重试，请保留页面</span>}
    </>}>
    <button type="button" className={automatic?.paused ? qualityPrimaryAction : qualityPauseAction} disabled={!automatic}
      onClick={() => automatic?.setAutoPaused(!automatic.paused)}>
      {automatic?.paused ? <><Play className="h-3 w-3"/>继续筛选</> : <><Pause className="h-3 w-3"/>暂停筛选</>}
    </button>
    <Popover open={settingsView !== null} onOpenChange={open => open ? setSettingsView('menu') : closeSettings()}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="即时交易设置" title="即时交易设置"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
          <Ellipsis aria-hidden className="h-4 w-4"/>
        </button>
      </PopoverTrigger>
      <FishPopoverContent align="start" collisionPadding={12} aria-label={settingsLabel}
        className={settingsView === 'before' ? 'fish-condition-settings screening-settings-popover'
          : settingsView === 'after' ? (editingAfter ? 'fish-condition-settings' : 'w-80 max-w-[calc(100vw-24px)] p-0') : settingsView === 'live' ? 'w-80 max-w-[calc(100vw-24px)] p-3' : 'w-36 p-1'}>
        {settingsView === 'menu' && <>
          <button type="button" className={settingsItem} disabled={!state.ready || !state.preEntry?.ready || !automatic?.saveSettings}
            title={automatic?.settings?.plans[0]?.label ?? '沿用动态筛选'} onClick={() => setSettingsView('before')}>
            <Settings2 aria-hidden className="h-3 w-3"/>买前设置
          </button>
          <button type="button" className={settingsItem} disabled={!state.ready || !state.instantMonitor}
            title={state.instantMonitor?.settings?.name ?? '即时交易默认规则'} onClick={() => setSettingsView('after')}>
            <Settings2 aria-hidden className="h-3 w-3"/>买后设置
          </button>
          {follow && <button type="button" className={settingsItem} onClick={() => { setPairCode(''); setPairIssue(''); setSettingsView('live'); }}>
            <Zap aria-hidden className="h-3 w-3"/>币安 U 本位
          </button>}
        </>}
        {settingsView === 'live' && follow && <div ref={focusSettings} tabIndex={-1} className="space-y-3 text-xs outline-none">
          <p className="font-medium">币安 U 本位实盘</p>
          <p role="status" className="text-muted-foreground">{follow.connected
            ? follow.paused ? '已暂停开仓和加仓，现有实盘战役继续处理减仓和平仓。' : '已连接。本机跟随开启后的新即时交易。'
            : follow.issue || '在 Windows 启动执行端，将它生成的配对码填在这里。'}</p>
          <p className="select-all break-all text-muted-foreground">账号 ID {follow.owner}</p>
          <form className="flex items-center gap-2" onSubmit={event => {
            event.preventDefault();
            try { follow.connect(pairCode); setPairIssue(''); setPairCode(''); }
            catch (error) { setPairIssue(error instanceof Error ? error.message : '配对失败'); }
          }}>
            <input aria-label="本机配对码" type="password" autoComplete="off" spellCheck={false} value={pairCode}
              onChange={event => setPairCode(event.target.value)} className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5"/>
            <button type="submit" disabled={!pairCode} className="rounded border px-2 py-1.5 disabled:opacity-40">连接</button>
          </form>
          {pairIssue && <p role="alert" className="text-destructive">{pairIssue}</p>}
          {follow.connected && <button type="button" className="rounded border px-2 py-1.5" onClick={follow.paused ? follow.resume : follow.pause}>
            {follow.paused ? '恢复开仓和加仓' : '暂停开仓和加仓'}
          </button>}
        </div>}
        {settingsView === 'before' && automatic?.saveSettings && <div ref={focusSettings} tabIndex={-1} className="outline-none">
          <FishPreEntrySettings state={state} selectedCount={0} done={closeSettings}
            automatic={{ settings: automatic.settings, save: automatic.saveSettings }}/>
        </div>}
        {settingsView === 'after' && <div ref={focusSettings} tabIndex={-1} className="outline-none">
          <HoldingTemplateSettings state={state} done={closeSettings} onEdit={setEditingAfter}/>
        </div>}
      </FishPopoverContent>
    </Popover>
  </FishQualityModule>;
}
