import { describe, expect, it } from 'vitest';
import { buildCampaignSummarySheets, campaignSummaryColumns } from '@/lib/campaignSummaryExport';
import { rowAddCount, rowAddEfficiency, rowMagicB, rowMainPriceEfficiency, rowPayoffRatio } from '@/lib/campaignListSort';
import { summarizeAsymmetricRiskMetrics } from '@/lib/asymmetricRiskMetrics';
import { makeSortRow } from '@/test/fixtures/campaignSortRows';

const rows = [
  makeSortRow({ id: 'win', title: '赚', pnl: 300, adds: 2, pcr: 300, dd: 2, mpc: 6, arith: 1.0, geo: 0.3, importance: 4 }),
  makeSortRow({ id: 'loss', title: '亏', pnl: -50, pcr: -50, dd: 2.5, mpc: -1, arith: -0.75, geo: -0.05 }),
  makeSortRow({ id: 'none', title: '算不出', pnl: null, time: null }),
];
rows[0].dynamicMaxDrawdownPct = 4.5;
rows[0].positionGeometricMultiple = 6.25;
rows[0].effectivePriceChangePct = 29.4117647059;
rows[0].magicB = 3;
rows[0].profitCaptureRatio = 900;
rows[0].arithmeticExpectancy = 999;
rows[0].geometricExpectancy = 999;
rows[1].magicB = -0.5;
rows[2].magicB = null;
const options = {
  mirrorTpLabel: () => '未实现',
  asymmetricSummary: summarizeAsymmetricRiskMetrics(rows.map(row => ({ campaign: row.campaign, payoffRatio: rowPayoffRatio(row) }))),
};

describe('【用户要求】交易战役 Excel 汇总表', () => {
  const [summary, notes] = buildCampaignSummarySheets(rows, options);
  const headers = summary.columns.map(column => column.header);
  const cell = (rowIndex: number, header: string) => summary.rows[rowIndex][headers.indexOf(header)];

  it('排序方式与盈亏概览的参数都在表里，「说明」逐列写口径', () => {
    for (const header of [
      '操作时间（北京）', '镜像止盈', '预期回撤（%）', '首仓涨跌幅（%）', '首仓涨跌幅倍数 η', '神奇的 b', '加仓效用', '加仓次数',
      '算术期望（R）', '杠杆倍数', '自评（0–5）',
      '相对涨幅（倍）', '盈亏比', '几何仓位（倍）', '神奇的 b',
      '最大预期亏损（USDT）', '已实现 P&L（USDT）', '峰值涨幅（%）', '几何期望', '几何期望（几何仓位）', '几何期望（理论）', '涨幅未兑现（%）', '动态最大回撤（%）', '仓位放大（倍）', 'DSI 贡献（%）', 'USI 贡献（%）',
    ]) expect(headers, header).toContain(header);
    expect(notes.rows.map(row => row[0])).toEqual(headers);
    expect(notes.rows.every(row => typeof row[1] === 'string' && (row[1] as string).length > 0)).toBe(true);
    const bNote = notes.rows.find(row => row[0] === '神奇的 b')?.[1];
    expect(bNote).toContain('神奇的 b = 几何仓位 × 相对涨幅');
    expect(bNote).toContain('相对涨幅 2.00× 参与计算为 2');
    expect(bNote).not.toContain('首次实际加仓价格 T₁');
    expect(bNote).not.toContain('+ 结算修正');
    expect(bNote).not.toContain('两种算法等价');
  });

  it('数值与页面同一组函数、写成数字；几何期望写因子 1 + v；读不出的留空', () => {
    expect(cell(0, '盈亏比')).toBe(rowPayoffRatio(rows[0]));
    expect(cell(0, '首仓涨跌幅倍数 η')).toBe(rowMainPriceEfficiency(rows[0]));
    expect(cell(0, '加仓效用')).toBe(rowAddEfficiency(rows[0]));
    expect(cell(0, '加仓次数')).toBe(rowAddCount(rows[0]));
    expect(cell(0, '加仓次数')).toBe(2);
    expect(cell(0, '峰值涨幅（%）')).toBe(rows[0].peakPriceChangePct);
    // 【用户要求】几何期望（原几何增长与几何期望合并，三种算法各一列）：方法一 1 + 0.1 × 盈亏比，方法二 1 + 0.1 × 神奇的 b
    expect(headers).not.toContain('峰值涨幅倍数');
    expect(headers).not.toContain('几何期望 Gᵢ');
    expect(cell(0, '几何期望')).toBeCloseTo(1 + 0.1 * (rowPayoffRatio(rows[0]) as number), 9);
    expect(cell(0, '几何期望（几何仓位）')).toBeCloseTo(1 + 0.1 * (rowMagicB(rows[0]) as number), 9);
    expect(cell(0, '涨幅未兑现（%）')).toBeCloseTo((rows[0].peakPriceChangePct as number) - 6, 9);
    expect(cell(0, '动态最大回撤（%）')).toBe(4.5);
    expect(cell(0, '几何期望')).toBeCloseTo(1.9, 9);
    expect(cell(0, '算术期望（R）')).toBe(4);
    expect(cell(0, '几何仓位（倍）')).toBe(6.25);
    expect(cell(0, '相对涨幅（倍）')).toBeCloseTo(0.294117647059);
    expect(headers).not.toContain('相对涨幅倍数');
    expect(cell(0, '神奇的 b')).toBe(3);
    expect(cell(1, '神奇的 b')).toBe(-0.5);
    expect(headers.slice(headers.indexOf('几何仓位（倍）'), headers.indexOf('几何仓位（倍）') + 5)).toEqual(['几何仓位（倍）', '几何仓位（理论）', '相对涨幅（倍）', '盈亏比', '神奇的 b']);
    expect(cell(0, '自评（0–5）')).toBe(4);
    expect(cell(0, '自评（文字）')).toBe('很好');
    expect(cell(0, '预期回撤（%）')).toBe(2);
    // 盈利场只有 USI 贡献，亏损场只有 DSI 贡献
    expect(cell(0, 'DSI 贡献（%）')).toBeNull();
    expect(typeof cell(0, 'USI 贡献（%）')).toBe('number');
    expect(typeof cell(1, 'DSI 贡献（%）')).toBe('number');
    // 第三场：没有风险分母、没有操作时间 → 留空，不写 0
    expect(cell(2, '神奇的 b')).toBeNull();
    expect(cell(2, '操作时间（北京）')).toBeNull();
    expect(cell(2, '序号')).toBe(3);
  });

  it('列定义是一份：表头与「说明」同序', () => {
    expect(campaignSummaryColumns(options).map(column => column.header)).toEqual(headers);
  });
});
