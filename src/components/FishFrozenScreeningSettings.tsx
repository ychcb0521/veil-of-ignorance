import type { QualityTemplateName } from '@/lib/fish/qualityTemplateNames';
import { additionVetoLabel } from '@/lib/fish/qualityAdditionVeto';
import { boxStopLabel } from '@/lib/fish/qualityBoxStop';
import { preEntryConditionText } from '@/lib/fish/preEntryConditions';
import { usesSignalTimeGate, usesTrackedGate, type EntryMarketCondition, type EntryMarketExpression } from '@/lib/fish/preEntryThreeStage';
import { additionMetricTime } from '@/lib/fish/qualityAdditionMetric';
import { holdingVetoLabel } from '@/lib/fish/qualityVeto';
import { formatBeijingTime } from '@/lib/timeFormat';
import type { InstantCampaignMetadata } from '@/lib/fish/instantCampaignMetadata';

const unavailable = '当前没有可读取的原始设置。';

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

export function FishFrozenScreeningSettings({ screening, label, templateName }: { screening?: InstantCampaignMetadata['screening']; label?: string; templateName?: QualityTemplateName }) {
  const plan = screening?.plan;
  if (!screening || !plan) return <><p>{label}</p><p className="text-muted-foreground">{unavailable}</p></>;
  const c = plan.preEntryThreeStage, old = plan.preEntryConditions;
  const paths = c?.requiredPaths;
  const stall = c?.stallTurn;
  const longDrawdown = c?.longDrawdown;
  return <>
    <div className="space-y-1">
      <p className="font-medium">{templateName?.name??plan.label} · 筛选时限 {screening.hours} 小时</p>
      {templateName&&<p className="text-muted-foreground">原名：{templateName.originalName}</p>}
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
