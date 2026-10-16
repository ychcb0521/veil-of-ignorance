/**
 * 指标字母表：交易战役（列表页「统计概览」旁的「指标表」）与 Deep dig（分组标准处）共用这一张，数据来自 campaignMetricLetters。
 * 【用户要求】2026-10-16「在交易战役中、deep dig 中，都要有个表格，要统一」。左对齐紧凑：字母、名称、单位挨着。
 */
import { cn } from '@/lib/utils';
import { CAMPAIGN_METRIC_LETTERS, type MetricSource } from '@/lib/campaignMetricLetters';

const SECTION: Record<MetricSource, string> = { campaign: '交易战役（每场战役一个读数）', signal: '信号库（每条信号一个读数，时间点是这条信号的时间）' };

export function MetricLetterTable({ sources = ['campaign', 'signal'], highlight, className }: {
  sources?: readonly MetricSource[];
  /** 当前用到的字母（Deep dig 分组标准里写了的），淡淡标一下。 */
  highlight?: ReadonlySet<string>;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2 text-[11px]', className)} data-testid="metric-letter-table">
      {sources.map(source => (
        <div key={source} className="space-y-0.5">
          <div className="text-[10.5px] font-medium text-muted-foreground">{SECTION[source]}</div>
          <table className="w-full">
            <tbody>
              {CAMPAIGN_METRIC_LETTERS.filter(m => m.source === source).map(m => (
                <tr key={m.letter} className={cn('border-t border-border/40 align-top', highlight?.has(m.letter) && 'bg-[#F0B90B]/[0.08]')} data-testid={`metric-letter-${m.aliases[0] ?? m.letter}`}>
                  <td className="w-[38px] whitespace-nowrap py-0.5 pr-2 font-mono text-[12px] font-medium text-foreground">{m.letter}</td>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-foreground">{m.name}</td>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-muted-foreground">{m.unit}</td>
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

/** 指标名前的小字母（盈亏概览用）：字母用 ::before 画出来，不进文字内容——名字的文字、复制与按文字定位都不受影响。 */
export function MetricLetterTag({ letter }: { letter: string | undefined }) {
  if (!letter) return null;
  return <span aria-hidden="true" data-letter={letter} className="mr-1 text-[10px] text-muted-foreground/60 [font-family:ui-monospace,monospace] before:content-[attr(data-letter)]" data-testid="metric-letter-tag" />;
}
