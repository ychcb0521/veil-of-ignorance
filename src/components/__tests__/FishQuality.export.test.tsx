// 【用户要求】2026-11-03 组合表下载：第一个子表＝当时组合表呈现的内容与形式（隐藏的不出现、表头一样、只含选中的标的），
// 其后是「组合算法」和「买入·加仓·卖出」，再往后照旧
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { XlsxSheet } from '@/lib/xlsxWorkbook';
const captured: { leading: XlsxSheet[] }[] = [];
vi.mock('@/lib/fish/qualityExport', async original => ({ ...(await original() as object), downloadQualityComparison: (_s: unknown, _r: unknown, _at: unknown, leading: XlsxSheet[]) => { captured.push({ leading }); return 'x.xlsx'; } }));
import { FishQuality } from '@/components/FishQuality';
import { importQualityLibrary, newQualityStudy, qualityDisplayRows } from '@/lib/fish/quality';
import { enableQualityComparison } from '@/lib/fish/qualityComparison';
import type { FishQualityState } from '@/hooks/useFishQuality';
const T = Date.UTC(2026, 9, 20);
function state(selected: number, mined = false): FishQualityState {
  const study = enableQualityComparison(importQualityLibrary(newQualityStudy(T + 1), ['AAAUSDT', 'BBBUSDT', 'CCCUSDT'].map((symbol, i) => ({ id: `l${i}`, symbol, timeMs: T - i * 3600000, timeLabel: '', fallbackZone: '', quality: 3 }))));
  if (mined) study.samples[0].source = { ...study.samples[0].source, mined: { anchorMs: T - 86400000 }, caughtAt: Date.UTC(2026, 10, 3, 2, 15) };
  study.selectedRowIds = qualityDisplayRows(study).slice(0, selected).map(r => r.id);
  return { study, ready: true, running: false, progress: null, filterRunning: false, filterProgress: null, filterError: '', startFilter: vi.fn(), cancelFilter: vi.fn(), warning: '', error: '', start: vi.fn(), restart: vi.fn(), cancel: vi.fn(), setRule: vi.fn(), setCombo: vi.fn(), setObserveHours: vi.fn(), selectSell: vi.fn(), setSelectedRows: vi.fn(), setPriority: vi.fn(), setScope: vi.fn(), setFilters: vi.fn(), setHoldingVetoes: vi.fn(), setSellPlans: vi.fn() } as FishQualityState;
}
afterEach(() => { cleanup(); captured.length = 0; });
it('puts the table exactly as shown, with only the selected rows, first; then the plan details and per-trade buys, adds and sells', { timeout: 30000 }, () => {
  const s = state(2);
  render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button', { name: '导出鱼质量数据' }));
  expect(captured).toHaveLength(1);
  const [table, plans, trades] = captured[0].leading;
  expect(table.name).toBe('组合表');
  // 表头与界面一致：分组表头按导出后的列数合并；列名行「标的」前加行号；运行状态已移除
  expect(table.headerRows?.[0][0]).toEqual({ text: '入场信息', span: 5 });
  expect(table.columns.slice(0, 5).map(c => c.header)).toEqual(['行号', '标的', '信号时间', '市场', '评分']);
  const sellHeaders = table.columns.map(c => c.header);
  for (const h of ['加仓次数', '几何仓位', '相对涨幅', '盈亏比', '静态最大回撤', '峰值涨幅', '首仓涨幅', '半仓镜像', '持仓时间']) expect(sellHeaders).toContain(h);
  expect(sellHeaders).not.toContain('跳转');
  // 只导出选中的两行，行号、标的、评分照界面
  expect(table.rows).toHaveLength(2);
  expect(table.rows.map(r => r[1])).toEqual(['AAAUSDT', 'BBBUSDT']);
  expect(table.rows[0][0]).toBe(1);expect(table.rows[0][4]).toBe('★★★☆☆');
  expect(plans.name).toBe('组合算法');expect(plans.rows.some(r => r[2] === '卖出算法')).toBe(true);
  expect(trades.name).toBe('买入·加仓·卖出');expect(new Set(trades.rows.map(r => r[0]))).toEqual(new Set(['AAAUSDT', 'BBBUSDT']));
});
it('hides what the table hides: the 买前过滤 group is left out once hidden', { timeout: 30000 }, () => {
  const s = state(3);
  render(<FishQuality state={s}/>);
  fireEvent.click(screen.getByRole('button', { name: '导出鱼质量数据' }));
  const shown = captured[0].leading[0];
  const filterShown = shown.headerRows?.[0].some(c => c.text.startsWith('买前过滤'));
  fireEvent.click(screen.getByRole('button', { name: '隐藏组合表中的过滤结果' }));fireEvent.click(screen.getByRole('button', { name: '导出鱼质量数据' }));
  const hidden = captured[1].leading[0];
  expect(filterShown).toBe(true);
  expect(hidden.headerRows?.[0].some(c => c.text.startsWith('买前过滤'))).toBe(false);
  expect(hidden.columns.map(c => c.header)).not.toContain('探测算法');
  expect(hidden.rows).toHaveLength(3);
});
// 【用户要求】2026-11-03 批量挖掘的数据显示挖掘时间（真实物理时间）；表里没有挖掘记录时不多出这一列
it('shows the real mining time for mined rows only when the table has mined records', { timeout: 30000 }, () => {
  render(<FishQuality state={state(3, true)}/>);
  expect(screen.getByTestId('quality-mined-at-column')).toHaveTextContent('挖掘时间');
  const cells = screen.getAllByTestId('quality-mined-at-cell').map(c => c.textContent);
  expect(cells.filter(t => t !== '—')).toHaveLength(1);expect(cells.find(t => t !== '—')).toContain('2026-11-03 10:15');
  fireEvent.click(screen.getByRole('button', { name: '导出鱼质量数据' }));
  expect(captured[0].leading[0].columns.map(c => c.header)).toContain('挖掘时间');
  cleanup();
  render(<FishQuality state={state(3)}/>);
  expect(screen.queryByTestId('quality-mined-at-column')).toBeNull();
});
