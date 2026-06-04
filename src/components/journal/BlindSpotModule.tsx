/**
 * 盲区模块：手动记录「你没预想到」的错误来源。
 * 系统能算的误差（校准 / R 缺口 / 证伪纪律）在主视图里；盲区是系统算不出来的那部分，
 * 只能你自己看见后手动写下，直到它变成可预测、可写进规则的东西。
 */
import { useState } from 'react';
import { Plus, Trash2, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { BlindSpot } from '@/lib/blindSpots';

export function BlindSpotModule({
  items,
  onAdd,
  onRemove,
}: {
  items: BlindSpot[];
  onAdd: (title: string, note: string) => void;
  onRemove: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  const submit = () => {
    if (!title.trim()) return;
    onAdd(title, note);
    setTitle('');
    setNote('');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#F0B90B]/30 bg-[#F0B90B]/5 p-4">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-[#D89B00]" />
          <h2 className="text-[13px] font-semibold">盲区 · 你没预想到的错误来源</h2>
        </div>
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          盲区不在你的预案里、也不在你盯的证伪信号里，所以系统算不出来。
          先把它手动写下来 —— 写下的那一刻，它就从「看不见」变成了「可被预测」，下次才有机会提前堵住。
        </p>
      </div>

      {/* 新增 */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2">
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="盲区一句话标题，例如：资金费率为正时持有过夜被反复收割"
          className="text-[12px] bg-background"
        />
        <Textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          placeholder="可选：当时为什么没看见？下次靠什么信号能提前发现？"
          className="text-[12px] bg-background"
        />
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!title.trim()} className="h-8 text-[12px]">
            <Plus className="mr-1 h-3.5 w-3.5" /> 记下这个盲区
          </Button>
        </div>
      </div>

      {/* 列表 */}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-muted-foreground">
          还没有盲区记录。在「错误类型」里展开「死法不在预案内」时，可一键加进来。
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(b => (
            <div key={b.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-foreground">{b.title}</div>
                  {b.note && <div className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">{b.note}</div>}
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {new Date(b.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>
                <button
                  onClick={() => onRemove(b.id)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-[#F6465D]"
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
