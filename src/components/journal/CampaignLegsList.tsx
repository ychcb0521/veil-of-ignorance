import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crosshair, ExternalLink, EyeOff, Unlink } from 'lucide-react';
import { LegRoleChip } from '@/components/journal/LegRoleChip';
import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { HEDGE_TYPE_LABELS } from '@/lib/hedgeTypes';
import { buildTradeRecordLookup, journalOperationTime } from '@/lib/objectiveOperationTime';
import { buildCampaignReverseOrderLegMap } from '@/lib/campaignReverseOrderAttribution';
import { buildMainLegOrdinals } from '@/lib/campaignMainLegOrdinals';
import { resolveMirrorTpOrderTiming } from '@/lib/campaignMirrorTpOrderTiming';
import type { CampaignEvent, TradeJournal } from '@/types/journal';
import { computeLegPnlContributions, sumLegPnl } from '@/lib/campaignLegPnl';
import { computeCampaignRealizedPnl } from '@/lib/campaignRealizedPnl';
import { legDeltaB, splitMainLegPhases, type MainLegPhase } from '@/lib/campaignLegPhases';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

interface Props {
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  campaignEvents?: CampaignEvent[];
  legExitPriceCorrections?: LegExitPriceCorrections;
  reverseHedgeOrders?: CampaignReverseHedgeOrder[];
  highlightedLegIds?: string[];
  onToggleHighlight?: (leg: TradeJournal) => void;
  onHideReverseHedgeOrder?: (order: CampaignReverseHedgeOrder) => void;
  onDetach?: (leg: TradeJournal) => void;
  /** 战役的初始最大预期亏损 L（USDT）；Δb 列 = 各腿盈亏 ÷ L。缺失时 Δb 显示「—」。 */
  initialExpectedMaxLoss?: number | null;
}

/** 盈亏取自哪一层数据。写在合计行旁边，让用户知道这个数有多硬。 */
function settlementBasisLabel(basis: string): string {
  if (basis === 'records') return '取自成交记录';
  if (basis === 'mixed') return '成交记录 + 复盘快照';
  if (basis === 'leg_snapshots') return '取自复盘快照';
  if (basis === 'events') return '取自战役事件';
  if (basis === 'campaign_summary') return '取自落库缓存';
  return '未结算';
}

function statusForLeg(leg: TradeJournal, record: TradeRecord | null) {
  if (record) return { label: '已平仓', className: 'text-[#0ECB81]' };
  if (leg.post_simulated_close_time || leg.post_real_close_time || leg.post_outcome) return { label: '已平仓', className: 'text-[#0ECB81]' };
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

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toPrecision(6);
}

/**
 * Legs 表的列宽 —— 表头与数据行共用同一个常量。
 *
 * 这里曾经把表头和行各写一份，加列时只改了表头，行少一列，
 * 最后一列「操作」被挤进隐式新行、整张表错位。共用一份后物理上不可能再失配。
 *
 * 时间列用 minmax(200px, 1fr) 而不是裸 1fr：裸 1fr 在容器被压窄时会缩到
 * 放不下「操作 2026-08-21 11:03」，导致文字逐字竖排。
 */
const LEGS_GRID = 'grid-cols-[44px_112px_minmax(200px,1fr)_100px_100px_104px_84px_132px_88px_236px_136px]';

/** 各列合计的下限，与 LEGS_GRID 对应；不足时容器横向滚动而不是压扁列。 */
const LEGS_MIN_WIDTH = 'min-w-[1476px]';

export function CampaignLegsList({
  legs,
  tradeRecords,
  campaignEvents = [],
  legExitPriceCorrections = {},
  reverseHedgeOrders = [],
  highlightedLegIds = [],
  onToggleHighlight,
  onHideReverseHedgeOrder,
  onDetach,
  initialExpectedMaxLoss = null,
}: Props) {
  const nav = useNavigate();
  const recordMap = useMemo(() => buildTradeRecordLookup(tradeRecords), [tradeRecords]);
  const highlightedSet = useMemo(() => new Set(highlightedLegIds), [highlightedLegIds]);
  // 每条腿的已实现盈亏与对全场的贡献率。必须整体算——贡献率的分母依赖全部腿。
  // 盈亏取值走全局唯一真源，Legs 表不再自己算一套——
  // 曾经这里用「一条腿一条成交」而战役总额用「一个仓位的每一刀」，同一场战役于是两个数。
  const settlement = useMemo(
    () => computeCampaignRealizedPnl(
      { final_realized_pnl: null, actual_evolution: campaignEvents },
      legs,
      tradeRecords,
      legExitPriceCorrections,
    ),
    [campaignEvents, legs, tradeRecords, legExitPriceCorrections],
  );
  const legPnlMap = useMemo(
    () => computeLegPnlContributions(legs, leg => settlement.byLeg.get(leg.id) ?? null),
    [legs, settlement],
  );
  // 主力腿的阶段拆解：每一次滚动对冲的结束把主力切成一段。
  // 边界价取对冲的平仓价（resolveLegExecution 同源，含平仓价校正）。
  const mainPhasesMap = useMemo(() => {
    const hedgeBoundaries = legs
      .filter(l => l.order_kind === 'hedge' || (l.leg_role ?? '').startsWith('hedge_') || l.leg_role === 'reentry_hedge')
      .map(l => {
        const rec = l.trade_record_id ? recordMap.get(l.trade_record_id) ?? null : null;
        const exec = resolveLegExecution(l, rec, legExitPriceCorrections);
        return { legId: l.id, closeTime: exec.closeTime ?? null, closePrice: exec.exitPrice ?? null };
      });
    const map = new Map<string, MainLegPhase[]>();
    for (const leg of legs) {
      if (leg.leg_role !== 'main_open' && leg.leg_role !== 'reentry_main') continue;
      const rec = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
      const exec = resolveLegExecution(leg, rec, legExitPriceCorrections);
      const pnl = settlement.byLeg.get(leg.id) ?? null;
      if (pnl == null || exec.entryPrice == null || exec.exitPrice == null) continue;
      const phases = splitMainLegPhases({
        pnl,
        entryPrice: exec.entryPrice,
        exitPrice: exec.exitPrice,
        openTime: exec.openTime ?? null,
        closeTime: exec.closeTime ?? null,
        side: leg.direction === 'short' ? 'short' : 'long',
        hedges: hedgeBoundaries,
      });
      // 只有真被切开（≥2 段）才展示子行；单段就是整腿自身，无需重复
      if (phases.length >= 2) map.set(leg.id, phases);
    }
    return map;
  }, [legs, recordMap, legExitPriceCorrections]);

  const totalPnl = useMemo(() => (settlement.total ?? null), [settlement]);
  const totalDeltaB = useMemo(
    () => (totalPnl == null ? null : legDeltaB(totalPnl, initialExpectedMaxLoss)),
    [totalPnl, initialExpectedMaxLoss],
  );
  // 贡献率分母（与 legPnlMap 同口径），供阶段子行使用：
  // 阶段是主力贡献的细分，用同一分母，Σ阶段贡献 = 主力贡献，不双计。
  const contributionDenominator = useMemo(() => {
    let sum = 0;
    for (const entry of legPnlMap.values()) {
      if (entry.pnl != null) sum += Math.abs(entry.pnl);
    }
    return sum;
  }, [legPnlMap]);

  // 两笔及以上主力时给它们编号——归类按时间走，界面上得能一眼核对归对没有。
  const mainLegOrdinals = useMemo(() => buildMainLegOrdinals(legs), [legs]);

  const reverseOrderLegMap = useMemo(
    () => buildCampaignReverseOrderLegMap(legs, reverseHedgeOrders, {
      // 与这一行渲染的「开 / 平」严格同源。若归类用一套时间、显示用另一套，
      // 就会出现「委 01:00 挂在一行标着 平 23:53 的腿上」——同一类错配换个位置再来一次。
      legWindow: (leg) => {
        const rec = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
        const exec = resolveLegExecution(leg, rec, legExitPriceCorrections);
        return { openMs: exec.openTime ?? null, closeMs: exec.closeTime ?? null };
      },
    }),
    [legs, reverseHedgeOrders, recordMap, legExitPriceCorrections],
  );

  return (
    <div className="bg-card border border-border rounded overflow-hidden">
      <div className="overflow-x-auto">
        <div className={LEGS_MIN_WIDTH}>
          <div className={`grid ${LEGS_GRID} gap-x-3 text-[10px] font-medium text-muted-foreground bg-muted/40 py-2 px-3`}>
            <div>#</div>
            <div>角色</div>
            <div>时间</div>
            <div className="text-right">开仓价</div>
            <div className="text-right">平仓价</div>
            <div className="text-right" title="上行：名义仓位（USD）；下行：按开仓价折算的币量，即加仓公式里的 X">仓位 / 币量</div>
            <div>状态</div>
            <div className="text-right">盈亏 / 贡献</div>
            <div className="text-right" title="该腿盈亏 ÷ 初始最大预期亏损 L：这条腿把整场 b 推高 / 拉低了多少">Δb</div>
            <div>委托</div>
            <div className="text-right">操作</div>
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {legs.map(leg => {
              const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
              const execution = resolveLegExecution(leg, record, legExitPriceCorrections);
              const status = statusForLeg(leg, record);
              const highlighted = highlightedSet.has(leg.id);
              const openLabel = fmtClock(execution.openTime ?? leg.pre_simulated_time);
              const closeLabel = fmtClock(execution.closeTime);
              const operationLabel = fmtClock(journalOperationTime(leg, record));
              const entryPriceValue = execution.entryPrice;
              // 币量 = 名义 ÷ 开仓价。名义为 0 或价格缺失时不猜，显示空。
              const legCoinQty = leg.pre_position_size != null && entryPriceValue != null && entryPriceValue > 0
                ? leg.pre_position_size / entryPriceValue
                : null;
              const exitPriceValue = execution.exitPrice;
              const exitCorrectionTitle = execution.exitCorrection
                ? `原 TradeRecord 平仓价 ${fmtPrice(execution.exitCorrection.originalExitPrice)} 超出该平仓时刻 1m K 线范围 ${fmtPrice(execution.exitCorrection.candleLow)}-${fmtPrice(execution.exitCorrection.candleHigh)}，本页按 K 线时价显示。`
                : undefined;
              const reverseOrdersForLeg = reverseHedgeOrders.filter(order => reverseOrderLegMap.get(order.id) === leg.id);
              const mirrorTpTiming = resolveMirrorTpOrderTiming(leg, record, campaignEvents);
              const hedgeSummary = leg.order_kind === 'hedge' && leg.hedge_type
                ? `${HEDGE_TYPE_LABELS[leg.hedge_type]}${leg.hedge_necessity_pct != null ? ` · ${leg.hedge_necessity_pct.toFixed(0)}%` : ''}`
                : null;
              const phases = mainPhasesMap.get(leg.id) ?? null;
              return (
                <div key={leg.id}>
                <div
                  className={`grid ${LEGS_GRID} gap-x-3 items-start text-[11px] font-mono py-2.5 px-3 border-b border-border/40 hover:bg-accent transition-colors ${
                    highlighted ? 'bg-[#002FA7]/5 ring-1 ring-inset ring-[#002FA7]/12' : ''
                  }`}
                >
                  <div>{leg.leg_sequence ?? '—'}</div>
                  <div className="flex items-center gap-1.5">
                    {leg.leg_role
                      ? <LegRoleChip role={leg.leg_role} ordinal={mainLegOrdinals.get(leg.id) ?? null} />
                      : '—'}
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
                  <div className="text-right tabular-nums">{fmtPrice(entryPriceValue)}</div>
                  <div className="text-right tabular-nums" title={exitCorrectionTitle}>{fmtPrice(exitPriceValue)}</div>
                  {/* 仓位是名义 USD；下面补按开仓价折算的币量——它就是加仓公式里的 X。
                      反向合约的面值锁在 USD 上，光看名义看不出这条腿拿着多少币。 */}
                  <div className="text-right tabular-nums leading-tight">
                    <div>{leg.pre_position_size != null ? leg.pre_position_size.toFixed(2) : '—'}</div>
                    {legCoinQty != null && (
                      <div
                        className="text-[10px] text-muted-foreground"
                        title={`按开仓价折算的币量：${leg.pre_position_size?.toFixed(2)} ÷ ${fmtPrice(entryPriceValue)} = ${legCoinQty.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
                      >
                        {legCoinQty.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </div>
                    )}
                  </div>
                  <div className={status.className}>{status.label}</div>
                  {(() => {
                    const entry = legPnlMap.get(leg.id);
                    const pnl = entry?.pnl ?? null;
                    if (pnl == null) {
                      // 未平仓 / 无数据：显示「—」而不是 0——0 会被读成「打平」
                      return <div className="text-right text-muted-foreground">—</div>;
                    }
                    const positive = pnl > 0;
                    const contribution = entry?.contribution ?? null;
                    return (
                      <div
                        data-testid={`leg-pnl-${leg.id}`}
                        title="该腿的已实现盈亏，以及它在本场各腿盈亏绝对值之和里所占的份额"
                        className="text-right leading-tight"
                      >
                        <div
                          className={`font-mono tabular-nums ${
                            pnl === 0 ? 'text-muted-foreground' : positive ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                          }`}
                        >
                          {positive ? '+' : ''}{pnl.toFixed(2)}
                        </div>
                        <div className="text-[9px] tabular-nums text-muted-foreground">
                          {contribution == null
                            ? '—'
                            : `${contribution > 0 ? '+' : ''}${(contribution * 100).toFixed(1)}%`}
                        </div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const pnl = legPnlMap.get(leg.id)?.pnl ?? null;
                    const delta = legDeltaB(pnl, initialExpectedMaxLoss);
                    if (delta == null) return <div className="text-right text-muted-foreground">—</div>;
                    return (
                      <div
                        data-testid={`leg-delta-b-${leg.id}`}
                        title="该腿盈亏 ÷ 初始最大预期亏损 L —— 这条腿把整场 b 推高 / 拉低了多少个单位"
                        className={`text-right tabular-nums ${
                          delta === 0 ? 'text-muted-foreground' : delta > 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                        }`}
                      >
                        {delta > 0 ? '+' : ''}{delta.toFixed(2)}
                      </div>
                    );
                  })()}
                  {/* 委托列：多条卡片会把行撑得很高。限高 + 内部滚动，
                      让各行高度趋于一致，同时一条委托都不丢。 */}
                  <div className="max-h-[132px] space-y-1 overflow-y-auto pr-1 font-sans">
                    {mirrorTpTiming && (
                      <div className="rounded border border-[#F0B90B]/25 bg-[#F0B90B]/5 px-2 py-1 leading-tight">
                        <div className="text-[10px] font-medium text-[#D89B00]">镜像止盈</div>
                        <div className="text-[10px] text-muted-foreground">委 {fmtClock(mirrorTpTiming.placedAt)}</div>
                        <div className="text-[10px] text-muted-foreground">触 {fmtClock(mirrorTpTiming.triggeredAt)}</div>
                      </div>
                    )}
                    {reverseOrdersForLeg.length === 0 && !mirrorTpTiming ? (
                      <span className="font-mono text-muted-foreground">—</span>
                    ) : (
                      reverseOrdersForLeg.map(order => (
                        <div
                          key={order.id}
                          className="group rounded border border-border/50 bg-muted/30 px-2 py-1 leading-tight"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={order.side === 'SHORT' ? 'text-[#6D28D9]' : 'text-[#002FA7]'}>
                              {order.side === 'SHORT' ? '空' : '多'} {fmtPrice(order.price)}
                            </span>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-muted-foreground">
                                {order.status === 'pending'
                                  ? '挂单中'
                                  : order.status === 'triggered'
                                    ? '已触发'
                                    : '已撤'}
                              </span>
                              {onHideReverseHedgeOrder && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onHideReverseHedgeOrder(order);
                                  }}
                                  title="从盘面隐藏这条委托空单"
                                  aria-label="从盘面隐藏这条委托空单"
                                  className="inline-flex items-center text-muted-foreground/25 opacity-0 transition-opacity hover:text-[#F6465D] group-hover:opacity-100"
                                >
                                  <EyeOff className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="text-[10px] text-muted-foreground">委 {fmtClock(order.createdAt)}</div>
                          {order.status === 'triggered' && (
                            <div className="text-[10px] text-muted-foreground">触 {fmtClock(order.triggeredAt)}</div>
                          )}
                          <div className="text-[10px] text-muted-foreground">
                            {order.cancelledAt ? `${order.status === 'triggered' ? '平' : '撤'} ${fmtClock(order.cancelledAt)}` : `${order.status === 'triggered' ? '平' : '撤'} —`}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                  {/* 操作列：等宽图标按钮，文字进 tooltip。
                      三个中文按钮横排放不进窄列，会逐字竖排并把整行撑歪。 */}
                  <div className="flex items-center justify-end gap-0.5 font-sans">
                    {onToggleHighlight && (
                      <button
                        type="button"
                        onClick={() => onToggleHighlight(leg)}
                        title={highlighted ? '已标注到盘面，点击取消' : '标到盘面'}
                        aria-label={highlighted ? '取消盘面标注' : '标到盘面'}
                        aria-pressed={highlighted}
                        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${
                          highlighted
                            ? 'bg-[#002FA7]/10 text-[#002FA7] hover:bg-[#002FA7]/15'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <Crosshair className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={!leg.id}
                      onClick={() => nav(`/journal/${leg.id}`)}
                      title="查看复盘"
                      aria-label="查看复盘"
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    {onDetach && (
                      <button
                        type="button"
                        onClick={() => onDetach(leg)}
                        title="从本战役解除该腿"
                        aria-label="解除"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#F6465D]"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* 主力阶段拆解：每一次滚动对冲的结束 = 主力一个阶段的完成。
                    子行缩进浅色呈现，Σ阶段盈亏 === 主力整腿盈亏（分摊守恒）。 */}
                {phases && (
                  <div data-testid={`leg-phases-${leg.id}`} className="border-b border-border/40 bg-muted/20">
                    {phases.map(phase => {
                      const phaseDelta = legDeltaB(phase.pnl, initialExpectedMaxLoss);
                      const phaseContribution = contributionDenominator > 0 ? phase.pnl / contributionDenominator : null;
                      const positive = phase.pnl > 0;
                      return (
                        <div
                          key={phase.index}
                          className={`grid ${LEGS_GRID} gap-x-3 items-center py-1 px-3 text-[10px] font-mono text-muted-foreground`}
                        >
                          <div />
                          <div className="pl-3 font-sans text-[9px]">
                            阶段 {phase.index}
                            {phase.boundaryLegId == null && <span className="text-muted-foreground/60"> · 收尾</span>}
                          </div>
                          <div className="tabular-nums">
                            {fmtClock(phase.startTime)} → {fmtClock(phase.endTime)}
                            {phase.boundaryLegId != null && (
                              <span className="ml-1 font-sans text-[9px] text-[#6D28D9]/80">对冲结束切段</span>
                            )}
                          </div>
                          <div className="text-right tabular-nums">{fmtPrice(phase.startPrice)}</div>
                          <div className="text-right tabular-nums">{fmtPrice(phase.endPrice)}</div>
                          <div />
                          <div />
                          <div className="text-right leading-tight">
                            <div className={`tabular-nums ${phase.pnl === 0 ? '' : positive ? 'text-[#0ECB81]/90' : 'text-[#F6465D]/90'}`}>
                              {positive ? '+' : ''}{phase.pnl.toFixed(2)}
                            </div>
                            <div className="text-[9px] tabular-nums text-muted-foreground/70">
                              {phaseContribution == null ? '—' : `${phaseContribution > 0 ? '+' : ''}${(phaseContribution * 100).toFixed(1)}%`}
                            </div>
                          </div>
                          <div className={`text-right tabular-nums ${phaseDelta == null ? '' : phaseDelta > 0 ? 'text-[#0ECB81]/90' : phaseDelta < 0 ? 'text-[#F6465D]/90' : ''}`}>
                            {phaseDelta == null ? '—' : `${phaseDelta > 0 ? '+' : ''}${phaseDelta.toFixed(2)}`}
                          </div>
                          <div />
                          <div />
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
              );
            })}
            {/* 合计行：按构造恒等于盈亏概览的「已实现 P&L」。
                历史上两处各算各的、谁也不显示合计，用户只能手加三个数才发现对不上；
                把这一行画出来，界面本身就是一道持续生效的断言。 */}
            <div
              data-testid="legs-total-row"
              className={`grid ${LEGS_GRID} items-center gap-x-3 border-t-2 border-border px-3 py-2 text-[11px] font-medium`}
            >
              <div />
              <div className="text-muted-foreground">合计</div>
              <div className="text-[10px] text-muted-foreground">{settlementBasisLabel(settlement.basis)}</div>
              <div /><div /><div /><div />
              <div className={`text-right tabular-nums ${totalPnl == null ? 'text-muted-foreground' : totalPnl > 0 ? 'text-[#0ECB81]' : totalPnl < 0 ? 'text-[#F6465D]' : ''}`}>
                {totalPnl == null ? '—' : `${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)}`}
              </div>
              <div className={`text-right tabular-nums ${totalDeltaB == null ? 'text-muted-foreground' : totalDeltaB > 0 ? 'text-[#0ECB81]' : totalDeltaB < 0 ? 'text-[#F6465D]' : ''}`}>
                {totalDeltaB == null ? '—' : `${totalDeltaB > 0 ? '+' : ''}${totalDeltaB.toFixed(2)}`}
              </div>
              <div /><div />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
