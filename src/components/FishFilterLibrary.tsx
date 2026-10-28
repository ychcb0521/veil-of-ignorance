import { filterLibraryCondition, libraryConditionSearch } from '@/lib/fish/libraryConditions';
import { FishLibraryCondition } from '@/components/FishLibraryConditions';
/** 过滤库：买前过滤每一轮冻结的条件与判断（数据见 lib/fish/qualityFilterLibrary）。 */
import { useCallback, useMemo } from 'react';
import { FishLibraryDialog, libraryCell } from '@/components/FishLibraryDialog';
import type { FishQualityStudy } from '@/lib/fish/quality';
import type { QualityFilterRecord, QualityFilterSetting } from '@/lib/fish/qualityFilterLibrary';
import { libraryRoundRecordIds } from '@/lib/fish/libraryRounds';
import { qualityFilterValueText } from '@/lib/fish/qualityFilterColumns';
import { formatUTC8 } from '@/lib/timeFormat';

const date = (t: number | null | undefined) => t == null ? '—' : formatUTC8(t);

const STATE = { pass: ['满足', 'text-emerald-600 dark:text-emerald-400'], fail: ['不满足', 'text-destructive'], error: ['缺数据', 'text-muted-foreground'], pending: ['待判断', 'text-muted-foreground'], none: ['不过滤', 'text-muted-foreground'] } as const;
const ROUND_STATE = { running: '运行中', complete: '已完成', paused: '已暂停', failed: '失败' } as const;

export function FishFilterLibrary({ study }: { study: FishQualityStudy }) {
  const library = study.filterLibrary;
  const settings = useMemo(() => new Map((library?.settings ?? []).map(s => [s.id, s])), [library?.settings]);
  const evidence=useMemo(()=>new Map([...settings.values()].map(s=>[s.id,s.filters.map(filterLibraryCondition)])),[settings]);
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
    return !needle || r.source.symbol.toUpperCase().includes(needle) || evidence.get(s.id)!.some(c=>libraryConditionSearch(c).toUpperCase().includes(needle)) || s.plans.some(p => p.toUpperCase().includes(needle));
  }, [roundIds, settings,evidence]);
  const settingCount = settings.size, recordCount = items.length;
  return <FishLibraryDialog name="过滤库" roundLabel="轮次" rounds={options} placeholder="搜索标的、过滤条件…"
    description={`${recordCount} 条记录 · ${settingCount} 组条件 · ${rounds.length} 轮过滤`}
    info={<><p>每点一次「开始过滤」记一轮，逐条展示当时实际使用的具体序列、方向、门槛、周期及历史公式版本，点击详情可核对公式与参数。独立保存过滤条件、每条信号的读数及判断，不要求配置或运行卖出算法。历史绑定条件的记录按原样保留。</p><p>同一组条件下，同标的、同信号时间、同买入时刻的合并为一条，保留最新判断；每轮仍可单独查看。只改门槛、读数可直接复用的，也记为新的一轮。</p><p>读数取买入时刻之前最后一根已收盘 K 线，具体周期以各条件的历史快照为准。随账号保存。</p></>}
    headers={['标的', '信号时间', '买入时刻', '过滤条件', '关联方式', '读数', '判断', '保存时间']}
    items={items} match={match}
    empty={{ none: '暂无过滤记录。设置买入条件并开始过滤后，每轮会自动保存。', unmatched: '没有匹配的过滤记录。' }}
    row={r => {
      const s = settings.get(r.settingId)!,saved=evidence.get(s.id)!, [label, tone] = STATE[r.status.state];
      // 每个条件一个读数，顺序与「过滤条件」一致；悬停看逐条判断
      const readingText = s.filters.map((_, i) => { const x = r.readings[i]; return !x ? '—' : x.error || !Number.isFinite(x.value) ? '缺' : qualityFilterValueText(x.value!); }).join(' / ');
      return <tr key={r.id} className="border-t border-border/40 hover:bg-muted/20" data-testid="filter-library-row" title={r.status.detail}>
        <td className={`${libraryCell} font-mono`}>{r.source.symbol}{r.origin === 'library' && <span className="ml-1.5 font-sans text-[9px] text-muted-foreground">信号库</span>}</td>
        <td className={`${libraryCell} font-mono text-muted-foreground`}>{date(r.source.timeMs)}</td>
        <td className={`${libraryCell} font-mono text-muted-foreground`}>{date(r.enteredAt)}</td>
        <td className={`${libraryCell} min-w-[320px] max-w-[440px] align-top`}><p className="mb-1 text-[9px] text-muted-foreground">{saved.length>1?'交集 · 以下条件全部满足':'单条件'}</p><div className="space-y-1.5">{saved.map((c,i)=><FishLibraryCondition key={i} condition={c}/>)}</div></td>
        <td className={`${libraryCell} max-w-40 truncate text-muted-foreground`} title={s.plans.join('、')}>{s.plans.length ? `历史绑定 · ${s.plans.join('、')}` : '独立过滤'}</td>
        <td className={`${libraryCell} min-w-[180px] align-top font-mono tabular-nums`} title={readingText}><p className="mb-1 font-sans text-[9px] text-muted-foreground">与左侧条件逐项对应</p><div className="space-y-1.5">{saved.map((c,i)=>{const x=r.readings[i],f=s.filters[i],valid=x&&!x.error&&Number.isFinite(x.value),passed=valid&&(f.direction==='>'?x.value!>f.threshold:x.value!<f.threshold);return <div key={i} className="min-h-9" title={x?.error??(x?.at?`读数时点：${date(x.at)}`:undefined)}><p className="text-foreground">{c.metric} = {valid?qualityFilterValueText(x.value!):x?'缺数据':'待计算'}</p><p className={`font-sans text-[9px] ${valid?passed?'text-emerald-600 dark:text-emerald-400':'text-destructive':'text-muted-foreground'}`}>{valid?passed?'满足':'不满足':x?'读数无效':'尚未取得读数'}</p></div>;})}</div></td>
        <td className={`${libraryCell} ${tone}`}>{label}</td>
        <td className={`${libraryCell} font-mono text-muted-foreground`} title={date(r.updatedAt)}>{date(r.updatedAt).slice(5, 16)}</td>
      </tr>;
    }}/>;
}
