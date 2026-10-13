import type { ReactNode } from 'react';
import { MagicBMethodFormulas } from '@/components/journal/MagicBMethodFormulas';
import { computeSettlementPayoffRatio, resolveUnifiedMagicB } from '@/lib/campaignB';
import type { AsymmetricRiskContribution } from '@/lib/asymmetricRiskMetrics';
import { formatCampaignPayoffRatio, type CampaignInitialRiskSource } from '@/lib/campaignAnalysis';
import type { CampaignBoardPnlItem } from '@/lib/campaignLegsPngExport';
import { computePositionAmplification } from '@/lib/campaignPositionAmplification';
import { computeMagicB, MAGIC_B_RULE, positionGeometricMultiple, POSITION_GEOMETRIC_ALPHA_RULE, POSITION_GEOMETRIC_FORMULA, POSITION_THEORETICAL_FORMULA, type CampaignGeometricMetrics } from '@/lib/campaignGeometricMetrics';
import {
  ARITHMETIC_EXPECTANCY_WIN_RATE,
  computeCampaignExpectanciesFromMagicB,
  formatArithmeticExpectancy,
  formatCampaignLeverage,
  formatGeometricExpectancy,
} from '@/lib/campaignMetrics';
import type { RealizedPnlBasis } from '@/lib/campaignRealizedPnl';
import {
  PRICE_CHANGE_EXIT_RULE_TEXT,
  computeAddEfficiency,
  computeMainPriceEfficiency,
  describePriceChangeExitSource,
  formatEfficiency,
  type CampaignPriceChangeExitSource,
} from '@/lib/campaignMainPriceChange';
import { formatLegPriceChangePct } from '@/lib/legPriceChange';

import { LEG_THEORETICAL_FACTOR_HINT } from '@/lib/campaignLegGeometricFactor';

/** Actual factors, kept together when wrapping; full-precision product, rounded display only. */
function PositionGeometricWorked({ basis, theoretical = false }: { basis?: CampaignGeometricMetrics['geometricMetricBasis']; theoretical?: boolean }) {
  const factors = basis?.theoreticalFactors;
  const ratios = theoretical ? factors?.every(Boolean) ? factors.map(factor => factor!.alpha) : null : basis?.addRatios ?? null;
  const reduction = basis?.earlyReductionFraction ?? null;
  const result = positionGeometricMultiple(ratios ?? null, reduction);
  if (result == null || ratios == null) return <p>{theoretical ? '缺少支撑线、加仓价、成本或首次减仓依据' : '缺少初始币量、首次减仓或实际加仓依据'}，暂不能展开计算。</p>;
  const number = (value: number) => Number(value.toPrecision(12)).toString();
  const first = theoretical ? null : basis?.firstAdd;
  return (
    <div data-testid="position-geometric-worked" className="space-y-2 rounded border border-border/60 bg-muted/40 p-2.5 text-foreground/85">
      <div className="text-[10px] font-medium text-muted-foreground">本场计算过程 · {ratios.length} 次加仓</div>
      <div data-testid="position-geometric-substitution" className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 font-mono tabular-nums">
        <span>(1 − {(reduction! * 100).toFixed(2)}%)</span>
        {ratios.map((ratio, index) => <span key={index} className="whitespace-nowrap">× (1 + {(ratio * 100).toFixed(2)}%)</span>)}
      </div>
      <div data-testid="position-geometric-factors" className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 font-mono tabular-nums">
        <span>≈ {number(1 - reduction!)}</span>
        {ratios.map((ratio, index) => <span key={index} className="whitespace-nowrap">× {number(1 + ratio)}</span>)}
      </div>
      <div data-testid="position-geometric-result" className="border-t border-border/60 pt-2 font-mono font-semibold tabular-nums">≈ {result.toFixed(2)} 倍</div>
      <div className="text-[10px] text-muted-foreground">按完整精度计算；上述代入值与结果仅作四舍五入展示。</div>
      <div className="text-[10px] text-muted-foreground">αf = 首次实际减仓币数 ÷ 初始主力与镜像合计币数；没有减仓取 0。不是所有早期减仓比例的累加。</div>
      {theoretical && factors?.map((factor, index) => factor && <div key={index} className="border-t border-border/60 pt-2 font-mono break-words">α{index + 1}理论 = max(0, {number(factor.support)} − {number(factor.costLine)}{factor.firstAdd ? ` + ${number(factor.bankedProfit)} ÷ ${number(factor.beforeCoins)}` : ''}) ÷ ({number(factor.addPrice)} − {number(factor.support)}) ≈ {(factor.alpha * 100).toFixed(2)}%</div>)}
      {first && <div data-testid="position-geometric-first-add" className="space-y-1.5 border-t border-border/60 pt-2">
        <div className="text-[10px] font-medium text-muted-foreground">首次加仓 · 覆盖预算与整体保本价</div>
        <div className="text-[10px] text-muted-foreground">加仓前 Q₁；旧仓成本 S₁；实际止损 K₁ 不变。</div>
        <div className="font-mono tabular-nums break-words">α₁上限 = max(0, K₁ − S₁ + G ÷ Q₁) ÷ (T₁ − K₁)</div>
        <div className="font-mono tabular-nums break-words">= max(0, {number(first.support)} − {number(first.costLine)} + {number(first.bankedProfit)} ÷ {number(first.beforeCoins)}) ÷ ({number(first.addPrice)} − {number(first.support)}) ≈ {(first.allowedRatio * 100).toFixed(2)}%</div>
        <div className="font-mono tabular-nums break-words">α₁实际 = {number(first.addCoins)} ÷ {number(first.beforeCoins)} ≈ {(first.actualRatio * 100).toFixed(2)}%</div>
        {first.afterCoins != null && first.afterCostLine != null && first.afterBreakevenLine != null && <div className="space-y-1.5 border-t border-border/60 pt-2" data-testid="position-geometric-after-breakeven">
          <div className="text-[10px] font-medium text-muted-foreground">加仓后 · 整体保本价（未扣未来平仓费）</div>
          <div className="font-mono tabular-nums break-words">Q后 = Q₁ + ΔQ₁ = {number(first.beforeCoins)} + {number(first.addCoins)} = {number(first.afterCoins)}</div>
          <div className="font-mono tabular-nums break-words">S后 = (Q₁S₁ + ΔQ₁T₁) ÷ Q后 ≈ {number(first.afterCostLine)}</div>
          <div className="font-mono tabular-nums break-words">K保本 = S后 − G ÷ Q后 = {number(first.afterCostLine)} − {number(first.bankedProfit)} ÷ {number(first.afterCoins)} ≈ {number(first.afterBreakevenLine)}</div>
        </div>}
        <div className="text-[10px] text-muted-foreground">G 只计入一次。K保本是整体保本门槛，不是重新下移实际止损；未加满或超额成交时，两者可以不同。</div>
      </div>}
    </div>
  );
}

/**
 * 盈亏概览的**唯一**一份指标清单构造器。
 *
 * 详情页的「盈亏概览」、导出 PNG 里的同名面板、以及反事实分支的「反事实盈亏概览」
 * 都从这里拿同一组 14 项（同顺序、同文案、同着色）。它只吃一个已经算好的
 * 纯数字对象，不碰 campaign / legs / tradeRecords——谁来算这些数字是调用方的事：
 * 真实战役由详情页的各 memo 算，反事实由 counterfactualOverview 从落库结果里还原。
 * 这样「同一指标两处两个数」在结构上就不可能发生。
 */

export type CampaignPnlOverviewItemKey =
  | 'realizedPnl'
  | 'mainLeverage'
  | 'initialMainExposureNotional'
  | 'peakPriceChange'
  | 'peakPriceEfficiency'
  | 'unrealizedPriceChangePct'
  | 'dynamicMaxDrawdownPct'
  | 'positionAmplification'
  | 'positionGeometricMultiple'
  | 'positionGeometricMultipleTheoretical'
  | 'effectivePriceChangePct'
  | 'effectivePriceChangeMultiple'
  | 'magicB'
  | 'peakUnrealizedPnl'
  | 'initialExpectedMaxLoss'
  | 'mainSideNotional'
  | 'expectedMaxDrawdownPct'
  | 'mainPriceChange'
  | 'mainPriceEfficiency'
  | 'payoffRatio'
  | 'addEfficiency'
  | 'addCount'
  | 'asymmetricRiskContribution'
  | 'arithmeticExpectancy'
  | 'geometricExpectancy';

export type CampaignPnlOverviewItem = CampaignBoardPnlItem & {
  key: CampaignPnlOverviewItemKey;
  help: ReactNode;
  valueClassName?: string;
};

/**
 * 盈亏概览两栏各自从上往下的次序，只在这里写一次（页面面板、反事实面板、导出图都按它排）。
 * 【用户要求】「左右两列对调一下，反事实部分也是」：递进链在左栏，结果与仓位在右栏。
 *
 * 左栏优先展示加仓次数、仓位几何累积倍数、有效涨幅、神奇的 b、盈亏比、几何期望。
 */
export const PNL_OVERVIEW_LEFT_COLUMN: readonly CampaignPnlOverviewItemKey[] = [
  'addCount',
  'positionGeometricMultiple',
  'positionGeometricMultipleTheoretical',
  'effectivePriceChangePct',
  'magicB',
  'payoffRatio',
  'geometricExpectancy',
  'arithmeticExpectancy',
  'expectedMaxDrawdownPct',
  'mainPriceChange',
  'mainPriceEfficiency',
];

/**
 * 右栏：结果与仓位。已实现 P&L 置顶，其后是最大预期亏损、峰值涨幅、峰值涨幅倍数、涨幅未兑现，再放两项名义仓位。
 * 杠杆倍数与 DSI/USI 贡献已经按用户要求迁到「战役元数据」。
 */
export const PNL_OVERVIEW_RIGHT_COLUMN: readonly CampaignPnlOverviewItemKey[] = [
  'realizedPnl',
  'initialExpectedMaxLoss',
  'peakPriceChange',
  'peakPriceEfficiency',
  'unrealizedPriceChangePct',
  'dynamicMaxDrawdownPct',
  'positionAmplification',
  'addEfficiency',
];

/**
 * 帮助文案的可序列化段落：纯字符串是普通段落，formula 是等宽公式框，warning 是黄色警示。
 * 反事实适配器是纯 .ts，用这个模型就能覆盖 / 追加说明而不必写 JSX。
 */
export type CampaignPnlOverviewHelpParagraph =
  | string
  | { formula: string }
  | { warning: string };

export interface CampaignPnlOverviewSettlementInfo {
  basis: RealizedPnlBasis | null;
  /** 落库缓存值，只在 drift 非空时印出来。 */
  stored: number | null;
  /** 落库缓存 − 现算值；调用方只在超过容差（hasMaterialDrift）时给值，否则 null。 */
  drift: number | null;
}

export interface CampaignPnlOverviewMetrics {
  realizedPnl: number | null;
  settlement: CampaignPnlOverviewSettlementInfo | null;
  mainLeverage: number | null;
  initialMainExposureNotional: number;
  peakUnrealizedPnl: number;
  /** 主力持有窗口内相对基准开仓价的最大有利价格涨幅；老反事实分支没有价格路径时为 null。 */
  peakPriceChangePct?: number | null;
  /** 持仓期间此前峰值到此后谷值的最大标准化回撤率。 */
  dynamicMaxDrawdownPct?: number | null;
  initialExpectedMaxLoss: number;
  /**
   * 【用户要求】主方向那一侧（主多战役是多单）所有已成交腿的名义仓位合计：主力、镜像、加仓都算，挂单中的不算；
   * 与 Legs 表合计行这一侧的 Σ名义仓位同一个数（campaignMainSideNotional）。读不到（SOP 推演没有逐腿）时为 null。
   */
  mainSideNotional: { side: 'long' | 'short'; total: number | null } | null;
  expectedMaxDrawdownPct: number;
  /** 原净盈亏风险比缓存（百分数）；盈亏概览按已实现净盈亏与初始风险金额重算。 */
  payoffRatio: number | null;
  /**
   * 战役的涨跌幅（%，按主力方向计；见 computeCampaignPriceChange：开仓价取主力最有利的一笔，主力平仓时若有对冲锁住行情，
   * 平仓价取最早那张对冲的开仓价），与战役卡片同一个数；主力都未平仓时 null。
   * 涨跌幅倍数与加仓效用由它和预期回撤、原盈亏比在构造器里现算（computeMainPriceEfficiency / computeAddEfficiency）。
   */
  mainPriceChangePct: number | null;
  /** 涨跌幅的依据（只进 ⓘ 说明）：开仓价、平仓价、平仓价取自主力还是哪张对冲；SOP 推演没有逐腿数据时可缺省。 */
  mainPriceChangeBasis?: { entryPrice: number | null; exitPrice: number | null; exitSource: CampaignPriceChangeExitSource | null } | null;
  /** 战役（或反事实副本）里有没有成交过的加仓腿；没有加仓时「加仓效用」不算（campaignHasMainAdd）。 */
  hasMainAdd: boolean;
  asymmetricRiskContribution: AsymmetricRiskContribution | null;
  arithmeticExpectancy: number | null;
  geometricExpectancy: number | null;
  effectivePriceChangePct?: number | null;
  effectivePriceChangeMultiple?: number | null;
  positionGeometricMultiple?: number | null;
  positionGeometricMultipleTheoretical?: number | null;
  addCount?: number | null;
  magicB?: number | null;
  geometricMetricBasis?: CampaignGeometricMetrics['geometricMetricBasis'];
  initialRisk: { drawdownFraction: number; source: CampaignInitialRiskSource } | null;
  /** 整段替换某一项的帮助文案（含义与真实战役不同时用）。 */
  helpOverrides?: Partial<Record<CampaignPnlOverviewItemKey, CampaignPnlOverviewHelpParagraph[]>>;
  /** 在标准帮助文案末尾追加的说明（口径相同、只差一个前提时用）。 */
  extraNotes?: Partial<Record<CampaignPnlOverviewItemKey, CampaignPnlOverviewHelpParagraph[]>>;
}

/**
 * 涨幅未兑现 = 峰值涨幅 − 最终涨跌幅。
 * 只要峰值涨幅与最终涨跌幅可用就计算。
 */
export function computeUnrealizedPriceChangePct(
  mainPriceChangePct: number | null | undefined,
  peakPriceChangePct: number | null | undefined,
): number | null {
  if (mainPriceChangePct == null || !Number.isFinite(mainPriceChangePct)
    || peakPriceChangePct == null || !Number.isFinite(peakPriceChangePct)) return null;
  const value = peakPriceChangePct - mainPriceChangePct;
  return Number.isFinite(value) ? value : null;
}

export function pnlColor(value: number | null) {
  if (value == null) return 'text-muted-foreground';
  if (value > 0) return 'text-[#0ECB81]';
  if (value < 0) return 'text-[#F6465D]';
  return 'text-muted-foreground';
}

export function pnlExportColor(value: number | null): string {
  if (value == null || value === 0) return '#64748B';
  return value > 0 ? '#0ECB81' : '#F6465D';
}

function renderHelpParagraphs(paragraphs: CampaignPnlOverviewHelpParagraph[], keyPrefix: string): ReactNode {
  return paragraphs.map((paragraph, index) => {
    const key = `${keyPrefix}-${index}`;
    if (typeof paragraph === 'string') return <p key={key}>{paragraph}</p>;
    if ('formula' in paragraph) {
      return <div key={key} className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">{paragraph.formula}</div>;
    }
    return <p key={key} className="text-[#F0B90B]">{paragraph.warning}</p>;
  });
}

function withHelpCustomisation(
  key: CampaignPnlOverviewItemKey,
  standard: ReactNode,
  metrics: CampaignPnlOverviewMetrics,
): ReactNode {
  const override = metrics.helpOverrides?.[key];
  const extra = metrics.extraNotes?.[key];
  const body = override ? renderHelpParagraphs(override, `${key}-override`) : standard;
  if (!extra || extra.length === 0) return body;
  return (
    <>
      {body}
      {renderHelpParagraphs(extra, `${key}-extra`)}
    </>
  );
}

/**
 * 盈亏概览里的神奇的 b读数：【用户要求】只写倍数 b（「0.59」），与封面同一个写法（formatCampaignPayoffRatio）；
 * 详情页、反事实面板与导出 PNG 都读这一格。红绿按同一个取整后的 b 定（campaignPayoffRatioMultiple）。
 */
export function formatOverviewPayoffRatio(value: number): string {
  return formatCampaignPayoffRatio(value);
}

/** 组内占比的读数：一位小数；大于 0 但不到 0.1% 写「<0.1%」，免得读成 0；缺值不写。 */
function formatContributionShare(share: number | null | undefined): string {
  if (share == null || !Number.isFinite(share)) return '';
  const pct = share * 100;
  if (pct > 0 && pct < 0.05) return '<0.1%';
  return `${pct.toFixed(1)}%`;
}

export function buildCampaignPnlOverviewItems(metrics: CampaignPnlOverviewMetrics): CampaignPnlOverviewItem[] {
  const {
    realizedPnl,
    settlement: pnlSettlement,
    mainLeverage,
    initialMainExposureNotional,
    peakPriceChangePct = null,
    dynamicMaxDrawdownPct = null,
    initialExpectedMaxLoss,
    mainSideNotional,
    expectedMaxDrawdownPct: expectedDrawdownPct,
    mainPriceChangePct,
    mainPriceChangeBasis,
    hasMainAdd,
    asymmetricRiskContribution,
  } = metrics;
  const mainPriceEfficiency = computeMainPriceEfficiency(mainPriceChangePct, expectedDrawdownPct);
  const peakPriceEfficiency = computeMainPriceEfficiency(peakPriceChangePct, expectedDrawdownPct);
  const unrealizedPriceChangePct = computeUnrealizedPriceChangePct(mainPriceChangePct, peakPriceChangePct);
  const positionAmplification = computePositionAmplification(initialMainExposureNotional, mainSideNotional?.total);
  const magicB = resolveUnifiedMagicB(metrics.magicB);
  const payoff = computeSettlementPayoffRatio(realizedPnl, initialExpectedMaxLoss);
  const { arithmeticExpectancy, geometricExpectancy } = computeCampaignExpectanciesFromMagicB(payoff);
  const addEfficiency = hasMainAdd
    ? computeAddEfficiency(payoff, mainPriceEfficiency)
    : null;
  const pnlDrift = pnlSettlement?.drift ?? null;

  const built: CampaignPnlOverviewItem[] = [
    {
      key: 'payoffRatio', label: '盈亏比',
      value: payoff == null ? '—' : formatOverviewPayoffRatio(payoff * 100),
      color: pnlExportColor(payoff), valueClassName: pnlColor(payoff == null ? null : Number(payoff.toFixed(2))),
      help: <><p className="font-mono">盈亏比 = 已实现净盈亏 ÷ 初始最大预期亏损 L₀</p>
        {payoff != null && <div className="rounded border border-border/60 bg-muted/40 p-2.5 font-mono tabular-nums break-words" data-testid="payoff-ratio-worked">本场：{realizedPnl!.toFixed(2)} U ÷ {initialExpectedMaxLoss.toFixed(2)} U ≈ {payoff.toFixed(8)}</div>}
        <p>已实现净盈亏与本场结算同源，包含各次交易的结算结果。L₀ 使用交易开始时的最大预期亏损；盈利为正，亏损保留负号。没有加仓的战役同样计算，缺少有效初始风险时显示「—」。</p></>,
    },
    {
      key: 'addCount', label: '加仓次数',
      value: metrics.addCount == null ? '—' : String(metrics.addCount),
      color: '#1E2329', valueClassName: 'text-foreground/85',
      help: <><p>本场真正成交过的主力加仓 Legs 数量，与列表、排序和散点图使用同一口径。</p><p>只挂单但未成交的加仓不计入；没有加仓时显示 0。</p></>,
    },
    {
      key: 'realizedPnl',
      label: '已实现 P&L',
      value: realizedPnl == null ? '—' : `${realizedPnl.toFixed(2)} USDT`,
      color: pnlExportColor(realizedPnl),
      valueClassName: pnlColor(realizedPnl),
      help: (
        <>
          <p>本场战役所有已平仓 Legs 的实际盈亏合计，包括主仓、加仓、对冲与止盈的已实现结果。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">已实现 P&amp;L = Σ 各已平仓 Leg 盈亏</div>
          <p>
            这个数与下方 Legs 表的「合计」行、卡片上的状态标签同源，按构造必然相等；
            取自{' '}
            <span className="text-foreground">
              {pnlSettlement?.basis === 'records' ? '成交记录'
                : pnlSettlement?.basis === 'mixed' ? '成交记录 + 复盘快照'
                : pnlSettlement?.basis === 'leg_snapshots' ? '复盘快照'
                : pnlSettlement?.basis === 'events' ? '战役事件'
                : pnlSettlement?.basis === 'campaign_summary' ? '落库缓存'
                : '尚未结算'}
            </span>
            。一个仓位分几刀平掉时，每一刀都计入；资金费不并入任何腿。
          </p>
          {pnlDrift != null && (
            <p className="text-[#F0B90B]">
              落库缓存为 {pnlSettlement?.stored?.toFixed(2)} USDT，与现算值相差 {pnlDrift.toFixed(2)} USDT。
              下次读取本战役时会自动回写收敛；若长期不归零说明写库失败。
            </p>
          )}
        </>
      ),
    },
    {
      key: 'mainLeverage',
      label: '杠杆倍数',
      value: formatCampaignLeverage(mainLeverage),
      help: (
        <>
          <p>本场战役主力头仓开仓时使用的杠杆倍数，不把后续加仓或对冲腿的杠杆混入。</p>
          <p>历史战役依次从主力 Leg、关联成交记录、战役初始字段和主力开仓事件回填。</p>
          <p>杠杆影响保证金占用与 ROE；名义仓位已经确定时，不再额外放大绝对盈亏。</p>
        </>
      ),
    },
    {
      key: 'initialMainExposureNotional',
      label: '主力开仓名义仓位',
      value: initialMainExposureNotional > 0
        ? `${initialMainExposureNotional.toFixed(2)} USDT`
        : '—',
      help: (
        <>
          <p>入场时主方向的全部初始敞口：M 加镜像仓位，按镜像 TP 落袋之前的真实全暴露计算。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">主力开仓名义仓位 = 初始 M 名义仓位 + 初始镜像名义仓位</div>
          <p>后续加仓、重入仓位和反向对冲均不计入；历史战役从成交记录、Leg 快照及事件流去重还原。</p>
        </>
      ),
    },
    {
      key: 'peakPriceChange',
      label: '峰值涨幅',
      value: formatLegPriceChangePct(peakPriceChangePct),
      color: pnlExportColor(peakPriceChangePct),
      valueClassName: pnlColor(peakPriceChangePct),
      help: (
        <>
          <p>主力持有期间，价格相对主力基准开仓价曾经走出的最大有利涨幅：主多取 K 线最高价，主空取 K 线最低价。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">峰值涨幅 = maxₜ（按主力方向计的价格涨跌幅ₜ）</div>
          <p>开仓价与普通「涨跌幅」相同；终点改为主力持有窗口内的盘中最有利价，因此它不等于整套多空组合的「峰值浮盈」。</p>
        </>
      ),
    },
    {
      key: 'peakPriceEfficiency',
      label: '峰值涨幅倍数',
      value: formatEfficiency(peakPriceEfficiency),
      color: pnlExportColor(peakPriceEfficiency),
      valueClassName: pnlColor(peakPriceEfficiency),
      help: (
        <>
          <p>峰值行情走出了几个初始预期回撤，用于把不同波动尺度的战役放在同一把尺上比较。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">峰值涨幅倍数 = 峰值涨幅 ÷ 预期回撤</div>
          {peakPriceEfficiency == null
            ? <p>缺少 K 线、主力基准开仓价或有效预期回撤时不计算。</p>
            : <p className="font-mono text-foreground">本场 = {formatLegPriceChangePct(peakPriceChangePct)} ÷ {expectedDrawdownPct.toFixed(2)}% = {formatEfficiency(peakPriceEfficiency)}</p>}
        </>
      ),
    },
    {
      key: 'unrealizedPriceChangePct',
      label: '涨幅未兑现',
      value: unrealizedPriceChangePct == null ? '—' : `${unrealizedPriceChangePct.toFixed(2)}%`,
      color: unrealizedPriceChangePct == null ? '#848E9C' : unrealizedPriceChangePct > 2 * expectedDrawdownPct ? '#F6465D' : '#181A20',
      valueClassName: unrealizedPriceChangePct == null
        ? 'text-muted-foreground' : unrealizedPriceChangePct > 2 * expectedDrawdownPct ? 'text-[#F6465D]' : 'text-foreground',
      help: (
        <>
          <p>主力曾经走出的峰值涨幅与最终涨跌幅之差。数值越高，表示从峰值回吐的百分点越多。</p>
          <p>只要峰值涨幅与最终涨跌幅可用就计算。</p>
          <p>读数大于 2 倍预期回撤时标红，否则使用正文色。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">涨幅未兑现 = 峰值涨幅 − 涨跌幅</div>
          {unrealizedPriceChangePct == null
            ? <p>缺少最终涨跌幅或历史 K 线峰值时不计算。</p>
            : <p className="font-mono text-foreground">本场 = {formatLegPriceChangePct(peakPriceChangePct)} − {formatLegPriceChangePct(mainPriceChangePct)} = {unrealizedPriceChangePct.toFixed(2)}%</p>}
        </>
      ),
    },
    {
      key: 'dynamicMaxDrawdownPct',
      label: '动态最大回撤',
      value: dynamicMaxDrawdownPct == null ? '—' : `${dynamicMaxDrawdownPct.toFixed(2)}%`,
      color: dynamicMaxDrawdownPct == null ? '#848E9C' : '#181A20',
      valueClassName: dynamicMaxDrawdownPct == null ? 'text-muted-foreground' : 'text-foreground',
      help: (
        <>
          <p>主力有效持仓期间，从此前已经出现的价格高点到此后低点的最大跌幅。它衡量持仓过程真正经历过的最深峰谷回撤，而不是开仓到平仓的涨跌幅。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">动态最大回撤 = maxₜ［（此前峰值 − 此后谷值）÷ 此前峰值］× 100%</div>
          <p>通常计算到主力平仓；若最后一次滚动对冲与主力在同一次操作中平仓，则该对冲触发后风险已被锁住，计算窗口提前结束于这张对冲的开仓时刻。</p>
          <p>高点必须早于低点；按当前计算周期 K 线估计，同一根 K 线内 high 与 low 的先后未知，因此不把同根 K 线强行解释成一次完整峰谷。</p>
        </>
      ),
    },
    {
      key: 'initialExpectedMaxLoss',
      label: '最大预期亏损',
      value: initialExpectedMaxLoss > 0
        ? `${initialExpectedMaxLoss.toFixed(2)} USDT`
        : '—',
      help: (
        <>
          <p>入场时 M 加镜像的真实全暴露，在初始对冲 A/B 风险边界下承担的最大亏损额。神奇的 b 沿用同一初始风险边界对应的回撤百分比。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">最大预期亏损 = 主力开仓名义仓位 × 预期回撤比例</div>
          <p><strong>一场有多笔主力时，按笔各算各的、再求和</strong>：每笔主力用它<strong>自己</strong>的开仓价、
            自己那笔镜像的敞口、以及开仓 ±5 分钟内挂出的<strong>自己</strong>那批保护单。
            上面那条等式仍然成立——「预期回撤比例」是按敞口加权的等效值。</p>
          <p>后续加仓、重入仓位和反向对冲不计入主力开仓名义仓位；开仓 5 分钟之后才挂出的追踪单
            属于新决策，不会抬高这个数。</p>
        </>
      ),
    },
    {
      key: 'mainSideNotional',
      // 【用户要求】「多方的总名义仓位包括所有多方的仓位，包括主力、镜像、加仓的多单」；主空战役同理是空方
      label: `${mainSideNotional?.side === 'short' ? '空方' : '多方'}总名义仓位`,
      value: mainSideNotional?.total != null && mainSideNotional.total > 0
        ? `${mainSideNotional.total.toFixed(2)} USDT`
        : '—',
      help: (
        <>
          <p>
            本场战役{mainSideNotional?.side === 'short' ? '空方（主力方向）' : '多方（主力方向）'}所有腿的名义仓位合计：
            主力、镜像、加仓、重新入场的主力都算，每条腿取 Legs 表「仓位」列那个数（开仓时的委托名义）。
          </p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">
            {mainSideNotional?.side === 'short' ? '空方' : '多方'}总名义仓位 = Σ 同方向各腿的名义仓位
          </div>
          <p>
            与 Legs 表合计行「币量 / 仓位」格里{mainSideNotional?.side === 'short' ? '空单' : '多单'}那一组的 Σ 名义仓位同一个数
            （也是「{mainSideNotional?.side === 'short' ? '空单' : '多单'}占比」列的分母）。还挂着没成交的腿不算；已成交未平的是真实持仓，照常计入。
            反向的对冲腿不在这一侧，不计入。
          </p>
          <p>它是整场累计投入的名义，不是某一刻同时持有的最大仓位：先平掉再开的腿会各算一次。</p>
        </>
      ),
    },
    {
      key: 'positionAmplification',
      label: '仓位放大',
      value: positionAmplification == null ? '—' : `${positionAmplification.toFixed(2)}x`,
      help: (
        <>
          <p>本场主方向累计名义仓位，相对于入场时主力与镜像初始敞口的放大倍数。</p>
          {/* 算式一行一项：接成一行在 18rem 的浮层里放不下，会从名字中间（最后一个字单独掉到下一行）或数字与单位之间折断 */}
          <div className="grid grid-cols-[max-content_max-content_max-content] gap-x-1.5 rounded bg-muted/60 px-2 py-1 font-mono text-foreground">
            <span>仓位放大</span><span>=</span><span>{mainSideNotional?.side === 'short' ? '空方' : '多方'}总名义仓位</span>
            <span /><span>÷</span><span>主力开仓名义仓位</span>
          </div>
          {/* 【用户要求】「仓位这里是按照什么计的？需要加上单位」 */}
          <p>两项都是<strong>名义仓位，单位 USDT</strong>：每条腿的名义仓位 = 开仓价 × 币量，不是币量，也不是保证金。</p>
          <p>分子包含同方向已成交的主力、镜像、加仓和重新入场腿；挂单与反向对冲不计。它表示整场累计投入的名义倍数，不等于任一时刻同时持有的最大仓位。</p>
          {positionAmplification != null && mainSideNotional?.total != null && (
            <div data-testid="position-amplification-worked" className="grid grid-cols-[max-content_max-content_max-content] gap-x-1.5 font-mono tabular-nums text-foreground">
              <span>本场</span><span>=</span><span className="text-right">{mainSideNotional.total.toFixed(2)} USDT</span>
              <span /><span>÷</span><span className="text-right">{initialMainExposureNotional.toFixed(2)} USDT</span>
              <span /><span>=</span><span>{positionAmplification.toFixed(2)}x</span>
            </div>
          )}
        </>
      ),
    },
    {
      key: 'expectedMaxDrawdownPct',
      label: '预期回撤',
      value: expectedDrawdownPct > 0 ? `${expectedDrawdownPct.toFixed(2)}%` : '—',
      help: (
        <>
          <p>主力开仓价到初始对冲 A/B 中更远一条风险边界的价格距离，占主力开仓价的百分比。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">
            d = max（|主力价 − A 价|，|主力价 − B 价|）÷ 主力价 × 100%
          </div>
        </>
      ),
    },
    {
      key: 'mainPriceChange',
      label: '涨跌幅',
      value: formatLegPriceChangePct(mainPriceChangePct),
      color: pnlExportColor(mainPriceChangePct),
      valueClassName: pnlColor(mainPriceChangePct),
      help: (
        <>
          <p>战役从开仓价到平仓价的涨跌幅，按主力方向计：主多价格涨了为正，主空价格跌了为正。与战役列表卡片是同一个数（开平价含 1 分钟 K 线平仓价校正）。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">涨跌幅 = ±（平仓价 − 开仓价）÷ 开仓价 × 100%</div>
          <p><strong>开仓价</strong>取主力各笔里最有利的那个：主多最低、主空最高。<strong>平仓价</strong>{PRICE_CHANGE_EXIT_RULE_TEXT.slice('平仓价'.length)}</p>
          {mainPriceChangeBasis?.entryPrice != null && mainPriceChangeBasis.exitPrice != null ? (
            <p className="font-mono text-foreground">
              本场：{mainPriceChangeBasis.entryPrice} → {mainPriceChangeBasis.exitPrice}
              {/* 来源注记单独一行、不加括号：「初始对冲 B」这类长名字接在价格后面会在名字中间折行，行首全角括号又像缩进 */}
              <span className="block text-muted-foreground">{describePriceChangeExitSource(mainPriceChangeBasis.exitSource)}</span>
            </p>
          ) : <p>主力都还没平仓时显示「—」。</p>}
        </>
      ),
    },
    {
      key: 'mainPriceEfficiency',
      label: '涨跌幅倍数',
      value: formatEfficiency(mainPriceEfficiency),
      color: pnlExportColor(mainPriceEfficiency),
      valueClassName: pnlColor(mainPriceEfficiency),
      help: (
        <>
          <p>价格走出了几个「预期回撤」：主力涨了 12%、入场到对冲边界 4%，倍数就是 +3.00。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">涨跌幅倍数 = 主力涨跌幅 ÷ 预期回撤</div>
          {mainPriceEfficiency != null ? (
            <p className="font-mono text-foreground">
              本场 = {formatLegPriceChangePct(mainPriceChangePct)} ÷ {expectedDrawdownPct.toFixed(2)}% = {formatEfficiency(mainPriceEfficiency)}
            </p>
          ) : <p>主力未平仓或算不出预期回撤时不计算。</p>}
        </>
      ),
    },
    {
      key: 'addEfficiency',
      label: '加仓效用',
      value: formatEfficiency(addEfficiency),
      // 【用户要求】颜色按这一场的 b：效用正负与本场 b 一致
      color: pnlExportColor(addEfficiency == null ? null : payoff),
      valueClassName: pnlColor(addEfficiency == null ? null : payoff),
      help: (
        <>
          <p>比较实际盈亏比与行情的风险倍数，<strong>只在做过加仓时计算</strong>。分母取涨跌幅倍数的绝对值；涨跌幅倍数显示为 0.00 或盈亏比缺失时不计算。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">加仓效用 = 盈亏比 ÷ |涨跌幅倍数|</div>
          {addEfficiency != null ? (
            <p className="font-mono text-foreground">
              本场 = {formatCampaignPayoffRatio((payoff ?? 0) * 100)} ÷ |{formatEfficiency(mainPriceEfficiency)}| = {formatEfficiency(addEfficiency)}
            </p>
          ) : <p>{hasMainAdd ? '本场涨跌幅倍数显示为 0.00 或算不出，或算不出盈亏比，不计算。' : '本场没有加仓，不计算加仓效用。'}</p>}
        </>
      ),
    },
    {
      key: 'asymmetricRiskContribution',
      // 【用户要求】「简化一下，细节信息放在说明部分」：行内只写进了哪一组、占组内多少，均方项与样本数放进 ⓘ
      label: 'DSI/USI 贡献',
      value: asymmetricRiskContribution == null
        ? '—'
        : `${asymmetricRiskContribution.group === 'win' ? 'USI' : 'DSI'} ${formatContributionShare(asymmetricRiskContribution.meanSquareShare)}`.trim(),
      help: (
        <>
          <p>本场盈亏比对账户不对称风险指标的贡献：盈利战役进入 USI 的上行组，亏损或持平战役进入 DSI 的下行组。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">组内占比 = 本场 b² ÷ 对应组 Σb²</div>
          <p>读数就是这个占比，用于定位哪些战役拉高了 DSI 或支撑了 USI；不到 0.1% 写「&lt;0.1%」。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">本场均方贡献 = b² ÷ 对应组样本数 n</div>
          {asymmetricRiskContribution != null ? (
            <p className="font-mono text-foreground">
              {`本场：${asymmetricRiskContribution.group === 'win' ? 'USI 上行组' : 'DSI 下行组'}，b = ${formatCampaignPayoffRatio((payoff ?? 0) * 100)}，n = ${asymmetricRiskContribution.sampleCount}，b²/n = ${asymmetricRiskContribution.meanSquareTerm.toFixed(4)}`}
              {asymmetricRiskContribution.meanSquareShare == null
                ? ''
                : `，组内占比 ${(asymmetricRiskContribution.meanSquareShare * 100).toFixed(2)}%`}
            </p>
          ) : <p>本场缺少有效最大预期亏损，或账户级样本尚未加载，因此不计算。</p>}
        </>
      ),
    },
    {
      key: 'arithmeticExpectancy',
      label: '算术期望',
      value: formatArithmeticExpectancy(arithmeticExpectancy),
      color: pnlExportColor(arithmeticExpectancy),
      valueClassName: pnlColor(arithmeticExpectancy),
      help: (
        <>
          <p>胜率 P 统一取 50%，以本场盈亏比计算期望。P 不随账户实时胜率变动，同一场战役的读数由它自己的盈亏比决定。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">E = P × b −（1 − P），P = 50%</div>
          {payoff != null ? (
            <p className="font-mono text-foreground">
              本场：{(ARITHMETIC_EXPECTANCY_WIN_RATE * 100).toFixed(2)}% × {formatCampaignPayoffRatio(payoff * 100)} − {((1 - ARITHMETIC_EXPECTANCY_WIN_RATE) * 100).toFixed(2)}%
            </p>
          ) : <p>缺少有效盈亏比时不计算。</p>}
        </>
      ),
    },
    {
      key: 'geometricExpectancy',
      label: '几何期望',
      value: formatGeometricExpectancy(geometricExpectancy),
      color: pnlExportColor(geometricExpectancy),
      valueClassName: pnlColor(geometricExpectancy),
      help: (
        <>
          <p>以本场盈亏比和固定风险比例 x = 10% 计算几何增长因子。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">Gᵢ = max(0, 1 + b × 10%)</div>
          {payoff != null ? <p className="font-mono text-foreground">本场：max(0, 1 + {formatCampaignPayoffRatio(payoff * 100)} × 10%) ≈ {formatGeometricExpectancy(geometricExpectancy)}</p> : <p>缺少有效盈亏比时不计算。</p>}
        </>
      ),
    },
  ];

  // 按两栏次序重排：先左栏（递进链）、再右栏（结果与仓位，标 rightColumn），窄屏单栏时也是这个先后。
  built.push({
    key: 'effectivePriceChangePct', label: '有效涨幅',
    value: metrics.effectivePriceChangePct == null ? '—' : `${metrics.effectivePriceChangePct.toFixed(2)}%`,
    color: pnlExportColor(metrics.effectivePriceChangePct), valueClassName: pnlColor(metrics.effectivePriceChangePct),
    help: <><p className="font-mono">有效涨幅 = (F − Kₘ) ÷ Kₘ</p><p>F 与「涨跌幅」指标的平仓价使用同一份取值逻辑和依据；Kₘ 为最后一次实际加仓时的新支撑线，与加仓校验共用依据。没有实际加仓、主力尚未平仓或缺少价格依据时显示「—」。</p><p>{PRICE_CHANGE_EXIT_RULE_TEXT}</p>{metrics.geometricMetricBasis && <p className="font-mono">F = {metrics.geometricMetricBasis.finalExitPrice ?? '—'}；Kₘ = {metrics.geometricMetricBasis.lastSupport ?? '—'}</p>}</>,
  });
  built.push({
    key: 'positionGeometricMultiple', label: '仓位几何累积倍数',
    value: metrics.positionGeometricMultiple == null ? '—' : `${metrics.positionGeometricMultiple.toFixed(2)}x`,
    color: '#1E2329', valueClassName: 'text-foreground/85',
    help: <><p className="font-mono">仓位几何累积倍数 = {POSITION_GEOMETRIC_FORMULA}</p><PositionGeometricWorked basis={metrics.geometricMetricBasis} /><p>{POSITION_GEOMETRIC_ALPHA_RULE}</p><p>最初的 1 对应初始主力与镜像仓位合计币数；先乘首次实际减仓后的保留比例，再累乘实际成交加仓因子。若还有其他减仓或重新入场，不等同于最终持仓 ÷ 初始总币数。依据不完整时显示「—」。</p></>,
  });
  {
    built.push({ key: 'positionGeometricMultipleTheoretical', label: '仓位几何累积倍数（理论）', value: metrics.positionGeometricMultipleTheoretical == null ? '—' : `${metrics.positionGeometricMultipleTheoretical.toFixed(2)}x`, color: '#1E2329', valueClassName: 'text-foreground/85', help: <><p className="font-mono">仓位几何累积倍数（理论） = {POSITION_THEORETICAL_FORMULA}</p><PositionGeometricWorked basis={metrics.geometricMetricBasis} theoretical /><p>{LEG_THEORETICAL_FACTOR_HINT}</p></> });
    const worked = computeMagicB(metrics.effectivePriceChangePct, metrics.positionGeometricMultiple);
    const number = (value: number) => Number(value.toPrecision(12)).toString();
    built.push({
      key: 'magicB', label: '神奇的 b',
      value: magicB == null ? '—' : formatOverviewPayoffRatio(magicB * 100),
      color: pnlExportColor(magicB == null ? null : Number(magicB.toFixed(2))), valueClassName: pnlColor(magicB == null ? null : Number(magicB.toFixed(2))),
      help: <><MagicBMethodFormulas realizedPnl={realizedPnl} initialRisk={initialExpectedMaxLoss} geometricWorked={
      worked != null && <div className="space-y-2 border-t border-border/60 pt-2 font-mono tabular-nums break-words" data-testid="magic-b-worked">
        <div className="text-[10px] font-medium text-muted-foreground">本场计算过程</div>
        <div>有效涨幅 = {number(metrics.effectivePriceChangePct!)}% = {number(metrics.effectivePriceChangePct! / 100)}</div>
        <div>b = {number(metrics.positionGeometricMultiple!)} × {number(metrics.effectivePriceChangePct! / 100)}</div>
        <div className="font-semibold">≈ {worked.toFixed(8)}</div>
        <div className="font-sans text-[10px] text-muted-foreground">按完整精度计算，代入值仅作四舍五入展示。</div>
      </div>} />
      {magicB == null && <p>仓位几何累积倍数或有效涨幅缺少有效依据时显示「—」。</p>}
      <p>{MAGIC_B_RULE}</p></>,
    });
  }
  const byKey = new Map(built.map(item => [item.key, item]));
  const items: CampaignPnlOverviewItem[] = [
    ...PNL_OVERVIEW_LEFT_COLUMN.filter(key => byKey.has(key)).map(key => byKey.get(key)!),
    ...PNL_OVERVIEW_RIGHT_COLUMN.filter(key => byKey.has(key)).map(key => ({ ...byKey.get(key)!, rightColumn: true })),
  ];

  if (!metrics.helpOverrides && !metrics.extraNotes) return items;
  return items.map(item => ({ ...item, help: withHelpCustomisation(item.key, item.help, metrics) }));
}
