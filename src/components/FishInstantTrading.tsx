import { FishUsdtPositions } from './FishUsdtPositions';
import { useQualityTemplateNames } from '@/contexts/QualityTemplateNamesContext';
import type {QualityTemplateName} from '@/lib/fish/qualityTemplateNames';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { BriefcaseBusiness, Clock3, Filter, Pause, Pickaxe, Play, Settings2, Zap } from 'lucide-react';
import { useScreenedInstantPositions } from '@/contexts/FishQualityContext';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { INSTANT_TEMPLATE_MONITOR, instantMonitorTemplateIssue, type InstantMonitorPlanChoice } from '@/lib/fish/instantMonitorSettings';
import { activeQualityPlanTemplates } from '@/lib/fish/qualityPlanTemplates';
import { isLegacyQualityPlan } from '@/lib/fish/qualityLegacyEngine';
import { FishPopoverContent } from './FishPopoverContent';
import type { QualityGroup } from '@/lib/fish/quality';
import { replaceQualitySellPlans } from '@/lib/fish/qualitySellPlans';
import { instantMonitorSize } from '@/lib/fish/instantMonitorExecution';
import { FishConditionDialogContent, FishConditionSettings } from './FishConditionSettings';
import { HoldingMonitorSettings } from './FishHoldingMonitorSettings';
import { FishPreEntrySettings } from './FishPreEntrySettings';
import { FishQualityInfo, FishQualityModule, qualityPauseAction, qualityPrimaryAction, qualityRowItem, qualitySettingsAction } from './FishQualityModule';
import { fishRail } from './FishSection';
import { Popover, PopoverTrigger } from './ui/popover';
import { Dialog } from './ui/dialog';
import { USDT_EXECUTION_SAFETY } from '@/lib/fish/usdtLiveEntry';

function InstantHoldingPlanEditor({ state, plan, save, templateName }: { state: FishQualityState; plan: QualityGroup; save: (plan: QualityGroup) => Promise<void>;templateName?:QualityTemplateName }) {
  const study = useMemo(() => ({ version: 1 as const, startedAt: 0, entryMode: 'signal' as const, observeHours: 0, tracking: false,
    groups: [], samples: [], results: [], sellPlans: [plan] }), [plan]);
  return <HoldingMonitorSettings instant templateName={templateName} state={{ ...state, study, setSellPlans: plans => {
      const next = replaceQualitySellPlans(study, plans).sellPlans?.[0];
      if (next) void save(next);
    } }} activeId={plan.id} onSelect={() => {}} done={() => {}} selectedCount={0}/>;
}

function HoldingTemplateSettings({ state, done }: { state: FishQualityState; done: () => void }) {
  const names=useQualityTemplateNames();
  const monitor = state.instantMonitor;
  const selected = monitor?.settings;
  const [id, setId] = useState(selected?.templateId ?? '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [localOnly, setLocalOnly] = useState(false);
  const templates = activeQualityPlanTemplates({planTemplates:state.study.planTemplates ?? state.templateCatalog})
    .filter(template => template.entryHours == null && !template.plan.preEntryThreeStage && !template.plan.preEntryConditions);
  const template = templates.find(value => value.id === id);
  const choice = useMemo<InstantMonitorPlanChoice | undefined>(() => id === selected?.templateId && selected
    ? { id, name: selected.name, plan: selected.plan }
    : template, [id, selected, template]);
  const choiceName=choice&&names?.forMonitor(choice.plan,choice.id);
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
  if (editing && choice) return <FishConditionSettings dialog imageExport title="即时交易 · 买后设置" description="编辑本次选用的工作副本，应用于保存后新入选的持仓。">
    <button className="px-4 pt-3 text-xs text-primary" type="button" disabled={saving}
      onClick={() => setEditing(false)}>返回模板选择</button>
    <fieldset disabled={saving}>
      <InstantHoldingPlanEditor state={state} plan={choice.plan} save={save} templateName={choiceName}/>
    </fieldset>
    {saveNotice && <p role="status" className="p-3 text-xs text-muted-foreground">{saveNotice}</p>}
    {error && <p role="alert" className="p-3 text-xs text-destructive">{error}</p>}
  </FishConditionSettings>;
  const size = instantMonitorSize(choice && { version: INSTANT_TEMPLATE_MONITOR, templateId: choice.id, name: choice.name, plan: choice.plan });
  return <FishConditionSettings dialog title="即时交易 · 买后设置" description="选择自动入选和币安手动开仓使用的监测模板。">
    <div className="space-y-3">
    <label className="block space-y-1.5">
      <span className="block font-medium">持仓监测模板</span>
      <select className="w-full rounded-md border bg-background px-2 py-1.5" value={id} onChange={event => setId(event.target.value)} disabled={saving}>
        <option value="">即时交易默认规则</option>
        {selected && !templates.some(value => value.id === selected.templateId) &&
          <option value={selected.templateId} disabled>{names?.forMonitor(selected.plan,selected.templateId)?.name??selected.name}（已选快照）</option>}
        {templates.map(value => <option key={value.id} value={value.id}>{names?.names.get(value.id)?.name??value.name}</option>)}
      </select>
    </label>
    <p className="text-muted-foreground">{id
      ? '自动入选和已接手的币安手动多仓各自冻结当时的模板，按模板执行加仓、减仓和卖出。'
      : '40 USDT 保证金、5 倍。CDA-5mins 原始值低于 −10 或 DBL-5-5mins 防守线断裂时，按 5 分钟收盘确认卖出。另有下跌 5% 止损，以及上涨 2% 时卖出原始数量的 71.5%。可在持仓监测模板中选择 CDA-1h 或 DBL-5-1h。'}</p>
    {choiceName&&<p className="text-muted-foreground">原名：{choiceName.originalName}</p>}
    {choice && <p className="text-muted-foreground">首仓名义仓位 {+(size.marginUsdt * size.leverage).toPrecision(12)} USDT · {size.leverage} 倍 · 保证金 {+size.marginUsdt.toPrecision(12)} USDT</p>}
    {saveNotice && <p role="status" className="text-muted-foreground">{saveNotice}</p>}
    {(error || issue) && <p role="alert" className="text-destructive">{error || issue}</p>}
    <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t px-4">
      {choice && !issue && !isLegacyQualityPlan(choice.plan) && <button type="button" className="rounded-md border px-3 py-1.5"
        disabled={saving} onClick={() => setEditing(true)}>编辑持仓监测条件</button>}
      <button type="button" className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-40"
      disabled={!monitor || !(state.instantPreferenceStatus === 'ready' || state.ready) || saving || !!issue || (!!id && !choice)} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</button></div>
    </div>
  </FishConditionSettings>;
}

const settingsItem = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[11px] outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-40';
const focusSettings = (panel: HTMLDivElement | null) => panel?.focus({ preventScroll: true });

export function FishInstantTrading({ state, capturing, children }: { state: FishQualityState; capturing?: boolean; children: ReactNode }) {
  const [settingsView, setSettingsView] = useState<'menu' | 'before' | 'after' | 'live' | null>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const instant = useScreenedInstantPositions();
  const follow = instant?.usdtFollow;
  const live = instant?.usdtLive;
  const [pairCode, setPairCode] = useState('');
  const [pairIssue, setPairIssue] = useState('');
  const [pairSaving, setPairSaving] = useState(false);
  const automatic = state.automaticScreening, cda = state.cdaTracking;
  const instantReady = state.instantPreferenceStatus ? state.instantPreferenceStatus === 'ready' : state.ready;
  const beforeReady = instantReady && (!!automatic?.settings || !!state.preEntry?.ready);
  const settingsReady = settingsView === 'before' ? beforeReady : instantReady;
  const settingsIssue = !instantReady && state.instantPreferenceStatus === 'error'
    ? '即时交易设置读取失败' : instantReady && settingsView === 'before' ? state.preEntry?.error : undefined;
  const retrySettings = !instantReady ? state.retryInstantPreferences : state.preEntry?.retry;
  const settingsDialog = settingsView === 'before' || settingsView === 'after';
  const closeSettings = () => setSettingsView(null);
  const pending = automatic?.pending ?? 0;
  const screeningPending = automatic?.screeningPending ?? (pending > 0 && !!(automatic?.settings ?? state.preEntry?.library.settings)?.plans.length);
  const needsSettings = pending > 0 && beforeReady && !screeningPending;
  const screening = !automatic?.paused && (!!state.preEntry?.automaticRunning || screeningPending && !automatic?.waitingReason);
  const realPositions = follow?.connected && !live?.issue ? live?.snapshot?.positions : undefined;
  const liveHolding = !!realPositions?.length;
  const following = realPositions?.some(position => position.direction === 'long' && follow?.statuses.some(status =>
    status.state === 'tracking' && (status.market ?? status.symbol.replace(/\//g, '')) === position.symbol &&
    Number(position.quantity) === status.quantity));
  const holding = liveHolding || !!instant?.positions.length;
  const verifiedExecutor = follow?.executionSafety === USDT_EXECUTION_SAFETY;
  const { label: stage, icon: StageIcon } = holding ? { label: '持仓中', icon: BriefcaseBusiness }
    : !automatic?.paused && automatic?.waitingReason ? { label: automatic.waitingReason, icon: Clock3 }
    : screening ? { label: '筛选中', icon: Filter }
    : automatic?.paused && pending > 0 ? { label: '筛选已暂停', icon: Pause }
    : capturing ? { label: '捕捞中', icon: Pickaxe } : { label: '等待中', icon: Clock3 };
  const followStatus = follow?.connected
    ? follow.paused ? '已暂停开仓和加仓' : verifiedExecutor ? '本机实盘跟随中' : '本机执行端待更新'
    : follow?.issue ? '实盘跟随未连通' : '实盘跟随连接中';
  const screeningIssue = state.preEntry?.automaticError || automatic?.attemptIssue;
  return <FishQualityModule title="即时交易" icon={Zap} testId="quality-instant-controls" subsection={<div className={fishRail + ' mt-2 space-y-1'}>
    {children}{follow && <FishUsdtPositions key={follow.owner} follow={follow} live={live}
      monitorTemplates={activeQualityPlanTemplates({ planTemplates: state.study.planTemplates ?? state.templateCatalog })}/>}
  </div>}
    summary={<FishQualityInfo label="即时交易说明"><p>自动筛选捕捞信号，入选后建立模拟持仓，最终平仓后归入交易战役的「即时交易」。</p></FishQualityInfo>}
    status={automatic && <>
      {needsSettings && <span>请先保存买前设置</span>}
      {screening && holding && <span role="status" className={qualityRowItem}><Filter aria-hidden className="h-3 w-3"/>筛选中</span>}
      {state.preEntry?.automaticRunning && screening && <progress aria-label="筛选鱼进度" className="h-1 w-16 accent-primary"/>}
      {(cda?.error || cda?.campaignIssue) && <span role="alert" className="text-destructive">{cda.error || cda.campaignIssue}</span>}
      {screeningIssue && <span role="alert" className="text-destructive">{screeningIssue}</span>}
      {live?.archiveIssue && <span role="status">实盘战役 · {live.archiveIssue}</span>}
      {automatic.storageIssue && <span role="alert" className="text-destructive">本机队列暂未保存，正在重试，请保留页面</span>}
    </>}>
    <button type="button" className={automatic?.paused ? qualityPrimaryAction : qualityPauseAction} disabled={!automatic}
      onClick={() => automatic?.setAutoPaused(!automatic.paused)}>
      {automatic?.paused ? <><Play className="h-3 w-3"/>继续筛选</> : <><Pause className="h-3 w-3"/>暂停筛选</>}
    </button>
    <Popover open={settingsView === 'menu' || settingsView === 'live'} onOpenChange={open => open ? setSettingsView('menu') : closeSettings()}>
      <PopoverTrigger asChild>
        <button ref={settingsTrigger} type="button" aria-label="即时交易条件设置" className={qualitySettingsAction}>
          <Settings2 aria-hidden className="h-3 w-3"/>条件设置
        </button>
      </PopoverTrigger>
      <FishPopoverContent align="start" collisionPadding={12}
        aria-label={settingsView === 'live' ? '币安 U 本位实盘' : '即时交易条件设置'}
        className={settingsView === 'live' ? 'w-80 max-w-[calc(100vw-24px)] p-3' : 'w-36 p-1'}
        onCloseAutoFocus={event => { if (settingsDialog) event.preventDefault(); }}>
        {settingsView === 'menu' && <>
          <button type="button" className={settingsItem} disabled={!state.preEntry || !automatic?.saveSettings}
            title={automatic?.settings?.plans[0]?.label ?? '沿用动态筛选'} onClick={() => setSettingsView('before')}>
            <Settings2 aria-hidden className="h-3 w-3"/>买前设置
          </button>
          <button type="button" className={settingsItem} disabled={!state.instantMonitor}
            title={state.instantMonitor?.settings?.name ?? '即时交易默认规则'} onClick={() => setSettingsView('after')}>
            <Settings2 aria-hidden className="h-3 w-3"/>买后设置
          </button>
          {follow && <button type="button" className={settingsItem} onClick={() => { setPairCode(''); setPairIssue(''); setSettingsView('live'); }}>
            <Zap aria-hidden className="h-3 w-3 shrink-0"/>
            <span>
              <span className="block">币安 U 本位</span>
              {follow.paired && <span className="mt-0.5 block text-[10px] text-muted-foreground">{followStatus}</span>}
            </span>
          </button>}
        </>}
        {settingsView === 'live' && follow && <div ref={focusSettings} tabIndex={-1} className="space-y-3 text-xs outline-none">
          <p className="font-medium">币安 U 本位实盘</p>
          <p role="status" className="text-muted-foreground">{follow.connected
            ? follow.paused ? '已暂停开仓和加仓，现有实盘战役继续处理减仓和平仓。' : verifiedExecutor
              ? '实时新鱼入选后按冻结的买后模板开仓。币安手动仓位须逐笔确认托管。'
              : '本机执行端待更新。新版页面暂缓发送实盘开仓和加仓，已有仓位可继续减仓和平仓。'
            : follow.issue || '在本机启动执行端，将它生成的配对码填在这里。'}</p>
          <p className="select-all break-all text-muted-foreground">账号 ID {follow.owner}</p>
          <form className="flex items-center gap-2" onSubmit={async event => {
            event.preventDefault();
            if (pairSaving) return;
            setPairSaving(true);
            setPairIssue('');
            try { await follow.connect(pairCode); setPairCode(''); }
            catch (error) { setPairIssue(error instanceof Error ? error.message : '配对失败'); }
            finally { setPairSaving(false); }
          }}>
            <input aria-label="本机配对码" type="password" autoComplete="off" spellCheck={false} value={pairCode} disabled={pairSaving}
              onChange={event => setPairCode(event.target.value)} className="min-w-0 flex-1 rounded border bg-background px-2 py-1.5"/>
            <button type="submit" disabled={!pairCode || pairSaving} className="rounded border px-2 py-1.5 disabled:opacity-40">{pairSaving ? '保存中…' : '连接'}</button>
          </form>
          {pairIssue && <p role="alert" className="text-destructive">{pairIssue}</p>}
          {follow.connected && <button type="button" className="rounded border px-2 py-1.5 disabled:opacity-40" disabled={follow.paused && !verifiedExecutor} onClick={follow.paused ? follow.resume : follow.pause}>
            {follow.paused ? '恢复开仓和加仓' : '暂停开仓和加仓'}
          </button>}
        </div>}
      </FishPopoverContent>
    </Popover>
    <Dialog open={settingsDialog} onOpenChange={open => { if (!open) closeSettings(); }}>
      {settingsDialog && <FishConditionDialogContent onCloseAutoFocus={event => {
        event.preventDefault();
        settingsTrigger.current?.focus({ preventScroll: true });
      }}>
        {!settingsReady && <FishConditionSettings dialog description="核对账号保存的设置" title={settingsView === 'before' ? '即时交易 · 买前设置' : '即时交易 · 买后设置'}>
          <p role={settingsIssue ? 'alert' : 'status'}>{settingsIssue || (instantReady ? '正在读取原买前方案…' : '正在读取即时交易设置…')}</p>
          {settingsIssue && retrySettings && <button type="button" onClick={retrySettings}>重试读取</button>}
        </FishConditionSettings>}
        {settingsReady && settingsView === 'before' && automatic?.saveSettings && <FishPreEntrySettings dialog state={state} selectedCount={0}
          done={closeSettings} automatic={{ settings: automatic.settings, save: automatic.saveSettings }}/>}
        {settingsReady && settingsView === 'after' && <HoldingTemplateSettings state={state} done={closeSettings}/>}
      </FishConditionDialogContent>}
    </Dialog>
    {(automatic || liveHolding) && (liveHolding
      ? <span role="status" className="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current"/><span>持仓中{following ? '（跟随中）' : ''}</span>
      </span>
      : <span role="status" className={`${qualityRowItem} shrink-0 whitespace-nowrap`}>
        <StageIcon aria-hidden className="h-3 w-3"/><span>{stage}</span>
      </span>)}
  </FishQualityModule>;
}
