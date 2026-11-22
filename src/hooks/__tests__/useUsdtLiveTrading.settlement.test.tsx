import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useUsdtLiveTrading } from '../useUsdtLiveTrading';
import type { UsdtLiveCampaign } from '@/lib/fish/usdtLiveCampaign';

const store = vi.hoisted(() => ({ save: vi.fn(), sync: vi.fn() }));
vi.mock('@/lib/fish/fishPreferencesDb', () => ({ readFishPreferences: async () => [], updateFishPreference: vi.fn() }));
vi.mock('@/lib/fish/usdtLiveCampaignStore', () => ({ readUsdtCampaigns: async () => [], saveUsdtCampaignBatch: store.save, syncClosedUsdtCampaigns: store.sync }));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('delivers confirmed campaign closures before archive persistence or cloud synchronization finishes', async () => {
  vi.stubGlobal('indexedDB', {});
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  store.save.mockImplementation(() => new Promise(() => {}));
  const campaign = { symbol: 'AAAUSDT', positionSide: 'LONG', direction: 'long', asset: 'USDT', openedAt: 1000,
    closedAt: 2000, quantity: '0', fills: [{ id: '1', orderId: '1', action: 'open' }] } as UsdtLiveCampaign;
  const follow = { connected: true, positionMirror: 1 as const, campaignMirror: 1 as const,
    readPositions: vi.fn().mockResolvedValue({ observedAt: Date.now(), positions: [] }),
    readCampaigns: vi.fn().mockResolvedValue({ observedAt: Date.now(), campaigns: [campaign] }),
    readPositionHistory: vi.fn() };
  const settlements = vi.fn();
  renderHook(() => useUsdtLiveTrading('owner', follow, settlements));
  await waitFor(() => expect(settlements).toHaveBeenCalledWith([campaign]));
  expect(store.save).toHaveBeenCalled();
  expect(store.sync).not.toHaveBeenCalled();
});
