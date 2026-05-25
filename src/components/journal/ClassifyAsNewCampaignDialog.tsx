import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getAssignableLegRoles, LEG_ROLE_LABELS, STRATEGY_TEMPLATES } from '@/lib/strategyTemplates';
import { createCampaignFromJournals, suggestLegRoles, validateClassification } from '@/lib/journalApi';
import type {
  ClassificationValidationResult,
  LegRole,
  StrategyTemplate,
  SuggestedLegRole,
  TradeJournal,
} from '@/types/journal';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  journals: TradeJournal[];
  onCreated: (campaignId: string) => void;
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

function statusLabel(journal: TradeJournal) {
  if (journal.trade_record_id) return '已成交';
  return journal.order_kind === 'hedge' ? '未触发取消' : '挂单中';
}

export function ClassifyAsNewCampaignDialog({ open, onOpenChange, journals, onCreated }: Props) {
  const ordered = useMemo(
    () => [...journals].sort((a, b) => new Date(a.pre_simulated_time).getTime() - new Date(b.pre_simulated_time).getTime()),
    [journals],
  );
  const suggestions = useMemo(() => suggestLegRoles(ordered), [ordered]);
  const suggestionMap = useMemo(() => new Map(suggestions.map(item => [item.journalId, item])), [suggestions]);
  const firstJournal = ordered[0] ?? null;
  const [title, setTitle] = useState('');
  const [strategyTemplate, setStrategyTemplate] = useState<StrategyTemplate>('main_dual_hedge_mirror_tp');
  const [notes, setNotes] = useState('');
  const [roleMap, setRoleMap] = useState<Record<string, LegRole | ''>>({});
  const [validation, setValidation] = useState<ClassificationValidationResult>({ ok: false, errors: [], warnings: [] });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !firstJournal) return;
    const d = new Date(firstJournal.pre_simulated_time);
    const dateLabel = d.toISOString().slice(0, 10);
    const directionLabel = firstJournal.direction === 'short' ? '空' : '多';
    setTitle(`${firstJournal.symbol} ${dateLabel} ${directionLabel}战役`);
    setNotes('');
    setStrategyTemplate('main_dual_hedge_mirror_tp');
    setRoleMap({});
  }, [open, firstJournal]);

  useEffect(() => {
    if (!open) return;
    const activeRoles = ordered
      .filter(journal => roleMap[journal.id])
      .map(journal => ({ journalId: journal.id, legRole: roleMap[journal.id] as LegRole }));
    let cancelled = false;
    (async () => {
      const next = await validateClassification({ legs: activeRoles, strategyTemplate });
      if (!cancelled) setValidation(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ordered, roleMap, strategyTemplate]);

  const allAssigned = ordered.every(journal => !!roleMap[journal.id]);
  const roleOptions = getAssignableLegRoles(strategyTemplate);
  const symbol = firstJournal?.symbol ?? '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px] bg-card border-border">
        <DialogHeader>
          <DialogTitle>归类为新战役</DialogTitle>
          <DialogDescription className="text-[11px]">
            {ordered.length} 个 journals · {symbol}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
                    next[item.journalId] = item.suggestedRole;
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
                  {ordered.map((journal, index) => {
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
                        <td className="px-2 py-2">{statusLabel(journal)}</td>
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
                const campaign = await createCampaignFromJournals({
                  title: title.trim(),
                  strategyTemplate,
                  notes: notes.trim() || undefined,
                  legs: ordered.map((journal, index) => ({
                    journalId: journal.id,
                    legRole: roleMap[journal.id] as LegRole,
                    legSequence: index + 1,
                  })),
                });
                toast.success('历史 journals 已归类为新战役');
                onOpenChange(false);
                onCreated(campaign.id);
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
