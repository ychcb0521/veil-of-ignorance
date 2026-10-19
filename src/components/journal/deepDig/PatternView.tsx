/**
 * Deep dig 描述统计 · 总体模式识别（在「时间序列」下面）。
 * 【用户要求】2026-10-19「除了做分组描述，我还希望看看将所有数据汇总到一起之后，这些数据整体上会呈现出什么特征，
 * 以及经过一些条件约束或者标准过滤之后，会呈现出什么样的特征和分布（比如时间序列图等等的）」。
 * 总体 = 实验组 + 对照组 + 其他（不含随机时点）；随机时点按同一条件筛，作市场平时的参照。
 * 读数（变量、时刻）跟着上面时间序列图的选择；条件按所选时刻的值判断。左对齐紧凑，名字和数字挨着。
 */
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { fmtValue, type DeepDigData, type DeepDigRow, type DeepDigRowGroup } from '@/lib/deepDig/analysis';
import type { DeepDigSeries } from '@/lib/deepDig/series';
import { compileRowFilter, describeRows, PATTERN_EXTRA_VARS, quantileBins, rowFilterValues, sharedHistogram, splitByFilter, type PatternStat } from '@/lib/deepDig/pattern';
import { SeriesChart } from '@/components/journal/deepDig/SeriesChart';

const GREEN = 'text-[#0B9F66] dark:text-[#0ECB81]';
const RED = 'text-[#F6465D]';
const AMBER = 'text-[#C27C0E] dark:text-[#F59E0B]';
const TH = 'py-1 pr-4 text-left font-normal whitespace-nowrap';
const TD = 'py-1 pr-4 whitespace-nowrap';
const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
const pct = (v: number | null | undefined, d = 1) => {
  if (!finite(v)) return '—';
  const text = (v * 100).toFixed(d);
  return `${Number(text) === 0 ? (0).toFixed(d) : text}%`;
};
const retTone = (v: number | null | undefined) => (!finite(v) || Math.abs(v) <= 0.0005 ? undefined : v > 0 ? GREEN : RED);
const Code = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-muted px-1 py-px font-mono text-[11px] text-foreground">{children}</code>;

/** 曲线借用的四条线：满足条件 = 实验组的绿、不满足 = 对照组的红、全部样本 = 灰、随机时点 = 灰虚线。 */
const LABELS: Record<DeepDigRowGroup, string> = { positive: '满足条件', control: '不满足', other: '全部样本', background: '随机时点' };

const FILTER_KEY = (featureId: string) => `veil.deepDig.patternFilter:${featureId}`;
function readFilter(featureId: string): string {
  try { return localStorage.getItem(FILTER_KEY(featureId)) ?? ''; } catch { return ''; }
}
function writeFilter(featureId: string, text: string) {
  try { if (text.trim()) localStorage.setItem(FILTER_KEY(featureId), text); else localStorage.removeItem(FILTER_KEY(featureId)); } catch { /* 记不住只是下次要重写 */ }
}

export function PatternView({ result, atRows, atFallback, series, variable, at, onAt, X, varNames, resultName, atText }: {
  /** 去掉删除行之后、按所选变量与时刻取值的数据（v = 读数 X）。 */
  result: DeepDigData;
  /** 所选时刻的各变量读数（判断条件用）；与 result 同一批行。 */
  atRows: readonly DeepDigRow[];
  /** 所选时刻的曲线还没就绪，条件改按进场时的值判断。 */
  atFallback: boolean;
  series: DeepDigSeries | null;
  variable: string | null;
  at: number;
  onAt: (offset: number) => void;
  /** 读数的名字（表头用）。 */
  X: string;
  /** 公式变量名（条件里可用）。 */
  varNames: readonly string[];
  resultName: string;
  atText: string;
}) {
  const def = result.definition;
  const [text, setTextState] = useState(() => readFilter(def.id));
  const setText = (t: string) => { setTextState(t); writeFilter(def.id, t); };
  const [help, setHelp] = useState(false);
  const { filter, error } = useMemo(() => compileRowFilter(text, [...new Set([...varNames, resultName])]), [text, varNames, resultName]);
  const atById = useMemo(() => new Map(atRows.map(r => [r.id, r])), [atRows]);
  const valuesOf = (r: DeepDigRow) => rowFilterValues(atById.get(r.id) ?? r, resultName);

  const real = useMemo(() => result.rows.filter(r => r.group !== 'background'), [result.rows]);
  const bgAll = useMemo(() => result.rows.filter(r => r.group === 'background'), [result.rows]);
  const split = useMemo(() => splitByFilter(real, filter, valuesOf), [real, filter, atById]); // eslint-disable-line react-hooks/exhaustive-deps
  const bg = useMemo(() => splitByFilter(bgAll, filter, valuesOf).pass, [bgAll, filter, atById]); // eslint-disable-line react-hooks/exhaustive-deps
  const focus = filter ? split.pass : real;
  const bp = (v: number | null | undefined) => fmtValue(def, v);
  const vOf = (rows: readonly DeepDigRow[]) => rows.map(r => r.v).filter(finite).map(v => v * def.scale);

  const table: { key: string; label: string; tone?: string; s: PatternStat; note?: string }[] = [
    { key: 'all', label: '全部样本', s: describeRows(real) },
    ...(filter ? [
      { key: 'pass', label: '满足条件', tone: GREEN, s: describeRows(split.pass) },
      { key: 'fail', label: '不满足', tone: RED, s: describeRows(split.fail) },
    ] : []),
    { key: 'bg', label: filter ? '随机时点（同条件）' : '随机时点', tone: 'text-muted-foreground', s: describeRows(bg) },
  ];
  const hist = useMemo(
    () => sharedHistogram(filter ? [vOf(split.pass), vOf(real), vOf(bg)] : [vOf(real), vOf(bg)]),
    [filter, split, real, bg], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const bins = useMemo(() => quantileBins(focus), [focus]);
  // 曲线：同一行可以同时算进「全部样本」与「满足 / 不满足」——按组复制一份（曲线只按 id 取值、按组求平均）
  const chartData = useMemo<DeepDigData>(() => ({
    ...result,
    rows: [
      ...real.map(r => ({ ...r, group: 'other' as const })),
      ...(filter ? [...split.pass.map(r => ({ ...r, group: 'positive' as const })), ...split.fail.map(r => ({ ...r, group: 'control' as const }))] : []),
      ...bg,
    ],
  }), [result, real, filter, split, bg]);
  const top = bins.at(-1);
  const low = bins[0];

  return (
    <div className="max-w-[720px] space-y-4 text-[11.5px]" data-testid="deep-dig-pattern">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-[32px] shrink-0 text-muted-foreground">条件</span>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            spellCheck={false}
            placeholder={`留空 = 看全部；例：${resultName} > 0 and hour >= 20`}
            aria-label="筛选条件"
            data-testid="deep-dig-pattern-filter"
            className={cn('h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11.5px] outline-none focus:border-foreground/40', error ? 'border-[#F6465D]/60' : 'border-border')}
          />
          {text && <button type="button" onClick={() => setText('')} className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground" data-testid="deep-dig-pattern-filter-clear">清空</button>}
        </div>
        <div className="pl-[38px] text-[11px] text-muted-foreground">
          {error ? <span className={RED} data-testid="deep-dig-pattern-error">{error}</span> : (
            <>
              写法同分组条件（<Code>and</Code> <Code>or</Code> <Code>&gt;</Code> <Code>&lt;=</Code> …）·{' '}
              <button type="button" onClick={() => setHelp(!help)} aria-expanded={help} className="underline-offset-2 hover:text-foreground hover:underline" data-testid="deep-dig-pattern-help-toggle">{help ? '收起可用名字' : '可用名字'}</button>
            </>
          )}
          {help && (
            <ul className="mt-0.5 space-y-0.5" data-testid="deep-dig-pattern-help">
              <li>公式变量 <span className="font-mono text-foreground">{[...new Set([...varNames, resultName])].join(' ')}</span>（{atText}的值）</li>
              {PATTERN_EXTRA_VARS.map(v => <li key={v.name}><span className="font-mono text-foreground">{v.name}</span> {v.label}</li>)}
            </ul>
          )}
        </div>
        {filter?.usesOutcome && <div className={cn('pl-[38px] text-[11px]', AMBER)} data-testid="deep-dig-pattern-outcome">条件用到了进场后的 24h 结果：只能作事后描述，不能当进场依据。</div>}
        {filter && atFallback && <div className={cn('pl-[38px] text-[11px]', AMBER)}>所选时刻的曲线还没就绪：条件暂按进场时的值判断。</div>}
      </div>

      <div className="max-w-full overflow-x-auto">
      <table className="text-[11.5px]" data-testid="deep-dig-pattern-table">
        <thead>
          <tr className="text-muted-foreground">
            <th className={TH}>范围</th><th className={TH}>n</th><th className={TH}>均值</th><th className={cn(TH, 'max-sm:hidden')}>标准差</th>
            <th className={TH}>中位数</th><th className={cn(TH, 'max-sm:hidden')}>四分位</th><th className={TH}>{X} &gt; 0</th>
            <th className={TH}>24h 期末</th><th className={TH}>上涨占比</th><th className={cn(TH, 'pr-0 max-sm:hidden')}>24h 最大涨</th>
          </tr>
        </thead>
        <tbody className="font-mono tabular-nums">
          {table.map(({ key, label, tone, s }) => (
            <tr key={key} className="border-t border-border/40" data-testid={`deep-dig-pattern-row-${key}`}>
              <td className={cn(TD, 'font-sans', tone)}>{label}</td>
              <td className={TD}>{s.n}</td>
              <td className={TD}>{bp(s.mean)}</td>
              <td className={cn(TD, 'max-sm:hidden')}>{bp(s.sd)}</td>
              <td className={cn(TD, 'text-foreground')}>{bp(s.median)}</td>
              <td className={cn(TD, 'text-muted-foreground max-sm:hidden')}>{bp(s.q25)} ~ {bp(s.q75)}</td>
              <td className={TD}>{pct(s.sharePositive, 0)}</td>
              <td className={cn(TD, retTone(s.endRetMean))}>{pct(s.endRetMean)}</td>
              <td className={TD}>{pct(s.upShare, 0)}</td>
              <td className={cn(TD, 'pr-0 text-muted-foreground max-sm:hidden')}>{pct(s.maxUpMedian)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <div className="-mt-2 text-[11px] text-muted-foreground" data-testid="deep-dig-pattern-note">
        全部样本 = 实验组 + 对照组 + 其他（不含随机时点）{filter && split.missing.length > 0 && <>；条件里的读数缺失 <span className="font-mono text-foreground">{split.missing.length}</span> 个，两边都不算</>}。24h 期末为平均、最大涨为中位数，用的是进场后的结果。
      </div>

      {hist && <Histogram hist={hist} filtered={!!filter} lo={hist.lo} hi={hist.hi} X={X} />}

      <div className="space-y-1">
        <div className="font-medium">时间序列</div>
        <SeriesChart
          data={chartData} series={series} variable={variable} onVariable={() => {}} at={at} onAt={onAt}
          labels={LABELS} tid="deep-dig-pattern-series" hiddenKey={`${def.id}:pattern`} showVariables={false}
          note={<>每个时点取那一刻之前最后一根已收盘 K 线上的值再平均；阴影 = 平均 ± 1 个标准误。变量与竖线时刻和上面的时间序列图同步。</>}
        />
      </div>

      {bins.length > 0 && (
        <div className="space-y-1" data-testid="deep-dig-pattern-bins">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">按 {X} 分五档</span>
            <span className="text-[11px] text-muted-foreground">{filter ? '满足条件' : '全部样本'}从低到高，每档人数相同 · 看读数高低与之后 24h 的关系</span>
          </div>
          <div className="max-w-full overflow-x-auto">
          <table className="text-[11.5px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className={TH}>档</th><th className={TH}>{X} 范围</th><th className={TH}>n</th>
                <th className={TH}>24h 期末</th><th className={TH}>上涨占比</th><th className={cn(TH, 'pr-0')}>24h 最大涨</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {bins.map(b => (
                <tr key={b.k} className="border-t border-border/40" data-testid="deep-dig-pattern-bin">
                  <td className={TD}>{b.k}</td>
                  <td className={cn(TD, 'text-muted-foreground')}>{bp(b.lo)} ~ {bp(b.hi)}</td>
                  <td className={TD}>{b.n}</td>
                  <td className={cn(TD, retTone(b.endRetMean))}>{pct(b.endRetMean)}</td>
                  <td className={TD}>{pct(b.upShare, 0)}</td>
                  <td className={cn(TD, 'pr-0 text-muted-foreground')}>{pct(b.maxUpMedian)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {top && low && finite(top.endRetMean) && finite(low.endRetMean) && (
            <div className="text-[11px] text-muted-foreground" data-testid="deep-dig-pattern-bins-summary">
              最高一档比最低一档：24h 期末 <span className={cn('font-mono', retTone(top.endRetMean - low.endRetMean))}>{top.endRetMean - low.endRetMean > 0 ? '+' : ''}{pct(top.endRetMean - low.endRetMean)}</span>
              {finite(top.upShare) && finite(low.upShare) && <>、上涨占比 <span className="font-mono text-foreground">{pct(low.upShare, 0)} → {pct(top.upShare, 0)}</span></>}。只是描述，是否可靠看推断统计。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 分布：共用分箱的占比直方图。有条件时 = 满足条件（绿柱）+ 全部样本（灰色轮廓）；随机时点 = 灰虚线。 */
function Histogram({ hist, filtered, lo, hi, X }: { hist: { shares: number[][] }; filtered: boolean; lo: number; hi: number; X: string }) {
  const W = 560;
  const Hh = 96;
  const [main, all, bgS] = filtered ? hist.shares : [hist.shares[0], null, hist.shares[1]];
  const bins = main.length;
  const peak = Math.max(...hist.shares.flat(), 0.01);
  const bw = W / bins;
  const y = (s: number) => Hh - (s / peak) * (Hh - 4);
  const step = (sh: number[]) => sh.map((s, i) => `${i === 0 ? 'M' : 'L'}${(i * bw).toFixed(1)},${y(s).toFixed(1)}H${((i + 1) * bw).toFixed(1)}`).join('');
  const line = (sh: number[]) => sh.map((s, i) => `${i === 0 ? 'M' : 'L'}${((i + 0.5) * bw).toFixed(1)},${y(s).toFixed(1)}`).join('');
  const span = hi - lo || 1;
  const zx = ((0 - lo) / span) * W;
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
  return (
    <div className="space-y-1" data-testid="deep-dig-pattern-hist">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">分布</span>
        <span className="text-[11px] text-muted-foreground">
          {filtered ? <><span className={GREEN}>■</span> 满足条件 · <span className="text-foreground/50">▭</span> 全部样本 · </> : <><span className="text-foreground/40">■</span> 全部样本 · </>}
          <span className="text-[#848E9C]">┄</span> 随机时点 · 纵轴 = 各自的占比（形状可直接比）· 最高一格 {pct(peak, 0)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${Hh + 14}`} className="block w-full max-w-[560px]" role="img" aria-label={`${X} 的分布`}>
        {main.map((s, i) => s > 0 && (
          <rect key={i} x={i * bw + 1} y={y(s)} width={Math.max(1, bw - 2)} height={Hh - y(s)} className={filtered ? 'fill-[#0ECB81]/60' : 'fill-foreground/25'} />
        ))}
        {all && <path d={step(all)} fill="none" className="stroke-foreground/45" strokeWidth={1.2} />}
        {bgS && <path d={line(bgS)} fill="none" className="stroke-[#848E9C]" strokeWidth={1.5} strokeDasharray="4 3" />}
        <line x1={0} x2={W} y1={Hh} y2={Hh} className="stroke-border" strokeWidth={1} />
        {zx >= 0 && zx <= W && <line x1={zx} x2={zx} y1={0} y2={Hh} className="stroke-[#F59E0B]" strokeDasharray="3 3" strokeWidth={1} />}
        <text x={0} y={Hh + 11} className="fill-muted-foreground font-mono text-[10px]">{fmt(lo)}</text>
        {zx > 30 && zx < W - 30 && <text x={zx} y={Hh + 11} textAnchor="middle" className="fill-[#C27C0E] font-mono text-[10px] dark:fill-[#F59E0B]">0</text>}
        <text x={W} y={Hh + 11} textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">{fmt(hi)}</text>
      </svg>
    </div>
  );
}
