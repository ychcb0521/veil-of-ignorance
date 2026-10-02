/**
 * 最小的 .xlsx 生成器：不压缩的 ZIP（store）+ 几份 SpreadsheetML。
 * 只做统计分析需要的那点事——数字写成数字单元格（Excel / SPSS / pandas 直接当数值读），文字写成内联字符串，
 * 首行表头加粗并冻结，可设列宽。不引第三方库。
 */

export type XlsxCell = string | number | null | undefined;

export type XlsxSheet = {
  name: string;
  columns: readonly { header: string; width?: number }[];
  rows: readonly (readonly XlsxCell[])[];
};

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 不压缩的 ZIP：.xlsx 要求包内路径一字不差（含 [Content_Types].xml、xl/…），这里不做任何文件名清洗。 */
export function buildStoredZip(files: readonly { path: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const crc = crc32(file.data);
    const size = file.data.length;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 文件名
    lv.setUint16(8, 0, true); // store
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, file.data);
    centrals.push(central);
    offset += local.length + size;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const total = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    total.set(part, cursor);
    cursor += part.length;
  }
  return total;
}

const escapeXml = (value: string) => value
  // XML 1.0 不允许的控制字符直接去掉
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 列号 → 字母：0 → A，25 → Z，26 → AA。 */
export function xlsxColumnName(index: number): string {
  let name = '';
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(sheet: XlsxSheet): string {
  const cols = sheet.columns.map((column, index) => (
    `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? Math.max(8, Math.min(40, column.header.length * 2 + 2))}" customWidth="1"/>`
  )).join('');
  const cell = (value: XlsxCell, ref: string, header = false) => {
    if (value == null || value === '') return '';
    if (typeof value === 'number') {
      return Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : '';
    }
    return `<c r="${ref}" t="inlineStr"${header ? ' s="1"' : ''}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  };
  const headerRow = `<row r="1">${sheet.columns.map((column, index) => cell(column.header, `${xlsxColumnName(index)}1`, true)).join('')}</row>`;
  const bodyRows = sheet.rows.map((row, rowIndex) => {
    const r = rowIndex + 2;
    return `<row r="${r}">${row.map((value, index) => cell(value, `${xlsxColumnName(index)}${r}`)).join('')}</row>`;
  }).join('');
  const lastRef = `${xlsxColumnName(Math.max(0, sheet.columns.length - 1))}${sheet.rows.length + 1}`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + `<cols>${cols}</cols>`
    + `<sheetData>${headerRow}${bodyRows}</sheetData>`
    + `<autoFilter ref="A1:${lastRef}"/>`
    + '</worksheet>';
}

/** 工作表名：Excel 限 31 字符、不能含 : \ / ? * [ ]。 */
function sheetName(name: string): string {
  return (name.replace(/[:\\/?*[\]]/g, '_').slice(0, 31)) || 'Sheet';
}

/** .xlsx 文件的字节（测试与 Node 环境用；页面用 buildXlsx 拿 Blob）。 */
export function buildXlsxBytes(sheets: readonly XlsxSheet[]): Uint8Array {
  const encoder = new TextEncoder();
  const names = sheets.map(sheet => sheetName(sheet.name));
  const files: { path: string; data: Uint8Array }[] = [
    {
      path: '[Content_Types].xml',
      data: encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '</Types>'),
    },
    {
      path: '_rels/.rels',
      data: encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>'),
    },
    {
      path: 'xl/workbook.xml',
      data: encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + `<sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>`
        + (sheets.length ? `<definedNames>${names.map((name, index) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">'${escapeXml(name).replace(/'/g, "''")}'!$A$1:$${xlsxColumnName(Math.max(0, sheets[index].columns.length - 1))}$${sheets[index].rows.length + 1}</definedName>`).join('')}</definedNames>` : '')
        + '</workbook>'),
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      data: encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + '</Relationships>'),
    },
    {
      path: 'xl/styles.xml',
      data: encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '</styleSheet>'),
    },
    ...sheets.map((sheet, index) => ({ path: `xl/worksheets/sheet${index + 1}.xml`, data: encoder.encode(sheetXml(sheet)) })),
  ];
  return buildStoredZip(files);
}

export function buildXlsx(sheets: readonly XlsxSheet[]): Blob {
  const bytes = buildXlsxBytes(sheets);
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
