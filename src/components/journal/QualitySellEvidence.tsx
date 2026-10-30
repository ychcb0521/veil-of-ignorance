import {holdingVetoLabel} from '@/lib/fish/qualityVeto';
import {qualityAdditionFills} from '@/lib/fish/qualityAddition';
import type { TradeCampaign } from '@/types/journal';
import { chartFeatureDef } from '@/lib/featureSource';
import { definitionKey } from '@/lib/deepDig/features';
import { formatUTC8 } from '@/lib/timeFormat';

type SellEvidence = NonNullable<TradeCampaign['comparison']>['sellEvidence'];
export function QualitySellTiming({ evidence }: { evidence: SellEvidence }) {
  if (!evidence || evidence.confirmedAt == null || !Number.isFinite(evidence.confirmedAt) || evidence.reading == null || !Number.isFinite(evidence.reading)) return null;
  if(evidence.triggerCause?.kind==='mirror-take-profit' && evidence.mirrorFill) return <aside className="mx-2 mb-2 space-y-1 rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px]" data-testid="quality-sell-timing">
    <b className="font-medium">镜像止盈 · 全部卖出</b><p>涨幅 ≥ {evidence.mirrorFill.gainPct}% · 价格 {evidence.mirrorFill.price.toPrecision(9)} · {formatUTC8(evidence.mirrorFill.at)}</p>
    <p className="text-muted-foreground">{evidence.mirrorFill.atOpen?'开盘已超过门槛，按开盘价成交。':'分钟内触及止盈限价，按止盈价模拟成交；分钟内的具体秒数不可确定。'}</p></aside>;
  if(evidence.triggerCause?.kind==='addition-geometric-profit'){const c=evidence.triggerCause,b=c.additionBasis;return <aside className="mx-2 mb-2 space-y-1 rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px]" data-testid="quality-addition-profit-evidence"><b>加仓止盈 · 全部余仓与加仓卖出</b><p>{holdingVetoLabel(c)}</p>{b&&<p>实际几何仓位 {b.geometricMultiple.toPrecision(8)}× · 均衡价 K {b.equilibriumPrice.toPrecision(8)} · 目标价 {b.targetPrice.toPrecision(8)}</p>}<p>{evidence.triggerAtOpen?'开盘已达标，按开盘价成交。':'盘中触及目标价成交；同分钟同时触及保护止损且先后不明时，优先止损。'}</p></aside>;}
  if(evidence.triggerCause?.kind==='addition-support') return <aside className="mx-2 mb-2 space-y-1 rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px]" data-testid="quality-sell-timing"><b className="font-medium">加仓支撑线 K · 止损卖出剩余持仓</b><p>K＝{evidence.triggerCause.threshold.toPrecision(9)} · {formatUTC8(evidence.executedAt??evidence.confirmedAt)}</p><p className="text-muted-foreground">{evidence.triggerAtOpen?'开盘跳空越过 K，按开盘价成交。':'分钟内触及 K，按支撑价成交；同分钟先后不明时优先止损。'}</p></aside>;
  const shortDrop = evidence.triggerCause?.kind === 'drop-1m' || evidence.triggerCause?.kind === 'drop-5m';
  if (shortDrop) return <aside className="mx-2 mb-2 space-y-1 rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px]" data-testid="quality-sell-timing">
    <b className="font-medium">一票否决 · {evidence.triggerCause!.label} · 分钟收盘确认</b>
    <p className="font-mono">跌幅 {evidence.reading.toPrecision(9)}% ≥ {evidence.triggerCause!.threshold}% · 确认 {formatUTC8(evidence.confirmedAt)}</p>
    <p className="text-muted-foreground">以滚动窗口起点开盘价为基准，按已收盘分钟计算；不足完整窗口时从买入时刻起算。{evidence.barOpenAt != null && `窗口起点 ${formatUTC8(evidence.barOpenAt)}。`}{evidence.executedAt != null ? `按 ${formatUTC8(evidence.executedAt)} 的分钟开盘价成交。` : '已触发，等待下一分钟开盘数据。'}普通指标副图不用于核对这一跌幅读数。</p>
  </aside>;
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
    <p className="text-muted-foreground">{evidence.triggerAtOpen ? '开盘价已越过持仓回撤阈值，当分钟开盘即触发，未使用该分钟后续高低价。' : evidence.triggerCause?.kind.endsWith('drawdown') ? '按已完成分钟的持仓价格路径检查回撤；同一分钟高低点顺序不明时不假定高点先发生，精度为 1 分钟。' : '用当时已完成的 1 分钟行情逐步复原原周期指标，精度为 1 分钟。'}{evidence.executedAt != null ? `按 ${formatUTC8(evidence.executedAt)} 起的 1 分钟 K 线开盘价成交。` : '已确认达标，等待分钟开盘数据，尚未记为成交。'}{evidence.triggerCause?.kind.endsWith('drawdown') ? '回撤依据持仓价格路径。' : '下方副图画的是原周期最终收盘值，可能与盘中触发读数不同。'}</p>
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

function SellEvidenceBody({ evidence, repair }: { evidence: NonNullable<TradeCampaign['comparison']>['sellEvidence']; repair?: NonNullable<TradeCampaign['comparison']>['repair'] }) {
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
      {evidence.triggerCause && <b className="font-medium text-destructive">实际触发：{['mirror-take-profit','addition-support'].includes(evidence.triggerCause.kind)?'':'一票否决 · '}{evidence.triggerCause.label} {evidence.triggerCause.direction} {evidence.triggerCause.threshold}{['indicator','addition-support'].includes(evidence.triggerCause.kind)?'':'%'}</b>}
      {evidence.reading != null && <span className="font-mono">触发读数 {evidence.reading.toPrecision(9)}</span>}
      {evidence.confirmedAt != null && <span>达标确认时刻 {formatUTC8(evidence.confirmedAt)}</span>}
      {evidence.executedAt != null && <span>成交时刻 {formatUTC8(evidence.executedAt)}</span>}
    </div>
    <p className="text-muted-foreground">{evidence.triggerCause?.kind === 'addition-support' ? '本次按加仓支撑线 K 止损，触线按支撑价卖出剩余币数，跳空越线按开盘价成交。' : evidence.triggerCause?.kind === 'mirror-take-profit' ? '本次按镜像止盈全部卖出，按止盈限价模拟成交；高开超过门槛时按开盘价成交。' : evidence.triggerCause?.kind === 'drop-1m' || evidence.triggerCause?.kind === 'drop-5m' ? '本次按滚动短时跌幅触发：窗口起点开盘价至最新分钟收盘价，买入后逐分钟检查；达到阈值后按下一分钟开盘价模拟成交。普通指标副图不用于核对这一跌幅读数。' : evidence.triggerCause?.kind.endsWith('drawdown') ? (evidence.triggerAtOpen ? '本次开盘跳空已越过持仓回撤阈值，按该分钟开盘价触发并成交，未等待这一分钟收盘。' : '本次按持仓回撤一票否决卖出，以已完成分钟确认，按下一分钟开盘价成交；跳空可能使实际回撤超过阈值。') : evidence.execution === 'intrabar-1m' ? `按 1 分钟逐步复原 ${evidence.interval} 指标，首次达标后取紧接的分钟开盘价。下方副图显示原周期最终收盘读数，不能据此倒推盘中首次达标时间。` : `按 ${evidence.interval} K 线收盘确认卖出，成交价取确认时刻起的 1 分钟 K 线开盘价。图上指标点按 K 线开盘位置绘制，最终读数到收盘才确定。`}</p>
    {repair?.status === 'verified' && repair.beforeReturnPct != null && <p className="text-muted-foreground">纠错前收益 {repair.beforeReturnPct.toFixed(2)}%{repair.beforeEndTime ? ` · 原卖出 / 估值时间 ${formatUTC8(repair.beforeEndTime)}` : ''}。原值已保留在纠错记录中。</p>}
    {repair && repair.status !== 'verified' && <p role="alert" className="text-destructive">{repair.status === 'pending' ? '此战役正在等待纠错，原结果暂不计入比较统计。' : `此战役纠错未通过：${repair.error}。原记录保留，暂不计入比较统计。`}</p>}
    {differs && <p role="status" className="text-amber-700 dark:text-amber-400">本战役公式与当前账号公式不同。下方通用指标图使用当前账号设置，不能用其读数核对这份历史结果；请回鱼质量重新运行，生成当前公式的比较结果。</p>}
    {evidence.mirrorTakeProfit?.enabled && <div className="rounded border border-primary/20 bg-primary/5 px-2 py-1.5 text-[11px]" data-testid="quality-mirror-evidence"><b className="font-medium">镜像止盈：涨幅 ≥ {evidence.mirrorTakeProfit.gainPct}% · 卖出初始币数 {evidence.mirrorTakeProfit.sellPct}%</b><p className="mt-1 text-muted-foreground">{evidence.mirrorFill?`已成交：${formatUTC8(evidence.mirrorFill.at)} · 价格 ${evidence.mirrorFill.price.toPrecision(9)} · ${evidence.mirrorFill.atOpen?'开盘价':'止盈限价'}；每笔持仓仅执行一次。`:'截至本次估值尚未触发。'}收益合并已兑现盈亏与剩余币数估值。</p></div>}
    {!!evidence.holdingVetoes?.length && <details><summary className="cursor-pointer text-muted-foreground">查看持仓一票否决条件</summary><ul className="mt-1 space-y-1">{evidence.holdingVetoes.map(v=><li key={v.id}>{holdingVetoLabel(v)}{v.formula&&<pre className="whitespace-pre-wrap rounded bg-muted/40 p-2">{v.formula}</pre>}</li>)}</ul></details>}
    <details><summary className="cursor-pointer text-muted-foreground">查看本次实际卖出公式</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px]">{evidence.formula}</pre></details>
  </section>;
}

export function QualitySellEvidence(props: { evidence: SellEvidence; repair?: NonNullable<TradeCampaign['comparison']>['repair'] }) {
 const e=props.evidence,fills=qualityAdditionFills(e??{});if(!e)return null;
 const outcome=e.triggerCause?.label??(e.executedAt!=null?'算法卖出':'持仓监测');
 const exitReason=e.exitReason??(e.triggerCause?`${e.triggerCause.label} ${e.triggerCause.direction} ${e.triggerCause.threshold}${['static-drawdown','dynamic-drawdown','drop-1m','drop-5m'].includes(e.triggerCause.kind)?'%':''}`:'历史记录未保存具体卖出原因');
 return <>{e.executedAt!=null&&<div data-testid="quality-sell-reason" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-border/70 bg-card px-3 py-2 text-[11px]"><span className="shrink-0 font-medium">卖出原因</span><span className="text-foreground/85">{exitReason}</span><span className="ml-auto font-mono text-[10px] text-muted-foreground">{formatUTC8(e.executedAt)}</span></div>}<details data-testid="quality-evidence-details" className="rounded border border-border/70 bg-card text-[11px]"><summary className="flex min-h-9 cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 text-muted-foreground hover:bg-muted/30"><span className="font-medium text-foreground">监测依据</span><span>{outcome}</span>{fills.length>0&&<span>加仓 {fills.length} 轮</span>}<span className="ml-auto text-[10px]">条件与成交明细 ▾</span></summary><div className="space-y-2 border-t border-border/50 p-2">{e?.addition?.enabled&&<aside className="mx-2 mb-2 space-y-1 rounded border border-primary/20 bg-primary/5 px-2 py-2 text-[11px]" data-testid="quality-addition-evidence"><b className="font-medium">条件加仓 · {fills.length?`已成交 ${fills.length} 轮`:'未触发'}</b>
  {fills.length?<><div className="space-y-2">{fills.map((fill,i)=><div key={fill.at}><p>第 {i+1} 轮 · {formatUTC8(fill.at)} · {fill.label} · 读数 {fill.reading.toPrecision(8)} {fill.direction} {fill.threshold}</p><p>加仓 {fill.quantity.toPrecision(8)} 枚 · 成交价 T {fill.price.toPrecision(8)} · 成交金额 {fill.notional.toPrecision(8)} USDT</p>{fill.sizing&&<p className="text-muted-foreground">计算基准余仓 Q {fill.sizing.coinsBefore.toPrecision(8)} 枚 · 成本线 S {fill.sizing.previousSupport.toPrecision(8)} → 支撑线 K {fill.sizing.support.toPrecision(8)} · 5分钟 ATR(14) {fill.sizing.atr.toPrecision(8)}（截至 {formatUTC8(fill.sizing.atrAt)} 已收盘）· 本轮可用落袋利润 {(fill.sizing.mirrorAvailableBefore??fill.sizing.mirrorUsed).toPrecision(8)} USDT · 已计入 {fill.sizing.mirrorUsed.toPrecision(8)} USDT · 余仓安全垫贡献 {fill.sizing.baseCoins.toPrecision(8)} 枚 ＋ 落袋利润贡献 {fill.sizing.mirrorCoins.toPrecision(8)} 枚</p>}{fill.sizing?.requiredBufferAtr!=null&&<p>T−S＝{fill.sizing.costBufferAtr?.toFixed(4)} ATR ≥ {fill.sizing.requiredBufferAtr} ATR · K＝T−{fill.sizing.supportOffsetAtr??1.5}×ATR · K 平衡差 {fill.sizing.coverageGap?.toPrecision(8)} USDT</p>}{fill.conditions&&<p>同时满足：{fill.conditions.map(c=>`${c.label} ${c.direction} ${c.threshold}（读数 ${c.reading.toPrecision(8)}）`).join('；')}</p>}{fill.priceGate&&<p>涨幅门槛 ≥ {fill.priceGate.thresholdPct}% · 基准价 {fill.priceGate.referencePrice.toPrecision(8)} → 确认收盘价 {fill.priceGate.observedPrice.toPrecision(8)}（+{fill.priceGate.gainPct.toFixed(2)}%）</p>}</div>)}</div><p>累计投入 {e.totalInvested} USDT · 实际持仓均价 {e.averageEntryPrice?.toPrecision(8)}；收益率按累计投入计算。</p></>:<p>从本笔买入时刻重新探测；没有满足条件且可覆盖风险的加仓成交。</p>}
 </aside>}<QualitySellTiming evidence={e}/><SellEvidenceBody {...props}/></div></details></>;
}
