import { createEntryPeriodSignal, entryPeriodTime, parseEntryPeriodMark, type EntryPeriodSignal } from './entryPeriodSignals';
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

type PhaseRow = { symbol: string; timeMs: number } & (
  { phase: 'entry'; signal: EntryPeriodSignal } | { phase: 'entry-continued'; day: number } | { phase: 'retreat-start' | 'retreat-later' }
);

async function readPhaseRows(file: File): Promise<PhaseRow[]> {
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
  const phases: PhaseRow[] = [];
  let columns: { symbol: string; date: string; stage: string; market?: string; end?: string } | undefined;
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
      if (symbol && date && stage) columns = { symbol, date, stage, market: headings.get('市场'), end: headings.get('进场期结束时间') };
      continue;
    }
    const stage = values.get(columns.stage)?.text.trim().normalize('NFKC') ?? '';
    const mark = parseEntryPeriodMark(stage);
    const stageDay = /^([进退])(\d+)(?:\(逼近\))?$/.exec(stage);
    if (!stageDay) continue;
    const rawSymbol = values.get(columns.symbol)?.text.trim() ?? '';
    const date = values.get(columns.date);
    const day = date ? readDate(date.text, date.numeric, date1904) : '';
    const timeMs = entryPeriodTime(day);
    const sourceRow = row.getAttribute('r') ?? '?';
    const invalidRow = () => new Error('第 ' + sourceRow + ' 行进退场记录缺少标的或日期无效');
    if (!rawSymbol || timeMs === undefined) throw invalidRow();
    const symbol = rawSymbol.normalize('NFKC').toUpperCase();
    if (!mark) {
      phases.push(stageDay[1] === '进'
        ? { symbol, timeMs, phase: 'entry-continued', day: Number(stageDay[2]) }
        : { symbol, timeMs, phase: stageDay[2] === '1' ? 'retreat-start' : 'retreat-later' });
      continue;
    }
    const signal = createEntryPeriodSignal(rawSymbol, day, mark, columns.market ? values.get(columns.market)?.text : undefined);
    if (!signal) throw invalidRow();
    const end = columns.end ? values.get(columns.end) : undefined;
    if (end?.text.trim()) {
      const endTimeMs = entryPeriodTime(readDate(end.text, end.numeric, date1904));
      if (endTimeMs === undefined || endTimeMs <= timeMs) {
        throw new Error('第 ' + (row.getAttribute('r') ?? '?') + ' 行进场期结束时间无效');
      }
      signal.entryPeriod.endTimeMs = endTimeMs;
    }
    phases.push({ symbol, timeMs, phase: 'entry', signal });
  }
  if (!columns) throw new Error('「数据」工作表需要「币种」「日期」「进退场周期」三列');
  return phases;
}

export async function readEntryPeriodWorkbooks(files: readonly File[]): Promise<EntryPeriodSignal[]> {
  const phases = new Map<string, PhaseRow>();
  for (const file of files) {
    let rows: PhaseRow[];
    try {
      rows = await readPhaseRows(file);
    } catch (error) {
      throw new Error(file.name ? file.name + ' · ' + (error as Error).message : (error as Error).message);
    }
    for (const row of rows) {
      const key = row.symbol + ':' + row.timeMs;
      const previous = phases.get(key);
      if (!previous) phases.set(key, row);
      else if (previous.phase !== row.phase ||
        (previous.phase === 'entry-continued' && row.phase === 'entry-continued' && previous.day !== row.day)) {
        throw new Error(row.symbol + ' 同一天的进退场周期冲突');
      }
      else if (previous.phase === 'entry' && row.phase === 'entry' && previous.signal.entryPeriod.endTimeMs === undefined) {
        previous.signal.entryPeriod.endTimeMs = row.signal.entryPeriod.endTimeMs;
      }
    }
  }

  const pending = new Map<string, { signal: EntryPeriodSignal; day: number }>();
  const signals: EntryPeriodSignal[] = [];
  for (const row of [...phases.values()].sort((a, b) => a.timeMs - b.timeMs)) {
    if (row.phase === 'entry') {
      pending.set(row.symbol, { signal: row.signal, day: 1 });
      signals.push(row.signal);
      continue;
    }
    const current = pending.get(row.symbol);
    if (!current) continue;
    if (row.phase === 'entry-continued') {
      // A lower day number is evidence of a new entry period whose first day is absent.
      if (row.day < current.day) pending.delete(row.symbol);
      else current.day = row.day;
      continue;
    }
    if (row.phase === 'retreat-start') current.signal.entryPeriod.endTimeMs = row.timeMs;
    // Even a later retreat day ends the matching window. Its first day was not observed.
    pending.delete(row.symbol);
  }
  return signals;
}

export function readEntryPeriodWorkbook(file: File): Promise<EntryPeriodSignal[]> {
  return readEntryPeriodWorkbooks([file]);
}
