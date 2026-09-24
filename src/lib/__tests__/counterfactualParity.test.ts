/**
 * 黄金对账：**不改一格**地重跑 Legs 副本，反事实盈亏概览必须逐项复现真实盈亏概览。
 *
 * 两块面板并排摆在战役页上，「相对实际」被读成「原始错误的代价」。原样重跑若差出一个数，
 * 用户就会把引擎的口径差当成自己方案的得失——所以这里用真实形状的夹具，按页面的原样
 * 算出真实那一侧，再走 buildManualLegs → simulateManualLegScenario → 适配器算出重跑那一侧，
 * 逐项比到 1 分钱以内。
 *
 * 比对的项：已实现 P&L、峰值浮盈、最大预期亏损、预期回撤、杠杆、主力开仓名义仓位、盈亏比，
 * 以及由 b 推出的算术期望、几何期望、DSI/USI 贡献（b²/n），主力涨幅与由它推出的涨幅效率、加仓&止盈效用，
 * 再加「相对实际」= 0.00。
 * 今日账户总资产两边读同一个数（当前账户），不在这里比。
 *
 * 按构造**不可能**相同、因此不比的项（写死在 EXCLUDED_BY_CONSTRUCTION 里，改动时必须说明理由）：
 *   · settlement（取数来源 / 落库缓存差额）——那是战役行自己的对账信息，反事实分支没有落库缓存；
 *   · initialRisk（帮助里的「本场 x」与脚注的资产分母来源）——真实战役优先用主力开仓时固化的账户资产快照，
 *     反事实分支没有「开仓那一刻的账户」，只能退到今日总资产。几何期望只由 b 决定，不受它影响，照样比。
 *
 * 夹具分三批：手写的八场（形状齐全、数字好算）；用模拟器自己的下单 / 合并 / 分刀平仓函数实跑出来的
 * 那一批（市价滑点、主力与镜像并仓、镜像止盈按比例减仓、历史归类的委托快照、本地没有成交记录、
 * 两笔主力先后开、先挂后成交的保护单、并进主力却没有腿的加仓、一条腿都结算不了……）；
 * 以及按种子生成的随机形状（randomParityFixture）。
 * 某一场里真实面板**自己**有已知局限、因而按构造对不上的指标，写在夹具的 exclusions 里并附理由；
 * 这里只跳过那一项，其余照比。
 *
 * 第二组断言守「相对实际只反映改动」：从原样副本出发改一格，相对实际挪动的量必须恰好是这一格值多少钱，
 * 不能因为「改过了」就整条腿换一套算法，把滑点、分刀、老费率的差额一起算进去。
 */
import { campaignHasMainAdd, campaignMainLegPriceChangePct, campaignPriceChangeLegInputs, computeAddEfficiency, computeMainPriceEfficiency } from '@/lib/campaignMainPriceChange';
import { describe, expect, it } from 'vitest';
import { computeAsymmetricRiskContribution, type AsymmetricRiskMetricsSummary } from '@/lib/asymmetricRiskMetrics';
import {
  computeCampaignPnlReconciliation,
  computeDecisionAccuracy,
  computeInitialExpectedMaxDrawdownPct,
  computeInitialMainExposureNotional,
  resolveCampaignEquityPathLegFacts,
  resolveUnfilledLegIds,
} from '@/lib/campaignAnalysis';
import { resolveNeverFilledOrderIds } from '@/lib/campaignOrderAttribution';
import {
  computeCampaignExpectancies,
  resolveCampaignMainLeverage,
} from '@/lib/campaignMetrics';
import {
  claimCampaignRecordsByLeg,
  computeCampaignRealizedPnl,
} from '@/lib/campaignRealizedPnl';
import { getPositionNotionalUsd } from '@/lib/tradingSettlement';
import {
  adoptBaselineLegFacts,
  buildActualSimulationParams,
  buildCounterfactualRiskContext,
  buildManualLegs,
  buildPureSopParams,
  computeManualLegDeviationCosts,
  counterfactualTemplateFor,
  defaultCloseTime,
  earlierClosedCuts,
  resolveCounterfactualActualResolved,
  simulateManualLegScenario,
} from '@/lib/campaignSimulationEngine';
import { buildCounterfactualChangeSummary } from '@/lib/counterfactualChangeSummary';
import { buildCounterfactualOverviewMetrics, type CounterfactualOverviewShared } from '@/lib/counterfactualOverview';
import { TAKER_FEE } from '@/types/trading';
import type {
  CampaignCounterfactualChangeSummary,
  CampaignCounterfactualManualLeg,
  CampaignCounterfactualParams,
  CampaignEvent,
} from '@/types/journal';
import type { TradeRecord } from '@/types/trading';
import {
  PARITY_FIXTURES,
  PARITY_HOUR,
  PARITY_T0,
  PARITY_TAKER_FEE,
  SIMULATOR_PARITY_FIXTURES,
  parityFixture,
  randomParityFixture,
  type ParityFixture,
  type ParityMetric,
} from '@/test/fixtures/counterfactualParityFixtures';
import type { KlineData } from '@/hooks/useBinanceData';
import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { buildTradeRecordLookup } from '@/lib/objectiveOperationTime';
import { buildLegPositionShareInputs, campaignMainSideNotional } from '@/lib/legPositionShareInputs';
import type { TradeJournal } from '@/types/journal';

const ASYMMETRIC: AsymmetricRiskMetricsSummary = {
  sampleCount: 10,
  winCount: 5,
  lossCount: 5,
  excludedPayoffCount: 0,
  dsi: 1,
  usi: 1,
  upsideStandardDeviation: null,
  downsideStandardDeviation: null,
  upsidePotential: null,
  downsidePotential: null,
  upr: null,
  omega: null,
  sortino: null,
  sortinoIdentityRhs: null,
  winSquaredSum: 5,
  lossSquaredSum: 5,
};

/** 与 buildCounterfactualOverviewMetrics 的约定逐项对应；这些项不比，理由见文件头。 */
const EXCLUDED_BY_CONSTRUCTION = ['settlement', 'initialRisk'] as const;
/**
 * 不是本场的读数、两边按构造读同一个输入的项：今日账户总资产、有效胜率（整页测试里逐字比过），
 * 以及帮助文案的覆盖 / 追加（文字，不是数）。
 */
const SHARED_INPUTS_AND_TEXT = ['helpOverrides', 'extraNotes',
  // 涨幅的依据只进 ⓘ 说明，读数已随 mainPriceChangePct 逐项比对
  'mainPriceChangeBasis',
] as const;

type PanelNumbers = Record<ParityMetric, number | null> & {
  realizedPnl: number | null;
  peakUnrealizedPnl: number;
  initialExpectedMaxLoss: number;
  expectedMaxDrawdownPct: number;
  mainLeverage: number | null;
  initialMainExposureNotional: number;
  mainSideNotional: number | null;
  payoffRatio: number | null;
  arithmeticExpectancy: number | null;
  geometricExpectancy: number | null;
  dsiUsiTerm: number | null;
  mainPriceChangePct: number | null;
  mainPriceEfficiency: number | null;
  addEfficiency: number | null;
};

/**
 * 涨幅效率与加仓&止盈效用：两边都从各自的涨幅、预期回撤、盈亏比走同一对函数（页面构造器里就是这么算的）；
 * 加仓&止盈效用只对做过加仓的战役算（真实侧 campaignHasMainAdd，重跑侧 metrics.hasMainAdd），这个判断也就跟着逐项比对。
 */
function efficiencyNumbers(mainPriceChangePct: number | null, expectedMaxDrawdownPct: number, payoffRatio: number | null, hasMainAdd: boolean) {
  const mainPriceEfficiency = computeMainPriceEfficiency(mainPriceChangePct, expectedMaxDrawdownPct);
  return {
    mainPriceChangePct,
    mainPriceEfficiency,
    addEfficiency: hasMainAdd ? computeAddEfficiency(payoffRatio == null ? null : payoffRatio / 100, mainPriceEfficiency) : null,
  };
}

const ALL_FIXTURES = [...PARITY_FIXTURES, ...SIMULATOR_PARITY_FIXTURES];

/** 页面从 getCampaignFullData 拿到的本地委托事实（从未成交的委托 id），与夹具同一份。 */
function localOrdersOf(fx: ParityFixture) {
  return fx.unfilledOrderIds ? { unfilledOrderIds: new Set(fx.unfilledOrderIds) } : {};
}

/** 页面「多方总名义仓位」memo 原样算：Legs 表同一份输入、同一份挂单判定凭据。 */
function realMainSide(fx: ParityFixture) {
  return campaignMainSideNotional(
    fx.campaign.direction,
    buildLegPositionShareInputs(fx.legs, buildTradeRecordLookup(fx.tradeRecords), fx.corrections, {
      unfilledOrderIds: new Set(fx.unfilledOrderIds ?? []),
      orders: fx.reverseHedgeOrders,
      events: fx.campaign.actual_evolution,
    }),
  );
}

/** 按 JournalCampaignDetailPage 的 accuracy / pnlReconciliation / campaignMetricValues / 盈亏概览 memo 原样算。 */
function realPanel(fx: ParityFixture) {
  const { campaign, legs, tradeRecords, klines, reverseHedgeOrders, corrections } = fx;
  const accuracy = computeDecisionAccuracy(campaign, legs, tradeRecords, klines, reverseHedgeOrders, corrections, localOrdersOf(fx));
  const pnlReconciliation = computeCampaignPnlReconciliation(campaign, legs, tradeRecords, corrections);
  const settlement = computeCampaignRealizedPnl(campaign, legs, tradeRecords, corrections);
  const payoffRatio = accuracy.initial_expected_max_loss > 0 ? accuracy.profit_capture_ratio : null;
  const expectedMaxDrawdownPct = computeInitialExpectedMaxDrawdownPct(campaign, legs, tradeRecords, reverseHedgeOrders);
  const expectancies = computeCampaignExpectancies(payoffRatio);
  const contribution = computeAsymmetricRiskContribution(payoffRatio == null ? null : payoffRatio / 100, ASYMMETRIC);
  const numbers: PanelNumbers = {
    realizedPnl: pnlReconciliation.correctedPnl ?? campaign.final_realized_pnl,
    peakUnrealizedPnl: accuracy.campaign_max_profit_real,
    initialExpectedMaxLoss: accuracy.initial_expected_max_loss,
    expectedMaxDrawdownPct,
    mainLeverage: resolveCampaignMainLeverage(campaign, legs, tradeRecords),
    initialMainExposureNotional: computeInitialMainExposureNotional(campaign, legs, tradeRecords),
    // 【用户要求】多方总名义仓位：与页面、Legs 表合计行同一份输入
    mainSideNotional: realMainSide(fx).total,
    payoffRatio,
    arithmeticExpectancy: expectancies.arithmeticExpectancy,
    geometricExpectancy: expectancies.geometricExpectancy,
    dsiUsiTerm: contribution?.meanSquareTerm ?? null,
    // 与页面同一个函数、同一份平仓价校正
    ...efficiencyNumbers(campaignMainLegPriceChangePct(campaign, legs, tradeRecords, corrections, localOrdersOf(fx)), expectedMaxDrawdownPct, payoffRatio, campaignHasMainAdd(legs)),
  };
  return { numbers, actualPnl: pnlReconciliation.correctedPnl, settlement, accuracy };
}

/** 编辑器的底稿（JSON 往返）与原样副本（buildManualLegs）。 */
function copyOf(fx: ParityFixture) {
  const { campaign, legs, tradeRecords, klines, corrections } = fx;
  const defaults = buildActualSimulationParams(campaign, legs, tradeRecords) ?? buildPureSopParams(campaign, legs, tradeRecords);
  expect(defaults).not.toBeNull();
  const base = JSON.parse(JSON.stringify(defaults)) as CampaignCounterfactualParams;
  const manualLegs = buildManualLegs(base, legs, klines, tradeRecords, corrections, { campaign, localOrders: localOrdersOf(fx) });
  return { base, manualLegs };
}

/** 页面 handleRunWhatIf 的写法：只送启用腿，附上这场战役的风险锚上下文，再经 JSON 往返（落库的 jsonb）。 */
function runLegs(fx: ParityFixture, base: CampaignCounterfactualParams, manualLegs: CampaignCounterfactualManualLeg[]) {
  const params = JSON.parse(JSON.stringify({
    ...base,
    manual_legs: manualLegs.filter(leg => leg.enabled),
    risk_context: buildCounterfactualRiskContext(fx.campaign, fx.reverseHedgeOrders),
    actual_resolved: resolveCounterfactualActualResolved(fx.campaign, fx.legs, fx.tradeRecords, fx.corrections),
  })) as CampaignCounterfactualParams;
  return { params, result: simulateManualLegScenario(params, fx.klines) };
}

/** 按编辑器（底稿 JSON 往返 → buildManualLegs → 只送启用腿）+ 页面（runCustomCounterfactual → 适配器）原样跑。 */
function rerunPanel(fx: ParityFixture, edit?: (legs: CampaignCounterfactualManualLeg[]) => CampaignCounterfactualManualLeg[]) {
  const { base, manualLegs: copied } = copyOf(fx);
  const manualLegs = JSON.parse(JSON.stringify(edit ? edit(copied) : copied)) as CampaignCounterfactualManualLeg[];
  const { params, result } = runLegs(fx, base, manualLegs);
  const shared: CounterfactualOverviewShared = {
    strategyTemplate: counterfactualTemplateFor(fx.campaign),
    asymmetricRiskSummary: ASYMMETRIC,
    currentAccountEquity: 10_000,
    isOwner: true,
    actualMain: {
      byLegId: Object.fromEntries(campaignPriceChangeLegInputs(fx.campaign, fx.legs, fx.tradeRecords, fx.corrections, localOrdersOf(fx)).map(input => [input.id, input])),
      pct: campaignMainLegPriceChangePct(fx.campaign, fx.legs, fx.tradeRecords, fx.corrections, localOrdersOf(fx)),
    },
    mainSide: realMainSide(fx).side,
  };
  const metrics = buildCounterfactualOverviewMetrics({ params, result }, shared);
  const numbers: PanelNumbers = {
    realizedPnl: metrics.realizedPnl,
    peakUnrealizedPnl: metrics.peakUnrealizedPnl,
    initialExpectedMaxLoss: metrics.initialExpectedMaxLoss,
    expectedMaxDrawdownPct: metrics.expectedMaxDrawdownPct,
    mainLeverage: metrics.mainLeverage,
    initialMainExposureNotional: metrics.initialMainExposureNotional,
    payoffRatio: metrics.payoffRatio,
    arithmeticExpectancy: metrics.arithmeticExpectancy,
    geometricExpectancy: metrics.geometricExpectancy,
    dsiUsiTerm: metrics.asymmetricRiskContribution?.meanSquareTerm ?? null,
    mainSideNotional: metrics.mainSideNotional?.total ?? null,
    ...efficiencyNumbers(metrics.mainPriceChangePct, metrics.expectedMaxDrawdownPct, metrics.payoffRatio, metrics.hasMainAdd),
  };
  return { numbers, result, manualLegs, metrics };
}

/** 两边都为空算相同；一边空一边有数算不同；都有数时差 ≤ 1 分钱算相同。 */
function withinCent(actual: number | null, expected: number | null): boolean {
  if (expected == null || actual == null) return actual === expected;
  return Math.abs(actual - expected) <= 0.01;
}

/** 收齐一场里全部不一致的项再断言，失败信息一次列全；夹具写明理由的项跳过。 */
function parityMismatches(real: PanelNumbers, rerun: PanelNumbers, exclusions: ParityFixture['exclusions'] = {}): string[] {
  return (Object.keys(real) as Array<keyof PanelNumbers>)
    .filter(key => !exclusions[key])
    .filter(key => !withinCent(rerun[key], real[key]))
    .map(key => `${key}: 真实 ${real[key]} ≠ 重跑 ${rerun[key]}`);
}

/** 一格改动值多少钱：同一条腿按调整前后的开平价算毛盈亏差，再减去这一刀平仓费的变化（按该记录自己的费率）。 */
function editWorth(qty: number, from: number, to: number, side: 'LONG' | 'SHORT', closeRate: number): number {
  const sign = side === 'LONG' ? 1 : -1;
  return sign * (to - from) * qty - qty * (to - from) * closeRate;
}

function closingRecord(records: TradeRecord[], positionOrFillId: string, fill = false): TradeRecord {
  const own = records.filter(record => (fill ? record.fillId === positionOrFillId && record.positionId !== positionOrFillId : record.fillId === positionOrFillId || (!record.fillId && record.positionId === positionOrFillId)));
  return own.reduce((latest, record) => (record.closeTime > latest.closeTime ? record : latest), own[0]);
}

/**
 * 9962e7e7 的 buildManualLegs 原样拷贝（冻结，不随引擎改）：「口径统一之前保存的分支」里每条腿就是它写下的。
 * 老引擎没有成交结果与成交状态；没有成交记录的腿按挂出时刻开仓，缺平仓时间的腿收在当时 K 线窗口的末根。
 */
function legacyBuildManualLegs(
  params: CampaignCounterfactualParams,
  legs: TradeJournal[],
  klines: KlineData[],
  tradeRecords: TradeRecord[],
  exitPriceCorrections: LegExitPriceCorrections = {},
): CampaignCounterfactualManualLeg[] {
  const manualTimeMs = (value: string) => {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
  };
  const fallbackClose = defaultCloseTime(params, klines);
  const recordMap = buildTradeRecordLookup(tradeRecords);
  const ordered = [...legs].sort((a, b) => {
    const seqA = a.leg_sequence ?? 9999;
    const seqB = b.leg_sequence ?? 9999;
    if (seqA !== seqB) return seqA - seqB;
    return new Date(a.pre_simulated_time).getTime() - new Date(b.pre_simulated_time).getTime();
  });
  return ordered
    .map((leg, index) => {
      const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
      const execution = resolveLegExecution(leg, record, exitPriceCorrections);
      const openTime = execution.openTime != null
        ? new Date(execution.openTime).toISOString()
        : leg.pre_simulated_time || params.entry.time;
      const closeTime = execution.closeTime != null
        ? new Date(execution.closeTime).toISOString()
        : fallbackClose;
      const closeMs = manualTimeMs(closeTime) ?? manualTimeMs(fallbackClose) ?? manualTimeMs(openTime) ?? Date.now();
      const openMs = manualTimeMs(openTime) ?? closeMs;
      const normalizedClose = closeMs >= openMs ? closeTime : new Date(openMs).toISOString();
      const entryPrice = execution.entryPrice ?? params.entry.price;
      const exitPrice = execution.exitPrice ?? entryPrice;
      return {
        id: leg.id || `leg-${index}`,
        leg_role: leg.leg_role ?? 'standalone',
        direction: leg.direction === 'short' ? 'short' : 'long',
        open_time: openTime,
        close_time: normalizedClose,
        entry_price: entryPrice,
        exit_price: exitPrice,
        size_usdt: leg.pre_position_size ?? params.entry.size_usdt,
        leverage: leg.leverage ?? params.entry.leverage ?? 1,
        enabled: true,
      } satisfies CampaignCounterfactualManualLeg;
    })
    .filter(leg => leg.entry_price > 0 && leg.size_usdt > 0);
}

/** 按页面的写法载回：每条腿按当前基线补事实（adoptBaselineLegFacts），带上那次运行的 K 线末根与改动摘要。 */
function loadRow(
  baseline: CampaignCounterfactualManualLeg[],
  saved: CampaignCounterfactualManualLeg[],
  windowEnd: string | null,
  summary: CampaignCounterfactualChangeSummary | null = null,
) {
  const byId = new Map(baseline.map(leg => [leg.id, leg]));
  return JSON.parse(JSON.stringify(saved)).map((leg: CampaignCounterfactualManualLeg) => (
    adoptBaselineLegFacts(leg, byId.get(leg.id), windowEnd, summary)
  )) as CampaignCounterfactualManualLeg[];
}

/**
 * 把一场随机形状改成「历史归类、换了浏览器」的样子：本地一条成交记录都没有，页面只能从 historical_leg_attached 事件还原。
 * 每条成交过的腿随机按两种归类方式之一写事件：
 *   · 从日志腿归类（campaignEventFromJournal）：一条事件带 journal_id，成交价取第一刀、名义与已实现取各刀之和；
 *     库里的腿保留委托价 / 委托名义，post_* 与事件合并；
 *   · 从仓位历史记录归类（campaignEventFromTradeRecord）：每条记录一条事件、只带成交 id，
 *     页面按事件合成一条 id 为 record-<成交 id> 的腿（synthesizeJournalFromEvent）。
 * 偶尔事件没有平仓时间（合成的腿按战役结束时刻收）、没有已实现。
 */
function historicalView(fx: ParityFixture, seed: number): ParityFixture | null {
  if (fx.tradeRecords.length === 0) return null;
  let state = (seed * 7919) >>> 0;
  const rnd = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  const claimed = claimCampaignRecordsByLeg(fx.legs, fx.tradeRecords);
  const blank = { pending_order_id: null, notes: null, recorded_at: fx.campaign.opened_at };
  const events: CampaignEvent[] = [{
    ...blank, id: 'ev-hist', timestamp: fx.campaign.opened_at, event_type: 'historical_classification_created',
    leg_role: null, journal_id: null, trade_record_id: null, price: null, size_usdt: null,
  }];
  const legs: TradeJournal[] = [];
  const closedAt = fx.campaign.closed_at;
  for (const leg of fx.legs) {
    const records = claimed.get(leg.id) ?? [];
    if (records.length === 0) {
      legs.push({ ...leg, leg_sequence: legs.length + 1 });
      continue;
    }
    const fromJournal = rnd() < 0.5;
    const noClose = rnd() < 0.15;
    const noRealized = rnd() < 0.1;
    const notionalOf = (record: TradeRecord) => getPositionNotionalUsd(record.symbol, record, record.entryPrice);
    const cutsOf = fromJournal ? [records] : records.map(record => [record]);
    for (const cut of cutsOf) {
      const first = cut.reduce((a, b) => (a.openTime <= b.openTime ? a : b));
      const last = cut.reduce((a, b) => (a.closeTime >= b.closeTime ? a : b));
      const notional = cut.reduce((sum, record) => sum + notionalOf(record), 0);
      const realized = noRealized ? null : cut.reduce((sum, record) => sum + record.pnl, 0);
      const closeTime = noClose ? null : iso(last.closeTime);
      events.push({
        ...blank,
        id: `ev-${fromJournal ? leg.id : first.id}`,
        timestamp: fromJournal ? leg.pre_simulated_time : iso(first.openTime),
        event_type: 'historical_leg_attached',
        leg_role: leg.leg_role,
        journal_id: fromJournal ? leg.id : null,
        trade_record_id: fromJournal ? leg.trade_record_id : first.id,
        price: first.entryPrice,
        size_usdt: notional,
        direction: leg.direction,
        open_time: iso(first.openTime),
        close_time: closeTime,
        entry_price: first.entryPrice,
        exit_price: last.exitPrice,
        realized_pnl: realized,
      });
      const merged = {
        post_realized_pnl: realized,
        post_simulated_close_time: closeTime ?? closedAt,
        post_exit_price_snapshot: last.exitPrice,
      };
      legs.push(fromJournal
        ? { ...leg, ...merged, leg_sequence: legs.length + 1 }
        : {
          ...leg,
          ...merged,
          id: `record-${first.id}`,
          trade_record_id: first.id,
          leg_sequence: legs.length + 1,
          source: 'retroactive_from_record',
          pre_simulated_time: iso(first.openTime),
          pre_entry_price: first.entryPrice,
          pre_position_size: notional,
          pre_settlement_mode: null,
        } as TradeJournal);
    }
  }
  const stored = legs.reduce((sum, leg) => sum + (leg.post_realized_pnl ?? 0), 0);
  return {
    ...fx,
    id: `${fx.id}-historical`,
    legs,
    tradeRecords: [],
    corrections: {},
    campaign: {
      ...fx.campaign,
      actual_evolution: [...events, ...(fx.campaign.actual_evolution ?? [])],
      final_realized_pnl: closedAt ? stored : null,
    },
  };
}

/**
 * 把一场随机形状改成「从已有日志腿归类」的历史战役（campaignEventFromJournal）：每条腿一条带 journal_id 的事件，
 * 事件是归类**那一刻**的快照，腿之后还会变：
 *   · 归类时已平（fresh）：事件抄成交价（第一刀）、名义与已实现（各刀之和）、平仓时刻；
 *   · 归类时还没平（stale）：事件没有平仓时间、已实现为空或 0；腿后来由 healCampaignLegSnapshots / 复盘补上；
 *   · 归类之后改过成交记录（corrected）：腿上的已实现换了，事件没跟着换；
 *   · 归类时还没成交的挂单：事件只有委托价、委托名义与挂出时刻，没有成交 id、没有已实现。
 * 页面装配时（mergeHistoricalCampaignLegs）腿的空字段由事件补上（挂单的平仓时间补成战役结束时刻）。
 * 本地成交记录：全有 / 全无 / 随机留一部分腿的（没留下的腿，平仓价校正也拉不到）。
 */
function journalClassifiedView(fx: ParityFixture, seed: number, local: 'all' | 'none' | 'partial') {
  const rnd = (() => {
    let state = (seed * 104_729 + 17) >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const iso = (ms: number) => new Date(ms).toISOString();
  const closedAt = fx.campaign.closed_at;
  const claimed = claimCampaignRecordsByLeg(fx.legs, fx.tradeRecords);
  const blank = { pending_order_id: null, notes: null, recorded_at: fx.campaign.opened_at };
  const events: CampaignEvent[] = [{
    ...blank, id: 'ev-hist', timestamp: fx.campaign.opened_at, event_type: 'historical_classification_created',
    leg_role: null, journal_id: null, trade_record_id: null, price: null, size_usdt: null,
  }];
  const tally = { stale: 0, corrected: 0, pending: 0 };
  const droppedRecordIds = new Set<string>();
  const corrections: LegExitPriceCorrections = {};
  const legs = fx.legs.map((leg): TradeJournal => {
    const records = claimed.get(leg.id) ?? [];
    const attach = {
      ...blank,
      id: `ev-attach-${leg.id}`,
      timestamp: leg.pre_simulated_time,
      event_type: 'historical_leg_attached' as const,
      leg_role: leg.leg_role,
      journal_id: leg.id,
      trade_record_id: leg.trade_record_id,
      direction: leg.direction,
    };
    if (records.length === 0) {
      if (!leg.trade_record_id && !Number.isFinite(leg.post_realized_pnl)) tally.pending += 1;
      events.push({
        ...attach,
        price: leg.pre_entry_price,
        size_usdt: leg.pre_position_size,
        open_time: leg.pre_simulated_time,
        close_time: leg.post_simulated_close_time,
        entry_price: leg.pre_entry_price,
        exit_price: leg.post_exit_price_snapshot ?? null,
        realized_pnl: leg.post_realized_pnl,
      });
      return {
        ...leg,
        post_simulated_close_time: leg.post_simulated_close_time ?? closedAt,
      };
    }
    const first = records.reduce((a, b) => (a.openTime <= b.openTime ? a : b));
    const last = records.reduce((a, b) => (a.closeTime >= b.closeTime ? a : b));
    const notional = records.reduce((sum, record) => sum + getPositionNotionalUsd(record.symbol, record, record.entryPrice), 0);
    const realized = records.reduce((sum, record) => sum + record.pnl, 0);
    const roll = rnd();
    const mode = roll < 0.35 ? 'stale' : roll < 0.55 ? 'corrected' : 'fresh';
    const legRealized = mode === 'corrected' ? realized + Math.round((rnd() - 0.5) * 4000) / 100 : realized;
    if (mode === 'stale') tally.stale += 1;
    if (mode === 'corrected') tally.corrected += 1;
    events.push({
      ...attach,
      price: first.entryPrice,
      size_usdt: notional,
      open_time: iso(first.openTime),
      close_time: mode === 'stale' ? null : iso(last.closeTime),
      entry_price: first.entryPrice,
      exit_price: mode === 'stale' ? null : last.exitPrice,
      realized_pnl: mode === 'stale' ? (rnd() < 0.5 ? null : 0) : realized,
    });
    const dropped = local === 'none' || (local === 'partial' && rnd() < 0.5);
    if (dropped) {
      for (const record of records) droppedRecordIds.add(record.id);
    } else if (fx.corrections[leg.id]) {
      corrections[leg.id] = fx.corrections[leg.id];
    }
    return {
      ...leg,
      post_realized_pnl: legRealized,
      post_simulated_close_time: iso(last.closeTime),
      post_exit_price_snapshot: last.exitPrice,
    };
  });
  const view: ParityFixture = {
    ...fx,
    id: `${fx.id}-journal-${local}`,
    legs,
    tradeRecords: local === 'none' ? [] : fx.tradeRecords.filter(record => !droppedRecordIds.has(record.id)),
    corrections,
    campaign: {
      ...fx.campaign,
      actual_evolution: [...events, ...(fx.campaign.actual_evolution ?? [])],
    },
  };
  return { view, tally };
}

/** 帮助文案（字符串 / 公式 / 告警）拼成一段，方便查口径说明。 */
function helpText(items: unknown[] | undefined): string {
  return (items ?? []).map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join('');
}

const hourBar = (hours: number, open: number, high: number, low: number, close: number): KlineData => ({
  time: PARITY_T0 + hours * PARITY_HOUR, open, high, low, close, volume: 1,
});

describe('反事实黄金对账：原样重跑 ≡ 真实盈亏概览', () => {
  it('夹具的费率与模拟器现行 Taker 费率一致', () => {
    expect(PARITY_TAKER_FEE).toBe(TAKER_FEE);
  });

  it('不比的项只有文件头列出的那几项：适配器吐出的每一个字段要么逐分比对，要么在排除清单里写明理由', () => {
    const { metrics } = rerunPanel(parityFixture('fees-everywhere'));
    const compared: Array<keyof PanelNumbers> = Object.keys(realPanel(parityFixture('fees-everywhere')).numbers) as Array<keyof PanelNumbers>;
    // dsiUsiTerm 是 asymmetricRiskContribution 里的那个数
    const covered = new Set<string>([
      // dsiUsiTerm 与两项效率是由适配器字段推出来的，不是适配器自己的字段
      ...compared.filter(key => key !== 'dsiUsiTerm' && key !== 'mainPriceEfficiency' && key !== 'addEfficiency'),
      // hasMainAdd 只决定加仓&止盈效用算不算，已随 addEfficiency 逐项比对
      'hasMainAdd',
      'asymmetricRiskContribution',
      ...EXCLUDED_BY_CONSTRUCTION,
      ...SHARED_INPUTS_AND_TEXT,
    ]);
    expect(Object.keys(metrics).filter(key => !covered.has(key))).toEqual([]);
    expect(EXCLUDED_BY_CONSTRUCTION).toEqual(['settlement', 'initialRisk']);
  });

  it.each(ALL_FIXTURES.map(fx => [fx.title, fx] as const))('%s', (_title, fx) => {
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    // 相对实际 = 分支已实现 − 页面印的已实现（叠了平仓价校正的现算值）；页面按两位小数印成 +0.00
    const delta = rerun.result.final_realized_pnl - real.actualPnl;
    const mismatches = parityMismatches(real.numbers, rerun.numbers, fx.exclusions);
    if (Math.abs(delta) >= 0.005) mismatches.push(`相对实际 ${delta.toFixed(4)} ≠ 0.00`);
    expect(mismatches, fx.id).toEqual([]);
    // 结果按净额落库，并写明扣掉了多少
    expect(typeof rerun.result.fees_total).toBe('number');
    // 排除项必须写明理由，且只能是真实面板自己的局限
    for (const reason of Object.values(fx.exclusions ?? {})) expect(reason?.length ?? 0).toBeGreaterThan(20);
  });

  it('随机形状 400 场（多主力、先挂后成交、并仓加仓、分刀、校正、本地无记录、进行中……）逐项对上', () => {
    const failures: string[] = [];
    const shapes = Array.from({ length: 400 }, (_value, index) => randomParityFixture(index + 1));
    for (const fx of shapes) {
      const real = realPanel(fx);
      const rerun = rerunPanel(fx);
      const mismatches = parityMismatches(real.numbers, rerun.numbers);
      const delta = rerun.result.final_realized_pnl - real.actualPnl;
      if (Math.abs(delta) >= 0.005) mismatches.push(`相对实际 ${delta.toFixed(4)} ≠ 0.00`);
      if (mismatches.length > 0) failures.push(`${fx.id}: ${mismatches.join('；')}`);
    }
    expect(failures.slice(0, 8)).toEqual([]);
    // 这批形状确实覆盖到了要守的几类
    expect(shapes.filter(fx => fx.legs.filter(leg => leg.leg_role === 'main_open').length > 1).length).toBeGreaterThan(100);
    expect(shapes.filter(fx => fx.tradeRecords.length === 0).length).toBeGreaterThan(20);
    expect(shapes.filter(fx => fx.campaign.closed_at == null).length).toBeGreaterThan(30);
    expect(shapes.filter(fx => fx.tradeRecords.some(record => record.fillId === 'fill-add')).length).toBeGreaterThan(50);
  }, 60_000);

  it('历史归类、换了浏览器的随机形状 300 场（事件还原的腿、按事件合成的腿、缺平仓时间 / 已实现）：已结束的逐项对上；进行中的只差峰值浮盈', () => {
    const failures: string[] = [];
    let closed = 0;
    let synthesized = 0;
    let fromJournal = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const fx = historicalView(randomParityFixture(seed), seed);
      if (!fx) continue;
      const active = fx.campaign.closed_at == null;
      if (!active) closed += 1;
      if (fx.legs.some(leg => leg.id.startsWith('record-'))) synthesized += 1;
      if (fx.campaign.actual_evolution.some(event => event.event_type === 'historical_leg_attached' && event.journal_id)) fromJournal += 1;
      const real = realPanel(fx);
      const rerun = rerunPanel(fx);
      // 进行中的战役：真实面板的权益路径只扫到最晚一条成交记录（本地一条都没有时就是开仓那一刻），这是说明里写明的例外
      const mismatches = parityMismatches(real.numbers, rerun.numbers, active ? { peakUnrealizedPnl: 'active' } : {});
      const delta = rerun.result.final_realized_pnl - real.actualPnl!;
      if (Math.abs(delta) >= 0.005) mismatches.push(`相对实际 ${delta.toFixed(4)} ≠ 0.00`);
      if (mismatches.length > 0) failures.push(`${fx.id}: ${mismatches.join('；')}`);
    }
    expect(failures.slice(0, 8)).toEqual([]);
    expect(closed).toBeGreaterThan(150);
    expect(synthesized).toBeGreaterThan(100);
    expect(fromJournal).toBeGreaterThan(100);
  }, 60_000);

  it('排除清单只有「进行中的战役」的峰值浮盈（真实面板只扫到最晚一条成交记录，之后的持仓看不到）', () => {
    const excluded = ALL_FIXTURES.flatMap(fx => Object.keys(fx.exclusions ?? {}).map(key => `${fx.id}.${key}`));
    expect(excluded).toEqual([
      'sim-active-open-main.peakUnrealizedPnl',
      'sim-active-snapshot-after-records.peakUnrealizedPnl',
    ]);
    for (const id of ['sim-active-open-main', 'sim-active-snapshot-after-records']) {
      expect(parityFixture(id).campaign.closed_at, id).toBeNull();
    }
  });
});

describe('反事实黄金对账：三处曾经的分叉各自钉住', () => {
  it('平仓价校正：真实峰值不再带着未校正的 +280 幻影利润', () => {
    const fx = parityFixture('exit-correction');
    const real = realPanel(fx);
    expect(real.numbers.realizedPnl).toBeCloseTo(120, 6);
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(320, 6);
    expect(rerunPanel(fx).numbers.peakUnrealizedPnl).toBeCloseTo(320, 2);
  });

  it('初始对冲从未成交：不计入持仓，但仍是定义 L 与预期回撤的那条止损线', () => {
    const fx = parityFixture('unfilled-hedge');
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(300, 6);
    expect(rerun.numbers.peakUnrealizedPnl).toBeCloseTo(300, 2);
    const hedge = rerun.manualLegs.find(leg => leg.leg_role === 'hedge_initial_a');
    expect(hedge?.filled).toBe(false);
    expect(hedge?.enabled).toBe(true);
    // L = 1000 × 5%，d = 5%——止损线没有因为「未成交」而消失
    expect(rerun.numbers.initialExpectedMaxLoss).toBeCloseTo(50, 4);
    expect(rerun.numbers.expectedMaxDrawdownPct).toBeCloseTo(5, 4);
    expect(rerun.metrics.payoffRatio).toBeCloseTo(real.numbers.payoffRatio!, 2);
    // 成交过的腿不带 filled 字段（缺省即已成交），老行照旧
    expect(rerun.manualLegs.find(leg => leg.leg_role === 'main_open')).not.toHaveProperty('filled');
  });

  it('手续费：已实现按记录净额（毛盈亏 − 平仓费），fees_total 就是扣掉的平仓费', () => {
    const fx = parityFixture('fees-everywhere');
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    const closeFees = fx.tradeRecords.reduce((sum, record) => sum + record.fee, 0);
    const openFees = fx.tradeRecords.reduce((sum, record) => sum + (record.openFeeUsd ?? 0), 0);
    expect(closeFees).toBeGreaterThan(0);
    expect(rerun.result.fees_total).toBeCloseTo(closeFees, 4);
    expect(rerun.result.open_fees_total).toBeCloseTo(openFees, 4);
    expect(rerun.result.final_realized_pnl).toBeCloseTo(real.actualPnl, 2);
  });

  it('只剩快照的腿：原样重跑直接用 post_realized_pnl，不按开平价重算毛盈亏', () => {
    const fx = parityFixture('snapshot-leg');
    const rerun = rerunPanel(fx);
    const snapshot = rerun.result.legs_summary.find(leg => leg.leg_role === 'main_add_1');
    expect(snapshot?.realized_pnl_usdt).toBeCloseTo(39.5, 4);
  });
});

describe('反事实黄金对账：模拟器实跑的形状', () => {
  it('主力 + 镜像并仓、镜像止盈按比例减仓：真实峰值按两刀各自的时点还原（≈ 300），不再只持有最后一刀的量', () => {
    const fx = parityFixture('sim-merged-mirror');
    const real = realPanel(fx);
    // 01:00 这根高点 130：10 个全仓都还在（01:30 才减仓），(130 − 100.01) × 10 ≈ 299.9
    expect(real.numbers.peakUnrealizedPnl!).toBeGreaterThan(299);
    expect(real.numbers.peakUnrealizedPnl!).toBeLessThan(300);
    expect(rerunPanel(fx).numbers.peakUnrealizedPnl).toBeCloseTo(real.numbers.peakUnrealizedPnl!, 2);
  });

  it('副本里的实际成交：并仓后的两条腿各带两刀、收盘那一刀排最后；对冲带委托价锚；成交时刻未知的对冲标 off_path', () => {
    const merged = copyOf(parityFixture('sim-merged-mirror')).manualLegs;
    for (const id of ['main', 'mirror']) {
      const cuts = merged.find(leg => leg.id === id)?.actual?.cuts ?? [];
      expect(cuts, id).toHaveLength(2);
      expect(cuts[0].close_time).toBe('2026-01-01T01:30:00.000Z');
      expect(cuts[1].close_time).toBe('2026-01-01T03:00:00.000Z');
      expect(cuts[0].close_fee_rate).toBe(PARITY_TAKER_FEE);
    }
    const slippedHedge = copyOf(parityFixture('sim-slipped-hedge')).manualLegs.find(leg => leg.id === 'hedge-a');
    expect(slippedHedge?.entry_price).toBeLessThan(98);
    expect(slippedHedge?.actual?.anchor_price).toBe(98);
    const noLocal = copyOf(parityFixture('sim-no-local-records')).manualLegs;
    expect(noLocal.find(leg => leg.id === 'hedge-a')?.actual).toMatchObject({ source: 'leg_snapshot', off_path: true });
    expect(noLocal.find(leg => leg.id === 'main')?.actual).not.toHaveProperty('off_path');
    const active = copyOf(parityFixture('sim-active-open-main')).manualLegs.find(leg => leg.id === 'main');
    expect(active?.actual).toMatchObject({ source: 'unsettled', close_time_fallback: true, still_open: true });
  });

  it('L 只有几美元时盈亏比照样逐分对上：L 与已实现按 8 位小数落库', () => {
    const fx = parityFixture('sim-slippage');
    const tiny: ParityFixture = {
      ...fx,
      tradeRecords: fx.tradeRecords.map(record => ({ ...record, quantity: record.quantity / 3000, pnl: record.pnl / 3000, fee: record.fee / 3000 })),
      legs: fx.legs.map(leg => ({ ...leg, pre_position_size: (leg.pre_position_size ?? 0) / 3000 })),
    };
    const real = realPanel(tiny);
    const rerun = rerunPanel(tiny);
    expect(real.numbers.initialExpectedMaxLoss!).toBeLessThan(0.05);
    expect(rerun.result.initial_expected_max_loss).toBeCloseTo(real.numbers.initialExpectedMaxLoss!, 8);
    expect(Math.abs(rerun.numbers.payoffRatio! - real.numbers.payoffRatio!)).toBeLessThan(0.01);
  });

  it('市价滑点：主力开仓名义仓位按成交记录（1000.10），副本的「仓位」格仍显示委托时写下的 1000', () => {
    const fx = parityFixture('sim-slippage');
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    expect(real.numbers.initialMainExposureNotional).toBeCloseTo(1000.1, 2);
    expect(rerun.numbers.initialMainExposureNotional).toBeCloseTo(1000.1, 2);
    expect(rerun.manualLegs.find(leg => leg.id === 'main')?.size_usdt).toBe(1000);
  });

  it('风险锚：对冲按计划价（98 / 96），不按滑点成交价；只在委托里的对冲 B 也算进止损线', () => {
    for (const id of ['sim-slipped-hedge', 'sim-reverse-order-only', 'sim-historical-reverse', 'tut-corrected-loss']) {
      const fx = parityFixture(id);
      const real = realPanel(fx);
      const rerun = rerunPanel(fx);
      expect(rerun.numbers.initialExpectedMaxLoss, id).toBeCloseTo(real.numbers.initialExpectedMaxLoss!, 2);
      expect(rerun.numbers.expectedMaxDrawdownPct, id).toBeCloseTo(real.numbers.expectedMaxDrawdownPct!, 4);
    }
    // TUT：计划价在入场下方 10%，L = 10% × 107,066
    expect(realPanel(parityFixture('tut-corrected-loss')).numbers.initialExpectedMaxLoss).toBeCloseTo(10_706.6, 1);
  });

  it('回场对冲一张挂着：副本标「挂单中」、不持有；快照对冲按事件流里的触发时刻持有', () => {
    const reentry = rerunPanel(parityFixture('sim-reentry-pending'));
    expect(reentry.manualLegs.find(leg => leg.id === 'rehedge-2')?.filled).toBe(false);
    expect(reentry.manualLegs.find(leg => leg.id === 'rehedge-1')).not.toHaveProperty('filled');
    const snapshot = rerunPanel(parityFixture('sim-snapshot-hedge-triggered'));
    expect(snapshot.manualLegs.find(leg => leg.id === 'hedge-a')?.open_time).toBe('2026-01-01T02:10:00.000Z');
  });
});

describe('相对实际只反映改动：从原样副本改一格，挪动的量恰是这一格值多少钱', () => {
  const bump = (id: string, patch: (leg: CampaignCounterfactualManualLeg) => Partial<CampaignCounterfactualManualLeg>) =>
    (legs: CampaignCounterfactualManualLeg[]) => legs.map(leg => (leg.id === id ? { ...leg, ...patch(leg) } : leg));

  it('M 减仓 50%：主力平仓价 +0.01 只挪最后那一刀的量（5 个），不把前一刀的 104 抹成全仓平在 110', () => {
    const fx = parityFixture('sim-m-reduce');
    const unchanged = rerunPanel(fx);
    const edited = rerunPanel(fx, bump('main', leg => ({ exit_price: leg.exit_price + 0.01 })));
    const last = closingRecord(fx.tradeRecords, 'pos-main');
    const worth = editWorth(last.quantity, last.exitPrice, last.exitPrice + 0.01, 'LONG', last.closeFeeRate!);
    expect(edited.result.final_realized_pnl - unchanged.result.final_realized_pnl).toBeCloseTo(worth, 6);
    expect(worth).toBeCloseTo(0.05, 3);
  });

  it('主力 + 镜像并仓：两条腿各挪各自最后一刀的量', () => {
    const fx = parityFixture('sim-merged-mirror');
    const unchanged = rerunPanel(fx).result.final_realized_pnl;
    const mainLast = closingRecord(fx.tradeRecords, 'pos-main');
    const mirrorLast = closingRecord(fx.tradeRecords, 'fill-mirror', true);
    const mainEdited = rerunPanel(fx, bump('main', leg => ({ exit_price: leg.exit_price + 0.01 }))).result.final_realized_pnl;
    const mirrorEdited = rerunPanel(fx, bump('mirror', leg => ({ exit_price: leg.exit_price + 0.01 }))).result.final_realized_pnl;
    expect(mainEdited - unchanged).toBeCloseTo(editWorth(mainLast.quantity, mainLast.exitPrice, mainLast.exitPrice + 0.01, 'LONG', mainLast.closeFeeRate!), 6);
    expect(mirrorEdited - unchanged).toBeCloseTo(editWorth(mirrorLast.quantity, mirrorLast.exitPrice, mirrorLast.exitPrice + 0.01, 'LONG', mirrorLast.closeFeeRate!), 6);
    expect(mainEdited - unchanged).toBeCloseTo(0.016, 3);
    expect(mirrorEdited - unchanged).toBeCloseTo(0.024, 3);
  });

  it('2026-09-12 之前的老记录（存的是 0.04% 的平仓费、没有费率字段）：+0.01 值 +8.9964，按记录自己的费率', () => {
    const fx = parityFixture('plain-long');
    const legacyFee = 900 * 110 * 0.0004;
    const record: TradeRecord = { ...fx.tradeRecords[0], quantity: 900, pnl: 900 * 10 - legacyFee, fee: legacyFee };
    const legacy: ParityFixture = {
      ...fx,
      tradeRecords: [record],
      legs: fx.legs.map(leg => ({ ...leg, pre_position_size: 90_000 })),
      campaign: { ...fx.campaign, final_realized_pnl: record.pnl },
    };
    const unchanged = rerunPanel(legacy);
    expect(unchanged.result.final_realized_pnl).toBeCloseTo(realPanel(legacy).actualPnl, 6);
    const edited = rerunPanel(legacy, bump('main', leg => ({ exit_price: 110.01 })));
    expect(edited.result.final_realized_pnl - unchanged.result.final_realized_pnl).toBeCloseTo(9 - 900 * 0.01 * 0.0004, 6);
  });

  it('币本位并仓空单：平仓价 −10 按最后一刀的张数挪（张数 × 面值 × 10 / 平仓价 − 0 费率变化）', () => {
    const fx = parityFixture('sim-coin-merged');
    const unchanged = rerunPanel(fx);
    const edited = rerunPanel(fx, bump('main', leg => ({ exit_price: leg.exit_price - 10 })));
    const last = closingRecord(fx.tradeRecords, 'pos-main');
    const notional = last.quantity * (last.contractSizeUsd ?? 100);
    // 币本位毛盈亏（折美元）= 名义 × (1 − 平仓价 / 开仓价)，手续费 = 名义 × 费率，与平仓价无关
    const worth = notional * (10 / last.entryPrice);
    expect(edited.result.final_realized_pnl - unchanged.result.final_realized_pnl).toBeCloseTo(worth, 6);
  });

  it('改开仓时间不改钱：已实现一分不动', () => {
    const fx = parityFixture('sim-merged-mirror');
    const unchanged = rerunPanel(fx).result.final_realized_pnl;
    const moved = rerunPanel(fx, bump('main', leg => ({ open_time: new Date(Date.parse(leg.open_time) + 60_000).toISOString() })));
    expect(moved.result.final_realized_pnl).toBe(unchanged);
  });
});

describe('口径统一之前保存的分支：换了 K 线窗口也不读成「改过」', () => {
  /** 老行：腿上没有 actual / filled，挂单与未结算腿的平仓时间是保存那一刻 K 线窗口的末根。 */
  const legacyRow = (legs: CampaignCounterfactualManualLeg[], windowEnd: string) => legs.map(leg => {
    const { actual: _actual, filled: _filled, settlement_mode: _mode, contract_size_usd: _face, ...rest } = leg;
    const fallback = leg.filled === false || leg.actual?.close_time_fallback === true;
    return fallback ? { ...rest, close_time: windowEnd } : rest;
  });

  it('初始对冲从未成交：偏离代价为空；载回重跑与上方同一峰值（300，而不是把挂单当成交的 125）', () => {
    const fx = parityFixture('unfilled-hedge');
    const { base, manualLegs: baseline } = copyOf(fx);
    const saved = legacyRow(baseline, '2026-01-01T03:45:00.000Z');
    expect(computeManualLegDeviationCosts(baseline, saved)).toEqual([]);
    expect(computeManualLegDeviationCosts(baseline, saved, '2026-01-01T03:45:00.000Z')).toEqual([]);

    const byId = new Map(baseline.map(leg => [leg.id, leg]));
    const loaded = saved.map(leg => adoptBaselineLegFacts({ ...leg }, byId.get(leg.id), null));
    expect(loaded.find(leg => leg.id === 'hedge-a')?.filled).toBe(false);
    const { result } = runLegs(fx, base, loaded);
    expect(result.peak_unrealized_pnl).toBeCloseTo(realPanel(fx).numbers.peakUnrealizedPnl!, 2);
    expect(result.final_realized_pnl - realPanel(fx).actualPnl).toBeCloseTo(0, 6);
    expect(buildCounterfactualChangeSummary(baseline, loaded, loaded).lines).toEqual([]);
  });

  it('未触发的镜像止盈（未结算）+ 挂着的 A/B：换窗口不印假代价', () => {
    const fx = parityFixture('mirror-tp');
    const pendingMirror: ParityFixture = {
      ...fx,
      legs: fx.legs.map(leg => (leg.id === 'mirror'
        ? { ...leg, trade_record_id: null, post_simulated_close_time: null, post_exit_price_snapshot: null, pre_entry_price: 104 }
        : leg)),
      tradeRecords: fx.tradeRecords.filter(record => record.id !== 'mirror-rec'),
    };
    const { manualLegs: baseline } = copyOf(pendingMirror);
    expect(baseline.find(leg => leg.id === 'mirror')?.actual).toMatchObject({ source: 'unsettled', close_time_fallback: true });
    const saved = legacyRow(baseline, '2026-01-01T04:00:00.000Z');
    expect(computeManualLegDeviationCosts(baseline, saved)).toEqual([]);
  });
});

describe('第二轮复核的几处分叉', () => {
  it('两笔主力先后开：各自的 A/B 归各自的主力（主力 1 01:00 已平，主力 2 的限价单 01:15 挂、01:30 成交）', () => {
    const fx = parityFixture('sim-two-mains-sequential');
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    // 主力 1：1000 × 4%；主力 2：2200 × (110 − 104) / 110
    expect(real.numbers.initialExpectedMaxLoss!).toBeGreaterThan(160);
    expect(rerun.numbers.initialExpectedMaxLoss).toBeCloseTo(real.numbers.initialExpectedMaxLoss!, 2);
    expect(rerun.numbers.expectedMaxDrawdownPct).toBeCloseTo(real.numbers.expectedMaxDrawdownPct!, 4);
    // 主力 2 的挂出时刻（01:15）与成交时刻（01:30）分开记
    const main2 = rerun.manualLegs.find(leg => leg.id === 'main2');
    expect(main2?.open_time).toBe('2026-01-01T01:30:00.000Z');
    expect(main2?.actual).toMatchObject({ placed_time: '2026-01-01T01:15:00.000Z', has_record: true });
  });

  it('并进主力、没有腿的加仓：名义仓位不算它；平仓价 +0.01 按同一时刻平掉的 15 个挪，副本不把它列成「先平」', () => {
    const fx = parityFixture('sim-merged-add-no-leg');
    const real = realPanel(fx);
    const unchanged = rerunPanel(fx);
    expect(real.numbers.initialMainExposureNotional).toBeCloseTo(1000.1, 2);
    expect(unchanged.numbers.initialMainExposureNotional).toBeCloseTo(1000.1, 2);
    const main = unchanged.manualLegs.find(leg => leg.id === 'main');
    expect(main?.actual?.cuts).toHaveLength(2);
    expect(earlierClosedCuts(main?.actual)).toEqual([]);
    const edited = rerunPanel(fx, legs => legs.map(leg => (leg.id === 'main' ? { ...leg, exit_price: leg.exit_price + 0.01 } : leg)));
    const worth = fx.tradeRecords.reduce((sum, record) => sum + editWorth(record.quantity, record.exitPrice, record.exitPrice + 0.01, 'LONG', record.closeFeeRate!), 0);
    expect(fx.tradeRecords.reduce((sum, record) => sum + record.quantity, 0)).toBeCloseTo(15, 9);
    expect(edited.result.final_realized_pnl - unchanged.result.final_realized_pnl).toBeCloseTo(worth, 6);
    // 并仓的镜像止盈：先平的那一刀照样列出来
    const merged = copyOf(parityFixture('sim-merged-mirror')).manualLegs.find(leg => leg.id === 'main');
    expect(earlierClosedCuts(merged?.actual)).toHaveLength(1);
  });

  it('一条腿都结算不了：总额摊到腿上（余差记在主力上），原样重跑复现；改一格只挪这一格的钱；停用主力减去它那一份', () => {
    const fx = parityFixture('sim-no-settlement-stored');
    const unchanged = rerunPanel(fx);
    const main = unchanged.manualLegs.find(leg => leg.id === 'main');
    expect(main?.actual).toMatchObject({ source: 'campaign_total', realized_pnl_usdt: 99.4 });
    expect(unchanged.result.final_realized_pnl).toBeCloseTo(99.4, 6);
    expect(unchanged.result.legs_summary.find(leg => leg.leg_role === 'main_open')?.pnl_basis).toBe('campaign_total');
    expect(unchanged.result.fee_unknown_leg_count).toBe(1);
    // 主力的平仓价（没有快照，按开仓价 100）+1：10 个 × 1 − 平仓费变化（Taker）
    const edited = rerunPanel(fx, legs => legs.map(leg => (leg.id === 'main' ? { ...leg, exit_price: 101 } : leg)));
    expect(edited.result.final_realized_pnl - 99.4).toBeCloseTo(10 - 10 * 1 * PARITY_TAKER_FEE, 6);
    const disabled = rerunPanel(fx, legs => legs.map(leg => (leg.id === 'main' ? { ...leg, enabled: false } : leg)));
    expect(disabled.result.final_realized_pnl).toBe(0);
    // 帮助里写明这个口径
    const help = (unchanged.metrics.helpOverrides?.realizedPnl ?? []).map(item => (typeof item === 'string' ? item : JSON.stringify(item))).join('');
    expect(help).toContain('一条腿都结算不了');
  });

  it('同一角色两张初始对冲：按挂出时刻取第一张（98），不按成交时刻', () => {
    const fx = parityFixture('sim-hedge-placed-early');
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    expect(real.numbers.expectedMaxDrawdownPct!).toBeCloseTo(4.0096, 3);
    expect(rerun.numbers.expectedMaxDrawdownPct).toBeCloseTo(real.numbers.expectedMaxDrawdownPct!, 6);
    expect(rerun.manualLegs.find(leg => leg.id === 'hedge-a')?.actual?.placed_time).toBe('2026-01-01T00:00:00.000Z');
  });

  it('老分支（9962e7e7 原样写下的腿）：有触发事件的对冲按挂出时刻存的开仓时间换回触发时刻，不读成改动，重跑峰值与上方相同', () => {
    const fx = parityFixture('sim-snapshot-hedge-triggered');
    const { base, manualLegs: baseline } = copyOf(fx);
    const saved = legacyBuildManualLegs(base, fx.legs, fx.klines, fx.tradeRecords, fx.corrections);
    expect(saved.find(leg => leg.id === 'hedge-a')?.open_time).toBe('2026-01-01T00:00:00.000Z');
    const windowEnd = defaultCloseTime(base, fx.klines);
    expect(computeManualLegDeviationCosts(baseline, saved, windowEnd)).toEqual([]);
    const loaded = loadRow(baseline, saved, windowEnd);
    expect(loaded.find(leg => leg.id === 'hedge-a')?.open_time).toBe('2026-01-01T02:10:00.000Z');
    expect(buildCounterfactualChangeSummary(baseline, loaded, loaded).lines).toEqual([]);
    const { result } = runLegs(fx, base, loaded);
    const real = realPanel(fx);
    expect(result.peak_unrealized_pnl).toBeCloseTo(real.numbers.peakUnrealizedPnl!, 2);
    expect(result.final_realized_pnl - real.actualPnl).toBeCloseTo(0, 6);
  });

  it('老分支的未结算腿：保存时的 K 线窗口（1h，末根 05:00）与运行时（15m，末根 05:45）不同，兜底平仓时间照样认出来', () => {
    const base = parityFixture('mirror-tp');
    const spiky = [...base.klines, hourBar(4, 110, 150, 109, 112), hourBar(5, 112, 113, 111, 112)];
    const fx: ParityFixture = {
      ...base,
      klines: spiky,
      legs: base.legs.map(leg => (leg.id === 'mirror'
        ? { ...leg, trade_record_id: null, post_simulated_close_time: null, post_exit_price_snapshot: null, pre_entry_price: 104 }
        : leg)),
      tradeRecords: base.tradeRecords.filter(record => record.id !== 'mirror-rec'),
    };
    const { base: params, manualLegs: baseline } = copyOf(fx);
    const saved = legacyBuildManualLegs(params, fx.legs, spiky, fx.tradeRecords, fx.corrections);
    expect(saved.find(leg => leg.id === 'mirror')?.close_time).toBe('2026-01-01T05:00:00.000Z');
    const windowEnd = '2026-01-01T05:45:00.000Z';
    expect(computeManualLegDeviationCosts(baseline, saved, windowEnd)).toEqual([]);
    const loaded = loadRow(baseline, saved, windowEnd);
    expect(buildCounterfactualChangeSummary(baseline, loaded, loaded).lines).toEqual([]);
    const { result } = runLegs(fx, params, loaded);
    expect(result.peak_unrealized_pnl).toBeCloseTo(realPanel(fx).numbers.peakUnrealizedPnl!, 2);
    // 改过平仓时间的老行照样保留（早于战役结束时刻，不可能是老窗口的末根）
    const editedClose = saved.map(leg => (leg.id === 'mirror' ? { ...leg, close_time: '2026-01-01T02:00:00.000Z' } : leg));
    expect(loadRow(baseline, editedClose, windowEnd).find(leg => leg.id === 'mirror')?.close_time).toBe('2026-01-01T02:00:00.000Z');
  });

  it('进行中的战役：新分支载回时 K 线窗口已经往后长了，未平仓腿的兜底平仓时间跟着换，不读成改动', () => {
    const fx = parityFixture('sim-active-open-main');
    const { base, manualLegs: savedBaseline } = copyOf(fx);
    const grown = [...fx.klines, hourBar(4, 110, 111, 109, 110)];
    const baselineNow = buildManualLegs(base, fx.legs, grown, fx.tradeRecords, fx.corrections, { campaign: fx.campaign });
    expect(baselineNow.find(leg => leg.id === 'main')?.close_time).toBe('2026-01-01T04:00:00.000Z');
    const loaded = loadRow(baselineNow, savedBaseline, '2026-01-01T03:00:00.000Z');
    const main = loaded.find(leg => leg.id === 'main');
    expect(main?.close_time).toBe('2026-01-01T04:00:00.000Z');
    expect(main?.actual).toMatchObject({ close_time: '2026-01-01T04:00:00.000Z', still_open: true });
    expect(buildCounterfactualChangeSummary(baselineNow, loaded, loaded).lines).toEqual([]);
    // 用户改过的平仓时间不动
    const edited = savedBaseline.map(leg => (leg.id === 'main' ? { ...leg, close_time: '2026-01-01T02:00:00.000Z' } : leg));
    expect(loadRow(baselineNow, edited, null).find(leg => leg.id === 'main')?.close_time).toBe('2026-01-01T02:00:00.000Z');
  });
});

describe('第三轮复核的几处分叉', () => {
  it('历史归类、本地没有成交记录：只在事件里的对冲，战役页持有它，副本也持有（峰值 140，不是把它丢掉的 300）', () => {
    const fx = parityFixture('sim-hist-event-hedge');
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    // 01:00 那根高点 130：主力 (130 − 100) × 10 = 300，空头对冲 (98 − 130) × 5 = −160
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(140, 6);
    expect(rerun.numbers.peakUnrealizedPnl).toBeCloseTo(140, 2);
    const hedge = rerun.manualLegs.find(leg => leg.id === 'record-rec-a');
    expect(hedge?.actual).toMatchObject({ source: 'leg_snapshot' });
    expect(hedge?.actual).not.toHaveProperty('off_path');
    expect(hedge?.open_time).toBe('2026-01-01T00:30:00.000Z');
    // 事件流里没有它的快照事件时，真的不知道它何时成交：两边都不持有
    const noEvent: ParityFixture = {
      ...fx,
      campaign: {
        ...fx.campaign,
        actual_evolution: fx.campaign.actual_evolution.filter(event => event.trade_record_id !== 'rec-a'),
      },
    };
    expect(copyOf(noEvent).manualLegs.find(leg => leg.id === 'record-rec-a')?.actual).toMatchObject({ off_path: true });
    expect(realPanel(noEvent).numbers.peakUnrealizedPnl).toBeCloseTo(300, 6);
    expect(rerunPanel(noEvent).numbers.peakUnrealizedPnl).toBeCloseTo(300, 2);
  });

  it('历史归类、每条腿都只在事件里：同一个仓位只持有一次（真实峰值 300，不是 600），副本相同，已实现不动', () => {
    const fx = parityFixture('sim-hist-event-only');
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(300, 6);
    expect(rerun.numbers.peakUnrealizedPnl).toBeCloseTo(300, 2);
    expect(real.numbers.realizedPnl).toBeCloseTo(99.45 - 15.25, 6);
    expect(rerun.result.final_realized_pnl).toBeCloseTo(real.actualPnl!, 6);
    // 两条腿都在路径上（对冲 02:10–02:50 按事件持有）
    expect(rerun.manualLegs.map(leg => [leg.id, leg.actual?.off_path ?? false, leg.open_time.slice(11, 16), leg.close_time.slice(11, 16)])).toEqual([
      ['record-rec-main', false, '00:00', '03:00'],
      ['record-rec-a', false, '02:10', '02:50'],
    ]);
  });

  it('历史归类、从日志腿归类：事件里的成交价与委托价不同，副本按事件的成交持有；未结算的同形腿也一样', () => {
    const fx = parityFixture('sim-hist-event-fill-price');
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    const fill = fx.campaign.actual_evolution.find(event => event.journal_id === 'hedge-a');
    expect(fill?.entry_price).toBeLessThan(98);
    // 空头对冲按成交价 97.99… 持有：01:00 那根高点上比按委托价 98 多亏 (98 − 成交价) × 5
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(300 - (130 - fill!.entry_price!) * 5, 6);
    expect(rerun.numbers.peakUnrealizedPnl).toBeCloseTo(real.numbers.peakUnrealizedPnl, 2);
    const hedge = rerun.manualLegs.find(leg => leg.id === 'hedge-a');
    // 格子仍显示 Legs 表的委托价与委托名义；持仓那一刀取事件
    expect(hedge).toMatchObject({ entry_price: 98, size_usdt: 490 });
    expect(hedge?.actual?.cuts).toHaveLength(1);
    expect(hedge?.actual?.cuts?.[0].entry_price).toBe(fill!.entry_price);
    expect(hedge?.actual?.cuts?.[0].size_usdt).toBeCloseTo(fill!.size_usdt!, 9);
    // 主力的事件与委托快照描述同一笔，路径上按委托快照（事件不再放一遍），副本也没有这一刀
    expect(rerun.manualLegs.find(leg => leg.id === 'main')?.actual).not.toHaveProperty('cuts');

    const unsettled: ParityFixture = {
      ...fx,
      legs: fx.legs.map(leg => (leg.id === 'hedge-a' ? { ...leg, post_realized_pnl: null } : leg)),
      campaign: {
        ...fx.campaign,
        actual_evolution: fx.campaign.actual_evolution.map(event => (event.journal_id === 'hedge-a' ? { ...event, realized_pnl: null } : event)),
      },
    };
    const unsettledRerun = rerunPanel(unsettled);
    expect(unsettledRerun.manualLegs.find(leg => leg.id === 'hedge-a')?.actual).toMatchObject({ source: 'unsettled' });
    expect(parityMismatches(realPanel(unsettled).numbers, unsettledRerun.numbers)).toEqual([]);
  });

  it('触发后又撤单的老对冲（没有平仓时间）：副本按撤单时刻平，峰值与上方相同（299.90，不是持有到结束的 139.90）', () => {
    const fx = parityFixture('sim-hedge-cancelled-after-trigger');
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(299.9, 1);
    expect(rerun.numbers.peakUnrealizedPnl).toBeCloseTo(real.numbers.peakUnrealizedPnl, 2);
    const hedge = rerun.manualLegs.find(leg => leg.id === 'hedge-a');
    expect(hedge).toMatchObject({ open_time: '2026-01-01T00:10:00.000Z', close_time: '2026-01-01T00:20:00.000Z' });
    expect(hedge?.actual).toMatchObject({ source: 'unsettled' });
    expect(hedge?.actual).not.toHaveProperty('close_time_fallback');

    // 9962e7e7 的老分支：对冲按挂出时刻开、收在当时 K 线窗口的末根；改动摘要里没有它 → 载回换成触发与撤单时刻
    const { base, manualLegs: baseline } = copyOf(fx);
    const saved = legacyBuildManualLegs(base, fx.legs, fx.klines, fx.tradeRecords, fx.corrections);
    expect(saved.find(leg => leg.id === 'hedge-a')).toMatchObject({ open_time: '2026-01-01T00:00:00.000Z', close_time: '2026-01-01T03:00:00.000Z' });
    const summary = buildCounterfactualChangeSummary(saved, saved, saved);
    const windowEnd = defaultCloseTime(base, fx.klines);
    const loaded = loadRow(baseline, saved, windowEnd, summary);
    expect(loaded.find(leg => leg.id === 'hedge-a')).toMatchObject({ open_time: '2026-01-01T00:10:00.000Z', close_time: '2026-01-01T00:20:00.000Z' });
    expect(buildCounterfactualChangeSummary(baseline, loaded, loaded).lines).toEqual([]);
    expect(runLegs(fx, base, loaded).result.peak_unrealized_pnl).toBeCloseTo(real.numbers.peakUnrealizedPnl, 2);
  });

  it('进行中的战役里只剩快照、在最后一条成交之后才平的腿：真实面板看不到它，这一场列入排除，说明里写明', () => {
    const fx = parityFixture('sim-active-snapshot-after-records');
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    // 真实面板扫到 00:50 就停：01:00 那根 130 的高点只在副本里
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(real.actualPnl!, 6);
    expect(rerun.numbers.peakUnrealizedPnl).toBeGreaterThan(real.numbers.peakUnrealizedPnl + 50);
    expect(parityMismatches(real.numbers, rerun.numbers, fx.exclusions)).toEqual([]);
    const note = helpText(rerun.metrics.extraNotes?.peakUnrealizedPnl);
    expect(note).toContain('进行中的战役');
    expect(note).toContain('只剩复盘快照或事件快照且在那之后才平的腿');
    expect(note).toContain('本地一条成交记录都没有时只到开仓那一刻');
  });

  it('只剩快照的腿改了平仓价：平仓费的变化按 Taker 扣进它的盈亏，不进 fees_total；成交记录腿改价时 fees_total 按改后的价重算', () => {
    const fx = parityFixture('snapshot-leg');
    const unchanged = rerunPanel(fx);
    const add = unchanged.manualLegs.find(leg => leg.id === 'add-1')!;
    const qty = add.size_usdt / add.entry_price;
    const edited = rerunPanel(fx, legs => legs.map(leg => (leg.id === 'add-1' ? { ...leg, exit_price: leg.exit_price + 10 } : leg)));
    expect(edited.result.final_realized_pnl - unchanged.result.final_realized_pnl).toBeCloseTo(10 * qty - 10 * qty * TAKER_FEE, 6);
    expect(edited.result.fees_total).toBe(unchanged.result.fees_total);
    expect(edited.result.legs_summary.find(leg => leg.leg_role === 'main_add_1')?.close_fee_usdt).toBe(0);
    expect(edited.result.fee_unknown_leg_count).toBe(1);
    const help = helpText(edited.metrics.helpOverrides?.realizedPnl);
    expect(help).toContain('另有 1 条腿只剩复盘快照或摊自战役级已实现');
    expect(help).toContain('平仓手续费随之变化的部分按模拟器 Taker 费率扣进它们的盈亏，同样不在上面的数里');

    const withFees = parityFixture('fees-everywhere');
    const before = rerunPanel(withFees);
    const record = withFees.tradeRecords.find(item => item.id === 'main-rec')!;
    const after = rerunPanel(withFees, legs => legs.map(leg => (leg.id === 'main' ? { ...leg, exit_price: leg.exit_price + 10 } : leg)));
    expect(after.result.fees_total! - before.result.fees_total!).toBeCloseTo(record.quantity * 10 * TAKER_FEE, 4);
  });

  it('进行中的战役、9962e7e7 的老分支：K 线窗口长了，改动摘要里没改平仓时间的未平仓腿按现在的末根收，不印假改动', () => {
    const fx = parityFixture('sim-active-open-main');
    const { base } = copyOf(fx);
    // 老编辑器在窗口 K0（末根 03:00）上建基线，运行时窗口多一根（run_context.to = 04:00），摘要是「未改动」
    const saved = legacyBuildManualLegs(base, fx.legs, fx.klines, fx.tradeRecords, fx.corrections);
    expect(saved.find(leg => leg.id === 'main')?.close_time).toBe('2026-01-01T03:00:00.000Z');
    const summary = buildCounterfactualChangeSummary(saved, saved, saved);
    expect(summary.legs).toEqual([]);
    const runWindowEnd = '2026-01-01T04:00:00.000Z';
    // 载回时窗口又多一根
    const grown: ParityFixture = { ...fx, klines: [...fx.klines, hourBar(4, 110, 111, 109, 110), hourBar(5, 110, 111, 109, 110)] };
    const baselineNow = copyOf(grown).manualLegs;
    expect(baselineNow.find(leg => leg.id === 'main')?.close_time).toBe('2026-01-01T05:00:00.000Z');

    // 没有摘要（9962e7e7 之前的行）：认不出，这一类写进了说明
    expect(loadRow(baselineNow, saved, runWindowEnd).find(leg => leg.id === 'main')?.close_time).toBe('2026-01-01T03:00:00.000Z');

    const loaded = loadRow(baselineNow, saved, runWindowEnd, summary);
    expect(loaded.find(leg => leg.id === 'main')?.close_time).toBe('2026-01-01T05:00:00.000Z');
    expect(buildCounterfactualChangeSummary(baselineNow, loaded, loaded).lines).toEqual([]);
    expect(computeManualLegDeviationCosts(baselineNow, saved, runWindowEnd, summary)).toEqual([]);
    const rerun = runLegs(grown, base, loaded);
    const metrics = buildCounterfactualOverviewMetrics(rerun, {
      strategyTemplate: counterfactualTemplateFor(fx.campaign),
      asymmetricRiskSummary: ASYMMETRIC,
      currentAccountEquity: 10_000,
      isOwner: true,
    });
    expect(metrics.realizedPnl).not.toBeNull();

    // 用户当时改过平仓时间：摘要里有，原样保留
    const edited = saved.map(leg => (leg.id === 'main' ? { ...leg, close_time: '2026-01-01T02:00:00.000Z', exit_price: 112 } : leg));
    const editedSummary = buildCounterfactualChangeSummary(saved, edited, edited);
    expect(loadRow(baselineNow, edited, runWindowEnd, editedSummary).find(leg => leg.id === 'main')?.close_time).toBe('2026-01-01T02:00:00.000Z');
  });

  it('切成「已成交」的挂单：进行中的战役载回时 K 线窗口长了，平仓时间跟着换成现在的末根，改动摘要只剩「成交」这一项', () => {
    const fx = parityFixture('sim-active-all-closed');
    const { manualLegs: baseline } = copyOf(fx);
    const toggled = baseline.map(leg => (leg.id === 'hedge-a' ? { ...leg, filled: true } : leg));
    const summary = buildCounterfactualChangeSummary(baseline, toggled, toggled);
    expect(summary.lines).toEqual(['改 初始对冲 A：成交 未成交 → 已成交']);
    const grown: ParityFixture = { ...fx, klines: [...fx.klines, hourBar(4, 110, 111, 109, 110), hourBar(5, 110, 111, 109, 110)] };
    const baselineNow = copyOf(grown).manualLegs;
    expect(baselineNow.find(leg => leg.id === 'hedge-a')?.close_time).toBe('2026-01-01T05:00:00.000Z');
    const loaded = loadRow(baselineNow, toggled, '2026-01-01T03:00:00.000Z', summary);
    expect(loaded.find(leg => leg.id === 'hedge-a')).toMatchObject({ filled: true, close_time: '2026-01-01T05:00:00.000Z' });
    expect(buildCounterfactualChangeSummary(baselineNow, loaded, loaded).lines).toEqual(['改 初始对冲 A：成交 未成交 → 已成交']);
    // 切成已成交时一并改了平仓时间：摘要里有，原样保留
    const closedEarly = toggled.map(leg => (leg.id === 'hedge-a' ? { ...leg, close_time: '2026-01-01T02:00:00.000Z' } : leg));
    const closedSummary = buildCounterfactualChangeSummary(baseline, closedEarly, closedEarly);
    expect(loadRow(baselineNow, closedEarly, null, closedSummary).find(leg => leg.id === 'hedge-a')?.close_time).toBe('2026-01-01T02:00:00.000Z');
  });
});

describe('核验第一轮的两处分叉：历史归类的事件快照', () => {
  it('归类时对冲还没平、腿后来补了平仓：战役页按腿上的平仓时刻与已实现放下它（峰值 294.75，不是持有到 03:00 的 140），副本相同', () => {
    const fx = parityFixture('sim-hist-stale-event');
    const staleEvent = fx.campaign.actual_evolution.find(item => item.journal_id === 'hedge-a');
    expect(staleEvent).toMatchObject({ close_time: null, realized_pnl: null, trade_record_id: 'pos-hedge-a' });
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    // 01:00 那根高点 130：主力 (130 − 100) × 10 = 300；对冲 00:50 已平，只剩它的已实现 −5.25
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(294.75, 6);
    expect(rerun.numbers.peakUnrealizedPnl).toBeCloseTo(294.75, 2);
    expect(real.numbers.realizedPnl).toBeCloseTo(94.2, 6);
    expect(parityMismatches(real.numbers, rerun.numbers)).toEqual([]);
    expect(rerun.manualLegs.find(leg => leg.id === 'hedge-a')).toMatchObject({
      open_time: '2026-01-01T00:00:00.000Z',
      close_time: '2026-01-01T00:50:00.000Z',
    });
    // 说明里写明：事件快照还原的腿按腿上的平仓时刻与已实现；归类时还挂着的保护单不持有
    const note = helpText(rerun.metrics.extraNotes?.peakUnrealizedPnl);
    expect(note).toContain('平仓时刻与已实现取腿上的（归类之后补上或改过的也算');
    expect(note).toContain('归类时还挂着的保护单（事件快照里既没有成交 id 也没有已实现）从未成交');

    // 事件里的已实现写的是 0（不是空）：一样按腿上的 −5.25
    const zero: ParityFixture = {
      ...fx,
      campaign: {
        ...fx.campaign,
        actual_evolution: fx.campaign.actual_evolution.map(item => (item.journal_id === 'hedge-a' ? { ...item, realized_pnl: 0 } : item)),
      },
    };
    expect(realPanel(zero).numbers.peakUnrealizedPnl).toBeCloseTo(294.75, 6);
    expect(parityMismatches(realPanel(zero).numbers, rerunPanel(zero).numbers)).toEqual([]);

    // 归类之后在仓位面板里改过成交记录：事件还写着旧的 00:50 / −3，腿上是 −5.25 —— 已实现与峰值都按腿
    const corrected: ParityFixture = {
      ...fx,
      campaign: {
        ...fx.campaign,
        actual_evolution: fx.campaign.actual_evolution.map(item => (item.journal_id === 'hedge-a'
          ? { ...item, close_time: '2026-01-01T00:50:00.000Z', exit_price: 98.6, realized_pnl: -3 }
          : item)),
      },
    };
    expect(realPanel(corrected).numbers.peakUnrealizedPnl).toBeCloseTo(294.75, 6);
    expect(parityMismatches(realPanel(corrected).numbers, rerunPanel(corrected).numbers)).toEqual([]);

    // 腿上也没有平仓时刻与已实现（真的还没平）：两边都按事件持有到战役结束
    const open: ParityFixture = {
      ...fx,
      legs: fx.legs.map(leg => (leg.id === 'hedge-a' ? { ...leg, post_simulated_close_time: null, post_realized_pnl: null, post_exit_price_snapshot: null } : leg)),
    };
    expect(realPanel(open).numbers.peakUnrealizedPnl).toBeCloseTo(140, 6);
    expect(parityMismatches(realPanel(open).numbers, rerunPanel(open).numbers)).toEqual([]);
  });

  it('从日志腿归类、A/B 归类时还挂着：战役页不持有这两张挂单（峰值与实时战役同为 299.90），副本标「挂单中」，止损线照旧', () => {
    const fx = parityFixture('sim-journal-classified-pending');
    const live = parityFixture('sim-slippage');
    for (const id of ['hedge-a', 'hedge-b']) {
      expect(fx.campaign.actual_evolution.find(item => item.journal_id === id)).toMatchObject({ trade_record_id: null, realized_pnl: null });
      // 装配时按事件补上的平仓时间（战役结束时刻）不算成交
      expect(fx.legs.find(leg => leg.id === id)?.post_simulated_close_time).toBe(fx.campaign.closed_at);
    }
    const real = realPanel(fx);
    const liveReal = realPanel(live);
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(liveReal.numbers.peakUnrealizedPnl, 6);
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(299.9, 2);
    expect(real.numbers.initialExpectedMaxLoss).toBeCloseTo(liveReal.numbers.initialExpectedMaxLoss, 6);
    expect([...resolveUnfilledLegIds(fx.campaign, fx.legs, fx.tradeRecords)].sort()).toEqual(['hedge-a', 'hedge-b']);
    const rerun = rerunPanel(fx);
    expect(parityMismatches(real.numbers, rerun.numbers)).toEqual([]);
    for (const id of ['hedge-a', 'hedge-b']) {
      const leg = rerun.manualLegs.find(item => item.id === id);
      expect(leg?.filled).toBe(false);
      expect(leg).not.toHaveProperty('actual');
    }

    // 换了浏览器（本地没有成交记录）：主力按腿上的委托快照（100，不是成交价 100.01）持有，挂单同样不持有
    const noLocal: ParityFixture = { ...fx, tradeRecords: [], corrections: {} };
    const noLocalReal = realPanel(noLocal);
    expect(noLocalReal.numbers.peakUnrealizedPnl).toBeCloseTo(300, 6);
    expect([...resolveUnfilledLegIds(noLocal.campaign, noLocal.legs, [])].sort()).toEqual(['hedge-a', 'hedge-b']);
    expect(parityMismatches(noLocalReal.numbers, rerunPanel(noLocal).numbers)).toEqual([]);

    // 归类时事件里带着已实现的（复盘过、或只剩快照的腿）照旧按事件持有：只跳过「既没有成交 id 也没有已实现」的那一类
    const reviewed: ParityFixture = {
      ...fx,
      legs: fx.legs.map(leg => (leg.id === 'hedge-a' ? { ...leg, post_realized_pnl: -12 } : leg)),
      campaign: {
        ...fx.campaign,
        actual_evolution: fx.campaign.actual_evolution.map(item => (item.journal_id === 'hedge-a' ? { ...item, realized_pnl: -12 } : item)),
      },
    };
    expect(resolveUnfilledLegIds(reviewed.campaign, reviewed.legs, reviewed.tradeRecords).has('hedge-a')).toBe(false);
    expect(parityMismatches(realPanel(reviewed).numbers, rerunPanel(reviewed).numbers)).toEqual([]);
  });

  it('从日志腿归类的随机形状（事件过期、归类后改过记录、归类时未成交的挂单；本地记录全有 / 全无 / 部分）：已结束的逐项对上，进行中的只差峰值浮盈', () => {
    const failures: string[] = [];
    const totals = { closed: 0, stale: 0, corrected: 0, pending: 0, sameAsLive: 0 };
    for (const local of ['all', 'none', 'partial'] as const) {
      for (let seed = 1; seed <= 150; seed += 1) {
        const base = randomParityFixture(seed);
        const { view: fx, tally } = journalClassifiedView(base, seed, local);
        const active = fx.campaign.closed_at == null;
        // 本地记录都在：每条成交过的腿都按成交记录上路径，归类只多出事件——战役页的峰值必须与实时战役一分不差
        // （归类时还没成交的挂单不能因为有了事件快照就被持有）
        if (local === 'all' && base.tradeRecords.length > 0) {
          const livePeak = realPanel(base).numbers.peakUnrealizedPnl;
          const classifiedPeak = realPanel(fx).numbers.peakUnrealizedPnl;
          if (Math.abs(livePeak - classifiedPeak) > 1e-9) failures.push(`${fx.id}: 归类后峰值 ${classifiedPeak} ≠ 实时 ${livePeak}`);
          else totals.sameAsLive += 1;
        }
        if (!active) totals.closed += 1;
        totals.stale += tally.stale;
        totals.corrected += tally.corrected;
        totals.pending += tally.pending;
        const real = realPanel(fx);
        const rerun = rerunPanel(fx);
        const mismatches = parityMismatches(real.numbers, rerun.numbers, active ? { peakUnrealizedPnl: 'active' } : {});
        const delta = rerun.result.final_realized_pnl - (real.actualPnl ?? 0);
        if (real.actualPnl != null && Math.abs(delta) >= 0.005) mismatches.push(`相对实际 ${delta.toFixed(4)} ≠ 0.00`);
        if (mismatches.length > 0) failures.push(`${fx.id}: ${mismatches.join('；')}`);
      }
    }
    expect(failures.slice(0, 8)).toEqual([]);
    expect(totals.closed).toBeGreaterThan(300);
    expect(totals.stale).toBeGreaterThan(200);
    expect(totals.corrected).toBeGreaterThan(100);
    expect(totals.pending).toBeGreaterThan(300);
    expect(totals.sameAsLive).toBeGreaterThan(100);
  }, 120_000);
});

describe('第四轮复核：结束时间记早了、挂着委托 id 的挂单、被别的腿认领的收盘记录', () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  const withClosedAt = (fx: ParityFixture, closedAt: string): ParityFixture => ({
    ...fx,
    campaign: { ...fx.campaign, closed_at: closedAt },
  });

  it.each([
    // [夹具, 正确收尾时的峰值浮盈]
    ['sim-slippage-closed-8h-early', 299.8998],
    ['sim-slippage-closed-20m-early', 399.8998],
    ['unfilled-hedge-closed-8h-early', 300],
    ['unfilled-hedge-closed-20m-early', 400],
  ] as const)('%s：已结束战役的窗口不早于最后一次平仓，读数与正确收尾的同一场逐字节相同，也与原样重跑相同', (id, peak) => {
    const fx = parityFixture(id);
    const lastClose = Math.max(...fx.tradeRecords.map(record => record.closeTime));
    expect(Date.parse(fx.campaign.closed_at!)).toBeLessThan(lastClose);
    const real = realPanel(fx);
    const onTime = realPanel(withClosedAt(fx, iso(lastClose)));
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(peak, 6);
    // 峰值、最大回撤、对冲精度、镜像止盈全都与正确收尾的那一场相同
    expect(real.accuracy).toEqual(onTime.accuracy);
    const rerun = rerunPanel(fx);
    expect(parityMismatches(real.numbers, rerun.numbers)).toEqual([]);
    expect(rerun.result.peak_drawdown).toBeCloseTo(real.accuracy.campaign_max_drawdown_real, 2);
    // 挂单的兜底平仓时间收在最后一次平仓（03:00），不是记早了的结束时间
    expect(rerun.manualLegs.find(leg => leg.id === 'hedge-a')).toMatchObject({ filled: false, close_time: '2026-01-01T03:00:00.000Z' });
  });

  it('结束时间只比最后一次平仓早几秒（旧对话框截到分钟）：窗口同样补到最后一次平仓，模拟器实跑的每一场都与正确收尾的读数相同', () => {
    for (const base of SIMULATOR_PARITY_FIXTURES) {
      if (!base.campaign.closed_at || base.tradeRecords.length === 0) continue;
      const lastClose = Math.max(...base.tradeRecords.map(record => record.closeTime));
      if (Date.parse(base.campaign.closed_at) !== lastClose) continue;
      const early = withClosedAt(base, iso(lastClose - 30_000));
      expect(realPanel(early).accuracy, base.id).toEqual(realPanel(base).accuracy);
      expect(parityMismatches(realPanel(early).numbers, rerunPanel(early).numbers), base.id).toEqual([]);
    }
  });

  it('结束时间晚于最后一次平仓：与改动之前相同，窗口照旧扫到结束时间，平仓时刻不明的腿持有到那一刻', () => {
    const base = parityFixture('sim-hist-stale-event');
    // 对冲 A 真的还没平（腿上、事件里都没有平仓时刻）：按事件持有到战役结束；04:00 那根冲到 200
    const open: ParityFixture = {
      ...base,
      legs: base.legs.map(leg => (leg.id === 'hedge-a'
        ? { ...leg, post_simulated_close_time: null, post_realized_pnl: null, post_exit_price_snapshot: null }
        : leg)),
      klines: [...base.klines, hourBar(4, 110, 200, 109, 110)],
    };
    const onTime = withClosedAt(open, '2026-01-01T03:00:00.000Z');
    const late = withClosedAt(open, '2026-01-01T04:30:00.000Z');
    const early = withClosedAt(open, '2025-12-31T19:00:00.000Z');
    // 03:00 收尾：主力 00:00–03:00，对冲持有到 03:00；最深在 00:00 / 02:00 那两根低点 97：−30 + 5
    expect(realPanel(onTime).accuracy.campaign_max_drawdown_real).toBeCloseTo(25, 6);
    // 04:30 收尾：对冲持有到 04:30，04:00 那根高点 200 上 99.45 − (200 − 98) × 5
    expect(realPanel(late).accuracy.campaign_max_drawdown_real).toBeCloseTo(410.55, 6);
    expect(realPanel(late).numbers.peakUnrealizedPnl).toBeCloseTo(140, 6);
    // 记早 8 小时：补到路径上最晚的平仓（主力快照的 03:00），与 03:00 收尾相同
    expect(realPanel(early).accuracy).toEqual(realPanel(onTime).accuracy);
    for (const fx of [onTime, late, early]) {
      const rerun = rerunPanel(fx);
      expect(parityMismatches(realPanel(fx).numbers, rerun.numbers), fx.campaign.closed_at!).toEqual([]);
      expect(rerun.result.peak_drawdown, fx.campaign.closed_at!).toBeCloseTo(realPanel(fx).accuracy.campaign_max_drawdown_real, 2);
    }
    expect(resolveCampaignEquityPathLegFacts(late.campaign, late.legs, late.tradeRecords).analysisEndMs)
      .toBe(Date.parse('2026-01-01T04:30:00.000Z'));
    expect(resolveCampaignEquityPathLegFacts(early.campaign, early.legs, early.tradeRecords).analysisEndMs)
      .toBe(Date.parse('2026-01-01T03:00:00.000Z'));
    // 市价滑点那一场晚 5 分钟收尾：与正确收尾的读数逐字节相同
    const slippage = parityFixture('sim-slippage');
    const lateSlippage = withClosedAt(slippage, '2026-01-01T03:05:00.000Z');
    expect(realPanel(lateSlippage).accuracy).toEqual(realPanel(slippage).accuracy);
  });

  it('resolveNeverFilledOrderIds：撤单或仍挂着的委托 id 算从未成交；有成交快照、是本场成交记录的 id、本地查不到的都不下结论', () => {
    expect(resolveNeverFilledOrderIds({
      referencedIds: ['ord-cancelled', 'ord-live', 'ord-filled', 'ord-both', 'ord-unknown', 'pos-main', null, 'ord-triggered', 'ord-live'],
      cancelledOrders: [{ id: 'ord-cancelled' }, { id: 'ord-both' }, { id: 'pos-main' }],
      filledOrders: [{ id: 'ord-filled' }, { id: 'ord-both' }],
      pendingOrders: [
        { id: 'ord-live', status: 'NEW' },
        { id: 'ord-triggered', status: 'TRIGGERED' },
        { id: 'ord-not-referenced', status: 'PENDING' },
      ],
      filledRecordIds: ['pos-main', null],
    })).toEqual(['ord-cancelled', 'ord-live']);
  });

  it('从日志腿归类、A/B 挂着委托 id 且本地委托记录显示已撤单：两边都按从未成交处理（峰值 299.90，与实时战役相同）；本地查不到这两张委托时照旧', () => {
    const fx = parityFixture('sim-journal-classified-order-id');
    const live = parityFixture('sim-slippage');
    for (const id of ['hedge-a', 'hedge-b']) {
      expect(fx.campaign.actual_evolution.find(item => item.journal_id === id)).toMatchObject({ trade_record_id: `ord-${id}`, realized_pnl: null });
    }
    const real = realPanel(fx);
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(realPanel(live).numbers.peakUnrealizedPnl, 6);
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(299.9, 2);
    expect(real.accuracy.campaign_max_drawdown_real).toBeCloseTo(realPanel(live).accuracy.campaign_max_drawdown_real, 6);
    expect([...resolveUnfilledLegIds(fx.campaign, fx.legs, fx.tradeRecords, localOrdersOf(fx))].sort()).toEqual(['hedge-a', 'hedge-b']);
    const rerun = rerunPanel(fx);
    expect(parityMismatches(real.numbers, rerun.numbers)).toEqual([]);
    for (const id of ['hedge-a', 'hedge-b']) {
      const leg = rerun.manualLegs.find(item => item.id === id);
      expect(leg?.filled).toBe(false);
      expect(leg).not.toHaveProperty('actual');
    }

    // 本地查不到这两张委托（换了浏览器）：不下结论，与改动之前相同——按归类快照从挂出时刻持有到结束，两边同为 99.24
    const unknown: ParityFixture = { ...fx, unfilledOrderIds: undefined };
    const unknownReal = realPanel(unknown);
    expect(unknownReal.numbers.peakUnrealizedPnl).toBeCloseTo(unknownReal.actualPnl!, 6);
    expect(unknownReal.numbers.peakUnrealizedPnl).toBeCloseTo(99.24, 2);
    expect(resolveUnfilledLegIds(unknown.campaign, unknown.legs, unknown.tradeRecords).size).toBe(0);
    const unknownRerun = rerunPanel(unknown);
    expect(parityMismatches(unknownReal.numbers, unknownRerun.numbers)).toEqual([]);
    expect(unknownRerun.manualLegs.find(item => item.id === 'hedge-a')).not.toHaveProperty('filled');

    // 实时战役（没有归类事件）里挂着委托 id 的挂单：以前判成「成交过、路径不持有」，本地委托记录在时同样标「挂单中」
    const liveOrderIds: ParityFixture = {
      ...live,
      legs: live.legs.map(leg => (leg.id.startsWith('hedge-') ? { ...leg, trade_record_id: `ord-${leg.id}` } : leg)),
      unfilledOrderIds: ['ord-hedge-a', 'ord-hedge-b'],
    };
    expect([...resolveCampaignEquityPathLegFacts(liveOrderIds.campaign, liveOrderIds.legs, liveOrderIds.tradeRecords).offPathLegIds].sort())
      .toEqual(['hedge-a', 'hedge-b']);
    const liveRerun = rerunPanel(liveOrderIds);
    expect(liveRerun.manualLegs.filter(leg => leg.filled === false).map(leg => leg.id).sort()).toEqual(['hedge-a', 'hedge-b']);
    expect(parityMismatches(realPanel(liveOrderIds).numbers, liveRerun.numbers)).toEqual([]);
    expect(realPanel(liveOrderIds).accuracy).toEqual(realPanel(live).accuracy);
  });

  it('主力的最后一刀被回填的加仓腿认领：副本按主力自己认领到的 00:30 那一刀开平（峰值 169.59，不是把一半持有到 03:00 的 299.90）', () => {
    const fx = parityFixture('sim-close-claimed-by-add-leg');
    const claimed = claimCampaignRecordsByLeg(fx.legs, fx.tradeRecords);
    expect(claimed.get('main')?.map(record => record.id)).toEqual(['half-1']);
    expect(claimed.get('add-1')?.map(record => record.id)).toEqual(['final-1']);
    const half = fx.tradeRecords.find(record => record.id === 'half-1')!;
    const real = realPanel(fx);
    const rerun = rerunPanel(fx);
    // 01:00 那根高点 130：主力 00:30 已平一半（已实现），加仓腿 5 个 ×（130 − 成交价）
    expect(real.numbers.peakUnrealizedPnl).toBeCloseTo(169.59, 2);
    expect(parityMismatches(real.numbers, rerun.numbers)).toEqual([]);
    expect(rerun.result.final_realized_pnl - real.actualPnl!).toBeCloseTo(0, 6);
    const main = rerun.manualLegs.find(leg => leg.id === 'main');
    expect(main).toMatchObject({ close_time: '2026-01-01T00:30:00.000Z', exit_price: half.exitPrice });
    expect(main?.actual?.cuts).toHaveLength(1);
    expect(rerun.manualLegs.find(leg => leg.id === 'add-1')).toMatchObject({ close_time: '2026-01-01T03:00:00.000Z' });
    // 平仓价 +0.01 只挪主力自己那一刀（5 个）的钱
    const edited = rerunPanel(fx, legs => legs.map(leg => (leg.id === 'main' ? { ...leg, exit_price: leg.exit_price + 0.01 } : leg)));
    expect(edited.result.final_realized_pnl - rerun.result.final_realized_pnl)
      .toBeCloseTo(editWorth(half.quantity, half.exitPrice, half.exitPrice + 0.01, 'LONG', half.closeFeeRate!), 6);
  });
});
