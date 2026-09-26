import { HEDGE_TYPE_LABELS } from '@/lib/hedgeTypes';
import {
  buildTradeRecordLookup,
  campaignOperationTime,
  journalOperationTime,
} from '@/lib/objectiveOperationTime';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import { LEG_ROLE_NEUTRAL_COLOR, LEG_ROLE_TONE_COLORS, legRoleExportTextColor } from '@/lib/legRoleTone';
import { legRowStatus, type LegFillEvidence } from '@/lib/legRowStatus';
import { isLiquidationRecord } from '@/lib/liquidationRecord';
import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { buildLegPositionShareInputs } from '@/lib/legPositionShareInputs';
import { resolveLegExecutionMethods, shouldHighlightLegExecution, type LegExecutionMethod } from '@/lib/legExecutionMethod';
import { resolveMirrorCloseRatio } from '@/lib/mirrorExecutionMethod';
import { computeInitialMainExposureNotional } from '@/lib/campaignAnalysis';
import { formatCampaignLeverage, resolveCampaignMainLeverage } from '@/lib/campaignMetrics';
import { formatCampaignDisplayCode } from '@/lib/campaignCode';
import { buildDisplayReverseOrderLegMap } from '@/lib/campaignReverseOrderAttribution';
import { formatFeeCoin, sumTradeRecordFees, tradeRecordFees } from '@/lib/tradeFees';
import { buildHedgeLegOrdinals, buildMainLegOrdinals, resolveLegDisplayRole } from '@/lib/campaignMainLegOrdinals';
import { resolveMirrorTpOrderTiming } from '@/lib/campaignMirrorTpOrderTiming';
import { computeLegPnlContributions } from '@/lib/campaignLegPnl';
import { computeCampaignRealizedPnl, settlementBasisLabel } from '@/lib/campaignRealizedPnl';
import { formatDeltaB, legDeltaB, legSupportsPhases, roundedDeltaB, splitMainLegPhases, visibleLegPhases } from '@/lib/campaignLegPhases';
import {
  computeLegPriceChangePct,
  formatLegPriceChangePct,
  legPriceChangeDirection,
} from '@/lib/legPriceChange';
import {
  computeLegPositionShares,
  formatLegCoinQuantity,
  formatLegNotional,
  formatLegPositionSharePct,
  formatLegPositionShareTotal,
  resolveLegPositionShareSide,
  LEG_POSITION_SHARE_COLUMN_TITLES,
  LEG_POSITION_SIDE_COLORS,
  LEG_POSITION_SIDE_LABELS,
  type LegPositionShareEntry,
  type LegPositionShareInput,
  type LegPositionShares,
  type LegPositionSide,
} from '@/lib/legPositionShare';
import {
  addSizingSnapshotLines,
  evaluateCampaignAddSizing,
  formatAddSizingCoinQuantity,
  formatAddSizingNotional,
} from '@/lib/campaignAddSizingCheck';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { EmotionDiaryExportSummary } from '@/types/emotionDiary';
import { formatForeignReplayOrdersNote } from '@/lib/campaignReverseOrderLines';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

type ExportInput = {
  campaign: TradeCampaign;
  /** Δb 列的分母：战役初始最大预期亏损 L。 */
  initialExpectedMaxLoss?: number | null;
  accountName?: string | null;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  reverseHedgeOrders: CampaignReverseHedgeOrder[];
  /** 操作方式证据含隐藏委托；不改变「委托」列本身的显示范围。 */
  executionMethodOrders?: CampaignReverseHedgeOrder[];
  /** 别的回放留下、本场期间仍挂着的委托：不进任何腿的行，表尾合计之后画一行淡注（与页面同源）。 */
  foreignLiveOrders?: CampaignReverseHedgeOrder[];
  legExitPriceCorrections?: LegExitPriceCorrections;
  /** 本地委托快照证明从未成交的 id：「挂单中」按成交判定的负证据，与页面同一份（legRowStatus）。 */
  unfilledOrderIds?: ReadonlySet<string>;
};

/** 「挂单中」按成交判定的凭据：与页面 CampaignLegsList 同一份（完整委托列表、事件流、本地从未成交的 id）。 */
function exportFillEvidence(
  input: Pick<ExportInput, 'campaign' | 'reverseHedgeOrders' | 'executionMethodOrders' | 'unfilledOrderIds'>,
): LegFillEvidence {
  return {
    unfilledOrderIds: input.unfilledOrderIds,
    orders: input.executionMethodOrders ?? input.reverseHedgeOrders,
    events: input.campaign.actual_evolution,
  };
}

export type CampaignBoardExportInput = ExportInput & {
  chartElement?: HTMLElement | null;
  chartInterval: string;
  pnlOverview: {
    items: CampaignBoardPnlItem[];
    note?: string;
  };
  emotionDiary?: EmotionDiaryExportSummary | null;
  /** 页面上情绪日记折叠着时为 true：导出图跟着只画标题栏，不画日记正文与量表。 */
  emotionDiaryCollapsed?: boolean;
  /** 不传时导出全部模块；单个模块仅在显式 false 时关闭。 */
  sections?: CampaignBoardExportSections;
  /** 批量导出共用同一导出时刻，避免每张图的时间随生成进度变化。 */
  exportedAt?: string;
  /** 单张默认为当前视图；批量完整战役视图可显式说明，避免误导。 */
  chartViewLabel?: string;
  /**
   * 勾了 K 线盘面、但这段时间交易所没有 K 线（批量导出里的新币 / 已下架合约）：
   * 不截图、不报错，盘面位置画一块说明，其余模块照常导出。
   */
  chartUnavailableNote?: string;
};

export type CampaignBoardExportSections = {
  metadata?: boolean;
  overview?: boolean;
  emotionDiary?: boolean;
  chart?: boolean;
  legs?: boolean;
};

export type CampaignBoardPnlItem = {
  key: string;
  label: string;
  value: string;
  color?: string;
  /** 排在右栏（盈亏概览的递进链）；导出图与页面一样按栏从上往下排。 */
  rightColumn?: boolean;
};

export type CampaignLegsExportCellLine = {
  text: string;
  color?: string;
  bold?: boolean;
  /**
   * 字号（px）。缺省 13——三个数值列靠它拉开主次：Δb 16 / 盈亏 13 / 手续费 11。
   * 超过 16 的（加仓校验的红叉）行高跟着撑开，见 exportLineHeight。
   */
  size?: number;
  /**
   * 行首的方向标签（「多」绿 /「空」红，与页面同色），与正文分开着色：正文（合计数）仍是中性色。
   * 只挂在合计行「币量 / 仓位」格每组 Σ 的上行。hidden 为 true 时只占位不画——同一组的下一行借它把数字与上一行的数字对齐。
   */
  tag?: CampaignLegsExportCellTag;
  /**
   * 把这一行画成角色标签（与页面同样的样子）：同色淡底圆角；hollow 为挂单中的虚线空心标签，
   * dot 为进行中标签文字后面的实心小圆点，flag 为爆仓时标签文字后面那两个红字。
   * 正文（角色名）用 color 着色，按标签的内边距右移。
   */
  chip?: CampaignLegsExportChip;
  /** 正文左缩进（px）：阶段子行的「阶段 N」与主力角色标签里的字对齐（= 标签左内边距），与页面的缩进一致。 */
  indent?: number;
  /** 状态与（开）/（平）分开绘制，固定两列位置；不因「未记录」多一个字而错位。 */
  operation?: { action: '开' | '平'; label: string };
};

export type CampaignLegsExportChip = {
  /** 标签主色：底色取它的 10%，虚线描边与小圆点直接用它。 */
  color: string;
  hollow?: boolean;
  dot?: boolean;
  /** 爆仓：标签文字后面一枚红色小字（与页面同一枚），文本恒为「爆仓」。 */
  flag?: string;
};

export type CampaignLegsExportCellTag = {
  text: string;
  color: string;
  hidden?: boolean;
};

export type CampaignLegsExportRow = {
  legId: string;
  /**
   * 腿本身 / 主力阶段子行 / 表尾合计 / 表下淡注。合计行画一道加粗上框，与页面一致。
   * note 行只有一格、横跨整张表宽（他场委托的说明），不按列排。
   */
  kind: 'leg' | 'phase' | 'total' | 'note';
  /** 逻辑行：每格「一条信息一行」，与页面同构；读数与测试都以它为准。 */
  cells: CampaignLegsExportCellLine[][];
  /** 按列宽折好的实际绘制行。行高由它决定——放不下的字折到下一行，而不是被画布横向压扁。 */
  wrapped: CampaignLegsExportCellLine[][];
  height: number;
};

type RenderedCanvas = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  scale: number;
};

type LegsCanvasOptions = {
  includeHeader?: boolean;
  scale?: number;
};

const COLUMNS = [
  // 与页面一样，第一列只有「角色」：不印腿的序号，也不挂「回填」；没平仓的腿把角色标签画成空心（挂单中）或带小圆点（进行中）。
  // 152：最长的「重新入场主力 2」标签带上小圆点也一行放下
  { title: '角色', width: 152 },
  // 300：主力阶段子行的「2026-08-07 19:41 → 2026-08-08 13:00」要一行放下，别把时刻和日期拆开
  { title: '时间', width: 300 },
  { title: '贡献 / 盈亏', width: 150 },
  { title: 'Δb', width: 104 },
  { title: '开仓价', width: 118 },
  { title: '平仓价', width: 118 },
  // 开 / 平各一行；业务显示约定与页面一致，仅手动对冲开仓突出，未成交且无来源时仍写「未记录」。
  { title: '操作方式', width: 102 },
  // 120：留 100px 文字宽，「+199900.00%」「+1234567.89%」这种千倍以上的涨跌幅也一行放下——拆成两截的百分数最难读
  { title: '涨跌幅', width: 120 },
  // 184：十亿级币量带两位小数（1,171,163,720.54）要一行放下，合计行的 Σ币量还可能多一位
  // （百亿级 11,981,041,835.39，17 个字符），前面再挂一枚「多 / 空」标签也得一行放下——拆成两截的数字比挤一点更难读
  { title: '币量 / 仓位', width: 184 },
  // 88：留 68px 文字宽，「100.0%」（13px 约 47px）与列头「多单占比」/「空单占比」（12px 粗体 48px）都一行放下。
  // 与页面一样只有这一列占比，且按战役主方向取一侧：主多看多单、主空看空单（表头的列名由 drawLegsTable 按那一侧写，见 SHARE_COLUMN_INDEX）
  { title: LEG_POSITION_SHARE_COLUMN_TITLES.long, width: 88 },
  // 170：红叉下面把 Plan B 正确上限的币量与 U 名义仓位都写清。
  { title: '加仓校验', width: 170 },
  { title: '手续费', width: 132 },
  { title: '委托', width: 444 },
] as const;

/**
 * 占比列在 COLUMNS 里的位置：宽度与别的列一样固定，只有**表头的列名**跟着战役主方向变
 * （主多「多单占比」、主空「空单占比」，两个都是四个汉字，宽度不变）。
 */
const SHARE_COLUMN_INDEX = COLUMNS.findIndex(column => column.title === LEG_POSITION_SHARE_COLUMN_TITLES.long);
const EXECUTION_METHOD_COLUMN_INDEX = COLUMNS.findIndex(column => column.title === '操作方式');

const TABLE_WIDTH = COLUMNS.reduce((sum, column) => sum + column.width, 0);
const MARGIN_X = 40;
const HEADER_H = 88;
const TABLE_HEADER_H = 38;
const ROW_PAD_Y = 12;
const LINE_H = 17;
const FOOTER_H = 24;
const BOARD_HEADER_H = 92;
const BOARD_OVERVIEW_MIN_H = 154;
const BOARD_SECTION_GAP = 18;
/**
 * 分区标题（「K 线盘面…」「Legs 列表…」）占的高度：标题基线在 +18，下方白框从 -10 起画，
 * 留到 36 才让白框顶边落在基线下 8px；原来的 28 让白框正好压在基线上，把字的下半截盖掉。
 */
const BOARD_SECTION_LABEL_H = 36;
const BOARD_FOOTER_H = 34;
const MAX_CANVAS_SIDE_PX = 32_000;
const MAX_CANVAS_AREA_PX = 180_000_000;

function campaignOutcomeSlug(status: TradeCampaign['status']): string {
  if (status === 'closed_profit') return 'profit';
  if (status === 'closed_loss') return 'loss';
  if (status === 'closed_breakeven') return 'breakeven';
  if (status === 'abandoned') return 'abandoned';
  return status;
}

function dateSlug(value: string | null): string {
  if (!value) return 'unknown-date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown-date';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function campaignKlineTitleName(campaign: TradeCampaign): string {
  return `${campaign.symbol} ${dateSlug(campaign.opened_at)} ${campaignOutcomeSlug(campaign.status)}`;
}

function campaignExportFileBaseName(campaign: TradeCampaign, accountName?: string | null): string {
  const code = formatCampaignDisplayCode(campaign.campaign_code, accountName, campaign.id);
  return code ? `${campaignKlineTitleName(campaign)} 编号 ${code}` : campaignKlineTitleName(campaign);
}

function safeFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function fmtAmount(value: number | null | undefined, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(2)}${suffix}`;
}

function fmtCampaignDuration(start: string, end: string | null): string {
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return '—';
  const minutes = Math.max(0, Math.floor((to - from) / 60_000));
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

/** 状态的中文标签。详情页页眉与导出图的「方向 / 状态」共用，两处不能各写一套。 */
export function campaignStatusLabel(status: TradeCampaign['status']): string {
  if (status === 'closed_profit') return '盈利结束';
  if (status === 'closed_loss') return '亏损结束';
  if (status === 'closed_breakeven') return '平盈结束';
  if (status === 'abandoned') return '已放弃';
  // 页头状态标签也读这里：计划中的战役不能被写成「进行中」
  if (status === 'planned') return '计划中';
  return '进行中';
}

export function formatCampaignChartInterval(interval: string): string {
  const normalized = interval.trim();
  const match = normalized.match(/^(\d+)([mhdwM])$/);
  if (!match) return normalized || '—';
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return `${amount}分钟线`;
  if (unit === 'h') return `${amount}小时线`;
  if (unit === 'd') return amount === 1 ? '日线' : `${amount}日线`;
  if (unit === 'w') return amount === 1 ? '周线' : `${amount}周线`;
  return amount === 1 ? '月线' : `${amount}月线`;
}

function campaignLegCounts(legs: TradeJournal[]) {
  const main = legs.filter(leg =>
    leg.leg_role === 'main_open'
    || leg.leg_role === 'reentry_main'
    || leg.leg_role?.startsWith('main_add_'),
  ).length;
  const hedge = legs.filter(leg => leg.leg_role?.startsWith('hedge_')).length;
  const tp = legs.filter(leg => leg.leg_role === 'mirror_tp').length;
  return { main, hedge, tp, other: Math.max(0, legs.length - main - hedge - tp) };
}

/**
 * 涨跌幅格：与页面同一个 helper、同一对价（含平仓价校正）、同一个方向。正绿负红；取整为 0 用中性色，缺值淡灰。
 * 按这条腿的方向计——空单价格跌了才是正数，按所示这一对开平价看与「贡献 / 盈亏」同号
 * （分几刀平掉时平仓价取最后一刀、盈亏是各刀合计，可能不同号）；阶段子行沿用主力的方向。
 */
function priceChangeCell(
  entryPrice: number | null | undefined,
  exitPrice: number | null | undefined,
  side: 'long' | 'short',
  neutralColor: string,
): CampaignLegsExportCellLine[] {
  const pct = computeLegPriceChangePct(entryPrice, exitPrice, side);
  const direction = legPriceChangeDirection(pct);
  return [{
    text: formatLegPriceChangePct(pct),
    color: direction === 'up' ? '#0ECB81' : direction === 'down' ? '#F6465D' : direction === 'flat' ? neutralColor : '#848E9C',
  }];
}

/**
 * 「币量 / 仓位」与「占比」的一组两行：上行（tagSide 给出时前挂彩色「多 / 空」标签）+ 下行淡色。
 * 下行挂一枚隐藏标签占位，两行的数字左端对齐。topColor 缺省为正文前景色（腿行），合计行传淡色。
 */
function positionShareLines(
  tagSide: LegPositionSide | null,
  top: string,
  bottom: string,
  topColor: string | undefined,
): CampaignLegsExportCellLine[] {
  const tag = tagSide ? { text: LEG_POSITION_SIDE_LABELS[tagSide], color: LEG_POSITION_SIDE_COLORS[tagSide] } : null;
  return [
    { text: top, ...(topColor ? { color: topColor } : {}), ...(tag ? { tag } : {}) },
    { text: bottom, color: '#848E9C', ...(tag ? { tag: { ...tag, hidden: true } } : {}) },
  ];
}

const EMPTY_CELL: CampaignLegsExportCellLine[] = [{ text: '' }];

function executionMethodCellLine(
  leg: Pick<TradeJournal, 'order_kind' | 'leg_role'>,
  action: '开' | '平',
  method: LegExecutionMethod,
): CampaignLegsExportCellLine {
  const highlight = shouldHighlightLegExecution(leg, action === '开' ? 'open' : 'close', method);
  return {
    text: `${method.label}（${action}）`,
    color: highlight ? '#A66B12' : method.kind === 'unknown' ? '#B4BBC5' : '#848E9C',
    bold: highlight,
    size: 11,
    operation: { action, label: method.label },
  };
}

/**
 * 腿行的「占比」格（与页面同源）：上行币量占比、下行名义仓位占比，只有本列那一侧（战役主方向）的行有数；
 * 另一侧的行一格空白（它不算占比，也不进分母）；行里不挂标签（列头已写明方向）。挂单中的腿两行「—」。
 */
function legShareCell(position: LegPositionShareEntry | undefined, side: LegPositionSide): CampaignLegsExportCellLine[] {
  if (position?.side !== side) return EMPTY_CELL;
  return positionShareLines(
    null,
    formatLegPositionSharePct(position.coinSharePct),
    formatLegPositionSharePct(position.notionalSharePct),
    undefined,
  );
}

/**
 * 合计行的「占比」格（与页面同源）：写本列那一侧那组的「100.0%」，与「币量 / 仓位」格里同方向那组 Σ 同一行——
 * Σ 固定先多后空，排在它之前的每一组先垫两行空白（主空战役看空单，就要垫多单那一组）；
 * 这一侧没有计入腿时一格空白；两个方向都没有时两行「—」。
 */
function totalShareCell(shares: LegPositionShares, side: LegPositionSide): CampaignLegsExportCellLine[] {
  if (shares.sides.length === 0) return positionShareLines(null, '—', '—', '#5F6B7A');
  const at = shares.sides.findIndex(totals => totals.side === side);
  if (at < 0) return EMPTY_CELL;
  return [
    ...shares.sides.slice(0, at).flatMap((): CampaignLegsExportCellLine[] => [{ text: '' }, { text: '' }]),
    ...positionShareLines(
      null,
      formatLegPositionShareTotal(shares.bySide[side].totalCoins),
      formatLegPositionShareTotal(shares.bySide[side].totalNotional),
      '#5F6B7A',
    ),
  ];
}

function statusForReverseOrder(order: CampaignReverseHedgeOrder): string {
  if (order.status === 'pending') return '挂单中';
  if (order.status === 'triggered') return '已触发';
  return '已撤';
}

/** 格内左右留白（px），绘制与折行共用，两边不许各算各的。 */
const CELL_PAD_X = 10;

function cellFont(line: CampaignLegsExportCellLine): string {
  return `${line.bold ? 700 : 500} ${line.size ?? 13}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
}

let sharedMeasureContext: CanvasRenderingContext2D | null | undefined;
function measureContext(): CanvasRenderingContext2D | null {
  if (sharedMeasureContext !== undefined) return sharedMeasureContext;
  try {
    sharedMeasureContext = typeof document === 'undefined'
      ? null
      : document.createElement('canvas').getContext('2d') ?? null;
  } catch {
    sharedMeasureContext = null;
  }
  return sharedMeasureContext;
}

/** 方向标签与正文之间的空隙（px）。 */
const TAG_GAP = 6;

/** 标签用同字号加粗画。 */
function tagFontLine(line: CampaignLegsExportCellLine): CampaignLegsExportCellLine {
  return { ...line, bold: true };
}

/** 与绘制同字体量宽；拿不到画布（测试环境）时按等宽字估：CJK 1em、其余 0.62em。 */
function cellTextWidth(text: string, line: CampaignLegsExportCellLine): number {
  const ctx = measureContext();
  if (ctx) {
    ctx.font = cellFont(line);
    return ctx.measureText(text).width;
  }
  const size = line.size ?? 13;
  let width = 0;
  for (const character of text) width += /[\u3000-\u9fff\uff00-\uffef]/.test(character) ? size : size * 0.62;
  return width;
}

/** 正文前被标签占掉的宽度：方向标签（隐藏的也占位）+ 空隙，或角色标签的左内边距；都没有为 0。绘制与折行共用。 */
function tagOffset(line: CampaignLegsExportCellLine): number {
  if (line.chip) return CHIP_PAD_X;
  return line.tag ? cellTextWidth(line.tag.text, tagFontLine(line)) + TAG_GAP : line.indent ?? 0;
}

/** 角色标签：字号、左右内边距、高度、圆角，以及「进行中」小圆点的直径与它前面的空隙。 */
const ROLE_CHIP_FONT_SIZE = 12;
const CHIP_PAD_X = 8;
const CHIP_H = 20;
const CHIP_RADIUS = 4;
const CHIP_DOT = 6;
const CHIP_DOT_GAP = 5;
/** 爆仓那两个红字：字号、它前面的空隙、以及红底方框左右各留的一点内边距。 */
const CHIP_FLAG_FONT_SIZE = 10;
const CHIP_FLAG_GAP = 5;
const CHIP_FLAG_PAD_X = 3;
const CHIP_FLAG_COLOR = '#F6465D';

/** 爆仓小字整体占的宽度（含红底方框的内边距）；没有时为 0。 */
function chipFlagWidth(line: CampaignLegsExportCellLine): number {
  const flag = line.chip?.flag;
  if (!flag) return 0;
  return CHIP_FLAG_GAP + CHIP_FLAG_PAD_X * 2 + cellTextWidth(flag, { text: flag, size: CHIP_FLAG_FONT_SIZE, bold: true });
}

/** 角色标签整体占的宽度：左右内边距 + 字 +（小圆点 / 爆仓小字）。 */
function chipWidth(line: CampaignLegsExportCellLine): number {
  const dot = line.chip?.dot ? CHIP_DOT_GAP + CHIP_DOT : 0;
  return CHIP_PAD_X * 2 + cellTextWidth(line.text, line) + dot + chipFlagWidth(line);
}

/** 十六进制色加透明度（'#0ECB81' + 0.1 → '#0ECB811A'）。 */
function withAlpha(hex: string, alpha: number): string {
  return `${hex}${Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase()}`;
}

/**
 * 画角色标签的底：实心淡底，或挂单中的虚线空心框；进行中再在字后面点一个实心小圆点。
 * 标签竖直方向以这一行字的中线为准（基线上方约 4.5px），与同一行「开 …」的时间对齐。
 */
function drawChip(ctx: CanvasRenderingContext2D, line: CampaignLegsExportCellLine, x: number, baseline: number) {
  const chip = line.chip;
  if (!chip) return;
  const width = chipWidth(line);
  const centerY = baseline - 4.5;
  const top = centerY - CHIP_H / 2;
  if (chip.hollow) {
    ctx.save();
    ctx.setLineDash([3, 2]);
    strokeRoundedRect(ctx, x + 0.5, top + 0.5, width - 1, CHIP_H - 1, CHIP_RADIUS, withAlpha(chip.color, 0.75), 1);
    ctx.restore();
  } else {
    fillRoundedRect(ctx, x, top, width, CHIP_H, CHIP_RADIUS, withAlpha(chip.color, 0.1));
  }
  if (chip.dot) {
    ctx.beginPath();
    ctx.arc(x + CHIP_PAD_X + cellTextWidth(line.text, line) + CHIP_DOT_GAP + CHIP_DOT / 2, centerY, CHIP_DOT / 2, 0, Math.PI * 2);
    ctx.fillStyle = chip.color;
    ctx.fill();
  }
  // 爆仓：角色名后面一枚红字（自带淡红底），与页面上的同一枚
  if (chip.flag) {
    const flagLine = { text: chip.flag, size: CHIP_FLAG_FONT_SIZE, bold: true };
    const flagTextWidth = cellTextWidth(chip.flag, flagLine);
    const flagX = x + CHIP_PAD_X + cellTextWidth(line.text, line) + CHIP_FLAG_GAP;
    const flagH = CHIP_FLAG_FONT_SIZE + 4;
    fillRoundedRect(ctx, flagX, centerY - flagH / 2, flagTextWidth + CHIP_FLAG_PAD_X * 2, flagH, 2, withAlpha(CHIP_FLAG_COLOR, 0.15));
    ctx.font = cellFont(flagLine);
    ctx.fillStyle = CHIP_FLAG_COLOR;
    ctx.fillText(chip.flag, flagX + CHIP_FLAG_PAD_X, baseline);
  }
}

/**
 * 把一条放不下的格内文字折成几行，颜色字号原样保留；放得下就原样返回。
 *
 * **先按空格断，词内不拆**：「平 104,091」被拆成「平 104」「,091」时，读者会读出两个错的数，
 * 这比整行被挤一点更糟。只有单个词本身就比格宽时，才退到逐字拆开。
 * 断行处的空格随之吞掉，其余字符一个不丢。
 */
export function wrapCampaignLegsExportLine(
  line: CampaignLegsExportCellLine,
  fullWidth: number,
): CampaignLegsExportCellLine[] {
  // 角色标签整体画在一行里，不折（最长的「重新入场主力 2」加小圆点也放得下）
  if (line.chip) return [line];
  // 带标签的行：正文只剩标签右边那一截宽；折出来的后续行挂隐藏标签，与首行的正文左端对齐
  const indent = tagOffset(line);
  const maxWidth = fullWidth - indent;
  if (!line.text || cellTextWidth(line.text, line) <= maxWidth) return [line];
  const pieces: string[] = [];
  let current = '';
  const flush = () => {
    const trimmed = current.trimEnd();
    if (trimmed) pieces.push(trimmed);
    current = '';
  };
  for (const token of line.text.split(/(\s+)/)) {
    if (!token) continue;
    if (/^\s+$/.test(token)) {
      if (current) current += token;
      continue;
    }
    if (cellTextWidth(`${current}${token}`, line) <= maxWidth) {
      current += token;
      continue;
    }
    flush();
    if (cellTextWidth(token, line) <= maxWidth) {
      current = token;
      continue;
    }
    // 单个词比格宽：只有这时才逐字拆
    let chunk = '';
    for (const character of Array.from(token)) {
      if (chunk && cellTextWidth(`${chunk}${character}`, line) > maxWidth) {
        pieces.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    current = chunk;
  }
  flush();
  if (pieces.length === 0) return [line];
  return pieces.map((text, index) => (
    line.tag && index > 0 ? { ...line, text, tag: { ...line.tag, hidden: true } } : { ...line, text }
  ));
}

/**
 * 一条绘制行占多高。16px 及以下沿用固定行高——Δb 的 16px 本来就排得下，老表格的行高一格不变；
 * 更大的字（加仓校验的红叉）按字号 + 4 撑开，否则会顶到下一行。
 */
function exportLineHeight(line: CampaignLegsExportCellLine): number {
  const size = line.size ?? 13;
  return size > 16 ? size + 4 : LINE_H;
}

function layoutExportRow(
  cells: CampaignLegsExportCellLine[][],
  minHeight: number,
): Pick<CampaignLegsExportRow, 'wrapped' | 'height'> {
  const wrapped = cells.map((cell, index) => (
    cell.flatMap(line => wrapCampaignLegsExportLine(line, COLUMNS[index].width - CELL_PAD_X * 2))
  ));
  const tallest = Math.max(LINE_H, ...wrapped.map(cell => cell.reduce((sum, line) => sum + exportLineHeight(line), 0)));
  return { wrapped, height: Math.max(minHeight, ROW_PAD_Y * 2 + tallest) };
}

/**
 * 「币量 / 仓位」与「占比」的逐腿输入：币量 = 名义 ÷ 开仓价，逐腿只算一次，格子里的数就是分母里加的那个数；
 * 多单、空单按持仓方向（与涨跌幅同源）分开算；状态为「挂单中」的腿不进任何合计（与页面同一个 legRowStatus）。
 * 占比列看哪一侧也读这一份（缺战役方向时要回推主方向），行与表头因此不可能各看一侧。
 */
function buildShareInputs(
  input: Pick<ExportInput, 'campaign' | 'legs' | 'legExitPriceCorrections' | 'reverseHedgeOrders' | 'executionMethodOrders' | 'unfilledOrderIds'>,
  recordMap: Map<string, TradeRecord>,
): LegPositionShareInput[] {
  // 与页面 Legs 表同一个函数：挂单中的腿不进分母，也画成空心标签
  return buildLegPositionShareInputs(input.legs, recordMap, input.legExitPriceCorrections, exportFillEvidence(input));
}

/**
 * 「占比」这一列看哪一侧：与页面同一个 helper——战役主方向（主多看多单、主空看空单），
 * 缺方向时从主力腿回推。腿行、合计行与表头列名都读它。
 */
export function campaignLegsShareSide(
  input: Pick<ExportInput, 'campaign' | 'legs' | 'tradeRecords' | 'legExitPriceCorrections' | 'reverseHedgeOrders' | 'executionMethodOrders' | 'unfilledOrderIds'>,
): LegPositionSide {
  return resolveLegPositionShareSide(
    input.campaign.direction,
    buildShareInputs(input, buildTradeRecordLookup(input.tradeRecords)),
  );
}

export function buildCampaignLegsExportRows(input: ExportInput): CampaignLegsExportRow[] {
  const recordMap = buildTradeRecordLookup(input.tradeRecords);
  const fillEvidence = exportFillEvidence(input);
  const mainLegOrdinals = buildMainLegOrdinals(input.legs);
  const hedgeLegOrdinals = buildHedgeLegOrdinals(input.legs);
  // 与页面调同一个函数：导出图的归类必须和界面一致，否则 PNG 会成为第五套口径。
  const reverseOrderLegMap = buildDisplayReverseOrderLegMap(
    input.legs,
    input.reverseHedgeOrders,
    recordMap,
    input.legExitPriceCorrections,
  );

  // 与页面完全同源：导出图里的腿盈亏必须和界面上是同一个数，
  // 否则导出的 PNG 会成为第五套口径。
  const settlement = computeCampaignRealizedPnl(
    input.campaign,
    input.legs,
    input.tradeRecords,
    input.legExitPriceCorrections,
  );
  const legPnlMap = computeLegPnlContributions(
    input.legs,
    leg => settlement.byLeg.get(leg.id) ?? null,
  );

  // 阶段拆解（与页面同源）：按对冲的完整存续窗口切换暴露状态
  const hedgeBoundaries = input.legs
    .filter(l => l.order_kind === 'hedge' || (l.leg_role ?? '').startsWith('hedge_') || l.leg_role === 'reentry_hedge')
    .map(l => {
      const rec = l.trade_record_id ? recordMap.get(l.trade_record_id) ?? null : null;
      const exec = resolveLegExecution(l, rec, input.legExitPriceCorrections);
      return {
        legId: l.id,
        ordinal: hedgeLegOrdinals.get(l.id) ?? 0,
        openTime: exec.openTime ?? null,
        openPrice: exec.entryPrice ?? null,
        closeTime: exec.closeTime ?? null,
        closePrice: exec.exitPrice ?? null,
      };
    });
  const contributionDenominator = [...legPnlMap.values()]
    .reduce((sum, entry) => sum + (entry.pnl == null ? 0 : Math.abs(entry.pnl)), 0);
  // 加仓校验：与页面同一个函数、同一份输入（可见反向委托），导出图不另算一套
  const addSizingMap = evaluateCampaignAddSizing({
    legs: input.legs,
    tradeRecords: input.tradeRecords,
    legExitPriceCorrections: input.legExitPriceCorrections,
    reverseHedgeOrders: input.reverseHedgeOrders,
  });

  // 「币量 / 仓位」与「占比」：与页面同一个 helper、同一组输入（buildShareInputs）。
  // 「占比」的分母只有战役主方向那一侧（主多看多单、主空看空单），另一侧的 Σ 只写进合计行。
  const shareInputs = buildShareInputs(input, recordMap);
  const positionShares = computeLegPositionShares(shareInputs);
  const shareSide = resolveLegPositionShareSide(input.campaign.direction, shareInputs);

  const legRows = input.legs.flatMap((leg): CampaignLegsExportRow[] => {
    const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
    const execution = resolveLegExecution(leg, record, input.legExitPriceCorrections);
    const mirrorRatio = leg.leg_role === 'mirror_tp'
      ? resolveMirrorCloseRatio(input.campaign, leg, input.legs, input.tradeRecords)?.reductionPct : null;
    const executionMethods = resolveLegExecutionMethods(leg, record, input.executionMethodOrders ?? input.reverseHedgeOrders, input.tradeRecords, mirrorRatio);
    const status = legRowStatus(leg, record, fillEvidence);
    // 与页面同源：两笔及以上主力时带上序号，导出图里也能核对归类。
    const roleOrdinal = hedgeLegOrdinals.get(leg.id) ?? mainLegOrdinals.get(leg.id) ?? null;
    const displayRole = resolveLegDisplayRole(leg);
    const roleLabel = displayRole
      ? `${LEG_ROLE_LABELS[displayRole] ?? displayRole}${roleOrdinal ? ` ${roleOrdinal}` : ''}`
      : '—';
    const openLabel = fmtClock(execution.openTime ?? leg.pre_simulated_time);
    const closeLabel = fmtClock(execution.closeTime);
    const operationLabel = fmtClock(journalOperationTime(leg, record));
    const entryPriceValue = execution.entryPrice;
    const exitPriceValue = execution.exitPrice;
    const position = positionShares.byLeg.get(leg.id);
    const hedgeSummary = leg.order_kind === 'hedge' && leg.hedge_type
      ? `${HEDGE_TYPE_LABELS[leg.hedge_type]}${leg.hedge_necessity_pct != null ? ` · ${leg.hedge_necessity_pct.toFixed(0)}%` : ''}`
      : null;
    const reverseOrdersForLeg = input.reverseHedgeOrders.filter(order => reverseOrderLegMap.get(order.id) === leg.id);
    const mirrorTpTiming = resolveMirrorTpOrderTiming(leg, record, input.campaign.actual_evolution);
    const mirrorTpLines: CampaignLegsExportCellLine[] = mirrorTpTiming
      ? [
          { text: '镜像止盈', color: '#D89B00', bold: true },
          { text: `委 ${fmtClock(mirrorTpTiming.placedAt)}`, color: '#5F6B7A' },
          { text: `触 ${fmtClock(mirrorTpTiming.triggeredAt)}`, color: '#5F6B7A' },
        ]
      : [];
    const reverseOrderLines: CampaignLegsExportCellLine[] = reverseOrdersForLeg.flatMap((order, index): CampaignLegsExportCellLine[] => {
      const sideColor = order.side === 'SHORT' ? '#6D28D9' : '#002FA7';
      return [
        ...(index > 0 || mirrorTpLines.length > 0 ? [{ text: '', color: '#848E9C' }] : []),
        { text: `${order.side === 'SHORT' ? '空' : '多'} ${fmtPrice(order.price)} · ${statusForReverseOrder(order)}`, color: sideColor, bold: true },
        { text: `委 ${fmtClock(order.createdAt)}`, color: '#5F6B7A' },
        ...(order.status === 'triggered' ? [{ text: `触 ${fmtClock(order.triggeredAt)}`, color: '#5F6B7A' }] : []),
        { text: `${order.status === 'triggered' ? '平' : '撤'} ${order.cancelledAt ? fmtClock(order.cancelledAt) : '—'}`, color: '#5F6B7A' },
      ];
    });
    const reverseLines: CampaignLegsExportCellLine[] = mirrorTpLines.length === 0 && reverseOrderLines.length === 0
      ? [{ text: '—', color: '#848E9C' }]
      : [...mirrorTpLines, ...reverseOrderLines];

    /**
     * 强平记录不换显示价：格子里就是记录上的强平价（与这一行的盈亏同一对价），
     * 所以不再印「原 …」那一行（它与上面那个数一模一样），只留 K 线区间与「强平异常」的警示。
     */
    const liquidationAnomaly = Boolean(execution.exitCorrection) && isLiquidationRecord(execution.record);
    const exitPriceLines: CampaignLegsExportCellLine[] = [
      { text: fmtPrice(exitPriceValue), bold: Boolean(execution.exitCorrection) },
      ...(execution.exitCorrection ? [
        ...(liquidationAnomaly ? [] : [{ text: `原 ${fmtPrice(execution.exitCorrection.originalExitPrice)}`, color: '#848E9C' }]),
        { text: `K线 ${fmtPrice(execution.exitCorrection.candleLow)}-${fmtPrice(execution.exitCorrection.candleHigh)}`, color: '#848E9C' },
      ] : []),
      // 强平记录的价不在那一刻的 K 线里 = 引擎误判的强平；只报异常，盈亏与显示价都不按这个价改。
      ...(liquidationAnomaly ? [{ text: '强平异常', color: '#F6465D' }] : []),
    ];
    const cells: CampaignLegsExportCellLine[][] = [
      // 角色标签：与页面同一套颜色与状态样式（挂单中空心虚线、进行中带小圆点、爆仓带红字），不再另写状态字、也不写「回填」；
      // 没有角色的腿同样是一枚标签（中性灰、写「—」），进行中的圆点照画
      [{
        text: roleLabel,
        bold: true,
        size: ROLE_CHIP_FONT_SIZE,
        color: legRoleExportTextColor(displayRole ?? null),
        chip: {
          color: displayRole ? LEG_ROLE_TONE_COLORS[displayRole] : LEG_ROLE_NEUTRAL_COLOR,
          ...(status === 'pending' ? { hollow: true } : {}),
          ...(status === 'open' ? { dot: true } : {}),
          ...(status === 'liquidated' ? { flag: '爆仓' } : {}),
        },
      }],
      [
        { text: `开 ${openLabel}` },
        { text: `平 ${closeLabel}` },
        { text: `操作 ${operationLabel}` },
        ...(hedgeSummary ? [{ text: hedgeSummary, color: '#D89B00' }] : []),
      ],
      (() => {
        // 与页面上的 Legs 列表同源，避免导出图与界面读数打架
        const entry = legPnlMap.get(leg.id);
        const pnl = entry?.pnl ?? null;
        if (pnl == null) return [{ text: '—', color: '#848E9C' }];
        const contribution = entry?.contribution ?? null;
        // 份额在上、金额在下：要读的是这条腿占了整场的多少，不是它的绝对数
        return [
          {
            text: contribution == null
              ? '—'
              : `${contribution > 0 ? '+' : ''}${(contribution * 100).toFixed(1)}%`,
            color: pnl === 0 ? '#5F6B7A' : pnl > 0 ? '#0ECB81' : '#F6465D',
            bold: true,
            size: 13,
          },
          {
            text: `${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}`,
            color: '#9AA4B2',
            size: 10,
          },
        ];
      })(),
      (() => {
        const pnl = legPnlMap.get(leg.id)?.pnl ?? null;
        const delta = legDeltaB(pnl, input.initialExpectedMaxLoss ?? null);
        if (delta == null) return [{ text: '—', color: '#848E9C' }];
        // Δb 是主角：导出图里也用最大字号把它顶出来
        return [{
          text: formatDeltaB(delta),
          color: roundedDeltaB(delta) === 0 ? '#5F6B7A' : delta > 0 ? '#0ECB81' : '#F6465D',
          bold: true,
          size: 16,
        }];
      })(),
      [{ text: fmtPrice(entryPriceValue) }],
      exitPriceLines,
      [
        executionMethodCellLine(leg, '开', executionMethods.open),
        executionMethodCellLine(leg, '平', executionMethods.close),
      ],
      // 涨跌幅：开仓价 → 平仓价的价格变化，按这条腿的方向计，与前面的开平价格同一对价
      priceChangeCell(entryPriceValue, exitPriceValue, leg.direction === 'short' ? 'short' : 'long', '#5F6B7A'),
      // 与页面同源：币量在上、名义在下——加仓公式里的 X 是币量，名义只是它乘开仓价的结果
      [
        { text: formatLegCoinQuantity(position?.coinQty) },
        { text: formatLegNotional(position?.notional), color: '#848E9C' },
      ],
      // 占比：与左边一格同构同色——上行币量占比、下行名义仓位占比，都是战役主方向那一侧合计里的份额；
      // 另一侧（对冲）的行空白；百分数中性色（与页面同源）；挂单中的腿两行都是「—」。
      // 导出图不跟页面的点击排序走：腿按传入的先后画
      legShareCell(position, shareSide),
      // 加仓校验：与页面同构——合规只是一枚淡灰小对号，过大则写明正确币量上限及 U 名义仓位；非加仓行留空
      ((): CampaignLegsExportCellLine[] => {
        const verdict = addSizingMap.get(leg.id);
        if (!verdict) return [{ text: '' }];
        if (verdict.status === 'ok') return [{ text: '✓', color: '#C4CAD3', size: 11 }];
        if (verdict.status === 'fail') {
          // 成交记录带着计算器的计划时，把「计算时 /（下单时）/ 实际成交」并上，再点一句超出从哪来。没有快照的行与之前逐字不变。
          const snapshot = addSizingSnapshotLines(verdict);
          const reason = snapshot?.slippage ?? snapshot?.cause ?? null;
          return [
            { text: '✗', color: '#F6465D', bold: true, size: 20 },
            { text: `上限 ${formatAddSizingCoinQuantity(verdict.maxAllowedCoins)} 币`, color: '#F6465D', bold: true, size: 11 },
            { text: `≈ ${formatAddSizingNotional(verdict.maxAllowedNotional)} U`, color: '#F6465D', size: 10 },
            ...(snapshot
              ? [
                { text: snapshot.calc, color: '#848E9C', size: 9 },
                ...(snapshot.order ? [{ text: snapshot.order, color: '#848E9C', size: 9 }] : []),
                { text: snapshot.actual, color: '#848E9C', size: 9 },
                ...(reason ? [{ text: reason, color: '#F6465D', bold: true, size: 9 }] : []),
              ]
              : []),
          ];
        }
        return [{ text: '—', color: '#C4CAD3', size: 11 }];
      })(),
      // 手续费：与页面同源，同样刻意做淡——合计在上、开/平拆分在下，明细在页面的 tooltip 里。
      (() => {
        const fees = execution.record ? tradeRecordFees(execution.record) : null;
        if (!fees) return [{ text: '—', color: '#A3ABB8' }];
        // 主行是金额（钱包扣的就是它），次行是拆分；币本位的拆分写币数——
        // 折成美元后价格被约掉，两笔金额必然相同，只有币数看得出差别（见 tradeFees）
        const coinMode = fees.coinSettled && fees.open?.coin != null && fees.close.coin != null;
        return [
          {
            text: `${fees.totalUsd == null ? '—' : fees.totalUsd.toFixed(2)}${fees.estimated ? ' 估' : ''}`,
            color: '#5F6B7A',
            size: 11,
          },
          {
            text: coinMode
              ? `开 ${formatFeeCoin(fees.open?.coin)} · 平 ${formatFeeCoin(fees.close.coin)} ${fees.asset}`
              : `开 ${fees.open ? fees.open.usd.toFixed(2) : '—'} · 平 ${fees.close.usd.toFixed(2)}`,
            color: '#9AA4B2',
            size: 10,
          },
        ];
      })(),
      reverseLines,
    ];
    const mainRow: CampaignLegsExportRow = { legId: leg.id, kind: 'leg', cells, ...layoutExportRow(cells, 58) };

    // 主力与其他多单后追加阶段子行。导出图不跟页面折叠；收尾段统一不呈现。
    if (!legSupportsPhases(leg)) return [mainRow];
    const pnlForPhases = legPnlMap.get(leg.id)?.pnl ?? null;
    if (pnlForPhases == null || entryPriceValue == null || exitPriceValue == null) return [mainRow];
    const phases = visibleLegPhases(splitMainLegPhases({
      pnl: pnlForPhases,
      entryPrice: entryPriceValue,
      exitPrice: exitPriceValue,
      openTime: execution.openTime ?? null,
      closeTime: execution.closeTime ?? null,
      side: leg.direction === 'short' ? 'short' : 'long',
      hedges: hedgeBoundaries,
    }));
    if (phases.length === 0) return [mainRow];
    const phaseRows = phases.map(phase => {
      const delta = legDeltaB(phase.pnl, input.initialExpectedMaxLoss ?? null);
      const contribution = contributionDenominator > 0 ? phase.pnl / contributionDenominator : null;
      const phaseCells: CampaignLegsExportCellLine[][] = [
          [{
            text: phase.label,
            color: phase.activeHedgeOrdinals.length > 0 ? '#6F9BD8' : '#848E9C',
            indent: CHIP_PAD_X,
          }],
          [
            { text: `${fmtClock(phase.startTime)} → ${fmtClock(phase.endTime)}`, color: '#848E9C' },
          ],
          [
            {
              text: contribution == null ? '—' : `${contribution > 0 ? '+' : ''}${(contribution * 100).toFixed(1)}%`,
              color: phase.pnl === 0 ? '#5F6B7A' : phase.pnl > 0 ? '#0ECB81' : '#F6465D',
            },
            {
              text: `${phase.pnl > 0 ? '+' : ''}${phase.pnl.toFixed(2)}`,
              color: '#848E9C',
            },
          ],
          [{
            text: formatDeltaB(delta),
            color: delta == null || roundedDeltaB(delta) === 0 ? '#5F6B7A' : delta > 0 ? '#0ECB81' : '#F6465D',
          }],
          [{ text: fmtPrice(phase.startPrice), color: '#848E9C' }],
          [{ text: fmtPrice(phase.endPrice), color: '#848E9C' }],
          EMPTY_CELL,
          // 阶段自己的起止价各算各的、方向沿用主力（与页面同源）
          priceChangeCell(phase.startPrice, phase.endPrice, leg.direction === 'short' ? 'short' : 'long', '#848E9C'),
          [{ text: '' }],
          [{ text: '' }],
          [{ text: '' }],
          [{ text: '' }],
          [{ text: '' }],
      ];
      return {
        legId: `${leg.id}-phase-${phase.index}`,
        kind: 'phase' as const,
        cells: phaseCells,
        ...layoutExportRow(phaseCells, 44),
      };
    });
    return [mainRow, ...phaseRows];
  });

  // 合计行：与页面 legs-total-row 同源——Σ盈亏按构造恒等于盈亏概览的已实现 P&L，
  // 手续费按成交记录去重。页面上有、导出图上没有，就是图不完整。
  const totalPnl = settlement.total ?? null;
  const totalDeltaB = legDeltaB(totalPnl, input.initialExpectedMaxLoss ?? null);
  const feeTotals = sumTradeRecordFees(input.legs.flatMap(leg => {
    const rec = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
    return rec ? [rec] : [];
  }));
  const tone = (value: number | null) => (
    value == null || value === 0 ? '#5F6B7A' : value > 0 ? '#0ECB81' : '#F6465D'
  );
  const totalCells: CampaignLegsExportCellLine[][] = [
    // 合计是整张表的结论，用正文最深的颜色、加粗、比腿的角色名大一号——导出图常被缩小看，淡灰小字会直接消失
    [{ text: '合计', bold: true, color: '#111827', size: 14 }],
    [{ text: settlementBasisLabel(settlement.basis), color: '#475569', size: 11 }],
    [{
      text: totalPnl == null ? '—' : `${totalPnl > 0 ? '+' : ''}${totalPnl.toFixed(2)}`,
      color: tone(totalPnl),
      bold: true,
    }],
    [{
      text: formatDeltaB(totalDeltaB),
      color: tone(totalDeltaB == null ? null : roundedDeltaB(totalDeltaB)),
      bold: true,
      size: 16,
    }],
    // 开仓价 / 平仓价 / 操作方式 / 涨跌幅：合计没有单独的操作方式，涨跌幅跨腿没有意义，与页面一样留空
    [{ text: '' }],
    [{ text: '' }],
    [{ text: '' }],
    [{ text: '' }],
    // 币量 / 仓位：多单、空单各一组 Σ（上行 Σ币量、下行 Σ名义仓位，挂单中的腿不计入），每组以标签开头；
    // 战役主方向那一侧那组是「占比」的分母，另一侧那组只是它各腿的合计。没有计入腿的方向不列。
    // 占比：写那一侧的「100.0%」，与左格同方向那组同一行（Σ 固定先多后空，排在它之前的组先垫两行空白）；
    // 两个方向都没有时两格照旧两行「—」。与页面同源，淡色
    positionShares.sides.length === 0
      ? positionShareLines(null, '—', '—', '#5F6B7A')
      : positionShares.sides.flatMap(totals => positionShareLines(
        totals.side,
        formatLegCoinQuantity(totals.totalCoins),
        formatLegNotional(totals.totalNotional),
        '#5F6B7A',
      )),
    totalShareCell(positionShares, shareSide),
    // 加仓校验
    [{ text: '' }],
    feeTotals == null
      ? [{ text: '—', color: '#A3ABB8' }]
      : [
        { text: `${feeTotals.totalUsd.toFixed(2)}${feeTotals.estimated ? ' 估' : ''}`, color: '#5F6B7A', size: 11 },
        ...(feeTotals.totalCoin != null
          ? [{ text: `币计 ${formatFeeCoin(feeTotals.totalCoin, feeTotals.asset)}`, color: '#9AA4B2', size: 10 }]
          : []),
      ],
    [{ text: '' }],
  ];
  // 他场委托的淡注：与页面 Legs 表下方那行同一个函数，不放进任何腿的行
  const foreignNote = formatForeignReplayOrdersNote(input.foreignLiveOrders ?? []);
  const noteRows: CampaignLegsExportRow[] = [];
  if (foreignNote) {
    const noteCells: CampaignLegsExportCellLine[][] = [[{ text: foreignNote, color: '#A3ABB8', size: 11 }]];
    const wrapped = [noteCells[0].flatMap(line => wrapCampaignLegsExportLine(line, TABLE_WIDTH - CELL_PAD_X * 2))];
    noteRows.push({
      legId: 'legs-foreign-replay-orders-note',
      kind: 'note',
      cells: noteCells,
      wrapped,
      height: NOTE_ROW_PAD_Y * 2 + wrapped[0].reduce((sum, line) => sum + exportLineHeight(line), 0),
    });
  }
  return [
    ...legRows,
    { legId: 'legs-total', kind: 'total', cells: totalCells, ...layoutExportRow(totalCells, 44) },
    ...noteRows,
  ];
}

/** 表下淡注行的上下留白：比腿行紧，读起来是表的脚注而不是又一行数据。 */
const NOTE_ROW_PAD_Y = 8;

export function campaignLegsExportCanvasHeight(input: ExportInput, includeHeader = false): number {
  const rows = buildCampaignLegsExportRows(input);
  return (includeHeader ? HEADER_H + FOOTER_H : 0)
    + TABLE_HEADER_H
    + rows.reduce((sum, row) => sum + row.height, 0);
}

function exportScale(): number {
  return Math.min(Math.max(window.devicePixelRatio || 2, 2), 3);
}

function createRenderedCanvas(width: number, height: number, scale = exportScale()): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rendered: RenderedCanvas;
} {
  // Chromium/Safari silently truncate or blank canvases that exceed their backing-store
  // limit. Keep the logical height fully content-driven, lowering only pixel density for
  // exceptionally long campaigns so the final rows are never lost.
  const sideScale = Math.min(MAX_CANVAS_SIDE_PX / width, MAX_CANVAS_SIDE_PX / height);
  const areaScale = Math.sqrt(MAX_CANVAS_AREA_PX / Math.max(1, width * height));
  const fittedScale = Math.max(0.1, Math.min(scale, sideScale, areaScale));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * fittedScale);
  canvas.height = Math.ceil(height * fittedScale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 PNG 画布');
  ctx.setTransform(fittedScale, 0, 0, fittedScale, 0, 0);
  return { canvas, ctx, rendered: { canvas, width, height, scale: fittedScale } };
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function strokeRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strokeStyle: string,
  lineWidth = 1,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * 逐行画格内文字。行已按列宽折好，这里**不再**给 fillText 传 maxWidth——
 * 传了，画布会把放不下的字横向压扁到糊成一团，那正是「导出图内容不完整」的来路。
 */
function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: CampaignLegsExportCellLine[],
  x: number,
  y: number,
) {
  let offset = 0;
  lines.forEach(line => {
    // 大字号行先把自己的基线往下推出多出来的那截，才不会压到上一行；之后按常规行距往下走
    offset += exportLineHeight(line) - LINE_H;
    if (line.operation) {
      // 操作列宽 102、左右各 10 内边距，中间固定 68px（状态 33 + 间隔 2 + 括号动作 33）。
      const statusRight = x + 7 + 33;
      ctx.font = cellFont(line);
      ctx.fillStyle = line.color ?? '#848E9C';
      ctx.fillText(line.operation.label, statusRight - ctx.measureText(line.operation.label).width, y + offset);
      ctx.font = cellFont({ ...line, bold: false });
      ctx.fillStyle = '#B4BBC5';
      ctx.fillText(`（${line.operation.action}）`, statusRight + 2, y + offset);
      offset += LINE_H;
      return;
    }
    // 角色标签先画底，字再压在上面。导出图是白底，与页面浅色主题一样：空心标签的字不再淡一档（品牌色在白底上本来就浅）
    if (line.chip) drawChip(ctx, line, x, y + offset);
    // 方向标签单独着色；隐藏标签只占位。正文右移的距离与折行时量的是同一个 tagOffset
    if (line.tag && !line.tag.hidden) {
      ctx.font = cellFont(tagFontLine(line));
      ctx.fillStyle = line.tag.color;
      ctx.fillText(line.tag.text, x, y + offset);
    }
    const textX = x + tagOffset(line);
    ctx.font = cellFont(line);
    ctx.fillStyle = line.color ?? '#202630';
    ctx.fillText(line.text, textX, y + offset);
    offset += LINE_H;
  });
}

/** shareSide：占比列的表头写哪一个列名——战役主方向那一侧（主多「多单占比」、主空「空单占比」），与格子里的数同一侧。 */
function drawLegsTable(
  ctx: CanvasRenderingContext2D,
  rows: CampaignLegsExportRow[],
  startY: number,
  shareSide: LegPositionSide,
) {
  let y = startY;
  let x = MARGIN_X;
  ctx.fillStyle = '#EEF2F7';
  ctx.fillRect(MARGIN_X, y, TABLE_WIDTH, TABLE_HEADER_H);
  ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = '#64748B';
  COLUMNS.forEach((column, index) => {
    const title = index === SHARE_COLUMN_INDEX ? LEG_POSITION_SHARE_COLUMN_TITLES[shareSide] : column.title;
    const titleX = index === EXECUTION_METHOD_COLUMN_INDEX ? x + (column.width - ctx.measureText(title).width) / 2 : x + 10;
    ctx.fillText(title, titleX, y + 24, column.width - 20);
    x += column.width;
  });

  y += TABLE_HEADER_H;
  rows.forEach((row, rowIndex) => {
    x = MARGIN_X;
    if (row.kind === 'note') {
      // 淡注横跨整张表宽：不画斑马底、不画分隔线，只写一行（放不下就折）浅灰小字
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(MARGIN_X, y, TABLE_WIDTH, row.height);
      drawLines(ctx, row.wrapped[0] ?? [], MARGIN_X + CELL_PAD_X, y + NOTE_ROW_PAD_Y + 12);
      y += row.height;
      return;
    }
    ctx.fillStyle = row.kind === 'total' ? '#EEF2F7' : rowIndex % 2 === 0 ? '#FFFFFF' : '#FAFBFD';
    ctx.fillRect(MARGIN_X, y, TABLE_WIDTH, row.height);
    ctx.strokeStyle = '#E5E7EB';
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, y + row.height);
    ctx.lineTo(MARGIN_X + TABLE_WIDTH, y + row.height);
    ctx.stroke();
    if (row.kind === 'total') {
      // 合计行与页面一样压一道加粗上框，和上面的腿分开
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(MARGIN_X, y, TABLE_WIDTH, 2);
    }

    row.wrapped.forEach((cell, cellIndex) => {
      drawLines(ctx, cell, x + CELL_PAD_X, y + ROW_PAD_Y + 12);
      x += COLUMNS[cellIndex].width;
    });
    y += row.height;
  });
}

/** 画出 Legs 列表画布（不下载）。导出与本地目检共用，所见即所导。 */
export function buildCampaignLegsListCanvas(input: ExportInput, options: LegsCanvasOptions = {}): RenderedCanvas {
  const rows = buildCampaignLegsExportRows(input);
  const includeHeader = options.includeHeader ?? true;
  const headerHeight = includeHeader ? HEADER_H : 0;
  const footerHeight = includeHeader ? FOOTER_H : 0;
  const width = TABLE_WIDTH + MARGIN_X * 2;
  const height = headerHeight + TABLE_HEADER_H + rows.reduce((sum, row) => sum + row.height, 0) + footerHeight;
  const { ctx, rendered } = createRenderedCanvas(width, height, options.scale);

  ctx.fillStyle = includeHeader ? '#F8FAFC' : '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  if (includeHeader) {
    fillRoundedRect(ctx, MARGIN_X - 12, 20, TABLE_WIDTH + 24, height - 40, 14, '#FFFFFF');

    const title = campaignKlineTitleName(input.campaign);
    ctx.font = '700 22px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#111827';
    ctx.fillText(`${title} · Legs 列表`, MARGIN_X, 54, TABLE_WIDTH - 260);
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = '#64748B';
    const displayCode = formatCampaignDisplayCode(
      input.campaign.campaign_code,
      input.accountName,
      input.campaign.id,
    );
    ctx.fillText(`编号 ${displayCode} · 共 ${input.legs.length} legs`, MARGIN_X, 76, TABLE_WIDTH - 260);
  }

  drawLegsTable(ctx, rows, headerHeight, campaignLegsShareSide(input));

  if (includeHeader) {
    ctx.font = '500 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(`导出时间 ${fmtClock(new Date().toISOString())}`, MARGIN_X, height - 20, TABLE_WIDTH);
  }

  return rendered;
}

function colorOrFallback(value: string, fallback: string): string {
  return value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)' ? value : fallback;
}

function drawAnalysisLabels(
  ctx: CanvasRenderingContext2D,
  chartElement: HTMLElement,
  chartRect: DOMRect,
) {
  const labels = Array.from(chartElement.querySelectorAll<HTMLElement>('[data-analysis-label]'));
  for (const label of labels) {
    const rect = label.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const x = rect.left - chartRect.left;
    const y = rect.top - chartRect.top;
    if (x > chartRect.width || y > chartRect.height || x + rect.width < 0 || y + rect.height < 0) continue;

    const style = window.getComputedStyle(label);
    const radius = Number.parseFloat(style.borderRadius) || 3;
    const bg = colorOrFallback(style.backgroundColor, 'rgba(255, 255, 255, 0.35)');
    const border = colorOrFallback(style.borderColor, style.color || '#64748B');
    const text = label.textContent?.trim() ?? '';
    const fontSize = Number.parseFloat(style.fontSize) || 8;
    const fontWeight = style.fontWeight || '600';
    const fontFamily = style.fontFamily || 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

    fillRoundedRect(ctx, x, y, rect.width, rect.height, radius, bg);
    strokeRoundedRect(ctx, x, y, rect.width, rect.height, radius, border, 1);
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.fillStyle = colorOrFallback(style.color, '#111827');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + rect.width / 2, y + rect.height / 2, rect.width - 4);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function captureCampaignChartCanvas(chartElement: HTMLElement | null): RenderedCanvas {
  if (!chartElement) throw new Error('K 线盘面尚未渲染，无法导出');
  const rect = chartElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) throw new Error('K 线盘面尺寸异常，无法导出');

  const sourceCanvases = Array.from(chartElement.querySelectorAll('canvas'));
  if (sourceCanvases.length === 0) throw new Error('未找到 K 线画布，请等待盘面加载完成后再导出');

  const { ctx, rendered } = createRenderedCanvas(rect.width, rect.height);
  const style = window.getComputedStyle(chartElement);
  ctx.fillStyle = colorOrFallback(style.backgroundColor, '#FFFFFF');
  ctx.fillRect(0, 0, rect.width, rect.height);

  for (const source of sourceCanvases) {
    const sourceRect = source.getBoundingClientRect();
    if (sourceRect.width <= 0 || sourceRect.height <= 0) continue;
    const x = sourceRect.left - rect.left;
    const y = sourceRect.top - rect.top;
    try {
      ctx.drawImage(source, x, y, sourceRect.width, sourceRect.height);
    } catch (error) {
      throw new Error(`K 线画布导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  drawAnalysisLabels(ctx, chartElement, rect);
  strokeRoundedRect(ctx, 0.5, 0.5, rect.width - 1, rect.height - 1, 6, '#E5E7EB', 1);
  return rendered;
}

async function canvasPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(nextBlob => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error('PNG 生成失败'));
    }, 'image/png');
  });
}

function downloadBlob(blob: Blob, fileName: string): string {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return fileName;
}

async function downloadCanvas(canvas: HTMLCanvasElement, fileName: string): Promise<string> {
  return downloadBlob(await canvasPngBlob(canvas), fileName);
}

function drawSectionLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number) {
  ctx.font = '700 14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText(label, x, y + 18);
}

type OverviewItem = {
  label: string;
  value: string;
  color?: string;
  rightColumn?: boolean;
};

/**
 * 摘要面板里每一项的格位（两栏）。有项标了 rightColumn 时按栏从上往下排：未标的进左栏、标了的进右栏，
 * 与页面上的盈亏概览一致；都没标（战役元数据）时仍按行从左到右排。
 */
export function overviewItemCells(items: OverviewItem[]): { cells: { item: OverviewItem; column: number; row: number }[]; rows: number } {
  if (!items.some(item => item.rightColumn)) {
    return {
      cells: items.map((item, index) => ({ item, column: index % 2, row: Math.floor(index / 2) })),
      rows: Math.ceil(items.length / 2),
    };
  }
  const left = items.filter(item => !item.rightColumn);
  const right = items.filter(item => item.rightColumn);
  return {
    cells: [
      ...left.map((item, row) => ({ item, column: 0, row })),
      ...right.map((item, row) => ({ item, column: 1, row })),
    ],
    rows: Math.max(left.length, right.length),
  };
}

export type CampaignBoardOverview = {
  metadataItems: OverviewItem[];
  pnlItems: CampaignBoardPnlItem[];
  pnlNote?: string;
  emotionDiary?: EmotionDiaryExportSummary | null;
  emotionDiaryCollapsed: boolean;
};

/**
 * 图里画不画 K 线周期：只有 K 线盘面（含「无 K 线」说明）用得到它。
 * 【用户已定】计算与显示分开：盈亏概览（峰值浮盈）按与详情页同一份自动周期的 K 线算，不随这里的周期变，
 * 所以没画盘面的图里写「周期 5分钟线」只会让人以为概览是按它算的。不传 sections（详情页单张导出）时照旧写。
 * 批量下载弹窗用同一个判断决定周期单选可不可用、进度区写不写周期。
 */
export function boardUsesChartInterval(sections: CampaignBoardExportSections | undefined): boolean {
  return sections?.chart !== false;
}

/** 导出图顶部两块摘要的唯一数据源，避免页面字段演进时漏掉战役原数据或盈亏信息。 */
export function buildCampaignBoardOverview(input: CampaignBoardExportInput): CampaignBoardOverview {
  const legCounts = campaignLegCounts(input.legs);
  const operationTime = campaignOperationTime(input.legs, input.tradeRecords);
  const chartIntervalLabel = formatCampaignChartInterval(input.chartInterval);
  const showChartInterval = boardUsesChartInterval(input.sections);
  const initialMainExposureNotional = computeInitialMainExposureNotional(
    input.campaign,
    input.legs,
    input.tradeRecords,
  );
  const mainLeverage = resolveCampaignMainLeverage(input.campaign, input.legs, input.tradeRecords);
  return {
    metadataItems: [
      { label: '操作时间', value: operationTime == null ? '—' : fmtClock(operationTime) },
      ...(showChartInterval ? [{ label: 'K 线周期', value: chartIntervalLabel }] : []),
      { label: '方向 / 状态', value: `${input.campaign.direction === 'main_long' ? '主多' : '主空'} / ${campaignStatusLabel(input.campaign.status)}` },
      { label: '战役开始', value: fmtClock(input.campaign.opened_at) },
      { label: '战役结束', value: fmtClock(input.campaign.closed_at) },
      { label: '持续时间', value: fmtCampaignDuration(input.campaign.opened_at, input.campaign.closed_at) },
      { label: '策略', value: input.campaign.strategy_template },
      { label: 'Legs 构成', value: `共 ${input.legs.length} · 主仓 ${legCounts.main} / 对冲 ${legCounts.hedge} / TP ${legCounts.tp} / 其他 ${legCounts.other}` },
      {
        label: '主力开仓名义仓位 / 杠杆',
        value: `${initialMainExposureNotional > 0 ? fmtAmount(initialMainExposureNotional, ' USDT') : '—'} / ${formatCampaignLeverage(mainLeverage)}`,
      },
      { label: '最终 R', value: fmtAmount(input.campaign.final_r_multiple) },
      {
        label: '战役编号',
        value: formatCampaignDisplayCode(
          input.campaign.campaign_code,
          input.accountName,
          input.campaign.id,
        ),
      },
    ],
    pnlItems: input.pnlOverview.items,
    pnlNote: input.pnlOverview.note,
    emotionDiary: input.emotionDiary,
    emotionDiaryCollapsed: input.emotionDiaryCollapsed === true,
  };
}

function drawOverviewPanel(
  ctx: CanvasRenderingContext2D,
  title: string,
  items: OverviewItem[],
  note: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  fillRoundedRect(ctx, x, y, width, height, 10, '#FFFFFF');
  strokeRoundedRect(ctx, x, y, width, height, 10, '#E5E7EB', 1);
  ctx.font = '700 14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText(title, x + 16, y + 25, width - 32);

  const columns = 2;
  const columnWidth = (width - 32) / columns;
  const { cells, rows: itemRows } = overviewItemCells(items);
  cells.forEach(({ item, column, row }) => {
    const itemX = x + 16 + column * columnWidth;
    const itemY = y + 52 + row * 32;
    ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.fillText(item.label, itemX, itemY, columnWidth - 12);
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = item.color ?? '#1F2937';
    ctx.fillText(item.value, itemX, itemY + 16, columnWidth - 12);
  });

  if (note) {
    const noteTop = y + 52 + itemRows * 32 + 2;
    ctx.strokeStyle = '#E5E7EB';
    ctx.beginPath();
    ctx.moveTo(x + 16, noteTop);
    ctx.lineTo(x + width - 16, noteTop);
    ctx.stroke();
    ctx.font = '500 10px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#64748B';
    wrapCanvasText(ctx, note, width - 32).forEach((line, index) => {
      ctx.fillText(line, x + 16, noteTop + 17 + index * 14, width - 32);
    });
  }
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of Array.from(text)) {
    const candidate = `${line}${character}`;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character.trimStart();
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function overviewPanelHeight(items: OverviewItem[], note: string | undefined, width: number): number {
  const itemRows = overviewItemCells(items).rows;
  const itemsBottom = 52 + itemRows * 32;
  if (!note) return Math.max(BOARD_OVERVIEW_MIN_H, itemsBottom + 12);

  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d');
  let noteLineCount = 1;
  if (measureContext) {
    measureContext.font = '500 10px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    noteLineCount = wrapCanvasText(measureContext, note, width - 32).length;
  } else {
    noteLineCount = Math.max(1, Math.ceil(note.length / Math.max(1, Math.floor((width - 32) / 10))));
  }
  return Math.max(BOARD_OVERVIEW_MIN_H, itemsBottom + 22 + noteLineCount * 14 + 12);
}

/** 折叠态只剩一条标题栏：与页面上折叠后的卡片同高同构，导出图才是「所见即所得」。 */
export const EMOTION_DIARY_COLLAPSED_H = 44;

/**
 * 导出图里情绪日记面板的高度。折叠时固定为标题栏高度——
 * 页面上用户把日记收起来了，往往就是不想让它出现在要分享出去的图里。
 */
export function campaignEmotionDiaryPanelHeight(
  diary: EmotionDiaryExportSummary,
  width: number,
  collapsed = false,
): number {
  return collapsed ? EMOTION_DIARY_COLLAPSED_H : emotionDiaryPanelHeight(diary, width);
}

function emotionDiaryPanelHeight(
  diary: EmotionDiaryExportSummary,
  width: number,
): number {
  const measureCanvas = document.createElement('canvas');
  const measureContext = measureCanvas.getContext('2d');
  let eventLineCount = 1;
  if (measureContext) {
    measureContext.font = '500 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    eventLineCount = wrapCanvasText(measureContext, diary.eventText, width - 32).length;
  } else {
    eventLineCount = Math.max(1, Math.ceil(diary.eventText.length / Math.max(1, Math.floor((width - 32) / 12))));
  }
  let dimensionLineCount = 0;
  if (diary.pomsDimensions) {
    if (measureContext) {
      measureContext.font = '500 10px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      dimensionLineCount = wrapCanvasText(measureContext, diary.pomsDimensions, width - 32).length;
    } else {
      dimensionLineCount = Math.max(
        1,
        Math.ceil(diary.pomsDimensions.length / Math.max(1, Math.floor((width - 32) / 10))),
      );
    }
  }
  return 60 + eventLineCount * 18 + 58 + (dimensionLineCount > 0 ? 25 + dimensionLineCount * 14 : 0);
}

export function drawEmotionDiaryPanel(
  ctx: CanvasRenderingContext2D,
  diary: EmotionDiaryExportSummary,
  x: number,
  y: number,
  width: number,
  height: number,
  collapsed = false,
) {
  fillRoundedRect(ctx, x, y, width, height, 10, '#FFFFFF');
  strokeRoundedRect(ctx, x, y, width, height, 10, '#E5E7EB', 1);

  ctx.font = '700 14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText(`操作日情绪日记 · ${diary.date}`, x + 16, y + 27, width - 120);

  if (collapsed) {
    // 折叠：只留标题与一个「已折叠」标记。正文、量表一个字都不画——
    // 画了再遮住没有意义，导出的 PNG 是可以被放大、被转发的。
    ctx.font = '500 10px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#94A3B8';
    ctx.textAlign = 'right';
    ctx.fillText('已折叠', x + width - 16, y + 27);
    ctx.textAlign = 'left';
    return;
  }

  ctx.font = '500 10px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText('最近起波澜的事情', x + 16, y + 45, width - 32);

  ctx.font = '500 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#1F2937';
  const eventLines = wrapCanvasText(ctx, diary.eventText, width - 32);
  eventLines.forEach((line, index) => {
    ctx.fillText(line, x + 16, y + 63 + index * 18, width - 32);
  });

  const metricsTop = y + 73 + eventLines.length * 18;
  ctx.strokeStyle = '#E5E7EB';
  ctx.beginPath();
  ctx.moveTo(x + 16, metricsTop - 13);
  ctx.lineTo(x + width - 16, metricsTop - 13);
  ctx.stroke();

  const metrics: ReadonlyArray<readonly [string, string]> = diary.pomsTotal
    ? [
      ['POMS TMD', diary.pomsTotal],
      ['PANAS 正性', diary.panasPositive ?? '—'],
      ['PANAS 负性', diary.panasNegative ?? '—'],
      [
        '个人主动性 PI-7',
        diary.personalInitiativeTotal && diary.personalInitiativeMean
          ? `${diary.personalInitiativeTotal} · ${diary.personalInitiativeMean}`
          : '未填写',
      ],
      ['焦虑 HADS-A', diary.anxiety],
      ['抑郁 HADS-D', diary.depression],
    ]
    : [
      ['历史 SAM 效价', diary.legacyValence ?? '—'],
      ['历史 SAM 唤醒度', diary.legacyArousal ?? '—'],
      ['焦虑 HADS-A', diary.anxiety],
      ['抑郁 HADS-D', diary.depression],
    ];
  const metricWidth = (width - 32) / metrics.length;
  metrics.forEach(([label, value], index) => {
    const itemX = x + 16 + index * metricWidth;
    ctx.font = '500 10px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.fillText(label, itemX, metricsTop, metricWidth - 12);
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = '#1F2937';
    ctx.fillText(value, itemX, metricsTop + 17, metricWidth - 12);
  });

  if (diary.pomsDimensions) {
    const dimensionsTop = metricsTop + 42;
    ctx.font = '500 10px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.fillText('POMS 七个分量表', x + 16, dimensionsTop, width - 32);
    ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = '#1F2937';
    wrapCanvasText(ctx, diary.pomsDimensions, width - 32).forEach((line, index) => {
      ctx.fillText(line, x + 16, dimensionsTop + 16 + index * 14, width - 32);
    });
  }
}

export async function exportCampaignLegsListPng(input: ExportInput): Promise<string> {
  const legsCanvas = buildCampaignLegsListCanvas(input, { includeHeader: true });
  return downloadCanvas(
    legsCanvas.canvas,
    `${safeFileName(campaignExportFileBaseName(input.campaign, input.accountName))}.png`,
  );
}

const BOARD_CHART_NOTE_H = 72;

function drawChartUnavailableNote(ctx: CanvasRenderingContext2D, note: string, x: number, y: number, width: number) {
  fillRoundedRect(ctx, x - 10, y - 10, width + 20, BOARD_CHART_NOTE_H, 12, '#FFFFFF');
  strokeRoundedRect(ctx, x - 10, y - 10, width + 20, BOARD_CHART_NOTE_H, 12, '#E5E7EB', 1);
  ctx.font = '500 13px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.textAlign = 'center';
  const lines = wrapCanvasText(ctx, note, width - 40).slice(0, 2);
  const top = y - 10 + (BOARD_CHART_NOTE_H - lines.length * 18) / 2 + 13;
  lines.forEach((line, index) => ctx.fillText(line, x + width / 2, top + index * 18, width - 40));
  ctx.textAlign = 'left';
}

/** 只生成 PNG，不触发浏览器下载；批量调用可逐张释放画布后打包。 */
export async function renderCampaignBoardPng(input: CampaignBoardExportInput): Promise<{ blob: Blob; fileName: string }> {
  const sections = {
    metadata: input.sections?.metadata !== false,
    overview: input.sections?.overview !== false,
    emotionDiary: input.sections?.emotionDiary !== false,
    chart: input.sections?.chart !== false,
    legs: input.sections?.legs !== false,
  };
  if (!Object.values(sections).some(Boolean)) throw new Error('请至少选择一个导出模块');
  const temporaryCanvases: HTMLCanvasElement[] = [];
  try {
    const title = campaignKlineTitleName(input.campaign);
    const chartIntervalLabel = formatCampaignChartInterval(input.chartInterval);
    const chartViewLabel = input.chartViewLabel ?? '当前视图';
    const chartNote = sections.chart && input.chartUnavailableNote ? input.chartUnavailableNote : null;
    const chart = sections.chart && !chartNote ? captureCampaignChartCanvas(input.chartElement ?? null) : null;
    if (chart) temporaryCanvases.push(chart.canvas);
    const legs = sections.legs ? buildCampaignLegsListCanvas(input, { includeHeader: false, scale: chart?.scale }) : null;
    if (legs) temporaryCanvases.push(legs.canvas);
    const overview = buildCampaignBoardOverview(input);
    const width = Math.max(TABLE_WIDTH + MARGIN_X * 2, (chart?.width ?? 0) + MARGIN_X * 2);
    const chartDisplayWidth = width - MARGIN_X * 2;
    const chartDisplayHeight = chart ? chart.height * (chartDisplayWidth / chart.width) : 0;
    const contentWidth = width - MARGIN_X * 2;
    const overviewGap = 16;
    const overviewWidth = sections.metadata && sections.overview ? (contentWidth - overviewGap) / 2 : contentWidth;
    const overviewHeight = Math.max(
      sections.metadata ? overviewPanelHeight(overview.metadataItems, undefined, overviewWidth) : 0,
      sections.overview ? overviewPanelHeight(overview.pnlItems, overview.pnlNote, overviewWidth) : 0,
    );
    const emotionDiary = sections.emotionDiary ? overview.emotionDiary : null;
    const emotionDiaryHeight = emotionDiary
      ? campaignEmotionDiaryPanelHeight(emotionDiary, contentWidth, overview.emotionDiaryCollapsed)
      : 0;
    const blockHeights = [
      overviewHeight,
      emotionDiaryHeight,
      chart ? BOARD_SECTION_LABEL_H + chartDisplayHeight : chartNote ? BOARD_SECTION_LABEL_H + BOARD_CHART_NOTE_H - 10 : 0,
      legs ? BOARD_SECTION_LABEL_H + legs.height : 0,
    ].filter(value => value > 0);
    const height = BOARD_HEADER_H + blockHeights.reduce((sum, value) => sum + value, 0)
      + Math.max(0, blockHeights.length - 1) * BOARD_SECTION_GAP + BOARD_FOOTER_H;
    const { ctx, rendered } = createRenderedCanvas(width, height, chart?.scale);
    temporaryCanvases.push(rendered.canvas);

    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, 0, width, height);

    ctx.font = '700 24px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#111827';
    ctx.fillText(title, MARGIN_X, 42, width - MARGIN_X * 2);
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = '#64748B';
    const displayCode = formatCampaignDisplayCode(
      input.campaign.campaign_code,
      input.accountName,
      input.campaign.id,
    );
    const moduleLabels = [
      sections.metadata && '战役原数据',
      sections.overview && '盈亏概览',
      emotionDiary && '操作日情绪日记',
      chart && `K 线盘面（${chartViewLabel}）`,
      chartNote && 'K 线盘面（无 K 线）',
      legs && 'Legs 列表',
    ].filter(Boolean);
    ctx.fillText(
      `编号 ${displayCode}${boardUsesChartInterval(input.sections) ? ` · 周期 ${chartIntervalLabel}` : ''} · ${moduleLabels.join(' + ')}`,
      MARGIN_X,
      68,
      width - MARGIN_X * 2,
    );

    let y = BOARD_HEADER_H;
    if (overviewHeight > 0) {
      if (sections.metadata) drawOverviewPanel(ctx, '战役原数据', overview.metadataItems, undefined, MARGIN_X, y, overviewWidth, overviewHeight);
      if (sections.overview) drawOverviewPanel(ctx, '盈亏概览', overview.pnlItems, overview.pnlNote,
        sections.metadata ? MARGIN_X + overviewWidth + overviewGap : MARGIN_X, y, overviewWidth, overviewHeight);
      y += overviewHeight + BOARD_SECTION_GAP;
    }

    if (emotionDiary) {
      drawEmotionDiaryPanel(
        ctx,
        emotionDiary,
        MARGIN_X,
        y,
        contentWidth,
        emotionDiaryHeight,
        overview.emotionDiaryCollapsed,
      );
      y += emotionDiaryHeight + BOARD_SECTION_GAP;
    }

    if (chart) {
      drawSectionLabel(ctx, `K 线盘面（${chartIntervalLabel} · ${chartViewLabel}）`, MARGIN_X, y);
      y += BOARD_SECTION_LABEL_H;
      fillRoundedRect(ctx, MARGIN_X - 10, y - 10, chartDisplayWidth + 20, chartDisplayHeight + 20, 12, '#FFFFFF');
      strokeRoundedRect(ctx, MARGIN_X - 10, y - 10, chartDisplayWidth + 20, chartDisplayHeight + 20, 12, '#E5E7EB', 1);
      ctx.drawImage(chart.canvas, MARGIN_X, y, chartDisplayWidth, chartDisplayHeight);

      y += chartDisplayHeight + BOARD_SECTION_GAP;
    } else if (chartNote) {
      drawSectionLabel(ctx, `K 线盘面（${chartIntervalLabel} · 无 K 线）`, MARGIN_X, y);
      y += BOARD_SECTION_LABEL_H;
      drawChartUnavailableNote(ctx, chartNote, MARGIN_X, y, contentWidth);
      y += BOARD_CHART_NOTE_H - 10 + BOARD_SECTION_GAP;
    }
    if (legs) {
      drawSectionLabel(ctx, `Legs 列表（完整展开 ${input.legs.length}/${input.legs.length} 条）`, MARGIN_X, y);
      y += BOARD_SECTION_LABEL_H;
      fillRoundedRect(ctx, MARGIN_X - 10, y - 10, TABLE_WIDTH + 20, legs.height + 20, 12, '#FFFFFF');
      strokeRoundedRect(ctx, MARGIN_X - 10, y - 10, TABLE_WIDTH + 20, legs.height + 20, 12, '#E5E7EB', 1);
      // Legs 画布左右自带 MARGIN_X 白边（单独导出 Legs 图时的页边）；拼进整板只裁表格本身，
      // 表格才正好落在白框里——整块贴上去会让表格右移 MARGIN_X、越出白框并顶到整图右缘。
      const legsPixelRatio = legs.canvas.width / legs.width;
      ctx.drawImage(
        legs.canvas,
        MARGIN_X * legsPixelRatio, 0, TABLE_WIDTH * legsPixelRatio, legs.canvas.height,
        MARGIN_X, y, TABLE_WIDTH, legs.height,
      );
    }

    ctx.font = '500 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = '#94A3B8';
    ctx.fillText(`导出时间 ${fmtClock(input.exportedAt ?? new Date().toISOString())}`, MARGIN_X, height - 16, width - MARGIN_X * 2);

    return {
      blob: await canvasPngBlob(rendered.canvas),
      fileName: `${safeFileName(campaignExportFileBaseName(input.campaign, input.accountName))}.png`,
    };
  } finally {
    // 多战役逐张导出时及时释放像素缓冲；不能清理传入的页面原始 K 线画布。
    for (const canvas of temporaryCanvases) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

export async function exportCampaignBoardPng(input: CampaignBoardExportInput): Promise<string> {
  const { blob, fileName } = await renderCampaignBoardPng(input);
  return downloadBlob(blob, fileName);
}
