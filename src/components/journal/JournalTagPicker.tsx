/**
 * 错误标签选择器 — 按 6 大类分组展示用户的 pattern，支持新增模式与每个标签的备注
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { listCategories, listPatterns, countPatternOccurrencesLast30Days } from '@/lib/journalApi';
import type { ErrorTagCategory, ErrorTagPattern } from '@/types/journal';
import { NewPatternDialog } from './NewPatternDialog';

interface Props {
  selectedPatternIds: string[];
  notes: Record<string, string>;
  onChange: (ids: string[], notes: Record<string, string>) => void;
  userId: string;
  allowCreatePattern?: boolean;
  disabled?: boolean;
}

export function JournalTagPicker({
  selectedPatternIds, notes, onChange, userId,
  allowCreatePattern = true, disabled = false,
}: Props) {
  const [categories, setCategories] = useState<ErrorTagCategory[]>([]);
  const [patterns, setPatterns] = useState<ErrorTagPattern[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [hotMap, setHotMap] = useState<Record<string, number>>({});
  const [newDialog, setNewDialog] = useState<{ open: boolean; categoryId?: string }>({ open: false });

  const reload = async () => {
    try {
      const [cs, ps] = await Promise.all([listCategories(), listPatterns(userId)]);
      setCategories(cs);
      setPatterns(ps);
      // 默认折叠 "该开没开错"
      const init: Record<string, boolean> = {};
      cs.forEach(c => { if (c.code === 'no_entry_missed') init[c.id] = true; });
      setCollapsed(prev => ({ ...init, ...prev }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [userId]);

  // 拉 30 天热度
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        patterns.map(async p => {
          try {
            const n = await countPatternOccurrencesLast30Days(userId, p.id);
            return [p.id, n] as const;
          } catch {
            return [p.id, 0] as const;
          }
        }),
      );
      if (!cancelled) setHotMap(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [patterns, userId]);

  const grouped = useMemo(() => {
    const m = new Map<string, ErrorTagPattern[]>();
    for (const c of categories) m.set(c.id, []);
    for (const p of patterns) {
      if (p.is_archived) continue;
      if (!m.has(p.category_id)) m.set(p.category_id, []);
      m.get(p.category_id)!.push(p);
    }
    return m;
  }, [categories, patterns]);

  const toggleSelect = (id: string) => {
    if (disabled) return;
    const has = selectedPatternIds.includes(id);
    const next = has ? selectedPatternIds.filter(x => x !== id) : [...selectedPatternIds, id];
    const nextNotes = { ...notes };
    if (has) delete nextNotes[id];
    onChange(next, nextNotes);
  };

  const setNote = (id: string, val: string) => {
    onChange(selectedPatternIds, { ...notes, [id]: val });
  };

  const n = selectedPatternIds.length;

  return (
    <div className={`bg-background border border-border rounded p-3 max-h-[400px] overflow-y-auto ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {categories.map(c => {
        const items = grouped.get(c.id) ?? [];
        const isCollapsed = collapsed[c.id];
        return (
          <div key={c.id} className="mb-3 last:mb-0">
            <button
              type="button"
              onClick={() => setCollapsed(prev => ({ ...prev, [c.id]: !prev[c.id] }))}
              className="w-full flex items-center justify-between py-1.5 hover:bg-card rounded px-1"
            >
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                <span className="text-[12px] font-medium text-foreground">{c.name_zh}</span>
                <span className="text-[10px] text-muted-foreground font-mono">({items.length})</span>
              </div>
              {isCollapsed ? <ChevronRight className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
            </button>
            {!isCollapsed && (
              <div className="pl-1">
                {items.length === 0 && (
                  <div className="text-[10px] text-muted-foreground py-1.5 px-1">暂无模式</div>
                )}
                {items.map(p => {
                  const checked = selectedPatternIds.includes(p.id);
                  const hot = (hotMap[p.id] ?? 0) >= 3;
                  return (
                    <div key={p.id}>
                      <div
                        className="flex items-center gap-2 h-7 px-1 hover:bg-card rounded cursor-pointer"
                        onClick={() => toggleSelect(p.id)}
                      >
                        <Checkbox checked={checked} className="h-3.5 w-3.5" />
                        <span className="flex-1 text-[12px] text-foreground truncate">{p.pattern_name}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">×{p.occurrence_count}</span>
                        {hot && <span className="w-1.5 h-1.5 rounded-full bg-[#F6465D]" title="近 30 天 ≥3 次" />}
                      </div>
                      {checked && (
                        <Textarea
                          value={notes[p.id] ?? ''}
                          onChange={e => setNote(p.id, e.target.value)}
                          placeholder="本次的具体备注（可选）"
                          className="h-9 min-h-[36px] my-1 ml-5 text-[11px] bg-background border-border/60 resize-none"
                        />
                      )}
                    </div>
                  );
                })}
                {allowCreatePattern && (
                  <button
                    type="button"
                    onClick={() => setNewDialog({ open: true, categoryId: c.id })}
                    className="text-[11px] text-[#F0B90B] hover:underline mt-1 ml-1"
                  >+ 新增此类模式</button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className={`mt-2 pt-2 border-t border-border text-[10px] font-mono ${n === 0 ? 'text-[#F6465D]' : 'text-muted-foreground'}`}>
        {n === 0 ? '未选任何标签——请确认本次确实无错误，或新增一个模式' : `已选 ${n} 个错误模式`}
      </div>
      <NewPatternDialog
        isOpen={newDialog.open}
        onOpenChange={open => setNewDialog(prev => ({ ...prev, open }))}
        defaultCategoryId={newDialog.categoryId}
        onCreated={() => { reload(); }}
      />
    </div>
  );
}
