/**
 * Deep dig · 特征值「多空博弈均衡点漂移速度 V」：描述统计 / 推断统计 / 规律提取（纯展示，不取数）。
 * 【用户要求】2026-10-16「描述统计包括：分组以及各组对应的数据，以及细节描述；推断统计包括基于不同统计方法的过程及结果；
 * 规律提取包括总结和归纳出来的方法，默认为统计得出的结果（且做成可以手动修改的）。总之，我喜欢简洁、美观」。
 * 左对齐紧凑、名字和数字挨着；分页与数据分组放在网址上，从战役返回能回到原处（由页面外壳负责）。
 */
import { useMemo, useState } from 'react';
import { ArrowUpRight, Download, Loader2, Pencil, Play, RotateCcw, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBeijingTime } from '@/lib/timeFormat';
import { DEEP_DIVE_ALPHA, type DeepDiveTargetKey } from '@/lib/deepRsa/deepDive';
import type { RunProgress, RunStage } from '@/lib/deepRsa/pipeline';
import {
  bp, DEEP_DIG_FEATURES, DRIFT_GROUP_LABEL, DRIFT_GROUP_NOTE, DRIFT_GROUPS, DRIFT_SCALE, DRIFT_UNIT, driftRules, pText,
  type DriftGroup, type DriftSpeedResult,
} from '@/lib/deepDig/driftSpeed';
import type { RunStatus } from '@/hooks/useDriftSpeed';

export type DeepDigTab = 'describe' | 'infer' | 'rules';
export const DEEP_DIG_TABS: { key: DeepDigTab; label: string }[] = [
  { key: 'describe', label: '描述统计' },
  { key: 'infer', label: '推断统计' },
  { key: 'rules', label: '规律提取' },
];

/** 手动修改过的规律：一行一条。 */
export interface DeepDigNote { text: string; savedAt: number }

const GREEN = 'text-[#0B9F66] dark:text-[#0ECB81]';
const RED = 'text-[#F6465D]';
export const GROUP_TONE: Record<DriftGroup, string> = { positive: GREEN, control: RED, other: 'text-foreground', background: 'text-muted-foreground' };
const DOT: Record<DriftGroup, string> = { positive: 'bg-[#0ECB81]', control: 'bg-[#F6465D]', other: 'bg-foreground/45', background: 'bg-[#848E9C]/60' };

const STAGE_LABEL: Partial<Record<RunStage, string>> = { events: '整理事件', fetch: '拉取 K 线', features: '计算 V', rsa: '统计检验', done: '完成' };
const TARGETS: { key: DeepDiveTargetKey; name: string }[] = [
  { key: 'endRet', name: '24h 期末收益' }, { key: 'maxUp', name: '24h 最大涨幅' }, { key: 'maxDown', name: '24h 最大跌幅' },
];

const TH = 'py-1 pr-4 text-left font-normal whitespace-nowrap';
const TD = 'py-1 pr-4 whitespace-nowrap';
const finite = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
/** 百分数；四舍五入后是 0 的不带负号（不出现「-0.0%」）。 */
const pct = (v: number | null | undefined, d = 1) => {
  if (!finite(v)) return '—';
  const text = (v * 100).toFixed(d);
  return `${Number(text) === 0 ? (0).toFixed(d) : text}%`;
};
const N = ({ children, className }: { children: React.ReactNode; className?: string }) => <span className={cn('font-mono tabular-nums text-foreground', className)}>{children}</span>;
const signTone = (v: number | null | undefined, eps = 0) => (!finite(v) || Math.abs(v) <= eps ? undefined : v > 0 ? GREEN : RED);
/** 收益按 0.1% 显示，不到 0.05% 的不上色。 */
const retTone = (v: number | null | undefined) => signTone(v, 0.0005);
/** 数据表默认显示的行数，其余点「展开」。 */
const ROWS_PREVIEW = 15;

function Block({ title, aside, children, testId }: { title: string; aside?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-[12.5px] font-medium">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export interface DriftSpeedViewProps {
  result: DriftSpeedResult | null;
  status: RunStatus;
  progress: RunProgress | null;
  error: string | null;
  canRun: boolean;
  /** 为什么现在不能运行（未登录、战役读取中……）。 */
  blockedReason?: string | null;
  onRun: () => void;
  onCancel: () => void;
  onDownload: () => void;
  tab: DeepDigTab;
  onTabChange: (tab: DeepDigTab) => void;
  group: DriftGroup;
  onGroupChange: (group: DriftGroup) => void;
  /** 数据表是否展开全部（放网址上：从战役返回时列表长度不变，才能滚回原处）。 */
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
  onOpenCampaign: (campaignId: string) => void;
  note: DeepDigNote | null;
  onSaveNote: (note: DeepDigNote | null) => void;
}

export function DriftSpeedView(props: DriftSpeedViewProps) {
  const { result, tab, onTabChange } = props;
  const feature = DEEP_DIG_FEATURES[0];
  return (
    <div className="space-y-5 text-[12px]" data-testid="deep-dig-feature">
      <div className="space-y-1">
        <h2 className="text-[15px] font-medium">{feature.name}</h2>
        <p className="max-w-[720px] text-[11.5px] leading-relaxed text-muted-foreground">{feature.definition}</p>
      </div>
      <RunStrip {...props} />
      <div className="inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-muted/40 p-0.5" role="tablist" aria-label="模块">
        {DEEP_DIG_TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab}
            data-testid={`deep-dig-tab-${t.key}`}
            onClick={() => onTabChange(t.key)}
            className={cn('h-7 rounded-[4px] px-3 text-[12px] transition-colors',
              t.key === tab ? 'bg-card font-medium shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-accent' : 'text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'rules' ? <RulesTab {...props} /> : !result ? (
        <div className="text-[11.5px] text-muted-foreground" data-testid="deep-dig-empty">
          还没运行：点上面的「运行」，在你的浏览器里取币安公开 5m K 线，算出每场战役进场时的 V（1–3 分钟，只读，不写数据、不下单）。
        </div>
      ) : tab === 'describe' ? <DescribeTab {...props} result={result} /> : <InferTab result={result} />}
    </div>
  );
}

function RunStrip({ result, status, progress, error, canRun, blockedReason, onRun, onCancel, onDownload }: DriftSpeedViewProps) {
  const running = status === 'running';
  const btn = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px]" data-testid="deep-dig-run">
      {running ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {STAGE_LABEL[progress?.stage ?? 'events'] ?? '运行中'}
            {progress && progress.total > 0 && <N>{progress.done} / {progress.total}</N>}
          </span>
          <button type="button" className={btn} onClick={onCancel} data-testid="deep-dig-cancel"><Square className="h-3 w-3" />取消</button>
        </>
      ) : (
        <>
          <button type="button" className={btn} onClick={onRun} disabled={!canRun} data-testid="deep-dig-run-button">
            <Play className="h-3 w-3" />{result ? '重新运行' : '运行'}
          </button>
          {result && (
            <button type="button" className={btn} onClick={onDownload} aria-label="下载结果 JSON" title="下载结果 JSON"><Download className="h-3 w-3" />JSON</button>
          )}
          {result ? (
            <span className="text-muted-foreground">
              上次运行 <N className="text-muted-foreground">{formatBeijingTime(result.finishedAt).slice(0, 16)}</N>
            </span>
          ) : null}
          {!canRun && blockedReason && <span className="text-muted-foreground">{blockedReason}</span>}
        </>
      )}
      {status === 'error' && error && <span className={RED}>运行失败：{error}</span>}
      {status === 'cancelled' && <span className="text-muted-foreground">已取消</span>}
    </div>
  );
}

// ===================== 描述统计 =====================

function DescribeTab({ result, group, onGroupChange, onOpenCampaign, showAll: expanded, onShowAllChange: setExpanded }: DriftSpeedViewProps & { result: DriftSpeedResult }) {
  const stats = result.groups;
  const byGroup = Object.fromEntries(stats.map(s => [s.group, s])) as Record<DriftGroup, (typeof stats)[number]>;
  const listed = useMemo(
    () => result.rows.filter(r => r.group === group).sort((a, b) => b.anchorMs - a.anchorMs),
    [result.rows, group],
  );
  const c = result.coverage;
  const shown = expanded ? listed : listed.slice(0, ROWS_PREVIEW);
  return (
    <div className="space-y-6" data-testid="deep-dig-describe">
      <Block title="分组" aside={<span className="text-[11px] text-muted-foreground">V 的单位：{DRIFT_UNIT}</span>}>
        <table className="text-[11.5px]" data-testid="deep-dig-groups">
          <thead>
            <tr className="text-muted-foreground">
              <th className={TH}>组</th><th className={TH}>n</th><th className={TH}>均值</th><th className={TH}>标准差</th>
              <th className={TH}>中位数</th><th className={cn(TH, 'max-sm:hidden')}>四分位</th><th className={cn(TH, 'pr-0')}>V &gt; 0</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {DRIFT_GROUPS.map(g => {
              const s = byGroup[g];
              return (
                <tr key={g} className="border-t border-border/40">
                  <td className={cn(TD, 'font-sans', GROUP_TONE[g])}>{DRIFT_GROUP_LABEL[g]}</td>
                  <td className={TD}>{s?.n ?? 0}</td>
                  <td className={TD}>{bp(s?.mean)}</td>
                  <td className={TD}>{bp(s?.sd)}</td>
                  <td className={cn(TD, 'text-foreground')}>{bp(s?.median)}</td>
                  <td className={cn(TD, 'text-muted-foreground max-sm:hidden')}>{bp(s?.q25)} ~ {bp(s?.q75)}</td>
                  <td className={cn(TD, 'pr-0')}>{pct(s?.sharePositive, 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <StripPlot result={result} />
      </Block>

      <Block title="细节">
        <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-foreground/85" data-testid="deep-dig-details">
          <li>
            样本：<N>{c.campaigns}</N> 场战役，同一个币 48 小时内的合为一簇 → <N>{c.clusters}</N> 簇，每簇取一个代表；
            另在同一批币、同一段时间里随机抽 <N>{byGroup.background?.n ?? 0}</N> 个时点作参照。
          </li>
          {DRIFT_GROUPS.map(g => (
            <li key={g}><span className={GROUP_TONE[g]}>{DRIFT_GROUP_LABEL[g]}</span>：{DRIFT_GROUP_NOTE[g]}。</li>
          ))}
          <li>
            V 取进场前最后一根已收盘的 5m K 线，半衰期 {result.halfLifeHours} 小时，主动买卖额一律用成交金额（USDT）；
            成交额数据不足的记缺失（<N>{c.featureMissing}</N> 个）{c.failed > 0 && <>，K 线没取到的 <N>{c.failed}</N> 个</>}。
          </li>
          <li>
            V &gt; 0 表示均衡价在上移：实验组 <N>{pct(byGroup.positive?.sharePositive, 0)}</N>、对照组 <N>{pct(byGroup.control?.sharePositive, 0)}</N>、
            随机时点 <N>{pct(byGroup.background?.sharePositive, 0)}</N>。
          </li>
        </ul>
      </Block>

      <Block title="数据" aside={<span className="text-[11px] text-muted-foreground">点一行打开交易战役</span>}>
        <div className="inline-flex flex-wrap items-center gap-0.5 rounded-md border border-border/70 bg-muted/40 p-0.5" role="group" aria-label="数据分组">
          {DRIFT_GROUPS.map(g => (
            <button
              key={g}
              type="button"
              aria-pressed={g === group}
              data-testid={`deep-dig-group-${g}`}
              onClick={() => onGroupChange(g)}
              className={cn('inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11.5px] transition-colors',
                g === group ? 'bg-card font-medium shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-accent' : 'text-muted-foreground hover:text-foreground')}
            >
              <span className={g === group ? GROUP_TONE[g] : undefined}>{DRIFT_GROUP_LABEL[g]}</span>
              <span className="font-mono tabular-nums">{byGroup[g]?.n ?? 0}</span>
            </button>
          ))}
        </div>
        {listed.length === 0 ? <div className="text-[11.5px] text-muted-foreground">这一组没有数据</div> : (
          <table className="text-[11.5px]" data-testid="deep-dig-rows">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className={TH}>时间<span className="max-sm:hidden">（北京）</span></th>
                <th className={TH}>标的</th>
                <th className={TH}>V</th>
                <th className={TH}>24h 期末</th>
                <th className={cn(TH, 'pr-0 max-sm:hidden')}>24h 最大涨</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const target = r.memberIds[0];
                return (
                  <tr
                    key={r.id}
                    data-testid="deep-dig-row"
                    onClick={target ? () => onOpenCampaign(target) : undefined}
                    title={target ? '打开交易战役' : undefined}
                    className={cn('group border-b border-border/50', target && 'cursor-pointer hover:bg-muted/50')}
                  >
                    <td className={cn(TD, 'font-mono tabular-nums text-muted-foreground')}>
                      <span className="max-sm:hidden">{formatBeijingTime(r.anchorMs).slice(0, 16)}</span>
                      <span className="sm:hidden">{formatBeijingTime(r.anchorMs).slice(5, 16)}</span>
                    </td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-1">
                        {r.symbol.replace(/USDT$/, '')}
                        {r.memberIds.length > 1 && <span className="font-mono text-[10.5px] text-muted-foreground">×{r.memberIds.length}</span>}
                        {target && <ArrowUpRight aria-hidden="true" className="h-2.5 w-2.5 text-muted-foreground opacity-0 group-hover:opacity-100" />}
                      </span>
                    </td>
                    <td className={cn(TD, 'font-mono tabular-nums', signTone(r.v))}>{bp(r.v)}</td>
                    <td className={cn(TD, 'font-mono tabular-nums', retTone(r.endRet))}>{pct(r.endRet)}</td>
                    <td className={cn(TD, 'pr-0 font-mono tabular-nums text-muted-foreground max-sm:hidden')}>{pct(r.maxUp)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {listed.length > ROWS_PREVIEW && (
          <button type="button" data-testid="deep-dig-rows-toggle" onClick={() => setExpanded(!expanded)} className="text-[11.5px] text-muted-foreground hover:text-foreground">
            {expanded ? '收起' : `展开全部 ${listed.length} 条`}
          </button>
        )}
      </Block>
    </div>
  );
}

/** 四组的 V 点阵：每个点一个事件，竖线 = 中位数，浅色条 = 四分位区间，橘黄虚线 = 0（均衡价不动）。两端 1% 的极端值压在边上。 */
function StripPlot({ result }: { result: DriftSpeedResult }) {
  const values = result.rows.map(r => r.v).filter(finite).map(v => v * DRIFT_SCALE).sort((a, b) => a - b);
  if (values.length < 2) return null;
  const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.round(q * (values.length - 1))))];
  const lo = Math.min(0, at(0.01));
  const hi = Math.max(0, at(0.99));
  const span = hi - lo || 1;
  const x = (v: number) => `${(Math.min(1, Math.max(0, (v - lo) / span)) * 100).toFixed(2)}%`;
  const stat = Object.fromEntries(result.groups.map(s => [s.group, s]));
  return (
    <div className="max-w-[560px] pt-1" data-testid="deep-dig-strip">
      <div className="grid grid-cols-[64px_1fr] items-center gap-x-2 gap-y-1">
        {DRIFT_GROUPS.map(g => {
          const s = stat[g];
          const vs = result.rows.filter(r => r.group === g && finite(r.v)).map(r => r.v! * DRIFT_SCALE);
          return (
            <div key={g} className="contents">
              <span className={cn('text-[11px]', GROUP_TONE[g])}>{DRIFT_GROUP_LABEL[g]}</span>
              <div className="relative h-4">
                <div className="absolute inset-y-[7px] left-0 right-0 bg-border/50" />
                {finite(s?.q25) && finite(s?.q75) && (
                  <div className="absolute inset-y-[4px] rounded-sm bg-foreground/[0.07]" style={{ left: x(s.q25 * DRIFT_SCALE), width: `calc(${x(s.q75 * DRIFT_SCALE)} - ${x(s.q25 * DRIFT_SCALE)})` }} />
                )}
                <div className="absolute inset-y-0 border-l border-dashed border-[#F59E0B]" style={{ left: x(0) }} />
                {vs.map((v, i) => (
                  <span key={i} className={cn('absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full', DOT[g])} style={{ left: x(v) }} />
                ))}
                {finite(s?.median) && <span className="absolute inset-y-0 w-[2px] -translate-x-1/2 rounded bg-foreground" style={{ left: x(s.median * DRIFT_SCALE) }} title={`中位数 ${bp(s.median)}`} />}
              </div>
            </div>
          );
        })}
        <span />
        <div className="relative h-3 font-mono text-[10px] tabular-nums text-muted-foreground">
          <span className="absolute left-0">{lo.toFixed(1)}</span>
          <span className="absolute -translate-x-1/2 text-[#C27C0E] dark:text-[#F59E0B]" style={{ left: x(0) }}>0</span>
          <span className="absolute right-0">{hi.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

// ===================== 推断统计 =====================

function Verdict({ ok, yes = '差异显著', no = '差异不显著' }: { ok: boolean; yes?: string; no?: string }) {
  return <span className={cn('rounded px-1.5 py-px text-[10.5px]', ok ? 'bg-[#0ECB81]/10 text-[#0B9F66] dark:text-[#0ECB81]' : 'bg-muted text-muted-foreground')}>{ok ? yes : no}</span>;
}

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-[11.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="whitespace-nowrap text-muted-foreground">{k}</dt>
          <dd className="font-mono tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const How = ({ children }: { children: React.ReactNode }) => <p className="max-w-[720px] text-[11.5px] leading-relaxed text-muted-foreground">{children}</p>;

function InferTab({ result }: { result: DriftSpeedResult }) {
  const t = result.tTest;
  const l = result.label;
  const conf = Object.fromEntries(result.confirmation.map(r => [r.target, r]));
  return (
    <div className="space-y-6" data-testid="deep-dig-infer">
      <Block title="① t 检验 · 实验组 vs 对照组" aside={t && finite(t.p) ? <Verdict ok={t.p < DEEP_DIVE_ALPHA} /> : null} testId="deep-dig-ttest">
        <How>比较两组 V 的均值：Welch t 检验（不假定两组方差相等），双侧，α = 0.05。均值差 = 实验组 − 对照组；Hedges g 是效应量（约 0.2 小、0.5 中、0.8 大）。</How>
        {t ? (
          <KV rows={[
            ['实验组', <><N>{t.nA}</N> 个 · 均值 <N>{bp(t.meanA)}</N> ± <N>{bp(t.sdA)}</N></>],
            ['对照组', <><N>{t.nB}</N> 个 · 均值 <N>{bp(t.meanB)}</N> ± <N>{bp(t.sdB)}</N></>],
            ['均值差', <><N className={signTone(t.diff)}>{bp(t.diff)}</N> <span className="text-muted-foreground">95% 区间 {t.ci95 ? `${bp(t.ci95[0])} ~ ${bp(t.ci95[1])}` : '—'}</span></>],
            ['t（自由度）', <>{finite(t.t) ? t.t.toFixed(2) : '—'}（{finite(t.df) ? t.df.toFixed(0) : '—'}）</>],
            ['p', <N>{pText(t.p)}</N>],
            ['Hedges g', <>{finite(t.hedgesG) ? t.hedgesG.toFixed(2) : '—'}</>],
            ['分期', <span className="font-sans text-muted-foreground">发现期均值差 <N>{bp(t.byPeriod.discovery.diff)}</N>（p {pText(t.byPeriod.discovery.p)}）· 确认期 <N>{bp(t.byPeriod.confirmation.diff)}</N>（p {pText(t.byPeriod.confirmation.p)}）</span>],
          ]} />
        ) : <div className="text-muted-foreground">没有结果</div>}
      </Block>

      <Block title="② Mann–Whitney · 排名比较" aside={l && finite(l.p) ? <Verdict ok={l.p < DEEP_DIVE_ALPHA} /> : null} testId="deep-dig-auc">
        <How>只看排名、不看具体数值，不怕极端值。AUC = 随机挑一场实验组和一场对照组，实验组 V 更高的概率：0.5 = 分不开，越偏离 0.5 越能分开。p：打乱组别 {result.permutations} 次；区间：按币整簇重抽样。</How>
        {l ? (
          <KV rows={[
            ['AUC', <><N>{finite(l.auc) ? l.auc.toFixed(3) : '—'}</N> <span className="text-muted-foreground">95% 区间 {l.ci ? `${l.ci[0].toFixed(2)} ~ ${l.ci[1].toFixed(2)}` : '—'}</span></>],
            ['中位数', <>实验组 <N>{bp(l.posMedian)}</N> · 对照组 <N>{bp(l.ctlMedian)}</N></>],
            ['p', <N>{pText(l.p)}</N>],
          ]} />
        ) : <div className="text-muted-foreground">没有结果</div>}
      </Block>

      <Block title="③ Spearman 相关 · V 与之后 24h 行情" testId="deep-dig-assoc">
        <How>
          全部事件（含随机时点），从进场后第一根 5m K 线开盘价算之后 24h 的结果。发现集 = 时间上前 80%：算 ρ，按月内打乱求 p，三个结果一起 Holm 校正；
          「控制波动」= 扣掉观察窗波动率后的偏相关，回答是不是只是波动大小。发现集通过的项，到确认集（最后 20%）按同一方向复核，同向且 p &lt; 0.05 → 已验证。
        </How>
        <table className="text-[11.5px]">
          <thead>
            <tr className="text-muted-foreground">
              <th className={TH}>结果</th><th className={TH}>ρ</th><th className={TH}>Holm p</th><th className={TH}>控制波动</th><th className={cn(TH, 'pr-0')}>确认集</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {TARGETS.map(tg => {
              const r = result.association.find(a => a.target === tg.key);
              const cf = conf[tg.key];
              return (
                <tr key={tg.key} className="border-t border-border/40" data-testid={`deep-dig-assoc-${tg.key}`}>
                  <td className={cn(TD, 'font-sans')}>{tg.name}</td>
                  <td className={cn(TD, r && r.pHolm < DEEP_DIVE_ALPHA ? signTone(r.rho) : undefined)}>
                    {r && finite(r.rho) ? r.rho.toFixed(2) : '—'}
                    {r?.ci && <span className="ml-1 text-[10.5px] text-muted-foreground max-sm:hidden">[{r.ci[0].toFixed(2)}, {r.ci[1].toFixed(2)}]</span>}
                  </td>
                  <td className={TD}>{pText(r?.pHolm)}</td>
                  <td className={cn(TD, 'text-muted-foreground')}>{r && finite(r.rhoPartialVol) ? <>{r.rhoPartialVol.toFixed(2)}<span className="max-sm:hidden">（p {pText(r.pPartialVol)}）</span></> : '—'}</td>
                  <td className={cn(TD, 'pr-0 font-sans')}>
                    {cf ? (
                      <span className={cf.verdict === '已验证' ? GREEN : RED}>
                        {cf.verdict}<span className="ml-1 font-mono text-[10.5px] text-muted-foreground max-sm:hidden">ρ {finite(cf.rho) ? cf.rho.toFixed(2) : '—'}{cf.verdict === '已验证' && !cf.survivesVolControl ? ' · 控制波动后不成立' : ''}</span>
                      </span>
                    ) : <span className="text-muted-foreground">未进入</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="text-[11px] text-muted-foreground">发现集 <N>{result.coverage.discovery}</N> · 确认集 <N>{result.coverage.confirmation}</N> · 两段之间隔离剔除 <N>{result.coverage.embargoed}</N></div>
      </Block>

      <Block title="④ 五分位分档" testId="deep-dig-quintiles">
        <How>把 V 从低到高分五档（切点取发现集），看每档之后 24h 的平均结果。看是否单调、差距是否大于噪声；描述，不做判定。</How>
        {result.quintiles.bins.length ? (
          <table className="text-[11.5px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className={TH}>档</th><th className={TH}>V 范围</th><th className={TH}>n</th>
                {TARGETS.map(tg => <th key={tg.key} className={cn(TH, tg.key === 'maxDown' && 'pr-0')}>{tg.name.replace('24h ', '')}</th>)}
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {result.quintiles.bins.map(b => (
                <tr key={b.q} className="border-t border-border/40">
                  <td className={TD}>Q{b.q}</td>
                  <td className={cn(TD, 'text-muted-foreground')}>{bp(b.lo, 1)} ~ {bp(b.hi, 1)}</td>
                  <td className={TD}>{b.n}</td>
                  {TARGETS.map(tg => <td key={tg.key} className={cn(TD, tg.key === 'maxDown' && 'pr-0', retTone(b.means[tg.key]))}>{pct(b.means[tg.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="text-muted-foreground">样本不够分档</div>}
      </Block>
    </div>
  );
}

// ===================== 规律提取 =====================

function RulesTab({ result, note, onSaveNote }: DriftSpeedViewProps) {
  const defaults = useMemo(() => (result ? driftRules(result) : []), [result]);
  const lines = note ? note.text.split('\n').map(s => s.trim()).filter(Boolean) : defaults;
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft != null;
  const btn = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] hover:bg-muted disabled:opacity-50';
  return (
    <div className="space-y-3" data-testid="deep-dig-rules">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={cn('rounded px-1.5 py-px text-[10.5px]', note ? 'bg-[#F0B90B]/15 text-[#8F6B00] dark:text-[#F0B90B]' : 'bg-muted text-muted-foreground')} data-testid="deep-dig-rules-source">
          {note ? `手动修改 · ${formatBeijingTime(note.savedAt).slice(5, 16)}` : '统计得出'}
        </span>
        {editing ? (
          <>
            <button type="button" className={btn} data-testid="deep-dig-rules-save"
              onClick={() => { const text = draft.trim(); onSaveNote(text ? { text, savedAt: Date.now() } : null); setDraft(null); }}>保存</button>
            <button type="button" className={btn} onClick={() => setDraft(null)}>取消</button>
          </>
        ) : (
          <>
            <button type="button" className={btn} data-testid="deep-dig-rules-edit" onClick={() => setDraft(lines.join('\n'))}>
              <Pencil className="h-3 w-3" />编辑
            </button>
            {note && result && (
              <button type="button" className={btn} data-testid="deep-dig-rules-reset" onClick={() => onSaveNote(null)}>
                <RotateCcw className="h-3 w-3" />恢复为统计结果
              </button>
            )}
          </>
        )}
      </div>
      {editing ? (
        <div className="space-y-1">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={Math.max(6, draft.split('\n').length + 1)}
            data-testid="deep-dig-rules-input"
            className="w-full max-w-[720px] rounded-md border border-border bg-background px-2.5 py-2 text-[12px] leading-relaxed outline-none focus:border-foreground/40"
          />
          <div className="text-[11px] text-muted-foreground">一行一条；清空后保存 = 恢复为统计结果。跟账号走，换设备也在。</div>
        </div>
      ) : lines.length ? (
        <ol className="max-w-[720px] space-y-1.5 text-[12px] leading-relaxed" data-testid="deep-dig-rules-list">
          {lines.map((line, i) => (
            <li key={i} className="grid grid-cols-[18px_1fr]">
              <span className="font-mono tabular-nums text-muted-foreground">{i + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="text-[11.5px] text-muted-foreground">运行后按统计结果自动生成，也可以直接点「编辑」自己写。</div>
      )}
      {note && result && note.savedAt < result.finishedAt && (
        <div className="text-[11px] text-muted-foreground">提示：保存之后又运行过一次，统计结果可能已经变了，可点「恢复为统计结果」对照。</div>
      )}
    </div>
  );
}
