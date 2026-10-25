import { useState } from 'react';
import { ChevronDown, ChevronUp, Gauge, RefreshCw } from 'lucide-react';
import type { FishQualityState } from '@/hooks/useFishQuality';
import { fishStatistics } from '@/lib/fish/algorithm';
import { EXCHANGE_NAMES } from '@/lib/fish/exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { qualityDefinition, qualityExitSuggestions, qualityGroupSummary, qualityResultKey, type QualityGroup, type QualityExitRule, type QualityResult, type QualitySample } from '@/lib/fish/quality';

const field = 'min-w-0 rounded bg-muted/60 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary';
const pct = (v?: number | null) => v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const money = (v?: number | null) => v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
const date = (v?: number | null) => v ? formatUTC8(v) : '—';
const signed = (v?: number | null) => v == null ? '' : v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-destructive' : '';
const cell = 'px-3 py-2';
function Headers({ titles }: { titles: string[] }) {
  return <thead className="sticky top-0 z-10 bg-muted text-[11px] text-muted-foreground"><tr>{titles.map(t => <th key={t} className={`${cell} font-medium`}>{t}</th>)}</tr></thead>;
}
function ExitEditor({ group, apply }: { group: QualityGroup; apply: (rule?: QualityExitRule) => void }) {
  const suggestions = qualityExitSuggestions(group), initial = group.rule ?? suggestions[0].rule;
  const [metric, setMetric] = useState(initial.metric), [direction, setDirection] = useState(initial.direction), [threshold, setThreshold] = useState(String(initial.threshold)), [error, setError] = useState('');
  let variables: { name: string; label: string }[] = [], unavailable = '', captured: ReturnType<typeof qualityDefinition> | undefined;
  try { captured = qualityDefinition(group.snapshot); variables = fishStatistics(captured).filter(v => v.name !== '结果'); }
  catch (e) { unavailable = e instanceof Error ? e.message : '公式不可用'; }
  const save = () => {
    if (!threshold.trim() || !Number.isFinite(Number(threshold))) { setError('请填写有限数字门槛'); return; }
    setError(''); apply({ metric, direction, threshold: Number(threshold) });
  };
  return <div className="space-y-2 rounded border border-border/50 p-3" data-testid="fish-quality-exit-editor">
    <p className="text-xs font-medium">卖出标准 <span className="font-normal text-muted-foreground">{group.rule ? `当前：${group.rule.metric === 'capture' ? group.metric : group.rule.metric} ${group.rule.direction} ${group.rule.threshold}` : '尚未选择，先登记买入'}</span></p>
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span>建议：</span>{suggestions.map(v => <button type="button" key={v.label} className="rounded border border-border/60 px-2 py-1 hover:bg-accent" onClick={() => { setMetric(v.rule.metric); setDirection(v.rule.direction); setThreshold(String(v.rule.threshold)); }}>{v.label}</button>)}</div>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="卖出指标" className={`${field} max-w-[21rem]`} value={metric} onChange={e => setMetric(e.target.value)}><option value="capture">捕获指标 · {group.metric}（沿用捕获单位）</option>{variables.map(v => <option key={v.name} value={v.name}>{v.label}（原值）</option>)}</select>
      <select aria-label="卖出方向" className={field} value={direction} onChange={e => setDirection(e.target.value as '<' | '>')}><option value="<">&lt;</option><option value=">">&gt;</option></select>
      <input aria-label="卖出门槛" type="number" step="any" className={`${field} w-28`} value={threshold} onChange={e => setThreshold(e.target.value)} />
      <button type="button" disabled={!!unavailable} className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-40" onClick={save}>应用并重算</button>
      {group.rule && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => apply(undefined)}>移除卖出规则</button>}
    </div>
    <p className="text-[11px] text-muted-foreground">建议只填入编辑框，应用后生效。{group.snapshot.direction === '<' ? '原捕获方向为小于，上穿门槛代表该条件减弱。' : '回穿门槛较敏感，缓冲门槛允许回落，零轴等待方向反转。'}这些是待比较的规则，尚未证明哪种收益更好。</p>
    <p className="text-[11px] text-muted-foreground">卖出从买入后的算法收盘读数开始判断，触发后按下一分钟开盘价模拟成交。</p>
    {captured && <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">捕获公式及参数</summary><p className="mt-1">K 线 {captured.interval} · hl {captured.halfLifeHours} 小时 · avgh {captured.avgHours} 小时 · 捕获指标显示倍率 {group.snapshot.scale ?? 1}</p><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono">{captured.formula}</pre></details>}
    {(error || unavailable) && <p role="alert" className="text-xs text-destructive">{error || unavailable}</p>}
  </div>;
}
function SampleRow({ sample: s, result: r }: { sample: QualitySample; result?: QualityResult }) {
  const reason = r?.reason ?? '等待评估';
  return <tr className="border-t border-border/40">
    <td className={`${cell} font-mono`}>{s.source.symbol}<span className="ml-1 text-[10px] text-muted-foreground">{EXCHANGE_NAMES[s.source.exchange ?? 'binance']}</span></td>
    <td className={`${cell} font-mono`}>{date(r?.entryTime ?? s.enteredAt)}<span className="ml-1 text-[10px] text-muted-foreground">{s.basis === 'detected' ? '发现' : s.basis === 'signal' ? '信号' : s.basis === 'capture' ? '捕捞' : '时间缺失'}</span></td>
    <td className={`${cell} max-w-64 whitespace-normal ${r?.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`} title={reason}>{r?.status === 'closed' ? '已卖出' : r?.status === 'error' ? `缺数据：${reason}` : r?.status === 'open' ? `持有 · ${reason}` : reason}</td>
    <td className={`${cell} font-mono`}>{r?.entryPrice?.toPrecision(7) ?? '—'}</td><td className={`${cell} font-mono`}>{r?.endPrice?.toPrecision(7) ?? '—'}</td>
    <td className={`${cell} font-mono ${signed(r?.returnPct)}`}>{pct(r?.returnPct)}</td><td className={`${cell} font-mono ${signed(r?.pnl)}`}>{money(r?.pnl)}</td>
    {[r?.peakPct, r?.adversePct, r?.drawdownPct, r?.uncapturedPct].map((v, i) => <td key={i} className={`${cell} font-mono`}>{i >= 2 ? pct(v).replace(/^\+/, '') : pct(v)}</td>)}
    <td className={`${cell} font-mono`}>{r?.heldHours?.toFixed(2) ?? '—'}</td><td className={`${cell} font-mono`}>{date(r?.endTime)}</td>
  </tr>;
}

export function FishQuality({ state }: { state: FishQualityState }) {
  const { study, ready, running, progress } = state;
  const [open, setOpen] = useState(true), [selected, setSelected] = useState(''), [hours, setHours] = useState<string | null>(null), [hoursError, setHoursError] = useState(''), [page, setPage] = useState(0);
  const group = study.groups.find(g => g.id === selected) ?? study.groups[0];
  const summary = group ? qualityGroupSummary(study, group) : null;
  const applyHours = () => {
    const n = Number(hours ?? study.observeHours);
    if (!(n >= 0 && n <= 8784) || !Number.isFinite(n)) { setHoursError('请填写 0～8784 小时之间的数字；0 为持续至卖出'); return; }
    setHoursError(''); setHours(null); if (n !== study.observeHours) state.setObserveHours(n);
  };
  const samples = group ? study.samples.filter(s => s.groups.includes(group.id)) : [];
  const pageCount = Math.max(1, Math.ceil(samples.length / 50)), currentPage = Math.min(page, pageCount - 1);
  const results = new Map(study.results.map(r => [r.key, r]));
  return <section className="min-w-0 border-t border-border/50 px-4 py-3" aria-label="鱼质量模块" data-testid="fish-quality">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button type="button" className="inline-flex items-center gap-2 text-sm font-medium" aria-expanded={open} onClick={() => setOpen(!open)}><Gauge className="h-4 w-4 text-muted-foreground"/>鱼质量 <span className="rounded bg-primary/10 px-1 text-xs text-primary">{study.samples.length}</span>{open ? <ChevronUp className="h-3 w-3 text-muted-foreground"/> : <ChevronDown className="h-3 w-3 text-muted-foreground"/>}</button>
      <span className="text-[11px] text-muted-foreground">模拟多单 · 每条每组 100 USDT · 1 倍</span>
    </div>
    {open && <div className="mt-3 space-y-3">
      <p className="text-xs leading-relaxed text-muted-foreground">鱼舱和新鱼自动复制到这里，之后新捕获的鱼自动加入。历史鱼按原始信号时间入场，实时新鱼按实际发现时点入场；以随后首根 1 分钟 K 线开盘价近似买入。已有历史样本按此口径重新评估，卖出规则保留。副本独立保存在本机当前账号下。</p>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={study.tracking} disabled={!ready} onChange={e => state.setTracking(e.target.checked)}/>自动跟踪新鱼及更新收益</label>
        <label className="inline-flex items-center gap-1.5">观察时长<input aria-label="鱼质量观察小时" type="number" min="0" max="8784" step="any" className={`${field} w-20`} value={hours ?? study.observeHours} onChange={e => setHours(e.target.value)} onBlur={applyHours} onKeyDown={e => { if (e.key === 'Enter') applyHours(); }}/>小时（0 = 持续至卖出）</label>
        <button type="button" disabled={!ready || running || !study.samples.length} className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 disabled:opacity-40" onClick={() => void state.start()}><RefreshCw className="h-3 w-3"/>更新收益</button>
        {running && <><span role="status">评估 {progress?.done ?? 0} / {progress?.total ?? 0} · {progress?.current}</span><button type="button" className="text-muted-foreground hover:text-foreground" onClick={state.cancel}>暂停本轮</button></>}
        {!ready && <span role="status">恢复本机记录…</span>}
      </div>
      {(state.warning || state.error || hoursError) && <p role="alert" className="text-xs text-destructive">{hoursError || state.error || state.warning}</p>}
      <p className="text-[11px] text-muted-foreground">选择卖出规则后评估收益，有效样本只统计已评估记录。收益为毛收益，未扣手续费、资金费和滑点；未触发卖出保留为持有状态，不在观察期末强平。同一条鱼命中多组时分别评估，组间结果不合计为账户收益。自动更新每分钟尝试一次，页面关闭后在下次打开时补算。</p>
      {!study.groups.length ? <div className="rounded border border-dashed border-border/60 p-5 text-center text-xs text-muted-foreground">暂无可评估的鱼：捕捞到鱼后会自动加入。</div> : <>
        <div className="max-h-64 overflow-auto rounded border border-border/60"><table className="w-full whitespace-nowrap text-left text-xs"><Headers titles={['算法类型', '具体指标', '捕获门槛', '有效 / 样本', '已平 / 持有', '平均收益率', '平均最大涨幅', '已平胜率']}/><tbody>{study.groups.map(g => {
          const m = qualityGroupSummary(study, g);
          return <tr key={g.id} className={`border-t border-border/40 ${group?.id === g.id ? 'bg-primary/5' : 'hover:bg-accent/50'}`}>
            <td className={cell}><button type="button" aria-pressed={g.id === group?.id} className="text-primary underline-offset-2 hover:underline" onClick={() => { setSelected(g.id); setPage(0); }}>{g.label}</button><span className="ml-1.5 text-[10px] text-muted-foreground">#{g.id.slice(0, 5)}</span></td>
            <td className={cell}>{g.metric}</td><td className={`${cell} font-mono`}>{g.snapshot.direction ?? '>'} {g.snapshot.threshold}</td>
            <td className={cell}>{m.valid} / {m.total}{m.failed > 0 && <span className="ml-1 text-destructive">缺数据 {m.failed}</span>}</td><td className={cell}>{m.closed} / {m.open}</td>
            <td className={`${cell} font-mono ${signed(m.averageReturn)}`}>{pct(m.averageReturn)}</td><td className={`${cell} font-mono`}>{pct(m.averagePeak)}</td><td className={`${cell} font-mono`}>{m.closedWinRate == null ? '—' : `${m.closedWinRate.toFixed(2)}%`}</td>
          </tr>;
        })}</tbody></table></div>
        {group && <div className="space-y-3" data-testid="fish-quality-group">
          <p className="text-xs font-medium">{group.label} · {group.metric} · 捕获 {group.snapshot.direction ?? '>'} {group.snapshot.threshold} <span className="text-muted-foreground">#{group.id.slice(0, 5)} · {group.snapshot.interval ?? '5m'} · {summary!.total} 条</span></p>
          <ExitEditor key={`${group.id}:${JSON.stringify(group.rule)}`} group={group} apply={rule => state.setRule(group.id, rule)}/>
          <p className="text-xs text-muted-foreground">组内毛盈亏 <span className={signed(summary!.pnl)}>{summary!.valid ? money(summary!.pnl) : '—'} USDT</span> · 已平胜率只统计已卖出的鱼；平均收益包含已评估持仓的浮盈。最大回撤沿用交易战役口径：此前峰值至后续谷值，同一分钟内高低顺序未知时不强行推断。</p>
          <div className="max-h-80 overflow-auto rounded border border-border/60"><table className="w-full whitespace-nowrap text-left text-xs"><Headers titles={['标的', '买入时间 / 依据', '状态', '买入价', '卖出 / 估值价', '收益率', '盈亏 USDT', '最大涨幅', '最大不利涨跌', '最大回撤', '涨幅未兑现', '持仓小时', '卖出 / 估值时间']}/><tbody>{samples.slice(currentPage * 50, (currentPage + 1) * 50).map(s => <SampleRow key={s.id} sample={s} result={results.get(qualityResultKey(s, group, study.observeHours))}/>)}</tbody></table></div>
          {pageCount > 1 && <div className="flex items-center gap-3 text-xs text-muted-foreground"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>下一页</button></div>}
        </div>}
      </>}
    </div>}
  </section>;
}
