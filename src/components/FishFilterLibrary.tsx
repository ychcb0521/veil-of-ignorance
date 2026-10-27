/** 过滤库：买前过滤每一轮冻结的条件与判断（数据见 lib/fish/qualityFilterLibrary）。 */
import { useCallback, useMemo } from 'react';
import { FishLibraryDialog, libraryCell } from '@/components/FishLibraryDialog';
import type { FishQualityStudy } from '@/lib/fish/quality';
import type { QualityFilterRecord, QualityFilterSetting } from '@/lib/fish/qualityFilterLibrary';
import { libraryRoundRecordIds } from '@/lib/fish/libraryRounds';
import { qualityFilterValueText } from '@/lib/fish/qualityFilterColumns';
import { formatUTC8 } from '@/lib/timeFormat';

const date = (t: number | null | undefined) => t == null ? '—' : formatUTC8(t);
const conditions = (s: QualityFilterSetting) => s.filters.map(f => `${f.label} ${f.direction} ${f.threshold}`).join(' 且 ');
const STATE = { pass: ['满足', 'text-emerald-600 dark:text-emerald-400'], fail: ['不满足', 'text-destructive'], error: ['缺数据', 'text-muted-foreground'], pending: ['待判断', 'text-muted-foreground'], none: ['不过滤', 'text-muted-foreground'] } as const;
const ROUND_STATE = { running: '运行中', complete: '已完成', paused: '已暂停', failed: '失败' } as const;

export function FishFilterLibrary({ study }: { study: FishQualityStudy }) {
  const library = study.filterLibrary;
  const settings = useMemo(() => new Map((library?.settings ?? []).map(s => [s.id, s])), [library?.settings]);
  const rounds = useMemo(() => [...(library?.rounds ?? [])].sort((a, b) => b.startedAt - a.startedAt), [library?.rounds]);
  const roundIds = useMemo(() => {
    const cache = new Map<string, string[]>(), all = library?.rounds ?? [];
    return new Map(rounds.map(r => [r.id, new Set(libraryRoundRecordIds(all, r, cache))]));
  }, [rounds, library?.rounds]);
  const items = useMemo(() => [...(library?.records ?? [])].filter(r => settings.has(r.settingId))
    .sort((a, b) => b.updatedAt - a.updatedAt || b.source.timeMs - a.source.timeMs || a.source.symbol.localeCompare(b.source.symbol)), [library?.records, settings]);
  const options = rounds.map((r, i) => ({ id: r.id, label: `第 ${rounds.length - i} 轮 · ${date(r.startedAt)} · ${ROUND_STATE[r.state]} · ${roundIds.get(r.id)?.size ?? 0} 条`, error: r.error }));
  const match = useCallback((r: QualityFilterRecord, needle: string, roundId: string) => {
    if (roundId && !roundIds.get(roundId)?.has(r.id)) return false;
    const s = settings.get(r.settingId)!;
    return !needle || r.source.symbol.toUpperCase().includes(needle) || conditions(s).toUpperCase().includes(needle) || s.plans.some(p => p.toUpperCase().includes(needle));
  }, [roundIds, settings]);
  const settingCount = settings.size, recordCount = items.length;
  return <FishLibraryDialog name="过滤库" roundLabel="轮次" rounds={options} placeholder="搜索标的、过滤条件或卖出方案…"
    description={`${recordCount} 条记录 · ${settingCount} 组条件 · ${rounds.length} 轮过滤`}
    info={<><p>每点一次「开始过滤」（改了条件后自动重跑的也算）记一轮，冻结当时每套卖出方案启用的买入条件，以及每条信号的读数和是否满足。</p><p>同一组条件下，同标的、同信号时间、同买入时刻的合并为一条，保留最新判断；每轮仍可单独查看。只改门槛、读数可直接复用的，也记为新的一轮。</p><p>读数取买入时刻之前最后一根已收盘的 5 分钟 K 线。随账号保存。</p></>}
    headers={['标的', '信号时间', '买入时刻', '过滤条件', '用于卖出', '读数', '判断', '保存时间']}
    items={items} match={match}
    empty={{ none: '暂无过滤记录。设置买入条件并开始过滤后，每轮会自动保存。', unmatched: '没有匹配的过滤记录。' }}
    row={r => {
      const s = settings.get(r.settingId)!, [label, tone] = STATE[r.status.state];
      // 每个条件一个读数，顺序与「过滤条件」一致；悬停看逐条判断
      const readingText = s.filters.map((_, i) => { const x = r.readings[i]; return !x ? '—' : x.error || !Number.isFinite(x.value) ? '缺' : qualityFilterValueText(x.value!); }).join(' / ');
      return <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20" data-testid="filter-library-row" title={r.status.detail}>
        <td className={`${libraryCell} font-mono`}>{r.source.symbol}{r.origin === 'library' && <span className="ml-1.5 font-sans text-[9px] text-muted-foreground">信号库</span>}</td>
        <td className={`${libraryCell} font-mono text-muted-foreground`}>{date(r.source.timeMs)}</td>
        <td className={`${libraryCell} font-mono text-muted-foreground`}>{date(r.enteredAt)}</td>
        <td className={`${libraryCell} max-w-64 truncate`} title={conditions(s)}>{conditions(s)}</td>
        <td className={`${libraryCell} max-w-40 truncate text-muted-foreground`} title={s.plans.join('、')}>{s.plans.join('、')}</td>
        <td className={`${libraryCell} font-mono tabular-nums`}>{readingText}</td>
        <td className={`${libraryCell} ${tone}`}>{label}</td>
        <td className={`${libraryCell} font-mono text-muted-foreground`} title={date(r.updatedAt)}>{date(r.updatedAt).slice(5, 16)}</td>
      </tr>;
    }}/>;
}
