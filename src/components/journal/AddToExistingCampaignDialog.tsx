import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LegRoleChip } from '@/components/journal/LegRoleChip';
import { getAssignableLegRoles, LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import { batchAttachToCampaign, suggestLegRoles, validateClassification } from '@/lib/journalApi';
import type {
  ClassificationValidationResult,
  LegRole,
  SuggestedLegRole,
  TradeCampaign,
  TradeJournal,
} from '@/types/journal';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaigns: Array<{ campaign: TradeCampaign; legs: TradeJournal[] }>;
  journals: TradeJournal[];
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
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function occupiedRolesLabel(legs: TradeJournal[]): LegRole[] {
  return legs.map(leg => leg.leg_role).filter((role): role is LegRole => !!role);
}

export function AddToExistingCampaignDialog({
  open,
  onOpenChange,
  campaigns,
  journals,
  symbol,
  onAttached,
}: Props) {
  const orderedJournals = useMemo(
    () => [...journals].sort((a, b) => new Date(a.pre_simulated_time).getTime() - new Date(b.pre_simulated_time).getTime()),
    [journals],
  );
  const sortedCampaigns = useMemo(() => {
    return [...campaigns].sort((a, b) => {
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
  const suggestions = useMemo(() => {
    const base = suggestLegRoles(orderedJournals);
    if (!target) return base;
    const occupied = new Set(occupiedRolesLabel(target.legs));
    return base.map(item => {
      if (item.suggestedRole === 'main_open' && occupied.has('main_open')) {
        return { ...item, suggestedRole: 'reentry_main', confidence: 'low' as const, reason: '目标战役已有 main_open，改建议为 reentry_main' };
      }
      return item;
    });
  }, [orderedJournals, target]);
  const suggestionMap = useMemo(() => new Map(suggestions.map(item => [item.journalId, item])), [suggestions]);

  useEffect(() => {
    if (!open) return;
    setRoleMap({});
    setTargetCampaignId(sortedCampaigns[0]?.campaign.id ?? '');
  }, [open, sortedCampaigns]);

  useEffect(() => {
    if (!open || !targetCampaignId || !target) return;
    const activeRoles = orderedJournals
      .filter(journal => roleMap[journal.id])
      .map(journal => ({ journalId: journal.id, legRole: roleMap[journal.id] as LegRole }));
    let cancelled = false;
    (async () => {
      const next = await validateClassification({
        legs: activeRoles,
        strategyTemplate: target.campaign.strategy_template,
        targetCampaignId,
      });
      if (!cancelled) setValidation(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, orderedJournals, roleMap, targetCampaignId, target]);

  const occupied = new Set(target ? occupiedRolesLabel(target.legs) : []);
  const allAssigned = orderedJournals.every(journal => !!roleMap[journal.id]);
  const roleOptions = getAssignableLegRoles(target?.campaign.strategy_template ?? 'main_dual_hedge_mirror_tp');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] bg-card border-border">
        <DialogHeader>
          <DialogTitle>加入现有战役</DialogTitle>
          <DialogDescription className="text-[11px]">
            选择目标战役后，为当前选中的历史 journals 指定角色。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {sortedCampaigns.length === 0 ? (
            <div className="rounded border border-border bg-muted/30 px-4 py-4 text-[12px] text-muted-foreground">
              该标的下无可加入的活动战役，请选择“归类为新战役”。
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
                      <th className="px-2 py-2 text-left">时间</th>
                      <th className="px-2 py-2 text-left">类型</th>
                      <th className="px-2 py-2 text-left">方向</th>
                      <th className="px-2 py-2 text-left">价格</th>
                      <th className="px-2 py-2 text-left">仓位</th>
                      <th className="px-2 py-2 text-left">建议角色</th>
                      <th className="px-2 py-2 text-left">你的选择</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderedJournals.map((journal, index) => {
                      const suggestion = suggestionMap.get(journal.id);
                      return (
                        <tr key={journal.id} className="border-t border-border">
                          <td className="px-2 py-2">{index + 1}</td>
                          <td className="px-2 py-2 font-mono">{fmtLabel(journal.pre_simulated_time)}</td>
                          <td className="px-2 py-2">{journal.order_kind === 'main' ? '主力' : '对冲'}</td>
                          <td className={`px-2 py-2 ${journal.direction === 'short' ? 'text-[#F6465D]' : 'text-[#0ECB81]'}`}>
                            {journal.direction === 'short' ? 'SHORT' : 'LONG'}
                          </td>
                          <td className="px-2 py-2 font-mono">{(journal.pre_entry_price ?? 0).toFixed(4)}</td>
                          <td className="px-2 py-2 font-mono">{journal.pre_position_size?.toFixed(2) ?? '—'}</td>
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
                              value={roleMap[journal.id] ?? ''}
                              onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                                setRoleMap(prev => ({
                                  ...prev,
                                  [journal.id]: e.target.value as LegRole,
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
                await batchAttachToCampaign(
                  target.campaign.id,
                  orderedJournals.map((journal, index) => ({
                    journalId: journal.id,
                    legRole: roleMap[journal.id] as LegRole,
                    legSequence: target.legs.length + index + 1,
                    attachNote: 'classified retroactively',
                  })),
                );
                toast.success('历史 journals 已加入现有战役');
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
