import type { KlineData } from '@/hooks/useBinanceData';
import {
  computeAsymmetricRiskContribution,
  type AsymmetricRiskMetricsSummary,
} from '@/lib/asymmetricRiskMetrics';
import { resolveCampaignInitialRiskFraction } from '@/lib/campaignAnalysis';
import { counterfactualMainLegPriceChangePct, type ActualMainPriceChange } from '@/lib/campaignMainPriceChange';
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
 *   · 已实现 P&L 读 result.final_realized_pnl：带 fees_total 的新行是净额（与战役页同一口径，已扣平仓费），
 *     没有 fees_total 的老行是毛盈亏，帮助文案必须如实说明；
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
  /**
   * 真实战役的主力（pickPrimaryMainLeg 选中的腿 id）与它在上方「盈亏概览」里的涨幅：
   * 反事实的「涨幅」先认这条腿，开平价与方向没改过就沿用这个数，原样重跑因此逐位相同。
   * 缺省时按「仓位」一格取最大的主力、按副本的开平价算。
   */
  actualMain?: ActualMainPriceChange | null;
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
 * 「已了结」门槛：手动 Legs 分支要求每条启用的腿都有可解析的平仓时刻，
 * 且没有「实际战役还在进行、这条腿也没平、副本也没给它另定平仓时间」的腿——
 * 那种腿的平仓时间只是末根 K 线，战役页对进行中的战役同样不算已了结。
 * 再叠上运行那一刻真实战役自己的判定（params.actual_resolved，与战役页同一条规则）：
 * 真实战役不算已了结（进行中、或一条腿都结算不了又没有落库值）时，原样重跑也不算——
 * 除非副本给实际还没平的腿另定了平仓时间，那是用户在模拟「这时候全平了」。老行没有这个字段，只看腿。
 * SOP 推演分支以主仓已全平（或已进入退场态）为准。
 */
export function isCounterfactualResolved(branch: CounterfactualOverviewBranch): boolean {
  if (isManualLegScenario(branch.params)) {
    const enabled = (branch.params.manual_legs ?? []).filter(leg => leg.enabled);
    let closedAnOpenLeg = false;
    const legsClosed = enabled.every(leg => {
      const closeMs = new Date(leg.close_time).getTime();
      if (!Number.isFinite(closeMs) || closeMs <= 0) return false;
      if (leg.filled === false || leg.actual?.still_open !== true) return true;
      const stillOpen = closeMs === new Date(leg.actual.close_time).getTime();
      if (!stillOpen) closedAnOpenLeg = true;
      return !stillOpen;
    });
    return legsClosed && (branch.params.actual_resolved !== false || closedAnOpenLeg);
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

/** 这一行的已实现是不是净额：新行落库了 fees_total（哪怕是 0），老行没有这个字段、是毛盈亏。 */
export function isCounterfactualResultNetOfFees(result: CampaignCounterfactualResult): boolean {
  return finiteOrNull(result.fees_total) != null;
}

/**
 * 手动 Legs 分支「已实现 P&L」的口径说明，按这一行实际落库的口径写。
 *
 * 新行与战役页同一口径：战役页的已实现是 Σ record.pnl，record.pnl = 毛盈亏 − 平仓费，
 * 开仓费在开仓时从钱包扣走、不在其中——所以这里也只扣平仓费，开仓费单列、不扣。
 * 若连开仓费一起扣，没改过一格的副本就会比实际少一截，被读成「原始错误的代价」。
 * 只剩复盘快照的腿，手续费已含在快照里、金额未知：不写成「0.00」，单独说明。
 */
function manualRealizedPnlHelp(result: CampaignCounterfactualResult): CampaignPnlOverviewHelpParagraph[] {
  if (!isCounterfactualResultNetOfFees(result)) {
    return [
      '本条反事实分支里全部手动 Legs 按调整后的开仓价 / 平仓价算出的盈亏合计（名义仓位 × 价格变动比例，不乘杠杆）。',
      { formula: '已实现 P&L = Σ 各手动 Leg 毛盈亏' },
      {
        warning: '本分支保存于手续费口径统一之前：这是未扣任何手续费的毛盈亏，而实际战役的已实现 P&L 已扣平仓手续费，'
          + '所以「相对实际」里多出了这部分手续费，不全是方案的得失；若有从未成交的保护单，当时也按成交计入了；'
          + '分几刀平掉的腿当时按整条腿平在最后一刀计算。'
          + '把它载回 Legs 副本重新运行一次，即可得到与实际同一口径的读数。',
      },
      '停用或删除的腿不计入；资金费不并入任何腿。',
    ];
  }
  const closeFees = finiteOrNull(result.fees_total) ?? 0;
  const openFees = finiteOrNull(result.open_fees_total);
  const unknownFeeLegs = finiteOrNull(result.fee_unknown_leg_count) ?? 0;
  const fromCampaignTotal = result.legs_summary.some(leg => leg.pnl_basis === 'campaign_total');
  const feeLine = openFees == null
    ? `本分支已扣平仓手续费 ${closeFees.toFixed(2)} USDT。开仓手续费在开仓时从钱包扣除，实际战役的已实现 P&L 同样不含它，这里也不扣。`
    : `本分支已扣平仓手续费 ${closeFees.toFixed(2)} USDT；开仓手续费 ${openFees.toFixed(2)} USDT 在开仓时从钱包扣除，`
      + '实际战役的已实现 P&L 同样不含它，这里也不扣。';
  return [
    '本条反事实分支里全部手动 Legs 的已实现盈亏合计，与实际战役的已实现 P&L 同一口径（净额，已扣平仓手续费），可以直接相减得到「相对实际」。',
    '没改过的腿直接取实际结算值：成交记录的盈亏之和（逐刀，已扣平仓手续费，叠与战役页同一份平仓价校正），只剩复盘快照的腿取快照，'
      + '实际结算没有计入的腿（既无成交记录也无复盘快照，如尚未平仓）记 0。'
      + '改过的腿从实际结算值出发，只加上这次改动本身值的钱：按改后的开平价、仓位重算这一刀的毛盈亏（名义仓位 × 价格变动比例，不乘杠杆）'
      + '与平仓手续费（费率用这一刀成交记录自己的，老记录按当时实收的费率），减去按原开平价算的同一个数；'
      + '平仓价、平仓时间改的是最后那一刻平掉的全部（同一时刻一起平掉的刀一起平移），分几刀平掉的腿更早平掉的刀维持实际成交。'
      + '新增的腿、切成「已成交」的挂单，以及改过的未平仓腿，按调整后的价格算毛盈亏，再按模拟器的 Taker 费率扣平仓手续费'
      + '（U 本位 = 数量 × 平仓价 × 费率；币本位 = 张数 × 面值 × 费率）。',
    ...(fromCampaignTotal
      ? ['本场一条腿都结算不了（本地既无成交记录也无复盘快照），上方的已实现取自事件流或落库缓存：'
        + '这个总额先按各腿的开平价估一份（毛盈亏 − 模拟器 Taker 平仓费），余差记在主力上，各份之和恰为那个总额；'
        + '停用一条腿减去它自己那一份，改一格仍只挪这一格值的钱。']
      : []),
    '所以原样重跑时已实现 P&L 逐分复现上方「盈亏概览」，「相对实际」只反映你的改动。',
    { formula: '已实现 P&L = Σ 各手动 Leg（实际已实现 + 改动差额）；新增的腿 = 毛盈亏 − 平仓手续费' },
    unknownFeeLegs > 0
      ? `${feeLine}另有 ${unknownFeeLegs} 条腿只剩复盘快照或摊自战役级已实现，手续费已含在盈亏里、金额未知，不在上面的数里；`
        + '改过这些腿的开平价或仓位时，平仓手续费随之变化的部分按模拟器 Taker 费率扣进它们的盈亏，同样不在上面的数里。'
      : feeLine,
    '标着「挂单中」（未成交）的腿、停用或删除的腿不计入；资金费不并入任何腿。',
  ];
}

/** 手动 Legs 分支峰值的持仓口径：与已实现同一份净额；挂单中的腿不持有。老行按当时的口径如实说明。 */
function manualPeakBasis(result: CampaignCounterfactualResult): string {
  return isCounterfactualResultNetOfFees(result)
    ? '已平的每一刀按与「已实现 P&L」同一份净额计入（没改过的腿即战役页校正后的实际结算值），'
      + '本地有成交记录时，分几刀平掉的腿按各刀自己的平仓时刻切换持仓（本地没有成交记录时，主力 / 镜像与战役页一样按 Leg 快照整条持有，峰值可能高于实际）；'
      + '标着「挂单中」的腿不计入持仓；本地没有成交记录、事件流里也没有触发时刻或历史快照的腿，与战役页一样不持有（已实现照计）；'
      + '历史归类的战役在本地没有成交记录时，主力 / 镜像按 Leg 快照持有，其余只在事件快照里的腿按事件里的成交价、数量与开仓时刻持有，'
      + '平仓时刻与已实现取腿上的（归类之后补上或改过的也算，腿上没有才取事件里的），与战役页同一段；'
      + '归类时还挂着的保护单（事件快照里既没有成交 id 也没有已实现）从未成交，与战役页一样标「挂单中」、不持有；'
      + '腿上存的是委托 id、本地委托记录显示它已撤单或仍挂着的同样算，本地查不到这张委托时无法判定，与战役页一样按成交处理；'
      + '已结束的战役里平仓时间只是兜底的腿，收在战役页扫描窗口的终点（结束时间，但不早于最后一次平仓）；'
      + '摊自战役级已实现的腿与战役页一样平仓后不计那份总额（只计改动的差额），峰值至少取到最终已实现。'
      + '例外：进行中的战役，上方「盈亏概览」只扫到最晚一条成交记录为止（本地一条成交记录都没有时只到开仓那一刻），'
      + '在那之后的持仓（还没平的腿、只剩复盘快照或事件快照且在那之后才平的腿）上方看不到，副本照常持有'
      + '（还没平的腿持有到最后一根 K 线），两边峰值可能不同。'
    : '本分支保存于手续费口径统一之前：已平的腿按毛盈亏计入，从未成交的保护单（如有）也按持有计算，'
      + '分几刀平掉的腿按整条腿持有到最后一刀，峰值可能与上方「盈亏概览」不同。';
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
  // 手动 Legs 分支：副本里主力那条腿的开平价（改过就按改后的）；SOP 推演没有逐腿开平价，不算。
  const mainPriceChangePct = manual
    ? counterfactualMainLegPriceChangePct(branch.params.manual_legs, shared.actualMain)
    : null;
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
      ? manualRealizedPnlHelp(branch.result)
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
        ? '反事实分支从手动 Legs 里角色为主力开仓与镜像止盈的腿的名义仓位还原：有成交记录的腿取上方分给它的那份开仓名义'
          + '（同一笔开仓成交只计一次、滑点后的成交价 × 数量，并进主力仓位却没有腿的加仓不算），「仓位」一格改过则按比例缩放；'
          + '没有成交记录的腿与新增的腿按「仓位」一格。方向与战役相反、上方不计的原始腿，这里同样不计；其余改了方向的腿仍算在内。'
        : '反事实分支从推演参数的入场名义仓位与镜像止盈仓位还原。',
    ],
    ...(manual ? {
      initialExpectedMaxLoss: [
        isCounterfactualResultNetOfFees(branch.result)
          ? '止损线与上方同一份：初始对冲按委托价（不是滑点后的成交价），同一角色几张时按挂出时刻取第一张，'
            + '也读这场战役的反向保护委托（历史归类的战役只认委托快照）与事件流里带价的初始对冲事件；'
            + '几笔主力时，每张保护单归哪一笔主力与上方相同（有成交记录的腿按成交时刻、没有的按挂出时刻，主力按各自的持仓窗口）；'
            + '开仓价改过的腿按改后的价。'
          : { warning: '本分支保存于口径统一之前：止损线只按手动 Legs 的开仓价锚定（成交过的对冲按滑点后的成交价），不含反向委托，可能与上方不同。' },
      ],
    } : {}),
    peakUnrealizedPnl: manual
      ? [peakCaveat(manual, branch.params.run_context), manualPeakBasis(branch.result)]
      : [peakCaveat(manual, branch.params.run_context)],
    asymmetricRiskContribution: [
      { warning: '假设值：本场反事实不在账户样本内，n 与 Σb² 取自真实已了结战役，占比只是「如果它是真的」的示意。' },
    ],
    mainPriceChange: [
      manual
        ? '反事实分支先认真实战役选中的那条主力：它的方向、开仓价、平仓价都没改过时沿用上方「盈亏概览」的涨幅（原样重跑逐位相同），'
          + '改过就按 Legs 副本里改后的开平价算。它被停用或改掉角色时，在参与运行的主力里按「仓位」一格取最大；'
          + '那条腿实际还没平仓、平仓价也没改过时不算（引擎只是按数据末端强行结算）。'
        : 'SOP 推演没有逐腿的开平价，本项与两项效率不计算。',
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
    mainPriceChangePct,
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
