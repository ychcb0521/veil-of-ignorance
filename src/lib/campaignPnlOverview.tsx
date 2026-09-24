import type { ReactNode } from 'react';
import type { AsymmetricRiskContribution } from '@/lib/asymmetricRiskMetrics';
import { formatCampaignPayoffRatio, type CampaignInitialRiskSource } from '@/lib/campaignAnalysis';
import type { CampaignBoardPnlItem } from '@/lib/campaignLegsPngExport';
import {
  ARITHMETIC_EXPECTANCY_WIN_RATE,
  formatArithmeticExpectancy,
  formatCampaignLeverage,
  formatGeometricExpectancy,
} from '@/lib/campaignMetrics';
import type { RealizedPnlBasis } from '@/lib/campaignRealizedPnl';
import { computeAddEfficiency, computeMainPriceEfficiency, formatEfficiency } from '@/lib/campaignMainPriceChange';
import { formatLegPriceChangePct } from '@/lib/legPriceChange';

/**
 * 盈亏概览的**唯一**一份指标清单构造器。
 *
 * 详情页的「盈亏概览」、导出 PNG 里的同名面板、以及反事实分支的「反事实盈亏概览」
 * 都从这里拿同一组 12 项（同顺序、同文案、同着色）。它只吃一个已经算好的
 * 纯数字对象，不碰 campaign / legs / tradeRecords——谁来算这些数字是调用方的事：
 * 真实战役由详情页的各 memo 算，反事实由 counterfactualOverview 从落库结果里还原。
 * 这样「同一指标两处两个数」在结构上就不可能发生。
 */

export type CampaignPnlOverviewItemKey =
  | 'realizedPnl'
  | 'mainLeverage'
  | 'initialMainExposureNotional'
  | 'peakUnrealizedPnl'
  | 'initialExpectedMaxLoss'
  | 'expectedMaxDrawdownPct'
  | 'mainPriceChange'
  | 'mainPriceEfficiency'
  | 'payoffRatio'
  | 'addEfficiency'
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
 * 左栏：结果与仓位。
 */
export const PNL_OVERVIEW_LEFT_COLUMN: readonly CampaignPnlOverviewItemKey[] = [
  'realizedPnl',
  'peakUnrealizedPnl',
  'mainLeverage',
  'initialMainExposureNotional',
  'initialExpectedMaxLoss',
  'asymmetricRiskContribution',
];

/**
 * 右栏：【用户要求】「预期回撤、涨幅、涨幅效率、盈亏比、加仓效率、几何期望、算术期望，这几个变量要放在同一列，
 * 因为这些指标是层层递进的」——与战役封面、列表排序栏同序，上一项是下一项的分母或来源。
 */
export const PNL_OVERVIEW_CHAIN_COLUMN: readonly CampaignPnlOverviewItemKey[] = [
  'expectedMaxDrawdownPct',
  'mainPriceChange',
  'mainPriceEfficiency',
  'payoffRatio',
  'addEfficiency',
  'geometricExpectancy',
  'arithmeticExpectancy',
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
  initialExpectedMaxLoss: number;
  expectedMaxDrawdownPct: number;
  /** b × 100（与 accuracy.profit_capture_ratio 同口径）；没有风险分母时 null。 */
  payoffRatio: number | null;
  /**
   * 主力的涨跌幅（%，按主力方向计；多笔主力取涨幅最大的那笔），与 Legs 表「涨跌幅」列、战役卡片同一个数；主力都未平仓时 null。
   * 涨幅效率与加仓效率由它和预期回撤、盈亏比在构造器里现算（computeMainPriceEfficiency / computeAddEfficiency）。
   */
  mainPriceChangePct: number | null;
  /** 战役（或反事实副本）里有没有成交过的加仓腿；没有加仓时「加仓效率」不算（campaignHasMainAdd）。 */
  hasMainAdd: boolean;
  asymmetricRiskContribution: AsymmetricRiskContribution | null;
  arithmeticExpectancy: number | null;
  geometricExpectancy: number | null;
  initialRisk: { drawdownFraction: number; source: CampaignInitialRiskSource } | null;
  /** 整段替换某一项的帮助文案（含义与真实战役不同时用）。 */
  helpOverrides?: Partial<Record<CampaignPnlOverviewItemKey, CampaignPnlOverviewHelpParagraph[]>>;
  /** 在标准帮助文案末尾追加的说明（口径相同、只差一个前提时用）。 */
  extraNotes?: Partial<Record<CampaignPnlOverviewItemKey, CampaignPnlOverviewHelpParagraph[]>>;
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

export function buildCampaignPnlOverviewItems(metrics: CampaignPnlOverviewMetrics): CampaignPnlOverviewItem[] {
  const {
    realizedPnl,
    settlement: pnlSettlement,
    mainLeverage,
    initialMainExposureNotional,
    peakUnrealizedPnl,
    initialExpectedMaxLoss,
    expectedMaxDrawdownPct: expectedDrawdownPct,
    payoffRatio,
    mainPriceChangePct,
    hasMainAdd,
    asymmetricRiskContribution,
    arithmeticExpectancy,
    geometricExpectancy,
    initialRisk,
  } = metrics;
  const mainPriceEfficiency = computeMainPriceEfficiency(mainPriceChangePct, expectedDrawdownPct);
  const addEfficiency = hasMainAdd
    ? computeAddEfficiency(payoffRatio == null ? null : payoffRatio / 100, mainPriceEfficiency)
    : null;
  const pnlDrift = pnlSettlement?.drift ?? null;

  const built: CampaignPnlOverviewItem[] = [
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
      key: 'peakUnrealizedPnl',
      label: '峰值浮盈',
      value: peakUnrealizedPnl.toFixed(2),
      help: (
        <>
          <p>战役期间某一时点的未实现盈亏，加上截至该时点已经落袋的盈亏之后，所得累计战役权益的最高值。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">峰值浮盈 = maxₜ（未实现盈亏ₜ + 累计已实现盈亏ₜ）</div>
          <p>已落袋部分包含镜像 TP 的已实现盈亏，与上方「已实现 P&amp;L」认领同一批成交记录，平仓价被 K 线校正过的腿按校正后的盈亏计入。还原不出持仓时段的腿不进路径（本地没有成交记录、事件流里也没有触发时刻或历史快照的对冲，只剩复盘快照的回场对冲等），它们的盈亏只在「已实现 P&amp;L」里；历史归类时还挂着的保护单（事件快照里既没有成交 id 也没有已实现）从未成交，也不持有；通过「记录决策」挂出的保护单，事件里的 id 其实是委托 id，本地委托记录显示它已撤单或仍挂着时同样按从未成交处理，本地查不到这张委托（换了浏览器）时无法判定，仍按归类快照从挂出时刻持有到战役结束。峰值浮盈至少取到最终已实现 P&amp;L，所以仍可与战役最终盈利直接比较。</p>
          <p>每根 K 线同时使用最高价和最低价重估当时仍持有的完整多空组合；分批平仓、镜像落袋和对冲拆除均按各自发生时点切换仓位状态。本地有成交记录时，一条腿分几刀平掉（M 减仓、并仓后的镜像止盈），每一刀都计入，各按自己的数量与平仓时刻进出；本地没有成交记录时（换了浏览器、清过历史成交），主力 / 镜像腿按 Leg 快照整条还原——按计划仓位从开仓持有到最后一刀，先平掉的几刀还原不出来，这台浏览器上的峰值浮盈可能高于实际峰值。</p>
          <p>已结束的战役从开仓扫到结束时间，但不早于最后一次平仓：结束时间记得比最后一次平仓还早的老战役（旧版结束对话框在东八区会把结束时间记早 8 小时），扫到最后一次平仓为止，平仓时刻不明的腿也持有到那一刻。</p>
          <p>历史战役会从关联成交、Leg 快照和事件快照还原，同一个仓位只持有一次；按事件快照还原的腿，平仓时刻与已实现取腿上的（与「已实现 P&amp;L」同一份，归类之后补上或改过的也算），腿上没有时才取事件里的。精度以可用 K 线粒度为限，不将不同腿分别放在不可能同时出现的最优价格上。</p>
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
          <p>入场时 M 加镜像的真实全暴露，在初始对冲 A/B 风险边界下承担的最大亏损额，是盈亏比的风险分母。</p>
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
      label: '涨幅',
      value: formatLegPriceChangePct(mainPriceChangePct),
      color: pnlExportColor(mainPriceChangePct),
      valueClassName: pnlColor(mainPriceChangePct),
      help: (
        <>
          <p>主力从开仓价到平仓价的涨跌幅，按主力方向计：主多价格涨了为正，主空价格跌了为正。与 Legs 表「涨跌幅」列、战役列表卡片是同一个数（同一对开平价，含 1 分钟 K 线平仓价校正）。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">涨幅 = ±（平仓价 − 开仓价）÷ 开仓价 × 100%</div>
          <p>主力有几笔时取<strong>涨幅最大</strong>的那笔（就是 Legs 表主力那几行「涨跌幅」里最大的数），还没平仓的不参与；主力都还没平仓时显示「—」。</p>
        </>
      ),
    },
    {
      key: 'mainPriceEfficiency',
      label: '涨幅效率',
      value: formatEfficiency(mainPriceEfficiency),
      color: pnlExportColor(mainPriceEfficiency),
      valueClassName: pnlColor(mainPriceEfficiency),
      help: (
        <>
          <p>价格走出了几个「预期回撤」：主力涨了 12%、入场到对冲边界 4%，效率就是 +3.00。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">涨幅效率 = 主力涨幅 ÷ 预期回撤</div>
          {mainPriceEfficiency != null ? (
            <p className="font-mono text-foreground">
              本场 = {formatLegPriceChangePct(mainPriceChangePct)} ÷ {expectedDrawdownPct.toFixed(2)}% = {formatEfficiency(mainPriceEfficiency)}
            </p>
          ) : <p>主力未平仓或算不出预期回撤时不计算。</p>}
        </>
      ),
    },
    {
      key: 'payoffRatio',
      label: '盈亏比',
      value: payoffRatio == null ? '—' : formatCampaignPayoffRatio(payoffRatio),
      color: pnlExportColor(payoffRatio),
      valueClassName: pnlColor(payoffRatio),
      help: (
        <>
          <p>本场已实现结果相对于初始风险分母的倍数。盈利为正，亏损保留负号。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">b = 已实现 P&amp;L ÷ 最大预期亏损</div>
          <p>百分数后括号内是数字倍数，例如 200%（2.00）表示 2R。</p>
        </>
      ),
    },
    {
      key: 'addEfficiency',
      label: '加仓效率',
      value: formatEfficiency(addEfficiency),
      color: pnlExportColor(addEfficiency),
      valueClassName: pnlColor(addEfficiency),
      help: (
        <>
          <p>加仓把同一段行情放大了多少：以「只拿主力、不加仓时盈亏比大致等于涨幅效率、比值约为 1」为基准，大于 1 说明加仓把行情放大成了更多的 R，小于 1 说明加仓、对冲或止盈吃掉了行情。<strong>只在做过加仓、且涨幅效率为正时计算</strong>——没有加仓，这个比值恒在 1 附近，没有信息量；涨幅效率不为正时，亏损战役负负得正、主力几乎没动时分母过小，读数都会失真。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">加仓效率 = 盈亏比 b ÷ 涨幅效率</div>
          {addEfficiency != null ? (
            <p className="font-mono text-foreground">
              本场 = {((payoffRatio ?? 0) / 100).toFixed(2)} ÷ {formatEfficiency(mainPriceEfficiency)} = {formatEfficiency(addEfficiency)}
            </p>
          ) : <p>{hasMainAdd ? '只在涨幅效率为正时计算：本场涨幅效率不为正或算不出，或算不出盈亏比。' : '本场没有加仓，不计算加仓效率。'}</p>}
        </>
      ),
    },
    {
      key: 'asymmetricRiskContribution',
      label: '本场 b 对 DSI/USI 的贡献',
      value: asymmetricRiskContribution == null
        ? '—'
        : `${asymmetricRiskContribution.group === 'win' ? 'USI' : 'DSI'} · b²/n = ${asymmetricRiskContribution.meanSquareTerm.toFixed(4)}${
          asymmetricRiskContribution.meanSquareShare == null
            ? ''
            : `（组内 ${(asymmetricRiskContribution.meanSquareShare * 100).toFixed(1)}%）`
        }`,
      help: (
        <>
          <p>盈利战役进入 USI 的上行组；亏损或持平战役进入 DSI 的下行组。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">本场均方贡献 = b² ÷ 对应组样本数 n</div>
          <p>括号内的组内占比 = 本场 b² ÷ 对应组 Σb²，用于定位哪些战役拉高了 DSI 或支撑了 USI。</p>
          {asymmetricRiskContribution != null ? (
            <p className="font-mono text-foreground">
              本场 b = {((payoffRatio ?? 0) / 100).toFixed(2)}，n = {asymmetricRiskContribution.sampleCount}
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
          <p>胜率 P 统一取 50%，与本场带正负号的实际盈亏比 b，计算每承担 1R 风险的加法期望。P 不随账户实时胜率变动，同一场战役的读数只由它自己的 b 决定。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">E = P × b −（1 − P），P = 50%</div>
          {payoffRatio != null ? (
            <p className="font-mono text-foreground">
              本场：{(ARITHMETIC_EXPECTANCY_WIN_RATE * 100).toFixed(2)}% × {(payoffRatio / 100).toFixed(2)} − {((1 - ARITHMETIC_EXPECTANCY_WIN_RATE) * 100).toFixed(2)}%
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
          <p>把胜率 P、本场实际盈亏比 b 和本场资产风险比例 x 放入复利路径，衡量这场战役对长期资本增长的影响。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">G = (1+b·x)^P · (1−x)^(1−P)；几何期望 = G − 1</div>
          <p>x = 最大预期亏损 ÷ 主力开仓时账户总资产。历史战役缺快照时，才使用今日当前总资产估算。</p>
          {initialRisk ? (
            <p className="font-mono text-foreground">本场 x = {(initialRisk.drawdownFraction * 100).toFixed(2)}%</p>
          ) : <p>缺少有效最大预期亏损或账户资产分母时不计算。</p>}
        </>
      ),
    },
  ];

  // 按两栏次序重排：先左栏、再右栏（递进链，标 rightColumn），窄屏单栏时也是这个先后。
  const byKey = new Map(built.map(item => [item.key, item]));
  const items: CampaignPnlOverviewItem[] = [
    ...PNL_OVERVIEW_LEFT_COLUMN.map(key => byKey.get(key)!),
    ...PNL_OVERVIEW_CHAIN_COLUMN.map(key => ({ ...byKey.get(key)!, rightColumn: true })),
  ];

  if (!metrics.helpOverrides && !metrics.extraNotes) return items;
  return items.map(item => ({ ...item, help: withHelpCustomisation(item.key, item.help, metrics) }));
}

export interface CampaignPnlOverviewNoteInput {
  initialRiskSource: CampaignInitialRiskSource | null;
}

/** 面板底部那句「期望口径」脚注；PNG 导出与反事实面板共用。 */
export function buildCampaignPnlOverviewNote(input: CampaignPnlOverviewNoteInput): string {
  const expectationNote = `期望口径：算术期望的胜率统一取 ${(ARITHMETIC_EXPECTANCY_WIN_RATE * 100).toFixed(0)}%。`;
  const riskNote = input.initialRiskSource === 'current_account_fallback'
    ? ' 本场几何期望的资产分母使用今日当前总账户资产估算。'
    : input.initialRiskSource === 'main_open_snapshot'
      ? ' 本场几何期望的资产分母使用主力开仓实时总资产快照。'
      : '';
  return `${expectationNote}${riskNote}`;
}
