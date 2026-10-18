/**
 * 指标字母表：交易战役（列表页「统计概览」旁的「指标表」）与 Deep dig（分组标准处）共用这一张，数据来自 campaignMetricLetters。
 * 【用户要求】2026-10-16「在交易战役中、deep dig 中，都要有个表格，要统一」。左对齐紧凑：字母、名称、单位挨着。
 */
import { cn } from '@/lib/utils';
import { CAMPAIGN_METRIC_LETTERS, formatRangeValue, type LetterRange, type MetricSource } from '@/lib/campaignMetricLetters';
import { MINOR_METRIC_LETTERS, MINOR_METRICS_NAMES, MINOR_TOGGLE_CLASS } from '@/lib/campaignMinorMetrics';
import { useShowMinorMetrics } from '@/hooks/useShowMinorMetrics';

const SECTION: Record<MetricSource, string> = { campaign: '交易战役（每场战役一个读数）', signal: '信号库（每条信号一个读数，时间点是这条信号的时间）' };

export function MetricLetterTable({ sources = ['campaign', 'signal'], highlight, className, ranges, rangeNoun = '场' }: {
  sources?: readonly MetricSource[];
  /** 当前用到的字母（Deep dig 分组标准里写了的），淡淡标一下。 */
  highlight?: ReadonlySet<string>;
  className?: string;
  /**
   * 【用户要求】2026-10-18「我想知道每个指标可以输入的数值范围」：本机样本里每个字母的最小 ~ 最大、中位数、有读数的个数；
   * 给了才多一列（按字母取；这一节没有数据的字母那一格空着）。
   */
  ranges?: Readonly<Record<string, LetterRange>>;
  /** 样本的量词（场 / 条）。 */
  rangeNoun?: string;
}) {
  // 【用户要求】不常用的指标（单位利润、仓位利润、仓位利润（理论）、加仓效用、算术期望、仓位放大）折起来：
  // 交易战役那一节右角一个很小、很淡的「›」展开（与列表、盈亏概览同一个开关）；分组标准里用到的照常显示
  const [showMinor, toggleMinor] = useShowMinorMetrics();
  const folded = (letter: string) => !showMinor && MINOR_METRIC_LETTERS.has(letter) && !highlight?.has(letter);
  return (
    <div className={cn('space-y-2 text-[11px]', className)} data-testid="metric-letter-table">
      {sources.map(source => (
        <div key={source} className="space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10.5px] font-medium text-muted-foreground">
              {SECTION[source]}
              {ranges && <span className="ml-1.5 font-normal" data-testid="metric-letter-range-note">· 本机范围 = 最小 ~ 最大（中位数），写条件用同样的单位：% 写 10 = 10%</span>}
            </div>
            {source === 'campaign' && (
              <button
                type="button"
                data-testid="metric-letter-minor-toggle"
                role="switch"
                aria-checked={showMinor}
                aria-label="显示不常用指标"
                title={`${showMinor ? '收起' : '展开'}不常用指标：${MINOR_METRICS_NAMES}`}
                onClick={toggleMinor}
                className={MINOR_TOGGLE_CLASS}
              >
                {showMinor ? '‹' : '›'}
              </button>
            )}
          </div>
          <table className="w-full">
            <tbody>
              {CAMPAIGN_METRIC_LETTERS.filter(m => m.source === source).map(m => (
                <tr key={m.letter} className={cn('border-t border-border/40 align-top', highlight?.has(m.letter) && 'bg-[#F0B90B]/[0.08]', folded(m.letter) && 'hidden')} data-testid={`metric-letter-${m.aliases[0] ?? m.letter}`}>
                  <td className="w-[38px] whitespace-nowrap py-0.5 pr-2 font-mono text-[12px] font-medium text-foreground">{m.letter}</td>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-foreground">{m.name}</td>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-muted-foreground">{m.unit}</td>
                  {ranges && <RangeCell range={ranges[m.letter]} noun={rangeNoun} />}
                  <td className="py-0.5 text-muted-foreground">
                    {m.help}
                    {m.aliases.length > 0 && <span className="ml-1 font-mono text-[10.5px] text-muted-foreground/80">（也可写 {m.aliases.join(' / ')}）</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function RangeCell({ range, noun }: { range: LetterRange | undefined; noun: string }) {
  if (!range) return <td className="py-0.5 pr-2" />;
  if (range.n === 0) {
    return <td className="whitespace-nowrap py-0.5 pr-2 text-[#C27C0E] dark:text-[#F59E0B]" data-testid="metric-letter-range" title={`本机 ${range.total} ${noun}都没有这个读数：用它分组会全部归「其他」`}>没有读数</td>;
  }
  return (
    <td className="whitespace-nowrap py-0.5 pr-2 font-mono tabular-nums text-foreground/85" data-testid="metric-letter-range"
      title={`本机 ${range.total} ${noun}里 ${range.n} ${noun}有读数：最小 ${formatRangeValue(range.min)}、最大 ${formatRangeValue(range.max)}、中位数 ${formatRangeValue(range.median)}`}>
      {formatRangeValue(range.min)} ~ {formatRangeValue(range.max)}
      <span className="ml-1 font-sans text-[10.5px] text-muted-foreground">中位 {formatRangeValue(range.median)}{range.n < range.total ? ` · ${range.n}/${range.total}` : ''}</span>
    </td>
  );
}

/** 指标名前的小字母（盈亏概览用）：字母用 ::before 画出来，不进文字内容——名字的文字、复制与按文字定位都不受影响。 */
export function MetricLetterTag({ letter }: { letter: string | undefined }) {
  if (!letter) return null;
  return <span aria-hidden="true" data-letter={letter} className="mr-1 text-[10px] text-muted-foreground/60 [font-family:ui-monospace,monospace] before:content-[attr(data-letter)]" data-testid="metric-letter-tag" />;
}
