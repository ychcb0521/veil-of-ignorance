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
import { Pencil, ChevronDown, BrainCircuit } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import {
  finalizeJournalReview, replacePhaseAssignments,
  listAssignmentsForJournal, countPatternOccurrencesLast30Days, listPatterns,
  updateJournalDeepAnalysis,
} from '@/lib/journalApi';
import type { TradeJournal, TradeOutcome, ErrorTagPattern } from '@/types/journal';
import { MENTAL_STATE_LABELS } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import { JournalTagPicker } from './JournalTagPicker';
import {
  SixStepAnalysisForm, EMPTY_SIX_STEP, pickSixStepValue, countCompletedSteps,
  type SixStepValue,
} from './SixStepAnalysisForm';

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
  const { setTradeHistory } = useTradingContext();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagNotes, setTagNotes] = useState<Record<string, string>>({});
  const [noErrors, setNoErrors] = useState(false);
  const [reflection, setReflection] = useState('');
  const [correctAction, setCorrectAction] = useState('');
  const [exitReason, setExitReason] = useState('');
  const [rMultipleOverride, setRMultipleOverride] = useState<string>('');
  const [editingR, setEditingR] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hotCounts, setHotCounts] = useState<Record<string, number>>({});
  const [allPatterns, setAllPatterns] = useState<ErrorTagPattern[]>([]);
  const [sixStep, setSixStep] = useState<SixStepValue>(EMPTY_SIX_STEP);
  const [sixStepOpen, setSixStepOpen] = useState(false);
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
        setExitReason(tradeRecord?.exit_reason_text ?? '');
        setRMultipleOverride(journal.post_r_multiple != null ? String(journal.post_r_multiple) : '');
        setSixStep(pickSixStepValue(journal));
        setSixStepOpen(countCompletedSteps(pickSixStepValue(journal)) > 0);
        if (user) {
          listPatterns(user.id).then(setAllPatterns).catch(() => {});
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { pausedOnce.done = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, journal?.id, tradeRecord?.id]);

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

  // Auto outcome — guard for null journal so hooks order is stable
  const pnl = tradeRecord?.pnl ?? journal?.post_realized_pnl ?? 0;
  const outcome: TradeOutcome =
    journal?.direction === 'no_entry' ? 'no_entry'
    : pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'breakeven';
  const computedR = useMemo(() => {
    const ml = journal?.pre_max_loss_usdt;
    if (!ml || ml === 0) return null;
    return pnl / ml;
  }, [pnl, journal?.pre_max_loss_usdt]);
  const finalR = rMultipleOverride !== '' && !isNaN(Number(rMultipleOverride))
    ? Number(rMultipleOverride)
    : computedR;

  const holdDurationLabel = useMemo(() => {
    if (!journal) return '—';
    const start = new Date(journal.pre_simulated_time).getTime();
    const end = tradeRecord?.closeTime ?? Date.now();
    const diff = Math.max(0, end - start);
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }, [journal, tradeRecord?.closeTime]);

  // Render loading placeholder instead of null to keep hook order stable
  if (!journal) {
    const placeholder = (
      <div className="p-6 space-y-3">
        <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        <div className="h-3 w-full bg-muted rounded animate-pulse" />
        <div className="h-3 w-3/4 bg-muted rounded animate-pulse" />
        <div className="h-3 w-2/3 bg-muted rounded animate-pulse" />
      </div>
    );
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={isMobile
            ? 'h-[60vh] rounded-t-2xl p-0 bg-card border-t border-border text-foreground'
            : 'w-[640px] sm:max-w-[640px] p-0 bg-card border-l border-border text-foreground'}
        >
          {placeholder}
        </SheetContent>
      </Sheet>
    );
  }

  const checklistItemsArr = journal.pre_checklist_items ?? [];
  const checklistRequired = checklistItemsArr.filter(i => i.required);
  const checklistOptional = checklistItemsArr.filter(i => !i.required);
  const reqChecked = checklistRequired.filter(i => i.checked).length;
  const optChecked = checklistOptional.filter(i => i.checked).length;
  const isHedge = journal.order_kind === 'hedge';
  const positionModeLabel = journal.position_mode === 'isolated'
    ? '逐仓'
    : journal.position_mode === 'cross'
      ? '全仓'
      : '—';
  const positionModeChipClass = journal.position_mode === 'isolated'
    ? 'bg-[#0ECB81]/10 text-[#0ECB81]'
    : journal.position_mode === 'cross'
      ? 'bg-[#F6465D]/10 text-[#F6465D]'
      : 'bg-muted text-muted-foreground';

  const tagsValid = noErrors || selectedTags.length >= 1;
  const reflectionValid = reflection.trim().length >= 30;
  const correctValid = correctAction.trim().length >= 20;
  const exitReasonValid = journal.direction === 'no_entry' || exitReason.trim().length >= 10;
  const canSave = tagsValid && reflectionValid && correctValid && exitReasonValid && !saving;

  const hotWarnings = selectedTags
    .map(id => {
      const p = allPatterns.find(x => x.id === id);
      const n = hotCounts[id] ?? 0;
      return p && n >= 2 ? { pattern: p, count: n } : null;
    })
    .filter(Boolean) as { pattern: ErrorTagPattern; count: number }[];

  const sectionCardClass = 'rounded-xl border border-border/70 bg-card/70 shadow-[0_10px_30px_rgba(0,0,0,0.04)]';
  const subtleLabelClass = 'text-[11px] font-medium text-muted-foreground';
  const metricCardClass = 'rounded-xl border border-border/70 bg-background/70 px-3 py-3';

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
      // Save deep analysis if any field was filled
      const hasDeep = Object.values(sixStep).some(v => String(v ?? '').trim().length > 0);
      if (hasDeep) {
        try {
          await updateJournalDeepAnalysis(journal.id, sixStep);
          if (sixStep.post_new_rule_draft.trim().length >= 15) {
            toast.info('提示：Step 6 已写但未加入 checklist，可前往复现页激活');
          }
        } catch (e) {
          console.warn('[deep] save failed', e);
        }
      }
      if (tradeRecord?.id) {
        const nextExitReason = exitReason.trim();
        setTradeHistory(prev => prev.map(t => (
          t.id === tradeRecord.id ? { ...t, exit_reason_text: nextExitReason } : t
        )));
      }
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

  const applySixStepToFields = () => {
    const ref = `[场景] ${sixStep.post_error_scenario}\n[现实] ${sixStep.post_reality_feedback}\n[根因] ${sixStep.post_real_problem}`;
    setReflection(ref);
    if (sixStep.post_new_rule_draft) setCorrectAction(sixStep.post_new_rule_draft);
  };

  const exitMethodLabel = (() => {
    const m = tradeRecord?.action === 'LIQUIDATION' ? 'liquidation' : tradeRecord?.exit_method;
    if (!m) return '—';
    if (m === 'manual') return '手动';
    if (m === 'sl') return '止损';
    if (m === 'liquidation') return '爆仓';
    if (m === 'tp1') return '止盈 1';
    if (m === 'tp2') return '止盈 2';
    if (m === 'tp3') return '止盈 3';
    return m;
  })();

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const body = (
    <>
      <div className="px-5 py-4 border-b border-border bg-gradient-to-b from-muted/25 to-background/80">
        <div className="text-[15px] font-semibold tracking-[0.01em] text-foreground">平仓评价</div>
        <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
          {journal.symbol} · {journal.direction} · 模拟时间 {fmtTime(journal.pre_simulated_time)}
        </div>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 bg-background">
        {/* (A) Snapshot */}
        <Collapsible defaultOpen>
          <CollapsibleTrigger className={`w-full px-4 py-3 text-[11px] ${subtleLabelClass} flex items-center gap-1.5 hover:text-foreground transition-colors ${sectionCardClass}`}>
            <ChevronDown className="w-3 h-3" /> 开仓时的快照
          </CollapsibleTrigger>
          <CollapsibleContent className={`mt-2 space-y-2 text-[11px] font-mono text-foreground/85 px-4 py-4 ${sectionCardClass}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-block rounded px-2 py-0.5 text-[10px] ${
                isHedge ? 'bg-[#F0B90B]/15 text-[#F0B90B]' : 'bg-foreground/10 text-foreground'
              }`}>{isHedge ? '对冲单' : '主力单'}</span>
              {journal.position_mode && (
                <span className={`inline-block rounded px-2 py-0.5 text-[10px] ${positionModeChipClass}`}>
                  {positionModeLabel}
                </span>
              )}
              {journal.position_mode === 'cross' && (
                <span className="inline-block rounded px-2 py-0.5 text-[10px] bg-[#F6465D]/10 text-[#F6465D]">
                  这笔在守卫上线前用了全仓
                </span>
              )}
            </div>
            <div>• {isHedge ? '对冲理由' : '入场理由'}：{journal.pre_entry_reason}</div>
            {journal.pre_planned_stop_loss != null ? (
              <div>• 预设止损/止盈：{journal.pre_planned_stop_loss} / {journal.pre_planned_take_profit ?? '—'} <span className="text-[10px] text-muted-foreground">（历史记录）</span></div>
            ) : journal.pre_planned_take_profit != null ? (
              <div>• 预设止盈：{journal.pre_planned_take_profit}</div>
            ) : null}
            {journal.pre_max_loss_usdt != null && (
              <div>• 本次预设最大亏损：<span className="text-[#F6465D]">{journal.pre_max_loss_usdt.toFixed(2)} USDT</span></div>
            )}
            {journal.pre_risk_awareness && <div>• 风险认识：{journal.pre_risk_awareness}</div>}
            {journal.pre_risk_management && <div>• 风险管理：{journal.pre_risk_management}</div>}
            <div>
              • 心态自评：{journal.pre_mental_state} 分（{MENTAL_STATE_LABELS[journal.pre_mental_state]}）
              {journal.pre_mental_trigger ? ` · ${journal.pre_mental_trigger}` : ''}
            </div>
            {journal.direction !== 'no_entry' && (
              <div>• 杠杆 / 仓位模式：{journal.leverage != null ? `${journal.leverage}x` : '—'} · {positionModeLabel}</div>
            )}
            {checklistItemsArr.length > 0 && (
              <div>
                • Checklist：{reqChecked}/{checklistRequired.length} 必填 · {optChecked}/{checklistOptional.length} 可选 · {journal.pre_checklist_passed ? '通过' : '未通过'}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* (B) Auto outcome */}
        {!tradeRecord && journal.direction !== 'no_entry' && (
          <div className="rounded-xl border border-[#F0B90B]/30 bg-[#F0B90B]/8 px-3 py-2.5 text-[11px] leading-relaxed text-[#F0B90B]">
            未找到对应的成交记录，下方判定字段使用快照中保存的数据，必要时可手填 R 倍数覆盖。
          </div>
        )}
        <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px] font-mono ${sectionCardClass} p-3`}>
          <div className={metricCardClass}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">结果</div>
            <div className={outcome === 'win' ? 'text-[#0ECB81]' : outcome === 'loss' ? 'text-[#F6465D]' : 'text-foreground'}>
              {outcome}
            </div>
          </div>
          <div className={metricCardClass}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">实现 P&L</div>
            <div className={pnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'}>
              {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
            </div>
          </div>
          <div className={metricCardClass}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              R 倍数
              <button onClick={() => setEditingR(v => !v)}><Pencil className="w-2.5 h-2.5 text-muted-foreground hover:text-foreground" /></button>
            </div>
            {editingR ? (
              <Input
                value={rMultipleOverride}
                onChange={e => setRMultipleOverride(e.target.value)}
                onBlur={() => setEditingR(false)}
                autoFocus
                className="mt-1 h-7 text-[12px] bg-card border-border/70 font-mono rounded-md"
              />
            ) : (
              <div>{finalR != null ? finalR.toFixed(2) + ' R' : '—'}</div>
            )}
          </div>
          <div className={metricCardClass}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">持仓时长</div>
            <div>{holdDurationLabel}</div>
          </div>
        </div>

        <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
          <div className="flex items-center justify-between gap-3">
            <Label className="text-[12px] font-medium">出场原因 * ≥10 字</Label>
            <span className="text-[11px] text-muted-foreground">出场方式：{exitMethodLabel}</span>
          </div>
          <Textarea
            rows={3}
            value={exitReason}
            onChange={e => setExitReason(e.target.value)}
            placeholder={
              tradeRecord?.exit_method === 'manual' || tradeRecord?.action === 'LIQUIDATION'
                ? '例如：跌破计划结构位后主动认错；或出现超预期波动，优先回收风险敞口。'
                : '例如：止盈触发后没有再追；止损触发符合预案，因此按系统执行离场。'
            }
            className="text-[12px] bg-background/80 border-border/70 rounded-xl"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">这里写的是你为什么在这个位置离场，不是这笔交易最后学到了什么。</p>
            <span className={`text-[10px] font-mono ${exitReasonValid ? 'text-muted-foreground' : 'text-[#F6465D]'}`}>
              {exitReason.trim().length} / 10
            </span>
          </div>
        </div>

        {/* (C) Tags */}
        {user && (
          <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
            <div className="flex items-center justify-between">
              <Label className="text-[12px] font-medium">错误标签 *</Label>
              <span className="text-[11px] text-muted-foreground">至少选 1 个，或勾选下方"本次无明显错误"</span>
            </div>
            <JournalTagPicker
              userId={user.id}
              selectedPatternIds={selectedTags}
              notes={tagNotes}
              onChange={(ids, ns) => { setSelectedTags(ids); setTagNotes(ns); }}
              disabled={noErrors}
            />
            <label className="flex items-center gap-2 text-[12px] text-foreground cursor-pointer rounded-lg border border-border/60 bg-background/60 px-3 py-2">
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

        {/* (C+) 六步深度分析（可选） */}
        <Collapsible open={sixStepOpen} onOpenChange={setSixStepOpen}>
          <CollapsibleTrigger className="w-full rounded-xl border border-border/70 bg-gradient-to-r from-card via-card to-accent/20 px-4 py-3 flex items-center gap-2 transition-colors hover:bg-accent/30 shadow-[0_10px_30px_rgba(0,0,0,0.04)]">
            <BrainCircuit className="w-3.5 h-3.5 text-[#F0B90B]" />
            <div className="flex-1 text-left">
              <div className="text-[12px] font-medium text-foreground">进入六步深度分析（推荐）</div>
              <div className="text-[10px] text-muted-foreground">
                比"复盘文字"+"反事实"更结构化。完成后下方两个字段可自动生成。
              </div>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${sixStepOpen ? 'rotate-180' : ''}`} />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            <SixStepAnalysisForm value={sixStep} onChange={setSixStep} />
            <Button size="sm" variant="ghost" onClick={applySixStepToFields}
              className="h-8 rounded-lg text-[10px] border border-border/70 bg-card/80 hover:bg-accent/60">
              用六步内容回写下方字段
            </Button>
          </CollapsibleContent>
        </Collapsible>

        {/* (D) Reflection */}
        <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
          <Label className="text-[12px] font-medium">复盘文字（这笔交易里你真正学到了什么？）* ≥30 字</Label>
          <Textarea
            rows={4}
            value={reflection}
            onChange={e => setReflection(e.target.value)}
            placeholder="例如：本次入场理由在事后看仍然成立，但仓位过重；止损位过近导致被洗出后又看着行情走出预期方向。下次应根据 ATR 设置止损宽度。"
            className="text-[12px] bg-background/80 border-border/70 rounded-xl"
          />
          <div className="text-[10px] text-muted-foreground text-right font-mono">{reflection.trim().length} / 30</div>
        </div>

        {/* (E) Counterfactual */}
        <div className={`space-y-2 px-4 py-4 ${sectionCardClass}`}>
          <Label className="text-[12px] font-medium">如果重来一次，你会怎么做？* ≥20 字</Label>
          <Textarea
            rows={3}
            value={correctAction}
            onChange={e => setCorrectAction(e.target.value)}
            placeholder="例如：止损位放在 X 而非 Y；分批入场 3 次而非一次满仓；不在心态 ≤3 分时开仓。"
            className="text-[12px] bg-background/80 border-border/70 rounded-xl"
          />
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">❗ 必须可执行——不是"下次更冷静"，而是"下次开仓前必须满足 checklist 第 N 项"</p>
            <span className="text-[10px] text-muted-foreground font-mono">{correctAction.trim().length} / 20</span>
          </div>
        </div>

        {/* (F) Frequency warning */}
        {hotWarnings.length > 0 && (
          <div className="bg-[#F6465D]/8 border border-[#F6465D]/25 rounded-xl px-4 py-3 space-y-1 shadow-[0_10px_30px_rgba(246,70,93,0.08)]">
            {hotWarnings.map(w => (
              <div key={w.pattern.id} className="text-[12px] text-[#F6465D]">
                ⚠ 模式「{w.pattern.pattern_name}」最近 30 天内已出现 {w.count} 次（含本次 = {w.count + 1} 次）。
                满 3 次后，系统会在批次 6 强制要求你写一条新规则加入 checklist。
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-border flex justify-end gap-2 shrink-0 bg-gradient-to-t from-muted/20 to-background">
        <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-9 rounded-lg px-4 text-[12px] hover:bg-accent/60">取消</Button>
        <Button
          onClick={handleSave}
          disabled={!canSave}
          className="h-9 rounded-lg px-4 text-[12px] bg-[#F0B90B] hover:bg-[#F0B90B]/90 text-black shadow-[0_10px_24px_rgba(240,185,11,0.18)] disabled:opacity-40 disabled:shadow-none"
        >{saving ? '保存中...' : '保存评价'}</Button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="h-[92vh] rounded-t-2xl p-0 bg-background border-t border-border flex flex-col">
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[640px] sm:max-w-[640px] p-0 bg-background border-l border-border shadow-2xl flex flex-col">
        {body}
      </SheetContent>
    </Sheet>
  );
}
