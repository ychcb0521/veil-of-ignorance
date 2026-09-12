import { useMemo } from 'react';
import { Crosshair, EyeOff, Unlink } from 'lucide-react';
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
import { describeTradeRecordFees, formatFeeCoin, sumTradeRecordFees, tradeRecordFees } from '@/lib/tradeFees';
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

/** closed 是常态：状态不再占一列，只有**不是**已平仓时才在角色旁标一枚小标签。 */
function statusForLeg(leg: TradeJournal, record: TradeRecord | null) {
  if (record) return { label: '已平仓', className: 'text-[#0ECB81]', closed: true };
  if (leg.post_simulated_close_time || leg.post_real_close_time || leg.post_outcome) {
    return { label: '已平仓', className: 'text-[#0ECB81]', closed: true };
  }
  if (leg.leg_role === 'mirror_tp' || leg.leg_role?.startsWith('hedge_')) {
    return { label: '挂单中', className: 'text-[#F0B90B]', closed: false };
  }
  return { label: '进行中', className: 'text-muted-foreground', closed: false };
}

function fmtClock(value: number | string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 委托卡片里的时刻：同一天只写 HH:mm，跨天才补 MM-DD。
 * 卡片里原本三行各印一遍完整日期（年份也在），一张卡四行高，三张就把行撑破、
 * 还要靠内部滚动切成半张。行头已经写着这条腿的开平日期，卡片只需要说"几点"。
 */
function fmtCardTime(value: number | null | undefined, sameDayAs?: number | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (sameDayAs) {
    const ref = new Date(sameDayAs);
    if (!Number.isNaN(ref.getTime()) && ref.toDateString() === date.toDateString()) return hm;
  }
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`;
}

function fmtPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toPrecision(6);
}

/**
 * Legs 表的列宽 —— 表头与数据行共用同一个常量。
 *
 * 弹性那一格给**委托**，不给时间。时间列的内容是定宽的（「开 2025-09-19 22:42」），
 * 让它吃掉所有富余宽度，富余就会变成表格中段一片空洞，而右侧的委托卡片反倒挤到发虚。
 * 委托是唯一"越宽越有用"的列，多出来的宽度停在它和操作列之间，视觉上是留白而不是裂口。
 *
 * 列序按**阅读价值**排，不按录入顺序排：贡献 / 盈亏与 Δb 紧跟在时间之后，落在从左往右
 * 扫视最先停留的那一段；开平价、币量、手续费这些"怎么来的"排在后面；委托与操作收在右端。
 * 「状态」不单独占一列——已平仓是绝大多数，只在**没有**平仓时才在角色旁标一枚小标签。

 *
 * 这里曾经把表头和行各写一份，加列时只改了表头，行少一列，
 * 最后一列「操作」被挤进隐式新行、整张表错位。共用一份后物理上不可能再失配。
 *
 * 时间列用 minmax(200px, 1fr) 而不是裸 1fr：裸 1fr 在容器被压窄时会缩到
 * 放不下「操作 2026-08-21 11:03」，导致文字逐字竖排。
 */
/**
 * Δb 是这张表的主角（这条腿把整场的 b 推高/拉低了多少），用最大字号 + 淡色底的胶囊固定住视线。
 * 底色只取 12% 透明度：密排表格里满色块会盖过数字本身。
 */
function deltaTone(delta: number | null): string {
  if (delta == null || roundedDeltaB(delta) === 0) return 'bg-muted text-muted-foreground';
  // 透明度必须写成 /[0.12]：任意色 + 非标准透明度档（/12）Tailwind 不会生成规则，底色会静默失效。
  return delta > 0
    ? 'bg-[#0ECB81]/[0.12] text-[#0ECB81]'
    : 'bg-[#F6465D]/[0.12] text-[#F6465D]';
}

/** 两位小数下取不到半个刻度的值就是 0：否则会印出「−0.00」这种自相矛盾的读数。 */
function roundedDeltaB(delta: number): number {
  const rounded = Number(delta.toFixed(2));
  return rounded === 0 ? 0 : rounded;
}

/** 「+0.43」「-0.06」「0.00」。 */
function formatDeltaB(delta: number | null): string {
  if (delta == null) return '—';
  const value = roundedDeltaB(delta);
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

/** 时间列里「开 / 平 / 操作」三个标签的定宽，保证三行时间戳起点对齐。 */
const TIME_LABEL = 'inline-block w-[30px] text-muted-foreground';

/** 手续费列表头的说明：币安的算式、费率档与「盈亏列为什么已经扣了平仓费」。 */
const FEE_COLUMN_HINT = '币安口径：手续费 = 名义 × 费率，开仓、平仓各收一次；市价单 / 触发单 Taker 0.05%，盘口限价单 Maker 0.02%。'
  + 'U 本位：名义 = 数量 × 成交价，以 USDT 计，平仓价越高平仓费越高。'
  + '币本位：名义 = 张数 × 面值 ÷ 成交价，收的是币——折成美元后价格被约掉，所以开平两笔的美元数必然相同，币数才不同（价越高付的币越少），本列因此按币显示。'
  + '盈亏列已扣平仓费；开仓费在开仓当时从钱包扣除。旧记录未存开仓费，按当时 0.04% Taker 估算并标明。';

const LEGS_GRID = 'grid-cols-[36px_128px_180px_116px_84px_88px_88px_116px_104px_minmax(224px,1fr)_64px]';

/** 各列合计的下限，与 LEGS_GRID 对应；不足时容器横向滚动而不是压扁列。 */
const LEGS_MIN_WIDTH = 'min-w-[1352px]';

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

  // 手续费合计：按成交记录去重（主力与镜像止盈可能挂同一条记录），不是按腿相加。
  const feeTotals = useMemo(() => {
    const records: TradeRecord[] = [];
    for (const leg of legs) {
      const rec = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
      if (rec) records.push(rec);
    }
    return sumTradeRecordFees(records);
  }, [legs, recordMap]);

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
          <div className={`grid ${LEGS_GRID} gap-x-2.5 text-[10px] font-medium text-muted-foreground bg-muted/40 py-2 px-3`}>
            <div>#</div>
            <div>角色</div>
            <div>时间</div>
            <div className="text-right text-foreground/70" title="上行：该腿在本场各腿盈亏绝对值之和里所占的份额；下行：已实现盈亏金额（已扣平仓费，开仓费在开仓当时从钱包扣除，见手续费列）">贡献 / 盈亏</div>
            <div className="text-right font-semibold tracking-wide text-foreground/85" title="该腿盈亏 ÷ 初始最大预期亏损 L：这条腿把整场 b 推高 / 拉低了多少">Δb</div>
            <div className="text-right">开仓价</div>
            <div className="text-right">平仓价</div>
            <div className="text-right" title="上行：按开仓价折算的币量，即加仓公式里的 X；下行：名义仓位（USD）">币量 / 仓位</div>
            <div className="text-right text-muted-foreground/60" title={FEE_COLUMN_HINT}>手续费</div>
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
              /**
               * 强平记录的价格不在平仓时刻那根 K 线里，说明引擎用了一个不属于那一刻的价去判强平
               * （旧版会拿比仓位还早的价）。这不是普通的价格误差：按 K 线改价只会把一次误判的强平
               * 改写成一笔看似合理的亏损，所以要明说。
               */
              const liquidationAnomaly = Boolean(execution.exitCorrection) && execution.record?.action === 'LIQUIDATION';
              const exitCorrectionTitle = execution.exitCorrection
                ? liquidationAnomaly
                  ? `强平异常：记录的强平价 ${fmtPrice(execution.exitCorrection.originalExitPrice)} 不在平仓时刻 1m K 线范围 ${fmtPrice(execution.exitCorrection.candleLow)}-${fmtPrice(execution.exitCorrection.candleHigh)} 内，属于引擎误判的强平。本页按 K 线时价显示，这条腿的盈亏不代表真实结果。`
                  : `原 TradeRecord 平仓价 ${fmtPrice(execution.exitCorrection.originalExitPrice)} 超出该平仓时刻 1m K 线范围 ${fmtPrice(execution.exitCorrection.candleLow)}-${fmtPrice(execution.exitCorrection.candleHigh)}，本页按 K 线时价显示。`
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
                  className={`grid ${LEGS_GRID} gap-x-2.5 items-start text-[11px] font-mono py-2.5 px-3 border-b border-border/40 hover:bg-accent transition-colors ${
                    highlighted ? 'bg-[#002FA7]/5 ring-1 ring-inset ring-[#002FA7]/12' : ''
                  }`}
                >
                  <div>{leg.leg_sequence ?? '—'}</div>
                  {/* 角色名长短不一（主力开仓 / 加仓1 / ReH），标签靠左排就会参差；
                      推到列的右缘，各行的「回填」便落在同一条竖线上。 */}
                  <div className="flex items-center justify-between gap-1.5">
                    {leg.leg_role
                      ? <LegRoleChip role={leg.leg_role} ordinal={mainLegOrdinals.get(leg.id) ?? null} />
                      : '—'}
                    {/* 「回填」排在最右：它几乎每行都有，放在右缘各行才落在同一条竖线上；
                        「挂单中 / 进行中」是少数行才出现的例外，插在它左边。 */}
                    <div className="flex shrink-0 items-center gap-1">
                      {!status.closed && (
                        <span className={`inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] ${status.className}`}>
                          {status.label}
                        </span>
                      )}
                      {leg.source === 'retroactive_from_record' && (
                        <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          回填
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 标签定宽（按最长的「操作」定），三行时间戳才会起于同一条竖线：
                      一个字的「开」与两个字的「操作」若各自占位，日期就会落在两个位置上。
                      定宽写在 span 上而不是拆成两栏，文本本身仍是「开 2025-09-19 21:49」，
                      复制出去、读屏念出来都还是一句完整的话。 */}
                  <div className="leading-tight">
                    <div><span className={TIME_LABEL}>开 </span>{openLabel}</div>
                    <div><span className={TIME_LABEL}>平 </span>{closeLabel}</div>
                    <div><span className={TIME_LABEL}>操作 </span>{operationLabel}</div>
                    {hedgeSummary && <div className="text-[10px] text-[#F0B90B]">{hedgeSummary}</div>}
                  </div>
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
                        title="上行：该腿在本场各腿盈亏绝对值之和里所占的份额；下行：已实现盈亏金额"
                        className="text-right text-[12px] leading-snug"
                      >
                        {/* 份额才是要读的那个数：同样一笔金额，在小场子里是主因、在大场子里是零头。 */}
                        <div
                          className={`font-mono font-medium tabular-nums ${
                            pnl === 0 ? 'text-foreground/50' : positive ? 'text-[#0ECB81]/90' : 'text-[#F6465D]/90'
                          }`}
                        >
                          {contribution == null
                            ? '—'
                            : `${contribution > 0 ? '+' : ''}${(contribution * 100).toFixed(1)}%`}
                        </div>
                        <div className="text-[10px] tabular-nums text-foreground/45">
                          {positive ? '+' : ''}{pnl.toFixed(2)}
                        </div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const pnl = legPnlMap.get(leg.id)?.pnl ?? null;
                    const delta = legDeltaB(pnl, initialExpectedMaxLoss);
                    if (delta == null) return <div className="text-right text-[11px] text-foreground/30">—</div>;
                    return (
                      <div className="flex justify-end">
                        <span
                          data-testid={`leg-delta-b-${leg.id}`}
                          title="该腿盈亏 ÷ 初始最大预期亏损 L —— 这条腿把整场 b 推高 / 拉低了多少个单位"
                          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[14px] font-semibold leading-tight tabular-nums ${deltaTone(delta)}`}
                        >
                          {formatDeltaB(delta)}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="text-right tabular-nums">{fmtPrice(entryPriceValue)}</div>
                  <div className="text-right tabular-nums" title={exitCorrectionTitle}>
                    {fmtPrice(exitPriceValue)}
                    {liquidationAnomaly && (
                      <div data-testid="leg-liquidation-anomaly" className="text-[10px] text-[#F6465D]">强平异常</div>
                    )}
                  </div>
                  {/* 币量在上、名义在下：加仓公式里的 X 是币量，名义只是它乘开仓价的结果。
                      反向合约的面值锁在 USD 上，光看名义看不出这条腿到底拿着多少币。 */}
                  <div
                    className="text-right tabular-nums leading-snug"
                    title={legCoinQty != null
                      ? `币量 = 名义 ÷ 开仓价 = ${leg.pre_position_size?.toFixed(2)} ÷ ${fmtPrice(entryPriceValue)}`
                      : '缺开仓价时不猜币量'}
                  >
                    <div>{legCoinQty != null ? legCoinQty.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {leg.pre_position_size != null ? leg.pre_position_size.toFixed(2) : '—'}
                    </div>
                  </div>
                  {(() => {
                    /**
                     * 三列的主次由**字号与字重**定，不靠发灰：
                     *   Δb 14px 半粗 + 淡色底（主角）→ 盈亏 12px 中粗（次角）→ 手续费 11px 常规（注脚）。
                     * 手续费用中性前景色而不是灰调，密排小字下灰调会显脏。
                     * 费率、Maker/Taker、估算依据都在 tooltip 里。
                     */
                    const fees = execution.record ? tradeRecordFees(execution.record) : null;
                    if (!fees) return <div className="text-right text-[11px] text-foreground/30">—</div>;
                    /**
                     * 币本位按**币**显示。币安的币本位手续费 = 张数 × 面值 ÷ 成交价 × 费率，收的是币；
                     * 折成美元后价格被约掉（= 张数 × 面值 × 费率），开平两笔的美元数必然相同——
                     * 只写美元会让人以为引擎把平仓费算成了开仓费。币数才看得出两笔的差别。
                     */
                    const coinMode = fees.coinSettled && fees.totalCoin != null;
                    return (
                      <div
                        data-testid={`leg-fees-${leg.id}`}
                        title={describeTradeRecordFees(execution.record!)}
                        className="text-right text-[11px] leading-snug tabular-nums text-foreground/55"
                      >
                        <div>
                          {coinMode
                            ? formatFeeCoin(fees.totalCoin, fees.asset)
                            : fees.totalUsd == null ? '—' : fees.totalUsd.toFixed(2)}
                          {fees.estimated && <span className="ml-1 text-[8px] tracking-wide text-foreground/30">估</span>}
                        </div>
                        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[9px] text-foreground/35">
                          开 {coinMode
                            ? formatFeeCoin(fees.open?.coin)
                            : fees.open ? fees.open.usd.toFixed(2) : '—'}
                          {' · 平 '}
                          {coinMode ? formatFeeCoin(fees.close.coin) : fees.close.usd.toFixed(2)}
                        </div>
                      </div>
                    );
                  })()}
                  {/* 委托列：多条卡片会把行撑得很高。限高 + 内部滚动，
                      让各行高度趋于一致，同时一条委托都不丢。 */}
                  <div className="max-h-[152px] max-w-[300px] space-y-1 overflow-y-auto pr-1 font-sans">
                    {mirrorTpTiming && (
                      <div
                        className="rounded border border-[#F0B90B]/25 bg-[#F0B90B]/5 px-2 py-1 leading-tight"
                        title={`委 ${fmtClock(mirrorTpTiming.placedAt)} · 触 ${fmtClock(mirrorTpTiming.triggeredAt)}`}
                      >
                        <div className="text-[10px] font-medium text-[#D89B00]">镜像止盈</div>
                        <div className="text-[10px] tabular-nums text-muted-foreground">
                          委 {fmtCardTime(mirrorTpTiming.placedAt)} · 触 {fmtCardTime(mirrorTpTiming.triggeredAt, mirrorTpTiming.placedAt)}
                        </div>
                      </div>
                    )}
                    {reverseOrdersForLeg.length === 0 && !mirrorTpTiming ? (
                      <span className="font-mono text-muted-foreground">—</span>
                    ) : (
                      reverseOrdersForLeg.map(order => (
                        <div
                          key={order.id}
                          title={`委 ${fmtClock(order.createdAt)}${order.status === 'triggered' ? ` · 触 ${fmtClock(order.triggeredAt)}` : ''} · ${order.status === 'triggered' ? '平' : '撤'} ${order.cancelledAt ? fmtClock(order.cancelledAt) : '—'}`}
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
                          <div className="text-[10px] tabular-nums text-muted-foreground">
                            委 {fmtCardTime(order.createdAt)}
                            {order.status === 'triggered' && ` · 触 ${fmtCardTime(order.triggeredAt, order.createdAt)}`}
                            {` · ${order.status === 'triggered' ? '平' : '撤'} ${order.cancelledAt ? fmtCardTime(order.cancelledAt, order.createdAt) : '—'}`}
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
                          className={`grid ${LEGS_GRID} gap-x-2.5 items-center py-1 px-3 text-[10px] font-mono text-muted-foreground`}
                        >
                          <div />
                          <div className="pl-3 font-sans text-[9px]">
                            阶段 {phase.index}
                            {phase.boundaryLegId == null && <span className="text-muted-foreground/60"> · 收尾</span>}
                          </div>
                          <div className="tabular-nums" title={`${fmtClock(phase.startTime)} → ${fmtClock(phase.endTime)}`}>
                            {fmtCardTime(phase.startTime)} → {fmtCardTime(phase.endTime, phase.startTime)}
                            {phase.boundaryLegId != null && (
                              <span className="ml-1 font-sans text-[9px] text-[#6D28D9]/80">对冲结束切段</span>
                            )}
                          </div>
                          <div className="text-right leading-tight">
                            <div className={`tabular-nums ${phase.pnl === 0 ? '' : positive ? 'text-[#0ECB81]/90' : 'text-[#F6465D]/90'}`}>
                              {phaseContribution == null ? '—' : `${phaseContribution > 0 ? '+' : ''}${(phaseContribution * 100).toFixed(1)}%`}
                            </div>
                            <div className="text-[9px] tabular-nums text-muted-foreground/70">
                              {positive ? '+' : ''}{phase.pnl.toFixed(2)}
                            </div>
                          </div>
                          <div className={`text-right tabular-nums ${phaseDelta == null ? '' : phaseDelta > 0 ? 'text-[#0ECB81]/90' : phaseDelta < 0 ? 'text-[#F6465D]/90' : ''}`}>
                            {phaseDelta == null ? '—' : `${phaseDelta > 0 ? '+' : ''}${phaseDelta.toFixed(2)}`}
                          </div>
                          <div className="text-right tabular-nums">{fmtPrice(phase.startPrice)}</div>
                          <div className="text-right tabular-nums">{fmtPrice(phase.endPrice)}</div>
                          <div />
                          <div />
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
              className={`grid ${LEGS_GRID} items-center gap-x-2.5 border-t-2 border-border px-3 py-2 text-[11px] font-medium`}
            >
              <div />
              <div className="text-muted-foreground">合计</div>
              <div className="text-[10px] text-muted-foreground">{settlementBasisLabel(settlement.basis)}</div>
              <div className={`text-right text-[12px] font-medium tabular-nums ${totalPnl == null ? 'text-foreground/50' : totalPnl > 0 ? 'text-[#0ECB81]/90' : totalPnl < 0 ? 'text-[#F6465D]/90' : ''}`}>
                {totalPnl == null ? '—' : `${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)}`}
              </div>
              <div className="flex justify-end">
                <span
                  data-testid="legs-total-delta-b"
                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[14px] font-semibold leading-tight tabular-nums ${deltaTone(totalDeltaB)}`}
                >
                  {formatDeltaB(totalDeltaB)}
                </span>
              </div>
              <div /><div /><div />
              <div
                data-testid="legs-total-fees"
                title="本场全部成交记录的开仓费 + 平仓费（按记录去重：同一条记录挂在几条腿上只算一次）"
                className="text-right text-[11px] font-normal tabular-nums leading-snug text-foreground/55"
              >
                {feeTotals == null
                  ? '—'
                  : feeTotals.totalCoin != null
                    ? formatFeeCoin(feeTotals.totalCoin, feeTotals.asset)
                    : feeTotals.totalUsd.toFixed(2)}
                {feeTotals?.estimated && <span className="ml-1 text-[8px] tracking-wide text-foreground/30">估</span>}
              </div>
              <div /><div />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
