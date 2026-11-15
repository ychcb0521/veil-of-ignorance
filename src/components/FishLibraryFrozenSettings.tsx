import {useQualityTemplateNames} from '@/contexts/QualityTemplateNamesContext';
import type { FishQualityStudy, QualityBuyFilter, QualityGroup } from '@/lib/fish/quality';
import type { QualityFilterRoundSnapshot, QualityFilterSetting } from '@/lib/fish/qualityFilterLibrary';
import type { PreEntryRound } from '@/lib/fish/preEntryMonitor';
import type { QualityMonitorSetting } from '@/lib/fish/qualityMonitorLibrary';
import { filterLibraryCondition, libraryCondition } from '@/lib/fish/libraryConditions';
import { qualityMonitorTimeLabels, type QualityMonitorTimeBasis } from '@/lib/fish/qualityAdmissionTime';
import { FishLibraryCondition } from './FishLibraryConditions';
import { FishFrozenScreeningSettings } from './FishFrozenScreeningSettings';
import { FishQualityMonitorSettingsView } from './FishQualityMonitorSettingsView';

const card = 'space-y-2 rounded-lg border border-border/60 p-3';
const missing = 'text-muted-foreground';

function FrozenFilters({ filters }: { filters: readonly QualityBuyFilter[] }) {
  if (!filters.length) return <p className={missing}>本轮没有保存过滤条件。</p>;
  return <ul className="space-y-2">{filters.map((filter,index) =>
    <li key={filter.id+':'+index}>
      {filter.label && <p>{filter.label}{!filter.enabled && ' · 已停用'}</p>}
      <FishLibraryCondition condition={filterLibraryCondition(filter)}/>
    </li>,
  )}</ul>;
}

export function FilterDirectorySettings({ settings, snapshot }: {
  settings: QualityFilterSetting[];
  snapshot?: QualityFilterRoundSnapshot;
}) {
  return <>
    {settings.length > 0 ? settings.map(setting => <section className={card} key={setting.id}>
      <h5 className="font-medium">{setting.plans.length ? setting.plans.join('、') : '静态过滤条件'}</h5>
      {setting.filters.length > 1 && <p className={missing}>以下条件全部满足</p>}
      <FrozenFilters filters={setting.filters}/>
    </section>) : <p className={missing}>这项目录未保存过滤设置。</p>}
    {!!snapshot?.signalMetrics?.length && <section className={card}>
      <h5 className="font-medium">信号读数算法</h5>
      {snapshot.signalMetrics.map(metric => <div key={metric.id}>
        <p>{metric.label}</p>
        <FishLibraryCondition condition={libraryCondition({
          ...metric.snapshot, statistic:metric.metric, direction:undefined, threshold:undefined,
        }, '该轮信号读数的公式快照')}/>
      </div>)}
    </section>}
  </>;
}

export function ScreeningDirectorySettings({ round }: { round: PreEntryRound }) {
  const names=useQualityTemplateNames();
  if (!round.plans?.length) return <>
    <p>筛选时限 {round.hours} 小时{round.engine && ' · '+round.engine}</p>
    <p className={missing}>历史轮次只记录了以下条件。</p>
    <FrozenFilters filters={round.filters}/>
  </>;
  return <>{round.plans.map(plan => <section className={card} key={plan.id}>
    <FishFrozenScreeningSettings templateName={names?.forPlan(plan,'screen',round.hours)} screening={{ plan, hours:round.hours, engine:round.engine }}/>
  </section>)}</>;
}

function HoldingPlan({ plan, setting, hours }: { plan: QualityGroup; setting?: QualityMonitorSetting; hours?: number }) {
  const alias=useQualityTemplateNames()?.forPlan(plan);
  const stored = setting ?? plan.positionManagement;
  const size = stored && Number.isFinite(stored.leverage) && stored.leverage > 0 && Number.isFinite(stored.notional) && stored.notional > 0
    ? { leverage:stored.leverage, notional:stored.notional, marginUsdt:stored.notional/stored.leverage } : undefined;
  const observeHours=setting?.observeHours??hours;
  return <section className={card}>
    <h5 className="font-medium">{alias?.name??plan.label}</h5>
    {alias&&<p className={missing}>原名：{alias.originalName}</p>}
    {observeHours!==undefined && <p>监测时限 {observeHours} 小时</p>}
    {!size&&<p className={missing}>原归档未单独记录仓位规模。</p>}
    {setting?.filtersKnown===false ? <p className={missing}>历史买前过滤条件未记录。</p> :
      !!plan.buyFilters?.length && <details className="space-y-2"><summary className="cursor-pointer">买前过滤条件</summary><FrozenFilters filters={plan.buyFilters}/></details>}
    <FishQualityMonitorSettingsView plan={plan} showSize={!!size} size={size} savedOnly/>
  </section>;
}

export function MonitorDirectorySettings({ settings, timeBasis }: {
  settings: QualityMonitorSetting[];
  timeBasis?: QualityMonitorTimeBasis;
}) {
  if (!settings.length) return <p className={missing}>这轮监测没有可读取的原始设置。</p>;
  return <>
    {timeBasis && <p>监测起点 · {qualityMonitorTimeLabels[timeBasis]}</p>}
    {settings.map(setting => <HoldingPlan key={setting.id} plan={setting.plan} setting={setting}/>)}
  </>;
}

export function ArchiveDirectorySettings({ study }: { study: FishQualityStudy }) {
  const recordedGroups=new Set(study.results.map(result=>result.groupId));
  const plans=study.sellPlans?.length ? study.sellPlans : study.groups.filter(group=>recordedGroups.has(group.id));
  if(!plans.length)return <p className={missing}>原归档未保存可读取的持仓监测方案。</p>;
  return <>{plans.map(plan=><HoldingPlan key={plan.id} plan={plan} hours={study.observeHours}/>)}</>;
}
