import { Component, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  CalendarRange,
  ChartScatter,
  ChevronDown,
  Download,
  FolderPlus,
  Info,
  Layers,
  ListChecks,
  ListOrdered,
  Plus,
  RotateCcw,
  Sigma,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from '@/lib/notificationCenter';
import { BackButton } from '@/components/journal/BackButton';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  CampaignMetricScatterPlot,
  type CampaignMetricChartView,
  type CampaignMetricColorMode,
  type CampaignMetricDistributionSpec,
  type CampaignMetricScatterGuide,
} from '@/components/journal/CampaignOddsScatterPlot';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import { useTradingContext } from '@/contexts/TradingContext';
import { useCampaignList } from '@/hooks/useCampaignList';
import { buildCampaignCardData, waitForCampaignListHeal, type CampaignCardData } from '@/lib/campaignListCache';
import { formatLegPriceChangePct, legPriceChangeDirection, type LegPriceChangeDirection } from '@/lib/legPriceChange';
import { PRICE_CHANGE_EXIT_RULE_TEXT, campaignHasMainAdd, formatEfficiency } from '@/lib/campaignMainPriceChange';
import { computeCurrentAccountEquity } from '@/lib/accountEquity';
import { formatCampaignDisplayCode, resolveCampaignAccountName } from '@/lib/campaignCode';
import {
  appendCampaignEvent,
  closeCampaign,
  deleteCampaign,
  getCampaignFullData,
  listDeletedCampaigns,
  permanentlyDeleteCampaign,
  restoreCampaign,
  updateCampaignImportance,
} from '@/lib/journalApi';
import {
  campaignPayoffRatioMultiple,
  formatCampaignPayoffRatio,
  resolveCampaignInitialRiskFraction,
} from '@/lib/campaignAnalysis';
import { fetchLegExitPriceCorrections } from '@/lib/campaignLegExecution';
import type { CampaignInitialRiskSource } from '@/lib/campaignAnalysis';
import { cardMetricColumnWidths } from '@/lib/campaignCardMetricWidths';
import {
  BULK_CLOSE_STATUS_LABELS,
  CLOSE_TIME_SOURCE_LABELS,
  planBulkCampaignClose,
  type BulkClosePlanItem,
} from '@/lib/campaignBulkClose';
import {
  ARITHMETIC_EXPECTANCY_WIN_RATE,
  computeCampaignExpectancies,
  formatArithmeticExpectancy,
  formatGeometricExpectancy,
} from '@/lib/campaignMetrics';
import {
  computeAsymmetricRiskContributionRates,
  summarizeAsymmetricRiskMetrics,
} from '@/lib/asymmetricRiskMetrics';
import { selectValidCampaignPerformanceSamples, summarizeCampaignPerformance } from '@/lib/kellySizing';
import {
  ALL_CAMPAIGN_OPERATION_RANGE,
  CAMPAIGN_RANGE_PRESETS,
  beijingDayKey,
  describeOperationRange,
  isAllRange,
  isValidDayKey,
  isWithinOperationRange,
  matchPreset,
  presetOperationRange,
  type CampaignOperationRange,
} from '@/lib/campaignOperationRange';
import {
  FIXED_DRAWDOWN_FRACTION,
  compoundGrowthFactor,
  computeGeometricExpectancy,
  realizedCompoundGrowth,
} from '@/lib/geometricExpectancy';
import {
  campaignAchievedMirrorTp,
  mirrorTpOutcome,
  summarizeMirrorTp,
  type MirrorTpOutcome,
} from '@/lib/mirrorTpSummary';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import { campaignOperationTime } from '@/lib/objectiveOperationTime';
import {
  buildCampaignMetricSeries,
  type CampaignMetricSeries,
} from '@/lib/campaignMetricSeries';
import { formatBeijingTime } from '@/lib/timeFormat';
import type { CampaignStatus, LegRole, TradeCampaign, TradeJournal } from '@/types/journal';
import { orderedCampaignExportTargets, retainCampaignSelection, toggleCampaignSelection, type CampaignExportTarget } from '@/lib/campaignBatchSelection';
import {
  appendSortLevel,
  campaignLeverage,
  clearSortChain,
  importanceValue,
  parseCampaignSortChain,
  removeSortLevel,
  rowAddEfficiency,
  rowMainPriceEfficiency,
  rowMirrorTpRank,
  rowPayoffRatio,
  selectSortMode,
  sortCampaignRows,
  sortChainKey,
  toggleSortLevel,
  writeCampaignSortParams,
  type CampaignSortChain,
  type CampaignSortDirection,
  type CampaignSortMode,
} from '@/lib/campaignListSort';
const MemoCampaignMetricScatterPlot = memo(CampaignMetricScatterPlot);
const LazyCampaignBatchExportDialog = lazy(() => import('@/components/journal/CampaignBatchExportDialog')
  .then(module => ({ default: module.CampaignBatchExportDialog })));

/**
 * 批量下载弹窗是按需加载的一块代码：加载失败（断网、发版后旧页面拿不到新分块）只关掉弹窗并提示，
 * 不能让错误一路冒上去把整张战役列表卸掉成白屏。
 */
class BatchExportLoadBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** 列表行加上依赖全表统计的四个数（期望与不对称风险贡献）。 */
type CampaignMetricData = CampaignCardData & {
  arithmeticExpectancy: number | null;
  geometricExpectancy: number | null;
  dsiContributionPct: number | null;
  usiContributionPct: number | null;
};

type CampaignDisplayData = CampaignMetricData & {
  initialRiskFraction: number | null;
  initialRiskSource: CampaignInitialRiskSource | null;
  riskAccountEquity: number | null;
};

type CampaignMetricChartKey =
  | 'odds'
  | 'oddsDistribution'
  | 'expectedDrawdownPct'
  | 'arithmeticExpectancy'
  | 'geometricExpectancy'
  | 'geometricExpectancyDistribution'
  | 'importance'
  | 'mirrorTp'
  | 'mirrorTpBars'
  | 'dsiContribution'
  | 'usiContribution'
  | 'mainPriceChange'
  | 'mainPriceChangeDistribution'
  | 'mainPriceEfficiency'
  | 'mainPriceEfficiencyDistribution'
  | 'addEfficiency'
  | 'addEfficiencyDistribution'
  | 'arithmeticExpectancyDistribution';

type CampaignMetricChartConfig = {
  key: CampaignMetricChartKey;
  /** 喂图的数据序列来自哪个键；缺省就是自己。分布图与时序图共用同一份盈亏比序列。 */
  sourceKey?: CampaignMetricChartKey;
  /** 缺省 'time'。 */
  view?: CampaignMetricChartView;
  /** 同一指标有多种看法时，面板右上角切换键上的短标签（时序 / 分布 / 柱状）。 */
  viewLabel?: string;
  viewTestId?: string;
  label: string;
  chartLabel: string;
  seriesLabel: string;
  guide: CampaignMetricScatterGuide;
  missingValueLabel: string;
  colorMode: CampaignMetricColorMode;
  formatValue: (value: number) => string;
  /** 通用分布图（涨跌幅、涨跌幅倍数、加仓效用、算术期望）的读法：单位、0 线、正值占比、额外参照线。 */
  distribution?: CampaignMetricDistributionSpec;
};

type CampaignListNavigationState = {
  fromCampaignList: true;
};

type CampaignFormulaPopover =
  | 'captureRate'
  | 'expectedDrawdownPct'
  | 'arithmeticExpectancy'
  | 'geometricExpectancy'
  | 'importanceSort'
  | 'mirrorTpSort'
  | 'validCampaigns'
  | 'operationRange'
  | 'mirrorTp'
  | 'winRate'
  | 'averagePayoffRatio'
  | 'expectedValue'
  | 'geometricEdge'
  | 'asymmetricRisk'
  | 'dsiContributionSort'
  | 'usiContributionSort'
  | 'mainPriceChangeSort'
  | 'mainPriceEfficiencySort'
  | 'addEfficiencySort'
  | 'sortChain';

/**
 * 【用户要求】排序行依次是：操作时间、镜像止盈 ┆ 预期回撤、涨跌幅、涨跌幅倍数、盈亏比、加仓效用、几何期望、算术期望 ┆
 * DSI 贡献、USI 贡献、杠杆倍数、重要性、字母（默认仍按操作时间排序）。
 * 【用户要求】封面指标格的先后与这里一致：镜像止盈之后就是中间那一组七项（见 CampaignCard 的指标格）。
 * 排序行左对齐依次排开。
 */
const SORT_OPTIONS: { value: CampaignSortMode; label: string }[] = [
  { value: 'time', label: '操作时间' },
  { value: 'mirrorTp', label: '镜像止盈' },
  { value: 'expectedDrawdownPct', label: '预期回撤' },
  { value: 'mainPriceChange', label: '涨跌幅' },
  { value: 'mainPriceEfficiency', label: '涨跌幅倍数' },
  { value: 'captureRate', label: '盈亏比' },
  { value: 'addEfficiency', label: '加仓效用' },
  { value: 'geometricExpectancy', label: '几何期望' },
  { value: 'arithmeticExpectancy', label: '算术期望' },
  { value: 'dsiContribution', label: 'DSI 贡献' },
  { value: 'usiContribution', label: 'USI 贡献' },
  { value: 'leverage', label: '杠杆倍数' },
  { value: 'importance', label: '重要性' },
  { value: 'alpha', label: '字母' },
];

/**
 * 【用户要求】排序行「还是用左对齐吧」：按钮按 SORT_OPTIONS 的次序从左依次排开、间距均匀，不再为了对齐封面的列线而拉开空隙。
 * 两条短分隔线把它分成三组，中间一组正是封面上镜像止盈之后的七项指标：
 *   操作时间 · 镜像止盈 ┆ 预期回撤 · 涨跌幅 · 涨跌幅倍数 · 盈亏比 · 加仓效用 · 几何期望 · 算术期望 ┆ DSI 贡献 · USI 贡献 · 杠杆倍数 · 重要性 · 字母
 */
const SORT_DIVIDERS_BEFORE: ReadonlySet<CampaignSortMode> = new Set<CampaignSortMode>(['expectedDrawdownPct', 'dsiContribution']);
const SORT_LABEL_BY_MODE = Object.fromEntries(SORT_OPTIONS.map(option => [option.value, option.label])) as Record<CampaignSortMode, string>;

/**
 * 【用户要求】多级排序（「先让镜像止盈的排序固定下来，然后在此基础上再排序加仓效用」）：
 * 单击排序项 = 只按这一项排（与原来一样）；排序项右上角的「+」= 把它追加为下一级；排序行下方的排序链逐级切方向、移除、清除。
 * 只有一级时，排序行、封面与原来逐像素相同：「+」只在悬停 / 键盘聚焦时显形，级数角标与排序链都不出现。
 */
/** 第二级及以后在排序行里的样子：淡琥珀描边与底色，比第一级（实底 + 阴影）轻一档。 */
const SORT_THEN_BUTTON = 'border-[#F0B90B]/35 text-foreground/85 hover:border-[#F0B90B]/55 hover:bg-foreground/[0.03]';
const SORT_THEN_ARROW = 'text-[#C98500]/75 dark:text-[#F0B90B]/70';
/**
 * 「+」：挂在排序按钮右上角（14px 小圆钮，与多级时的级数角标同一个位置——加层后这个角上就换成 ②），不占尺寸，
 * 不压在按钮本体上：按钮连同 Σ 的单击、双击、右键都与原来一样。
 * 只在能悬停的设备上出现（悬停这一项、或键盘聚焦到它时显形）；没显形时 pointer-events-none，不会被看不见地点中。
 * 触屏没有悬停，改用长按排序项加层（见 sortLongPressHandlers）。
 */
const SORT_ADD_BUTTON = 'pointer-events-none absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-background text-[#B7860B] opacity-0 shadow-[0_1px_2px_rgba(15,23,42,0.12)] ring-1 ring-inset ring-[#F0B90B]/60 transition-[opacity,background-color,color] duration-150 hover:bg-[#F0B90B] hover:text-black focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 group-hover/sort:pointer-events-auto group-hover/sort:opacity-100 dark:text-[#F0B90B] dark:hover:text-black [@media(hover:hover)]:inline-flex';
/** 级数：排序行右上角的角标与排序链里每一级前面的序号共用。 */
const SORT_LEVEL_BADGE = 'inline-flex h-3 min-w-3 items-center justify-center rounded-full px-[3px] font-mono text-[8px] font-semibold leading-none tabular-nums';
const SORT_LEVEL_BADGE_FIRST = 'bg-[#F0B90B] text-black';
const SORT_LEVEL_BADGE_THEN = 'bg-background text-[#8F6B00] ring-1 ring-inset ring-[#F0B90B]/60 dark:text-[#F0B90B]';
/** 排序链上的一级：第一级实一档，之后各级轻一档（与封面高亮同一个主次）。 */
const SORT_CHAIN_CHIP_FIRST = 'border-[#F0B90B]/45 bg-[#F0B90B]/[0.08] font-medium text-foreground';
const SORT_CHAIN_CHIP_THEN = 'border-[#F0B90B]/25 bg-[#F0B90B]/[0.03] text-foreground/85';
/** 排序链上的小按钮（切方向 / 移除 / 清除 / ⓘ）：手机上 28px 高好点按，≥ 640px 收成 24px。 */
const SORT_CHAIN_CONTROL = 'inline-flex h-7 items-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring/70 sm:h-6';
/** 触屏长按排序项多久算「加为下一级」。 */
const SORT_LONG_PRESS_MS = 450;

/**
 * 战役封面指标行：【用户要求】「交易战役的封面上的指标做成左对齐，要美观，不需要均匀分布。美观是第一位的」——
 * 八项按排序行的次序从左往右紧凑排开（上一行淡色指标名、下一行等宽数字），不把整行均分；右侧留白。
 * 【用户要求】「分布要做得非常均匀、美观，不要有没必要的空隙」：每项的宽度按**当前时间段里的全部战役实际出现的读数**定
 * （指标名与读数取宽者 + 左右内边距，见 cardMetricColumnWidths），以 CSS 变量挂在列表容器上（campaign-card-list），
 * 不再为列表里没出现的极端读数留空。每张卡片读同一套变量，上下各张卡的同名项仍落在同一条竖线上。
 * 列宽不看排序：有的排序会筛掉算不出这一项的战役，若按筛完的列表算，撑宽某一列的那场一被筛掉，后面各格就整体左移——
 * 切换排序时文字不能挪。换时间段才重算。
 * 手机（< 640px）放不下一行，退回两列网格；≥ 640px 起按宽度依次排开，放不下时整行换行（各卡在同一处换行）。
 */
const CARD_METRIC_STRIP = 'grid grid-cols-2 gap-1 sm:flex sm:flex-wrap sm:gap-x-2 sm:gap-y-1';
/** 指标行外框的内边距：再加上每项自己的 10px，首项文字与卡片标题行（CAMPAIGN_COLUMNS_INSET）同一起点。 */
const CARD_METRIC_STRIP_INSET = 'px-1.5 py-1 sm:px-2.5';
/** 排序行补一条透明的 1px 边框、与卡片同样的内边距：行首与封面左缘对齐。 */
const CAMPAIGN_COLUMNS_FRAME = 'border-x border-transparent';
/** 排序行、统计概览与卡片展开详情的左右内边距（封面指标行的首格文字也落在这条线上，见 CARD_METRIC_STRIP_INSET）。 */
const CAMPAIGN_COLUMNS_INSET = 'px-4 sm:px-5';

/**
 * 公式 / 统计浮层与视口边缘至少留 12px：靠左的按钮（如排序行的「涨跌幅」、概览的「有效战役」）用 align="end" 打开时，
 * 浮层被推回视口内也不会贴着屏幕左缘；很窄的屏幕上宽度同样让出两侧这 12px（POPOVER_VIEWPORT_MAX_W）。
 */
const POPOVER_COLLISION_PADDING = 12;
const POPOVER_VIEWPORT_MAX_W = 'max-w-[calc(100vw_-_24px)]';

/**
 * 会**过滤掉**缺少该指标的战役的排序档：空列表时要说清是「没有战役」还是「有战役但都算不出这个指标」。
 * 此前 DSI / USI / 杠杆三档同样在过滤，却只显示「尚无战役」，看上去像战役丢了。
 */
const SORT_EMPTY_HINTS: Partial<Record<CampaignSortMode, { noun: string; hint: string }>> = {
  captureRate: { noun: '可计算盈亏比', hint: '未设置初始最大预期亏损的战役不会进入当前排序' },
  expectedDrawdownPct: { noun: '可计算预期回撤', hint: '缺少主力开仓价或初始对冲 A/B 价格的战役不会进入当前排序' },
  arithmeticExpectancy: { noun: '可计算算术期望', hint: '未设置初始最大预期亏损的战役不会进入当前排序' },
  geometricExpectancy: {
    noun: '可计算几何期望',
    hint: '旧战役缺少开仓资产快照时会按当前总资产估算；缺少初始最大预期亏损的战役仍不会进入当前排序',
  },
  dsiContribution: { noun: '可计算 DSI 贡献', hint: 'DSI 贡献只统计亏损战役，其余不会进入当前排序' },
  usiContribution: { noun: '可计算 USI 贡献', hint: 'USI 贡献只统计盈利战役，其余不会进入当前排序' },
  leverage: { noun: '记录了杠杆倍数', hint: '没有记录杠杆倍数、各腿也没有杠杆的战役不会进入当前排序' },
  mainPriceChange: { noun: '主力已平仓', hint: '涨跌幅按战役算（开仓价取主力最有利的一笔，主力平仓时有对冲锁住行情就按对冲开仓价），主力都还没平仓的战役不会进入当前排序' },
  mainPriceEfficiency: {
    noun: '可计算涨跌幅倍数',
    hint: '涨跌幅倍数 = 主力涨跌幅 ÷ 预期回撤；主力还没平仓、或缺少主力开仓价 / 初始对冲 A/B 价格的战役不会进入当前排序',
  },
  addEfficiency: {
    noun: '可计算加仓效用',
    hint: '加仓效用 = 盈亏比 ÷ 涨跌幅倍数，只算做过加仓、且涨跌幅倍数为正的战役；其余战役不会进入当前排序',
  },
};

const CAMPAIGN_LIST_SCROLL_KEY_PREFIX = 'journal-campaign-list-scroll:';

function formatSignedMetric(value: number, suffix: string, digits = 2): string {
  const normalized = Math.abs(value) < 10 ** -(digits + 1) ? 0 : value;
  return `${normalized > 0 ? '+' : ''}${normalized.toFixed(digits)}${suffix}`;
}

/** 分组盈亏比均值：带符号显示，无样本时给「—」而不是 0，避免把「没有」读成「打平」。 */
function formatGroupPayoffRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

/**
 * 镜像止盈四档的文案。右边三档一律带「已实现」前缀：它们与「未实现」不是并列的四种结果，
 * 而是「镜像止盈有没有成交」这一层之下、成交之后的三种收场。
 * 只写「亏损 / 持平 / 盈利」会被读成另一个维度。
 */
/**
 * 六档的轴标签。中间那一档同时收「持平（|b| ≤ 0.1）」与「尚未结束」两种战役，
 * 标签必须把「进行中」写出来——卡片上那一场显示的是「已实现·进行中」，
 * 图上若只写「持平」，同一场战役在同一页上就有了两个说法。
 */
const MIRROR_TP_RANK_LABELS = [
  '未实现·亏损',
  '未实现·持平/进行中',
  '未实现·盈利',
  '已实现·亏损',
  '已实现·持平/进行中',
  '已实现·盈利',
] as const;

function formatMirrorTpMetric(value: number): string {
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > 0.001) return value.toFixed(1);
  return MIRROR_TP_RANK_LABELS[Math.min(MIRROR_TP_RANK_LABELS.length - 1, Math.max(0, rounded))];
}

/**
 * 【用户要求】涨跌幅、涨跌幅倍数、加仓效用、算术期望也配「分布」看法并默认打开（同盈亏比）。
 * 四张分布图共用的两句参考线说明：密度曲线与越界三角的读法四张图一字不差，写一份免得各自漂移。
 */
const METRIC_DISTRIBUTION_DENSITY_NOTE = '灰色曲线：高斯核密度估计（Silverman 带宽）换算成每档期望场数，与点列共用同一条场数轴；带宽约两档宽，尖峰处会低于实际堆高，是趋势轮廓而不是包络。';
const METRIC_DISTRIBUTION_CLAMP_NOTE = '显示区间取 p2–p98 的稳健窗口，超出的极端值贴边画成三角并在图下计数；提示框、摘要统计与点击跳转仍用原值。';
/** 单场算术期望的胜率是常数（见 ARITHMETIC_EXPECTANCY_WIN_RATE）：说明里的式子与「0R ↔ b」的换算都从它推，不手写数字。 */
const ARITHMETIC_WIN_RATE_PCT = Math.round(ARITHMETIC_EXPECTANCY_WIN_RATE * 100);
/** Eᵢ = 0 ⇔ bᵢ = (1 − P) ÷ P；P = 50% 时是 +1R。 */
const ARITHMETIC_BREAK_EVEN_PAYOFF = `+${Number(((1 - ARITHMETIC_EXPECTANCY_WIN_RATE) / ARITHMETIC_EXPECTANCY_WIN_RATE).toFixed(2))}R`;

const CAMPAIGN_METRIC_CHART_CONFIGS: readonly CampaignMetricChartConfig[] = [
  {
    key: 'odds',
    label: '盈亏比',
    chartLabel: '赔率图',
    viewLabel: '时序',
    viewTestId: 'campaign-odds-view-time',
    seriesLabel: '盈亏比时序',
    guide: {
      yAxis: '每场战役的实际盈亏比 b，单位为 R。b = 已实现盈亏 ÷ 初始最大预期亏损；正数表示盈利，负数表示亏损。',
      point: '点越高，实际盈亏比越大；点越低，亏损相对初始风险越深。每个点代表一场具备有效风险分母的战役。',
      colors: [
        { token: 'profit', label: '绿色：b > 0，战役盈利。' },
        { token: 'loss', label: '红色：b < 0，战役亏损。' },
        { token: 'neutral', label: '灰色：b = 0，盈亏持平。' },
      ],
      referenceLines: [
        '灰色零线：盈亏平衡线。',
        '黄色 -1R 虚线：实际亏损等于初始最大预期亏损；低于该线表示亏损超过原定风险边界。',
      ],
    },
    missingValueLabel: '有效盈亏比',
    colorMode: 'signed',
    formatValue: value => formatSignedMetric(value, 'R'),
  },
  {
    key: 'oddsDistribution',
    sourceKey: 'odds',
    view: 'distribution',
    label: '盈亏比分布',
    chartLabel: '分布图',
    viewLabel: '分布',
    viewTestId: 'campaign-odds-view-distribution',
    seriesLabel: '盈亏比分布',
    guide: {
      yAxis: '落在该盈亏比附近的战役数量：点从底线向上堆叠，堆得越高，这一档 b 出现得越多。刻度随图高变化，读柱高时对照左侧场数刻度。',
      point: '每个点仍是一场战役，横向位置就是它的实际盈亏比 b，不考虑时间先后；同一档内的点按 b 从小到大自下而上排。',
      colors: [
        { token: 'profit', label: '绿色：b > 0，战役盈利。' },
        { token: 'loss', label: '红色：b < 0，战役亏损。' },
        { token: 'neutral', label: '灰色：b = 0，盈亏持平。' },
      ],
      referenceLines: [
        '琥珀色 -1R 虚线：止损墙，实际亏损等于初始最大预期亏损；墙左侧的点是止损滑点或超出原定风险的亏损。',
        '存在 b ≤ -10 时，额外显示黄色 -10R 归零线：按固定 10% 下注，1 + 0.1b ≤ 0。含等号的风险点用红色方点与黄色描边区分；这不是实际账户的强平判定。',
        '灰色 0 线：盈亏平衡。',
        '灰色曲线：高斯核密度估计（Silverman 带宽）换算成每档期望场数，与柱共用同一条场数轴；带宽约两档宽，尖峰处会低于实际堆高，是趋势轮廓而不是包络。',
        '超出显示区间的极端值贴边画成三角并在脚注计数。存在归零样本时左界为 -12R，极端亏损仍保留黄色描边、原始数值和统计。',
      ],
    },
    missingValueLabel: '有效盈亏比',
    colorMode: 'signed',
    formatValue: value => formatSignedMetric(value, 'R'),
  },
  {
    key: 'expectedDrawdownPct',
    label: '预期回撤',
    chartLabel: '回撤图',
    seriesLabel: '预期回撤时序',
    guide: {
      yAxis: '以主力开仓价为 0%，向下显示到初始对冲 A/B 中有效风险边界的负回撤，占主力开仓价的百分比。数值越负，预设价格回撤空间越大。',
      point: '点越靠近顶部 0%，初始风险边界离开仓价越近；点越低，负回撤绝对值越大。',
      colors: [
        { token: 'profit', label: '绿色：该战役最终盈利。' },
        { token: 'loss', label: '红色：该战役最终亏损。' },
        { token: 'neutral', label: '灰色：盈亏持平或尚未结束。' },
      ],
      referenceLines: ['0% 顶线：无预期回撤；纵轴向下表示回撤加深。'],
    },
    missingValueLabel: '预期回撤',
    colorMode: 'risk',
    formatValue: value => `${(Math.abs(value) < 0.005 ? 0 : value).toFixed(2)}%`,
  },
  {
    key: 'arithmeticExpectancy',
    label: '算术期望',
    chartLabel: '算术图',
    viewLabel: '时序',
    viewTestId: 'campaign-arithmeticExpectancy-view-time',
    seriesLabel: '算术期望时序',
    guide: {
      yAxis: '该场战役在当前有效样本胜率下的算术期望，单位为 R。E = P(赢) × b − (1 − P(赢))。',
      point: '点越高，代表按当前胜率与本场实际盈亏比计算的期望越高；低于零表示算术期望为负。',
      colors: [
        { token: 'profit', label: '绿色：算术期望 > 0。' },
        { token: 'loss', label: '红色：算术期望 < 0。' },
        { token: 'neutral', label: '灰色：算术期望 = 0。' },
      ],
      referenceLines: ['灰色零线：正、负算术期望的分界。'],
    },
    missingValueLabel: '算术期望',
    colorMode: 'signed',
    formatValue: formatArithmeticExpectancy,
  },
  {
    key: 'arithmeticExpectancyDistribution',
    sourceKey: 'arithmeticExpectancy',
    view: 'distribution',
    label: '算术期望分布',
    chartLabel: '分布图',
    viewLabel: '分布',
    viewTestId: 'campaign-arithmeticExpectancy-view-distribution',
    seriesLabel: '算术期望分布',
    guide: {
      yAxis: '落在该算术期望附近的战役数量：点从底线向上堆叠，堆得越高，这一档 Eᵢ 出现得越多。刻度随图高变化，读柱高时对照左侧场数刻度。',
      point: `每个点仍是一场战役，横向位置就是它的单场算术期望 Eᵢ = ${ARITHMETIC_WIN_RATE_PCT}% × bᵢ − ${100 - ARITHMETIC_WIN_RATE_PCT}%（单位 R，胜率统一取 ${ARITHMETIC_WIN_RATE_PCT}%），不考虑时间先后；同一档内的点按 Eᵢ 从小到大自下而上排。`
        + `胜率固定之后 Eᵢ 只是 bᵢ 的线性变换，分布形状与盈亏比分布一致、只是刻度不同：Eᵢ = 0R 对应 bᵢ = ${ARITHMETIC_BREAK_EVEN_PAYOFF}，Eᵢ = −1R 仍对应 bᵢ = −1R。`,
      colors: [
        { token: 'profit', label: '绿色：算术期望 > 0。' },
        { token: 'loss', label: '红色：算术期望 < 0。' },
        { token: 'neutral', label: '灰色：算术期望 = 0。' },
      ],
      referenceLines: [
        `灰色 0R 竖线：盈亏平衡，正、负算术期望的分界（对应 bᵢ = ${ARITHMETIC_BREAK_EVEN_PAYOFF}）；摘要条的「正期望」是 Eᵢ > 0 的场数占比。`,
        METRIC_DISTRIBUTION_DENSITY_NOTE,
        METRIC_DISTRIBUTION_CLAMP_NOTE,
      ],
    },
    missingValueLabel: '算术期望',
    colorMode: 'signed',
    formatValue: formatArithmeticExpectancy,
    distribution: {
      unit: 'R',
      zeroLabel: '0R 盈亏平衡',
      zeroMeaning: '盈亏分界',
      positiveShareLabel: '正期望',
    },
  },
  {
    key: 'geometricExpectancy',
    label: '几何期望',
    chartLabel: '几何图',
    viewLabel: '时序',
    viewTestId: 'campaign-geometricExpectancy-view-time',
    seriesLabel: '几何期望时序',
    guide: {
      yAxis: '按固定 10% 的资金比例下这一注，本场把本金乘成了多少：Gᵢ = 1 + bᵢ×0.1，纵轴直接读 Gᵢ——1.00 是本金不增不减。',
      point: '点越高，本场按同一下注比例换算出的资本增长越大；低于 1.00 的是亏损场（bᵢ 为负）。'
        + '固定 x 之后 Gᵢ 是 bᵢ 的线性变换，所以它的形状与盈亏比图一致——差别只在单位。',
      colors: [
        { token: 'profit', label: '绿色：Gᵢ > 1.00，本场让本金变大。' },
        { token: 'loss', label: '红色：Gᵢ < 1.00，本场让本金变小。' },
        { token: 'neutral', label: '灰色：Gᵢ = 1.00，不增不减。' },
      ],
      referenceLines: ['灰色的 1.00 线：本金不增不减，线上为增长、线下为损耗。'],
    },
    missingValueLabel: '几何期望',
    colorMode: 'signed',
    formatValue: formatGeometricExpectancy,
  },
  {
    key: 'geometricExpectancyDistribution',
    sourceKey: 'geometricExpectancy',
    view: 'distribution',
    label: '几何期望分布',
    chartLabel: '分布图',
    viewLabel: '分布',
    viewTestId: 'campaign-geometricExpectancy-view-distribution',
    seriesLabel: '几何期望分布',
    guide: {
      yAxis: '落在该 Gᵢ 附近的战役数量：点从底线向上堆叠，堆得越高，这一档结果出现得越多。刻度随图高变化，读柱高时对照左侧场数刻度。',
      point: '每个点仍是一场战役，横向按 Gᵢ 的对数排布，不考虑时间先后。'
        + '相同倍率变化占相同距离，例如 0.5 → 1 → 2 等距，方便比较本金减半与翻倍；'
        + 'Gᵢ = 0 在独立栏显示，不能只凭分布偏斜判断风控是否合格。',
      colors: [
        { token: 'profit', label: '绿色：Gᵢ > 1.00，本场让本金变大。' },
        { token: 'loss', label: '红色：Gᵢ < 1.00，本场让本金变小。' },
        { token: 'neutral', label: '灰色：Gᵢ = 1.00，不增不减。' },
      ],
      referenceLines: [
        '灰色 1.00 竖线：盈亏分界，线右为增长、线左为损耗。',
        '灰色曲线：在 ln(Gᵢ) 空间计算核密度，再换算成「每个对数档的期望场数」，与点列共用场数轴；归零点不纳入曲线。',
      ],
    },
    missingValueLabel: '几何期望',
    colorMode: 'signed',
    formatValue: formatGeometricExpectancy,
  },
  {
    key: 'importance',
    label: '重要性',
    chartLabel: '重要性图',
    seriesLabel: '重要性时序',
    guide: {
      yAxis: '人工设置的战役重要性评分，范围为 0–5 星。纵坐标数值就是对应星级。',
      point: '点越高，代表该战役被标记得越重要；点位只反映人工重要性，不代表盈亏或风险大小。',
      colors: [
        { token: 'importance', label: '金色：统一表示重要性评分；颜色不区分盈亏。' },
      ],
    },
    missingValueLabel: '重要性评分',
    colorMode: 'importance',
    formatValue: value => `${Math.round(value)}/5`,
  },
  {
    key: 'mirrorTp',
    label: '镜像止盈',
    chartLabel: '镜像图',
    viewLabel: '时序',
    viewTestId: 'campaign-mirrorTp-view-time',
    seriesLabel: '镜像止盈结果时序',
    guide: {
      yAxis: '镜像止盈结果采用离散等级：0–2 = 未实现·亏损 / 持平 / 盈利，3–5 = 已实现·亏损 / 持平 / 盈利；盈亏按实际盈亏比 b 判，|b| ≤ 0.1 记持平。纵向高度表示结果等级，不是连续金额差。',
      point: '点越高，镜像止盈结果等级越好；同一水平线上的点属于同一种结果，点与点的垂直距离不代表实际盈亏差额。',
      colors: [
        { token: 'profit', label: '绿色圆点：该战役最终盈利（b > 0.1）。' },
        { token: 'loss', label: '红色菱形：该战役最终亏损（b < −0.1）。' },
        { token: 'neutral', label: '灰色空心圈：持平（|b| ≤ 0.1）或尚未结束。' },
      ],
    },
    missingValueLabel: '镜像止盈结果',
    colorMode: 'pnlBand',
    formatValue: formatMirrorTpMetric,
  },
  {
    key: 'mirrorTpBars',
    sourceKey: 'mirrorTp',
    view: 'bars',
    viewLabel: '柱状',
    viewTestId: 'campaign-mirrorTp-view-bars',
    label: '镜像止盈分布',
    chartLabel: '柱状图',
    seriesLabel: '镜像止盈结果分布',
    guide: {
      yAxis: '纵轴是场数：同一档的战役码成一根柱，柱越高这种结果出现得越多。场数多时一行会并排放几个点，'
        + '左侧刻度已按每行点数折算，照着刻度读柱高即可；每根柱的精确场数写在柱脚下，图例右侧另有一份含合计的汇总。',
      point: '横轴是四个结果档位（未实现与已实现各分亏损 / 持平 / 盈利，共六档；|b| ≤ 0.1 记持平），不按时间排列。柱由点组成，每个点仍是一场战役，'
        + '颜色与所在柱说的是同一件事（绿=盈利、红=亏损、灰=持平或进行中），只是为了扫一眼就能分出左右两半；'
        + '真正的新信息在横轴上：同一种盈亏结果，镜像止盈到底有没有生效。'
        + '悬停读数值与 b、点击进入对应战役。一场都没有的档位保留空柱——某一档 0 场本身就是结论。',
      colors: [
        { token: 'profit', label: '绿色圆点：该战役最终盈利（b > 0.1）。' },
        { token: 'loss', label: '红色菱形：该战役最终亏损（b < −0.1）。' },
        { token: 'neutral', label: '灰色空心圈：持平（|b| ≤ 0.1）或尚未结束。' },
      ],
    },
    missingValueLabel: '镜像止盈结果',
    colorMode: 'pnlBand',
    formatValue: formatMirrorTpMetric,
  },
  {
    key: 'dsiContribution',
    label: 'DSI 贡献',
    chartLabel: 'DSI 贡献图',
    seriesLabel: 'DSI 贡献率时序',
    guide: {
      yAxis: '该场亏损战役对下行风险 DSI 的贡献率 = bᵢ² ÷ 所有亏损战役 b² 之和 × 100%。',
      point: '点越高，这一场对下行风险的拉动越大。平方放大了大亏，少数几场就可能占掉大半 DSI。',
      colors: [
        { token: 'loss', label: '红色：亏损战役；只有亏损（b ≤ 0）才对 DSI 有贡献。' },
      ],
      referenceLines: ['所有点的贡献率合计为 100%。'],
    },
    missingValueLabel: 'DSI 贡献率',
    colorMode: 'downside',
    formatValue: value => `${value.toFixed(1)}%`,
  },
  {
    key: 'usiContribution',
    label: 'USI 贡献',
    chartLabel: 'USI 贡献图',
    seriesLabel: 'USI 贡献率时序',
    guide: {
      yAxis: '该场盈利战役对上行离散 USI 的贡献率 = bᵢ² ÷ 所有盈利战役 b² 之和 × 100%。',
      point: '点越高，这一场对盈利离散度的拉动越大。若极少数战役占掉大半，说明盈利高度依赖偶发大赚。',
      colors: [
        { token: 'profit', label: '绿色：盈利战役；只有盈利（b > 0）才对 USI 有贡献。' },
      ],
      referenceLines: ['所有点的贡献率合计为 100%。'],
    },
    missingValueLabel: 'USI 贡献率',
    colorMode: 'upside',
    formatValue: value => `${value.toFixed(1)}%`,
  },
  // 【用户要求】涨跌幅、涨跌幅倍数、加仓效用与已有指标一样各配一张散点图；三者都带方向，按正绿负红着色（同盈亏比）。
  {
    key: 'mainPriceChange',
    label: '涨跌幅',
    chartLabel: '涨跌幅图',
    viewLabel: '时序',
    viewTestId: 'campaign-mainPriceChange-view-time',
    seriesLabel: '涨跌幅时序',
    guide: {
      yAxis: '每场战役的涨跌幅，单位 %：（平仓价 − 开仓价）÷ 开仓价，按主力方向计——空单价格跌了为正，与盈亏同号。开仓价取主力最有利的一笔；主力平仓时有对冲锁住行情就按对冲的开仓价，否则按主力的平仓价（开平价与详情页 Legs 表「涨跌幅」列同源）。',
      point: '点越高，主力吃到的价格行情越大；低于 0% 表示价格朝主力的反方向走。每个点代表一场主力已平仓的战役。',
      colors: [
        { token: 'profit', label: '绿色：涨跌幅 > 0，价格朝主力方向走。' },
        { token: 'loss', label: '红色：涨跌幅 < 0，价格朝主力反方向走。' },
        { token: 'neutral', label: '灰色：涨跌幅 = 0，开平价相同。' },
      ],
      referenceLines: ['灰色零线：价格不涨不跌的分界。'],
    },
    missingValueLabel: '主力涨跌幅',
    colorMode: 'signed',
    formatValue: value => formatLegPriceChangePct(value),
  },
  {
    key: 'mainPriceChangeDistribution',
    sourceKey: 'mainPriceChange',
    view: 'distribution',
    label: '涨跌幅分布',
    chartLabel: '分布图',
    viewLabel: '分布',
    viewTestId: 'campaign-mainPriceChange-view-distribution',
    seriesLabel: '涨跌幅分布',
    guide: {
      yAxis: '落在该涨跌幅附近的战役数量：点从底线向上堆叠，堆得越高，这一档涨跌幅出现得越多。刻度随图高变化，读柱高时对照左侧场数刻度。',
      point: '每个点仍是一场主力已平仓的战役，横向位置就是这场战役的涨跌幅（%，按主力方向计，空单价格跌了为正；开仓价取主力最有利的一笔，主力平仓时有对冲锁住行情就按对冲开仓价；开平价与 Legs 表「涨跌幅」列同源），不考虑时间先后；同一档内的点按涨跌幅从小到大自下而上排。',
      colors: [
        { token: 'profit', label: '绿色：涨跌幅 > 0，价格朝主力方向走。' },
        { token: 'loss', label: '红色：涨跌幅 < 0，价格朝主力反方向走。' },
        { token: 'neutral', label: '灰色：涨跌幅 = 0，开平价相同。' },
      ],
      referenceLines: [
        '灰色 0% 竖线：价格不涨不跌的分界，线右是价格朝主力方向走、线左是朝反方向走；摘要条的「顺向」是涨跌幅 > 0 的场数占比。',
        METRIC_DISTRIBUTION_DENSITY_NOTE,
        METRIC_DISTRIBUTION_CLAMP_NOTE,
      ],
    },
    missingValueLabel: '主力涨跌幅',
    colorMode: 'signed',
    formatValue: value => formatLegPriceChangePct(value),
    distribution: {
      unit: '%',
      zeroLabel: '0% 不涨不跌',
      zeroMeaning: '涨跌分界',
      positiveShareLabel: '顺向',
    },
  },
  {
    key: 'mainPriceEfficiency',
    label: '涨跌幅倍数',
    chartLabel: '涨跌幅倍数图',
    viewLabel: '时序',
    viewTestId: 'campaign-mainPriceEfficiency-view-time',
    seriesLabel: '涨跌幅倍数时序',
    guide: {
      yAxis: '涨跌幅倍数 = 主力涨跌幅 ÷ 预期回撤，单位为倍：价格走出了几个「预期回撤」。+3.00 表示主力吃到的行情是入场到对冲边界距离的 3 倍。',
      point: '点越高，同样的风险距离换来的价格行情越大；低于 0 表示价格朝主力反方向走。每个点代表一场主力已平仓、且算得出预期回撤的战役。',
      colors: [
        { token: 'profit', label: '绿色：涨跌幅倍数 > 0，价格朝主力方向走。' },
        { token: 'loss', label: '红色：涨跌幅倍数 < 0，价格朝主力反方向走。' },
        { token: 'neutral', label: '灰色：涨跌幅倍数 = 0。' },
      ],
      referenceLines: ['灰色零线：正、负涨跌幅倍数的分界。'],
    },
    missingValueLabel: '涨跌幅倍数',
    colorMode: 'signed',
    formatValue: value => formatEfficiency(value),
  },
  {
    key: 'mainPriceEfficiencyDistribution',
    sourceKey: 'mainPriceEfficiency',
    view: 'distribution',
    label: '涨跌幅倍数分布',
    chartLabel: '分布图',
    viewLabel: '分布',
    viewTestId: 'campaign-mainPriceEfficiency-view-distribution',
    seriesLabel: '涨跌幅倍数分布',
    guide: {
      yAxis: '落在该涨跌幅倍数附近的战役数量：点从底线向上堆叠，堆得越高，这一档涨跌幅倍数出现得越多。刻度随图高变化，读柱高时对照左侧场数刻度。',
      point: '每个点仍是一场战役，横向位置就是它的涨跌幅倍数（= 主力涨跌幅 ÷ 预期回撤：价格走出了几个「预期回撤」），不考虑时间先后；同一档内的点按涨跌幅倍数从小到大自下而上排。只画主力已平仓、且算得出预期回撤的战役。',
      colors: [
        { token: 'profit', label: '绿色：涨跌幅倍数 > 0，价格朝主力方向走。' },
        { token: 'loss', label: '红色：涨跌幅倍数 < 0，价格朝主力反方向走。' },
        { token: 'neutral', label: '灰色：涨跌幅倍数 = 0。' },
      ],
      referenceLines: [
        '灰色 0.00 竖线：正、负涨跌幅倍数的分界，线右是价格朝主力方向走、线左是朝反方向走；摘要条的「顺向」是涨跌幅倍数 > 0 的场数占比。',
        METRIC_DISTRIBUTION_DENSITY_NOTE,
        METRIC_DISTRIBUTION_CLAMP_NOTE,
      ],
    },
    missingValueLabel: '涨跌幅倍数',
    colorMode: 'signed',
    formatValue: value => formatEfficiency(value),
    distribution: {
      unit: '倍',
      zeroLabel: '0.00 不涨不跌',
      zeroMeaning: '涨跌分界',
      positiveShareLabel: '顺向',
    },
  },
  {
    key: 'addEfficiency',
    label: '加仓效用',
    chartLabel: '加仓效用图',
    viewLabel: '时序',
    viewTestId: 'campaign-addEfficiency-view-time',
    seriesLabel: '加仓效用时序',
    guide: {
      yAxis: '加仓效用 = 盈亏比 b ÷ 涨跌幅倍数，单位为倍。只拿主力、不加仓时约为 1；大于 1 说明加仓把同一段行情放大成了更多的 R，小于 1 说明加仓、对冲或止盈吃掉了行情。',
      point: '点越高，加仓对同一段行情的放大越多。只画做过加仓（有一条成交过的加仓腿）且涨跌幅倍数为正的战役，其余不进图。',
      colors: [
        { token: 'profit', label: '绿色：加仓效用 > 0，本场盈亏比为正。' },
        { token: 'loss', label: '红色：加仓效用 < 0，主力涨了、本场却亏了（盈亏比为负）。' },
        { token: 'neutral', label: '灰色：加仓效用 = 0。' },
      ],
      referenceLines: ['灰色零线：正、负加仓效用的分界；读数 1 是「加仓没有额外放大」的参照，不单独画线。'],
    },
    missingValueLabel: '加仓效用',
    colorMode: 'signed',
    formatValue: value => formatEfficiency(value),
  },
  {
    key: 'addEfficiencyDistribution',
    sourceKey: 'addEfficiency',
    view: 'distribution',
    label: '加仓效用分布',
    chartLabel: '分布图',
    viewLabel: '分布',
    viewTestId: 'campaign-addEfficiency-view-distribution',
    seriesLabel: '加仓效用分布',
    guide: {
      yAxis: '落在该加仓效用附近的战役数量：点从底线向上堆叠，堆得越高，这一档加仓效用出现得越多。刻度随图高变化，读柱高时对照左侧场数刻度。',
      point: '每个点仍是一场做过加仓、且涨跌幅倍数为正的战役，横向位置就是它的加仓效用（倍，= 盈亏比 b ÷ 涨跌幅倍数），不考虑时间先后；同一档内的点按加仓效用从小到大自下而上排。没有加仓、或涨跌幅倍数不为正的战役不进图。',
      colors: [
        { token: 'profit', label: '绿色：加仓效用 > 0，本场盈亏比为正。' },
        { token: 'loss', label: '红色：加仓效用 < 0，主力涨了、本场却亏了（盈亏比为负）。' },
        { token: 'neutral', label: '灰色：加仓效用 = 0。' },
      ],
      referenceLines: [
        '琥珀色 1.00 虚线：加仓没有额外放大——只拿主力、不加仓时加仓效用约为 1。线右是加仓把同一段行情放大成了更多的 R（摘要条的「放大（> 1）」是加仓效用 > 1 的场数占比），线左是加仓、对冲或止盈吃掉了行情；1.00 也是档边界，恰好等于 1.00 的点归线右。',
        '灰色 0.00 竖线：盈亏平衡。进图的战役涨跌幅倍数都为正，加仓效用与盈亏比同号：线左是主力涨了、本场却亏了；摘要条的「盈利」是加仓效用 > 0 的场数占比。',
        METRIC_DISTRIBUTION_DENSITY_NOTE,
        METRIC_DISTRIBUTION_CLAMP_NOTE,
      ],
    },
    missingValueLabel: '加仓效用',
    colorMode: 'signed',
    formatValue: value => formatEfficiency(value),
    distribution: {
      unit: '倍',
      zeroLabel: '0.00 盈亏平衡',
      zeroMeaning: '盈亏分界',
      positiveShareLabel: '盈利',
      references: [{ value: 1, label: '1.00 加仓没有额外放大', shareLabel: '放大（> 1）' }],
    },
  },
] as const;

const SORT_FORMULA_BY_MODE: Partial<Record<CampaignSortMode, CampaignFormulaPopover>> = {
  importance: 'importanceSort',
  captureRate: 'captureRate',
  expectedDrawdownPct: 'expectedDrawdownPct',
  arithmeticExpectancy: 'arithmeticExpectancy',
  geometricExpectancy: 'geometricExpectancy',
  mirrorTp: 'mirrorTpSort',
  dsiContribution: 'dsiContributionSort',
  usiContribution: 'usiContributionSort',
  mainPriceChange: 'mainPriceChangeSort',
  mainPriceEfficiency: 'mainPriceEfficiencySort',
  addEfficiency: 'addEfficiencySort',
};

const SORT_CHART_BY_MODE: Partial<Record<CampaignSortMode, CampaignMetricChartKey>> = {
  importance: 'importance',
  captureRate: 'odds',
  expectedDrawdownPct: 'expectedDrawdownPct',
  arithmeticExpectancy: 'arithmeticExpectancy',
  geometricExpectancy: 'geometricExpectancy',
  mirrorTp: 'mirrorTp',
  dsiContribution: 'dsiContribution',
  usiContribution: 'usiContribution',
  mainPriceChange: 'mainPriceChange',
  mainPriceEfficiency: 'mainPriceEfficiency',
  addEfficiency: 'addEfficiency',
};

/**
 * 某个指标族**默认打开哪一张视图**。
 *
 * 盈亏比默认看分布而不是时序：要判断的是「这套打法的形状对不对」——右尾够不够长、
 * 亏损有没有被 -1R 止损墙挡住——而形状与战役先后无关。时序回答的是「b 怎么变化」，
 * 是第二个问题。面板右上角的「时序 | 分布」随时切回，选择记进 URL。
 *
 * 这里映射的是**族键**（排序行按钮传进来的那个），族键本身仍用于判定「当前开的是不是这一族」
 * 与按钮的 testid，所以不能反过来把 SORT_CHART_BY_MODE 直接改成分布键。
 */
const DEFAULT_CHART_VIEW_BY_SOURCE: Partial<Record<CampaignMetricChartKey, CampaignMetricChartKey>> = {
  odds: 'oddsDistribution',
  // 镜像止盈同理：要问的是「四档各多少场」，时序把 200 个点摊成四条横线，什么也读不出来。
  mirrorTp: 'mirrorTpBars',
  // 几何期望也一样：要判断的是这套打法的资本增长偏不偏、右尾够不够长——那是形状问题。
  geometricExpectancy: 'geometricExpectancyDistribution',
  // 【用户要求】涨跌幅、涨跌幅倍数、加仓效用、算术期望同盈亏比：默认看分布，「时序 | 分布」随时切回。
  mainPriceChange: 'mainPriceChangeDistribution',
  mainPriceEfficiency: 'mainPriceEfficiencyDistribution',
  addEfficiency: 'addEfficiencyDistribution',
  arithmeticExpectancy: 'arithmeticExpectancyDistribution',
};

export type CampaignMetricChartViewState = {
  open: boolean;
  key: CampaignMetricChartKey;
};

/**
 * 散点图的开关与选中指标存进 URL，而不是只放组件 state：
 * 从散点图点进战役详情时 URL 会被一并带上，详情页返回（nav(-1)）落回同一条
 * history 记录，列表页据此重新打开同一张散点图，而不是掉回卡片列表。
 */
function parseCampaignChartParams(search: string): CampaignMetricChartViewState {
  const requested = new URLSearchParams(search).get('chart');
  const matched = CAMPAIGN_METRIC_CHART_CONFIGS.find(config => config.key === requested);
  return matched
    ? { open: true, key: matched.key }
    : { open: false, key: DEFAULT_CHART_VIEW_BY_SOURCE.odds ?? 'odds' };
}

/**
 * 操作时间段也存进 URL：与排序、散点图同一套做法——从卡片点进详情再返回时
 * 落回同一条 history 记录，筛选范围要跟着回来，否则统计会在眼皮底下跳回全部。
 */
function parseCampaignRangeParams(search: string): CampaignOperationRange {
  const params = new URLSearchParams(search);
  const from = params.get('from');
  const to = params.get('to');
  return {
    from: isValidDayKey(from) ? from : null,
    to: isValidDayKey(to) ? to : null,
  };
}

/**
 * 带方向的数字用的正 / 负色。深色主题沿用币安绿 / 红；浅色主题换成与散点图 --chart-profit / --chart-loss
 * 同一对更深的绿 / 红——#0ECB81 压在浅底上对比度只有 2:1 左右，数字发虚。
 */
const TONE_UP = 'text-[#00875A] dark:text-[#0ECB81]';
const TONE_DOWN = 'text-[#DE350B] dark:text-[#F6465D]';

/** 按正负取色；缺值与 0 用给定的中性色。 */
function signTone(value: number | null | undefined, neutral: string): string {
  if (value == null || !Number.isFinite(value) || value === 0) return neutral;
  return value > 0 ? TONE_UP : TONE_DOWN;
}

/** 状态胶囊：浅色主题字色加深一档（同 TONE_UP / TONE_DOWN），底色仍是同色系的淡底。 */
const STATUS_STYLES: Record<string, string> = {
  active: 'bg-[#F0B90B]/15 text-[#8F6B00] dark:text-[#F0B90B]',
  closed_profit: `bg-[#0ECB81]/15 ${TONE_UP}`,
  closed_loss: `bg-[#F6465D]/15 ${TONE_DOWN}`,
  closed_breakeven: 'bg-muted text-muted-foreground',
  planned: 'bg-muted text-muted-foreground',
  abandoned: 'bg-[#848E9C]/15 text-[#848E9C]',
};

const STATUS_ACCENT_STYLES: Record<string, string> = {
  active: 'bg-[#F0B90B]',
  closed_profit: 'bg-[#0ECB81]',
  closed_loss: 'bg-[#F6465D]',
  closed_breakeven: 'bg-[#848E9C]',
  planned: 'bg-[#848E9C]',
  abandoned: 'bg-[#848E9C]',
};

const DIRECTION_STYLES: Record<string, string> = {
  main_long: `bg-[#0ECB81]/10 ${TONE_UP}`,
  main_short: `bg-[#F6465D]/10 ${TONE_DOWN}`,
};

const LEG_ABBR: Record<LegRole, string> = {
  main_open: 'M',
  main_add_1: 'A1',
  main_add_2: 'A2',
  main_add_3: 'A3',
  main_add_4: 'A4',
  main_add_5: 'A5',
  main_add_6: 'A6',
  hedge_initial_a: 'Ha',
  hedge_initial_b: 'Hb',
  hedge_rolling: 'R',
  mirror_tp: 'TP',
  reentry_main: 'RM',
  reentry_hedge: 'RH',
  standalone: 'S',
};

/** Legs 小标签：浅色主题字色加深一档（绿 / 红同 TONE_UP / TONE_DOWN），深色主题不变。 */
const LEG_CHIP_UP = `bg-[#0ECB81]/10 ${TONE_UP}`;
const LEG_CHIP_DOWN = `bg-[#F6465D]/10 ${TONE_DOWN}`;
const LEG_CHIP_ROLL = 'bg-[#B080FF]/10 text-[#7A4FD6] dark:text-[#B080FF]';
const LEG_CHIP_CLASS: Record<LegRole, string> = {
  main_open: LEG_CHIP_UP,
  main_add_1: LEG_CHIP_UP,
  main_add_2: LEG_CHIP_UP,
  main_add_3: LEG_CHIP_UP,
  main_add_4: LEG_CHIP_UP,
  main_add_5: LEG_CHIP_UP,
  main_add_6: LEG_CHIP_UP,
  hedge_initial_a: LEG_CHIP_DOWN,
  hedge_initial_b: LEG_CHIP_DOWN,
  hedge_rolling: LEG_CHIP_ROLL,
  mirror_tp: 'bg-[#F0B90B]/10 text-[#8F6B00] dark:text-[#F0B90B]',
  reentry_main: LEG_CHIP_UP,
  reentry_hedge: LEG_CHIP_ROLL,
  standalone: 'bg-muted text-muted-foreground',
};

const fmtTime = (iso: string | null) => (iso ? iso.replace('T', ' ').slice(0, 16) : '进行中');
const fmtOperationTime = (time: number | null) => (
  time == null ? '—' : formatBeijingTime(time).slice(0, 16)
);
const fmtDeletedTime = (iso: string | null | undefined) => (
  iso ? formatBeijingTime(new Date(iso).getTime()).slice(0, 16) : '—'
);

function formatAsymmetricMetric(value: number | null, digits = 2): string {
  return value == null ? '—' : value.toFixed(digits);
}

function dsiTone(value: number | null): string {
  if (value == null) return 'text-muted-foreground';
  if (value <= 1.05) return 'text-[#0ECB81]';
  if (value <= 1.15) return 'text-[#B8860B]';
  return 'text-[#F6465D]';
}

function usiTone(value: number | null): string {
  if (value == null) return 'text-muted-foreground';
  if (value >= 1.8) return 'text-[#0ECB81]';
  if (value >= 1.5) return 'text-[#B8860B]';
  return 'text-[#F6465D]';
}

function sortDirectionLabel(direction: CampaignSortDirection, mode?: CampaignSortMode): string {
  if (mode === 'alpha') return direction === 'asc' ? 'A 到 Z' : 'Z 到 A';
  if (mode === 'mirrorTp') return direction === 'desc' ? '生效在前' : '未实现在前';
  return direction === 'desc' ? '从大到小' : '从小到大';
}

/** 卡片上的镜像止盈状态文案；与统计、排序共用 mirrorTpOutcome，三处不会各判各的。 */
const MIRROR_TP_STATUS_LABEL: Record<MirrorTpOutcome, string> = {
  win: '已实现·盈利',
  loss: '已实现·亏损',
  flat: '已实现·持平',
  open: '已实现·进行中',
};

const formatMainPriceEfficiency = formatEfficiency;

/** 卡片上主力涨跌幅的字色：与 Legs 表「涨跌幅」列同一套判定（按显示到两位小数后的值，正绿负红，0 中性）。 */
const MAIN_PRICE_CHANGE_TONE: Record<LegPriceChangeDirection, string> = {
  up: TONE_UP,
  down: TONE_DOWN,
  flat: 'text-muted-foreground/80',
};

/** 按显示到两位小数后的值定正负色，读数为 0.00 时不上色。 */
function signedTone(value: number): LegPriceChangeDirection {
  const rounded = Number(value.toFixed(2));
  return rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
}

/** 10 → 「10x」；7.5 → 「7.5x」。 */
function formatLeverage(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(1))}x`;
}

function durationLabel(openedAt: string, closedAt: string | null) {
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const start = new Date(openedAt).getTime();
  const mins = Math.max(0, Math.floor((end - start) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  if (hours < 24) return `${hours}h ${restMins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** 几何期望统一按这个固定下注比例读，卡片与汇总区共用。 */
const fixedFractionLabel = `${(FIXED_DRAWDOWN_FRACTION * 100).toFixed(0)}%`;

/**
 * 封面指标项：上标签、下数值，左右各 10px 内边距、圆角。每一项都预留同样的内边距，
 * 高亮（当前排序项）只换底色与描边，切换排序时文字一个像素都不动。
 */
const CARD_METRIC_CELL = 'flex min-w-0 shrink-0 flex-col gap-0.5 rounded-md px-2.5 py-1.5 transition-[background-color,box-shadow] duration-150';
/** 封面八项的指标名（与排序行同序）：卡片上的 dt 与列宽估算读同一份。 */
const CARD_METRIC_LABEL = {
  mirrorTp: '镜像止盈',
  expectedDrawdownPct: '预期回撤',
  mainPriceChange: '涨跌幅',
  mainPriceEfficiency: '涨跌幅倍数',
  captureRate: '盈亏比',
  addEfficiency: '加仓效用',
  geometricExpectancy: '几何期望',
  arithmeticExpectancy: '算术期望',
} as const satisfies Partial<Record<CampaignSortMode, string>>;
type CardMetricMode = keyof typeof CARD_METRIC_LABEL;
type CardMetricReadings = Record<CardMetricMode, string>;
const CARD_METRIC_MODES = Object.keys(CARD_METRIC_LABEL) as CardMetricMode[];
/**
 * 每项的宽度（≥ 640px）读列表容器上的 CSS 变量 --cm-w-<项>（cardMetricWidthStyle 按当前时间段里全部战役的读数算出）。
 * Tailwind 要看到完整类名，所以逐个写出；手机（< 640px）是两列网格，不读这些变量。
 */
const CARD_METRIC_WIDTH_CLASS = {
  mirrorTp: 'sm:w-[var(--cm-w-mirrorTp)]',
  expectedDrawdownPct: 'sm:w-[var(--cm-w-expectedDrawdownPct)]',
  mainPriceChange: 'sm:w-[var(--cm-w-mainPriceChange)]',
  mainPriceEfficiency: 'sm:w-[var(--cm-w-mainPriceEfficiency)]',
  captureRate: 'sm:w-[var(--cm-w-captureRate)]',
  addEfficiency: 'sm:w-[var(--cm-w-addEfficiency)]',
  geometricExpectancy: 'sm:w-[var(--cm-w-geometricExpectancy)]',
  arithmeticExpectancy: 'sm:w-[var(--cm-w-arithmeticExpectancy)]',
} as const satisfies Record<CardMetricMode, string>;

/** 每行的封面读数按行对象缓存：行对象不变，读数就不变（行情 tick 不会换掉没变的行）。 */
const cardMetricReadingsCache = new WeakMap<CampaignDisplayData, CardMetricReadings>();
/**
 * 封面八项的读数，与卡片上显示的字符串逐字相同：卡片渲染与列宽估算都读这一份，估出来的宽度就是卡片上的字。
 */
function cardMetricReadings(row: CampaignDisplayData): CardMetricReadings {
  const cached = cardMetricReadingsCache.get(row);
  if (cached) return cached;
  const { profitCaptureRatio, initialExpectedMaxDrawdownPct } = row;
  const mainPriceEfficiency = rowMainPriceEfficiency(row);
  const addEfficiency = rowAddEfficiency(row);
  const readings: CardMetricReadings = {
    mirrorTp: !campaignAchievedMirrorTp(row.legs, row.tradeRecords)
      ? '未实现'
      : MIRROR_TP_STATUS_LABEL[mirrorTpOutcome(
        profitCaptureRatio == null ? null : profitCaptureRatio / 100,
        row.campaign.final_realized_pnl ?? null,
      )],
    expectedDrawdownPct: initialExpectedMaxDrawdownPct > 0 ? `${initialExpectedMaxDrawdownPct.toFixed(2)}%` : '—',
    mainPriceChange: formatLegPriceChangePct(row.mainPriceChangePct),
    mainPriceEfficiency: mainPriceEfficiency == null ? '—' : formatMainPriceEfficiency(mainPriceEfficiency),
    // 【用户要求】盈亏比只保留倍数 b，不写百分数
    captureRate: profitCaptureRatio == null ? '—' : formatCampaignPayoffRatio(profitCaptureRatio),
    addEfficiency: addEfficiency == null ? '—' : formatMainPriceEfficiency(addEfficiency),
    geometricExpectancy: formatGeometricExpectancy(row.geometricExpectancy),
    arithmeticExpectancy: formatArithmeticExpectancy(row.arithmeticExpectancy),
  };
  cardMetricReadingsCache.set(row, readings);
  return readings;
}

/**
 * 列表容器上的列宽变量：当前时间段里的全部战役（displayRows，与排序无关）每一项的指标名与读数取宽者 + 左右内边距，
 * 向上取整到偶数 px（cardMetricColumnWidths）。读数短的列表不再为没出现的极端读数留空，相邻两项之间的空白因此匀称。
 */
function cardMetricWidthStyle(rows: readonly CampaignDisplayData[]): CSSProperties {
  const widths = cardMetricColumnWidths(CARD_METRIC_LABEL, rows.map(cardMetricReadings));
  const style: Record<string, string> = {};
  for (const mode of CARD_METRIC_MODES) style[`--cm-w-${mode}`] = `${widths[mode]}px`;
  return style as CSSProperties;
}
/**
 * 【用户要求】「选中排序功能的时候，交易战役封面上对应的模块高亮显示」：淡琥珀底 + 细描边，
 * 指标名换成琥珀色（浅色主题用深一档的琥珀，白底上才看得清）。封面上的其它对应模块（操作时间、杠杆、重要性、标题）同一套颜色。
 */
const SORT_HIGHLIGHT_BOX = 'bg-[#F0B90B]/[0.08] ring-1 ring-inset ring-[#F0B90B]/40 dark:bg-[#F0B90B]/[0.10]';
const SORT_HIGHLIGHT_TEXT = 'text-[#B7860B] dark:text-[#F0B90B]';
/**
 * 多级排序时，第二级及以后对应的模块用更轻一档的同色系：底色与描边都减半、指标名换成淡琥珀、不加粗——
 * 第一级仍是上面那一套，扫一眼分得出主次；与第一级一样只换底色与描边，文字不挪。
 */
const SORT_THEN_HIGHLIGHT_BOX = 'bg-[#F0B90B]/[0.035] ring-1 ring-inset ring-[#F0B90B]/20 dark:bg-[#F0B90B]/[0.045]';
const SORT_THEN_HIGHLIGHT_TEXT = 'text-[#B7860B]/80 dark:text-[#F0B90B]/70';
/** 指标名：10px 淡色，一格一行，放不下时省略。 */
const CARD_METRIC_NAME = 'truncate text-[10px] leading-[14px]';
/** 数值一行：只放读数（「仓位击穿」徽标在标题行、杠杆标签之后）。 */
const CARD_METRIC_VALUE_ROW = 'flex h-4 min-w-0 items-center';
/** 展开详情里的名称（「名称：值」写在一行里）。 */
const CARD_DETAIL_LABEL = 'shrink-0 text-[10px] leading-4 text-muted-foreground/80';
/** 展开详情里的一项：不按列排、不画分隔线，项与项之间只靠 gap-x-6 分开。 */
const CARD_DETAIL_ITEM = 'inline-flex h-7 min-w-0 shrink-0 items-center gap-1 whitespace-nowrap';
/**
 * 统计概览的一项：标签淡、数值实（11px 等宽），点击展开公式；浮层打开时保持按下态。
 * border 预留 1px：悬停 / 打开时出现的描边不会把后面的项挤动。
 */
const STAT_TRIGGER = 'inline-flex h-7 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded border px-2 transition-[color,background-color,border-color] duration-150 hover:border-border/70 hover:bg-background/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70 data-[state=open]:border-border data-[state=open]:bg-background';
const STAT_LABEL = 'text-muted-foreground';
/** 数值的字形；颜色另给（中性用 text-foreground/90，带方向的走 statSignTone），免得两条颜色类互相覆盖。 */
const STAT_VALUE = 'font-mono text-[11px] font-medium tabular-nums';

/** 带方向的汇总数（期望值、几何期望）：正绿负红，与封面同一套颜色；缺值与 0 不上色。 */
function statSignTone(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || Number(value.toFixed(4)) === 0) return 'text-foreground/90';
  return value > 0 ? TONE_UP : TONE_DOWN;
}

/** 封面标题旁的标签（方向 / 标的 / 杠杆 / 仓位击穿 / 编号）统一高度与圆角。 */
const CARD_CHIP = 'inline-flex h-[18px] items-center rounded-[3px] px-1.5 leading-none';
/** 批量下载选择条里的次级按钮：与排序按钮同高同字号，平时只有淡边框。 */
const BATCH_BAR_BUTTON = 'inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded border border-border/60 bg-background/60 px-2 text-foreground/80 transition-[color,background-color,border-color] duration-150 hover:border-border hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-40';
/**
 * 数值：11px 等宽。格宽按列表里最宽的读数估算（只会偏宽），正常不会截断；省略号只是兜底，
 * 万一装不下也在本格内收住、不压到隔壁一格。行高给足 16px。
 */
const CARD_METRIC_VALUE = 'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] font-medium leading-4 tabular-nums';
/** 展开详情里的数值：比指标行轻一档（常规字重），层级上退后。 */
const CARD_DETAIL_VALUE = 'whitespace-nowrap font-mono text-[11px] leading-4 tabular-nums';

type CampaignCardProps = {
  row: CampaignDisplayData;
  /**
   * 排序链上各级的排序项（第一级在前）：封面上对应的模块高亮——第一级用 SORT_HIGHLIGHT_*，之后各级轻一档（SORT_THEN_*）。
   * DSI / USI 贡献不在封面上，没有可亮的。页面按排序链 memo 住这个数组，卡片的 memo 才不会白白失效。
   */
  sortHighlight: readonly CampaignSortMode[];
  expanded: boolean;
  busy: boolean;
  isOwnCampaign: boolean;
  campaignAccountName: string;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (campaignId: string) => void;
  onOpen: (campaignId: string) => void;
  onToggleDetails: (event: MouseEvent<HTMLButtonElement>, campaignId: string) => void;
  onImportanceChange: (event: MouseEvent<HTMLButtonElement>, campaign: TradeCampaign, weight: number) => void;
  onDelete: (event: MouseEvent<HTMLButtonElement>, campaign: TradeCampaign) => void;
};

/**
 * 单张战役卡片。按引用 memo：行情每个 tick 都会让整页重渲染，
 * 行对象与回调没变的卡片一张都不重画（237 张卡片就是每个 tick 上万个节点的对账）。
 */
const CampaignCard = memo(function CampaignCard({
  row,
  sortHighlight,
  expanded,
  busy,
  isOwnCampaign,
  campaignAccountName,
  selectionMode = false,
  selected = false,
  onToggleSelection,
  onOpen,
  onToggleDetails,
  onImportanceChange,
  onDelete,
}: CampaignCardProps) {
  const {
    campaign,
    legs,
    tradeRecords,
    profitCaptureRatio,
    initialExpectedMaxDrawdownPct,
    initialRiskFraction,
    riskAccountEquity,
    arithmeticExpectancy,
    geometricExpectancy,
  } = row;
  const cardLeverage = campaignLeverage(campaign, legs);
  const mainPriceChangePct = row.mainPriceChangePct;
  const mainPriceEfficiency = rowMainPriceEfficiency(row);
  const addEfficiency = rowAddEfficiency(row);
  const importance = importanceValue(campaign);
  const operationTime = campaignOperationTime(legs, tradeRecords);
  const campaignDisplayCode = formatCampaignDisplayCode(
    campaign.campaign_code,
    campaignAccountName,
    campaign.id,
  );
  /** 封面八项的读数：与列表容器上的列宽估算同一份（cardMetricReadings）。 */
  const readings = cardMetricReadings(row);
  const mirrorTpStatus = readings.mirrorTp;
  const statusLabel = campaign.status === 'active'
    ? '进行中'
    : campaign.status === 'closed_profit'
      ? '盈利结束'
      : campaign.status === 'closed_loss'
        ? '亏损结束'
        : campaign.status === 'closed_breakeven'
          // 与批量结束对话框同一个叫法（BULK_CLOSE_STATUS_LABELS）
          ? '打平结束'
          : campaign.status === 'abandoned'
            ? '已放弃'
            : campaign.status === 'planned'
              ? '计划中'
              : campaign.status;
  const realizedPnl = campaign.final_realized_pnl;
  const realizedPnlTone = signTone(realizedPnl, 'text-foreground/80');
  // 红绿跟着读数上的 b（两位小数）走：只亏一点手续费、读作「0.00」的战役用中性色，不出现红色的 0.00
  const payoffRatioTone = signTone(campaignPayoffRatioMultiple(profitCaptureRatio), 'text-foreground/85');
  const arithmeticTone = signTone(arithmeticExpectancy, 'text-foreground/80');
  // 本场真实下注比例（最大预期亏损 ÷ 账户总资产）≥ 100%：这一注押上了全部本金。
  // 这是仓位大小的结论，不进几何期望公式，也不是本场盈亏，所以会和正的算术期望同时出现。
  const ruinousSizing = initialRiskFraction != null && initialRiskFraction >= 1;
  /** 下注比例的算式，分子分母都代入：标题行「仓位击穿」与几何期望格的悬停说明共用。 */
  const riskFractionFormula = `最大预期亏损 ÷ 账户总资产 = ${row.initialExpectedMaxLoss.toFixed(2)} ÷ ${riskAccountEquity?.toFixed(2) ?? '—'}`
    + ` = ${((initialRiskFraction ?? 0) * 100).toFixed(2)}%`;
  const geometricTone = signTone(geometricExpectancy, 'text-foreground/80');
  const detailsExpanded = expanded;
  /** 这一项在排序链上的第几级（0 = 第一级；-1 = 不在链上）。 */
  const sortLevel = (mode: CampaignSortMode) => sortHighlight.indexOf(mode);
  /** 按这一项在排序链上的级别取类名：第一级 / 之后各级 / 不在链上。 */
  const byLevel = (mode: CampaignSortMode, first: string, then: string, idle: string) => {
    const level = sortLevel(mode);
    return level === 0 ? first : level > 0 ? then : idle;
  };
  /** 指标项的类名：宽度（列表容器上的 CSS 变量）+ 排序链上的高亮。 */
  const metricCell = (mode: CardMetricMode) => `${CARD_METRIC_CELL} ${CARD_METRIC_WIDTH_CLASS[mode]} ${byLevel(mode, SORT_HIGHLIGHT_BOX, SORT_THEN_HIGHLIGHT_BOX, '')}`;
  const metricName = (mode: CardMetricMode) => `${CARD_METRIC_NAME} ${byLevel(mode, `${SORT_HIGHLIGHT_TEXT} font-medium`, SORT_THEN_HIGHLIGHT_TEXT, 'text-muted-foreground/80')}`;
  /** data-sort-highlight：第一级 'true'，之后各级 'then'。 */
  const litAttr = (mode: CampaignSortMode) => byLevel(mode, 'true', 'then', '') || undefined;
  return (
    <div
      data-testid="campaign-card"
      data-selected={selectionMode ? selected : undefined}
      onClick={() => selectionMode ? onToggleSelection?.(campaign.id) : onOpen(campaign.id)}
      className={`group relative mb-3.5 cursor-pointer overflow-hidden rounded-md border shadow-[0_2px_7px_rgba(15,23,42,0.055)] transition-[border-color,box-shadow,background-color] last:mb-0 hover:shadow-[0_7px_22px_rgba(15,23,42,0.08)] ${
        selectionMode && selected
          // 选中：琥珀描边 + 极淡琥珀底，与选择模式按钮同一种强调色；左侧状态色条照旧，盈亏一眼仍读得出。
          // 琥珀底叠在卡片底色上（背景图层），不是替掉卡片底色：深色主题里只剩 3.5% 琥珀叠在页面底色上，选中的卡反而比没选中的更暗、像陷下去一块。
          ? 'border-[#F0B90B]/60 bg-card bg-[linear-gradient(rgba(240,185,11,0.05),rgba(240,185,11,0.05))] ring-1 ring-[#F0B90B]/25 hover:border-[#F0B90B]/80'
          : 'border-border bg-card hover:border-foreground/20 hover:bg-accent/20'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-[3px] opacity-65 ${STATUS_ACCENT_STYLES[campaign.status] || 'bg-muted-foreground'}`}
      />
      <div className="flex flex-col gap-2 px-4 py-2.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {/* 批量下载的选择模式：标题前一枚勾选框（点整张卡也能切换）；平时不占位。封面指标行在下一行，勾选框不挪动逐列对齐。
              勾选框与状态圆点都对齐标题那一行（行高 20px 的中线）：手机上标签折成几行时，它们不会跑到中间那行（杠杆 / 编号）旁边。 */}
          {selectionMode && (
            <input
              type="checkbox"
              checked={selected}
              aria-label={`选择战役：${campaign.title}`}
              data-testid="campaign-select-checkbox"
              className="mt-[3px] h-3.5 w-3.5 shrink-0 cursor-pointer self-start accent-[#F0B90B] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70 dark:[color-scheme:dark]"
              onClick={event => event.stopPropagation()}
              onChange={() => onToggleSelection?.(campaign.id)}
            />
          )}
          {/* 状态圆点用实色（与左侧色条同一套），淡底色的圆点在浅色主题里几乎看不见 */}
          <span aria-hidden="true" data-testid="campaign-status-dot" className={`mt-[7px] inline-flex h-1.5 w-1.5 shrink-0 self-start rounded-full opacity-80 ${STATUS_ACCENT_STYLES[campaign.status] || 'bg-muted-foreground'}`} />
          {/* overflow-hidden 配合「操作时间」的 -ml-px：它换到行首时那条分隔线正好落在容器外被裁掉，不会顶着一条孤线。 */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 overflow-hidden">
            {/* 按「字母」排序时标题下面一道琥珀下划线：字母排序比的就是标题。 */}
            <h2
              data-sort-highlight={litAttr('alpha')}
              className={`mr-0.5 text-[13px] font-semibold leading-5 text-foreground ${byLevel('alpha', 'underline decoration-[#F0B90B]/70 decoration-2 underline-offset-[5px]', 'underline decoration-[#F0B90B]/35 decoration-2 underline-offset-[5px]', '')}`}
            >
              {campaign.title}
            </h2>
            <span className={`${CARD_CHIP} text-[10px] font-medium ${DIRECTION_STYLES[campaign.direction] || 'bg-muted text-muted-foreground'}`}>
              {campaign.direction === 'main_short' ? '主空' : '主多'}
            </span>
            <span className={`${CARD_CHIP} bg-muted text-[10px] font-medium text-muted-foreground`}>{campaign.symbol}</span>
            {/* 杠杆紧跟标的，与交易所的写法一致；取值与「杠杆倍数」排序同一个口径。 */}
            {cardLeverage > 0 && (
              <span
                data-testid="campaign-leverage"
                title={Number(campaign.initial_leverage) > 0
                  ? '杠杆倍数：主力开仓那一刻记录的初始杠杆'
                  : '杠杆倍数：这场战役没记初始杠杆，取各腿里最大的一档'}
                data-sort-highlight={litAttr('leverage')}
                className={`${CARD_CHIP} border font-mono text-[10px] tabular-nums ${byLevel('leverage', `border-[#F0B90B]/55 bg-[#F0B90B]/10 ${SORT_HIGHLIGHT_TEXT}`, `border-[#F0B90B]/30 bg-[#F0B90B]/[0.05] ${SORT_THEN_HIGHLIGHT_TEXT}`, 'border-border/70 text-muted-foreground')}`}
              >
                {formatLeverage(cardLeverage)}
              </span>
            )}
            {/* 「仓位击穿」紧跟杠杆：它说的是当时的仓位大小（与杠杆同一类信息），不进几何期望公式，
                放在几何期望格里会被读成那个数的一部分，还要为它把那一格撑宽。 */}
            {ruinousSizing && (
              <span
                data-testid="campaign-ruinous-sizing"
                title={`仓位击穿：本场下注比例 = ${riskFractionFormula} ≥ 100%，`
                  + '这一注押上了全部本金。它评判的是当时的仓位大小，不进几何期望公式，也与本场实际盈亏无关。'}
                className={`${CARD_CHIP} bg-[#F6465D]/15 text-[10px] font-medium ${TONE_DOWN}`}
              >
                仓位击穿
              </span>
            )}
            <span
              className={`${CARD_CHIP} border border-border/60 font-mono text-[9px] text-muted-foreground/70`}
              title={`战役编号 ${campaignDisplayCode}`}
            >
              {campaignDisplayCode}
            </span>
            {/* 分隔线之后的内容带 6px 内边距与圆角：按「操作时间」排序时只换底色，文字位置不变。 */}
            <span
              data-testid="campaign-operation-time"
              className="-ml-px inline-flex h-[18px] items-center border-l border-border/70 pl-0.5 text-[10px] leading-none"
            >
              <span
                data-sort-highlight={litAttr('time')}
                className={`inline-flex h-[18px] items-center gap-1 rounded-[3px] px-1.5 ${byLevel('time', `${SORT_HIGHLIGHT_BOX} ${SORT_HIGHLIGHT_TEXT}`, `${SORT_THEN_HIGHLIGHT_BOX} ${SORT_THEN_HIGHLIGHT_TEXT}`, 'text-muted-foreground/75')}`}
              >
                操作时间：
                <span className={`whitespace-nowrap font-mono text-[10px] tabular-nums ${byLevel('time', 'text-foreground/90', 'text-foreground/85', 'text-foreground/75')}`}>
                  {fmtOperationTime(operationTime)}
                </span>
              </span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1 self-end lg:self-auto" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            data-testid="campaign-details-toggle"
            aria-expanded={detailsExpanded}
            aria-label={detailsExpanded ? '收起战役详情' : '展开战役详情'}
            title={detailsExpanded ? '收起战役详情' : '展开战役详情'}
            onClick={(event) => onToggleDetails(event, campaign.id)}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-muted-foreground/50 transition-colors hover:border-border/80 hover:bg-background/65 hover:text-foreground"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${detailsExpanded ? 'rotate-180' : ''}`} />
          </button>
          {isOwnCampaign && (
            <div
              data-sort-highlight={litAttr('importance')}
              className={`flex h-7 items-center gap-0.5 rounded border px-1.5 transition-colors ${byLevel('importance', 'border-[#F0B90B]/55 bg-[#F0B90B]/[0.08]', 'border-[#F0B90B]/30 bg-[#F0B90B]/[0.04]', 'border-border/80 bg-background/50')}`}
            >
              <span className={`mr-0.5 text-[9px] ${byLevel('importance', `${SORT_HIGHLIGHT_TEXT} font-medium`, SORT_THEN_HIGHLIGHT_TEXT, 'text-muted-foreground/80')}`}>重要性</span>
              {[1, 2, 3, 4, 5].map(score => (
                <button
                  key={score}
                  type="button"
                  disabled={busy}
                  title={`设为 ${score} 分`}
                  onClick={(event) => onImportanceChange(event, campaign, score)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-[#F0B90B]/10 hover:text-[#F0B90B] disabled:opacity-50"
                >
                  <Star
                    className={`h-3 w-3 ${score <= importance ? 'text-[#F0B90B]' : ''}`}
                    fill={score <= importance ? 'currentColor' : 'none'}
                  />
                </button>
              ))}
            </div>
          )}
          {!isOwnCampaign && importance > 0 && (
            <span
              data-sort-highlight={litAttr('importance')}
              className={`rounded border px-2 py-1 text-[10px] ${byLevel('importance', `border-[#F0B90B]/55 bg-[#F0B90B]/[0.08] ${SORT_HIGHLIGHT_TEXT}`, `border-[#F0B90B]/30 bg-[#F0B90B]/[0.04] ${SORT_THEN_HIGHLIGHT_TEXT}`, 'border-border bg-background/60 text-muted-foreground')}`}
            >
              重要性 {importance}/5
            </span>
          )}
          {isOwnCampaign && (
            <button
              type="button"
              disabled={busy}
              title="删除战役"
              onClick={(event) => onDelete(event, campaign)}
              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border/80 bg-background/50 text-muted-foreground transition-colors hover:border-[#F6465D]/40 hover:bg-[#F6465D]/10 hover:text-[#F6465D] disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <div className={`inline-flex h-7 items-center rounded px-2.5 text-[10px] font-medium ${STATUS_STYLES[campaign.status] || 'bg-muted text-muted-foreground'}`}>
            {statusLabel}
          </div>
        </div>
      </div>

      {/* 封面指标行：左对齐、按当前列表的读数定宽（CARD_METRIC_STRIP / CARD_METRIC_WIDTH_CLASS），上标签、下数值；【用户要求】顺序与排序行一致：
          镜像止盈、预期回撤、涨跌幅、涨跌幅倍数、盈亏比、加仓效用、几何期望、算术期望。当前排序项高亮。 */}
      <div className={`border-t border-border/60 bg-muted/[0.12] dark:bg-muted/[0.16] ${CARD_METRIC_STRIP_INSET}`}>
        <dl
          data-testid="campaign-card-metrics"
          className={CARD_METRIC_STRIP}
        >
          <div className={metricCell('mirrorTp')} data-testid="campaign-mirror-tp-status" data-sort-highlight={litAttr('mirrorTp')}>
            <dt className={metricName('mirrorTp')}>{CARD_METRIC_LABEL.mirrorTp}</dt>
            <dd className={CARD_METRIC_VALUE_ROW}>
              <span className={`${CARD_METRIC_VALUE} ${mirrorTpStatus === MIRROR_TP_STATUS_LABEL.win ? TONE_UP : mirrorTpStatus === MIRROR_TP_STATUS_LABEL.loss ? TONE_DOWN : 'text-foreground/85'}`}>{mirrorTpStatus}</span>
            </dd>
          </div>
          <div className={metricCell('expectedDrawdownPct')} data-testid="campaign-expected-drawdown-pct" data-sort-highlight={litAttr('expectedDrawdownPct')}>
            <dt className={metricName('expectedDrawdownPct')}>{CARD_METRIC_LABEL.expectedDrawdownPct}</dt>
            <dd className={CARD_METRIC_VALUE_ROW}>
              <span className={`${CARD_METRIC_VALUE} text-foreground/85`}>
                {readings.expectedDrawdownPct}
              </span>
            </dd>
          </div>
          {/* 涨跌幅 → 涨跌幅倍数：倍数就是「涨跌幅 ÷ 预期回撤」，紧跟预期回撤读得出来。 */}
          <div
            data-testid="campaign-main-price-change"
            title={mainPriceChangePct == null
              ? '涨跌幅：主力都还没平仓（没有平仓价），显示「—」'
              : '涨跌幅：按主力方向计（空单价格跌了为正）。开仓价取主力最有利的一笔；主力平仓时有对冲锁住行情就按对冲的开仓价，否则按主力的平仓价。公式见排序栏「涨跌幅」的说明'}
            className={metricCell('mainPriceChange')}
            data-sort-highlight={litAttr('mainPriceChange')}
          >
            <dt className={metricName('mainPriceChange')}>{CARD_METRIC_LABEL.mainPriceChange}</dt>
            <dd className={CARD_METRIC_VALUE_ROW}>
              <span data-testid="campaign-main-price-change-value" className={`${CARD_METRIC_VALUE} ${MAIN_PRICE_CHANGE_TONE[mainPriceChangePct == null ? 'flat' : signedTone(mainPriceChangePct)]}`}>
                {readings.mainPriceChange}
              </span>
            </dd>
          </div>
          <div
            data-testid="campaign-main-price-efficiency"
            title={mainPriceEfficiency == null
              ? '涨跌幅倍数 = 主力涨跌幅 ÷ 预期回撤：主力未平仓或算不出预期回撤时不算'
              : `涨跌幅倍数 = 主力涨跌幅 ${formatLegPriceChangePct(mainPriceChangePct)} ÷ 预期回撤 ${initialExpectedMaxDrawdownPct.toFixed(2)}% = ${formatMainPriceEfficiency(mainPriceEfficiency)}：价格走出了几个「预期回撤」`}
            className={metricCell('mainPriceEfficiency')}
            data-sort-highlight={litAttr('mainPriceEfficiency')}
          >
            <dt className={metricName('mainPriceEfficiency')}>{CARD_METRIC_LABEL.mainPriceEfficiency}</dt>
            <dd className={CARD_METRIC_VALUE_ROW}>
              <span data-testid="campaign-main-price-efficiency-value" className={`${CARD_METRIC_VALUE} ${MAIN_PRICE_CHANGE_TONE[mainPriceEfficiency == null ? 'flat' : signedTone(mainPriceEfficiency)]}`}>
                {readings.mainPriceEfficiency}
              </span>
            </dd>
          </div>
          <div className={metricCell('captureRate')} data-testid="campaign-payoff-ratio" data-sort-highlight={litAttr('captureRate')}>
            <dt className={metricName('captureRate')}>{CARD_METRIC_LABEL.captureRate}</dt>
            <dd className={CARD_METRIC_VALUE_ROW}>
              <span
                data-testid="campaign-payoff-ratio-value"
                title={profitCaptureRatio == null ? undefined : `盈亏比 b = 已实现 P&L ÷ 最大预期亏损 = ${readings.captureRate}`}
                className={`${CARD_METRIC_VALUE} ${payoffRatioTone}`}
              >
                {readings.captureRate}
              </span>
            </dd>
          </div>
          {/* 加仓效用紧跟盈亏比：它就是盈亏比 ÷ 涨跌幅倍数。 */}
          <div
            data-testid="campaign-add-efficiency"
            title={addEfficiency == null || mainPriceEfficiency == null
              ? (campaignHasMainAdd(legs)
                ? '加仓效用 = 盈亏比 ÷ 涨跌幅倍数：只在涨跌幅倍数为正时计算，这场涨跌幅倍数不为正或算不出（或算不出盈亏比）'
                : '加仓效用：这场战役没有加仓，不计算')
                : `加仓效用 = 盈亏比 ${readings.captureRate} ÷ 涨跌幅倍数 ${formatMainPriceEfficiency(mainPriceEfficiency)} = ${formatMainPriceEfficiency(addEfficiency)}；大于 1 说明加仓把同一段行情放大成了更多的 R，小于 1 说明加仓 / 对冲 / 止盈吃掉了行情`}
            className={metricCell('addEfficiency')}
            data-sort-highlight={litAttr('addEfficiency')}
          >
            <dt className={metricName('addEfficiency')}>{CARD_METRIC_LABEL.addEfficiency}</dt>
            <dd className={CARD_METRIC_VALUE_ROW}>
              <span data-testid="campaign-add-efficiency-value" className={`${CARD_METRIC_VALUE} ${MAIN_PRICE_CHANGE_TONE[addEfficiency == null ? 'flat' : signedTone(addEfficiency)]}`}>
                {readings.addEfficiency}
              </span>
            </dd>
          </div>
          <div
            data-testid="campaign-geometric-expectancy"
            data-ruinous-sizing={ruinousSizing ? 'true' : undefined}
            title={`单场几何期望 = Gᵢ − 1，Gᵢ = 1 + bᵢ·x，x 每场统一取 ${fixedFractionLabel}`
              + (initialRiskFraction == null
                ? ''
                : ruinousSizing
                  ? `。另：本场真实下注比例 = ${riskFractionFormula} ≥ 100%，`
                    + '这一注押上了全部本金（标题行的「仓位击穿」）。它评判的是当时的仓位大小，不进上面这个公式，也与本场实际盈亏无关。'
                    + `注意卡片左侧的「预期回撤 ${initialExpectedMaxDrawdownPct.toFixed(2)}%」是价格层面的口径（主力入场到对冲边界的距离），与账户层面的下注比例不是同一个量。`
                  : '')}
            className={metricCell('geometricExpectancy')}
            data-sort-highlight={litAttr('geometricExpectancy')}
          >
            <dt className={metricName('geometricExpectancy')}>{CARD_METRIC_LABEL.geometricExpectancy}</dt>
            <dd className={CARD_METRIC_VALUE_ROW}>
              <span className={`${CARD_METRIC_VALUE} ${geometricTone}`}>{readings.geometricExpectancy}</span>
            </dd>
          </div>
          <div
            data-testid="campaign-arithmetic-expectancy"
            title="Eᵢ = 50% × 该战役盈亏比 − 50%（胜率统一取 50%）"
            className={metricCell('arithmeticExpectancy')}
            data-sort-highlight={litAttr('arithmeticExpectancy')}
          >
            <dt className={metricName('arithmeticExpectancy')}>{CARD_METRIC_LABEL.arithmeticExpectancy}</dt>
            <dd className={CARD_METRIC_VALUE_ROW}>
              <span className={`${CARD_METRIC_VALUE} ${arithmeticTone}`}>{readings.arithmeticExpectancy}</span>
            </dd>
          </div>
        </dl>
      </div>

      {detailsExpanded && (
        // 展开的详情只是一串「名称：值」，不按列排：画分隔线会与上方指标行的列线错开，所以只用间距分组。
        <dl
          data-testid="campaign-card-details"
          className={`flex flex-wrap items-center gap-x-6 gap-y-0.5 border-t border-border/50 bg-background/40 py-1 ${CAMPAIGN_COLUMNS_INSET}`}
        >
          <div className={CARD_DETAIL_ITEM}>
            <dt className={CARD_DETAIL_LABEL}>战役时间：</dt>
            <dd className={`${CARD_DETAIL_VALUE} text-foreground/80`}>
              {fmtTime(campaign.opened_at)} → {fmtTime(campaign.closed_at)}
            </dd>
          </div>
          <div className={CARD_DETAIL_ITEM}>
            <dt className={CARD_DETAIL_LABEL}>结构与时长：</dt>
            <dd className={`${CARD_DETAIL_VALUE} text-foreground/80`}>
              {legs.length} legs · {durationLabel(campaign.opened_at, campaign.closed_at)}
            </dd>
          </div>
          <div className={CARD_DETAIL_ITEM}>
            <dt className={CARD_DETAIL_LABEL}>已实现 P&amp;L：</dt>
            <dd className={`${CARD_DETAIL_VALUE} ${realizedPnlTone}`}>
              {realizedPnl == null ? '—' : realizedPnl.toFixed(2)}
            </dd>
          </div>
          <div className="flex min-h-7 min-w-0 items-center gap-1.5">
            <dt className={`inline-flex items-center gap-1 ${CARD_DETAIL_LABEL}`}>
              <Layers className="h-3 w-3" />
              Legs：
            </dt>
            <dd className="flex min-h-5 flex-wrap items-center gap-1">
              {legs.length === 0 ? (
                <span className="text-[10px] text-muted-foreground">暂无 legs</span>
              ) : (
                legs.map((leg: TradeJournal) => (
                  <span
                    key={leg.id}
                    title={leg.leg_role ? LEG_ROLE_LABELS[leg.leg_role] : '未归类'}
                    className={`rounded px-1.5 py-0.5 text-[9px] ${leg.leg_role ? LEG_CHIP_CLASS[leg.leg_role] : 'bg-muted text-muted-foreground'}`}
                  >
                    {leg.leg_role ? LEG_ABBR[leg.leg_role] : '?'}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
});

export default function JournalCampaignsPage() {
  const nav = useNavigate();
  const location = useLocation();
  const initialSortChain = useMemo(() => parseCampaignSortChain(location.search), [location.search]);
  const { user, profile } = useAuth();
  // 只认 id：auth 每次刷新 token 都会换一个 user 对象，不能让它牵动取数与回调。
  const userId = user?.id;
  const campaignAccountName = useMemo(
    () => resolveCampaignAccountName({
      displayName: profile?.display_name,
      email: user?.email,
      userId: user?.id,
    }),
    [profile?.display_name, user?.email, user?.id],
  );
  const { balance, positionsMap, priceMap, getEffectiveTime, tradeHistory, ordersMap, filledOrders } = useTradingContext();
  const currentAccountEquity = useMemo(
    () => computeCurrentAccountEquity(balance, positionsMap, priceMap),
    [balance, positionsMap, priceMap],
  );
  const {
    rows, setRows, complete: campaignRowsComplete, refreshing, loaded, total,
    error: campaignLoadError, failedCount, retry: retryCampaignLoad, beginMutation,
  } = useCampaignList(user?.id, { tradeHistory, ordersMap, filledOrders, positionsMap });
  const loading = !campaignRowsComplete && !campaignLoadError && rows.length === 0;
  const campaignLoadProgress = { loaded, total };
  const [busyCampaignId, setBusyCampaignIdState] = useState<string | null>(null);
  // 回调只从 ref 读「正在忙的那一场」：不把它列进依赖，点一次星不会换掉 237 张卡片的回调引用
  const busyCampaignIdRef = useRef<string | null>(null);
  const setBusyCampaignId = useCallback((id: string | null) => {
    busyCampaignIdRef.current = id;
    setBusyCampaignIdState(id);
  }, []);
  /** 排序链（第一级就是原来的 mode / direction）；只有一级时一切与原来的单级排序相同。 */
  const [sortChain, setSortChain] = useState<CampaignSortChain>(initialSortChain);
  /** 第一级：决定哪些战役进列表、空列表提示按它说。 */
  const primarySort = sortChain[0];
  /** 卡片按引用 memo：链不变，数组引用就不变。 */
  const sortHighlight = useMemo(() => sortChain.map(level => level.mode), [sortChain]);
  // 默认全选：进页面先看全部战役，要比较某一段日子再自己框。
  const [operationRange, setOperationRange] = useState<CampaignOperationRange>(
    () => parseCampaignRangeParams(location.search),
  );
  const [formulaPopover, setFormulaPopover] = useState<CampaignFormulaPopover | null>(null);
  const initialChartState = useMemo(
    () => parseCampaignChartParams(location.search),
    // 只取首帧快照：后续 URL 变化由下方 effect 同步，避免每次 search 变动都重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [metricChartOpen, setMetricChartOpen] = useState(initialChartState.open);
  const [metricChartKey, setMetricChartKey] = useState<CampaignMetricChartKey>(initialChartState.key);
  const metricChartPanelRef = useRef<HTMLDivElement | null>(null);
  const [deletedOpen, setDeletedOpen] = useState(false);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedCampaigns, setDeletedCampaigns] = useState<TradeCampaign[]>([]);
  const [deletedBusyId, setDeletedBusyId] = useState<string | null>(null);
  const [expandedCampaignIds, setExpandedCampaignIds] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<ReadonlySet<string>>(() => new Set());
  const [selectFirstCount, setSelectFirstCount] = useState('10');
  const [exportTargets, setExportTargets] = useState<CampaignExportTarget[] | null>(null);
  const toggleExportSelection = useCallback((id: string) => setSelectedCampaignIds(current => toggleCampaignSelection(current, id)), []);
  useEffect(() => {
    setSelectionMode(false); setSelectedCampaignIds(new Set()); setExportTargets(null);
  }, [userId]);
  const batchToggleRef = useRef<HTMLButtonElement | null>(null);
  const selectionBarRef = useRef<HTMLDivElement | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  /** 退出选择模式后要聚焦的元素（在列表按退出后的状态重渲染之后取）。 */
  const exitFocusRef = useRef<(() => HTMLElement | null | undefined) | null>(null);
  /**
   * 退出选择模式（Esc、底部浮条上的「退出选择」）。焦点原先在选择条或浮条里时，它们随即卸载，焦点会掉到 <body>：
   * 改交给「批量下载」开关；焦点原先在卡片勾选框上时，交给同一张卡片的「展开详情」，键盘位置不跳走。
   * preventScroll：从很下面的浮条退出时，焦点回到页顶的开关不该把页面拽回去。
   */
  const exitSelectionMode = useCallback(() => {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fromToolbar = Boolean(active && (selectionBarRef.current?.contains(active) || dockRef.current?.contains(active)));
    const card = !fromToolbar && active?.matches('[data-testid="campaign-select-checkbox"]')
      ? active.closest('[data-testid="campaign-card"]')
      : null;
    exitFocusRef.current = fromToolbar
      ? () => batchToggleRef.current
      : card
        ? () => card.querySelector<HTMLElement>('[data-testid="campaign-details-toggle"]')
        : null;
    setSelectionMode(false);
  }, []);
  useEffect(() => {
    if (selectionMode) return;
    const pick = exitFocusRef.current;
    exitFocusRef.current = null;
    const target = pick?.();
    if (target?.isConnected) target.focus({ preventScroll: true });
  }, [selectionMode]);
  // 选择模式下按 Esc 退出（已选保留）；弹窗、浮层或正在打字的输入框自己要用 Esc 时不抢。
  // 勾选框、单选框不算「打字」：刚勾完一张卡片焦点就停在勾选框上，这时 Esc 也要能退出。
  useEffect(() => {
    if (!selectionMode || exportTargets) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      if (target?.closest('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [role="dialog"], [data-radix-popper-content-wrapper]')) return;
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      exitSelectionMode();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectionMode, exportTargets, exitSelectionMode]);
  const barExportButtonRef = useRef<HTMLButtonElement | null>(null);
  const dockExportButtonRef = useRef<HTMLButtonElement | null>(null);
  /** 打开批量下载弹窗的是哪一个「下载选中」（选择条上的 / 底部浮条上的）：关弹窗后焦点还给它。 */
  const exportOpenerRef = useRef<'bar' | 'dock'>('bar');
  /** 这次关弹窗时整批都已下载、退出了选择模式：焦点交给「批量下载」开关。 */
  const exportFinishedRef = useRef(false);
  const handleExportDialogClose = useCallback(({ allDownloaded }: { allDownloaded: boolean }) => {
    exportFinishedRef.current = allDownloaded;
    setExportTargets(null);
    // 整批都已下载：任务完成，退回普通浏览（已选保留，再次进入可以接着用）；还有失败或没下载的就留在选择模式。
    if (allDownloaded) setSelectionMode(false);
  }, []);
  /**
   * 弹窗卸载后（Radix 的 onCloseAutoFocus，此时列表已按关窗后的状态重渲染）把键盘焦点还回来：
   * 整批下载完、退出了选择模式 → 「批量下载」开关；否则 → 打开它的那个「下载选中」，浮条收起了就退到选择条上的那个。
   * preventScroll：从底部浮条打开时页面可能翻在很下面，焦点回到页顶的开关不该把页面拽回去。
   */
  const returnFocusAfterExport = useCallback(() => {
    const order = exportFinishedRef.current
      ? [batchToggleRef, barExportButtonRef]
      : exportOpenerRef.current === 'dock'
        ? [dockExportButtonRef, barExportButtonRef, batchToggleRef]
        : [barExportButtonRef, dockExportButtonRef, batchToggleRef];
    order.map(ref => ref.current).find(node => node?.isConnected && !node.disabled)?.focus({ preventScroll: true });
  }, []);
  /** 窄屏：选择条不进吸顶区（见 renderBatchSelectionBar）。 */
  const narrowViewport = useIsMobile();
  const stickyControlsRef = useRef<HTMLDivElement | null>(null);
  const [stickyControlsHeight, setStickyControlsHeight] = useState(0);
  useEffect(() => {
    const node = stickyControlsRef.current;
    if (!selectionMode || !narrowViewport || !node) {
      setStickyControlsHeight(0);
      return;
    }
    const update = () => setStickyControlsHeight(Math.round(node.getBoundingClientRect().height));
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [selectionMode, narrowViewport]);
  // 宽屏上选择条在吸顶区里，吸顶区只在列表上半段（统计与散点图那一节）吸顶；往下翻卡片时它会滚出视野。
  // 窄屏上它本来就跟着页面滚。滚出视野后在屏幕底部浮出一条精简的「已选 N 场 · 下载选中」，勾到哪都能直接下载，不必翻回顶部。
  const [selectionBarInView, setSelectionBarInView] = useState(true);
  useEffect(() => {
    const node = selectionBarRef.current;
    if (!selectionMode || !node || typeof IntersectionObserver === 'undefined') {
      setSelectionBarInView(true);
      return;
    }
    // 顶部让出吸顶页眉的 57px（窄屏上再让出吸顶的统计与排序区：选择条滚到它底下也算看不见）。
    // 选择条要几乎整条露着才算「在视野里」：只看是否相交（露 1px 也算）时，窄屏上它滑到吸顶区底下的那一段，
    // 「下载选中」已被盖掉一截、浮条却还没出来；这里只要被盖住一点，浮条就接手。
    const top = 57 + (narrowViewport ? stickyControlsHeight : 0);
    const observer = new IntersectionObserver(
      ([entry]) => setSelectionBarInView(entry.isIntersecting && entry.intersectionRatio >= 0.99),
      { rootMargin: `-${top}px 0px 0px 0px`, threshold: [0, 0.99, 1] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [selectionMode, narrowViewport, stickyControlsHeight]);
  const handleExportDialogLoadError = useCallback((error: Error) => {
    setExportTargets(null);
    toast.error('批量下载没能打开，请刷新页面后重试', { description: error.message });
  }, []);
  const [bulkCloseOpen, setBulkCloseOpen] = useState(false);
  const [bulkClosing, setBulkClosing] = useState(false);
  const [includeUnsettled, setIncludeUnsettled] = useState(false);
  // 失败常驻在对话框里，不是右上角停两秒半的 toast。
  // 一次批量操作失败时用户的视线正落在对话框上——把原因摆在他正在看的地方，
  // 而且是**每一场**的原因，不是只报第一条。
  const [bulkFailures, setBulkFailures] = useState<string[]>([]);
  const [bulkWarnings, setBulkWarnings] = useState<string[]>([]);

  useEffect(() => {
    const next = parseCampaignSortChain(location.search);
    setSortChain(current => (sortChainKey(current) === sortChainKey(next) ? current : next));
    const nextRange = parseCampaignRangeParams(location.search);
    setOperationRange(current => (
      current.from === nextRange.from && current.to === nextRange.to ? current : nextRange
    ));
    // 浏览器前进 / 后退（含详情页返回）时，让散点图跟随 URL 恢复。
    const nextChart = parseCampaignChartParams(location.search);
    setMetricChartOpen(nextChart.open);
    if (nextChart.open) setMetricChartKey(nextChart.key);
    const params = new URLSearchParams(location.search);
    if (!params.has('scope')) return;
    params.delete('scope');
    const search = params.toString();
    nav({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [location.pathname, location.search, nav]);


  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    listDeletedCampaigns(userId)
      .then(campaigns => {
        if (!cancelled) setDeletedCampaigns(campaigns);
      })
      .catch(() => {
        if (!cancelled) setDeletedCampaigns([]);
      });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (loading) return;
    const storageKey = `${CAMPAIGN_LIST_SCROLL_KEY_PREFIX}${location.key}`;
    const savedScroll = Number(sessionStorage.getItem(storageKey));
    if (!Number.isFinite(savedScroll) || savedScroll < 0) return;
    sessionStorage.removeItem(storageKey);
    if (savedScroll === 0) return;
    const frame = window.requestAnimationFrame(() => window.scrollTo({ top: savedScroll }));
    return () => window.cancelAnimationFrame(frame);
  }, [loading, location.key]);

  /**
   * 所选操作时间段内的战役。统计、卡片、散点图全部读它，**只有**批量操作读原始 rows——
   * 一次「结束全部进行中战役」若被日期筛选悄悄漏掉几场，那是会写进库的错。
   *
   * 全选时返回同一个数组引用，不产生新对象：默认路径下所有下游 memo 一次都不会白算。
   */
  const scopedRows = useMemo(() => {
    if (isAllRange(operationRange)) return rows;
    return rows.filter(row => isWithinOperationRange(
      campaignOperationTime(row.legs, row.tradeRecords),
      operationRange,
    ));
  }, [rows, operationRange]);
  useEffect(() => {
    if (campaignRowsComplete) setSelectedCampaignIds(current => retainCampaignSelection(current, new Set(scopedRows.map(row => row.campaign.id))));
  }, [scopedRows, campaignRowsComplete]);
  /** 因为没有客观操作时间而被时间段挡在外面的场数——不声不响地少几场是不能接受的。 */
  const undatedExcludedCount = useMemo(() => {
    if (isAllRange(operationRange)) return 0;
    return rows.filter(row => campaignOperationTime(row.legs, row.tradeRecords) == null).length;
  }, [rows, operationRange]);

  const activeCount = useMemo(
    () => rows.filter((row: CampaignCardData) => row.campaign.status === 'active').length,
    [rows],
  );

  /**
   * 「如果现在把进行中的战役全部结束，会发生什么」——确认框读它，写库也读它。
   * 只收自己的战役：别人分享过来的行同样会显示在列表里，但不该被这里写掉。
   */
  const bulkClosePlan = useMemo(() => {
    const candidates = rows
      .filter(row => row.campaign.status === 'active' && row.campaign.user_id === user?.id)
      .map(row => ({ campaign: row.campaign, legs: row.legs, settlement: row.settlement }));
    // 兜底时钟：模拟时间尚未启动过时是 0，直接拿去当时间戳会盖出 1970 年。
    const clock = getEffectiveTime();
    return planBulkCampaignClose(candidates, clock > 0 ? clock : Date.now());
  }, [rows, user?.id, getEffectiveTime]);

  const settledPlan = useMemo(
    () => bulkClosePlan.filter(item => item.verdict.kind === 'settled'),
    [bulkClosePlan],
  );
  const unsettledPlan = useMemo(
    () => bulkClosePlan.filter(item => item.verdict.kind === 'unsettled'),
    [bulkClosePlan],
  );
  const bulkCloseTargets = includeUnsettled ? bulkClosePlan : settledPlan;

  // 卡片按引用 memo：回调不依赖 rows / 正在忙的那一场（都走函数式更新与 ref），整个会话里引用不换。
  const handleImportanceChange = useCallback(async (
    event: MouseEvent<HTMLButtonElement>,
    campaign: TradeCampaign,
    weight: number,
  ) => {
    event.stopPropagation();
    if (!userId || campaign.user_id !== userId || busyCampaignIdRef.current === campaign.id) return;

    const previousWeight = importanceValue(campaign);
    const nextWeight = previousWeight === weight ? 0 : weight;
    const setWeight = (value: number) => setRows(prev => prev.map(row => (
      row.campaign.id === campaign.id
        ? { ...row, campaign: { ...row.campaign, importance_weight: value } }
        : row
    )));
    const finishMutation = beginMutation();
    setBusyCampaignId(campaign.id);
    setWeight(nextWeight);

    try {
      // 等后台正在跑的那一场自愈落地再写（见 waitForCampaignListHeal，最多等 2 s）；乐观更新已经画上了
      await waitForCampaignListHeal();
      await updateCampaignImportance(campaign.id, nextWeight);
      toast.success(nextWeight > 0 ? `重要性已设为 ${nextWeight}` : '已清除重要性评分');
    } catch (error) {
      // 只把这一场的评分退回去，不整表回滚：期间别的行可能已经被后台核对更新过
      setWeight(previousWeight);
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyCampaignId(null);
      finishMutation();
    }
  }, [userId, beginMutation, setRows, setBusyCampaignId]);

  const performanceSamples = useMemo(
    () => scopedRows.map(row => ({
      campaign: row.campaign,
      payoffRatio: row.profitCaptureRatio == null ? null : row.profitCaptureRatio / 100,
    })),
    [scopedRows],
  );
  const performance = useMemo(
    () => summarizeCampaignPerformance(performanceSamples),
    [performanceSamples],
  );
  const asymmetricRisk = useMemo(
    () => summarizeAsymmetricRiskMetrics(performanceSamples),
    [performanceSamples],
  );
  /**
   * 实测连乘 ∏(1+bᵢ·x)：每场按固定 10% 下注，这条真实路径把本金走成了几倍。
   * 与 W = G^n 同一口径下的两个问题——那个是按均值推演，这个是照真实 bᵢ 逐场走。
   * 取样population 与「有效战役 / 平均盈亏比」完全一致，n 才对得上。
   */
  const realizedGrowth = useMemo(
    () => realizedCompoundGrowth(
      selectValidCampaignPerformanceSamples(performanceSamples)
        .map(sample => sample.payoffRatio as number),
    ),
    [performanceSamples],
  );
  /**
   * 全表几何期望：G = (1+b·x)^p·(1−x)^(1−p)，x 固定 10%、b 取盈利战役的平均 b、p 取有效战役胜率。
   * b 只用盈利侧：公式里 (1+b·x) 是「赢的那一腿乘多少」，混进亏损战役的负 b 会同时压低赢腿，
   * 而亏损已经由 (1−x)^(1−p) 这一腿表达了，等于罚两次。
   */
  const geometric = useMemo(
    () => computeGeometricExpectancy(performance.expectedWinRate, performance.winPayoffRatio, FIXED_DRAWDOWN_FRACTION),
    [performance.expectedWinRate, performance.winPayoffRatio],
  );
  // 镜像止盈达成统计（战役维度，全表口径）。
  const mirrorTp = useMemo(
    () => summarizeMirrorTp(scopedRows.map(row => ({
      achieved: campaignAchievedMirrorTp(row.legs, row.tradeRecords),
      payoffRatio: rowPayoffRatio(row),
      realizedPnl: row.campaign.final_realized_pnl ?? null,
    }))),
    [scopedRows],
  );
  const mirrorTpRateLabel = mirrorTp.achievedRatePct == null ? '—' : `${mirrorTp.achievedRatePct.toFixed(0)}%`;
  const mirrorTpNotAchievedRateLabel = mirrorTp.notAchievedRatePct == null ? '—' : `${mirrorTp.notAchievedRatePct.toFixed(0)}%`;
  const mirrorTpWinRateLabel = mirrorTp.achievedWinRatePct == null ? '—' : `${mirrorTp.achievedWinRatePct.toFixed(0)}%`;
  /**
   * 期望与不对称风险贡献都依赖全表统计（胜率、DSI/USI 汇总），一场变了整表都要重算——
   * 但重算出的四个数与上次相同的行沿用上一个对象（整表都没变就沿用同一个数组）：
   * 卡片与散点图的 memo 按引用判，一场成交变化只重画那一张卡片、一次散点图。
   */
  const metricRowsRef = useRef<{ byRow: Map<CampaignCardData, CampaignMetricData>; rows: CampaignMetricData[] }>({
    byRow: new Map(), rows: [],
  });
  const metricRows = useMemo<CampaignMetricData[]>(() => {
    const previous = metricRowsRef.current;
    const byRow = new Map<CampaignCardData, CampaignMetricData>();
    const rows = scopedRows.map(row => {
      const next: CampaignMetricData = {
        ...row,
        // 单场算术期望的胜率统一取 50%（与详情页同一个函数），不随账户实时胜率变动
        ...computeCampaignExpectancies(row.profitCaptureRatio),
        ...computeAsymmetricRiskContributionRates({
          campaign: row.campaign,
          payoffRatio: row.profitCaptureRatio == null ? null : row.profitCaptureRatio / 100,
        }, asymmetricRisk),
      };
      const before = previous.byRow.get(row);
      const kept = before
        && Object.is(before.arithmeticExpectancy, next.arithmeticExpectancy)
        && Object.is(before.geometricExpectancy, next.geometricExpectancy)
        && Object.is(before.dsiContributionPct, next.dsiContributionPct)
        && Object.is(before.usiContributionPct, next.usiContributionPct)
        ? before
        : next;
      byRow.set(row, kept);
      return kept;
    });
    const unchanged = rows.length === previous.rows.length && rows.every((row, index) => row === previous.rows[index]);
    metricRowsRef.current = { byRow, rows: unchanged ? previous.rows : rows };
    return metricRowsRef.current.rows;
  }, [scopedRows, asymmetricRisk]);
  /**
   * 账户权益随行情每个 tick 变，但只有没记开仓权益快照的场次才拿它兜底。
   * 解析出的三个数与上次相同就沿用上一个行对象（整表都没变就沿用同一个数组）：
   * 卡片按引用 memo，行情 tick 一张都不重画。
   */
  const displayRowsRef = useRef<{ byRow: Map<CampaignMetricData, CampaignDisplayData>; rows: CampaignDisplayData[] }>({
    byRow: new Map(), rows: [],
  });
  const displayRows = useMemo<CampaignDisplayData[]>(() => {
    const previous = displayRowsRef.current;
    const byRow = new Map<CampaignMetricData, CampaignDisplayData>();
    const rows = metricRows.map(row => {
      const initialRisk = resolveCampaignInitialRiskFraction(
        row.initialExpectedMaxLoss,
        row.legs,
        row.campaign.user_id === userId ? currentAccountEquity : null,
      );
      const display: CampaignDisplayData = {
        ...row,
        initialRiskFraction: initialRisk?.drawdownFraction ?? null,
        initialRiskSource: initialRisk?.source ?? null,
        riskAccountEquity: initialRisk?.accountEquityAtMainOpen ?? null,
      };
      const before = previous.byRow.get(row);
      const kept = before
        && Object.is(before.initialRiskFraction, display.initialRiskFraction)
        && before.initialRiskSource === display.initialRiskSource
        && Object.is(before.riskAccountEquity, display.riskAccountEquity)
        ? before
        : display;
      byRow.set(row, kept);
      return kept;
    });
    const unchanged = rows.length === previous.rows.length && rows.every((row, index) => row === previous.rows[index]);
    displayRowsRef.current = { byRow, rows: unchanged ? previous.rows : rows };
    return displayRowsRef.current.rows;
  }, [metricRows, currentAccountEquity, userId]);
  const sortedRows = useMemo(
    () => sortCampaignRows(displayRows, sortChain),
    [displayRows, sortChain],
  );
  /**
   * 封面指标行的列宽：按当前时间段里的全部战役（displayRows）实际出现的读数定，见 cardMetricWidthStyle。
   * 不读 sortedRows：排序会筛掉算不出这一项的战役，按它算的话切换排序会让后面各格整体左右挪动。
   * 首次加载时战役分批到达，新到的一场读数更宽，这一列就跟着放宽；加载完就定下来。
   */
  const cardMetricWidths = useMemo(() => cardMetricWidthStyle(displayRows), [displayRows]);
  const metricSeriesByKey = useMemo<Record<CampaignMetricChartKey, CampaignMetricSeries>>(() => {
    const samples = metricRows.map(row => ({
      row,
      campaignId: row.campaign.id,
      title: row.campaign.title,
      symbol: row.campaign.symbol,
      operationTime: campaignOperationTime(row.legs, row.tradeRecords),
      pnl: row.campaign.final_realized_pnl ?? null,
      payoffRatio: rowPayoffRatio(row),
    }));
    const buildSeries = (valueForRow: (row: typeof metricRows[number]) => number | null) => (
      buildCampaignMetricSeries(samples.map(({ row, ...sample }) => ({
        ...sample,
        value: valueForRow(row),
      })))
    );

    // 分布图与时序图是同一份序列的两种读法，只建一次、共用同一个对象。
    const odds = buildSeries(row => (
      row.profitCaptureRatio == null ? null : row.profitCaptureRatio / 100
    ));
    const mirrorTp = buildSeries(row => rowMirrorTpRank(row));
    const geometric = buildSeries(row => row.geometricExpectancy);
    const arithmetic = buildSeries(row => row.arithmeticExpectancy);
    // 与卡片、排序同一组函数：算不出的战役（主力未平仓、没有预期回撤、没有加仓）不进图
    const mainPriceChange = buildSeries(row => (
      row.mainPriceChangePct != null && Number.isFinite(row.mainPriceChangePct) ? row.mainPriceChangePct : null
    ));
    const mainPriceEfficiency = buildSeries(row => rowMainPriceEfficiency(row));
    const addEfficiency = buildSeries(row => rowAddEfficiency(row));
    return {
      odds,
      oddsDistribution: odds,
      expectedDrawdownPct: buildSeries(row => (
        Number.isFinite(row.initialExpectedMaxDrawdownPct) && row.initialExpectedMaxDrawdownPct > 0
          ? row.initialExpectedMaxDrawdownPct
          : null
      )),
      arithmeticExpectancy: arithmetic,
      arithmeticExpectancyDistribution: arithmetic,
      geometricExpectancy: geometric,
      // 分布图与时序图是同一份序列的两种读法，只建一次、共用同一个对象。
      geometricExpectancyDistribution: geometric,
      importance: buildSeries(row => importanceValue(row.campaign)),
      mirrorTp: mirrorTp,
      // 柱状图与时序图读的是同一份镜像止盈序列，只是横轴换成了结果档位。
      mirrorTpBars: mirrorTp,
      dsiContribution: buildSeries(row => row.dsiContributionPct),
      usiContribution: buildSeries(row => row.usiContributionPct),
      // 涨跌幅三项与算术期望同理：分布图与时序图共用同一份序列。
      mainPriceChange,
      mainPriceChangeDistribution: mainPriceChange,
      mainPriceEfficiency,
      mainPriceEfficiencyDistribution: mainPriceEfficiency,
      addEfficiency,
      addEfficiencyDistribution: addEfficiency,
    };
  }, [metricRows]);
  const selectedMetricConfig = CAMPAIGN_METRIC_CHART_CONFIGS.find(
    config => config.key === metricChartKey,
  ) ?? CAMPAIGN_METRIC_CHART_CONFIGS[0];
  const selectedMetricSeries = metricSeriesByKey[metricChartKey];
  const selectedExportTargets = useMemo(() => orderedCampaignExportTargets(
    selectedCampaignIds, sortedRows.map(row => row.campaign), scopedRows.map(row => row.campaign),
  ), [selectedCampaignIds, sortedRows, scopedRows]);
  const selectedOutsideList = selectedExportTargets.length - sortedRows.filter(row => selectedCampaignIds.has(row.campaign.id)).length;
  const openExportDialog = (opener: 'bar' | 'dock') => {
    exportOpenerRef.current = opener;
    exportFinishedRef.current = false;
    setExportTargets(selectedExportTargets);
  };
  const selectFirstNumber = Number(selectFirstCount);
  const selectFirstValid = Number.isInteger(selectFirstNumber) && selectFirstNumber >= 1;
  // 「当前打开的是哪份数据」：分布图打开时，盈亏比的排序行按钮也要读成「收起」。
  const openSourceKey: CampaignMetricChartKey = selectedMetricConfig.sourceKey ?? selectedMetricConfig.key;
  /** 同一指标的几种看法（时序 / 分布 / 柱状）；只有一种时不画切换键。 */
  const familyViewOptions = useMemo(
    () => CAMPAIGN_METRIC_CHART_CONFIGS.filter(
      config => (config.sourceKey ?? config.key) === openSourceKey && config.viewLabel,
    ),
    [openSourceKey],
  );
  const familySourceLabel = CAMPAIGN_METRIC_CHART_CONFIGS
    .find(config => config.key === openSourceKey)?.label ?? selectedMetricConfig.label;
  const updateChartParam = useCallback((nextKey: CampaignMetricChartKey | null) => {
    const params = new URLSearchParams(location.search);
    params.delete('scope');
    if (nextKey) params.set('chart', nextKey);
    else params.delete('chart');
    const search = params.toString();
    nav({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  }, [location.pathname, location.search, nav]);
  const handleChartBack = useCallback(() => {
    setMetricChartOpen(false);
    updateChartParam(null);
  }, [updateChartParam]);

  const handleMetricChartToggle = (key: CampaignMetricChartKey) => {
    if (metricSeriesByKey[key].points.length === 0) return;
    if (metricChartOpen && openSourceKey === key) {
      setMetricChartOpen(false);
      updateChartParam(null);
      return;
    }
    // 排序行按钮传的是族键；真正打开的是这一族的默认视图（盈亏比 → 分布，镜像止盈 → 柱状）。
    const openKey = DEFAULT_CHART_VIEW_BY_SOURCE[key] ?? key;
    setMetricChartKey(openKey);
    setMetricChartOpen(true);
    updateChartParam(openKey);
  };
  const winRateLabel = performance.winRate == null ? '—' : `${(performance.winRate * 100).toFixed(2)}%`;
  const payoffRatioLabel = performance.payoffRatio == null ? '—' : performance.payoffRatio.toFixed(2);
  // 概览里那一项只报盈利侧：「赢的时候平均赢多少 R」。混合均值仍在浮层与期望值里。
  const winPayoffRatioLabel = formatGroupPayoffRatio(performance.winPayoffRatio);
  const lossPayoffRatioLabel = formatGroupPayoffRatio(performance.lossPayoffRatio);
  // 期望值浮层里的分组项：某一组没有样本时该项为 0（n = 0），不是「—」。
  const groupTerm = (value: number | null) => (value == null ? '0' : value.toFixed(2));
  const validCampaignCount = performance.payoffRatioSampleCount;
  const breakevenCampaignCount = Math.max(
    0,
    validCampaignCount - performance.winCount - performance.lossCount,
  );
  const payoffRatioSum = performance.payoffRatio == null
    ? null
    : performance.payoffRatio * performance.payoffRatioSampleCount;
  const expectedRLabel = performance.expectedR == null
    ? '—'
    : `${performance.expectedR >= 0 ? '+' : ''}${performance.expectedR.toFixed(2)}R`;
  const geometricEdgeLabel = geometric == null
    ? '—'
    : `${geometric.geometricEdge >= 0 ? '+' : ''}${(geometric.geometricEdge * 100).toFixed(1)}%`;
  // 累计倍数：几百场复利动辄上亿倍，超过 4 位数就换科学计数，别让一串零占满一行。
  const formatGrowthFactor = (factor: number) => {
    if (factor === 0) return '×0（本金归零）';
    // G^n 在 n 上千时会溢出成 Infinity；「×Infinity」读起来像 bug，不如直说超出可表示范围。
    if (!Number.isFinite(factor)) return '×超出可表示范围';
    if (factor >= 10000 || factor < 0.0001) return `×${factor.toExponential(2)}`;
    return `×${factor.toFixed(2)}`;
  };
  const compoundGrowthLabel = geometric == null
    ? '—'
    : formatGrowthFactor(compoundGrowthFactor(geometric.growthFactor, validCampaignCount));
  const realizedGrowthLabel = realizedGrowth.count === 0
    ? '—'
    : formatGrowthFactor(realizedGrowth.factor);

  const updateListParams = (
    nextSort: CampaignSortChain,
    nextChartKey: CampaignMetricChartKey | null | undefined = undefined,
  ) => {
    const params = new URLSearchParams(location.search);
    params.delete('scope');
    // 第一级写 sort / direction（只有一级时与原来逐字相同），之后各级写 then=项.方向
    writeCampaignSortParams(params, nextSort);
    if (nextChartKey !== undefined) {
      if (nextChartKey) params.set('chart', nextChartKey);
      else params.delete('chart');
    }
    const search = params.toString();
    nav({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };

  const scrollMetricChartIntoView = () => {
    const schedule = window.requestAnimationFrame ?? ((callback: FrameRequestCallback) => window.setTimeout(callback, 0));
    schedule(() => {
      metricChartPanelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  };

  /** 今天（UTC+8 自然日）：预设区间与日期选择器的上限都以它为准。 */
  const today = beijingDayKey(Date.now());
  const activePreset = matchPreset(operationRange, today);
  const updateRangeParams = (nextRange: CampaignOperationRange) => {
    const params = new URLSearchParams(location.search);
    params.delete('scope');
    if (nextRange.from) params.set('from', nextRange.from); else params.delete('from');
    if (nextRange.to) params.set('to', nextRange.to); else params.delete('to');
    const search = params.toString();
    nav({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
  };
  const applyOperationRange = (nextRange: CampaignOperationRange) => {
    setOperationRange(nextRange);
    updateRangeParams(nextRange);
  };

  /** 单击排序项：只按这一项排（已经只按它排时切换方向；它在多级链里时收成单级、保留方向），见 selectSortMode。 */
  const handleSortChange = (mode: CampaignSortMode) => {
    const nextSort = selectSortMode(sortChain, mode);
    const sortChartKey = SORT_CHART_BY_MODE[mode] ?? null;
    const nextChartKey = metricChartOpen && sortChartKey != null && metricSeriesByKey[sortChartKey].points.length > 0
      ? DEFAULT_CHART_VIEW_BY_SOURCE[sortChartKey] ?? sortChartKey
      : undefined;
    setSortChain(nextSort);
    if (nextChartKey) {
      setMetricChartKey(nextChartKey);
      setMetricChartOpen(true);
      scrollMetricChartIntoView();
    }
    updateListParams(nextSort, nextChartKey);
  };

  /**
   * 键盘操作「+」、链上的 ×、「清除」之后，被按的那个按钮随即卸载，焦点会掉回 <body>（下一次 Tab 从页面开头走）。
   * 这里记下接替它的按钮（data-testid），排序链一更新就把焦点交过去；只在键盘触发时（单击的 detail = 0）这样做。
   */
  const pendingSortFocusRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const testId = pendingSortFocusRef.current;
    if (!testId) return;
    pendingSortFocusRef.current = null;
    document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus({ preventScroll: true });
  }, [sortChain]);

  /**
   * 排序链的其余改动（「+」加层、链上切方向 / 移除 / 清除）：只改排序，不切换散点图——
   * 散点图仍按被点开的那一项，排序行按钮的单击才会让它跟着换。
   * focusTestId：键盘触发时，改完把焦点交给这个按钮（见 pendingSortFocusRef）。
   */
  const applySortChain = (nextSort: CampaignSortChain, focusTestId: string | null = null) => {
    if (sortChainKey(nextSort) === sortChainKey(sortChain)) return;
    pendingSortFocusRef.current = focusTestId;
    setSortChain(nextSort);
    updateListParams(nextSort);
  };
  /** 「+」加层：焦点留在同一项的排序按钮上（「+」换成级数角标），接着 Tab 仍从这一项往后走。 */
  const handleSortAppend = (mode: CampaignSortMode, fromKeyboard = false) => applySortChain(
    appendSortLevel(sortChain, mode),
    fromKeyboard ? `campaign-sort-${mode}` : null,
  );
  const handleSortLevelToggle = (index: number) => applySortChain(toggleSortLevel(sortChain, index));
  /**
   * × / 清除之后排序链变短或整条消失，双击（手机双点）的第二下会落到挪过来的下一级 ×、或挪上来的卡片上
   * （点开详情 / 选择模式里被勾掉）。吞掉紧跟着的那一下连击（detail > 1），600ms 后自动撤掉。
   */
  const swallowFollowUpClick = () => {
    const cleanup = () => {
      document.removeEventListener('click', swallow, true);
      window.clearTimeout(timer);
    };
    const swallow = (event: globalThis.MouseEvent) => {
      if (event.detail > 1) {
        event.stopPropagation();
        event.preventDefault();
      }
      cleanup();
    };
    document.addEventListener('click', swallow, true);
    const timer = window.setTimeout(cleanup, 600);
  };
  /** 移除一级：还剩多级时焦点落到前一级（移除的是第一级时落到新的第一级），只剩一级时落到它在排序行上的按钮。 */
  const handleSortLevelRemove = (index: number, fromKeyboard = false) => {
    const nextSort = removeSortLevel(sortChain, index);
    const focusTestId = !fromKeyboard
      ? null
      : nextSort.length > 1
        ? `sort-chain-toggle-${Math.max(1, index)}`
        : `campaign-sort-${nextSort[0].mode}`;
    if (!fromKeyboard) swallowFollowUpClick();
    applySortChain(nextSort, focusTestId);
  };
  /** 清除：排序链消失，焦点落到第一级在排序行上的按钮。 */
  const handleSortChainClear = (fromKeyboard = false) => {
    if (!fromKeyboard) swallowFollowUpClick();
    applySortChain(clearSortChain(sortChain), fromKeyboard ? `campaign-sort-${sortChain[0].mode}` : null);
  };
  /**
   * 多级时双击排序项看说明：第一击已经把链收成了单级，双击时把单击前的链还原——看说明不该改排序，
   * 而 URL 是 replace 导航、后退也找不回来。单级时行为不变（单击换排序，双击只多弹说明）。
   */
  const sortChainBeforeClickRef = useRef<{ mode: CampaignSortMode; chain: CampaignSortChain } | null>(null);
  /**
   * 双击「+」：第一击已经加了层、「+」随即卸载，第二击落到下面的排序按钮上——
   * 那一下的 dblclick 不再顺带打开说明（双击「+」只算加一级）。
   */
  const sortJustAppendedRef = useRef<{ mode: CampaignSortMode; at: number } | null>(null);
  const markSortJustAppended = (mode: CampaignSortMode) => {
    sortJustAppendedRef.current = { mode, at: Date.now() };
  };
  const sortDoubleClickFollowsAppend = (mode: CampaignSortMode) => {
    const recent = sortJustAppendedRef.current;
    return recent != null && recent.mode === mode && Date.now() - recent.at < 800;
  };

  /**
   * 触屏：长按排序项 = 把它加为下一级（触屏没有悬停，「+」不出现）。
   * 【为什么不在手机上常驻「+」】十四个排序项各带一个够点按的「+」，窄屏上排序行要多折两行、吸顶区占掉更多屏幕，
   * 只有一级时也不再与原来一样；长按是手机上「更多操作」的通行手势，排序行保持原样，加层后下方出现的排序链就是反馈，
   * 链上的切方向 / 移除 / 清除都是 28px 高的按钮。
   * 450ms 内松手或手指滑动超过 10px 不算；长按后松手的那次单击、安卓顺带弹出的 contextmenu 都吞掉。
   */
  const sortLongPressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const sortLongPressFiredRef = useRef(false);
  const sortAppendRef = useRef(handleSortAppend);
  sortAppendRef.current = handleSortAppend;
  const cancelSortLongPress = () => {
    const pending = sortLongPressRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    sortLongPressRef.current = null;
  };
  useEffect(() => () => {
    if (sortLongPressRef.current) window.clearTimeout(sortLongPressRef.current.timer);
  }, []);
  const sortLongPressActive = () => sortLongPressRef.current != null || sortLongPressFiredRef.current;
  /** 长按之后紧跟的那次单击吞掉；键盘触发的单击（detail = 0）不是手指松开，从不吞。 */
  const consumeSortLongPress = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail === 0 || !sortLongPressFiredRef.current) return false;
    sortLongPressFiredRef.current = false;
    return true;
  };
  /** 手指离开（松开或被浏览器取消，如滑动去滚页面）：长按已生效的，稍后自己复位，不误吞之后的键盘操作。 */
  const releaseSortLongPress = () => {
    cancelSortLongPress();
    if (sortLongPressFiredRef.current) window.setTimeout(() => { sortLongPressFiredRef.current = false; }, 400);
  };
  const sortLongPressHandlers = (mode: CampaignSortMode, canAppend: boolean) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      sortLongPressFiredRef.current = false;
      cancelSortLongPress();
      if (event.pointerType !== 'touch') return;
      const timer = window.setTimeout(() => {
        sortLongPressRef.current = null;
        sortLongPressFiredRef.current = true;
        // 已在排序链上的项长按不做任何事（松手也不会改成只按它排）
        if (!canAppend) return;
        setFormulaPopover(null);
        sortAppendRef.current(mode);
        try {
          navigator.vibrate?.(8);
        } catch {
          // 不支持震动的设备忽略
        }
      }, SORT_LONG_PRESS_MS);
      sortLongPressRef.current = { timer, x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const pending = sortLongPressRef.current;
      if (pending && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 10) cancelSortLongPress();
    },
    // 松手后紧跟着的那次单击由 consumeSortLongPress 吞掉；万一没有单击（或手指滑走、浏览器发的是 pointercancel），稍后自己复位
    onPointerUp: releaseSortLongPress,
    onPointerCancel: releaseSortLongPress,
    onPointerLeave: cancelSortLongPress,
  });

  const handleCampaignOpen = useCallback((campaignId: string) => {
    const storageKey = `${CAMPAIGN_LIST_SCROLL_KEY_PREFIX}${location.key}`;
    sessionStorage.setItem(storageKey, String(window.scrollY));
    const state: CampaignListNavigationState = { fromCampaignList: true };
    nav(`/journal/campaigns/${campaignId}${location.search}`, { state });
  }, [location.key, location.search, nav]);

  const openFormulaPopover = (
    event: MouseEvent<HTMLButtonElement>,
    formula: CampaignFormulaPopover,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setFormulaPopover(formula);
  };

  const toggleFormulaPopover = (
    event: MouseEvent<HTMLButtonElement>,
    formula: CampaignFormulaPopover,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setFormulaPopover(current => current === formula ? null : formula);
  };

  const handleFormulaPopoverChange = (
    formula: CampaignFormulaPopover,
    open: boolean,
  ) => {
    setFormulaPopover(current => {
      if (open) return formula;
      return current === formula ? null : current;
    });
  };

  /**
   * 一键结束。写的字段与单场「结束战役」对话框完全一致——两条路径必须产出同一种
   * 数据形状，否则复盘导出、事件流、指标页能分辨出「这场是批量结的」。
   *
   * 串行而不是 Promise.all：appendCampaignEvent 是「读 actual_evolution → 整段写回」，
   * 并发写同一行会互相覆盖；场数是个位数，串行的代价可以忽略。
   * 单场失败不终止整批：已成功的照样落地，失败的原样留在列表里等下一次。
   */
  const handleBulkClose = async () => {
    if (bulkClosing || bulkCloseTargets.length === 0) return;
    const finishMutation = beginMutation();
    setBulkClosing(true);
    setBulkFailures([]);
    setBulkWarnings([]);
    const closed = new Map<string, BulkClosePlanItem>();
    const failures: string[] = [];
    const warnings: string[] = [];
    const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));
    try {
      await waitForCampaignListHeal();
      for (const item of bulkCloseTargets) {
        // 主操作：结束战役。只有它失败，这一场才算失败。
        let saved: TradeCampaign;
        try {
          saved = await closeCampaign(item.campaign.id, {
            status: item.verdict.status,
            final_realized_pnl: item.realizedPnl,
            final_r_multiple: item.finalRMultiple,
            closed_at: item.closedAt,
            // peak_unrealized_pnl / peak_drawdown 有意不写：批量路径手上没有逐笔权益曲线，
            // 补 null 会把单场对话框此前算出的峰值抹掉。缺字段就让它保持原样。
          });
        } catch (error) {
          failures.push(`${item.campaign.title} · ${reason(error)}`);
          continue;
        }

        // 回读确认：拿写回来的那一行核对 closed_at 真的落下去了。
        // 「点了没反应」之所以难判，就是因为整条链路上没有任何一步会说
        // 「我写了但没写进去」——这一句把模糊的症状变成确定的结论。
        if (!saved?.closed_at) {
          failures.push(`${item.campaign.title} · 写入后回读不到结束时间，状态可能没有真正保存`);
          continue;
        }

        closed.set(item.campaign.id, item);

        // 副操作：写事件流。它是审计副产物——写不上不改变「这场已经结束」这个事实，
        // 所以只降级成提示，绝不把一次已经落库的结束报告成失败。
        try {
          await appendCampaignEvent(item.campaign.id, {
            timestamp: item.closedAt,
            event_type: 'campaign_closed',
            leg_role: null,
            journal_id: null,
            trade_record_id: null,
            pending_order_id: null,
            price: null,
            size_usdt: null,
            notes: item.verdict.kind === 'unsettled'
              ? '在战役列表一键结束；结束时仍有未结算的腿，按放弃处理'
              : '在战役列表一键结束；状态由已实现盈亏推出',
          });
        } catch (error) {
          warnings.push(`${item.campaign.title} · 状态已保存，但事件流没写上：${reason(error)}`);
        }
      }
    } finally {
      setBulkClosing(false);
    }

    if (closed.size > 0) {
      setRows(prev => prev.map(row => {
        const item = closed.get(row.campaign.id);
        if (!item) return row;
        return {
          ...row,
          campaign: {
            ...row.campaign,
            status: item.verdict.status,
            closed_at: item.closedAt,
            final_realized_pnl: item.realizedPnl ?? row.campaign.final_realized_pnl,
            final_r_multiple: item.finalRMultiple,
          },
        };
      }));
    }

    finishMutation();
    setBulkWarnings(warnings);
    if (failures.length === 0) {
      setBulkCloseOpen(false);
      setIncludeUnsettled(false);
      setBulkFailures([]);
      toast.success(
        warnings.length > 0
          ? `已结束 ${closed.size} 场战役（${warnings.length} 场的事件流未写入）`
          : `已结束 ${closed.size} 场战役`,
      );
      return;
    }
    // 有失败就**不关对话框**，把每一场的原因留在原地让用户看清楚。
    setBulkFailures(failures);
  };

  const handleDeleteCampaign = useCallback(async (
    event: MouseEvent<HTMLButtonElement>,
    campaign: TradeCampaign,
  ) => {
    event.stopPropagation();
    if (!userId || campaign.user_id !== userId || busyCampaignIdRef.current === campaign.id) return;
    const confirmed = window.confirm(`删除战役「${campaign.title}」？\n\n战役会移到“已删除”，之后仍可恢复；已生成的交易记录不会被删除。`);
    if (!confirmed) return;

    // 记下拿掉的那一行与它的位置：失败时只把它放回原处，不整表回滚
    let removed: { row: CampaignCardData; index: number } | null = null;
    const finishMutation = beginMutation();
    setBusyCampaignId(campaign.id);
    setRows(prev => {
      const index = prev.findIndex(row => row.campaign.id === campaign.id);
      if (index < 0) return prev;
      removed = { row: prev[index], index };
      return prev.filter(row => row.campaign.id !== campaign.id);
    });
    try {
      // 先等后台正在跑的那一场自愈落地再删（最多等 2 s）
      await waitForCampaignListHeal();
      await deleteCampaign(campaign.id);
      setDeletedCampaigns(current => [
        { ...campaign, deleted_at: new Date().toISOString() },
        ...current.filter(item => item.id !== campaign.id),
      ]);
      toast.success('战役已移到已删除，可随时恢复');
    } catch (error) {
      const restore = removed as { row: CampaignCardData; index: number } | null;
      if (restore) {
        setRows(prev => {
          if (prev.some(row => row.campaign.id === campaign.id)) return prev;
          const next = [...prev];
          next.splice(Math.min(restore.index, next.length), 0, restore.row);
          return next;
        });
      }
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyCampaignId(null);
      finishMutation();
    }
  }, [userId, beginMutation, setRows, setBusyCampaignId]);

  const handleDeletedOpenChange = async (open: boolean) => {
    setDeletedOpen(open);
    if (!open || !user) return;
    setDeletedLoading(true);
    try {
      setDeletedCampaigns(await listDeletedCampaigns(user.id));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletedLoading(false);
    }
  };

  const handleCampaignDetailsToggle = useCallback((
    event: MouseEvent<HTMLButtonElement>,
    campaignId: string,
  ) => {
    event.stopPropagation();
    setExpandedCampaignIds(current => {
      const next = new Set(current);
      if (next.has(campaignId)) next.delete(campaignId);
      else next.add(campaignId);
      return next;
    });
  }, []);

  const handleRestoreCampaign = async (campaign: TradeCampaign) => {
    if (!user || deletedBusyId) return;
    const finishMutation = beginMutation();
    setDeletedBusyId(campaign.id);
    try {
      await waitForCampaignListHeal();
      await restoreCampaign(campaign.id);
      setDeletedCampaigns(current => current.filter(item => item.id !== campaign.id));
      const details = await getCampaignFullData(campaign.id);
      const exitPriceCorrections = await fetchLegExitPriceCorrections(
        details.campaign.symbol,
        details.legs,
        details.tradeRecords,
      );
      const restoredRow = buildCampaignCardData(details, exitPriceCorrections);
      setRows(current => [restoredRow, ...current.filter(item => item.campaign.id !== campaign.id)]);
      toast.success('战役已恢复');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletedBusyId(null);
      finishMutation();
    }
  };

  const handlePermanentDeleteCampaign = async (campaign: TradeCampaign) => {
    if (deletedBusyId) return;
    const confirmed = window.confirm(
      `永久删除战役「${campaign.title}」？\n\n此操作无法恢复；原始交易记录不会被删除。`,
    );
    if (!confirmed) return;
    setDeletedBusyId(campaign.id);
    try {
      await waitForCampaignListHeal();
      await permanentlyDeleteCampaign(campaign.id);
      setDeletedCampaigns(current => current.filter(item => item.id !== campaign.id));
      toast.success('战役已永久删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletedBusyId(null);
    }
  };

  /**
   * 排序行：「排序方式」标签之后按 SORT_OPTIONS 的次序左对齐依次排开，两条短分隔线分出三组（见 SORT_DIVIDERS_BEFORE）。
   * 按钮以 option.value 作 key，这里按 key 取。
   */
  const renderSortRow = (buttons: ReactElement[]) => [
    <span key="__label" className="mr-1 inline-flex h-7 shrink-0 select-none items-center gap-1.5 pr-1 font-medium text-foreground/70">
      <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5 opacity-80" />
      排序方式
    </span>,
    ...buttons.flatMap(button => {
      const mode = button.key as CampaignSortMode;
      return SORT_DIVIDERS_BEFORE.has(mode)
        ? [<span key={`__divider-${mode}`} aria-hidden="true" data-testid={`campaign-sort-divider-${mode}`} className="mx-1 hidden h-4 w-px shrink-0 bg-border sm:block" />, button]
        : [button];
    }),
  ];

  /**
   * 排序链：多级时出现在排序行下方，「① 镜像止盈 ↓ › ② 加仓效用 ↓ ×  ⓘ 清除」。
   * 点某一级的名称或箭头切换它的方向，× 移除这一级，「清除」只保留第一级；只有一级时不出现（界面与原来相同）。
   * 行首与排序行同样是图标 + 四个字的标签，各级从排序行第一个按钮的位置开始排。
   * 窄屏放不下一行时：标签只留图标、图标后与「清除」前各收 4px（390 宽的手机上两级连同 ⓘ、清除正好一行排下）；
   * 各级连同前面的「›」、ⓘ 连同「清除」各自成组折行，
   * 折下去的那行与 ① 对齐（标签右边整块是一个折行区），「›」不会孤零零挂在行尾。
   */
  const renderSortChainBar = () => (
    <div
      data-testid="sort-chain"
      role="group"
      aria-label="多级排序"
      className={`order-2 flex items-start gap-x-1 border-t border-border/40 py-1.5 text-[10px] text-muted-foreground ${CAMPAIGN_COLUMNS_FRAME} ${CAMPAIGN_COLUMNS_INSET}`}
    >
      <span aria-hidden="true" data-testid="sort-chain-label" className="mr-1 inline-flex h-7 shrink-0 select-none items-center gap-1.5 pr-1 font-medium text-foreground/70 max-sm:pr-0 sm:h-6">
        <ListOrdered className="h-3.5 w-3.5 opacity-80" />
        <span className="max-sm:hidden">多级排序</span>
      </span>
      <div data-testid="sort-chain-levels" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1">
      {sortChain.map((level, index) => {
        const label = SORT_LABEL_BY_MODE[level.mode];
        const first = index === 0;
        const directionText = sortDirectionLabel(level.direction, level.mode);
        const arrowTone = first ? 'text-[#C98500] dark:text-[#F0B90B]' : SORT_THEN_ARROW;
        return (
          <span key={level.mode} className="inline-flex shrink-0 items-center gap-1">
            {index > 0 && <span aria-hidden="true" className="select-none px-0.5 text-[12px] leading-none text-muted-foreground/45 max-sm:hidden">›</span>}
            <span
              data-testid={`sort-chain-level-${index + 1}`}
              data-sort-mode={level.mode}
              data-sort-direction={level.direction}
              className={`inline-flex shrink-0 items-stretch overflow-hidden rounded border ${first ? SORT_CHAIN_CHIP_FIRST : SORT_CHAIN_CHIP_THEN}`}
            >
              <button
                type="button"
                data-testid={`sort-chain-toggle-${index + 1}`}
                aria-label={`第 ${index + 1} 级：${label}，${directionText}；点击切换方向`}
                title={`第 ${index + 1} 级：按${label}${directionText}；点击切换方向`}
                onClick={event => { if (event.detail > 1) return; handleSortLevelToggle(index); }}
                className={`${SORT_CHAIN_CONTROL} gap-1 pl-1 pr-1.5 hover:bg-[#F0B90B]/10`}
              >
                <span aria-hidden="true" className={`${SORT_LEVEL_BADGE} ${first ? SORT_LEVEL_BADGE_FIRST : SORT_LEVEL_BADGE_THEN}`}>{index + 1}</span>
                <span>{label}</span>
                {level.direction === 'desc'
                  ? <ArrowDown aria-hidden="true" className={`h-3 w-3 ${arrowTone}`} />
                  : <ArrowUp aria-hidden="true" className={`h-3 w-3 ${arrowTone}`} />}
              </button>
              <button
                type="button"
                data-testid={`sort-chain-remove-${index + 1}`}
                aria-label={`移除第 ${index + 1} 级「${label}」`}
                title={first
                  ? `移除第 1 级「${label}」：第 2 级升为第一级，进不进列表改由它决定`
                  : `移除第 ${index + 1} 级「${label}」`}
                onClick={event => { if (event.detail > 1) return; handleSortLevelRemove(index, event.detail === 0); }}
                className={`${SORT_CHAIN_CONTROL} w-6 justify-center border-l border-[#F0B90B]/20 text-muted-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground sm:w-5`}
              >
                <X aria-hidden="true" className="h-2.5 w-2.5" />
              </button>
            </span>
          </span>
        );
      })}
      <span className="inline-flex shrink-0 items-center">
      <Popover
        open={formulaPopover === 'sortChain'}
        onOpenChange={open => handleFormulaPopoverChange('sortChain', open)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="sort-chain-info"
            aria-label="多级排序的规则"
            title="多级排序的规则"
            onClick={event => toggleFormulaPopover(event, 'sortChain')}
            className={`${SORT_CHAIN_CONTROL} ml-0.5 w-6 justify-center rounded text-muted-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/80`}
          >
            <Info aria-hidden="true" className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={POPOVER_COLLISION_PADDING} className={`w-80 border-border bg-card p-3 text-[11px] ${POPOVER_VIEWPORT_MAX_W}`}>
          <div className="font-medium text-foreground">多级排序</div>
          <div data-testid="sort-chain-rules" className="mt-2 space-y-1 text-muted-foreground">
            <div>第一级决定哪些战役进列表，与只按它排时同一口径。</div>
            <div>第一级打平时按第二级比较，再打平看第三级……各级都打平后，按第一级原有的并列规则收尾。</div>
            <div>第二级起算不出的战役留在本档、排到本档末尾（不论升序还是降序），封面照常显示「—」。</div>
            <div>点某一级的名称或箭头切换它的方向，× 移除这一级；「清除」只保留第一级。</div>
            <div>加一级：悬停排序项，点右上角的「+」；手机上长按排序项。单击排序项仍是只按这一项排。</div>
          </div>
        </PopoverContent>
      </Popover>
      <button
        type="button"
        data-testid="sort-chain-clear"
        title="清除后面各级，只保留第一级"
        onClick={event => { if (event.detail > 1) return; handleSortChainClear(event.detail === 0); }}
        className={`${SORT_CHAIN_CONTROL} ml-1 rounded px-1.5 text-muted-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground max-sm:ml-0`}
      >
        清除
      </button>
      </span>
      </div>
    </div>
  );

  /**
   * 批量下载的选择条。宽屏上放在吸顶区里（排序行下方），跟着统计与排序一起吸顶；
   * 窄屏（< 768px）上排序行本身就折成好几行，再叠一条会让吸顶区占掉小半屏，所以放到吸顶区下面、跟着页面滚走，
   * 滚出视野后由底部浮条（已选 N 场 · 退出选择 · 下载选中）接手。两处只挂一份。
   */
  const renderBatchSelectionBar = (detached: boolean) => (
    <div
      ref={selectionBarRef}
      data-testid="campaign-batch-selection-bar"
      role="toolbar"
      aria-label="批量下载：选择战役"
      data-placement={detached ? 'flow' : 'sticky'}
      className={`flex min-h-10 flex-wrap items-center gap-x-1 gap-y-1 bg-[#F0B90B]/[0.045] py-1.5 text-[10px] text-muted-foreground dark:bg-[#F0B90B]/[0.035] ${CAMPAIGN_COLUMNS_FRAME} ${CAMPAIGN_COLUMNS_INSET} ${
        detached
          // 跟着页面滚走的一条：上面贴着吸顶区的下边框；散点图收起时这一节没有下边框，由它自己收口
          ? `order-2 ${metricChartOpen ? '' : 'border-b border-border/80'}`
          : 'order-3 border-t border-[#F0B90B]/20'
      }`}
    >
      <span className="mr-1 inline-flex h-7 shrink-0 select-none items-center gap-1.5 pr-1 font-medium text-foreground/70" role="status" aria-live="polite">
        <ListChecks aria-hidden="true" className="h-3.5 w-3.5 text-[#C98500] dark:text-[#F0B90B]" />
        已选
        <span data-testid="campaign-batch-selected-count" className="font-mono text-[11px] tabular-nums text-foreground">{selectedExportTargets.length}</span>
        场
      </span>
      <span aria-hidden="true" className="mx-1 hidden h-4 w-px shrink-0 bg-border sm:block" />
      <button
        type="button"
        className={BATCH_BAR_BUTTON}
        onClick={() => setSelectedCampaignIds(new Set(sortedRows.map(row => row.campaign.id)))}
        aria-label={`全选列表（${sortedRows.length}）`}
        title="选中列表里当前显示的全部战役（替换现有选择）"
      >
        全选列表<span className="font-mono tabular-nums text-muted-foreground/60">{sortedRows.length}</span>
      </button>
      {metricChartOpen && (
        <button
          type="button"
          className={BATCH_BAR_BUTTON}
          onClick={() => setSelectedCampaignIds(new Set(selectedMetricSeries.points.map(point => point.campaignId)))}
          aria-label={`全选当前图（${selectedMetricSeries.points.length}）`}
          title={`选中「${selectedMetricConfig.label}」图上的全部战役（替换现有选择）`}
        >
          全选当前图<span className="font-mono tabular-nums text-muted-foreground/60">{selectedMetricSeries.points.length}</span>
        </button>
      )}
      <form
        noValidate
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border/60 bg-background/60 pl-1.5 pr-0.5"
        onSubmit={event => {
          event.preventDefault();
          // 超过列表场数就按全部算（不弹浏览器自带的「值必须小于或等于…」提示）
          if (selectFirstValid) setSelectedCampaignIds(new Set(sortedRows.slice(0, selectFirstNumber).map(row => row.campaign.id)));
        }}
      >
        <label htmlFor="campaign-batch-first-n">前</label>
        <input
          id="campaign-batch-first-n"
          aria-label="选择前几场"
          type="number"
          inputMode="numeric"
          min={1}
          max={Math.max(1, sortedRows.length)}
          value={selectFirstCount}
          onChange={event => setSelectFirstCount(event.target.value)}
          className="h-5 w-10 rounded-sm border border-border/70 bg-background px-1 text-center font-mono text-[10px] tabular-nums text-foreground [appearance:textfield] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span>场</span>
        <button
          type="submit"
          disabled={!selectFirstValid}
          className="ml-0.5 inline-flex h-5 items-center rounded-sm px-1.5 text-foreground/80 transition-colors hover:bg-foreground/[0.06] disabled:cursor-not-allowed disabled:opacity-40"
          title="按列表当前的排序选中前 N 场（替换现有选择）"
        >
          按当前排序选择
        </button>
      </form>
      <button
        type="button"
        disabled={selectedCampaignIds.size === 0}
        className={`${BATCH_BAR_BUTTON} border-transparent`}
        onClick={() => setSelectedCampaignIds(new Set())}
      >
        清空
      </button>
      {selectedOutsideList > 0 && (
        <span
          data-testid="campaign-batch-outside-note"
          title={`进不进列表由排序的第一级「${SORT_LABEL_BY_MODE[primarySort.mode]}」决定：算不出这一项的战役不在列表里`}
          className="inline-flex h-7 items-center text-[#8F6B00] dark:text-[#E8B21C]"
        >
          另有 {selectedOutsideList} 场因当前排序口径未显示，仍保留并排在下载队列末尾
        </span>
      )}
      <span className="ml-auto hidden select-none pr-1.5 text-muted-foreground/55 xl:inline">点卡片或散点增减 · Esc 退出</span>
      <button
        type="button"
        disabled={!selectedExportTargets.length || !campaignRowsComplete}
        onClick={() => openExportDialog('bar')}
        data-testid="campaign-batch-export-open"
        ref={barExportButtonRef}
        className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded bg-[#F0B90B] px-2.5 text-[11px] font-medium text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-40 max-xl:ml-auto"
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        下载选中
        <span className="font-mono tabular-nums">{selectedExportTargets.length}</span>
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* 页眉恰好 57px（h-14 + 1px 下边框）：下方统计 / 排序的吸顶 top-[57px] 与它严丝合缝，吸住时不会被压掉一截。 */}
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-6">
          <BackButton to="/" />
          <div>
            <h1 className="text-[14px] font-medium">交易战役</h1>
            <p className="text-[11px] text-muted-foreground">复盘的高层单位</p>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => nav('/journal/campaigns/classify')}
            className="inline-flex h-8 items-center gap-1 rounded border border-border bg-card px-3 text-[12px] hover:bg-accent"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            归类历史交易
          </button>
          <button
            type="button"
            onClick={() => void handleDeletedOpenChange(true)}
            title="已删除战役"
            aria-label={`已删除战役，共 ${deletedCampaigns.length} 场`}
            data-testid="deleted-campaigns-entry"
            className="inline-flex h-8 items-center gap-1 rounded border border-transparent px-1.5 text-[10px] text-muted-foreground/45 transition-colors hover:border-border/60 hover:bg-accent hover:text-muted-foreground"
          >
            <ArchiveRestore className="h-3.5 w-3.5" />
            {deletedCampaigns.length > 0 && <span>{deletedCampaigns.length}</span>}
          </button>
        </div>
      </header>

      {/* 选择模式下底部留出浮条（bottom-4 + h-10）的高度：翻到列表最末，最后一张卡片的指标行不被浮条压住 */}
      <main className={`mx-auto max-w-[1600px] px-4 py-5 sm:px-6${selectionMode ? ' pb-20' : ''}`}>
        {activeCount > 0 && (
          <button
            type="button"
            data-testid="active-campaigns-banner"
            onClick={() => setBulkCloseOpen(true)}
            title="一键结束进行中的战役"
            className="mb-4 flex w-full items-center gap-2 rounded border border-[#F0B90B]/30 bg-[#F0B90B]/10 px-3 py-2 text-left text-[11px] text-[#F0B90B] transition-colors hover:border-[#F0B90B]/60 hover:bg-[#F0B90B]/20"
          >
            <span className="min-w-0 flex-1">
              你有 {activeCount} 个进行中的战役。每个战役都应该有明确的退出条件——不要让它无限期 active。
            </span>
            <span className="shrink-0 rounded border border-[#F0B90B]/45 px-1.5 py-0.5 text-[10px] font-medium">
              一键结束
            </span>
          </button>
        )}

        {/* 一键结束的确认框：先把「每一场会变成什么」摊开，再动手写库。
            这是一批不可撤销的写入，界面上读到的那一份就是随后落库的那一份。 */}
        <Dialog
          open={bulkCloseOpen}
          onOpenChange={(open) => {
            if (bulkClosing) return; // 写库过程中不许关掉，避免只结了一半却看不见进度
            setBulkCloseOpen(open);
            if (!open) { setIncludeUnsettled(false); setBulkFailures([]); setBulkWarnings([]); }
          }}
        >
          <DialogContent className="max-w-[560px]" data-testid="bulk-close-dialog">
            <DialogHeader>
              <DialogTitle className="text-[14px]">结束进行中的战役</DialogTitle>
              <DialogDescription className="text-[11px] leading-[1.7]">
                状态由本场已实现盈亏推出，不用手选；结束时间取该场最后一笔成交，不是此刻。
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[46vh] space-y-1 overflow-y-auto pr-0.5">
              {bulkClosePlan.length === 0 && (
                <div className="rounded border border-border bg-muted/25 px-3 py-6 text-center text-[12px] text-muted-foreground">
                  没有属于你的进行中战役
                </div>
              )}
              {bulkClosePlan.map((item) => {
                // 取成局部常量再判别：TS 只对 const 引用做别名收窄，
                // 直接写 item.verdict.kind 会让下面读 unsettledLegCount 时丢掉类型。
                const verdict = item.verdict;
                const unsettled = verdict.kind === 'unsettled';
                const included = !unsettled || includeUnsettled;
                const pnl = item.realizedPnl;
                const pnlTone = pnl == null || pnl === 0
                  ? 'text-foreground/70'
                  : pnl > 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]';
                return (
                  <div
                    key={item.campaign.id}
                    data-testid="bulk-close-row"
                    data-campaign-id={item.campaign.id}
                    data-included={included}
                    className={`rounded border px-2.5 py-1.5 ${included ? 'border-border bg-card' : 'border-dashed border-border/70 bg-muted/20 opacity-60'}`}
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate text-foreground/90">{item.campaign.title}</span>
                      <span className={`shrink-0 font-mono tabular-nums ${pnlTone}`}>
                        {pnl == null ? '—' : `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}`}
                      </span>
                      <span className="shrink-0 text-muted-foreground/50">→</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLES[verdict.status] || 'bg-muted text-muted-foreground'}`}>
                        {BULK_CLOSE_STATUS_LABELS[verdict.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground/65">
                      <span className="font-mono tabular-nums">
                        {formatBeijingTime(Date.parse(item.closedAt)).slice(0, 16)}
                      </span>
                      <span className="text-muted-foreground/45">·</span>
                      <span>{CLOSE_TIME_SOURCE_LABELS[item.closedAtSource]}</span>
                      {verdict.kind === 'unsettled' && (
                        <>
                          <span className="text-muted-foreground/45">·</span>
                          <span className="text-[#F0B90B]/85">
                            {verdict.unsettledLegCount > 0
                              ? `还有 ${verdict.unsettledLegCount} 条腿未结算`
                              : '没有已结算的腿'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {unsettledPlan.length > 0 && (
              <label
                data-testid="bulk-close-include-unsettled"
                className="flex cursor-pointer items-start gap-2 rounded border border-border/70 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground"
              >
                <input
                  type="checkbox"
                  className="mt-0.5 h-3 w-3 shrink-0 accent-[#F0B90B]"
                  checked={includeUnsettled}
                  onChange={(event) => setIncludeUnsettled(event.target.checked)}
                />
                <span>
                  连同 {unsettledPlan.length} 场未结算的一并标记为「放弃」。
                  <span className="text-muted-foreground/70">它们还有没结算完的腿，给不出盈利或亏损的定性。</span>
                </span>
              </label>
            )}

            {bulkFailures.length > 0 && (
              <div
                data-testid="bulk-close-failures"
                className="space-y-1 rounded border border-[#F6465D]/40 bg-[#F6465D]/10 px-2.5 py-2 text-[11px] text-[#F6465D]"
              >
                <div className="font-medium">{bulkFailures.length} 场没能结束</div>
                {bulkFailures.map(msg => (
                  <div key={msg} className="leading-[1.6] opacity-90">{msg}</div>
                ))}
              </div>
            )}

            {bulkWarnings.length > 0 && (
              <div
                data-testid="bulk-close-warnings"
                className="space-y-1 rounded border border-[#F0B90B]/40 bg-[#F0B90B]/10 px-2.5 py-2 text-[11px] text-[#F0B90B]"
              >
                <div className="font-medium">{bulkWarnings.length} 场的状态已保存，但事件流没写上</div>
                {bulkWarnings.map(msg => (
                  <div key={msg} className="leading-[1.6] opacity-90">{msg}</div>
                ))}
              </div>
            )}

            <DialogFooter>
              <button
                type="button"
                disabled={bulkClosing}
                onClick={() => { setBulkCloseOpen(false); setIncludeUnsettled(false); setBulkFailures([]); setBulkWarnings([]); }}
                className="inline-flex h-8 items-center rounded border border-border bg-card px-3 text-[12px] hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="bulk-close-confirm"
                disabled={bulkClosing || bulkCloseTargets.length === 0}
                onClick={() => void handleBulkClose()}
                className="inline-flex h-8 items-center rounded bg-[#F0B90B] px-3 text-[12px] font-medium text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {bulkClosing
                  ? '结束中…'
                  : bulkFailures.length > 0
                    ? `重试这 ${bulkCloseTargets.length} 场`
                    : `结束这 ${bulkCloseTargets.length} 场`}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {(campaignLoadError || failedCount > 0) && (
          <div role="status" className="mb-2 flex items-center gap-3 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
            <span>
              {campaignLoadError
                ? `${campaignRowsComplete ? '更新失败，保留上次结果。' : '战役读取失败。'}${campaignLoadError}`
                : `${failedCount} 场战役未能更新，统计可能不完整；已有结果已保留。`}
            </span>
            <button type="button" onClick={retryCampaignLoad} disabled={refreshing} className="shrink-0 underline disabled:opacity-50">
              {refreshing ? '重试中…' : '重试'}
            </button>
          </div>
        )}
        {/* 散点图收起时，吸顶区自己的下边框就是这一段的收口，不再叠一条 section 下边框。 */}
        <section className={`mb-5 overflow-visible border-t border-border/80 bg-card/40 ${metricChartOpen ? 'border-b' : ''}`}>
          <div className="flex w-full flex-col">
            <div
              ref={stickyControlsRef}
              data-testid="campaign-sticky-controls"
              className="sticky top-[57px] z-10 order-1 flex w-full flex-col border-b border-border/80 bg-background/95 shadow-[0_8px_16px_-14px_rgba(15,23,42,0.45)] backdrop-blur-md"
            >
            {/* 【用户要求】排序行左对齐：按钮依次排开、间距均匀，两条短分隔线分出「操作时间 · 镜像止盈 ┆ 与封面指标同序的七项 ┆ 其余」三组。
                左右内边距与封面相同（CAMPAIGN_COLUMNS_FRAME / INSET），行首与封面左缘对齐。 */}
            <div
              data-testid="campaign-sort-controls"
              className={`order-2 flex min-h-11 flex-wrap items-center gap-x-1 gap-y-1 border-t border-border/60 py-2 text-[10px] text-muted-foreground ${CAMPAIGN_COLUMNS_FRAME} ${CAMPAIGN_COLUMNS_INSET}`}
            >
              {renderSortRow(SORT_OPTIONS.map(option => {
                /** 这一项在排序链上的第几级（0 = 第一级，-1 = 不在链上）。 */
                const level = sortChain.findIndex(item => item.mode === option.value);
                const active = level === 0;
                const inChain = level >= 0;
                const thenLevel = level > 0;
                const direction = inChain ? sortChain[level].direction : 'desc';
                const formula = SORT_FORMULA_BY_MODE[option.value] ?? null;
                const sortChartKey = SORT_CHART_BY_MODE[option.value] ?? null;
                const sortChartConfig = sortChartKey == null
                  ? null
                  : CAMPAIGN_METRIC_CHART_CONFIGS.find(config => config.key === sortChartKey) ?? null;
                const sortChartPointCount = sortChartKey == null
                  ? 0
                  : metricSeriesByKey[sortChartKey].points.length;
                const sortChartActive = sortChartKey != null
                  && metricChartOpen
                  && openSourceKey === sortChartKey;
                const sortChartTestId = sortChartKey === 'odds'
                  ? 'campaign-odds-chart-toggle'
                  : sortChartKey == null
                    ? undefined
                    : `campaign-${sortChartKey}-chart-toggle`;
                /** 多级时链上的每一级（含第一级）都标出级数；单击它会收成只按这一项排、方向不变（见 selectSortMode）。 */
                const chainLevel = inChain && sortChain.length > 1;
                const sortButton = (
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-label={`${option.label}，${sortDirectionLabel(direction, option.value)}排序${chainLevel ? `（第 ${level + 1} 级）` : ''}`}
                    title={chainLevel
                      ? `第 ${level + 1} 级：按${option.label}${sortDirectionLabel(direction, option.value)}；单击改为只按这一项排（方向不变）${formula ? '；双击或右键查看说明与散点图' : ''}`
                      : `按${option.label}${sortDirectionLabel(direction, option.value)}排序${active ? '；再次单击切换方向' : ''}${formula ? '；双击或右键查看说明与散点图' : ''}`}
                    data-sort-direction={inChain ? direction : undefined}
                    data-sort-level={inChain ? level + 1 : undefined}
                    data-testid={`campaign-sort-${option.value}`}
                    onClick={(event) => {
                      if (event.detail > 1) return;
                      // 触屏长按刚把它加成了下一级：松手时的这次单击不再当作「只按这一项排」
                      if (consumeSortLongPress(event)) return;
                      // 键盘在「+」上连按两下：第一下加层后焦点交给本项排序按钮，第二下不能把刚建好的链收成单级
                      if (event.detail === 0 && sortDoubleClickFollowsAppend(option.value)) return;
                      sortChainBeforeClickRef.current = sortChain.length > 1 ? { mode: option.value, chain: sortChain } : null;
                      setFormulaPopover(null);
                      handleSortChange(option.value);
                    }}
                    onDoubleClick={(event) => {
                      // 双击的是右上角的「+」（第一击已加层）：只算加一级，不顺带打开说明
                      if (sortDoubleClickFollowsAppend(option.value)) {
                        event.preventDefault();
                        return;
                      }
                      // 多级时双击看说明：把第一击收掉的排序链还原
                      const before = sortChainBeforeClickRef.current;
                      sortChainBeforeClickRef.current = null;
                      if (before && before.mode === option.value) applySortChain(before.chain);
                      if (formula) openFormulaPopover(event, formula);
                    }}
                    onContextMenu={(event) => {
                      // 触屏长按（安卓会顺带弹出 contextmenu）是加层，不是看说明
                      if (sortLongPressActive()) {
                        event.preventDefault();
                        return;
                      }
                      if (formula) openFormulaPopover(event, formula);
                    }}
                    {...sortLongPressHandlers(option.value, !inChain)}
                    className={`inline-flex h-7 shrink-0 select-none items-center gap-0.5 whitespace-nowrap rounded border px-1.5 transition-[color,background-color,border-color,box-shadow] duration-150 [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70 ${
                      active
                        ? 'border-border bg-card font-medium text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.08)] dark:border-foreground/15 dark:bg-accent'
                        : thenLevel
                          ? SORT_THEN_BUTTON
                          : 'border-transparent text-muted-foreground/75 hover:border-border/60 hover:bg-foreground/[0.04] hover:text-foreground/85'
                    }`}
                  >
                    <span>{option.label}</span>
                    {/* 图标位宽度固定：有公式的档平时显示 Σ，选中后同一个位置换成方向箭头；
                        没有公式的档（操作时间 / 杠杆倍数 / 字母）平时也留一个同宽的空位——切换排序时按钮宽度不变，整行不会重排、双击不会落到隔壁。 */}
                    {(formula || inChain) ? (
                      <span aria-hidden="true" data-testid={`campaign-sort-${option.value}-icon`} className="inline-flex w-3 shrink-0 justify-center">
                        {!inChain
                          ? <Sigma className="h-2.5 w-2.5 opacity-30" />
                          : direction === 'desc'
                            ? <ArrowDown className={`h-3 w-3 ${active ? 'text-[#C98500] dark:text-[#F0B90B]' : SORT_THEN_ARROW}`} />
                            : <ArrowUp className={`h-3 w-3 ${active ? 'text-[#C98500] dark:text-[#F0B90B]' : SORT_THEN_ARROW}`} />}
                      </span>
                    ) : (
                      <span aria-hidden="true" data-testid={`campaign-sort-${option.value}-icon`} className="inline-flex w-3 shrink-0" />
                    )}
                  </button>
                );
                /**
                 * 每一项外面包一层（不占尺寸）：右上角挂一个悬停才出现的「+」（加为下一级），多级时同一个角上标出第几级。
                 * 只有一级时这一层什么也不画，排序行与原来逐像素相同。
                 */
                const wrapSortItem = (content: ReactElement) => (
                  <span key={option.value} data-sort-item={option.value} className="group/sort relative inline-flex shrink-0">
                    {content}
                    {!inChain && (
                      <button
                        type="button"
                        data-testid={`sort-chain-add-${option.value}`}
                        aria-label={`把「${option.label}」加为第 ${sortChain.length + 1} 级排序`}
                        title={`加为第 ${sortChain.length + 1} 级：前面各级打平时，再按${option.label}排`}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (event.detail > 1) return;
                          setFormulaPopover(null);
                          markSortJustAppended(option.value);
                          handleSortAppend(option.value, event.detail === 0);
                        }}
                        // 「+」是这一项的一部分：右键同样看说明与散点图（不弹浏览器菜单、不加层）
                        onContextMenu={formula ? event => openFormulaPopover(event, formula) : undefined}
                        className={SORT_ADD_BUTTON}
                      >
                        <Plus aria-hidden="true" strokeWidth={3} className="h-2.5 w-2.5" />
                      </button>
                    )}
                    {inChain && sortChain.length > 1 && (
                      <span
                        aria-hidden="true"
                        data-testid={`sort-chain-rank-${option.value}`}
                        className={`pointer-events-none absolute -right-1 -top-1 ${SORT_LEVEL_BADGE} ${active ? SORT_LEVEL_BADGE_FIRST : SORT_LEVEL_BADGE_THEN}`}
                      >
                        {level + 1}
                      </span>
                    )}
                  </span>
                );
                if (!formula) {
                  return wrapSortItem(sortButton);
                }
                return wrapSortItem(
                <Popover
                  open={formulaPopover === formula}
                  onOpenChange={open => handleFormulaPopoverChange(formula, open)}
                >
                  <PopoverAnchor asChild>{sortButton}</PopoverAnchor>
                  <PopoverContent align="end" collisionPadding={POPOVER_COLLISION_PADDING} className={`w-80 border-border bg-card p-3 text-[11px] ${POPOVER_VIEWPORT_MAX_W}`}>
                    {formula === 'captureRate' ? (
                      <>
                        <div className="font-medium text-foreground">单场盈亏比计算公式</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          bᵢ = 已实现盈亏ᵢ ÷ 初始最大预期亏损ᵢ
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div>初始最大预期亏损：</div>
                          <div className="rounded border border-border/60 px-2 py-1.5 font-mono leading-relaxed text-foreground/85">
                            Lᵢ = 主力开仓名义仓位 × max（|开仓价 − 对冲 A 价|，|开仓价 − 对冲 B 价|）÷ 开仓价
                          </div>
                          <div>主力开仓名义仓位为入场时 M 加镜像的真实全暴露；后续加仓、重入和反向对冲不计入。</div>
                          <div>排序使用带正负号的 bᵢ：盈利为正，亏损为负。</div>
                          <div>没有有效初始最大预期亏损的战役不参与排序。</div>
                        </div>
                      </>
                    ) : formula === 'expectedDrawdownPct' ? (
                      <>
                        <div className="font-medium text-foreground">预期回撤计算公式</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          dᵢ = max（|主力开仓价 − 初始对冲 A 价|，|主力开仓价 − 初始对冲 B 价|）÷ 主力开仓价 × 100%
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div>取初始对冲 A/B 中离主力开仓价更远的风险边界；只有一个有效价格时使用该价格。</div>
                          <div>历史战役优先使用保存的原始委托快照，缺失时才回退到角色记录。</div>
                          <div>缺少主力开仓价或所有初始对冲价格的战役不参与排序。</div>
                        </div>
                      </>
                    ) : formula === 'arithmeticExpectancy' ? (
                      <>
                        <div className="font-medium text-foreground">单场算术期望计算公式</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          Eᵢ = P(赢) × bᵢ −（1 − P(赢)）
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div>P(赢) 统一取 50%，不随账户实时胜率变动。</div>
                          <div>bᵢ 使用该战役带正负号的实际盈亏比。</div>
                          <div>算术期望按 R 展示；同一场战役的读数只由它自己的 bᵢ 决定。</div>
                          <div>缺少有效初始最大预期亏损的战役不参与排序。</div>
                        </div>
                      </>
                    ) : formula === 'geometricExpectancy' ? (
                      <>
                        <div className="font-medium text-foreground">单场几何期望计算公式</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          单场几何期望 = Gᵢ = 1 + bᵢ·x
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div className="rounded border border-border/60 px-2 py-1.5 font-mono leading-relaxed text-foreground/85">
                            x = {fixedFractionLabel}（每场统一）；bᵢ = 该战役带正负号的实际盈亏比
                          </div>
                          <div>
                            读法：按固定 {fixedFractionLabel} 的资金比例下这一注，赚 bᵢ 个 R 就等于本金乘上 1 + bᵢ×0.1 倍。
                            列里直接显示这个倍数：bᵢ = +2 → <span className="text-foreground">1.20</span>（本金 ×1.20）；
                            bᵢ = −1 → <span className="text-foreground">0.90</span>。
                            <span className="text-foreground">1.00</span> 是本金不增不减的分界。
                          </div>
                          <div>
                            这里不乘胜率：汇总那条 G 要按胜率把赢腿与亏腿加权，因为它推演的是重复下注的长期路径；
                            单场的结果已经发生，bᵢ 就是它的全部。
                          </div>
                          <div>
                            x 也不再按该场真实的「最大预期亏损 ÷ 开仓时账户资产」取值：那样会把「这场赔率结构好不好」
                            和「当时账户有多大」搅在一起——同样一场 +2R，早期小账户算出来像重仓豪赌、后期大账户算出来几乎没下注。
                          </div>
                          <div>若 1+bᵢ·x ≤ 0（即 bᵢ ≤ −10），代表这一注把本金打穿，Gᵢ 记为 0.00。</div>
                          <div>缺少有效初始最大预期亏损（因而没有 bᵢ）的战役不参与几何期望排序。</div>
                        </div>
                      </>
                    ) : formula === 'dsiContributionSort' ? (
                      <>
                        <div className="font-medium text-foreground">单场 DSI 贡献率计算公式</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          DSI 贡献率ᵢ = bᵢ² ÷ Σ(亏损战役 b²) × 100%
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div>DSI = √(Σ 亏损战役 b² ÷ 亏损场数)，衡量下行风险的量级。</div>
                          <div>因此单场的边际影响就是它的 b² 占亏损组平方和的比例；平方会放大大亏，少数几场往往占掉大半。</div>
                          <div>只有亏损战役（b ≤ 0，含盈亏持平）对 DSI 有贡献；盈利战役不参与该排序。</div>
                          <div>全部参与战役的贡献率合计为 100%。未了结或缺少有效 bᵢ 的战役不参与。</div>
                          <div>当前亏损样本 n={asymmetricRisk.lossCount}，DSI={formatAsymmetricMetric(asymmetricRisk.dsi, 3)}。</div>
                        </div>
                      </>
                    ) : formula === 'usiContributionSort' ? (
                      <>
                        <div className="font-medium text-foreground">单场 USI 贡献率计算公式</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          USI 贡献率ᵢ = bᵢ² ÷ Σ(盈利战役 b²) × 100%
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div>USI = √(Σ 盈利战役 b² ÷ 盈利场数) ÷ 盈利均值，衡量盈利的离散程度。</div>
                          <div>分子的组内均方决定量级，单场的边际影响即它的 b² 占盈利组平方和的比例。</div>
                          <div>只有盈利战役（b &gt; 0）对 USI 有贡献；亏损战役不参与该排序。</div>
                          <div>若极少数战役就占掉大半，说明整体盈利高度依赖偶发大赚，需与 U1 联合判读。</div>
                          <div>当前盈利样本 n={asymmetricRisk.winCount}，USI={formatAsymmetricMetric(asymmetricRisk.usi, 3)}。</div>
                        </div>
                      </>
                    ) : formula === 'mainPriceChangeSort' ? (
                      <>
                        <div className="font-medium text-foreground">主力涨跌幅计算公式</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          涨跌幅ᵢ = s ×（平仓价 − 开仓价）÷ 开仓价 × 100%
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div className="rounded border border-border/60 px-2 py-1.5 font-mono leading-relaxed text-foreground/85">
                            s = +1（主多）/ −1（主空）；开仓价 = 主力最有利的一笔；平仓价 = 主力平仓时有对冲锁住行情则取最早那张对冲的开仓价，否则取主力平仓价
                          </div>
                          <div>开仓价取主力（main_open，没有才取 reentry_main）各笔里最有利的那个：主多最低、主空最高。{PRICE_CHANGE_EXIT_RULE_TEXT}开平价与详情页 Legs 表同源（含 1 分钟 K 线平仓价校正）。</div>
                          <div>按主力方向计：空单价格跌了为正，与盈亏同号。</div>
                          <div>
                            例：主多 100 → 112，涨跌幅 = (112 − 100) ÷ 100 = <span className="text-foreground">+12.00%</span>；
                            主空 50 → 47，涨跌幅 = −1 × (47 − 50) ÷ 50 = <span className="text-foreground">+6.00%</span>。
                          </div>
                          <div>主力都还没平仓（没有平仓价）的战役显示「—」，不参与排序与散点图。</div>
                        </div>
                      </>
                    ) : formula === 'mainPriceEfficiencySort' ? (
                      <>
                        <div className="font-medium text-foreground">涨跌幅倍数计算公式</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          ηᵢ = 涨跌幅ᵢ ÷ 预期回撤ᵢ
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div>预期回撤：</div>
                          <div className="rounded border border-border/60 px-2 py-1.5 font-mono leading-relaxed text-foreground/85">
                            dᵢ = max（|主力开仓价 − 初始对冲 A 价|，|主力开仓价 − 初始对冲 B 价|）÷ 主力开仓价 × 100%
                          </div>
                          <div>涨跌幅与预期回撤都是价格层面的百分数，相除得到倍数：价格走出了几个「预期回撤」。</div>
                          <div>
                            例：主力涨了 12%、入场到对冲边界 4%，ηᵢ = 12 ÷ 4 = <span className="text-foreground">+3.00</span>；
                            价格朝反方向走 −2%，ηᵢ = −2 ÷ 4 = <span className="text-foreground">−0.50</span>。
                          </div>
                          <div>主力未平仓，或缺少主力开仓价 / 初始对冲 A/B 价格（算不出预期回撤）的战役不参与排序与散点图。</div>
                        </div>
                      </>
                    ) : formula === 'addEfficiencySort' ? (
                      <>
                        <div className="font-medium text-foreground">加仓效用计算公式</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          加仓效用ᵢ = bᵢ ÷ ηᵢ
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          {/* 两个式子各自不断行，只在「；」之后换行：不会把「涨跌幅ᵢ」拆成「涨跌幅」和另起一行的「ᵢ」 */}
                          <div className="rounded border border-border/60 px-2 py-1.5 font-mono leading-relaxed text-foreground/85">
                            <span className="whitespace-nowrap">bᵢ = 已实现盈亏ᵢ ÷ 初始最大预期亏损ᵢ；</span>
                            <wbr />
                            <span className="whitespace-nowrap">ηᵢ = 涨跌幅ᵢ ÷ 预期回撤ᵢ</span>
                          </div>
                          <div>只拿主力、不加仓时，bᵢ 大致就是主力的涨跌幅倍数，比值约为 1。</div>
                          <div>大于 1：加仓把同一段行情放大成了更多的 R；小于 1：加仓、对冲或止盈吃掉了行情。</div>
                          <div>
                            例：bᵢ = +6.00、ηᵢ = +3.00，加仓效用 = 6 ÷ 3 = <span className="text-foreground">+2.00</span>——同一段行情，加仓后多赚了一倍的 R。
                          </div>
                          <div>只算做过加仓（有一条成交过的加仓腿）<span className="text-foreground">且涨跌幅倍数为正</span>的战役：涨跌幅倍数为负时亏损战役负负得正、接近 0 时分母过小，读数都会失真；其余战役不参与排序与散点图，封面显示「—」。</div>
                        </div>
                      </>
                    ) : formula === 'importanceSort' ? (
                      <>
                        <div className="font-medium text-foreground">重要性排序口径</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          重要性 = 手动标记星级（0–5）
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div>排序直接使用每场战役当前保存的星级。</div>
                          <div>未标记的战役按 0 星处理；相同星级再按客观操作时间排序。</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-medium text-foreground">镜像止盈排序口径</div>
                        <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                          已实现·盈利 ＞ 已实现·持平 ＞ 已实现·亏损 ＞ 未实现·盈利 ＞ 未实现·持平 ＞ 未实现·亏损
                        </div>
                        <div className="mt-2 space-y-1 text-muted-foreground">
                          <div>先判断镜像止盈委托是否真正成交，再按战役实际盈亏比 b 区分结果（|b| ≤ 0.1 记持平），共六档。</div>
                          <div>成交与否是第一层：这套动作首先要考核的是「镜像止盈到底有没有生效」，赚亏是在那之后的事。</div>
                          <div>相同结果再按客观操作时间排序。</div>
                        </div>
                      </>
                    )}
                    {sortChartKey != null && sortChartConfig != null ? (
                      <div className="mt-3 border-t border-border/55 pt-2">
                        <button
                          type="button"
                          data-testid={sortChartTestId}
                          aria-expanded={sortChartActive}
                          aria-controls="campaign-odds-scatter-panel"
                          aria-label={`${sortChartActive ? '收起' : '查看'}${sortChartConfig.label}散点图，共 ${sortChartPointCount} 场`}
                          title={`${sortChartActive ? '收起' : '查看'}${sortChartConfig.label}散点图`}
                          disabled={sortChartPointCount === 0}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleMetricChartToggle(sortChartKey);
                            setFormulaPopover(null);
                          }}
                          className={`inline-flex h-6 items-center gap-1 rounded border px-1.5 text-[9px] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                            sortChartActive
                              ? 'border-[#F0B90B]/25 bg-[#F0B90B]/5 text-foreground/70'
                              : 'border-transparent text-muted-foreground/45 hover:border-border/70 hover:bg-muted/45 hover:text-foreground/70'
                          }`}
                        >
                          <ChartScatter aria-hidden="true" className="h-3 w-3" />
                          <span>{sortChartActive ? '收起散点图' : '查看散点图'}</span>
                          <span className="text-muted-foreground/45">{sortChartPointCount}</span>
                        </button>
                      </div>
                    ) : null}
                  </PopoverContent>
                </Popover>,
              );
              }))}
              {/* 批量下载不是排序项：排序按钮照旧左对齐，它单独靠在这一行最右端；进入选择模式后下方展开选择条。 */}
              <button
                ref={batchToggleRef}
                type="button"
                aria-pressed={selectionMode}
                data-testid="campaign-batch-select-toggle"
                disabled={!campaignRowsComplete}
                title={campaignRowsComplete
                  ? selectionMode ? '退出选择模式（Esc）；已选的战役保留' : '勾选卡片或点击散点，把多场战役一次下载成 PNG 压缩包'
                  : '战役还在加载，全部读完后才能批量下载'}
                onClick={() => setSelectionMode(current => !current)}
                className={`ml-auto inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded border px-2 transition-[color,background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-40 ${
                  selectionMode
                    ? 'border-[#F0B90B]/45 bg-[#F0B90B]/10 font-medium text-[#8F6B00] dark:text-[#E8B21C]'
                    : 'border-border/70 text-muted-foreground hover:border-border hover:bg-foreground/[0.04] hover:text-foreground/85'
                }`}
              >
                {selectionMode ? <X aria-hidden="true" className="h-3 w-3" /> : <Download aria-hidden="true" className="h-3 w-3" />}
                {selectionMode ? '退出选择' : '批量下载'}
              </button>
            </div>
            {sortChain.length > 1 && renderSortChainBar()}
            {selectionMode && !narrowViewport && renderBatchSelectionBar(false)}
            <div
              data-testid="campaign-metrics-strip"
              className={`order-1 flex flex-wrap items-center gap-x-0.5 gap-y-1 bg-[#F0B90B]/[0.04] py-2 text-[10px] text-muted-foreground dark:bg-[#F0B90B]/[0.035] ${CAMPAIGN_COLUMNS_FRAME} ${CAMPAIGN_COLUMNS_INSET}`}
            >
              <span className="mr-1.5 inline-flex h-7 shrink-0 select-none items-center gap-1.5 border-r border-[#F0B90B]/25 pr-3 font-medium text-[#8F6B00] dark:text-[#E8B21C]">
                <Activity aria-hidden="true" className="h-3.5 w-3.5" />
                统计概览
              </span>
            {/**
              * 操作时间段：放在概览最前，因为它决定了后面每一个数的取样范围。
              * 默认「全部」；一旦框了范围，卡片、散点图、导出也跟着一起收窄——
              * 统计说 45 场而下面躺着 230 张卡片，那种页面自己跟自己打架。
              */}
            <Popover
              open={formulaPopover === 'operationRange'}
              onOpenChange={open => handleFormulaPopoverChange('operationRange', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-operation-range"
                  data-range-active={isAllRange(operationRange) ? undefined : 'true'}
                  aria-label={`操作时间段 ${describeOperationRange(operationRange)}，当前 ${scopedRows.length} 场，点击选择时间段`}
                  title="按客观操作时间筛选：统计、卡片与散点图一起收窄"
                  onClick={event => toggleFormulaPopover(event, 'operationRange')}
                  className={`${STAT_TRIGGER} ${
                    isAllRange(operationRange)
                      ? 'border-border/70 bg-background/60'
                      : 'border-[#F0B90B]/45 bg-[#F0B90B]/10 text-[#8F6B00] dark:text-[#E8B21C]'
                  }`}
                >
                  <CalendarRange aria-hidden="true" className="h-3 w-3 opacity-60" />
                  <span className={isAllRange(operationRange) ? STAT_LABEL : ''}>操作时间</span>{' '}
                  <span className={`text-[11px] font-medium tabular-nums ${isAllRange(operationRange) ? 'text-foreground/90' : ''}`}>
                    {describeOperationRange(operationRange)}
                  </span>
                  <ChevronDown aria-hidden="true" className="h-3 w-3 opacity-45" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" collisionPadding={POPOVER_COLLISION_PADDING} className={`w-72 border-border bg-card p-3 text-[11px] ${POPOVER_VIEWPORT_MAX_W}`}>
                <div className="font-medium text-foreground">按操作时间段筛选</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {CAMPAIGN_RANGE_PRESETS.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      data-testid={`campaign-range-preset-${key}`}
                      aria-pressed={activePreset === key}
                      onClick={() => applyOperationRange(presetOperationRange(key, today))}
                      className={`h-6 rounded border px-2 text-[10px] transition-colors ${
                        activePreset === key
                          ? 'border-[#F0B90B]/40 bg-[#F0B90B]/10 text-[#D89B00]'
                          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  <input
                    type="date"
                    aria-label="起始日期"
                    max={today}
                    value={operationRange.from ?? ''}
                    onChange={event => applyOperationRange({
                      ...operationRange,
                      from: isValidDayKey(event.target.value) ? event.target.value : null,
                    })}
                    className="h-6 rounded border border-border bg-background px-1 font-mono text-[10px] outline-none"
                  />
                  <span>至</span>
                  <input
                    type="date"
                    aria-label="结束日期"
                    max={today}
                    value={operationRange.to ?? ''}
                    onChange={event => applyOperationRange({
                      ...operationRange,
                      to: isValidDayKey(event.target.value) ? event.target.value : null,
                    })}
                    className="h-6 rounded border border-border bg-background px-1 font-mono text-[10px] outline-none"
                  />
                </div>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <div>
                    当前范围 <span className="text-foreground">{describeOperationRange(operationRange)}</span>，
                    命中 <span className="text-foreground">{scopedRows.length}</span> 场（整表 {rows.length} 场）。
                  </div>
                  <div>按<span className="text-foreground">客观操作时间</span>筛选，不受时间机器的模拟时钟影响；起止两天都算在内。</div>
                  <div>统计概览、战役卡片与散点图读的是同一批战役，所以会一起跟着收窄。</div>
                  {undatedExcludedCount > 0 ? (
                    <div data-testid="campaign-range-undated">
                      另有 {undatedExcludedCount} 场缺少客观操作时间，无从安放，已排除在外。
                    </div>
                  ) : null}
                </div>
                {!isAllRange(operationRange) ? (
                  <button
                    type="button"
                    data-testid="campaign-range-clear"
                    onClick={() => applyOperationRange({ ...ALL_CAMPAIGN_OPERATION_RANGE })}
                    className="mt-2 h-7 w-full rounded border border-border text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    恢复全部
                  </button>
                ) : null}
              </PopoverContent>
            </Popover>
            <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-border" />
            <Popover
              open={formulaPopover === 'validCampaigns'}
              onOpenChange={open => handleFormulaPopoverChange('validCampaigns', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-valid-count"
                  aria-label={`有效战役 ${validCampaignCount} 场，其中盈利 ${performance.winCount} 场，亏损 ${performance.lossCount} 场${breakevenCampaignCount > 0 ? `，盈亏平衡 ${breakevenCampaignCount} 场` : ''}，点击查看最大预期亏损计算说明`}
                  title="点击查看有效战役与最大预期亏损说明"
                  onClick={event => toggleFormulaPopover(event, 'validCampaigns')}
                  className={`${STAT_TRIGGER} border-transparent`}
                >
                  <span className={STAT_LABEL}>有效战役</span>{' '}
                  <span className={`${STAT_VALUE} text-foreground/90`}>{validCampaignCount}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" collisionPadding={POPOVER_COLLISION_PADDING} className={`w-96 border-border bg-card p-3 text-[11px] ${POPOVER_VIEWPORT_MAX_W}`}>
                <div className="font-medium text-foreground">有效战役与最大预期亏损</div>
                <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono leading-relaxed text-foreground">
                  Lᵢ = 主力开仓名义仓位 × max（|主力开仓价 − 初始对冲 A 价|，|主力开仓价 − 初始对冲 B 价|）÷ 主力开仓价
                </div>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <div>主力开仓名义仓位按初始 M 与镜像 Legs 去重求和，采用镜像 TP 落袋前的真实全暴露；后续加仓、重入和反向对冲不计入。</div>
                  <div>若 A、B 都存在，取离主力开仓价更远的一档；只有一档时使用该档。</div>
                  <div>历史战役优先使用保存的原始委托价，不使用触发成交后的滑点价；旧记录缺失委托快照时，才回退到 Legs、成交记录或事件数据。</div>
                  <div>只有战役已结束，且主力开仓价、主力开仓名义仓位、初始对冲价完整，使 Lᵢ 为有限正数时，才属于有效战役。</div>
                  <div>无有效 Lᵢ 的战役不参与盈亏比、胜率、平均盈亏比、算术期望与几何期望统计。</div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 border-t border-border/60 pt-2 text-center">
                  <div><span className="text-muted-foreground">盈利</span><strong className={`ml-1 ${TONE_UP}`}>{performance.winCount}</strong></div>
                  <div><span className="text-muted-foreground">亏损</span><strong className={`ml-1 ${TONE_DOWN}`}>{performance.lossCount}</strong></div>
                  <div><span className="text-muted-foreground">盈亏平衡</span><strong className="ml-1 text-foreground">{breakevenCampaignCount}</strong></div>
                </div>
              </PopoverContent>
            </Popover>
            <Popover
              open={formulaPopover === 'mirrorTp'}
              onOpenChange={open => handleFormulaPopoverChange('mirrorTp', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-mirror-tp"
                  aria-label={`镜像止盈达成率 ${mirrorTpRateLabel}，实现 ${mirrorTp.achieved} 场（盈利 ${mirrorTp.achievedWin} 场、亏损 ${mirrorTp.achievedLoss} 场），未实现 ${mirrorTp.notAchieved} 场（${mirrorTpNotAchievedRateLabel}），点击查看说明`}
                  title="点击查看镜像止盈达成说明"
                  onClick={event => toggleFormulaPopover(event, 'mirrorTp')}
                  className={`${STAT_TRIGGER} border-transparent`}
                >
                  <span className={STAT_LABEL}>镜像止盈</span>{' '}
                  <span className={`${STAT_VALUE} text-foreground/90`}>{mirrorTpRateLabel}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" collisionPadding={POPOVER_COLLISION_PADDING} className={`w-96 border-border bg-card p-3 text-[11px] ${POPOVER_VIEWPORT_MAX_W}`}>
                <div className="font-medium text-foreground">镜像止盈达成统计</div>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <div>「实现镜像止盈」= 该战役的镜像止盈委托真正成交（触发后进入「已锁定不亏」）。口径为当前列表全部 {mirrorTp.total} 场战役。</div>
                  <div>达成率 = 实现 ÷ 全部；达成盈利率 = 实现且盈利 ÷ 实现。</div>
                  <div>盈亏按战役实际盈亏比 b 判定：<span className="text-foreground">|b| ≤ 0.1 记持平</span>，不计入盈利或亏损——这个幅度是手续费与滑点级别的噪声，不是镜像止盈的功劳或过失。缺少有效初始最大预期亏损时退回按已实现盈亏的正负判。</div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 border-t border-border/60 pt-2 text-center">
                  <div><span className="text-muted-foreground">实现</span><strong className="ml-1 text-foreground">{mirrorTp.achieved}</strong><span className="ml-1 text-muted-foreground">（{mirrorTpRateLabel}）</span></div>
                  <div><span className="text-muted-foreground">未实现</span><strong className="ml-1 text-foreground">{mirrorTp.notAchieved}</strong><span className="ml-1 text-muted-foreground">（{mirrorTpNotAchievedRateLabel}）</span></div>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1 text-center">
                  <div><span className="text-muted-foreground">已实现·盈利</span><strong className={`ml-1 ${TONE_UP}`}>{mirrorTp.achievedWin}</strong></div>
                  <div><span className="text-muted-foreground">已实现·亏损</span><strong className={`ml-1 ${TONE_DOWN}`}>{mirrorTp.achievedLoss}</strong></div>
                  <div><span className="text-muted-foreground">达成盈利率</span><strong className="ml-1 text-foreground">{mirrorTpWinRateLabel}</strong></div>
                </div>
                {/* 未达成那一侧也拆开：「没触发但照样赚了」与「没触发且亏了」是两件事，散点图按这六档分柱。 */}
                <div className="mt-1 grid grid-cols-3 gap-1 text-center" data-testid="campaign-mirror-tp-missed">
                  <div><span className="text-muted-foreground">未实现·盈利</span><strong className={`ml-1 ${TONE_UP}`}>{mirrorTp.notAchievedWin}</strong></div>
                  <div><span className="text-muted-foreground">未实现·亏损</span><strong className={`ml-1 ${TONE_DOWN}`}>{mirrorTp.notAchievedLoss}</strong></div>
                  <div><span className="text-muted-foreground">未实现·持平/进行中</span><strong className="ml-1 text-foreground">{mirrorTp.notAchievedNeutral}</strong></div>
                </div>
                {mirrorTp.achievedNeutral > 0 ? (
                  <div className="mt-1 text-center text-muted-foreground">其中 {mirrorTp.achievedNeutral} 场持平（|b| ≤ 0.1）/ 进行中，未计入盈亏。</div>
                ) : null}
              </PopoverContent>
            </Popover>
            <Popover
              open={formulaPopover === 'winRate'}
              onOpenChange={open => handleFormulaPopoverChange('winRate', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-win-rate"
                  aria-label={`盈利战役 ${performance.winCount} 场，亏损战役 ${performance.lossCount} 场，胜率 ${winRateLabel}`}
                  title="点击查看胜率计算公式"
                  onClick={event => toggleFormulaPopover(event, 'winRate')}
                  className={`${STAT_TRIGGER} border-transparent`}
                >
                  <span className={STAT_LABEL}>胜率</span>{' '}
                  <span className={`${STAT_VALUE} text-foreground/90`}>{winRateLabel}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" collisionPadding={POPOVER_COLLISION_PADDING} className={`w-72 border-border bg-card p-3 text-[11px] ${POPOVER_VIEWPORT_MAX_W}`}>
                <div className="font-medium text-foreground">胜率计算公式</div>
                <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                  P(赢) = 盈利战役数 ÷（盈利战役数 + 亏损战役数）
                </div>
                {performance.winRate != null ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    <div className="font-mono">
                      = {performance.winCount} ÷（{performance.winCount} + {performance.lossCount}）
                    </div>
                    <div className="font-mono text-foreground">= {winRateLabel}</div>
                    <div>仅统计存在有效初始最大预期亏损的已结束战役。</div>
                    <div>进行中、盈亏平衡、已删除及分母无效的战役不计入胜负。</div>
                  </div>
                ) : (
                  <div className="mt-2 text-muted-foreground">当前列表没有可计算胜率的已结束战役。</div>
                )}
              </PopoverContent>
            </Popover>
            <Popover
              open={formulaPopover === 'averagePayoffRatio'}
              onOpenChange={open => handleFormulaPopoverChange('averagePayoffRatio', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-average-payoff-ratio"
                  aria-label={`平均盈亏比 ${winPayoffRatioLabel}，盈利战役 ${performance.winCount} 场；亏损战役平均 ${lossPayoffRatioLabel}，${performance.lossCount} 场`}
                  title="点击查看平均盈亏比计算公式"
                  onClick={event => toggleFormulaPopover(event, 'averagePayoffRatio')}
                  className={`${STAT_TRIGGER} border-transparent`}
                >
                  <span className={STAT_LABEL}>平均盈亏比</span>{' '}
                  <span className={`${STAT_VALUE} text-foreground/90`}>{winPayoffRatioLabel}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" collisionPadding={POPOVER_COLLISION_PADDING} className={`w-72 border-border bg-card p-3 text-[11px] ${POPOVER_VIEWPORT_MAX_W}`}>
                <div className="font-medium text-foreground">平均盈亏比计算公式</div>
                <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                  b̄赢 = Σ 盈利战役 bᵢ ÷ 盈利战役数
                </div>
                {performance.payoffRatio != null && payoffRatioSum != null ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {/* 头条是盈利侧：「赢的时候平均赢多少 R」才是赔率结构里要盯的那个数。
                        亏损侧紧随其后——没有它就只剩一半故事。混合均值降成脚注，但不能删：期望值读的就是它。 */}
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-foreground">盈利战役（{performance.winCount} 场）</span>
                      <span
                        data-testid="campaign-win-payoff-ratio"
                        className={`font-mono text-[12px] font-semibold tabular-nums ${TONE_UP}`}
                      >
                        {formatGroupPayoffRatio(performance.winPayoffRatio)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span>亏损战役（{performance.lossCount} 场）</span>
                      <span
                        data-testid="campaign-loss-payoff-ratio"
                        className={`font-mono tabular-nums ${TONE_DOWN}`}
                      >
                        {formatGroupPayoffRatio(performance.lossPayoffRatio)}
                      </span>
                    </div>
                    <div className="leading-relaxed">
                      分别是「赢的时候平均赢多少 R」与「亏的时候平均亏多少 R」，按已实现盈亏的正负切分，盈亏持平的战役两侧都不计入。
                      上方那一项只报盈利侧：混合均值会让赢和亏互相抵消，看不出赔率结构。
                    </div>
                    <div>没有有效初始最大预期亏损的战役不计入统计。</div>

                    <div className="mt-2 border-t border-border/60 pt-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span>混合均值 b̄（全部 {performance.payoffRatioSampleCount} 场）</span>
                        <span
                          data-testid="campaign-mixed-payoff-ratio"
                          className="font-mono tabular-nums text-foreground"
                        >
                          {payoffRatioLabel}
                        </span>
                      </div>
                      <div className="mt-1 font-mono">
                        = {payoffRatioSum.toFixed(2)} ÷ {performance.payoffRatioSampleCount}（亏损以负值原样参与求和）
                      </div>
                      <div className="mt-1 leading-relaxed">期望值那一项读的就是这个混合均值。</div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-muted-foreground">当前列表没有带有效盈亏比的战役。</div>
                )}
              </PopoverContent>
            </Popover>
            <Popover
              open={formulaPopover === 'expectedValue'}
              onOpenChange={open => handleFormulaPopoverChange('expectedValue', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-expected-value"
                  className={`${STAT_TRIGGER} border-transparent`}
                  aria-label={`期望值 ${expectedRLabel}，点击查看计算公式`}
                  onClick={event => toggleFormulaPopover(event, 'expectedValue')}
                >
                  <span className={STAT_LABEL}>期望值</span>{' '}
                  <span className={`${STAT_VALUE} ${statSignTone(performance.expectedR)}`}>{expectedRLabel}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" collisionPadding={POPOVER_COLLISION_PADDING} className={`w-72 border-border bg-card p-3 text-[11px] ${POPOVER_VIEWPORT_MAX_W}`}>
                <div className="font-medium text-foreground">期望值计算公式</div>
                <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                  E = Σ bᵢ ÷ N
                </div>
                {performance.expectedWinRate != null && performance.payoffRatio != null && performance.expectedR != null ? (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    <div>全部有效战役盈亏比的平均值，等价于按盈亏分组：</div>
                    <div className="font-mono">= (n赢 × b̄赢 + n亏 × b̄亏) ÷ N</div>
                    <div className="font-mono">
                      = ({performance.winCount} × {groupTerm(performance.winPayoffRatio)} + {performance.lossCount} × {groupTerm(performance.lossPayoffRatio)}) ÷ {performance.payoffRatioSampleCount}
                    </div>
                    <div className="font-mono text-foreground">= {expectedRLabel}</div>
                    <div>b̄赢 / b̄亏 = 盈利 / 亏损战役各自的平均盈亏比；盈亏平衡战役计入 N，贡献为 0</div>
                    <div>P(赢) 仅统计设置了最大预期亏损的有效战役</div>
                    <div className="mt-2 border-t border-border/60 pt-2 text-foreground">理论公式</div>
                    <div className="font-mono">E = P(赢) × b − (1 − P(赢))</div>
                    <div>
                      其中 b 是「赢时的平均盈亏比」、每次亏损按恰好 −1R 计。这里的 b̄ 是全部战役的混合均值，
                      亏损已以负值计入，再减 (1 − P(赢)) 会把亏损扣两遍；实盘亏损平均 {groupTerm(performance.lossPayoffRatio)}R 也不恰好是 −1R，
                      所以统计值直接取平均。
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-muted-foreground">
                    当前列表需要至少一场有有效盈亏比的战役，并且要有可计算的胜率，才能得到期望值。
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <Popover
              open={formulaPopover === 'geometricEdge'}
              onOpenChange={open => handleFormulaPopoverChange('geometricEdge', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-geometric-edge"
                  className={`${STAT_TRIGGER} border-transparent`}
                  aria-label={`几何期望 ${geometricEdgeLabel} 每笔，点击查看计算公式`}
                  onClick={event => toggleFormulaPopover(event, 'geometricEdge')}
                >
                  <span className={STAT_LABEL}>几何期望</span>{' '}
                  <span className={`${STAT_VALUE} ${statSignTone(geometric?.geometricEdge ?? null)}`}>
                    {geometricEdgeLabel}
                    <span className="ml-px font-sans text-[10px] font-normal text-muted-foreground">/笔</span>
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" collisionPadding={POPOVER_COLLISION_PADDING} className={`w-80 border-border bg-card p-3 text-[11px] ${POPOVER_VIEWPORT_MAX_W}`}>
                {/**
                  * 这个浮层里其实是**两个概念**，过去挤在同一个标题下，读者很容易把
                  * 「推演出来的复利速度」当成「账户真实走过的路径」。现在分成两块，
                  * 各自带一句「它回答什么」，最后再点明两者之差的含义。
                  */}
                <div className="font-medium text-foreground">几何期望 · 两个口径</div>
                {geometric != null && performance.expectedWinRate != null && performance.winPayoffRatio != null ? (
                  <div className="mt-2 space-y-2 text-muted-foreground">
                    <section className="space-y-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className="rounded-sm bg-muted px-1 text-[9px] text-foreground/70">理论</span>
                        <span className="text-foreground">几何期望（每笔复利率）</span>
                      </div>
                      <div className="rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                        G = (1+b·x)^p · (1−x)^(1−p)，几何期望 = G − 1；W = G^n
                      </div>
                      <div className="font-mono">
                        G = (1 + {performance.winPayoffRatio.toFixed(2)} × {fixedFractionLabel})^{(performance.expectedWinRate * 100).toFixed(1)}% · (1 − {fixedFractionLabel})^{((1 - performance.expectedWinRate) * 100).toFixed(1)}%
                      </div>
                      <div className="font-mono text-foreground">G − 1 = {geometricEdgeLabel}/笔</div>
                      <div className="font-mono text-foreground">W = G^{validCampaignCount} = {compoundGrowthLabel}</div>
                      <div>
                        它回答：<span className="text-foreground">若按这套参数重复下注 {validCampaignCount} 次，理论上本金按什么速度复利</span>。
                        b = 盈利战役的平均实际盈亏比（{performance.winPayoffRatio.toFixed(2)}，{performance.winCount} 场）；
                        p = 有效战役胜率（{(performance.expectedWinRate * 100).toFixed(1)}%）；
                        n = 有效战役数（{validCampaignCount} 场）；
                        x = 每笔按资金比例的最大预期回撤，统一取 {fixedFractionLabel}——固定仓位后，这个数的变化只反映 edge 本身，可以纵向比较。
                      </div>
                      <div>它与算术期望（{expectedRLabel}）的差 = <span className="text-foreground">波动拖累</span>：押太大时算术为正、几何却翻负、本金长期归零。</div>
                      {geometric.bleeds ? (
                        <div className="text-[#F6465D]">当前为长期缩水（G&lt;1）——这套 edge 不该按此仓位下注。</div>
                      ) : null}
                    </section>

                    <section className="space-y-1 border-t border-border/60 pt-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className="rounded-sm bg-muted px-1 text-[9px] text-foreground/70">实测</span>
                        <span className="text-foreground">实际复利结果</span>
                      </div>
                      <div className="rounded bg-muted/60 px-2 py-1.5 font-mono text-foreground">
                        ∏（1+bᵢ·x），bᵢ = 每场真实盈亏比
                      </div>
                      <div className="font-mono text-foreground">
                        ∏（1+bᵢ·x）= {realizedGrowthLabel}
                        <span className="ml-1 text-muted-foreground">（{realizedGrowth.count} 场逐场连乘）</span>
                      </div>
                      <div>
                        它回答：<span className="text-foreground">每场按同样 {fixedFractionLabel} 的比例下注，真实发生的 bᵢ 一场一场走下来，本金实际成了几倍</span>。
                        这里不用胜率、也不用平均值，样本是什么就走什么。
                      </div>
                      {realizedGrowth.wipedOut ? (
                        <div className="text-[#F6465D]">其中有一场 bᵢ ≤ −10，按 {fixedFractionLabel} 下注足以打穿本金，连乘因此归零。</div>
                      ) : null}
                    </section>

                    <div className="border-t border-border/60 pt-2">
                      两者之差 = <span className="text-foreground">真实样本的分布</span>相对「按均值推演」的代价或红利：
                      理论那条把所有盈利战役压成一个平均数，实测这条保留了每一场的原样。
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-muted-foreground">需要可计算的胜率，以及至少一场盈利战役的平均盈亏比，才能得到几何期望。</div>
                )}
              </PopoverContent>
            </Popover>
            <Popover
              open={formulaPopover === 'asymmetricRisk'}
              onOpenChange={open => handleFormulaPopoverChange('asymmetricRisk', open)}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  data-testid="campaign-asymmetric-risk"
                  className={`${STAT_TRIGGER} border-transparent`}
                  aria-label={`不对称风险，UPR ${formatAsymmetricMetric(asymmetricRisk.upr)}，Omega ${formatAsymmetricMetric(asymmetricRisk.omega)}，点击查看六项指标`}
                  title="点击查看不对称风险指标"
                  onClick={event => toggleFormulaPopover(event, 'asymmetricRisk')}
                >
                  <span className={STAT_LABEL}>不对称风险</span>{' '}
                  <span className="inline-flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">UPR</span>{' '}
                    <span className={`${STAT_VALUE} text-foreground/90`}>{formatAsymmetricMetric(asymmetricRisk.upr)}</span>{' '}
                    <span aria-hidden="true" className="text-muted-foreground/50">·</span>{' '}
                    <span className="text-[10px] text-muted-foreground">Ω</span>{' '}
                    <span className={`${STAT_VALUE} text-foreground/90`}>{formatAsymmetricMetric(asymmetricRisk.omega)}</span>
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" collisionPadding={POPOVER_COLLISION_PADDING} className={`w-[min(92vw,38rem)] border-border bg-card p-0 text-[11px] ${POPOVER_VIEWPORT_MAX_W}`}>
                <div className="relative flex items-center justify-between border-b border-border/70 px-4 py-3">
                  <div>
                    <div className="font-medium text-foreground">不对称风险</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">上行与下行分开计量，完整保留右尾贡献</div>
                  </div>
                  <details
                    data-testid="asymmetric-risk-help"
                    className="group text-[10px] text-muted-foreground"
                  >
                    <summary
                      data-testid="asymmetric-risk-help-toggle"
                      className="cursor-pointer select-none list-none rounded px-1.5 py-1 hover:bg-muted/70"
                    >
                      说明
                    </summary>
                    <div className="absolute right-3 top-12 z-10 max-h-[70vh] w-[min(90vw,36rem)] overflow-y-auto rounded border border-border bg-card p-3 shadow-lg">
                      <div className="font-medium text-foreground">计算口径与符号</div>
                      <div className="mt-1.5 space-y-1 leading-relaxed">
                        <div><span className="font-mono text-foreground">bᵢ = 已实现 P&amp;Lᵢ ÷ 最大预期亏损ᵢ</span>。只使用与实时胜率完全相同、且属于当前账户的有效战役。</div>
                        <div><span className="font-mono text-foreground">N</span> = 全部有效战役数；<span className="font-mono text-foreground">n_win</span> = bᵢ &gt; 0 的盈利战役数；<span className="font-mono text-foreground">n_loss</span> = bᵢ ≤ 0 的亏损战役数。</div>
                        <div>不做任何异常值剔除，bᵢ &lt; −1 的超额实亏完整保留。盈亏比为空的已结束战役整场排除，并在模块脚注明示数量。</div>
                      </div>

                      <div className="mt-3 space-y-2">
                        <div className="rounded border border-border/70 p-2">
                          <div className="font-medium text-foreground">1. DSI 下行纪律系数</div>
                          <div className="mt-1 font-mono text-foreground">DSI = √[Σ(bᵢ² | bᵢ ≤ 0) ÷ n_loss]</div>
                          <div className="mt-1 leading-relaxed">只在亏损组内计算每笔亏损 R 倍数的均方根。设计亏损都贴近 −1R 时，DSI 接近 1；超过 1 的部分反映止损或对冲委托被越过。越小越好：≤1.05 绿，1.05–1.15 黄，&gt;1.15 红。</div>
                        </div>

                        <div className="rounded border border-border/70 p-2">
                          <div className="font-medium text-foreground">2. USI 上行保留系数</div>
                          <div className="mt-1 font-mono text-foreground">USI = √[Σ(bᵢ² | bᵢ &gt; 0) ÷ n_win] ÷ [Σ(bᵢ | bᵢ &gt; 0) ÷ n_win]</div>
                          <div className="mt-1 leading-relaxed">盈利组的均方根除以盈利组均值，用来观察盈利分布是否仍保留少数大额右尾。若所有盈利几乎一样，分子与分母接近，USI 趋近 1；右尾越长，USI 越大。≥1.80 绿，1.50–1.80 黄，&lt;1.50 红。</div>
                        </div>

                        <div className="rounded border border-border/70 p-2">
                          <div className="font-medium text-foreground">3. 上行标准差 σ_u</div>
                          <div className="mt-1 font-mono text-foreground">σ_u = √[Σ max(bᵢ, 0)² ÷ N]</div>
                          <div className="mt-1 leading-relaxed">每场只保留正向 R 倍数，亏损场按 0 进入求和，最后除以全部有效战役数 N。它描述整个战役序列中的上行波动强度；对本策略而言右尾是产出，应关注它是否被保留，而不是机械压低。</div>
                        </div>

                        <div className="rounded border border-border/70 p-2">
                          <div className="font-medium text-foreground">4. 下行标准差 σ_d</div>
                          <div className="mt-1 font-mono text-foreground">σ_d = √[Σ min(bᵢ, 0)² ÷ N]</div>
                          <div className="mt-1 leading-relaxed">每场只保留负向 R 倍数，盈利场按 0 进入求和，分母仍是全部有效战役数 N。这是 MAR=0 的教科书 Sortino 口径，越小越好；它与只除以 n_loss 的 DSI 是不同口径，不能互换。</div>
                        </div>

                        <div className="rounded border border-border/70 p-2">
                          <div className="font-medium text-foreground">5. UPR 上行潜力比</div>
                          <div className="mt-1 font-mono text-foreground">U1 = Σ max(bᵢ, 0) ÷ N；UPR = U1 ÷ σ_d</div>
                          <div className="mt-1 leading-relaxed">U1 是每场战役贡献的平均正向 R，上行只进入分子；σ_d 只度量下行并进入分母。UPR 因此直接衡量每单位下行波动换来了多少上行潜力，越大越好，是本模块主指标。</div>
                        </div>

                        <div className="rounded border border-border/70 p-2">
                          <div className="font-medium text-foreground">6. Omega 比率</div>
                          <div className="mt-1 font-mono text-foreground">D1 = Σ max(−bᵢ, 0) ÷ N；Omega = U1 ÷ D1</div>
                          <div className="mt-1 leading-relaxed">D1 是每场战役贡献的平均负向 R 绝对值。Omega 比较累计上行与累计下行：等于 1 为盈亏平衡，大于 1 表示上行总量超过下行总量，越大越好。</div>
                        </div>
                      </div>

                      <div className="mt-3 rounded bg-muted/60 p-2 leading-relaxed">
                        <div className="font-medium text-foreground">Sortino 对照与恒等式</div>
                        <div className="mt-1 font-mono text-foreground">Sortino = (U1 − D1) ÷ σ_d</div>
                        <div className="mt-1 font-mono text-foreground">Sortino ≡ UPR − D1 ÷ σ_d</div>
                        <div className="mt-1">系统逐次校验两边是否一致，用来发现样本池、分母或符号口径漂移。</div>
                      </div>

                      <div className="mt-3 border-t border-border/70 pt-2 leading-relaxed">
                        <div className="font-medium text-foreground">空值与样本提示</div>
                        <div className="mt-1">无亏损样本时，DSI、σ_d、UPR、Omega、Sortino 显示「—」；无盈利样本时，USI、σ_u、U1、UPR、Omega 显示「—」。任何除数为 0 也返回「—」，不会显示 0 或 ∞。</div>
                        <div className="mt-1">n_loss &lt; 5 或 n_win &lt; 5 时仍显示可计算结果，同时加灰色「样本不足 n=X」角标。</div>
                      </div>
                    </div>
                  </details>
                </div>
                <div className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
                  <div className="col-span-1 bg-card px-4 py-3 sm:col-span-2">
                    <div className="text-muted-foreground">UPR 上行潜力比</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{formatAsymmetricMetric(asymmetricRisk.upr, 3)}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">U1 ÷ σ_d，越大越好</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {asymmetricRisk.winCount < 5 ? <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">盈利样本不足 n={asymmetricRisk.winCount}</span> : null}
                      {asymmetricRisk.lossCount < 5 ? <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">亏损样本不足 n={asymmetricRisk.lossCount}</span> : null}
                    </div>
                  </div>
                  <div className="col-span-1 bg-card px-4 py-3 sm:col-span-2">
                    <div className="text-muted-foreground">Omega 比率</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{formatAsymmetricMetric(asymmetricRisk.omega, 3)}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">U1 ÷ D1，1 为盈亏平衡线</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {asymmetricRisk.winCount < 5 ? <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">盈利样本不足 n={asymmetricRisk.winCount}</span> : null}
                      {asymmetricRisk.lossCount < 5 ? <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">亏损样本不足 n={asymmetricRisk.lossCount}</span> : null}
                    </div>
                  </div>
                  <div className="bg-card px-4 py-3">
                    <div className="text-muted-foreground">DSI 下行纪律</div>
                    <div className={`mt-1 text-base font-semibold ${dsiTone(asymmetricRisk.dsi)}`}>{formatAsymmetricMetric(asymmetricRisk.dsi, 3)}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">≤1.05 稳定，&gt;1.15 警戒</div>
                    {asymmetricRisk.lossCount < 5 ? <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">样本不足 n={asymmetricRisk.lossCount}</span> : null}
                  </div>
                  <div className="bg-card px-4 py-3">
                    <div className="text-muted-foreground">USI 上行保留</div>
                    <div className={`mt-1 text-base font-semibold ${usiTone(asymmetricRisk.usi)}`}>{formatAsymmetricMetric(asymmetricRisk.usi, 3)}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">≥1.80 健康，&lt;1.50 警戒</div>
                    {asymmetricRisk.winCount < 5 ? <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">样本不足 n={asymmetricRisk.winCount}</span> : null}
                  </div>
                  <div className="bg-card px-4 py-3">
                    <div className="text-muted-foreground">上行标准差 σ_u</div>
                    <div className="mt-1 text-base font-semibold text-foreground">{formatAsymmetricMetric(asymmetricRisk.upsideStandardDeviation, 3)}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">全样本 N 为分母，守住右尾</div>
                    {asymmetricRisk.winCount < 5 ? <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">样本不足 n={asymmetricRisk.winCount}</span> : null}
                  </div>
                  <div className="bg-card px-4 py-3">
                    <div className="text-muted-foreground">下行标准差 σ_d</div>
                    <div className="mt-1 text-base font-semibold text-foreground">{formatAsymmetricMetric(asymmetricRisk.downsideStandardDeviation, 3)}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">全样本 N 为分母，越小越好</div>
                    {asymmetricRisk.lossCount < 5 ? <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">样本不足 n={asymmetricRisk.lossCount}</span> : null}
                  </div>
                </div>
                <div className="space-y-1 border-t border-border/70 px-4 py-3 text-[10px] text-muted-foreground">
                  <div className="grid grid-cols-3 gap-2 font-mono">
                    <span>U1 {formatAsymmetricMetric(asymmetricRisk.upsidePotential, 3)}</span>
                    <span>D1 {formatAsymmetricMetric(asymmetricRisk.downsidePotential, 3)}</span>
                    <span>Sortino {formatAsymmetricMetric(asymmetricRisk.sortino, 3)}</span>
                  </div>
                  <div className="font-mono">
                    校验：Sortino = UPR − D1/σ_d
                    {asymmetricRisk.sortino != null && asymmetricRisk.sortinoIdentityRhs != null
                      ? `（${Math.abs(asymmetricRisk.sortino - asymmetricRisk.sortinoIdentityRhs) < 1e-12 ? '通过' : '异常'}）`
                      : '（—）'}
                  </div>
                  <div>口径：{asymmetricRisk.sampleCount} 场有效战役，其中盈利 {asymmetricRisk.winCount} 场 / 亏损 {asymmetricRisk.lossCount} 场</div>
                  {asymmetricRisk.excludedPayoffCount > 0 ? <div>另有 {asymmetricRisk.excludedPayoffCount} 场已结束战役因盈亏比未回填而排除。</div> : null}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          </div>
          {selectionMode && narrowViewport && renderBatchSelectionBar(true)}
          {metricChartOpen ? (
            <div
              ref={metricChartPanelRef}
              id="campaign-odds-scatter-panel"
              data-testid="campaign-odds-scatter-panel"
              // isolate：面板自成层叠上下文。图里提示框（z-20）、合并三角（z-10）只在面板内部比层级，
              // 往下翻时整块面板都在吸顶的统计与排序区（sticky z-10）底下，提示框不会画到吸顶区上面。
              className="order-3 isolate border-t border-border/70 bg-background/35"
            >
              <div id="campaign-metric-scatter-view">
                <div className="h-5 px-4 text-right text-[10px] text-muted-foreground" role="status">
                  {campaignRowsComplete && refreshing ? '正在更新数据…' : ''}
                </div>
                {familyViewOptions.length > 1 ? (
                  // 视图切换键放在面板层而不是图表表头：空序列时元件只渲染空态、没有表头，
                  // 切换键仍要在。切换直接改键与 URL，不走 toggle（同键会关图）。
                  // 选项由同族配置自动生成：新增一种看法只要多写一条配置，不必再动这里。
                  <div className="flex items-center justify-end px-3 pt-2 sm:px-4">
                    <div
                      role="group"
                      aria-label={`${familySourceLabel}视图`}
                      data-testid={`campaign-${openSourceKey}-view-switch`}
                      className="inline-flex shrink-0 overflow-hidden rounded border border-[color:var(--chart-border)] text-[9px] text-[color:var(--chart-ink-muted)]"
                    >
                      {familyViewOptions.map(option => {
                        const pressed = selectedMetricConfig.key === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            data-testid={option.viewTestId}
                            aria-pressed={pressed}
                            onClick={() => {
                              if (pressed) return;
                              setMetricChartKey(option.key);
                              updateChartParam(option.key);
                            }}
                            className={`px-2 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${
                              pressed
                                ? 'bg-[color:var(--chart-surface-raised)] font-medium text-[color:var(--chart-ink)]'
                                : 'hover:text-[color:var(--chart-ink)]'
                            }`}
                          >
                            {option.viewLabel}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {campaignRowsComplete ? (
                  <MemoCampaignMetricScatterPlot
                    key={selectedMetricConfig.key}
                    points={selectedMetricSeries.points}
                    metricKey={selectedMetricConfig.key}
                    metricLabel={selectedMetricConfig.label}
                    // 轴上写这一族的名字（「几何期望」），而不是这张图的名字（「几何期望分布」）
                    axisLabel={familySourceLabel}
                    seriesLabel={selectedMetricConfig.seriesLabel}
                    guide={selectedMetricConfig.guide}
                    formatValue={selectedMetricConfig.formatValue}
                    missingValueLabel={selectedMetricConfig.missingValueLabel}
                    excludedMissingValueCount={selectedMetricSeries.excludedMissingValueCount}
                    excludedMissingOperationTimeCount={selectedMetricSeries.excludedMissingOperationTimeCount}
                    colorMode={selectedMetricConfig.colorMode}
                    legacyOddsTestIds={selectedMetricConfig.key === 'odds'}
                    view={selectedMetricConfig.view ?? 'time'}
                    distributionSpec={selectedMetricConfig.distribution}
                    onBack={handleChartBack}
                    onSelectCampaign={handleCampaignOpen}
                    selectionMode={selectionMode}
                    selectedCampaignIds={selectedCampaignIds}
                    onToggleCampaign={toggleExportSelection}
                  />
                ) : campaignLoadError ? null : (
                  <div
                    data-testid="campaign-metric-loading"
                    className="mx-auto flex min-h-[22rem] w-full max-w-[58rem] flex-col items-center justify-center gap-3 px-6 text-center"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="text-[12px] font-medium text-foreground">正在准备完整散点图…</div>
                    <div className="h-1.5 w-full max-w-72 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                        style={{
                          width: `${campaignLoadProgress.total > 0
                            ? Math.round((campaignLoadProgress.loaded / campaignLoadProgress.total) * 100)
                            : 0}%`,
                        }}
                      />
                    </div>
                    <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {campaignLoadProgress.total > 0
                        ? `${campaignLoadProgress.loaded} / ${campaignLoadProgress.total} 场`
                        : '正在读取战役目录'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
          </div>
        </section>

        {loading ? (
          <div className="border border-border rounded p-10 text-center text-[12px] text-muted-foreground">加载中…</div>
        ) : sortedRows.length === 0 ? (
          <div className="border border-border rounded p-10 text-center space-y-2">
            <div className="mx-auto w-10 h-10 rounded-full bg-accent flex items-center justify-center">
              <Layers className="w-5 h-5 text-muted-foreground" />
            </div>
            {/* 空列表有三种原因，不能都说成「尚无战役」：时间段筛空了、当前排序口径筛空了、真的一场都没有。 */}
            {!isAllRange(operationRange) && scopedRows.length === 0 ? (
              <>
                <div className="text-[13px] font-medium" data-testid="campaign-empty-range">
                  {describeOperationRange(operationRange)} 内没有战役
                </div>
                <div className="text-[12px] text-muted-foreground">
                  整表共 {rows.length} 场。换一个时间段，或点上方「操作时间」选回全部。
                </div>
              </>
            ) : (
              <>
                <div className="text-[13px] font-medium">
                  {SORT_EMPTY_HINTS[primarySort.mode] && scopedRows.length > 0
                    ? `暂无${SORT_EMPTY_HINTS[primarySort.mode]!.noun}的战役`
                    : '尚无战役'}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  {SORT_EMPTY_HINTS[primarySort.mode] && scopedRows.length > 0
                    ? SORT_EMPTY_HINTS[primarySort.mode]!.hint
                    : '你下次开主力单时会自动创建第一个战役'}
                </div>
              </>
            )}
          </div>
        ) : (
          // 列宽变量挂在列表容器上：每张卡的同名项读同一个宽度，上下对齐；宽度随时间段里的战役变（不随排序变），卡片本身不重画。
          <div data-testid="campaign-card-list" style={cardMetricWidths}>
            {sortedRows.map(row => (
              <CampaignCard
                key={row.campaign.id}
                row={row}
                sortHighlight={sortHighlight}
                expanded={expandedCampaignIds.has(row.campaign.id)}
                busy={busyCampaignId === row.campaign.id}
                isOwnCampaign={row.campaign.user_id === userId}
                campaignAccountName={campaignAccountName}
                selectionMode={selectionMode}
                selected={selectedCampaignIds.has(row.campaign.id)}
                onToggleSelection={toggleExportSelection}
                onOpen={handleCampaignOpen}
                onToggleDetails={handleCampaignDetailsToggle}
                onImportanceChange={handleImportanceChange}
                onDelete={handleDeleteCampaign}
              />
            ))}
          </div>
        )}
      </main>
      {selectionMode && !selectionBarInView && !exportTargets && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div
            ref={dockRef}
            data-testid="campaign-batch-dock"
            role="toolbar"
            aria-label="批量下载：已选战役"
            className="pointer-events-auto inline-flex h-10 items-center gap-1 rounded-md border border-[#F0B90B]/35 bg-background/95 pl-3 pr-1 text-[10px] text-muted-foreground shadow-[0_10px_28px_-6px_rgba(15,23,42,0.28)] backdrop-blur-md"
          >
            {/* 不再设 aria-live：选择条仍挂在页面上、它的计数已经播报过，这里重复播报只会念两遍 */}
            <span className="inline-flex shrink-0 select-none items-center gap-1.5 pr-1 font-medium text-foreground/70">
              <ListChecks aria-hidden="true" className="h-3.5 w-3.5 text-[#C98500] dark:text-[#F0B90B]" />
              已选
              <span className="font-mono text-[11px] tabular-nums text-foreground">{selectedExportTargets.length}</span>
              场
            </span>
            <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" />
            <button type="button" className={`${BATCH_BAR_BUTTON} border-transparent bg-transparent`} onClick={exitSelectionMode} title="退出选择模式（Esc）；已选的战役保留">
              <X aria-hidden="true" className="h-3 w-3" />退出选择
            </button>
            <button
              type="button"
              disabled={!selectedExportTargets.length || !campaignRowsComplete}
              ref={dockExportButtonRef}
              onClick={() => openExportDialog('dock')}
              data-testid="campaign-batch-dock-export"
              className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded bg-[#F0B90B] px-2.5 text-[11px] font-medium text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download aria-hidden="true" className="h-3.5 w-3.5" />
              下载选中
              <span className="font-mono tabular-nums">{selectedExportTargets.length}</span>
            </button>
          </div>
        </div>
      )}
      {exportTargets && userId && (
        <BatchExportLoadBoundary key={userId} onError={handleExportDialogLoadError}>
          <Suspense fallback={<div role="status" className="fixed bottom-5 right-5 z-50 rounded border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground shadow-md">正在准备批量下载…</div>}>
            <LazyCampaignBatchExportDialog
              campaigns={exportTargets}
              userId={userId}
              currentAccountEquity={currentAccountEquity}
              onClose={handleExportDialogClose}
              onReturnFocus={returnFocusAfterExport}
            />
          </Suspense>
        </BatchExportLoadBoundary>
      )}
      <Dialog open={deletedOpen} onOpenChange={open => void handleDeletedOpenChange(open)}>
        <DialogContent className="max-h-[78vh] max-w-2xl overflow-hidden border-border bg-background p-0 sm:rounded-md">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2 text-[14px] font-medium">
              <ArchiveRestore className="h-4 w-4 text-muted-foreground" />
              已删除战役
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              删除的战役不会进入列表与统计；恢复后会回到原来的战役记录。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto px-5 py-2">
            {deletedLoading ? (
              <div className="py-12 text-center text-[12px] text-muted-foreground">加载中…</div>
            ) : deletedCampaigns.length === 0 ? (
              <div className="py-12 text-center">
                <ArchiveRestore className="mx-auto h-5 w-5 text-muted-foreground/45" />
                <div className="mt-2 text-[12px] text-muted-foreground">暂无已删除战役</div>
              </div>
            ) : (
              deletedCampaigns.map(campaign => (
                <div
                  key={campaign.id}
                  data-testid="deleted-campaign-row"
                  className="flex flex-col gap-3 border-b border-border/70 py-3 last:border-b-0 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[12px] font-medium">{campaign.title}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                        {formatCampaignDisplayCode(
                          campaign.campaign_code,
                          campaignAccountName,
                          campaign.id,
                        )}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>{campaign.symbol}</span>
                      <span>删除于 {fmtDeletedTime(campaign.deleted_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    <button
                      type="button"
                      disabled={deletedBusyId != null}
                      onClick={() => void handleRestoreCampaign(campaign)}
                      data-testid={`restore-campaign-${campaign.id}`}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-[11px] text-foreground/80 transition-colors hover:bg-accent disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      恢复
                    </button>
                    <button
                      type="button"
                      disabled={deletedBusyId != null}
                      title="永久删除"
                      aria-label={`永久删除 ${campaign.title}`}
                      onClick={() => void handlePermanentDeleteCampaign(campaign)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:bg-[#F6465D]/10 hover:text-[#F6465D] disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
