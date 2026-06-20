import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crosshair, ExternalLink } from 'lucide-react';
import { LegRoleChip } from '@/components/journal/LegRoleChip';
import { HEDGE_TYPE_LABELS } from '@/lib/hedgeTypes';
import type { TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

interface Props {
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  reverseHedgeOrders?: CampaignReverseHedgeOrder[];
  highlightedLegIds?: string[];
  onToggleHighlight?: (leg: TradeJournal) => void;
  onDetach?: (leg: TradeJournal) => void;
}

function statusForLeg(leg: TradeJournal, record: TradeRecord | null) {
  if (record) return { label: '已平仓', className: 'text-[#0ECB81]' };
  if (leg.post_real_close_time || leg.post_outcome) return { label: '已平仓', className: 'text-[#0ECB81]' };
  if (leg.leg_role === 'mirror_tp' || leg.leg_role?.startsWith('hedge_')) return { label: '挂单中', className: 'text-[#F0B90B]' };
  return { label: '进行中', className: 'text-muted-foreground' };
}

function fmtClock(value: number | string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function operationTimeForLeg(leg: TradeJournal): string | number | null | undefined {
  return leg.post_real_close_time ?? leg.pre_real_time ?? leg.created_at ?? leg.updated_at;
}

function timeMs(value: number | string | null | undefined): number | null {
  if (!value) return null;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toPrecision(6);
}

export function CampaignLegsList({
  legs,
  tradeRecords,
  reverseHedgeOrders = [],
  highlightedLegIds = [],
  onToggleHighlight,
  onDetach,
}: Props) {
  const nav = useNavigate();
  const recordMap = useMemo(() => new Map(tradeRecords.map(record => [record.id, record])), [tradeRecords]);
  const highlightedSet = useMemo(() => new Set(highlightedLegIds), [highlightedLegIds]);
  // 反向挂单归属：每条挂单只归到「委托时刻最近一次开仓」的那条腿，避免在多条腿重叠的时间窗里重复出现。
  const reverseOrderLegMap = useMemo(() => {
    const legOpens = legs
      .map(leg => {
        const rec = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
        return { id: leg.id, openMs: timeMs(rec?.openTime ?? leg.pre_simulated_time) };
      })
      .filter((item): item is { id: string; openMs: number } => item.openMs != null)
      .sort((a, b) => a.openMs - b.openMs);
    const map = new Map<string, string>();
    for (const order of reverseHedgeOrders) {
      let assignedId: string | null = legOpens[0]?.id ?? null;
      for (const { id, openMs } of legOpens) {
        if (openMs <= order.createdAt) assignedId = id;
        else break;
      }
      if (assignedId) map.set(order.id, assignedId);
    }
    return map;
  }, [legs, reverseHedgeOrders, recordMap]);

  return (
    <div className="bg-card border border-border rounded overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[1320px]">
          <div className="grid grid-cols-[48px_120px_1fr_96px_96px_92px_88px_72px_210px_230px] text-[10px] text-muted-foreground bg-muted/40 py-2 px-3">
            <div>#</div>
            <div>角色</div>
            <div>时间</div>
            <div>开仓价</div>
            <div>平仓价</div>
            <div>仓位</div>
            <div>状态</div>
            <div>R̄</div>
            <div>反向挂单</div>
            <div>操作</div>
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {legs.map(leg => {
              const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
              const status = statusForLeg(leg, record);
              const highlighted = highlightedSet.has(leg.id);
              const openLabel = fmtClock(record?.openTime ?? leg.pre_simulated_time);
              const closeLabel = fmtClock(record?.closeTime ?? leg.post_real_close_time);
              const operationLabel = fmtClock(operationTimeForLeg(leg));
              const entryPriceValue = leg.pre_entry_price ?? record?.entryPrice ?? null;
              const exitPriceValue = record?.exitPrice ?? leg.post_exit_price_snapshot ?? null;
              const reverseOrdersForLeg = reverseHedgeOrders.filter(order => reverseOrderLegMap.get(order.id) === leg.id);
              const hedgeSummary = leg.order_kind === 'hedge' && leg.hedge_type
                ? `${HEDGE_TYPE_LABELS[leg.hedge_type]}${leg.hedge_necessity_pct != null ? ` · ${leg.hedge_necessity_pct.toFixed(0)}%` : ''}`
                : null;
              return (
                <div
                  key={leg.id}
                  className={`grid grid-cols-[48px_120px_1fr_96px_96px_92px_88px_72px_210px_230px] items-center text-[11px] font-mono py-2 px-3 border-b border-border/40 hover:bg-accent ${
                    highlighted ? 'bg-[#002FA7]/5 ring-1 ring-inset ring-[#002FA7]/12' : ''
                  }`}
                >
                  <div>{leg.leg_sequence ?? '—'}</div>
                  <div className="flex items-center gap-1.5">
                    {leg.leg_role ? <LegRoleChip role={leg.leg_role} /> : '—'}
                    {leg.source === 'retroactive_from_record' && (
                      <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        回填
                      </span>
                    )}
                  </div>
                  <div className="leading-tight">
                    <div><span className="text-muted-foreground">开 </span>{openLabel}</div>
                    <div><span className="text-muted-foreground">平 </span>{closeLabel}</div>
                    <div><span className="text-muted-foreground">操作 </span>{operationLabel}</div>
                    {hedgeSummary && <div className="text-[10px] text-[#F0B90B]">{hedgeSummary}</div>}
                  </div>
                  <div>{fmtPrice(entryPriceValue)}</div>
                  <div>{fmtPrice(exitPriceValue)}</div>
                  <div>{leg.pre_position_size != null ? leg.pre_position_size.toFixed(2) : '—'}</div>
                  <div className={status.className}>{status.label}</div>
                  <div>{leg.post_r_multiple != null ? leg.post_r_multiple.toFixed(2) : '—'}</div>
                  <div className="space-y-1 pr-2 font-sans">
                    {reverseOrdersForLeg.length === 0 ? (
                      <span className="font-mono text-muted-foreground">—</span>
                    ) : (
                      reverseOrdersForLeg.map(order => (
                        <div
                          key={order.id}
                          className="rounded border border-border/50 bg-muted/30 px-2 py-1 leading-tight"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={order.side === 'SHORT' ? 'text-[#6D28D9]' : 'text-[#002FA7]'}>
                              {order.side === 'SHORT' ? '空' : '多'} {fmtPrice(order.price)}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {order.status === 'pending' ? '挂单中' : '已撤'}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground">委 {fmtClock(order.createdAt)}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {order.cancelledAt ? `撤 ${fmtClock(order.cancelledAt)}` : '撤 —'}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {onToggleHighlight && (
                      <button
                        type="button"
                        onClick={() => onToggleHighlight(leg)}
                        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors ${
                          highlighted
                            ? 'bg-[#002FA7]/10 text-[#002FA7] hover:bg-[#002FA7]/15'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <Crosshair className="w-3 h-3" />
                        {highlighted ? '已标注' : '标到盘面'}
                      </button>
                    )}
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
        </div>
      </div>
    </div>
  );
}
