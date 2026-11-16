import { describe, expect, it } from 'vitest';
import { buildXlsxBytes } from '@/lib/xlsxWorkbook';
import { readEntryPeriodWorkbook } from '@/lib/entryPeriodWorkbook';
import { mergeEntryPeriodSignals } from '@/lib/entryPeriodSignals';
import { setSignalQuality, signalChartSymbol } from '@/lib/signalLibrary';

const columns = ['日期', '币种', '进退场周期', '市场'].map(header => ({ header }));
const workbook = (rows: (string | number)[][], sheet = '数据') => {
  const buffer = Uint8Array.from(buildXlsxBytes([{ name: sheet, columns, rows }])).buffer;
  return { arrayBuffer: async () => buffer } as File;
};

describe('进场期信号库', () => {
  it('只收表中首日，保留原标的和市场，按北京时间 16:00 保存', async () => {
    const rows = await readEntryPeriodWorkbook(workbook([
      ['2025-04-11', 'BTC', '进1', ''],
      ['2025-04-22', '期权波动率', '进1（逼近）', ''],
      ['2025-04-23', 'BTC', '进10', ''],
      ['2025-04-24', 'BTC', '退1', ''],
      ['2025-04-25', '币种甲', '进1', 'A股'],
    ]));
    expect(rows.map(row => [row.symbol, row.timeLabel, row.entryPeriod.market])).toEqual([
      ['BTC', '2025-04-11 16:00', 'crypto'],
      ['期权波动率', '2025-04-22 16:00', 'indicator'],
      ['币种甲', '2025-04-25 16:00', 'cn'],
    ]);
    expect(rows[0].timeMs).toBe(Date.parse('2025-04-11T08:00:00Z'));
    expect(rows[1].entryPeriod.mark).toBe('进1(逼近)');
    expect(rows.map(signalChartSymbol)).toEqual(['BTCUSDT', null, null]);
  });

  it('支持 Excel 日期序号，重复导入保留原评分与不同日期的记录', async () => {
    const file = workbook([
      [45758, 'BTC', '进1', ''],
      ['2025-04-11', 'BTC', '进1', ''],
      ['2025-04-12', 'BTC', '进1', ''],
    ]);
    const incoming = await readEntryPeriodWorkbook(file);
    const first = mergeEntryPeriodSignals([], incoming);
    expect(first.map(row => row.timeLabel)).toEqual(['2025-04-11 16:00', '2025-04-12 16:00']);
    const rated = setSignalQuality(first, first[0].id, 4);
    expect(mergeEntryPeriodSignals(rated, incoming)).toBe(rated);
    expect(rated[0].quality).toBe(4);
  });

  it('报告缺少「数据」页和无效首日日期', async () => {
    await expect(readEntryPeriodWorkbook(workbook([], '说明'))).rejects.toThrow('未找到「数据」工作表');
    await expect(readEntryPeriodWorkbook(workbook([['2025-02-30', 'BTC', '进1', '']]))).rejects.toThrow('日期无效');
  });
});
