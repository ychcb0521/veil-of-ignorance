import type { ReactNode } from 'react';
import type { AsymmetricRiskContribution } from '@/lib/asymmetricRiskMetrics';
import { formatCampaignPayoffRatio, type CampaignInitialRiskSource } from '@/lib/campaignAnalysis';
import type { CampaignBoardPnlItem } from '@/lib/campaignLegsPngExport';
import {
  formatArithmeticExpectancy,
  formatCampaignLeverage,
  formatGeometricExpectancy,
} from '@/lib/campaignMetrics';
import type { RealizedPnlBasis } from '@/lib/campaignRealizedPnl';
import { formatOpportunityQuality } from '@/lib/opportunityQuality';

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
  | 'payoffRatio'
  | 'asymmetricRiskContribution'
  | 'opportunityQuality'
  | 'arithmeticExpectancy'
  | 'geometricExpectancy'
  | 'todayAccountEquity';

export type CampaignPnlOverviewItem = CampaignBoardPnlItem & {
  key: CampaignPnlOverviewItemKey;
  help: ReactNode;
  valueClassName?: string;
  rightColumn?: boolean;
};

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
  asymmetricRiskContribution: AsymmetricRiskContribution | null;
  opportunityQuality: number | null;
  arithmeticExpectancy: number | null;
  geometricExpectancy: number | null;
  initialRisk: { drawdownFraction: number; source: CampaignInitialRiskSource } | null;
  todayAccountEquity: number | null;
  expectedWinRate: number | null;
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
    asymmetricRiskContribution,
    opportunityQuality,
    arithmeticExpectancy,
    geometricExpectancy,
    initialRisk,
    todayAccountEquity,
    expectedWinRate,
  } = metrics;
  const pnlDrift = pnlSettlement?.drift ?? null;

  const items: CampaignPnlOverviewItem[] = [
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
          <p>已落袋部分包含镜像 TP 的已实现盈亏，因此可以与战役最终盈利直接比较。</p>
          <p>每根 K 线同时使用最高价和最低价重估当时仍持有的完整多空组合；分批平仓、镜像落袋和对冲拆除均按各自发生时点切换仓位状态。</p>
          <p>历史战役会从关联成交、Leg 快照和事件快照还原；精度以可用 K 线粒度为限，不将不同腿分别放在不可能同时出现的最优价格上。</p>
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
      key: 'opportunityQuality',
      label: '机会质量',
      value: formatOpportunityQuality(opportunityQuality),
      color: pnlExportColor(opportunityQuality),
      valueClassName: pnlColor(opportunityQuality),
      help: (
        <>
          <p>先将本场实际盈亏比设置下限为 1，再衡量每 1 个预期回撤百分点对应的机会质量。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">b* = max（实际盈亏比 b, 1）；Q = b* ÷ 预期回撤百分点 d</div>
          <p>实际盈亏比小于 1（包括等于 0 或为负数）时统一按 1 计算，不取绝对值。回撤 2% 时 d 按 2 计，不按 0.02 计。</p>
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
          <p>按同一账户当前有效战役胜率 P，与本场带正负号的实际盈亏比 b，计算每承担 1R 风险的加法期望。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">E = P × b −（1 − P）</div>
          {expectedWinRate != null && payoffRatio != null ? (
            <p className="font-mono text-foreground">
              本场：{(expectedWinRate * 100).toFixed(2)}% × {(payoffRatio / 100).toFixed(2)} − {((1 - expectedWinRate) * 100).toFixed(2)}%
            </p>
          ) : <p>缺少有效盈亏比或有效战役胜率时不计算。</p>}
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
    {
      key: 'todayAccountEquity',
      label: '今日账户总资产',
      value: todayAccountEquity == null ? '—' : `${todayAccountEquity.toFixed(2)} USDT`,
      rightColumn: true,
      help: (
        <>
          <p>当前交易账户按最新余额、持仓和价格计算的总资产。</p>
          <p>新战役的几何期望优先使用主力开仓时固化的账户资产；历史战役缺少该快照时，使用这个今日总资产作为估算分母。</p>
        </>
      ),
    },
  ];

  if (!metrics.helpOverrides && !metrics.extraNotes) return items;
  return items.map(item => ({ ...item, help: withHelpCustomisation(item.key, item.help, metrics) }));
}

export interface CampaignPnlOverviewNoteInput {
  performanceLoading: boolean;
  performanceError: boolean;
  expectedWinRate: number | null;
  payoffRatioSampleCount: number;
  initialRiskSource: CampaignInitialRiskSource | null;
}

/** 面板底部那句「期望口径」脚注；PNG 导出与反事实面板共用。 */
export function buildCampaignPnlOverviewNote(input: CampaignPnlOverviewNoteInput): string {
  const expectationNote = input.performanceLoading
    ? '正在按同一账户的有效战役口径计算期望…'
    : input.performanceError
      ? '暂无可计算期望的有效战役样本。'
      : input.expectedWinRate == null
        ? '暂无可计算胜率的有效战役样本。'
        : `期望口径：${input.payoffRatioSampleCount} 场有效战役，实时胜率 ${(input.expectedWinRate * 100).toFixed(2)}%。`;
  const riskNote = input.initialRiskSource === 'current_account_fallback'
    ? ' 本场几何期望的资产分母使用今日当前总账户资产估算。'
    : input.initialRiskSource === 'main_open_snapshot'
      ? ' 本场几何期望的资产分母使用主力开仓实时总资产快照。'
      : '';
  return `${expectationNote}${riskNote}`;
}
