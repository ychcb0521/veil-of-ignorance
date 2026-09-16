import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { closeCampaign, appendCampaignEvent } from '@/lib/journalApi';
import { computeSopDeviation, type DecisionAccuracyResult } from '@/lib/campaignAnalysis';
import { campaignStatusFromRealizedPnl, type CampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { fromLocalDateTimeInputValue, toLocalDateTimeInputValue } from '@/lib/localDateTimeInput';
import type { CampaignStatus, TradeCampaign, TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

type CloseStatus = Extract<CampaignStatus, 'closed_profit' | 'closed_loss' | 'closed_breakeven' | 'abandoned'>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  /**
   * 详情页已经算好的那一份结算（叠着平仓价校正）。
   * 已结算时状态由它推出、final_realized_pnl 写它的 total——与页面显示的数同源；
   * 不传或未结算时退回原来的手选流程。
   */
  settlement?: CampaignRealizedPnl | null;
  accuracy: DecisionAccuracyResult;
  currentSimulatedTime: number;
  onClosed: () => void;
}

const STATUS_OPTIONS: Array<{ value: CloseStatus; label: string; className: string }> = [
  { value: 'closed_profit', label: 'closed_profit', className: 'text-[#0ECB81]' },
  { value: 'closed_loss', label: 'closed_loss', className: 'text-[#F6465D]' },
  { value: 'closed_breakeven', label: 'closed_breakeven', className: 'text-muted-foreground' },
  { value: 'abandoned', label: 'abandoned', className: 'text-[#F0B90B]' },
];

const DERIVED_STATUS_HINT = '状态由已实现盈亏推出';

/** 已结算时由金额推出的结束态；只在三个 closed_* 之间取值（closedAt 为空时退回 null）。 */
function derivedCloseStatus(
  settlement: CampaignRealizedPnl | null | undefined,
  closedAt: string,
): Exclude<CloseStatus, 'abandoned'> | null {
  if (!settlement?.settled || !closedAt) return null;
  const status = campaignStatusFromRealizedPnl(settlement, closedAt);
  return status === 'closed_profit' || status === 'closed_loss' || status === 'closed_breakeven'
    ? status
    : null;
}

export function EndCampaignDialog({
  open,
  onOpenChange,
  campaign,
  legs,
  tradeRecords,
  settlement,
  accuracy,
  currentSimulatedTime,
  onClosed,
}: Props) {
  /**
   * 结束时间：输入框里是本地墙钟（datetime-local 按本地时间解析）。
   * 曾经按 UTC 墙钟预填（toISOString().slice(0, 16)）、再按本地时间解析，东八区里存下的 closed_at 比模拟时钟早 8 小时，
   * 战役页的扫描窗口因此在最后一次平仓之前截断。现在：没动过这一格就写**确切的**模拟时钟
   * （不截到分钟——否则 closed_at 会比刚刚那次平仓早几秒）；动过才按输入框里的本地时间写。
   * 预填跟着当前的模拟时钟走，不停在页面首次渲染的那一刻（对话框一直挂在页面上）；每次打开都清掉上次的改动。
   */
  const prefilledClosedAt = toLocalDateTimeInputValue(currentSimulatedTime);
  const [editedClosedAt, setEditedClosedAt] = useState<string | null>(null);
  useEffect(() => {
    if (open) setEditedClosedAt(null);
  }, [open]);
  const closedAtEdited = editedClosedAt != null && editedClosedAt !== prefilledClosedAt;
  const closedAt = closedAtEdited ? editedClosedAt : prefilledClosedAt;
  /**
   * 状态不是选出来的，是算出来的（与批量结束同一条原则）：
   * 已结算的战役预选推出的状态，其余三个都不可点——「放弃」也不例外：
   * 它只留给还有腿没平的战役（批量结束也是这么分档的）。已结算的战役写进 abandoned 是死写，
   * 对话框一关、详情页刷新，自愈就按金额把它改回 closed_*，用户只会看到状态自己跳了一下。
   * 未结算（还有腿没平）才退回原来的手选流程。
   */
  const derivedStatus = derivedCloseStatus(settlement, closedAt);
  const [manualStatus, setManualStatus] = useState<CloseStatus>('closed_profit');
  const status: CloseStatus = derivedStatus ?? manualStatus;
  const [notes, setNotes] = useState('');
  const [previewScore, setPreviewScore] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 已结算：写页面显示的那个数（校正后）；否则退回 Σ record.pnl 的老口径。
  const finalRealized = useMemo(
    () => (settlement?.settled && settlement.total != null
      ? settlement.total
      : tradeRecords.reduce((sum, record) => sum + (record.pnl || 0), 0)),
    [settlement, tradeRecords],
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
            {STATUS_OPTIONS.map(option => {
              // 已结算时只有推出的那个结束态可点；其余三个锁死并说明原因。
              const locked = derivedStatus != null && option.value !== derivedStatus;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={locked}
                  title={locked ? DERIVED_STATUS_HINT : undefined}
                  onClick={() => setManualStatus(option.value)}
                  className={`h-10 rounded border text-[12px] ${status === option.value ? 'border-[#F0B90B] bg-[#F0B90B]/10' : 'border-border bg-card'} ${locked ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <span className={option.className}>{option.label}</span>
                </button>
              );
            })}
          </div>
          {derivedStatus != null && (
            <div className="text-[11px] text-muted-foreground">
              {DERIVED_STATUS_HINT}：{finalRealized.toFixed(2)} USDT（与盈亏概览同源，已叠加平仓价校正）。
            </div>
          )}

          <div>
            <div className="text-[11px] text-muted-foreground mb-1">结束时间</div>
            <Input type="datetime-local" value={closedAt} onChange={(e: ChangeEvent<HTMLInputElement>) => setEditedClosedAt(e.target.value)} className="text-[12px]" />
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
                const simulatedIso = new Date(Number.isFinite(currentSimulatedTime) ? currentSimulatedTime : Date.now()).toISOString();
                const closedAtIso = closedAtEdited
                  ? fromLocalDateTimeInputValue(closedAt, simulatedIso)
                  : simulatedIso;
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
