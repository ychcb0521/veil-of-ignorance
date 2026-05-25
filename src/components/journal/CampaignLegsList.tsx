import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { LegRoleChip } from '@/components/journal/LegRoleChip';
import type { TradeJournal } from '@/types/journal';
import type { TradeRecord } from '@/types/trading';

interface Props {
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  onDetach?: (leg: TradeJournal) => void;
}

function statusForLeg(leg: TradeJournal, record: TradeRecord | null) {
  if (record) return { label: '已平仓', className: 'text-[#0ECB81]' };
  if (leg.leg_role === 'mirror_tp' || leg.leg_role?.startsWith('hedge_')) return { label: '挂单中', className: 'text-[#F0B90B]' };
  return { label: '进行中', className: 'text-muted-foreground' };
}

export function CampaignLegsList({ legs, tradeRecords, onDetach }: Props) {
  const nav = useNavigate();
  const recordMap = useMemo(() => new Map(tradeRecords.map(record => [record.id, record])), [tradeRecords]);

  return (
    <div className="bg-card border border-border rounded overflow-hidden">
      <div className="grid grid-cols-[48px_120px_1fr_96px_92px_88px_72px_150px] text-[10px] text-muted-foreground bg-muted/40 py-2 px-3">
        <div>#</div>
        <div>角色</div>
        <div>时间</div>
        <div>价格</div>
        <div>仓位</div>
        <div>状态</div>
        <div>R̄</div>
        <div>操作</div>
      </div>
      {legs.map(leg => {
        const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
        const status = statusForLeg(leg, record);
        const timeLabel = leg.pre_simulated_time.replace('T', ' ').slice(5, 16);
        return (
          <div
            key={leg.id}
            className="grid grid-cols-[48px_120px_1fr_96px_92px_88px_72px_150px] items-center text-[11px] font-mono py-2 px-3 border-b border-border/40 hover:bg-accent"
          >
            <div>{leg.leg_sequence ?? '—'}</div>
            <div>{leg.leg_role ? <LegRoleChip role={leg.leg_role} /> : '—'}</div>
            <div>{timeLabel}</div>
            <div>{(leg.pre_entry_price ?? record?.entryPrice ?? 0).toFixed(4)}</div>
            <div>{leg.pre_position_size != null ? leg.pre_position_size.toFixed(2) : '—'}</div>
            <div className={status.className}>{status.label}</div>
            <div>{leg.post_r_multiple != null ? leg.post_r_multiple.toFixed(2) : '—'}</div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={!leg.id}
                onClick={() => nav(`/journal/${leg.id}`)}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <ExternalLink className="w-3 h-3" />
                查看复盘
              </button>
              {onDetach && (
                <button
                  type="button"
                  onClick={() => onDetach(leg)}
                  className="text-[10px] text-muted-foreground hover:text-[#F6465D]"
                >
                  解除
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
