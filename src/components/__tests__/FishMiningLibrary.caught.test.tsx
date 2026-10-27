// 【用户要求】2026-10-27「挖掘库中命中算法这里只显示探测算法（也就是被哪个算法捕捉到的）」
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FishMiningLibrary } from '@/components/FishMiningLibrary';
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
  expect(bySymbol.AKEUSDT[3]).toBe('CBI-2·avg₂ · CBA·avg₂');
  expect(bySymbol.DOGEUSDT[3]).toBe('S·avg₂');
  expect(bySymbol.AKEUSDT[5]).toBe('在舱');
  expect(bySymbol.DOGEUSDT[5]).toBe('已从鱼舱删除');
  expect(screen.getByText(/2 条信号/)).toBeInTheDocument();
  // 按命中算法搜：只搜得到真正命中的
  fireEvent.change(screen.getByLabelText('搜索挖掘库'), { target: { value: 'S·avg' } });
  expect(screen.getAllByTestId('mining-library-row').map(r => within(r).getAllByRole('cell')[0].textContent)).toEqual(['DOGEUSDT']);
});
