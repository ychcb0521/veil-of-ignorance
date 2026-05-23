import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
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

  const range = params.get('range') ?? '30d';
  const symbols = (params.get('symbols') ?? '').split(',').filter(Boolean);
  const outcomes = (params.get('outcomes') ?? '').split(',').filter(Boolean);
  const cats = (params.get('cats') ?? '').split(',').filter(Boolean);
  const mentalMin = Number(params.get('mmin') ?? '1');
  const mentalMax = Number(params.get('mmax') ?? '5');

  const allSymbols = useMemo(() => Array.from(new Set(journals.map(j => j.symbol))).sort(), [journals]);

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

  const outcomeOpts: { v: TradeOutcome; label: string }[] = [
    { v: 'win', label: '盈' }, { v: 'loss', label: '亏' },
    { v: 'breakeven', label: '平' }, { v: 'no_entry', label: '未入场' },
  ];

  const reset = () => setParams(new URLSearchParams(), { replace: true });

  return (
    <div className="bg-card border-b border-border">
      <div className="px-6 py-2 max-w-[1600px] mx-auto flex flex-wrap items-center gap-3 text-[11px]">
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">区间</span>
          {PRESETS.map(p => (
            <button key={p.key}
              onClick={() => update({ range: p.key === '30d' ? undefined : p.key })}
              className={`h-6 px-2 rounded ${range === p.key ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground hover:bg-[#363c45]'}`}>
              {p.label}
            </button>
          ))}
        </div>

        <Multi label="标的" options={allSymbols} selected={symbols}
          onToggle={v => toggleIn('symbols', symbols, v)} />
        <Multi label="结果" options={outcomeOpts.map(o => o.v)} selected={outcomes}
          onToggle={v => toggleIn('outcomes', outcomes, v)}
          renderLabel={v => outcomeOpts.find(o => o.v === v)?.label ?? v} />
        <Multi label="大类" options={categories.map(c => c.id)} selected={cats}
          onToggle={v => toggleIn('cats', cats, v)}
          renderLabel={id => categories.find(c => c.id === id)?.name_zh ?? id} />

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">心态</span>
          <select value={mentalMin}
            onChange={e => update({ mmin: e.target.value === '1' ? undefined : e.target.value })}
            className="h-6 bg-muted rounded px-1 text-[11px]">
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="text-muted-foreground">~</span>
          <select value={mentalMax}
            onChange={e => update({ mmax: e.target.value === '5' ? undefined : e.target.value })}
            className="h-6 bg-muted rounded px-1 text-[11px]">
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <button onClick={reset} className="h-6 px-2 text-muted-foreground hover:text-foreground">重置</button>
      </div>
    </div>
  );
}

function Multi({ label, options, selected, onToggle, renderLabel }: {
  label: string; options: string[]; selected: string[];
  onToggle: (v: string) => void; renderLabel?: (v: string) => string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1 max-w-[320px]">
        {options.map(o => {
          const on = selected.includes(o);
          return (
            <button key={o} onClick={() => onToggle(o)}
              className={`h-6 px-2 rounded text-[11px] ${on ? 'bg-[#F0B90B] text-black' : 'bg-muted text-foreground hover:bg-[#363c45]'}`}>
              {renderLabel ? renderLabel(o) : o}
            </button>
          );
        })}
        {options.length === 0 && <span className="text-[11px] text-muted-foreground italic">无</span>}
      </div>
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
