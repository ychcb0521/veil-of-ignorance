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

type PhaseRow = {
  symbol: string;
  rawSymbol: string;
  timeMs: number;
  side: 'entry' | 'retreat';
  day: number;
  mark?: EntryPeriodSignal['entryPeriod']['mark'];
  market?: string;
  startInferred?: true;
  endTimeMs?: number;
  endInferred?: true;
};

const DAY_MS = 86_400_000;

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
  let columns: { symbol: string; date: string; stage: string; market?: string; end?: string; startSource?: string; endSource?: string } | undefined;
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
      if (symbol && date && stage) columns = {
        symbol, date, stage, market: headings.get('市场'), end: headings.get('进场期结束时间'),
        startSource: headings.get('进场时间来源'), endSource: headings.get('结束时间来源'),
      };
      continue;
    }
    const stage = values.get(columns.stage)?.text.trim().normalize('NFKC') ?? '';
    const stageDay = /^([进退])([1-9]\d*)(?:\(逼近\))?$/.exec(stage);
    if (!stageDay) continue;
    const rawSymbol = values.get(columns.symbol)?.text.trim() ?? '';
    const date = values.get(columns.date);
    const timeMs = date ? entryPeriodTime(readDate(date.text, date.numeric, date1904)) : undefined;
    const rowNumber = row.getAttribute('r') ?? '?';
    const day = Number(stageDay[2]);
    if (!rawSymbol || timeMs === undefined || !Number.isSafeInteger(day)) {
      throw new Error('第 ' + rowNumber + ' 行进退场记录缺少标的或日期、序号无效');
    }
    const side = stageDay[1] === '进' ? 'entry' : 'retreat';
    const phase: PhaseRow = { symbol: rawSymbol.normalize('NFKC').toUpperCase(), rawSymbol, timeMs, side, day };
    if (side === 'entry') {
      phase.mark = parseEntryPeriodMark(stage);
      phase.market = columns.market ? values.get(columns.market)?.text : undefined;
    }
    if (phase.mark) {
      if (columns.startSource && values.get(columns.startSource)?.text.trim() === '倒推') phase.startInferred = true;
      const end = columns.end ? values.get(columns.end) : undefined;
      if (end?.text.trim()) {
        phase.endTimeMs = entryPeriodTime(readDate(end.text, end.numeric, date1904));
        if (phase.endTimeMs === undefined || phase.endTimeMs <= timeMs) {
          throw new Error('第 ' + rowNumber + ' 行进场期结束时间无效');
        }
        if (columns.endSource && values.get(columns.endSource)?.text.trim() === '倒推') phase.endInferred = true;
      }
    }
    phases.push(phase);
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
      else if (previous.side !== row.side || previous.day !== row.day) {
        throw new Error(row.symbol + ' 同一天的进退场周期冲突');
      } else {
        if (previous.startInferred && !row.startInferred) {
          previous.mark = row.mark;
          delete previous.startInferred;
        }
        if (row.endTimeMs !== undefined &&
          (previous.endTimeMs === undefined || (previous.endInferred && !row.endInferred))) {
          previous.endTimeMs = row.endTimeMs;
          previous.endInferred = row.endInferred;
        }
      }
    }
  }

  const previousRows = new Map<string, PhaseRow>();
  const pending = new Map<string, EntryPeriodSignal>();
  const signals: EntryPeriodSignal[] = [];
  for (const row of [...phases.values()].sort((a, b) => a.timeMs - b.timeMs)) {
    const previous = previousRows.get(row.symbol);
    previousRows.set(row.symbol, row);
    const newPhase = !previous || previous.side !== row.side || row.day < previous.day || row.day === 1;
    if (!newPhase) continue;

    const firstDay = row.timeMs - (row.day - 1) * DAY_MS;
    // A projected first day must not contradict the last observed phase.
    const valid = Number.isFinite(new Date(firstDay).getTime()) && (!previous || firstDay > previous.timeMs);
    if (row.side === 'entry') {
      pending.delete(row.symbol);
      if (!valid) continue;
      const date = new Date(firstDay).toISOString().slice(0, 10);
      const signal = createEntryPeriodSignal(row.rawSymbol, date, row.mark ?? '进1', row.market);
      if (!signal) continue;
      if (row.day > 1 || row.startInferred) signal.entryPeriod.startInferred = true;
      if (row.endTimeMs !== undefined) signal.entryPeriod.endTimeMs = row.endTimeMs;
      if (row.endInferred) signal.entryPeriod.endInferred = true;
      signals.push(signal);
      pending.set(row.symbol, signal);
      continue;
    }

    const current = pending.get(row.symbol);
    pending.delete(row.symbol);
    if (!current || !valid || firstDay <= current.timeMs) continue;
    if (row.day === 1 || current.entryPeriod.endTimeMs === undefined || current.entryPeriod.endInferred) {
      current.entryPeriod.endTimeMs = firstDay;
      if (row.day > 1) current.entryPeriod.endInferred = true;
      else delete current.entryPeriod.endInferred;
    }
  }
  return signals;
}

export function readEntryPeriodWorkbook(file: File): Promise<EntryPeriodSignal[]> {
  return readEntryPeriodWorkbooks([file]);
}
