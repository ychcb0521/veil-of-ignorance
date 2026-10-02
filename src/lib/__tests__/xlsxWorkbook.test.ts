import { describe, expect, it } from 'vitest';
import { buildStoredZip, buildXlsxBytes, xlsxColumnName } from '@/lib/xlsxWorkbook';

/** 读回不压缩 ZIP 的条目（本地文件头 → 名字 → 数据）。 */
function readStoredZip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const out = new Map<string, string>();
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    out.set(name, decoder.decode(bytes.subarray(start, start + size)));
    offset = start + size;
  }
  return out;
}

describe('最小 .xlsx 生成器', () => {
  it('列号 → 字母', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(xlsxColumnName)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('包内路径一字不差（含 [Content_Types].xml 与 xl/ 目录），工作表 XML 里数字是数字、文字转义、空值留空', () => {
    const files = readStoredZip(buildXlsxBytes([{
      name: '战役汇总',
      columns: [{ header: '标题' }, { header: '盈亏比 b（R）' }],
      rows: [['A <&> "B"', 1.5], ['空', null], ['非数', Number.NaN]],
    }]));
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml',
    ]);
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="B2"><v>1.5</v></c>');
    expect(sheet).toContain('A &lt;&amp;&gt; &quot;B&quot;');
    // 空值与 NaN 都不写单元格（读出来是空，不是 0）
    expect(sheet).not.toContain('r="B3"');
    expect(sheet).not.toContain('r="B4"');
    // 表头冻结 + 自动筛选
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:B4"/>');
    expect(files.get('xl/workbook.xml')).toContain('name="战役汇总"');
  });

  it('ZIP 的中央目录与结尾记录写对了条目数', () => {
    const zip = buildStoredZip([{ path: 'a.txt', data: new TextEncoder().encode('hi') }, { path: 'b/c.txt', data: new Uint8Array() }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
  });
});
