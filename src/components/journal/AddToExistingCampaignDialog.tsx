import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LegRoleChip } from '@/components/journal/LegRoleChip';
import { getAssignableLegRoles, LEG_ROLE_LABELS, MAIN_ADD_ROLES } from '@/lib/strategyTemplates';
import { batchAttachToCampaign, batchBackfillAndAttach, suggestLegRoles, validateClassification } from '@/lib/journalApi';
import { isHistoricalCampaign } from '@/types/journal';
import type {
  ClassificationValidationResult,
  LegRole,
  SuggestedLegRole,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';
import type { ClassifiableItem, ClassifiableSuggestion } from '@/types/journalClassification';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: Array<{ campaign: TradeCampaign; legs: TradeJournal[] }>;
  items: ClassifiableItem[];
  symbol: string;
  onAttached: (campaignId: string) => void;
}

const CONFIDENCE_DOT: Record<SuggestedLegRole['confidence'], string> = {
  high: 'bg-[#0ECB81]',
  medium: 'bg-[#F0B90B]',
  low: 'bg-muted-foreground',
};

function fmtLabel(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}\n${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function itemTimeMs(item: ClassifiableItem) {
  return item.kind === 'journal'
    ? new Date(item.journal.pre_simulated_time).getTime()
    : (item.record.openTime || item.record.closeTime || 0);
}

function itemTimeLabel(item: ClassifiableItem) {
  return fmtLabel(item.kind === 'journal' ? item.journal.pre_simulated_time : new Date(item.record.openTime).toISOString());
}

function itemCloseTimeLabel(item: ClassifiableItem) {
  if (item.kind === 'journal') {
    if (item.record?.closeTime) return fmtLabel(new Date(item.record.closeTime).toISOString());
    return item.journal.post_real_close_time ? fmtLabel(item.journal.post_real_close_time) : '—';
  }
  return item.record.closeTime ? fmtLabel(new Date(item.record.closeTime).toISOString()) : '—';
}

function itemOperationTimeLabel(item: ClassifiableItem) {
  if (item.kind === 'journal') {
    return fmtLabel(item.journal.post_real_close_time ?? item.journal.pre_real_time ?? item.journal.updated_at ?? item.journal.created_at);
  }
  // 裸成交记录：操作时间只认真实钱包时钟(closedRealAt)，没有就「—」，不拿模拟 K 线时间冒充。
  return item.record.closedRealAt ? fmtLabel(new Date(item.record.closedRealAt).toISOString()) : '—';
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

function itemExitPrice(item: ClassifiableItem) {
  if (item.kind === 'journal') return item.record && item.record.exitPrice > 0 ? item.record.exitPrice : null;
  return item.record.exitPrice > 0 ? item.record.exitPrice : null;
}

function itemPositionSize(item: ClassifiableItem) {
  return item.kind === 'journal'
    ? item.journal.pre_position_size
    : item.record.entryPrice * item.record.quantity;
}

function priceLabel(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : '—';
}

function suggestOrphanRecordRole(item: Extract<ClassifiableItem, { kind: 'orphanRecord' }>, index: number, ordered: ClassifiableItem[]): ClassifiableSuggestion {
  if (index === 0) {
    return {
      itemId: item.id,
      suggestedRole: 'main_open',
      confidence: 'low',
      reason: '裸 record 缺少开仓快照，默认建议先作为主力开仓归类',
    };
  }
  const firstDirection = itemDirection(ordered[0]);
  if (itemDirection(item) === firstDirection) {
    const priorSameDirectionCount = ordered
      .slice(0, index)
      .filter(candidate => itemDirection(candidate) === itemDirection(item))
      .length;
    const addRole = MAIN_ADD_ROLES[Math.min(Math.max(priorSameDirectionCount - 1, 0), MAIN_ADD_ROLES.length - 1)] ?? 'main_add_1';
    return {
      itemId: item.id,
      suggestedRole: addRole,
      confidence: 'medium',
      reason: '同向后续仓位，建议作为主力加仓 leg',
    };
  }
  return {
    itemId: item.id,
    suggestedRole: 'hedge_rolling',
    confidence: 'low',
    reason: '反向历史成交更像滚动对冲或独立单，请按实际意图确认',
  };
}

function occupiedRolesLabel(legs: TradeJournal[]): LegRole[] {
  return legs.map(leg => leg.leg_role).filter((role): role is LegRole => !!role);
}

function buildMixedValidation(
  ordered: ClassifiableItem[],
  target: { campaign: TradeCampaign; legs: TradeJournal[] } | null,
  targetCampaignId: string,
  roleMap: Record<string, LegRole | ''>,
): ClassificationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!target || !targetCampaignId) return { ok: false, errors: ['请选择目标战役'], warnings };

  const assigned = ordered.filter(item => roleMap[item.id]).map(item => ({ item, role: roleMap[item.id] as LegRole }));
  const symbols = new Set(ordered.map(itemSymbol));
  if (symbols.size > 1) errors.push('选中项跨多个 symbol');
  if (ordered.some(item => itemSymbol(item) !== target.campaign.symbol)) {
    errors.push('目标战役与选中项 symbol 不一致');
  }

  const selectedMain = assigned.find(item => item.role === 'main_open') ?? null;
  const existingMain = target.legs.find(leg => leg.leg_role === 'main_open') ?? null;
  if (existingMain && selectedMain) errors.push('目标战役已有 main_open，本次不能再次添加 main_open');

  if (assigned.some(item => itemTimeMs(item.item) < new Date(target.campaign.opened_at).getTime())) {
    errors.push('leg 时间不能早于战役开始时间');
  }

  if (selectedMain) {
    const nextDirection = itemDirection(selectedMain.item) === 'short' ? 'main_short' : 'main_long';
    if (nextDirection !== target.campaign.direction) errors.push('方向冲突');
  }

  const combinedSpan = [...target.legs.map(leg => new Date(leg.pre_simulated_time).getTime()), ...assigned.map(item => itemTimeMs(item.item))]
    .sort((a, b) => a - b);
  if (combinedSpan.length > 1 && combinedSpan[combinedSpan.length - 1] - combinedSpan[0] > 7 * 24 * 60 * 60 * 1000) {
    warnings.push('选中 legs 时间跨度 > 7 天（异常长战役）');
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function AddToExistingCampaignDialog({
  open,
  onOpenChange,
  campaigns,
  items,
  symbol,
  onAttached,
}: Props) {
  const orderedItems = useMemo(
    () => [...items].sort((a, b) => itemTimeMs(a) - itemTimeMs(b)),
    [items],
  );
  const sortedCampaigns = useMemo(() => {
    return campaigns.filter(item => isHistoricalCampaign(item.campaign)).sort((a, b) => {
      const aScore = a.campaign.symbol === symbol ? 0 : 1;
      const bScore = b.campaign.symbol === symbol ? 0 : 1;
      if (aScore !== bScore) return aScore - bScore;
      return new Date(b.campaign.opened_at).getTime() - new Date(a.campaign.opened_at).getTime();
    });
  }, [campaigns, symbol]);
  const [targetCampaignId, setTargetCampaignId] = useState('');
  const [roleMap, setRoleMap] = useState<Record<string, LegRole | ''>>({});
  const [validation, setValidation] = useState<ClassificationValidationResult>({ ok: false, errors: [], warnings: [] });
  const [submitting, setSubmitting] = useState(false);

  const target = sortedCampaigns.find(item => item.campaign.id === targetCampaignId) ?? null;
  const orphanCount = useMemo(() => orderedItems.filter(item => item.kind === 'orphanRecord').length, [orderedItems]);
  const suggestions = useMemo(() => {
    const base: SuggestedLegRole[] = suggestLegRoles(orderedItems.flatMap(item => item.kind === 'journal' ? [item.journal] : []));
    const baseMap = new Map<string, SuggestedLegRole>(base.map(item => [item.journalId, item] as const));
    const normalized: ClassifiableSuggestion[] = orderedItems.map((item, index) => {
      if (item.kind === 'orphanRecord') {
        return suggestOrphanRecordRole(item, index, orderedItems);
      }
      const suggestion = baseMap.get(item.journal.id);
      if (!suggestion) {
        return {
          itemId: item.id,
          suggestedRole: 'main_open',
          confidence: 'low',
          reason: '未能推断角色，默认建议 main_open',
        };
      }
      return {
        itemId: item.id,
        suggestedRole: suggestion.suggestedRole,
        confidence: suggestion.confidence,
        reason: suggestion.reason,
      };
    });
    if (!target) return normalized;
    const occupied = new Set(occupiedRolesLabel(target.legs));
    return normalized.map(item => {
      if (item.suggestedRole === 'main_open' && occupied.has('main_open')) {
        return { ...item, suggestedRole: 'reentry_main', confidence: 'low' as const, reason: '目标战役已有 main_open，改建议为 reentry_main' };
      }
      return item;
    });
  }, [orderedItems, target]);
  const suggestionMap = useMemo(() => new Map(suggestions.map(item => [item.itemId, item])), [suggestions]);

  useEffect(() => {
    if (!open) return;
    setRoleMap({});
    setTargetCampaignId(sortedCampaigns[0]?.campaign.id ?? '');
  }, [open, sortedCampaigns]);

  useEffect(() => {
    if (!open || !targetCampaignId || !target) return;
    let cancelled = false;
    (async () => {
      let next: ClassificationValidationResult;
      if (orphanCount === 0) {
        const activeRoles = orderedItems
          .filter((item): item is Extract<ClassifiableItem, { kind: 'journal' }> => item.kind === 'journal' && !!roleMap[item.id])
          .map(item => ({ journalId: item.journal.id, legRole: roleMap[item.id] as LegRole }));
        next = await validateClassification({
          legs: activeRoles,
          strategyTemplate: target.campaign.strategy_template,
          targetCampaignId,
        });
      } else {
        next = buildMixedValidation(orderedItems, target, targetCampaignId, roleMap);
      }
      if (!cancelled) setValidation(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, orderedItems, orphanCount, roleMap, targetCampaignId, target]);

  const occupied = new Set(target ? occupiedRolesLabel(target.legs) : []);
  const allAssigned = orderedItems.every(item => !!roleMap[item.id]);
  const roleOptions = getAssignableLegRoles(target?.campaign.strategy_template ?? 'main_dual_hedge_mirror_tp');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] bg-card border-border">
        <DialogHeader>
          <DialogTitle>加入现有战役</DialogTitle>
          <DialogDescription className="text-[11px]">
            选择目标战役后，为当前选中的归类项指定角色。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {orphanCount > 0 && (
            <div className="rounded border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-3 py-2 text-[11px] text-[#F0B90B]">
              本次选中含 {orphanCount} 个裸 records，归类时将自动回填为最小化 journal。
              这些回填 journal 缺少开仓决策信息（理由/心态/风险认识），在战役复盘中会显示“[历史回填]”标识。
            </div>
          )}
          {sortedCampaigns.length === 0 ? (
            <div className="rounded border border-border bg-muted/30 px-4 py-4 text-[12px] text-muted-foreground">
              该标的下无可加入的历史战役，请选择“归类为新战役”。实时战役不会在这里混入历史归类。
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <div className="text-[11px] text-muted-foreground">选择目标战役 *</div>
                <select
                  value={targetCampaignId}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setTargetCampaignId(e.target.value)}
                  className="h-10 w-full rounded border border-border bg-background px-3 text-[12px]"
                >
                  {sortedCampaigns.map(item => (
                    <option key={item.campaign.id} value={item.campaign.id}>
                      {item.campaign.symbol === symbol ? '★ ' : ''}{item.campaign.title} · {fmtLabel(item.campaign.opened_at)} · {item.legs.length} legs · {item.campaign.status}
                    </option>
                  ))}
                </select>
              </div>

              {target && (
                <div className="rounded border border-border bg-muted/20 p-3 text-[11px] space-y-2">
                  <div>{target.campaign.title}</div>
                  <div className="text-muted-foreground">
                    {target.campaign.direction} · opened_at {fmtLabel(target.campaign.opened_at)} · 现有 {target.legs.length} 个 legs
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {occupiedRolesLabel(target.legs).map((role, index) => (
                      <LegRoleChip key={`${role}-${index}`} role={role} short />
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/30 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 text-left">#</th>
                      <th className="px-2 py-2 text-left">类型</th>
                      <th className="px-2 py-2 text-left">开仓时间</th>
                      <th className="px-2 py-2 text-left">平仓时间</th>
                      <th className="px-2 py-2 text-left">操作时间</th>
                      <th className="px-2 py-2 text-left">订单类型</th>
                      <th className="px-2 py-2 text-left">方向</th>
                      <th className="px-2 py-2 text-left">开仓价</th>
                      <th className="px-2 py-2 text-left">平仓价</th>
                      <th className="px-2 py-2 text-left">仓位</th>
                      <th className="px-2 py-2 text-left">建议角色</th>
                      <th className="px-2 py-2 text-left">你的选择</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedItems.map((item, index) => {
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
                          <td className="px-2 py-2 font-mono whitespace-pre-line">{itemTimeLabel(item)}</td>
                          <td className="px-2 py-2 font-mono whitespace-pre-line">{itemCloseTimeLabel(item)}</td>
                          <td className="px-2 py-2 font-mono whitespace-pre-line">{itemOperationTimeLabel(item)}</td>
                          <td className="px-2 py-2">{item.kind === 'journal' ? (item.journal.order_kind === 'main' ? '主力' : '对冲') : '历史成交'}</td>
                          <td className={`px-2 py-2 ${direction === 'short' ? 'text-[#F6465D]' : 'text-[#0ECB81]'}`}>
                            {direction === 'short' ? 'SHORT' : 'LONG'}
                          </td>
                          <td className="px-2 py-2 font-mono">{priceLabel(itemEntryPrice(item))}</td>
                          <td className="px-2 py-2 font-mono">{priceLabel(itemExitPrice(item))}</td>
                          <td className="px-2 py-2 font-mono">{itemPositionSize(item)?.toFixed(2) ?? '—'}</td>
                          <td className="px-2 py-2">
                            {suggestion ? (
                              <span title={suggestion.reason} className="inline-flex items-center gap-1 rounded bg-background px-2 py-1">
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
                                <option key={role} value={role} disabled={role === 'main_open' && occupied.has('main_open')}>
                                  {LEG_ROLE_LABELS[role]}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            className="bg-[#5BA3FF] text-white hover:bg-[#5BA3FF]/90 h-9"
            disabled={!targetCampaignId || !allAssigned || validation.errors.length > 0 || submitting || sortedCampaigns.length === 0}
            onClick={async () => {
              if (!target) return;
              try {
                setSubmitting(true);
                const orderedAssignments = orderedItems.map((item, index) => ({
                  item,
                  legRole: roleMap[item.id] as LegRole,
                  legSequence: target.legs.length + index + 1,
                }));
                const journalAssignments = orderedAssignments.filter(
                  (item): item is typeof item & { item: Extract<ClassifiableItem, { kind: 'journal' }> } => item.item.kind === 'journal',
                );
                const orphanAssignments = orderedAssignments.filter(
                  (item): item is typeof item & { item: Extract<ClassifiableItem, { kind: 'orphanRecord' }> } => item.item.kind === 'orphanRecord',
                );

                if (journalAssignments.length > 0) {
                  await batchAttachToCampaign(
                    target.campaign.id,
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
                    target.campaign.id,
                  );
                }
                toast.success('历史归类项已加入现有战役');
                onOpenChange(false);
                onAttached(target.campaign.id);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            加入战役
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
