/**
 * Deep dig · 一个特征值的页面：定义区（可编辑）+ 运行 + 描述统计 / 推断统计 / 规律提取（纯展示，不取数）。
 * 【用户要求】2026-10-16「描述统计包括：分组以及各组对应的数据，以及细节描述；推断统计包括基于不同统计方法的过程及结果；
 * 规律提取包括总结和归纳出来的方法，默认为统计得出的结果（且做成可以手动修改的）。总之，我喜欢简洁、美观」。
 * 左对齐紧凑、名字和数字挨着；分页与数据分组放在网址上，从战役返回能回到原处（由页面外壳负责）。
 */
import { useMemo, useState } from 'react';
import { ArrowUpRight, Download, Loader2, Pencil, Play, RotateCcw, Square, Undo2, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBeijingTime } from '@/lib/timeFormat';
import type { RunProgress, RunStage } from '@/lib/deepRsa/pipeline';
import {
  applyExclusions, dataSupportsInference, DEEP_DIG_GROUPS, viewForVariable, deepDigRules, exclusionKey, fmtValue, groupLabel, pText,
  type DeepDigData, type DeepDigInference, type DeepDigRowGroup, type DefinitionSnapshot,
} from '@/lib/deepDig/analysis';
import { avgHoursOf, definitionKey, featureWindowMs, formulaVariables, halfLifeOf, intervalOf, RESULT_VAR, type DeepDigFeatureDef, type SampleRow, type SampleSource } from '@/lib/deepDig/features';
import type { RunStatus } from '@/hooks/useDeepDigRun';
import { DefinitionPanel, GroupCriteria } from '@/components/journal/deepDig/DefinitionPanel';
import { CommandPanel, InferenceResults, targetText } from '@/components/journal/deepDig/InferenceView';
import { SeriesChart } from '@/components/journal/deepDig/SeriesChart';
import type { DeepDigSeries } from '@/lib/deepDig/series';
import { dataVariables } from '@/lib/deepDig/commands';

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
export const GROUP_TONE: Record<DeepDigRowGroup, string> = { positive: GREEN, control: RED, other: 'text-foreground', background: 'text-muted-foreground' };
const DOT: Record<DeepDigRowGroup, string> = { positive: 'bg-[#0ECB81]', control: 'bg-[#F6465D]', other: 'bg-foreground/45', background: 'bg-[#848E9C]/60' };

const STAGE_LABEL: Partial<Record<RunStage, string>> = { events: '整理事件', fetch: '拉取 K 线', features: '计算特征值', rsa: '统计检验', done: '完成' };

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

export interface FeatureViewProps {
  def: DeepDigFeatureDef;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onSaveDef: (def: DeepDigFeatureDef) => void;
  onResetDef?: () => void;
  onDeleteDef?: () => void;
  /** 本机战役（分组标准即时预览）；还没读完时为 null。 */
  samples: Record<SampleSource, readonly SampleRow[] | null>;
  /** 描述统计的数据（未删减）。 */
  data: DeepDigData | null;
  /** 描述统计的时间序列曲线（本机 IndexedDB）；没有为 null / 不传。 */
  series?: DeepDigSeries | null;
  inference: DeepDigInference | null;
  describeStatus: RunStatus;
  describeProgress: RunProgress | null;
  describeError: string | null;
  canDescribe: boolean;
  /** 为什么现在不能运行描述统计（未登录、战役读取中……）。 */
  blockedReason?: string | null;
  onDescribe: () => void;
  onCancel: () => void;
  inferStatus: RunStatus;
  inferError: string | null;
  /** 在删减后的数据上运行推断统计。 */
  onInfer: (data: DeepDigData, excludedKey: string) => void;
  onDownload: () => void;
  /** 推断统计的命令原文。 */
  commands: string;
  onCommandsChange: (text: string) => void;
  /** 删掉的行（事件 id）。 */
  excluded: readonly string[];
  onExcludedChange: (ids: string[]) => void;
  tab: DeepDigTab;
  onTabChange: (tab: DeepDigTab) => void;
  group: DeepDigRowGroup;
  onGroupChange: (group: DeepDigRowGroup) => void;
  /** 数据表是否展开全部（放网址上：从战役返回时列表长度不变，才能滚回原处）。 */
  showAll: boolean;
  onShowAllChange: (showAll: boolean) => void;
  onOpenCampaign: (campaignId: string) => void;
  note: DeepDigNote | null;
  onSaveNote: (note: DeepDigNote | null) => void;
}

export function FeatureView(props: FeatureViewProps) {
  const { def, data, inference, excluded, tab, onTabChange } = props;
  const variables = useMemo(() => formulaVariables(def.formula), [def.formula]);
  const effective = useMemo(() => (data ? applyExclusions(data, excluded) : null), [data, excluded]);
  const exKey = data ? exclusionKey(data, excluded) : '';
  const inferenceDataFresh = !!(data && inference && inference.dataFinishedAt === data.finishedAt && (inference.excludedKey ?? '') === exKey);
  const inferenceFresh = inferenceDataFresh && inference?.commands === props.commands && (data == null || definitionKey(data.definition) === definitionKey(def));
  const defStale = data != null && definitionKey(data.definition) !== definitionKey(def);
  return (
    <div className="space-y-5 text-[12px]" data-testid="deep-dig-feature">
      <DefinitionPanel
        def={def} editing={props.editing} onEditingChange={props.onEditingChange} onSave={props.onSaveDef}
        onReset={props.onResetDef} onDelete={props.onDeleteDef} samples={props.samples}
      />
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
      {tab === 'describe' && (
        <div className="space-y-4">
          <RunStrip
            testId="deep-dig-describe-run" label="运行描述统计" hasResult={!!data} finishedAt={data?.finishedAt ?? null}
            status={props.describeStatus} progress={props.describeProgress} error={props.describeError}
            canRun={props.canDescribe} blockedReason={props.blockedReason} onRun={props.onDescribe} onCancel={props.onCancel} onDownload={data ? props.onDownload : undefined}
            hint={`取币安公开 ${intervalOf(def)} K 线${intervalOf(def) === '5m' ? '' : '（24h 结果仍按 5m）'}、按上面的公式算特征值、按分组标准分组（1–3 分钟，只读）`}
          />
          {defStale && <Notice testId="deep-dig-stale">公式、周期、半衰期或分组标准改过了：下面是按旧定义算的数据，点「重新运行描述统计」按现在的定义重算。</Notice>}
          {effective && data ? <DescribeTab {...props} data={effective} raw={data} /> : <Empty>还没运行描述统计。</Empty>}
        </div>
      )}
      {tab === 'infer' && (
        <div className="space-y-4">
          <CommandPanel
            commands={props.commands} onChange={props.onCommandsChange} variables={variables} scale={def.scale} unit={def.unit}
            available={effective ? [...dataVariables(effective.rows), RESULT_VAR] : null}
          />
          <RunStrip
            testId="deep-dig-infer-run" label="运行推断统计" hasResult={!!inference} finishedAt={inference?.finishedAt ?? null}
            status={props.inferStatus} error={props.inferError}
            canRun={!defStale && !!effective && dataSupportsInference(effective) && props.inferStatus !== 'running'}
            blockedReason={defStale ? '分组或公式已修改，请先重新运行描述统计' : !effective ? '先运行描述统计' : !dataSupportsInference(effective) ? '这份描述统计数据是旧版生成的，先重新运行描述统计' : null}
            onRun={() => { if (effective) props.onInfer(effective, exKey); }}
            hint="按上面的命令逐行算，用描述统计的数据（已去掉删除的行），不联网，几秒到十几秒"
          />
          {inference && !inferenceFresh && (
            <Notice testId="deep-dig-infer-stale">
              {defStale ? '分组或公式改过了，请先重新运行描述统计' : inferenceDataFresh ? '命令改过了' : '描述统计的数据或删减改过了'}：下面是上一次运行的结果，重新运行推断统计。
            </Notice>
          )}
          {inference && effective ? (
            <InferenceResults blocks={inference.blocks} target={inference.target !== undefined ? targetText(inference.target, formulaVariables(effective.definition.formula), effective.definition.scale, effective.definition.unit) : undefined} />
          ) : <Empty>还没运行推断统计。</Empty>}
        </div>
      )}
      {tab === 'rules' && <RulesTab {...props} data={effective} inference={inferenceFresh ? inference : null} />}
    </div>
  );
}

const Notice = ({ children, testId }: { children: React.ReactNode; testId?: string }) => (
  <div className="max-w-[720px] rounded-md bg-[#F0B90B]/10 px-2.5 py-1.5 text-[11.5px] text-[#8F6B00] dark:text-[#F0B90B]" data-testid={testId}>{children}</div>
);
const Empty = ({ children }: { children: React.ReactNode }) => <div className="text-[11.5px] text-muted-foreground" data-testid="deep-dig-empty">{children}</div>;

function RunStrip({ testId, label, hint, hasResult, finishedAt, status, progress, error, canRun, blockedReason, onRun, onCancel, onDownload }: {
  testId: string;
  label: string;
  hint: string;
  hasResult: boolean;
  finishedAt: number | null;
  status: RunStatus;
  progress?: RunProgress | null;
  error: string | null;
  canRun: boolean;
  blockedReason?: string | null;
  onRun: () => void;
  onCancel?: () => void;
  onDownload?: () => void;
}) {
  const running = status === 'running';
  const btn = 'inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50';
  return (
    <div className="space-y-1 text-[11.5px]" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {running ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {progress ? STAGE_LABEL[progress.stage] ?? '运行中' : '计算中'}
              {progress && progress.total > 0 && <N>{progress.done} / {progress.total}</N>}
            </span>
            {onCancel && <button type="button" className={btn} onClick={onCancel} data-testid={`${testId}-cancel`}><Square className="h-3 w-3" />取消</button>}
          </>
        ) : (
          <>
            <button type="button" className={btn} onClick={onRun} disabled={!canRun} data-testid={`${testId}-button`}>
              <Play className="h-3 w-3" />{hasResult ? `重新${label}` : label}
            </button>
            {onDownload && (
              <button type="button" className={btn} onClick={onDownload} aria-label="下载结果 JSON" title="下载结果 JSON（描述 + 推断）"><Download className="h-3 w-3" />JSON</button>
            )}
            {finishedAt != null && (
              <span className="text-muted-foreground">上次运行 <N className="text-muted-foreground">{formatBeijingTime(finishedAt).slice(0, 16)}</N></span>
            )}
            {!canRun && blockedReason && <span className="text-muted-foreground">{blockedReason}</span>}
          </>
        )}
        {status === 'error' && error && <span className={RED}>运行失败：{error}</span>}
        {status === 'cancelled' && <span className="text-muted-foreground">已取消</span>}
      </div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}

// ===================== 描述统计 =====================

const Code = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-muted px-1 py-px font-mono text-[11px] text-foreground">{children}</code>;

function groupNote(def: DefinitionSnapshot, g: DeepDigRowGroup): React.ReactNode {
  switch (g) {
    case 'positive': return <>满足 <Code>{def.positive}</Code>（且不满足对照组条件）</>;
    case 'control': return <>满足 <Code>{def.control}</Code>（且不满足实验组条件）</>;
    case 'other': return '两组都满足（冲突）、都不满足、条件读数缺失或数据不可靠的样本：只作描述，不进两组比较。';
    case 'background': return '同一批币、同一段时间里随机抽的时点：市场平时的读数。';
  }
}

function DescribeTab({ def: liveDef, samples, onSaveDef, data: effectiveData, raw, series, excluded, onExcludedChange, group, onGroupChange, onOpenCampaign, showAll: expanded, onShowAllChange: setExpanded }: FeatureViewProps & { data: DeepDigData; raw: DeepDigData }) {
  const def = effectiveData.definition;
  const [showDeleted, setShowDeleted] = useState(false);
  /** 看哪个变量（时间序列图里选）；null = 公式最后一句（核心变量）。分组表、点阵图、细节、逐场数据都跟着它。 */
  const [seriesVar, setSeriesVar] = useState<string | null>(null);
  const result = useMemo(() => viewForVariable(effectiveData, seriesVar), [effectiveData, seriesVar]);
  /** 选的是公式里别的变量（不是最后一句）时它的名字。 */
  const varName = seriesVar != null && result !== effectiveData ? seriesVar : null;
  const removed = useMemo(() => {
    const drop = new Set(excluded);
    return viewForVariable(raw, seriesVar).rows.filter(r => drop.has(r.id)).sort((a, b) => b.anchorMs - a.anchorMs);
  }, [raw, excluded, seriesVar]);
  const remove = (id: string) => onExcludedChange([...excluded.filter(x => x !== id), id]);
  const restore = (id: string) => onExcludedChange(excluded.filter(x => x !== id));
  const bp = (v: number | null | undefined, d = 2) => fmtValue(def, v, d);
  // 表头用公式里的名字（最后一句没起名时用简称），免得「V」和公式里的变量 V 混淆
  const resultName = formulaVariables(def.formula).result;
  const X = varName ?? (resultName !== RESULT_VAR ? resultName : def.short || '值');
  const stats = result.groups;
  const byGroup = Object.fromEntries(stats.map(s => [s.group, s])) as Record<DeepDigRowGroup, (typeof stats)[number]>;
  const listed = useMemo(
    () => result.rows.filter(r => r.group === group).sort((a, b) => b.anchorMs - a.anchorMs),
    [result.rows, group],
  );
  const c = result.coverage;
  const shown = expanded ? listed : listed.slice(0, ROWS_PREVIEW);
  return (
    <div className="space-y-6" data-testid="deep-dig-describe">
      <Block title="分组" aside={(
        <span className="text-[11px] text-muted-foreground" data-testid="deep-dig-groups-var">
          按 <span className="font-mono text-foreground">{X}</span> 统计{varName ? `（公式里的变量）· 原值 × ${def.scale}` : def.unit ? ` · 单位 ${def.unit}` : ''} · 跟着下面时间序列图选的变量
        </span>
      )}>
        <GroupCriteria def={liveDef} resultDef={def} samples={samples} onSave={onSaveDef} testId="deep-dig-describe-groups" />
        <table className="text-[11.5px]" data-testid="deep-dig-groups">
          <thead>
            <tr className="text-muted-foreground">
              <th className={TH}>组</th><th className={TH}>n</th><th className={TH}>均值</th><th className={TH}>标准差</th>
              <th className={TH}>中位数</th><th className={cn(TH, 'max-sm:hidden')}>四分位</th><th className={cn(TH, 'pr-0')}>{X} &gt; 0</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {DEEP_DIG_GROUPS.map(g => {
              const s = byGroup[g];
              return (
                <tr key={g} className="border-t border-border/40">
                  <td className={cn(TD, 'font-sans', GROUP_TONE[g])}>{groupLabel(g, def.source)}</td>
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

      <Block title="时间序列" aside={<span className="text-[11px] text-muted-foreground">各组平均 · 进场前后</span>} testId="deep-dig-series-block">
        <SeriesChart data={result} series={series && series.finishedAt === raw.finishedAt ? series : null} variable={seriesVar} onVariable={setSeriesVar} />
      </Block>

      <Block title="细节">
        <ul className="list-disc space-y-1 pl-4 text-[11.5px] text-foreground/85" data-testid="deep-dig-details">
          <li>
            {def.source === 'signals' ? (
              <>样本：信号库里的 <N>{c.campaigns}</N> 条信号，每条信号单独一个事件（时间点 = 信号时间，读数 = 它的评级），有没有交易战役都算；</>
            ) : (
              <>样本：<N>{c.campaigns}</N> 场战役，同一个币 48 小时内的合为一簇 → <N>{c.clusters}</N> 簇，每簇取一个代表；</>
            )}
            另在同一批币、同一段时间里随机抽 <N>{byGroup.background?.n ?? 0}</N> 个时点作参照。
          </li>
          {DEEP_DIG_GROUPS.map(g => (
            <li key={g}><span className={GROUP_TONE[g]}>{groupLabel(g, def.source)}</span>：{groupNote(def, g)}</li>
          ))}
          <li>
            {X} 按上面的公式，在进场前 <N>{featureWindowMs(def) / 3_600_000}</N> 小时的已收盘 <N>{intervalOf(def)}</N> K 线上逐根算（半衰期 hl = <N>{halfLifeOf(def)}</N> 小时、平均时长 avgh = <N>{avgHoursOf(def)}</N> 小时）、取最后一根；算不出来的记缺失（<N>{c.featureMissing}</N> 个）
            {c.failed > 0 && <>，K 线没取到的 <N>{c.failed}</N> 个</>}。
          </li>
          {removed.length > 0 && <li>手动删掉 <N>{removed.length}</N> 行（归类不准确等）：不进上面的分组统计、推断统计与规律提取。</li>}
          <li>
            {X} &gt; 0 的占比：实验组 <N>{pct(byGroup.positive?.sharePositive, 0)}</N>、对照组 <N>{pct(byGroup.control?.sharePositive, 0)}</N>、
            随机时点 <N>{pct(byGroup.background?.sharePositive, 0)}</N>。
          </li>
        </ul>
      </Block>

      <Block title="数据" aside={<span className="text-[11px] text-muted-foreground">点一行打开交易战役</span>}>
        <div className="inline-flex flex-wrap items-center gap-0.5 rounded-md border border-border/70 bg-muted/40 p-0.5" role="group" aria-label="数据分组">
          {DEEP_DIG_GROUPS.map(g => (
            <button
              key={g}
              type="button"
              aria-pressed={g === group}
              data-testid={`deep-dig-group-${g}`}
              onClick={() => onGroupChange(g)}
              className={cn('inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11.5px] transition-colors',
                g === group ? 'bg-card font-medium shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:bg-accent' : 'text-muted-foreground hover:text-foreground')}
            >
              <span className={g === group ? GROUP_TONE[g] : undefined}>{groupLabel(g, def.source)}</span>
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
                <th className={TH}>{X}</th>
                <th className={TH}>24h 期末</th>
                <th className={cn(TH, 'max-sm:hidden')}>24h 最大涨</th>
                <th className="w-6" aria-label="删除" />
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                // 信号样本没有对应的战役可打开
                const target = def.source === 'signals' ? undefined : r.memberIds[0];
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
                    <td className={cn(TD, 'font-mono tabular-nums text-muted-foreground max-sm:hidden')}>{pct(r.maxUp)}</td>
                    <td className="py-1">
                      <button
                        type="button"
                        aria-label="删掉这一行"
                        title="删掉这一行（不进统计，可恢复）"
                        data-testid="deep-dig-row-delete"
                        onClick={e => { e.stopPropagation(); remove(r.id); }}
                        className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:text-[#F6465D] focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-25"
                      >
                        <XIcon className="h-3 w-3" />
                      </button>
                    </td>
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
        {removed.length > 0 && (
          <div className="space-y-1.5 pt-1" data-testid="deep-dig-removed">
            <button type="button" onClick={() => setShowDeleted(v => !v)} data-testid="deep-dig-removed-toggle" className="text-[11px] text-muted-foreground/60 hover:text-foreground">
              已删 <span className="font-mono tabular-nums">{removed.length}</span> 行 · {showDeleted ? '收起' : '查看 / 恢复'}
            </button>
            {showDeleted && (
              <table className="text-[11.5px] text-muted-foreground">
                <tbody>
                  {removed.map(r => (
                    <tr key={r.id} className="border-b border-border/40" data-testid="deep-dig-removed-row">
                      <td className={cn(TD, 'font-mono tabular-nums')}>{formatBeijingTime(r.anchorMs).slice(5, 16)}</td>
                      <td className={TD}>{r.symbol.replace(/USDT$/, '')}</td>
                      <td className={cn(TD, GROUP_TONE[r.group])}>{groupLabel(r.group, def.source)}</td>
                      <td className={cn(TD, 'font-mono tabular-nums')}>{bp(r.v)}</td>
                      <td className="py-1">
                        <button type="button" onClick={() => restore(r.id)} data-testid="deep-dig-row-restore" className="inline-flex items-center gap-1 hover:text-foreground">
                          <Undo2 className="h-3 w-3" />恢复
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </Block>
    </div>
  );
}

/** 四组的特征值点阵：每个点一个事件，竖线 = 中位数，浅色条 = 四分位区间，橘黄虚线 = 0。两端 1% 的极端值压在边上。 */
function StripPlot({ result }: { result: DeepDigData }) {
  const def = result.definition;
  const SCALE = def.scale;
  const values = result.rows.map(r => r.v).filter(finite).map(v => v * SCALE).sort((a, b) => a - b);
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
        {DEEP_DIG_GROUPS.map(g => {
          const s = stat[g];
          const vs = result.rows.filter(r => r.group === g && finite(r.v)).map(r => r.v! * SCALE);
          return (
            <div key={g} className="contents">
              <span className={cn('text-[11px]', GROUP_TONE[g])}>{groupLabel(g, def.source)}</span>
              <div className="relative h-4">
                <div className="absolute inset-y-[7px] left-0 right-0 bg-border/50" />
                {finite(s?.q25) && finite(s?.q75) && (
                  <div className="absolute inset-y-[4px] rounded-sm bg-foreground/[0.07]" style={{ left: x(s.q25 * SCALE), width: `calc(${x(s.q75 * SCALE)} - ${x(s.q25 * SCALE)})` }} />
                )}
                <div className="absolute inset-y-0 border-l border-dashed border-[#F59E0B]" style={{ left: x(0) }} />
                {vs.map((v, i) => (
                  <span key={i} className={cn('absolute top-1/2 h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full', DOT[g])} style={{ left: x(v) }} />
                ))}
                {finite(s?.median) && <span className="absolute inset-y-0 w-[2px] -translate-x-1/2 rounded bg-foreground" style={{ left: x(s.median * SCALE) }} title={`中位数 ${fmtValue(result.definition, s.median)}`} />}
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


// ===================== 规律提取 =====================

function RulesTab({ data, inference, note, onSaveNote }: FeatureViewProps & { data: DeepDigData | null }) {
  const result = data;
  const defaults = useMemo(() => (data ? deepDigRules(data, inference) : []), [data, inference]);
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
