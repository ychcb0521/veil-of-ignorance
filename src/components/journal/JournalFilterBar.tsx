/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ErrorTagCategory, TradeJournal, TradeOutcome } from '@/types/journal';

interface Props {
  journals: TradeJournal[];
  categories: ErrorTagCategory[];
}

const PRESETS = [
  { key: '7d', label: '7天', days: 7 },
  { key: '30d', label: '30天', days: 30 },
  { key: '90d', label: '90天', days: 90 },
  { key: 'all', label: '全部', days: 0 },
];

export function JournalFilterBar({ journals, categories }: Props) {
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);

  const range = params.get('range') ?? '30d';
  const symbols = (params.get('symbols') ?? '').split(',').filter(Boolean);
  const outcomes = (params.get('outcomes') ?? '').split(',').filter(Boolean);
  const cats = (params.get('cats') ?? '').split(',').filter(Boolean);
  const mentalMin = Number(params.get('mmin') ?? '1');
  const mentalMax = Number(params.get('mmax') ?? '5');

  const allSymbols = useMemo(() => Array.from(new Set(journals.map(j => j.symbol))).sort(), [journals]);
  const activeCount = useMemo(() => {
    let count = 0;
    if (range !== '30d') count += 1;
    if (symbols.length) count += 1;
    if (outcomes.length) count += 1;
    if (cats.length) count += 1;
    if (mentalMin !== 1 || mentalMax !== 5) count += 1;
    return count;
  }, [cats.length, mentalMax, mentalMin, outcomes.length, range, symbols.length]);
  const summary = useMemo(() => {
    const parts: string[] = [];
    parts.push(PRESETS.find(p => p.key === range)?.label ?? '30天');
    if (symbols.length) parts.push(symbols.length === 1 ? symbols[0] : `${symbols.length} 个标的`);
    if (outcomes.length) parts.push(outcomes.map(v => outcomeLabel(v)).join('/'));
    if (cats.length) parts.push(`${cats.length} 类错误`);
    if (mentalMin !== 1 || mentalMax !== 5) parts.push(`心态 ${mentalMin}-${mentalMax}`);
    return parts.join(' · ');
  }, [cats.length, mentalMax, mentalMin, outcomes, range, symbols]);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  const toggleIn = (key: string, current: string[], val: string) => {
    const set = new Set(current);
    if (set.has(val)) set.delete(val); else set.add(val);
    update({ [key]: Array.from(set).join(',') });
  };
  const removeFrom = (key: string, current: string[], val: string) => {
    update({ [key]: current.filter(item => item !== val).join(',') });
  };

  const outcomeOpts: { v: TradeOutcome; label: string }[] = [
    { v: 'win', label: '盈' }, { v: 'loss', label: '亏' },
    { v: 'breakeven', label: '平' }, { v: 'no_entry', label: '未入场' },
  ];

  const reset = () => setParams(new URLSearchParams(), { replace: true });

  return (
    <div className="bg-background/95 border-b border-border">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="px-6 py-2 max-w-[1600px] mx-auto">
          <div className="flex flex-wrap items-center gap-2">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="h-8 inline-flex items-center gap-2 rounded border border-border bg-card px-3 text-[12px] hover:bg-accent"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                <span>筛选</span>
                {activeCount > 0 && (
                  <span className="rounded bg-[#F0B90B] px-1.5 py-0.5 text-[10px] leading-none text-black">{activeCount}</span>
                )}
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
            </CollapsibleTrigger>
            <div className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {summary || '30天 · 全部标的 · 全部结果 · 心态 1-5'}
            </div>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={reset}
                className="h-8 rounded px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                重置
              </button>
            )}
          </div>
        </div>

        <CollapsibleContent>
          <div className="border-t border-border/60">
            <div className="px-6 py-3 max-w-[1600px] mx-auto grid grid-cols-1 lg:grid-cols-[1.1fr_1fr_1.4fr_.9fr] gap-3 text-[11px]">
              <FilterGroup label="区间">
                <Segmented options={PRESETS.map(p => ({ value: p.key, label: p.label }))} value={range}
                  onChange={value => update({ range: value === '30d' ? undefined : value })} />
              </FilterGroup>

              <FilterGroup label="标的">
                <div className="space-y-2">
                  <select
                    value=""
                    onChange={e => {
                      if (e.target.value) toggleIn('symbols', symbols, e.target.value);
                    }}
                    className="h-8 w-full rounded border border-border bg-card px-2 text-[11px]"
                  >
                    <option value="">添加标的</option>
                    {allSymbols.map(symbol => (
                      <option key={symbol} value={symbol}>{symbol}</option>
                    ))}
                  </select>
                  <ChipList values={symbols} onRemove={value => removeFrom('symbols', symbols, value)} empty="全部标的" />
                </div>
              </FilterGroup>

              <FilterGroup label="结果 / 大类">
                <div className="space-y-2">
                  <Segmented options={outcomeOpts.map(o => ({ value: o.v, label: o.label }))} valueSet={outcomes}
                    onChange={value => toggleIn('outcomes', outcomes, value)} />
                  <div className="flex flex-wrap gap-1">
                    {categories.map(category => {
                      const on = cats.includes(category.id);
                      return (
                        <button key={category.id} type="button" onClick={() => toggleIn('cats', cats, category.id)}
                          className={`h-7 rounded px-2 ${on ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground hover:bg-accent'}`}>
                          {category.name_zh}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </FilterGroup>

              <FilterGroup label="心态">
                <div className="flex items-center gap-2">
                  <select value={mentalMin}
                    onChange={e => update({ mmin: e.target.value === '1' ? undefined : e.target.value })}
                    className="h-8 flex-1 rounded border border-border bg-card px-2 text-[11px]">
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <span className="text-muted-foreground">-</span>
                  <select value={mentalMax}
                    onChange={e => update({ mmax: e.target.value === '5' ? undefined : e.target.value })}
                    className="h-8 flex-1 rounded border border-border bg-card px-2 text-[11px]">
                    {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </FilterGroup>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function outcomeLabel(value: string) {
  return ({ win: '盈', loss: '亏', breakeven: '平', no_entry: '未入场' } as Record<string, string>)[value] ?? value;
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  valueSet,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  value?: string;
  valueSet?: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(option => {
        const on = valueSet ? valueSet.includes(option.value) : value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`h-8 rounded px-2.5 text-[11px] ${on ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground hover:bg-accent'}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function ChipList({ values, onRemove, empty }: { values: string[]; onRemove: (value: string) => void; empty: string }) {
  if (values.length === 0) return <div className="text-[11px] text-muted-foreground">{empty}</div>;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map(value => (
        <button key={value} type="button" onClick={() => onRemove(value)}
          className="inline-flex h-6 items-center gap-1 rounded bg-muted px-2 text-[10px] text-foreground hover:bg-accent">
          {value}
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

export function getFilteredJournals(journals: TradeJournal[], params: URLSearchParams, categoriesById: Map<string, string>): TradeJournal[] {
  const range = params.get('range') ?? '30d';
  const symbols = new Set((params.get('symbols') ?? '').split(',').filter(Boolean));
  const outcomes = new Set((params.get('outcomes') ?? '').split(',').filter(Boolean));
  const mmin = Number(params.get('mmin') ?? '1');
  const mmax = Number(params.get('mmax') ?? '5');
  const days = ({ '7d': 7, '30d': 30, '90d': 90, all: 0 } as Record<string, number>)[range] ?? 30;
  const since = days > 0 ? Date.now() - days * 86400000 : 0;
  return journals.filter(j => {
    if (since && new Date(j.pre_simulated_time).getTime() < since) return false;
    if (symbols.size && !symbols.has(j.symbol)) return false;
    if (outcomes.size && !outcomes.has(j.post_outcome ?? '')) return false;
    const m = j.pre_mental_state ?? 3;
    if (m < mmin || m > mmax) return false;
    return true;
  });
}
