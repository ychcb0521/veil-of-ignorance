import type { TradeCampaign } from '@/types/journal';
import { chartFeatureDef } from '@/lib/featureSource';
import { definitionKey } from '@/lib/deepDig/features';
import { formatUTC8 } from '@/lib/timeFormat';

type SellEvidence = NonNullable<TradeCampaign['comparison']>['sellEvidence'];
export function QualitySellTiming({ evidence }: { evidence: SellEvidence }) {
  if (!evidence || evidence.confirmedAt == null || !Number.isFinite(evidence.confirmedAt) || evidence.reading == null || !Number.isFinite(evidence.reading)) return null;
  const period = /^([1-9]\d*)(m|h|d)$/.exec(evidence.interval);
  if (!period) return null;
  const step = Number(period[1]) * (period[2] === 'm' ? 60_000 : period[2] === 'h' ? 3_600_000 : 86_400_000);
  if (evidence.execution === 'intrabar-1m') return <aside className="mx-2 mb-2 rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px] space-y-1" data-testid="quality-sell-timing">
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <b className="font-medium">卖出方式：{evidence.triggerCause ? `一票否决 · ${evidence.triggerCause.label}` : '盘中达标即卖'} · 1 分钟复原</b>
      <span>{evidence.triggerCause?.kind.endsWith('drawdown') ? '触发价格分钟起点' : `原指标周期：${evidence.interval} · K 线起点`} {formatUTC8(evidence.barOpenAt ?? Math.floor((evidence.confirmedAt - 1) / step) * step)}</span>
      {evidence.previousAt != null && evidence.previousReading != null && <span className="font-mono">前次：{formatUTC8(evidence.previousAt)} · {evidence.previousReading.toPrecision(9)}</span>}
      <span className="font-mono">首次达标：{formatUTC8(evidence.confirmedAt)} · {evidence.reading.toPrecision(9)} {evidence.triggerCause?.direction ?? evidence.direction} {evidence.triggerCause?.threshold ?? evidence.threshold}{evidence.triggerCause && evidence.triggerCause.kind!=='indicator'?'%':''}</span>
    </div>
    <p className="text-muted-foreground">{evidence.triggerCause?.kind.endsWith('drawdown') ? '按已完成分钟的持仓价格路径检查回撤；同一分钟高低点顺序不明时不假定高点先发生，精度为 1 分钟。' : '用当时已完成的 1 分钟行情逐步复原原周期指标，精度为 1 分钟。'}{evidence.executedAt != null ? `按 ${formatUTC8(evidence.executedAt)} 起的 1 分钟 K 线开盘价成交。` : '已确认达标，等待分钟开盘数据，尚未记为成交。'}{evidence.triggerCause?.kind.endsWith('drawdown') ? '回撤依据持仓价格路径。' : '下方副图画的是原周期最终收盘值，可能与盘中触发读数不同。'}</p>
  </aside>;
  const open = evidence.confirmedAt - step;
  return <aside className="mx-2 mb-2 rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px] space-y-1" data-testid="quality-sell-timing">
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <b className="font-medium">卖出方式：{evidence.interval} 收盘确认</b>
      <span>触发 K 线：{formatUTC8(open)} → {formatUTC8(evidence.confirmedAt)}</span>
      <span className="font-mono">收盘读数 {evidence.reading.toPrecision(9)} {evidence.triggerCause?.direction ?? evidence.direction} {evidence.triggerCause?.threshold ?? evidence.threshold}{evidence.triggerCause && evidence.triggerCause.kind!=='indicator'?'%':''}</span>
    </div>
    <p className="text-muted-foreground">图上指标点画在该根 K 线的开盘位置，最终读数到收盘才确定；指标连线不表示盘中首次达标。{evidence.executedAt != null ? `确认后按 ${formatUTC8(evidence.executedAt)} 起的 1 分钟 K 线开盘价成交。` : '已确认达标，等待分钟开盘数据，尚未记为成交。'}</p>
  </aside>;
}

export function QualitySellEvidence({ evidence, repair }: { evidence: NonNullable<TradeCampaign['comparison']>['sellEvidence']; repair?: NonNullable<TradeCampaign['comparison']>['repair'] }) {
  if (!evidence) return null;
  const current = chartFeatureDef(evidence.featureId);
  const differs = !!current && definitionKey({ ...current, interval: evidence.interval as '5m' }) !== evidence.definitionKey;
  return <section className="rounded border border-border bg-card px-3 py-2 text-[11px] space-y-1.5" data-testid="quality-sell-evidence">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <b className="font-medium">卖出依据</b>
      {repair?.status === 'verified' && <span>已核验纠错 · {repair.checkedAt ? formatUTC8(repair.checkedAt) : ''}</span>}
      <span>{evidence.source === 'account' ? '运行时账号公式' : '历史公式快照'} · {evidence.version}</span>
      <span>{evidence.interval} 指标 · {evidence.execution === 'intrabar-1m' ? '盘中达标 / 1m复原' : '收盘确认'} · hl {evidence.halfLifeHours}h · avgh {evidence.avgHours}h</span>
      <span className="font-mono">{evidence.metric} {evidence.direction} {evidence.threshold}</span>
      {evidence.triggerCause && <b className="font-medium text-destructive">实际触发：一票否决 · {evidence.triggerCause.label} {evidence.triggerCause.direction} {evidence.triggerCause.threshold}{evidence.triggerCause.kind==='indicator'?'':'%'}</b>}
      {evidence.reading != null && <span className="font-mono">触发读数 {evidence.reading.toPrecision(9)}</span>}
      {evidence.confirmedAt != null && <span>达标确认时刻 {formatUTC8(evidence.confirmedAt)}</span>}
      {evidence.executedAt != null && <span>成交时刻 {formatUTC8(evidence.executedAt)}</span>}
    </div>
    <p className="text-muted-foreground">{evidence.triggerCause?.kind.endsWith('drawdown') ? '本次按持仓回撤一票否决卖出，以已完成分钟确认，按下一分钟开盘价成交；跳空可能使实际回撤超过阈值。' : evidence.execution === 'intrabar-1m' ? `按 1 分钟逐步复原 ${evidence.interval} 指标，首次达标后取紧接的分钟开盘价。下方副图显示原周期最终收盘读数，不能据此倒推盘中首次达标时间。` : `按 ${evidence.interval} K 线收盘确认卖出，成交价取确认时刻起的 1 分钟 K 线开盘价。图上指标点按 K 线开盘位置绘制，最终读数到收盘才确定。`}</p>
    {repair?.status === 'verified' && repair.beforeReturnPct != null && <p className="text-muted-foreground">纠错前收益 {repair.beforeReturnPct.toFixed(2)}%{repair.beforeEndTime ? ` · 原卖出 / 估值时间 ${formatUTC8(repair.beforeEndTime)}` : ''}。原值已保留在纠错记录中。</p>}
    {repair && repair.status !== 'verified' && <p role="alert" className="text-destructive">{repair.status === 'pending' ? '此战役正在等待纠错，原结果暂不计入比较统计。' : `此战役纠错未通过：${repair.error}。原记录保留，暂不计入比较统计。`}</p>}
    {differs && <p role="status" className="text-amber-700 dark:text-amber-400">本战役公式与当前账号公式不同。下方通用指标图使用当前账号设置，不能用其读数核对这份历史结果；请回鱼质量重新运行，生成当前公式的比较结果。</p>}
    {!!evidence.holdingVetoes?.length && <details><summary className="cursor-pointer text-muted-foreground">查看持仓一票否决条件</summary><ul className="mt-1 space-y-1">{evidence.holdingVetoes.map(v=><li key={v.id}>{v.label} {v.direction} {v.threshold}{v.kind==='indicator'?'':'%'}{v.formula&&<pre className="whitespace-pre-wrap rounded bg-muted/40 p-2">{v.formula}</pre>}</li>)}</ul></details>}
    <details><summary className="cursor-pointer text-muted-foreground">查看本次实际卖出公式</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">{evidence.formula}</pre></details>
  </section>;
}
