import { type ReactNode, useEffect, useMemo, useState, useCallback } from 'react';
import {
  ArrowLeft,
  Activity,
  CalendarMinus,
  ClipboardCheck,
  ClipboardX,
  ChevronDown,
  ChevronRight,
  Clock,
  Flag,
  Gauge,
  LineChart,
  ListChecks,
  Loader2,
  Trophy,
  Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import {
  EXECUTION_DECISION_REWARD,
  EXECUTION_DIRECT_PENALTY,
  EXECUTION_NO_TRADE_PENALTY,
  EXECUTION_CAMPAIGN_REWARD,
  EXECUTION_CAMPAIGN_MISSING_PENALTY,
  EXECUTION_REVIEW_REWARD,
  EXECUTION_REVIEW_MISSING_PENALTY,
  executionTradeCount,
  localDateKey,
  type ExecutionAssetEvent,
  type ExecutionTradeSnapshot,
} from '@/lib/executionAssets';
import {
  backfillJournalFromRecord,
  listAllCampaigns,
  listJournals,
  listJournalsByTradeRecordId,
} from '@/lib/journalApi';
import { formatCoinAmount, getSettlementAsset } from '@/lib/coinMargined';
import {
  formatSettlementQuantity,
  getPositionNotionalUsd,
  isCoinSettled,
} from '@/lib/tradingSettlement';
import { formatUTC8 } from '@/lib/timeFormat';
import { cn } from '@/lib/utils';
import type { TradeRecord } from '@/types/trading';
import type { TradeCampaign } from '@/types/journal';
import { buildObjectiveLongMainReviewItems } from '@/lib/unreviewedLongMainTrades';

type DetailPanelKey = 'decision' | 'direct' | 'penalty' | 'campaign' | 'review' | 'review_missing' | 'share';

function formatSigned(points: number) {
  return `${points >= 0 ? '+' : ''}${points.toLocaleString()}`;
}

function eventTone(type: string) {
  if (type === 'decision_reward') return 'text-[#0ECB81] border-[#0ECB81]/25 bg-[#0ECB81]/5';
  if (type === 'direct_reward') return 'text-[#F6465D] border-[#F6465D]/25 bg-[#F6465D]/5';
  if (type === 'campaign_reward') return 'text-[#5BA3FF] border-[#5BA3FF]/25 bg-[#5BA3FF]/5';
  if (type === 'review_reward') return 'text-[#B080FF] border-[#B080FF]/25 bg-[#B080FF]/5';
  return 'text-[#F6465D] border-[#F6465D]/25 bg-[#F6465D]/5';
}

function formatNumber(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatTime(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return '—';
  return formatUTC8(value);
}

function executionEventOperationTime(
  event: ExecutionAssetEvent,
  campaignById: Record<string, TradeCampaign>,
): number {
  if (event.operationTime != null && Number.isFinite(event.operationTime)) return event.operationTime;
  if (event.type === 'campaign_reward' && event.campaignId) {
    const campaignCreatedAt = campaignById[event.campaignId]?.created_at;
    const campaignTime = campaignCreatedAt ? new Date(campaignCreatedAt).getTime() : Number.NaN;
    if (Number.isFinite(campaignTime)) return campaignTime;
  }
  if (Number.isFinite(event.createdAt)) return event.createdAt;
  const dateFallback = new Date(`${event.date}T00:00:00+08:00`).getTime();
  return Number.isFinite(dateFallback) ? dateFallback : 0;
}

function sideLabel(side: string | null | undefined) {
  if (side === 'LONG') return '多';
  if (side === 'SHORT') return '空';
  return side || '—';
}

function quoteLabel(item: { settlementMode?: string } | null | undefined) {
  return item?.settlementMode === 'coin' ? 'USD' : 'USDT';
}

function formatSnapshotQuantity(trade: ExecutionTradeSnapshot) {
  return formatSettlementQuantity(trade, trade.symbol);
}

function formatSnapshotMargin(trade: ExecutionTradeSnapshot) {
  const margin = trade.margin ?? 0;
  if (isCoinSettled(trade) && trade.marginCoin != null) {
    const asset = trade.settlementAsset ?? getSettlementAsset(trade.symbol);
    return `${formatCoinAmount(trade.marginCoin, asset)} ≈ ${formatNumber(margin, 2)} USDT`;
  }
  return `${formatNumber(margin, 2)} USDT`;
}

function formatSnapshotNotional(trade: ExecutionTradeSnapshot) {
  const notional = trade.notionalUsd ?? trade.notional ?? getPositionNotionalUsd(trade.symbol, trade, trade.entryPrice);
  return `${formatNumber(notional, 2)} ${quoteLabel(trade)}`;
}

/**
 * 按 symbol + side + 入场价 + 开仓时间，在 tradeHistory 里找对应的 CLOSE 记录。
 * - 同一笔可能因部分平仓产生多条 CLOSE → 全部累加 pnl，closeTime 取最晚一条
 * - 找不到任何 CLOSE → 视为持仓中
 */
interface MatchedClose {
  records: TradeRecord[];
  pnl: number;
  fee: number;
  netPnl: number;
  closeTime: number;
  /** Use this representative record as input to backfillJournalFromRecord. */
  primaryRecord: TradeRecord;
}
function matchClosesForSnapshot(
  snapshot: ExecutionTradeSnapshot | null | undefined,
  history: TradeRecord[],
): MatchedClose | null {
  if (!snapshot) return null;
  const targetOpen = snapshot.simulatedTime ?? null;
  const PRICE_EPS = Math.max(snapshot.entryPrice * 1e-5, 1e-6);
  const TIME_EPS = 1500; // 1.5s 容差，吃掉时间戳精度差
  const matched = history.filter(record => (
    record.action !== 'OPEN'
    && record.symbol === snapshot.symbol
    && record.side === snapshot.side
    && Math.abs(record.entryPrice - snapshot.entryPrice) <= PRICE_EPS
    && (targetOpen == null || Math.abs((record.openTime ?? 0) - targetOpen) <= TIME_EPS)
  ));
  if (matched.length === 0) return null;
  const pnl = matched.reduce((sum, r) => sum + (r.pnl ?? 0), 0);
  const fee = matched.reduce((sum, r) => sum + (r.fee ?? 0), 0);
  const closeTime = matched.reduce((max, r) => Math.max(max, r.closeTime ?? 0), 0);
  // 最大数量那条作 primary，更可能是完整平仓的代表记录
  const primaryRecord = matched.reduce((best, r) => (
    (r.contracts ?? r.quantity) > (best.contracts ?? best.quantity) ? r : best
  ), matched[0]);
  return { records: matched, pnl, fee, netPnl: pnl, closeTime, primaryRecord };
}

/**
 * 跳转到「持仓过程 K 线回放」：找现有 journal → 没有就 backfill 一条最小 journal → navigate('/journal/:id')
 * 没登录或没匹配的 CLOSE 记录时给 toast，不跳。
 */
function useOpenPlaybackForSnapshot() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { tradeHistory } = useTradingContext();
  const [busyId, setBusyId] = useState<string | null>(null);

  const open = useCallback(async (event: ExecutionAssetEvent) => {
    if (!user) { toast.error('请先登录后查看 K 线回放'); return; }
    const matched = matchClosesForSnapshot(event.trade, tradeHistory);
    if (!matched) { toast.info('这笔还未平仓，无法查看完整持仓过程'); return; }
    setBusyId(event.id);
    try {
      const existing = await listJournalsByTradeRecordId(user.id, matched.primaryRecord.id);
      const journal = existing[0] ?? await backfillJournalFromRecord(matched.primaryRecord);
      nav(`/journal/${journal.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }, [nav, tradeHistory, user]);

  return { open, busyId };
}

function formatPnl(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}
function pnlClass(value: number) {
  return value > 0 ? 'text-[#0ECB81]' : value < 0 ? 'text-[#F6465D]' : 'text-muted-foreground';
}

function marginModeLabel(mode: string | null | undefined) {
  if (mode === 'isolated') return '逐仓';
  if (mode === 'cross') return '全仓';
  return mode || '—';
}

function orderTypeLabel(type: string | null | undefined) {
  if (!type) return '—';
  const map: Record<string, string> = {
    BEST: '最优价',
    MARKET: '市价',
    LIMIT: '限价',
    POST_ONLY: 'Post Only',
    CONDITIONAL: '条件单',
    LIMIT_TP_SL: '限价止盈止损',
    MARKET_TP_SL: '市价止盈止损',
    TRAILING_STOP: '跟踪委托',
    TWAP: 'TWAP',
    SCALED: '分段订单',
  };
  return map[type] ?? type;
}

const PANEL_COPY: Record<DetailPanelKey, { title: string; subtitle: string; empty: string }> = {
  decision: {
    title: '决策记录交易明细',
    subtitle: `通过决策记录模式完成的做多开仓，每笔 +${EXECUTION_DECISION_REWARD}（不按标的去重）。`,
    empty: '暂无决策记录交易。',
  },
  direct: {
    title: '直接交易明细',
    subtitle: `未经过快照流程的直接做多开仓，按当日标的去重，每个标的 -${EXECUTION_DIRECT_PENALTY}。`,
    empty: '暂无直接交易。',
  },
  penalty: {
    title: '未练习扣分日明细',
    subtitle: `自然日没有任何练习（下单 / 弃单 / 复盘）时，系统记录一次 -${EXECUTION_NO_TRADE_PENALTY}，永久不可逆。`,
    empty: '暂无未练习扣分日。',
  },
  campaign: {
    title: '创建交易战役明细',
    subtitle: `按“自然日 × 标的”计分：当天同一标的建一场或多场战役都只 +${EXECUTION_CAMPAIGN_REWARD}，并与未建战役扣分互斥。`,
    empty: '暂无创建的交易战役。',
  },
  review: {
    title: '平仓评价明细',
    subtitle: `每完成一笔平仓评价 +${EXECUTION_REVIEW_REWARD}；后续编辑不重复计分。`,
    empty: '暂无已完成的平仓评价。',
  },
  review_missing: {
    title: '未做平仓评价明细',
    subtitle: `只统计拥有真实操作时间的主力多单；每笔 -${EXECUTION_REVIEW_MISSING_PENALTY}，补做评价后自动撤销。`,
    empty: '暂无未做平仓评价的主力多单。',
  },
  share: {
    title: '决策记录占比明细',
    subtitle: '这里合并展示所有计分交易，用来观察可复盘样本占比。',
    empty: '暂无可计分交易。',
  },
};

function StatCard({
  active,
  icon,
  value,
  label,
  detail,
  tone,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  value: string;
  label: string;
  detail: ReactNode;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group rounded-xl border bg-background/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-sm',
        active ? 'border-[#F0B90B]/50 shadow-sm ring-1 ring-[#F0B90B]/20' : 'border-border/60',
      )}
      aria-expanded={active}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn('mb-3', tone)}>{icon}</div>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform group-hover:text-foreground',
            active && 'rotate-180 text-foreground',
          )}
        />
      </div>
      <div className="font-mono text-2xl">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-2 text-[11px]">{detail}</div>
      <div className="mt-3 text-[10px] text-muted-foreground/80">点击查看明细</div>
    </button>
  );
}

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/50 bg-background/60 px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-[12px] text-foreground">{value}</div>
    </div>
  );
}

function EventDetailCard({
  event, matched, busy, onOpen, campaignById,
}: {
  event: ExecutionAssetEvent;
  matched: MatchedClose | null;
  busy: boolean;
  onOpen: (e: ExecutionAssetEvent) => void;
  campaignById: Record<string, TradeCampaign>;
}) {
  const nav = useNavigate();
  const trade = event.trade;
  const isPenalty = event.type === 'no_trade_penalty';
  const isCampaign = event.type === 'campaign_reward';
  const isReview = event.type === 'review_reward';
  const isReviewMissing = event.type === 'review_missing_penalty';
  const canOpen = Boolean(trade) && matched != null;
  const operationTime = executionEventOperationTime(event, campaignById);
  const tradeSymbol = trade
    ? `${getSettlementAsset(trade.symbol)}/${quoteLabel(trade)}`
    : null;

  return (
    <div className="rounded-xl border border-border/60 bg-background/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">
              {tradeSymbol ?? event.reviewSymbol ?? (isPenalty ? '未练习扣分日' : event.label)}
            </span>
            {trade?.side && (
              <span
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                  trade.side === 'LONG'
                    ? 'border-[#0ECB81]/30 bg-[#0ECB81]/5 text-[#0ECB81]'
                    : 'border-[#F6465D]/30 bg-[#F6465D]/5 text-[#F6465D]',
                )}
              >
                {sideLabel(trade.side)}
              </span>
            )}
            <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${eventTone(event.type)}`}>
              {formatSigned(event.points)}
            </span>
            {trade && (
              <span className={cn(
                'rounded-full border px-2 py-0.5 font-mono text-[11px]',
                matched
                  ? `${pnlClass(matched.netPnl)} border-current/30 bg-current/5`
                  : 'border-border bg-muted text-muted-foreground',
              )}>
                {matched ? `${formatPnl(matched.netPnl)} USDT` : '持仓中'}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            奖励日期 {event.date}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 text-right text-[10px] text-muted-foreground">
          <div>
            <div>操作时间</div>
            <div className="mt-1 font-mono text-foreground">{formatTime(operationTime)}</div>
          </div>
          {trade && (
            <button
              type="button"
              onClick={() => onOpen(event)}
              disabled={!canOpen || busy}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                canOpen && !busy
                  ? 'border-[#F0B90B]/40 bg-[#F0B90B]/5 text-[#D89B00] hover:bg-[#F0B90B]/10'
                  : 'border-border bg-muted/40 text-muted-foreground cursor-not-allowed',
              )}
              title={canOpen ? '查看这笔的持仓过程 K 线回放' : '这笔还未平仓，无法查看完整持仓过程'}
            >
              {busy
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <LineChart className="h-3 w-3" />}
              K 线回放
            </button>
          )}
        </div>
      </div>

      {trade ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem label="模拟开仓时间" value={formatTime(trade.simulatedTime)} />
          <DetailItem label="订单类型" value={orderTypeLabel(trade.orderType)} />
          <DetailItem label="开仓价" value={formatNumber(trade.entryPrice, 6)} />
          {matched && <DetailItem label="平仓价（最末次）" value={formatNumber(matched.primaryRecord.exitPrice ?? null, 6)} />}
          <DetailItem label="数量" value={formatSnapshotQuantity(trade)} />
          <DetailItem label="杠杆" value={`${formatNumber(trade.leverage, 2)}x`} />
          <DetailItem label="保证金模式" value={marginModeLabel(trade.marginMode)} />
          <DetailItem label="保证金" value={formatSnapshotMargin(trade)} />
          <DetailItem label="名义价值" value={formatSnapshotNotional(trade)} />
          {matched && <DetailItem label="平仓时间" value={formatTime(matched.closeTime)} />}
          {matched && (
            <DetailItem
              label="累计盈亏"
              value={<span className={pnlClass(matched.netPnl)}>{formatPnl(matched.netPnl)} USDT</span>}
            />
          )}
          {trade.positionId && <DetailItem label="仓位 ID" value={trade.positionId} />}
        </div>
      ) : isPenalty ? (
        <div className="mt-4 rounded-lg border border-[#F6465D]/20 bg-[#F6465D]/5 px-3 py-2 text-[12px] text-muted-foreground">
          当日没有计分做多开仓，系统按自然日扣分。扣分日期：<span className="font-mono text-foreground">{event.date}</span>
        </div>
      ) : isCampaign ? (
        (() => {
          const camp = event.campaignId ? campaignById[event.campaignId] : null;
          if (!camp) {
            // 还没记 ID 的老事件，或战役已被删除 → 退回原来的笼统展示。
            return (
              <div className="mt-4 rounded-lg border border-[#5BA3FF]/20 bg-[#5BA3FF]/5 px-3 py-2 text-[12px] text-muted-foreground">
                创建一次交易战役 +{EXECUTION_CAMPAIGN_REWARD}。奖励日期：<span className="font-mono text-foreground">{event.date}</span>
                {event.campaignId ? '（战役已删除）' : ''}
              </div>
            );
          }
          return (
            <button
              type="button"
              onClick={() => nav(`/journal/campaigns/${camp.id}`)}
              className="mt-4 flex w-full items-center justify-between gap-3 rounded-lg border border-[#5BA3FF]/30 bg-[#5BA3FF]/5 px-3 py-2 text-left transition-colors hover:bg-[#5BA3FF]/10"
              title="点击查看这场战役"
            >
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium text-foreground">{camp.title || '未命名战役'}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                  <span>{camp.symbol}</span>
                  <span>建于 {formatTime(new Date(camp.opened_at).getTime())}</span>
                  <span className="truncate">ID {camp.id.slice(0, 8)}</span>
                  <span className="text-[#5BA3FF]">+{EXECUTION_CAMPAIGN_REWARD}</span>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-[#5BA3FF]" />
            </button>
          );
        })()
      ) : isReviewMissing ? (
        event.journalId ? (
          <button
            type="button"
            onClick={() => nav(`/journal/${event.journalId}`)}
            className="mt-4 flex w-full items-center justify-between gap-3 rounded-lg border border-[#F6465D]/25 bg-[#F6465D]/5 px-3 py-2 text-left transition-colors hover:bg-[#F6465D]/10"
            title="点击补做这笔平仓评价"
          >
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-foreground">
                {event.reviewSymbol || '主力多单'} · 未做平仓评价
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                操作于 {formatTime(operationTime)} · -{EXECUTION_REVIEW_MISSING_PENALTY}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#F6465D]" />
          </button>
        ) : (
          <div className="mt-4 rounded-lg border border-[#F6465D]/20 bg-[#F6465D]/5 px-3 py-2 text-[12px] text-muted-foreground">
            这笔历史主力多单尚未完成平仓评价。
          </div>
        )
      ) : isReview ? (
        event.journalId ? (
          <button
            type="button"
            onClick={() => nav(`/journal/${event.journalId}`)}
            className="mt-4 flex w-full items-center justify-between gap-3 rounded-lg border border-[#B080FF]/30 bg-[#B080FF]/5 px-3 py-2 text-left transition-colors hover:bg-[#B080FF]/10"
            title="点击查看这笔平仓评价"
          >
            <div>
              <div className="text-[12px] font-medium text-foreground">已完成平仓评价</div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                评价于 {formatTime(event.createdAt)} · +{EXECUTION_REVIEW_REWARD}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-[#B080FF]" />
          </button>
        ) : (
          <div className="mt-4 rounded-lg border border-[#B080FF]/20 bg-[#B080FF]/5 px-3 py-2 text-[12px] text-muted-foreground">
            完成一次平仓评价 +{EXECUTION_REVIEW_REWARD}。
          </div>
        )
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border/70 px-3 py-2 text-[12px] text-muted-foreground">
          这条早期流水只保留了日期、类型与积分；之后产生的交易会自动记录完整单据信息。
        </div>
      )}
    </div>
  );
}

function DetailPanel({
  panelKey, events, tradeHistory, busyId, onOpen, campaignById,
}: {
  panelKey: DetailPanelKey;
  events: ExecutionAssetEvent[];
  tradeHistory: TradeRecord[];
  busyId: string | null;
  onOpen: (e: ExecutionAssetEvent) => void;
  campaignById: Record<string, TradeCampaign>;
}) {
  const copy = PANEL_COPY[panelKey];
  const [operationSort, setOperationSort] = useState<'desc' | 'asc'>('desc');
  const displayedEvents = useMemo(() => {
    if (panelKey !== 'review_missing') return events;
    return [...events].sort((a, b) => {
      const difference = executionEventOperationTime(a, campaignById) - executionEventOperationTime(b, campaignById);
      return operationSort === 'asc' ? difference : -difference;
    });
  }, [campaignById, events, operationSort, panelKey]);
  const missingSymbolCount = useMemo(() => (
    panelKey === 'review_missing'
      ? new Set(events.map(event => event.reviewSymbol).filter(Boolean)).size
      : 0
  ), [events, panelKey]);

  return (
    <div className="border-t border-border/70 px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold">{copy.title}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {panelKey === 'review_missing' && (
            <button
              type="button"
              onClick={() => setOperationSort(current => current === 'desc' ? 'asc' : 'desc')}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              aria-label={`操作时间${operationSort === 'desc' ? '从新到旧' : '从旧到新'}排序；点击切换`}
            >
              <Clock className="h-3 w-3" />
              操作时间 {operationSort === 'desc' ? '↓' : '↑'}
            </button>
          )}
          <div className="rounded-full border border-border/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
            {panelKey === 'review_missing' ? `${missingSymbolCount} 标的 · ` : ''}{events.length} 条
          </div>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-[12px] text-muted-foreground">
          {copy.empty}
        </div>
      ) : (
        <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {displayedEvents.map(event => (
            <EventDetailCard
              key={event.id}
              event={event}
              matched={matchClosesForSnapshot(event.trade, tradeHistory)}
              busy={busyId === event.id}
              onOpen={onOpen}
              campaignById={campaignById}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExecutionAssetsPage() {
  const nav = useNavigate();
  const {
    executionAsset,
    tradeHistory,
    reconcileCampaignRewards,
    reconcilePostTradeReviewRewards,
    settleCampaignMissingPenalties,
    reconcileReviewMissingPenalties,
  } = useTradingContext();
  const { user } = useAuth();
  const { open: openPlayback, busyId } = useOpenPlaybackForSnapshot();
  const [openPanel, setOpenPanel] = useState<DetailPanelKey | null>(null);
  const [campaignById, setCampaignById] = useState<Record<string, TradeCampaign>>({});
  const todayKey = localDateKey();
  const tradedToday = Boolean(executionAsset.tradedDates?.[todayKey]);
  const totalTrades = executionTradeCount(executionAsset);
  const decisionShare = totalTrades > 0 ? (executionAsset.decisionTradeCount / totalTrades) * 100 : 0;

  // 进页面即对账：按真实战役 ID 和已完成评价的 journal ID 补齐漏记奖励；两类都幂等自愈。
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    listAllCampaigns(user.id)
      .then(campaigns => {
        if (cancelled) return;
        reconcileCampaignRewards(campaigns.map(c => ({ id: c.id, symbol: c.symbol, createdAt: c.created_at })));
        const campaignRefs = campaigns.map(c => ({ symbol: c.symbol, createdAt: c.created_at }));
        // 用权威战役列表结算「自然日 × 标的」建/未建战役互斥积分，并修复历史冲突。
        settleCampaignMissingPenalties(campaignRefs);
        // 留存战役以便「建战役」明细按 campaignId 显示标题/标的/时间并可点进。
        setCampaignById(Object.fromEntries(campaigns.map(c => [c.id, c])));
      })
      .catch(() => { /* 离线 / 无战役表时静默，不影响页面 */ });
    listJournals(user.id)
      .then(journals => {
        if (cancelled) return;
        reconcilePostTradeReviewRewards(
          journals
            .filter(journal => Boolean(journal.post_reviewed_at))
            .map(journal => ({ journalId: journal.id, reviewedAt: journal.post_reviewed_at })),
        );
        // 未做平仓评价 −1000（可翻转）：已平仓、有成交记录的主力单，未复盘挂罚、补做即翻回 +1000。
        reconcileReviewMissingPenalties(
          buildObjectiveLongMainReviewItems(journals, tradeHistory).map(item => ({
            journalId: item.journal.id,
            reviewed: item.reviewed,
            symbol: item.symbol,
            operationTime: item.operationTime,
          })),
        );
      })
      .catch(() => { /* 离线 / 无 journal 表时静默，不影响页面 */ });
    return () => { cancelled = true; };
  }, [user?.id, tradeHistory, reconcileCampaignRewards, reconcilePostTradeReviewRewards, settleCampaignMissingPenalties, reconcileReviewMissingPenalties]);

  const detailEvents = useMemo(() => {
    const events = executionAsset.events ?? [];
    const decision = events.filter(event => event.type === 'decision_reward');
    const direct = events.filter(event => event.type === 'direct_reward');
    return {
      decision,
      direct,
      penalty: events.filter(event => event.type === 'no_trade_penalty'),
      campaign: events.filter(event => event.type === 'campaign_reward'),
      review: events.filter(event => event.type === 'review_reward'),
      review_missing: events.filter(event => event.type === 'review_missing_penalty'),
      share: events.filter(event => event.type === 'decision_reward' || event.type === 'direct_reward'),
    };
  }, [executionAsset.events]);

  const recentEvents = useMemo(() => (
    (executionAsset.events ?? [])
      .map((event, index) => ({
        event,
        index,
        operationTime: executionEventOperationTime(event, campaignById),
      }))
      .sort((a, b) => b.operationTime - a.operationTime || a.index - b.index)
      .map(item => item.event)
  ), [executionAsset.events, campaignById]);

  const togglePanel = (panel: DetailPanelKey) => {
    setOpenPanel(current => (current === panel ? null : panel));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <button
            onClick={() => nav('/')}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            返回
          </button>
          <div className="text-right">
            <h1 className="text-[15px] font-semibold">执行力资产</h1>
            <p className="text-[11px] text-muted-foreground">重复次数的加速器：做，比想更贵重。</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <section className="rounded-2xl border border-border/70 bg-card shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
          <div className="grid gap-4 border-b border-border/70 p-5 md:grid-cols-[1.4fr_1fr]">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-3 py-1 text-[11px] font-medium text-[#D89B00]">
                <Zap className="h-3.5 w-3.5" />
                没去做带来的损失，必须被系统看见
              </div>
              <div className="font-mono text-5xl font-semibold tracking-tight text-foreground">
                {executionAsset.points.toLocaleString()}
              </div>
              <div className="mt-2 text-[12px] text-muted-foreground">当前执行力积分</div>
            </div>
            <div className="grid gap-2">
              <div className={`rounded-xl border px-3 py-3 ${tradedToday ? 'border-[#0ECB81]/25 bg-[#0ECB81]/5' : 'border-[#F6465D]/25 bg-[#F6465D]/5'}`}>
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <Activity className="h-4 w-4" />
                  今日状态
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  {tradedToday ? '今天已练习，已守住执行力日线。' : `今天还没练习；到明天仍未练习，将扣 ${EXECUTION_NO_TRADE_PENALTY} 分（下单 / 弃单 / 复盘任一即算练习）。`}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-3">
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <Gauge className="h-4 w-4" />
                  方向盘
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  决策交易 <span className="font-mono text-[#0ECB81]">+{EXECUTION_DECISION_REWARD}</span>，直接交易 <span className="font-mono text-[#F6465D]">−{EXECUTION_DIRECT_PENALTY}</span>：同额反号，慢想加分、乱下扣分。
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <StatCard
              active={openPanel === 'decision'}
              icon={<Trophy className="h-4 w-4" />}
              value={String(executionAsset.decisionTradeCount)}
              label="决策记录交易"
              tone="text-[#0ECB81]"
              detail={<span className="font-mono text-[#0ECB81]">每次 +{EXECUTION_DECISION_REWARD}</span>}
              onClick={() => togglePanel('decision')}
            />
            <StatCard
              active={openPanel === 'direct'}
              icon={<Zap className="h-4 w-4" />}
              value={String(executionAsset.directTradeCount)}
              label="直接交易"
              tone="text-[#F6465D]"
              detail={<span className="font-mono text-[#F6465D]">每标的 −{EXECUTION_DIRECT_PENALTY}</span>}
              onClick={() => togglePanel('direct')}
            />
            <StatCard
              active={openPanel === 'penalty'}
              icon={<CalendarMinus className="h-4 w-4" />}
              value={String(executionAsset.penaltyDays)}
              label="未练习扣分日"
              tone="text-[#F6465D]"
              detail={<span className="font-mono text-[#F6465D]">每天 -{EXECUTION_NO_TRADE_PENALTY}</span>}
              onClick={() => togglePanel('penalty')}
            />
            <StatCard
              active={openPanel === 'campaign'}
              icon={<Flag className="h-4 w-4" />}
              value={String(executionAsset.campaignCount)}
              label="建战役"
              tone="text-[#5BA3FF]"
              detail={<span className="font-mono text-[#5BA3FF]">每次 +{EXECUTION_CAMPAIGN_REWARD}</span>}
              onClick={() => togglePanel('campaign')}
            />
            <StatCard
              active={openPanel === 'review'}
              icon={<ClipboardCheck className="h-4 w-4" />}
              value={String(executionAsset.reviewCount ?? 0)}
              label="平仓评价"
              tone="text-[#B080FF]"
              detail={<span className="font-mono text-[#B080FF]">每次 +{EXECUTION_REVIEW_REWARD}</span>}
              onClick={() => togglePanel('review')}
            />
            <StatCard
              active={openPanel === 'review_missing'}
              icon={<ClipboardX className="h-4 w-4" />}
              value={String(detailEvents.review_missing.length)}
              label="未做评价"
              tone="text-[#F6465D]"
              detail={<span className="font-mono text-[#F6465D]">主力多单 -{EXECUTION_REVIEW_MISSING_PENALTY}</span>}
              onClick={() => togglePanel('review_missing')}
            />
            <StatCard
              active={openPanel === 'share'}
              icon={<ListChecks className="h-4 w-4" />}
              value={`${decisionShare.toFixed(0)}%`}
              label="决策记录占比"
              tone="text-muted-foreground"
              detail={<span className="text-muted-foreground">越高，样本越可复盘。</span>}
              onClick={() => togglePanel('share')}
            />
          </div>

          {openPanel && (
            <DetailPanel
              panelKey={openPanel}
              events={detailEvents[openPanel]}
              tradeHistory={tradeHistory}
              busyId={busyId}
              onOpen={openPlayback}
              campaignById={campaignById}
            />
          )}
        </section>

        <section className="mt-4 rounded-2xl border border-border/70 bg-card">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-[13px] font-semibold">积分规则</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              开仓只记做多，做空对冲不计分。直接交易按当日标的去重（同标的多笔只扣一次）。“建战役 / 未建战役”按自然日 × 标的互斥结算：同日同标的多场战役只奖励一次，先扣未建后补齐战役会自动撤罚并改为奖励。下单 / 弃单 / 复盘任一即算当天已练习；整日未练习扣分，且永久不可逆。平仓评价完成后独立奖励，重复编辑不重复计分。
            </p>
          </div>
          <div data-testid="execution-rule-grid" className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-[#B080FF]/25 bg-[#B080FF]/5 px-4 py-3">
              <div className="text-[12px] font-medium">完成平仓评价</div>
              <div className="mt-2 font-mono text-2xl text-[#B080FF]">+{EXECUTION_REVIEW_REWARD}</div>
            </div>
            <div className="rounded-xl border border-[#0ECB81]/25 bg-[#0ECB81]/5 px-4 py-3">
              <div className="text-[12px] font-medium">决策记录交易</div>
              <div className="mt-2 font-mono text-2xl text-[#0ECB81]">+{EXECUTION_DECISION_REWARD}</div>
            </div>
            <div className="rounded-xl border border-[#5BA3FF]/25 bg-[#5BA3FF]/5 px-4 py-3">
              <div className="text-[12px] font-medium">创建交易战役</div>
              <div className="mt-2 font-mono text-2xl text-[#5BA3FF]">+{EXECUTION_CAMPAIGN_REWARD}</div>
            </div>
            {/* 下排与上排逐列镜像（做 vs 不做，同额反号）：完成评价↔未做评价、决策↔直接、建战役↔未建战役。 */}
            <div className="rounded-xl border border-[#F6465D]/25 bg-[#F6465D]/5 px-4 py-3">
              <div className="text-[12px] font-medium">未做平仓评价</div>
              <div className="mt-2 font-mono text-2xl text-[#F6465D]">-{EXECUTION_REVIEW_MISSING_PENALTY}</div>
            </div>
            <div className="rounded-xl border border-[#F6465D]/25 bg-[#F6465D]/5 px-4 py-3">
              <div className="text-[12px] font-medium">直接交易（每标的）</div>
              <div className="mt-2 font-mono text-2xl text-[#F6465D]">-{EXECUTION_DIRECT_PENALTY}</div>
            </div>
            <div className="rounded-xl border border-[#D89B00]/25 bg-[#D89B00]/5 px-4 py-3">
              <div className="text-[12px] font-medium">标的未建战役（每标的）</div>
              <div className="mt-2 font-mono text-2xl text-[#D89B00]">-{EXECUTION_CAMPAIGN_MISSING_PENALTY}</div>
            </div>
            {/* 断更是头号大罪：无正向镜像、独占一行、最重且永久不可逆。 */}
            <div className="rounded-xl border border-[#F6465D]/40 bg-[#F6465D]/10 px-4 py-3 sm:col-span-2 lg:col-span-3">
              <div className="text-[12px] font-medium">自然日未练习</div>
              <div className="mt-2 font-mono text-2xl text-[#F6465D]">-{EXECUTION_NO_TRADE_PENALTY}</div>
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-border/70 bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
            <div>
              <h2 className="text-[13px] font-semibold">最近积分流水</h2>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                每条对应一次计分动作。交易奖励可查看 K 线回放，平仓评价奖励可进入对应复盘。
              </p>
            </div>
            <div className="rounded-full border border-border/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              共 {recentEvents.length} 条
            </div>
          </div>
          <div className="p-3">
            {recentEvents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-[12px] text-muted-foreground">
                还没有积分流水。下一次计分动作完成后，这里会出现第一条记录。
              </div>
            ) : (
              <ul data-testid="recent-execution-events" className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                {recentEvents.map(event => {
                  const matched = matchClosesForSnapshot(event.trade, tradeHistory);
                  const canOpen = Boolean(event.trade) && matched != null;
                  const canOpenReview = (event.type === 'review_reward' || event.type === 'review_missing_penalty') && Boolean(event.journalId);
                  const campaign = event.type === 'campaign_reward' && event.campaignId
                    ? campaignById[event.campaignId]
                    : null;
                  const canOpenCampaign = Boolean(campaign);
                  const canInteract = canOpen || canOpenReview || canOpenCampaign;
                  const busy = busyId === event.id;
                  const operationTime = executionEventOperationTime(event, campaignById);
                  return (
                    <li key={event.id} data-event-id={event.id} data-operation-time={operationTime}>
                      <button
                        type="button"
                        onClick={() => {
                          if (canOpen) openPlayback(event);
                          else if (canOpenReview && event.journalId) nav(`/journal/${event.journalId}`);
                          else if (canOpenCampaign && campaign) nav(`/journal/campaigns/${campaign.id}`);
                        }}
                        disabled={!canInteract || busy}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-xl border bg-background/70 px-4 py-3 text-left transition-colors',
                          canInteract && !busy
                            ? event.type === 'review_reward'
                              ? 'border-border/60 hover:border-[#B080FF]/40 hover:bg-[#B080FF]/[0.03]'
                              : event.type === 'campaign_reward'
                                ? 'border-border/60 hover:border-[#5BA3FF]/40 hover:bg-[#5BA3FF]/[0.03]'
                              : 'border-border/60 hover:border-[#F0B90B]/40 hover:bg-[#F0B90B]/[0.03]'
                            : 'border-border/60 cursor-not-allowed opacity-95',
                        )}
                        title={
                          canOpenReview ? '点击查看这笔平仓评价'
                          : canOpenCampaign ? '点击进入对应的交易战役'
                          : event.type === 'campaign_reward' && event.campaignId ? '对应战役已删除'
                          : event.type === 'campaign_reward' ? '正在匹配历史奖励对应的战役'
                          : !event.trade ? '此条无交易快照，无法查看回放'
                          : !matched ? '这笔还未平仓，无法查看完整持仓过程'
                          : '点击查看持仓过程 K 线回放'
                        }
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[12px] font-medium">
                              {event.trade?.symbol ?? event.reviewSymbol ?? event.label}
                            </span>
                            {event.trade?.side && (
                              <span className={cn(
                                'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                event.trade.side === 'LONG'
                                  ? 'bg-[#0ECB81]/10 text-[#0ECB81]'
                                  : 'bg-[#F6465D]/10 text-[#F6465D]',
                              )}>
                                {sideLabel(event.trade.side)}
                              </span>
                            )}
                            {event.trade && (
                              <span className={cn(
                                'rounded-full border px-2 py-0.5 font-mono text-[11px]',
                                matched
                                  ? `${pnlClass(matched.netPnl)} border-transparent bg-current/5`
                                  : 'border-border bg-muted text-muted-foreground',
                              )}>
                                {matched ? `${formatPnl(matched.netPnl)} USDT` : '持仓中'}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                            操作时间 {formatTime(operationTime)}
                            {event.trade?.simulatedTime ? ` · 盘面时间 ${formatTime(event.trade.simulatedTime)}` : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full border px-2.5 py-1 font-mono text-[12px] ${eventTone(event.type)}`}>
                            {formatSigned(event.points)}
                          </span>
                          {(event.trade || canOpenReview || canOpenCampaign) && (
                            <span className={cn(
                              'inline-flex h-7 w-7 items-center justify-center rounded-md',
                              canInteract && !busy
                                ? event.type === 'review_reward'
                                  ? 'text-[#B080FF]'
                                  : event.type === 'campaign_reward'
                                    ? 'text-[#5BA3FF]'
                                    : 'text-[#D89B00]'
                                : 'text-muted-foreground/40',
                            )}>
                              {busy
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <ChevronRight className="h-3.5 w-3.5" />}
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
