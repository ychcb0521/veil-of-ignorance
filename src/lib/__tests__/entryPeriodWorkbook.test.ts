import { describe, expect, it } from 'vitest';
import { buildXlsxBytes } from '@/lib/xlsxWorkbook';
import { readEntryPeriodWorkbook, readEntryPeriodWorkbooks } from '@/lib/entryPeriodWorkbook';
import { ENTRY_PERIOD_MARKETS, entryPeriodMarketGroup, entryPeriodMarketLabel, mergeEntryPeriodSignals } from '@/lib/entryPeriodSignals';
import { setSignalQuality, signalChartSymbol, sortSignalsBy } from '@/lib/signalLibrary';

const columns = ['日期', '币种', '进退场周期', '市场', '进场期结束时间', '进场时间来源', '结束时间来源'].map(header => ({ header }));
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

  it('按四类显示旧记录，并兼容新旧 Excel 的市场名称', async () => {
    expect(Object.values(ENTRY_PERIOD_MARKETS)).toEqual(['Crypto', '美股', 'A股', '其他']);
    const rows = await readEntryPeriodWorkbook(workbook([
      ['2025-04-10', 'BTC', '进1', '币圈'],
      ['2025-04-11', 'BTC', '进1', 'Crypto'],
      ['2025-04-11', '黄金 OTC', '进1', '商品'],
      ['2025-04-11', '期权波动率', '进1', '指标'],
      ['2025-04-11', 'ETF', '进1', '待确认'],
      ['2025-04-12', 'ETF', '进1', '其他'],
    ]));
    expect(rows.map(row => entryPeriodMarketGroup(row.entryPeriod.market))).toEqual([
      'crypto', 'crypto', 'other', 'other', 'other', 'other',
    ]);
    expect(rows.map(row => entryPeriodMarketLabel(row.entryPeriod.market))).toEqual([
      'Crypto', 'Crypto', '其他', '其他', '其他', '其他',
    ]);
    expect(rows.map(signalChartSymbol)).toEqual(['BTCUSDT', 'BTCUSDT', null, null, null, null]);
  });

  it('跨文件倒推缺失首日，并优先使用原表首日', async () => {
    const rows = await readEntryPeriodWorkbooks([
      workbook([
        ['2025-04-21', 'BTC', '进1', ''],
        ['2025-04-18', 'BTC', '进1', ''],
        ['2025-04-11', 'BTC', '进1', ''],
        ['2025-04-12', 'ETH', '进1', ''],
        ['2025-04-13', 'BTC', '进2', ''],
        ['2025-04-16', 'ETH', '进5', ''],
        ['2025-04-24', 'ETH', '进3', ''],
      ]),
      workbook([
        ['2025-04-27', 'BTC', '退1', ''],
        ['2025-04-15', 'BTC', '退1(逼近)', ''],
        ['2025-04-24', 'BTC', '退2', ''],
        ['2025-04-25', 'ETH', '退1', ''],
      ]),
    ]);
    expect(rows.map(row => [row.symbol, row.timeLabel, row.entryPeriod.endTimeMs])).toEqual([
      ['BTC', '2025-04-11 16:00', Date.parse('2025-04-15T08:00:00Z')],
      ['ETH', '2025-04-12 16:00', undefined],
      ['BTC', '2025-04-18 16:00', undefined],
      ['BTC', '2025-04-21 16:00', Date.parse('2025-04-23T08:00:00Z')],
      ['ETH', '2025-04-22 16:00', Date.parse('2025-04-25T08:00:00Z')],
    ]);
    expect(rows[3].entryPeriod.endInferred).toBe(true);
    expect(rows[4].entryPeriod.startInferred).toBe(true);
    expect(sortSignalsBy(rows, 'entryEnd')[0]).toBe(rows[0]);
  });

  it('回导结束时间可补齐已有信号，重复导入保留评分和原结束时间', async () => {
    const original = await readEntryPeriodWorkbook(workbook([['2025-04-11', 'BTC', '进1', '']]));
    const rated = setSignalQuality(original, original[0].id, 5);
    const incoming = await readEntryPeriodWorkbook(workbook([['2025-04-11', 'BTC', '进1', '', '2025-04-15 16:00']]));
    const merged = mergeEntryPeriodSignals(rated, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ quality: 5, entryPeriod: { endTimeMs: Date.parse('2025-04-15T08:00:00Z') } });
    expect(mergeEntryPeriodSignals(merged, incoming)).toBe(merged);
  });

  it('倒推与已记录阶段重叠时不补造首日', async () => {
    const rows = await readEntryPeriodWorkbook(workbook([
      ['2025-04-11', 'BTC', '进1', ''],
      ['2025-04-12', 'BTC', '进2', ''],
      ['2025-04-13', 'BTC', '退2', ''],
      ['2025-04-14', 'BTC', '进2', ''],
      ['2025-04-15', 'BTC', '进3', ''],
      ['2025-04-16', 'BTC', '退1', ''],
      ['2025-04-17', 'ETH', '进3', ''],
    ]));
    expect(rows.map(row => [row.symbol, row.timeLabel, row.entryPeriod.endTimeMs, row.entryPeriod.startInferred])).toEqual([
      ['BTC', '2025-04-11 16:00', undefined, undefined],
      ['ETH', '2025-04-15 16:00', undefined, true],
    ]);
  });

  it('保留回导的倒推标记，并以原表首日补正同一条记录', async () => {
    const inferred = await readEntryPeriodWorkbook(workbook([
      ['2025-04-11', 'BTC', '进1', 'Crypto', '2025-04-15 16:00', '倒推', '倒推'],
    ]));
    expect(inferred[0].entryPeriod).toMatchObject({ startInferred: true, endInferred: true });
    const rated = setSignalQuality(inferred, inferred[0].id, 4);
    const confirmed = await readEntryPeriodWorkbook(workbook([
      ['2025-04-11', 'BTC', '进1(逼近)', 'Crypto'],
      ['2025-04-16', 'BTC', '退1', 'Crypto'],
    ]));
    const merged = mergeEntryPeriodSignals(rated, confirmed);
    expect(merged[0]).toMatchObject({ quality: 4, entryPeriod: { mark: '进1(逼近)', endTimeMs: Date.parse('2025-04-16T08:00:00Z') } });
    expect(merged[0].entryPeriod?.startInferred).toBeUndefined();
    expect(merged[0].entryPeriod?.endInferred).toBeUndefined();
  });

  it('报告缺少「数据」页和无效首日日期', async () => {
    await expect(readEntryPeriodWorkbook(workbook([], '说明'))).rejects.toThrow('未找到「数据」工作表');
    await expect(readEntryPeriodWorkbook(workbook([['2025-02-30', 'BTC', '进1', '']]))).rejects.toThrow(/日期.*无效/);
  });
});
