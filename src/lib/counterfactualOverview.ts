import type { KlineData } from '@/hooks/useBinanceData';
import {
  computeAsymmetricRiskContribution,
  type AsymmetricRiskMetricsSummary,
} from '@/lib/asymmetricRiskMetrics';
import { resolveCampaignInitialRiskFraction } from '@/lib/campaignAnalysis';
import { computeCampaignExpectancies, resolveResolvedOpportunityQuality } from '@/lib/campaignMetrics';
import type {
  CampaignPnlOverviewHelpParagraph,
  CampaignPnlOverviewItemKey,
  CampaignPnlOverviewMetrics,
  CampaignPnlOverviewNoteInput,
} from '@/lib/campaignPnlOverview';
import {
  deriveCounterfactualRiskAnchors,
  isManualLegScenario,
  type CounterfactualRiskAnchors,
  type SupportedTemplate,
} from '@/lib/campaignSimulationEngine';
import type {
  CampaignCounterfactualParams,
  CampaignCounterfactualResult,
  CampaignCounterfactualRunContext,
} from '@/types/journal';

/**
 * 把一条反事实分支（params + result）翻译成「盈亏概览」构造器要的纯数字对象。
 *
 * 口径守则（每一条都对应过一次错数）：
 *   · 已实现 P&L 读 result.final_realized_pnl；
 *   · L / 名义仓位 / d / 杠杆优先读 result 上落库的四个字段，老行没有就按 params 重算——
 *     重算必须用这场战役自己的推演模板（main_only 没有保护线），否则老 SOP 行会被造出 L；
 *   · 盈亏比 b = L > 0 ? 已实现 ÷ L × 100 : null——**绝不**拿 result.profit_capture_ratio
 *     （那是 已实现 ÷ 峰值），也不拿 final_r_multiple（L = 0 时它是 0，会印成 0.00 而不是「—」）；
 *   · 机会质量 / 算术与几何期望 / DSI-USI 贡献全部由这个 b 推出，用的是战役页同一批函数。
 */

export interface CounterfactualOverviewShared {
  /** 这场战役的推演模板（counterfactualTemplateFor）：老行没有落库锚时按它重算，与运行时选的引擎一致。 */
  strategyTemplate: SupportedTemplate;
  expectedWinRate: number | null;
  payoffRatioSampleCount: number;
  performanceLoading: boolean;
  performanceError: boolean;
  asymmetricRiskSummary: AsymmetricRiskMetricsSummary | null;
  currentAccountEquity: number;
  isOwner: boolean;
}

export interface CounterfactualOverviewBranch {
  params: CampaignCounterfactualParams;
  result: CampaignCounterfactualResult;
}

const EPSILON = 0.000001;

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 新行直接读落库字段；缺任一项（老行）就按 params 重算整组，保证四项出自同一份合成腿。
 * 重算时模板取这场战役的：手动 Legs 分支不看模板，SOP 分支在 main_only 下没有对冲腿、L = 0。
 */
export function resolveCounterfactualRiskAnchors(
  branch: CounterfactualOverviewBranch,
  template: SupportedTemplate,
): CounterfactualRiskAnchors {
  const { result } = branch;
  const stored = {
    initialExpectedMaxLoss: finiteOrNull(result.initial_expected_max_loss),
    initialMainExposureNotional: finiteOrNull(result.initial_main_exposure_notional),
    expectedMaxDrawdownPct: finiteOrNull(result.expected_max_drawdown_pct),
  };
  const hasStoredAnchors = stored.initialExpectedMaxLoss != null
    && stored.initialMainExposureNotional != null
    && stored.expectedMaxDrawdownPct != null
    && 'main_leverage' in result;
  if (hasStoredAnchors) {
    return {
      initialExpectedMaxLoss: stored.initialExpectedMaxLoss,
      initialMainExposureNotional: stored.initialMainExposureNotional,
      expectedMaxDrawdownPct: stored.expectedMaxDrawdownPct,
      mainLeverage: finiteOrNull(result.main_leverage),
    };
  }
  return deriveCounterfactualRiskAnchors(branch.params, template);
}

/** b × 100：与 accuracy.profit_capture_ratio（已实现 ÷ L × 100）同口径；没有止损线时 null。 */
export function computeCounterfactualPayoffRatio(realizedPnl: number, initialExpectedMaxLoss: number): number | null {
  if (!Number.isFinite(realizedPnl) || !Number.isFinite(initialExpectedMaxLoss)) return null;
  if (initialExpectedMaxLoss <= EPSILON) return null;
  return (realizedPnl / initialExpectedMaxLoss) * 100;
}

/**
 * 「已了结」门槛：手动 Legs 分支要求每条启用的腿都有可解析的平仓时刻；
 * SOP 推演分支以主仓已全平（或已进入退场态）为准。
 */
export function isCounterfactualResolved(branch: CounterfactualOverviewBranch): boolean {
  if (isManualLegScenario(branch.params)) {
    return (branch.params.manual_legs ?? [])
      .filter(leg => leg.enabled)
      .every(leg => {
        const closeMs = new Date(leg.close_time).getTime();
        return Number.isFinite(closeMs) && closeMs > 0;
      });
  }
  return branch.result.events.some(event => event.event_type === 'main_fully_closed')
    || branch.result.state_segments.some(segment => segment.state === 'state_3_exit');
}

const L_DERIVED_KEYS: CampaignPnlOverviewItemKey[] = [
  'initialExpectedMaxLoss',
  'expectedMaxDrawdownPct',
  'payoffRatio',
  'asymmetricRiskContribution',
  'opportunityQuality',
  'arithmeticExpectancy',
  'geometricExpectancy',
];

/**
 * 峰值口径的告诫按**跑出这一行的引擎**写，不按 run_context 在不在。
 * run_context 是在分流到手动 / SOP 之前挂上去的：SOP 分支同样带着它，
 * 而 simulateCampaign 只在每根 K 线的收盘价上重估权益，写「最高价、最低价」就是在撒谎。
 */
function peakCaveat(manual: boolean, runContext: CampaignCounterfactualRunContext | undefined): string {
  if (!manual) {
    return runContext
      ? `本次推演用 ${runContext.interval} K 线共 ${runContext.kline_count} 根，SOP 推演引擎只在每根 K 线的收盘价上重估权益，`
        + '盘中最高 / 最低价带来的浮盈看不到，峰值可能偏低，只能与同周期下的读数比较。'
      : 'SOP 推演引擎只在每根 K 线的收盘价上重估权益，盘中最高 / 最低价带来的浮盈看不到，峰值可能偏低。';
  }
  if (runContext) {
    return `本次运行用 ${runContext.interval} K 线共 ${runContext.kline_count} 根，与战役页「盈亏概览」同一算法：`
      + '每根 K 线内逐个还原持仓状态（K 线起点、各腿开仓、平仓前后、K 线终点），各自用这根的最高价、最低价重估，'
      + '已平的腿计已实现，再与最终已实现盈亏取最大值；一根 K 线内高低点与开平仓的先后顺序不可知，'
      + '这是该周期粒度下的估计，只能与同周期下的读数比较。';
  }
  return '本分支未记录运行时的 K 线周期；早期分支的峰值只按每根 K 线收盘价估计，可能低于按最高价 / 最低价重估的读数。';
}

export function buildCounterfactualOverviewMetrics(
  branch: CounterfactualOverviewBranch,
  shared: CounterfactualOverviewShared,
): CampaignPnlOverviewMetrics {
  const manual = isManualLegScenario(branch.params);
  const realizedPnl = finiteOrNull(branch.result.final_realized_pnl);
  const anchors = resolveCounterfactualRiskAnchors(branch, shared.strategyTemplate);
  const initialExpectedMaxLoss = anchors.initialExpectedMaxLoss > EPSILON ? anchors.initialExpectedMaxLoss : 0;
  const hasStopLine = initialExpectedMaxLoss > 0;
  const payoffRatio = realizedPnl == null ? null : computeCounterfactualPayoffRatio(realizedPnl, initialExpectedMaxLoss);
  const expectedMaxDrawdownPct = hasStopLine && anchors.expectedMaxDrawdownPct > 0 ? anchors.expectedMaxDrawdownPct : 0;
  const resolved = isCounterfactualResolved(branch) && realizedPnl != null;
  const opportunityQuality = resolveResolvedOpportunityQuality(resolved, payoffRatio, expectedMaxDrawdownPct);
  const expectancies = computeCampaignExpectancies(payoffRatio, shared.expectedWinRate);
  const asymmetricRiskContribution = computeAsymmetricRiskContribution(
    payoffRatio == null ? null : payoffRatio / 100,
    shared.asymmetricRiskSummary,
  );
  // 反事实没有主力开仓时的账户快照，与老战役一样退到今日总资产（仅所有者可见）。
  const initialRisk = resolveCampaignInitialRiskFraction(
    initialExpectedMaxLoss,
    [],
    shared.isOwner ? shared.currentAccountEquity : null,
  );
  const todayAccountEquity = shared.isOwner && Number.isFinite(shared.currentAccountEquity) && shared.currentAccountEquity > 0
    ? shared.currentAccountEquity
    : null;

  const helpOverrides: Partial<Record<CampaignPnlOverviewItemKey, CampaignPnlOverviewHelpParagraph[]>> = {
    realizedPnl: manual
      ? [
        '本条反事实分支里全部手动 Legs 按你调整后的开仓价 / 平仓价算出的盈亏合计，与实际战役的已实现 P&L 同一口径（名义仓位 × 价格变动比例，不乘杠杆），可以直接相减得到「相对实际」。',
        { formula: '已实现 P&L = Σ 各手动 Leg 盈亏' },
        '停用或删除的腿不计入；资金费不并入任何腿。',
      ]
      : [
        '按标准 SOP 在真实行情上推演出的全部平仓盈亏合计（主仓、镜像止盈、对冲），与实际战役的已实现 P&L 同一口径。',
        { formula: '已实现 P&L = Σ 各推演 Leg 盈亏' },
        '数据结束时仍未平的仓位按最后一根 K 线收盘价强制结算。',
      ],
    mainLeverage: [
      manual
        ? '本分支主力开仓腿的杠杆倍数：取手动 Legs 里名义仓位最大的那笔主力；编辑器不改杠杆，所以通常与原始战役相同。'
        : '本分支主力开仓时使用的杠杆倍数，来自推演参数里的入场杠杆。',
      '杠杆影响保证金占用与 ROE；名义仓位已经确定时，不再额外放大绝对盈亏。',
    ],
  };

  const extraNotes: Partial<Record<CampaignPnlOverviewItemKey, CampaignPnlOverviewHelpParagraph[]>> = {
    initialMainExposureNotional: [
      manual
        ? '反事实分支从手动 Legs 里角色为主力开仓与镜像止盈的腿的名义仓位还原；合成腿一律按入场方向计，改了方向的腿也算在内。'
        : '反事实分支从推演参数的入场名义仓位与镜像止盈仓位还原。',
    ],
    peakUnrealizedPnl: [peakCaveat(manual, branch.params.run_context)],
    asymmetricRiskContribution: [
      { warning: '假设值：本场反事实不在账户样本内，n 与 Σb² 取自真实已了结战役，占比只是「如果它是真的」的示意。' },
    ],
  };
  if (!hasStopLine) {
    const reason = manual
      ? '手动 Legs 里没有初始对冲 A/B，读不到止损线，本项不计算。'
      : '本分支没有初始对冲 A/B，读不到止损线，本项不计算。';
    for (const key of L_DERIVED_KEYS) {
      extraNotes[key] = [...(extraNotes[key] ?? []), { warning: reason }];
    }
  }

  return {
    realizedPnl,
    settlement: null,
    mainLeverage: anchors.mainLeverage,
    initialMainExposureNotional: anchors.initialMainExposureNotional > 0 ? anchors.initialMainExposureNotional : 0,
    peakUnrealizedPnl: finiteOrNull(branch.result.peak_unrealized_pnl) ?? 0,
    initialExpectedMaxLoss,
    expectedMaxDrawdownPct,
    payoffRatio,
    asymmetricRiskContribution,
    opportunityQuality,
    arithmeticExpectancy: expectancies.arithmeticExpectancy,
    geometricExpectancy: expectancies.geometricExpectancy,
    initialRisk: initialRisk ? { drawdownFraction: initialRisk.drawdownFraction, source: initialRisk.source } : null,
    todayAccountEquity,
    expectedWinRate: shared.expectedWinRate,
    helpOverrides,
    extraNotes,
  };
}

/** 反事实面板的脚注输入：期望口径那句与真实面板完全一致，资产分母那句跟着 initialRisk 走。 */
export function buildCounterfactualOverviewNoteInput(
  metrics: Pick<CampaignPnlOverviewMetrics, 'initialRisk'>,
  shared: CounterfactualOverviewShared,
): CampaignPnlOverviewNoteInput {
  return {
    performanceLoading: shared.performanceLoading,
    performanceError: shared.performanceError,
    expectedWinRate: shared.expectedWinRate,
    payoffRatioSampleCount: shared.payoffRatioSampleCount,
    initialRiskSource: metrics.initialRisk?.source ?? null,
  };
}

const KLINE_INTERVAL_BY_MS: ReadonlyArray<readonly [number, string]> = [
  [60_000, '1m'],
  [180_000, '3m'],
  [300_000, '5m'],
  [900_000, '15m'],
  [1_800_000, '30m'],
  [3_600_000, '1h'],
  [7_200_000, '2h'],
  [14_400_000, '4h'],
  [21_600_000, '6h'],
  [28_800_000, '8h'],
  [43_200_000, '12h'],
  [86_400_000, '1d'],
  [259_200_000, '3d'],
  [604_800_000, '1w'],
];

/**
 * 从 K 线数组反推周期：取相邻开盘时刻的最小正步长（缺根只会让步长变大，不会变小）。
 * 调用方拿不到主图周期时的兜底；不足两根返回 null。
 */
export function inferKlineInterval(klines: KlineData[]): string | null {
  let step = Number.POSITIVE_INFINITY;
  for (let index = 1; index < klines.length; index += 1) {
    const delta = klines[index].time - klines[index - 1].time;
    if (delta > 0 && delta < step) step = delta;
  }
  if (!Number.isFinite(step)) return null;
  const exact = KLINE_INTERVAL_BY_MS.find(([ms]) => ms === step);
  if (exact) return exact[1];
  return step % 3_600_000 === 0 ? `${step / 3_600_000}h` : `${Math.round(step / 60_000)}m`;
}

/** 运行那一刻的 K 线上下文；没有 K 线时返回 null（那种运行本来就该被页面拦下）。 */
export function buildCounterfactualRunContext(
  klines: KlineData[],
  interval: string,
  ranAt: Date = new Date(),
): CampaignCounterfactualRunContext | null {
  if (klines.length === 0) return null;
  return {
    interval,
    from: new Date(klines[0].time).toISOString(),
    to: new Date(klines[klines.length - 1].time).toISOString(),
    kline_count: klines.length,
    ran_at: ranAt.toISOString(),
  };
}
