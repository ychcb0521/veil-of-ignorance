/**
 * Stop Doing List 管理对话框：增删改我的"决心不做"清单。
 * 设计意图：清单是 Munger 风格的个人长期承诺，做最小可用版本——
 *   一个文本框新增，列表展示，单条编辑/停用/删除。不做拖拽排序，不做分类。
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Trash2, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  listStopDoingItems, createStopDoingItem,
  updateStopDoingItem, deleteStopDoingItem,
} from '@/lib/journalApi';
import type { StopDoingItem } from '@/types/journal';

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** 关闭时回调最新列表，供调用方刷新表单。 */
  onChanged?: (items: StopDoingItem[]) => void;
}

export function StopDoingListManagerDialog({ isOpen, onOpenChange, onChanged }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<StopDoingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newText, setNewText] = useState('');
  const [adding, setAdding] = useState(false);

  const reload = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const next = await listStopDoingItems(user.id);
      setItems(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user?.id]);

  const handleAdd = async () => {
    if (!user || !newText.trim()) return;
    setAdding(true);
    try {
      await createStopDoingItem(user.id, newText);
      setNewText('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleEdit = async (id: string, text: string) => {
    try {
      await updateStopDoingItem(id, { text });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('确认删除这条 Stop doing？历史已勾选的记录不受影响。')) return;
    try {
      await deleteStopDoingItem(id);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) onChanged?.(items);
    onOpenChange(open);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="text-[14px]">我的 Stop Doing List</DialogTitle>
          <DialogDescription className="text-[11px] leading-relaxed">
            Munger 说：要确认自己不该做什么，往往比想清楚该做什么更重要。
            这里维护的是你"决心不再做"的事，每次开仓前都会让你逐条勾选确认。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium">新增一条</Label>
            <div className="flex gap-2">
              <Input
                value={newText}
                onChange={e => setNewText(e.target.value)}
                placeholder="例如：不在心态 ≤ 3 分时开仓 / 不追刚跑出去的单 / 不在凌晨 3 点以后下单"
                className="text-[12px]"
                onKeyDown={e => { if (e.key === 'Enter') void handleAdd(); }}
              />
              <Button
                onClick={handleAdd}
                disabled={!newText.trim() || adding}
                className="bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 text-[12px] shrink-0"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />加入
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium">现有条目 · {items.length}</Label>
            {loading ? (
              <div className="text-[11px] text-muted-foreground py-3 text-center">载入中…</div>
            ) : items.length === 0 ? (
              <div className="text-[11px] text-muted-foreground py-3 text-center border border-dashed border-border/60 rounded-lg">
                还没有任何 Stop doing 条目。
              </div>
            ) : (
              <ul className="space-y-1.5 max-h-[320px] overflow-y-auto">
                {items.map(item => (
                  <li key={item.id} className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
                    <EditableText value={item.text} onCommit={text => handleEdit(item.id, text)} />
                    <button
                      type="button"
                      onClick={() => void handleDelete(item.id)}
                      className="shrink-0 text-muted-foreground hover:text-[#F6465D] transition-colors p-1"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)} className="text-[12px]">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 单条可编辑文本：失焦提交。 */
function EditableText({ value, onCommit }: { value: string; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <input
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== value) onCommit(trimmed);
        else if (!trimmed) setDraft(value);
      }}
      className="flex-1 bg-transparent text-[12px] text-foreground focus:outline-none focus:ring-1 focus:ring-[#F0B90B]/40 rounded px-1"
    />
  );
}
