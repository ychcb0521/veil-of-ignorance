import type { ReactNode } from 'react';
import type { AsymmetricRiskContribution } from '@/lib/asymmetricRiskMetrics';
import { campaignPayoffRatioMultiple, formatCampaignPayoffRatio, type CampaignInitialRiskSource } from '@/lib/campaignAnalysis';
import type { CampaignBoardPnlItem } from '@/lib/campaignLegsPngExport';
import {
  ARITHMETIC_EXPECTANCY_WIN_RATE,
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
  | 'peakUnrealizedPnl'
  | 'initialExpectedMaxLoss'
  | 'mainSideNotional'
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
 * 【用户要求】「左右两列对调一下，反事实部分也是」：递进链在左栏，结果与仓位在右栏。
 *
 * 左栏按用户指定的阅读顺序：算术期望、预期回撤、涨跌幅、涨跌幅倍数、盈亏比、加仓效用、几何期望。
 */
export const PNL_OVERVIEW_LEFT_COLUMN: readonly CampaignPnlOverviewItemKey[] = [
  'arithmeticExpectancy',
  'expectedMaxDrawdownPct',
  'mainPriceChange',
  'mainPriceEfficiency',
  'payoffRatio',
  'addEfficiency',
  'geometricExpectancy',
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
  'initialMainExposureNotional',
  'mainSideNotional',
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
  initialExpectedMaxLoss: number;
  /**
   * 【用户要求】主方向那一侧（主多战役是多单）所有已成交腿的名义仓位合计：主力、镜像、加仓都算，挂单中的不算；
   * 与 Legs 表合计行这一侧的 Σ名义仓位同一个数（campaignMainSideNotional）。读不到（SOP 推演没有逐腿）时为 null。
   */
  mainSideNotional: { side: 'long' | 'short'; total: number | null } | null;
  expectedMaxDrawdownPct: number;
  /** b × 100（与 accuracy.profit_capture_ratio 同口径）；没有风险分母时 null。 */
  payoffRatio: number | null;
  /**
   * 战役的涨跌幅（%，按主力方向计；见 computeCampaignPriceChange：开仓价取主力最有利的一笔，主力平仓时若有对冲锁住行情，
   * 平仓价取最早那张对冲的开仓价），与战役卡片同一个数；主力都未平仓时 null。
   * 涨跌幅倍数与加仓效用由它和预期回撤、盈亏比在构造器里现算（computeMainPriceEfficiency / computeAddEfficiency）。
   */
  mainPriceChangePct: number | null;
  /** 涨跌幅的依据（只进 ⓘ 说明）：开仓价、平仓价、平仓价取自主力还是哪张对冲；SOP 推演没有逐腿数据时可缺省。 */
  mainPriceChangeBasis?: { entryPrice: number | null; exitPrice: number | null; exitSource: CampaignPriceChangeExitSource | null } | null;
  /** 战役（或反事实副本）里有没有成交过的加仓腿；没有加仓时「加仓效用」不算（campaignHasMainAdd）。 */
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

/**
 * 涨幅未兑现 = 峰值涨幅 − 最终涨跌幅。
 * 只有峰值涨幅严格大于预期回撤时才计算：行情先越过初始风险尺度，峰值兑现比例才有比较意义。
 */
export function computeUnrealizedPriceChangePct(
  mainPriceChangePct: number | null | undefined,
  peakPriceChangePct: number | null | undefined,
  expectedDrawdownPct: number | null | undefined,
): number | null {
  if (mainPriceChangePct == null || !Number.isFinite(mainPriceChangePct)
    || peakPriceChangePct == null || !Number.isFinite(peakPriceChangePct)
    || expectedDrawdownPct == null || !Number.isFinite(expectedDrawdownPct) || expectedDrawdownPct <= 0
    || peakPriceChangePct <= expectedDrawdownPct) return null;
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
 * 盈亏概览里的盈亏比读数：【用户要求】只写倍数 b（「0.59」），与封面同一个写法（formatCampaignPayoffRatio）；
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
    initialExpectedMaxLoss,
    mainSideNotional,
    expectedMaxDrawdownPct: expectedDrawdownPct,
    payoffRatio,
    mainPriceChangePct,
    mainPriceChangeBasis,
    hasMainAdd,
    asymmetricRiskContribution,
    arithmeticExpectancy,
    geometricExpectancy,
    initialRisk,
  } = metrics;
  const mainPriceEfficiency = computeMainPriceEfficiency(mainPriceChangePct, expectedDrawdownPct);
  const peakPriceEfficiency = computeMainPriceEfficiency(peakPriceChangePct, expectedDrawdownPct);
  const unrealizedPriceChangePct = computeUnrealizedPriceChangePct(mainPriceChangePct, peakPriceChangePct, expectedDrawdownPct);
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
      color: unrealizedPriceChangePct == null || Number(unrealizedPriceChangePct.toFixed(2)) === 0
        ? '#848E9C' : unrealizedPriceChangePct > 0 ? '#F6465D' : '#0ECB81',
      valueClassName: unrealizedPriceChangePct == null || Number(unrealizedPriceChangePct.toFixed(2)) === 0
        ? 'text-muted-foreground' : unrealizedPriceChangePct > 0 ? 'text-[#F6465D]' : 'text-[#0ECB81]',
      help: (
        <>
          <p>主力曾经走出的峰值涨幅与最终涨跌幅之差。数值越高，表示从峰值回吐的百分点越多。</p>
          <p>仅当峰值涨幅严格大于预期回撤时计算；行情尚未越过初始风险尺度时，本项不成立。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">涨幅未兑现 = 峰值涨幅 − 涨跌幅</div>
          {unrealizedPriceChangePct == null
            ? <p>缺少必要数据、预期回撤无效，或峰值涨幅不大于预期回撤时不计算。</p>
            : <p className="font-mono text-foreground">本场 = {formatLegPriceChangePct(peakPriceChangePct)} − {formatLegPriceChangePct(mainPriceChangePct)} = {unrealizedPriceChangePct.toFixed(2)}%</p>}
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
      key: 'payoffRatio',
      label: '盈亏比',
      value: payoffRatio == null ? '—' : formatOverviewPayoffRatio(payoffRatio),
      // 颜色跟着读数上的 b 走：取整为「0.00」的（只亏一点手续费）用中性色，不出现红色的 0.00
      color: pnlExportColor(campaignPayoffRatioMultiple(payoffRatio)),
      valueClassName: pnlColor(campaignPayoffRatioMultiple(payoffRatio)),
      help: (
        <>
          <p>本场已实现结果相对于初始风险分母的倍数。盈利为正，亏损保留负号；不到 0.005 R 的（只差一点手续费）读作 0.00，用中性色。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">b = 已实现 P&amp;L ÷ 最大预期亏损</div>
          <p>读数就是倍数 b，两位小数：2.00 表示赚到 2 个 R，-0.50 表示亏掉半个 R。</p>
        </>
      ),
    },
    {
      key: 'addEfficiency',
      label: '加仓效用',
      value: formatEfficiency(addEfficiency),
      // 【用户要求】颜色按这一场的 b：效用正负与本场 b 一致
      color: pnlExportColor(addEfficiency == null ? null : payoffRatio),
      valueClassName: pnlColor(addEfficiency == null ? null : payoffRatio),
      help: (
        <>
          <p>加仓把同一段行情放大了多少：以「只拿主力、不加仓时盈亏比大致等于涨跌幅倍数、比值约为 1」为基准，大于 1 说明加仓把行情放大成了更多的 R，小于 1 说明加仓、对冲或止盈吃掉了行情。<strong>只在做过加仓时计算</strong>——没有加仓，这个比值恒在 1 附近，没有信息量。涨跌幅倍数为负的也算，分母取绝对值，效用正负跟随 b；b 为负时效用为负；涨跌幅倍数显示为 0.00 时分母过小，不算。读数的颜色按本场盈亏比 b 的正负。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">加仓效用 = 盈亏比 b ÷ |涨跌幅倍数|</div>
          {addEfficiency != null ? (
            <p className="font-mono text-foreground">
              本场 = {formatCampaignPayoffRatio(payoffRatio ?? 0)} ÷ |{formatEfficiency(mainPriceEfficiency)}| = {formatEfficiency(addEfficiency)}
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
          <p>本场盈亏比 b 对账户不对称风险指标的贡献：盈利战役进入 USI 的上行组，亏损或持平战役进入 DSI 的下行组。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">组内占比 = 本场 b² ÷ 对应组 Σb²</div>
          <p>读数就是这个占比，用于定位哪些战役拉高了 DSI 或支撑了 USI；不到 0.1% 写「&lt;0.1%」。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">本场均方贡献 = b² ÷ 对应组样本数 n</div>
          {asymmetricRiskContribution != null ? (
            <p className="font-mono text-foreground">
              {`本场：${asymmetricRiskContribution.group === 'win' ? 'USI 上行组' : 'DSI 下行组'}，b = ${formatCampaignPayoffRatio(payoffRatio ?? 0)}，n = ${asymmetricRiskContribution.sampleCount}，b²/n = ${asymmetricRiskContribution.meanSquareTerm.toFixed(4)}`}
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
          <p>胜率 P 统一取 50%，与本场带正负号的实际盈亏比 b，计算每承担 1R 风险的加法期望。P 不随账户实时胜率变动，同一场战役的读数只由它自己的 b 决定。</p>
          <div className="rounded bg-muted/60 px-2 py-1 font-mono text-foreground">E = P × b −（1 − P），P = 50%</div>
          {payoffRatio != null ? (
            <p className="font-mono text-foreground">
              本场：{(ARITHMETIC_EXPECTANCY_WIN_RATE * 100).toFixed(2)}% × {formatCampaignPayoffRatio(payoffRatio)} − {((1 - ARITHMETIC_EXPECTANCY_WIN_RATE) * 100).toFixed(2)}%
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
            <>
              <p className="font-mono text-foreground">本场 x = {(initialRisk.drawdownFraction * 100).toFixed(2)}%</p>
              <p>
                本场的资产分母：{initialRisk.source === 'main_open_snapshot'
                  ? '主力开仓那一刻的账户总资产快照。'
                  : '这场没有开仓时的资产快照，用今日当前总账户资产估算。'}
              </p>
            </>
          ) : <p>缺少有效最大预期亏损或账户资产分母时不计算。</p>}
        </>
      ),
    },
  ];

  // 按两栏次序重排：先左栏（递进链）、再右栏（结果与仓位，标 rightColumn），窄屏单栏时也是这个先后。
  const byKey = new Map(built.map(item => [item.key, item]));
  const items: CampaignPnlOverviewItem[] = [
    ...PNL_OVERVIEW_LEFT_COLUMN.map(key => byKey.get(key)!),
    ...PNL_OVERVIEW_RIGHT_COLUMN.map(key => ({ ...byKey.get(key)!, rightColumn: true })),
  ];

  if (!metrics.helpOverrides && !metrics.extraNotes) return items;
  return items.map(item => ({ ...item, help: withHelpCustomisation(item.key, item.help, metrics) }));
}
