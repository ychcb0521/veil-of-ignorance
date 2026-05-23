/**
 * 标签字典管理页 /journal/tags
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BackButton } from '@/components/journal/BackButton';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { listCategories, listPatterns, archivePattern } from '@/lib/journalApi';
import type { ErrorTagCategory, ErrorTagPattern } from '@/types/journal';
import { NewPatternDialog } from '@/components/journal/NewPatternDialog';

export default function JournalTagsPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [categories, setCategories] = useState<ErrorTagCategory[]>([]);
  const [patterns, setPatterns] = useState<ErrorTagPattern[]>([]);
  const [newDialog, setNewDialog] = useState<{ open: boolean; categoryId?: string }>({ open: false });
  const [editDialog, setEditDialog] = useState<{ open: boolean; pattern: ErrorTagPattern | null }>({ open: false, pattern: null });

  const reload = async () => {
    if (!user) return;
    try {
      const [cs, ps] = await Promise.all([listCategories(), listPatterns(user.id, { includeArchived: true })]);
      setCategories(cs);
      setPatterns(ps);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [user]);

  const groupedActive = useMemo(() => {
    const m = new Map<string, ErrorTagPattern[]>();
    for (const c of categories) m.set(c.id, []);
    for (const p of patterns) if (!p.is_archived) m.get(p.category_id)?.push(p);
    return m;
  }, [categories, patterns]);

  const archived = patterns.filter(p => p.is_archived);

  const handleArchive = async (p: ErrorTagPattern) => {
    if (!confirm(`确认归档「${p.pattern_name}」？归档后不在评价选择器中出现，但历史标签保留。`)) return;
    try {
      await archivePattern(p.id);
      toast.success('已归档');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) : '—';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1600px] mx-auto flex items-center gap-3">
          <BackButton />
          <h1 className="text-[14px] font-medium">标签字典</h1>
          <span className="text-[11px] text-muted-foreground">错误模式字典</span>
          <div className="flex-1" />
          <Button
            onClick={() => setNewDialog({ open: true })}
            className="h-8 text-[12px] bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black"
          >+ 新建模式</Button>
        </div>
      </header>

      <main className="px-6 py-4 max-w-[1200px] mx-auto">
        {categories.map(c => {
          const rows = groupedActive.get(c.id) ?? [];
          return (
            <div key={c.id} className="bg-card border border-border rounded p-4 mb-4">
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                  <span className="text-[13px] font-medium">{c.name_zh}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">({rows.length})</span>
                </div>
                <button
                  onClick={() => setNewDialog({ open: true, categoryId: c.id })}
                  className="text-[11px] text-[#F0B90B] hover:underline"
                >+ 新增此类模式</button>
              </div>
              <div className="text-[11px] text-muted-foreground mb-3">{c.description}</div>
              {rows.length === 0 ? (
                <div className="text-[11px] text-muted-foreground py-4 text-center">暂无模式</div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-muted-foreground bg-background">
                      <th className="text-left px-2 py-2 flex-1">模式名称</th>
                      <th className="text-left px-2 py-2">可操作定义</th>
                      <th className="text-right px-2 py-2 w-[80px]">累计出现</th>
                      <th className="text-right px-2 py-2 w-[100px]">最近一次</th>
                      <th className="text-right px-2 py-2 w-[120px]">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(p => (
                      <tr key={p.id} className="text-[11px] border-b border-border/40">
                        <td className="px-2 py-2 font-medium">{p.pattern_name}</td>
                        <td className="px-2 py-2 text-muted-foreground">{p.operational_definition}</td>
                        <td className={`px-2 py-2 text-right font-mono ${p.occurrence_count >= 5 ? 'text-[#F6465D]' : ''}`}>
                          {p.occurrence_count}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-muted-foreground">{fmtDate(p.last_seen_at)}</td>
                        <td className="px-2 py-2 text-right space-x-2">
                          <button
                            onClick={() => setEditDialog({ open: true, pattern: p })}
                            className="text-[10px] text-muted-foreground hover:text-foreground"
                          >编辑</button>
                          <button
                            onClick={() => handleArchive(p)}
                            className="text-[10px] text-muted-foreground hover:text-[#F6465D]"
                          >归档</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}

        {archived.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="text-[12px] text-muted-foreground hover:text-foreground mb-2">
              已归档（{archived.length}）
            </CollapsibleTrigger>
            <CollapsibleContent className="bg-card border border-border rounded p-3">
              {archived.map(p => (
                <div key={p.id} className="text-[11px] text-muted-foreground py-1 border-b border-border/30 last:border-b-0">
                  {p.pattern_name} — {p.operational_definition}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </main>

      <NewPatternDialog
        isOpen={newDialog.open}
        onOpenChange={open => setNewDialog(prev => ({ ...prev, open }))}
        defaultCategoryId={newDialog.categoryId}
        onCreated={() => reload()}
      />
      <NewPatternDialog
        isOpen={editDialog.open}
        onOpenChange={open => setEditDialog(prev => ({ ...prev, open }))}
        mode="edit"
        editing={editDialog.pattern}
        onUpdated={() => reload()}
      />
    </div>
  );
}
