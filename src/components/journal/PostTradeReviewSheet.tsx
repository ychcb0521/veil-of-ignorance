/**
 * 平仓评价抽屉 — 桌面 right Sheet / 移动 bottom Sheet
 */
import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useIsMobile } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import { Pencil, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  finalizeJournalReview, replacePhaseAssignments,
  listAssignmentsForJournal, countPatternOccurrencesLast30Days, listPatterns,
} from '@/lib/journalApi';
import type { TradeJournal, TradeOutcome, ErrorTagPattern } from '@/types/journal';
import { MENTAL_STATE_LABELS } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import { JournalTagPicker } from './JournalTagPicker';

interface Props {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  journal: TradeJournal | null;
  tradeRecord?: TradeRecord | null;
  onReviewed?: (updated: TradeJournal) => void;
  onAutoPause?: () => void;
}

export function PostTradeReviewSheet({
  isOpen, onOpenChange, journal, tradeRecord, onReviewed, onAutoPause,
}: Props) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagNotes, setTagNotes] = useState<Record<string, string>>({});
  const [noErrors, setNoErrors] = useState(false);
  const [reflection, setReflection] = useState('');
  const [correctAction, setCorrectAction] = useState('');
  const [rMultipleOverride, setRMultipleOverride] = useState<string>('');
  const [editingR, setEditingR] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hotCounts, setHotCounts] = useState<Record<string, number>>({});
  const [allPatterns, setAllPatterns] = useState<ErrorTagPattern[]>([]);
  const pausedOnce = useState({ done: false })[0];

  // Auto-pause + reset state per journal
  useEffect(() => {
    if (!isOpen || !journal) return;
    if (!pausedOnce.done) { pausedOnce.done = true; onAutoPause?.(); }
    (async () => {
      try {
        const existing = await listAssignmentsForJournal(journal.id);
        const post = existing.filter(a => a.tagged_phase === 'post');
        setSelectedTags(post.map(a => a.pattern_id));
        const ns: Record<string, string> = {};
        post.forEach(a => { if (a.note) ns[a.pattern_id] = a.note; });
        setTagNotes(ns);
        setNoErrors(post.length === 0 && !!journal.post_reviewed_at);
        setReflection(journal.post_reflection ?? '');
        setCorrectAction(journal.post_correct_action ?? '');
        setRMultipleOverride(journal.post_r_multiple != null ? String(journal.post_r_multiple) : '');
        if (user) {
          listPatterns(user.id).then(setAllPatterns).catch(() => {});
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { pausedOnce.done = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, journal?.id]);

  // 计算频次告警
  useEffect(() => {
    if (!user || selectedTags.length === 0) { setHotCounts({}); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        selectedTags.map(async id => {
          try {
            const n = await countPatternOccurrencesLast30Days(user.id, id);
            return [id, n] as const;
          } catch { return [id, 0] as const; }
        }),
      );
      if (!cancelled) setHotCounts(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [selectedTags, user]);

  if (!journal) return null;

  // Auto outcome
  const pnl = tradeRecord?.pnl ?? journal.post_realized_pnl ?? 0;
  const outcome: TradeOutcome =
    journal.direction === 'no_entry' ? 'no_entry'
    : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';
  const computedR = useMemo(() => {
    const ml = journal.pre_max_loss_usdt;
    if (!ml || ml === 0) return null;
    return pnl / ml;
  }, [pnl, journal.pre_max_loss_usdt]);
  const finalR = rMultipleOverride !== '' && !isNaN(Number(rMultipleOverride))
    ? Number(rMultipleOverride)
    : computedR;

  const holdDurationLabel = useMemo(() => {
    const start = new Date(journal.pre_simulated_time).getTime();
    const end = tradeRecord?.closeTime ?? Date.now();
    const diff = Math.max(0, end - start);
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }, [journal.pre_simulated_time, tradeRecord?.closeTime]);

  const checklistRequired = journal.pre_checklist_items.filter(i => i.required);
  const checklistOptional = journal.pre_checklist_items.filter(i => !i.required);
  const reqChecked = checklistRequired.filter(i => i.checked).length;
  const optChecked = checklistOptional.filter(i => i.checked).length;

  const tagsValid = noErrors || selectedTags.length >= 1;
  const reflectionValid = reflection.trim().length >= 30;
  const correctValid = correctAction.trim().length >= 20;
  const canSave = tagsValid && reflectionValid && correctValid && !saving;

  const hotWarnings = selectedTags
    .map(id => {
      const p = allPatterns.find(x => x.id === id);
      const n = hotCounts[id] ?? 0;
      return p && n >= 2 ? { pattern: p, count: n } : null;
    })
    .filter(Boolean) as { pattern: ErrorTagPattern; count: number }[];

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const updated = await finalizeJournalReview(journal.id, {
        post_outcome: outcome,
        post_realized_pnl: pnl,
        post_r_multiple: finalR,
        post_reflection: reflection.trim(),
        post_correct_action: correctAction.trim(),
      });
      const assignments = noErrors ? [] : selectedTags.map(id => ({
        patternId: id,
        phase: 'post' as const,
        note: tagNotes[id] ?? null,
      }));
      await replacePhaseAssignments(journal.id, 'post', assignments);
      toast.success('已保存平仓评价');
      window.dispatchEvent(new CustomEvent('journal:reviewed', { detail: { journalId: journal.id } }));
      onReviewed?.(updated);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const body = (
    <>
      <div className="px-5 py-4 border-b border-[#2B3139]">
        <div className="text-[14px] font-medium text-foreground">平仓评价</div>
        <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
          {journal.symbol} · {journal.direction} · 模拟时间 {fmtTime(journal.pre_simulated_time)}
        </div>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
        {/* (A) Snapshot */}
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="text-[11px] text-muted-foreground flex items-center gap-1 hover:text-foreground">
            <ChevronDown className="w-3 h-3" /> 开仓时的快照
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1 text-[11px] font-mono text-foreground/80 pl-3 border-l border-[#2B3139]">
            <div>• 入场理由：{journal.pre_entry_reason}</div>
            <div>• 预设止损/止盈：{journal.pre_planned_stop_loss ?? '—'} / {journal.pre_planned_take_profit ?? '—'}</div>
            <div>• 风险认识：{journal.pre_risk_awareness}</div>
            <div>• 风险管理：{journal.pre_risk_management}</div>
            <div>
              • 心态自评：{journal.pre_mental_state} 分（{MENTAL_STATE_LABELS[journal.pre_mental_state]}）
              {journal.pre_mental_trigger ? ` · ${journal.pre_mental_trigger}` : ''}
            </div>
            <div>
              • Checklist：{reqChecked}/{checklistRequired.length} 必填 · {optChecked}/{checklistOptional.length} 可选 · {journal.pre_checklist_passed ? '通过' : '未通过'}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* (B) Auto outcome */}
        <div className="bg-[#0B0E11] border border-[#2B3139] rounded p-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px] font-mono">
          <div>
            <div className="text-[10px] text-muted-foreground">结果</div>
            <div className={outcome === 'win' ? 'text-[#0ECB81]' : outcome === 'loss' ? 'text-[#F6465D]' : 'text-foreground'}>
              {outcome}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">实现 P&L</div>
            <div className={pnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
              R 倍数
              <button onClick={() => setEditingR(v => !v)}><Pencil className="w-2.5 h-2.5 text-muted-foreground hover:text-foreground" /></button>
            </div>
            {editingR ? (
              <Input
                value={rMultipleOverride}
                onChange={e => setRMultipleOverride(e.target.value)}
                onBlur={() => setEditingR(false)}
                autoFocus
                className="h-6 text-[12px] bg-[#181A20] border-[#2B3139] font-mono"
              />
            ) : (
              <div>{finalR != null ? finalR.toFixed(2) + ' R' : '—'}</div>
            )}
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">持仓时长</div>
            <div>{holdDurationLabel}</div>
          </div>
        </div>

        {/* (C) Tags */}
        {user && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[12px]">错误标签 *</Label>
              <span className="text-[11px] text-muted-foreground">至少选 1 个，或勾选下方"本次无明显错误"</span>
            </div>
            <JournalTagPicker
              userId={user.id}
              selectedPatternIds={selectedTags}
              notes={tagNotes}
              onChange={(ids, ns) => { setSelectedTags(ids); setTagNotes(ns); }}
              disabled={noErrors}
            />
            <label className="flex items-center gap-2 text-[12px] text-foreground cursor-pointer">
              <Checkbox
                checked={noErrors}
                onCheckedChange={v => {
                  const next = !!v;
                  setNoErrors(next);
                  if (next) { setSelectedTags([]); setTagNotes({}); }
                }}
              />
              ✓ 本次交易过程符合预期，无明显错误模式
            </label>
          </div>
        )}

        {/* (D) Reflection */}
        <div className="space-y-1.5">
          <Label className="text-[12px]">复盘文字（这笔交易里你真正学到了什么？）* ≥30 字</Label>
          <Textarea
            rows={4}
            value={reflection}
            onChange={e => setReflection(e.target.value)}
            placeholder="例如：本次入场理由在事后看仍然成立，但仓位过重；止损位过近导致被洗出后又看着行情走出预期方向。下次应根据 ATR 设置止损宽度。"
            className="text-[12px] bg-[#0B0E11] border-[#2B3139]"
          />
          <div className="text-[10px] text-muted-foreground text-right font-mono">{reflection.trim().length} / 30</div>
        </div>

        {/* (E) Counterfactual */}
        <div className="space-y-1.5">
          <Label className="text-[12px]">如果重来一次，你会怎么做？* ≥20 字</Label>
          <Textarea
            rows={3}
            value={correctAction}
            onChange={e => setCorrectAction(e.target.value)}
            placeholder="例如：止损位放在 X 而非 Y；分批入场 3 次而非一次满仓；不在心态 ≤3 分时开仓。"
            className="text-[12px] bg-[#0B0E11] border-[#2B3139]"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">❗ 必须可执行——不是"下次更冷静"，而是"下次开仓前必须满足 checklist 第 N 项"</p>
            <span className="text-[10px] text-muted-foreground font-mono">{correctAction.trim().length} / 20</span>
          </div>
        </div>

        {/* (F) Frequency warning */}
        {hotWarnings.length > 0 && (
          <div className="bg-[#F6465D]/10 border border-[#F6465D]/30 rounded p-3 space-y-1">
            {hotWarnings.map(w => (
              <div key={w.pattern.id} className="text-[12px] text-[#F6465D]">
                ⚠ 模式「{w.pattern.pattern_name}」最近 30 天内已出现 {w.count} 次（含本次 = {w.count + 1} 次）。
                满 3 次后，系统会在批次 6 强制要求你写一条新规则加入 checklist。
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-[#2B3139] flex justify-end gap-2 shrink-0 bg-[#181A20]">
        <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-8 text-[12px]">取消</Button>
        <Button
          onClick={handleSave}
          disabled={!canSave}
          className="h-8 text-[12px] bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black disabled:opacity-40"
        >{saving ? '保存中...' : '保存评价'}</Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[92vh] rounded-t-2xl p-0 bg-[#181A20] border-t border-[#2B3139] flex flex-col">
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[640px] sm:max-w-[640px] p-0 bg-[#181A20] border-l border-[#2B3139] flex flex-col">
        {body}
      </SheetContent>
    </Sheet>
  );
}
