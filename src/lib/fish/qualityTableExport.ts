/**
 * 【用户要求】2026-11-03 组合表下载：唯一子表＝当时组合表呈现的内容与形式——隐藏的模块不出现、表头文字一样、
 * 只含正在被选中的标的；「呈现了什么就下载什么」。
 *
 * 做法：已选行复用页面的单元格渲染，分批读取表头与单元格（不另写一套列定义，避免与界面不一致）。
 * - 分组表头（入场信息 / 买前过滤 / 持仓监测、变量 / 水平）按原来的跨列合并；
 * - 列名行：「标的」拆成行号 + 标的；「运行状态」拆成过滤 / 监测；「加仓次数 · 几何仓位 · 相对涨幅 · 盈亏比」拆成四列；
 * - 评分写成星号；排序箭头、「展开 / 收起」按钮、图标不算内容；跳转列不导出。
 */
import {buildXlsx,type XlsxCell,type XlsxSheet} from '@/lib/xlsxWorkbook';
import {formatUTC8} from '@/lib/timeFormat';

const SELL_PART_IDS = ['quality-sell-additions', 'quality-sell-geometric', 'quality-sell-relative-gain', 'quality-sell-payoff'];

/** 元素上看得见的文字：去掉图标、读屏隐藏、展开 / 收起开关和排序箭头，各段文字之间留一个空格。 */
export function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('svg,[aria-hidden="true"],[aria-expanded],input,select').forEach(node => node.remove());
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 3) { const t = node.textContent ?? ''; if (t.trim()) parts.push(t.trim()); return; }
    node.childNodes.forEach(walk);
  };
  walk(clone);
  return parts.join(' ').replace(/\s*[↑↓]\s*$/u, '').replace(/\s+[↑↓]\s+/gu, ' ').replace(/\s+/g, ' ').trim();
}
/** 只由数字组成的格子写成数字（Excel 里能直接计算）；带 %、R、× 等单位的照原样写成文字。 */
const asCell = (text: string): XlsxCell => /^[+-]?\d+(\.\d+)?$/.test(text) ? Number(text) : text;

/** 列名行每个表头格导出成几列、各叫什么。 */
function headerLabels(th: HTMLTableCellElement): string[] {
  if (th.getAttribute('aria-hidden') === 'true' || th.getAttribute('aria-label') === '跳转') return [];
  const parts = th.querySelector('[data-testid="quality-sell-parts"]');
  if (parts) return [...parts.children].map(visibleText);
  if (th.querySelector('[data-testid="quality-run-state-parts"]')) return ['运行状态 · 过滤', '运行状态 · 监测'];
  if (th.getAttribute('aria-sort') != null && th.querySelector('input[type="checkbox"]')) return ['行号', visibleText(th)];
  return [visibleText(th)];
}
function cellValues(td: HTMLTableCellElement, labels: readonly string[]): XlsxCell[] {
  if (labels.length === 4) {
    const parts = SELL_PART_IDS.map(id => td.querySelector(`[data-testid="${id}"]`));
    if (parts.every(Boolean)) return parts.map(p => asCell(visibleText(p!)));
    if (labels[0] === '加仓次数') return [visibleText(td), '', '', ''];
  }
  if (labels[0] === '运行状态 · 过滤') return [...td.querySelectorAll('[data-run-stage]')].map(s => asCell(visibleText(s)));
  if (labels[0] === '行号') {
    const number = td.querySelector('[data-testid="quality-row-number"]'), clone = td.cloneNode(true) as Element;
    clone.querySelector('[data-testid="quality-row-number"]')?.remove();
    return [asCell(number ? visibleText(number) : ''), visibleText(clone)];
  }
  const stars = td.querySelector('[aria-label^="评分"]');
  if (stars) { const n = Number(/(\d+)/.exec(stars.getAttribute('aria-label') ?? '')?.[1] ?? 0); return ['★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n))]; }
  const text = visibleText(td);
  return [asCell(text)];
}

/**
 * 读取组合表。默认只读已勾选行；没有勾选时结果为空，绝不自动扩大到全部行。
 */
export function readQualityTableSheet(table: HTMLTableElement, { name = '组合表', selectedOnly = true }: { name?: string; selectedOnly?: boolean } = {}): XlsxSheet {
  const headRows = [...(table.tHead?.rows ?? [])];
  if (!headRows.length) throw new Error('组合表没有表头，无法导出');
  const columnRow = headRows[headRows.length - 1];
  const labelsByUnit = [...columnRow.cells].map(th => headerLabels(th as HTMLTableCellElement));
  const widthOf = (from: number, span: number) => labelsByUnit.slice(from, from + span).reduce((n, l) => n + l.length, 0);
  // 分组表头：原来的跨列按列名行拆分后的实际列数换算
  const headerRows = headRows.slice(0, -1).map(tr => {
    let unit = 0;
    return [...tr.cells].flatMap(th => {
      const span = (th as HTMLTableCellElement).colSpan || 1, width = widthOf(unit, span);unit += span;
      return width ? [{ text: th.getAttribute('aria-hidden') === 'true' ? '' : visibleText(th), span: width }] : [];
    });
  });
  const columns = labelsByUnit.flat().map(header => ({ header, width: Math.max(8, Math.min(28, header.length * 2 + 4)) }));
  const rows: XlsxCell[][] = [];
  for (const tr of table.tBodies[0]?.rows ?? []) {
    if (tr.getAttribute('aria-hidden') === 'true' || tr.cells.length !== labelsByUnit.length) continue;
    const box = tr.cells[0]?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    if (selectedOnly && !box?.checked) continue;
    rows.push([...tr.cells].flatMap((td, i) => labelsByUnit[i].length ? cellValues(td as HTMLTableCellElement, labelsByUnit[i]) : []));
  }
  return { name, columns, rows, headerRows };
}

/** Only the selected on-screen table representation. No archive hydration or
 * supplementary algorithm/trade/history worksheets are needed for this download. */
export function downloadQualityTableSheet(sheet:XlsxSheet,at=Date.now()){
  if(!sheet.rows.length)throw Error('请先勾选组合表中要导出的行');
  const blob=buildXlsx([{...sheet,name:'组合表'}]);
  const filename=`鱼质量-组合表-${formatUTC8(at).replace(/\D/g,'').slice(0,14)}.xlsx`;
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  try{link.href=url;link.download=filename;document.body.appendChild(link);link.click();}
  finally{link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),60000);}
  return filename;
}
