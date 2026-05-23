/**
 * 新建 / 编辑 错误模式弹窗
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { createPattern, updatePattern, listCategories, listPatterns } from '@/lib/journalApi';
import type { ErrorTagCategory, ErrorTagPattern } from '@/types/journal';

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCategoryId?: string;
  mode?: 'create' | 'edit';
  editing?: ErrorTagPattern | null;
  onCreated?: (p: ErrorTagPattern) => void;
  onUpdated?: (p: ErrorTagPattern) => void;
}

export function NewPatternDialog({
  isOpen, onOpenChange, defaultCategoryId, mode = 'create',
  editing, onCreated, onUpdated,
}: Props) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<ErrorTagCategory[]>([]);
  const [patterns, setPatterns] = useState<ErrorTagPattern[]>([]);
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId ?? '');
  const [name, setName] = useState('');
  const [definition, setDefinition] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    listCategories().then(setCategories).catch(e => toast.error(String(e instanceof Error ? e.message : e)));
    if (user) listPatterns(user.id).then(setPatterns).catch(() => {});
    if (mode === 'edit' && editing) {
      setCategoryId(editing.category_id);
      setName(editing.pattern_name);
      setDefinition(editing.operational_definition);
      setParentId(editing.parent_id ?? '');
    } else {
      setCategoryId(defaultCategoryId ?? '');
      setName('');
      setDefinition('');
      setParentId('');
    }
  }, [isOpen, mode, editing, defaultCategoryId, user]);

  const disabled = !categoryId || name.trim().length === 0 || name.length > 40 || definition.trim().length < 10;

  const handleSubmit = async () => {
    if (!user) { toast.error('请先登录'); return; }
    if (disabled) return;
    setSaving(true);
    try {
      if (mode === 'edit' && editing) {
        const updated = await updatePattern(editing.id, {
          pattern_name: name.trim(),
          operational_definition: definition.trim(),
          parent_id: parentId || null,
        });
        toast.success('已更新模式');
        onUpdated?.(updated);
      } else {
        const created = await createPattern({
          user_id: user.id,
          category_id: categoryId,
          pattern_name: name.trim(),
          operational_definition: definition.trim(),
          parent_id: parentId || null,
        });
        toast.success('已新建模式');
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const peersInCategory = patterns.filter(p => p.category_id === categoryId && p.id !== editing?.id && !p.is_archived);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px] bg-card border border-border">
        <DialogHeader>
          <DialogTitle className="text-[14px]">{mode === 'edit' ? '编辑错误模式' : '新建错误模式'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">所属大类 *</Label>
            <Select value={categoryId} onValueChange={setCategoryId} disabled={mode === 'edit'}>
              <SelectTrigger className="h-9 text-[12px] bg-background border-border"><SelectValue placeholder="选择大类" /></SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c.id} value={c.id} className="text-[12px]">{c.name_zh}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">模式名称 * (1-40 字符)</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value.slice(0, 40))}
              placeholder="例如：在连续亏损 ≥2 笔后立即开仓"
              className="h-9 text-[12px] bg-background border-border"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">可操作定义 * (≥10 字符)</Label>
            <Textarea
              rows={3}
              value={definition}
              onChange={e => setDefinition(e.target.value)}
              placeholder="例如：在前一笔交易出现负收益后，30 分钟内开新仓，且 entry 与上一笔同方向。"
              className="text-[12px] bg-background border-border"
            />
            <p className="text-[10px] text-muted-foreground">
              ❗ 必须可被未来的你客观判定——不要写"心态不好"，要写"交易前心态自评 ≤2 分"
            </p>
          </div>
          {peersInCategory.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">父模式（可选）</Label>
              <Select value={parentId || '__none__'} onValueChange={v => setParentId(v === '__none__' ? '' : v)}>
                <SelectTrigger className="h-9 text-[12px] bg-background border-border"><SelectValue placeholder="无父模式" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__" className="text-[12px]">无父模式</SelectItem>
                  {peersInCategory.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-[12px]">{p.pattern_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-8 text-[12px]">取消</Button>
          <Button
            onClick={handleSubmit}
            disabled={disabled || saving}
            className="h-8 text-[12px] bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black"
          >{saving ? '保存中...' : '确认'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
