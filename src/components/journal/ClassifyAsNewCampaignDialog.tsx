import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getAssignableLegRoles, LEG_ROLE_LABELS, STRATEGY_TEMPLATES } from '@/lib/strategyTemplates';
import {
  appendCampaignEvent,
  batchAttachToCampaign,
  batchBackfillAndAttach,
  createCampaign,
  createCampaignFromJournals,
  createCampaignFromTradeRecords,
  deleteCampaign,
  suggestLegRoles,
  validateClassification,
} from '@/lib/journalApi';
import type {
  ClassificationValidationResult,
  LegRole,
  StrategyTemplate,
  SuggestedLegRole,
} from '@/types/journal';
import type { ClassifiableItem, ClassifiableSuggestion } from '@/types/journalClassification';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ClassifiableItem[];
  onCreated: (campaignId: string) => void;
}

const CONFIDENCE_DOT: Record<SuggestedLegRole['confidence'], string> = {
  high: 'bg-[#0ECB81]',
  medium: 'bg-[#F0B90B]',
  low: 'bg-muted-foreground',
};

function fmtLabel(value: string | number) {
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function itemTimeMs(item: ClassifiableItem) {
  return item.kind === 'journal'
    ? new Date(item.journal.pre_simulated_time).getTime()
    : (item.record.openTime || item.record.closeTime || 0);
}

function itemTimeLabel(item: ClassifiableItem) {
  return fmtLabel(item.kind === 'journal' ? item.journal.pre_simulated_time : item.record.openTime);
}

function itemSymbol(item: ClassifiableItem) {
  return item.kind === 'journal' ? item.journal.symbol : item.record.symbol;
}

function itemDirection(item: ClassifiableItem): 'long' | 'short' {
  if (item.kind === 'journal') return item.journal.direction === 'short' ? 'short' : 'long';
  return item.record.side === 'SHORT' ? 'short' : 'long';
}

function itemEntryPrice(item: ClassifiableItem) {
  return item.kind === 'journal' ? item.journal.pre_entry_price ?? 0 : item.record.entryPrice;
}

function itemPositionSize(item: ClassifiableItem) {
  return item.kind === 'journal'
    ? item.journal.pre_position_size
    : item.record.entryPrice * item.record.quantity;
}

function statusLabel(item: ClassifiableItem) {
  if (item.kind === 'orphanRecord') return '已成交';
  if (item.journal.trade_record_id) return '已成交';
  return item.journal.order_kind === 'hedge' ? '未触发取消' : '挂单中';
}

function buildMixedValidation(
  ordered: ClassifiableItem[],
  roleMap: Record<string, LegRole | ''>,
  strategyTemplate: StrategyTemplate,
): ClassificationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const assigned = ordered.filter(item => roleMap[item.id]).map(item => ({ item, role: roleMap[item.id] as LegRole }));
  const symbols = new Set(ordered.map(itemSymbol));
  if (symbols.size > 1) errors.push('选中项跨多个 symbol');
  if (strategyTemplate === 'main_dual_hedge_mirror_tp' && !assigned.some(item => item.role === 'main_open')) {
    errors.push('main_dual_hedge_mirror_tp 模板必须包含 main_open 角色');
  }
  if (assigned.length > 1) {
    const spanMs = itemTimeMs(assigned[assigned.length - 1].item) - itemTimeMs(assigned[0].item);
    if (spanMs > 7 * 24 * 60 * 60 * 1000) {
      warnings.push('选中 legs 时间跨度 > 7 天（异常长战役）');
    }
  }
  if (
    strategyTemplate === 'main_dual_hedge_mirror_tp' &&
    (!assigned.some(item => item.role === 'hedge_initial_a') || !assigned.some(item => item.role === 'hedge_initial_b'))
  ) {
    warnings.push('main_dual_hedge_mirror_tp 模板缺少 hedge_initial_a 或 hedge_initial_b');
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function ClassifyAsNewCampaignDialog({ open, onOpenChange, items, onCreated }: Props) {
  const ordered = useMemo(
    () => [...items].sort((a, b) => itemTimeMs(a) - itemTimeMs(b)),
    [items],
  );
  const journalSuggestions = useMemo(
    () => new Map(suggestLegRoles(ordered.flatMap(item => item.kind === 'journal' ? [item.journal] : [])).map(item => [item.journalId, item])),
    [ordered],
  );
  const suggestions = useMemo<ClassifiableSuggestion[]>(
    () => ordered.map((item, index) => {
      if (item.kind === 'journal') {
        const suggestion = journalSuggestions.get(item.journal.id);
        return suggestion
          ? {
              itemId: item.id,
              suggestedRole: suggestion.suggestedRole,
              confidence: suggestion.confidence,
              reason: suggestion.reason,
            }
          : {
              itemId: item.id,
              suggestedRole: 'main_open',
              confidence: 'low',
              reason: '未能推断角色，默认建议 main_open',
            };
      }
      return {
        itemId: item.id,
        suggestedRole: index === 0 ? 'main_open' : 'standalone',
        confidence: 'low',
        reason: index === 0 ? '第一条仓位历史记录默认作为 main_open' : '后续仓位历史记录默认作为 standalone',
      };
    }),
    [journalSuggestions, ordered],
  );
  const suggestionMap = useMemo(() => new Map(suggestions.map(item => [item.itemId, item])), [suggestions]);
  const firstItem = ordered[0] ?? null;
  const orphanCount = useMemo(() => ordered.filter(item => item.kind === 'orphanRecord').length, [ordered]);
  const [title, setTitle] = useState('');
  const [strategyTemplate, setStrategyTemplate] = useState<StrategyTemplate>('main_dual_hedge_mirror_tp');
  const [notes, setNotes] = useState('');
  const [roleMap, setRoleMap] = useState<Record<string, LegRole | ''>>({});
  const [validation, setValidation] = useState<ClassificationValidationResult>({ ok: false, errors: [], warnings: [] });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !firstItem) return;
    const d = new Date(itemTimeMs(firstItem));
    const dateLabel = d.toISOString().slice(0, 10);
    const directionLabel = itemDirection(firstItem) === 'short' ? '空' : '多';
    setTitle(`${itemSymbol(firstItem)} ${dateLabel} ${directionLabel}战役`);
    setNotes('');
    setStrategyTemplate('main_dual_hedge_mirror_tp');
    setRoleMap({});
  }, [open, firstItem]);

  useEffect(() => {
    if (!open || suggestions.length === 0) return;
    setRoleMap(Object.fromEntries(suggestions.map(item => [item.itemId, item.suggestedRole])));
  }, [open, suggestions]);

  useEffect(() => {
    if (!open || ordered.length === 0) return;
    let cancelled = false;
    (async () => {
      let next: ClassificationValidationResult;
      if (orphanCount === 0) {
        const activeRoles = ordered
          .filter((item): item is Extract<ClassifiableItem, { kind: 'journal' }> => item.kind === 'journal' && !!roleMap[item.id])
          .map(item => ({ journalId: item.journal.id, legRole: roleMap[item.id] as LegRole }));
        next = await validateClassification({ legs: activeRoles, strategyTemplate });
      } else {
        next = buildMixedValidation(ordered, roleMap, strategyTemplate);
      }
      if (!cancelled) setValidation(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ordered, orphanCount, roleMap, strategyTemplate]);

  const allAssigned = ordered.every(item => !!roleMap[item.id]);
  const roleOptions = getAssignableLegRoles(strategyTemplate);
  const symbol = firstItem ? itemSymbol(firstItem) : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] bg-card border-border">
        <DialogHeader>
          <DialogTitle>归类为新战役</DialogTitle>
          <DialogDescription className="text-[11px]">
            {ordered.length} 个归类项 · {symbol}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {orphanCount > 0 && (
            <div className="rounded border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-3 py-2 text-[11px] text-[#F0B90B]">
              本次选中含 {orphanCount} 条仓位历史记录。若全部来自仓位历史记录，将直接组成一次交易战役。
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="text-[11px] text-muted-foreground">战役标题 *</div>
              <Input value={title} onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)} className="text-[12px]" />
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] text-muted-foreground">策略模板 *</div>
              <select
                value={strategyTemplate}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setStrategyTemplate(e.target.value as StrategyTemplate)}
                className="h-10 w-full rounded border border-border bg-background px-3 text-[12px]"
              >
                {Object.entries(STRATEGY_TEMPLATES).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
            {STRATEGY_TEMPLATES[strategyTemplate].description}
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] text-muted-foreground">备注</div>
            <Textarea value={notes} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)} className="min-h-[80px] text-[12px]" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[13px] font-medium">为每条 leg 分配角色</div>
              <Button
                type="button"
                variant="outline"
                className="h-8 text-[11px]"
                onClick={() => {
                  const next: Record<string, LegRole> = {};
                  suggestions.forEach(item => {
                    next[item.itemId] = item.suggestedRole;
                  });
                  setRoleMap(next);
                }}
              >
                一键应用建议
              </Button>
            </div>

            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/30 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">订单类型</th>
                    <th className="px-2 py-2 text-left">时间</th>
                    <th className="px-2 py-2 text-left">类型</th>
                    <th className="px-2 py-2 text-left">方向</th>
                    <th className="px-2 py-2 text-left">价格</th>
                    <th className="px-2 py-2 text-left">仓位</th>
                    <th className="px-2 py-2 text-left">状态</th>
                    <th className="px-2 py-2 text-left">建议角色</th>
                    <th className="px-2 py-2 text-left">你的选择</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((item, index) => {
                    const suggestion = suggestionMap.get(item.id);
                    const direction = itemDirection(item);
                    return (
                      <tr key={item.id} className="border-t border-border">
                        <td className="px-2 py-2">{index + 1}</td>
                        <td className="px-2 py-2">
                          <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] ${item.kind === 'journal' ? 'bg-[#0ECB81]/15 text-[#0ECB81]' : 'bg-[#F0B90B]/15 text-[#F0B90B]'}`}>
                            {item.kind === 'journal' ? 'journal' : '裸 record'}
                          </span>
                        </td>
                        <td className="px-2 py-2 font-mono">{itemTimeLabel(item)}</td>
                        <td className="px-2 py-2">{item.kind === 'journal' ? (item.journal.order_kind === 'main' ? '主力' : '对冲') : '历史成交'}</td>
                        <td className={`px-2 py-2 ${direction === 'short' ? 'text-[#F6465D]' : 'text-[#0ECB81]'}`}>
                          {direction === 'short' ? 'SHORT' : 'LONG'}
                        </td>
                        <td className="px-2 py-2 font-mono">{itemEntryPrice(item).toFixed(4)}</td>
                        <td className="px-2 py-2 font-mono">{itemPositionSize(item)?.toFixed(2) ?? '—'}</td>
                        <td className="px-2 py-2">{statusLabel(item)}</td>
                        <td className="px-2 py-2">
                          {suggestion ? (
                            <span
                              title={suggestion.reason}
                              className="inline-flex items-center gap-1 rounded bg-background px-2 py-1"
                            >
                              <span className={`h-2 w-2 rounded-full ${CONFIDENCE_DOT[suggestion.confidence]}`} />
                              {LEG_ROLE_LABELS[suggestion.suggestedRole]}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={roleMap[item.id] ?? ''}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                              setRoleMap(prev => ({
                                ...prev,
                                [item.id]: e.target.value as LegRole,
                              }));
                            }}
                            className="h-9 min-w-[160px] rounded border border-border bg-background px-2 text-[11px]"
                          >
                            <option value="">请选择</option>
                            {roleOptions.map(role => (
                              <option key={role} value={role}>{LEG_ROLE_LABELS[role]}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {validation.errors.length > 0 && (
            <div className="rounded border border-[#F6465D]/35 bg-[#F6465D]/8 p-3 text-[12px] text-foreground space-y-1">
              {validation.errors.map(error => <div key={error}>• {error}</div>)}
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className="rounded border border-[#F0B90B]/35 bg-[#F0B90B]/8 p-3 text-[12px] text-foreground space-y-1">
              {validation.warnings.map(warning => <div key={warning}>• {warning}</div>)}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            className="bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90 h-9"
            disabled={!title.trim() || !allAssigned || validation.errors.length > 0 || submitting}
            onClick={async () => {
              try {
                setSubmitting(true);
                const orderedAssignments = ordered.map((item, index) => ({
                  item,
                  legRole: roleMap[item.id] as LegRole,
                  legSequence: index + 1,
                }));
                const journalAssignments = orderedAssignments.filter(
                  (item): item is typeof item & { item: Extract<ClassifiableItem, { kind: 'journal' }> } => item.item.kind === 'journal',
                );
                const orphanAssignments = orderedAssignments.filter(
                  (item): item is typeof item & { item: Extract<ClassifiableItem, { kind: 'orphanRecord' }> } => item.item.kind === 'orphanRecord',
                );

                let campaignId: string;
                if (orphanAssignments.length === 0) {
                  const campaign = await createCampaignFromJournals({
                    title: title.trim(),
                    strategyTemplate,
                    notes: notes.trim() || undefined,
                    legs: journalAssignments.map(({ item, legRole, legSequence }) => ({
                      journalId: item.journal.id,
                      legRole,
                      legSequence,
                    })),
                  });
                  campaignId = campaign.id;
                } else if (journalAssignments.length === 0) {
                  const campaign = await createCampaignFromTradeRecords({
                    title: title.trim(),
                    strategyTemplate,
                    notes: notes.trim() || undefined,
                    records: orphanAssignments.map(({ item, legRole, legSequence }) => ({
                      record: item.record,
                      legRole,
                      legSequence,
                    })),
                  });
                  campaignId = campaign.id;
                } else {
                  const mainItem = orderedAssignments.find(item => item.legRole === 'main_open')?.item ?? orderedAssignments[0].item;
                  const campaign = await createCampaign({
                    symbol: itemSymbol(mainItem),
                    direction: itemDirection(mainItem) === 'short' ? 'main_short' : 'main_long',
                    title: title.trim(),
                    opened_at: new Date(itemTimeMs(ordered[0])).toISOString(),
                    strategy_template: strategyTemplate,
                    notes: notes.trim() || null,
                  });
                  campaignId = campaign.id;
                  try {
                    await appendCampaignEvent(campaign.id, {
                      timestamp: new Date(itemTimeMs(ordered[0])).toISOString(),
                      event_type: 'historical_classification_created',
                      leg_role: null,
                      journal_id: null,
                      trade_record_id: null,
                      pending_order_id: null,
                      price: null,
                      size_usdt: null,
                      notes: notes.trim() || null,
                    });
                    if (journalAssignments.length > 0) {
                      await batchAttachToCampaign(
                        campaign.id,
                        journalAssignments.map(({ item, legRole, legSequence }) => ({
                          journalId: item.journal.id,
                          legRole,
                          legSequence,
                          attachNote: 'classified retroactively',
                        })),
                      );
                    }
                    if (orphanAssignments.length > 0) {
                      await batchBackfillAndAttach(
                        orphanAssignments.map(({ item }) => item.record),
                        orphanAssignments.map(({ item, legRole, legSequence }) => ({
                          recordId: item.record.id,
                          legRole,
                          legSequence,
                          attachNote: 'classified retroactively',
                        })),
                        campaign.id,
                      );
                    }
                  } catch (error) {
                    await deleteCampaign(campaign.id).catch(() => undefined);
                    throw error;
                  }
                }
                toast.success('历史归类项已归类为新战役');
                onOpenChange(false);
                onCreated(campaignId);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            创建战役
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
