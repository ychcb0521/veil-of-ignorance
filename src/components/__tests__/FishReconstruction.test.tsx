import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FishReconstructionResults, reconstructionMatches, SignalMatchCell } from '@/components/FishReconstruction';
import type { FishReconstructionState } from '@/hooks/useFishReconstruction';
import type { FishReconstructionResult } from '@/lib/fish/reconstruction';
import { formatUTC8 } from '@/lib/timeFormat';

const time = Date.UTC(2026, 5, 20);
const metrics = { strictRate: .5, looseRate: .75, noiseRate: 2, precision: .25, f1: 1 / 3, valid: 3, total: 4, skipped: { gap: 1 } };
function fixture(): FishReconstructionResult {
  return { createdAt: time, algorithms: [
    { key: 'bss', label: 'BSS', unit: '', bestThreshold: .023, currentThreshold: .1, train: { ...metrics, f1: .9 }, test: { ...metrics, f1: .2 }, scan: [{ threshold: .023, train: metrics, test: metrics }], perSignal: [
      { id: 'one', reading: .2, best: { strict: true, loose: true, start: time, unknown: false }, current: { strict: false, loose: false, start: null, unknown: false } },
      { id: 'skipped', reading: null, skip: 'gap', reason: 'K 线缺口', best: null, current: null },
    ] },
    { key: 'cba', label: 'CBA', unit: '', bestThreshold: 10, currentThreshold: 9, train: { ...metrics, f1: .1 }, test: { ...metrics, f1: .8 }, scan: [{ threshold: 10, train: metrics, test: metrics }], perSignal: [
      { id: 'one', reading: 12, best: { strict: false, loose: true, start: time - 1800000, unknown: false }, current: { strict: true, loose: true, start: time, unknown: false } },
    ] },
  ] } as unknown as FishReconstructionResult;
}
function state(result: FishReconstructionResult | null = fixture(), patch: Partial<FishReconstructionState> = {}): FishReconstructionState {
  return { result, stale: false, running: false, progress: null, error: '', warning: '', settingsError: '', available: true, mode: 'best', setMode: vi.fn(), start: vi.fn(), cancel: vi.fn(), onCardsChange: vi.fn(), ...patch };
}
afterEach(cleanup);

beforeEach(() => sessionStorage.clear());
describe('reconstruction report and signal matching', () => {
  it('strict and loose matches use distinct tones and expose readings plus close-time starts', () => {
    const matches = reconstructionMatches(fixture(), 'best', false);
    render(<SignalMatchCell match={matches.get('one')}/>);
    expect(screen.getByText('BSS > 0.023')).toHaveClass('text-foreground/90');
    expect(screen.getByText('CBA > 10')).toHaveClass('text-muted-foreground/45');
    const cell = screen.getByTestId('signal-reconstruction-match');
    expect(cell).toHaveAttribute('title', expect.stringContaining('t 时读数 0.2'));
    expect(cell).toHaveAttribute('title', expect.stringContaining(formatUTC8(time)));
    expect(cell).toHaveAttribute('title', expect.stringContaining(formatUTC8(time - 1800000)));
    expect(cell).toHaveAttribute('title', expect.stringContaining('仅宽松匹配'));
  });

  it('seller matches display the negative threshold and < direction', () => {
    const result=fixture();
    result.algorithms[0]={...result.algorithms[0],label:'DSS',direction:'<',bestThreshold:-.08,perSignal:result.algorithms[0].perSignal.map(row=>({...row,reading:row.reading==null?null:-row.reading}))};
    render(<SignalMatchCell match={reconstructionMatches(result,'best',false).get('one')}/>);
    expect(screen.getByText('DSS < -0.08')).toHaveClass('text-foreground/90');
    expect(screen.getByTestId('signal-reconstruction-match')).toHaveAttribute('title',expect.stringContaining('t 时读数 -0.2'));
  });

  it('current-threshold mode reads current evaluations and no longer lists best-only matches', () => {
    const matches = reconstructionMatches(fixture(), 'current', false);
    render(<SignalMatchCell match={matches.get('one')}/>);
    expect(screen.queryByText('BSS > 0.023')).toBeNull(); expect(screen.queryByText('BSS > 0.1')).toBeNull();
    expect(screen.getByText('CBA > 9')).toHaveClass('text-foreground/90');
    expect(screen.getByTestId('signal-reconstruction-match')).toHaveAttribute('title', expect.stringContaining('BSS > 0.1'));
  });

  it('unassessed rows show a dash, skipped rows explain why and old matches visibly expire', () => {
    const empty = render(<SignalMatchCell/>); expect(screen.getByTestId('signal-reconstruction-match')).toHaveTextContent('—'); empty.unmount();
    const matches = reconstructionMatches(fixture(), 'best', true);
    const skipped = render(<SignalMatchCell match={matches.get('skipped')}/>);
    expect(screen.getByTestId('signal-reconstruction-match')).toHaveTextContent('—');
    expect(screen.getByTestId('signal-reconstruction-match')).toHaveAttribute('title', expect.stringContaining('跳过：缺口'));
    skipped.unmount(); render(<SignalMatchCell match={matches.get('one')}/>);
    expect(screen.getByText('已过期')).toBeVisible();
    expect(screen.getByTestId('signal-reconstruction-match')).toHaveAttribute('title', expect.stringContaining('需重新评估'));
  });

  // 【用户要求】2026-10-20「复原的这个表格的结果折得起来，在复原后面加个隐形的符号」
  it('table is folded by default behind a faint toggle after 复原; opening is remembered for the session', () => {
    const view = render(<FishReconstructionResults state={state()}/>);
    expect(screen.queryAllByTestId('fish-reconstruction-row')).toHaveLength(0);
    const toggle = screen.getByRole('button', { name: '展开复原结果' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false'); expect(toggle).toHaveTextContent('复原');
    fireEvent.click(toggle);
    expect(screen.getAllByTestId('fish-reconstruction-row').length).toBeGreaterThan(0);
    view.unmount(); render(<FishReconstructionResults state={state()}/>);
    expect(screen.getAllByTestId('fish-reconstruction-row').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '收起复原结果' }));
    expect(screen.queryAllByTestId('fish-reconstruction-row')).toHaveLength(0);
  });

  it('ranking and headline metrics use held-out F1 rather than training F1', () => {
    render(<FishReconstructionResults state={state()}/>);
    fireEvent.click(screen.getByRole('button', { name: '展开复原结果' }));
    const rows = screen.getAllByTestId('fish-reconstruction-row');
    expect(within(rows[0]).getByText('CBA')).toBeVisible(); expect(within(rows[0]).getByText('最可能')).toBeVisible();
    expect(within(rows[0]).getByText('80.0%')).toBeVisible(); expect(within(rows[0]).getByText('3 / 4')).toBeVisible();
    expect(within(rows[1]).getByText('BSS')).toBeVisible(); expect(within(rows[1]).queryByText('最可能')).toBeNull();
    expect(screen.getByText('仅信号库 · 全部卡片 · 结果序列 · 买方 > / 卖方 < · 后 30% 验证')).toBeVisible();
  });

  it('expired results retain their explicit stale status and cancellation is explained', () => {
    render(<FishReconstructionResults state={state(fixture(), { stale: true, progress: { status: 'cancelled', phase: 'loading', done: 1, total: 2, current: '' } as FishReconstructionState['progress'] })}/>);
    expect(screen.getByTestId('fish-reconstruction-stale')).toHaveTextContent('已过期');
    expect(screen.getByText('复原已取消；未完成的结果不保存。')).toBeVisible();
  });
});
