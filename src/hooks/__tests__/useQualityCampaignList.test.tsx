import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useQualityCampaignList } from '@/hooks/useQualityCampaignList';
import { listLocalInstantCampaignData, listQualityCampaignData } from '@/lib/fish/qualityCampaigns';
import { publishInstantCampaigns } from '@/lib/fish/instantCampaignStore';
import { buildUsdtLiveCampaignData } from '@/lib/fish/usdtLiveCampaignProjection';
import type { UsdtLiveCampaign } from '@/lib/fish/usdtLiveCampaign';
import { workspaceCampaignFixture } from '@/lib/fish/__tests__/workspaceCampaign.fixture';
import { listQualityCampaignDataFromStudy } from '@/lib/fish/qualityCampaignProjection';
vi.mock('@/lib/fish/qualityCampaigns', () => ({
  listQualityCampaignData: vi.fn(async () => ({ rows: [], warning: undefined, selectedSellKey: undefined })),
  listLocalInstantCampaignData: vi.fn(async () => []),
}));
afterEach(() => { cleanup(); vi.mocked(listQualityCampaignData).mockClear(); vi.mocked(listLocalInstantCampaignData).mockClear(); });

it('keeps a new exchange campaign through a delayed list read and closes the same card', async () => {
  const owner = 'live-list';
  const at = Date.UTC(2026, 10, 16, 3, 5, 0, 123);
  const open: UsdtLiveCampaign = {
    symbol: 'BEATUSDT', positionSide: 'LONG', direction: 'long', asset: 'USDT', openedAt: at, quantity: '100',
    fills: [{ id: '11', orderId: '21', at, price: '0.08', side: 'BUY', quantity: '100', positionQuantity: '100',
      action: 'open', commission: 0, realized: 0, commissionAsset: 'USDT' }],
  };
  const local = vi.mocked(listLocalInstantCampaignData);
  const list = vi.mocked(listQualityCampaignData);
  let finish!: (value: Awaited<ReturnType<typeof listQualityCampaignData>>) => void;
  list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const h = renderHook(() => useQualityCampaignList(owner, 'instant'));
  local.mockResolvedValueOnce([buildUsdtLiveCampaignData(owner, open)]);
  await act(async () => publishInstantCampaigns(owner));
  await waitFor(() => expect(h.result.current.rows[0]?.campaign.status).toBe('active'));
  const id = h.result.current.rows[0].campaign.id;
  await act(async () => finish({ rows: [], warning: undefined, selectedSellKey: undefined,
    buyFilterLabel: '', repair: undefined }));
  expect(h.result.current.rows.map(row => row.campaign.id)).toEqual([id]);
  const closeAt = at + 60_000;
  const closed: UsdtLiveCampaign = { ...open, closedAt: closeAt, quantity: '0', fills: [...open.fills,
    { ...open.fills[0], id: '12', orderId: '22', at: closeAt, price: '0.09', side: 'SELL', action: 'reduce', realized: 1 }] };
  local.mockResolvedValueOnce([buildUsdtLiveCampaignData(owner, closed)]);
  await act(async () => publishInstantCampaigns(owner));
  await waitFor(() => expect(h.result.current.rows.map(row => [row.campaign.id, row.campaign.closed_at])).toEqual([
    [id, new Date(closeAt).toISOString()],
  ]));
});
it('does no comparison loading for the personal board and isolates board/account switches and stale responses', async () => {
  const load = vi.mocked(listQualityCampaignData);
  // 【用户要求】2026-10-26 卖出比较与探测比较合并为「卖出与探测（控制变量法）」一个板块
  const h = renderHook(({ owner, section }) => useQualityCampaignList(owner, section), { initialProps: { owner: 'a', section: 'personal' as 'personal' | 'quality' } });
  expect(load).not.toHaveBeenCalled();
  h.rerender({ owner: 'a', section: 'quality' }); await waitFor(() => expect(h.result.current.complete).toBe(true)); expect(load).toHaveBeenLastCalledWith('a', 'quality',expect.any(AbortSignal),expect.any(Function));
  const previousSignal=load.mock.calls.at(-1)![2]!;
  h.rerender({ owner: 'b', section: 'quality' }); expect(h.result.current.rows).toEqual([]);
  await waitFor(() => expect(load).toHaveBeenLastCalledWith('b', 'quality',expect.any(AbortSignal),expect.any(Function)));expect(previousSignal.aborted).toBe(true);
  const n = load.mock.calls.length;
  act(() => { window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner: 'a' } })); }); expect(load).toHaveBeenCalledTimes(n);
  act(() => { window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner: 'b' } })); }); await waitFor(() => expect(load).toHaveBeenCalledTimes(n + 1));
});
it('shows current working campaigns while historical recovery is pending and retains them when recovery fails', async () => {
  let fail!: (error: Error) => void;
  const local = listQualityCampaignDataFromStudy('current', workspaceCampaignFixture(), 'quality', []);
  vi.mocked(listQualityCampaignData).mockImplementationOnce((_owner, _section, _signal, onLocal) => {
    onLocal?.(local);
    return new Promise((_resolve, reject) => { fail = reject; });
  });
  const h = renderHook(() => useQualityCampaignList('current', 'quality'));
  await waitFor(() => expect(h.result.current.rows).toHaveLength(local.rows.length));
  expect(h.result.current.complete).toBe(false);
  await act(async () => fail(Error('历史同步离线')));
  expect(h.result.current.rows.map(row => row.campaign.id)).toEqual(local.rows.map(row => row.campaign.id));
  expect(h.result.current.complete).toBe(true);
  expect(h.result.current.error).toBe('历史同步离线');
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
