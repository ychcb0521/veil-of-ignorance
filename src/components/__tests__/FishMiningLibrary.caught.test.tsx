// 【用户要求】2026-10-27「挖掘库中命中算法这里只显示探测算法（也就是被哪个算法捕捉到的）」
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FishMiningLibrary } from '@/components/FishMiningLibrary';
import { FishBulkDeleteContext } from '@/components/FishBulkDeletion';
import { emptyMiningLibrary, type FishMiningLibrary as Library } from '@/lib/fish/miningLibrary';
import { fishCatchKey, fishVisibleCatchKey } from '@/lib/fish/records';
import type { TradeSignal } from '@/lib/signalLibrary';

const store = vi.hoisted(() => ({ library: null as unknown }));
vi.mock('@/lib/fish/miningLibraryStore', () => ({ MINING_LIBRARY_EVENT: 'x', loadMiningLibrary: async () => store.library }));
const A = Date.UTC(2026, 4, 16, 4);
const snap = (featureShort: string, statistic: string, algorithmKey: string) => ({ average: 0.05, cbi2: 0, startAverage: 0, previousAverage: 0, cutoffMs: A, threshold: 0.04, featureShort, statistic, algorithmKey });
const signal = (symbol: string, hit: number[], key = 'k1'): TradeSignal => ({ id: symbol, symbol, timeMs: A - 3_600_000, timeLabel: '', fallbackZone: '', mined: { anchorMs: A },
  fish: { ...snap('CBI-2', 'avg_CBI2_2', key), combination: 'or', hitAlgorithms: hit, algorithms: [snap('CBI-2', 'avg_CBI2_2', 'a'), snap('S', 'avg_state_2', 'b'), snap('CBA', 'avg_CBA_2', 'c')] } });
const record = (s: TradeSignal, id: string, catchKey: string, at: number) => ({ id, runId: 'r', anchorMs: A, catchKey, signal: s, firstSavedAt: at, updatedAt: at });

it('shows only the detectors that actually caught each signal, merges identical rows, and keeps alias-repaired fish in the hold', async () => {
  const ake = signal('AKEUSDT', [1, 3]), akeOld = { ...signal('AKEUSDT', [1, 3], 'k-old') };
  const doge = signal('DOGEUSDT', [2]);
  const library: Library = { ...emptyMiningLibrary(), runs: [{ id: 'r', signature: 's', rules: [], startMs: A, stepMs: 43_200_000, firstAt: A, updatedAt: A }],
    anchors: [{ id: 'r|a', runId: 'r', anchorMs: A, scannedAt: A, updatedAt: A, found: 3, added: 3, recordIds: ['1', '2', '3'], attempts: 1 }],
    records: [record(ake, '1', 'ake-new', 2), record(akeOld, '2', 'ake-old', 1), record(doge, '3', 'doge', 1)] };
  store.library = library;
  // 鱼舱里 AKE 只有修过别名后的那条（键与旧记录不同），DOGE 已删除
  const hold = new Set([fishCatchKey(ake), fishVisibleCatchKey(ake)]);
  render(<FishMiningLibrary account="u" holdKeys={() => hold}/>);
  fireEvent.click(screen.getByRole('button', { name: '打开挖掘库' }));
  const rows = await screen.findAllByTestId('mining-library-row');
  expect(rows).toHaveLength(2);
  const [first, second] = rows.map(r => within(r).getAllByRole('cell').map(c => c.textContent));
  const bySymbol = Object.fromEntries([first, second].map(cells => [cells[0], cells]));
  expect(bySymbol.AKEUSDT[3]).toContain('CBI-2·avg₂ · avg_CBI2_2');expect(bySymbol.AKEUSDT[3]).toContain('CBA·avg₂ · avg_CBA_2');expect(bySymbol.AKEUSDT[3]).not.toContain('avg_state_2');
  expect(bySymbol.DOGEUSDT[3]).toContain('S·avg₂ · avg_state_2');
  expect(screen.queryByRole('columnheader',{name:'鱼舱'})).not.toBeInTheDocument();
  expect(screen.queryByText('已从鱼舱删除')).not.toBeInTheDocument();
  expect(first).toHaveLength(6);expect(second).toHaveLength(6);
  expect(screen.getByText(/2 条信号/)).toBeInTheDocument();
  // 按命中算法搜：只搜得到真正命中的
  fireEvent.change(screen.getByLabelText('搜索挖掘库'), { target: { value: 'S·avg' } });
  expect(screen.getAllByTestId('mining-library-row').map(r => within(r).getAllByRole('cell')[0].textContent)).toEqual(['DOGEUSDT']);
});


it('keeps different historical thresholds visible even when their old shorthand labels and signal times are identical',async()=>{
 const a=signal('AAAUSDT',[1]),b=structuredClone(a);a.fish!.algorithms![0]={...a.fish!.algorithms![0],direction:'>',threshold:.04};b.fish!.algorithms![0]={...b.fish!.algorithms![0],direction:'>',threshold:.05};
 store.library={...emptyMiningLibrary(),records:[record(a,'a','a',1),record(b,'b','b',2)]};
 render(<FishMiningLibrary/>);fireEvent.click(screen.getByRole('button',{name:'打开挖掘库'}));
 const rows=await screen.findAllByTestId('mining-library-row');expect(rows).toHaveLength(2);expect(rows.map(r=>r.textContent).join(' ')).toContain('avg_CBI2_2 > 0.04');expect(rows.map(r=>r.textContent).join(' ')).toContain('avg_CBI2_2 > 0.05');
 fireEvent.change(screen.getByLabelText('搜索挖掘库'),{target:{value:'avg_CBI2_2 > 0.05'}});expect(screen.getAllByTestId('mining-library-row')).toHaveLength(1);
});

it('shows exact Beijing mining times, sorts repeated captures separately, and selects only the matching threshold for deletion', async () => {
  const old = signal('AAAUSDT', [1]), newer = structuredClone(old), repeat = structuredClone(newer);
  for (const [capture, id, threshold, caughtAt] of [
    [old, 'capture-early', 0.04, A + 11_000],
    [newer, 'capture-new', 0.05, A + 23_000],
    [repeat, 'capture-repeat', 0.05, A + 35_000],
  ] as const) {
    capture.id = id;
    capture.caughtAt = caughtAt;
    capture.fish!.algorithms![0] = { ...capture.fish!.algorithms![0], direction: '>', threshold };
  }
  store.library = { ...emptyMiningLibrary(), records: [
    record(newer, 'new', 'new', A + 23_000),
    { ...record(repeat, 'repeat', 'repeat', A + 35_000), runId: 'restarted' },
    record(old, 'old', 'old', A + 11_000),
    record(signal('BBBUSDT', [1]), 'missing', 'missing', A + 9_000),
  ] };
  const remove = vi.fn();
  render(<FishBulkDeleteContext.Provider value={remove}><FishMiningLibrary/></FishBulkDeleteContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: '打开挖掘库' }));
  await screen.findAllByTestId('mining-library-mined-at');
  const dates = () => screen.getAllByTestId('mining-library-mined-at').map(cell => cell.textContent);
  const sort = screen.getByRole('button', { name: '按挖掘时间排序' });
  fireEvent.click(sort);
  expect(dates()).toEqual(['2026-05-16 12:00:35', '2026-05-16 12:00:23', '2026-05-16 12:00:11', '—']);
  fireEvent.click(sort);
  expect(dates()).toEqual(['2026-05-16 12:00:11', '2026-05-16 12:00:23', '2026-05-16 12:00:35', '—']);

  fireEvent.click(screen.getByRole('checkbox', { name: '选择挖掘记录 AAAUSDT new' }));
  const search = screen.getByLabelText('搜索挖掘库');
  fireEvent.change(search, { target: { value: '2026-05-16 12:00:11' } });
  expect(dates()).toEqual(['2026-05-16 12:00:11']);
  fireEvent.change(search, { target: { value: 'avg_CBI2_2 > 0.04' } });
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选（1）' }));
  fireEvent.click(screen.getByRole('button', { name: '删除所选（1）' }));
  expect(remove).toHaveBeenCalledWith({
    kind: 'mining', ids: ['old'], targets: [{ source: old, entry: A, origin: 'mined', miningCaptureId: old.id }],
  });
});

it('bulk selects a sorted, filtered range across the scroll window and supports the header checkbox', async () => {
  const captures = Array.from({ length: 20 }, (_, i) => {
    const source = { ...signal(`KEEP${String(i).padStart(2, '0')}USDT`, [1]), caughtAt: A + (i + 1) * 1000 };
    return record(source, String(i), String(i), source.caughtAt);
  });
  const excluded = { ...signal('OTHERUSDT', [1]), caughtAt: A + 10_500 };
  store.library = { ...emptyMiningLibrary(), records: [...captures, record(excluded, 'excluded', 'excluded', excluded.caughtAt)] };
  const remove = vi.fn();
  render(<FishBulkDeleteContext.Provider value={remove}><FishMiningLibrary/></FishBulkDeleteContext.Provider>);
  fireEvent.click(screen.getByRole('button', { name: '打开挖掘库' }));
  await screen.findAllByTestId('mining-library-row');

  fireEvent.change(screen.getByLabelText('搜索挖掘库'), { target: { value: 'KEEP' } });
  fireEvent.click(screen.getByRole('button', { name: '按挖掘时间排序' }));
  const first = screen.getByRole('checkbox', { name: '选择挖掘记录 KEEP19USDT 19' });
  const last = screen.getByRole('checkbox', { name: '选择挖掘记录 KEEP00USDT 0' });
  const header = screen.getByRole('checkbox', { name: '全选当前筛选的挖掘库记录' });
  expect(screen.queryByRole('checkbox', { name: '选择挖掘记录 KEEP03USDT 3' })).not.toBeInTheDocument();

  fireEvent.click(first);
  expect(header).toBePartiallyChecked();
  fireEvent.click(last, { shiftKey: true });
  expect(header).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '删除所选（20）' }));
  expect(remove.mock.calls[0][0].ids).toEqual(captures.map(capture => capture.id).reverse());

  fireEvent.click(first, { shiftKey: true });
  expect(screen.getByRole('button', { name: '删除所选（0）' })).toBeDisabled();
  fireEvent.click(header);
  expect(screen.getByRole('button', { name: '删除所选（20）' })).toBeEnabled();
  fireEvent.click(header);
  expect(screen.getByRole('button', { name: '删除所选（0）' })).toBeDisabled();
});

it('hands the selected actual mining date to the combination table with each original anchor', async () => {
  const old = { ...signal('OLDUSDT', [1]), caughtAt: Date.UTC(2026, 10, 4, 1) };
  const selected = { ...signal('NEWUSDT', [2]), caughtAt: Date.UTC(2026, 10, 6, 1, 18), mined: undefined };
  store.library = { ...emptyMiningLibrary(), records: [record(old, 'old', 'old', A), record(selected, 'new', 'new', A)] };
  const useInTable = vi.fn(() => true);
  render(<FishMiningLibrary onSelectInTable={useInTable}/>);
  fireEvent.click(screen.getByRole('button', { name: '打开挖掘库' }));
  await screen.findAllByTestId('mining-library-row');
  fireEvent.change(screen.getByLabelText('搜索挖掘库'), { target: { value: '2026-11-06' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '全选当前筛选的挖掘库记录' }));
  fireEvent.click(screen.getByRole('button', { name: '在组合表中勾选' }));
  expect(useInTable).toHaveBeenCalledWith([{ ...selected, mined: { anchorMs: A } }]);
  expect(screen.queryByRole('dialog', { name: '挖掘库' })).not.toBeInTheDocument();
});
