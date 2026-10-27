import { useEffect, useMemo, useState } from 'react';
import { ChartNoAxesCombined } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { FishQualityStudy, QualitySample } from '@/lib/fish/quality';
import { QUALITY_STATIC_CUTS, qualityCohortSummary, qualityStatisticsDefaultSell, qualityStatisticsEstimate, qualityStatisticsInference, qualityStatisticsSeries, type QualityInferenceMetric, type QualityInferenceRow, type QualityStatisticsCategory, type QualityStatisticSeries } from '@/lib/fish/qualityStatistics';

export interface QualityStatisticsRequest { category: QualityStatisticsCategory; variableId?: string; levelId?: string }
const names = { sell: '卖出算法', detect: '探测算法', filter: '过滤算法' };
const input = 'h-8 min-w-0 rounded-md border border-border/60 bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring';
const number = (v: number | null | undefined, suffix = '', signed = false) => v == null || !Number.isFinite(v) ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(2)}${suffix}`;
const duration = (v: number | null) => v == null ? '—' : v < 1 ? `${(v * 60).toFixed(1)} 分钟` : v < 48 ? `${v.toFixed(1)} 小时` : `${(v / 24).toFixed(1)} 天`;
const pText = (v: number | null) => v == null ? '—' : v < .001 ? '<0.001' : v.toFixed(3);
const palette = ['var(--chart-profit)', 'var(--chart-info)', 'var(--chart-importance)', '#8B78C6', 'var(--chart-loss)', 'var(--chart-neutral)'];

/** Quiet at rest, visible on hover and keyboard focus; its hit target remains usable. */
export function QualityStatisticsButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" aria-label={`统计分析 · ${label}`} title="统计分析" onClick={onClick} className="absolute right-1 top-0.5 flex h-5 w-5 items-center justify-center rounded text-muted-foreground/30 outline-none transition-colors hover:bg-background/80 hover:text-foreground focus-visible:text-foreground focus-visible:ring-1 focus-visible:ring-ring"><ChartNoAxesCombined aria-hidden className="h-3 w-3"/></button>;
}

function Pie({ title, bins, empty }: { title: string; bins: { label: string; n: number }[]; empty: string }) {
  const total = bins.reduce((n, b) => n + b.n, 0);
  let offset = 0;
  const slices = bins.map((b, i) => { const start = offset; offset += total ? b.n / total * 100 : 0; return `${palette[i % palette.length]} ${start}% ${offset}%`; });
  return <figure aria-label={title} className="min-w-0">
    <figcaption className="mb-3 text-[11px] font-medium">{title}<span className="ml-1.5 font-normal text-muted-foreground">{total} 笔</span></figcaption>
    {!total ? <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-border/60 text-[11px] text-muted-foreground">{empty}</div> : <div className="flex items-center gap-4">
      <div role="img" aria-label={`${title}：${bins.filter(b => b.n).map(b => `${b.label} ${b.n}笔，占${(b.n / total * 100).toFixed(1)}%`).join('；')}`} className="relative h-24 w-24 shrink-0 rounded-full" style={{ background: `conic-gradient(${slices.join(',')})` }}><div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-background"><span className="font-mono text-base tabular-nums">{total}</span><span className="text-[9px] text-muted-foreground">笔数占比</span></div></div>
      <ul className="min-w-0 flex-1 space-y-1 text-[10px]">{bins.map((b, i) => <li key={b.label} className={`flex items-center gap-1.5 ${b.n ? '' : 'opacity-45'}`}><span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: palette[i % palette.length] }}/><span className="min-w-0 flex-1 break-words">{b.label}</span><span className="font-mono tabular-nums">{b.n}</span><span className="w-10 text-right font-mono tabular-nums text-muted-foreground">{(b.n / total * 100).toFixed(1)}%</span></li>)}</ul>
    </div>}
  </figure>;
}
function Cohort({ series, limit }: { series: QualityStatisticSeries; limit: number }) {
  const stats = qualityCohortSummary(series.trades, limit);
  return <section aria-label={`静态回撤${limit}%以内`} className="rounded-xl border border-border/60 bg-card p-4">
    <div className="mb-4 flex items-start justify-between gap-2"><div><h3 className="text-xs font-medium">静态回撤 ≤ {limit}%</h3><p className="mt-1 text-[10px] text-muted-foreground">已卖出 {stats.n} 笔 · 盈 {stats.profit.n} / 亏 {stats.loss.n} / 平 {stats.flat}</p></div><div className="text-right"><p className="font-mono text-xl tabular-nums tracking-tight">{number(stats.winRate, '%')}</p><p className="text-[10px] text-muted-foreground">胜率</p></div></div>
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
      {(['profit', 'loss'] as const).map(kind => { const s = stats[kind]; return <div key={kind} className="space-y-3"><dl className="grid grid-cols-2 gap-2 text-[10px]"><div><dt className="text-muted-foreground">{kind === 'profit' ? '盈利时平均涨幅' : '亏损时平均跌幅'}</dt><dd className={`mt-1 font-mono text-sm tabular-nums ${kind === 'profit' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>{number(s.mean, '%')}</dd></div><div><dt className="text-muted-foreground">平均持仓时间</dt><dd className="mt-1 font-mono text-sm tabular-nums">{duration(s.held)}</dd>{s.heldN < s.n && <p className="text-[9px] text-muted-foreground">时长有效 {s.heldN}/{s.n} 笔</p>}</div></dl><Pie title={kind === 'profit' ? '盈利涨幅分布' : '亏损跌幅分布'} bins={s.bins} empty={kind === 'profit' ? '暂无盈利样本' : '暂无亏损样本'}/></div>; })}
    </div>
  </section>;
}

function Description({ series }: { series: QualityStatisticSeries }) {
  const all = qualityCohortSummary(series.trades), ex = series.excluded;
  return <div className="space-y-5">
    <div className="grid grid-cols-2 gap-3 rounded-xl bg-muted/35 p-4 sm:grid-cols-4"><Metric label="有效已卖出" value={`${all.n} 笔`}/><Metric label="平均收益" value={number(all.mean, '%', true)}/><Metric label="收益中位数" value={number(all.median, '%', true)}/><Metric label="样本标准差" value={number(all.sd, '%')}/></div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">以下三组按持仓期间实际最大静态回撤分组，包含边界且相互嵌套；≤5% 的记录也属于 ≤8% 和 ≤10%，三组不可相加。胜率 = 盈利笔数 ÷ 本组有效已卖出笔数（含持平）。</p>
    <div className="grid gap-4 xl:grid-cols-3">{QUALITY_STATIC_CUTS.map(limit => <Cohort key={limit} series={series} limit={limit}/>)}</div>
    <div className="grid gap-5 rounded-xl border border-border/60 p-4 md:grid-cols-2"><Pie title="卖出类型分布 · 全部有效已卖出" bins={all.sellTypes} empty="暂无已卖出样本"/><div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground"><p className="font-medium text-foreground">样本口径</p><p>静态回撤 = 买入价到持仓最低价的最大跌幅，最低为 0%；静态回撤缺失 {all.missingDrawdown} 笔，仅从三组回撤统计中排除。</p><p>未纳入收益统计：未买入 {ex.filtered}，过滤待判断或缺数据 {ex.pendingFilter}，持有中 {ex.open}，待评估/待设卖出 {ex.waiting}，结果缺数据 {ex.error}，收益无效 {ex.invalidReturn}。</p><p>涨跌幅饼图按笔数计占比，跌幅取亏损绝对值；区间左闭右开，第一档不含 0。收益未扣手续费、资金费和滑点。</p><p>卖出类型按保存的触发证据分类；历史触发证据不完整时显示“触发原因未记录”。</p></div></div>
  </div>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-base tabular-nums">{value}</p></div>; }

function Inference({ series, focused, category, results, estimate, onRun, busy, metric, setMetric }: {
  series: QualityStatisticSeries[]; focused: QualityStatisticSeries; category: QualityStatisticsCategory;
  results: QualityInferenceRow[] | null; estimate: ReturnType<typeof qualityStatisticsEstimate> | null; onRun: () => void; busy: boolean;
  metric: QualityInferenceMetric; setMetric: (m: QualityInferenceMetric) => void;
}) {
  return <div className="space-y-4 text-[11px]">
    <div className="rounded-xl border border-border/60 p-4 leading-relaxed"><h3 className="mb-2 font-medium">方法与比较对象</h3><p>参照水平：{focused.variable} · {focused.level}。因变量可选已卖出收益率或持仓小时；比较范围为当前所选变量的其他水平，选择“全部变量”可跨变量比较。</p><p className="mt-2 text-muted-foreground">{category === 'sell' ? '卖出方案按同一入场记录配对，只纳入双方均已卖出且因变量有效的记录；先计算逐笔差值，再按标的整簇重抽样。' : '固定同一卖出方案，比较不同算法/阈值命中的记录；按两组标的并集同步整簇重抽样，保留重叠记录的依赖。'}使用 Deep Dig 的簇 Bootstrap 引擎，1,999 次、固定种子、95% 百分位区间。至少 5 个标的簇才估计区间。</p><p className="mt-2 text-muted-foreground">{category === 'sell' ? '另给出簇级符号翻转双侧 p 值和本次比较族的 Holm 校正 p；≤12 簇穷举，其余 1,999 次。符号翻转要求零假设下簇差值对称。' : '阈值组可能重叠或嵌套，不套用独立样本 t 检验或 ANOVA；报告均值差及区间，不生成不适用的 p 值。'}同币相关通过整簇处理；跨币共同市场波动、历史选择偏差仍可能存在。这里是探索分析，不作因果或未来收益推断。</p><p className="mt-2 text-muted-foreground">回撤 ≤5%、≤8%、≤10% 是事后且嵌套的描述分组，推断使用全部有效已卖出样本，不把它们当作独立实验组。</p></div>
    <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2">因变量<select aria-label="统计比较因变量" className={input} value={metric} onChange={e => setMetric(e.target.value as QualityInferenceMetric)}><option value="return">已卖出收益率（%）</option><option value="held">持仓时间（小时）</option></select></label><button type="button" disabled={busy} onClick={onRun} className="h-8 rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50">{busy ? '计算中…' : '运行推断统计'}</button><span className="text-muted-foreground">{series.length > 1 ? `${series.length - 1} 项与参照水平的比较` : '当前仅一个水平，运行后给出区间估计'}</span></div>
    {estimate && <div className="grid gap-3 rounded-xl bg-muted/35 p-4 sm:grid-cols-3"><Metric label="参照水平 · 标的簇" value={String(estimate.clusters)}/><Metric label="平均收益 · 95% CI" value={estimate.meanCi ? `${number(estimate.meanCi[0], '%')} ～ ${number(estimate.meanCi[1], '%')}` : '簇数不足，暂不估计'}/><Metric label="胜率 · 95% CI" value={estimate.winCi ? `${number(estimate.winCi[0], '%')} ～ ${number(estimate.winCi[1], '%')}` : estimate.winReason}/></div>}
    {results && results.length > 0 && <div className="overflow-x-auto rounded-lg border border-border/60"><table className="w-full whitespace-nowrap text-left text-[11px]"><thead className="bg-muted/40 text-muted-foreground"><tr>{['比较水平 − 参照', '笔数 A / B', '重叠入场', '标的簇', metric === 'return' ? '均值差（百分点）' : '均值差（小时）', '95% CI · 未校正', 'p', 'Holm p'].map(t => <th key={t} className="px-3 py-2 font-medium">{t}</th>)}</tr></thead><tbody>{results.map(r => <tr key={r.id} className="border-t border-border/40" title={r.note}><td className="max-w-64 whitespace-normal px-3 py-3">{r.label}<span className="mt-1 block text-[10px] text-muted-foreground">{r.note}</span></td><td className="px-3 font-mono">{r.nA} / {r.nB}</td><td className="px-3 font-mono">{r.overlap}</td><td className="px-3 font-mono">{r.clusters}</td><td className="px-3 font-mono">{number(r.difference, '', true)}</td><td className="px-3 font-mono">{r.ci ? `${number(r.ci[0])} ～ ${number(r.ci[1])}` : '—'}</td><td className="px-3 font-mono">{pText(r.p)}</td><td className="px-3 font-mono">{pText(r.pHolm)}</td></tr>)}</tbody></table></div>}
    {!results && <p className="py-6 text-center text-muted-foreground">先确认参照水平与因变量，再运行；修改筛选或数据后需要重新运行。</p>}
  </div>;
}

export function FishQualityStatistics({ study, rows, request, onClose }: { study: FishQualityStudy; rows: readonly QualitySample[]; request: QualityStatisticsRequest; onClose: () => void }) {
  const [tab, setTab] = useState<'description' | 'inference' | 'results'>('description');
  const [fixedSell, setFixedSell] = useState(() => qualityStatisticsDefaultSell(study, request.category, request.levelId));
  const [variable, setVariable] = useState(request.variableId ?? '');
  const [level, setLevel] = useState(request.levelId ?? '');
  const [metric, setMetric] = useState<QualityInferenceMetric>('return'), [busy, setBusy] = useState(false);
  const [results, setResults] = useState<QualityInferenceRow[] | null>(null), [estimate, setEstimate] = useState<ReturnType<typeof qualityStatisticsEstimate> | null>(null);
  const [inferenceError, setInferenceError] = useState('');
  const series = useMemo(() => qualityStatisticsSeries(study, rows, request.category, fixedSell), [study, rows, request.category, fixedSell]);
  const variables = [...new Map(series.map(s => [s.variableId, s.variable])).entries()];
  const variableSeries = useMemo(() => series.filter(s => !variable || s.variableId === variable), [series, variable]);
  const focused = variableSeries.find(s => s.id === level) ?? variableSeries[0];
  useEffect(() => { setResults(null); setEstimate(null); setBusy(false); setInferenceError(''); }, [series, variable, focused?.id, metric]);
  const run = () => {
    if (!focused) return;
    setInferenceError('');
    setBusy(true);
    // Yield to paint the running state; cancel if scope/metric changes or the dialog closes.
    setJob({ series: variableSeries, focused, metric });
  };
  const [job, setJob] = useState<{ series: QualityStatisticSeries[]; focused: QualityStatisticSeries; metric: QualityInferenceMetric } | null>(null);
  useEffect(() => {
    if (!job || job.series !== variableSeries || job.focused.id !== focused?.id || job.metric !== metric) return;
    if (typeof Worker !== 'undefined') {
      let worker: Worker;
      try {
        worker = new Worker(new URL('../lib/fish/qualityStatistics.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }) => { if (data.error) setInferenceError(data.error); else { setEstimate(data.estimate); setResults(data.results); } setBusy(false); setJob(null); };
        worker.onerror = () => { setInferenceError('统计计算未完成，请重试。'); setBusy(false); setJob(null); };
        worker.postMessage({ series: job.series, referenceId: job.focused.id, paired: request.category === 'sell', metric: job.metric });
        return () => worker.terminate();
      } catch { setInferenceError('无法启动统计计算，请刷新后重试。'); setBusy(false); setJob(null); return; }
    }
    const timer = window.setTimeout(() => { try { setEstimate(qualityStatisticsEstimate(job.focused.trades)); setResults(qualityStatisticsInference(job.series, job.focused.id, request.category === 'sell', job.metric)); } catch { setInferenceError('统计计算未完成，请重试。'); } setBusy(false); setJob(null); }, 20);
    return () => window.clearTimeout(timer);
  }, [job, variableSeries, focused?.id, metric, request.category]);
  const summary = focused ? qualityCohortSummary(focused.trades) : null;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0" data-testid="quality-statistics-dialog">
    <DialogHeader className="shrink-0 border-b border-border/60 px-5 pb-4 pt-5 text-left"><DialogTitle className="pr-8 text-base">{names[request.category]} · 统计分析</DialogTitle><DialogDescription className="text-[11px] leading-relaxed">当前表格筛选范围内的全部入场记录 · 不受滚动位置、合并显示或行勾选影响 · 同一次入场在每个水平内只计一次</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
      <div className="sticky top-0 z-10 space-y-3 border-b border-border/50 bg-background pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-3 text-[11px]">{request.category !== 'sell' && <label className="flex items-center gap-2">固定卖出<select className={`${input} max-w-56`} aria-label="统计固定卖出方案" value={fixedSell} onChange={e => setFixedSell(e.target.value)}>{(study.sellPlans ?? []).map(p => <option key={p.id} value={p.id}>{p.label} · {p.rule ? `${p.rule.direction} ${p.rule.threshold}` : '仅否决/未设'}</option>)}</select></label>}<label className="flex items-center gap-2">变量<select className={`${input} max-w-56`} aria-label="统计算法变量" value={variable} onChange={e => { setVariable(e.target.value); setLevel(''); }}><option value="">全部变量</option>{variables.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="flex items-center gap-2">{tab === 'description' ? '查看水平' : '参照水平'}<select className={`${input} max-w-72`} aria-label="统计算法水平" value={focused?.id ?? ''} onChange={e => setLevel(e.target.value)}>{variableSeries.map(s => <option key={s.id} value={s.id}>{variable ? '' : `${s.variable} · `}{s.level}</option>)}</select></label></div>
        <div role="tablist" aria-label="统计分析内容" className="flex gap-5">{([['description', '描述统计'], ['inference', '推断统计'], ['results', '统计结果']] as const).map(([key, label]) => <button type="button" role="tab" aria-controls="quality-statistics-panel" id={`quality-statistics-tab-${key}`} aria-selected={tab === key} key={key} onClick={() => setTab(key)} className={`border-b-2 pb-2 text-xs transition-colors ${tab === key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>)}</div>
      </div>
      <div role="tabpanel" id="quality-statistics-panel" aria-labelledby={`quality-statistics-tab-${tab}`} className="pt-4">
        {!focused ? <p className="py-12 text-center text-xs text-muted-foreground">暂无算法水平。请先配置相应算法。</p> : <><p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">{focused.variable} · {focused.level} · {focused.context}</p>
          {tab === 'description' && <Description series={focused}/>}
          {tab === 'inference' && <>{inferenceError && <p role="alert" className="mb-3 text-xs text-destructive">{inferenceError}</p>}<Inference series={variableSeries} focused={focused} category={request.category} results={results} estimate={estimate} onRun={run} busy={busy} metric={metric} setMetric={setMetric}/></>}
          {tab === 'results' && summary && <div className="space-y-4 text-xs leading-relaxed"><div className="rounded-xl border border-border/60 p-4"><h3 className="mb-2 font-medium">当前样本的描述结果</h3><p>{summary.n ? `有效已卖出 ${summary.n} 笔，胜率 ${number(summary.winRate, '%')}，平均收益 ${number(summary.mean, '%', true)}，中位数 ${number(summary.median, '%', true)}；盈利 ${summary.profit.n}、亏损 ${summary.loss.n}、持平 ${summary.flat} 笔。` : '当前范围尚无有效已卖出样本，无法判断胜率或收益表现。'}</p><p className="mt-2 text-muted-foreground">{QUALITY_STATIC_CUTS.map(c => { const s = qualityCohortSummary(focused.trades, c); return `静态回撤 ≤${c}%：${s.n} 笔，胜率 ${number(s.winRate, '%')}`; }).join('；')}。</p></div><div className="rounded-xl border border-border/60 p-4"><h3 className="mb-2 font-medium">推断结果</h3>{!results ? <p className="text-muted-foreground">尚未运行当前范围的推断统计。切到“推断统计”确认方法后运行。</p> : results.length ? <ul className="space-y-3">{results.map(r => <li key={r.id}><p>{r.label} 相对参照：{r.difference == null ? '数据不足。' : `平均${metric === 'return' ? '收益' : '持仓时间'}差 ${number(r.difference, metric === 'return' ? ' 个百分点' : ' 小时', true)}。`}{r.pHolm != null ? r.pHolm < .05 ? ` Holm p = ${pText(r.pHolm)}，在本次比较族中观察到统计差异；差异方向以均值差为准。` : ` Holm p = ${pText(r.pHolm)}，证据不足以确认差异，不代表两者等效。` : r.ci ? `95% 区间${r.ci[0] <= 0 && r.ci[1] >= 0 ? '包含 0，方向尚不明确' : '未包含 0，提示探索性差异'}；未作多重区间校正，不据此判定最优。` : r.note}</p></li>)}</ul> : <p className="text-muted-foreground">仅一个水平，已给出参照水平的区间估计，无组间比较。</p>}</div><p className="text-[11px] text-muted-foreground">以上结论只针对当前历史样本。算法水平可能同时改变附加约束、买入条件或持仓否决，差异不能自动归因于阈值；事后选择回撤较小的交易也不能证明事前可筛出这些交易。请使用独立时段或样本外数据复核。</p></div>}
        </>}
      </div>
    </div>
  </DialogContent></Dialog>;
}
