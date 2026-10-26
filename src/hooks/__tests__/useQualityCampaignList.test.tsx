import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useQualityCampaignList } from '@/hooks/useQualityCampaignList';
import { listQualityCampaignData } from '@/lib/fish/qualityCampaigns';
vi.mock('@/lib/fish/qualityCampaigns', () => ({ listQualityCampaignData: vi.fn(async () => ({ rows: [], warning: undefined, selectedSellKey: undefined })) }));
afterEach(() => { cleanup(); vi.mocked(listQualityCampaignData).mockClear(); });
it('does no comparison loading for the personal board and isolates board/account switches and stale responses', async () => {
  const load = vi.mocked(listQualityCampaignData);
  const h = renderHook(({ owner, section }) => useQualityCampaignList(owner, section), { initialProps: { owner: 'a', section: 'personal' as 'personal' | 'sell' | 'detect' } });
  expect(load).not.toHaveBeenCalled();
  h.rerender({ owner: 'a', section: 'sell' }); await waitFor(() => expect(h.result.current.complete).toBe(true)); expect(load).toHaveBeenLastCalledWith('a', 'sell');
  h.rerender({ owner: 'b', section: 'detect' }); expect(h.result.current.rows).toEqual([]);
  await waitFor(() => expect(load).toHaveBeenLastCalledWith('b', 'detect'));
  const n = load.mock.calls.length;
  act(() => { window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner: 'a' } })); }); expect(load).toHaveBeenCalledTimes(n);
  act(() => { window.dispatchEvent(new CustomEvent('fish-quality-saved', { detail: { owner: 'b' } })); }); await waitFor(() => expect(load).toHaveBeenCalledTimes(n + 1));
});
