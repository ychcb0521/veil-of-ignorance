import { Fragment, useMemo } from 'react';
import type { FishReconstructionState } from '@/hooks/useFishReconstruction';
import type { FishReconstructionResult } from '@/lib/fish/reconstruction';
import { formatUTC8 } from '@/lib/timeFormat';

export const reconstructionSkipLabels: Record<string, string> = { gap: '缺口', history: '历史不足', retention: '超出保留期', failed: '请求失败', readings: '读数不全' };
const number = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? '—' : Number(v.toPrecision(6)).toString();
const rate = (v: number | null | undefined) => v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`;
const columns = ['算法', '最佳门槛', '严格捕获', '宽松捕获', '噪音 / 币·天', '精确率', 'F1', '有效 / 总数'];
type Metrics = FishReconstructionResult['algorithms'][number]['test'];
function MetricCells({ m }: { m: Metrics }) {
  return <><td>{rate(m.strictRate)}</td><td>{rate(m.looseRate)}</td><td>{number(m.noiseRate)}</td><td>{rate(m.precision)}</td><td>{rate(m.f1)}</td><td>{m.valid} / {m.total}</td></>;
}
function skipText(m: Metrics) { return Object.entries(m.skipped).filter(([, n]) => n).map(([k, n]) => `${reconstructionSkipLabels[k] ?? k} ${n}`).join(' · ') || '无'; }
export function FishReconstructionResults({ state }: { state: FishReconstructionState }) {
  const { result, stale, progress, running, error, warning } = state;
  const ranked = useMemo(() => [...(result?.algorithms ?? [])].sort((a, b) => (b.test.f1 ?? -1) - (a.test.f1 ?? -1) || (a.test.noiseRate ?? Infinity) - (b.test.noiseRate ?? Infinity)), [result]);
  if (!result && !running && !progress && !error && !warning) return null;
  return <section aria-label="复原结果" data-testid="fish-reconstruction-results" className="min-w-0 space-y-2 rounded-md border border-border/50 p-2.5 text-[11px]">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-medium">复原 {stale && <span className="text-muted-foreground" data-testid="fish-reconstruction-stale">· 已过期，需重新评估</span>}</span>
      <span className="text-[10px] text-muted-foreground">仅信号库 · 全部卡片 · 结果序列 · &gt; · 后 30% 验证</span>
      {result && <span className="text-[10px] text-muted-foreground/60" title="仅保存在本机，不改写信号">{formatUTC8(result.createdAt)} · 本机</span>}
    </div>
    {running && <div role="status" className="flex flex-wrap items-center gap-2 text-muted-foreground">
      <span>复原中 · {progress?.phase === 'thresholds' ? '门槛评估' : '历史取数'} · {progress?.done ?? 0} / {progress?.total ?? 0} {progress?.current}</span>
      <button type="button" className="rounded px-1 hover:text-foreground" onClick={state.cancel}>取消复原</button>
    </div>}
    {!running && progress?.status === 'cancelled' && <p className="text-muted-foreground">复原已取消；未完成的结果不保存。</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}{warning && <p className="text-muted-foreground">{warning}</p>}
    {result && <><div className={`overflow-x-auto ${stale ? 'opacity-50' : ''}`}>
      <table className="w-full min-w-[740px] border-collapse text-left text-[10px] [&_td]:px-2 [&_td]:py-2 [&_th]:px-2 [&_th]:py-1.5">
        <thead className="border-b border-border/50 text-muted-foreground"><tr>{columns.map(c => <th className="whitespace-nowrap font-normal" key={c}>{c}</th>)}</tr></thead>
        <tbody>{ranked.map((a, i) => <Fragment key={`${a.key}:${i}`}>
          <tr className="border-b border-border/30 font-mono tabular-nums" data-testid="fish-reconstruction-row">
            <td><span className="font-sans">{a.label}</span>{i === 0 && a.test.f1 != null && a.bestThreshold != null && <span className="ml-1 rounded bg-primary/10 px-1 py-0.5 font-sans text-[9px] text-primary" title="后 30% 信号的 F1 最高；属于匹配推断">最可能</span>}</td>
            <td title={a.bestThreshold == null ? '前 70% 没有有效样本，无法选择门槛' : `前 70% 选择 · 完整门槛 ${a.bestThreshold} · ${a.unit || '无量纲'}`}>{number(a.bestThreshold)}</td><MetricCells m={a.test}/>
          </tr>
          <tr><td colSpan={8} className="!py-1"><details className="text-muted-foreground">
            <summary className="w-fit cursor-pointer text-[10px]">门槛扫描与跳过原因</summary>
            <p className="my-2">训练：{a.train.valid} / {a.train.total} 条；跳过：{skipText(a.train)}。验证：{a.test.valid} / {a.test.total} 条；跳过：{skipText(a.test)}。</p>
            <p className="my-2">最佳门槛按训练 F1 最高选择，并列取噪音率低者。严格起点在信号前 1 根内，宽松在前 1 小时内；噪音窗口按同币去重。</p>
            <table className="w-full text-left font-mono tabular-nums"><thead><tr>{['门槛', '样本', ...columns.slice(2)].map(c => <th key={c} className="font-sans font-normal">{c}</th>)}</tr></thead>
              <tbody>{a.scan.map((s, k) => <Fragment key={k}><tr className="border-t border-border/30"><td rowSpan={2} title={String(s.threshold)}>{number(s.threshold)}{s.threshold === a.bestThreshold && <span className="ml-1 font-sans text-primary">最佳</span>}{s.threshold === a.currentThreshold && <span className="ml-1 font-sans">当前</span>}</td><td className="font-sans">前 70%</td><MetricCells m={s.train}/></tr><tr><td className="font-sans">后 30%</td><MetricCells m={s.test}/></tr></Fragment>)}</tbody>
            </table>
          </details></td></tr>
        </Fragment>)}</tbody>
      </table>
    </div><p className="text-[10px] text-muted-foreground/70">门槛只在前 70% 选择；表中指标只用后 30%。每条信号仅使用其时刻前已收盘的 K 线。</p></>}
  </section>;
}
export interface SignalReconstructionMatch { parts: { label: string; loose: boolean }[]; title: string; stale: boolean }
export function reconstructionMatches(result: FishReconstructionResult | null, mode: 'best' | 'current', stale: boolean): Map<string, SignalReconstructionMatch> {
  const matches = new Map<string, SignalReconstructionMatch>();
  for (const a of result?.algorithms ?? []) for (const row of a.perSignal) {
    let match = matches.get(row.id);
    if (!match) { match = { parts: [], title: stale ? '已过期：设置或信号库已变化，需重新评估。\n' : '', stale }; matches.set(row.id, match); }
    const threshold = mode === 'best' ? a.bestThreshold : a.currentThreshold;
    const evaluation = mode === 'best' ? row.best : row.current;
    const start = evaluation?.start == null ? evaluation?.unknown ? '起点不明' : '—' : formatUTC8(evaluation.start);
    const outcome = row.skip ? `跳过：${reconstructionSkipLabels[row.skip] ?? row.skip}（${row.reason ?? ''}）` : !evaluation ? '无可用门槛' : evaluation.strict ? '严格匹配' : evaluation.loose ? '仅宽松匹配' : evaluation.unknown ? '起点不明' : '未匹配';
    match.title += `${a.label} > ${threshold ?? '—'} · t 时读数 ${row.reading ?? '—'} · 起点 ${start} · ${outcome}\n`;
    if (evaluation && (evaluation.strict || evaluation.loose)) match.parts.push({ label: `${a.label} > ${number(threshold)}`, loose: !evaluation.strict });
  }
  return matches;
}
export function SignalMatchCell({ match }: { match?: SignalReconstructionMatch }) {
  return <span data-testid="signal-reconstruction-match" title={match?.title || '尚未复原'} className={`block min-w-0 truncate text-[10px] leading-4 ${match?.stale ? 'opacity-40' : ''}`}>
    {match?.parts.length ? match.parts.map((part, i) => <Fragment key={i}>{i > 0 && <span className="text-muted-foreground/50"> · </span>}<span className={part.loose ? 'text-muted-foreground/45' : 'text-foreground/90'}>{part.label}</span></Fragment>) : <span className="text-muted-foreground/40">—</span>}
    {match?.stale && <span className="ml-1 text-[9px] text-muted-foreground">已过期</span>}
  </span>;
}
