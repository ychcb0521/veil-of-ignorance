import { createEntryPeriodSignal, parseEntryPeriodMark, type EntryPeriodSignal } from './entryPeriodSignals';
import { openWorkbookZip } from './workbookZip';

const texts = (element: Element, name: string) => Array.from(element.getElementsByTagNameNS('*', name));
const child = (element: Element, name: string) => Array.from(element.children).find(node => node.localName === name);
const joinedText = (element: Element) => texts(element, 't')
  .filter(node => node.parentElement?.localName !== 'rPh')
  .map(node => node.textContent ?? '').join('');

function readDate(value: string, numeric: boolean, date1904: boolean): string {
  if (numeric && /^\d+(?:\.\d+)?$/.test(value)) {
    const day = Math.floor(Number(value));
    if (day > 0 && day < 2_958_465) {
      const origin = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, day < 60 ? 31 : 30);
      if (date1904 || day !== 60) return new Date(origin + day * 86_400_000).toISOString().slice(0, 10);
    }
  }
  const match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:$|[ T])/.exec(value.trim());
  return match ? [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')].join('-') : '';
}

export async function readEntryPeriodWorkbook(file: File) {
  const readXml = openWorkbookZip(await file.arrayBuffer());
  const book = await readXml('xl/workbook.xml');
  const rels = await readXml('xl/_rels/workbook.xml.rels');
  if (!book?.documentElement || !rels?.documentElement) throw new Error('无法读取 Excel 工作簿');
  const data = texts(book.documentElement, 'sheet').find(sheet => sheet.getAttribute('name') === '数据');
  if (!data) throw new Error('未找到「数据」工作表');
  const relationId = Array.from(data.attributes).find(attribute => attribute.localName === 'id')?.value;
  const relationships = texts(rels.documentElement, 'Relationship').filter(node => node.getAttribute('TargetMode') !== 'External');
  const resolveTarget = (target: string) => new URL(target, 'https://workbook.invalid/xl/').pathname.slice(1);
  const target = relationships.find(relation => relation.getAttribute('Id') === relationId)?.getAttribute('Target');
  const sharedTarget = relationships.find(relation => relation.getAttribute('Type')?.endsWith('/sharedStrings'))?.getAttribute('Target');
  const [sheet, shared] = await Promise.all([
    target ? readXml(resolveTarget(target)) : undefined,
    sharedTarget ? readXml(resolveTarget(sharedTarget)) : undefined,
  ]);
  if (!sheet?.documentElement) throw new Error('无法读取「数据」工作表');
  const strings = shared?.documentElement ? texts(shared.documentElement, 'si').map(joinedText) : [];
  const date1904 = ['1', 'true'].includes(texts(book.documentElement, 'workbookPr')[0]?.getAttribute('date1904') ?? '');
  const signals: EntryPeriodSignal[] = [];
  let columns: { symbol: string; date: string; stage: string; market?: string } | undefined;
  for (const row of texts(sheet.documentElement, 'row')) {
    const cells = Array.from(row.children).filter(node => node.localName === 'c');
    const values = new Map(cells.map(cell => {
      const kind = cell.getAttribute('t');
      const value = child(cell, 'v')?.textContent ?? '';
      const text = kind === 's' ? strings[Number(value)] ?? '' : kind === 'inlineStr' ? joinedText(cell) : value;
      return [(cell.getAttribute('r') ?? '').replace(/\d+$/, ''), { text, numeric: kind == null || kind === 'n' }] as const;
    }));
    if (!columns) {
      const headings = new Map(Array.from(values, ([column, value]) => [value.text.trim(), column]));
      const symbol = headings.get('币种'), date = headings.get('日期'), stage = headings.get('进退场周期');
      if (symbol && date && stage) columns = { symbol, date, stage, market: headings.get('市场') };
      continue;
    }
    const mark = parseEntryPeriodMark(values.get(columns.stage)?.text ?? '');
    if (!mark) continue;
    const date = values.get(columns.date);
    const signal = createEntryPeriodSignal(
      values.get(columns.symbol)?.text ?? '', date ? readDate(date.text, date.numeric, date1904) : '',
      mark, columns.market ? values.get(columns.market)?.text : undefined,
    );
    if (!signal) throw new Error('第 ' + (row.getAttribute('r') ?? '?') + ' 行首日记录缺少标的或日期无效');
    signals.push(signal);
  }
  if (!columns) throw new Error('「数据」工作表需要「币种」「日期」「进退场周期」三列');
  return signals;
}
