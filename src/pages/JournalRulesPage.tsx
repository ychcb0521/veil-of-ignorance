/**
 * /journal/rules — 交易规则管理页
 * 列出用户所有规则（含规则源 pattern、是否生效、是否进入 checklist、是否必填、snooze 状态）。
 * 支持编辑、激活/停用、加入/移出 checklist、删除。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trash2, Pencil, Check, X } from 'lucide-react';
import { BackButton } from '@/components/journal/BackButton';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  listRules, listPatterns, updateRule, deleteRule,
} from '@/lib/journalApi';
import type { TradingRule, ErrorTagPattern } from '@/types/journal';

export default function JournalRulesPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [rules, setRules] = useState<TradingRule[]>([]);
  const [patterns, setPatterns] = useState<ErrorTagPattern[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [r, p] = await Promise.all([
        listRules(user.id),
        listPatterns(user.id, { includeArchived: true }),
      ]);
      setRules(r.filter(x => x.rule_text !== '[延后]'));
      setPatterns(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  const patternMap = useMemo(() => new Map(patterns.map(p => [p.id, p])), [patterns]);

  const handlePatch = async (id: string, patch: Partial<TradingRule>) => {
    try {
      await updateRule(id, patch);
      await reload();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('删除该规则？已添加到 checklist 的下次开仓将不再出现。')) return;
    try {
      await deleteRule(id);
      await reload();
      toast.message('已删除规则');
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); }
  };

  const saveEdit = async (id: string) => {
    if (editText.trim().length < 20) {
      toast.error('规则文字至少 20 字');
      return;
    }
    await handlePatch(id, { rule_text: editText.trim() });
    setEditingId(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-3 max-w-[1200px] mx-auto flex items-center gap-3">
          <BackButton />
          <h1 className="text-[14px] font-medium">规则</h1>
          <span className="text-[11px] text-muted-foreground font-mono ml-auto">{rules.length} 条规则</span>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-6 py-4">
        {loading ? (
          <div className="text-muted-foreground text-[12px] font-mono">加载中…</div>
        ) : rules.length === 0 ? (
          <div className="border border-border rounded p-10 text-center">
            <div className="text-[40px] mb-2">📜</div>
            <div className="text-[12px] text-muted-foreground">
              你还没有写过任何规则。规则会在某个错误模式 30 天内重复 3 次后强制要求生成。
            </div>
          </div>
        ) : (
          <div className="border border-border rounded overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-card text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">规则</th>
                  <th className="text-left px-3 py-2 w-[180px]">来源模式</th>
                  <th className="text-center px-3 py-2 w-[80px]">激活</th>
                  <th className="text-center px-3 py-2 w-[100px]">加入 Checklist</th>
                  <th className="text-center px-3 py-2 w-[80px]">必填</th>
                  <th className="text-right px-3 py-2 w-[100px]">操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => {
                  const p = r.source_pattern_id ? patternMap.get(r.source_pattern_id) : null;
                  const snoozed = r.snooze_until && new Date(r.snooze_until).getTime() > Date.now();
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-card/50">
                      <td className="px-3 py-2 align-top">
                        {editingId === r.id ? (
                          <div className="flex gap-1">
                            <Input value={editText} onChange={e => setEditText(e.target.value)}
                              className="h-7 text-[12px] bg-background border-border" />
                            <Button size="sm" className="h-7 w-7 p-0" onClick={() => saveEdit(r.id)}>
                              <Check className="w-3 h-3" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingId(null)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ) : (
                          <div>
                            <div className="text-foreground">{r.rule_text}</div>
                            {snoozed && (
                              <div className="text-[10px] text-[#F0B90B] mt-0.5">
                                延后至 {new Date(r.snooze_until!).toLocaleString('zh-CN')}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-muted-foreground text-[11px]">
                        {p ? p.pattern_name : '手动'}
                      </td>
                      <td className="px-3 py-2 align-top text-center">
                        <Switch checked={r.is_active} onCheckedChange={(v) => handlePatch(r.id, { is_active: v })} />
                      </td>
                      <td className="px-3 py-2 align-top text-center">
                        <Switch checked={r.added_to_checklist} onCheckedChange={(v) => handlePatch(r.id, { added_to_checklist: v })} />
                      </td>
                      <td className="px-3 py-2 align-top text-center">
                        <Switch checked={r.required} onCheckedChange={(v) => handlePatch(r.id, { required: v })} />
                      </td>
                      <td className="px-3 py-2 align-top text-right">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                          onClick={() => { setEditingId(r.id); setEditText(r.rule_text); }}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 hover:text-[#F6465D]"
                          onClick={() => handleDelete(r.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
