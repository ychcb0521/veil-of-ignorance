/**
 * 【用户要求】交易战役导出 Excel 汇总表：排序方式与盈亏概览里的全部参数，一场战役一行，用于统计分析、找相关性。
 * 数值一律写成数字（不带单位、不按屏幕取整），单位写在表头；读不出的格子留空（不是 0）。
 * 每一列与卡片 / 详情页「盈亏概览」读同一个函数，导出的数与页面上的字一致（只差显示精度）。
 */
import { computeInitialMainExposureNotional } from '@/lib/campaignAnalysis';
import { computeMainPriceEfficiency } from '@/lib/campaignMainPriceChange';
import {
  campaignLeverage,
  importanceValue,
  rowAddCount,
  rowAddEfficiency,
  rowMainPriceEfficiency,
  rowMirrorTpRank,
  rowPayoffRatio,
  rowUnrealizedPriceChangePct,
  selfRatingLabel,
  type CampaignSortRow,
} from '@/lib/campaignListSort';
import { computeAsymmetricRiskContributionRates } from '@/lib/asymmetricRiskMetrics';
import { buildLegPositionShareInputs, campaignMainSideNotional } from '@/lib/legPositionShareInputs';
import { buildTradeRecordLookup, campaignOperationTime } from '@/lib/objectiveOperationTime';
import { formatBeijingTime } from '@/lib/timeFormat';
import type { XlsxCell, XlsxSheet } from '@/lib/xlsxWorkbook';

type AsymmetricSummary = Parameters<typeof computeAsymmetricRiskContributionRates>[1];

export type CampaignSummaryExportOptions = {
  /** 镜像止盈的文字（与卡片同一个读数，由页面给，免得两处各写一套档名）。 */
  mirrorTpLabel: (row: CampaignSortRow) => string;
  /** 全表 DSI / USI 汇总（与统计概览「不对称风险」同一份），算每场的贡献率。 */
  asymmetricSummary: AsymmetricSummary;
};

const STATUS_LABEL: Record<string, string> = {
  active: '进行中',
  closed_profit: '盈利结束',
  closed_loss: '亏损结束',
  closed_breakeven: '打平结束',
  abandoned: '已放弃',
};

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const timeText = (value: string | number | null | undefined): string | null => {
  const text = formatBeijingTime(value ?? null);
  return text === '—' ? null : text.slice(0, 16);
};

type Column = {
  header: string;
  width?: number;
  /** 「说明」工作表里这一列的口径。 */
  note: string;
  value: (row: CampaignSortRow, index: number) => XlsxCell;
};

export function campaignSummaryColumns(options: CampaignSummaryExportOptions): Column[] {
  const contribution = (row: CampaignSortRow) => computeAsymmetricRiskContributionRates(
    { campaign: row.campaign, payoffRatio: rowPayoffRatio(row) },
    options.asymmetricSummary,
  );
  const initialNotional = (row: CampaignSortRow) => finite(computeInitialMainExposureNotional(row.campaign, row.legs, row.tradeRecords));
  const mainSideNotional = (row: CampaignSortRow) => {
    const inputs = buildLegPositionShareInputs(row.legs, buildTradeRecordLookup(row.tradeRecords), undefined, { events: row.campaign.actual_evolution });
    return finite(campaignMainSideNotional(row.campaign.direction, inputs).total);
  };
  return [
    { header: '序号', width: 6, note: '按导出时列表的排序次序编号。', value: (_row, index) => index + 1 },
    { header: '战役编号', width: 30, note: '战役的唯一编号（campaign_code）。', value: row => row.campaign.campaign_code ?? row.campaign.id },
    { header: '标题', width: 28, note: '战役标题。', value: row => row.campaign.title },
    { header: '标的', width: 14, note: '交易对。', value: row => row.campaign.symbol },
    { header: '方向', width: 6, note: '主多 / 主空。', value: row => (row.campaign.direction === 'main_short' ? '主空' : '主多') },
    { header: '状态', width: 9, note: '盈利结束 / 亏损结束 / 打平结束 / 进行中 / 已放弃。', value: row => STATUS_LABEL[row.campaign.status] ?? row.campaign.status },
    { header: '操作时间（北京）', width: 17, note: '客观操作时间（真实发生的时刻，北京时间），不是时光机里的模拟时间。', value: row => timeText(campaignOperationTime(row.legs, row.tradeRecords)) },
    { header: '开始（K线时间）', width: 17, note: '战役开始的 K 线（模拟）时间，北京时间。', value: row => timeText(row.campaign.opened_at) },
    { header: '结束（K线时间）', width: 17, note: '战役结束的 K 线（模拟）时间，北京时间；进行中为空。', value: row => timeText(row.campaign.closed_at) },
    {
      header: '持续（小时）', width: 10, note: '结束 − 开始，按 K 线时间算；进行中为空。',
      value: (row) => {
        const start = Date.parse(row.campaign.opened_at ?? '');
        const end = Date.parse(row.campaign.closed_at ?? '');
        return Number.isFinite(start) && Number.isFinite(end) && end >= start ? (end - start) / 3_600_000 : null;
      },
    },
    { header: '杠杆倍数', width: 8, note: '战役记录的初始杠杆，没记时取各腿里最大的那个（与卡片杠杆标签同一个数）。', value: row => { const v = campaignLeverage(row.campaign, row.legs); return v > 0 ? v : null; } },
    { header: '自评（0–5）', width: 9, note: '五点自评：1 非常差 · 2 很差 · 3 一般 · 4 很好 · 5 非常好；0 = 未评。', value: row => importanceValue(row.campaign) },
    { header: '自评（文字）', width: 9, note: '自评的量表文字；未评为空。', value: row => selfRatingLabel(importanceValue(row.campaign)) },
    { header: '镜像止盈', width: 13, note: '镜像止盈结果：已实现 / 未实现 × 盈利 / 持平 / 亏损（|b| ≤ 0.1 记持平），与卡片同一个读数。', value: row => options.mirrorTpLabel(row) },
    { header: '镜像止盈档位（0–5）', width: 12, note: '镜像止盈排序用的六档：0–2 = 未实现·亏损 / 持平 / 盈利，3–5 = 已实现·亏损 / 持平 / 盈利。', value: row => rowMirrorTpRank(row) },
    { header: '预期回撤（%）', width: 11, note: '主力开仓价到初始对冲边界的距离，占开仓价的百分数（3.35 表示 3.35%）。', value: row => (row.initialExpectedMaxDrawdownPct > 0 ? row.initialExpectedMaxDrawdownPct : null) },
    { header: '涨跌幅（%）', width: 10, note: '战役的涨跌幅，按主力方向计（空单价跌为正），百分数；主力未平仓为空。', value: row => finite(row.mainPriceChangePct) },
    { header: '涨跌幅倍数 η', width: 11, note: '涨跌幅 ÷ 预期回撤（倍）。', value: row => rowMainPriceEfficiency(row) },
    { header: '盈亏比 b（R）', width: 11, note: '已实现盈亏 ÷ 初始最大预期亏损（倍数，2 表示赚到 2R）。', value: row => rowPayoffRatio(row) },
    { header: '加仓效用', width: 9, note: 'b ÷ |η|，正负跟随 b；只算做过加仓的战役，涨跌幅倍数显示为 0.00 时不算。', value: row => rowAddEfficiency(row) },
    { header: '加仓次数', width: 8, note: '真的成交过的加仓腿条数；没加仓为 0。', value: row => rowAddCount(row) },
    { header: '几何期望 Gᵢ', width: 10, note: '单场几何期望因子 Gᵢ = 1 + bᵢ × x（x 为每场统一的下注比例）；与卡片显示同一个数（卡片取两位小数）。', value: row => { const v = finite(row.geometricExpectancy); return v == null ? null : 1 + v; } },
    { header: '算术期望（R）', width: 10, note: '单场算术期望 Eᵢ = P(赢) × bᵢ − (1 − P(赢))，单位 R。', value: row => finite(row.arithmeticExpectancy) },
    { header: '最大预期亏损（USDT）', width: 14, note: '初始最大预期亏损 L：主力从开仓价跌到初始对冲边界时的亏损（盈亏概览同名项）。', value: row => (row.initialExpectedMaxLoss > 0 ? row.initialExpectedMaxLoss : null) },
    { header: '已实现 P&L（USDT）', width: 14, note: '已实现盈亏（含平仓价校正，与盈亏概览同名项）。', value: row => finite(row.campaign.final_realized_pnl) },
    { header: '峰值涨幅（%）', width: 11, note: '主力有效持仓窗口内按方向计算的最大有利价格涨幅。', value: row => finite(row.peakPriceChangePct) },
    { header: '峰值涨幅倍数', width: 11, note: '峰值涨幅 ÷ 预期回撤（倍）。', value: row => computeMainPriceEfficiency(row.peakPriceChangePct, row.initialExpectedMaxDrawdownPct) },
    { header: '涨幅未兑现（%）', width: 12, note: '峰值涨幅 − 最终涨跌幅；仅峰值涨幅严格大于预期回撤时计算。', value: row => rowUnrealizedPriceChangePct(row) },
    { header: '动态最大回撤（%）', width: 13, note: '有效持仓期间此前峰值到此后谷值的最大回撤；最后一次滚动对冲与主力同平时，窗口结束于该对冲开仓。', value: row => finite(row.dynamicMaxDrawdownPct) },
    { header: '仓位放大（倍）', width: 11, note: '主方向总名义仓位 ÷ 主力开仓名义仓位。', value: row => { const initial = initialNotional(row); const total = mainSideNotional(row); return initial != null && initial > 0 && total != null ? total / initial : null; } },
    { header: 'DSI 贡献（%）', width: 10, note: '这场亏损战役 b² 占全表亏损组平方和的比例（百分数）；盈利战役为空。', value: row => finite(contribution(row).dsiContributionPct) },
    { header: 'USI 贡献（%）', width: 10, note: '这场盈利战役 b² 占全表盈利组平方和的比例（百分数）；亏损战役为空。', value: row => finite(contribution(row).usiContributionPct) },
  ];
}

/** 两张工作表：「战役汇总」（一场一行）与「说明」（逐列口径）。 */
export function buildCampaignSummarySheets(rows: readonly CampaignSortRow[], options: CampaignSummaryExportOptions): XlsxSheet[] {
  const columns = campaignSummaryColumns(options);
  return [
    {
      name: '战役汇总',
      columns: columns.map(column => ({ header: column.header, width: column.width })),
      rows: rows.map((row, index) => columns.map(column => {
        try {
          return column.value(row, index);
        } catch {
          return null;
        }
      })),
    },
    {
      name: '说明',
      columns: [{ header: '列', width: 24 }, { header: '口径', width: 100 }],
      rows: columns.map(column => [column.header, column.note]),
    },
  ];
}
