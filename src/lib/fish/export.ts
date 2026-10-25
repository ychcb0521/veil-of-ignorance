/** Export the cabin as the same simple table the user sees, using saved capture settings. */
import type { TradeSignal } from '@/lib/signalLibrary';
import type { FishSnapshot } from './algorithm';
import { fishCaughtBy, fishMetricLabel, fishSourceLabel } from './records';
import { EXCHANGE_NAMES } from './exchanges';
import { formatUTC8 } from '@/lib/timeFormat';
import { buildXlsx, type XlsxSheet } from '@/lib/xlsxWorkbook';

/** Match the list: a union names only its hit members; an intersection names all members. */
function caughtMembers(s: TradeSignal): Partial<FishSnapshot>[] {
  const root = s.fish;
  if (!root) return [];
  if (!root.algorithms?.length) return [root];
  return root.combination === 'or'
    ? (root.hitAlgorithms ?? []).map(i => root.algorithms![i - 1]).filter(Boolean)
    : root.algorithms;
}

function captureThreshold(m: Partial<FishSnapshot>): string {
  // Historical placeholders sometimes retain the original setting only in their saved key.
  const parts = m.algorithmKey?.split('|');
  const key = parts?.length === 6 ? parts : undefined;
  const direction = m.direction ?? key?.[3];
  const threshold = m.threshold ?? (key?.[4]?.trim() ? Number(key[4]) : undefined);
  return direction && typeof threshold === 'number' && Number.isFinite(threshold)
    ? `${direction} ${threshold}` : '未记录';
}

export function buildFishCabinSheets(input: readonly TradeSignal[]): XlsxSheet[] {
  const rows = input.filter(s => !s.freshCatch).slice().sort((a, b) => b.timeMs - a.timeMs).map(s => {
    const members = caughtMembers(s);
    const details = (label: (m: Partial<FishSnapshot>) => string) => [...new Set(members.map(m =>
      members.length > 1 ? `${fishSourceLabel(m)}：${label(m)}` : label(m)))].join('；') || '未记录';
    const venue = s.exchange && s.exchange !== 'binance' ? `（${EXCHANGE_NAMES[s.exchange]}）` : '';
    return [s.symbol + venue, formatUTC8(s.timeMs), fishCaughtBy(s).join(' · ') || '—',
      s.market === 'us_stock' ? '美股' : '',
      typeof s.quality === 'number' && Number.isFinite(s.quality) ? s.quality : null,
      details(fishMetricLabel), details(captureThreshold)];
  });
  // Interactive controls (process dialog, jump, delete) have no spreadsheet column.
  return [{ name: '鱼舱', columns: [
    {header:'标的',width:25}, {header:'信号时间',width:24}, {header:'算法类型',width:32},
    {header:'市场',width:10}, {header:'评分',width:8},
    {header:'具体指标',width:58}, {header:'捕获阈值',width:45},
  ], rows }];
}

export function downloadFishCabin(input: readonly TradeSignal[], exportedAt = Date.now()): string {
  if (!input.some(s => !s.freshCatch)) throw new Error('鱼舱暂无可导出的数据');
  const blob = buildXlsx(buildFishCabinSheets(input));
  const filename = '鱼舱-' + formatUTC8(exportedAt).replace(/\D/g, '').slice(0, 14) + '.xlsx';
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  try { link.href = url; link.download = filename; document.body.appendChild(link); link.click(); }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return filename;
}
