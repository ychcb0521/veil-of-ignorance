import { type ReactNode, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Activity,
  CalendarMinus,
  ChevronDown,
  Clock,
  Gauge,
  ListChecks,
  Trophy,
  Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTradingContext } from '@/contexts/TradingContext';
import {
  EXECUTION_DECISION_REWARD,
  EXECUTION_DIRECT_REWARD,
  EXECUTION_NO_TRADE_PENALTY,
  executionTradeCount,
  localDateKey,
  type ExecutionAssetEvent,
} from '@/lib/executionAssets';
import { formatUTC8 } from '@/lib/timeFormat';
import { cn } from '@/lib/utils';

type DetailPanelKey = 'decision' | 'direct' | 'penalty' | 'share';

function formatSigned(points: number) {
  return `${points >= 0 ? '+' : ''}${points.toLocaleString()}`;
}

function eventTone(type: string) {
  if (type === 'decision_reward') return 'text-[#0ECB81] border-[#0ECB81]/25 bg-[#0ECB81]/5';
  if (type === 'direct_reward') return 'text-[#F0B90B] border-[#F0B90B]/25 bg-[#F0B90B]/5';
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

function sideLabel(side: string | null | undefined) {
  if (side === 'LONG') return '多';
  if (side === 'SHORT') return '空';
  return side || '—';
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
    subtitle: '通过决策记录模式完成的做多开仓，每笔 +999。',
    empty: '暂无决策记录交易。',
  },
  direct: {
    title: '直接交易明细',
    subtitle: '未经过快照流程的直接做多开仓，每笔 +99。',
    empty: '暂无直接交易。',
  },
  penalty: {
    title: '未交易扣分日明细',
    subtitle: '自然日没有计分做多开仓时，系统记录一次 -500。',
    empty: '暂无未交易扣分日。',
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

function EventDetailCard({ event }: { event: ExecutionAssetEvent }) {
  const trade = event.trade;
  const isPenalty = event.type === 'no_trade_penalty';

  return (
    <div className="rounded-xl border border-border/60 bg-background/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">
              {trade?.symbol ?? (isPenalty ? '未交易扣分日' : event.label)}
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
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            奖励日期 {event.date}
          </div>
        </div>
        <div className="text-right text-[10px] text-muted-foreground">
          <div>记录时间</div>
          <div className="mt-1 font-mono text-foreground">{formatTime(event.createdAt)}</div>
        </div>
      </div>

      {trade ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <DetailItem label="模拟开仓时间" value={formatTime(trade.simulatedTime)} />
          <DetailItem label="订单类型" value={orderTypeLabel(trade.orderType)} />
          <DetailItem label="开仓价" value={formatNumber(trade.entryPrice, 6)} />
          <DetailItem label="数量" value={formatNumber(trade.quantity, 6)} />
          <DetailItem label="杠杆" value={`${formatNumber(trade.leverage, 2)}x`} />
          <DetailItem label="保证金模式" value={marginModeLabel(trade.marginMode)} />
          <DetailItem label="保证金" value={`${formatNumber(trade.margin, 2)} USDT`} />
          <DetailItem label="名义价值" value={`${formatNumber(trade.notional, 2)} USDT`} />
          {trade.positionId && <DetailItem label="仓位 ID" value={trade.positionId} />}
        </div>
      ) : isPenalty ? (
        <div className="mt-4 rounded-lg border border-[#F6465D]/20 bg-[#F6465D]/5 px-3 py-2 text-[12px] text-muted-foreground">
          当日没有计分做多开仓，系统按自然日扣分。扣分日期：<span className="font-mono text-foreground">{event.date}</span>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border/70 px-3 py-2 text-[12px] text-muted-foreground">
          这条早期流水只保留了日期、类型与积分；之后产生的交易会自动记录完整单据信息。
        </div>
      )}
    </div>
  );
}

function DetailPanel({ panelKey, events }: { panelKey: DetailPanelKey; events: ExecutionAssetEvent[] }) {
  const copy = PANEL_COPY[panelKey];

  return (
    <div className="border-t border-border/70 px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold">{copy.title}</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="rounded-full border border-border/60 px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
          {events.length} 条
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-[12px] text-muted-foreground">
          {copy.empty}
        </div>
      ) : (
        <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {events.map(event => (
            <EventDetailCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExecutionAssetsPage() {
  const nav = useNavigate();
  const { executionAsset } = useTradingContext();
  const [openPanel, setOpenPanel] = useState<DetailPanelKey | null>(null);
  const todayKey = localDateKey();
  const tradedToday = Boolean(executionAsset.tradedDates?.[todayKey]);
  const totalTrades = executionTradeCount(executionAsset);
  const decisionShare = totalTrades > 0 ? (executionAsset.decisionTradeCount / totalTrades) * 100 : 0;

  const detailEvents = useMemo(() => {
    const events = executionAsset.events ?? [];
    const decision = events.filter(event => event.type === 'decision_reward');
    const direct = events.filter(event => event.type === 'direct_reward');
    return {
      decision,
      direct,
      penalty: events.filter(event => event.type === 'no_trade_penalty'),
      share: events.filter(event => event.type === 'decision_reward' || event.type === 'direct_reward'),
    };
  }, [executionAsset.events]);

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
                  {tradedToday ? '今天已有交易，已守住执行力日线。' : `今天还没有交易；到明天仍未交易，将扣 ${EXECUTION_NO_TRADE_PENALTY} 分。`}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-3">
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <Gauge className="h-4 w-4" />
                  加速器
                </div>
                <div className="mt-1 text-[12px] text-muted-foreground">
                  决策记录交易是直接交易的 <span className="font-mono text-foreground">10.1x</span> 权重。
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 p-5 md:grid-cols-4">
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
              tone="text-[#F0B90B]"
              detail={<span className="font-mono text-[#F0B90B]">每次 +{EXECUTION_DIRECT_REWARD}</span>}
              onClick={() => togglePanel('direct')}
            />
            <StatCard
              active={openPanel === 'penalty'}
              icon={<CalendarMinus className="h-4 w-4" />}
              value={String(executionAsset.penaltyDays)}
              label="未交易扣分日"
              tone="text-[#F6465D]"
              detail={<span className="font-mono text-[#F6465D]">每天 -{EXECUTION_NO_TRADE_PENALTY}</span>}
              onClick={() => togglePanel('penalty')}
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

          {openPanel && <DetailPanel panelKey={openPanel} events={detailEvents[openPanel]} />}
        </section>

        <section className="mt-4 rounded-2xl border border-border/70 bg-card">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-[13px] font-semibold">积分规则</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">只记做多开仓；做空都是辅助对冲单，不计分。挂单在真正成交时才计分。</p>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-3">
            <div className="rounded-xl border border-[#0ECB81]/25 bg-[#0ECB81]/5 px-4 py-3">
              <div className="text-[12px] font-medium">决策记录模块交易</div>
              <div className="mt-2 font-mono text-2xl text-[#0ECB81]">+999</div>
            </div>
            <div className="rounded-xl border border-[#F0B90B]/25 bg-[#F0B90B]/5 px-4 py-3">
              <div className="text-[12px] font-medium">直接交易</div>
              <div className="mt-2 font-mono text-2xl text-[#D89B00]">+99</div>
            </div>
            <div className="rounded-xl border border-[#F6465D]/25 bg-[#F6465D]/5 px-4 py-3">
              <div className="text-[12px] font-medium">自然日未交易</div>
              <div className="mt-2 font-mono text-2xl text-[#F6465D]">-500</div>
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-border/70 bg-card">
          <div className="border-b border-border/70 px-5 py-4">
            <h2 className="text-[13px] font-semibold">最近积分流水</h2>
          </div>
          <div className="p-3">
            {executionAsset.events.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-[12px] text-muted-foreground">
                还没有积分流水。下一次真实开仓后，这里会出现第一条记录。
              </div>
            ) : (
              <div className="space-y-2">
                {executionAsset.events.slice(0, 12).map(event => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/70 px-4 py-3"
                  >
                    <div>
                      <div className="text-[12px] font-medium">{event.trade?.symbol ?? event.label}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                        {event.date}
                        {event.trade?.simulatedTime ? ` · ${formatTime(event.trade.simulatedTime)}` : ''}
                      </div>
                    </div>
                    <div className={`rounded-full border px-2.5 py-1 font-mono text-[12px] ${eventTone(event.type)}`}>
                      {formatSigned(event.points)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
