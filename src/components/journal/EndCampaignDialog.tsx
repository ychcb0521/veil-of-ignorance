import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { closeCampaign, appendCampaignEvent } from '@/lib/journalApi';
import { computeSopDeviation, type DecisionAccuracyResult } from '@/lib/campaignAnalysis';
import type { CampaignStatus, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  accuracy: DecisionAccuracyResult;
  currentSimulatedTime: number;
  onClosed: () => void;
}

const STATUS_OPTIONS: Array<{ value: Extract<CampaignStatus, 'closed_profit' | 'closed_loss' | 'closed_breakeven' | 'abandoned'>; label: string; className: string }> = [
  { value: 'closed_profit', label: 'closed_profit', className: 'text-[#0ECB81]' },
  { value: 'closed_loss', label: 'closed_loss', className: 'text-[#F6465D]' },
  { value: 'closed_breakeven', label: 'closed_breakeven', className: 'text-muted-foreground' },
  { value: 'abandoned', label: 'abandoned', className: 'text-[#F0B90B]' },
];

export function EndCampaignDialog({
  open,
  onOpenChange,
  campaign,
  legs,
  tradeRecords,
  accuracy,
  currentSimulatedTime,
  onClosed,
}: Props) {
  const [status, setStatus] = useState<Extract<CampaignStatus, 'closed_profit' | 'closed_loss' | 'closed_breakeven' | 'abandoned'>>('closed_profit');
  const [closedAt, setClosedAt] = useState(() => new Date(currentSimulatedTime).toISOString().slice(0, 16));
  const [notes, setNotes] = useState('');
  const [previewScore, setPreviewScore] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const finalRealized = useMemo(
    () => tradeRecords.reduce((sum, record) => sum + (record.pnl || 0), 0),
    [tradeRecords],
  );
  const totalPlannedMaxLoss = useMemo(
    () => legs.reduce((sum, leg) => sum + (leg.pre_max_loss_usdt ?? 0), 0),
    [legs],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>结束战役</DialogTitle>
          <DialogDescription>确认本场战役的最终状态，并在结束前先看一眼 SOP 分数。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {STATUS_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatus(option.value)}
                className={`h-10 rounded border text-[12px] ${status === option.value ? 'border-[#F0B90B] bg-[#F0B90B]/10' : 'border-border bg-card'}`}
              >
                <span className={option.className}>{option.label}</span>
              </button>
            ))}
          </div>

          <div>
            <div className="text-[11px] text-muted-foreground mb-1">结束时间</div>
            <Input type="datetime-local" value={closedAt} onChange={(e: ChangeEvent<HTMLInputElement>) => setClosedAt(e.target.value)} className="text-[12px]" />
          </div>

          <div>
            <div className="text-[11px] text-muted-foreground mb-1">战役总复盘文字</div>
            <Textarea
              rows={4}
              value={notes}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
              placeholder="这场战役你学到了什么？哪些动作做对了，哪些下次应该做不一样？"
            />
          </div>

          {previewScore != null && (
            <div className="rounded border border-border bg-accent/30 px-3 py-2 text-[12px]">
              当前 SOP 评分预览：<span className="font-mono font-medium">{previewScore}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant="outline"
            onClick={() => {
              const score = computeSopDeviation(campaign, legs, tradeRecords);
              setPreviewScore(score.score ?? 0);
            }}
          >
            运行 SOP 评分
          </Button>
          <Button
            className="bg-[#F0B90B] text-black hover:bg-[#F0B90B]/90"
            disabled={submitting}
            onClick={async () => {
              try {
                setSubmitting(true);
                const closedAtIso = new Date(closedAt).toISOString();
                const finalR = totalPlannedMaxLoss > 0 ? finalRealized / totalPlannedMaxLoss : null;
                await closeCampaign(campaign.id, {
                  status,
                  final_realized_pnl: finalRealized,
                  final_r_multiple: finalR,
                  closed_at: closedAtIso,
                  peak_unrealized_pnl: accuracy.campaign_max_profit_real,
                  peak_drawdown: accuracy.campaign_max_drawdown_real,
                  notes: notes.trim() || null,
                });
                await appendCampaignEvent(campaign.id, {
                  timestamp: closedAtIso,
                  event_type: 'campaign_closed',
                  leg_role: null,
                  journal_id: null,
                  trade_record_id: null,
                  pending_order_id: null,
                  price: null,
                  size_usdt: null,
                  notes: notes.trim() || null,
                });
                onOpenChange(false);
                onClosed();
              } finally {
                setSubmitting(false);
              }
            }}
          >
            确认结束
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
