import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useQualityCampaignList } from '@/hooks/useQualityCampaignList';
import { listQualityCampaignData } from '@/lib/fish/qualityCampaigns';
vi.mock('@/lib/fish/qualityCampaigns', () => ({ listQualityCampaignData: vi.fn(async () => ({ rows: [], warning: undefined, selectedSellKey: undefined })) }));
afterEach(() => { cleanup(); vi.mocked(listQualityCampaignData).mockClear(); });
it('does no comparison loading for the personal board and isolates board/account switches and stale responses', async () => {
  const load = vi.mocked(listQualityCampaignData);
  // 【用户要求】2026-10-26 卖出比较与探测比较合并为「卖出与探测（控制变量法）」一个板块
  const h = renderHook(({ owner, section }) => useQualityCampaignList(owner, section), { initialProps: { owner: 'a', section: 'personal' as 'personal' | 'quality' } });
  expect(load).not.toHaveBeenCalled();
  h.rerender({ owner: 'a', section: 'quality' }); await waitFor(() => expect(h.result.current.complete).toBe(true)); expect(load).toHaveBeenLastCalledWith('a', 'quality');
  h.rerender({ owner: 'b', section: 'quality' }); expect(h.result.current.rows).toEqual([]);
  await waitFor(() => expect(load).toHaveBeenLastCalledWith('b', 'quality'));
  const n = load.mock.calls.length;
  act(() => { window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner: 'a' } })); }); expect(load).toHaveBeenCalledTimes(n);
  act(() => { window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner: 'b' } })); }); await waitFor(() => expect(load).toHaveBeenCalledTimes(n + 1));
});
it('passes the sell board buy-filter label through and clears it on other boards', async () => {
  const load = vi.mocked(listQualityCampaignData);
  load.mockResolvedValueOnce({ rows: [], warning: undefined, selectedSellKey: undefined, buyFilterLabel: '状态 S 原始值 > 0.7' } as never);
  const h = renderHook(() => useQualityCampaignList('a', 'quality'));
  await waitFor(() => expect(h.result.current.buyFilterLabel).toBe('状态 S 原始值 > 0.7'));
});
it('clears the list on the first repair checkpoint and rebuilds on completion rather than every saved trade', async () => {
  const load = vi.mocked(listQualityCampaignData);
  const h = renderHook(() => useQualityCampaignList('a', 'quality'));
  await waitFor(() => expect(h.result.current.complete).toBe(true));
  const initial = load.mock.calls.length;
  load.mockResolvedValueOnce({ rows: [], repair: { id: 'batch-a', state: 'running' } } as never);
  const saved = (state: string) => window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner: 'a', repair: { id: 'batch-a', state } } }));
  await act(async () => { saved('running'); });
  expect(load).toHaveBeenCalledTimes(initial + 1);
  await act(async () => { for (let i = 0; i < 100; i++) saved('running'); });
  expect(load).toHaveBeenCalledTimes(initial + 1);
  await act(async () => { saved('paused'); });
  expect(load).toHaveBeenCalledTimes(initial + 2);
  await act(async () => { saved('complete'); });
  expect(load).toHaveBeenCalledTimes(initial + 3);
});


it('coalesces focus/save bursts into one pending refresh and never holds concurrent full snapshots', async () => {
  const load = vi.mocked(listQualityCampaignData);
  let finish!: (value: any) => void;
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const h = renderHook(() => useQualityCampaignList('burst', 'quality'));
  expect(load).toHaveBeenCalledTimes(1);
  act(() => {
    for (let i = 0; i < 100; i++) {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner: 'burst' } }));
    }
  });
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ rows: [], warning: '旧读数不应提交' }); });
  await waitFor(() => expect(h.result.current.complete).toBe(true));
  expect(load).toHaveBeenCalledTimes(2);
  expect(h.result.current.error).toBeNull();
});

it('deduplicates repair checkpoints even before the first async checkpoint has finished reading', async () => {
  const load = vi.mocked(listQualityCampaignData);
  const h = renderHook(() => useQualityCampaignList('repair', 'quality'));
  await waitFor(() => expect(h.result.current.complete).toBe(true));
  let finish!: (value: any) => void;
  load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const count = load.mock.calls.length;
  const event = () => window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner: 'repair', repair: { id: 'active-batch', state: 'running' } } }));
  act(() => { for (let i = 0; i < 100; i++) event(); });
  expect(load).toHaveBeenCalledTimes(count + 1);
  await act(async () => { finish({ rows: [], repair: { id: 'active-batch', state: 'running' } }); });
  expect(load).toHaveBeenCalledTimes(count + 1);
  h.unmount();
  act(() => window.dispatchEvent(new Event('focus')));
  expect(load).toHaveBeenCalledTimes(count + 1);
});
