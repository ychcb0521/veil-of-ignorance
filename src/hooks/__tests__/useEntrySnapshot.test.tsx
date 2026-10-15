import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntrySchellingPanel, SignalEntrySchelling } from '@/components/journal/EntrySchelling';
import { __setEntrySnapshotFetchForTests, useEntrySnapshot } from '@/hooks/useEntrySnapshot';
import { clearMarketDataCache } from '@/lib/deepRsa/marketData';
import { BAR_MS } from '@/lib/deepRsa/window';

const ANCHOR = Date.parse('2026-04-12T05:05:00Z');

/** 价格从 1 线性涨到 1.2，成交量恒定：收盘价高于 VWAP。 */
function klineRows(from: number, to: number) {
  const rows: unknown[][] = [];
  for (let t = from; t < to; t += BAR_MS) {
    const i = (t - (ANCHOR - 576 * BAR_MS)) / BAR_MS;
    const p = 1 + 0.2 * i / 576;
    rows.push([t, String(p), String(p * 1.001), String(p * 0.999), String(p), '1000', t + BAR_MS - 1, '0', 10, '500']);
  }
  return rows;
}

function fakeFetch(status = 200) {
  return vi.fn(async (url: string) => {
    const q = new URL(url).searchParams;
    return {
      ok: status === 200, status, headers: { get: () => null },
      json: async () => klineRows(Number(q.get('startTime')), Number(q.get('endTime')) + 1),
    };
  });
}

function Probe({ symbol, anchor }: { symbol: string; anchor: number }) {
  const s = useEntrySnapshot(symbol, anchor);
  return <span data-testid="probe">{s.status}{s.status === 'ready' ? ` ${s.snapshot.vwapDev!.toFixed(4)}` : ''}</span>;
}

beforeEach(() => { localStorage.clear(); clearMarketDataCache(); });
afterEach(() => __setEntrySnapshotFetchForTests(undefined));

describe('进场时的谢林偏离：按需取数、全站共用缓存', () => {
  it('测试环境默认不发请求', () => {
    __setEntrySnapshotFetchForTests(undefined);
    const spy = vi.spyOn(globalThis, 'fetch');
    render(<Probe symbol="ABCUSDT" anchor={ANCHOR} />);
    expect(screen.getByTestId('probe').textContent).toBe('idle');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('同一个标的 @ 时刻只取一次；结果持久化，重载后直接读缓存不再请求', async () => {
    const fetchFn = fakeFetch();
    __setEntrySnapshotFetchForTests(fetchFn);
    render(<><Probe symbol="abc" anchor={ANCHOR} /><Probe symbol="ABCUSDT" anchor={ANCHOR} /></>);
    await waitFor(() => expect(screen.getAllByTestId('probe')[0].textContent).toMatch(/^ready 0\.\d{4}$/));
    expect(screen.getAllByTestId('probe')[1].textContent).toBe(screen.getAllByTestId('probe')[0].textContent);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toContain('symbol=ABCUSDT');
    // 只拉 [t₀ − 48h, t₀)
    expect(fetchFn.mock.calls[0][0]).toContain(`endTime=${ANCHOR - 1}`);
    await act(async () => { await new Promise(r => setTimeout(r, 600)); });
    const stored = localStorage.getItem('campaign-entry-schelling-v1')!;
    expect(stored).toContain('ABCUSDT@');

    // 模拟重新打开页面：清内存、保留 localStorage
    const again = fakeFetch();
    __setEntrySnapshotFetchForTests(again);
    localStorage.setItem('campaign-entry-schelling-v1', stored);
    render(<Probe symbol="ABCUSDT" anchor={ANCHOR} />);
    expect(screen.getAllByTestId('probe').at(-1)!.textContent).toMatch(/^ready/);
    expect(again).not.toHaveBeenCalled();
  });

  it('币安没有这个合约：确定结果，缓存为「不可用」；进场时间还没到：不请求', async () => {
    const fetchFn = fakeFetch(400);
    __setEntrySnapshotFetchForTests(fetchFn);
    render(<><Probe symbol="NOPEUSDT" anchor={ANCHOR} /><Probe symbol="ABCUSDT" anchor={Date.now() + 3_600_000} /></>);
    await waitFor(() => expect(screen.getAllByTestId('probe')[0].textContent).toBe('unavailable'));
    expect(screen.getAllByTestId('probe')[1].textContent).toBe('unavailable');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('展示', () => {
  it('战役详情面板：偏离与参考价都写出来，名字和数字挨着', async () => {
    __setEntrySnapshotFetchForTests(fakeFetch());
    render(<EntrySchellingPanel symbol="ABCUSDT" anchorMs={ANCHOR} />);
    await waitFor(() => expect(screen.getByTestId('entry-schelling-vwap')).toBeInTheDocument());
    expect(screen.getByTestId('entry-schelling-vwap').textContent).toMatch(/^偏离 12h VWAP \+\d+\.\d%VWAP 1\.\d+$/);
    expect(screen.getByTestId('entry-schelling-poc').textContent).toContain('半衰期 6 小时');
    expect(screen.getByTestId('campaign-entry-schelling-panel').textContent).toContain('K 线覆盖率 100%');
  });

  it('没有进场时点：写明原因，不请求', () => {
    const fetchFn = fakeFetch();
    __setEntrySnapshotFetchForTests(fetchFn);
    render(<EntrySchellingPanel symbol="ABCUSDT" anchorMs={null} />);
    expect(screen.getByTestId('campaign-entry-schelling-panel').textContent).toContain('还没有成交的主力开仓');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('信号库三列：VWAP · POC · 兜底；兜底价相对收盘价', async () => {
    __setEntrySnapshotFetchForTests(fakeFetch());
    render(<SignalEntrySchelling symbol="ABCUSDT" timeMs={ANCHOR} fallbackPrice={1} />);
    await waitFor(() => expect(screen.getByTestId('signal-entry-schelling').dataset.status).toBe('ready'));
    const cells = [...screen.getByTestId('signal-entry-schelling').children].map(c => c.textContent);
    expect(cells).toHaveLength(3);
    expect(cells[0]).toMatch(/^\+\d+\.\d%$/);
    // 收盘价约 1.2，兜底 1 → 约 +20%
    expect(cells[2]).toMatch(/^\+(19|20)\.\d%$/);
  });
});
