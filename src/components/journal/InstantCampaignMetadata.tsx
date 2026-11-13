import { Activity, Filter, Waves } from 'lucide-react';
import type { ReactNode } from 'react';
import { QualityMonitorSettingsButton } from '@/components/FishQualityMonitorSettingsView';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { TradeCampaign } from '@/types/journal';
import { additionVetoLabel } from '@/lib/fish/qualityAdditionVeto';
import { boxStopLabel } from '@/lib/fish/qualityBoxStop';
import type { InstantCampaignMetadata } from '@/lib/fish/instantCampaignMetadata';
import { preEntryConditionText } from '@/lib/fish/preEntryConditions';
import { usesSignalTimeGate, usesTrackedGate, type EntryMarketCondition, type EntryMarketExpression } from '@/lib/fish/preEntryThreeStage';
import { additionMetricTime } from '@/lib/fish/qualityAdditionMetric';
import { holdingVetoLabel } from '@/lib/fish/qualityVeto';
import { SCREENED_CDA_GUARD_RULE, SCREENED_PRICE_EXIT_RULE, screenedSellReason } from '@/lib/fish/screenedCda';
import { formatBeijingTime } from '@/lib/timeFormat';

const triggerStyle = 'inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground';
const unavailable = '当前没有可读取的原始设置。';

function MetadataButton({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return <Popover>
    <PopoverTrigger asChild><button type="button" className={triggerStyle} aria-label={'查看' + label}>{icon}{label}</button></PopoverTrigger>
    <PopoverContent align="start" collisionPadding={12} aria-label={label}
      className="w-[34rem] max-w-[calc(100vw-1.5rem)] max-h-[min(80dvh,var(--radix-popover-content-available-height))] space-y-3 overflow-y-auto overscroll-contain text-[11px]">
      <h4 className="text-xs font-medium">{label}</h4>
      {children}
    </PopoverContent>
  </Popover>;
}

function FishingInfo({ fishing, detectors }: { fishing?: InstantCampaignMetadata['fishing']; detectors: { id: string; label: string }[] }) {
  const algorithms = fishing?.algorithms ?? detectors.map(({ label }) => ({ label, reading: undefined, unit: undefined, interval: undefined }));
  if (!algorithms.length) return <p className="text-muted-foreground">当前没有可读取的原始捕捞记录。</p>;
  return <>
    <p>命中 {algorithms.length} 个算法{fishing?.combination ? ' · ' + (fishing.combination === 'and' ? '交集' : '并集') : ''}</p>
    <ul className="space-y-1 font-mono tabular-nums">{algorithms.map((value, index) => <li key={index} className="break-words">
      {value.label}（{value.reading == null ? '读数未保存' : String(value.reading) + (value.unit ?? '')}）{value.interval && <span className="ml-2 text-muted-foreground">{value.interval}</span>}
    </li>)}</ul>
  </>;
}

function ConditionText({ condition }: { condition: Pick<EntryMarketCondition, 'label' | 'snapshot' | 'direction' | 'threshold' | 'enabled'> & { timing?: EntryMarketCondition['timing'] } }) {
  const time = additionMetricTime(condition.snapshot);
  return <span className="break-words">
    {condition.label} {condition.direction} {condition.threshold}
    {condition.snapshot.interval ? ' · ' + condition.snapshot.interval : ''}
    {time.hl && ' · 半衰期 ' + time.hl + ' 小时'}
    {time.avgh && ' · 公式回看 ' + time.avgh + ' 小时'}
    {time.window && ' · 均值窗口 ' + time.window}
    {condition.timing ? condition.timing === 'closed' ? ' · 原周期收盘' : ' · 逐分钟复原' : ''}
    {!condition.enabled && ' · 已停用'}
  </span>;
}

function ExpressionView({ expression }: { expression: EntryMarketExpression }) {
  if ('condition' in expression) return <ConditionText condition={expression.condition}/>;
  return <div className="border-l border-border pl-2">
    <span className="text-muted-foreground">{expression.join === 'all' ? '全部满足（且）' : '任一满足（或）'}</span>
    <ul className="space-y-1 pl-2">{expression.children.map((child, index) => <li key={index}><ExpressionView expression={child}/></li>)}</ul>
  </div>;
}

function ScreeningInfo({ screening, label }: { screening?: InstantCampaignMetadata['screening']; label?: string }) {
  const plan = screening?.plan;
  if (!screening || !plan) return <><p>{label}</p><p className="text-muted-foreground">{unavailable}</p></>;
  const c = plan.preEntryThreeStage, old = plan.preEntryConditions;
  const paths = c?.requiredPaths;
  const stall = c?.stallTurn;
  const longDrawdown = c?.longDrawdown;
  return <>
    <div className="space-y-1">
      <p className="font-medium">{plan.label} · 筛选时限 {screening.hours} 小时</p>
      <p className="text-muted-foreground">{screening.engine}{screening.matchedAt && ' · 首次满足 ' + formatBeijingTime(screening.matchedAt)}</p>
    </div>
    {c ? <>
      <section className="space-y-1 rounded border border-border/60 p-2">
        <h5 className="font-medium">必要条件{c.steps?.required === false ? ' · 已跳过' : ''}</h5>
        {usesSignalTimeGate(c.version) && <p>{usesTrackedGate(c.version) && paths?.tracking
          ? paths.static ? '原信号时点优先，未达标则追踪' : '时限内追踪' : '原信号时点判断'}</p>}
        <ul className="space-y-1">{c.required.map(condition => <li key={condition.id}><ConditionText condition={condition}/></li>)}</ul>
        {c.detectors?.map(detector => <p key={detector.id}>{detector.featureId ?? '原捕捞算法'} · 门槛加严 {detector.stricterPct}% · {detector.match === 'all' ? '全部满足' : '任一满足'}</p>)}
      </section>
      <section className="space-y-1 rounded border border-border/60 p-2">
        <h5 className="font-medium">事件准入{c.steps?.admission === false ? ' · 已跳过' : ''}</h5>
        {(c.admission?.guardEnabled ?? true) && <p>{boxStopLabel(c.guard.rule)}</p>}
        <ul className="space-y-1">{c.admission?.algorithms.map(condition => <li key={condition.id}><ConditionText condition={condition}/></li>)}</ul>
        {!!screening.evidence?.admission?.met.length && <p>本次满足 {screening.evidence.admission.met.join('、')}</p>}
      </section>
      <section className="space-y-1 rounded border border-border/60 p-2">
        <h5 className="font-medium">排除检查{c.steps?.exclusion === false ? ' · 已跳过' : ''}</h5>
        {c.additionVetoes.map((veto, index) => <p key={index}>{preEntryConditionText(additionVetoLabel(veto))}{!veto.enabled && ' · 已停用'}</p>)}
        {c.hardVetoes.map(veto => <p key={veto.id}>{preEntryConditionText(holdingVetoLabel(veto))}{!veto.enabled && ' · 已停用'}</p>)}
        {c.sellRules.map(rule => <div key={rule.id} className="space-y-1">
          <p>{rule.label} · 连续 {rule.confirmation.samples} 次 · 间隔 {rule.confirmation.minutes} 分钟{!rule.enabled && ' · 已停用'}</p>
          <ExpressionView expression={rule.expression}/>
        </div>)}
        {stall && <p>滞涨转弱 · 回看 {stall.historyHours} 小时 · {stall.riseMinutes} 分钟上涨 ≥ {stall.risePct}% · 滞涨 {stall.stallMinutes} 分钟、推进 ≤ {stall.maxProgressPct}% · 转弱确认 {stall.turnMinutes} 分钟{!stall.enabled && ' · 已停用'}
          {stall.pullback?.enabled && ' · 回调 ≥ ' + stall.pullback.pct + '%'}</p>}
        {longDrawdown && <p>回看 {longDrawdown.hours} 小时 · {longDrawdown.mode === 'maximum' ? '最大' : '当前'}回撤 ≥ {longDrawdown.pct}%{!longDrawdown.enabled && ' · 已停用'}</p>}
      </section>
    </> : <>
      {plan.rule && <ConditionText condition={{ ...plan.rule, label: plan.label, snapshot: plan.snapshot, enabled: true }}/>}
      {plan.buyFilters?.map(condition => <p key={condition.id}><ConditionText condition={condition}/></p>)}
      {old?.entryVetoes.map((veto, index) => <p key={index}>{preEntryConditionText(additionVetoLabel(veto))}{!veto.enabled && ' · 已停用'}</p>)}
      {[...(old?.sellVetoes ?? []), ...(old?.hardVetoes ?? [])].map(veto => <p key={veto.id}>{preEntryConditionText(holdingVetoLabel(veto))}{!veto.enabled && ' · 已停用'}</p>)}
    </>}
    {!!screening.evidence?.readings?.some(reading => Number.isFinite(reading.value)) && <details>
      <summary className="cursor-pointer">入选时的读数</summary>
      <ul className="mt-1 space-y-1">{screening.evidence.readings.filter(reading => Number.isFinite(reading.value)).map((reading, index) =>
        <li key={index} className="break-words">{reading.label ?? reading.id}（{String(reading.value)}） · {formatBeijingTime(reading.at)}</li>)}</ul>
    </details>}
    {!!plan.frozenVersions?.length && <details><summary className="cursor-pointer">算法版本</summary>
      <ul className="mt-1 space-y-1">{plan.frozenVersions.map(item => <li key={item.key} className="break-words">{item.name} · {item.version}</li>)}</ul>
    </details>}
  </>;
}

export function InstantCampaignMetadataButtons({ campaign }: { campaign: TradeCampaign }) {
  const comparison = campaign.comparison, instant = comparison?.instant;
  if (!comparison || !instant) return null;
  const version = instant.sellEvidence?.version;
  const screening = instant.metadata?.screening;
  return <div className="flex flex-wrap gap-2">
    <MetadataButton label="捕捞信息" icon={<Waves aria-hidden className="h-3.5 w-3.5"/>}>
      <FishingInfo fishing={instant.metadata?.fishing} detectors={comparison.detectors}/>
    </MetadataButton>
    <MetadataButton label="动态筛选" icon={<Filter aria-hidden className="h-3.5 w-3.5"/>}>
      <ScreeningInfo screening={screening} label={comparison.monitorPlan ? undefined : comparison.planLabel}/>
    </MetadataButton>
    {comparison.monitorPlan ? <QualityMonitorSettingsButton plan={comparison.monitorPlan} campaign={campaign}/> :
      <MetadataButton label="持仓监测" icon={<Activity aria-hidden className="h-3.5 w-3.5"/>}>
        <p>{comparison.sellLabel}</p>
        <p>保证金 {instant.marginUsdt} USDT · {campaign.initial_leverage} 倍 · 名义仓位 {campaign.initial_main_size_usdt} USDT</p>
        {(version === SCREENED_CDA_GUARD_RULE || version === SCREENED_PRICE_EXIT_RULE) && <p>DBL-5 防守线-20261112 · 5 分钟收盘确认 · 支持手动卖出</p>}
        {instant.sellEvidence && <p>本次卖出 {screenedSellReason({ at: comparison.valuedAt, evidence: instant.sellEvidence })}</p>}
        {instant.cdaValue != null && <p>CDA 确认读数 {instant.cdaValue}</p>}
      </MetadataButton>}
  </div>;
}
