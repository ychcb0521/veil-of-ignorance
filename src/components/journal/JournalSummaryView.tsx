/**
 * 错题集「汇总」视图：把开仓快照 / 平仓评价里每个问题做成一行可展开，
 * 展开后看到的是历史全部单子在这个问题上的答案分布 / 列表 / 数值统计。
 *
 * 渲染策略：
 *   - 单选（enum） → 分布条
 *   - 多选（multi） → 分布条（按"被选频次"计）
 *   - 数值（numeric） → 均值 / 中位 / 极值 + 分布条
 *   - 文本（text） → 所有历史回答的滚动列表，可点击跳到该笔回放
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { TradeJournal } from '@/types/journal';
import {
  PRE_FIELD_SPECS, POST_FIELD_SPECS, summarizeField,
  OUTCOME_LABEL, OUTCOME_COLOR,
  type FieldSummary, type SummaryFieldSpec, type EnumBucket,
} from '@/lib/journalSummary';

interface Props {
  journals: TradeJournal[];
}

export function JournalSummaryView({ journals }: Props) {
  // 只看主力单（不含对冲、不含"太难"），让答案分布有意义；对冲单各字段语义差异太大。
  const scopedJournals = useMemo(
    () => journals.filter(j => (
      j.order_kind !== 'hedge'
      && (j.journal_kind ?? 'trade') === 'trade'
    )),
    [journals],
  );

  return (
    <div className="space-y-6">
      <header className="rounded-xl border border-border/60 bg-card px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold text-foreground">所有单子的汇总</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              把开仓快照与平仓评价里每个问题展开 —— 看到的不是单笔，是历史全部主力单在这个问题上的答案。
              选项题看分布条；文本题看完整历史回答列表（点击跳到该笔回放）；数值题看均值与分布。
            </p>
          </div>
          <span className="rounded-full border border-border/60 px-3 py-1 font-mono text-[11px] text-muted-foreground">
            纳入统计：{scopedJournals.length} 笔主力单
          </span>
        </div>
      </header>

      <SummaryBlock title="开仓快照汇总" specs={PRE_FIELD_SPECS} journals={scopedJournals} />
      <SummaryBlock title="平仓评价汇总" specs={POST_FIELD_SPECS} journals={scopedJournals} />
    </div>
  );
}

function SummaryBlock({
  title, specs, journals,
}: {
  title: string;
  specs: SummaryFieldSpec[];
  journals: TradeJournal[];
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="border-b border-border/60 px-5 py-3">
        <h3 className="text-[12px] font-semibold text-foreground">{title}</h3>
      </div>
      <ul className="divide-y divide-border/60">
        {specs.map(spec => (
          <li key={String(spec.key)}>
            <FieldRow spec={spec} journals={journals} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function FieldRow({ spec, journals }: { spec: SummaryFieldSpec; journals: TradeJournal[] }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarizeField(journals, spec), [journals, spec]);
  const total = summary.filled + summary.empty;
  const fillRate = total > 0 ? Math.round((summary.filled / total) * 100) : 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-accent/30 transition-colors">
        <div className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-foreground truncate">{spec.label}</div>
            {spec.hint && (
              <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground truncate">{spec.hint}</div>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span>{summary.filled}/{total} 填</span>
          <span className="rounded-full border border-border/60 px-2 py-0.5">{fillRate}%</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-5 pb-4">
        <SummaryDetail summary={summary} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function SummaryDetail({ summary }: { summary: FieldSummary }) {
  if (summary.filled === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-background/40 px-3 py-3 text-[11px] text-muted-foreground text-center">
        历史所有单子都没有填这个字段。
      </div>
    );
  }
  switch (summary.type) {
    case 'enum':   return <DistributionBars buckets={summary.buckets} totalNote={`${summary.filled} 笔已填`} />;
    case 'multi':  return <DistributionBars buckets={summary.buckets} totalNote={`${summary.filled} 笔已填 · 合计被选 ${summary.selections} 次`} />;
    case 'numeric': return <NumericDetail summary={summary} />;
    case 'text':   return <TextList answers={summary.answers} />;
  }
}

function DistributionBars({ buckets, totalNote }: { buckets: EnumBucket[]; totalNote: string }) {
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono text-muted-foreground">{totalNote}</div>
      <ul className="space-y-1.5">
        {buckets.filter(b => b.count > 0).map(b => {
          const width = Math.max(2, (b.count / maxCount) * 100);
          const accent = b.accent ?? 'hsl(var(--muted-foreground) / 0.55)';
          return (
            <li key={b.value} className="flex items-center gap-2">
              <span className="w-[120px] shrink-0 truncate text-[11px] text-foreground" title={b.label}>{b.label}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-background/70">
                <div className="h-full rounded-full" style={{ width: `${width}%`, background: accent }} />
              </div>
              <span className="w-[70px] shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                {b.count} · {Math.round(b.share * 100)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NumericDetail({ summary }: { summary: Extract<FieldSummary, { type: 'numeric' }> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]">
        <Stat label="均值" value={fmtNumber(summary.mean)} />
        <Stat label="中位" value={fmtNumber(summary.median)} />
        <Stat label="最小" value={fmtNumber(summary.min)} />
        <Stat label="最大" value={fmtNumber(summary.max)} />
      </div>
      <DistributionBars buckets={summary.buckets} totalNote={`${summary.filled} 笔已填`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/60 px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-[12px] text-foreground">{value}</div>
    </div>
  );
}

function fmtNumber(n: number | null): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 100) return n.toFixed(0);
  return n.toFixed(2);
}

function TextList({ answers }: { answers: Array<{ journalId: string; symbol: string; direction: string | null; timeIso: string; outcome: string | null; text: string }> }) {
  const nav = useNavigate();
  return (
    <div className="space-y-2">
      <div className="text-[10px] font-mono text-muted-foreground">{answers.length} 条历史回答 · 按时间倒序</div>
      <ul className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
        {answers.map(a => (
          <li key={a.journalId}>
            <button
              type="button"
              onClick={() => nav(`/journal/${a.journalId}`)}
              className="w-full rounded-lg border border-border/60 bg-background/70 px-3 py-2 text-left hover:border-[#F0B90B]/40 hover:bg-[#F0B90B]/[0.03] transition-colors"
              title="点击跳到该笔回放"
            >
              <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground">
                <span className="text-foreground">{a.symbol}</span>
                {a.direction && <span>·</span>}
                {a.direction && <span>{a.direction}</span>}
                <span>·</span>
                <span>{fmtTime(a.timeIso)}</span>
                {a.outcome && (
                  <span
                    className="ml-auto rounded-full border px-1.5 py-0.5 text-[9px]"
                    style={{ borderColor: `${OUTCOME_COLOR[a.outcome] ?? '#9AA0A6'}66`, color: OUTCOME_COLOR[a.outcome] ?? '#9AA0A6' }}
                  >
                    {OUTCOME_LABEL[a.outcome] ?? a.outcome}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[12px] leading-relaxed text-foreground whitespace-pre-wrap break-words">{a.text}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function fmtTime(iso: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}
