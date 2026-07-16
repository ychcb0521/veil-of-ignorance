import { HEDGE_TYPE_LABELS } from '@/lib/hedgeTypes';
import {
  buildTradeRecordLookup,
  campaignOperationTime,
  journalOperationTime,
} from '@/lib/objectiveOperationTime';
import { LEG_ROLE_LABELS } from '@/lib/strategyTemplates';
import { resolveLegExecution, type LegExitPriceCorrections } from '@/lib/campaignLegExecution';
import { formatCampaignPayoffRatio } from '@/lib/campaignAnalysis';
import type { TradeCampaign, TradeJournal } from '@/types/journal';
import type { CampaignReverseHedgeOrder, TradeRecord } from '@/types/trading';

type ExportInput = {
  campaign: TradeCampaign;
  legs: TradeJournal[];
  tradeRecords: TradeRecord[];
  reverseHedgeOrders: CampaignReverseHedgeOrder[];
  legExitPriceCorrections?: LegExitPriceCorrections;
};

export type CampaignBoardExportInput = ExportInput & {
  chartElement: HTMLElement | null;
  pnlOverview: {
    campaignMaxProfitReal: number;
    campaignMaxDrawdownReal: number;
    initialExpectedMaxLoss: number;
    profitCaptureRatio: number;
  };
};

export type CampaignLegsExportCellLine = {
  text: string;
  color?: string;
  bold?: boolean;
};

export type CampaignLegsExportRow = {
  legId: string;
  cells: CampaignLegsExportCellLine[][];
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
  { title: '#', width: 56 },
  { title: '角色', width: 150 },
  { title: '时间', width: 300 },
  { title: '开仓价', width: 122 },
  { title: '平仓价', width: 122 },
  { title: '仓位', width: 122 },
  { title: '状态', width: 108 },
  { title: 'R̄', width: 82 },
  { title: '反向挂单', width: 470 },
] as const;

const TABLE_WIDTH = COLUMNS.reduce((sum, column) => sum + column.width, 0);
const MARGIN_X = 40;
const HEADER_H = 88;
const TABLE_HEADER_H = 38;
const ROW_PAD_Y = 12;
const LINE_H = 17;
const FOOTER_H = 24;
const BOARD_HEADER_H = 92;
const BOARD_OVERVIEW_H = 154;
const BOARD_SECTION_GAP = 18;
const BOARD_SECTION_LABEL_H = 28;
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

function campaignExportFileBaseName(campaign: TradeCampaign): string {
  const code = campaign.campaign_code?.trim();
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

function timeMs(value: number | string | null | undefined): number | null {
  if (!value) return null;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
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

function campaignStatusLabel(status: TradeCampaign['status']): string {
  if (status === 'closed_profit') return '盈利结束';
  if (status === 'closed_loss') return '亏损结束';
  if (status === 'closed_breakeven') return '平盈结束';
  if (status === 'abandoned') return '已放弃';
  return '进行中';
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

function statusForLeg(leg: TradeJournal, record: TradeRecord | null): { label: string; color: string } {
  if (record || leg.post_simulated_close_time || leg.post_real_close_time || leg.post_outcome) return { label: '已平仓', color: '#0ECB81' };
  if (leg.leg_role === 'mirror_tp' || leg.leg_role?.startsWith('hedge_')) return { label: '挂单中', color: '#D89B00' };
  return { label: '进行中', color: '#848E9C' };
}

function statusForReverseOrder(order: CampaignReverseHedgeOrder): string {
  if (order.status === 'pending') return '挂单中';
  if (order.status === 'triggered') return '已触发';
  return '已撤';
}

function buildReverseOrderLegMap(
  legs: TradeJournal[],
  tradeRecords: TradeRecord[],
  reverseHedgeOrders: CampaignReverseHedgeOrder[],
): Map<string, string> {
  const recordMap = buildTradeRecordLookup(tradeRecords);
  const legIdByTradeRecordId = new Map(
    legs
      .filter(leg => Boolean(leg.trade_record_id))
      .map(leg => [leg.trade_record_id as string, leg.id]),
  );
  const legOpens = legs
    .map(leg => {
      const rec = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
      return { id: leg.id, openMs: timeMs(rec?.openTime ?? leg.pre_simulated_time) };
    })
    .filter((item): item is { id: string; openMs: number } => item.openMs != null)
    .sort((a, b) => a.openMs - b.openMs);
  const map = new Map<string, string>();

  for (const order of reverseHedgeOrders) {
    const directLegId = order.tradeRecordId
      ? legIdByTradeRecordId.get(order.tradeRecordId)
      : legIdByTradeRecordId.get(order.id);
    if (directLegId) {
      map.set(order.id, directLegId);
      continue;
    }

    let assignedId: string | null = legOpens[0]?.id ?? null;
    for (const { id, openMs } of legOpens) {
      if (openMs <= order.createdAt) assignedId = id;
      else break;
    }
    if (assignedId) map.set(order.id, assignedId);
  }

  return map;
}

export function buildCampaignLegsExportRows(input: ExportInput): CampaignLegsExportRow[] {
  const recordMap = buildTradeRecordLookup(input.tradeRecords);
  const reverseOrderLegMap = buildReverseOrderLegMap(input.legs, input.tradeRecords, input.reverseHedgeOrders);

  return input.legs.map(leg => {
    const record = leg.trade_record_id ? recordMap.get(leg.trade_record_id) ?? null : null;
    const execution = resolveLegExecution(leg, record, input.legExitPriceCorrections);
    const status = statusForLeg(leg, record);
    const roleLabel = leg.leg_role ? LEG_ROLE_LABELS[leg.leg_role] ?? leg.leg_role : '—';
    const openLabel = fmtClock(execution.openTime ?? leg.pre_simulated_time);
    const closeLabel = fmtClock(execution.closeTime);
    const operationLabel = fmtClock(journalOperationTime(leg, record));
    const entryPriceValue = execution.entryPrice;
    const exitPriceValue = execution.exitPrice;
    const hedgeSummary = leg.order_kind === 'hedge' && leg.hedge_type
      ? `${HEDGE_TYPE_LABELS[leg.hedge_type]}${leg.hedge_necessity_pct != null ? ` · ${leg.hedge_necessity_pct.toFixed(0)}%` : ''}`
      : null;
    const reverseOrdersForLeg = input.reverseHedgeOrders.filter(order => reverseOrderLegMap.get(order.id) === leg.id);
    const reverseLines: CampaignLegsExportCellLine[] = reverseOrdersForLeg.length === 0
      ? [{ text: '—', color: '#848E9C' }]
      : reverseOrdersForLeg.flatMap((order, index): CampaignLegsExportCellLine[] => {
          const sideColor = order.side === 'SHORT' ? '#6D28D9' : '#002FA7';
          return [
            ...(index > 0 ? [{ text: '', color: '#848E9C' }] : []),
            { text: `${order.side === 'SHORT' ? '空' : '多'} ${fmtPrice(order.price)} · ${statusForReverseOrder(order)}`, color: sideColor, bold: true },
            { text: `委 ${fmtClock(order.createdAt)}`, color: '#5F6B7A' },
            ...(order.status === 'triggered' ? [{ text: `触 ${fmtClock(order.triggeredAt)}`, color: '#5F6B7A' }] : []),
            { text: `${order.status === 'triggered' ? '平' : '撤'} ${order.cancelledAt ? fmtClock(order.cancelledAt) : '—'}`, color: '#5F6B7A' },
          ];
        });

    const exitPriceLines: CampaignLegsExportCellLine[] = [
      { text: fmtPrice(exitPriceValue), bold: Boolean(execution.exitCorrection) },
      ...(execution.exitCorrection ? [
        { text: `原 ${fmtPrice(execution.exitCorrection.originalExitPrice)}`, color: '#848E9C' },
        { text: `K线 ${fmtPrice(execution.exitCorrection.candleLow)}-${fmtPrice(execution.exitCorrection.candleHigh)}`, color: '#848E9C' },
      ] : []),
    ];
    const cells: CampaignLegsExportCellLine[][] = [
      [{ text: String(leg.leg_sequence ?? '—') }],
      [
        { text: roleLabel, bold: true },
        ...(leg.source === 'retroactive_from_record' ? [{ text: '回填', color: '#848E9C' }] : []),
      ],
      [
        { text: `开 ${openLabel}` },
        { text: `平 ${closeLabel}` },
        { text: `操作 ${operationLabel}` },
        ...(hedgeSummary ? [{ text: hedgeSummary, color: '#D89B00' }] : []),
      ],
      [{ text: fmtPrice(entryPriceValue) }],
      exitPriceLines,
      [{ text: leg.pre_position_size != null ? leg.pre_position_size.toFixed(2) : '—' }],
      [{ text: status.label, color: status.color, bold: true }],
      [{ text: leg.post_r_multiple != null ? leg.post_r_multiple.toFixed(2) : '—' }],
      reverseLines,
    ];
    const maxLines = Math.max(...cells.map(cell => cell.length));
    return {
      legId: leg.id,
      cells,
      height: Math.max(58, ROW_PAD_Y * 2 + maxLines * LINE_H),
    };
  });
}

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

function drawLines(
  ctx: CanvasRenderingContext2D,
  lines: CampaignLegsExportCellLine[],
  x: number,
  y: number,
  maxWidth: number,
) {
  lines.forEach((line, index) => {
    ctx.font = `${line.bold ? 700 : 500} 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    ctx.fillStyle = line.color ?? '#202630';
    ctx.fillText(line.text, x, y + index * LINE_H, maxWidth);
  });
}

function drawLegsTable(ctx: CanvasRenderingContext2D, rows: CampaignLegsExportRow[], startY: number) {
  let y = startY;
  let x = MARGIN_X;
  ctx.fillStyle = '#EEF2F7';
  ctx.fillRect(MARGIN_X, y, TABLE_WIDTH, TABLE_HEADER_H);
  ctx.font = '700 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = '#64748B';
  COLUMNS.forEach(column => {
    ctx.fillText(column.title, x + 10, y + 24, column.width - 20);
    x += column.width;
  });

  y += TABLE_HEADER_H;
  rows.forEach((row, rowIndex) => {
    x = MARGIN_X;
    ctx.fillStyle = rowIndex % 2 === 0 ? '#FFFFFF' : '#FAFBFD';
    ctx.fillRect(MARGIN_X, y, TABLE_WIDTH, row.height);
    ctx.strokeStyle = '#E5E7EB';
    ctx.beginPath();
    ctx.moveTo(MARGIN_X, y + row.height);
    ctx.lineTo(MARGIN_X + TABLE_WIDTH, y + row.height);
    ctx.stroke();

    row.cells.forEach((cell, cellIndex) => {
      drawLines(ctx, cell, x + 10, y + ROW_PAD_Y + 12, COLUMNS[cellIndex].width - 20);
      x += COLUMNS[cellIndex].width;
    });
    y += row.height;
  });
}

function buildCampaignLegsListCanvas(input: ExportInput, options: LegsCanvasOptions = {}): RenderedCanvas {
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
    ctx.fillText(`编号 ${input.campaign.campaign_code} · 共 ${input.legs.length} legs`, MARGIN_X, 76, TABLE_WIDTH - 260);
  }

  drawLegsTable(ctx, rows, headerHeight);

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

async function downloadCanvas(canvas: HTMLCanvasElement, fileName: string): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(nextBlob => {
      if (nextBlob) resolve(nextBlob);
      else reject(new Error('PNG 生成失败'));
    }, 'image/png');
  });
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

function drawSectionLabel(ctx: CanvasRenderingContext2D, label: string, x: number, y: number) {
  ctx.font = '700 14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText(label, x, y + 18);
}

type OverviewItem = {
  label: string;
  value: string;
  color?: string;
};

export type CampaignBoardOverview = {
  metadataItems: OverviewItem[];
  pnlItems: OverviewItem[];
};

/** 导出图顶部两块摘要的唯一数据源，避免页面字段演进时漏掉战役原数据或盈亏信息。 */
export function buildCampaignBoardOverview(input: CampaignBoardExportInput): CampaignBoardOverview {
  const legCounts = campaignLegCounts(input.legs);
  const operationTime = campaignOperationTime(input.legs, input.tradeRecords);
  const realizedPnl = input.campaign.final_realized_pnl;
  return {
    metadataItems: [
      { label: '操作时间', value: operationTime == null ? '—' : fmtClock(operationTime) },
      { label: '方向 / 状态', value: `${input.campaign.direction === 'main_long' ? '主多' : '主空'} / ${campaignStatusLabel(input.campaign.status)}` },
      { label: '战役开始', value: fmtClock(input.campaign.opened_at) },
      { label: '战役结束', value: fmtClock(input.campaign.closed_at) },
      { label: '持续时间', value: fmtCampaignDuration(input.campaign.opened_at, input.campaign.closed_at) },
      { label: '策略', value: input.campaign.strategy_template },
      { label: 'Legs 构成', value: `共 ${input.legs.length} · 主仓 ${legCounts.main} / 对冲 ${legCounts.hedge} / TP ${legCounts.tp} / 其他 ${legCounts.other}` },
      { label: '初始主仓 / 杠杆', value: `${fmtAmount(input.campaign.initial_main_size_usdt, ' USDT')} / ${input.campaign.initial_leverage == null ? '—' : `${input.campaign.initial_leverage.toFixed(0)}x`}` },
    ],
    pnlItems: [
      {
        label: '已实现 P&L',
        value: fmtAmount(realizedPnl, ' USDT'),
        color: realizedPnl == null ? '#64748B' : realizedPnl > 0 ? '#0ECB81' : realizedPnl < 0 ? '#F6465D' : '#64748B',
      },
      { label: '最终 R', value: fmtAmount(input.campaign.final_r_multiple) },
      { label: '峰值浮盈', value: fmtAmount(input.pnlOverview.campaignMaxProfitReal, ' USDT'), color: '#0ECB81' },
      { label: '最大回撤', value: fmtAmount(input.pnlOverview.campaignMaxDrawdownReal, ' USDT'), color: '#F6465D' },
      { label: '最大预期亏损', value: fmtAmount(input.pnlOverview.initialExpectedMaxLoss, ' USDT'), color: '#F6465D' },
      { label: '盈亏比', value: formatCampaignPayoffRatio(input.pnlOverview.profitCaptureRatio, 2) },
      { label: '战役编号', value: input.campaign.campaign_code || '—' },
    ],
  };
}

function drawOverviewPanel(
  ctx: CanvasRenderingContext2D,
  title: string,
  items: OverviewItem[],
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
  items.forEach((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const itemX = x + 16 + column * columnWidth;
    const itemY = y + 52 + row * 27;
    ctx.font = '500 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.fillText(item.label, itemX, itemY, columnWidth - 12);
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    ctx.fillStyle = item.color ?? '#1F2937';
    ctx.fillText(item.value, itemX, itemY + 16, columnWidth - 12);
  });
}

export async function exportCampaignLegsListPng(input: ExportInput): Promise<string> {
  const title = campaignKlineTitleName(input.campaign);
  const legsCanvas = buildCampaignLegsListCanvas(input, { includeHeader: true });
  return downloadCanvas(legsCanvas.canvas, `${safeFileName(campaignExportFileBaseName(input.campaign))}.png`);
}

export async function exportCampaignBoardPng(input: CampaignBoardExportInput): Promise<string> {
  const title = campaignKlineTitleName(input.campaign);
  const chart = captureCampaignChartCanvas(input.chartElement);
  const legs = buildCampaignLegsListCanvas(input, { includeHeader: false, scale: chart.scale });
  const overview = buildCampaignBoardOverview(input);
  const width = Math.max(TABLE_WIDTH + MARGIN_X * 2, chart.width + MARGIN_X * 2);
  const chartDisplayWidth = width - MARGIN_X * 2;
  const chartDisplayHeight = chart.height * (chartDisplayWidth / chart.width);
  const height = BOARD_HEADER_H
    + BOARD_OVERVIEW_H
    + BOARD_SECTION_GAP
    + BOARD_SECTION_LABEL_H
    + chartDisplayHeight
    + BOARD_SECTION_GAP
    + BOARD_SECTION_LABEL_H
    + legs.height
    + BOARD_FOOTER_H;
  const { ctx, rendered } = createRenderedCanvas(width, height, chart.scale);

  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(0, 0, width, height);

  ctx.font = '700 24px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = '#111827';
  ctx.fillText(title, MARGIN_X, 42, width - MARGIN_X * 2);
  ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = '#64748B';
  ctx.fillText(
    `编号 ${input.campaign.campaign_code} · 战役原数据 + 盈亏概览 + K 线盘面（当前视图）+ Legs 列表`,
    MARGIN_X,
    68,
    width - MARGIN_X * 2,
  );

  let y = BOARD_HEADER_H;
  const contentWidth = width - MARGIN_X * 2;
  const overviewGap = 16;
  const overviewWidth = (contentWidth - overviewGap) / 2;
  drawOverviewPanel(ctx, '战役原数据', overview.metadataItems, MARGIN_X, y, overviewWidth, BOARD_OVERVIEW_H);
  drawOverviewPanel(ctx, '盈亏概览', overview.pnlItems, MARGIN_X + overviewWidth + overviewGap, y, overviewWidth, BOARD_OVERVIEW_H);
  y += BOARD_OVERVIEW_H + BOARD_SECTION_GAP;

  drawSectionLabel(ctx, 'K 线盘面（当前视图）', MARGIN_X, y);
  y += BOARD_SECTION_LABEL_H;
  fillRoundedRect(ctx, MARGIN_X - 10, y - 10, chartDisplayWidth + 20, chartDisplayHeight + 20, 12, '#FFFFFF');
  strokeRoundedRect(ctx, MARGIN_X - 10, y - 10, chartDisplayWidth + 20, chartDisplayHeight + 20, 12, '#E5E7EB', 1);
  ctx.drawImage(chart.canvas, MARGIN_X, y, chartDisplayWidth, chartDisplayHeight);

  y += chartDisplayHeight + BOARD_SECTION_GAP;
  drawSectionLabel(ctx, `Legs 列表（完整展开 ${input.legs.length}/${input.legs.length} 条）`, MARGIN_X, y);
  y += BOARD_SECTION_LABEL_H;
  fillRoundedRect(ctx, MARGIN_X - 10, y - 10, TABLE_WIDTH + 20, legs.height + 20, 12, '#FFFFFF');
  strokeRoundedRect(ctx, MARGIN_X - 10, y - 10, TABLE_WIDTH + 20, legs.height + 20, 12, '#E5E7EB', 1);
  ctx.drawImage(legs.canvas, MARGIN_X, y, legs.width, legs.height);

  ctx.font = '500 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = '#94A3B8';
  ctx.fillText(`导出时间 ${fmtClock(new Date().toISOString())}`, MARGIN_X, height - 16, width - MARGIN_X * 2);

  return downloadCanvas(rendered.canvas, `${safeFileName(campaignExportFileBaseName(input.campaign))}.png`);
}
